from pathlib import Path
from typing import Dict, List, Optional, Tuple
import json
import math
import duckdb

from api.tools.btsy.duckdb_pool import duckdb_pool


class RiskPopulationService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS risk_boundaries_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS risk_boundary_annotations_seq START 1")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_boundary_definitions (
                  boundary_id INTEGER PRIMARY KEY DEFAULT nextval('risk_boundaries_seq'),
                  session_id INTEGER NOT NULL,
                  strategy_id INTEGER NOT NULL,
                  buffer_type TEXT NOT NULL,
                  buffer_params_json TEXT,
                  aggregation_lens TEXT,
                  behavior_run_id INTEGER,
                  boundary_type TEXT,
                  boundary_value DOUBLE,
                  status TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            try:
                conn.execute("ALTER TABLE risk_boundary_definitions ADD COLUMN behavior_run_id INTEGER")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE risk_boundary_definitions ADD COLUMN boundary_type TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE risk_boundary_definitions ADD COLUMN boundary_value DOUBLE")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE risk_boundary_definitions ADD COLUMN status TEXT")
            except Exception:
                pass

            conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_population_stats (
                  boundary_id INTEGER NOT NULL,
                  aggregation_lens TEXT,
                  population_type TEXT NOT NULL,
                  entity_count INTEGER,
                  population_pct DOUBLE,
                  median DOUBLE,
                  p95 DOUBLE,
                  p99 DOUBLE,
                  volume_pct DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_boundary_stress_results (
                  boundary_id INTEGER NOT NULL,
                  aggregation_lens TEXT,
                  delta_pct DOUBLE NOT NULL,
                  entity_churn_pct DOUBLE,
                  volume_churn_pct DOUBLE,
                  enter_pct DOUBLE,
                  leave_pct DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_population_overlap (
                  boundary_a INTEGER NOT NULL,
                  boundary_b INTEGER NOT NULL,
                  aggregation_lens TEXT,
                  overlap_pct DOUBLE,
                  jaccard DOUBLE,
                  intersection_count INTEGER,
                  only_a_count INTEGER,
                  only_b_count INTEGER,
                  volume_overlap_pct DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS risk_boundary_annotations (
                  annotation_id INTEGER PRIMARY KEY DEFAULT nextval('risk_boundary_annotations_seq'),
                  boundary_id INTEGER NOT NULL,
                  annotation_text TEXT NOT NULL,
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

    def _get_session_meta(self, session_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT behavior_run_id, metric_name
                FROM calibration_sessions
                WHERE session_id = ?
            """, [session_id]).fetchone()
            if not row:
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
                'behavior_run_id': int(row[0]),
                'metric_name': row[1],
                'entity_collapse': entity_collapse,
                'time_lens': time_lens,
                'sustained_days': sustained_days,
                'aggregation_lens': f"entity={entity_collapse};time={time_lens};n={sustained_days}"
            }

    def _get_strategy(self, session_id: int, strategy_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT strategy_id, name, strategy_type, params_json, threshold_value
                FROM threshold_strategies
                WHERE session_id = ? AND strategy_id = ?
            """, [session_id, strategy_id]).fetchone()
            if not row:
                raise ValueError("Strategy not found")
            return {
                'strategy_id': int(row[0]),
                'name': row[1],
                'strategy_type': row[2],
                'params': json.loads(row[3]) if row[3] else {},
                'threshold_value': float(row[4] or 0.0)
            }

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

    def _boundary_thresholds(self, threshold_value: float, buffer_type: str, buffer_params: Dict) -> Dict:
        bt = (buffer_type or 'hard').lower()
        if bt == 'hard':
            return {'lower': float(threshold_value), 'upper': float(threshold_value)}
        band_pct = float((buffer_params or {}).get('band_pct', 2.0))
        band_pct = max(0.0, min(50.0, band_pct))
        lower = float(threshold_value) * (1.0 - band_pct / 100.0)
        upper = float(threshold_value) * (1.0 + band_pct / 100.0)
        return {'lower': float(lower), 'upper': float(upper)}

    def create_boundary(self, behavior_db_path: Path, session_id: int, strategy_id: int, buffer_type: str, buffer_params: Dict, created_by: Optional[str]) -> Dict:
        meta = self._get_session_meta(session_id)
        aggregation_lens = meta['aggregation_lens']
        boundary_type = None
        boundary_value = None
        try:
            strategy = self._get_strategy(session_id, strategy_id)
            boundary_value = float(strategy.get('threshold_value') or 0.0)
            st = str(strategy.get('strategy_type') or '').lower()
            params = strategy.get('params') or {}
            if st == 'percentile':
                pct = params.get('percentile') or params.get('pct')
                if pct is not None:
                    boundary_type = f"P{int(float(pct))}"
                else:
                    boundary_type = "PCTL"
            elif st == 'absolute':
                boundary_type = "VALUE"
            elif st == 'top_n':
                n = params.get('n') or params.get('top_n')
                boundary_type = f"TOP_{int(n)}" if n is not None else "TOP_N"
            else:
                boundary_type = (strategy.get('strategy_type') or '').upper() or None
        except Exception:
            pass
        with duckdb_pool.connection(self.db_path) as conn:
            boundary_id = self._next_id(conn, "risk_boundary_definitions", "boundary_id")
            conn.execute("""
                INSERT INTO risk_boundary_definitions (
                  boundary_id, session_id, strategy_id, buffer_type, buffer_params_json, aggregation_lens,
                  behavior_run_id, boundary_type, boundary_value, status, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                int(boundary_id),
                int(session_id),
                int(strategy_id),
                buffer_type,
                json.dumps(buffer_params or {}),
                aggregation_lens,
                int(meta['behavior_run_id']),
                boundary_type,
                boundary_value,
                'ACTIVE',
                created_by
            ])
        self._log_event(session_id, 'risk_boundary_created', {
            'boundary_id': int(boundary_id),
            'strategy_id': int(strategy_id),
            'buffer_type': buffer_type,
            'buffer_params': buffer_params or {},
            'aggregation_lens': aggregation_lens
        }, created_by)
        self.compute_boundary_stats(behavior_db_path=behavior_db_path, session_id=session_id, boundary_id=int(boundary_id), created_by=created_by)
        return {'boundary_id': int(boundary_id)}

    def list_boundaries(self, session_id: int) -> List[Dict]:
        meta = self._get_session_meta(session_id)
        with duckdb_pool.connection(self.db_path) as conn:
            try:
                conn.execute(
                    """
                    UPDATE risk_boundary_definitions
                    SET behavior_run_id = ?
                    WHERE session_id = ? AND behavior_run_id IS NULL
                    """,
                    [int(meta['behavior_run_id']), int(session_id)],
                )
            except Exception:
                pass
            try:
                conn.execute(
                    """
                    UPDATE risk_boundary_definitions
                    SET aggregation_lens = ?
                    WHERE session_id = ? AND (aggregation_lens IS NULL OR aggregation_lens = '')
                    """,
                    [meta['aggregation_lens'], int(session_id)],
                )
            except Exception:
                pass
            try:
                conn.execute(
                    """
                    UPDATE risk_boundary_definitions
                    SET status = 'ACTIVE'
                    WHERE session_id = ? AND (status IS NULL OR status = '')
                    """,
                    [int(session_id)],
                )
            except Exception:
                pass

            rows = conn.execute(
                """
                SELECT boundary_id, strategy_id, buffer_type, buffer_params_json, aggregation_lens,
                       behavior_run_id, boundary_type, boundary_value, status, created_by, created_at
                FROM risk_boundary_definitions
                WHERE session_id = ?
                  AND aggregation_lens = ?
                  AND behavior_run_id = ?
                  AND COALESCE(status, 'ACTIVE') = 'ACTIVE'
                ORDER BY boundary_id DESC
                LIMIT 200
                """,
                [int(session_id), meta['aggregation_lens'], int(meta['behavior_run_id'])],
            ).fetchall()
            return [
                {
                    'boundary_id': int(r[0]),
                    'strategy_id': int(r[1]),
                    'buffer_type': r[2],
                    'buffer_params': json.loads(r[3]) if r[3] else {},
                    'aggregation_lens': r[4],
                    'behavior_run_id': int(r[5]) if r[5] is not None else None,
                    'boundary_type': r[6],
                    'boundary_value': float(r[7]) if r[7] is not None else None,
                    'status': r[8] or 'ACTIVE',
                    'created_by': r[9],
                    'created_at': str(r[10]),
                }
                for r in rows
            ]

    def get_boundary(self, session_id: int, boundary_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute("""
                SELECT boundary_id, session_id, strategy_id, buffer_type, buffer_params_json, aggregation_lens,
                       behavior_run_id, boundary_type, boundary_value, status, created_by, created_at
                FROM risk_boundary_definitions
                WHERE session_id = ? AND boundary_id = ?
            """, [session_id, boundary_id]).fetchone()
            if not row:
                raise ValueError("Boundary not found")
            annotations = conn.execute("""
                SELECT annotation_id, annotation_text, created_by, created_at
                FROM risk_boundary_annotations
                WHERE boundary_id = ?
                ORDER BY annotation_id ASC
            """, [boundary_id]).fetchall()
            stats = conn.execute("""
                SELECT population_type, entity_count, population_pct, median, p95, p99, volume_pct, computed_at, aggregation_lens
                FROM risk_population_stats
                WHERE boundary_id = ?
                ORDER BY computed_at DESC
                LIMIT 10
            """, [boundary_id]).fetchall()
            stress = conn.execute("""
                SELECT delta_pct, entity_churn_pct, volume_churn_pct, enter_pct, leave_pct, computed_at, aggregation_lens
                FROM risk_boundary_stress_results
                WHERE boundary_id = ?
                ORDER BY computed_at DESC, delta_pct ASC
                LIMIT 50
            """, [boundary_id]).fetchall()
        return {
            'boundary': {
                'boundary_id': int(row[0]),
                'session_id': int(row[1]),
                'strategy_id': int(row[2]),
                'buffer_type': row[3],
                'buffer_params': json.loads(row[4]) if row[4] else {},
                'aggregation_lens': row[5],
                'behavior_run_id': int(row[6]) if row[6] is not None else None,
                'boundary_type': row[7],
                'boundary_value': float(row[8]) if row[8] is not None else None,
                'status': row[9] or 'ACTIVE',
                'created_by': row[10],
                'created_at': str(row[11])
            },
            'annotations': [{
                'annotation_id': int(a[0]),
                'annotation_text': a[1],
                'created_by': a[2],
                'created_at': str(a[3])
            } for a in annotations],
            'stats': [{
                'population_type': s[0],
                'entity_count': int(s[1]) if s[1] is not None else None,
                'population_pct': float(s[2]) if s[2] is not None else None,
                'median': float(s[3]) if s[3] is not None else None,
                'p95': float(s[4]) if s[4] is not None else None,
                'p99': float(s[5]) if s[5] is not None else None,
                'volume_pct': float(s[6]) if s[6] is not None else None,
                'computed_at': str(s[7]),
                'aggregation_lens': s[8]
            } for s in stats],
            'stress': [{
                'delta_pct': float(r[0]),
                'entity_churn_pct': float(r[1]) if r[1] is not None else None,
                'volume_churn_pct': float(r[2]) if r[2] is not None else None,
                'enter_pct': float(r[3]) if r[3] is not None else None,
                'leave_pct': float(r[4]) if r[4] is not None else None,
                'computed_at': str(r[5]),
                'aggregation_lens': r[6]
            } for r in stress]
        }

    def compute_boundary_stats(self, behavior_db_path: Path, session_id: int, boundary_id: int, created_by: Optional[str]) -> Dict:
        meta = self._get_session_meta(session_id)
        aggregation_lens = meta['aggregation_lens']
        with duckdb_pool.connection(self.db_path) as conn:
            b = conn.execute("""
                SELECT strategy_id, buffer_type, buffer_params_json, aggregation_lens
                FROM risk_boundary_definitions
                WHERE session_id = ? AND boundary_id = ?
            """, [session_id, boundary_id]).fetchone()
            if not b:
                raise ValueError("Boundary not found")
            strategy_id = int(b[0])
            buffer_type = b[1]
            buffer_params = json.loads(b[2]) if b[2] else {}
            stored_lens = b[3]
            if stored_lens and stored_lens != aggregation_lens:
                raise ValueError("No boundary exists for the selected behaviour + aggregation lens in this session.")

        strategy = self._get_strategy(session_id, strategy_id)
        threshold_value = float(strategy['threshold_value'] or 0.0)
        thresholds = self._boundary_thresholds(threshold_value, buffer_type, buffer_params)
        lower = thresholds['lower']
        upper = thresholds['upper']

        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        with duckdb_pool.connection(behavior_db_path) as bconn:
            total_n = int(bconn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)
            total_volume = float(bconn.execute(f"SELECT SUM(ABS(aggregated_value)) FROM ({agg_query})").fetchone()[0] or 0.0)

            def segment(where_sql: str) -> Dict:
                n = int(bconn.execute(f"SELECT COUNT(*) FROM ({agg_query}) WHERE {where_sql}").fetchone()[0] or 0)
                pct = float(n / total_n * 100.0) if total_n else 0.0
                stats = bconn.execute(f"""
                    SELECT
                      median(aggregated_value) AS med,
                      quantile(aggregated_value, 0.95) AS p95,
                      quantile(aggregated_value, 0.99) AS p99,
                      SUM(ABS(aggregated_value)) AS vol
                    FROM ({agg_query})
                    WHERE {where_sql}
                """).fetchone()
                vol = float(stats[3] or 0.0)
                vol_pct = float(vol / total_volume * 100.0) if total_volume else 0.0
                return {
                    'entity_count': n,
                    'population_pct': pct,
                    'median': float(stats[0]) if stats[0] is not None else None,
                    'p95': float(stats[1]) if stats[1] is not None else None,
                    'p99': float(stats[2]) if stats[2] is not None else None,
                    'volume_pct': vol_pct
                }

            atl = segment(f"aggregated_value >= {upper}")
            btl = segment(f"aggregated_value < {lower}")
            review = None
            if upper != lower:
                review = segment(f"aggregated_value >= {lower} AND aggregated_value < {upper}")

        with duckdb_pool.connection(self.db_path) as conn2:
            conn2.execute("DELETE FROM risk_population_stats WHERE boundary_id = ?", [boundary_id])
            conn2.execute("""
                INSERT INTO risk_population_stats (boundary_id, aggregation_lens, population_type, entity_count, population_pct, median, p95, p99, volume_pct)
                VALUES (?, ?, 'ATL', ?, ?, ?, ?, ?, ?)
            """, [boundary_id, aggregation_lens, atl['entity_count'], atl['population_pct'], atl['median'], atl['p95'], atl['p99'], atl['volume_pct']])
            if review is not None:
                conn2.execute("""
                    INSERT INTO risk_population_stats (boundary_id, aggregation_lens, population_type, entity_count, population_pct, median, p95, p99, volume_pct)
                    VALUES (?, ?, 'REVIEW', ?, ?, ?, ?, ?, ?)
                """, [boundary_id, aggregation_lens, review['entity_count'], review['population_pct'], review['median'], review['p95'], review['p99'], review['volume_pct']])
            conn2.execute("""
                INSERT INTO risk_population_stats (boundary_id, aggregation_lens, population_type, entity_count, population_pct, median, p95, p99, volume_pct)
                VALUES (?, ?, 'BTL', ?, ?, ?, ?, ?, ?)
            """, [boundary_id, aggregation_lens, btl['entity_count'], btl['population_pct'], btl['median'], btl['p95'], btl['p99'], btl['volume_pct']])

        self._log_event(session_id, 'risk_population_stats_computed', {
            'boundary_id': int(boundary_id),
            'strategy_id': int(strategy_id),
            'threshold_value': threshold_value,
            'lower': lower,
            'upper': upper,
            'aggregation_lens': aggregation_lens
        }, created_by)

        return {
            'boundary_id': int(boundary_id),
            'strategy': strategy,
            'threshold': {'threshold_value': threshold_value, 'lower': lower, 'upper': upper},
            'atl': atl,
            'review': review,
            'btl': btl
        }

    def stress_boundary(self, behavior_db_path: Path, session_id: int, boundary_id: int, deltas_pct: List[float], created_by: Optional[str]) -> List[Dict]:
        baseline = self.compute_boundary_stats(behavior_db_path, session_id, boundary_id, created_by)
        meta = self._get_session_meta(session_id)
        aggregation_lens = meta['aggregation_lens']
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])

        base_upper = float(baseline['threshold']['upper'])
        base_atl_where = f"aggregated_value >= {base_upper}"

        with duckdb_pool.connection(behavior_db_path) as conn:
            base_total = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0] or 0)
            base_atl_count = int(conn.execute(f"SELECT COUNT(*) FROM ({agg_query}) WHERE {base_atl_where}").fetchone()[0] or 0)
            base_atl_volume = float(conn.execute(f"SELECT SUM(ABS(aggregated_value)) FROM ({agg_query}) WHERE {base_atl_where}").fetchone()[0] or 0.0)
            base_ids = set(r[0] for r in conn.execute(f"SELECT entity_id FROM ({agg_query}) WHERE {base_atl_where}").fetchall())
            results = []
            for d in deltas_pct:
                d = float(d)
                th = base_upper * (1.0 + d / 100.0)
                ids = set(r[0] for r in conn.execute(f"SELECT entity_id FROM ({agg_query}) WHERE aggregated_value >= {float(th)}").fetchall())
                enter = len(ids - base_ids)
                leave = len(base_ids - ids)
                churn_pct = float((enter + leave) / base_atl_count * 100.0) if base_atl_count else 0.0
                enter_pct = float(enter / base_atl_count * 100.0) if base_atl_count else 0.0
                leave_pct = float(leave / base_atl_count * 100.0) if base_atl_count else 0.0
                sym_ids = list(ids.symmetric_difference(base_ids))
                volume_churn = 0.0
                if sym_ids:
                    values = conn.execute(f"""
                        SELECT SUM(ABS(aggregated_value))
                        FROM ({agg_query})
                        WHERE entity_id IN ({",".join(["?"] * len(sym_ids))})
                    """, sym_ids).fetchone()[0]
                    volume_churn = float(values or 0.0)
                volume_churn_pct = float(volume_churn / base_atl_volume * 100.0) if base_atl_volume else 0.0
                results.append({
                    'delta_pct': d,
                    'entity_churn_pct': churn_pct,
                    'volume_churn_pct': volume_churn_pct,
                    'enter_pct': enter_pct,
                    'leave_pct': leave_pct,
                    'base_atl_count': base_atl_count,
                    'population_base': base_total
                })

        with duckdb_pool.connection(self.db_path) as wconn:
            wconn.execute("DELETE FROM risk_boundary_stress_results WHERE boundary_id = ?", [boundary_id])
            for r in results:
                wconn.execute("""
                    INSERT INTO risk_boundary_stress_results (
                      boundary_id, aggregation_lens, delta_pct, entity_churn_pct, volume_churn_pct, enter_pct, leave_pct
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, [boundary_id, aggregation_lens, r['delta_pct'], r['entity_churn_pct'], r['volume_churn_pct'], r['enter_pct'], r['leave_pct']])

        self._log_event(session_id, 'risk_boundary_stress_tested', {
            'boundary_id': int(boundary_id),
            'deltas_pct': deltas_pct,
            'aggregation_lens': aggregation_lens
        }, created_by)
        return results

    def borderline_entities(self, behavior_db_path: Path, session_id: int, boundary_id: int, limit: int = 50) -> List[Dict]:
        meta = self._get_session_meta(session_id)
        aggregation_lens = meta['aggregation_lens']
        with duckdb_pool.connection(self.db_path) as conn:
            b = conn.execute("""
                SELECT strategy_id, buffer_type, buffer_params_json
                FROM risk_boundary_definitions
                WHERE session_id = ? AND boundary_id = ?
            """, [session_id, boundary_id]).fetchone()
            if not b:
                raise ValueError("Boundary not found")
            strategy_id = int(b[0])
            buffer_type = b[1]
            buffer_params = json.loads(b[2]) if b[2] else {}

        strategy = self._get_strategy(session_id, strategy_id)
        thresholds = self._boundary_thresholds(float(strategy['threshold_value'] or 0.0), buffer_type, buffer_params)
        lower = thresholds['lower']
        upper = thresholds['upper']

        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])
        lim = max(1, min(200, int(limit or 50)))

        with duckdb_pool.connection(behavior_db_path) as conn2:
            rows = conn2.execute(f"""
                WITH agg AS ({agg_query})
                SELECT
                  entity_id,
                  aggregated_value,
                  ABS(aggregated_value - {float(strategy['threshold_value'] or 0.0)}) AS distance
                FROM agg
                ORDER BY distance ASC
                LIMIT {lim}
            """).fetchall()

        out = []
        for e, v, dist in rows:
            v = float(v or 0.0)
            if v >= upper:
                side = 'ATL'
            elif v < lower:
                side = 'BTL'
            else:
                side = 'REVIEW'
            out.append({
                'entity_id': e,
                'aggregated_value': v,
                'distance': float(dist or 0.0),
                'side': side,
                'threshold_value': float(strategy['threshold_value'] or 0.0),
                'lower': lower,
                'upper': upper,
                'aggregation_lens': aggregation_lens
            })
        return out

    def overlap_boundaries(self, behavior_db_path: Path, session_id: int, boundary_a: int, boundary_b: int, created_by: Optional[str]) -> Dict:
        meta = self._get_session_meta(session_id)
        aggregation_lens = meta['aggregation_lens']
        agg_query = self._agg_query(meta['behavior_run_id'], meta['metric_name'], meta['entity_collapse'], meta['time_lens'], meta['sustained_days'])

        def upper_for(boundary_id: int) -> float:
            with duckdb_pool.connection(self.db_path) as conn:
                b = conn.execute("""
                    SELECT strategy_id, buffer_type, buffer_params_json
                    FROM risk_boundary_definitions
                    WHERE session_id = ? AND boundary_id = ?
                """, [session_id, boundary_id]).fetchone()
                if not b:
                    raise ValueError("Boundary not found")
                strategy = self._get_strategy(session_id, int(b[0]))
                thresholds = self._boundary_thresholds(float(strategy['threshold_value'] or 0.0), b[1], json.loads(b[2]) if b[2] else {})
                return float(thresholds['upper'])

        upper_a = upper_for(boundary_a)
        upper_b = upper_for(boundary_b)
        with duckdb_pool.connection(behavior_db_path) as conn2:
            ids_a = set(r[0] for r in conn2.execute(f"SELECT entity_id FROM ({agg_query}) WHERE aggregated_value >= {upper_a}").fetchall())
            ids_b = set(r[0] for r in conn2.execute(f"SELECT entity_id FROM ({agg_query}) WHERE aggregated_value >= {upper_b}").fetchall())

            inter = ids_a & ids_b
            only_a = ids_a - ids_b
            only_b = ids_b - ids_a
            union = ids_a | ids_b
            jacc = float(len(inter) / len(union)) if union else 0.0
            overlap_pct = float(len(inter) / min(len(ids_a), len(ids_b)) * 100.0) if min(len(ids_a), len(ids_b)) else 0.0

            volume_overlap_pct = 0.0
            if union:
                inter_ids = list(inter)
                union_ids = list(union)
                inter_vol = 0.0
                union_vol = 0.0
                if inter_ids:
                    inter_vol = float(conn2.execute(f"""
                        SELECT SUM(ABS(aggregated_value))
                        FROM ({agg_query})
                        WHERE entity_id IN ({",".join(["?"] * len(inter_ids))})
                    """, inter_ids).fetchone()[0] or 0.0)
                if union_ids:
                    union_vol = float(conn2.execute(f"""
                        SELECT SUM(ABS(aggregated_value))
                        FROM ({agg_query})
                        WHERE entity_id IN ({",".join(["?"] * len(union_ids))})
                    """, union_ids).fetchone()[0] or 0.0)
                volume_overlap_pct = float(inter_vol / union_vol * 100.0) if union_vol else 0.0

        result = {
            'boundary_a': int(boundary_a),
            'boundary_b': int(boundary_b),
            'intersection_count': len(inter),
            'only_a_count': len(only_a),
            'only_b_count': len(only_b),
            'overlap_pct': overlap_pct,
            'jaccard': jacc,
            'volume_overlap_pct': volume_overlap_pct,
            'aggregation_lens': aggregation_lens
        }

        with duckdb_pool.connection(self.db_path) as wconn:
            wconn.execute("""
                DELETE FROM risk_population_overlap
                WHERE boundary_a = ? AND boundary_b = ? AND aggregation_lens = ?
            """, [boundary_a, boundary_b, aggregation_lens])
            wconn.execute("""
                INSERT INTO risk_population_overlap (
                  boundary_a, boundary_b, aggregation_lens, overlap_pct, jaccard,
                  intersection_count, only_a_count, only_b_count, volume_overlap_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                boundary_a, boundary_b, aggregation_lens, overlap_pct, jacc, len(inter), len(only_a), len(only_b), volume_overlap_pct
            ])

        self._log_event(session_id, 'risk_population_overlap_computed', {
            'boundary_a': int(boundary_a),
            'boundary_b': int(boundary_b),
            'aggregation_lens': aggregation_lens
        }, created_by)

        return result

    def add_annotation(self, session_id: int, boundary_id: int, text: str, created_by: Optional[str]) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            annotation_id = self._next_id(conn, "risk_boundary_annotations", "annotation_id")
            conn.execute("""
                INSERT INTO risk_boundary_annotations (annotation_id, boundary_id, annotation_text, created_by)
                VALUES (?, ?, ?, ?)
            """, [int(annotation_id), int(boundary_id), text, created_by])
        self._log_event(session_id, 'risk_boundary_annotation_added', {'boundary_id': int(boundary_id), 'annotation_id': int(annotation_id)}, created_by)
        return {'annotation_id': int(annotation_id)}
