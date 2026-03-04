# backend/api/tools/btsy/snapshot_manager.py
"""
Foundation Snapshot Manager - FIXED: PRIMARY KEY on snapshot_domains
"""
import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import duckdb
import secrets

logger = logging.getLogger(__name__)


class SnapshotManager:
    """Manages foundation snapshots"""
    
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_tables()
    
    def _ensure_tables(self):
        """Create snapshot tables"""
        conn = duckdb.connect(str(self.db_path))
        
        # Create sequence for auto-increment
        conn.execute("""
            CREATE SEQUENCE IF NOT EXISTS snapshot_domains_seq START 1
        """)
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS foundation_snapshots (
                snapshot_id TEXT PRIMARY KEY,
                env_id TEXT NOT NULL,
                tenant_id TEXT NOT NULL,
                snapshot_name TEXT,
                snapshot_hash TEXT NOT NULL,
                raw_hash TEXT NOT NULL,
                normalized_hash TEXT NOT NULL,
                schema_hash TEXT NOT NULL,
                total_domains INTEGER,
                total_input_rows INTEGER,
                total_output_rows INTEGER,
                quality_summary JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                frozen_by TEXT,
                status TEXT DEFAULT 'frozen',
                foundation_duration_ms INTEGER,
                domains_processed JSON
            )
        """)
        
        # FIXED: Added PRIMARY KEY to id column
        conn.execute("""
            CREATE TABLE IF NOT EXISTS snapshot_domains (
                id INTEGER PRIMARY KEY DEFAULT nextval('snapshot_domains_seq'),
                snapshot_id TEXT NOT NULL,
                domain TEXT NOT NULL,
                raw_file_path TEXT,
                raw_file_hash TEXT,
                raw_file_size INTEGER,
                normalized_file_path TEXT,
                normalized_file_hash TEXT,
                normalized_file_size INTEGER,
                extensions_file_path TEXT,
                input_rows INTEGER,
                output_rows INTEGER,
                validation_errors INTEGER,
                quality_score REAL,
                mapped_fields JSON,
                schema_signature JSON
            )
        """)

        conn.execute("CREATE SEQUENCE IF NOT EXISTS extension_attributes_seq START 1")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS extension_attributes (
              id INTEGER PRIMARY KEY DEFAULT nextval('extension_attributes_seq'),
              snapshot_id TEXT NOT NULL,
              entity_scope TEXT NOT NULL,
              source_column_name TEXT NOT NULL,
              display_name TEXT,
              data_type TEXT,
              status TEXT NOT NULL DEFAULT 'pending',
              locked BOOLEAN NOT NULL DEFAULT FALSE,
              version INTEGER NOT NULL DEFAULT 1,
              first_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_ext_attr_unique
            ON extension_attributes(snapshot_id, entity_scope, source_column_name)
        """)

        conn.execute("CREATE SEQUENCE IF NOT EXISTS field_type_audit_seq START 1")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS field_type_locks (
              env_id TEXT NOT NULL,
              tenant_id TEXT NOT NULL,
              snapshot_id TEXT NOT NULL,
              entity_scope TEXT NOT NULL,
              field_kind TEXT NOT NULL,
              field_key TEXT NOT NULL,
              source_column_name TEXT,
              proposed_type TEXT,
              locked_type TEXT,
              locked BOOLEAN NOT NULL DEFAULT FALSE,
              status TEXT NOT NULL DEFAULT 'pending',
              lock_version INTEGER NOT NULL DEFAULT 1,
              validation_checksum TEXT,
              validation_report JSON,
              locked_at TIMESTAMP,
              locked_by TEXT,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_field_type_lock_unique
            ON field_type_locks(env_id, tenant_id, entity_scope, field_kind, field_key)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS field_type_audit (
              id INTEGER PRIMARY KEY DEFAULT nextval('field_type_audit_seq'),
              env_id TEXT NOT NULL,
              tenant_id TEXT NOT NULL,
              entity_scope TEXT NOT NULL,
              field_kind TEXT NOT NULL,
              field_key TEXT NOT NULL,
              action TEXT NOT NULL,
              from_type TEXT,
              to_type TEXT,
              result TEXT,
              metadata JSON,
              performed_by TEXT,
              performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calibration_runs (
                run_id TEXT PRIMARY KEY,
                snapshot_id TEXT NOT NULL,
                run_name TEXT,
                run_type TEXT,
                parameters JSON,
                status TEXT DEFAULT 'pending',
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                results JSON,
                metrics JSON,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        try:
            conn.execute("ALTER TABLE foundation_snapshots ADD COLUMN snapshot_name TEXT")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE foundation_snapshots ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE snapshot_domains ADD COLUMN extensions_file_path TEXT")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE field_type_locks ADD COLUMN status TEXT")
        except Exception:
            pass
        
        conn.close()

    def get_latest_snapshot_id(self, env_id: str, tenant_id: str, status: str) -> Optional[str]:
        conn = duckdb.connect(str(self.db_path))
        try:
            row = conn.execute(
                """
                SELECT snapshot_id
                FROM foundation_snapshots
                WHERE env_id = ? AND tenant_id = ? AND LOWER(status) = LOWER(?)
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [str(env_id), str(tenant_id), str(status)],
            ).fetchone()
            return str(row[0]) if row and row[0] else None
        finally:
            conn.close()

    def upsert_extension_attributes(self, snapshot_id: str, entity_scope: str, attributes: List[Dict]) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        created = 0
        updated = 0
        try:
            for a in attributes:
                source = (a.get("source_column_name") or "").strip()
                if not source:
                    continue
                display = (a.get("display_name") or "").strip() or None
                data_type = (a.get("data_type") or "").strip() or None
                status = (a.get("status") or "pending").strip().lower()
                locked_in = a.get("locked")
                if locked_in is not None:
                    locked_in = bool(locked_in)
                if status not in ("pending", "active", "ignored"):
                    status = "pending"

                row = conn.execute(
                    """
                    SELECT locked
                    FROM extension_attributes
                    WHERE snapshot_id = ? AND entity_scope = ? AND source_column_name = ?
                    """,
                    [str(snapshot_id), str(entity_scope), source],
                ).fetchone()
                if row is not None:
                    if bool(row[0]):
                        continue
                    conn.execute(
                        """
                        UPDATE extension_attributes
                        SET display_name = COALESCE(?, display_name),
                            data_type = COALESCE(?, data_type),
                            status = ?,
                            locked = CASE WHEN ? IS NULL THEN locked ELSE ? END,
                            version = version + 1,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE snapshot_id = ? AND entity_scope = ? AND source_column_name = ?
                        """,
                        [display, data_type, status, locked_in, locked_in, str(snapshot_id), str(entity_scope), source],
                    )
                    updated += 1
                else:
                    conn.execute(
                        """
                        INSERT INTO extension_attributes (
                          snapshot_id, entity_scope, source_column_name, display_name, data_type, status, locked
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        [str(snapshot_id), str(entity_scope), source, display, data_type, status, bool(locked_in) if locked_in is not None else False],
                    )
                    created += 1
        finally:
            conn.close()
        return {"created": created, "updated": updated}

    def list_extension_attributes(self, snapshot_id: str, entity_scope: Optional[str] = None) -> List[Dict]:
        conn = duckdb.connect(str(self.db_path))
        try:
            if entity_scope:
                rows = conn.execute(
                    """
                    SELECT snapshot_id, entity_scope, source_column_name, display_name, data_type, status, locked, version, first_seen_at
                    FROM extension_attributes
                    WHERE snapshot_id = ? AND entity_scope = ?
                    ORDER BY status DESC, source_column_name ASC
                    """,
                    [str(snapshot_id), str(entity_scope)],
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT snapshot_id, entity_scope, source_column_name, display_name, data_type, status, locked, version, first_seen_at
                    FROM extension_attributes
                    WHERE snapshot_id = ?
                    ORDER BY entity_scope ASC, status DESC, source_column_name ASC
                    """,
                    [str(snapshot_id)],
                ).fetchall()
            return [
                {
                    "snapshot_id": r[0],
                    "entity_scope": r[1],
                    "source_column_name": r[2],
                    "display_name": r[3],
                    "data_type": r[4],
                    "status": r[5],
                    "locked": bool(r[6]),
                    "version": int(r[7] or 1),
                    "first_seen_at": str(r[8]) if r[8] is not None else None,
                }
                for r in rows
            ]
        finally:
            conn.close()

    def get_type_lock(
        self,
        env_id: str,
        tenant_id: str,
        entity_scope: str,
        field_kind: str,
        field_key: str,
    ) -> Optional[Dict]:
        conn = duckdb.connect(str(self.db_path))
        try:
            row = conn.execute(
                """
                SELECT snapshot_id, source_column_name, proposed_type, locked_type, locked, status,
                       lock_version, validation_checksum, locked_at, locked_by, updated_at
                FROM field_type_locks
                WHERE env_id = ? AND tenant_id = ? AND entity_scope = ? AND field_kind = ? AND field_key = ?
                """,
                [str(env_id), str(tenant_id), str(entity_scope), str(field_kind), str(field_key)],
            ).fetchone()
            if not row:
                return None
            return {
                "env_id": str(env_id),
                "tenant_id": str(tenant_id),
                "entity_scope": str(entity_scope),
                "field_kind": str(field_kind),
                "field_key": str(field_key),
                "snapshot_id": row[0],
                "source_column_name": row[1],
                "proposed_type": row[2],
                "locked_type": row[3],
                "locked": bool(row[4]),
                "status": row[5],
                "lock_version": int(row[6] or 1),
                "validation_checksum": row[7],
                "locked_at": str(row[8]) if row[8] is not None else None,
                "locked_by": row[9],
                "updated_at": str(row[10]) if row[10] is not None else None,
            }
        finally:
            conn.close()

    def upsert_type_lock(
        self,
        env_id: str,
        tenant_id: str,
        snapshot_id: str,
        entity_scope: str,
        field_kind: str,
        field_key: str,
        source_column_name: Optional[str],
        proposed_type: Optional[str],
        locked_type: Optional[str],
        locked: bool,
        status: str,
        validation_checksum: Optional[str],
        validation_report: Optional[Dict],
        performed_by: str = "user",
    ) -> Dict:
        conn = duckdb.connect(str(self.db_path))
        try:
            prev = conn.execute(
                """
                SELECT locked_type, lock_version, locked
                FROM field_type_locks
                WHERE env_id = ? AND tenant_id = ? AND entity_scope = ? AND field_kind = ? AND field_key = ?
                """,
                [str(env_id), str(tenant_id), str(entity_scope), str(field_kind), str(field_key)],
            ).fetchone()
            if prev:
                prev_type = prev[0]
                prev_ver = int(prev[1] or 1)
                next_ver = prev_ver + 1 if (locked_type and prev_type and str(locked_type) != str(prev_type)) else prev_ver
                conn.execute(
                    """
                    UPDATE field_type_locks
                    SET snapshot_id = ?,
                        source_column_name = ?,
                        proposed_type = ?,
                        locked_type = ?,
                        locked = ?,
                        status = ?,
                        lock_version = ?,
                        validation_checksum = ?,
                        validation_report = ?,
                        locked_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE locked_at END,
                        locked_by = CASE WHEN ? THEN ? ELSE locked_by END,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE env_id = ? AND tenant_id = ? AND entity_scope = ? AND field_kind = ? AND field_key = ?
                    """,
                    [
                        str(snapshot_id),
                        source_column_name,
                        proposed_type,
                        locked_type,
                        bool(locked),
                        status,
                        int(next_ver),
                        validation_checksum or secrets.token_hex(8),
                        json.dumps(validation_report) if validation_report is not None else None,
                        bool(locked),
                        bool(locked),
                        performed_by,
                        str(env_id),
                        str(tenant_id),
                        str(entity_scope),
                        str(field_kind),
                        str(field_key),
                    ],
                )
                conn.execute(
                    """
                    INSERT INTO field_type_audit (
                      env_id, tenant_id, entity_scope, field_kind, field_key, action, from_type, to_type, result, metadata, performed_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        str(env_id),
                        str(tenant_id),
                        str(entity_scope),
                        str(field_kind),
                        str(field_key),
                        "lock" if locked else "update",
                        prev_type,
                        locked_type,
                        status,
                        json.dumps(validation_report) if validation_report is not None else None,
                        performed_by,
                    ],
                )
                return {"lock_version": int(next_ver), "status": status}
            else:
                conn.execute(
                    """
                    INSERT INTO field_type_locks (
                      env_id, tenant_id, snapshot_id, entity_scope, field_kind, field_key,
                      source_column_name, proposed_type, locked_type, locked, status,
                      lock_version, validation_checksum, validation_report, locked_at, locked_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, CASE WHEN ? THEN ? ELSE NULL END)
                    """,
                    [
                        str(env_id),
                        str(tenant_id),
                        str(snapshot_id),
                        str(entity_scope),
                        str(field_kind),
                        str(field_key),
                        source_column_name,
                        proposed_type,
                        locked_type,
                        bool(locked),
                        status,
                        validation_checksum or secrets.token_hex(8),
                        json.dumps(validation_report) if validation_report is not None else None,
                        bool(locked),
                        bool(locked),
                        performed_by,
                    ],
                )
                conn.execute(
                    """
                    INSERT INTO field_type_audit (
                      env_id, tenant_id, entity_scope, field_kind, field_key, action, from_type, to_type, result, metadata, performed_by
                    ) VALUES (?, ?, ?, ?, ?, 'create', NULL, ?, ?, ?, ?)
                    """,
                    [
                        str(env_id),
                        str(tenant_id),
                        str(entity_scope),
                        str(field_kind),
                        str(field_key),
                        locked_type,
                        status,
                        json.dumps(validation_report) if validation_report is not None else None,
                        performed_by,
                    ],
                )
                return {"lock_version": 1, "status": status}
        finally:
            conn.close()

    def rename_snapshot(self, snapshot_id: str, snapshot_name: str) -> None:
        name = (snapshot_name or "").strip()
        if not name:
            raise ValueError("snapshot_name required")
        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute(
                "UPDATE foundation_snapshots SET snapshot_name = ?, updated_at = CURRENT_TIMESTAMP WHERE snapshot_id = ?",
                [name, str(snapshot_id)],
            )
        finally:
            conn.close()

    def create_draft_snapshot(self, tenant_id: str, env_id: str, snapshot_name: str, created_by: str) -> Dict:
        name = (snapshot_name or "").strip()
        if not name:
            raise ValueError("snapshot_name required")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        snapshot_id = f"DRAFT_{env_id}_{timestamp}"

        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute(
                """
                INSERT INTO foundation_snapshots (
                    snapshot_id, env_id, tenant_id, snapshot_name,
                    snapshot_hash, raw_hash, normalized_hash, schema_hash,
                    total_domains, total_input_rows, total_output_rows, quality_summary,
                    frozen_by, status, domains_processed
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    snapshot_id,
                    env_id,
                    tenant_id,
                    name,
                    "",
                    "",
                    "",
                    "",
                    0,
                    0,
                    0,
                    json.dumps({"domains": 0, "avg_quality": 0.0, "total_validation_errors": 0}),
                    created_by or "user",
                    "draft",
                    json.dumps([]),
                ],
            )
        finally:
            conn.close()

        return {
            "snapshot_id": snapshot_id,
            "snapshot_name": name,
            "env_id": env_id,
            "tenant_id": tenant_id,
            "created_at": datetime.now().isoformat(),
            "status": "draft",
            "total_domains": 0,
            "total_input_rows": 0,
            "total_output_rows": 0,
            "quality_summary": {"domains": 0, "avg_quality": 0.0, "total_validation_errors": 0},
        }
    
    def _compute_file_hash(self, file_path: Path) -> str:
        """Compute SHA256 hash"""
        if not file_path or not file_path.exists():
            return ""
        
        sha256 = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()
    
    def _compute_schema_hash(self, mapping_state: Dict) -> str:
        """Compute schema hash"""
        if not mapping_state:
            return ""
        
        schema_data = {
            'domain': mapping_state.get('domain', ''),
            'mappings': {}
        }
        
        for field in mapping_state.get('canonical_fields', []):
            if field.get('status') == 'mapped':
                schema_data['mappings'][field['canonical_name']] = {
                    'bank_column': field.get('mapped_column'),
                    'expected_type': field.get('expected_type')
                }
        
        schema_json = json.dumps(schema_data, sort_keys=True)
        return hashlib.sha256(schema_json.encode()).hexdigest()
    
    def create_snapshot(
        self,
        tenant_id: str,
        env_id: str,
        foundation_data: Dict,
        frozen_by: str,
        snapshot_id: Optional[str] = None,
        snapshot_name: Optional[str] = None,
    ) -> Dict:
        """Create snapshot"""
        logger.info(f"[SNAPSHOT] Creating snapshot for {tenant_id}/{env_id}")
        
        if snapshot_id:
            snapshot_id = str(snapshot_id)
        else:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            snapshot_id = f"FS_{env_id}_{timestamp}"
        snap_name = (snapshot_name or "").strip() or snapshot_id
        
        domain_details = []
        raw_hashes = []
        normalized_hashes = []
        schema_hashes = []
        
        total_input = 0
        total_output = 0
        domains_processed = []
        
        upload_status = foundation_data.get('upload_status', {})
        mappings = foundation_data.get('mappings', {})
        norm_results = foundation_data.get('normalization_results', {})
        
        for domain_key, upload_info in upload_status.items():
            if not upload_info or not upload_info.get('uploaded'):
                continue
            
            domains_processed.append(domain_key)
            
            raw_file_path = upload_info.get('raw_file_path')
            norm_result = norm_results.get(domain_key) or {}
            normalized_file_path = norm_result.get('output_file')
            extensions_file_path = norm_result.get('extensions_file')
            
            raw_hash = self._compute_file_hash(Path(raw_file_path)) if raw_file_path else ""
            norm_hash = self._compute_file_hash(Path(normalized_file_path)) if normalized_file_path else ""
            
            raw_hashes.append(raw_hash)
            normalized_hashes.append(norm_hash)
            
            mapping_state = mappings.get(domain_key)
            schema_hash = self._compute_schema_hash(mapping_state)
            schema_hashes.append(schema_hash)
            
            input_rows = norm_result.get('input_rows', 0) or 0
            output_rows = norm_result.get('output_rows', 0) or 0
            
            total_input += input_rows
            total_output += output_rows
            
            quality_info = upload_info.get('quality') or {}
            quality_score = quality_info.get('score', 0) if isinstance(quality_info, dict) else 0
            
            domain_details.append({
                'domain': domain_key,
                'raw_file_path': raw_file_path,
                'raw_file_hash': raw_hash,
                'raw_file_size': upload_info.get('size_bytes', 0) or 0,
                'normalized_file_path': normalized_file_path,
                'normalized_file_hash': norm_hash,
                'normalized_file_size': Path(normalized_file_path).stat().st_size if normalized_file_path and Path(normalized_file_path).exists() else 0,
                'extensions_file_path': extensions_file_path,
                'input_rows': input_rows,
                'output_rows': output_rows,
                'validation_errors': norm_result.get('validation_errors', 0) or 0,
                'quality_score': quality_score,
                'mapped_fields': mapping_state.get('canonical_fields', []) if mapping_state else [],
                'schema_signature': upload_info.get('schema_signature', {}) or {}
            })
        
        aggregate_raw_hash = hashlib.sha256(''.join(sorted(raw_hashes)).encode()).hexdigest()
        aggregate_norm_hash = hashlib.sha256(''.join(sorted(normalized_hashes)).encode()).hexdigest()
        aggregate_schema_hash = hashlib.sha256(''.join(sorted(schema_hashes)).encode()).hexdigest()
        
        snapshot_hash = hashlib.sha256(
            f"{aggregate_raw_hash}{aggregate_norm_hash}{aggregate_schema_hash}".encode()
        ).hexdigest()
        
        quality_summary = {
            'domains': len(domains_processed),
            'avg_quality': sum(d['quality_score'] for d in domain_details) / len(domain_details) if domain_details else 0,
            'total_validation_errors': sum(d['validation_errors'] for d in domain_details)
        }
        
        conn = duckdb.connect(str(self.db_path))
        
        try:
            # Start explicit transaction
            conn.execute("BEGIN TRANSACTION")
            
            existing = conn.execute(
                "SELECT 1 FROM foundation_snapshots WHERE snapshot_id = ?",
                [snapshot_id],
            ).fetchone()

            if existing:
                conn.execute(
                    "DELETE FROM snapshot_domains WHERE snapshot_id = ?",
                    [snapshot_id],
                )
                conn.execute(
                    """
                    UPDATE foundation_snapshots
                    SET
                      env_id = ?,
                      tenant_id = ?,
                      snapshot_name = ?,
                      snapshot_hash = ?,
                      raw_hash = ?,
                      normalized_hash = ?,
                      schema_hash = ?,
                      total_domains = ?,
                      total_input_rows = ?,
                      total_output_rows = ?,
                      quality_summary = ?,
                      frozen_by = ?,
                      status = ?,
                      domains_processed = ?,
                      updated_at = CURRENT_TIMESTAMP
                    WHERE snapshot_id = ?
                    """,
                    [
                        env_id,
                        tenant_id,
                        snap_name,
                        snapshot_hash,
                        aggregate_raw_hash,
                        aggregate_norm_hash,
                        aggregate_schema_hash,
                        len(domains_processed),
                        total_input,
                        total_output,
                        json.dumps(quality_summary),
                        frozen_by,
                        "locked",
                        json.dumps(domains_processed),
                        snapshot_id,
                    ],
                )
            else:
                conn.execute(
                    """
                    INSERT INTO foundation_snapshots (
                        snapshot_id, env_id, tenant_id, snapshot_name,
                        snapshot_hash, raw_hash, normalized_hash, schema_hash,
                        total_domains, total_input_rows, total_output_rows,
                        quality_summary, frozen_by, status, domains_processed
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        snapshot_id,
                        env_id,
                        tenant_id,
                        snap_name,
                        snapshot_hash,
                        aggregate_raw_hash,
                        aggregate_norm_hash,
                        aggregate_schema_hash,
                        len(domains_processed),
                        total_input,
                        total_output,
                        json.dumps(quality_summary),
                        frozen_by,
                        "locked",
                        json.dumps(domains_processed),
                    ],
                )
            
            # Insert domain details - let sequence handle id
            for detail in domain_details:
                conn.execute("""
                    INSERT INTO snapshot_domains (
                        snapshot_id, domain,
                        raw_file_path, raw_file_hash, raw_file_size,
                        normalized_file_path, normalized_file_hash, normalized_file_size,
                        extensions_file_path,
                        input_rows, output_rows, validation_errors, quality_score,
                        mapped_fields, schema_signature
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [
                    snapshot_id, detail['domain'],
                    detail['raw_file_path'], detail['raw_file_hash'], detail['raw_file_size'],
                    detail['normalized_file_path'], detail['normalized_file_hash'], detail['normalized_file_size'],
                    detail.get('extensions_file_path'),
                    detail['input_rows'], detail['output_rows'], detail['validation_errors'], detail['quality_score'],
                    json.dumps(detail['mapped_fields']), json.dumps(detail['schema_signature'])
                ])
            
            # Explicit commit
            conn.execute("COMMIT")
            
            snapshot_metadata = {
                'snapshot_id': snapshot_id,
                'snapshot_name': snap_name,
                'snapshot_hash': snapshot_hash,
                'env_id': env_id,
                'tenant_id': tenant_id,
                'total_domains': len(domains_processed),
                'total_input_rows': total_input,
                'total_output_rows': total_output,
                'quality_summary': quality_summary,
                'domains_processed': domains_processed,
                'created_at': datetime.now().isoformat(),
                'status': 'locked'
            }
            
            logger.info(f"[SNAPSHOT] Created: {snapshot_id}")
            return snapshot_metadata
            
        except Exception as e:
            # Rollback on error
            try:
                conn.execute("ROLLBACK")
            except:
                pass
            logger.error(f"[SNAPSHOT] Failed: {str(e)}", exc_info=True)
            raise
        finally:
            conn.close()
    
    def get_snapshot(self, snapshot_id: str) -> Optional[Dict]:
        """Get snapshot by ID"""
        conn = duckdb.connect(str(self.db_path))
        
        try:
            result = conn.execute("""
                SELECT 
                    snapshot_id, env_id, tenant_id,
                    snapshot_name,
                    snapshot_hash, raw_hash, normalized_hash, schema_hash,
                    total_domains, total_input_rows, total_output_rows,
                    quality_summary, created_at, updated_at, frozen_by, status, domains_processed
                FROM foundation_snapshots
                WHERE snapshot_id = ?
            """, [snapshot_id]).fetchone()
            
            if not result:
                return None
            
            domains = conn.execute("""
                SELECT 
                    domain, raw_file_path, raw_file_hash, raw_file_size,
                    normalized_file_path, normalized_file_hash, normalized_file_size,
                    extensions_file_path,
                    input_rows, output_rows, validation_errors, quality_score,
                    mapped_fields, schema_signature
                FROM snapshot_domains
                WHERE snapshot_id = ?
            """, [snapshot_id]).fetchall()
            
            return {
                'snapshot_id': result[0],
                'env_id': result[1],
                'tenant_id': result[2],
                'snapshot_name': result[3] or result[0],
                'snapshot_hash': result[4],
                'raw_hash': result[5],
                'normalized_hash': result[6],
                'schema_hash': result[7],
                'total_domains': result[8],
                'total_input_rows': result[9],
                'total_output_rows': result[10],
                'quality_summary': json.loads(result[11]) if result[11] else {},
                'created_at': result[12],
                'updated_at': result[13],
                'frozen_by': result[14],
                'status': result[15],
                'domains_processed': json.loads(result[16]) if result[16] else [],
                'domains': [
                    {
                        'domain': d[0],
                        'raw_file_path': d[1],
                        'raw_file_hash': d[2],
                        'raw_file_size': d[3],
                        'normalized_file_path': d[4],
                        'normalized_file_hash': d[5],
                        'normalized_file_size': d[6],
                        'extensions_file_path': d[7],
                        'input_rows': d[8],
                        'output_rows': d[9],
                        'validation_errors': d[10],
                        'quality_score': d[11],
                        'mapped_fields': json.loads(d[12]) if d[12] else [],
                        'schema_signature': json.loads(d[13]) if d[13] else {}
                    }
                    for d in domains
                ]
            }
            
        finally:
            conn.close()
    
    def list_snapshots(self, env_id: str, tenant_id: str) -> List[Dict]:
        """List all snapshots"""
        conn = duckdb.connect(str(self.db_path))
        
        try:
            results = conn.execute("""
                SELECT 
                    snapshot_id, snapshot_hash,
                    snapshot_name,
                    total_domains, total_input_rows, total_output_rows,
                    quality_summary, created_at, updated_at, frozen_by, status
                FROM foundation_snapshots
                WHERE env_id = ? AND tenant_id = ?
                ORDER BY created_at DESC
            """, [env_id, tenant_id]).fetchall()
            
            return [
                {
                    'snapshot_id': r[0],
                    'snapshot_hash': r[1],
                    'snapshot_name': r[2] or r[0],
                    'total_domains': r[3],
                    'total_input_rows': r[4],
                    'total_output_rows': r[5],
                    'quality_summary': json.loads(r[6]) if r[6] else {},
                    'created_at': r[7],
                    'updated_at': r[8],
                    'frozen_by': r[9],
                    'status': r[10],
                }
                for r in results
            ]
            
        finally:
            conn.close()
