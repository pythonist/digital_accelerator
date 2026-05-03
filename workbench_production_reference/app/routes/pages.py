from __future__ import annotations

from flask import Blueprint, abort, redirect, render_template, request, url_for

from ..extensions import db
from ..models import TaskRecord
from ..services.task_service import create_task_record, run_demo_pipeline
from ..services.workbench_service import (
    WORKBENCH_META,
    build_workbench_context,
    ensure_session_id,
    save_tab,
    set_feature_decision,
    update_transform,
)

pages_bp = Blueprint("pages", __name__)


def _get_workbench_key_or_404(workbench_key: str) -> str:
    key = str(workbench_key or "").strip().lower()
    if key not in WORKBENCH_META:
        abort(404)
    return key


@pages_bp.get("/")
def home():
    return redirect(url_for("pages.workbench_page", workbench_key="fcc"))


@pages_bp.get("/workbench/<workbench_key>")
def workbench_page(workbench_key: str):
    key = _get_workbench_key_or_404(workbench_key)
    session_id = ensure_session_id()
    context = build_workbench_context(key, session_id)
    return render_template("workbench.html", title=f"{context['meta']['title']} Reference", **context)


@pages_bp.post("/workbench/<workbench_key>/tab")
def workbench_tab(workbench_key: str):
    key = _get_workbench_key_or_404(workbench_key)
    session_id = ensure_session_id()
    tab = request.form.get("tab", "overview")
    save_tab(key, session_id, tab)
    context = build_workbench_context(key, session_id)
    return render_template("fragments/workbench_content.html", **context)


@pages_bp.post("/workbench/<workbench_key>/transform")
def workbench_transform(workbench_key: str):
    key = _get_workbench_key_or_404(workbench_key)
    session_id = ensure_session_id()
    update_transform(key, session_id, request.form.to_dict())
    save_tab(key, session_id, "transform")
    context = build_workbench_context(key, session_id)
    return render_template("fragments/workbench_content.html", **context)


@pages_bp.post("/workbench/<workbench_key>/feature-decision")
def workbench_feature_decision(workbench_key: str):
    key = _get_workbench_key_or_404(workbench_key)
    session_id = ensure_session_id()
    feature_name = request.form.get("feature_name", "")
    decision = request.form.get("decision", "selected")
    set_feature_decision(key, session_id, feature_name, decision)
    save_tab(key, session_id, "feature_selection")
    context = build_workbench_context(key, session_id)
    return render_template("fragments/workbench_content.html", **context)


@pages_bp.post("/workbench/<workbench_key>/start-task")
def workbench_start_task(workbench_key: str):
    key = _get_workbench_key_or_404(workbench_key)
    session_id = ensure_session_id()
    task = create_task_record(key, session_id, task_name="Preprocessing pipeline")
    async_result = run_demo_pipeline.delay(task.task_id)
    task.worker_job_id = async_result.id
    db.session.commit()
    context = build_workbench_context(key, session_id)
    return render_template("fragments/task_panel.html", latest_task=context["latest_task"])


@pages_bp.get("/fragments/task/<task_id>")
def task_fragment(task_id: str):
    task = TaskRecord.query.filter_by(task_id=task_id).first_or_404()
    return render_template("fragments/task_panel.html", latest_task=task)
