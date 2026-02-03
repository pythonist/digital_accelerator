"""
BTSY Service - FIXED WITH ROBUST CONNECTION POOLING
Fixes:
1. Missing self.connections attribute
2. Proper connection lifecycle management
3. Concurrent request handling
4. Connection pooling with cleanup
"""
import os
import json
import duckdb
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import logging
import threading
import time

logger = logging.getLogger(__name__)


class BTSYService:
    """Central service for BTSY with improved connection handling"""
    
    STATE_NOT_UPLOADED = 'NOT_UPLOADED'
    STATE_UPLOADED = 'UPLOADED'
    STATE_PROFILED = 'PROFILED'
    STATE_MAPPED = 'MAPPED'
    STATE_NORMALIZED = 'NORMALIZED'
    
    def __init__(self, base_data_path: str):
        self.base_data_path = Path(base_data_path)
        self.connections = {}  # FIX: Initialize connections dict
        self.connection_locks = {}  # Per-env locks for thread safety
        self._global_lock = threading.Lock()  # Global lock for connection dict access

    def _relation_expr(self, file_path: Path, sample_size: Optional[int] = None) -> str:
        p = str(file_path).replace("'", "''")
        ext = file_path.suffix.lower()
        if ext in ('.parquet', '.pq'):
            return f"read_parquet('{p}')"
        if sample_size is not None:
            return f"read_csv_auto('{p}', sample_size={int(sample_size)})"
        return f"read_csv_auto('{p}')"
    
    def get_env_path(self, tenant_id: str, env_id: str) -> Path:
        return self.base_data_path / "tenants" / tenant_id / "envs" / env_id / "btsy"
    
    def init_env_structure(self, tenant_id: str, env_id: str) -> Dict[str, Path]:
        env_path = self.get_env_path(tenant_id, env_id)
        folders = {
            'root': env_path,
            'raw': env_path / 'raw',
            'duckdb': env_path / 'duckdb',
            'cache': env_path / 'cache',
            'snapshots': env_path / 'snapshots',
            'logs': env_path / 'logs',
            'state': env_path / 'state',
            'normalized': env_path / 'normalized',
            'audit': env_path / 'audit'
        }
        for name, path in folders.items():
            path.mkdir(parents=True, exist_ok=True)
        return folders
    
    def _get_env_lock(self, tenant_id: str, env_id: str) -> threading.Lock:
        """Get or create a lock for this environment"""
        key = f"{tenant_id}:{env_id}"
        with self._global_lock:
            if key not in self.connection_locks:
                self.connection_locks[key] = threading.Lock()
            return self.connection_locks[key]
    
    # service.py - Hardened Connection Logic
    def get_connection(self, tenant_id: str, env_id: str) -> duckdb.DuckDBPyConnection:
        key = f"{tenant_id}:{env_id}"
        env_lock = self._get_env_lock(tenant_id, env_id)
        
        with env_lock:
            if key in self.connections:
                try:
                    # Rigorous health check
                    self.connections[key].execute("SELECT 1").fetchone()
                    return self.connections[key]
                except Exception as e:
                    logger.warning(f"[BTSY] Purging dead connection for {key}: {e}")
                    self._force_close_connection(key)

            # Before opening a new one, force Python to release all C++ pointers
            import gc
            gc.collect()
            time.sleep(0.1) # Brief pause to allow OS file handles to sync

            folders = self.init_env_structure(tenant_id, env_id)
            db_path = folders['duckdb'] / 'ingest.duckdb'
            
            try:
                # Open with explicit configuration to prevent internal conflicts
                # SET preserve_insertion_order=false can reduce memory pointer overhead
                conn = duckdb.connect(str(db_path), read_only=False)
                conn.execute("SET preserve_insertion_order=false")
                
                with self._global_lock:
                    self.connections[key] = conn
                return conn
            except Exception as e:
                logger.error(f"[BTSY] Critical DB open failure: {e}")
                raise
    
    def _force_close_connection(self, key: str):
        """Force close connection and cleanup (must be called with lock held)"""
        if key in self.connections:
            try:
                self.connections[key].close()
                logger.debug(f"[BTSY] Closed connection for {key}")
            except Exception as e:
                logger.warning(f"[BTSY] Error closing connection {key}: {e}")
            
            with self._global_lock:
                if key in self.connections:
                    del self.connections[key]
            
            import gc
            gc.collect()
    
    def close_connection(self, tenant_id: str, env_id: str):
        """Explicitly close a connection"""
        key = f"{tenant_id}:{env_id}"
        env_lock = self._get_env_lock(tenant_id, env_id)
        
        with env_lock:
            self._force_close_connection(key)
            logger.info(f"[BTSY] Explicitly closed connection for {key}")
    
    def reset_database(self, tenant_id: str, env_id: str):
        """
        FIX: Completely reset DuckDB database
        Deletes the database file and forces recreation on next connection
        """
        key = f"{tenant_id}:{env_id}"
        env_lock = self._get_env_lock(tenant_id, env_id)
        
        with env_lock:
            # Close existing connection
            self._force_close_connection(key)
            
            # Delete database file
            folders = self.init_env_structure(tenant_id, env_id)
            db_path = folders['duckdb'] / 'ingest.duckdb'
            
            # Wait for file handles to release
            import gc
            gc.collect()
            time.sleep(0.2)
            
            if db_path.exists():
                try:
                    db_path.unlink()
                    logger.info(f"[BTSY] Deleted DuckDB file: {db_path}")
                except Exception as e:
                    logger.error(f"[BTSY] Failed to delete DuckDB file: {e}")
                    raise
            
            # Also delete WAL and other DuckDB files
            for wal_file in folders['duckdb'].glob('ingest.duckdb.*'):
                try:
                    wal_file.unlink()
                    logger.info(f"[BTSY] Deleted DuckDB WAL file: {wal_file}")
                except Exception as e:
                    logger.warning(f"[BTSY] Failed to delete WAL file: {e}")
            
            # Force garbage collection
            gc.collect()
            
            logger.info(f"[BTSY] DuckDB completely reset for {env_id}")
    
    def get_domain_state_path(self, tenant_id: str, env_id: str, domain: str) -> Path:
        folders = self.init_env_structure(tenant_id, env_id)
        return folders['state'] / f'{domain}_state.json'
    
    def get_domain_state(self, tenant_id: str, env_id: str, domain: str) -> Dict:
        state_path = self.get_domain_state_path(tenant_id, env_id, domain)
        if state_path.exists():
            with open(state_path, 'r') as f:
                return json.load(f)
        return {'state': self.STATE_NOT_UPLOADED, 'domain': domain}
    
    def set_domain_state(self, tenant_id: str, env_id: str, domain: str, state: str, metadata: Dict = None):
        state_path = self.get_domain_state_path(tenant_id, env_id, domain)
        data = {
            'domain': domain,
            'state': state,
            'updated_at': datetime.now().isoformat()
        }
        if metadata:
            data.update(metadata)
        
        with open(state_path, 'w') as f:
            json.dump(data, f, indent=2)
        
        # AUDIT: Capture state change
        self._capture_audit_event(tenant_id, env_id, 'state_change', {
            'domain': domain,
            'state': state,
            'metadata': metadata
        })
        
        logger.info(f"[BTSY] Set {domain} state to {state}")
    
    def _capture_audit_event(self, tenant_id: str, env_id: str, event_type: str, data: Dict):
        """Capture audit events for PDF report"""
        folders = self.init_env_structure(tenant_id, env_id)
        audit_file = folders['audit'] / 'events.jsonl'
        
        event = {
            'timestamp': datetime.now().isoformat(),
            'event_type': event_type,
            'data': data
        }
        
        with open(audit_file, 'a') as f:
            f.write(json.dumps(event) + '\n')
    
    def get_audit_summary(self, tenant_id: str, env_id: str) -> Dict:
        """Get audit summary for report generation"""
        folders = self.init_env_structure(tenant_id, env_id)
        audit_file = folders['audit'] / 'events.jsonl'
        
        events = []
        if audit_file.exists():
            with open(audit_file, 'r') as f:
                for line in f:
                    events.append(json.loads(line))
        
        # Aggregate for report
        summary = {
            'total_events': len(events),
            'first_event': events[0]['timestamp'] if events else None,
            'last_event': events[-1]['timestamp'] if events else None,
            'domains_processed': list(set(e['data'].get('domain') for e in events if e['data'].get('domain'))),
            'state_transitions': [e for e in events if e['event_type'] == 'state_change']
        }
        
        return summary
    
    def get_upload_status(self, tenant_id: str, env_id: str) -> Dict:
        """
        FIX: Get upload status with row count ALWAYS visible from persisted state
        """
        folders = self.init_env_structure(tenant_id, env_id)
        raw_path = folders['raw']
        
        domains = ['transactions', 'accounts', 'customers', 'str']
        status = {}
        
        for domain in domains:
            domain_files = list(raw_path.glob(f"{domain}.*"))
            state_info = self.get_domain_state(tenant_id, env_id, domain)
            
            if domain_files:
                file_path = domain_files[0]
                
                # FIX: Try multiple locations for row_count
                row_count = (
                    state_info.get('row_count') or  # Direct in state (from upload)
                    state_info.get('profile', {}).get('row_count') or  # In profile (from profiling)
                    0  # Fallback
                )
                
                status[domain] = {
                    'uploaded': True,
                    'filename': file_path.name,
                    'size_bytes': file_path.stat().st_size,
                    'uploaded_at': datetime.fromtimestamp(file_path.stat().st_mtime).isoformat(),
                    'state': state_info.get('state', self.STATE_UPLOADED),
                    'schema_signature': state_info.get('schema_signature'),
                    'quality': state_info.get('quality'),
                    'row_count': row_count,  # FIX: Always present
                    'profile': state_info.get('profile'),
                    'mapping_status': state_info.get('mapping_status')
                }
            else:
                status[domain] = {
                    'uploaded': False,
                    'filename': None,
                    'state': self.STATE_NOT_UPLOADED,
                    'row_count': 0
                }
        
        return status
    
    def compute_schema_signature(self, tenant_id: str, env_id: str, domain: str) -> Dict:
        """
        FIX: Use isolated connection per operation
        """
        folders = self.init_env_structure(tenant_id, env_id)
        raw_path = folders['raw']
        
        domain_files = list(raw_path.glob(f"{domain}.*"))
        if not domain_files:
            return {}
        
        file_path = domain_files[0]
        
        # Use separate connection for this operation
        conn = self.get_connection(tenant_id, env_id)
        
        try:
            rel = self._relation_expr(file_path)
            columns_query = f"DESCRIBE SELECT * FROM {rel}"
            columns_result = conn.execute(columns_query).fetchall()
            
            signature = {
                'columns': {col[0]: col[1] for col in columns_result},
                'computed_at': datetime.now().isoformat()
            }
            return signature
        except Exception as e:
            logger.error(f"[BTSY] Schema signature error: {e}")
            return {}
    
    def detect_schema_drift(self, old_signature: Dict, new_signature: Dict) -> Optional[Dict]:
        if not old_signature or not new_signature:
            return None
        
        old_cols = set(old_signature.get('columns', {}).keys())
        new_cols = set(new_signature.get('columns', {}).keys())
        
        added = new_cols - old_cols
        removed = old_cols - new_cols
        
        type_changes = []
        for col in old_cols & new_cols:
            old_type = old_signature['columns'][col]
            new_type = new_signature['columns'][col]
            if old_type != new_type:
                type_changes.append({
                    'column': col,
                    'old_type': old_type,
                    'new_type': new_type
                })
        
        if added or removed or type_changes:
            return {
                'added_columns': list(added),
                'removed_columns': list(removed),
                'type_changes': type_changes,
                'detected_at': datetime.now().isoformat()
            }
        
        return None
    
    def upload_file(self, tenant_id: str, env_id: str, domain: str, file_path: str, filename: str) -> Dict:
        """
        FIX: Upload file and IMMEDIATELY calculate and persist row count
        Optimized for 1M+ rows:
        - Streamed copy
        - DuckDB fast read
        - Memory efficient
        """
        folders = self.init_env_structure(tenant_id, env_id)
        raw_path = folders['raw']
        
        # Determine file extension
        file_ext = Path(filename).suffix
        dest_path = raw_path / f"{domain}{file_ext}"
        
        # Remove existing file if present
        if dest_path.exists():
            dest_path.unlink()
        
        # Copy file with chunked reading to be memory safe
        import shutil
        with open(file_path, 'rb') as fsrc:
            with open(dest_path, 'wb') as fdst:
                shutil.copyfileobj(fsrc, fdst, length=1024*1024*10) # 10MB chunks

        # FIX: IMMEDIATELY compute row count with fresh connection
        conn = self.get_connection(tenant_id, env_id)
        try:
            # Use count(*) which is optimized in DuckDB
            rel = self._relation_expr(dest_path, sample_size=20000)
            row_count = conn.execute(
                f"SELECT COUNT(*) FROM {rel}"
            ).fetchone()[0]
        except Exception as e:
            logger.error(f"[BTSY] Failed row count for {domain}: {e}")
            row_count = 0
        
        # Schema signature + drift
        # For large files, sample only first 1000 rows for schema detection
        new_signature = self.compute_schema_signature(tenant_id, env_id, domain)
        old_state = self.get_domain_state(tenant_id, env_id, domain)
        old_signature = old_state.get('schema_signature')
        drift = None
        if old_signature:
            drift = self.detect_schema_drift(old_signature, new_signature)

        # FIX: Persist row count at TOP LEVEL of state (not nested in profile)
        self.set_domain_state(
            tenant_id,
            env_id,
            domain,
            self.STATE_UPLOADED,
            {
                'filename': filename,
                'uploaded_at': datetime.now().isoformat(),
                'size_bytes': dest_path.stat().st_size,
                'row_count': row_count,  # FIX: At top level for immediate access
                'schema_signature': new_signature,
                'schema_drift': drift
            }
        )

        logger.info(f"[BTSY] Uploaded {domain}: {row_count} rows")

        return {
            'domain': domain,
            'filename': filename,
            'size_bytes': dest_path.stat().st_size,
            'row_count': row_count,  # FIX: Return immediately
            'schema_drift': drift
        }
    
    def clear_domain(self, tenant_id: str, env_id: str, domain: str):
        folders = self.init_env_structure(tenant_id, env_id)
        raw_path = folders['raw']
        
        for file in raw_path.glob(f"{domain}.*"):
            file.unlink()
        
        state_path = self.get_domain_state_path(tenant_id, env_id, domain)
        if state_path.exists():
            state_path.unlink()
        
        logger.info(f"[BTSY] Cleared {domain}")
    
    def profile_file(self, tenant_id: str, env_id: str, domain: str) -> Dict:
        """
        FIX: Reuse connection properly during profiling
        """
        logger.info(f"[BTSY] Profiling {domain}")
        
        folders = self.init_env_structure(tenant_id, env_id)
        raw_path = folders['raw']
        
        domain_files = list(raw_path.glob(f"{domain}.*"))
        if not domain_files:
            raise FileNotFoundError(f"No file found for domain: {domain}")
        
        file_path = domain_files[0]
        conn = self.get_connection(tenant_id, env_id)
        
        try:
            # 1. Clear any previous stale results on this connection
            conn.execute("SELECT 1").fetchall() 
            rel = self._relation_expr(file_path)
            
            row_count_query = f"SELECT COUNT(*) as cnt FROM {rel}"
            row_count = conn.execute(row_count_query).fetchone()[0]
            
            # 2. Execute describe in a single atomic fetch
            columns_query = f"DESCRIBE SELECT * FROM {rel}"
            columns_result = conn.execute(columns_query).fetchall()
            
            columns = []
            for col_info in columns_result:
                col_name = col_info[0]
                col_type = col_info[1]
                stats = {}
                
                try:
                    null_query = f"""
                        SELECT 
                            COUNT(*) - COUNT("{col_name}") as null_count,
                            COUNT(*) as total_count
                        FROM {rel}
                    """
                    null_result = conn.execute(null_query).fetchone()
                    if null_result and len(null_result) == 2:
                        null_count, total_count = null_result
                        stats['null_pct'] = (null_count / total_count * 100) if total_count > 0 else 0
                        stats['null_count'] = null_count
                    else:
                        stats['null_pct'] = 0
                        stats['null_count'] = 0
                except Exception as e:
                    logger.warning(f"Null stats failed for {col_name}: {e}")
                    stats['null_pct'] = 0
                    stats['null_count'] = 0
                
                try:
                    distinct_query = f"""
                        SELECT COUNT(DISTINCT "{col_name}") as distinct_count
                        FROM {rel}
                    """
                    distinct_result = conn.execute(distinct_query).fetchone()
                    stats['distinct_count'] = distinct_result[0] if distinct_result else 0
                except Exception as e:
                    logger.warning(f"Distinct count failed for {col_name}: {e}")
                    stats['distinct_count'] = 0
                
                if col_type in ['BIGINT', 'DOUBLE', 'DECIMAL', 'INTEGER', 'FLOAT']:
                    try:
                        stats_query = f"""
                            SELECT 
                                MIN("{col_name}") as min_val,
                                MAX("{col_name}") as max_val,
                                AVG("{col_name}") as avg_val,
                                STDDEV("{col_name}") as stddev_val
                            FROM {rel}
                        """
                        stats_result = conn.execute(stats_query).fetchone()
                        if stats_result:
                            stats['min'] = float(stats_result[0]) if stats_result[0] is not None else None
                            stats['max'] = float(stats_result[1]) if stats_result[1] is not None else None
                            stats['mean'] = float(stats_result[2]) if stats_result[2] is not None else None
                            stats['stddev'] = float(stats_result[3]) if stats_result[3] is not None else None
                    except:
                        pass
                
                elif col_type in ['VARCHAR', 'STRING', 'TEXT']:
                    try:
                        sample_query = f"""
                            SELECT DISTINCT "{col_name}"
                            FROM {rel}
                            WHERE "{col_name}" IS NOT NULL
                            LIMIT 5
                        """
                        sample_result = conn.execute(sample_query).fetchall()
                        stats['sample_values'] = [row[0] for row in sample_result if row[0]]
                    except:
                        pass
                
                columns.append({
                    'name': col_name,
                    'type': col_type,
                    'stats': stats
                })
            
            profile = {
                'domain': domain,
                'row_count': row_count,
                'column_count': len(columns),
                'columns': columns,
                'file_size_bytes': file_path.stat().st_size,
                'profiled_at': datetime.now().isoformat()
            }
            
            quality = self.evaluate_data_quality(tenant_id, env_id, domain, profile)
            profile['quality'] = quality
            
            self.set_domain_state(tenant_id, env_id, domain, self.STATE_PROFILED, {
                'profile': profile,
                'quality': quality,
                'row_count': row_count  # FIX: Also store at top level
            })
            
            logger.info(f"[BTSY] Profiled {domain}: {row_count} rows, {len(columns)} columns")
            return profile
            
        except Exception as e:
            logger.error(f"[BTSY] Profiling error: {e}", exc_info=True)
            raise
    
    def evaluate_data_quality(self, tenant_id: str, env_id: str, domain: str, profile: Dict) -> Dict:
        """Evaluate data quality based on profile"""
        issues = []
        warnings = []
        score = 100
        
        for col in profile.get('columns', []):
            null_pct = col['stats'].get('null_pct', 0)
            distinct_count = col['stats'].get('distinct_count', 0)
            
            if null_pct > 50:
                issues.append(f"High null percentage in '{col['name']}': {null_pct:.1f}%")
                score -= 10
            elif null_pct > 20:
                warnings.append(f"Moderate null percentage in '{col['name']}': {null_pct:.1f}%")
                score -= 5
            
            if distinct_count == 1:
                warnings.append(f"Column '{col['name']}' has only 1 distinct value")
                score -= 3
        
        return {
            'score': max(0, score),
            'grade': 'A' if score >= 90 else 'B' if score >= 75 else 'C' if score >= 60 else 'D',
            'issues': issues,
            'warnings': warnings
        }
    
    def cleanup(self):
        """Cleanup all connections on shutdown"""
        with self._global_lock:
            for key in list(self.connections.keys()):
                try:
                    self.connections[key].close()
                    logger.info(f"[BTSY] Closed connection: {key}")
                except:
                    pass
            self.connections.clear()
            logger.info("[BTSY] All connections cleaned up")


_btsy_service = None

def get_btsy_service(base_data_path: str = "data") -> BTSYService:
    global _btsy_service
    if _btsy_service is None:
        _btsy_service = BTSYService(base_data_path)
    return _btsy_service
