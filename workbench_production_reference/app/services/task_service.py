from __future__ import annotations

import time
import uuid

from .. import celery
from ..extensions import db
from ..models import TaskRecord, WorkbenchState


def create_task_record(workbench_key: str, session_id: str, task_name: str) -> TaskRecord:
    task = TaskRecord(
        task_id=str(uuid.uuid4()),
        workbench_key=workbench_key,
        session_id=session_id,
        task_name=task_name,
        status="queued",
        progress=0,
        message="Queued for background execution.",
        result_payload={},
    )
    db.session.add(task)
    db.session.commit()

    state = WorkbenchState.query.filter_by(workbench_key=workbench_key, session_id=session_id).first()
    if state:
        state.latest_task_id = task.task_id
        state.ui_state = {**(state.ui_state or {}), "last_message": f"{task_name} queued."}
        db.session.commit()
    return task


def update_task(task_id: str, *, status: str, progress: int, message: str, result_payload: dict | None = None) -> None:
    task = TaskRecord.query.filter_by(task_id=task_id).first()
    if not task:
        return
    task.status = status
    task.progress = progress
    task.message = message
    if result_payload is not None:
        task.result_payload = result_payload
    db.session.commit()


@celery.task(name="workbench.run_demo_pipeline")
def run_demo_pipeline(task_id: str) -> dict:
    checkpoints = [
        (15, "Restoring persisted workbench state from PostgreSQL."),
        (35, "Loading cached feature catalog from Redis."),
        (60, "Applying deterministic transform plan in background."),
        (82, "Refreshing governed feature set and audit summary."),
        (100, "Completed without a full-page reload."),
    ]
    update_task(task_id, status="in_progress", progress=5, message="Worker accepted job.")
    for progress, message in checkpoints:
        time.sleep(1.2)
        update_task(task_id, status="in_progress" if progress < 100 else "completed", progress=progress, message=message)
    result = {
        "output_dataset": "model_ready_dataset",
        "rows_written": 10000,
        "selected_features": 8,
        "dropped_features": 3,
    }
    update_task(
        task_id,
        status="completed",
        progress=100,
        message="Pipeline finished. Output dataset is ready for the next step.",
        result_payload=result,
    )
    return result
