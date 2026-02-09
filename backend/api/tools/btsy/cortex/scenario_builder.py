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
from typing import Any, Dict, Optional
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
            conn.execute("CREATE SEQUENCE IF NOT EXISTS cortex_recon_seq START 1")
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

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cortex_reconstruction_runs (
                  recon_id INTEGER PRIMARY KEY DEFAULT nextval('cortex_recon_seq'),
                  run_id INTEGER NOT NULL,
                  entity_level TEXT,
                  entity_id TEXT,
                  as_of_date TIMESTAMP,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  created_by TEXT
                )
                """
            )

            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cortex_reconstruction_artifacts (
                  recon_id INTEGER NOT NULL,
                  payload_json TEXT
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

    def reconstruct_behavior(
        self,
        run_id: int,
        universe_db_path: Path,
        entity_id: str,
        as_of_date: str,
        entity_level: str = 'account',
        created_by: str = 'user',
    ) -> Dict[str, Any]:
        conn = duckdb.connect(str(self.db_path))
        try:
            row = conn.execute(
                """
                SELECT universe_id, config_json, transaction_type, aggregation_level, lookback_days
                FROM cortex_scenario_runs
                WHERE run_id = ?
                """,
                [int(run_id)],
            ).fetchone()
        finally:
            conn.close()
        if not row:
            raise ValueError(f"cortex run {run_id} not found")
        universe_id = int(row[0])
        base_cfg = {}
        if row[1]:
            try:
                base_cfg = json.loads(row[1])
            except Exception:
                base_cfg = {}
        if row[2]:
            base_cfg.setdefault('transaction_type', row[2])
        if row[3]:
            base_cfg.setdefault('aggregation_level', row[3])
        if row[4]:
            base_cfg.setdefault('lookback_days', int(row[4]))
        cfg = _normalize_config(base_cfg)
        parquet_path = self._get_universe_parquet(universe_id, universe_db_path)
        if not parquet_path.exists():
            raise FileNotFoundError(f"Universe parquet not found: {parquet_path}")
        df_all = pd.read_parquet(parquet_path)
        df0 = _ensure_columns(df_all)
        entity_id_str = str(entity_id)
        if entity_level.lower() == 'customer':
            df_entity = df0[df0['customer_id'].astype(str) == entity_id_str].copy()
        else:
            df_entity = df0[df0['account_id'].astype(str) == entity_id_str].copy()
        if len(df_entity) == 0:
            artifact = {
                'entity_id': entity_id_str,
                'entity_level': entity_level,
                'as_of_date': as_of_date,
                'raw_view': [],
                'filter_impact': {
                    'total_raw': 0,
                    'after_basic_filters': 0,
                    'after_type_filter': 0,
                },
                'aggregation': {
                    'rows': [],
                    'groups': [],
                },
                'lookback': {
                    'window_start': None,
                    'window_end': as_of_date,
                    'included_dates': [],
                    'excluded_dates': [],
                },
                'contribution_table': {
                    'rows': [],
                    'final_threshold': 0.0,
                },
                'duplicates': [],
                'data_loss': {
                    'eligible_raw': 0,
                    'included_raw': 0,
                    'dropped_raw': 0,
                    'dropped_rows': [],
                },
                'entity_merge': {
                    'accounts': [],
                },
                'config_snapshot': {
                    'transaction_type': cfg.transaction_type,
                    'aggregation_level': cfg.aggregation_level,
                    'lookback_days': cfg.lookback_days,
                    'grouping_keys': [],
                },
                'certificate': 'No transactions found for this entity.',
            }
        else:
            df_work = df_entity.copy()
            df_work['transaction_datetime'] = pd.to_datetime(df_work['transaction_datetime'], errors='coerce')
            df_work['transaction_amount'] = pd.to_numeric(df_work['transaction_amount'], errors='coerce')
            mask_dt = df_work['transaction_datetime'].notna()
            mask_amt = df_work['transaction_amount'].notna()
            mask_acc = df_work['account_id'].notna()
            base_ok = mask_dt & mask_amt & mask_acc
            tx_type = str(cfg.transaction_type or 'ALL').upper()
            if tx_type != 'ALL':
                norm_tx = df_work['transaction_type'].astype(str).map(_normalize_tx_type)
                mask_type = norm_tx == _normalize_tx_type(tx_type)
            else:
                mask_type = pd.Series(True, index=df_work.index)
            as_of_ts = pd.to_datetime(as_of_date, errors='coerce')
            if pd.isna(as_of_ts):
                raise ValueError('invalid as_of_date')
            window_start = as_of_ts - pd.Timedelta(days=int(cfg.lookback_days))
            mask_window = (df_work['transaction_datetime'] >= window_start) & (df_work['transaction_datetime'] <= as_of_ts)
            eligible = base_ok & mask_type & mask_window
            raw_view = df_entity.copy()
            raw_view['transaction_datetime'] = df_work['transaction_datetime']
            raw_view['transaction_amount'] = df_work['transaction_amount']
            raw_view['included_step2'] = eligible
            reason = pd.Series('', index=df_work.index, dtype=object)
            invalid_dt = ~mask_dt
            invalid_amt = mask_dt & ~mask_amt
            missing_id = mask_dt & mask_amt & ~mask_acc
            reason[invalid_dt] = 'invalid_datetime'
            reason[invalid_amt] = 'invalid_amount'
            reason[missing_id] = 'missing_id'
            reason[base_ok & ~mask_type] = 'wrong_type'
            reason[base_ok & mask_type & ~mask_window] = 'outside_lookback_window'
            reason[eligible] = 'included'
            raw_view['exclusion_reason'] = reason
            total_raw = int(len(raw_view))
            after_basic = int(base_ok.sum())
            after_type = int((base_ok & mask_type).sum())
            df_filtered = df_work[base_ok & mask_type].copy()
            agg_level = str(cfg.aggregation_level or 'daily').lower()
            has_customer_id = 'customer_id' in df_filtered.columns and bool(df_filtered['customer_id'].notna().all())
            if not has_customer_id:
                df_filtered['customer_id'] = pd.NA
            id_keys = ['account_id', 'customer_id'] if has_customer_id else ['account_id']
            if agg_level == 'daily':
                df_stage = df_filtered.assign(
                    month_last_date=df_filtered['transaction_datetime'].dt.to_period('M').dt.to_timestamp('M') + pd.Timedelta(days=1)
                )
                group_cols = [*id_keys, 'transaction_datetime', 'month_last_date']
                step_daily_level = (
                    df_stage
                    .groupby(group_cols, as_index=False, dropna=False)
                    .agg(total_daily_amount=('transaction_amount', 'sum'))
                )
            elif agg_level == 'monthly':
                df_stage = df_filtered.assign(
                    month_last_date=df_filtered['transaction_datetime'].dt.to_period('M').dt.to_timestamp('M') + pd.Timedelta(days=1),
                    month_start=df_filtered['transaction_datetime'].dt.to_period('M').dt.to_timestamp(),
                )
                group_cols = [*id_keys, 'month_start', 'month_last_date']
                step_daily_level = (
                    df_stage
                    .groupby(group_cols, as_index=False, dropna=False)
                    .agg(total_daily_amount=('transaction_amount', 'sum'))
                    .rename(columns={'month_start': 'transaction_datetime'})
                )
            else:
                raise ValueError('aggregation_level must be daily or monthly')
            if 'customer_id' not in step_daily_level.columns:
                step_daily_level['customer_id'] = pd.NA
            df_stage_keys = df_stage.copy()
            if agg_level == 'monthly':
                df_stage_keys = df_stage_keys.rename(columns={'month_start': 'transaction_datetime'})
            def _make_key_row(r):
                vals = [str(r[k]) for k in id_keys]
                vals.append(pd.to_datetime(r['transaction_datetime']).isoformat() if pd.notna(r['transaction_datetime']) else '')
                vals.append(pd.to_datetime(r['month_last_date']).isoformat() if pd.notna(r['month_last_date']) else '')
                return '|'.join(vals)
            df_stage_keys['group_key'] = df_stage_keys.apply(_make_key_row, axis=1)
            step_daily_level['group_key'] = step_daily_level.apply(_make_key_row, axis=1)
            group_to_rows: Dict[str, Any] = {}
            for idx, r in df_stage_keys.iterrows():
                k = r['group_key']
                if k not in group_to_rows:
                    group_to_rows[k] = []
                group_to_rows[k].append(int(idx))
            step_daily_level_window = step_daily_level[
                (step_daily_level['transaction_datetime'] >= window_start)
                & (step_daily_level['transaction_datetime'] <= as_of_ts)
            ].copy()
            included_dates = sorted(
                {pd.to_datetime(d).isoformat() for d in step_daily_level_window['transaction_datetime'] if pd.notna(d)}
            )
            all_dates = sorted(
                {pd.to_datetime(d).isoformat() for d in step_daily_level['transaction_datetime'] if pd.notna(d)}
            )
            excluded_dates = [d for d in all_dates if d not in included_dates]
            agg_rows = []
            for _, r in step_daily_level_window.iterrows():
                k = r['group_key']
                src_rows = group_to_rows.get(k, [])
                agg_rows.append(
                    {
                        'account_id': str(r['account_id']) if r['account_id'] is not None else None,
                        'customer_id': str(r['customer_id']) if r['customer_id'] is not None else None,
                        'transaction_datetime': pd.to_datetime(r['transaction_datetime']).isoformat() if pd.notna(r['transaction_datetime']) else None,
                        'month_last_date': pd.to_datetime(r['month_last_date']).isoformat() if pd.notna(r['month_last_date']) else None,
                        'total_daily_amount': float(r['total_daily_amount']) if r['total_daily_amount'] is not None else 0.0,
                        'source_row_indices': src_rows,
                    }
                )
            contribution_rows = []
            final_threshold = 0.0
            for r in agg_rows:
                amt = float(r['total_daily_amount'])
                final_threshold += amt
                contribution_rows.append(
                    {
                        'transaction_datetime': r['transaction_datetime'],
                        'aggregated_amount': amt,
                        'reason': f"within lookback window {window_start.isoformat()} to {as_of_ts.isoformat()}",
                    }
                )
            duplicates = []
            if len(df_filtered) > 0:
                dup_counts = (
                    df_filtered.groupby(['transaction_datetime', 'transaction_amount'])
                    .size()
                    .reset_index(name='count')
                )
                dup_counts = dup_counts[dup_counts['count'] > 1]
                for _, r in dup_counts.iterrows():
                    duplicates.append(
                        {
                            'transaction_datetime': pd.to_datetime(r['transaction_datetime']).isoformat() if pd.notna(r['transaction_datetime']) else None,
                            'transaction_amount': float(r['transaction_amount']) if r['transaction_amount'] is not None else None,
                            'count': int(r['count']),
                        }
                    )
            eligible_raw = int(eligible.sum())
            included_raw = eligible_raw
            dropped_raw = 0
            dropped_rows = []
            accounts_merge = sorted({str(a) for a in df_filtered['account_id'].dropna().astype(str).unique().tolist()})
            grouping_keys = id_keys + ['transaction_datetime']
            config_snapshot = {
                'transaction_type': cfg.transaction_type,
                'aggregation_level': cfg.aggregation_level,
                'lookback_days': int(cfg.lookback_days),
                'grouping_keys': grouping_keys,
            }
            certificate = f"The threshold value {final_threshold:.2f} is reproducible from the transactions listed in the contribution table."
            raw_view_out = raw_view.copy()
            if 'transaction_datetime' in raw_view_out.columns:
                raw_view_out['transaction_datetime'] = raw_view_out['transaction_datetime'].apply(
                    lambda v: v.isoformat() if isinstance(v, pd.Timestamp) and pd.notna(v) else None
                )
            artifact = {
                'entity_id': entity_id_str,
                'entity_level': entity_level,
                'as_of_date': as_of_ts.isoformat(),
                'raw_view': raw_view_out.to_dict('records'),
                'filter_impact': {
                    'total_raw': total_raw,
                    'after_basic_filters': after_basic,
                    'after_type_filter': after_type,
                },
                'aggregation': {
                    'rows': agg_rows,
                    'groups': agg_rows,
                },
                'lookback': {
                    'window_start': window_start.isoformat(),
                    'window_end': as_of_ts.isoformat(),
                    'included_dates': included_dates,
                    'excluded_dates': excluded_dates,
                },
                'contribution_table': {
                    'rows': contribution_rows,
                    'final_threshold': final_threshold,
                },
                'duplicates': duplicates,
                'data_loss': {
                    'eligible_raw': eligible_raw,
                    'included_raw': included_raw,
                    'dropped_raw': dropped_raw,
                    'dropped_rows': dropped_rows,
                },
                'entity_merge': {
                    'accounts': accounts_merge,
                },
                'config_snapshot': config_snapshot,
                'certificate': certificate,
            }
        conn = duckdb.connect(str(self.db_path))
        try:
            recon_id = conn.execute("SELECT nextval('cortex_recon_seq')").fetchone()[0]
            conn.execute(
                """
                INSERT INTO cortex_reconstruction_runs (recon_id, run_id, entity_level, entity_id, as_of_date, created_by)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    int(recon_id),
                    int(run_id),
                    str(entity_level),
                    entity_id_str,
                    artifact.get('as_of_date'),
                    created_by,
                ],
            )
            conn.execute(
                """
                INSERT INTO cortex_reconstruction_artifacts (recon_id, payload_json)
                VALUES (?, ?)
                """,
                [int(recon_id), json.dumps(artifact)],
            )
        finally:
            conn.close()
        result = dict(artifact)
        result['recon_id'] = int(recon_id)
        return result

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
