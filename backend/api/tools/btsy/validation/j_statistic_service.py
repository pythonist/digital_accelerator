from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json

import duckdb
import numpy as np

from api.tools.btsy.duckdb_pool import duckdb_pool


class JStatisticService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_step36_results (
                  step36_id INTEGER PRIMARY KEY,
                  session_id INTEGER NOT NULL,
                  boundary_id INTEGER NOT NULL,
                  signal_name TEXT NOT NULL,
                  max_j DOUBLE,
                  threshold_value DOUBLE,
                  threshold_percentile DOUBLE,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_step36_stability (
                  step36_id INTEGER NOT NULL,
                  n_samples INTEGER NOT NULL,
                  sample_frac DOUBLE NOT NULL,
                  mean_j DOUBLE,
                  std_j DOUBLE,
                  min_j DOUBLE,
                  max_j DOUBLE,
                  stability_label TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_step36_stability_samples (
                  step36_id INTEGER NOT NULL,
                  sample_index INTEGER NOT NULL,
                  max_j DOUBLE,
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
                'signal_name': s[1],
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
                SELECT strategy_id, name, threshold_value
                FROM threshold_strategies
                WHERE session_id = ? AND strategy_id = ?
            """, [session_id, int(b[1])]).fetchone()
            if not s:
                raise ValueError("Boundary strategy not found")
            return {
                'boundary_id': int(b[0]),
                'strategy_id': int(s[0]),
                'strategy_name': s[1],
                'threshold_value': float(s[2] or 0.0),
                'buffer_type': b[2],
                'buffer_params': json.loads(b[3]) if b[3] else {}
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

    def _agg_query(self, behavior_run_id: int, signal_name: str, entity_collapse: str, time_lens: str, sustained_days: int) -> str:
        entity_collapse = (entity_collapse or 'max').lower()
        time_lens = (time_lens or 'full').lower()
        metric_filter = f"behavior_run_id = {int(behavior_run_id)}"
        if signal_name:
            metric_filter += " AND metric_name = '" + signal_name.replace("'", "''") + "'"

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

    def _fetch_labeled_rows(self, behavior_db_path: Path, meta: Dict, lower: float, upper: float, sample_entity_ids: Optional[List[str]] = None) -> Dict:
        agg_query = self._agg_query(meta['behavior_run_id'], meta['signal_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        entity_filter_sql = ""
        entity_params: List = []
        if sample_entity_ids:
            entity_filter_sql = f" AND b.entity_id IN ({','.join(['?'] * len(sample_entity_ids))})"
            entity_params = list(sample_entity_ids)

        with duckdb_pool.connection(behavior_db_path) as conn:
            rows = conn.execute(f"""
                WITH agg AS ({agg_query})
                SELECT
                  b.entity_id,
                  b.metric_value AS signal_value,
                  CASE
                    WHEN a.aggregated_value >= {float(upper)} THEN 1
                    WHEN a.aggregated_value < {float(lower)} THEN 0
                    ELSE NULL
                  END AS is_atl
                FROM behavior_table b
                JOIN agg a ON b.entity_id = a.entity_id
                WHERE b.behavior_run_id = ? AND b.metric_name = ?
                  AND (a.aggregated_value >= {float(upper)} OR a.aggregated_value < {float(lower)})
                  {entity_filter_sql}
            """, [meta['behavior_run_id'], meta['signal_name'], *entity_params]).fetchall()

        entity_ids: List[str] = []
        signal: List[float] = []
        labels: List[int] = []
        for eid, v, y in rows:
            if v is None or y is None:
                continue
            entity_ids.append(eid)
            signal.append(float(v))
            labels.append(int(y))

        if not signal:
            return {'entity_ids': np.array([]), 'signal': np.array([]), 'labels': np.array([])}

        return {
            'entity_ids': np.asarray(entity_ids),
            'signal': np.asarray(signal, dtype=float),
            'labels': np.asarray(labels, dtype=int)
        }

    def _compute_j_curve(self, signal: np.ndarray, labels: np.ndarray, points: int = 120) -> Dict:
        signal = np.asarray(signal, dtype=float)
        labels = np.asarray(labels, dtype=int)
        mask = np.isfinite(signal)
        signal = signal[mask]
        labels = labels[mask]

        pos = signal[labels == 1]
        neg = signal[labels == 0]
        n_pos = int(len(pos))
        n_neg = int(len(neg))
        if n_pos == 0 or n_neg == 0:
            return {
                'max_j': None,
                'threshold_value': None,
                'threshold_percentile': None,
                'n_atl_rows': n_pos,
                'n_btl_rows': n_neg,
                'curve': []
            }

        lo = float(np.min(signal))
        hi = float(np.max(signal))
        if hi == lo:
            hi = lo + 1.0

        thresholds = np.linspace(lo, hi, max(20, int(points)))
        curve = []
        max_j = -1.0
        max_t = None

        for t in thresholds:
            tpr = float(np.mean(pos >= t)) if n_pos else 0.0
            fpr = float(np.mean(neg >= t)) if n_neg else 0.0
            j = tpr - fpr
            curve.append({'threshold': float(t), 'tpr': tpr, 'fpr': fpr, 'j': j})
            if j > max_j:
                max_j = j
                max_t = float(t)

        pct = float(np.mean(signal <= max_t) * 100.0) if max_t is not None else None
        return {
            'max_j': float(max_j),
            'threshold_value': float(max_t) if max_t is not None else None,
            'threshold_percentile': pct,
            'n_atl_rows': n_pos,
            'n_btl_rows': n_neg,
            'curve': curve
        }

    def _interpret_j(self, max_j: Optional[float]) -> str:
        if max_j is None:
            return 'insufficient_data'
        if max_j < 0.2:
            return 'weak'
        if max_j < 0.4:
            return 'moderate'
        return 'strong'

    def _stability_label(self, mean_j: float, std_j: float) -> str:
        if mean_j is None or std_j is None:
            return 'unknown'
        if mean_j <= 0:
            return 'unknown'
        rel = float(std_j / max(mean_j, 1e-9))
        if rel <= 0.10:
            return 'stable'
        if rel <= 0.25:
            return 'sensitive'
        return 'fragile'

    def compute_step36(self, behavior_db_path: Path, session_id: int, boundary_id: int, created_by: Optional[str]) -> Dict:
        meta = self._get_session_meta(session_id)
        boundary = self._get_boundary(session_id, boundary_id)
        lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])

        data = self._fetch_labeled_rows(behavior_db_path, meta, lower, upper)
        j = self._compute_j_curve(data['signal'], data['labels'], points=120)
        interpretation = self._interpret_j(j['max_j'])

        with duckdb_pool.connection(self.db_path) as conn:
            step36_id = self._next_id(conn, "calibration_step36_results", "step36_id")
            conn.execute("""
                INSERT INTO calibration_step36_results (
                  step36_id, session_id, boundary_id, signal_name,
                  max_j, threshold_value, threshold_percentile, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                step36_id,
                session_id,
                boundary_id,
                meta['signal_name'],
                j['max_j'],
                j['threshold_value'],
                j['threshold_percentile'],
                created_by
            ])

        self._log_event(session_id, "STEP_3_6_RUN", {
            'step36_id': int(step36_id),
            'boundary_id': int(boundary_id),
            'signal_name': meta['signal_name'],
            'max_j': j['max_j'],
            'threshold_percentile': j['threshold_percentile'],
            'interpretation': interpretation
        }, created_by)

        return {
            'step36_id': int(step36_id),
            'session_id': int(session_id),
            'boundary_id': int(boundary_id),
            'signal_name': meta['signal_name'],
            'aggregation_lens': meta['aggregation_lens'],
            'population': {
                'n_atl_rows': int(j['n_atl_rows']),
                'n_btl_rows': int(j['n_btl_rows'])
            },
            'result': {
                'max_j': j['max_j'],
                'threshold_value': j['threshold_value'],
                'threshold_percentile': j['threshold_percentile'],
                'interpretation': interpretation
            },
            'curve': j['curve']
        }

    def compute_stability(self, behavior_db_path: Path, session_id: int, step36_id: int, n_samples: int, sample_frac: float, created_by: Optional[str]) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT session_id, boundary_id, signal_name
                FROM calibration_step36_results
                WHERE step36_id = ?
            """, [step36_id]).fetchone()
            if not row:
                raise ValueError("Step-3.6 run not found")
            if int(row[0]) != int(session_id):
                raise ValueError("Step-3.6 run does not belong to session")
            boundary_id = int(row[1])
            signal_name = row[2]

        meta = self._get_session_meta(session_id)
        meta = {**meta, 'signal_name': signal_name}
        boundary = self._get_boundary(session_id, boundary_id)
        lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])

        n_samples = max(5, min(100, int(n_samples or 20)))
        sample_frac = float(sample_frac or 0.75)
        sample_frac = max(0.5, min(0.9, sample_frac))

        base = self._fetch_labeled_rows(behavior_db_path, meta, lower, upper)
        entities = np.unique(base['entity_ids'])
        if len(entities) < 10:
            raise ValueError("Insufficient entities for stability sampling")

        js = []
        with duckdb_pool.connection(self.db_path) as conn2:
            conn2.execute("DELETE FROM calibration_step36_stability WHERE step36_id = ?", [step36_id])
            conn2.execute("DELETE FROM calibration_step36_stability_samples WHERE step36_id = ?", [step36_id])

        for i in range(n_samples):
            k = max(1, int(len(entities) * sample_frac))
            sampled = np.random.choice(entities, size=k, replace=False)
            data = self._fetch_labeled_rows(behavior_db_path, meta, lower, upper, sample_entity_ids=list(sampled))
            j = self._compute_j_curve(data['signal'], data['labels'], points=80)
            js.append(j['max_j'] if j['max_j'] is not None else 0.0)
            with duckdb_pool.connection(self.db_path) as conn3:
                conn3.execute("""
                    INSERT INTO calibration_step36_stability_samples (step36_id, sample_index, max_j)
                    VALUES (?, ?, ?)
                """, [step36_id, i + 1, j['max_j']])

        js_np = np.asarray(js, dtype=float)
        mean_j = float(np.mean(js_np)) if len(js_np) else None
        std_j = float(np.std(js_np)) if len(js_np) else None
        min_j = float(np.min(js_np)) if len(js_np) else None
        max_j = float(np.max(js_np)) if len(js_np) else None
        stability_label = self._stability_label(mean_j, std_j) if mean_j is not None and std_j is not None else 'unknown'

        with duckdb_pool.connection(self.db_path) as conn4:
            conn4.execute("""
                INSERT INTO calibration_step36_stability (
                  step36_id, n_samples, sample_frac, mean_j, std_j, min_j, max_j, stability_label, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [step36_id, n_samples, sample_frac, mean_j, std_j, min_j, max_j, stability_label, created_by])

        self._log_event(session_id, "STEP_3_6_STABILITY", {
            'step36_id': int(step36_id),
            'n_samples': int(n_samples),
            'sample_frac': float(sample_frac),
            'mean_j': mean_j,
            'std_j': std_j,
            'stability_label': stability_label
        }, created_by)

        return {
            'step36_id': int(step36_id),
            'n_samples': int(n_samples),
            'sample_frac': float(sample_frac),
            'mean_j': mean_j,
            'std_j': std_j,
            'min_j': min_j,
            'max_j': max_j,
            'stability_label': stability_label
        }

    def list_runs(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT step36_id, boundary_id, signal_name, max_j, threshold_percentile, created_by, created_at
                FROM calibration_step36_results
                WHERE session_id = ?
                ORDER BY step36_id DESC
                LIMIT 200
            """, [session_id]).fetchall()
        return [{
            'step36_id': int(r[0]),
            'boundary_id': int(r[1]),
            'signal_name': r[2],
            'max_j': float(r[3]) if r[3] is not None else None,
            'threshold_percentile': float(r[4]) if r[4] is not None else None,
            'created_by': r[5],
            'created_at': str(r[6])
        } for r in rows]

    def get_run(self, session_id: int, step36_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT step36_id, session_id, boundary_id, signal_name, max_j, threshold_value, threshold_percentile, created_by, created_at
                FROM calibration_step36_results
                WHERE step36_id = ?
            """, [step36_id]).fetchone()
            if not run or int(run[1]) != int(session_id):
                raise ValueError("Step-3.6 run not found")
            stab = conn.execute("""
                SELECT n_samples, sample_frac, mean_j, std_j, min_j, max_j, stability_label, created_at
                FROM calibration_step36_stability
                WHERE step36_id = ?
                ORDER BY created_at DESC
                LIMIT 1
            """, [step36_id]).fetchone()
            samples = conn.execute("""
                SELECT sample_index, max_j, created_at
                FROM calibration_step36_stability_samples
                WHERE step36_id = ?
                ORDER BY sample_index ASC
            """, [step36_id]).fetchall()

        interpretation = self._interpret_j(float(run[4]) if run[4] is not None else None)
        return {
            'run': {
                'step36_id': int(run[0]),
                'session_id': int(run[1]),
                'boundary_id': int(run[2]),
                'signal_name': run[3],
                'max_j': float(run[4]) if run[4] is not None else None,
                'threshold_value': float(run[5]) if run[5] is not None else None,
                'threshold_percentile': float(run[6]) if run[6] is not None else None,
                'interpretation': interpretation,
                'created_by': run[7],
                'created_at': str(run[8])
            },
            'stability': (None if not stab else {
                'n_samples': int(stab[0]),
                'sample_frac': float(stab[1]),
                'mean_j': float(stab[2]) if stab[2] is not None else None,
                'std_j': float(stab[3]) if stab[3] is not None else None,
                'min_j': float(stab[4]) if stab[4] is not None else None,
                'max_j': float(stab[5]) if stab[5] is not None else None,
                'stability_label': stab[6],
                'created_at': str(stab[7])
            }),
            'stability_samples': [{'sample_index': int(s[0]), 'max_j': float(s[1]) if s[1] is not None else None, 'created_at': str(s[2])} for s in samples]
        }

