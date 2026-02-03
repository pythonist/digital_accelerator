from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from api.tools.btsy.duckdb_pool import duckdb_pool


class CalibrationRunService:
    def __init__(self, workbench_db_path: Path):
        self.db_path = workbench_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS calibration_runs_seq START 1")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS calibration_runs (
                  calibration_run_id INTEGER PRIMARY KEY DEFAULT nextval('calibration_runs_seq'),
                  env_id TEXT NOT NULL,
                  snapshot_id TEXT NOT NULL,
                  status TEXT NOT NULL,
                  active BOOLEAN NOT NULL DEFAULT FALSE,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  notes TEXT
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_calibration_runs_env ON calibration_runs(env_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_calibration_runs_active ON calibration_runs(env_id, active)")

    def create_run(self, env_id: str, snapshot_id: str, created_by: str = "user", notes: Optional[str] = None) -> Dict[str, Any]:
        with duckdb_pool.connection(self.db_path) as conn:
            run_id = int(conn.execute("SELECT nextval('calibration_runs_seq')").fetchone()[0])
            conn.execute(
                """
                UPDATE calibration_runs
                SET active = FALSE, updated_at = CURRENT_TIMESTAMP
                WHERE env_id = ? AND active = TRUE
                """,
                [env_id],
            )
            conn.execute(
                """
                INSERT INTO calibration_runs (
                  calibration_run_id, env_id, snapshot_id, status, active, created_by, notes
                ) VALUES (?, ?, ?, 'draft', TRUE, ?, ?)
                """,
                [int(run_id), env_id, snapshot_id, created_by, notes],
            )
        return self.get_run(env_id, int(run_id))

    def list_runs(self, env_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit or 200), 500))
        with duckdb_pool.connection(self.db_path, read_only=True) as conn:
            rows = conn.execute(
                """
                SELECT calibration_run_id, env_id, snapshot_id, status, active, created_by, created_at, updated_at, notes
                FROM calibration_runs
                WHERE env_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                [env_id, int(limit)],
            ).fetchall()
        return [
            {
                "calibration_run_id": int(r[0]),
                "env_id": r[1],
                "snapshot_id": r[2],
                "status": r[3],
                "active": bool(r[4]),
                "created_by": r[5],
                "created_at": str(r[6]) if r[6] is not None else None,
                "updated_at": str(r[7]) if r[7] is not None else None,
                "notes": r[8],
            }
            for r in rows
        ]

    def get_run(self, env_id: str, calibration_run_id: int) -> Dict[str, Any]:
        with duckdb_pool.connection(self.db_path, read_only=True) as conn:
            row = conn.execute(
                """
                SELECT calibration_run_id, env_id, snapshot_id, status, active, created_by, created_at, updated_at, notes
                FROM calibration_runs
                WHERE env_id = ? AND calibration_run_id = ?
                """,
                [env_id, int(calibration_run_id)],
            ).fetchone()
        if not row:
            raise ValueError("Calibration run not found")
        return {
            "calibration_run_id": int(row[0]),
            "env_id": row[1],
            "snapshot_id": row[2],
            "status": row[3],
            "active": bool(row[4]),
            "created_by": row[5],
            "created_at": str(row[6]) if row[6] is not None else None,
            "updated_at": str(row[7]) if row[7] is not None else None,
            "notes": row[8],
        }

    def set_active(self, env_id: str, calibration_run_id: int, active: bool = True) -> Dict[str, Any]:
        with duckdb_pool.connection(self.db_path) as conn:
            if active:
                conn.execute(
                    "UPDATE calibration_runs SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE env_id = ? AND active = TRUE",
                    [env_id],
                )
            conn.execute(
                """
                UPDATE calibration_runs
                SET active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE env_id = ? AND calibration_run_id = ?
                """,
                [bool(active), env_id, int(calibration_run_id)],
            )
        return self.get_run(env_id, int(calibration_run_id))

    def get_active(self, env_id: str) -> Optional[Dict[str, Any]]:
        with duckdb_pool.connection(self.db_path, read_only=True) as conn:
            row = conn.execute(
                """
                SELECT calibration_run_id, env_id, snapshot_id, status, active, created_by, created_at, updated_at, notes
                FROM calibration_runs
                WHERE env_id = ? AND active = TRUE
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                [env_id],
            ).fetchone()
        if not row:
            return None
        return {
            "calibration_run_id": int(row[0]),
            "env_id": row[1],
            "snapshot_id": row[2],
            "status": row[3],
            "active": bool(row[4]),
            "created_by": row[5],
            "created_at": str(row[6]) if row[6] is not None else None,
            "updated_at": str(row[7]) if row[7] is not None else None,
            "notes": row[8],
        }

