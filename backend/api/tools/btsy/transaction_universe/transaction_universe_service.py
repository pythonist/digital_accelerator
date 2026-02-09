# backend/api/tools/btsy/transaction_universe/transaction_universe_service.py
"""
Transaction Universe Service - Step 1 (UPDATED: Supports BOTH transaction_type and transaction_category)
"""
import hashlib
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import duckdb
import pandas as pd

logger = logging.getLogger(__name__)
try:
    import pyarrow  # type: ignore
    _PARQUET_ENGINE = "pyarrow"
except Exception:
    try:
        import fastparquet  # type: ignore
        _PARQUET_ENGINE = "fastparquet"
    except Exception:
        _PARQUET_ENGINE = None


class TransactionUniverseService:
    """Manages transaction universe definition and materialization"""
    
    def __init__(self, db_path: Path, snapshot_storage_path: Path, audit_service=None):
        self.db_path = db_path
        self.snapshot_storage_path = snapshot_storage_path
        self.audit_service = audit_service
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
    
    def _ensure_schema(self):
        """Initialize universe tables - FIXED: Auto-increment DEFAULT"""
        conn = duckdb.connect(str(self.db_path))
        
        try:
            # Create sequence
            conn.execute("CREATE SEQUENCE IF NOT EXISTS universe_runs_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS universe_audit_seq START 1")
            
            # FIXED: Add DEFAULT nextval() to PRIMARY KEY
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transaction_universe_runs (
                  id INTEGER PRIMARY KEY DEFAULT nextval('universe_runs_seq'),
                  calibration_run_id INTEGER,
                  run_id TEXT,
                  scenario_id TEXT,
                  snapshot_id TEXT NOT NULL,
                  universe_name TEXT NOT NULL,
                  universe_description TEXT,
                  filter_spec TEXT NOT NULL,
                  spec_hash TEXT NOT NULL,
                  transaction_count INTEGER NOT NULL,
                  unique_accounts INTEGER,
                  unique_customers INTEGER,
                  date_range_start TIMESTAMP,
                  date_range_end TIMESTAMP,
                  category_breakdown TEXT,
                  total_amount DECIMAL(20,2),
                  avg_amount DECIMAL(20,2),
                  min_amount DECIMAL(20,2),
                  max_amount DECIMAL(20,2),
                  status TEXT CHECK (status IN ('draft','frozen')) NOT NULL DEFAULT 'draft',
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  created_by TEXT,
                  frozen_at TIMESTAMP,
                  frozen_by TEXT,
                  parquet_path TEXT,
                  parquet_hash TEXT,
                  parquet_size_bytes BIGINT,
                  selected BOOLEAN DEFAULT FALSE,
                  selected_at TIMESTAMP,
                  selection_reason TEXT
                )
            """)
            
            # FIXED: Add DEFAULT nextval() to audit table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS universe_audit_log (
                  id INTEGER PRIMARY KEY DEFAULT nextval('universe_audit_seq'),
                  universe_run_id INTEGER NOT NULL,
                  event_type TEXT NOT NULL,
                  event_data TEXT,
                  performed_by TEXT,
                  performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            info = conn.execute("PRAGMA table_info('transaction_universe_runs')").fetchall()
            col = next((r for r in info if r[1] == 'calibration_run_id'), None)
            if col and int(col[3] or 0) == 1:
                conn.execute("DROP INDEX IF EXISTS idx_universe_calibration")
                conn.execute("DROP INDEX IF EXISTS idx_universe_snapshot")
                conn.execute("DROP INDEX IF EXISTS idx_universe_status")
                try:
                    conn.execute("ALTER TABLE transaction_universe_runs ALTER COLUMN calibration_run_id DROP NOT NULL")
                except Exception:
                    conn.execute("""
                        CREATE TABLE transaction_universe_runs__new (
                          id INTEGER PRIMARY KEY DEFAULT nextval('universe_runs_seq'),
                          calibration_run_id INTEGER,
                          snapshot_id TEXT NOT NULL,
                          universe_name TEXT NOT NULL,
                          universe_description TEXT,
                          filter_spec TEXT NOT NULL,
                          spec_hash TEXT NOT NULL,
                          transaction_count INTEGER NOT NULL,
                          unique_accounts INTEGER,
                          unique_customers INTEGER,
                          date_range_start TIMESTAMP,
                          date_range_end TIMESTAMP,
                          category_breakdown TEXT,
                          total_amount DECIMAL(20,2),
                          avg_amount DECIMAL(20,2),
                          min_amount DECIMAL(20,2),
                          max_amount DECIMAL(20,2),
                          status TEXT CHECK (status IN ('draft','frozen')) NOT NULL DEFAULT 'draft',
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                          created_by TEXT,
                          frozen_at TIMESTAMP,
                          frozen_by TEXT,
                          parquet_path TEXT,
                          parquet_hash TEXT,
                          parquet_size_bytes BIGINT
                        )
                    """)
                    conn.execute("""
                        INSERT INTO transaction_universe_runs__new (
                          id, calibration_run_id, snapshot_id, universe_name, universe_description,
                          filter_spec, spec_hash, transaction_count, unique_accounts, unique_customers,
                          date_range_start, date_range_end, category_breakdown,
                          total_amount, avg_amount, min_amount, max_amount,
                          status, created_at, created_by, frozen_at, frozen_by,
                          parquet_path, parquet_hash, parquet_size_bytes
                        )
                        SELECT
                          id, calibration_run_id, snapshot_id, universe_name, universe_description,
                          filter_spec, spec_hash, transaction_count, unique_accounts, unique_customers,
                          date_range_start, date_range_end, category_breakdown,
                          total_amount, avg_amount, min_amount, max_amount,
                          status, created_at, created_by, frozen_at, frozen_by,
                          parquet_path, parquet_hash, parquet_size_bytes
                        FROM transaction_universe_runs
                    """)
                    conn.execute("DROP TABLE transaction_universe_runs")
                    conn.execute("ALTER TABLE transaction_universe_runs__new RENAME TO transaction_universe_runs")
                    next_id = int(conn.execute("SELECT COALESCE(MAX(id), 0) + 1 FROM transaction_universe_runs").fetchone()[0] or 1)
                    conn.execute(f"ALTER SEQUENCE universe_runs_seq RESTART WITH {next_id}")

            conn.execute("CREATE INDEX IF NOT EXISTS idx_universe_calibration ON transaction_universe_runs(calibration_run_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_universe_scenario ON transaction_universe_runs(scenario_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_universe_snapshot ON transaction_universe_runs(snapshot_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_universe_status ON transaction_universe_runs(status)")
            try:
                conn.execute("ALTER TABLE transaction_universe_runs ADD COLUMN run_id TEXT")
            except Exception:
                pass
            conn.execute("CREATE INDEX IF NOT EXISTS idx_universe_runid ON transaction_universe_runs(run_id)")
            
            logger.info(f"[UNIVERSE] Schema ensured at {self.db_path}")
        except Exception as e:
            logger.error(f"[UNIVERSE] Schema creation error: {e}")
        finally:
            conn.close()
        conn = duckdb.connect(str(self.db_path))
        try:
            try:
                conn.execute("ALTER TABLE transaction_universe_runs ADD COLUMN run_id TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE transaction_universe_runs ADD COLUMN scenario_id TEXT")
            except Exception:
                pass
            
            # Add missing selection columns
            try:
                conn.execute("ALTER TABLE transaction_universe_runs ADD COLUMN selected BOOLEAN DEFAULT FALSE")
            except Exception:
                pass
            
            try:
                conn.execute("ALTER TABLE transaction_universe_runs ADD COLUMN selected_at TIMESTAMP")
            except Exception:
                pass
                
            try:
                conn.execute("ALTER TABLE transaction_universe_runs ADD COLUMN selection_reason TEXT")
            except Exception:
                pass
        finally:
            conn.close()
    
    def _compute_filter_hash(self, filter_spec: Dict) -> str:
        """Compute deterministic hash of filter spec"""
        spec_json = json.dumps(filter_spec, sort_keys=True)
        return hashlib.sha256(spec_json.encode()).hexdigest()[:16]

    def _normalize_tx_type(self, value: str) -> str:
        v = str(value).strip().upper()
        if v in ('DR', 'D', 'DEBIT', 'DBIT'):
            return 'DEBIT'
        if v in ('CR', 'C', 'CREDIT', 'CRDT'):
            return 'CREDIT'
        return v
    
    def _load_snapshot_transactions(self, snapshot_id: str) -> pd.DataFrame:
        """Load normalized transactions from snapshot"""
        if not snapshot_id:
            raise ValueError("snapshot_id is required")
        
        from api.tools.btsy.snapshot_manager import SnapshotManager
        mgr = SnapshotManager(self.snapshot_storage_path.parent / "duckdb" / "snapshots.duckdb")
        snap = mgr.get_snapshot(str(snapshot_id))
        tx_file = None
        ext_file = None
        if snap:
            for d in (snap.get("domains") or []):
                if d.get("domain") == "transactions" and d.get("normalized_file_path"):
                    tx_file = Path(d["normalized_file_path"])
                    ext_file = Path(d["extensions_file_path"]) if d.get("extensions_file_path") else None
                    break
        if tx_file is None:
            tx_file = self.snapshot_storage_path.parent / "normalized" / str(snapshot_id) / "transactions.parquet"
            ext_file = self.snapshot_storage_path.parent / "normalized" / str(snapshot_id) / "transactions_extensions.parquet"
        
        if not tx_file.exists():
            raise FileNotFoundError(f"Transaction file not found: {tx_file}")
        
        conn = duckdb.connect()
        if ext_file and ext_file.exists():
            df = conn.execute(
                f"""
                SELECT t.*, e.extensions
                FROM read_parquet('{tx_file}') t
                LEFT JOIN read_parquet('{ext_file}') e
                ON t.transaction_id = e.transaction_id
                """
            ).df()
        else:
            df = conn.execute(f"SELECT * FROM read_parquet('{tx_file}')").df()
        conn.close()
        
        logger.info(f"[UNIVERSE] Loaded {len(df)} transactions from snapshot {snapshot_id}")
        return df

    def _resolve_snapshot_domain_path(self, snapshot_id: str, domain: str) -> Path:
        from api.tools.btsy.snapshot_manager import SnapshotManager
        mgr = SnapshotManager(self.snapshot_storage_path.parent / "duckdb" / "snapshots.duckdb")
        snap = mgr.get_snapshot(str(snapshot_id))
        if snap:
            for d in (snap.get("domains") or []):
                if d.get("domain") == domain and d.get("normalized_file_path"):
                    return Path(d["normalized_file_path"])
        return self.snapshot_storage_path.parent / "normalized" / str(snapshot_id) / f"{domain}.parquet"
    
    def data_foundation_summary(self, snapshot_id: str) -> Dict:
        """Summarize base tables and merge coverage for UI Step 0."""
        import duckdb
        tx_path = self._resolve_snapshot_domain_path(snapshot_id, 'transactions')
        acc_path = self._resolve_snapshot_domain_path(snapshot_id, 'accounts')
        cust_path = self._resolve_snapshot_domain_path(snapshot_id, 'customers')
        conn = duckdb.connect()
        try:
            def cnt(p: Path) -> int:
                if p and p.exists():
                    ps = str(p).replace("'", "''")
                    return int(conn.execute(f"SELECT COUNT(*) FROM read_parquet('{ps}')").fetchone()[0] or 0)
                return 0
            tx_count = cnt(tx_path)
            acc_count = cnt(acc_path)
            cust_count = cnt(cust_path)
            merged_coverage = None
            if tx_path.exists() and acc_path.exists():
                txs = str(tx_path).replace("'", "''")
                accs = str(acc_path).replace("'", "''")
                # Left join to measure customer_id coverage post-merge
                row = conn.execute(f"""
                    SELECT 
                      COUNT(*) AS total_rows,
                      SUM(CASE WHEN c.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS with_customer
                    FROM read_parquet('{txs}') t
                    LEFT JOIN read_parquet('{accs}') c
                    ON CAST(t.account_id AS VARCHAR) = CAST(c.account_id AS VARCHAR)
                """).fetchone()
                total_rows = int(row[0] or 0) if row else 0
                with_customer = int(row[1] or 0) if row else 0
                pct = float(with_customer / total_rows * 100.0) if total_rows else 0.0
                merged_coverage = {'total_rows': total_rows, 'with_customer_rows': with_customer, 'coverage_pct': round(pct, 2)}
            return {
                'snapshot_id': snapshot_id,
                'transactions_count': tx_count,
                'accounts_count': acc_count,
                'customers_count': cust_count,
                'merge_customer_coverage': merged_coverage
            }
        finally:
            conn.close()
    
    def merged_preview(self, snapshot_id: str, limit: int = 10) -> Dict:
        import duckdb
        tx = self._resolve_snapshot_domain_path(snapshot_id, 'transactions')
        acc = self._resolve_snapshot_domain_path(snapshot_id, 'accounts')
        cus = self._resolve_snapshot_domain_path(snapshot_id, 'customers')
        s = self._resolve_snapshot_domain_path(snapshot_id, 'str')
        conn = duckdb.connect()
        try:
            def exists(p): return p is not None and p.exists()
            txs = str(tx).replace("'", "''")
            q_base = f"SELECT * FROM read_parquet('{txs}')"
            if exists(acc):
                accs = str(acc).replace("'", "''")
                q_base = f"""
                    SELECT t.*, a.account_type, a.account_open_date, a.account_status, a.account_close_date,
                           a.dormancy_flag, a.last_dormant_date, a.internal_watchlist_flag AS internal_watchlist_flag_acct
                    FROM ({q_base}) t
                    LEFT JOIN read_parquet('{accs}') a
                    ON CAST(t.account_id AS VARCHAR) = CAST(a.account_id AS VARCHAR)
                """
            if exists(cus):
                cuss = str(cus).replace("'", "''")
                q_base = f"""
                    SELECT x.*, c.income_bracket, c.kyc_status, c.pep_flag, c.sanction_flag,
                           c.internal_watchlist_flag AS internal_watchlist_flag_cust,
                           c.customer_risk_rating, c.dob_or_incorporation_date, c.customer_segment
                    FROM ({q_base}) x
                    LEFT JOIN read_parquet('{cuss}') c
                    ON CAST(x.customer_id AS VARCHAR) = CAST(c.customer_id AS VARCHAR)
                """
            if exists(s):
                ss = str(s).replace("'", "''")
                q_base = f"""
                    SELECT y.*, s.str_filed_date,
                           CASE WHEN s.str_filed_date IS NOT NULL THEN 1 ELSE 0 END AS str_filed_flag
                    FROM ({q_base}) y
                    LEFT JOIN read_parquet('{ss}') s
                    ON CAST(y.account_id AS VARCHAR) = CAST(s.account_id AS VARCHAR)
                """
            rows = conn.execute(f"{q_base} LIMIT {int(limit)}").df().to_dict(orient="records")
            return {"rows": rows, "limit": int(limit)}
        finally:
            conn.close()

    def _normalize_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()

        if 'transaction_datetime' not in out.columns and 'transaction_date' in out.columns:
            out = out.rename(columns={'transaction_date': 'transaction_datetime'})

        if 'transaction_datetime' not in out.columns:
            raise KeyError("transaction_datetime column missing")
        out['transaction_datetime'] = pd.to_datetime(out['transaction_datetime'], errors='coerce')

        if 'transaction_amount' not in out.columns:
            raise KeyError("transaction_amount column missing")
        out['transaction_amount'] = pd.to_numeric(out['transaction_amount'], errors='coerce')

        if 'transaction_type' in out.columns:
            out['transaction_type'] = out['transaction_type'].astype(str).map(self._normalize_tx_type)
        else:
            if 'transaction_direction' in out.columns:
                out['transaction_type'] = out['transaction_direction'].astype(str).map(self._normalize_tx_type)
            else:
                # Derive from amount sign as a fallback
                out['transaction_type'] = out['transaction_amount'].apply(
                    lambda x: 'DEBIT' if x < 0 else ('CREDIT' if x > 0 else 'UNKNOWN')
                )

        return out

    def _maybe_enrich_customer_id(self, df: pd.DataFrame, snapshot_id: str) -> pd.DataFrame:
        if 'customer_id' in df.columns and df['customer_id'].notna().any():
            return df

        try:
            accounts_path = self._resolve_snapshot_domain_path(snapshot_id, 'accounts')
            if not accounts_path.exists():
                return df

            conn = duckdb.connect()
            try:
                accounts_path_sql = str(accounts_path).replace("'", "''")
                acc_df = conn.execute(
                    f"SELECT account_id, customer_id FROM read_parquet('{accounts_path_sql}')"
                ).df()
            finally:
                conn.close()

            if 'account_id' not in acc_df.columns or 'customer_id' not in acc_df.columns:
                return df

            acc_df = acc_df.dropna(subset=['account_id']).drop_duplicates(subset=['account_id'])

            df = df.copy()
            df['account_id'] = df['account_id'].astype(str)
            acc_df['account_id'] = acc_df['account_id'].astype(str)

            if 'customer_id' in df.columns:
                df = df.merge(acc_df, on='account_id', how='left', suffixes=('', '_acct'))
                df['customer_id'] = df['customer_id'].fillna(df.get('customer_id_acct'))
                if 'customer_id_acct' in df.columns:
                    df = df.drop(columns=['customer_id_acct'])
            else:
                df = df.merge(acc_df, on='account_id', how='left')

            return df
        except Exception:
            return df
    
    def _apply_filters(self, df: pd.DataFrame, filter_spec: Dict) -> pd.DataFrame:
        """
        Apply transaction-native filters
        UPDATED: Now handles BOTH transaction_type and transaction_category
        """
        import pandas as pd
        
        filtered = df.copy()
        initial_count = len(filtered)
        
        # NEW: Transaction type filter (CREDIT/DEBIT)
        if filter_spec.get('types'):
            types = [self._normalize_tx_type(t) for t in filter_spec['types']]
            logger.info(f"[FILTER] Applying transaction_type filter: {types}")
            if 'transaction_type' in filtered.columns:
                filtered = filtered[filtered['transaction_type'].map(self._normalize_tx_type).isin(types)]
            else:
                logger.warning("[FILTER] transaction_type column not found, skipping type filter")
        
        # Transaction category filter (RTGS/NEFT/CHEQUE/etc)
        if filter_spec.get('categories'):
            categories = filter_spec['categories']
            logger.info(f"[FILTER] Applying transaction_category filter: {categories}")
            if 'transaction_category' in filtered.columns:
                filtered = filtered[filtered['transaction_category'].isin(categories)]
            else:
                logger.warning("[FILTER] transaction_category column not found, skipping category filter")
        
        # Amount range - ensure numeric
        if filter_spec.get('amount_min') is not None:
            amount_min = float(filter_spec['amount_min'])
            filtered = filtered[pd.to_numeric(filtered['transaction_amount'], errors='coerce') >= amount_min]
            
        if filter_spec.get('amount_max') is not None:
            amount_max = float(filter_spec['amount_max'])
            filtered = filtered[pd.to_numeric(filtered['transaction_amount'], errors='coerce') <= amount_max]
        
        # Date range - ensure datetime
        if filter_spec.get('date_start'):
            date_start = pd.to_datetime(filter_spec['date_start'])
            filtered = filtered[pd.to_datetime(filtered['transaction_datetime'], errors='coerce') >= date_start]
            
        if filter_spec.get('date_end'):
            date_end = pd.to_datetime(filter_spec['date_end'])
            filtered = filtered[pd.to_datetime(filtered['transaction_datetime'], errors='coerce') <= date_end]
        
        # Remove any rows with NaT or NaN from filtering
        filtered = filtered.dropna(subset=['transaction_datetime', 'transaction_amount'])
        
        # Optional de-duplication
        dedup_by = filter_spec.get('deduplicate_by')
        if isinstance(dedup_by, list) and dedup_by:
            dedup_cols = [c for c in dedup_by if c in filtered.columns]
            if dedup_cols:
                filtered = filtered.drop_duplicates(subset=dedup_cols, keep='first')
        elif filter_spec.get('deduplicate') is True:
            base_cols = [c for c in ['account_id', 'customer_id', 'transaction_datetime'] if c in filtered.columns]
            if base_cols:
                filtered = filtered.drop_duplicates(subset=base_cols, keep='first')
        
        final_count = len(filtered)
        logger.info(f"[FILTER] Filtered: {initial_count} -> {final_count} transactions")
        
        return filtered
    
    def _compute_metrics(self, df: pd.DataFrame) -> Dict:
        """Compute universe metrics - FIXED: Convert strings to numeric first"""
        import pandas as pd
        import numpy as np
        
        if len(df) == 0:
            return {
                'transaction_count': 0,
                'unique_accounts': 0,
                'unique_customers': 0,
                'date_range_start': None,
                'date_range_end': None,
                'total_amount': 0.0,
                'avg_amount': 0.0,
                'min_amount': 0.0,
                'max_amount': 0.0,
                'category_breakdown': {}
            }
        
        # CRITICAL FIX: Convert transaction_amount to numeric FIRST
        df_copy = df.copy()
        df_copy['transaction_amount'] = pd.to_numeric(df_copy['transaction_amount'], errors='coerce')
        
        # Remove any NaN amounts
        df_copy = df_copy.dropna(subset=['transaction_amount'])
        
        if len(df_copy) == 0:
            return {
                'transaction_count': len(df),
                'unique_accounts': 0,
                'unique_customers': 0,
                'date_range_start': None,
                'date_range_end': None,
                'total_amount': 0.0,
                'avg_amount': 0.0,
                'min_amount': 0.0,
                'max_amount': 0.0,
                'category_breakdown': {}
            }
        
        metrics = {
            'transaction_count': len(df),
            'unique_accounts': int(df_copy['account_id'].nunique()) if 'account_id' in df_copy.columns else 0,
            'unique_customers': int(df_copy['customer_id'].nunique()) if 'customer_id' in df_copy.columns else 0,
            'date_range_start': pd.to_datetime(df_copy['transaction_datetime']).min(),
            'date_range_end': pd.to_datetime(df_copy['transaction_datetime']).max(),
            'total_amount': float(df_copy['transaction_amount'].sum()),
            'avg_amount': float(df_copy['transaction_amount'].mean()),
            'min_amount': float(df_copy['transaction_amount'].min()),
            'max_amount': float(df_copy['transaction_amount'].max())
        }
        
        # Category breakdown
        if 'transaction_category' in df_copy.columns:
            category_counts = df_copy['transaction_category'].value_counts().to_dict()
            metrics['category_breakdown'] = {str(k): int(v) for k, v in category_counts.items()}
        else:
            metrics['category_breakdown'] = {}
        
        return metrics
    
    def _save_parquet(self, df: pd.DataFrame, universe_name: str, snapshot_id: str) -> Dict:
        """Save filtered transactions to parquet"""
        import hashlib
        
        # Create output directory
        output_dir = self.snapshot_storage_path.parent / 'universes' / snapshot_id
        output_dir.mkdir(parents=True, exist_ok=True)
        
        # Generate filename
        safe_name = "".join(c if c.isalnum() or c in "_ " else "_" for c in universe_name)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{safe_name}_{timestamp}.parquet"
        
        parquet_path = output_dir / filename
        
        # Save to parquet
        if _PARQUET_ENGINE:
            df.to_parquet(parquet_path, index=False, engine=_PARQUET_ENGINE)
        else:
            df.to_parquet(parquet_path, index=False)
        
        # Compute hash
        file_hash = hashlib.md5(parquet_path.read_bytes()).hexdigest()
        file_size = parquet_path.stat().st_size
        
        logger.info(f"[UNIVERSE] Saved {len(df)} transactions to {parquet_path}")
        
        return {
            'parquet_path': str(parquet_path),
            'parquet_hash': file_hash,
            'parquet_size_bytes': file_size
        }
    
    def create_universe(
        self,
        calibration_run_id: Optional[int],
        run_id: Optional[str],
        scenario_id: Optional[str],
        snapshot_id: str,
        universe_name: str,
        filter_spec: Dict,
        description: str = None,
        created_by: str = 'user'
    ) -> Dict:
        """Create a new transaction universe (draft status)"""
        start_time = time.time()
        
        try:
            # Load transactions
            df = self._load_snapshot_transactions(snapshot_id)
            df = self._normalize_columns(df)
            
            # Apply filters
            filtered_df = self._apply_filters(df, filter_spec)
            filtered_df = self._maybe_enrich_customer_id(filtered_df, snapshot_id)
            
            if len(filtered_df) == 0:
                raise ValueError("Filters resulted in zero transactions")
            
            # Compute metrics
            metrics = self._compute_metrics(filtered_df)
            
            # Save to parquet
            parquet_info = self._save_parquet(filtered_df, universe_name, snapshot_id)
            
            # Compute spec hash
            spec_hash = self._compute_filter_hash(filter_spec)
            
            # Insert into database - FIXED: Let DEFAULT handle ID
            conn = duckdb.connect(str(self.db_path))
            
            try:
                conn.execute("""
                    INSERT INTO transaction_universe_runs (
                        calibration_run_id, run_id, scenario_id, snapshot_id, universe_name, universe_description,
                        filter_spec, spec_hash, transaction_count, unique_accounts, unique_customers,
                        date_range_start, date_range_end, category_breakdown,
                        total_amount, avg_amount, min_amount, max_amount,
                        status, created_by, parquet_path, parquet_hash, parquet_size_bytes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
                """, [
                    calibration_run_id, run_id, scenario_id, snapshot_id, universe_name, description,
                    json.dumps(filter_spec), spec_hash, metrics['transaction_count'],
                    metrics['unique_accounts'], metrics['unique_customers'],
                    metrics['date_range_start'], metrics['date_range_end'],
                    json.dumps(metrics['category_breakdown']),
                    metrics['total_amount'], metrics['avg_amount'],
                    metrics['min_amount'], metrics['max_amount'],
                    created_by, parquet_info['parquet_path'],
                    parquet_info['parquet_hash'], parquet_info['parquet_size_bytes']
                ])
                
                # Get the auto-generated ID
                universe_id = conn.execute("SELECT MAX(id) FROM transaction_universe_runs").fetchone()[0]
                
                # FIXED: Let DEFAULT handle audit ID
                conn.execute("""
                    INSERT INTO universe_audit_log (universe_run_id, event_type, performed_by)
                    VALUES (?, 'created', ?)
                """, [universe_id, created_by])
                
                duration = time.time() - start_time
                
                # Log to central audit service if available
                if self.audit_service and calibration_run_id:
                    self.audit_service.log_action(
                        calibration_run_id=calibration_run_id,
                        step_name='step1_universe',
                        action='create',
                        entity_type='universe',
                        entity_id=str(universe_id),
                        performed_by=created_by,
                        metadata={'transaction_count': metrics['transaction_count']},
                        duration_seconds=duration
                    )
                
                logger.info(f"[UNIVERSE] Created universe {universe_id} with {metrics['transaction_count']} transactions")
                
                return {
                    'universe_id': universe_id,
                    'metrics': metrics,
                    'status': 'draft'
                }
                
            finally:
                conn.close()
                
        except Exception as e:
            logger.error(f"[UNIVERSE] Failed to create universe: {e}", exc_info=True)
            raise
    
    def freeze_universe(self, universe_id: int, frozen_by: str = 'user') -> Dict:
        """Freeze a universe (make it immutable)"""
        start_time = time.time()
        conn = duckdb.connect(str(self.db_path))
        
        try:
            result = conn.execute("""
                SELECT status, calibration_run_id FROM transaction_universe_runs WHERE id = ?
            """, [universe_id]).fetchone()
            
            if not result:
                raise ValueError(f"Universe {universe_id} not found")
            
            if result[0] == 'frozen':
                raise ValueError(f"Universe {universe_id} is already frozen")
            
            calibration_run_id = result[1]
            
            conn.execute("""
                UPDATE transaction_universe_runs 
                SET status = 'frozen', frozen_at = CURRENT_TIMESTAMP, frozen_by = ?
                WHERE id = ?
            """, [frozen_by, universe_id])
            
            # FIXED: Let DEFAULT handle audit ID
            conn.execute("""
                INSERT INTO universe_audit_log (universe_run_id, event_type, performed_by)
                VALUES (?, 'frozen', ?)
            """, [universe_id, frozen_by])
            
            duration = time.time() - start_time
            
            # Log to central audit service if available
            if self.audit_service and calibration_run_id:
                self.audit_service.log_action(
                    calibration_run_id=calibration_run_id,
                    step_name='step1_universe',
                    action='freeze',
                    entity_type='universe',
                    entity_id=str(universe_id),
                    performed_by=frozen_by,
                    duration_seconds=duration
                )
            
            logger.info(f"[UNIVERSE] Frozen universe {universe_id}")
            
            return {'universe_id': universe_id, 'status': 'frozen'}
            
        finally:
            conn.close()
    
    def get_universe(self, universe_id: int) -> Optional[Dict]:
        """Get universe details"""
        conn = duckdb.connect(str(self.db_path))
        
        try:
            result = conn.execute("""
                SELECT 
                    id, universe_name, calibration_run_id, scenario_id, snapshot_id, status,
                    transaction_count, unique_accounts, unique_customers,
                    date_range_start, date_range_end, total_amount, category_breakdown,
                    created_at, created_by, frozen_at, frozen_by, parquet_path,
                    filter_spec, universe_description
                FROM transaction_universe_runs 
                WHERE id = ?
            """, [universe_id]).fetchone()
            
            if not result:
                return None
            
            universe = {
                'id': result[0],
                'universe_name': result[1],
                'calibration_run_id': result[2],
                'scenario_id': result[3],
                'snapshot_id': result[4],
                'status': result[5],
                'transaction_count': result[6],
                'unique_accounts': result[7],
                'unique_customers': result[8],
                'date_range_start': result[9],
                'date_range_end': result[10],
                'total_amount': result[11],
                'category_breakdown': json.loads(result[12]) if result[12] else {},
                'created_at': result[13],
                'created_by': result[14],
                'frozen_at': result[15],
                'frozen_by': result[16],
                'parquet_path': result[17],
                'filter_spec': json.loads(result[18]) if result[18] else {},
                'universe_description': result[19]
            }
            
            return universe
            
        finally:
            conn.close()

    def compute_thresholds(
        self,
        parquet_path: Path,
        transaction_type: str = "ALL",
        schedule: str = "daily",
        aggregation_level: str = "daily",
        lookback_days: int = 10,
        account_id: Optional[str] = None,
        limit_threshold_rows: int = 200,
        limit_worst_case: int = 20,
        limit_worst_single: int = 10,
        limit_monthly_rows: int = 200,
    ) -> Dict:
        if not parquet_path:
            raise ValueError("parquet_path is required")
        if lookback_days is None or int(lookback_days) <= 0:
            raise ValueError("lookback_days must be a positive integer")
        transaction_type = str(transaction_type or "ALL").upper()
        schedule = str(schedule or "daily").lower()
        aggregation_level = str(aggregation_level or "daily").lower()
        if schedule not in {"daily", "monthly"}:
            raise ValueError("schedule must be 'daily' or 'monthly'")
        if aggregation_level not in {"daily", "monthly"}:
            raise ValueError("aggregation_level must be 'daily' or 'monthly'")

        p_sql = str(parquet_path).replace("'", "''")
        base = f"read_parquet('{p_sql}')"

        tx_filter = ""
        if transaction_type != "ALL":
            transaction_type_sql = transaction_type.replace("'", "''")
            tx_filter = f"WHERE UPPER(CAST(transaction_type AS VARCHAR)) = '{transaction_type_sql}'"

        base_agg_level = "daily" if schedule == "monthly" else aggregation_level

        if base_agg_level == "daily":
            step_agg_sql = """
                SELECT
                    CAST(account_id AS VARCHAR) AS account_id,
                    CAST(customer_id AS VARCHAR) AS customer_id,
                    date_trunc('day', transaction_datetime) AS transaction_datetime,
                    (date_trunc('month', transaction_datetime) + INTERVAL '1 month') AS month_last_date,
                    SUM(transaction_amount) AS total_daily_amount
                FROM step1
                GROUP BY
                    CAST(account_id AS VARCHAR),
                    CAST(customer_id AS VARCHAR),
                    date_trunc('day', transaction_datetime),
                    (date_trunc('month', transaction_datetime) + INTERVAL '1 month')
            """
        else:
            step_agg_sql = """
                SELECT
                    CAST(account_id AS VARCHAR) AS account_id,
                    CAST(customer_id AS VARCHAR) AS customer_id,
                    date_trunc('month', transaction_datetime) AS transaction_datetime,
                    (date_trunc('month', transaction_datetime) + INTERVAL '1 month') AS month_last_date,
                    SUM(transaction_amount) AS total_daily_amount
                FROM step1
                GROUP BY
                    CAST(account_id AS VARCHAR),
                    CAST(customer_id AS VARCHAR),
                    date_trunc('month', transaction_datetime),
                    (date_trunc('month', transaction_datetime) + INTERVAL '1 month')
            """

        lookback_days_int = int(lookback_days)
        conn = duckdb.connect()
        try:
            conn.execute(f"""
                CREATE OR REPLACE TEMP VIEW step1_raw AS
                SELECT
                    CAST(account_id AS VARCHAR) AS account_id,
                    CAST(customer_id AS VARCHAR) AS customer_id,
                    TRY_CAST(transaction_datetime AS TIMESTAMP) AS transaction_datetime,
                    TRY_CAST(transaction_amount AS DOUBLE) AS transaction_amount,
                    UPPER(CAST(transaction_type AS VARCHAR)) AS transaction_type
                FROM {base}
                {tx_filter}
            """)

            conn.execute("""
                CREATE OR REPLACE TEMP VIEW step1 AS
                SELECT *
                FROM step1_raw
                WHERE transaction_datetime IS NOT NULL
                  AND transaction_amount IS NOT NULL
            """)
            step1_count = int(conn.execute("SELECT COUNT(1) FROM step1").fetchone()[0] or 0)

            conn.execute(f"CREATE OR REPLACE TEMP VIEW step_agg AS {step_agg_sql}")
            step_agg_count = int(conn.execute("SELECT COUNT(1) FROM step_agg").fetchone()[0] or 0)

            account_filter_sql = ""
            if account_id:
                account_id_sql = str(account_id).replace("'", "''")
                account_filter_sql = f"WHERE account_id = '{account_id_sql}'"

            if schedule == "daily":
                conn.execute(f"""
                    CREATE OR REPLACE TEMP VIEW lookback AS
                    SELECT
                        a.account_id AS account_id,
                        a.customer_id AS customer_id,
                        a.transaction_datetime AS transaction_datetime,
                        a.total_daily_amount AS total_daily_amount,
                        b.total_daily_amount AS amount_lookback,
                        b.transaction_datetime AS trxn_date_lookback
                    FROM step_agg a
                    JOIN step_agg b
                      ON a.account_id = b.account_id
                    WHERE b.transaction_datetime >= a.transaction_datetime - INTERVAL '{lookback_days_int} days'
                      AND b.transaction_datetime <= a.transaction_datetime
                """)

                lookback_count = int(conn.execute("SELECT COUNT(1) FROM lookback").fetchone()[0] or 0)

                conn.execute("""
                    CREATE OR REPLACE TEMP VIEW threshold_table AS
                    SELECT
                        account_id,
                        customer_id,
                        transaction_datetime,
                        SUM(amount_lookback) AS threshold_amt,
                        COUNT(1) AS trxn_count,
                        AVG(amount_lookback) AS avg_amt,
                        MAX(amount_lookback) AS max_amt,
                        MIN(amount_lookback) AS min_amt
                    FROM lookback
                    GROUP BY account_id, customer_id, transaction_datetime
                """)

                threshold_count = int(conn.execute("SELECT COUNT(1) FROM threshold_table").fetchone()[0] or 0)
                threshold_stats = conn.execute("""
                    SELECT
                        COUNT(DISTINCT account_id) AS unique_accounts,
                        COUNT(1) AS total_periods,
                        AVG(threshold_amt) AS avg_threshold,
                        MEDIAN(threshold_amt) AS median_threshold,
                        MAX(threshold_amt) AS max_threshold,
                        MIN(threshold_amt) AS min_threshold,
                        STDDEV_SAMP(threshold_amt) AS std_threshold
                    FROM threshold_table
                """).fetchone()

                if account_id:
                    series_df = conn.execute(f"""
                        SELECT
                            account_id,
                            customer_id,
                            transaction_datetime,
                            threshold_amt,
                            trxn_count
                        FROM threshold_table
                        {account_filter_sql}
                        ORDER BY transaction_datetime ASC NULLS LAST
                    """).df()
                    threshold_rows_df = series_df
                else:
                    series_df = None
                    threshold_rows_df = conn.execute(f"""
                        SELECT
                            account_id,
                            customer_id,
                            transaction_datetime,
                            threshold_amt,
                            trxn_count,
                            avg_amt,
                            max_amt,
                            min_amt
                        FROM threshold_table
                        ORDER BY threshold_amt DESC NULLS LAST
                        LIMIT {int(limit_threshold_rows)}
                    """).df()

                worst_case_df = conn.execute(f"""
                    SELECT
                        account_id,
                        COUNT(1) AS count_periods,
                        SUM(threshold_amt) AS total_threshold,
                        AVG(threshold_amt) AS avg_threshold,
                        MAX(threshold_amt) AS max_threshold,
                        MIN(threshold_amt) AS min_threshold,
                        SUM(trxn_count) AS total_trxn_count
                    FROM threshold_table
                    GROUP BY account_id
                    ORDER BY total_threshold DESC NULLS LAST
                    LIMIT {int(limit_worst_case)}
                """).df()

                worst_single_df = conn.execute(f"""
                    SELECT
                        account_id,
                        customer_id,
                        transaction_datetime,
                        threshold_amt,
                        trxn_count
                    FROM threshold_table
                    ORDER BY threshold_amt DESC NULLS LAST
                    LIMIT {int(limit_worst_single)}
                """).df()

                return {
                    "config": {
                        "transaction_type": transaction_type,
                        "schedule": schedule,
                        "aggregation_level": aggregation_level,
                        "lookback_days": lookback_days_int,
                        "account_id": str(account_id) if account_id else None,
                    },
                    "counts": {
                        "step1_rows": step1_count,
                        "step1_5_rows": step_agg_count,
                        "step2_rows": lookback_count,
                        "step3_rows": threshold_count,
                    },
                    "threshold_table": {
                        "rows": threshold_rows_df.to_dict(orient="records"),
                        "total_rows": threshold_count,
                    },
                    "series": series_df.to_dict(orient="records") if series_df is not None else None,
                    "worst_case": worst_case_df.to_dict(orient="records"),
                    "worst_single": worst_single_df.to_dict(orient="records"),
                    "statistics": {
                        "unique_accounts": int(threshold_stats[0] or 0) if threshold_stats else 0,
                        "total_periods": int(threshold_stats[1] or 0) if threshold_stats else 0,
                        "avg_threshold": float(threshold_stats[2] or 0.0) if threshold_stats else 0.0,
                        "median_threshold": float(threshold_stats[3] or 0.0) if threshold_stats else 0.0,
                        "max_threshold": float(threshold_stats[4] or 0.0) if threshold_stats else 0.0,
                        "min_threshold": float(threshold_stats[5] or 0.0) if threshold_stats else 0.0,
                        "std_threshold": float(threshold_stats[6] or 0.0) if threshold_stats else 0.0,
                    },
                }

            conn.execute(f"""
                CREATE OR REPLACE TEMP VIEW monthly_threshold AS
                SELECT
                    account_id,
                    month_last_date,
                    SUM(total_daily_amount) AS threshold_amt,
                    COUNT(1) AS transaction_count
                FROM step_agg
                WHERE transaction_datetime >= month_last_date - INTERVAL '{lookback_days_int} days'
                  AND transaction_datetime <= month_last_date
                GROUP BY account_id, month_last_date
            """)

            monthly_count = int(conn.execute("SELECT COUNT(1) FROM monthly_threshold").fetchone()[0] or 0)

            monthly_stats = conn.execute("""
                SELECT
                    COUNT(DISTINCT account_id) AS unique_accounts,
                    COUNT(1) AS total_periods,
                    AVG(threshold_amt) AS avg_threshold,
                    MEDIAN(threshold_amt) AS median_threshold,
                    MAX(threshold_amt) AS max_threshold,
                    MIN(threshold_amt) AS min_threshold,
                    STDDEV_SAMP(threshold_amt) AS std_threshold
                FROM monthly_threshold
            """).fetchone()

            if account_id:
                monthly_series_df = conn.execute(f"""
                    SELECT
                        account_id,
                        month_last_date,
                        threshold_amt,
                        transaction_count
                    FROM monthly_threshold
                    {account_filter_sql}
                    ORDER BY month_last_date ASC NULLS LAST
                """).df()
                monthly_rows_df = monthly_series_df
            else:
                monthly_series_df = None
                monthly_rows_df = conn.execute(f"""
                    SELECT
                        account_id,
                        month_last_date,
                        threshold_amt,
                        transaction_count
                    FROM monthly_threshold
                    ORDER BY threshold_amt DESC NULLS LAST
                    LIMIT {int(limit_monthly_rows)}
                """).df()

            worst_case_df = conn.execute(f"""
                SELECT
                    account_id,
                    COUNT(1) AS count_periods,
                    SUM(threshold_amt) AS total_threshold,
                    AVG(threshold_amt) AS avg_threshold,
                    MAX(threshold_amt) AS max_threshold,
                    MIN(threshold_amt) AS min_threshold,
                    SUM(transaction_count) AS total_trxn_count
                FROM monthly_threshold
                GROUP BY account_id
                ORDER BY total_threshold DESC NULLS LAST
                LIMIT {int(limit_worst_case)}
            """).df()

            worst_single_df = conn.execute(f"""
                SELECT
                    account_id,
                    month_last_date,
                    threshold_amt,
                    transaction_count
                FROM monthly_threshold
                ORDER BY threshold_amt DESC NULLS LAST
                LIMIT {int(limit_worst_single)}
            """).df()

            return {
                "config": {
                    "transaction_type": transaction_type,
                    "schedule": schedule,
                    "aggregation_level": aggregation_level,
                    "lookback_days": lookback_days_int,
                    "account_id": str(account_id) if account_id else None,
                },
                "counts": {
                    "step1_rows": step1_count,
                    "step1_5_rows": step_agg_count,
                    "step2_rows": None,
                    "step3_rows": monthly_count,
                },
                "monthly_threshold": {
                    "rows": monthly_rows_df.to_dict(orient="records"),
                    "total_rows": monthly_count,
                },
                "series": monthly_series_df.to_dict(orient="records") if monthly_series_df is not None else None,
                "worst_case": worst_case_df.to_dict(orient="records"),
                "worst_single": worst_single_df.to_dict(orient="records"),
                "statistics": {
                    "unique_accounts": int(monthly_stats[0] or 0) if monthly_stats else 0,
                    "total_periods": int(monthly_stats[1] or 0) if monthly_stats else 0,
                    "avg_threshold": float(monthly_stats[2] or 0.0) if monthly_stats else 0.0,
                    "median_threshold": float(monthly_stats[3] or 0.0) if monthly_stats else 0.0,
                    "max_threshold": float(monthly_stats[4] or 0.0) if monthly_stats else 0.0,
                    "min_threshold": float(monthly_stats[5] or 0.0) if monthly_stats else 0.0,
                    "std_threshold": float(monthly_stats[6] or 0.0) if monthly_stats else 0.0,
                },
            }
        finally:
            conn.close()
    
    def list_universes(
        self, 
        calibration_run_id: int = None,
        snapshot_id: str = None,
        status: str = None
    ) -> List[Dict]:
        """List universes with filters"""
        conn = duckdb.connect(str(self.db_path))
        
        try:
            query = """
                SELECT 
                    id, universe_name, calibration_run_id, scenario_id, snapshot_id, status,
                    transaction_count, unique_accounts, unique_customers,
                    date_range_start, date_range_end, total_amount, category_breakdown,
                    created_at, created_by, filter_spec, universe_description
                FROM transaction_universe_runs 
                WHERE 1=1
            """
            params = []
            
            if calibration_run_id:
                query += " AND calibration_run_id = ?"
                params.append(calibration_run_id)
            
            if snapshot_id:
                query += " AND snapshot_id = ?"
                params.append(snapshot_id)
            
            if status:
                query += " AND status = ?"
                params.append(status)
            
            query += " ORDER BY created_at DESC"
            
            results = conn.execute(query, params).fetchall()
            
            logger.info(f"[UNIVERSE] List query returned {len(results)} universes (calibration_run_id={calibration_run_id})")
            
            universes = []
            for row in results:
                universe = {
                    'id': row[0],
                    'universe_name': row[1],
                    'calibration_run_id': row[2],
                    'scenario_id': row[3],
                    'snapshot_id': row[4],
                    'status': row[5],
                    'transaction_count': row[6],
                    'unique_accounts': row[7],
                    'unique_customers': row[8],
                    'date_range_start': row[9],
                    'date_range_end': row[10],
                    'total_amount': row[11],
                    'category_breakdown': json.loads(row[12]) if row[12] else {},
                    'created_at': row[13],
                    'created_by': row[14],
                    'filter_spec': json.loads(row[15]) if row[15] else {},
                    'universe_description': row[16]
                }
                universes.append(universe)
            
            return universes
            
        finally:
            conn.close()
    
    def delete_universe(self, universe_id: int, calibration_run_id: int = None) -> bool:
        """Delete universe (only if draft)"""
        start_time = time.time()
        conn = duckdb.connect(str(self.db_path))
        
        try:
            result = conn.execute("""
                SELECT status, parquet_path, calibration_run_id FROM transaction_universe_runs WHERE id = ?
            """, [universe_id]).fetchone()
            
            if not result:
                return False
            
            if result[0] == 'frozen':
                raise ValueError("Cannot delete frozen universe")
            
            calibration_run_id = result[2]
            
            if result[1]:
                parquet_path = Path(result[1])
                if parquet_path.exists():
                    parquet_path.unlink()
            
            conn.execute("DELETE FROM universe_audit_log WHERE universe_run_id = ?", [universe_id])
            conn.execute("DELETE FROM transaction_universe_runs WHERE id = ?", [universe_id])
            
            duration = time.time() - start_time
            
            # Log to central audit service if available
            if self.audit_service and calibration_run_id:
                self.audit_service.log_action(
                    calibration_run_id=calibration_run_id,
                    step_name='step1_universe',
                    action='delete',
                    entity_type='universe',
                    entity_id=str(universe_id),
                    performed_by='user',
                    duration_seconds=duration
                )
            
            logger.info(f"[UNIVERSE] Deleted universe {universe_id}")
            return True
            
        finally:
            conn.close()
