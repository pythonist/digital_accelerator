from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import json

import duckdb

from api.tools.btsy.duckdb_pool import duckdb_pool
from api.tools.btsy.calibration_workbench.orchestrated_calibration_service import OrchestratedCalibrationService


class EligibilityAlertService:
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
                CREATE TABLE IF NOT EXISTS alert_generation_runs (
                  alert_run_id INTEGER PRIMARY KEY,
                  session_id INTEGER NOT NULL,
                  boundary_id INTEGER NOT NULL,
                  threshold_value DOUBLE,
                  scenario_ref TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  status TEXT NOT NULL,
                  mode TEXT NOT NULL
                )
            """)
            try:
                conn.execute("ALTER TABLE alert_generation_runs ADD COLUMN IF NOT EXISTS scenario_ref TEXT")
            except Exception:
                pass
            conn.execute("""
                CREATE TABLE IF NOT EXISTS alerts (
                  alert_id INTEGER PRIMARY KEY,
                  alert_run_id INTEGER NOT NULL,
                  entity_id TEXT NOT NULL,
                  account_id TEXT,
                  customer_id TEXT,
                  alert_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  scenario_ref TEXT,
                  threshold_value DOUBLE
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS eligibility_decisions (
                  alert_run_id INTEGER NOT NULL,
                  entity_id TEXT NOT NULL,
                  rule_id TEXT NOT NULL,
                  rule_result TEXT NOT NULL,
                  rule_reason TEXT,
                  evaluated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS policy_impact_summary (
                  alert_run_id INTEGER NOT NULL,
                  rule_id TEXT NOT NULL,
                  suppressed_count INTEGER,
                  suppressed_pct DOUBLE,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def _next_id(self, conn: duckdb.DuckDBPyConnection, table_name: str, pk_column: str) -> int:
        row = conn.execute(f"SELECT COALESCE(MAX({pk_column}), 0) + 1 FROM {table_name}").fetchone()
        v = int(row[0] or 1) if row else 1
        return v if v >= 1 else 1

    def _get_session_meta(self, conn: duckdb.DuckDBPyConnection, session_id: int) -> Dict:
        s = conn.execute("""
            SELECT behavior_run_id, metric_name, window_spec, entity_level
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
        return {
            'behavior_run_id': int(s[0]),
            'signal_name': s[1],
            'window': s[2],
            'entity_level': s[3],
            'entity_collapse': (agg[0] if agg else 'max'),
            'time_lens': (agg[1] if agg else 'full'),
            'sustained_days': int(agg[2]) if agg and agg[2] is not None else 3
        }

    def _resolve_snapshot_paths(self, session_id: int) -> Dict[str, Path]:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT universe_id FROM calibration_sessions WHERE session_id = ?",
                [int(session_id)],
            ).fetchone()
            if not row:
                raise ValueError("Session not found")
            universe_id = int(row[0])

        uconn = duckdb.connect(str(self.universes_db_path), read_only=True)
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
            "accounts": _domain_path("accounts"),
            "customers": _domain_path("customers"),
        }

    def _get_boundary(self, conn: duckdb.DuckDBPyConnection, session_id: int, boundary_id: int) -> Dict:
        b = conn.execute("""
            SELECT strategy_id, buffer_type, buffer_params_json
            FROM risk_boundary_definitions
            WHERE session_id = ? AND boundary_id = ?
        """, [session_id, boundary_id]).fetchone()
        if not b:
            raise ValueError("Boundary not found")
        s = conn.execute("""
            SELECT threshold_value
            FROM threshold_strategies
            WHERE session_id = ? AND strategy_id = ?
        """, [session_id, int(b[0])]).fetchone()
        if not s:
            raise ValueError("Boundary strategy not found")
        return {
            'strategy_id': int(b[0]),
            'buffer_type': b[1],
            'buffer_params': json.loads(b[2]) if b[2] else {},
            'threshold_value': float(s[0] or 0.0)
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

    def _agg_query(self, meta: Dict) -> str:
        behavior_run_id = int(meta['behavior_run_id'])
        signal_name = meta.get('signal_name') or ''
        entity_collapse = (meta.get('entity_collapse') or 'max').lower()
        time_lens = (meta.get('time_lens') or 'full').lower()
        sustained_days = int(meta.get('sustained_days') or 3)

        metric_filter = f"behavior_run_id = {behavior_run_id}"
        if signal_name:
            metric_filter += " AND metric_name = '" + signal_name.replace("'", "''") + "'"

        if time_lens == 'full':
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

        if time_lens in ('rolling_peak', 'sustained'):
            n = max(1, sustained_days)
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

    def _series_query(self, meta: Dict) -> str:
        behavior_run_id = int(meta['behavior_run_id'])
        signal_name = meta.get('signal_name') or ''
        time_lens = (meta.get('time_lens') or 'full').lower()
        sustained_days = int(meta.get('sustained_days') or 3)

        metric_filter = f"behavior_run_id = {behavior_run_id}"
        if signal_name:
            metric_filter += " AND metric_name = '" + signal_name.replace("'", "''") + "'"

        if time_lens == 'full':
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

        if time_lens in ('rolling_peak', 'sustained'):
            n = max(1, sustained_days)
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

    def _columns(self, conn: duckdb.DuckDBPyConnection, parquet_path: Path) -> List[str]:
        p = str(parquet_path).replace("'", "''")
        rows = conn.execute(f"DESCRIBE SELECT * FROM read_parquet('{p}')").fetchall()
        return [r[0] for r in rows]

    def _pick_col(self, cols: List[str], candidates: List[str]) -> Optional[str]:
        norm = {c.lower(): c for c in cols}
        for cand in candidates:
            if cand.lower() in norm:
                return norm[cand.lower()]
        return None

    def _rules(self) -> List[Dict]:
        return [
            {'rule_id': 'ACCOUNT_ACTIVE', 'title': 'Account must be ACTIVE', 'scope': 'account'},
            {'rule_id': 'CUSTOMER_NOT_PEP', 'title': 'Customer must not be PEP', 'scope': 'customer'},
            {'rule_id': 'CUSTOMER_NOT_SANCTIONED', 'title': 'Customer must not be Sanctioned', 'scope': 'customer'},
        ]

    def _load_context(self, conn: duckdb.DuckDBPyConnection, session_id: int) -> Dict:
        ocr = OrchestratedCalibrationService(self.db_path)
        approved = ocr.get_approved_boundary(session_id)
        return approved

    def get_policy_context(self, behavior_db_path: Path, session_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            meta = self._get_session_meta(conn, session_id)
            approved = self._load_context(conn, session_id)
            if not approved.get('approved'):
                return {'approved': False}
            boundary_id = int(approved['boundary_id'])
            boundary = self._get_boundary(conn, session_id, boundary_id)
            lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])
            atl_row = conn.execute("""
                SELECT COUNT(*)
                FROM calibration_frozen_risk_entities
                WHERE session_id = ? AND boundary_id = ? AND atl_flag = TRUE
            """, [session_id, boundary_id]).fetchone()
            atl_count = int(atl_row[0] or 0) if atl_row else 0
            return {
                'approved': True,
                'boundary_id': boundary_id,
                'threshold_value': boundary['threshold_value'],
                'lower': lower,
                'upper': upper,
                'atl_count': atl_count,
                'entity_level': meta.get('entity_level'),
                'signal_name': meta.get('signal_name'),
                'window': meta.get('window'),
                'rules': self._rules()
            }

    def preview(self, behavior_db_path: Path, session_id: int, mode: str = 'preview', overrides: Optional[Dict] = None) -> Dict:
        overrides = overrides or {}
        paths = self._resolve_snapshot_paths(session_id)
        accounts_path = paths["accounts"]
        customers_path = paths["customers"]
        if not accounts_path.exists() or not customers_path.exists():
            raise ValueError("Normalized accounts/customers parquet required")
            raise ValueError("Normalized accounts/customers parquet required")

        with duckdb_pool.connection(self.db_path) as conn:
            meta = self._get_session_meta(conn, session_id)
            approved = self._load_context(conn, session_id)
            if not approved.get('approved'):
                raise ValueError("Approved boundary required")
            boundary_id = int(approved['boundary_id'])
            boundary = self._get_boundary(conn, session_id, boundary_id)
            lower, upper = self._boundary_thresholds(boundary['threshold_value'], boundary['buffer_type'], boundary['buffer_params'])

            account_cols = self._columns(conn, accounts_path)
            customer_cols = self._columns(conn, customers_path)

            account_id_col = self._pick_col(account_cols, ['account_id', 'acct_id', 'account_number', 'account_no', 'entity_id'])
            customer_id_col = self._pick_col(customer_cols, ['customer_id', 'cust_id', 'customer_number', 'customer_no', 'entity_id'])
            account_customer_col = self._pick_col(account_cols, ['customer_id', 'cust_id', 'customer_number'])
            account_status_col = self._pick_col(account_cols, ['account_status', 'status'])
            pep_col = self._pick_col(customer_cols, ['pep_flag', 'is_pep', 'pep'])
            sanction_col = self._pick_col(customer_cols, ['sanction_flag', 'is_sanctioned', 'sanctioned'])

            if not account_id_col or not customer_id_col:
                raise ValueError("Required account_id/customer_id columns not found in normalized data")

            atl_count = int(conn.execute("""
                SELECT COUNT(*)
                FROM calibration_frozen_risk_entities
                WHERE session_id = ? AND boundary_id = ? AND atl_flag = TRUE
            """, [session_id, boundary_id]).fetchone()[0] or 0)
            if atl_count == 0:
                return {
                    'session_id': int(session_id),
                    'boundary_id': int(boundary_id),
                    'threshold': {'lower': lower, 'upper': upper, 'threshold_value': boundary['threshold_value']},
                    'blocked': True,
                    'checks': [{
                        'rule_id': 'FROZEN_ATL_REQUIRED',
                        'status': 'blocked',
                        'message': 'No frozen ATL entities found. Re-approve the boundary to freeze Step-3 output.'
                    }]
                }

            entity_level = (meta.get('entity_level') or '').lower()
            atl = f"""
                SELECT entity_id, aggregated_value
                FROM calibration_frozen_risk_entities
                WHERE session_id = {int(session_id)} AND boundary_id = {int(boundary_id)} AND atl_flag = TRUE
            """

            if 'customer' in entity_level:
                joined = f"""
                    WITH atl AS ({atl})
                    SELECT
                      atl.entity_id AS entity_id,
                      NULL::TEXT AS account_id,
                      atl.entity_id AS customer_id,
                      NULL::TEXT AS account_status,
                      c.{pep_col} AS pep_flag,
                      c.{sanction_col} AS sanction_flag
                    FROM atl
                    LEFT JOIN read_parquet('{str(customers_path).replace("'", "''")}') c
                      ON c.{customer_id_col} = atl.entity_id
                """
            else:
                joined = f"""
                    WITH atl AS ({atl})
                    SELECT
                      atl.entity_id AS entity_id,
                      atl.entity_id AS account_id,
                      a.{account_customer_col} AS customer_id,
                      a.{account_status_col} AS account_status,
                      c.{pep_col} AS pep_flag,
                      c.{sanction_col} AS sanction_flag
                    FROM atl
                    LEFT JOIN read_parquet('{str(accounts_path).replace("'", "''")}') a
                      ON a.{account_id_col} = atl.entity_id
                    LEFT JOIN read_parquet('{str(customers_path).replace("'", "''")}') c
                      ON c.{customer_id_col} = a.{account_customer_col}
                """

            enabled = {
                'ACCOUNT_ACTIVE': bool(overrides.get('ACCOUNT_ACTIVE', True)),
                'CUSTOMER_NOT_PEP': bool(overrides.get('CUSTOMER_NOT_PEP', True)),
                'CUSTOMER_NOT_SANCTIONED': bool(overrides.get('CUSTOMER_NOT_SANCTIONED', True)),
            }

            checks = []
            if enabled['ACCOUNT_ACTIVE'] and not account_status_col:
                checks.append({'rule_id': 'ACCOUNT_ACTIVE', 'status': 'blocked', 'message': 'account_status column missing'})
            if enabled['CUSTOMER_NOT_PEP'] and not pep_col:
                checks.append({'rule_id': 'CUSTOMER_NOT_PEP', 'status': 'blocked', 'message': 'pep flag column missing'})
            if enabled['CUSTOMER_NOT_SANCTIONED'] and not sanction_col:
                checks.append({'rule_id': 'CUSTOMER_NOT_SANCTIONED', 'status': 'blocked', 'message': 'sanction flag column missing'})
            if any(c.get('status') == 'blocked' for c in checks):
                return {
                    'session_id': int(session_id),
                    'boundary_id': int(boundary_id),
                    'threshold': {'lower': lower, 'upper': upper, 'threshold_value': boundary['threshold_value']},
                    'blocked': True,
                    'checks': checks
                }

            account_pass = "TRUE" if not enabled['ACCOUNT_ACTIVE'] else f"(UPPER(COALESCE(account_status,'')) = 'ACTIVE')"
            pep_pass = "TRUE" if not enabled['CUSTOMER_NOT_PEP'] else "(LOWER(COALESCE(CAST(pep_flag AS VARCHAR), '')) IN ('', '0', 'false', 'n', 'no', 'null', 'none'))"
            sanc_pass = "TRUE" if not enabled['CUSTOMER_NOT_SANCTIONED'] else "(LOWER(COALESCE(CAST(sanction_flag AS VARCHAR), '')) IN ('', '0', 'false', 'n', 'no', 'null', 'none'))"

            eligible_where = f"{account_pass} AND {pep_pass} AND {sanc_pass}"

            counts = conn.execute(f"""
                WITH joined AS ({joined})
                SELECT
                  COUNT(*) AS atl_total,
                  SUM(CASE WHEN {eligible_where} THEN 1 ELSE 0 END) AS eligible_total
                FROM joined
            """).fetchone()
            atl_total = int(counts[0] or 0)
            eligible_total = int(counts[1] or 0)
            suppressed_total = max(0, atl_total - eligible_total)

            attribution = conn.execute(f"""
                WITH joined AS ({joined}),
                decisions AS (
                  SELECT
                    entity_id,
                    CASE WHEN {account_pass} THEN 0 ELSE 1 END AS fail_account,
                    CASE WHEN {pep_pass} THEN 0 ELSE 1 END AS fail_pep,
                    CASE WHEN {sanc_pass} THEN 0 ELSE 1 END AS fail_sanc
                  FROM joined
                ),
                first_fail AS (
                  SELECT
                    entity_id,
                    CASE
                      WHEN fail_account = 1 THEN 'ACCOUNT_ACTIVE'
                      WHEN fail_pep = 1 THEN 'CUSTOMER_NOT_PEP'
                      WHEN fail_sanc = 1 THEN 'CUSTOMER_NOT_SANCTIONED'
                      ELSE 'ELIGIBLE'
                    END AS rule_id
                  FROM decisions
                )
                SELECT rule_id, COUNT(*) AS suppressed_count
                FROM first_fail
                WHERE rule_id != 'ELIGIBLE'
                GROUP BY rule_id
                ORDER BY suppressed_count DESC
            """).fetchall()
            attribution_rows = [{
                'rule_id': r[0],
                'suppressed_count': int(r[1] or 0),
                'suppressed_pct': float(r[1] or 0) / suppressed_total * 100.0 if suppressed_total else 0.0
            } for r in attribution]

            sample_alerts = conn.execute(f"""
                WITH joined AS ({joined})
                SELECT entity_id, account_id, customer_id
                FROM joined
                WHERE {eligible_where}
                LIMIT 200
            """).fetchall()
            sample_excl = conn.execute(f"""
                WITH joined AS ({joined})
                SELECT
                  entity_id,
                  CASE
                    WHEN NOT ({account_pass}) THEN 'ACCOUNT_ACTIVE'
                    WHEN NOT ({pep_pass}) THEN 'CUSTOMER_NOT_PEP'
                    WHEN NOT ({sanc_pass}) THEN 'CUSTOMER_NOT_SANCTIONED'
                    ELSE 'UNKNOWN'
                  END AS exclusion_rule
                FROM joined
                WHERE NOT ({eligible_where})
                LIMIT 200
            """).fetchall()

            return {
                'session_id': int(session_id),
                'boundary_id': int(boundary_id),
                'threshold': {'lower': lower, 'upper': upper, 'threshold_value': boundary['threshold_value']},
                'mode': mode,
                'rules': self._rules(),
                'counts': {
                    'atl_total': atl_total,
                    'eligible_total': eligible_total,
                    'suppressed_total': suppressed_total
                },
                'suppression_attribution': attribution_rows,
                'sample_alerts': [{'entity_id': r[0], 'account_id': r[1], 'customer_id': r[2]} for r in sample_alerts],
                'sample_exclusions': [{'entity_id': r[0], 'rule_id': r[1]} for r in sample_excl],
                'disclaimer': 'Step-4 applies bank eligibility policy to already-identified risky behaviour. It does not redefine risk or thresholds.'
            }

    def generate(self, behavior_db_path: Path, session_id: int, created_by: Optional[str]) -> Dict:
        preview = self.preview(behavior_db_path, session_id, mode='generate')
        if preview.get('blocked'):
            raise ValueError("Preview blocked; cannot generate alerts")
        boundary_id = int(preview['boundary_id'])
        threshold_value = float(preview['threshold']['threshold_value'])

        with duckdb_pool.connection(self.db_path) as conn:
            run_id = self._next_id(conn, "alert_generation_runs", "alert_run_id")
            meta = self._get_session_meta(conn, session_id)
            scenario_ref = f"S-{int(session_id)}:{meta.get('signal_name') or 'scenario'}"
            conn.execute("""
                INSERT INTO alert_generation_runs (
                  alert_run_id, session_id, boundary_id, threshold_value, scenario_ref, created_by, status, mode
                ) VALUES (?, ?, ?, ?, ?, ?, 'completed', 'production')
            """, [int(run_id), int(session_id), int(boundary_id), float(threshold_value), scenario_ref, created_by])

        paths = self._resolve_snapshot_paths(session_id)
        accounts_path = paths["accounts"]
        customers_path = paths["customers"]
        with duckdb_pool.connection(self.db_path) as wconn:
            meta = self._get_session_meta(wconn, session_id)
            atl = f"""
                SELECT entity_id, aggregated_value
                FROM calibration_frozen_risk_entities
                WHERE session_id = {int(session_id)} AND boundary_id = {int(boundary_id)} AND atl_flag = TRUE
            """

            account_cols = self._columns(wconn, accounts_path)
            customer_cols = self._columns(wconn, customers_path)
            account_id_col = self._pick_col(account_cols, ['account_id', 'acct_id', 'account_number', 'account_no', 'entity_id'])
            customer_id_col = self._pick_col(customer_cols, ['customer_id', 'cust_id', 'customer_number', 'customer_no', 'entity_id'])
            account_customer_col = self._pick_col(account_cols, ['customer_id', 'cust_id', 'customer_number'])
            account_status_col = self._pick_col(account_cols, ['account_status', 'status'])
            pep_col = self._pick_col(customer_cols, ['pep_flag', 'is_pep', 'pep'])
            sanction_col = self._pick_col(customer_cols, ['sanction_flag', 'is_sanctioned', 'sanctioned'])

            if not account_id_col or not customer_id_col or not account_customer_col:
                raise ValueError("Required normalized join columns missing")
            if not account_status_col or not pep_col or not sanction_col:
                raise ValueError("Required policy fields missing in normalized data")

            entity_level = (meta.get('entity_level') or '').lower()
            if 'customer' in entity_level:
                joined = f"""
                    WITH atl AS ({atl})
                    SELECT
                      atl.entity_id AS entity_id,
                      NULL::TEXT AS account_id,
                      atl.entity_id AS customer_id,
                      NULL::TEXT AS account_status,
                      c.{pep_col} AS pep_flag,
                      c.{sanction_col} AS sanction_flag
                    FROM atl
                    LEFT JOIN read_parquet('{str(customers_path).replace("'", "''")}') c
                      ON c.{customer_id_col} = atl.entity_id
                """
            else:
                joined = f"""
                    WITH atl AS ({atl})
                    SELECT
                      atl.entity_id AS entity_id,
                      atl.entity_id AS account_id,
                      a.{account_customer_col} AS customer_id,
                      a.{account_status_col} AS account_status,
                      c.{pep_col} AS pep_flag,
                      c.{sanction_col} AS sanction_flag
                    FROM atl
                    LEFT JOIN read_parquet('{str(accounts_path).replace("'", "''")}') a
                      ON a.{account_id_col} = atl.entity_id
                    LEFT JOIN read_parquet('{str(customers_path).replace("'", "''")}') c
                      ON c.{customer_id_col} = a.{account_customer_col}
                """

            account_pass = "(UPPER(COALESCE(account_status,'')) = 'ACTIVE')"
            pep_pass = "(LOWER(COALESCE(CAST(pep_flag AS VARCHAR), '')) IN ('', '0', 'false', 'n', 'no', 'null', 'none'))"
            sanc_pass = "(LOWER(COALESCE(CAST(sanction_flag AS VARCHAR), '')) IN ('', '0', 'false', 'n', 'no', 'null', 'none'))"
            eligible_where = f"{account_pass} AND {pep_pass} AND {sanc_pass}"

            wconn.execute("DELETE FROM eligibility_decisions WHERE alert_run_id = ?", [int(run_id)])
            wconn.execute(f"""
                INSERT INTO eligibility_decisions (alert_run_id, entity_id, rule_id, rule_result, rule_reason)
                WITH joined AS ({joined})
                SELECT {int(run_id)} AS alert_run_id, entity_id, 'ACCOUNT_ACTIVE' AS rule_id,
                  CASE WHEN {account_pass} THEN 'PASS' ELSE 'FAIL' END AS rule_result,
                  CASE WHEN {account_pass} THEN NULL ELSE COALESCE(CAST(account_status AS TEXT), 'MISSING') END AS rule_reason
                FROM joined
                UNION ALL
                SELECT {int(run_id)} AS alert_run_id, entity_id, 'CUSTOMER_NOT_PEP' AS rule_id,
                  CASE WHEN {pep_pass} THEN 'PASS' ELSE 'FAIL' END AS rule_result,
                  CASE WHEN {pep_pass} THEN NULL ELSE COALESCE(CAST(pep_flag AS TEXT), 'MISSING') END AS rule_reason
                FROM joined
                UNION ALL
                SELECT {int(run_id)} AS alert_run_id, entity_id, 'CUSTOMER_NOT_SANCTIONED' AS rule_id,
                  CASE WHEN {sanc_pass} THEN 'PASS' ELSE 'FAIL' END AS rule_result,
                  CASE WHEN {sanc_pass} THEN NULL ELSE COALESCE(CAST(sanction_flag AS TEXT), 'MISSING') END AS rule_reason
                FROM joined
            """)

            wconn.execute("DELETE FROM alerts WHERE alert_run_id = ?", [int(run_id)])
            base_alert_id = self._next_id(wconn, "alerts", "alert_id")
            wconn.execute(f"ATTACH '{str(behavior_db_path)}' AS behavior")
            try:
                series_q = self._series_query(meta)
                breach_q = self._breach_query(series_q, meta.get('entity_collapse'), float(threshold_value))
                scenario_ref = f"S-{int(session_id)}:{meta.get('signal_name') or 'scenario'}"
                wconn.execute(f"""
                    WITH joined AS ({joined}),
                    eligible AS (
                      SELECT entity_id, account_id, customer_id
                      FROM joined
                      WHERE {eligible_where}
                    ),
                    breaches AS ({breach_q})
                    INSERT INTO alerts (alert_id, alert_run_id, entity_id, account_id, customer_id, alert_date, scenario_ref, threshold_value)
                    SELECT
                      {int(base_alert_id)} + ROW_NUMBER() OVER () - 1 AS alert_id,
                      {int(run_id)} AS alert_run_id,
                      e.entity_id,
                      e.account_id,
                      e.customer_id,
                      COALESCE(b.breach_date, CURRENT_TIMESTAMP) AS alert_date,
                      '{scenario_ref.replace("'", "''")}' AS scenario_ref,
                      {float(threshold_value)} AS threshold_value
                    FROM eligible e
                    LEFT JOIN breaches b
                      ON b.entity_id = e.entity_id
                """)
            finally:
                try:
                    wconn.execute("DETACH behavior")
                except Exception:
                    pass

            suppressed_total = int(preview['counts']['suppressed_total'] or 0)
            wconn.execute("DELETE FROM policy_impact_summary WHERE alert_run_id = ?", [int(run_id)])
            for r in preview['suppression_attribution']:
                wconn.execute("""
                    INSERT INTO policy_impact_summary (alert_run_id, rule_id, suppressed_count, suppressed_pct)
                    VALUES (?, ?, ?, ?)
                """, [
                    int(run_id),
                    r['rule_id'],
                    int(r['suppressed_count']),
                    float(r['suppressed_count']) / suppressed_total * 100.0 if suppressed_total else 0.0
                ])

            event_id = self._next_id(wconn, "calibration_event_log", "event_id")
            wconn.execute(
                "INSERT INTO calibration_event_log (event_id, session_id, event_type, event_json, created_by) VALUES (?, ?, ?, ?, ?)",
                [event_id, session_id, "STEP_4_RUN", json.dumps({'alert_run_id': int(run_id), 'boundary_id': int(boundary_id)}), created_by]
            )

        return self.get_run(session_id, int(run_id))

    def list_runs(self, session_id: int) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT alert_run_id, session_id, boundary_id, threshold_value, scenario_ref, created_by, created_at, status, mode
                FROM alert_generation_runs
                WHERE session_id = ?
                ORDER BY alert_run_id DESC
                LIMIT 200
            """, [session_id]).fetchall()
        return [{
            'alert_run_id': int(r[0]),
            'session_id': int(r[1]),
            'boundary_id': int(r[2]),
            'threshold_value': float(r[3]) if r[3] is not None else None,
            'scenario_ref': r[4],
            'created_by': r[5],
            'created_at': str(r[6]),
            'status': r[7],
            'mode': r[8]
        } for r in rows]

    def get_run(self, session_id: int, alert_run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            run = conn.execute("""
                SELECT alert_run_id, session_id, boundary_id, threshold_value, scenario_ref, created_by, created_at, status, mode
                FROM alert_generation_runs
                WHERE alert_run_id = ?
            """, [alert_run_id]).fetchone()
            if not run or int(run[1]) != int(session_id):
                raise ValueError("Alert run not found")
            alerts = conn.execute("""
                SELECT alert_id, entity_id, account_id, customer_id, alert_date, scenario_ref, threshold_value
                FROM alerts
                WHERE alert_run_id = ?
                ORDER BY alert_id ASC
                LIMIT 500
            """, [alert_run_id]).fetchall()
            impact = conn.execute("""
                SELECT rule_id, suppressed_count, suppressed_pct
                FROM policy_impact_summary
                WHERE alert_run_id = ?
                ORDER BY suppressed_count DESC
            """, [alert_run_id]).fetchall()
            decisions = conn.execute("""
                SELECT entity_id, rule_id, rule_result, rule_reason
                FROM eligibility_decisions
                WHERE alert_run_id = ?
                ORDER BY entity_id ASC
                LIMIT 2000
            """, [alert_run_id]).fetchall()

        return {
            'run': {
                'alert_run_id': int(run[0]),
                'session_id': int(run[1]),
                'boundary_id': int(run[2]),
                'threshold_value': float(run[3]) if run[3] is not None else None,
                'scenario_ref': run[4],
                'created_by': run[5],
                'created_at': str(run[6]),
                'status': run[7],
                'mode': run[8]
            },
            'alerts': [{
                'alert_id': int(a[0]),
                'entity_id': a[1],
                'account_id': a[2],
                'customer_id': a[3],
                'alert_date': str(a[4]) if a[4] is not None else None,
                'scenario_ref': a[5],
                'threshold_value': float(a[6]) if a[6] is not None else None
            } for a in alerts],
            'eligibility_decisions': [{
                'entity_id': d[0],
                'rule_id': d[1],
                'rule_result': d[2],
                'rule_reason': d[3]
            } for d in decisions],
            'suppression_attribution': [{
                'rule_id': i[0],
                'suppressed_count': int(i[1] or 0),
                'suppressed_pct': float(i[2] or 0.0)
            } for i in impact],
            'disclaimer': 'Policy filters applied after risk identification. Risk and thresholds remain frozen from Step-3.'
        }
