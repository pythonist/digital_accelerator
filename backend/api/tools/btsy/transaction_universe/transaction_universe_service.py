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
            
            logger.info(f"[UNIVERSE] Schema ensured at {self.db_path}")
        except Exception as e:
            logger.error(f"[UNIVERSE] Schema creation error: {e}")
        finally:
            conn.close()
        conn = duckdb.connect(str(self.db_path))
        try:
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
            types = filter_spec['types']
            logger.info(f"[FILTER] Applying transaction_type filter: {types}")
            if 'transaction_type' in filtered.columns:
                filtered = filtered[filtered['transaction_type'].isin(types)]
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
        df.to_parquet(parquet_path, index=False, engine='pyarrow')
        
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
            
            # Apply filters
            filtered_df = self._apply_filters(df, filter_spec)
            
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
                        calibration_run_id, scenario_id, snapshot_id, universe_name, universe_description,
                        filter_spec, spec_hash, transaction_count, unique_accounts, unique_customers,
                        date_range_start, date_range_end, category_breakdown,
                        total_amount, avg_amount, min_amount, max_amount,
                        status, created_by, parquet_path, parquet_hash, parquet_size_bytes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
                """, [
                    calibration_run_id, scenario_id, snapshot_id, universe_name, description,
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
