from __future__ import annotations

import json
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from api.tools.mlops.duckdb_manager import get_connection


VALID_STATUSES = {
    "not_started",
    "blocked",
    "in_progress",
    "completed",
    "failed",
    "stale",
}


STAGE_DEFS = [
    {"step_id": "data", "stage_name": "upload_data", "label": "Upload Data"},
    {"step_id": "master", "stage_name": "master_dataset", "label": "Master Dataset"},
    {"step_id": "featurestore", "stage_name": "feature_store", "label": "Feature Store"},
    {"step_id": "preprocess", "stage_name": "preprocessing_feature_selection", "label": "Preprocessing & Feature Selection"},
    {"step_id": "model", "stage_name": "model_build", "label": "Model Build"},
    {"step_id": "validation", "stage_name": "model_output_validation", "label": "Model Output & Validation"},
    {"step_id": "pipelines", "stage_name": "pipeline_hub", "label": "Pipeline Hub"},
]

STEP_TO_STAGE = {item["step_id"]: item["stage_name"] for item in STAGE_DEFS}
STAGE_TO_STEP = {item["stage_name"]: item["step_id"] for item in STAGE_DEFS}
STAGE_LABEL = {item["stage_name"]: item["label"] for item in STAGE_DEFS}
MAIN_STAGE_ORDER = [item["stage_name"] for item in STAGE_DEFS if item["stage_name"] != "pipeline_hub"]


def _txt(value: Any) -> str:
    return str(value or "").strip()


def _low(value: Any) -> str:
    return _txt(value).lower()


def _loads(value: Any, fallback: Any):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _status(value: Any, default: str = "not_started") -> str:
    normalized = _low(value) or default
    return normalized if normalized in VALID_STATUSES else default


class MuleWorkspaceService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _conn_ctx(self, conn=None):
        return nullcontext(conn) if conn is not None else get_connection(self.db_path)

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS pipeline_run (
                  run_id INTEGER PRIMARY KEY,
                  user_id TEXT,
                  pipeline_type TEXT DEFAULT 'mule',
                  status TEXT DEFAULT 'not_started',
                  current_stage TEXT,
                  current_substage TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  last_opened_at TIMESTAMP,
                  run_metadata_json TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS stage_state (
                  run_id INTEGER,
                  stage_name TEXT,
                  status TEXT DEFAULT 'not_started',
                  substage TEXT,
                  summary_json TEXT,
                  error_json TEXT,
                  started_at TIMESTAMP,
                  completed_at TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  PRIMARY KEY (run_id, stage_name)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS artifact_registry (
                  artifact_id BIGINT PRIMARY KEY,
                  run_id INTEGER,
                  stage_name TEXT,
                  artifact_type TEXT,
                  version INTEGER,
                  storage_ref TEXT,
                  metadata_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS job_registry (
                  job_id TEXT PRIMARY KEY,
                  run_id INTEGER,
                  stage_name TEXT,
                  job_type TEXT,
                  status TEXT,
                  progress_pct DOUBLE,
                  logs_json TEXT,
                  started_at TIMESTAMP,
                  finished_at TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _pipeline_row(self, run_id: int, conn) -> Optional[Tuple[Any, ...]]:
        return conn.execute(
            """
            SELECT pipeline_id, name, pipeline_type, model_family
            FROM mlops_pipelines
            WHERE pipeline_id = ?
            """,
            [int(run_id)],
        ).fetchone()

    def _ensure_stage_rows(self, run_id: int, conn) -> None:
        existing = {
            _low(row[0])
            for row in conn.execute(
                "SELECT stage_name FROM stage_state WHERE run_id = ?",
                [int(run_id)],
            ).fetchall()
        }
        for stage_name in [item["stage_name"] for item in STAGE_DEFS]:
            if stage_name in existing:
                continue
            conn.execute(
                """
                INSERT INTO stage_state (run_id, stage_name, status, substage, summary_json, error_json)
                VALUES (?, ?, 'not_started', '', '{}', '{}')
                """,
                [int(run_id), stage_name],
            )

    def ensure_run(
        self,
        run_id: int,
        user_id: str = "system",
        status: Optional[str] = None,
        current_stage: Optional[str] = None,
        current_substage: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        conn=None,
    ) -> Dict[str, Any]:
        with self._conn_ctx(conn) as c:
            pipeline_row = self._pipeline_row(run_id, c)
            if not pipeline_row:
                raise ValueError(
                    f"Run {int(run_id)} is not available in backend persistence. "
                    "Open a saved Mule run from Pipeline Hub or create a new Mule run."
                )
            pipeline_type = _low(pipeline_row[2] or pipeline_row[3] or "fcc") or "fcc"
            if pipeline_type != "mule":
                raise ValueError(
                    f'Run {int(run_id)} is saved as "{pipeline_type}", not "mule". '
                    "Open the correct Mule run before continuing."
                )
            current_row = c.execute(
                """
                SELECT run_id, user_id, status, current_stage, current_substage, run_metadata_json
                FROM pipeline_run
                WHERE run_id = ?
                """,
                [int(run_id)],
            ).fetchone()
            merged_metadata = {
                "pipeline_name": _txt(pipeline_row[1]) or f"Mule Pipeline {int(run_id)}",
                "pipeline_type": "mule",
                **(metadata or {}),
            }
            if current_row:
                next_status = _status(status, default=_status(current_row[2], "in_progress")) if status is not None else _status(current_row[2], "in_progress")
                next_stage = _txt(current_stage) if current_stage is not None else (_txt(current_row[3]) or "upload_data")
                next_substage = _txt(current_substage) if current_substage is not None else _txt(current_row[4])
                prior_meta = _loads(current_row[5], {})
                if isinstance(prior_meta, dict):
                    merged_metadata = {**prior_meta, **merged_metadata}
                c.execute(
                    """
                    UPDATE pipeline_run
                    SET user_id = ?, pipeline_type = 'mule', status = ?, current_stage = ?, current_substage = ?,
                        run_metadata_json = ?, updated_at = CURRENT_TIMESTAMP, last_opened_at = CURRENT_TIMESTAMP
                    WHERE run_id = ?
                    """,
                    [
                        _txt(user_id) or _txt(current_row[1]) or "system",
                        next_status,
                        next_stage,
                        next_substage,
                        json.dumps(merged_metadata, default=str),
                        int(run_id),
                    ],
                )
            else:
                next_status = _status(status, default="in_progress")
                next_stage = _txt(current_stage) or "upload_data"
                next_substage = _txt(current_substage)
                c.execute(
                    """
                    INSERT INTO pipeline_run (
                      run_id, user_id, pipeline_type, status, current_stage, current_substage,
                      run_metadata_json, last_opened_at
                    ) VALUES (?, ?, 'mule', ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    [
                        int(run_id),
                        _txt(user_id) or "system",
                        next_status,
                        next_stage,
                        next_substage,
                        json.dumps(merged_metadata, default=str),
                    ],
                )
            self._ensure_stage_rows(run_id, c)
            return {
                "run_id": int(run_id),
                "pipeline_name": merged_metadata.get("pipeline_name"),
                "status": next_status,
                "current_stage": next_stage,
                "current_substage": next_substage,
            }

    def update_run(
        self,
        run_id: int,
        *,
        status: Optional[str] = None,
        current_stage: Optional[str] = None,
        current_substage: Optional[str] = None,
        metadata_patch: Optional[Dict[str, Any]] = None,
        conn=None,
    ) -> None:
        with self._conn_ctx(conn) as c:
            row = c.execute(
                """
                SELECT status, current_stage, current_substage, run_metadata_json
                FROM pipeline_run
                WHERE run_id = ?
                """,
                [int(run_id)],
            ).fetchone()
            if not row:
                self.ensure_run(
                    run_id,
                    status=status or "in_progress",
                    current_stage=current_stage or "upload_data",
                    current_substage=current_substage or "",
                    metadata=metadata_patch,
                    conn=c,
                )
                return
            next_status = _status(status, default=_status(row[0], "in_progress")) if status is not None else _status(row[0], "in_progress")
            next_stage = _txt(current_stage) if current_stage is not None else _txt(row[1])
            next_substage = _txt(current_substage) if current_substage is not None else _txt(row[2])
            current_meta = _loads(row[3], {})
            merged_meta = current_meta if isinstance(current_meta, dict) else {}
            if isinstance(metadata_patch, dict):
                merged_meta.update(metadata_patch)
            c.execute(
                """
                UPDATE pipeline_run
                SET status = ?, current_stage = ?, current_substage = ?, run_metadata_json = ?,
                    updated_at = CURRENT_TIMESTAMP, last_opened_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                [
                    next_status,
                    next_stage,
                    next_substage,
                    json.dumps(merged_meta, default=str),
                    int(run_id),
                ],
            )

    def set_stage_state(
        self,
        run_id: int,
        stage_name: str,
        status: str,
        *,
        substage: str = "",
        summary: Optional[Dict[str, Any]] = None,
        error: Optional[Dict[str, Any]] = None,
        conn=None,
    ) -> None:
        stage = _txt(stage_name)
        next_status = _status(status, default="not_started")
        with self._conn_ctx(conn) as c:
            self._ensure_stage_rows(run_id, c)
            row = c.execute(
                """
                SELECT started_at
                FROM stage_state
                WHERE run_id = ? AND stage_name = ?
                """,
                [int(run_id), stage],
            ).fetchone()
            started_clause = "started_at = started_at"
            if next_status == "in_progress" and (not row or row[0] is None):
                started_clause = "started_at = CURRENT_TIMESTAMP"
            completed_clause = "completed_at = completed_at"
            if next_status == "completed":
                completed_clause = "completed_at = CURRENT_TIMESTAMP"
            elif next_status in {"in_progress", "not_started", "blocked", "stale"}:
                completed_clause = "completed_at = NULL"
            c.execute(
                f"""
                UPDATE stage_state
                SET status = ?, substage = ?, summary_json = ?, error_json = ?,
                    {started_clause}, {completed_clause}, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ? AND stage_name = ?
                """,
                [
                    next_status,
                    _txt(substage),
                    json.dumps(summary or {}, default=str),
                    json.dumps(error or {}, default=str),
                    int(run_id),
                    stage,
                ],
            )

    def register_artifact(
        self,
        run_id: int,
        stage_name: str,
        artifact_type: str,
        storage_ref: str,
        metadata: Optional[Dict[str, Any]] = None,
        version: Optional[int] = None,
        conn=None,
    ) -> Dict[str, Any]:
        with self._conn_ctx(conn) as c:
            artifact_id = int(
                c.execute("SELECT COALESCE(MAX(artifact_id), 0) + 1 FROM artifact_registry").fetchone()[0] or 1
            )
            if version is None:
                version = int(
                    c.execute(
                        """
                        SELECT COALESCE(MAX(version), 0) + 1
                        FROM artifact_registry
                        WHERE run_id = ? AND stage_name = ? AND artifact_type = ?
                        """,
                        [int(run_id), _txt(stage_name), _txt(artifact_type)],
                    ).fetchone()[0]
                    or 1
                )
            c.execute(
                """
                INSERT INTO artifact_registry (
                  artifact_id, run_id, stage_name, artifact_type, version, storage_ref, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    artifact_id,
                    int(run_id),
                    _txt(stage_name),
                    _txt(artifact_type),
                    int(version),
                    _txt(storage_ref),
                    json.dumps(metadata or {}, default=str),
                ],
            )
            return {
                "artifact_id": artifact_id,
                "run_id": int(run_id),
                "stage_name": _txt(stage_name),
                "artifact_type": _txt(artifact_type),
                "version": int(version),
                "storage_ref": _txt(storage_ref),
                "metadata": metadata or {},
            }

    def upsert_job(
        self,
        job_id: str,
        run_id: int,
        stage_name: str,
        job_type: str,
        status: str,
        progress_pct: float = 0.0,
        logs: Optional[Dict[str, Any]] = None,
        conn=None,
    ) -> Dict[str, Any]:
        with self._conn_ctx(conn) as c:
            key = _txt(job_id)
            next_status = _status(status, default="in_progress")
            row = c.execute("SELECT job_id FROM job_registry WHERE job_id = ?", [key]).fetchone()
            if row:
                finished_expr = "finished_at = CURRENT_TIMESTAMP" if next_status in {"completed", "failed", "stale"} else "finished_at = NULL"
                c.execute(
                    f"""
                    UPDATE job_registry
                    SET run_id = ?, stage_name = ?, job_type = ?, status = ?, progress_pct = ?,
                        logs_json = ?, {finished_expr}, updated_at = CURRENT_TIMESTAMP
                    WHERE job_id = ?
                    """,
                    [
                        int(run_id),
                        _txt(stage_name),
                        _txt(job_type),
                        next_status,
                        float(progress_pct or 0.0),
                        json.dumps(logs or {}, default=str),
                        key,
                    ],
                )
            else:
                c.execute(
                    """
                    INSERT INTO job_registry (
                      job_id, run_id, stage_name, job_type, status, progress_pct, logs_json, started_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    [
                        key,
                        int(run_id),
                        _txt(stage_name),
                        _txt(job_type),
                        next_status,
                        float(progress_pct or 0.0),
                        json.dumps(logs or {}, default=str),
                    ],
                )
            return {
                "job_id": key,
                "run_id": int(run_id),
                "stage_name": _txt(stage_name),
                "job_type": _txt(job_type),
                "status": next_status,
                "progress_pct": float(progress_pct or 0.0),
                "logs": logs or {},
            }

    def _derive_stage_state(self, step_id: str, payload: Dict[str, Any]) -> Tuple[str, str, Dict[str, Any], Dict[str, Any]]:
        data = payload if isinstance(payload, dict) else {}
        if step_id == "data":
            count = int(data.get("sources_loaded") or 0)
            status = "completed" if count > 0 else "not_started"
            return status, ("sources_loaded" if status == "completed" else "awaiting_upload"), {"sources_loaded": count}, {}
        if step_id == "master":
            build_status = _low(data.get("build_status") or "")
            if build_status in {"built", "completed"} or data.get("latest_build"):
                return "completed", "build", {"build_status": build_status or "built", "latest_build": data.get("latest_build")}, {}
            if build_status in {"failed", "error"}:
                return "failed", "build", {"build_status": build_status}, {"message": _txt(data.get("error") or "Master dataset build failed")}
            if build_status in {"preview", "draft", "in_progress"} or data.get("preview_summary"):
                return "in_progress", "preview", {"build_status": build_status or "preview"}, {}
            return "not_started", "configure", {"build_status": build_status or "draft"}, {}
        if step_id == "featurestore":
            generation_status = _low(data.get("generation_status") or data.get("feature_store_status") or "")
            if generation_status in {"ready", "generated", "built", "completed"} or data.get("latest_run"):
                return "completed", "generate", {"generation_status": generation_status or "ready"}, {}
            if generation_status in {"failed", "error"}:
                return "failed", "generate", {"generation_status": generation_status}, {"message": _txt(data.get("error") or "Feature Store generation failed")}
            if generation_status in {"in_progress", "running", "preview"}:
                return "in_progress", "generate", {"generation_status": generation_status}, {}
            return "not_started", "configure", {"generation_status": generation_status or "not_generated"}, {}
        if step_id == "preprocess":
            build_status = _low(data.get("build_status") or "")
            if build_status in {"built", "completed"} or data.get("latest_run"):
                return "completed", "run", {"build_status": build_status or "built"}, {}
            if build_status in {"failed", "error"}:
                return "failed", "run", {"build_status": build_status}, {"message": _txt(data.get("error") or "Preprocessing failed")}
            if build_status in {"preview", "in_progress"}:
                return "in_progress", "preview", {"build_status": build_status}, {}
            return "not_started", "configure", {"build_status": build_status or "draft"}, {}
        if step_id == "model":
            model_status = _low(data.get("status") or "")
            if model_status in {"trained", "completed"} or data.get("latest_run"):
                return "completed", "train", {"status": model_status or "trained"}, {}
            if model_status in {"failed", "error"}:
                return "failed", "train", {"status": model_status}, {"message": _txt(data.get("error") or "Model build failed")}
            if model_status in {"in_progress", "running"}:
                return "in_progress", "train", {"status": model_status}, {}
            return "not_started", "configure", {"status": model_status or "draft"}, {}
        if step_id == "validation":
            val_status = _low(data.get("status") or "")
            if val_status in {"validated", "ready", "completed"} or data.get("latest_validation"):
                return "completed", "validate", {"status": val_status or "validated"}, {}
            if val_status in {"failed", "error"}:
                return "failed", "validate", {"status": val_status}, {"message": _txt(data.get("error") or "Validation failed")}
            if val_status in {"preview", "in_progress", "running"}:
                return "in_progress", "preview", {"status": val_status}, {}
            return "not_started", "validate", {"status": val_status or "not_ready"}, {}
        return "not_started", "", {}, {}

    def sync_stage_payloads(
        self,
        run_id: int,
        payloads: Dict[str, Any],
        user_id: str = "system",
        conn=None,
    ) -> None:
        with self._conn_ctx(conn) as c:
            self.ensure_run(run_id, user_id=user_id, conn=c)
            stage_statuses: Dict[str, str] = {}
            first_incomplete_stage = "upload_data"
            first_incomplete_substage = ""
            saw_incomplete = False
            any_failed = False

            for step in ("data", "master", "featurestore", "preprocess", "model", "validation"):
                stage_name = STEP_TO_STAGE[step]
                stage_payload = payloads.get(step) if isinstance(payloads, dict) else {}
                status, substage, summary, error = self._derive_stage_state(step, stage_payload if isinstance(stage_payload, dict) else {})
                stage_statuses[stage_name] = status
                self.set_stage_state(
                    run_id,
                    stage_name,
                    status,
                    substage=substage,
                    summary=summary,
                    error=error,
                    conn=c,
                )
                if status == "failed":
                    any_failed = True
                if not saw_incomplete and status != "completed":
                    first_incomplete_stage = stage_name
                    first_incomplete_substage = substage
                    saw_incomplete = True

            self.set_stage_state(
                run_id,
                "pipeline_hub",
                "in_progress",
                substage="resume",
                summary={"available": True},
                error={},
                conn=c,
            )

            if any_failed:
                run_status = "failed"
            elif all(stage_statuses.get(name) == "completed" for name in MAIN_STAGE_ORDER):
                run_status = "completed"
                first_incomplete_stage = "pipeline_hub"
                first_incomplete_substage = "history"
            elif any(stage_statuses.get(name) in {"in_progress", "completed"} for name in MAIN_STAGE_ORDER):
                run_status = "in_progress"
            else:
                run_status = "not_started"

            self.update_run(
                run_id,
                status=run_status,
                current_stage=first_incomplete_stage,
                current_substage=first_incomplete_substage,
                conn=c,
            )

    def _load_stage_rows(self, run_id: int, conn) -> List[Dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT stage_name, status, substage, summary_json, error_json, started_at, completed_at, updated_at
            FROM stage_state
            WHERE run_id = ?
            """,
            [int(run_id)],
        ).fetchall()
        result: List[Dict[str, Any]] = []
        for row in rows:
            stage_name = _txt(row[0])
            result.append(
                {
                    "stage_name": stage_name,
                    "step_id": STAGE_TO_STEP.get(stage_name, stage_name),
                    "label": STAGE_LABEL.get(stage_name, stage_name.replace("_", " ").title()),
                    "status": _status(row[1]),
                    "substage": _txt(row[2]),
                    "summary": _loads(row[3], {}),
                    "error": _loads(row[4], {}),
                    "started_at": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
                    "completed_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
                    "updated_at": row[7].isoformat() if hasattr(row[7], "isoformat") else row[7],
                }
            )
        ordered: List[Dict[str, Any]] = []
        by_stage = {item["stage_name"]: item for item in result}
        for definition in STAGE_DEFS:
            stage_name = definition["stage_name"]
            if stage_name in by_stage:
                ordered.append(by_stage[stage_name])
            else:
                ordered.append(
                    {
                        "stage_name": stage_name,
                        "step_id": definition["step_id"],
                        "label": definition["label"],
                        "status": "not_started",
                        "substage": "",
                        "summary": {},
                        "error": {},
                        "started_at": None,
                        "completed_at": None,
                        "updated_at": None,
                    }
                )
        return ordered

    def _load_artifacts(self, run_id: int, conn) -> List[Dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT artifact_id, stage_name, artifact_type, version, storage_ref, metadata_json, created_at
            FROM artifact_registry
            WHERE run_id = ?
            ORDER BY created_at DESC, artifact_id DESC
            """,
            [int(run_id)],
        ).fetchall()
        return [
            {
                "artifact_id": int(row[0]),
                "stage_name": _txt(row[1]),
                "artifact_type": _txt(row[2]),
                "version": int(row[3] or 1),
                "storage_ref": _txt(row[4]),
                "metadata": _loads(row[5], {}),
                "created_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
            }
            for row in rows
        ]

    def _load_latest_job(self, run_id: int, conn) -> Optional[Dict[str, Any]]:
        row = conn.execute(
            """
            SELECT job_id, stage_name, job_type, status, progress_pct, logs_json, started_at, finished_at, updated_at
            FROM job_registry
            WHERE run_id = ?
            ORDER BY updated_at DESC, started_at DESC
            LIMIT 1
            """,
            [int(run_id)],
        ).fetchone()
        if not row:
            return None
        return {
            "job_id": _txt(row[0]),
            "stage_name": _txt(row[1]),
            "job_type": _txt(row[2]),
            "status": _status(row[3], "not_started"),
            "progress_pct": float(row[4] or 0.0),
            "logs": _loads(row[5], {}),
            "started_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
            "finished_at": row[7].isoformat() if hasattr(row[7], "isoformat") else row[7],
            "updated_at": row[8].isoformat() if hasattr(row[8], "isoformat") else row[8],
        }

    def _derive_allowed_actions(self, stages: List[Dict[str, Any]]) -> List[str]:
        first_pending = next((item for item in stages if item["stage_name"] in MAIN_STAGE_ORDER and item["status"] != "completed"), None)
        if not first_pending:
            return ["pipeline_hub.refresh", "pipeline_hub.resume", "pipeline_hub.open_history"]
        stage = first_pending["stage_name"]
        if stage == "upload_data":
            return ["upload_data.refresh", "upload_data.import_bundle", "upload_data.save"]
        if stage == "master_dataset":
            return ["master_dataset.refresh", "master_dataset.preview", "master_dataset.build", "master_dataset.save"]
        if stage == "feature_store":
            return ["feature_store.refresh", "feature_store.generate", "feature_store.save"]
        if stage == "preprocessing_feature_selection":
            return ["preprocessing.refresh", "preprocessing.preview", "preprocessing.run", "preprocessing.save"]
        if stage == "model_build":
            return ["model_build.refresh", "model_build.train", "model_build.save"]
        if stage == "model_output_validation":
            return ["model_validation.refresh", "model_validation.run", "model_validation.graph"]
        return ["workspace.refresh", "workspace.resume"]

    def _derive_blockers_warnings(self, stages: List[Dict[str, Any]]) -> Tuple[List[str], List[str]]:
        blockers: List[str] = []
        warnings: List[str] = []
        prev_completed = True
        for stage_name in MAIN_STAGE_ORDER:
            stage = next((item for item in stages if item["stage_name"] == stage_name), None)
            if not stage:
                continue
            if not prev_completed and stage["status"] not in {"completed", "failed"}:
                blockers.append(f"{STAGE_LABEL.get(stage_name, stage_name)} is blocked until the previous stage is completed.")
            if stage["status"] == "failed":
                err = stage.get("error") or {}
                blockers.append(_txt(err.get("message") or f"{STAGE_LABEL.get(stage_name, stage_name)} failed."))
            summary = stage.get("summary") or {}
            stage_warnings = summary.get("warnings") if isinstance(summary, dict) else None
            if isinstance(stage_warnings, list):
                for item in stage_warnings:
                    text = _txt(item)
                    if text:
                        warnings.append(text)
            prev_completed = prev_completed and stage["status"] == "completed"
        return blockers, warnings

    def get_workspace_snapshot(
        self,
        run_id: int,
        *,
        user_id: str = "system",
        payloads: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        with get_connection(self.db_path) as conn:
            self.ensure_run(run_id, user_id=user_id, conn=conn)
            if isinstance(payloads, dict) and payloads:
                self.sync_stage_payloads(run_id, payloads, user_id=user_id, conn=conn)
            run_row = conn.execute(
                """
                SELECT run_id, user_id, pipeline_type, status, current_stage, current_substage,
                       created_at, updated_at, last_opened_at, run_metadata_json
                FROM pipeline_run
                WHERE run_id = ?
                """,
                [int(run_id)],
            ).fetchone()
            stages = self._load_stage_rows(run_id, conn)
            artifacts = self._load_artifacts(run_id, conn)
            latest_job = self._load_latest_job(run_id, conn)
            blockers, warnings = self._derive_blockers_warnings(stages)
            allowed_actions = self._derive_allowed_actions(stages)

            metadata = _loads(run_row[9], {}) if run_row else {}
            current_stage = _txt(run_row[4]) if run_row else ""
            current_substage = _txt(run_row[5]) if run_row else ""
            current_step = STAGE_TO_STEP.get(current_stage, "data")
            stage_summaries = {
                item["step_id"]: {
                    "stage_name": item["stage_name"],
                    "status": item["status"],
                    "substage": item["substage"],
                    "summary": item.get("summary") or {},
                    "error": item.get("error") or {},
                }
                for item in stages
            }
            stage_statuses = {item["step_id"]: item["status"] for item in stages}

            return {
                "contract_version": "mule_workspace_v1",
                "run": {
                    "run_id": int(run_row[0]) if run_row else int(run_id),
                    "user_id": _txt(run_row[1]) if run_row else _txt(user_id),
                    "pipeline_type": _txt(run_row[2]) if run_row else "mule",
                    "status": _status(run_row[3], "not_started") if run_row else "not_started",
                    "current_stage": current_stage or "upload_data",
                    "current_substage": current_substage,
                    "current_step": current_step,
                    "current_step_label": STAGE_LABEL.get(current_stage, STAGE_LABEL.get("upload_data")),
                    "created_at": run_row[6].isoformat() if run_row and hasattr(run_row[6], "isoformat") else (run_row[6] if run_row else None),
                    "updated_at": run_row[7].isoformat() if run_row and hasattr(run_row[7], "isoformat") else (run_row[7] if run_row else None),
                    "last_opened_at": run_row[8].isoformat() if run_row and hasattr(run_row[8], "isoformat") else (run_row[8] if run_row else None),
                    "metadata": metadata if isinstance(metadata, dict) else {},
                },
                "stages": stages,
                "stage_statuses": stage_statuses,
                "stage_summaries": stage_summaries,
                "artifacts": artifacts,
                "blockers": blockers,
                "warnings": warnings,
                "allowed_actions": allowed_actions,
                "latest_job": latest_job,
            }
