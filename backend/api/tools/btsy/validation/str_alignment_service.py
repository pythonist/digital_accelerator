from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from typing import Dict, List, Optional

import duckdb

from api.tools.btsy.duckdb_pool import duckdb_pool


@dataclass
class AlignmentContext:
    session_id: int
    behavior_run_id: int
    metric_name: str
    window_spec: Optional[str]
    entity_level: str
    entity_collapse: str
    time_lens: str
    sustained_days: int


class STRAlignmentService:
    def __init__(self, workbench_db_path: Path, universes_db_path: Path, snapshots_db_path: Path, normalized_base: Path):
        self.db_path = workbench_db_path
        self.universes_db_path = universes_db_path
        self.snapshots_db_path = snapshots_db_path
        self.normalized_base = normalized_base
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.normalized_base.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS str_alignment_runs (
                  str_alignment_run_id INTEGER PRIMARY KEY,
                  session_id INTEGER NOT NULL,
                  alert_run_id INTEGER NOT NULL,
                  threshold_value DOUBLE,
                  temporal_rule TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  status TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alert_str_links (
                  str_alignment_run_id INTEGER NOT NULL,
                  str_id INTEGER NOT NULL,
                  entity_id TEXT,
                  account_id TEXT,
                  customer_id TEXT,
                  str_filed_date TIMESTAMP,
                  breach_date TIMESTAMP,
                  behavior_rows INTEGER,
                  eligible_alerted BOOLEAN,
                  captured BOOLEAN
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS str_capture_summary (
                  str_alignment_run_id INTEGER NOT NULL,
                  total_str INTEGER,
                  captured_str INTEGER,
                  missed_str INTEGER,
                  capture_rate DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS missed_str_analysis_runs (
                  missed_run_id INTEGER PRIMARY KEY,
                  str_alignment_run_id INTEGER NOT NULL,
                  session_id INTEGER NOT NULL,
                  threshold_value DOUBLE,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  status TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS missed_str_classification (
                  missed_run_id INTEGER NOT NULL,
                  str_id INTEGER NOT NULL,
                  entity_id TEXT,
                  root_cause_code TEXT NOT NULL,
                  explanation_text TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS missed_str_metrics (
                  missed_run_id INTEGER NOT NULL,
                  root_cause_code TEXT NOT NULL,
                  count INTEGER,
                  percentage DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def _next_id(self, conn: duckdb.DuckDBPyConnection, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def _get_session_meta(self, conn: duckdb.DuckDBPyConnection, session_id: int) -> AlignmentContext:
        s = conn.execute("""
            SELECT behavior_run_id, metric_name, window_spec, entity_level
            FROM calibration_sessions
            WHERE session_id = ?
        """, [int(session_id)]).fetchone()
        if not s:
            raise ValueError("Session not found")
        agg = conn.execute("""
            SELECT entity_collapse, time_lens, sustained_days
            FROM aggregation_configs
            WHERE session_id = ?
        """, [int(session_id)]).fetchone()
        return AlignmentContext(
            session_id=int(session_id),
            behavior_run_id=int(s[0]),
            metric_name=s[1] or '',
            window_spec=s[2],
            entity_level=s[3] or 'account',
            entity_collapse=(agg[0] if agg else 'max') or 'max',
            time_lens=(agg[1] if agg else 'full') or 'full',
            sustained_days=int(agg[2]) if agg and agg[2] is not None else 3,
        )

    def _get_alert_run(self, conn: duckdb.DuckDBPyConnection, session_id: int, alert_run_id: int) -> Dict:
        row = conn.execute("""
            SELECT alert_run_id, session_id, boundary_id, threshold_value, created_at, status
            FROM alert_generation_runs
            WHERE alert_run_id = ?
        """, [int(alert_run_id)]).fetchone()
        if not row or int(row[1]) != int(session_id):
            raise ValueError("Alert generation run not found")
        return {
            'alert_run_id': int(row[0]),
            'session_id': int(row[1]),
            'boundary_id': int(row[2]),
            'threshold_value': float(row[3] or 0.0),
            'created_at': str(row[4]),
            'status': row[5],
        }

    def _parquet_exists(self, name: str) -> bool:
        return (self.normalized_base / f"{name}.parquet").exists()

    def _resolve_snapshot_paths(self, session_id: int) -> Dict[str, Path]:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT universe_id FROM calibration_sessions WHERE session_id = ?",
                [int(session_id)],
            ).fetchone()
            if not row:
                raise ValueError("Session not found")
            universe_id = int(row[0])

        uconn = duckdb.connect(str(self.universes_db_path))
        try:
            u = uconn.execute(
                "SELECT snapshot_id FROM transaction_universe_runs WHERE id = ?",
                [int(universe_id)],
            ).fetchone()
        finally:
            uconn.close()
        if not u:
            raise ValueError("Universe not found")
        snapshot_id = str(u[0])

        from api.tools.btsy.snapshot_manager import SnapshotManager
        mgr = SnapshotManager(self.snapshots_db_path)
        snap = mgr.get_snapshot(snapshot_id) or {}

        def _domain_path(domain: str) -> Path:
            for d in (snap.get("domains") or []):
                if d.get("domain") == domain and d.get("normalized_file_path"):
                    return Path(d["normalized_file_path"])
            return self.normalized_base / snapshot_id / f"{domain}.parquet"

        return {
            "snapshot_id": snapshot_id,
            "str": _domain_path("str"),
            "accounts": _domain_path("accounts"),
        }

    def _series_query(self, ctx: AlignmentContext) -> str:
        metric_filter = f"behavior_run_id = {int(ctx.behavior_run_id)}"
        if ctx.metric_name:
            metric_filter += " AND metric_name = '" + ctx.metric_name.replace("'", "''") + "'"

        tl = (ctx.time_lens or 'full').lower()
        if tl == 'full':
            base = f"""
                SELECT entity_id, as_of_date, metric_value
                FROM behavior.behavior_table
                WHERE {metric_filter}
            """
        else:
            base = f"""
                SELECT entity_id, date_trunc('day', as_of_date) AS as_of_date, MAX(metric_value) AS metric_value
                FROM behavior.behavior_table
                WHERE {metric_filter}
                GROUP BY entity_id, as_of_date
            """

        if tl in ('rolling_peak', 'sustained'):
            n = max(1, int(ctx.sustained_days or 3))
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
                    WHEN '{tl}' = 'rolling_peak' THEN roll_sum
                    WHEN '{tl}' = 'sustained' THEN CASE WHEN all_non_zero = 1 THEN roll_avg ELSE NULL END
                    ELSE metric_value
                  END AS metric_value
                FROM w
            """
        return base

    def _breach_query(self, series_query: str, entity_collapse: str, threshold_value: float) -> str:
        ec = (entity_collapse or 'max').lower()
        th = float(threshold_value or 0.0)
        if ec in ('max', 'p95'):
            return f"""
                SELECT entity_id, MIN(as_of_date) AS breach_date
                FROM ({series_query}) s
                WHERE metric_value IS NOT NULL AND metric_value >= {th}
                GROUP BY entity_id
            """
        if ec == 'last':
            return f"""
                WITH lastv AS (
                  SELECT
                    entity_id,
                    MAX(as_of_date) AS last_date,
                    max_by(metric_value, as_of_date) AS last_value
                  FROM ({series_query}) s
                  GROUP BY entity_id
                )
                SELECT entity_id, last_date AS breach_date
                FROM lastv
                WHERE last_value IS NOT NULL AND last_value >= {th}
            """
        if ec == 'avg':
            return f"""
                WITH w AS (
                  SELECT
                    entity_id,
                    as_of_date,
                    AVG(metric_value) OVER (
                      PARTITION BY entity_id
                      ORDER BY as_of_date
                      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS run_avg
                  FROM ({series_query}) s
                  WHERE metric_value IS NOT NULL
                )
                SELECT entity_id, MIN(as_of_date) AS breach_date
                FROM w
                WHERE run_avg >= {th}
                GROUP BY entity_id
            """
        raise ValueError("Unsupported entity collapse method")

    def get_context(self, behavior_db_path: Path, session_id: int) -> Dict:
        paths = self._resolve_snapshot_paths(session_id)
        str_path = paths["str"]
        accounts_path = paths["accounts"]
        with duckdb_pool.connection(self.db_path) as conn:
            ctx = self._get_session_meta(conn, session_id)
            alert_runs = conn.execute("""
                SELECT alert_run_id, boundary_id, threshold_value, created_at, status
                FROM alert_generation_runs
                WHERE session_id = ?
                ORDER BY alert_run_id DESC
                LIMIT 200
            """, [int(session_id)]).fetchall()

            str_window = None
            if str_path.exists():
                conn.execute(f"ATTACH '{str(behavior_db_path)}' AS behavior")
                try:
                    mm = conn.execute(f"""
                        SELECT MIN(str_filed_date), MAX(str_filed_date)
                        FROM read_parquet('{str(str_path).replace("'", "''")}')
                    """).fetchone()
                    str_window = {
                        'min': str(mm[0]) if mm and mm[0] is not None else None,
                        'max': str(mm[1]) if mm and mm[1] is not None else None,
                    }
                finally:
                    try:
                        conn.execute("DETACH behavior")
                    except Exception:
                        pass

        missing: List[str] = []
        if not str_path.exists():
            missing.append('normalized_str_parquet')
        if (ctx.entity_level or '').lower() == 'customer' and not accounts_path.exists():
            missing.append('normalized_accounts_parquet')

        return {
            'ready': len(missing) == 0 and len(alert_runs) > 0,
            'missing': missing,
            'temporal_rule': 'alert_date <= str_filed_date',
            'session': {
                'session_id': ctx.session_id,
                'behavior_run_id': ctx.behavior_run_id,
                'metric_name': ctx.metric_name,
                'window': ctx.window_spec,
                'entity_level': ctx.entity_level,
                'entity_collapse': ctx.entity_collapse,
                'time_lens': ctx.time_lens,
                'sustained_days': ctx.sustained_days,
            },
            'alert_runs': [{
                'alert_run_id': int(r[0]),
                'boundary_id': int(r[1]),
                'threshold_value': float(r[2] or 0.0),
                'created_at': str(r[3]),
                'status': r[4],
            } for r in alert_runs],
            'str_window': str_window,
        }

    def list_alignment_runs(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT str_alignment_run_id, session_id, alert_run_id, threshold_value, temporal_rule, created_by, created_at, status
                FROM str_alignment_runs
                WHERE session_id = ?
                ORDER BY str_alignment_run_id DESC
                LIMIT 200
            """, [int(session_id)]).fetchall()
        return [{
            'str_alignment_run_id': int(r[0]),
            'session_id': int(r[1]),
            'alert_run_id': int(r[2]),
            'threshold_value': float(r[3] or 0.0),
            'temporal_rule': r[4],
            'created_by': r[5],
            'created_at': str(r[6]),
            'status': r[7],
        } for r in rows]

    def create_alignment_run(self, behavior_db_path: Path, session_id: int, alert_run_id: int, created_by: str) -> Dict:
        paths = self._resolve_snapshot_paths(session_id)
        str_path = paths["str"]
        if not str_path.exists():
            raise ValueError("Normalized STR parquet required")

        with duckdb_pool.connection(self.db_path) as conn:
            ctx = self._get_session_meta(conn, session_id)
            ar = self._get_alert_run(conn, session_id, alert_run_id)
            threshold_value = float(ar['threshold_value'] or 0.0)

            run_id = self._next_id(conn, "str_alignment_runs", "str_alignment_run_id")
            conn.execute("""
                INSERT INTO str_alignment_runs (
                  str_alignment_run_id, session_id, alert_run_id, threshold_value, temporal_rule, created_by, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'completed')
            """, [int(run_id), int(session_id), int(alert_run_id), float(threshold_value), 'alert_date <= str_filed_date', created_by])

            conn.execute("DELETE FROM alert_str_links WHERE str_alignment_run_id = ?", [int(run_id)])
            conn.execute("DELETE FROM str_capture_summary WHERE str_alignment_run_id = ?", [int(run_id)])

            conn.execute(f"ATTACH '{str(behavior_db_path)}' AS behavior")
            try:
                series_q = self._series_query(ctx)
                breach_q = self._breach_query(series_q, ctx.entity_collapse, threshold_value)
                series_counts_q = f"SELECT entity_id, COUNT(1) AS n FROM ({series_q}) s GROUP BY entity_id"

                accounts_path = paths["accounts"]
                accounts_join = ""
                entity_id_expr = "CAST(s.account_id AS VARCHAR)"
                customer_expr = "NULL::VARCHAR"
                if (ctx.entity_level or '').lower() == 'customer':
                    if not accounts_path.exists():
                        raise ValueError("Normalized accounts parquet required for customer-level alignment")
                    a_path = str(accounts_path).replace("'", "''")
                    accounts_join = f"LEFT JOIN read_parquet('{a_path}') a ON CAST(a.account_id AS VARCHAR) = CAST(s.account_id AS VARCHAR)"
                    entity_id_expr = "CAST(a.customer_id AS VARCHAR)"
                    customer_expr = "CAST(a.customer_id AS VARCHAR)"

                str_path_esc = str(str_path).replace("'", "''")

                conn.execute(f"""
                    WITH str_raw AS (
                      SELECT
                        ROW_NUMBER() OVER () AS str_id,
                        CAST(account_id AS VARCHAR) AS account_id,
                        TRY_CAST(str_filed_date AS TIMESTAMP) AS str_filed_date
                      FROM read_parquet('{str_path_esc}')
                    ),
                    str_entities AS (
                      SELECT
                        s.str_id,
                        s.account_id,
                        {customer_expr} AS customer_id,
                        {entity_id_expr} AS entity_id,
                        s.str_filed_date
                      FROM str_raw s
                      {accounts_join}
                    ),
                    breaches AS ({breach_q}),
                    series_counts AS ({series_counts_q}),
                    alerted AS (
                      SELECT DISTINCT entity_id
                      FROM alerts
                      WHERE alert_run_id = {int(alert_run_id)}
                    ),
                    joined AS (
                      SELECT
                        se.str_id,
                        se.entity_id,
                        se.account_id,
                        se.customer_id,
                        se.str_filed_date,
                        b.breach_date,
                        COALESCE(sc.n, 0) AS behavior_rows,
                        CASE WHEN al.entity_id IS NOT NULL THEN TRUE ELSE FALSE END AS eligible_alerted,
                        CASE
                          WHEN b.breach_date IS NOT NULL
                           AND se.str_filed_date IS NOT NULL
                           AND b.breach_date <= se.str_filed_date
                           AND al.entity_id IS NOT NULL
                          THEN TRUE ELSE FALSE
                        END AS captured
                      FROM str_entities se
                      LEFT JOIN breaches b ON b.entity_id = se.entity_id
                      LEFT JOIN series_counts sc ON sc.entity_id = se.entity_id
                      LEFT JOIN alerted al ON al.entity_id = se.entity_id
                    )
                    INSERT INTO alert_str_links (
                      str_alignment_run_id, str_id, entity_id, account_id, customer_id,
                      str_filed_date, breach_date, behavior_rows, eligible_alerted, captured
                    )
                    SELECT
                      {int(run_id)} AS str_alignment_run_id,
                      str_id, entity_id, account_id, customer_id,
                      str_filed_date, breach_date, CAST(behavior_rows AS INTEGER),
                      eligible_alerted, captured
                    FROM joined
                """)

                totals = conn.execute("""
                    SELECT
                      COUNT(1) AS total_str,
                      SUM(CASE WHEN captured THEN 1 ELSE 0 END) AS captured_str
                    FROM alert_str_links
                    WHERE str_alignment_run_id = ?
                """, [int(run_id)]).fetchone()
                total_str = int(totals[0] or 0) if totals else 0
                captured_str = int(totals[1] or 0) if totals else 0
                missed_str = max(0, total_str - captured_str)
                capture_rate = float(captured_str / total_str * 100.0) if total_str else 0.0

                conn.execute("""
                    INSERT INTO str_capture_summary (str_alignment_run_id, total_str, captured_str, missed_str, capture_rate)
                    VALUES (?, ?, ?, ?, ?)
                """, [int(run_id), total_str, captured_str, missed_str, float(capture_rate)])
            finally:
                try:
                    conn.execute("DETACH behavior")
                except Exception:
                    pass

            event_id = self._next_id(conn, "calibration_event_log", "event_id")
            conn.execute(
                "INSERT INTO calibration_event_log (event_id, session_id, event_type, event_json, created_by) VALUES (?, ?, ?, ?, ?)",
                [event_id, int(session_id), "STEP_5_STR_ALIGNMENT_RUN", json.dumps({'str_alignment_run_id': int(run_id), 'alert_run_id': int(alert_run_id)}), created_by]
            )

        return self.get_alignment_run(int(run_id))

    def get_alignment_run(self, str_alignment_run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT str_alignment_run_id, session_id, alert_run_id, threshold_value, temporal_rule, created_by, created_at, status
                FROM str_alignment_runs
                WHERE str_alignment_run_id = ?
            """, [int(str_alignment_run_id)]).fetchone()
            if not run:
                raise ValueError("STR alignment run not found")
            summary = conn.execute("""
                SELECT total_str, captured_str, missed_str, capture_rate
                FROM str_capture_summary
                WHERE str_alignment_run_id = ?
                ORDER BY computed_at DESC
                LIMIT 1
            """, [int(str_alignment_run_id)]).fetchone()

        return {
            'run': {
                'str_alignment_run_id': int(run[0]),
                'session_id': int(run[1]),
                'alert_run_id': int(run[2]),
                'threshold_value': float(run[3] or 0.0),
                'temporal_rule': run[4],
                'created_by': run[5],
                'created_at': str(run[6]),
                'status': run[7],
            },
            'summary': {
                'total_str': int(summary[0] or 0) if summary else 0,
                'captured_str': int(summary[1] or 0) if summary else 0,
                'missed_str': int(summary[2] or 0) if summary else 0,
                'capture_rate': float(summary[3] or 0.0) if summary else 0.0,
            },
            'disclaimer': 'This analysis is retrospective and non-operational. STR data is used only in Step-5.'
        }

    def get_alignment_diagnostics(self, behavior_db_path: Path, str_alignment_run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT session_id, alert_run_id, threshold_value
                FROM str_alignment_runs
                WHERE str_alignment_run_id = ?
            """, [int(str_alignment_run_id)]).fetchone()
            if not run:
                raise ValueError("STR alignment run not found")

            session_id = int(run[0])
            alert_run_id = int(run[1])
            threshold_value = float(run[2] or 0.0)
            ctx = self._get_session_meta(conn, session_id)

            entity_key = 'account_id'
            if (ctx.entity_level or '').lower() == 'customer':
                entity_key = 'customer_id'

            join_key = {
                'entity_key': entity_key,
                'alerts_entity_column': 'entity_id',
                'str_entity_derivation': 'entity_id derived from STR.account_id (account-level) or Accounts.customer_id (customer-level)',
            }

            join_stats = conn.execute("""
                SELECT
                  COUNT(DISTINCT account_id) AS str_accounts_total,
                  COUNT(DISTINCT CASE WHEN eligible_alerted THEN account_id ELSE NULL END) AS str_accounts_matched,
                  COUNT(DISTINCT entity_id) AS str_entities_total,
                  COUNT(DISTINCT CASE WHEN eligible_alerted THEN entity_id ELSE NULL END) AS str_entities_matched,
                  SUM(CASE WHEN entity_id IS NULL THEN 1 ELSE 0 END) AS null_entity_id_rows,
                  SUM(CASE WHEN account_id IS NULL THEN 1 ELSE 0 END) AS null_account_id_rows,
                  SUM(CASE WHEN str_filed_date IS NULL THEN 1 ELSE 0 END) AS null_str_filed_date_rows
                FROM alert_str_links
                WHERE str_alignment_run_id = ?
            """, [int(str_alignment_run_id)]).fetchone()

            str_accounts_total = int(join_stats[0] or 0)
            str_accounts_matched = int(join_stats[1] or 0)
            str_entities_total = int(join_stats[2] or 0)
            str_entities_matched = int(join_stats[3] or 0)
            null_entity_id_rows = int(join_stats[4] or 0)
            null_account_id_rows = int(join_stats[5] or 0)
            null_str_filed_date_rows = int(join_stats[6] or 0)

            str_accounts_unmatched = max(0, str_accounts_total - str_accounts_matched)
            str_entities_unmatched = max(0, str_entities_total - str_entities_matched)

            alert_range = conn.execute("""
                SELECT
                  MIN(alert_date) AS min_alert_date,
                  MAX(alert_date) AS max_alert_date,
                  typeof(MIN(alert_date)) AS alert_date_type
                FROM alerts
                WHERE alert_run_id = ?
            """, [int(alert_run_id)]).fetchone()

            str_range = conn.execute("""
                SELECT
                  MIN(str_filed_date) AS min_str_filed_date,
                  MAX(str_filed_date) AS max_str_filed_date,
                  typeof(MIN(str_filed_date)) AS str_filed_date_type
                FROM alert_str_links
                WHERE str_alignment_run_id = ?
            """, [int(str_alignment_run_id)]).fetchone()

            temporal = conn.execute("""
                WITH first_alert AS (
                  SELECT entity_id, MIN(alert_date) AS first_alert_date
                  FROM alerts
                  WHERE alert_run_id = ?
                  GROUP BY entity_id
                ),
                j AS (
                  SELECT
                    l.str_id,
                    l.entity_id,
                    l.str_filed_date,
                    a.first_alert_date
                  FROM alert_str_links l
                  LEFT JOIN first_alert a
                    ON a.entity_id = l.entity_id
                  WHERE l.str_alignment_run_id = ?
                )
                SELECT
                  SUM(CASE WHEN str_filed_date IS NOT NULL AND first_alert_date IS NOT NULL THEN 1 ELSE 0 END) AS comparable,
                  SUM(CASE WHEN str_filed_date IS NOT NULL AND first_alert_date IS NOT NULL AND first_alert_date <= str_filed_date THEN 1 ELSE 0 END) AS aligned
                FROM j
            """, [int(alert_run_id), int(str_alignment_run_id)]).fetchone()

            comparable = int(temporal[0] or 0)
            aligned = int(temporal[1] or 0)
            aligned_pct = float(aligned / comparable * 100.0) if comparable else 0.0

            alert_counts = conn.execute("""
                SELECT COUNT(1) AS alert_rows, COUNT(DISTINCT entity_id) AS alert_entities
                FROM alerts
                WHERE alert_run_id = ?
            """, [int(alert_run_id)]).fetchone()

            alert_rows = int(alert_counts[0] or 0) if alert_counts else 0
            alert_entities = int(alert_counts[1] or 0) if alert_counts else 0

            str_metrics = conn.execute("""
                SELECT
                  COUNT(1) AS total_str,
                  SUM(CASE WHEN captured THEN 1 ELSE 0 END) AS captured_str,
                  SUM(CASE WHEN captured THEN 0 ELSE 1 END) AS missed_str
                FROM alert_str_links
                WHERE str_alignment_run_id = ?
            """, [int(str_alignment_run_id)]).fetchone()

            total_str = int(str_metrics[0] or 0)
            captured_str = int(str_metrics[1] or 0)
            missed_str = int(str_metrics[2] or 0)
            capture_rate = float(captured_str / total_str * 100.0) if total_str else 0.0
            str_alert_rate = float(str_entities_matched / alert_entities * 100.0) if alert_entities else 0.0

            issues: List[str] = []
            alert_date_type = str(alert_range[2]) if alert_range and alert_range[2] is not None else None
            str_date_type = str(str_range[2]) if str_range and str_range[2] is not None else None
            if alert_date_type and str_date_type and alert_date_type != str_date_type:
                issues.append(f"Date type mismatch: alert_date is {alert_date_type}, str_filed_date is {str_date_type}.")
            if null_str_filed_date_rows > 0:
                issues.append(f"{null_str_filed_date_rows} STR rows have NULL str_filed_date after parsing.")
            if null_entity_id_rows > 0:
                issues.append(f"{null_entity_id_rows} STR rows have NULL entity_id (join key derivation failure).")
            if null_account_id_rows > 0:
                issues.append(f"{null_account_id_rows} STR rows have NULL account_id.")

            conn.execute(f"ATTACH '{str(behavior_db_path)}' AS behavior")
            breached_total = 0
            breached_in_alert_universe = 0
            breach_range = {'min': None, 'max': None}
            try:
                series_q = self._series_query(ctx)
                breach_q = self._breach_query(series_q, ctx.entity_collapse, threshold_value)

                br = conn.execute(f"""
                    SELECT COUNT(DISTINCT entity_id) AS breached_entities, MIN(breach_date), MAX(breach_date)
                    FROM ({breach_q})
                """).fetchone()
                breached_total = int(br[0] or 0) if br else 0
                breach_range = {
                    'min': str(br[1]) if br and br[1] is not None else None,
                    'max': str(br[2]) if br and br[2] is not None else None,
                }

                bri = conn.execute(f"""
                    WITH breached AS ({breach_q}),
                    alert_universe AS (
                      SELECT DISTINCT entity_id
                      FROM alerts
                      WHERE alert_run_id = {int(alert_run_id)}
                    )
                    SELECT COUNT(DISTINCT b.entity_id)
                    FROM breached b
                    JOIN alert_universe u
                      ON u.entity_id = b.entity_id
                """).fetchone()
                breached_in_alert_universe = int(bri[0] or 0) if bri else 0
            finally:
                try:
                    conn.execute("DETACH behavior")
                except Exception:
                    pass

            root_cause = conn.execute("""
                WITH missed AS (
                  SELECT *
                  FROM alert_str_links
                  WHERE str_alignment_run_id = ?
                    AND (captured IS NULL OR captured = FALSE)
                ),
                classified AS (
                  SELECT
                    CASE
                      WHEN account_id IS NULL OR entity_id IS NULL OR str_filed_date IS NULL THEN 'Data join failure'
                      WHEN eligible_alerted IS NULL OR eligible_alerted = FALSE THEN 'Account never present in alert universe'
                      WHEN CAST(behavior_rows AS INTEGER) = 0 THEN 'No prior alerts on account'
                      WHEN breach_date IS NULL THEN 'Alerts existed but below threshold'
                      WHEN breach_date > str_filed_date THEN 'Alerts after STR filed date'
                      ELSE 'No prior alerts on account'
                    END AS category
                  FROM missed
                )
                SELECT category, COUNT(1) AS c
                FROM classified
                GROUP BY category
                ORDER BY c DESC
            """, [int(str_alignment_run_id)]).fetchall()

            root_total = int(missed_str or 0)
            root_rows = []
            for cat, c in root_cause:
                cc = int(c or 0)
                root_rows.append({
                    'category': cat,
                    'count': cc,
                    'percentage': float(cc / root_total * 100.0) if root_total else 0.0,
                })

            return {
                'run': {
                    'str_alignment_run_id': int(str_alignment_run_id),
                    'session_id': int(session_id),
                    'alert_run_id': int(alert_run_id),
                    'threshold_value': float(threshold_value),
                    'entity_level': ctx.entity_level,
                    'temporal_rule': 'alert_date <= str_filed_date',
                },
                'join_key': join_key,
                'str_alert_join_diagnostics': {
                    'str_accounts_total': str_accounts_total,
                    'str_accounts_matched_to_alerts': str_accounts_matched,
                    'str_accounts_unmatched': str_accounts_unmatched,
                    'str_entities_total': str_entities_total,
                    'str_entities_matched_to_alerts': str_entities_matched,
                    'str_entities_unmatched': str_entities_unmatched,
                    'null_entity_id_rows': null_entity_id_rows,
                },
                'temporal_alignment': {
                    'min_alert_date': str(alert_range[0]) if alert_range and alert_range[0] is not None else None,
                    'max_alert_date': str(alert_range[1]) if alert_range and alert_range[1] is not None else None,
                    'min_str_filed_date': str(str_range[0]) if str_range and str_range[0] is not None else None,
                    'max_str_filed_date': str(str_range[1]) if str_range and str_range[1] is not None else None,
                    'pct_strs_alert_le_str_filed': float(aligned_pct),
                    'comparable_pairs': comparable,
                    'aligned_pairs': aligned,
                    'issues': issues,
                },
                'universe': {
                    'alignment_performed_on': 'alert universe (Step-4 eligible population) + temporal/breach rule',
                    'alert_rows': alert_rows,
                    'alert_entities': alert_entities,
                    'breached_entities_total': breached_total,
                    'breached_entities_in_alert_universe': breached_in_alert_universe,
                    'breach_date_range': breach_range,
                },
                'str_metrics': {
                    'total_str': total_str,
                    'captured_str': captured_str,
                    'missed_str': missed_str,
                    'str_capture_rate_pct': float(capture_rate),
                    'str_alert_rate_pct': float(str_alert_rate),
                    'str_entities_matched_to_alerts': str_entities_matched,
                    'total_alert_entities': alert_entities,
                },
                'missed_root_cause_rollup': {
                    'total_missed_str': missed_str,
                    'categories': root_rows
                },
                'guardrail': 'This analysis explains why STRs were missed. It does not re-evaluate risk or policy.'
            }

    def classify_missed(self, behavior_db_path: Path, str_alignment_run_id: int, created_by: str) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT session_id, alert_run_id, threshold_value
                FROM str_alignment_runs
                WHERE str_alignment_run_id = ?
            """, [int(str_alignment_run_id)]).fetchone()
            if not run:
                raise ValueError("STR alignment run not found")
            session_id = int(run[0])
            alert_run_id = int(run[1])
            threshold_value = float(run[2] or 0.0)
            ctx = self._get_session_meta(conn, session_id)

            missed_run_id = self._next_id(conn, "missed_str_analysis_runs", "missed_run_id")
            conn.execute("""
                INSERT INTO missed_str_analysis_runs (
                  missed_run_id, str_alignment_run_id, session_id, threshold_value, created_by, status
                ) VALUES (?, ?, ?, ?, ?, 'completed')
            """, [int(missed_run_id), int(str_alignment_run_id), int(session_id), float(threshold_value), created_by])

            conn.execute("DELETE FROM missed_str_classification WHERE missed_run_id = ?", [int(missed_run_id)])
            conn.execute("DELETE FROM missed_str_metrics WHERE missed_run_id = ?", [int(missed_run_id)])

            conn.execute(f"ATTACH '{str(behavior_db_path)}' AS behavior")
            try:
                series_q = self._series_query(ctx)
                breach_q = self._breach_query(series_q, ctx.entity_collapse, threshold_value)
                series_counts_q = f"SELECT entity_id, COUNT(1) AS n FROM ({series_q}) s GROUP BY entity_id"

                conn.execute(f"""
                    WITH missed AS (
                      SELECT
                        l.str_id,
                        l.entity_id,
                        l.account_id,
                        l.customer_id,
                        l.str_filed_date,
                        l.breach_date,
                        l.behavior_rows,
                        l.eligible_alerted
                      FROM alert_str_links l
                      WHERE l.str_alignment_run_id = {int(str_alignment_run_id)}
                        AND (l.captured IS NULL OR l.captured = FALSE)
                    ),
                    breaches AS ({breach_q}),
                    series_counts AS ({series_counts_q}),
                    rules_failed AS (
                      SELECT
                        entity_id,
                        STRING_AGG(rule_id || ':' || COALESCE(rule_reason, 'FAIL'), '; ') AS fails
                      FROM eligibility_decisions
                      WHERE alert_run_id = {int(alert_run_id)} AND rule_result = 'FAIL'
                      GROUP BY entity_id
                    ),
                    enriched AS (
                      SELECT
                        m.*,
                        COALESCE(sc.n, m.behavior_rows, 0) AS series_rows,
                        b.breach_date AS computed_breach_date,
                        rf.fails AS policy_fails
                      FROM missed m
                      LEFT JOIN series_counts sc ON sc.entity_id = m.entity_id
                      LEFT JOIN breaches b ON b.entity_id = m.entity_id
                      LEFT JOIN rules_failed rf ON rf.entity_id = m.entity_id
                    ),
                    classified AS (
                      SELECT
                        str_id,
                        entity_id,
                        CASE
                          WHEN str_filed_date IS NULL OR entity_id IS NULL THEN 'DATA_QUALITY_LIMITATION'
                          WHEN CAST(series_rows AS INTEGER) = 0 THEN 'SCENARIO_COVERAGE_GAP'
                          WHEN computed_breach_date IS NULL THEN 'BELOW_THRESHOLD'
                          WHEN computed_breach_date > str_filed_date THEN 'TEMPORAL_MISALIGNMENT'
                          WHEN eligible_alerted IS NULL OR eligible_alerted = FALSE THEN 'POLICY_SUPPRESSED'
                          ELSE 'DATA_QUALITY_LIMITATION'
                        END AS root_cause_code,
                        CASE
                          WHEN str_filed_date IS NULL THEN 'Missing STR filed date.'
                          WHEN entity_id IS NULL THEN 'STR could not be linked to an entity in this scenario.'
                          WHEN CAST(series_rows AS INTEGER) = 0 THEN 'Entity has no behavior rows for this scenario metric.'
                          WHEN computed_breach_date IS NULL THEN 'Entity never crossed the Step-3 boundary for this scenario.'
                          WHEN computed_breach_date > str_filed_date THEN 'Entity crossed the boundary only after STR filing date.'
                          WHEN eligible_alerted IS NULL OR eligible_alerted = FALSE THEN COALESCE('Failed Step-4 eligibility: ' || policy_fails, 'Failed Step-4 eligibility.')
                          ELSE 'Unclassified.'
                        END AS explanation_text
                      FROM enriched
                    )
                    INSERT INTO missed_str_classification (missed_run_id, str_id, entity_id, root_cause_code, explanation_text)
                    SELECT {int(missed_run_id)} AS missed_run_id, str_id, entity_id, root_cause_code, explanation_text
                    FROM classified
                """)

                totals = conn.execute("""
                    SELECT COUNT(1) FROM missed_str_classification WHERE missed_run_id = ?
                """, [int(missed_run_id)]).fetchone()
                missed_total = int(totals[0] or 0) if totals else 0
                rows = conn.execute("""
                    SELECT root_cause_code, COUNT(1) AS c
                    FROM missed_str_classification
                    WHERE missed_run_id = ?
                    GROUP BY root_cause_code
                    ORDER BY c DESC
                """, [int(missed_run_id)]).fetchall()
                for code, c in rows:
                    pct = float(c / missed_total * 100.0) if missed_total else 0.0
                    conn.execute("""
                        INSERT INTO missed_str_metrics (missed_run_id, root_cause_code, count, percentage)
                        VALUES (?, ?, ?, ?)
                    """, [int(missed_run_id), code, int(c or 0), float(pct)])
            finally:
                try:
                    conn.execute("DETACH behavior")
                except Exception:
                    pass

        return self.get_missed_run(int(missed_run_id))

    def get_missed_run(self, missed_run_id: int, limit: int = 200, offset: int = 0, root_cause_code: Optional[str] = None) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT missed_run_id, str_alignment_run_id, session_id, threshold_value, created_by, created_at, status
                FROM missed_str_analysis_runs
                WHERE missed_run_id = ?
            """, [int(missed_run_id)]).fetchone()
            if not run:
                raise ValueError("Missed STR analysis run not found")
            metrics = conn.execute("""
                SELECT root_cause_code, count, percentage
                FROM missed_str_metrics
                WHERE missed_run_id = ?
                ORDER BY count DESC
            """, [int(missed_run_id)]).fetchall()

            filter_sql = ""
            params: List = [int(missed_run_id)]
            if root_cause_code:
                filter_sql = " AND c.root_cause_code = ?"
                params.append(root_cause_code)
            params.extend([int(limit), int(offset)])

            rows = conn.execute(f"""
                SELECT
                  c.str_id,
                  l.account_id,
                  l.customer_id,
                  c.entity_id,
                  l.str_filed_date,
                  l.breach_date,
                  c.root_cause_code,
                  c.explanation_text
                FROM missed_str_classification c
                LEFT JOIN alert_str_links l
                  ON l.str_alignment_run_id = (SELECT str_alignment_run_id FROM missed_str_analysis_runs WHERE missed_run_id = {int(missed_run_id)})
                 AND l.str_id = c.str_id
                WHERE c.missed_run_id = ? {filter_sql}
                ORDER BY c.root_cause_code ASC, c.str_id ASC
                LIMIT ? OFFSET ?
            """, params).fetchall()

        return {
            'run': {
                'missed_run_id': int(run[0]),
                'str_alignment_run_id': int(run[1]),
                'session_id': int(run[2]),
                'threshold_value': float(run[3] or 0.0),
                'created_by': run[4],
                'created_at': str(run[5]),
                'status': run[6],
            },
            'metrics': [{
                'root_cause_code': m[0],
                'count': int(m[1] or 0),
                'percentage': float(m[2] or 0.0),
            } for m in metrics],
            'rows': [{
                'str_id': int(r[0]),
                'account_id': r[1],
                'customer_id': r[2],
                'entity_id': r[3],
                'str_filed_date': str(r[4]) if r[4] is not None else None,
                'breach_date': str(r[5]) if r[5] is not None else None,
                'root_cause_code': r[6],
                'explanation_text': r[7],
            } for r in rows],
            'disclaimer': 'This analysis is retrospective and non-operational. STR data is used only in Step-5.'
        }
