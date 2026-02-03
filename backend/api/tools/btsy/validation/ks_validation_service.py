from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json

import duckdb
import numpy as np
from scipy import stats

from api.tools.btsy.duckdb_pool import duckdb_pool


class KSValidationService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ks_validation_runs (
                  ks_run_id INTEGER PRIMARY KEY,
                  session_id INTEGER NOT NULL,
                  boundary_id INTEGER NOT NULL,
                  behaviour_run_id INTEGER NOT NULL,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ks_results (
                  ks_run_id INTEGER NOT NULL,
                  variant_type TEXT NOT NULL,
                  ks_stat DOUBLE,
                  p_value DOUBLE,
                  n_atl INTEGER,
                  n_btl INTEGER,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ks_sensitivity_results (
                  ks_run_id INTEGER NOT NULL,
                  delta_type TEXT NOT NULL,
                  delta_value TEXT NOT NULL,
                  ks_stat DOUBLE,
                  ks_shift DOUBLE,
                  n_atl INTEGER,
                  n_btl INTEGER,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ks_leakage_checks (
                  ks_run_id INTEGER NOT NULL,
                  check_type TEXT NOT NULL,
                  status TEXT NOT NULL,
                  message TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ks_cdf_points (
                  ks_run_id INTEGER NOT NULL,
                  x DOUBLE NOT NULL,
                  atl_cdf DOUBLE,
                  btl_cdf DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS ks_annotations (
                  ks_run_id INTEGER NOT NULL,
                  analyst_note TEXT NOT NULL,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def _next_id(self, conn: duckdb.DuckDBPyConnection, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def _log_event(self, session_id: int, event_type: str, event: Dict, created_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            event_id = self._next_id(conn, "calibration_event_log", "event_id")
            conn.execute(
                "INSERT INTO calibration_event_log (event_id, session_id, event_type, event_json, created_by) VALUES (?, ?, ?, ?, ?)",
                [event_id, session_id, event_type, json.dumps(event or {}), created_by]
            )

    def _record_check(self, ks_run_id: int, check_type: str, status: str, message: str):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute(
                "INSERT INTO ks_leakage_checks (ks_run_id, check_type, status, message) VALUES (?, ?, ?, ?)",
                [ks_run_id, check_type, status, message]
            )

    def _get_session_meta(self, session_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            s = conn.execute("""
                SELECT behavior_run_id, metric_name
                FROM calibration_sessions
                WHERE session_id = ?
            """, [session_id]).fetchone()
            if not s:
                raise ValueError("Session not found")
            agg = conn.execute("""
                SELECT entity_collapse, time_lens, sustained_days
                FROM aggregation_configs
                WHERE session_id = ?
            """, [session_id]).fetchone()
            entity_collapse = (agg[0] if agg else 'max')
            time_lens = (agg[1] if agg else 'full')
            sustained_days = int(agg[2]) if agg and agg[2] is not None else 3
            return {
                'behavior_run_id': int(s[0]),
                'metric_name': s[1],
                'entity_collapse': entity_collapse,
                'time_lens': time_lens,
                'sustained_days': sustained_days,
                'aggregation_lens': f"entity={entity_collapse};time={time_lens};n={sustained_days}"
            }

    def _get_boundary(self, session_id: int, boundary_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            agg = conn.execute("""
                SELECT entity_collapse, time_lens, sustained_days
                FROM aggregation_configs
                WHERE session_id = ?
            """, [session_id]).fetchone()
            entity_collapse = (agg[0] if agg else 'max')
            time_lens = (agg[1] if agg else 'full')
            sustained_days = int(agg[2]) if agg and agg[2] is not None else 3
            current_lens = f"entity={entity_collapse};time={time_lens};n={sustained_days}"

            b = conn.execute("""
                SELECT boundary_id, strategy_id, buffer_type, buffer_params_json, aggregation_lens
                FROM risk_boundary_definitions
                WHERE session_id = ? AND boundary_id = ?
            """, [session_id, boundary_id]).fetchone()
            if not b:
                raise ValueError("Boundary not found")
            stored_lens = b[4]
            if stored_lens and stored_lens != current_lens:
                raise ValueError("No boundary exists for the selected behaviour + aggregation lens in this session.")
            s = conn.execute("""
                SELECT strategy_id, name, strategy_type, params_json, threshold_value
                FROM threshold_strategies
                WHERE session_id = ? AND strategy_id = ?
            """, [session_id, int(b[1])]).fetchone()
            if not s:
                raise ValueError("Boundary strategy not found")
            return {
                'boundary_id': int(b[0]),
                'strategy': {
                    'strategy_id': int(s[0]),
                    'name': s[1],
                    'strategy_type': s[2],
                    'params': json.loads(s[3]) if s[3] else {},
                    'threshold_value': float(s[4] or 0.0)
                },
                'buffer_type': b[2],
                'buffer_params': json.loads(b[3]) if b[3] else {},
                'aggregation_lens': b[4]
            }

    def _boundary_thresholds(self, threshold_value: float, buffer_type: str, buffer_params: Dict) -> Tuple[float, float]:
        bt = (buffer_type or 'hard').lower()
        if bt == 'hard':
            return float(threshold_value), float(threshold_value)
        band_pct = float((buffer_params or {}).get('band_pct', 2.0))
        band_pct = max(0.0, min(50.0, band_pct))
        lower = float(threshold_value) * (1.0 - band_pct / 100.0)
        upper = float(threshold_value) * (1.0 + band_pct / 100.0)
        return float(lower), float(upper)

    def _agg_query(self, behavior_run_id: int, metric_name: str, entity_collapse: str, time_lens: str, sustained_days: int) -> str:
        entity_collapse = (entity_collapse or 'max').lower()
        time_lens = (time_lens or 'full').lower()
        metric_filter = f"behavior_run_id = {int(behavior_run_id)}"
        if metric_name:
            metric_filter += " AND metric_name = '" + metric_name.replace("'", "''") + "'"

        if time_lens == 'full':
            base = f"""
                SELECT entity_id, as_of_date, metric_value
                FROM behavior_table
                WHERE {metric_filter}
            """
        else:
            base = f"""
                SELECT entity_id, date_trunc('day', as_of_date) AS as_of_date, MAX(metric_value) AS metric_value
                FROM behavior_table
                WHERE {metric_filter}
                GROUP BY entity_id, as_of_date
            """

        if time_lens in ('rolling_peak', 'sustained'):
            n = max(1, int(sustained_days or 3))
            base = f"""
                WITH daily AS ({base}),
                w AS (
                  SELECT
                    entity_id,
                    as_of_date,
                    metric_value,
                    SUM(metric_value) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS roll_sum,
                    AVG(metric_value) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS roll_avg,
                    MIN(CASE WHEN metric_value != 0 THEN 1 ELSE 0 END) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN {n - 1} PRECEDING AND CURRENT ROW
                    ) AS all_non_zero
                  FROM daily
                )
                SELECT
                  entity_id,
                  as_of_date,
                  CASE
                    WHEN '{time_lens}' = 'rolling_peak' THEN roll_sum
                    WHEN '{time_lens}' = 'sustained' THEN CASE WHEN all_non_zero = 1 THEN roll_avg ELSE NULL END
                    ELSE metric_value
                  END AS metric_value
                FROM w
            """

        if entity_collapse == 'max':
            return f"SELECT entity_id, MAX(metric_value) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'avg':
            return f"SELECT entity_id, AVG(metric_value) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'p95':
            return f"SELECT entity_id, quantile(metric_value, 0.95) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        if entity_collapse == 'last':
            return f"SELECT entity_id, max_by(metric_value, as_of_date) AS aggregated_value FROM ({base}) t GROUP BY entity_id"
        raise ValueError("Unsupported entity collapse method")

    def _fetch_behavior_rows(self, behavior_db_path: Path, meta: Dict, lower: float, upper: float, max_rows: int = 200000) -> Dict:
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])

        with duckdb_pool.connection(behavior_db_path) as conn:
            q = f"""
                WITH agg AS ({agg_query})
                SELECT
                  b.as_of_date,
                  b.metric_value,
                  CASE
                    WHEN a.aggregated_value >= {float(upper)} THEN 'ATL'
                    WHEN a.aggregated_value < {float(lower)} THEN 'BTL'
                    ELSE 'EXCLUDE'
                  END AS pop
                FROM behavior_table b
                JOIN agg a ON b.entity_id = a.entity_id
                WHERE b.behavior_run_id = ? AND b.metric_name = ?
                  AND (a.aggregated_value >= {float(upper)} OR a.aggregated_value < {float(lower)})
            """
            if max_rows and max_rows > 0:
                q = f"SELECT * FROM ({q}) USING SAMPLE {int(max_rows)} ROWS"
            rows = conn.execute(q, [meta['behavior_run_id'], meta['metric_name']]).fetchall()

        dates: List = []
        values: List[float] = []
        pops: List[str] = []
        for d, v, p in rows:
            if v is None:
                continue
            dates.append(d)
            values.append(float(v))
            pops.append(p)
        if not values:
            return {'atl': np.array([]), 'btl': np.array([]), 'dates': [], 'values': np.array([]), 'pops': np.array([])}

        values_np = np.asarray(values, dtype=float)
        pops_np = np.asarray(pops)
        atl = values_np[pops_np == 'ATL']
        btl = values_np[pops_np == 'BTL']
        return {'atl': atl, 'btl': btl, 'dates': dates, 'values': values_np, 'pops': pops_np}

    def _ks(self, a: np.ndarray, b: np.ndarray) -> Dict:
        a = np.asarray(a, dtype=float)
        b = np.asarray(b, dtype=float)
        a = a[np.isfinite(a)]
        b = b[np.isfinite(b)]
        if len(a) == 0 or len(b) == 0:
            return {'ks_stat': None, 'p_value': None, 'n_atl': int(len(a)), 'n_btl': int(len(b))}
        ks_stat, p_value = stats.ks_2samp(a, b, alternative='two-sided', mode='asymp')
        return {'ks_stat': float(ks_stat), 'p_value': float(p_value), 'n_atl': int(len(a)), 'n_btl': int(len(b))}

    def _cdf_overlay(self, a: np.ndarray, b: np.ndarray, points: int = 120) -> List[Dict]:
        a = np.asarray(a, dtype=float)
        b = np.asarray(b, dtype=float)
        a = a[np.isfinite(a)]
        b = b[np.isfinite(b)]
        if len(a) == 0 or len(b) == 0:
            return []
        lo = float(min(np.min(a), np.min(b)))
        hi = float(max(np.max(a), np.max(b)))
        if hi == lo:
            hi = lo + 1.0
        xs = np.linspace(lo, hi, max(10, int(points)))
        a_sorted = np.sort(a)
        b_sorted = np.sort(b)

        out = []
        for x in xs:
            a_cdf = float(np.searchsorted(a_sorted, x, side='right') / len(a_sorted))
            b_cdf = float(np.searchsorted(b_sorted, x, side='right') / len(b_sorted))
            out.append({'x': float(x), 'atl_cdf': a_cdf, 'btl_cdf': b_cdf})
        return out

    def create_run(self, behavior_db_path: Path, session_id: int, boundary_id: int, created_by: Optional[str]) -> Dict:
        meta = self._get_session_meta(session_id)
        boundary = self._get_boundary(session_id, boundary_id)
        lower, upper = self._boundary_thresholds(boundary['strategy']['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])

        with duckdb_pool.connection(self.db_path) as conn:
            ks_run_id = self._next_id(conn, "ks_validation_runs", "ks_run_id")
            conn.execute("""
                INSERT INTO ks_validation_runs (ks_run_id, session_id, boundary_id, behaviour_run_id, created_by)
                VALUES (?, ?, ?, ?, ?)
            """, [ks_run_id, session_id, boundary_id, meta['behavior_run_id'], created_by])
            conn.execute("DELETE FROM ks_results WHERE ks_run_id = ?", [ks_run_id])
            conn.execute("DELETE FROM ks_leakage_checks WHERE ks_run_id = ?", [ks_run_id])
            conn.execute("DELETE FROM ks_cdf_points WHERE ks_run_id = ?", [ks_run_id])

        self._record_check(ks_run_id, "context", "ok", "Behaviour source: Step-2 behavior_table rows. Population split source: Step-3.4 boundary.")
        self._record_check(ks_run_id, "behavior_rows_only", "ok", "KS computed ONLY on behavior_table.metric_value rows (not entity reductions).")

        rows = self._fetch_behavior_rows(behavior_db_path, meta, lower, upper, max_rows=0)
        atl = rows['atl']
        btl = rows['btl']

        if len(atl) == 0 or len(btl) == 0:
            self._record_check(ks_run_id, "missing_population", "blocked", "Boundary produces empty ATL or BTL behaviour-row population.")
            self._log_event(session_id, "ks_validation_blocked", {'ks_run_id': int(ks_run_id), 'boundary_id': int(boundary_id)}, created_by)
            return {
                'ks_run_id': int(ks_run_id),
                'blocked': True,
                'meta': meta,
                'boundary': boundary,
                'thresholds': {'lower': lower, 'upper': upper},
                'results': [],
                'cdf': [],
                'checks': self.get_checks(ks_run_id)
            }

        full = self._ks(atl, btl)

        tail_pct = 5.0
        combined = np.concatenate([atl, btl])
        tail_q = float(np.quantile(combined, max(0.0, min(1.0, 1.0 - tail_pct / 100.0)))) if len(combined) else 0.0
        tail_atl = atl[atl >= tail_q]
        tail_btl = btl[btl >= tail_q]
        tail = self._ks(tail_atl, tail_btl)

        dates = rows['dates']
        vals = rows['values']
        pops = rows['pops']
        early = {'ks_stat': None, 'p_value': None, 'n_atl': 0, 'n_btl': 0}
        late = {'ks_stat': None, 'p_value': None, 'n_atl': 0, 'n_btl': 0}
        if dates and len(dates) == len(vals) and len(vals) == len(pops):
            date_np = np.asarray(dates).astype('datetime64[ns]')
            mid = np.quantile(date_np.astype('int64'), 0.5)
            mid_dt = np.datetime64(int(mid), 'ns')

            mask_early = date_np <= mid_dt
            mask_late = ~mask_early
            atl_early = vals[(pops == 'ATL') & mask_early]
            btl_early = vals[(pops == 'BTL') & mask_early]
            atl_late = vals[(pops == 'ATL') & mask_late]
            btl_late = vals[(pops == 'BTL') & mask_late]
            early = self._ks(atl_early, btl_early)
            late = self._ks(atl_late, btl_late)

        checks = self._derive_checks(ks_run_id, atl, btl, full)
        cdf = self._cdf_overlay(atl, btl)

        results = [
            {'variant_type': 'full', **full},
            {'variant_type': f'tail_top_{int(tail_pct)}pct', **tail},
            {'variant_type': 'time_early', **early},
            {'variant_type': 'time_late', **late}
        ]

        with duckdb_pool.connection(self.db_path) as conn3:
            for r in results:
                conn3.execute("""
                    INSERT INTO ks_results (ks_run_id, variant_type, ks_stat, p_value, n_atl, n_btl)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, [ks_run_id, r['variant_type'], r['ks_stat'], r['p_value'], r['n_atl'], r['n_btl']])
            if cdf:
                rows = [(ks_run_id, p['x'], p['atl_cdf'], p['btl_cdf']) for p in cdf]
                conn3.executemany("""
                    INSERT INTO ks_cdf_points (ks_run_id, x, atl_cdf, btl_cdf)
                    VALUES (?, ?, ?, ?)
                """, rows)

        self._log_event(session_id, "ks_validation_computed", {
            'ks_run_id': int(ks_run_id),
            'boundary_id': int(boundary_id),
            'variants': [r['variant_type'] for r in results],
            'aggregation_lens': meta['aggregation_lens']
        }, created_by)

        return {
            'ks_run_id': int(ks_run_id),
            'blocked': False,
            'meta': meta,
            'boundary': boundary,
            'thresholds': {'lower': lower, 'upper': upper},
            'results': results,
            'cdf': cdf,
            'checks': checks
        }

    def _derive_checks(self, ks_run_id: int, atl: np.ndarray, btl: np.ndarray, full: Dict) -> List[Dict]:
        checks = []
        min_n = min(int(len(atl)), int(len(btl)))
        if min_n < 200:
            self._record_check(ks_run_id, "sample_size", "warning", f"Low behaviour-row sample size (min(n_atl,n_btl)={min_n}).")
        a_min, a_max = (float(np.min(atl)), float(np.max(atl))) if len(atl) else (None, None)
        b_min, b_max = (float(np.min(btl)), float(np.max(btl))) if len(btl) else (None, None)
        if a_min is not None and b_min is not None:
            if a_min > b_max or b_min > a_max:
                self._record_check(ks_run_id, "disjoint_support", "warning", "ATL and BTL behaviour rows have disjoint value support (no overlap).")
        ks_stat = full.get('ks_stat')
        p = full.get('p_value')
        if ks_stat is not None and ks_stat >= 0.95:
            self._record_check(ks_run_id, "artefact_extreme_separation", "warning", "KS is extremely high; check for boundary artefact or data leakage.")
        if p is not None and p < 1e-10 and min_n < 500:
            self._record_check(ks_run_id, "pvalue_tiny_small_n", "warning", "Extremely small p-value with limited sample size.")
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT check_type, status, message, created_at
                FROM ks_leakage_checks
                WHERE ks_run_id = ?
                ORDER BY created_at ASC
            """, [ks_run_id]).fetchall()
        for r in rows:
            checks.append({'check_type': r[0], 'status': r[1], 'message': r[2], 'created_at': str(r[3])})
        return checks

    def get_checks(self, ks_run_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT check_type, status, message, created_at
                FROM ks_leakage_checks
                WHERE ks_run_id = ?
                ORDER BY created_at ASC
            """, [ks_run_id]).fetchall()
        return [{'check_type': r[0], 'status': r[1], 'message': r[2], 'created_at': str(r[3])} for r in rows]

    def get_run(self, ks_run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT ks_run_id, session_id, boundary_id, behaviour_run_id, created_by, created_at
                FROM ks_validation_runs
                WHERE ks_run_id = ?
            """, [ks_run_id]).fetchone()
            if not run:
                raise ValueError("KS run not found")
            results = conn.execute("""
                SELECT variant_type, ks_stat, p_value, n_atl, n_btl, computed_at
                FROM ks_results
                WHERE ks_run_id = ?
                ORDER BY computed_at DESC
            """, [ks_run_id]).fetchall()
            sens = conn.execute("""
                SELECT delta_type, delta_value, ks_stat, ks_shift, n_atl, n_btl, computed_at
                FROM ks_sensitivity_results
                WHERE ks_run_id = ?
                ORDER BY computed_at DESC
            """, [ks_run_id]).fetchall()
            checks = conn.execute("""
                SELECT check_type, status, message, created_at
                FROM ks_leakage_checks
                WHERE ks_run_id = ?
                ORDER BY created_at ASC
            """, [ks_run_id]).fetchall()
            cdf = conn.execute("""
                SELECT x, atl_cdf, btl_cdf, computed_at
                FROM ks_cdf_points
                WHERE ks_run_id = ?
                ORDER BY x ASC
            """, [ks_run_id]).fetchall()
            notes = conn.execute("""
                SELECT analyst_note, created_by, created_at
                FROM ks_annotations
                WHERE ks_run_id = ?
                ORDER BY created_at ASC
            """, [ks_run_id]).fetchall()

        return {
            'run': {
                'ks_run_id': int(run[0]),
                'session_id': int(run[1]),
                'boundary_id': int(run[2]),
                'behaviour_run_id': int(run[3]),
                'created_by': run[4],
                'created_at': str(run[5])
            },
            'results': [{
                'variant_type': r[0],
                'ks_stat': float(r[1]) if r[1] is not None else None,
                'p_value': float(r[2]) if r[2] is not None else None,
                'n_atl': int(r[3]) if r[3] is not None else 0,
                'n_btl': int(r[4]) if r[4] is not None else 0,
                'computed_at': str(r[5])
            } for r in results],
            'sensitivity': [{
                'delta_type': r[0],
                'delta_value': r[1],
                'ks_stat': float(r[2]) if r[2] is not None else None,
                'ks_shift': float(r[3]) if r[3] is not None else None,
                'n_atl': int(r[4]) if r[4] is not None else 0,
                'n_btl': int(r[5]) if r[5] is not None else 0,
                'computed_at': str(r[6])
            } for r in sens],
            'checks': [{'check_type': r[0], 'status': r[1], 'message': r[2], 'created_at': str(r[3])} for r in checks],
            'cdf': [{'x': float(r[0]), 'atl_cdf': float(r[1]) if r[1] is not None else None, 'btl_cdf': float(r[2]) if r[2] is not None else None, 'computed_at': str(r[3])} for r in cdf],
            'annotations': [{'analyst_note': r[0], 'created_by': r[1], 'created_at': str(r[2])} for r in notes]
        }

    def list_runs(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT ks_run_id, boundary_id, behaviour_run_id, created_by, created_at
                FROM ks_validation_runs
                WHERE session_id = ?
                ORDER BY ks_run_id DESC
                LIMIT 200
            """, [session_id]).fetchall()
        return [{
            'ks_run_id': int(r[0]),
            'boundary_id': int(r[1]),
            'behaviour_run_id': int(r[2]),
            'created_by': r[3],
            'created_at': str(r[4])
        } for r in rows]

    def stress_run(self, behavior_db_path: Path, session_id: int, ks_run_id: int, deltas_pct: List[float], subsample_fracs: List[float], created_by: Optional[str]) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("SELECT boundary_id FROM ks_validation_runs WHERE ks_run_id = ? AND session_id = ?", [ks_run_id, session_id]).fetchone()
            if not run:
                raise ValueError("KS run not found")
            boundary_id = int(run[0])

        meta = self._get_session_meta(session_id)
        boundary = self._get_boundary(session_id, boundary_id)
        lower0, upper0 = self._boundary_thresholds(boundary['strategy']['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])

        base_rows = self._fetch_behavior_rows(behavior_db_path, meta, lower0, upper0, max_rows=0)
        base_full = self._ks(base_rows['atl'], base_rows['btl'])
        base_ks = base_full.get('ks_stat')

        results = []
        for d in deltas_pct or []:
            d = float(d)
            lower = lower0 * (1.0 + d / 100.0)
            upper = upper0 * (1.0 + d / 100.0)
            rows = self._fetch_behavior_rows(behavior_db_path, meta, lower, upper, max_rows=0)
            full = self._ks(rows['atl'], rows['btl'])
            shift = (float(full['ks_stat']) - float(base_ks)) if (full['ks_stat'] is not None and base_ks is not None) else None
            results.append({
                'delta_type': 'threshold_pct',
                'delta_value': f"{d:+.1f}%",
                'ks_stat': full['ks_stat'],
                'ks_shift': shift,
                'n_atl': full['n_atl'],
                'n_btl': full['n_btl']
            })

        for frac in subsample_fracs or []:
            frac = float(frac)
            frac = max(0.05, min(1.0, frac))
            rows = self._fetch_behavior_rows(behavior_db_path, meta, lower0, upper0, max_rows=0)
            atl = rows['atl']
            btl = rows['btl']
            if len(atl) > 0:
                atl = np.random.choice(atl, size=max(1, int(len(atl) * frac)), replace=False)
            if len(btl) > 0:
                btl = np.random.choice(btl, size=max(1, int(len(btl) * frac)), replace=False)
            full = self._ks(atl, btl)
            shift = (float(full['ks_stat']) - float(base_ks)) if (full['ks_stat'] is not None and base_ks is not None) else None
            results.append({
                'delta_type': 'subsample_frac',
                'delta_value': f"{frac:.2f}",
                'ks_stat': full['ks_stat'],
                'ks_shift': shift,
                'n_atl': full['n_atl'],
                'n_btl': full['n_btl']
            })

        with duckdb_pool.connection(self.db_path) as conn2:
            conn2.execute("DELETE FROM ks_sensitivity_results WHERE ks_run_id = ?", [ks_run_id])
            for r in results:
                conn2.execute("""
                    INSERT INTO ks_sensitivity_results (ks_run_id, delta_type, delta_value, ks_stat, ks_shift, n_atl, n_btl)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, [ks_run_id, r['delta_type'], r['delta_value'], r['ks_stat'], r['ks_shift'], r['n_atl'], r['n_btl']])

        self._log_event(session_id, "ks_validation_stressed", {
            'ks_run_id': int(ks_run_id),
            'deltas_pct': deltas_pct,
            'subsample_fracs': subsample_fracs,
            'aggregation_lens': meta['aggregation_lens']
        }, created_by)

        return results

    def add_annotation(self, session_id: int, ks_run_id: int, note: str, created_by: Optional[str]) -> Dict:
        text = (note or "").strip()
        if not text:
            raise ValueError("analyst_note required")
        with duckdb_pool.connection(self.db_path) as conn:
            exists = conn.execute("SELECT 1 FROM ks_validation_runs WHERE ks_run_id = ? AND session_id = ? LIMIT 1", [ks_run_id, session_id]).fetchone()
            if not exists:
                raise ValueError("KS run not found")
            conn.execute("""
                INSERT INTO ks_annotations (ks_run_id, analyst_note, created_by)
                VALUES (?, ?, ?)
            """, [ks_run_id, text, created_by])
        self._log_event(session_id, "ks_validation_note_added", {'ks_run_id': int(ks_run_id)}, created_by)
        return {'success': True}
