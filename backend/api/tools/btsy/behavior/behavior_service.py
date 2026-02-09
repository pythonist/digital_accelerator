from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import json
import time
from datetime import datetime
import re
import duckdb
import pandas as pd
import hashlib

class BehaviorService:
    def __init__(self, db_path: Path, snapshot_storage_path: Path, audit_service=None):
        self.db_path = db_path
        self.snapshot_storage_path = snapshot_storage_path
        self.audit_service = audit_service
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS behavior_runs_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS behavior_insights_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS behavior_chart_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS behavior_overlap_audit_seq START 1")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_runs (
                  behavior_run_id INTEGER PRIMARY KEY DEFAULT nextval('behavior_runs_seq'),
                  universe_id INTEGER NOT NULL,
                  config_json TEXT NOT NULL,
                  entity_level TEXT NOT NULL,
                  entity_id_col TEXT,
                  time_col TEXT,
                  behavior_hash TEXT,
                  total_rows INTEGER,
                  total_entities INTEGER,
                  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  finished_at TIMESTAMP,
                  status TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_table (
                  behavior_run_id INTEGER NOT NULL,
                  universe_id INTEGER NOT NULL,
                  entity_level TEXT NOT NULL,
                  entity_id TEXT NOT NULL,
                  as_of_date TIMESTAMP NOT NULL,
                  metric_name TEXT NOT NULL,
                  metric_value DOUBLE,
                  metric_type TEXT,
                  window_spec TEXT,
                  computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_run_diagnostics (
                  behavior_run_id INTEGER PRIMARY KEY,
                  universe_id INTEGER NOT NULL,
                  entity_level TEXT NOT NULL,
                  metric_name TEXT,
                  window_spec TEXT,
                  total_rows INTEGER,
                  total_entities INTEGER,
                  null_pct DOUBLE,
                  zero_pct DOUBLE,
                  negative_pct DOUBLE,
                  gini DOUBLE,
                  ks_vs_prev DOUBLE,
                  coverage_delta_pct DOUBLE,
                  reusability_score DOUBLE,
                  reusability_label TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_run_insights (
                  id INTEGER PRIMARY KEY DEFAULT nextval('behavior_insights_seq'),
                  behavior_run_id INTEGER NOT NULL,
                  insight_type TEXT NOT NULL,
                  insight_text TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_chart_snapshots (
                  id INTEGER PRIMARY KEY DEFAULT nextval('behavior_chart_seq'),
                  behavior_run_id INTEGER NOT NULL,
                  chart_type TEXT NOT NULL,
                  data_json TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_run_entities (
                  behavior_run_id INTEGER NOT NULL,
                  entity_id TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_run_period_entities (
                  behavior_run_id INTEGER NOT NULL,
                  period TIMESTAMP NOT NULL,
                  entity_id TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_run_entity_stats (
                  behavior_run_id INTEGER PRIMARY KEY,
                  total_entities INTEGER
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_overlap_cache (
                  run_a INTEGER NOT NULL,
                  run_b INTEGER NOT NULL,
                  shared_entities INTEGER,
                  shared_pct_a DOUBLE,
                  shared_pct_b DOUBLE,
                  shared_periods INTEGER,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_entity_footprint (
                  entity_id TEXT NOT NULL,
                  behavior_run_id INTEGER NOT NULL,
                  first_seen TIMESTAMP,
                  last_seen TIMESTAMP,
                  active_days INTEGER,
                  activity_dates_json TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS behavior_overlap_audit (
                  id INTEGER PRIMARY KEY DEFAULT nextval('behavior_overlap_audit_seq'),
                  behavior_run_id INTEGER,
                  entity_id TEXT,
                  action TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
        finally:
            conn.close()

    def _safe_ident(self, name: str) -> str:
        n = str(name or '')
        if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', n):
            raise ValueError(f"Unsafe identifier: {n}")
        return f'"{n}"'

    def _get_run_meta(self, run_id: int) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        try:
            row = conn.execute("""
                SELECT universe_id, config_json, entity_level, entity_id_col, time_col
                FROM behavior_runs
                WHERE behavior_run_id = ?
            """, [int(run_id)]).fetchone()
            if not row:
                raise ValueError("Behavior run not found")
            cfg = json.loads(row[1]) if row[1] else {}
            metric = (cfg.get('metrics') or [{}])[0] if isinstance(cfg, dict) else {}
            return {
                'behavior_run_id': int(run_id),
                'universe_id': int(row[0]),
                'config': cfg,
                'entity_level': row[2],
                'entity_id_col': row[3] or (cfg.get('entity_id_col') if isinstance(cfg, dict) else None),
                'time_col': row[4] or (cfg.get('time_col') if isinstance(cfg, dict) else None),
                'metric': metric,
            }
        finally:
            conn.close()

    def validate_runs(self, run_a: int, run_b: int, universe_db_path: Path, entity_id: Optional[str] = None) -> Dict:
        meta_a = self._get_run_meta(int(run_a))
        meta_b = self._get_run_meta(int(run_b))

        conn = duckdb.connect(str(self.db_path))
        try:
            same_universe = meta_a['universe_id'] == meta_b['universe_id']
            q = """
                WITH joined AS (
                  SELECT
                    a.entity_id,
                    a.as_of_date,
                    TRY_CAST(a.metric_value AS DOUBLE) AS va,
                    TRY_CAST(b.metric_value AS DOUBLE) AS vb
                  FROM behavior_table a
                  JOIN behavior_table b
                    ON a.entity_id = b.entity_id
                   AND a.as_of_date = b.as_of_date
                  WHERE a.behavior_run_id = ?
                    AND b.behavior_run_id = ?
                )
                SELECT
                  COUNT(*) AS n,
                  SUM(CASE WHEN ABS(COALESCE(va,0) - COALESCE(vb,0)) <= 1e-9 THEN 1 ELSE 0 END) AS eq,
                  AVG(ABS(COALESCE(va,0) - COALESCE(vb,0))) AS mean_abs_delta,
                  quantile(ABS(COALESCE(va,0) - COALESCE(vb,0)), 0.5) AS med_abs_delta,
                  quantile(ABS(COALESCE(va,0) - COALESCE(vb,0)), 0.95) AS p95_abs_delta,
                  MAX(ABS(COALESCE(va,0) - COALESCE(vb,0))) AS max_abs_delta
                FROM joined
            """
            s = conn.execute(q, [int(run_a), int(run_b)]).fetchone()
            n = int(s[0] or 0)
            eq = int(s[1] or 0)
            summary = {
                'n_rows_joined': n,
                'equal_rows': eq,
                'equal_pct': (float(eq) / float(n) * 100.0) if n else None,
                'mean_abs_delta': float(s[2] or 0.0) if n else None,
                'median_abs_delta': float(s[3] or 0.0) if n else None,
                'p95_abs_delta': float(s[4] or 0.0) if n else None,
                'max_abs_delta': float(s[5] or 0.0) if n else None,
            }

            sample_q = """
                WITH joined AS (
                  SELECT
                    a.entity_id,
                    a.as_of_date,
                    TRY_CAST(a.metric_value AS DOUBLE) AS va,
                    TRY_CAST(b.metric_value AS DOUBLE) AS vb
                  FROM behavior_table a
                  JOIN behavior_table b
                    ON a.entity_id = b.entity_id
                   AND a.as_of_date = b.as_of_date
                  WHERE a.behavior_run_id = ?
                    AND b.behavior_run_id = ?
                )
                SELECT entity_id, as_of_date, va, vb, (COALESCE(vb,0)-COALESCE(va,0)) AS delta
                FROM joined
                ORDER BY ABS(delta) DESC
                LIMIT 25
            """
            samples = conn.execute(sample_q, [int(run_a), int(run_b)]).fetchall()
            sample_rows = [{
                'entity_id': r[0],
                'as_of_date': str(r[1]) if r[1] is not None else None,
                'value_a': float(r[2]) if r[2] is not None else None,
                'value_b': float(r[3]) if r[3] is not None else None,
                'delta': float(r[4]) if r[4] is not None else None,
            } for r in samples]

            per_entity = None
            if entity_id:
                pe_q = """
                    WITH joined AS (
                      SELECT
                        a.entity_id,
                        a.as_of_date,
                        TRY_CAST(a.metric_value AS DOUBLE) AS va,
                        TRY_CAST(b.metric_value AS DOUBLE) AS vb
                      FROM behavior_table a
                      JOIN behavior_table b
                        ON a.entity_id = b.entity_id
                       AND a.as_of_date = b.as_of_date
                      WHERE a.behavior_run_id = ?
                        AND b.behavior_run_id = ?
                        AND CAST(a.entity_id AS VARCHAR) = ?
                    )
                    SELECT
                      COUNT(*) AS n,
                      SUM(CASE WHEN ABS(COALESCE(va,0) - COALESCE(vb,0)) <= 1e-9 THEN 1 ELSE 0 END) AS eq,
                      AVG(ABS(COALESCE(va,0) - COALESCE(vb,0))) AS mean_abs_delta,
                      MAX(ABS(COALESCE(va,0) - COALESCE(vb,0))) AS max_abs_delta
                    FROM joined
                """
                pe = conn.execute(pe_q, [int(run_a), int(run_b), str(entity_id)]).fetchone()
                per_entity = {
                    'entity_id': str(entity_id),
                    'n_rows': int(pe[0] or 0),
                    'equal_pct': (float(pe[1] or 0) / float(pe[0] or 1) * 100.0) if pe[0] else None,
                    'mean_abs_delta': float(pe[2] or 0.0) if pe[0] else None,
                    'max_abs_delta': float(pe[3] or 0.0) if pe[0] else None,
                }

            time_stats = None
            if same_universe:
                u = self._get_universe(meta_a['universe_id'], universe_db_path)
                parquet_path = u.get('parquet_path')
                entity_col = meta_a.get('entity_id_col') or 'account_id'
                time_col = meta_a.get('time_col') or 'transaction_datetime'

                conn_u = duckdb.connect()
                try:
                    e = self._safe_ident(entity_col)
                    t = self._safe_ident(time_col)
                    ts = f"TRY_CAST({t} AS TIMESTAMP)"
                    parquet_path_sql = str(parquet_path).replace("'", "''")
                    base = f"read_parquet('{parquet_path_sql}')"

                    st = conn_u.execute(f"""
                        WITH base AS (
                          SELECT {e} AS entity_id, {ts} AS ts
                          FROM {base}
                        ),
                        by_entity AS (
                          SELECT
                            entity_id,
                            MIN(ts) AS min_ts,
                            MAX(ts) AS max_ts,
                            COUNT(*) AS n
                          FROM base
                          WHERE ts IS NOT NULL
                          GROUP BY entity_id
                        )
                        SELECT
                          (SELECT COUNT(*) FROM {base}) AS total_rows,
                          (SELECT COUNT(*) FROM {base} WHERE {ts} IS NULL) AS null_ts_rows,
                          (SELECT COUNT(DISTINCT date_trunc('day', {ts})) FROM {base} WHERE {ts} IS NOT NULL) AS distinct_days,
                          (SELECT MIN({ts}) FROM {base} WHERE {ts} IS NOT NULL) AS min_ts,
                          (SELECT MAX({ts}) FROM {base} WHERE {ts} IS NOT NULL) AS max_ts,
                          (SELECT SUM(CASE WHEN EXTRACT(hour FROM {ts})=0 AND EXTRACT(minute FROM {ts})=0 AND EXTRACT(second FROM {ts})=0 THEN 1 ELSE 0 END) FROM {base} WHERE {ts} IS NOT NULL) AS midnight_rows,
                          (SELECT quantile(CAST(date_diff('day', min_ts, max_ts) AS DOUBLE), 0.5) FROM by_entity) AS median_entity_span_days,
                          (SELECT quantile(CAST(n AS DOUBLE), 0.5) FROM by_entity) AS median_entity_rows
                    """).fetchone()

                    total_rows = int(st[0] or 0)
                    null_ts_rows = int(st[1] or 0)
                    midnight_rows = int(st[5] or 0)
                    time_stats = {
                        'total_rows': total_rows,
                        'null_ts_pct': (float(null_ts_rows) / float(total_rows) * 100.0) if total_rows else None,
                        'midnight_pct': (float(midnight_rows) / float(max(1, total_rows - null_ts_rows)) * 100.0) if total_rows else None,
                        'distinct_days': int(st[2] or 0),
                        'min_ts': str(st[3]) if st[3] is not None else None,
                        'max_ts': str(st[4]) if st[4] is not None else None,
                        'median_entity_span_days': float(st[6]) if st[6] is not None else None,
                        'median_entity_rows': float(st[7]) if st[7] is not None else None,
                    }
                finally:
                    conn_u.close()

            return {
                'same_universe': same_universe,
                'run_a': {
                    'behavior_run_id': meta_a['behavior_run_id'],
                    'universe_id': meta_a['universe_id'],
                    'window': meta_a['metric'].get('window'),
                    'metric_name': meta_a['metric'].get('name'),
                    'metric_type': meta_a['metric'].get('type'),
                    'metric_column': meta_a['metric'].get('column'),
                    'time_col': meta_a.get('time_col'),
                    'entity_id_col': meta_a.get('entity_id_col'),
                },
                'run_b': {
                    'behavior_run_id': meta_b['behavior_run_id'],
                    'universe_id': meta_b['universe_id'],
                    'window': meta_b['metric'].get('window'),
                    'metric_name': meta_b['metric'].get('name'),
                    'metric_type': meta_b['metric'].get('type'),
                    'metric_column': meta_b['metric'].get('column'),
                    'time_col': meta_b.get('time_col'),
                    'entity_id_col': meta_b.get('entity_id_col'),
                },
                'join_summary': summary,
                'top_deltas': sample_rows,
                'entity_summary': per_entity,
                'universe_time_stats': time_stats,
            }
        finally:
            conn.close()

    def account_transactions(
        self,
        run_id: int,
        entity_id: str,
        universe_db_path: Path,
        limit: int = 200,
        offset: int = 0,
        lookback_days: Optional[int] = 30,
    ) -> Dict:
        meta = self._get_run_meta(int(run_id))
        u = self._get_universe(meta['universe_id'], universe_db_path)
        parquet_path = u.get('parquet_path')

        entity_col = meta.get('entity_id_col') or 'account_id'
        time_col = meta.get('time_col') or 'transaction_datetime'
        amount_col = (meta.get('metric') or {}).get('column') or 'transaction_amount'

        conn = duckdb.connect()
        try:
            e = self._safe_ident(entity_col)
            t = self._safe_ident(time_col)
            a = self._safe_ident(amount_col)
            ts = f"TRY_CAST({t} AS TIMESTAMP)"
            amt = f"TRY_CAST({a} AS DOUBLE)"
            parquet_path_sql = str(parquet_path).replace("'", "''")
            base = f"read_parquet('{parquet_path_sql}')"

            max_ts = conn.execute(f"SELECT MAX({ts}) FROM {base} WHERE {e} = ? AND {ts} IS NOT NULL", [str(entity_id)]).fetchone()[0]
            if max_ts is None:
                return {
                    'run_id': int(run_id),
                    'entity_id': str(entity_id),
                    'meta': {'universe_id': meta['universe_id'], 'entity_id_col': entity_col, 'time_col': time_col, 'amount_col': amount_col},
                    'range': {'start': None, 'end': None},
                    'transactions': [],
                    'daily': [],
                    'summary': {'total_txns': 0}
                }

            start_expr = None
            params: List = [str(entity_id)]
            if lookback_days is not None:
                start_expr = f"({ts} >= (?::TIMESTAMP - INTERVAL '{int(lookback_days)} days'))"
                params.append(max_ts)

            where = f"{e} = ? AND {ts} IS NOT NULL"
            if start_expr:
                where = f"{where} AND {start_expr}"

            tx_rows = conn.execute(f"""
                SELECT * EXCLUDE({t})
                     , {ts} AS {time_col}
                FROM {base}
                WHERE {where}
                ORDER BY {ts} DESC
                LIMIT {int(limit)} OFFSET {int(offset)}
            """, params).df()

            daily_rows = conn.execute(f"""
                SELECT
                  date_trunc('day', {ts}) AS day,
                  COUNT(*) AS txn_count,
                  SUM({amt}) AS total_amount,
                  AVG({amt}) AS avg_amount,
                  MAX({amt}) AS max_amount
                FROM {base}
                WHERE {where} AND {amt} IS NOT NULL
                GROUP BY day
                ORDER BY day ASC
            """, params).fetchall()

            sum_row = conn.execute(f"""
                SELECT
                  COUNT(*) AS txn_count,
                  COUNT(DISTINCT date_trunc('day', {ts})) AS active_days,
                  SUM(CASE WHEN EXTRACT(hour FROM {ts})=0 AND EXTRACT(minute FROM {ts})=0 AND EXTRACT(second FROM {ts})=0 THEN 1 ELSE 0 END) AS midnight_rows,
                  MIN({ts}) AS min_ts,
                  MAX({ts}) AS max_ts,
                  SUM({amt}) AS total_amount
                FROM {base}
                WHERE {where}
            """, params).fetchone()

            txn_count = int(sum_row[0] or 0)
            active_days = int(sum_row[1] or 0)
            midnight_rows = int(sum_row[2] or 0)
            min_ts2 = sum_row[3]
            max_ts2 = sum_row[4]
            total_amount = sum_row[5]

            daily = [{
                'day': str(r[0])[:10] if r[0] is not None else None,
                'txn_count': int(r[1] or 0),
                'total_amount': float(r[2] or 0.0) if r[2] is not None else 0.0,
                'avg_amount': float(r[3] or 0.0) if r[3] is not None else 0.0,
                'max_amount': float(r[4] or 0.0) if r[4] is not None else 0.0,
            } for r in daily_rows]

            return {
                'run_id': int(run_id),
                'entity_id': str(entity_id),
                'meta': {
                    'universe_id': meta['universe_id'],
                    'entity_id_col': entity_col,
                    'time_col': time_col,
                    'amount_col': amount_col,
                },
                'range': {
                    'start': str(min_ts2) if min_ts2 is not None else None,
                    'end': str(max_ts2) if max_ts2 is not None else None,
                    'lookback_days': int(lookback_days) if lookback_days is not None else None,
                },
                'summary': {
                    'total_txns': txn_count,
                    'active_days': active_days,
                    'midnight_pct': (float(midnight_rows) / float(txn_count) * 100.0) if txn_count else None,
                    'total_amount': float(total_amount) if total_amount is not None else None,
                },
                'transactions': tx_rows.to_dict(orient='records'),
                'daily': daily,
            }
        finally:
            conn.close()
        conn = duckdb.connect(str(self.db_path))
        try:
            try:
                conn.execute("ALTER TABLE behavior_runs ADD COLUMN entity_id_col TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE behavior_runs ADD COLUMN time_col TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE behavior_runs ADD COLUMN behavior_hash TEXT")
            except Exception:
                pass
        finally:
            conn.close()

    def _get_universe(self, universe_id: int, universe_db_path: Path):
        conn = duckdb.connect(str(universe_db_path))
        try:
            row = conn.execute("""
                SELECT parquet_path, calibration_run_id, universe_name, snapshot_id
                FROM transaction_universe_runs
                WHERE id = ?
            """, [universe_id]).fetchone()
            if not row:
                raise ValueError("Universe not found")
            return {
                'parquet_path': row[0],
                'calibration_run_id': row[1],
                'universe_name': row[2],
                'snapshot_id': row[3]
            }
        finally:
            conn.close()

    def _gini(self, values: List[float]) -> float:
        arr = pd.Series([v for v in values if v is not None]).astype(float).to_numpy()
        if arr.size == 0:
            return 0.0
        arr = abs(arr)
        if arr.sum() == 0:
            return 0.0
        arr = pd.Series(arr).sort_values().to_numpy()
        n = arr.size
        index = pd.Series(range(1, n + 1)).to_numpy()
        return float((2.0 * (index * arr).sum()) / (n * arr.sum()) - (n + 1) / n)

    def _resolve_snapshot_domain_path(self, snapshot_id: str, domain: str) -> Path:
        from api.tools.btsy.snapshot_manager import SnapshotManager
        mgr = SnapshotManager(self.snapshot_storage_path.parent / "duckdb" / "snapshots.duckdb")
        snap = mgr.get_snapshot(str(snapshot_id))
        if snap:
            for d in (snap.get("domains") or []):
                if d.get("domain") == domain and d.get("normalized_file_path"):
                    return Path(d["normalized_file_path"])
        return self.snapshot_storage_path.parent / "normalized" / str(snapshot_id) / f"{domain}.parquet"

    def _get_distribution_stats(self, conn, run_id: int) -> Dict[str, Any]:
        snap = conn.execute(
            """
            SELECT data_json
            FROM behavior_chart_snapshots
            WHERE behavior_run_id = ? AND chart_type = 'distribution_stats'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [run_id],
        ).fetchone()
        if snap and snap[0]:
            try:
                return json.loads(snap[0])
            except Exception:
                pass
        dist = conn.execute(
            """
            SELECT
              COUNT(*) AS n,
              MIN(metric_value) AS minv,
              MAX(metric_value) AS maxv,
              AVG(metric_value) AS meanv,
              median(metric_value) AS medianv,
              quantile(metric_value, 0.9) AS p90,
              quantile(metric_value, 0.95) AS p95,
              quantile(metric_value, 0.99) AS p99,
              SUM(CASE WHEN metric_value = 0 THEN 1 ELSE 0 END) AS zeros
            FROM behavior_table
            WHERE behavior_run_id = ?
            """,
            [run_id],
        ).fetchone()
        total_mass_row = conn.execute(
            "SELECT SUM(ABS(metric_value)) AS mass FROM behavior_table WHERE behavior_run_id = ?",
            [run_id],
        ).fetchone()
        total_mass = float(total_mass_row[0] or 0.0)
        tail = {'top1_mass_pct': None, 'top5_mass_pct': None}
        if total_mass > 0:
            q99 = conn.execute(
                "SELECT quantile(metric_value, 0.99) FROM behavior_table WHERE behavior_run_id = ?",
                [run_id],
            ).fetchone()[0]
            q95 = conn.execute(
                "SELECT quantile(metric_value, 0.95) FROM behavior_table WHERE behavior_run_id = ?",
                [run_id],
            ).fetchone()[0]
            top1 = conn.execute(
                """
                SELECT SUM(ABS(metric_value)) AS mass
                FROM behavior_table
                WHERE behavior_run_id = ? AND metric_value >= ?
                """,
                [run_id, q99],
            ).fetchone()[0]
            top5 = conn.execute(
                """
                SELECT SUM(ABS(metric_value)) AS mass
                FROM behavior_table
                WHERE behavior_run_id = ? AND metric_value >= ?
                """,
                [run_id, q95],
            ).fetchone()[0]
            tail = {
                'top1_mass_pct': float((top1 or 0.0) / total_mass * 100.0),
                'top5_mass_pct': float((top5 or 0.0) / total_mass * 100.0),
            }
        gini_vals = conn.execute(
            """
            SELECT MAX(ABS(metric_value)) AS v
            FROM behavior_table
            WHERE behavior_run_id = ?
            GROUP BY entity_id
            """,
            [run_id],
        ).fetchall()
        gini = self._gini([float(r[0] or 0.0) for r in gini_vals])
        return {
            'count': int(dist[0] or 0),
            'min': float(dist[1] or 0.0),
            'max': float(dist[2] or 0.0),
            'mean': float(dist[3] or 0.0),
            'median': float(dist[4] or 0.0),
            'p90': float(dist[5] or 0.0),
            'p95': float(dist[6] or 0.0),
            'p99': float(dist[7] or 0.0),
            'zero_pct': (float(dist[8] or 0.0) / float(dist[0] or 1)) * 100.0 if dist[0] else 0.0,
            'tail': tail,
            'gini': float(gini or 0.0),
        }

    def _get_prev_run_id(self, conn, run_id: int) -> Optional[int]:
        row = conn.execute(
            """
            SELECT universe_id, config_json
            FROM behavior_runs
            WHERE behavior_run_id = ?
            """,
            [int(run_id)],
        ).fetchone()
        if not row:
            return None
        universe_id = int(row[0])
        metric_name = None
        try:
            cfg = json.loads(row[1]) if row[1] else {}
            metric = (cfg.get('metrics') or [{}])[0] if cfg.get('metrics') else {}
            metric_name = metric.get('name')
        except Exception:
            metric_name = None
        prev_rows = conn.execute(
            """
            SELECT behavior_run_id, config_json
            FROM behavior_runs
            WHERE universe_id = ? AND behavior_run_id < ?
            ORDER BY behavior_run_id DESC
            LIMIT 25
            """,
            [universe_id, int(run_id)],
        ).fetchall()
        for rid, cfg in prev_rows:
            try:
                c = json.loads(cfg) if cfg else {}
                m = (c.get('metrics') or [{}])[0] if c.get('metrics') else {}
                if metric_name and m.get('name') == metric_name:
                    return int(rid)
            except Exception:
                continue
        return None

    def _ks_from_histograms(self, hist_a: Dict[int, int], hist_b: Dict[int, int]) -> Optional[float]:
        if not hist_a or not hist_b:
            return None
        total_a = sum(hist_a.values())
        total_b = sum(hist_b.values())
        if total_a == 0 or total_b == 0:
            return None
        all_keys = sorted(set(hist_a.keys()) | set(hist_b.keys()))
        cdf_a = 0.0
        cdf_b = 0.0
        ks = 0.0
        for k in all_keys:
            cdf_a += hist_a.get(k, 0) / total_a
            cdf_b += hist_b.get(k, 0) / total_b
            ks = max(ks, abs(cdf_a - cdf_b))
        return float(ks)

    def get_signal_intelligence(self, run_id: int, universe_db_path: Optional[Path] = None, compare_run_id: Optional[int] = None) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        try:
            if compare_run_id is None:
                snap = conn.execute(
                    """
                    SELECT data_json
                    FROM behavior_chart_snapshots
                    WHERE behavior_run_id = ? AND chart_type = 'signal_intelligence'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    [int(run_id)],
                ).fetchone()
                if snap and snap[0]:
                    try:
                        return json.loads(snap[0])
                    except Exception:
                        pass

            meta = self._get_run_meta(run_id)
            entity_level = str(meta.get('entity_level') or 'account')
            metric_name = (meta.get('metric') or {}).get('name')
            dist = self._get_distribution_stats(conn, run_id)
            totals = conn.execute(
                """
                SELECT
                  COUNT(*) AS n,
                  SUM(CASE WHEN metric_value IS NULL THEN 1 ELSE 0 END) AS nulls,
                  SUM(CASE WHEN metric_value = 0 THEN 1 ELSE 0 END) AS zeros,
                  SUM(CASE WHEN metric_value < 0 THEN 1 ELSE 0 END) AS negatives
                FROM behavior_table
                WHERE behavior_run_id = ?
                """,
                [int(run_id)],
            ).fetchone()
            n = int(totals[0] or 0)
            null_pct = float((totals[1] or 0) / n * 100.0) if n else 0.0
            zero_pct = float((totals[2] or 0) / n * 100.0) if n else 0.0
            negative_pct = float((totals[3] or 0) / n * 100.0) if n else 0.0

            tail = dist.get('tail') or {}
            top1_mass_pct = tail.get('top1_mass_pct') or 0.0
            gini = float(dist.get('gini') or 0.0)
            median = float(dist.get('median') or 0.0)
            p99 = float(dist.get('p99') or 0.0)
            distribution_label = 'moderate_skew'
            if zero_pct >= 70:
                distribution_label = 'mostly_zero'
            elif top1_mass_pct >= 40 or gini >= 0.6:
                distribution_label = 'highly_concentrated'
            elif median > 0 and p99 >= 5 * median:
                distribution_label = 'heavy_right_tail'
            elif median > 0 and dist.get('p95') is not None and float(dist.get('p95') or 0) <= 2 * median:
                distribution_label = 'uniform'

            distribution_text = "Signal shows moderate skew with mixed concentration."
            if distribution_label == 'mostly_zero':
                distribution_text = "Most observations are zero; the signal is sparse."
            elif distribution_label == 'highly_concentrated':
                distribution_text = "This behaviour is highly concentrated in a small number of entities."
            elif distribution_label == 'heavy_right_tail':
                distribution_text = "Signal has a heavy right tail; extreme values dominate."
            elif distribution_label == 'uniform':
                distribution_text = "Signal distribution is relatively uniform across entities."

            dominance_rows = conn.execute(
                """
                SELECT entity_id, SUM(ABS(metric_value)) AS mass
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY entity_id
                ORDER BY mass DESC
                """,
                [int(run_id)],
            ).fetchall()
            total_mass = float(sum([float(r[1] or 0.0) for r in dominance_rows]) or 0.0)
            def _mass_pct(k: int) -> float:
                if total_mass <= 0:
                    return 0.0
                return float(sum([float(r[1] or 0.0) for r in dominance_rows[:k]]) / total_mass * 100.0)
            dominance = {
                'top1_pct': _mass_pct(1),
                'top5_pct': _mass_pct(5),
                'top10_pct': _mass_pct(10),
                'total_mass': total_mass,
            }

            by_day = conn.execute(
                """
                SELECT date_trunc('day', as_of_date) AS day, SUM(ABS(metric_value)) AS day_mass
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY day
                ORDER BY day
                """,
                [int(run_id)],
            ).fetchall()
            day_mass = pd.Series([float(r[1] or 0.0) for r in by_day])
            day_mean = float(day_mass.mean()) if not day_mass.empty else 0.0
            day_std = float(day_mass.std()) if not day_mass.empty else 0.0
            day_cv = float(day_std / day_mean) if day_mean else 0.0
            by_month = conn.execute(
                """
                SELECT date_trunc('month', as_of_date) AS month, SUM(ABS(metric_value)) AS month_mass
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY month
                ORDER BY month
                """,
                [int(run_id)],
            ).fetchall()
            month_mass = pd.Series([float(r[1] or 0.0) for r in by_month])
            month_mean = float(month_mass.mean()) if not month_mass.empty else 0.0
            month_std = float(month_mass.std()) if not month_mass.empty else 0.0
            month_cv = float(month_std / month_mean) if month_mean else 0.0
            stability_label = 'moderate'
            if day_cv <= 0.5:
                stability_label = 'stable'
            elif day_cv >= 1.0:
                stability_label = 'volatile'
            stability = {
                'day_cv': day_cv,
                'month_cv': month_cv,
                'label': stability_label,
            }

            activity_rows = conn.execute(
                """
                WITH by_entity_day AS (
                  SELECT entity_id,
                         COUNT(DISTINCT CASE WHEN metric_value != 0 THEN date_trunc('day', as_of_date) END) AS active_days
                  FROM behavior_table
                  WHERE behavior_run_id = ?
                  GROUP BY entity_id
                )
                SELECT
                  SUM(CASE WHEN active_days = 1 THEN 1 ELSE 0 END) AS one_time,
                  SUM(CASE WHEN active_days BETWEEN 2 AND 3 THEN 1 ELSE 0 END) AS repeat,
                  SUM(CASE WHEN active_days >= 4 THEN 1 ELSE 0 END) AS sustained,
                  COUNT(*) AS total
                FROM by_entity_day
                """,
                [int(run_id)],
            ).fetchone()
            total_entities = float(activity_rows[3] or 0)
            activity_pattern = {
                'one_time': int(activity_rows[0] or 0),
                'repeat': int(activity_rows[1] or 0),
                'sustained': int(activity_rows[2] or 0),
                'total': int(activity_rows[3] or 0),
            }
            if total_entities > 0:
                activity_pattern['one_time_pct'] = float(activity_pattern['one_time'] / total_entities * 100.0)
                activity_pattern['repeat_pct'] = float(activity_pattern['repeat'] / total_entities * 100.0)
                activity_pattern['sustained_pct'] = float(activity_pattern['sustained'] / total_entities * 100.0)
            else:
                activity_pattern['one_time_pct'] = 0.0
                activity_pattern['repeat_pct'] = 0.0
                activity_pattern['sustained_pct'] = 0.0
            activity_pattern['label'] = max(
                [('one_time', activity_pattern['one_time_pct']),
                 ('repeat', activity_pattern['repeat_pct']),
                 ('sustained', activity_pattern['sustained_pct'])],
                key=lambda x: x[1]
            )[0] if total_entities > 0 else 'none'

            entity_stats = conn.execute(
                """
                SELECT entity_id,
                       MAX(metric_value) AS maxv,
                       median(metric_value) AS medv
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY entity_id
                """,
                [int(run_id)],
            ).fetchall()
            ratios = []
            for _, maxv, medv in entity_stats:
                mv = float(maxv or 0.0)
                md = float(medv or 0.0)
                if md > 0:
                    ratios.append(mv / md)
            ratios_series = pd.Series(ratios)
            median_ratio = float(ratios_series.median()) if not ratios_series.empty else 0.0
            p90_ratio = float(ratios_series.quantile(0.9)) if not ratios_series.empty else 0.0
            spike_pct = float((ratios_series >= 5).mean() * 100.0) if not ratios_series.empty else 0.0
            entity_variability = {
                'median_ratio': median_ratio,
                'p90_ratio': p90_ratio,
                'spike_pct': spike_pct,
            }

            peaks_df = pd.DataFrame(entity_stats, columns=['entity_id', 'maxv', 'medv'])
            peaks_df['peak'] = peaks_df['maxv'].fillna(0.0).astype(float)
            peak_values = peaks_df['peak'].to_numpy()
            percentiles = [0.8, 0.85, 0.9, 0.92, 0.94, 0.95, 0.97, 0.98, 0.99]
            sensitivity = []
            if peak_values.size > 0:
                series = pd.Series(peak_values)
                for p in percentiles:
                    cutoff = float(series.quantile(p))
                    count = int((series >= cutoff).sum())
                    sensitivity.append({
                        'percentile': p,
                        'cutoff': cutoff,
                        'entity_count': count,
                        'entity_pct': float(count / len(series) * 100.0),
                    })
            sensitivity_preview = {
                'points': sensitivity,
                'total_entities': int(len(peak_values)),
            }

            warnings = []
            if zero_pct >= 70:
                warnings.append('too_many_zeros')
            if null_pct >= 5:
                warnings.append('high_null_rate')
            if activity_pattern.get('one_time_pct', 0) >= 70:
                warnings.append('too_many_single_observations')
            if total_entities < 50:
                warnings.append('low_entity_density')
            cov_delta = None
            diag_row = conn.execute(
                "SELECT coverage_delta_pct, ks_vs_prev FROM behavior_run_diagnostics WHERE behavior_run_id = ?",
                [int(run_id)],
            ).fetchone()
            if diag_row:
                cov_delta = float(diag_row[0]) if diag_row[0] is not None else None
            if cov_delta is not None and cov_delta <= -10:
                warnings.append('coverage_drop')

            heatmap = conn.execute(
                """
                WITH by_day AS (
                  SELECT
                    date_trunc('day', as_of_date) AS day,
                    SUM(ABS(metric_value)) AS day_mass
                  FROM behavior_table
                  WHERE behavior_run_id = ?
                  GROUP BY day
                ),
                ranked AS (
                  SELECT day, day_mass,
                         ROW_NUMBER() OVER (ORDER BY day_mass DESC) AS rn
                  FROM by_day
                )
                SELECT
                  (SELECT COUNT(*) FROM by_day) AS total_days,
                  (SELECT SUM(day_mass) FROM by_day) AS total_mass,
                  (SELECT SUM(day_mass) FROM ranked WHERE rn <= 3) AS top3_mass,
                  (SELECT SUM(day_mass) FROM ranked WHERE rn <= 10) AS top10_mass
                """,
                [int(run_id)],
            ).fetchone()
            top_days = conn.execute(
                """
                SELECT
                  strftime(date_trunc('day', as_of_date), '%Y-%m-%d') AS day,
                  SUM(ABS(metric_value)) AS total_value
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY day
                ORDER BY total_value DESC
                LIMIT 10
                """,
                [int(run_id)],
            ).fetchall()
            total_mass_hm = float(heatmap[1] or 0.0)
            peak_concentration = {
                'top3_mass_pct': float((heatmap[2] or 0.0) / total_mass_hm * 100.0) if total_mass_hm else 0.0,
                'top10_mass_pct': float((heatmap[3] or 0.0) / total_mass_hm * 100.0) if total_mass_hm else 0.0,
                'top_days': [{'day': d, 'total_value': float(v or 0.0)} for d, v in top_days],
            }

            composition = {}
            if universe_db_path:
                try:
                    u = self._get_universe(meta['universe_id'], universe_db_path)
                    snapshot_id = u.get('snapshot_id')
                    if snapshot_id:
                        domain = 'customers' if entity_level == 'customer' else 'accounts'
                        path = self._resolve_snapshot_domain_path(snapshot_id, domain)
                        if path.exists():
                            conn2 = duckdb.connect()
                            try:
                                entity_col = 'customer_id' if entity_level == 'customer' else 'account_id'
                                conn2.register('entity_peaks', peaks_df[['entity_id', 'peak']])
                                cols = conn2.execute(
                                    f"DESCRIBE SELECT * FROM read_parquet('{str(path)}')"
                                ).fetchall()
                                col_names = [c[0] for c in cols]
                                candidates = [
                                    'customer_type',
                                    'segment',
                                    'risk_category',
                                    'risk_tier',
                                    'customer_segment',
                                    'risk_segment',
                                    'account_type',
                                    'industry',
                                    'customer_industry',
                                ]
                                for col in candidates:
                                    if col in col_names:
                                        safe_col = self._safe_ident(col)
                                        safe_id = self._safe_ident(entity_col)
                                        rows = conn2.execute(
                                            f"""
                                            SELECT {safe_col} AS key,
                                                   COUNT(*) AS entity_count,
                                                   SUM(entity_peaks.peak) AS total_peak
                                            FROM entity_peaks
                                            JOIN read_parquet('{str(path)}') a
                                              ON CAST(a.{safe_id} AS VARCHAR) = entity_peaks.entity_id
                                            GROUP BY key
                                            ORDER BY total_peak DESC NULLS LAST
                                            LIMIT 10
                                            """
                                        ).fetchall()
                                        total_entities_comp = sum([int(r[1] or 0) for r in rows]) or 1
                                        total_peak_comp = sum([float(r[2] or 0.0) for r in rows]) or 1.0
                                        composition[col] = [
                                            {
                                                'key': r[0],
                                                'entity_count': int(r[1] or 0),
                                                'entity_pct': float((r[1] or 0) / total_entities_comp * 100.0),
                                                'mass_pct': float((r[2] or 0.0) / total_peak_comp * 100.0),
                                            }
                                            for r in rows
                                        ]
                            finally:
                                conn2.close()
                except Exception:
                    composition = {}

            prev_id = compare_run_id if compare_run_id is not None else self._get_prev_run_id(conn, run_id)
            run_drift = {
                'prev_run_id': int(prev_id) if prev_id else None,
                'ks_vs_prev': None,
                'delta_gini': None,
                'delta_p95': None,
                'delta_p99': None,
                'delta_zero_pct': None,
                'delta_top1_mass_pct': None,
            }
            if prev_id:
                prev_dist = self._get_distribution_stats(conn, int(prev_id))
                run_drift['delta_gini'] = float(gini - float(prev_dist.get('gini') or 0.0))
                run_drift['delta_p95'] = float(dist.get('p95') or 0.0) - float(prev_dist.get('p95') or 0.0)
                run_drift['delta_p99'] = float(dist.get('p99') or 0.0) - float(prev_dist.get('p99') or 0.0)
                run_drift['delta_zero_pct'] = float(dist.get('zero_pct') or 0.0) - float(prev_dist.get('zero_pct') or 0.0)
                prev_tail = (prev_dist.get('tail') or {}).get('top1_mass_pct') or 0.0
                run_drift['delta_top1_mass_pct'] = float(top1_mass_pct - prev_tail)
                ks_row = conn.execute(
                    "SELECT ks_vs_prev FROM behavior_run_diagnostics WHERE behavior_run_id = ?",
                    [int(run_id)],
                ).fetchone()
                if ks_row and ks_row[0] is not None:
                    run_drift['ks_vs_prev'] = float(ks_row[0])

            insights = [
                {'type': 'distribution', 'text': distribution_text},
                {'type': 'dominance', 'text': f"Top 10 entities control {dominance['top10_pct']:.1f}% of total signal mass."},
                {'type': 'stability', 'text': f"Signal stability is {stability_label} (daily CV {stability['day_cv']:.2f})."},
                {'type': 'activity', 'text': f"Activity pattern is {activity_pattern.get('label')} across entities."},
            ]
            if warnings:
                insights.append({'type': 'warnings', 'text': f"Warnings flagged: {', '.join(warnings)}."})

            payload = {
                'behavior_run_id': int(run_id),
                'entity_level': entity_level,
                'metric_name': metric_name,
                'distribution_nature': {
                    'label': distribution_label,
                    'text': distribution_text,
                    'stats': dist,
                },
                'dominance': dominance,
                'stability': stability,
                'activity_pattern': activity_pattern,
                'entity_variability': entity_variability,
                'sensitivity': sensitivity_preview,
                'noise_warnings': warnings,
                'peak_concentration': peak_concentration,
                'population_composition': composition,
                'run_drift': run_drift,
                'insights': insights,
            }

            if compare_run_id is None:
                conn.execute(
                    "INSERT INTO behavior_chart_snapshots (behavior_run_id, chart_type, data_json) VALUES (?, 'signal_intelligence', ?)",
                    [int(run_id), json.dumps(payload)],
                )

            return payload
        finally:
            conn.close()

    def _audit_overlap(self, run_id: Optional[int], entity_id: Optional[str], action: str, created_by: str) -> None:
        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute(
                """
                INSERT INTO behavior_overlap_audit (behavior_run_id, entity_id, action, created_by)
                VALUES (?, ?, ?, ?)
                """,
                [
                    int(run_id) if run_id is not None else None,
                    str(entity_id) if entity_id is not None else None,
                    str(action),
                    str(created_by),
                ],
            )
        finally:
            conn.close()

    def _ensure_interaction_cache(self, run_id: int) -> Tuple[int, List[int]]:
        conn = duckdb.connect(str(self.db_path))
        try:
            row = conn.execute(
                """
                SELECT universe_id
                FROM behavior_runs
                WHERE behavior_run_id = ?
                """,
                [int(run_id)],
            ).fetchone()
            if not row:
                raise ValueError("Behavior run not found")
            universe_id = int(row[0])
            runs = conn.execute(
                """
                SELECT behavior_run_id
                FROM behavior_runs
                WHERE universe_id = ?
                ORDER BY behavior_run_id
                """,
                [universe_id],
            ).fetchall()
            run_ids = [int(r[0]) for r in runs]
            for rid in run_ids:
                conn.execute("DELETE FROM behavior_run_entities WHERE behavior_run_id = ?", [rid])
                conn.execute(
                    """
                    INSERT INTO behavior_run_entities
                    SELECT ?, entity_id
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                    GROUP BY entity_id
                    """,
                    [rid, rid],
                )
                conn.execute("DELETE FROM behavior_run_period_entities WHERE behavior_run_id = ?", [rid])
                conn.execute(
                    """
                    INSERT INTO behavior_run_period_entities
                    SELECT ?, date_trunc('month', as_of_date) AS period, entity_id
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                    GROUP BY period, entity_id
                    """,
                    [rid, rid],
                )
                total_entities = conn.execute(
                    "SELECT COUNT(*) FROM behavior_run_entities WHERE behavior_run_id = ?",
                    [rid],
                ).fetchone()[0]
                conn.execute("DELETE FROM behavior_run_entity_stats WHERE behavior_run_id = ?", [rid])
                conn.execute(
                    """
                    INSERT INTO behavior_run_entity_stats (behavior_run_id, total_entities)
                    VALUES (?, ?)
                    """,
                    [rid, int(total_entities or 0)],
                )
                rows = conn.execute(
                    """
                    SELECT
                      entity_id,
                      MIN(as_of_date) AS first_seen,
                      MAX(as_of_date) AS last_seen,
                      COUNT(DISTINCT date_trunc('day', as_of_date)) AS active_days,
                      list(DISTINCT strftime(date_trunc('day', as_of_date), '%Y-%m-%d')) AS days
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                    GROUP BY entity_id
                    """,
                    [rid],
                ).fetchall()
                conn.execute("DELETE FROM behavior_entity_footprint WHERE behavior_run_id = ?", [rid])
                for r in rows:
                    days = r[4] if isinstance(r[4], list) else []
                    conn.execute(
                        """
                        INSERT INTO behavior_entity_footprint (
                          entity_id, behavior_run_id, first_seen, last_seen, active_days, activity_dates_json
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        [
                            str(r[0]),
                            rid,
                            r[1],
                            r[2],
                            int(r[3] or 0),
                            json.dumps(days),
                        ],
                    )
            conn.execute(
                """
                DELETE FROM behavior_overlap_cache
                WHERE run_a IN ({runs}) OR run_b IN ({runs})
                """.format(runs=",".join([str(r) for r in run_ids]))
            )
            for i, a in enumerate(run_ids):
                total_a = conn.execute(
                    "SELECT total_entities FROM behavior_run_entity_stats WHERE behavior_run_id = ?",
                    [a],
                ).fetchone()
                total_a_val = int(total_a[0] or 0) if total_a else 0
                for b in run_ids[i + 1:]:
                    total_b = conn.execute(
                        "SELECT total_entities FROM behavior_run_entity_stats WHERE behavior_run_id = ?",
                        [b],
                    ).fetchone()
                    total_b_val = int(total_b[0] or 0) if total_b else 0
                    shared = conn.execute(
                        """
                        SELECT COUNT(*) FROM (
                          SELECT a.entity_id
                          FROM behavior_run_entities a
                          JOIN behavior_run_entities b
                            ON a.entity_id = b.entity_id
                          WHERE a.behavior_run_id = ? AND b.behavior_run_id = ?
                          GROUP BY a.entity_id
                        )
                        """,
                        [a, b],
                    ).fetchone()[0]
                    shared_periods = conn.execute(
                        """
                        SELECT COUNT(*) FROM (
                          SELECT a.entity_id, a.period
                          FROM behavior_run_period_entities a
                          JOIN behavior_run_period_entities b
                            ON a.entity_id = b.entity_id AND a.period = b.period
                          WHERE a.behavior_run_id = ? AND b.behavior_run_id = ?
                          GROUP BY a.entity_id, a.period
                        )
                        """,
                        [a, b],
                    ).fetchone()[0]
                    pct_a = float(shared / total_a_val * 100.0) if total_a_val else 0.0
                    pct_b = float(shared / total_b_val * 100.0) if total_b_val else 0.0
                    conn.execute(
                        """
                        INSERT INTO behavior_overlap_cache (
                          run_a, run_b, shared_entities, shared_pct_a, shared_pct_b, shared_periods
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        [a, b, int(shared or 0), pct_a, pct_b, int(shared_periods or 0)],
                    )
            return universe_id, run_ids
        finally:
            conn.close()

    def get_overlap_overview(self, run_id: int, created_by: str = "user") -> Dict:
        universe_id, run_ids = self._ensure_interaction_cache(run_id)
        conn = duckdb.connect(str(self.db_path))
        try:
            meta_rows = conn.execute(
                """
                SELECT behavior_run_id, config_json
                FROM behavior_runs
                WHERE behavior_run_id IN ({runs})
                """.format(runs=",".join([str(r) for r in run_ids]))
            ).fetchall()
            metric_map = {}
            for rid, cfg in meta_rows:
                try:
                    c = json.loads(cfg) if cfg else {}
                    metric = (c.get('metrics') or [{}])[0] if c.get('metrics') else {}
                    metric_map[int(rid)] = metric.get('name')
                except Exception:
                    metric_map[int(rid)] = None
            rows = conn.execute(
                """
                SELECT run_a, run_b, shared_entities, shared_pct_a, shared_pct_b, shared_periods
                FROM behavior_overlap_cache
                WHERE run_a = ? OR run_b = ?
                ORDER BY shared_entities DESC
                """,
                [int(run_id), int(run_id)],
            ).fetchall()
            overview = []
            for r in rows:
                a, b, shared, pct_a, pct_b, shared_periods = r
                other = b if a == run_id else a
                overview.append({
                    'other_run_id': int(other),
                    'other_metric_name': metric_map.get(int(other)),
                    'shared_entities': int(shared or 0),
                    'shared_pct_this': float(pct_a if a == run_id else pct_b),
                    'shared_pct_other': float(pct_b if a == run_id else pct_a),
                    'shared_periods': int(shared_periods or 0),
                })
            self._audit_overlap(run_id, None, "overview", created_by)
            return {
                'behavior_run_id': int(run_id),
                'universe_id': int(universe_id),
                'overview': overview,
            }
        finally:
            conn.close()

    def get_overlap_matrix(self, run_id: int, created_by: str = "user") -> Dict:
        universe_id, run_ids = self._ensure_interaction_cache(run_id)
        conn = duckdb.connect(str(self.db_path))
        try:
            meta_rows = conn.execute(
                """
                SELECT behavior_run_id, config_json
                FROM behavior_runs
                WHERE behavior_run_id IN ({runs})
                ORDER BY behavior_run_id
                """.format(runs=",".join([str(r) for r in run_ids]))
            ).fetchall()
            runs = []
            for rid, cfg in meta_rows:
                try:
                    c = json.loads(cfg) if cfg else {}
                    metric = (c.get('metrics') or [{}])[0] if c.get('metrics') else {}
                    name = metric.get('name')
                except Exception:
                    name = None
                runs.append({'run_id': int(rid), 'metric_name': name})
            pairs = conn.execute(
                """
                SELECT run_a, run_b, shared_entities, shared_pct_a, shared_pct_b
                FROM behavior_overlap_cache
                WHERE run_a IN ({runs}) OR run_b IN ({runs})
                """.format(runs=",".join([str(r) for r in run_ids]))
            ).fetchall()
            matrix = []
            for a, b, shared, pct_a, pct_b in pairs:
                matrix.append({
                    'run_a': int(a),
                    'run_b': int(b),
                    'shared_entities': int(shared or 0),
                    'shared_pct_a': float(pct_a or 0.0),
                    'shared_pct_b': float(pct_b or 0.0),
                })
            self._audit_overlap(run_id, None, "matrix", created_by)
            return {
                'behavior_run_id': int(run_id),
                'universe_id': int(universe_id),
                'runs': runs,
                'matrix': matrix,
            }
        finally:
            conn.close()

    def get_population_interaction_stats(self, run_id: int, created_by: str = "user") -> Dict:
        universe_id, run_ids = self._ensure_interaction_cache(run_id)
        conn = duckdb.connect(str(self.db_path))
        try:
            rows = conn.execute(
                """
                WITH base AS (
                  SELECT entity_id
                  FROM behavior_run_entities
                  WHERE behavior_run_id = ?
                ),
                counts AS (
                  SELECT r.entity_id, COUNT(DISTINCT r.behavior_run_id) AS run_count
                  FROM behavior_run_entities r
                  JOIN base b ON b.entity_id = r.entity_id
                  GROUP BY r.entity_id
                )
                SELECT
                  SUM(CASE WHEN run_count = 1 THEN 1 ELSE 0 END) AS only_here,
                  SUM(CASE WHEN run_count = 2 THEN 1 ELSE 0 END) AS in_two,
                  SUM(CASE WHEN run_count >= 3 THEN 1 ELSE 0 END) AS in_three_plus,
                  COUNT(*) AS total
                FROM counts
                """,
                [int(run_id)],
            ).fetchone()
            self._audit_overlap(run_id, None, "population_stats", created_by)
            return {
                'behavior_run_id': int(run_id),
                'universe_id': int(universe_id),
                'only_here': int(rows[0] or 0),
                'in_two': int(rows[1] or 0),
                'in_three_plus': int(rows[2] or 0),
                'total': int(rows[3] or 0),
            }
        finally:
            conn.close()

    def get_recurring_pairs(self, run_id: int, limit: int = 10, created_by: str = "user") -> Dict:
        universe_id, run_ids = self._ensure_interaction_cache(run_id)
        conn = duckdb.connect(str(self.db_path))
        try:
            meta_rows = conn.execute(
                """
                SELECT behavior_run_id, config_json
                FROM behavior_runs
                WHERE behavior_run_id IN ({runs})
                """.format(runs=",".join([str(r) for r in run_ids]))
            ).fetchall()
            metric_map = {}
            for rid, cfg in meta_rows:
                try:
                    c = json.loads(cfg) if cfg else {}
                    metric = (c.get('metrics') or [{}])[0] if c.get('metrics') else {}
                    metric_map[int(rid)] = metric.get('name')
                except Exception:
                    metric_map[int(rid)] = None
            rows = conn.execute(
                """
                SELECT run_a, run_b, shared_entities, shared_pct_a, shared_pct_b
                FROM behavior_overlap_cache
                ORDER BY shared_entities DESC
                LIMIT ?
                """,
                [int(limit)],
            ).fetchall()
            pairs = []
            for a, b, shared, pct_a, pct_b in rows:
                pairs.append({
                    'run_a': int(a),
                    'run_b': int(b),
                    'metric_a': metric_map.get(int(a)),
                    'metric_b': metric_map.get(int(b)),
                    'shared_entities': int(shared or 0),
                    'shared_pct_a': float(pct_a or 0.0),
                    'shared_pct_b': float(pct_b or 0.0),
                })
            self._audit_overlap(run_id, None, "recurring_pairs", created_by)
            return {
                'behavior_run_id': int(run_id),
                'universe_id': int(universe_id),
                'pairs': pairs,
            }
        finally:
            conn.close()

    def get_entity_footprint(self, run_id: int, entity_id: str, created_by: str = "user") -> Dict:
        universe_id, run_ids = self._ensure_interaction_cache(run_id)
        conn = duckdb.connect(str(self.db_path))
        try:
            rows = conn.execute(
                """
                SELECT behavior_run_id, first_seen, last_seen, active_days, activity_dates_json
                FROM behavior_entity_footprint
                WHERE entity_id = ? AND behavior_run_id IN ({runs})
                """.format(runs=",".join([str(r) for r in run_ids])),
                [str(entity_id)],
            ).fetchall()
            meta_rows = conn.execute(
                """
                SELECT behavior_run_id, config_json
                FROM behavior_runs
                WHERE behavior_run_id IN ({runs})
                """.format(runs=",".join([str(r) for r in run_ids]))
            ).fetchall()
            metric_map = {}
            window_map = {}
            for rid, cfg in meta_rows:
                try:
                    c = json.loads(cfg) if cfg else {}
                    metric = (c.get('metrics') or [{}])[0] if c.get('metrics') else {}
                    metric_map[int(rid)] = metric.get('name')
                    window_map[int(rid)] = metric.get('window')
                except Exception:
                    metric_map[int(rid)] = None
                    window_map[int(rid)] = None
            footprint = []
            for r in rows:
                days = []
                if r[4]:
                    try:
                        days = json.loads(r[4])
                    except Exception:
                        days = []
                footprint.append({
                    'behavior_run_id': int(r[0]),
                    'metric_name': metric_map.get(int(r[0])),
                    'window': window_map.get(int(r[0])),
                    'first_seen': str(r[1]) if r[1] is not None else None,
                    'last_seen': str(r[2]) if r[2] is not None else None,
                    'active_days': int(r[3] or 0),
                    'activity_dates': days,
                })
            self._audit_overlap(run_id, entity_id, "entity_footprint", created_by)
            return {
                'behavior_run_id': int(run_id),
                'entity_id': str(entity_id),
                'universe_id': int(universe_id),
                'footprint': footprint,
            }
        finally:
            conn.close()

    def _ensure_evidence(self, run_id: int, universe_db_path: Optional[Path] = None):
        conn = duckdb.connect(str(self.db_path))
        try:
            meta = conn.execute("""
                SELECT universe_id, config_json, entity_level, total_rows, total_entities
                FROM behavior_runs
                WHERE behavior_run_id = ?
            """, [run_id]).fetchone()
            if not meta:
                raise ValueError("Behavior run not found")
            universe_id = int(meta[0])
            config = json.loads(meta[1]) if meta[1] else {}
            entity_level = meta[2]
            total_rows = int(meta[3] or 0)
            total_entities = int(meta[4] or 0)

            has_diag = conn.execute(
                "SELECT 1 FROM behavior_run_diagnostics WHERE behavior_run_id = ? LIMIT 1",
                [run_id]
            ).fetchone()

            if not has_diag:
                metric_name = None
                window_spec = None
                if isinstance(config, dict):
                    metric = (config.get('metrics') or [{}])[0] if config.get('metrics') else {}
                    metric_name = metric.get('name')
                    window_spec = metric.get('window')

                totals = conn.execute("""
                    SELECT
                      COUNT(*) AS n,
                      SUM(CASE WHEN metric_value IS NULL THEN 1 ELSE 0 END) AS nulls,
                      SUM(CASE WHEN metric_value = 0 THEN 1 ELSE 0 END) AS zeros,
                      SUM(CASE WHEN metric_value < 0 THEN 1 ELSE 0 END) AS negatives
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                """, [run_id]).fetchone()

                n = int(totals[0] or 0)
                null_pct = float((totals[1] or 0) / n * 100.0) if n else 0.0
                zero_pct = float((totals[2] or 0) / n * 100.0) if n else 0.0
                negative_pct = float((totals[3] or 0) / n * 100.0) if n else 0.0

                gini_vals = conn.execute("""
                    SELECT MAX(ABS(metric_value)) AS v
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                    GROUP BY entity_id
                """, [run_id]).fetchall()
                gini = self._gini([float(r[0] or 0.0) for r in gini_vals])

                prev_row = conn.execute("""
                    SELECT behavior_run_id, config_json
                    FROM behavior_runs
                    WHERE universe_id = ? AND behavior_run_id < ?
                    ORDER BY behavior_run_id DESC
                    LIMIT 25
                """, [universe_id, run_id]).fetchall()
                prev_run_id = None
                for rid, cfg in prev_row:
                    try:
                        c = json.loads(cfg) if cfg else {}
                        m = (c.get('metrics') or [{}])[0] if isinstance(c, dict) else {}
                        if metric_name and m.get('name') == metric_name:
                            prev_run_id = int(rid)
                            break
                    except Exception:
                        continue

                ks_vs_prev = None
                coverage_delta_pct = None
                if prev_run_id:
                    bins = 60
                    mm = conn.execute("""
                        SELECT MIN(metric_value), MAX(metric_value)
                        FROM behavior_table
                        WHERE behavior_run_id IN (?, ?)
                    """, [run_id, prev_run_id]).fetchone()
                    minv = float(mm[0] or 0.0)
                    maxv = float(mm[1] or 0.0)
                    if maxv == minv:
                        ks_vs_prev = 0.0
                    else:
                        rows_a = conn.execute(f"""
                            SELECT
                              CAST(FLOOR(((metric_value - {minv}) / NULLIF({maxv}-{minv},0)) * {bins}) AS INTEGER) AS bucket,
                              COUNT(*) AS count
                            FROM behavior_table
                            WHERE behavior_run_id = ?
                            GROUP BY bucket
                        """, [run_id]).fetchall()
                        rows_b = conn.execute(f"""
                            SELECT
                              CAST(FLOOR(((metric_value - {minv}) / NULLIF({maxv}-{minv},0)) * {bins}) AS INTEGER) AS bucket,
                              COUNT(*) AS count
                            FROM behavior_table
                            WHERE behavior_run_id = ?
                            GROUP BY bucket
                        """, [prev_run_id]).fetchall()
                        hist_a = {int(b if b is not None else 0): int(c) for b, c in rows_a}
                        hist_b = {int(b if b is not None else 0): int(c) for b, c in rows_b}
                        ks_vs_prev = self._ks_from_histograms(hist_a, hist_b)

                    cov = conn.execute("""
                        WITH by_entity_day AS (
                          SELECT
                            entity_id,
                            COUNT(DISTINCT CASE WHEN metric_value != 0 THEN date_trunc('day', as_of_date) END) AS active_days
                          FROM behavior_table
                          WHERE behavior_run_id = ?
                          GROUP BY entity_id
                        )
                        SELECT
                          SUM(CASE WHEN active_days > 0 THEN 1 ELSE 0 END) AS nz_entities,
                          COUNT(*) AS total_entities
                        FROM by_entity_day
                    """, [run_id]).fetchone()
                    prev_cov = conn.execute("""
                        WITH by_entity_day AS (
                          SELECT
                            entity_id,
                            COUNT(DISTINCT CASE WHEN metric_value != 0 THEN date_trunc('day', as_of_date) END) AS active_days
                          FROM behavior_table
                          WHERE behavior_run_id = ?
                          GROUP BY entity_id
                        )
                        SELECT
                          SUM(CASE WHEN active_days > 0 THEN 1 ELSE 0 END) AS nz_entities,
                          COUNT(*) AS total_entities
                        FROM by_entity_day
                    """, [prev_run_id]).fetchone()
                    cov_pct = (float(cov[0] or 0) / float(cov[1] or 1)) * 100.0
                    prev_cov_pct = (float(prev_cov[0] or 0) / float(prev_cov[1] or 1)) * 100.0
                    coverage_delta_pct = cov_pct - prev_cov_pct

                temporal = conn.execute("""
                    WITH by_day AS (
                      SELECT
                        date_trunc('day', as_of_date) AS day,
                        SUM(CASE WHEN metric_value != 0 THEN 1 ELSE 0 END) AS non_zero_obs
                      FROM behavior_table
                      WHERE behavior_run_id = ?
                      GROUP BY day
                    )
                    SELECT
                      SUM(CASE WHEN non_zero_obs > 0 THEN 1 ELSE 0 END) AS active_days,
                      COUNT(*) AS total_days
                    FROM by_day
                """, [run_id]).fetchone()
                active_days = int(temporal[0] or 0)
                total_days = int(temporal[1] or 0)
                temporal_spread = (active_days / total_days) if total_days else 0.0

                cov2 = conn.execute("""
                    WITH by_entity_day AS (
                      SELECT
                        entity_id,
                        COUNT(DISTINCT CASE WHEN metric_value != 0 THEN date_trunc('day', as_of_date) END) AS active_days
                      FROM behavior_table
                      WHERE behavior_run_id = ?
                      GROUP BY entity_id
                    )
                    SELECT
                      SUM(CASE WHEN active_days > 0 THEN 1 ELSE 0 END) AS nz_entities,
                      COUNT(*) AS total_entities
                    FROM by_entity_day
                """, [run_id]).fetchone()
                cov_ratio = (float(cov2[0] or 0) / float(cov2[1] or 1))

                stability_score = (1.0 - float(ks_vs_prev)) if ks_vs_prev is not None else 0.5
                reusability_score = 100.0 * (0.5 * cov_ratio + 0.3 * temporal_spread + 0.2 * max(0.0, min(1.0, stability_score)))
                if reusability_score >= 70:
                    reusability_label = "HIGH"
                elif reusability_score >= 40:
                    reusability_label = "MEDIUM"
                else:
                    reusability_label = "LOW"

                conn.execute("""
                    INSERT INTO behavior_run_diagnostics (
                      behavior_run_id, universe_id, entity_level, metric_name, window_spec,
                      total_rows, total_entities, null_pct, zero_pct, negative_pct,
                      gini, ks_vs_prev, coverage_delta_pct, reusability_score, reusability_label
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    run_id, universe_id, entity_level, metric_name, window_spec,
                    total_rows, total_entities, null_pct, zero_pct, negative_pct,
                    gini, ks_vs_prev, coverage_delta_pct, reusability_score, reusability_label
                ])

            has_snapshot = conn.execute(
                "SELECT 1 FROM behavior_chart_snapshots WHERE behavior_run_id = ? LIMIT 1",
                [run_id]
            ).fetchone()
            if not has_snapshot:
                dist = conn.execute("""
                    SELECT
                      COUNT(*) AS n,
                      MIN(metric_value) AS minv,
                      MAX(metric_value) AS maxv,
                      AVG(metric_value) AS meanv,
                      median(metric_value) AS medianv,
                      quantile(metric_value, 0.9) AS p90,
                      quantile(metric_value, 0.95) AS p95,
                      quantile(metric_value, 0.99) AS p99,
                      SUM(CASE WHEN metric_value = 0 THEN 1 ELSE 0 END) AS zeros
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                """, [run_id]).fetchone()

                total_mass = conn.execute("""
                    SELECT SUM(ABS(metric_value)) AS mass
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                """, [run_id]).fetchone()
                total_mass = float(total_mass[0] or 0.0)
                tail = {'top1_mass_pct': None, 'top5_mass_pct': None}
                if total_mass > 0:
                    q99 = conn.execute("SELECT quantile(metric_value, 0.99) FROM behavior_table WHERE behavior_run_id = ?", [run_id]).fetchone()[0]
                    q95 = conn.execute("SELECT quantile(metric_value, 0.95) FROM behavior_table WHERE behavior_run_id = ?", [run_id]).fetchone()[0]
                    top1 = conn.execute("""
                        SELECT SUM(ABS(metric_value)) AS mass
                        FROM behavior_table
                        WHERE behavior_run_id = ? AND metric_value >= ?
                    """, [run_id, q99]).fetchone()[0]
                    top5 = conn.execute("""
                        SELECT SUM(ABS(metric_value)) AS mass
                        FROM behavior_table
                        WHERE behavior_run_id = ? AND metric_value >= ?
                    """, [run_id, q95]).fetchone()[0]
                    tail = {
                        'top1_mass_pct': float((top1 or 0.0) / total_mass * 100.0),
                        'top5_mass_pct': float((top5 or 0.0) / total_mass * 100.0)
                    }

                diag = conn.execute(
                    "SELECT gini, ks_vs_prev, coverage_delta_pct, reusability_score, reusability_label FROM behavior_run_diagnostics WHERE behavior_run_id = ?",
                    [run_id]
                ).fetchone()

                dist_stats = {
                    'count': int(dist[0] or 0),
                    'min': float(dist[1] or 0.0),
                    'max': float(dist[2] or 0.0),
                    'mean': float(dist[3] or 0.0),
                    'median': float(dist[4] or 0.0),
                    'p90': float(dist[5] or 0.0),
                    'p95': float(dist[6] or 0.0),
                    'p99': float(dist[7] or 0.0),
                    'zero_pct': (float(dist[8] or 0.0) / float(dist[0] or 1)) * 100.0 if dist[0] else 0.0,
                    'tail': tail,
                    'gini': float(diag[0] or 0.0) if diag else 0.0,
                    'ks_vs_prev': float(diag[1]) if diag and diag[1] is not None else None
                }
                conn.execute(
                    "INSERT INTO behavior_chart_snapshots (behavior_run_id, chart_type, data_json) VALUES (?, 'distribution_stats', ?)",
                    [run_id, json.dumps(dist_stats)]
                )

                cov_stats = conn.execute("""
                    WITH by_entity_day AS (
                      SELECT
                        entity_id,
                        COUNT(DISTINCT CASE WHEN metric_value != 0 THEN date_trunc('day', as_of_date) END) AS active_days
                      FROM behavior_table
                      WHERE behavior_run_id = ?
                      GROUP BY entity_id
                    )
                    SELECT
                      SUM(CASE WHEN active_days > 0 THEN 1 ELSE 0 END) AS nz_entities,
                      SUM(CASE WHEN active_days = 1 THEN 1 ELSE 0 END) AS single_obs,
                      SUM(CASE WHEN active_days >= 2 THEN 1 ELSE 0 END) AS repeated_obs,
                      COUNT(*) AS total_entities
                    FROM by_entity_day
                """, [run_id]).fetchone()
                coverage_stats = {
                    'nz_entities': int(cov_stats[0] or 0),
                    'single_obs': int(cov_stats[1] or 0),
                    'repeated_obs': int(cov_stats[2] or 0),
                    'total_entities': int(cov_stats[3] or 0)
                }
                conn.execute(
                    "INSERT INTO behavior_chart_snapshots (behavior_run_id, chart_type, data_json) VALUES (?, 'coverage_stats', ?)",
                    [run_id, json.dumps(coverage_stats)]
                )

                heatmap = conn.execute("""
                    WITH by_day AS (
                      SELECT
                        date_trunc('day', as_of_date) AS day,
                        SUM(ABS(metric_value)) AS day_mass,
                        SUM(CASE WHEN strftime('%w', as_of_date) IN ('0','6') THEN ABS(metric_value) ELSE 0 END) AS weekend_mass,
                        SUM(CASE WHEN strftime('%w', as_of_date) NOT IN ('0','6') THEN ABS(metric_value) ELSE 0 END) AS weekday_mass
                      FROM behavior_table
                      WHERE behavior_run_id = ?
                      GROUP BY day
                    ),
                    ranked AS (
                      SELECT day, day_mass,
                             ROW_NUMBER() OVER (ORDER BY day_mass DESC) AS rn
                      FROM by_day
                    )
                    SELECT
                      (SELECT COUNT(*) FROM by_day) AS total_days,
                      (SELECT SUM(day_mass) FROM by_day) AS total_mass,
                      (SELECT SUM(day_mass) FROM ranked WHERE rn <= 3) AS top3_mass,
                      (SELECT SUM(day_mass) FROM ranked WHERE rn <= 10) AS top10_mass,
                      (SELECT SUM(weekday_mass) FROM by_day) AS weekday_mass,
                      (SELECT SUM(weekend_mass) FROM by_day) AS weekend_mass
                """, [run_id]).fetchone()
                top_days = conn.execute("""
                    SELECT
                      strftime(date_trunc('day', as_of_date), '%Y-%m-%d') AS day,
                      SUM(ABS(metric_value)) AS total_value
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                    GROUP BY day
                    ORDER BY total_value DESC
                    LIMIT 10
                """, [run_id]).fetchall()
                total_days = int(heatmap[0] or 0)
                hm_total_mass = float(heatmap[1] or 0.0)
                heatmap_stats = {
                    'total_days': total_days,
                    'total_mass': hm_total_mass,
                    'top3_mass_pct': float((heatmap[2] or 0.0) / hm_total_mass * 100.0) if hm_total_mass else None,
                    'top10_mass_pct': float((heatmap[3] or 0.0) / hm_total_mass * 100.0) if hm_total_mass else None,
                    'top_days': [{'day': d, 'total_value': float(v or 0.0)} for d, v in top_days],
                    'weekday_vs_weekend': {
                        'weekday_mass': float(heatmap[4] or 0.0),
                        'weekend_mass': float(heatmap[5] or 0.0)
                    }
                }
                conn.execute(
                    "INSERT INTO behavior_chart_snapshots (behavior_run_id, chart_type, data_json) VALUES (?, 'heatmap_stats', ?)",
                    [run_id, json.dumps(heatmap_stats)]
                )

            has_insight = conn.execute(
                "SELECT 1 FROM behavior_run_insights WHERE behavior_run_id = ? LIMIT 1",
                [run_id]
            ).fetchone()
            if not has_insight:
                snap = conn.execute("""
                    SELECT chart_type, data_json
                    FROM behavior_chart_snapshots
                    WHERE behavior_run_id = ?
                """, [run_id]).fetchall()
                snap_map = {t: json.loads(j) for t, j in snap}
                dist_stats = snap_map.get('distribution_stats') or {}
                cov_stats = snap_map.get('coverage_stats') or {}
                hm_stats = snap_map.get('heatmap_stats') or {}

                stability_note = None
                top1 = (dist_stats.get('tail') or {}).get('top1_mass_pct')
                if top1 is None:
                    stability_note = "Distribution summary is unavailable for this run."
                elif top1 >= 50:
                    stability_note = "This metric shows a heavy right tail, indicating few entities dominate volume."
                else:
                    stability_note = "This metric is not strongly concentrated in the extreme tail."

                insights = [
                    ('distribution', stability_note),
                ]

                total_entities = float(cov_stats.get('total_entities') or 0)
                single_obs = float(cov_stats.get('single_obs') or 0)
                if total_entities > 0:
                    single_pct = (single_obs / total_entities) * 100.0
                    if single_pct >= 70:
                        insights.append((
                            'coverage',
                            "Most entities exhibit activity on a single date. This metric captures point-in-time behaviour more than sustained activity."
                        ))
                    else:
                        insights.append((
                            'coverage',
                            "A meaningful share of entities show activity across multiple dates, suggesting sustained behaviour patterns."
                        ))

                top3_pct = hm_stats.get('top3_mass_pct')
                if top3_pct is not None:
                    insights.append((
                        'time_density',
                        f"Activity concentration: {top3_pct:.2f}% of total volume is concentrated in the top 3 days."
                    ))

                if universe_db_path:
                    try:
                        u = self._get_universe(universe_id, universe_db_path)
                        cfg = config if isinstance(config, dict) else {}
                        metric = (cfg.get('metrics') or [{}])[0] if cfg.get('metrics') else {}
                        lineage = (
                            f"This behaviour was computed on universe {u.get('universe_name')} (ID {universe_id}) from snapshot {u.get('snapshot_id')}. "
                            f"Transactions were grouped by {cfg.get('entity_level', '').upper()} and ordered by {cfg.get('time_col')}. "
                            f"A rolling window of {metric.get('window')} was applied. "
                            f"Metric {metric.get('name')} represents the rolling {metric.get('type')}({metric.get('column')})."
                        )
                        insights.append(('lineage', lineage))
                    except Exception:
                        pass

                for t, text in insights:
                    conn.execute(
                        "INSERT INTO behavior_run_insights (behavior_run_id, insight_type, insight_text) VALUES (?, ?, ?)",
                        [run_id, t, text]
                    )
        finally:
            conn.close()

    def _compute_metrics(self, df: pd.DataFrame, config: Dict) -> pd.DataFrame:
        entity = config['entity_id_col']
        time_col = config['time_col']
        metrics: List[Dict] = config['metrics']

        df = df.copy()
        df[time_col] = pd.to_datetime(df[time_col])
        df = df.sort_values([entity, time_col])

        frames = []
        for m in metrics:
            mtype = m['type']
            col = m['column']
            window = m['window']
            name = m['name']

            # Set datetime as index for rolling
            df_indexed = df.set_index(time_col)
            
            # Apply rolling per entity
            if mtype == 'SUM':
                values = df_indexed.groupby(entity)[col].rolling(window).sum()
            elif mtype == 'COUNT':
                values = df_indexed.groupby(entity)[col].rolling(window).count()
            elif mtype == 'MAX':
                values = df_indexed.groupby(entity)[col].rolling(window).max()
            else:
                raise ValueError(f"Unsupported metric type: {mtype}")
            
            # Reset index to get datetime back as column
            values = values.reset_index()
            
            frames.append(pd.DataFrame({
                'entity_id': values[entity].values,
                'as_of_date': values[time_col].values,
                'metric_name': name,
                'metric_value': values[col].values,
                'metric_type': mtype,
                'window': window
            }))

        return pd.concat(frames, ignore_index=True)

    def compare_runs(self, run_a: int, run_b: int, agg: str = 'max', bins: int = 30) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        try:
            meta = conn.execute("""
                SELECT behavior_run_id, universe_id, entity_level FROM behavior_runs
                WHERE behavior_run_id IN (?, ?)
                ORDER BY behavior_run_id
            """, [run_a, run_b]).fetchall()
            if len(meta) != 2:
                raise ValueError("Both runs must exist")
            ua = meta[0][1]; ub = meta[1][1]
            ea = meta[0][2]; eb = meta[1][2]
            same_universe = ua == ub
            same_entity = ea == eb
            if not (same_universe and same_entity):
                return {
                    'allowed': False,
                    'same_universe': same_universe,
                    'same_entity_level': same_entity,
                    'explain': "Runs differ in universe or entity level; comparison disabled."
                }
            # Distribution overlay
            mm = conn.execute("""
                SELECT MIN(metric_value), MAX(metric_value) 
                FROM behavior_table WHERE behavior_run_id IN (?, ?)
            """, [run_a, run_b]).fetchone()
            minv = mm[0] or 0.0
            maxv = mm[1] or 0.0
            dist_a = conn.execute(f"""
                SELECT CAST(FLOOR(((metric_value - {minv}) / NULLIF({maxv}-{minv},0)) * {bins}) AS INTEGER) AS bucket,
                       COUNT(*) AS count
                FROM behavior_table WHERE behavior_run_id = ?
                GROUP BY bucket ORDER BY bucket
            """, [run_a]).fetchall()
            dist_b = conn.execute(f"""
                SELECT CAST(FLOOR(((metric_value - {minv}) / NULLIF({maxv}-{minv},0)) * {bins}) AS INTEGER) AS bucket,
                       COUNT(*) AS count
                FROM behavior_table WHERE behavior_run_id = ?
                GROUP BY bucket ORDER BY bucket
            """, [run_b]).fetchall()
            overlay = {
                'run_a': [{'bucket': int(b if b is not None else 0), 'count': int(c)} for b, c in dist_a],
                'run_b': [{'bucket': int(b if b is not None else 0), 'count': int(c)} for b, c in dist_b],
                'min': float(minv), 'max': float(maxv), 'bins': bins,
                'total_a': int(sum(c for _, c in dist_a)),
                'total_b': int(sum(c for _, c in dist_b))
            }
            # Coverage overlap (entities with non-zero)
            ent_a = conn.execute("""
                SELECT DISTINCT entity_id FROM behavior_table 
                WHERE behavior_run_id = ? AND metric_value != 0
            """, [run_a]).fetchall()
            ent_b = conn.execute("""
                SELECT DISTINCT entity_id FROM behavior_table 
                WHERE behavior_run_id = ? AND metric_value != 0
            """, [run_b]).fetchall()
            set_a = {r[0] for r in ent_a}
            set_b = {r[0] for r in ent_b}
            both = len(set_a & set_b)
            only_a = len(set_a - set_b)
            only_b = len(set_b - set_a)
            coverage = {'both': both, 'only_a': only_a, 'only_b': only_b}
            coverage['total_a'] = len(set_a)
            coverage['total_b'] = len(set_b)
            # Correlation scatter (aggregate per entity)
            agg_fn = 'MAX' if agg.lower() == 'max' else 'AVG'
            agg_a = conn.execute(f"""
                SELECT entity_id, {agg_fn}(metric_value) AS val_a
                FROM behavior_table WHERE behavior_run_id = ?
                GROUP BY entity_id
            """, [run_a]).fetchall()
            agg_b = conn.execute(f"""
                SELECT entity_id, {agg_fn}(metric_value) AS val_b
                FROM behavior_table WHERE behavior_run_id = ?
                GROUP BY entity_id
            """, [run_b]).fetchall()
            map_a = {r[0]: float(r[1] or 0) for r in agg_a}
            map_b = {r[0]: float(r[1] or 0) for r in agg_b}
            common = set(map_a.keys()) & set(map_b.keys())
            points = [{'entity_id': e, 'x': map_b[e], 'y': map_a[e]} for e in common]
            # Correlation coefficients (pearson)
            if len(points) >= 3:
                import numpy as np
                xs = np.array([p['x'] for p in points])
                ys = np.array([p['y'] for p in points])
                pearson = float(np.corrcoef(xs, ys)[0,1])
                # Spearman via ranks
                rank_x = xs.argsort().argsort()
                rank_y = ys.argsort().argsort()
                spearman = float(np.corrcoef(rank_x, rank_y)[0,1])
            else:
                pearson = None; spearman = None
            return {
                'allowed': True,
                'same_universe': True,
                'same_entity_level': True,
                'overlay': overlay,
                'coverage': coverage,
                'correlation': {'pearson': pearson, 'spearman': spearman},
                'points': points[:2000]  # cap for UI
            }
        finally:
            conn.close()

    def create_behavior_run(self, universe_id: int, config: Dict, created_by: str, universe_db_path: Path) -> Dict:
        start = time.time()
        info = self._get_universe(universe_id, universe_db_path)
        parquet_path = Path(info['parquet_path'])
        if not parquet_path.exists():
            raise FileNotFoundError("Universe parquet not found")

        behavior_hash = hashlib.sha256((json.dumps(config, sort_keys=True) + f"|{universe_id}").encode()).hexdigest()[:16]

        # Caching: reuse existing run if same config and universe
        conn_check = duckdb.connect(str(self.db_path))
        try:
            existing = conn_check.execute("""
                SELECT behavior_run_id, total_rows, total_entities 
                FROM behavior_runs 
                WHERE universe_id = ? AND behavior_hash = ?
                ORDER BY behavior_run_id DESC LIMIT 1
            """, [universe_id, behavior_hash]).fetchone()
            if existing:
                self._ensure_evidence(int(existing[0]), universe_db_path)
                return {'behavior_run_id': existing[0], 'total_rows': existing[1], 'total_entities': existing[2], 'cached': True}
        finally:
            conn_check.close()

        conn = duckdb.connect()
        df = conn.execute(f"SELECT * FROM read_parquet('{parquet_path}')").df()
        conn.close()

        behavior_df = self._compute_metrics(df, config)
        total_rows = len(behavior_df)
        total_entities = behavior_df['entity_id'].nunique()

        conn2 = duckdb.connect(str(self.db_path))
        try:
            run_id = conn2.execute("SELECT nextval('behavior_runs_seq')").fetchone()[0]
            conn2.execute("""
                INSERT INTO behavior_runs (
                    behavior_run_id, universe_id, config_json, entity_level,
                    entity_id_col, time_col, behavior_hash,
                    total_rows, total_entities, started_at, finished_at, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'success')
            """, [run_id, universe_id, json.dumps(config), config['entity_level'], config['entity_id_col'], config['time_col'], behavior_hash, total_rows, total_entities])

            behavior_df['behavior_run_id'] = run_id
            behavior_df['universe_id'] = universe_id
            behavior_df['entity_level'] = config['entity_level']

            tmp = behavior_df[['behavior_run_id','universe_id','entity_level','entity_id','as_of_date','metric_name','metric_value','metric_type','window']].rename(columns={'window':'window_spec'})
            conn2.register('tmp_behavior', tmp)
            conn2.execute("""
                INSERT INTO behavior_table (
                    behavior_run_id, universe_id, entity_level, entity_id,
                    as_of_date, metric_name, metric_value, metric_type, window_spec
                )
                SELECT 
                    behavior_run_id, universe_id, entity_level, entity_id,
                    as_of_date, metric_name, metric_value, metric_type, window_spec
                FROM tmp_behavior
            """)
        finally:
            conn2.close()

        self._ensure_evidence(int(run_id), universe_db_path)

        if self.audit_service and info['calibration_run_id']:
            self.audit_service.log_action(
                calibration_run_id=info['calibration_run_id'],
                step_name='step2_behavior',
                action='create',
                entity_type='behavior',
                entity_id=str(run_id),
                metadata={'universe_id': universe_id, 'created_by': created_by},
                metrics={'rows': total_rows, 'entities': total_entities},
            )

        return {'behavior_run_id': run_id, 'total_rows': total_rows, 'total_entities': total_entities}

    def list_runs(self, universe_id: Optional[int] = None) -> List[Dict]:
        conn = duckdb.connect(str(self.db_path))
        try:
            q = """
                WITH data_counts AS (
                  SELECT
                    behavior_run_id,
                    COUNT(1) AS data_rows,
                    COUNT(DISTINCT entity_id) AS data_entities,
                    MIN(as_of_date) AS min_as_of_date,
                    MAX(as_of_date) AS max_as_of_date
                  FROM behavior_table
                  GROUP BY behavior_run_id
                )
                SELECT
                  r.behavior_run_id, r.universe_id, r.entity_level, r.entity_id_col, r.time_col,
                  r.total_rows, r.total_entities, r.started_at, r.finished_at, r.status, r.config_json,
                  COALESCE(c.data_rows, 0) AS data_rows,
                  COALESCE(c.data_entities, 0) AS data_entities,
                  c.min_as_of_date,
                  c.max_as_of_date
                FROM behavior_runs r
                LEFT JOIN data_counts c
                  ON r.behavior_run_id = c.behavior_run_id
            """
            params = []
            if universe_id:
                q += " WHERE r.universe_id = ? ORDER BY r.behavior_run_id DESC"
                params.append(universe_id)
            else:
                q += " ORDER BY r.behavior_run_id DESC"
            rows = conn.execute(q, params).fetchall()
            return [{
                'behavior_run_id': r[0],
                'universe_id': r[1],
                'entity_level': r[2],
                'entity_id_col': r[3],
                'time_col': r[4],
                'total_rows': r[5],
                'total_entities': r[6],
                'started_at': r[7],
                'finished_at': r[8],
                'status': r[9],
                'config': json.loads(r[10]) if r[10] else {},
                'data_rows': int(r[11] or 0),
                'data_entities': int(r[12] or 0),
                'min_as_of_date': r[13],
                'max_as_of_date': r[14],
                'data_ready': bool(int(r[11] or 0) > 0)
            } for r in rows]
        finally:
            conn.close()

    def preview_run(
        self,
        run_id: int,
        limit: int = 100,
        offset: int = 0,
        entity_search: Optional[str] = None,
        value_min: Optional[float] = None,
        value_max: Optional[float] = None,
        sort_by: str = 'as_of_date',
        sort_dir: str = 'asc',
    ) -> List[Dict]:
        conn = duckdb.connect(str(self.db_path))
        try:
            sort_by = (sort_by or 'as_of_date').lower()
            sort_dir = (sort_dir or 'asc').lower()
            allowed_sort = {
                'as_of_date': 'as_of_date',
                'entity_id': 'entity_id',
                'metric_value': 'metric_value',
                'metric_name': 'metric_name',
            }
            order_col = allowed_sort.get(sort_by, 'as_of_date')
            order_dir = 'DESC' if sort_dir == 'desc' else 'ASC'

            where = ["behavior_run_id = ?"]
            params: List = [int(run_id)]

            if entity_search:
                where.append("CAST(entity_id AS VARCHAR) ILIKE ?")
                params.append(f"%{entity_search}%")
            if value_min is not None:
                where.append("TRY_CAST(metric_value AS DOUBLE) >= ?")
                params.append(float(value_min))
            if value_max is not None:
                where.append("TRY_CAST(metric_value AS DOUBLE) <= ?")
                params.append(float(value_max))

            where_sql = " AND ".join(where)
            q = f"""
                SELECT entity_id, as_of_date, metric_name, metric_value, metric_type, window_spec
                FROM behavior_table
                WHERE {where_sql}
                ORDER BY {order_col} {order_dir}, as_of_date ASC, entity_id ASC
                LIMIT ? OFFSET ?
            """
            params.extend([int(limit), int(offset)])
            rows = conn.execute(q, params).fetchall()
            return [{
                'entity_id': r[0],
                'as_of_date': r[1],
                'metric_name': r[2],
                'metric_value': r[3],
                'metric_type': r[4],
                'window': r[5]
            } for r in rows]
        finally:
            conn.close()

    def get_quality(self, run_id: int) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        try:
            mm = conn.execute("""
                SELECT MIN(metric_value), MAX(metric_value)
                FROM behavior_table WHERE behavior_run_id = ?
            """, [run_id]).fetchone()
            minv = mm[0] or 0.0
            maxv = mm[1] or 0.0
            bins = 20
            rows = conn.execute(f"""
                SELECT 
                    CAST(FLOOR(((metric_value - {minv}) / NULLIF({maxv}-{minv},0)) * {bins}) AS INTEGER) AS bucket,
                    COUNT(*) AS count
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY bucket
                ORDER BY bucket
            """, [run_id]).fetchall()
            hist = [{'bucket': int(b if b is not None else 0), 'count': int(c)} for b, c in rows]

            cov_rows = conn.execute("""
                WITH by_entity_day AS (
                    SELECT
                      entity_id,
                      COUNT(DISTINCT CASE WHEN metric_value != 0 THEN date_trunc('day', as_of_date) END) AS active_days
                    FROM behavior_table
                    WHERE behavior_run_id = ?
                    GROUP BY entity_id
                )
                SELECT
                  SUM(CASE WHEN active_days > 0 THEN 1 ELSE 0 END) AS nz_entities,
                  SUM(CASE WHEN active_days = 1 THEN 1 ELSE 0 END) AS single_obs,
                  SUM(CASE WHEN active_days >= 2 THEN 1 ELSE 0 END) AS repeated_obs,
                  COUNT(*) AS total_entities
                FROM by_entity_day
            """, [run_id]).fetchone()
            coverage = {
                'nz_entities': int(cov_rows[0] or 0),
                'single_obs': int(cov_rows[1] or 0),
                'repeated_obs': int(cov_rows[2] or 0),
                'total_entities': int(cov_rows[3] or 0)
            }

            td_rows = conn.execute("""
                SELECT 
                    date_trunc('day', as_of_date) AS day,
                    ABS(hash(entity_id) % 32) AS bucket,
                    AVG(ABS(metric_value)) AS intensity
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY day, bucket
                ORDER BY day, bucket
            """, [run_id]).fetchall()
            heatmap = [{'day': str(d), 'bucket': int(b), 'intensity': float(i)} for d, b, i in td_rows]

            return {'histogram': hist, 'coverage': coverage, 'heatmap': heatmap, 'min': float(minv), 'max': float(maxv), 'bins': int(bins)}
        finally:
            conn.close()

    def preview_run_entity(
        self,
        run_id: int,
        agg: str = 'last',
        limit: int = 100,
        offset: int = 0,
        entity_search: Optional[str] = None,
        value_min: Optional[float] = None,
        value_max: Optional[float] = None,
        sort_by: Optional[str] = None,
        sort_dir: str = 'desc',
    ) -> List[Dict]:
        agg = (agg or 'last').lower()
        conn = duckdb.connect(str(self.db_path))
        try:
            sort_dir = (sort_dir or 'desc').lower()
            order_dir = 'DESC' if sort_dir == 'desc' else 'ASC'
            sort_by = (sort_by or ('as_of_date' if agg == 'last' else 'metric_value')).lower()
            allowed_sort = {
                'as_of_date': 'as_of_date',
                'entity_id': 'entity_id',
                'metric_value': 'metric_value',
                'metric_name': 'metric_name',
            }
            order_col = allowed_sort.get(sort_by, 'metric_value')

            entity_clause = ""
            params_entity: List = []
            if entity_search:
                entity_clause = " AND CAST(entity_id AS VARCHAR) ILIKE ?"
                params_entity.append(f"%{entity_search}%")

            value_clause = ""
            params_value: List = []
            if value_min is not None:
                value_clause += " AND TRY_CAST(metric_value AS DOUBLE) >= ?"
                params_value.append(float(value_min))
            if value_max is not None:
                value_clause += " AND TRY_CAST(metric_value AS DOUBLE) <= ?"
                params_value.append(float(value_max))

            if agg == 'last':
                rows = conn.execute(f"""
                    WITH ranked AS (
                      SELECT
                        entity_id,
                        metric_name,
                        as_of_date,
                        metric_value,
                        ROW_NUMBER() OVER (PARTITION BY entity_id, metric_name ORDER BY as_of_date DESC) AS rn
                      FROM behavior_table
                      WHERE behavior_run_id = ? {entity_clause}
                    )
                    SELECT entity_id, as_of_date, metric_name, metric_value
                    FROM ranked
                    WHERE rn = 1 {value_clause}
                    ORDER BY {order_col} {order_dir}, entity_id ASC
                    LIMIT ? OFFSET ?
                """, [int(run_id), *params_entity, *params_value, int(limit), int(offset)]).fetchall()
            elif agg == 'max':
                rows = conn.execute(f"""
                    SELECT
                      entity_id,
                      MAX(as_of_date) AS as_of_date,
                      metric_name,
                      MAX(metric_value) AS metric_value
                    FROM behavior_table
                    WHERE behavior_run_id = ? {entity_clause}
                    GROUP BY entity_id, metric_name
                    HAVING 1=1 {value_clause}
                    ORDER BY {order_col} {order_dir} NULLS LAST, entity_id ASC
                    LIMIT ? OFFSET ?
                """, [int(run_id), *params_entity, *params_value, int(limit), int(offset)]).fetchall()
            elif agg == 'avg':
                rows = conn.execute(f"""
                    SELECT
                      entity_id,
                      MAX(as_of_date) AS as_of_date,
                      metric_name,
                      AVG(metric_value) AS metric_value
                    FROM behavior_table
                    WHERE behavior_run_id = ? {entity_clause}
                    GROUP BY entity_id, metric_name
                    HAVING 1=1 {value_clause}
                    ORDER BY {order_col} {order_dir} NULLS LAST, entity_id ASC
                    LIMIT ? OFFSET ?
                """, [int(run_id), *params_entity, *params_value, int(limit), int(offset)]).fetchall()
            else:
                raise ValueError("Unsupported aggregation")

            return [{
                'entity_id': r[0],
                'as_of_date': r[1],
                'metric_name': r[2],
                'metric_value': r[3]
            } for r in rows]
        finally:
            conn.close()

    def entity_timeline(
        self,
        run_ids: List[int],
        entity_ids: List[str],
        points_per_series: int = 2000,
    ) -> Dict:
        if not run_ids:
            raise ValueError("run_ids required")
        if not entity_ids:
            raise ValueError("entity_ids required")

        conn = duckdb.connect(str(self.db_path))
        try:
            run_ids_int = [int(r) for r in run_ids]
            placeholders_runs = ",".join(["?"] * len(run_ids_int))
            placeholders_entities = ",".join(["?"] * len(entity_ids))
            q = f"""
                WITH x AS (
                  SELECT
                    behavior_run_id,
                    entity_id,
                    as_of_date,
                    metric_name,
                    metric_value,
                    window_spec,
                    ROW_NUMBER() OVER (PARTITION BY behavior_run_id, entity_id ORDER BY as_of_date DESC) AS rn
                  FROM behavior_table
                  WHERE behavior_run_id IN ({placeholders_runs})
                    AND CAST(entity_id AS VARCHAR) IN ({placeholders_entities})
                )
                SELECT behavior_run_id, entity_id, as_of_date, metric_name, metric_value, window_spec
                FROM x
                WHERE rn <= ?
                ORDER BY behavior_run_id ASC, entity_id ASC, as_of_date ASC
            """
            params: List = [*run_ids_int, *entity_ids, int(points_per_series)]
            rows = conn.execute(q, params).fetchall()

            out: Dict = {'series': {}}
            for run_id, entity_id, as_of_date, metric_name, metric_value, window_spec in rows:
                rid = str(int(run_id))
                eid = str(entity_id)
                out['series'].setdefault(rid, {})
                out['series'][rid].setdefault(eid, {
                    'run_id': int(run_id),
                    'entity_id': eid,
                    'metric_name': metric_name,
                    'window': window_spec,
                    'points': []
                })
                out['series'][rid][eid]['points'].append({
                    'as_of_date': str(as_of_date) if as_of_date is not None else None,
                    'metric_value': float(metric_value) if metric_value is not None else None
                })
            return out
        finally:
            conn.close()

    def entity_values(
        self,
        run_ids: List[int],
        agg: str = 'max',
        limit_entities: int = 200,
        entity_search: Optional[str] = None,
        value_min: Optional[float] = None,
        value_max: Optional[float] = None,
    ) -> Dict:
        if not run_ids:
            raise ValueError("run_ids required")
        agg = (agg or 'max').lower()
        if agg not in ('max', 'avg', 'last'):
            raise ValueError("Unsupported aggregation")

        conn = duckdb.connect(str(self.db_path))
        try:
            run_ids_int = [int(r) for r in run_ids]
            placeholders_runs = ",".join(["?"] * len(run_ids_int))

            if agg == 'last':
                vals_cte = f"""
                    WITH ranked AS (
                      SELECT
                        behavior_run_id,
                        entity_id,
                        metric_name,
                        as_of_date,
                        metric_value,
                        window_spec,
                        ROW_NUMBER() OVER (PARTITION BY behavior_run_id, entity_id, metric_name ORDER BY as_of_date DESC) AS rn
                      FROM behavior_table
                      WHERE behavior_run_id IN ({placeholders_runs})
                    )
                    SELECT behavior_run_id, entity_id, metric_name, as_of_date, metric_value, window_spec
                    FROM ranked
                    WHERE rn = 1
                """
            elif agg == 'avg':
                vals_cte = f"""
                    SELECT
                      behavior_run_id,
                      entity_id,
                      ANY_VALUE(metric_name) AS metric_name,
                      MAX(as_of_date) AS as_of_date,
                      AVG(metric_value) AS metric_value,
                      ANY_VALUE(window_spec) AS window_spec
                    FROM behavior_table
                    WHERE behavior_run_id IN ({placeholders_runs})
                    GROUP BY behavior_run_id, entity_id
                """
            else:
                vals_cte = f"""
                    SELECT
                      behavior_run_id,
                      entity_id,
                      ANY_VALUE(metric_name) AS metric_name,
                      MAX(as_of_date) AS as_of_date,
                      MAX(metric_value) AS metric_value,
                      ANY_VALUE(window_spec) AS window_spec
                    FROM behavior_table
                    WHERE behavior_run_id IN ({placeholders_runs})
                    GROUP BY behavior_run_id, entity_id
                """

            q_entities = f"""
                WITH vals AS ({vals_cte}),
                scored AS (
                  SELECT entity_id, MAX(TRY_CAST(metric_value AS DOUBLE)) AS max_value
                  FROM vals
                  GROUP BY entity_id
                )
                SELECT entity_id, max_value
                FROM scored
                WHERE 1=1
            """
            params_entities: List = [*run_ids_int]
            if entity_search:
                q_entities += " AND CAST(entity_id AS VARCHAR) ILIKE ?"
                params_entities.append(f"%{entity_search}%")
            if value_min is not None:
                q_entities += " AND max_value >= ?"
                params_entities.append(float(value_min))
            if value_max is not None:
                q_entities += " AND max_value <= ?"
                params_entities.append(float(value_max))
            q_entities += " ORDER BY max_value DESC NULLS LAST, entity_id ASC LIMIT ?"
            params_entities.append(int(limit_entities))

            ent_rows = conn.execute(q_entities, params_entities).fetchall()
            entity_ids = [str(r[0]) for r in ent_rows]

            if not entity_ids:
                return {'run_ids': run_ids_int, 'agg': agg, 'rows': []}

            placeholders_entities = ",".join(["?"] * len(entity_ids))
            q_vals = f"""
                WITH vals AS ({vals_cte})
                SELECT behavior_run_id, entity_id, metric_name, as_of_date, metric_value, window_spec
                FROM vals
                WHERE CAST(entity_id AS VARCHAR) IN ({placeholders_entities})
            """
            params_vals: List = [*run_ids_int, *entity_ids]
            rows = conn.execute(q_vals, params_vals).fetchall()

            by_entity: Dict[str, Dict] = {eid: {'entity_id': eid, 'values': {}} for eid in entity_ids}
            for behavior_run_id, entity_id, metric_name, as_of_date, metric_value, window_spec in rows:
                rid = str(int(behavior_run_id))
                eid = str(entity_id)
                if eid not in by_entity:
                    continue
                by_entity[eid]['values'][rid] = {
                    'metric_name': metric_name,
                    'as_of_date': str(as_of_date) if as_of_date is not None else None,
                    'metric_value': float(metric_value) if metric_value is not None else None,
                    'window': window_spec,
                }

            return {
                'run_ids': run_ids_int,
                'agg': agg,
                'rows': list(by_entity.values())
            }
        finally:
            conn.close()

    def get_evidence(self, run_id: int, universe_db_path: Optional[Path] = None) -> Dict:
        self._ensure_evidence(run_id, universe_db_path)
        conn = duckdb.connect(str(self.db_path))
        try:
            diag = conn.execute("""
                SELECT
                  behavior_run_id, universe_id, entity_level, metric_name, window_spec,
                  total_rows, total_entities, null_pct, zero_pct, negative_pct,
                  gini, ks_vs_prev, coverage_delta_pct, reusability_score, reusability_label,
                  created_at
                FROM behavior_run_diagnostics
                WHERE behavior_run_id = ?
            """, [run_id]).fetchone()
            diag_obj = None
            if diag:
                diag_obj = {
                    'behavior_run_id': diag[0],
                    'universe_id': diag[1],
                    'entity_level': diag[2],
                    'metric_name': diag[3],
                    'window': diag[4],
                    'total_rows': diag[5],
                    'total_entities': diag[6],
                    'null_pct': float(diag[7] or 0.0),
                    'zero_pct': float(diag[8] or 0.0),
                    'negative_pct': float(diag[9] or 0.0),
                    'gini': float(diag[10] or 0.0),
                    'ks_vs_prev': float(diag[11]) if diag[11] is not None else None,
                    'coverage_delta_pct': float(diag[12]) if diag[12] is not None else None,
                    'reusability_score': float(diag[13] or 0.0),
                    'reusability_label': diag[14],
                    'created_at': str(diag[15])
                }

            insights_rows = conn.execute("""
                SELECT insight_type, insight_text, created_at
                FROM behavior_run_insights
                WHERE behavior_run_id = ?
                ORDER BY id ASC
            """, [run_id]).fetchall()
            insights = [{'type': t, 'text': txt, 'created_at': str(ts)} for t, txt, ts in insights_rows]

            snap_rows = conn.execute("""
                SELECT chart_type, data_json, created_at
                FROM behavior_chart_snapshots
                WHERE behavior_run_id = ?
                ORDER BY id ASC
            """, [run_id]).fetchall()
            snapshots = {}
            for t, dj, ts in snap_rows:
                try:
                    snapshots[t] = {'data': json.loads(dj), 'created_at': str(ts)}
                except Exception:
                    snapshots[t] = {'data': dj, 'created_at': str(ts)}

            return {'diagnostics': diag_obj, 'insights': insights, 'snapshots': snapshots}
        finally:
            conn.close()
    def export_run(self, run_id: int, fmt: str = 'parquet') -> Dict:
        export_dir = self.snapshot_storage_path.parent / 'exports'
        export_dir.mkdir(parents=True, exist_ok=True)
        out_path = export_dir / f'behavior_run_{run_id}.{ "parquet" if fmt=="parquet" else "csv"}'
        conn = duckdb.connect(str(self.db_path))
        try:
            if fmt == 'parquet':
                conn.execute(f"""
                    COPY (SELECT * FROM behavior_table WHERE behavior_run_id = {run_id})
                    TO '{str(out_path)}' (FORMAT 'parquet')
                """)
            else:
                conn.execute(f"""
                    COPY (SELECT * FROM behavior_table WHERE behavior_run_id = {run_id})
                    TO '{str(out_path)}' (HEADER, DELIMITER ',')
                """)
        finally:
            conn.close()
        meta_path = export_dir / f'behavior_run_{run_id}.json'
        connm = duckdb.connect(str(self.db_path))
        try:
            row = connm.execute("""
                SELECT behavior_run_id, universe_id, entity_level, entity_id_col, time_col, config_json, total_rows, total_entities, started_at, finished_at, status
                FROM behavior_runs WHERE behavior_run_id = ?
            """, [run_id]).fetchone()
        finally:
            connm.close()
        meta = {
            'behavior_run_id': row[0],
            'universe_id': row[1],
            'entity_level': row[2],
            'entity_id_col': row[3],
            'time_col': row[4],
            'config': json.loads(row[5]) if row[5] else {},
            'total_rows': row[6],
            'total_entities': row[7],
            'started_at': str(row[8]),
            'finished_at': str(row[9]),
            'status': row[10]
        }
        meta_path.write_text(json.dumps(meta, indent=2))
        return {'data_path': str(out_path), 'meta_path': str(meta_path)}

    def top_entities(self, run_id: int, k: int = 20) -> List[Dict]:
        conn = duckdb.connect(str(self.db_path))
        try:
            rows = conn.execute("""
                SELECT entity_id, MAX(metric_value) AS max_value
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY entity_id
                ORDER BY max_value DESC
                LIMIT ?
            """, [run_id, k]).fetchall()
            return [{'entity_id': r[0], 'max_value': float(r[1] or 0)} for r in rows]
        finally:
            conn.close()

    def median_by_day(self, run_id: int) -> List[Dict]:
        conn = duckdb.connect(str(self.db_path))
        try:
            rows = conn.execute("""
                SELECT date_trunc('day', as_of_date) AS day,
                       median(metric_value) AS med_value
                FROM behavior_table
                WHERE behavior_run_id = ?
                GROUP BY day
                ORDER BY day
            """, [run_id]).fetchall()
            return [{'day': str(r[0]), 'median_value': float(r[1] or 0)} for r in rows]
        finally:
            conn.close()
