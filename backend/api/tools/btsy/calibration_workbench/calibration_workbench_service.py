from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import json
import duckdb
from api.tools.btsy.duckdb_pool import duckdb_pool


class CalibrationWorkbenchService:
    def __init__(self, db_path: Path, audit_service=None):
        self.db_path = db_path
        self.audit_service = audit_service
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _next_id(self, conn: duckdb.DuckDBPyConnection, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS calibration_sessions_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS threshold_strategies_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS scenario_annotations_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS calibration_event_log_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS scenario_evidence_snapshots_seq START 1")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_sessions (
                  session_id INTEGER PRIMARY KEY DEFAULT nextval('calibration_sessions_seq'),
                  behavior_run_id INTEGER NOT NULL,
                  universe_id INTEGER NOT NULL,
                  entity_level TEXT NOT NULL,
                  metric_name TEXT NOT NULL,
                  window_spec TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  status TEXT DEFAULT 'active'
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS aggregation_configs (
                  session_id INTEGER PRIMARY KEY,
                  entity_collapse TEXT NOT NULL,
                  time_lens TEXT NOT NULL,
                  sustained_days INTEGER,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS threshold_strategies (
                  strategy_id INTEGER PRIMARY KEY DEFAULT nextval('threshold_strategies_seq'),
                  session_id INTEGER NOT NULL,
                  name TEXT NOT NULL,
                  strategy_type TEXT NOT NULL,
                  params_json TEXT,
                  threshold_value DOUBLE,
                  alerts_count INTEGER,
                  population_pct DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS scenario_entities (
                  session_id INTEGER NOT NULL,
                  strategy_id INTEGER NOT NULL,
                  entity_id TEXT NOT NULL,
                  aggregated_value DOUBLE,
                  threshold_crossed BOOLEAN,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS scenario_annotations (
                  annotation_id INTEGER PRIMARY KEY DEFAULT nextval('scenario_annotations_seq'),
                  session_id INTEGER NOT NULL,
                  annotation_type TEXT NOT NULL,
                  text TEXT NOT NULL,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS calibration_event_log (
                  event_id INTEGER PRIMARY KEY DEFAULT nextval('calibration_event_log_seq'),
                  session_id INTEGER NOT NULL,
                  event_type TEXT NOT NULL,
                  event_json TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            conn.execute("""
                CREATE TABLE IF NOT EXISTS scenario_evidence_snapshots (
                  evidence_id INTEGER PRIMARY KEY DEFAULT nextval('scenario_evidence_snapshots_seq'),
                  session_id INTEGER NOT NULL,
                  section TEXT NOT NULL,
                  data_json TEXT NOT NULL,
                  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def _log_event(self, session_id: int, event_type: str, event: Dict, created_by: Optional[str]):
        with duckdb_pool.connection(self.db_path) as conn:
            event_id = self._next_id(conn, "calibration_event_log", "event_id")
            conn.execute(
                "INSERT INTO calibration_event_log (event_id, session_id, event_type, event_json, created_by) VALUES (?, ?, ?, ?, ?)",
                [event_id, session_id, event_type, json.dumps(event or {}), created_by]
            )

    def _get_behavior_meta(self, behavior_db_path: Path, behavior_run_id: int) -> Dict:
        conn = duckdb.connect(str(behavior_db_path))
        try:
            row = conn.execute("""
                SELECT universe_id, entity_level, config_json
                FROM behavior_runs
                WHERE behavior_run_id = ?
            """, [behavior_run_id]).fetchone()
            if not row:
                raise ValueError("Behavior run not found")
            universe_id = int(row[0])
            entity_level = row[1]
            cfg = json.loads(row[2]) if row[2] else {}
            metric = (cfg.get('metrics') or [{}])[0] if isinstance(cfg, dict) else {}
            metric_name = metric.get('name') or ''
            window_spec = metric.get('window')
            return {
                'behavior_run_id': behavior_run_id,
                'universe_id': universe_id,
                'entity_level': entity_level,
                'metric_name': metric_name,
                'window': window_spec,
            }
        finally:
            conn.close()

    def create_session(self, behavior_db_path: Path, behavior_run_id: int, created_by: str) -> Dict:
        meta = self._get_behavior_meta(behavior_db_path, behavior_run_id)
        bconn = duckdb.connect(str(behavior_db_path))
        try:
            cnt = bconn.execute(
                "SELECT COUNT(1) FROM behavior_table WHERE behavior_run_id = ? AND metric_name = ?",
                [int(behavior_run_id), meta.get('metric_name') or '']
            ).fetchone()
            has_rows = int(cnt[0] or 0) if cnt else 0
        finally:
            bconn.close()
        if has_rows == 0:
            raise ValueError("Selected behaviour run has no behavior_table rows; regenerate the behaviour run.")
        with duckdb_pool.connection(self.db_path) as conn:
            session_id = self._next_id(conn, "calibration_sessions", "session_id")
            conn.execute("""
                INSERT INTO calibration_sessions (
                  session_id, behavior_run_id, universe_id, entity_level, metric_name, window_spec, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [
                session_id,
                behavior_run_id,
                meta['universe_id'],
                meta['entity_level'],
                meta['metric_name'],
                meta['window'],
                created_by
            ])
            conn.execute("""
                INSERT INTO aggregation_configs (session_id, entity_collapse, time_lens, sustained_days)
                VALUES (?, 'max', 'full', 3)
            """, [session_id])

        self._log_event(int(session_id), 'session_created', {'behavior_run_id': behavior_run_id}, created_by)
        return self.get_session(int(session_id))

    def list_sessions(self, behavior_run_id: Optional[int] = None) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            q = """
                SELECT session_id, behavior_run_id, universe_id, entity_level, metric_name, window_spec, created_by, created_at, status
                FROM calibration_sessions
            """
            params: List = []
            if behavior_run_id:
                q += " WHERE behavior_run_id = ?"
                params.append(behavior_run_id)
            q += " ORDER BY session_id DESC"
            rows = conn.execute(q, params).fetchall()
            return [{
                'session_id': int(r[0]),
                'behavior_run_id': int(r[1]),
                'universe_id': int(r[2]),
                'entity_level': r[3],
                'metric_name': r[4],
                'window': r[5],
                'created_by': r[6],
                'created_at': str(r[7]),
                'status': r[8],
            } for r in rows]

    def get_session(self, session_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            s = conn.execute("""
                SELECT session_id, behavior_run_id, universe_id, entity_level, metric_name, window_spec, created_by, created_at, status
                FROM calibration_sessions
                WHERE session_id = ?
            """, [session_id]).fetchone()
            if not s:
                raise ValueError("Session not found")
            agg = conn.execute("""
                SELECT entity_collapse, time_lens, sustained_days, updated_at
                FROM aggregation_configs
                WHERE session_id = ?
            """, [session_id]).fetchone()
            strategies = conn.execute("""
                SELECT strategy_id, name, strategy_type, params_json, threshold_value, alerts_count, population_pct, created_at, updated_at
                FROM threshold_strategies
                WHERE session_id = ?
                ORDER BY strategy_id ASC
            """, [session_id]).fetchall()
            annotations = conn.execute("""
                SELECT annotation_id, annotation_type, text, created_by, created_at
                FROM scenario_annotations
                WHERE session_id = ?
                ORDER BY annotation_id ASC
            """, [session_id]).fetchall()
            events = conn.execute("""
                SELECT event_id, event_type, event_json, created_by, created_at
                FROM calibration_event_log
                WHERE session_id = ?
                ORDER BY event_id DESC
                LIMIT 200
            """, [session_id]).fetchall()

            return {
                'session': {
                    'session_id': int(s[0]),
                    'behavior_run_id': int(s[1]),
                    'universe_id': int(s[2]),
                    'entity_level': s[3],
                    'metric_name': s[4],
                    'window': s[5],
                    'created_by': s[6],
                    'created_at': str(s[7]),
                    'status': s[8],
                },
                'aggregation': {
                    'entity_collapse': agg[0] if agg else 'max',
                    'time_lens': agg[1] if agg else 'full',
                    'sustained_days': int(agg[2]) if agg and agg[2] is not None else 3,
                    'updated_at': str(agg[3]) if agg else None
                },
                'strategies': [{
                    'strategy_id': int(r[0]),
                    'name': r[1],
                    'strategy_type': r[2],
                    'params': json.loads(r[3]) if r[3] else {},
                    'threshold_value': float(r[4]) if r[4] is not None else None,
                    'alerts_count': int(r[5]) if r[5] is not None else None,
                    'population_pct': float(r[6]) if r[6] is not None else None,
                    'created_at': str(r[7]),
                    'updated_at': str(r[8]),
                } for r in strategies],
                'annotations': [{
                    'annotation_id': int(r[0]),
                    'annotation_type': r[1],
                    'text': r[2],
                    'created_by': r[3],
                    'created_at': str(r[4]),
                } for r in annotations],
                'events': [{
                    'event_id': int(r[0]),
                    'event_type': r[1],
                    'event': json.loads(r[2]) if r[2] else {},
                    'created_by': r[3],
                    'created_at': str(r[4]),
                } for r in events]
            }

    def set_aggregation(self, session_id: int, entity_collapse: str, time_lens: str, sustained_days: Optional[int], created_by: Optional[str]) -> Dict:
        entity_collapse = (entity_collapse or 'max').lower()
        time_lens = (time_lens or 'full').lower()
        sustained_days = int(sustained_days) if sustained_days is not None else 3
        with duckdb_pool.connection(self.db_path) as conn:
            exists = conn.execute("SELECT 1 FROM aggregation_configs WHERE session_id = ? LIMIT 1", [session_id]).fetchone()
            if exists:
                conn.execute("""
                    UPDATE aggregation_configs
                    SET entity_collapse = ?, time_lens = ?, sustained_days = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE session_id = ?
                """, [entity_collapse, time_lens, sustained_days, session_id])
            else:
                conn.execute("""
                    INSERT INTO aggregation_configs (session_id, entity_collapse, time_lens, sustained_days)
                    VALUES (?, ?, ?, ?)
                """, [session_id, entity_collapse, time_lens, sustained_days])

        self._log_event(session_id, 'aggregation_updated', {
            'entity_collapse': entity_collapse,
            'time_lens': time_lens,
            'sustained_days': sustained_days
        }, created_by)
        return self.get_session(session_id)

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
            return {
                'behavior_run_id': int(row[0]),
                'metric_name': row[1],
                'entity_collapse': (agg[0] if agg else 'max'),
                'time_lens': (agg[1] if agg else 'full'),
                'sustained_days': int(agg[2]) if agg and agg[2] is not None else 3
            }

    def _aggregated_entity_values_query(self, behavior_run_id: int, metric_name: str, entity_collapse: str, time_lens: str, sustained_days: int) -> str:
        entity_collapse = (entity_collapse or 'max').lower()
        time_lens = (time_lens or 'full').lower()
        metric_filter = f"behavior_run_id = {int(behavior_run_id)}"
        if metric_name:
            escaped_metric_name = metric_name.replace("'", "''")
            metric_filter += f" AND metric_name = '{escaped_metric_name}'"

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

    def get_aggregate_view(self, behavior_db_path: Path, session_id: int, limit_entities: int = 200) -> Dict:
        meta = self._get_session_meta(session_id)
        q = self._aggregated_entity_values_query(
            meta['behavior_run_id'],
            meta['metric_name'],
            meta['entity_collapse'],
            meta['time_lens'],
            meta['sustained_days']
        )
        conn = duckdb.connect(str(behavior_db_path))
        try:
            stats = conn.execute(f"""
                WITH agg AS ({q})
                SELECT
                  COUNT(*) AS n,
                  MIN(aggregated_value) AS minv,
                  MAX(aggregated_value) AS maxv,
                  AVG(aggregated_value) AS meanv,
                  median(aggregated_value) AS medianv,
                  quantile(aggregated_value, 0.9) AS p90,
                  quantile(aggregated_value, 0.95) AS p95,
                  quantile(aggregated_value, 0.99) AS p99
                FROM agg
            """).fetchone()
            n = int(stats[0] or 0)
            minv = float(stats[1] or 0.0)
            maxv = float(stats[2] or 0.0)
            bins = 40
            hist_rows = conn.execute(f"""
                WITH agg AS ({q}),
                b AS (
                  SELECT
                    CAST(FLOOR(((aggregated_value - {minv}) / NULLIF({maxv}-{minv},0)) * {bins}) AS INTEGER) AS bucket,
                    COUNT(*) AS count
                  FROM agg
                  GROUP BY bucket
                )
                SELECT bucket, count
                FROM b
                ORDER BY bucket
            """).fetchall()
            entities = conn.execute(f"""
                WITH agg AS ({q})
                SELECT entity_id, aggregated_value
                FROM agg
                ORDER BY aggregated_value DESC NULLS LAST
                LIMIT {int(limit_entities)}
            """).fetchall()
            return {
                'aggregation': {
                    'entity_collapse': meta['entity_collapse'],
                    'time_lens': meta['time_lens'],
                    'sustained_days': meta['sustained_days']
                },
                'summary': {
                    'entities': n,
                    'min': float(stats[1] or 0.0),
                    'max': float(stats[2] or 0.0),
                    'mean': float(stats[3] or 0.0),
                    'median': float(stats[4] or 0.0),
                    'p90': float(stats[5] or 0.0),
                    'p95': float(stats[6] or 0.0),
                    'p99': float(stats[7] or 0.0),
                },
                'histogram': {
                    'min': minv,
                    'max': maxv,
                    'bins': bins,
                    'rows': [{'bucket': int(b if b is not None else 0), 'count': int(c)} for b, c in hist_rows]
                },
                'top_entities': [{'entity_id': e, 'aggregated_value': float(v or 0.0)} for e, v in entities]
            }
        finally:
            conn.close()

    def _compute_threshold(self, behavior_db_path: Path, agg_query: str, strategy_type: str, params: Dict) -> Tuple[float, int, float]:
        conn = duckdb.connect(str(behavior_db_path))
        try:
            n = conn.execute(f"SELECT COUNT(*) FROM ({agg_query})").fetchone()[0]
            n = int(n or 0)
            if n == 0:
                return 0.0, 0, 0.0

            strategy_type = (strategy_type or '').lower()
            if strategy_type == 'percentile':
                pct = float(params.get('percentile', 99.0))
                q = max(0.0, min(1.0, pct / 100.0))
                th = conn.execute(f"SELECT quantile(aggregated_value, {q}) FROM ({agg_query})").fetchone()[0]
                th = float(th or 0.0)
            elif strategy_type == 'absolute':
                th = float(params.get('threshold_value') or 0.0)
            elif strategy_type == 'top_n':
                top_n = int(params.get('top_n') or 100)
                top_n = max(1, top_n)
                th_row = conn.execute(f"""
                    SELECT aggregated_value
                    FROM ({agg_query})
                    ORDER BY aggregated_value DESC NULLS LAST
                    LIMIT 1 OFFSET {top_n - 1}
                """).fetchone()
                th = float(th_row[0] or 0.0) if th_row else 0.0
            else:
                raise ValueError("Unsupported strategy type")

            alerts = conn.execute(f"SELECT COUNT(*) FROM ({agg_query}) WHERE aggregated_value >= {th}").fetchone()[0]
            alerts = int(alerts or 0)
            pop_pct = float(alerts / n * 100.0) if n else 0.0
            return th, alerts, pop_pct
        finally:
            conn.close()

    def add_strategy(self, behavior_db_path: Path, session_id: int, name: str, strategy_type: str, params: Dict, created_by: Optional[str]) -> Dict:
        meta = self._get_session_meta(session_id)
        agg_query = self._aggregated_entity_values_query(
            meta['behavior_run_id'],
            meta['metric_name'],
            meta['entity_collapse'],
            meta['time_lens'],
            meta['sustained_days']
        )
        threshold_value, alerts_count, population_pct = self._compute_threshold(
            behavior_db_path,
            agg_query,
            strategy_type,
            params or {}
        )

        with duckdb_pool.connection(self.db_path) as conn:
            strategy_id = self._next_id(conn, "threshold_strategies", "strategy_id")
            conn.execute("""
                INSERT INTO threshold_strategies (
                  strategy_id, session_id, name, strategy_type, params_json,
                  threshold_value, alerts_count, population_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                strategy_id,
                session_id,
                name,
                strategy_type,
                json.dumps(params or {}),
                float(threshold_value),
                int(alerts_count),
                float(population_pct)
            ])
            conn.execute("DELETE FROM scenario_entities WHERE session_id = ? AND strategy_id = ?", [session_id, strategy_id])

        bconn = duckdb.connect(str(behavior_db_path))
        try:
            ents = bconn.execute(f"""
                WITH agg AS ({agg_query})
                SELECT entity_id, aggregated_value
                FROM agg
                WHERE aggregated_value >= {float(threshold_value)}
                ORDER BY aggregated_value DESC NULLS LAST
                LIMIT 5000
            """).fetchall()
        finally:
            bconn.close()

        with duckdb_pool.connection(self.db_path) as conn2:
            if ents:
                rows = [(session_id, int(strategy_id), e, float(v or 0.0), True) for e, v in ents]
                conn2.executemany("""
                    INSERT INTO scenario_entities (session_id, strategy_id, entity_id, aggregated_value, threshold_crossed)
                    VALUES (?, ?, ?, ?, ?)
                """, rows)

        self._log_event(session_id, 'strategy_added', {
            'strategy_id': int(strategy_id),
            'name': name,
            'strategy_type': strategy_type,
            'params': params or {},
            'threshold_value': float(threshold_value),
            'alerts_count': int(alerts_count),
            'population_pct': float(population_pct),
        }, created_by)
        return self.get_session(session_id)

    def add_annotation(self, session_id: int, annotation_type: str, text: str, created_by: Optional[str]) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            annotation_id = self._next_id(conn, "scenario_annotations", "annotation_id")
            conn.execute("""
                INSERT INTO scenario_annotations (annotation_id, session_id, annotation_type, text, created_by)
                VALUES (?, ?, ?, ?, ?)
            """, [annotation_id, session_id, annotation_type, text, created_by])
        self._log_event(session_id, 'annotation_added', {'annotation_type': annotation_type}, created_by)
        return self.get_session(session_id)

    def get_entity_drilldown(self, behavior_db_path: Path, session_id: int, entity_id: str) -> Dict:
        meta = self._get_session_meta(session_id)
        bconn = duckdb.connect(str(behavior_db_path))
        try:
            rows = bconn.execute("""
                SELECT as_of_date, metric_value
                FROM behavior_table
                WHERE behavior_run_id = ? AND metric_name = ? AND entity_id = ?
                ORDER BY as_of_date ASC
            """, [meta['behavior_run_id'], meta['metric_name'], entity_id]).fetchall()
        finally:
            bconn.close()

        with duckdb_pool.connection(self.db_path) as conn:
            strategies = conn.execute("""
                SELECT strategy_id, name, threshold_value
                FROM threshold_strategies
                WHERE session_id = ?
                ORDER BY strategy_id ASC
            """, [session_id]).fetchall()

        series = [{'as_of_date': str(ts), 'metric_value': float(v or 0.0)} for ts, v in rows]
        thresholds = [{'strategy_id': int(sid), 'name': nm, 'threshold_value': float(tv or 0.0)} for sid, nm, tv in strategies]
        return {'entity_id': entity_id, 'series': series, 'thresholds': thresholds}

    def freeze_session(self, session_id: int, created_by: Optional[str]) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("""
                UPDATE calibration_sessions
                SET status = 'frozen'
                WHERE session_id = ?
            """, [session_id])
        self._log_event(session_id, 'session_frozen', {}, created_by)
        return self.get_session(session_id)
