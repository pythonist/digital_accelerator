import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import duckdb

logger = logging.getLogger(__name__)


class FoundationAuditService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self._ensure_tables()

    def _ensure_tables(self) -> None:
        conn = duckdb.connect(str(self.db_path))
        try:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS foundation_audit_seq")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS foundation_audit_log (
                    id INTEGER PRIMARY KEY DEFAULT nextval('foundation_audit_seq'),
                    tenant_id TEXT NOT NULL,
                    env_id TEXT NOT NULL,
                    run_id TEXT,
                    domain TEXT,
                    snapshot_id TEXT,
                    event TEXT NOT NULL,
                    status TEXT,
                    duration_ms BIGINT,
                    metadata_json TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
        finally:
            conn.close()

    def log_event(
        self,
        tenant_id: str,
        env_id: str,
        event: str,
        run_id: Optional[str] = None,
        domain: Optional[str] = None,
        snapshot_id: Optional[str] = None,
        status: str = "ok",
        duration_ms: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        conn = duckdb.connect(str(self.db_path))
        try:
            meta = metadata or {}
            meta.setdefault("timestamp", datetime.utcnow().isoformat() + "Z")
            conn.execute(
                """
                INSERT INTO foundation_audit_log
                    (tenant_id, env_id, run_id, domain, snapshot_id, event, status, duration_ms, metadata_json)
                VALUES
                    (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    tenant_id,
                    env_id,
                    run_id,
                    domain,
                    snapshot_id,
                    event,
                    status,
                    int(duration_ms) if duration_ms is not None else None,
                    json.dumps(meta, default=str),
                ],
            )
        except Exception as e:
            logger.error(f"[BTSY][AUDIT] Failed to log event: {e}", exc_info=True)
        finally:
            conn.close()
