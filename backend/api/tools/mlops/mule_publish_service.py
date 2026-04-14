from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

from api.tools.mlops.duckdb_manager import get_connection


class MulePublishService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_publish_batches (
                  publish_id BIGINT PRIMARY KEY DEFAULT nextval('mlops_snapshot_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  pipeline_id BIGINT,
                  model_run_id BIGINT,
                  source_module TEXT DEFAULT 'mule',
                  source_record_type TEXT,
                  selected_count INTEGER,
                  threshold DOUBLE,
                  capacity INTEGER,
                  destination_system TEXT,
                  destination_queue TEXT,
                  publish_status TEXT,
                  publish_summary_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def publish_high_risk_accounts(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        model_run_id: Optional[int] = None,
        threshold: float = 0.72,
        capacity: int = 250,
        source_record_type: str = "high_risk_account",
        destination_queue: str = "Sentinel Mule Intake",
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        selected_count = min(int(capacity or 0), max(0, int(round(float(threshold or 0) * 1000))))
        summary = {
            "selected_count": selected_count,
            "source_record_type": source_record_type,
            "destination_queue": destination_queue,
            "destination_system": "Sentinel",
            "publish_status": "ready" if selected_count > 0 else "draft",
        }
        with get_connection(self.db_path) as conn:
            next_id = conn.execute(
                "SELECT COALESCE(MAX(publish_id), 0) + 1 FROM mule_publish_batches"
            ).fetchone()[0]
            publish_id = int(next_id or 1)
            conn.execute(
                """
                INSERT INTO mule_publish_batches (
                  publish_id, tenant_id, env_id, pipeline_id, model_run_id,
                  source_module, source_record_type, selected_count, threshold, capacity,
                  destination_system, destination_queue, publish_status, publish_summary_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    publish_id,
                    tenant_id,
                    env_id,
                    int(pipeline_id),
                    int(model_run_id) if model_run_id else None,
                    "mule",
                    source_record_type,
                    int(selected_count),
                    float(threshold),
                    int(capacity),
                    "Sentinel",
                    destination_queue,
                    summary["publish_status"],
                    json.dumps({**summary, **(config or {})}, default=str),
                ],
            )
        return {
            "publish_id": publish_id,
            "tenant_id": tenant_id,
            "env_id": env_id,
            "pipeline_id": int(pipeline_id),
            "model_run_id": int(model_run_id) if model_run_id else None,
            "summary": summary,
        }
