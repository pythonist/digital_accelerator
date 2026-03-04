from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import date, datetime
import json

import duckdb


class ThresholdConstructionService:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS threshold_runs_seq START 1")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS threshold_runs (
                  run_id INTEGER PRIMARY KEY DEFAULT nextval('threshold_runs_seq'),
                  universe_id INTEGER NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  created_by TEXT,
                  transaction_type TEXT,
                  aggregation_level TEXT,
                  entity_level TEXT,
                  lookback_days INTEGER,
                  static_rows INTEGER,
                  grouped_rows INTEGER,
                  lookback_rows INTEGER,
                  threshold_rows INTEGER,
                  date_range_start TIMESTAMP,
                  date_range_end TIMESTAMP,
                  available_types_json TEXT,
                  categories_json TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS run__static (
                  run_id INTEGER NOT NULL,
                  transaction_id TEXT,
                  account_id TEXT,
                  customer_id TEXT,
                  transaction_datetime TIMESTAMP,
                  transaction_amount DOUBLE,
                  transaction_type TEXT,
                  transaction_category TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS run__grouped (
                  run_id INTEGER NOT NULL,
                  entity_level TEXT,
                  account_id TEXT,
                  customer_id TEXT,
                  transaction_datetime TIMESTAMP,
                  month_last_date TIMESTAMP,
                  total_amount DOUBLE,
                  transaction_count INTEGER
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS run__lookback (
                  run_id INTEGER NOT NULL,
                  entity_level TEXT,
                  account_id TEXT,
                  customer_id TEXT,
                  transaction_datetime TIMESTAMP,
                  amount_lookback DOUBLE,
                  trxn_date_lookback TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS run__threshold (
                  run_id INTEGER NOT NULL,
                  entity_level TEXT,
                  account_id TEXT,
                  customer_id TEXT,
                  transaction_datetime TIMESTAMP,
                  threshold_amt DOUBLE,
                  trxn_count INTEGER,
                  avg_amt DOUBLE,
                  max_amt DOUBLE,
                  min_amt DOUBLE
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS threshold_run_stage_meta (
                  run_id INTEGER NOT NULL,
                  stage TEXT,
                  meta_json TEXT
                )
                """
            )
        finally:
            conn.close()

    def _safe_value(self, value):
        if value is None:
            return None
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if hasattr(value, "to_pydatetime"):
            try:
                return value.to_pydatetime().isoformat()
            except Exception:
                return value
        if hasattr(value, "isoformat"):
            try:
                return value.isoformat()
            except Exception:
                return value
        return value

    def _safe_row(self, row: Dict) -> Dict:
        return {k: self._safe_value(v) for k, v in (row or {}).items()}

    def _safe_rows(self, rows: List[Dict]) -> List[Dict]:
        return [self._safe_row(r) for r in rows or []]

    def _get_universe_parquet(self, universe_id: int, universe_db_path: Path) -> Path:
        uconn = duckdb.connect(str(universe_db_path))
        try:
            row = uconn.execute(
                """
                SELECT parquet_path
                FROM transaction_universe_runs
                WHERE id = ?
                """,
                [int(universe_id)]
            ).fetchone()
            if not row or not row[0]:
                raise ValueError(f"Universe {universe_id} not found or has no parquet path")
            return Path(row[0])
        finally:
            uconn.close()

    def _describe_parquet_columns(self, parquet_path: Path) -> List[str]:
        p_sql = str(parquet_path).replace("'", "''")
        conn = duckdb.connect()
        try:
            rows = conn.execute(f"DESCRIBE SELECT * FROM read_parquet('{p_sql}')").fetchall()
            return [r[0] for r in rows]
        finally:
            conn.close()

    def _persist_stage_meta(self, conn: duckdb.DuckDBPyConnection, run_id: int, stage: str, meta: Dict) -> None:
        conn.execute(
            "DELETE FROM threshold_run_stage_meta WHERE run_id = ? AND stage = ?",
            [int(run_id), str(stage)]
        )
        conn.execute(
            """
            INSERT INTO threshold_run_stage_meta (run_id, stage, meta_json)
            VALUES (?, ?, ?)
            """,
            [int(run_id), str(stage), json.dumps(meta or {}, default=str)]
        )

    def start_run(
        self,
        universe_id: int,
        universe_db_path: Path,
        created_by: str = "user",
        preview_limit: int = 200,
        preview_offset: int = 0,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
    ) -> Dict:
        parquet_path = self._get_universe_parquet(universe_id, universe_db_path)
        if not parquet_path.exists():
            raise FileNotFoundError(f"Universe parquet not found: {parquet_path}")

        columns = set(self._describe_parquet_columns(parquet_path))
        tx_dt_col = "transaction_datetime" if "transaction_datetime" in columns else ("transaction_date" if "transaction_date" in columns else None)
        if not tx_dt_col:
            raise KeyError("transaction_datetime column missing")
        if "transaction_amount" not in columns:
            raise KeyError("transaction_amount column missing")

        has_tx_id = "transaction_id" in columns
        has_customer = "customer_id" in columns
        has_type = "transaction_type" in columns
        has_direction = "transaction_direction" in columns
        has_category = "transaction_category" in columns

        p_sql = str(parquet_path).replace("'", "''")
        amount_expr = "TRY_CAST(transaction_amount AS DOUBLE)"
        tx_dt_expr = f"TRY_CAST({tx_dt_col} AS TIMESTAMP)"
        if has_type:
            tx_type_expr = "UPPER(CAST(transaction_type AS VARCHAR))"
        elif has_direction:
            tx_type_expr = "UPPER(CAST(transaction_direction AS VARCHAR))"
        else:
            tx_type_expr = f"CASE WHEN {amount_expr} < 0 THEN 'DEBIT' WHEN {amount_expr} > 0 THEN 'CREDIT' ELSE 'UNKNOWN' END"
        tx_cat_expr = "CAST(transaction_category AS VARCHAR)" if has_category else "NULL"
        tx_id_expr = "CAST(transaction_id AS VARCHAR)" if has_tx_id else "NULL"
        customer_expr = "CAST(customer_id AS VARCHAR)" if has_customer else "NULL"

        conn = duckdb.connect(str(self.db_path))
        try:
            run_id = conn.execute("SELECT nextval('threshold_runs_seq')").fetchone()[0]
            conn.execute(
                """
                INSERT INTO threshold_runs (run_id, universe_id, created_by)
                VALUES (?, ?, ?)
                """,
                [int(run_id), int(universe_id), str(created_by)]
            )
            conn.execute("DELETE FROM run__static WHERE run_id = ?", [int(run_id)])
            conn.execute(
                f"""
                INSERT INTO run__static
                SELECT
                  ? AS run_id,
                  {tx_id_expr} AS transaction_id,
                  CAST(account_id AS VARCHAR) AS account_id,
                  {customer_expr} AS customer_id,
                  {tx_dt_expr} AS transaction_datetime,
                  {amount_expr} AS transaction_amount,
                  {tx_type_expr} AS transaction_type,
                  {tx_cat_expr} AS transaction_category
                FROM read_parquet('{p_sql}')
                WHERE {tx_dt_expr} IS NOT NULL
                  AND {amount_expr} IS NOT NULL
                """,
                [int(run_id)]
            )

            stats_row = conn.execute(
                """
                SELECT
                  COUNT(1) AS rows,
                  COUNT(DISTINCT account_id) AS accounts,
                  COUNT(DISTINCT customer_id) AS customers,
                  MIN(transaction_datetime) AS date_start,
                  MAX(transaction_datetime) AS date_end,
                  SUM(transaction_amount) AS total_amount,
                  AVG(transaction_amount) AS avg_amount,
                  MIN(transaction_amount) AS min_amount,
                  MAX(transaction_amount) AS max_amount
                FROM run__static
                WHERE run_id = ?
                """,
                [int(run_id)]
            ).fetchone()

            types = conn.execute(
                """
                SELECT DISTINCT transaction_type
                FROM run__static
                WHERE run_id = ? AND transaction_type IS NOT NULL
                ORDER BY transaction_type
                """,
                [int(run_id)]
            ).fetchall()
            available_types = [t[0] for t in types if t and t[0]]

            categories = conn.execute(
                """
                SELECT transaction_category, COUNT(1) AS cnt
                FROM run__static
                WHERE run_id = ? AND transaction_category IS NOT NULL
                GROUP BY transaction_category
                ORDER BY cnt DESC
                """,
                [int(run_id)]
            ).fetchall()
            categories_map = {str(r[0]): int(r[1]) for r in categories if r and r[0] is not None}

            conn.execute(
                """
                UPDATE threshold_runs
                SET static_rows = ?, date_range_start = ?, date_range_end = ?,
                    available_types_json = ?, categories_json = ?
                WHERE run_id = ?
                """,
                [
                    int(stats_row[0] or 0),
                    stats_row[3],
                    stats_row[4],
                    json.dumps(available_types, default=str),
                    json.dumps(categories_map, default=str),
                    int(run_id),
                ]
            )
            self._persist_stage_meta(
                conn,
                run_id,
                "static",
                {
                    "rows": int(stats_row[0] or 0),
                    "accounts": int(stats_row[1] or 0),
                    "customers": int(stats_row[2] or 0),
                    "date_start": self._safe_value(stats_row[3]),
                    "date_end": self._safe_value(stats_row[4]),
                    "total_amount": float(stats_row[5] or 0.0),
                    "avg_amount": float(stats_row[6] or 0.0),
                    "min_amount": float(stats_row[7] or 0.0),
                    "max_amount": float(stats_row[8] or 0.0),
                }
            )

            preview_rows = self._preview_static(
                conn,
                run_id,
                account_id=account_id,
                customer_id=customer_id,
                limit=preview_limit,
                offset=preview_offset,
            )

        finally:
            conn.close()

        return {
            "run_id": int(run_id),
            "stats": {
                "rows": int(stats_row[0] or 0),
                "accounts": int(stats_row[1] or 0),
                "customers": int(stats_row[2] or 0),
                "date_start": self._safe_value(stats_row[3]),
                "date_end": self._safe_value(stats_row[4]),
                "total_amount": float(stats_row[5] or 0.0),
                "avg_amount": float(stats_row[6] or 0.0),
                "min_amount": float(stats_row[7] or 0.0),
                "max_amount": float(stats_row[8] or 0.0),
            },
            "available_transaction_types": available_types,
            "categories": categories_map,
            "preview": preview_rows,
        }

    def preview_static(
        self,
        run_id: int,
        preview_limit: int = 200,
        preview_offset: int = 0,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
    ) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        try:
            run_row = conn.execute(
                """
                SELECT available_types_json, categories_json
                FROM threshold_runs
                WHERE run_id = ?
                """,
                [int(run_id)]
            ).fetchone()
            if not run_row:
                raise ValueError(f"run_id {run_id} not found")

            stats_row = conn.execute(
                """
                SELECT
                  COUNT(1) AS rows,
                  COUNT(DISTINCT account_id) AS accounts,
                  COUNT(DISTINCT customer_id) AS customers,
                  MIN(transaction_datetime) AS date_start,
                  MAX(transaction_datetime) AS date_end,
                  SUM(transaction_amount) AS total_amount,
                  AVG(transaction_amount) AS avg_amount,
                  MIN(transaction_amount) AS min_amount,
                  MAX(transaction_amount) AS max_amount
                FROM run__static
                WHERE run_id = ?
                """,
                [int(run_id)]
            ).fetchone()

            available_types = []
            categories_map: Dict[str, int] = {}
            if run_row[0]:
                try:
                    available_types = json.loads(run_row[0]) or []
                except Exception:
                    available_types = []
            if run_row[1]:
                try:
                    categories_map = json.loads(run_row[1]) or {}
                except Exception:
                    categories_map = {}

            if not available_types:
                types = conn.execute(
                    """
                    SELECT DISTINCT transaction_type
                    FROM run__static
                    WHERE run_id = ? AND transaction_type IS NOT NULL
                    ORDER BY transaction_type
                    """,
                    [int(run_id)]
                ).fetchall()
                available_types = [t[0] for t in types if t and t[0]]

            if not categories_map:
                categories = conn.execute(
                    """
                    SELECT transaction_category, COUNT(1) AS cnt
                    FROM run__static
                    WHERE run_id = ? AND transaction_category IS NOT NULL
                    GROUP BY transaction_category
                    ORDER BY cnt DESC
                    """,
                    [int(run_id)]
                ).fetchall()
                categories_map = {str(r[0]): int(r[1]) for r in categories if r and r[0] is not None}

            preview_rows = self._preview_static(
                conn,
                run_id,
                account_id=account_id,
                customer_id=customer_id,
                limit=preview_limit,
                offset=preview_offset,
            )
        finally:
            conn.close()

        return {
            "run_id": int(run_id),
            "stats": {
                "rows": int(stats_row[0] or 0),
                "accounts": int(stats_row[1] or 0),
                "customers": int(stats_row[2] or 0),
                "date_start": self._safe_value(stats_row[3]),
                "date_end": self._safe_value(stats_row[4]),
                "total_amount": float(stats_row[5] or 0.0),
                "avg_amount": float(stats_row[6] or 0.0),
                "min_amount": float(stats_row[7] or 0.0),
                "max_amount": float(stats_row[8] or 0.0),
            },
            "available_transaction_types": available_types,
            "categories": categories_map,
            "preview": preview_rows,
        }

    def _preview_static(
        self,
        conn: duckdb.DuckDBPyConnection,
        run_id: int,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict]:
        filters, params = self._build_filters(account_id, customer_id)
        query = f"""
            SELECT
              transaction_id,
              account_id,
              customer_id,
              transaction_datetime,
              transaction_type,
              transaction_category,
              transaction_amount
            FROM run__static
            WHERE run_id = ?
            {filters}
            ORDER BY transaction_datetime DESC NULLS LAST
            LIMIT ? OFFSET ?
        """
        params = [int(run_id), *params, int(limit), int(offset)]
        rows = conn.execute(query, params).df().to_dict(orient="records")
        return self._safe_rows(rows)

    def group_run(
        self,
        run_id: int,
        aggregation_level: str,
        entity_level: str,
        transaction_type: Optional[str] = None,
        preview_limit: int = 200,
        preview_offset: int = 0,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
    ) -> Dict:
        agg = str(aggregation_level or "").lower()
        if agg not in {"daily", "monthly"}:
            raise ValueError("aggregation_level must be daily or monthly")
        ent = str(entity_level or "").lower()
        if ent not in {"account", "customer"}:
            raise ValueError("entity_level must be account or customer")
        tx_type = str(transaction_type or "ALL").upper()

        trunc_unit = "day" if agg == "daily" else "month"
        bucket_expr = f"date_trunc('{trunc_unit}', transaction_datetime)"
        month_last_expr = (
            f"(date_trunc('month', {bucket_expr}) + INTERVAL '1 month' - INTERVAL '1 day')"
        )

        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute("DELETE FROM run__grouped WHERE run_id = ?", [int(run_id)])

            tx_filter = ""
            tx_params: List = []
            if tx_type and tx_type != "ALL":
                tx_filter = "AND transaction_type = ?"
                tx_params.append(tx_type)

            if ent == "account":
                group_keys = f"account_id, customer_id, {bucket_expr}"
                select_account = "account_id"
                select_customer = "customer_id"
            else:
                group_keys = f"customer_id, {bucket_expr}"
                select_account = "NULL"
                select_customer = "customer_id"

            conn.execute(
                f"""
                INSERT INTO run__grouped
                SELECT
                  ? AS run_id,
                  ? AS entity_level,
                  {select_account} AS account_id,
                  {select_customer} AS customer_id,
                  {bucket_expr} AS transaction_datetime,
                  {month_last_expr} AS month_last_date,
                  SUM(transaction_amount) AS total_amount,
                  COUNT(1) AS transaction_count
                FROM run__static
                WHERE run_id = ?
                {tx_filter}
                GROUP BY {group_keys}
                """,
                [int(run_id), ent, int(run_id), *tx_params]
            )

            stats_row = conn.execute(
                """
                SELECT
                  COUNT(1) AS rows,
                  COUNT(DISTINCT account_id) AS accounts,
                  COUNT(DISTINCT customer_id) AS customers,
                  MIN(transaction_datetime) AS date_start,
                  MAX(transaction_datetime) AS date_end,
                  SUM(total_amount) AS total_amount,
                  AVG(total_amount) AS avg_amount,
                  MIN(total_amount) AS min_amount,
                  MAX(total_amount) AS max_amount
                FROM run__grouped
                WHERE run_id = ?
                """,
                [int(run_id)]
            ).fetchone()

            conn.execute(
                """
                UPDATE threshold_runs
                SET transaction_type = ?, aggregation_level = ?, entity_level = ?, grouped_rows = ?
                WHERE run_id = ?
                """,
                [tx_type, agg, ent, int(stats_row[0] or 0), int(run_id)]
            )
            self._persist_stage_meta(
                conn,
                run_id,
                "grouped",
                {
                    "rows": int(stats_row[0] or 0),
                    "accounts": int(stats_row[1] or 0),
                    "customers": int(stats_row[2] or 0),
                    "date_start": self._safe_value(stats_row[3]),
                    "date_end": self._safe_value(stats_row[4]),
                    "total_amount": float(stats_row[5] or 0.0),
                    "avg_amount": float(stats_row[6] or 0.0),
                    "min_amount": float(stats_row[7] or 0.0),
                    "max_amount": float(stats_row[8] or 0.0),
                }
            )

            preview_rows = self._preview_grouped(
                conn,
                run_id,
                account_id=account_id,
                customer_id=customer_id,
                limit=preview_limit,
                offset=preview_offset,
            )

        finally:
            conn.close()

        return {
            "run_id": int(run_id),
            "stats": {
                "rows": int(stats_row[0] or 0),
                "accounts": int(stats_row[1] or 0),
                "customers": int(stats_row[2] or 0),
                "date_start": self._safe_value(stats_row[3]),
                "date_end": self._safe_value(stats_row[4]),
                "total_amount": float(stats_row[5] or 0.0),
                "avg_amount": float(stats_row[6] or 0.0),
                "min_amount": float(stats_row[7] or 0.0),
                "max_amount": float(stats_row[8] or 0.0),
            },
            "preview": preview_rows,
        }

    def _preview_grouped(
        self,
        conn: duckdb.DuckDBPyConnection,
        run_id: int,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict]:
        filters, params = self._build_filters(account_id, customer_id)
        query = f"""
            SELECT
              account_id,
              customer_id,
              transaction_datetime,
              month_last_date,
              total_amount,
              transaction_count
            FROM run__grouped
            WHERE run_id = ?
            {filters}
            ORDER BY transaction_datetime DESC NULLS LAST
            LIMIT ? OFFSET ?
        """
        params = [int(run_id), *params, int(limit), int(offset)]
        rows = conn.execute(query, params).df().to_dict(orient="records")
        return self._safe_rows(rows)

    def lookback_run(
        self,
        run_id: int,
        lookback_days: int,
        preview_limit: int = 200,
        preview_offset: int = 0,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        as_of_date: Optional[str] = None,
    ) -> Dict:
        lookback_days_int = int(lookback_days or 0)
        if lookback_days_int <= 0:
            raise ValueError("lookback_days must be positive")

        conn = duckdb.connect(str(self.db_path))
        try:
            row = conn.execute(
                "SELECT entity_level FROM threshold_runs WHERE run_id = ?",
                [int(run_id)]
            ).fetchone()
            if not row or not row[0]:
                raise ValueError("Run not found or missing entity_level")
            ent = str(row[0])

            conn.execute("DELETE FROM run__lookback WHERE run_id = ?", [int(run_id)])

            if ent == "customer":
                join_key = "customer_id"
            else:
                join_key = "account_id"

            conn.execute(
                f"""
                INSERT INTO run__lookback
                SELECT
                  ? AS run_id,
                  ? AS entity_level,
                  a.account_id AS account_id,
                  a.customer_id AS customer_id,
                  a.transaction_datetime AS transaction_datetime,
                  b.total_amount AS amount_lookback,
                  b.transaction_datetime AS trxn_date_lookback
                FROM run__grouped a
                JOIN run__grouped b
                  ON a.{join_key} = b.{join_key}
                WHERE a.run_id = ?
                  AND b.run_id = ?
                  AND b.transaction_datetime >= a.transaction_datetime - INTERVAL '{lookback_days_int} days'
                  AND b.transaction_datetime <= a.transaction_datetime
                """,
                [int(run_id), ent, int(run_id), int(run_id)]
            )

            stats_row = conn.execute(
                """
                SELECT
                  COUNT(1) AS rows,
                  COUNT(DISTINCT account_id) AS accounts,
                  COUNT(DISTINCT customer_id) AS customers
                FROM run__lookback
                WHERE run_id = ?
                """,
                [int(run_id)]
            ).fetchone()

            conn.execute(
                """
                UPDATE threshold_runs
                SET lookback_days = ?, lookback_rows = ?
                WHERE run_id = ?
                """,
                [int(lookback_days_int), int(stats_row[0] or 0), int(run_id)]
            )
            self._persist_stage_meta(
                conn,
                run_id,
                "lookback",
                {
                    "rows": int(stats_row[0] or 0),
                    "accounts": int(stats_row[1] or 0),
                    "customers": int(stats_row[2] or 0),
                }
            )

            preview_rows = self._preview_lookback(
                conn,
                run_id,
                account_id=account_id,
                customer_id=customer_id,
                as_of_date=as_of_date,
                limit=preview_limit,
                offset=preview_offset,
            )

        finally:
            conn.close()

        return {
            "run_id": int(run_id),
            "stats": {
                "rows": int(stats_row[0] or 0),
                "accounts": int(stats_row[1] or 0),
                "customers": int(stats_row[2] or 0),
                "lookback_days": int(lookback_days_int),
            },
            "preview": preview_rows,
        }

    def _preview_lookback(
        self,
        conn: duckdb.DuckDBPyConnection,
        run_id: int,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        as_of_date: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict]:
        filters, params = self._build_filters(account_id, customer_id)
        date_filter = ""
        if as_of_date:
            date_filter = "AND transaction_datetime = TRY_CAST(? AS TIMESTAMP)"
            params.append(as_of_date)
        query = f"""
            SELECT
              account_id,
              customer_id,
              transaction_datetime,
              trxn_date_lookback,
              amount_lookback
            FROM run__lookback
            WHERE run_id = ?
            {filters}
            {date_filter}
            ORDER BY transaction_datetime DESC NULLS LAST, trxn_date_lookback DESC NULLS LAST
            LIMIT ? OFFSET ?
        """
        params = [int(run_id), *params, int(limit), int(offset)]
        rows = conn.execute(query, params).df().to_dict(orient="records")
        return self._safe_rows(rows)

    def threshold_run(
        self,
        run_id: int,
        preview_limit: int = 200,
        preview_offset: int = 0,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
    ) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        try:
            row = conn.execute(
                "SELECT entity_level FROM threshold_runs WHERE run_id = ?",
                [int(run_id)]
            ).fetchone()
            if not row or not row[0]:
                raise ValueError("Run not found or missing entity_level")
            ent = str(row[0])

            conn.execute("DELETE FROM run__threshold WHERE run_id = ?", [int(run_id)])
            conn.execute(
                """
                INSERT INTO run__threshold
                SELECT
                  ? AS run_id,
                  ? AS entity_level,
                  account_id,
                  customer_id,
                  transaction_datetime,
                  SUM(amount_lookback) AS threshold_amt,
                  COUNT(1) AS trxn_count,
                  AVG(amount_lookback) AS avg_amt,
                  MAX(amount_lookback) AS max_amt,
                  MIN(amount_lookback) AS min_amt
                FROM run__lookback
                WHERE run_id = ?
                GROUP BY account_id, customer_id, transaction_datetime
                """,
                [int(run_id), ent, int(run_id)]
            )

            stats_row = conn.execute(
                """
                SELECT
                  COUNT(1) AS rows,
                  COUNT(DISTINCT account_id) AS accounts,
                  COUNT(DISTINCT customer_id) AS customers,
                  AVG(threshold_amt) AS avg_threshold,
                  MEDIAN(threshold_amt) AS median_threshold,
                  MAX(threshold_amt) AS max_threshold,
                  MIN(threshold_amt) AS min_threshold
                FROM run__threshold
                WHERE run_id = ?
                """,
                [int(run_id)]
            ).fetchone()

            conn.execute(
                """
                UPDATE threshold_runs
                SET threshold_rows = ?
                WHERE run_id = ?
                """,
                [int(stats_row[0] or 0), int(run_id)]
            )
            self._persist_stage_meta(
                conn,
                run_id,
                "threshold",
                {
                    "rows": int(stats_row[0] or 0),
                    "accounts": int(stats_row[1] or 0),
                    "customers": int(stats_row[2] or 0),
                    "avg_threshold": float(stats_row[3] or 0.0),
                    "median_threshold": float(stats_row[4] or 0.0),
                    "max_threshold": float(stats_row[5] or 0.0),
                    "min_threshold": float(stats_row[6] or 0.0),
                }
            )

            preview_rows = self._preview_threshold(
                conn,
                run_id,
                account_id=account_id,
                customer_id=customer_id,
                limit=preview_limit,
                offset=preview_offset,
            )
            worst_case = self._preview_worst_case(conn, run_id, ent)

        finally:
            conn.close()

        return {
            "run_id": int(run_id),
            "stats": {
                "rows": int(stats_row[0] or 0),
                "accounts": int(stats_row[1] or 0),
                "customers": int(stats_row[2] or 0),
                "avg_threshold": float(stats_row[3] or 0.0),
                "median_threshold": float(stats_row[4] or 0.0),
                "max_threshold": float(stats_row[5] or 0.0),
                "min_threshold": float(stats_row[6] or 0.0),
            },
            "preview": preview_rows,
            "worst_case": worst_case,
        }

    def _preview_threshold(
        self,
        conn: duckdb.DuckDBPyConnection,
        run_id: int,
        account_id: Optional[str] = None,
        customer_id: Optional[str] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Dict]:
        filters, params = self._build_filters(account_id, customer_id)
        query = f"""
            SELECT
              account_id,
              customer_id,
              transaction_datetime,
              threshold_amt,
              trxn_count,
              avg_amt,
              max_amt,
              min_amt
            FROM run__threshold
            WHERE run_id = ?
            {filters}
            ORDER BY threshold_amt DESC NULLS LAST
            LIMIT ? OFFSET ?
        """
        params = [int(run_id), *params, int(limit), int(offset)]
        rows = conn.execute(query, params).df().to_dict(orient="records")
        return self._safe_rows(rows)

    def _preview_worst_case(self, conn: duckdb.DuckDBPyConnection, run_id: int, entity_level: str) -> List[Dict]:
        if entity_level == "customer":
            group_key = "customer_id"
        else:
            group_key = "account_id"
        query = f"""
            SELECT
              {group_key} AS entity_id,
              COUNT(1) AS count_periods,
              SUM(threshold_amt) AS total_threshold,
              AVG(threshold_amt) AS avg_threshold,
              MAX(threshold_amt) AS max_threshold,
              MIN(threshold_amt) AS min_threshold,
              SUM(trxn_count) AS total_trxn_count
            FROM run__threshold
            WHERE run_id = ?
            GROUP BY {group_key}
            ORDER BY total_threshold DESC NULLS LAST
            LIMIT 20
        """
        rows = conn.execute(query, [int(run_id)]).df().to_dict(orient="records")
        return self._safe_rows(rows)

    def _build_filters(
        self, account_id: Optional[str] = None, customer_id: Optional[str] = None
    ) -> Tuple[str, List]:
        clauses = []
        params: List = []
        if account_id:
            clauses.append("AND account_id = ?")
            params.append(str(account_id))
        if customer_id:
            clauses.append("AND customer_id = ?")
            params.append(str(customer_id))
        return (" " + " ".join(clauses)) if clauses else "", params
