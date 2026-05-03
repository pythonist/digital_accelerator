from __future__ import annotations

from datetime import datetime, timezone

from .extensions import db


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class WorkbenchState(db.Model):
    __tablename__ = "workbench_state"

    id = db.Column(db.Integer, primary_key=True)
    workbench_key = db.Column(db.String(40), nullable=False, index=True)
    session_id = db.Column(db.String(120), nullable=False, index=True)
    selected_tab = db.Column(db.String(40), nullable=False, default="overview")
    feature_decisions = db.Column(db.JSON, nullable=False, default=dict)
    transform_config = db.Column(db.JSON, nullable=False, default=dict)
    ui_state = db.Column(db.JSON, nullable=False, default=dict)
    latest_task_id = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        db.UniqueConstraint("workbench_key", "session_id", name="uq_workbench_state_session"),
    )


class FeatureCatalog(db.Model):
    __tablename__ = "feature_catalog"

    id = db.Column(db.Integer, primary_key=True)
    workbench_key = db.Column(db.String(40), nullable=False, index=True)
    feature_name = db.Column(db.String(120), nullable=False)
    family = db.Column(db.String(80), nullable=False)
    source_tag = db.Column(db.String(40), nullable=False, default="feature_store")
    correlation_score = db.Column(db.Float, nullable=False, default=0.0)
    model_score = db.Column(db.Float, nullable=False, default=0.0)
    default_decision = db.Column(db.String(20), nullable=False, default="selected")
    notes = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


class TaskRecord(db.Model):
    __tablename__ = "task_record"

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.String(120), nullable=False, unique=True, index=True)
    workbench_key = db.Column(db.String(40), nullable=False, index=True)
    session_id = db.Column(db.String(120), nullable=False, index=True)
    task_name = db.Column(db.String(120), nullable=False)
    status = db.Column(db.String(30), nullable=False, default="queued")
    progress = db.Column(db.Integer, nullable=False, default=0)
    message = db.Column(db.String(255), nullable=False, default="Queued")
    result_payload = db.Column(db.JSON, nullable=False, default=dict)
    worker_job_id = db.Column(db.String(120), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
