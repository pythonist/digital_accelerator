# backend/api/tools/btsy/cortex/scenario_builder.py
"""
Cortex Scenario Builder - Step 2
Implements the lookback threshold logic from tc.ipynb.

Key behaviors:
- Normalizes transaction_datetime / transaction_amount
- Normalizes transaction_type to DEBIT/CREDIT when possible
- Handles missing customer_id gracefully (account-level only)
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional
import json

import duckdb
import pandas as pd


@dataclass
class CortexScenarioConfig:
    transaction_type: str = 'DEBIT'   # DEBIT, CREDIT, or ALL
    aggregation_level: str = 'daily'  # daily or monthly
    lookback_days: int = 10
    debug: bool = False


def _normalize_config(cfg: Dict) -> CortexScenarioConfig:
    if isinstance(cfg, CortexScenarioConfig):
        return cfg
    cfg = cfg or {}
    return CortexScenarioConfig(
        transaction_type=str(cfg.get('transaction_type', 'DEBIT')),
        aggregation_level=str(cfg.get('aggregation_level', 'daily')),
        lookback_days=int(cfg.get('lookback_days', 10)),
        debug=bool(cfg.get('debug', False)),
    )


def _normalize_tx_type(value) -> str:
    v = str(value).strip().upper()
    if v in ('DR', 'D', 'DEBIT', 'DBIT'):
        return 'DEBIT'
    if v in ('CR', 'C', 'CREDIT', 'CRDT'):
        return 'CREDIT'
    return v


def _ensure_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    if 'transaction_datetime' not in out.columns and 'transaction_date' in out.columns:
        out = out.rename(columns={'transaction_date': 'transaction_datetime'})

    if 'transaction_datetime' not in out.columns:
        raise KeyError('transaction_datetime column missing')
    if 'transaction_amount' not in out.columns:
        raise KeyError('transaction_amount column missing')
    if 'account_id' not in out.columns:
        raise KeyError('account_id column missing')

    if 'transaction_type' not in out.columns:
        # Try to derive a type
        if 'transaction_direction' in out.columns:
            out['transaction_type'] = out['transaction_direction'].astype(str).map(_normalize_tx_type)
        else:
            out['transaction_type'] = pd.to_numeric(out['transaction_amount'], errors='coerce').apply(
                lambda x: 'DEBIT' if x < 0 else ('CREDIT' if x > 0 else 'UNKNOWN')
            )
    else:
        out['transaction_type'] = out['transaction_type'].astype(str).map(_normalize_tx_type)

    if 'customer_id' not in out.columns:
        out['customer_id'] = pd.NA

    return out


def build_threshold_tables(df: pd.DataFrame, cfg: CortexScenarioConfig) -> Dict[str, Optional[pd.DataFrame]]:
    cfg = _normalize_config(cfg)

    if cfg.lookback_days <= 0:
        raise ValueError('lookback_days must be positive')

    df = _ensure_columns(df)
    df = df.copy()

    df['transaction_datetime'] = pd.to_datetime(df['transaction_datetime'], errors='coerce')
    df['transaction_amount'] = pd.to_numeric(df['transaction_amount'], errors='coerce')
    df = df.dropna(subset=['transaction_datetime', 'transaction_amount', 'account_id'])

    tx_type = str(cfg.transaction_type or 'ALL').upper()
    if tx_type != 'ALL':
        df = df[df['transaction_type'].astype(str).map(_normalize_tx_type) == _normalize_tx_type(tx_type)]

    agg_level = str(cfg.aggregation_level or 'daily').lower()

    has_customer_id = bool(df['customer_id'].notna().all()) if 'customer_id' in df.columns else False
    if not has_customer_id:
        df['customer_id'] = pd.NA
    id_keys = ['account_id', 'customer_id'] if has_customer_id else ['account_id']

    if agg_level == 'daily':
        step_daily_level = (
            df
            .assign(
                month_last_date=df['transaction_datetime'].dt.to_period('M').dt.to_timestamp('M') + pd.Timedelta(days=1)
            )
            .groupby([*id_keys, 'transaction_datetime', 'month_last_date'], as_index=False, dropna=False)
            .agg(total_daily_amount=('transaction_amount', 'sum'))
        )
    elif agg_level == 'monthly':
        step_daily_level = (
            df
            .assign(
                month_last_date=df['transaction_datetime'].dt.to_period('M').dt.to_timestamp('M') + pd.Timedelta(days=1),
                month_start=df['transaction_datetime'].dt.to_period('M').dt.to_timestamp()
            )
            .groupby([*id_keys, 'month_start', 'month_last_date'], as_index=False, dropna=False)
            .agg(total_daily_amount=('transaction_amount', 'sum'))
            .rename(columns={'month_start': 'transaction_datetime'})
        )
    else:
        raise ValueError('aggregation_level must be daily or monthly')

    if 'customer_id' not in step_daily_level.columns:
        step_daily_level['customer_id'] = pd.NA

    # Step 2 - lookback join
    a = step_daily_level.rename(columns={
        'transaction_datetime': 'transaction_datetime_a',
        'total_daily_amount': 'total_daily_amount_a'
    })
    b = step_daily_level.rename(columns={
        'transaction_datetime': 'transaction_datetime_b',
        'total_daily_amount': 'total_daily_amount_b'
    })

    merged_ab = a.merge(b, on='account_id', suffixes=('_a', '_b'), how='left')

    mask_lookback = (
        (merged_ab['transaction_datetime_b'] >= merged_ab['transaction_datetime_a'] - pd.Timedelta(days=cfg.lookback_days)) &
        (merged_ab['transaction_datetime_b'] <= merged_ab['transaction_datetime_a'])
    )

    lookback_table = (
        merged_ab.loc[mask_lookback, [
            'account_id',
            'customer_id_a',
            'transaction_datetime_a',
            'total_daily_amount_a',
            'total_daily_amount_b',
            'transaction_datetime_b'
        ]]
        .rename(columns={
            'customer_id_a': 'customer_id',
            'transaction_datetime_a': 'transaction_datetime',
            'total_daily_amount_a': 'total_daily_amount',
            'total_daily_amount_b': 'amount_lookback',
            'transaction_datetime_b': 'trxn_date_lookback'
        })
        .sort_values(['account_id', 'transaction_datetime', 'trxn_date_lookback'])
    )

    threshold_group_keys = ['account_id', 'customer_id', 'transaction_datetime'] if has_customer_id else ['account_id', 'transaction_datetime']
    threshold_table = (
        lookback_table
        .groupby(threshold_group_keys, as_index=False, dropna=False)
        .agg(
            threshold_amt=('amount_lookback', 'sum'),
            trxn_count=('amount_lookback', 'count'),
            avg_amt=('amount_lookback', 'mean'),
            max_amt=('amount_lookback', 'max'),
            min_amt=('amount_lookback', 'min')
        )
    )
    if 'customer_id' not in threshold_table.columns:
        threshold_table['customer_id'] = pd.NA

    worst_case = (
        threshold_table
        .groupby('account_id', as_index=False, dropna=False)
        .agg(
            count_periods=('account_id', 'count'),
            total_threshold=('threshold_amt', 'sum'),
            avg_threshold=('threshold_amt', 'mean'),
            max_threshold=('threshold_amt', 'max'),
            min_threshold=('threshold_amt', 'min'),
            total_trxn_count=('trxn_count', 'sum')
        )
        .sort_values('total_threshold', ascending=False)
    )

    # Step 2.2 - monthly reference points when aggregation is daily
    step3_lookback_table_monthly = None
    monthly_threshold = None

    if agg_level == 'daily':
        step_2_5_daily_level_sorted = step_daily_level.sort_values(
            ['account_id', 'month_last_date', 'transaction_datetime']
        )

        if has_customer_id:
            d = (
                step_2_5_daily_level_sorted
                .drop_duplicates(subset=['account_id', 'month_last_date'], keep='first')
                [['account_id', 'customer_id', 'month_last_date']]
                .copy()
            )
            a2 = step_daily_level.copy()
            merged_a2d = a2.merge(d, on=['account_id', 'customer_id'], how='left', suffixes=('_x', '_y'))
            dedup_keys = ['account_id', 'customer_id', 'transaction_datetime', 'month_last_date_y']
        else:
            d = (
                step_2_5_daily_level_sorted
                .drop_duplicates(subset=['account_id', 'month_last_date'], keep='first')
                [['account_id', 'month_last_date']]
                .copy()
            )
            a2 = step_daily_level.copy()
            merged_a2d = a2.merge(d, on=['account_id'], how='left', suffixes=('_x', '_y'))
            dedup_keys = ['account_id', 'transaction_datetime', 'month_last_date_y']

        mask_lookback_monthly = (
            (merged_a2d['transaction_datetime'] >= merged_a2d['month_last_date_y'] - pd.Timedelta(days=cfg.lookback_days)) &
            (merged_a2d['transaction_datetime'] <= merged_a2d['month_last_date_y'])
        )

        step3_lookback_table_monthly = (
            merged_a2d
            .loc[mask_lookback_monthly]
            .drop_duplicates(subset=dedup_keys, keep='first')
            .rename(columns={
                'total_daily_amount': 'lookbakc_amt',
                'month_last_date_y': 'month_last_date'
            })
            [['account_id', 'customer_id', 'transaction_datetime', 'lookbakc_amt', 'month_last_date']]
            .sort_values(['account_id', 'month_last_date', 'transaction_datetime'])
            .reset_index(drop=True)
        )

        monthly_threshold = (
            step3_lookback_table_monthly
            .groupby(['account_id', 'month_last_date'], as_index=False, dropna=False)
            .agg(
                threshold_amt=('lookbakc_amt', 'sum'),
                transaction_count=('lookbakc_amt', 'count')
            )
        )

    stats = {
        'rows_input': int(len(df)),
        'rows_step_daily': int(len(step_daily_level)),
        'rows_lookback': int(len(lookback_table)),
        'rows_threshold': int(len(threshold_table)),
        'rows_worst_case': int(len(worst_case)),
        'rows_monthly_threshold': int(len(monthly_threshold)) if monthly_threshold is not None else 0,
        'transaction_type': tx_type,
        'aggregation_level': agg_level,
        'lookback_days': int(cfg.lookback_days),
    }

    if len(threshold_table) > 0:
        stats.update({
            'unique_accounts': int(threshold_table['account_id'].nunique()),
            'total_periods': int(len(threshold_table)),
            'avg_threshold': float(threshold_table['threshold_amt'].mean()),
            'median_threshold': float(threshold_table['threshold_amt'].median()),
            'max_threshold': float(threshold_table['threshold_amt'].max()),
            'min_threshold': float(threshold_table['threshold_amt'].min()),
            'std_threshold': float(threshold_table['threshold_amt'].std() or 0.0),
        })

    return {
        'stats': stats,
        'step_daily_level': step_daily_level,
        'lookback_table': lookback_table,
        'threshold_table': threshold_table,
        'worst_case': worst_case,
        'step3_lookback_table_monthly': step3_lookback_table_monthly,
        'monthly_threshold': monthly_threshold,
    }


class CortexScenarioBuilderService:
    """Persists outputs of the cortex scenario builder in DuckDB."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS cortex_runs_seq START 1")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cortex_scenario_runs (
                  run_id INTEGER PRIMARY KEY DEFAULT nextval('cortex_runs_seq'),
                  universe_id INTEGER NOT NULL,
                  config_json TEXT NOT NULL,
                  transaction_type TEXT,
                  aggregation_level TEXT,
                  lookback_days INTEGER,
                  threshold_rows INTEGER,
                  worst_case_rows INTEGER,
                  monthly_threshold_rows INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  created_by TEXT
                )
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cortex_threshold_table (
                  run_id INTEGER NOT NULL,
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
                CREATE TABLE IF NOT EXISTS cortex_worst_case (
                  run_id INTEGER NOT NULL,
                  account_id TEXT,
                  count_periods INTEGER,
                  total_threshold DOUBLE,
                  avg_threshold DOUBLE,
                  max_threshold DOUBLE,
                  min_threshold DOUBLE,
                  total_trxn_count INTEGER
                )
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cortex_monthly_threshold (
                  run_id INTEGER NOT NULL,
                  account_id TEXT,
                  month_last_date TIMESTAMP,
                  threshold_amt DOUBLE,
                  transaction_count INTEGER
                )
                """
            )
        finally:
            conn.close()

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

    def create_run(self, universe_id: int, config: Dict, universe_db_path: Path, created_by: str = 'user') -> Dict:
        cfg = _normalize_config(config)
        parquet_path = self._get_universe_parquet(universe_id, universe_db_path)
        if not parquet_path.exists():
            raise FileNotFoundError(f"Universe parquet not found: {parquet_path}")

        df = pd.read_parquet(parquet_path)
        result = build_threshold_tables(df, cfg)

        threshold_table = result['threshold_table']
        worst_case = result['worst_case']
        monthly_threshold = result['monthly_threshold']

        conn = duckdb.connect(str(self.db_path))
        try:
            run_id = conn.execute("SELECT nextval('cortex_runs_seq')").fetchone()[0]

            conn.execute(
                """
                INSERT INTO cortex_scenario_runs (
                  run_id, universe_id, config_json, transaction_type, aggregation_level,
                  lookback_days, threshold_rows, worst_case_rows, monthly_threshold_rows, created_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(run_id), int(universe_id), json.dumps(config or {}),
                    cfg.transaction_type.upper(), cfg.aggregation_level.lower(), int(cfg.lookback_days),
                    int(len(threshold_table)), int(len(worst_case)),
                    int(len(monthly_threshold)) if monthly_threshold is not None else 0,
                    created_by
                ]
            )

            if len(threshold_table) > 0:
                conn.register('tmp_thresholds', threshold_table)
                conn.execute(
                    """
                    INSERT INTO cortex_threshold_table
                    SELECT ?, account_id, customer_id, transaction_datetime,
                           threshold_amt, trxn_count, avg_amt, max_amt, min_amt
                    FROM tmp_thresholds
                    """,
                    [int(run_id)]
                )

            if len(worst_case) > 0:
                conn.register('tmp_worst', worst_case)
                conn.execute(
                    """
                    INSERT INTO cortex_worst_case
                    SELECT ?, account_id, count_periods, total_threshold, avg_threshold, max_threshold,
                           min_threshold, total_trxn_count
                    FROM tmp_worst
                    """,
                    [int(run_id)]
                )

            if monthly_threshold is not None and len(monthly_threshold) > 0:
                conn.register('tmp_monthly', monthly_threshold)
                conn.execute(
                    """
                    INSERT INTO cortex_monthly_threshold
                    SELECT ?, account_id, month_last_date, threshold_amt, transaction_count
                    FROM tmp_monthly
                    """,
                    [int(run_id)]
                )

        finally:
            conn.close()

        return {
            'run_id': int(run_id),
            'stats': result['stats']
        }

    def preview_thresholds(self, run_id: int, limit: int = 50, offset: int = 0) -> pd.DataFrame:
        conn = duckdb.connect(str(self.db_path))
        try:
            return conn.execute(
                """
                SELECT account_id, customer_id, transaction_datetime,
                       threshold_amt, trxn_count, avg_amt, max_amt, min_amt
                FROM cortex_threshold_table
                WHERE run_id = ?
                ORDER BY account_id, transaction_datetime
                LIMIT ? OFFSET ?
                """,
                [int(run_id), int(limit), int(offset)]
            ).df()
        finally:
            conn.close()

    def preview_worst_case(self, run_id: int, limit: int = 20, offset: int = 0) -> pd.DataFrame:
        conn = duckdb.connect(str(self.db_path))
        try:
            return conn.execute(
                """
                SELECT account_id, count_periods, total_threshold, avg_threshold,
                       max_threshold, min_threshold, total_trxn_count
                FROM cortex_worst_case
                WHERE run_id = ?
                ORDER BY total_threshold DESC
                LIMIT ? OFFSET ?
                """,
                [int(run_id), int(limit), int(offset)]
            ).df()
        finally:
            conn.close()

    def preview_monthly_threshold(self, run_id: int, limit: int = 20, offset: int = 0) -> pd.DataFrame:
        conn = duckdb.connect(str(self.db_path))
        try:
            return conn.execute(
                """
                SELECT account_id, month_last_date, threshold_amt, transaction_count
                FROM cortex_monthly_threshold
                WHERE run_id = ?
                ORDER BY month_last_date ASC
                LIMIT ? OFFSET ?
                """,
                [int(run_id), int(limit), int(offset)]
            ).df()
        finally:
            conn.close()

    def delete_run(self, run_id: int) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        try:
            rid = int(run_id)
            conn.execute("DELETE FROM cortex_threshold_table WHERE run_id = ?", [rid])
            conn.execute("DELETE FROM cortex_worst_case WHERE run_id = ?", [rid])
            conn.execute("DELETE FROM cortex_monthly_threshold WHERE run_id = ?", [rid])
            conn.execute("DELETE FROM cortex_scenario_runs WHERE run_id = ?", [rid])
            return {"success": True, "run_id": rid}
        finally:
            conn.close()
