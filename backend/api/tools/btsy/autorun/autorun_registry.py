from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from typing import Dict, List, Optional

import duckdb

from api.tools.btsy.duckdb_pool import duckdb_pool


@dataclass
class RunRecord:
    run_id: int
    env_id: str
    snapshot_id: str
    session_id: int
    config_id: str
    config_version: str
    mode: str
    status: str
    progress_pct: float
    current_step: str
    created_by: str
    created_at: str
    started_at: Optional[str]
    finished_at: Optional[str]
    workspace_path: str
    run_db_path: str
    behavior_db_path: str
    universe_db_path: str
    report_pdf_path: Optional[str]
    summary_json: Optional[Dict]
    error_text: Optional[str]

    def as_dict(self) -> Dict:
        return {
            'run_id': int(self.run_id),
            'env_id': self.env_id,
            'snapshot_id': self.snapshot_id,
            'session_id': int(self.session_id),
            'config_id': self.config_id,
            'config_version': self.config_version,
            'mode': self.mode,
            'status': self.status,
            'progress_pct': float(self.progress_pct or 0.0),
            'current_step': self.current_step,
            'created_by': self.created_by,
            'created_at': self.created_at,
            'started_at': self.started_at,
            'finished_at': self.finished_at,
            'workspace_path': self.workspace_path,
            'run_db_path': self.run_db_path,
            'behavior_db_path': self.behavior_db_path,
            'universe_db_path': self.universe_db_path,
            'report_pdf_path': self.report_pdf_path,
            'summary': self.summary_json or {},
            'error': self.error_text,
        }


class AutoRunRegistry:
    def __init__(self, index_db_path: Path):
        self.db_path = index_db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self):
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS auto_calibration_runs_seq START 1")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS auto_calibration_runs (
                  run_id INTEGER PRIMARY KEY DEFAULT nextval('auto_calibration_runs_seq'),
                  env_id TEXT NOT NULL,
                  snapshot_id TEXT NOT NULL,
                  session_id INTEGER NOT NULL,
                  config_id TEXT NOT NULL,
                  config_version TEXT NOT NULL,
                  mode TEXT NOT NULL,
                  status TEXT NOT NULL,
                  progress_pct DOUBLE,
                  current_step TEXT,
                  created_by TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  started_at TIMESTAMP,
                  finished_at TIMESTAMP,
                  workspace_path TEXT,
                  run_db_path TEXT,
                  behavior_db_path TEXT,
                  universe_db_path TEXT,
                  report_pdf_path TEXT,
                  summary_json TEXT,
                  error_text TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS auto_calibration_run_events (
                  event_id BIGINT,
                  run_id INTEGER NOT NULL,
                  event_type TEXT NOT NULL,
                  event_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

    def create_run(
        self,
        env_id: str,
        snapshot_id: str,
        session_id: int,
        config_id: str,
        config_version: str,
        mode: str,
        created_by: str,
        workspace_path: Path,
        run_db_path: Path,
        behavior_db_path: Path,
        universe_db_path: Path,
    ) -> int:
        with duckdb_pool.connection(self.db_path) as conn:
            run_id = conn.execute("SELECT nextval('auto_calibration_runs_seq')").fetchone()[0]
            conn.execute("""
                INSERT INTO auto_calibration_runs (
                  run_id, env_id, snapshot_id, session_id, config_id, config_version, mode,
                  status, progress_pct, current_step, created_by,
                  workspace_path, run_db_path, behavior_db_path, universe_db_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATED', 0.0, 'CREATED', ?, ?, ?, ?, ?)
            """, [
                int(run_id),
                env_id,
                snapshot_id,
                int(session_id),
                config_id,
                config_version,
                mode,
                created_by,
                str(workspace_path),
                str(run_db_path),
                str(behavior_db_path),
                str(universe_db_path),
            ])
        return int(run_id)

    def update_status(
        self,
        run_id: int,
        status: str,
        progress_pct: Optional[float] = None,
        current_step: Optional[str] = None,
        started: bool = False,
        finished: bool = False,
        report_pdf_path: Optional[str] = None,
        summary_json: Optional[Dict] = None,
        error_text: Optional[str] = None,
    ):
        fields = ["status = ?"]
        params: List = [status]
        if progress_pct is not None:
            fields.append("progress_pct = ?")
            params.append(float(progress_pct))
        if current_step is not None:
            fields.append("current_step = ?")
            params.append(current_step)
        if started:
            fields.append("started_at = COALESCE(started_at, CURRENT_TIMESTAMP)")
        if finished:
            fields.append("finished_at = CURRENT_TIMESTAMP")
        if report_pdf_path is not None:
            fields.append("report_pdf_path = ?")
            params.append(report_pdf_path)
        if summary_json is not None:
            fields.append("summary_json = ?")
            params.append(json.dumps(summary_json))
        if error_text is not None:
            fields.append("error_text = ?")
            params.append(error_text)
        params.append(int(run_id))
        with duckdb_pool.connection(self.db_path) as conn:
            conn.execute(f"UPDATE auto_calibration_runs SET {', '.join(fields)} WHERE run_id = ?", params)

    def add_event(self, run_id: int, event_type: str, event: Dict):
        with duckdb_pool.connection(self.db_path) as conn:
            event_id = int(datetime.utcnow().timestamp() * 1000)
            conn.execute(
                "INSERT INTO auto_calibration_run_events (event_id, run_id, event_type, event_json) VALUES (?, ?, ?, ?)",
                [event_id, int(run_id), event_type, json.dumps(event or {})]
            )

    def list_runs(self, limit: int = 200) -> List[Dict]:
        with duckdb_pool.connection(self.db_path) as conn:
            rows = conn.execute("""
                SELECT run_id, env_id, snapshot_id, session_id, config_id, config_version, mode,
                       status, progress_pct, current_step,
                       created_by, created_at, started_at, finished_at,
                       workspace_path, run_db_path, behavior_db_path, universe_db_path,
                       report_pdf_path, summary_json, error_text
                FROM auto_calibration_runs
                ORDER BY run_id DESC
                LIMIT ?
            """, [int(limit)]).fetchall()
        out = []
        for r in rows:
            out.append(RunRecord(
                run_id=int(r[0]),
                env_id=r[1],
                snapshot_id=r[2],
                session_id=int(r[3]),
                config_id=r[4],
                config_version=r[5],
                mode=r[6],
                status=r[7],
                progress_pct=float(r[8] or 0.0),
                current_step=r[9] or '',
                created_by=r[10],
                created_at=str(r[11]),
                started_at=str(r[12]) if r[12] is not None else None,
                finished_at=str(r[13]) if r[13] is not None else None,
                workspace_path=r[14],
                run_db_path=r[15],
                behavior_db_path=r[16],
                universe_db_path=r[17],
                report_pdf_path=r[18],
                summary_json=json.loads(r[19]) if r[19] else None,
                error_text=r[20],
            ).as_dict())
        return out

    def get_run(self, run_id: int) -> Dict:
        with duckdb_pool.connection(self.db_path) as conn:
            r = conn.execute("""
                SELECT run_id, env_id, snapshot_id, session_id, config_id, config_version, mode,
                       status, progress_pct, current_step,
                       created_by, created_at, started_at, finished_at,
                       workspace_path, run_db_path, behavior_db_path, universe_db_path,
                       report_pdf_path, summary_json, error_text
                FROM auto_calibration_runs
                WHERE run_id = ?
            """, [int(run_id)]).fetchone()
            if not r:
                raise ValueError("Run not found")
            events = conn.execute("""
                SELECT event_type, event_json, created_at
                FROM auto_calibration_run_events
                WHERE run_id = ?
                ORDER BY created_at ASC
                LIMIT 1000
            """, [int(run_id)]).fetchall()
        rec = RunRecord(
            run_id=int(r[0]),
            env_id=r[1],
            snapshot_id=r[2],
            session_id=int(r[3]),
            config_id=r[4],
            config_version=r[5],
            mode=r[6],
            status=r[7],
            progress_pct=float(r[8] or 0.0),
            current_step=r[9] or '',
            created_by=r[10],
            created_at=str(r[11]),
            started_at=str(r[12]) if r[12] is not None else None,
            finished_at=str(r[13]) if r[13] is not None else None,
            workspace_path=r[14],
            run_db_path=r[15],
            behavior_db_path=r[16],
            universe_db_path=r[17],
            report_pdf_path=r[18],
            summary_json=json.loads(r[19]) if r[19] else None,
            error_text=r[20],
        )
        return {
            **rec.as_dict(),
            'events': [{
                'event_type': e[0],
                'event': json.loads(e[1]) if e[1] else {},
                'created_at': str(e[2]),
            } for e in events]
        }

