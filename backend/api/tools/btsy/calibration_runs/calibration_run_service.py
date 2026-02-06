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
                  run_id TEXT UNIQUE,
                  env_id TEXT NOT NULL,
                  snapshot_id TEXT NOT NULL,
                  status TEXT NOT NULL,
                  active BOOLEAN NOT NULL DEFAULT FALSE,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  notes TEXT,
                  logic_name TEXT,
                  logic_description TEXT,
                  transaction_type TEXT,
                  aggregation_level TEXT,
                  lookback_days INTEGER,
                  run_frequency TEXT,
                  locked BOOLEAN DEFAULT TRUE
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_calibration_runs_env ON calibration_runs(env_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_calibration_runs_active ON calibration_runs(env_id, active)")
            try:
                conn.execute("ALTER TABLE calibration_runs ADD COLUMN run_id TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE calibration_runs ADD COLUMN logic_name TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE calibration_runs ADD COLUMN logic_description TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE calibration_runs ADD COLUMN transaction_type TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE calibration_runs ADD COLUMN aggregation_level TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE calibration_runs ADD COLUMN lookback_days INTEGER")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE calibration_runs ADD COLUMN run_frequency TEXT")
            except Exception:
                pass
            try:
                conn.execute("ALTER TABLE calibration_runs ADD COLUMN locked BOOLEAN DEFAULT TRUE")
            except Exception:
                pass
            conn.execute("CREATE INDEX IF NOT EXISTS idx_calibration_runs_runid ON calibration_runs(run_id)")

    def _generate_run_id(self) -> str:
        import secrets
        from datetime import datetime
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        suffix = secrets.token_hex(3).upper()
        return f"CAL_{stamp}_{suffix}"

    def create_run(self, env_id: str, snapshot_id: str, created_by: str = "user", notes: Optional[str] = None, logic_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        with duckdb_pool.connection(self.db_path) as conn:
            run_id = int(conn.execute("SELECT nextval('calibration_runs_seq')").fetchone()[0])
            run_id_text = self._generate_run_id()
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
                  calibration_run_id, run_id, env_id, snapshot_id, status, active, created_by, notes,
                  logic_name, logic_description, transaction_type, aggregation_level, lookback_days, run_frequency, locked
                ) VALUES (?, ?, ?, ?, 'draft', TRUE, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)
                """,
                [
                    int(run_id),
                    run_id_text,
                    env_id,
                    snapshot_id,
                    created_by,
                    notes,
                    (logic_config or {}).get('logic_name'),
                    (logic_config or {}).get('logic_description'),
                    (logic_config or {}).get('transaction_type'),
                    (logic_config or {}).get('aggregation_level'),
                    int((logic_config or {}).get('lookback_days')) if (logic_config or {}).get('lookback_days') is not None else None,
                    (logic_config or {}).get('run_frequency'),
                ],
            )
        return self.get_run(env_id, int(run_id))

    def list_runs(self, env_id: str, limit: int = 200) -> List[Dict[str, Any]]:
        limit = max(1, min(int(limit or 200), 500))
        with duckdb_pool.connection(self.db_path, read_only=True) as conn:
            rows = conn.execute(
                """
                SELECT calibration_run_id, run_id, env_id, snapshot_id, status, active, created_by, created_at, updated_at, notes,
                       logic_name, logic_description, transaction_type, aggregation_level, lookback_days, run_frequency, locked
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
                "run_id": r[1],
                "env_id": r[2],
                "snapshot_id": r[3],
                "status": r[4],
                "active": bool(r[5]),
                "created_by": r[6],
                "created_at": str(r[7]) if r[7] is not None else None,
                "updated_at": str(r[8]) if r[8] is not None else None,
                "notes": r[9],
                "logic_name": r[10],
                "logic_description": r[11],
                "transaction_type": r[12],
                "aggregation_level": r[13],
                "lookback_days": int(r[14]) if r[14] is not None else None,
                "run_frequency": r[15],
                "locked": bool(r[16]) if r[16] is not None else True,
            }
            for r in rows
        ]

    def get_run(self, env_id: str, calibration_run_id: int) -> Dict[str, Any]:
        with duckdb_pool.connection(self.db_path, read_only=True) as conn:
            row = conn.execute(
                """
                SELECT calibration_run_id, run_id, env_id, snapshot_id, status, active, created_by, created_at, updated_at, notes,
                       logic_name, logic_description, transaction_type, aggregation_level, lookback_days, run_frequency, locked
                FROM calibration_runs
                WHERE env_id = ? AND calibration_run_id = ?
                """,
                [env_id, int(calibration_run_id)],
            ).fetchone()
        if not row:
            raise ValueError("Calibration run not found")
        return {
            "calibration_run_id": int(row[0]),
            "run_id": row[1],
            "env_id": row[2],
            "snapshot_id": row[3],
            "status": row[4],
            "active": bool(row[5]),
            "created_by": row[6],
            "created_at": str(row[7]) if row[7] is not None else None,
            "updated_at": str(row[8]) if row[8] is not None else None,
            "notes": row[9],
            "logic_name": row[10],
            "logic_description": row[11],
            "transaction_type": row[12],
            "aggregation_level": row[13],
            "lookback_days": int(row[14]) if row[14] is not None else None,
            "run_frequency": row[15],
            "locked": bool(row[16]) if row[16] is not None else True,
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
                SELECT calibration_run_id, run_id, env_id, snapshot_id, status, active, created_by, created_at, updated_at, notes
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
            "run_id": row[1],
            "env_id": row[2],
            "snapshot_id": row[3],
            "status": row[4],
            "active": bool(row[5]),
            "created_by": row[6],
            "created_at": str(row[7]) if row[7] is not None else None,
            "updated_at": str(row[8]) if row[8] is not None else None,
            "notes": row[9],
        }

    def get_run_by_id(self, env_id: str, run_id: str) -> Dict[str, Any]:
        with duckdb_pool.connection(self.db_path, read_only=True) as conn:
            row = conn.execute(
                """
                SELECT calibration_run_id, run_id, env_id, snapshot_id, status, active, created_by, created_at, updated_at, notes,
                       logic_name, logic_description, transaction_type, aggregation_level, lookback_days, run_frequency, locked
                FROM calibration_runs
                WHERE env_id = ? AND run_id = ?
                """,
                [env_id, str(run_id)],
            ).fetchone()
        if not row:
            raise ValueError("Calibration run not found")
        return {
            "calibration_run_id": int(row[0]),
            "run_id": row[1],
            "env_id": row[2],
            "snapshot_id": row[3],
            "status": row[4],
            "active": bool(row[5]),
            "created_by": row[6],
            "created_at": str(row[7]) if row[7] is not None else None,
            "updated_at": str(row[8]) if row[8] is not None else None,
            "notes": row[9],
            "logic_name": row[10],
            "logic_description": row[11],
            "transaction_type": row[12],
            "aggregation_level": row[13],
            "lookback_days": int(row[14]) if row[14] is not None else None,
            "run_frequency": row[15],
            "locked": bool(row[16]) if row[16] is not None else True,
        }

    def set_active_by_id(self, env_id: str, run_id: str, active: bool = True) -> Dict[str, Any]:
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
                WHERE env_id = ? AND run_id = ?
                """,
                [bool(active), env_id, str(run_id)],
            )
        return self.get_run_by_id(env_id, str(run_id))

    def clone_run_by_id(self, env_id: str, run_id: str, created_by: str = "user", notes: Optional[str] = None, logic_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        with duckdb_pool.connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT snapshot_id FROM calibration_runs WHERE env_id = ? AND run_id = ?",
                [env_id, str(run_id)]
            ).fetchone()
            if not row:
                raise ValueError("Source run not found")
            snapshot_id = row[0]
        return self.create_run(env_id=env_id, snapshot_id=str(snapshot_id), created_by=str(created_by), notes=notes, logic_config=logic_config)
