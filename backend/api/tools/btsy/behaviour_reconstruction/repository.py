from pathlib import Path
from typing import Any, Dict, Optional

import duckdb
import json


class BehaviourReconstructionRepository:
    def __init__(self, cortex_db_path: Path):
        self.cortex_db_path = cortex_db_path
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        conn = duckdb.connect(str(self.cortex_db_path))
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS behaviour_reconstruction_log (
                  recon_id INTEGER,
                  run_id INTEGER,
                  entity_level TEXT,
                  entity_id TEXT,
                  as_of_date TIMESTAMP,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  created_by TEXT,
                  matches_threshold BOOLEAN,
                  stored_threshold DOUBLE,
                  reconstructed_threshold DOUBLE
                )
                """
            )
        finally:
            conn.close()

    def get_cached_reconstruction(
        self,
        run_id: int,
        entity_id: str,
        as_of_date: str,
    ) -> Optional[Dict[str, Any]]:
        conn = duckdb.connect(str(self.cortex_db_path))
        try:
            row = conn.execute(
                """
                SELECT r.recon_id, a.payload_json
                FROM cortex_reconstruction_runs r
                JOIN cortex_reconstruction_artifacts a ON a.recon_id = r.recon_id
                WHERE r.run_id = ? AND r.entity_id = ? AND r.as_of_date = ?
                ORDER BY r.created_at DESC
                LIMIT 1
                """,
                [int(run_id), str(entity_id), as_of_date],
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return None
        recon_id = int(row[0])
        payload_raw = row[1] or "{}"
        try:
            payload = json.loads(payload_raw)
        except Exception:
            payload = {}
        if isinstance(payload, dict):
            payload = dict(payload)
            payload.setdefault("recon_id", recon_id)
        return payload

    def get_stored_threshold(
        self,
        run_id: int,
        entity_level: str,
        entity_id: str,
        as_of_date: str,
    ) -> Optional[float]:
        level = str(entity_level or "account").lower()
        conn = duckdb.connect(str(self.cortex_db_path))
        try:
            if level == "customer":
                row = conn.execute(
                    """
                    SELECT SUM(threshold_amt) AS total
                    FROM cortex_threshold_table
                    WHERE run_id = ? AND customer_id = ? AND transaction_datetime = ?
                    """,
                    [int(run_id), str(entity_id), as_of_date],
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT SUM(threshold_amt) AS total
                    FROM cortex_threshold_table
                    WHERE run_id = ? AND account_id = ? AND transaction_datetime = ?
                    """,
                    [int(run_id), str(entity_id), as_of_date],
                ).fetchone()
        finally:
            conn.close()
        if not row or row[0] is None:
            return None
        return float(row[0])

    def log_reconstruction(
        self,
        recon_id: int,
        run_id: int,
        entity_level: str,
        entity_id: str,
        as_of_date: str,
        created_by: str,
        matches_threshold: Optional[bool],
        stored_threshold: Optional[float],
        reconstructed_threshold: float,
    ) -> None:
        conn = duckdb.connect(str(self.cortex_db_path))
        try:
            conn.execute(
                """
                INSERT INTO behaviour_reconstruction_log (
                  recon_id,
                  run_id,
                  entity_level,
                  entity_id,
                  as_of_date,
                  created_by,
                  matches_threshold,
                  stored_threshold,
                  reconstructed_threshold
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(recon_id),
                    int(run_id),
                    str(entity_level),
                    str(entity_id),
                    as_of_date,
                    str(created_by),
                    None if matches_threshold is None else bool(matches_threshold),
                    None if stored_threshold is None else float(stored_threshold),
                    float(reconstructed_threshold),
                ],
            )
        finally:
            conn.close()

