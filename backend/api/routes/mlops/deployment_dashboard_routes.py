"""
deployment_dashboard_routes.py
────────────────────────────────────────────────────────────────────────────────
Flask Blueprint for the post-deployment monitoring dashboard.

Endpoints (all under /api/deployment-dashboard)
────────────────────────────────────────────────
  POST /score-batch          — Score a JSON batch of alerts/cases
  GET  /ledger               — Paginated suppression ledger
  GET  /drift                — Week-over-week drift stats
  GET/POST /model-lineage    — DAG + summary cards for model build story
  GET  /alert-vs-case        — Alert vs case suppression split
  GET  /event-loss-trend     — Rolling event-loss time series
  POST /inference-explain    — Single-record scoring + SHAP/LIME style explanation

Register in create_app():
    from api.tools.mlops.deployment_dashboard_routes import deployment_dashboard_bp
    app.register_blueprint(deployment_dashboard_bp, url_prefix="/api/deployment-dashboard")
"""

from __future__ import annotations

import threading
import json
from pathlib import Path
from typing import Dict

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.deployment_dashboard_service import DeploymentDashboardService
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root
from services.fcc_sentinel_bridge import FCCSentinelBridgeService

deployment_dashboard_bp = Blueprint("deployment_dashboard", __name__)

_SERVICE_LOCK = threading.Lock()
_SERVICE_CACHE: Dict[str, DeploymentDashboardService] = {}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_env_ids():
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or services.metadata_manager.active_env
    )
    if not env_id:
        raise ValueError("X-Environment-ID header required")
    tenant_id = getattr(request, "tenant_id", None) or "default"
    return str(tenant_id), str(env_id)


def _resolve_env_path(env_id: str, tenant_id: str) -> Path:
    return resolve_env_root(env_id, tenant_id, create_if_missing=True)


def _get_service(env_root: Path) -> DeploymentDashboardService:
    key = str(env_root.resolve())
    with _SERVICE_LOCK:
        svc = _SERVICE_CACHE.get(key)
        if svc is None:
            svc = DeploymentDashboardService(
                db_path=env_root / "mlops" / "duckdb" / "deployment.duckdb",
                model_dir=env_root / "mlops" / "models",
            )
            _SERVICE_CACHE[key] = svc
        return svc


def _get_report_service(env_root: Path) -> MLOpsWorkbenchService:
    mlops_db = env_root / "mlops" / "duckdb" / "mlops.duckdb"
    return MLOpsWorkbenchService(mlops_db)


def _resolve_locked_deployment_threshold(env_root: Path, deployment_id: str, fallback: float) -> float:
    deployment_text = str(deployment_id or "").strip()
    if not deployment_text:
        return float(fallback)
    deploy_file = env_root / "mlops" / "deployments" / f"{deployment_text}.json"
    if not deploy_file.exists():
        return float(fallback)
    try:
        payload = json.loads(deploy_file.read_text(encoding="utf-8"))
        return float(payload.get("threshold") or fallback)
    except Exception:
        return float(fallback)


def _bool_value(value, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _ok(data):
    return jsonify({"status": "ok", "data": data})


def _err(msg: str, code: int = 400):
    return jsonify({"status": "error", "error": str(msg)}), code


# ── Routes ─────────────────────────────────────────────────────────────────────

@deployment_dashboard_bp.route("/score-batch", methods=["POST"])
def score_batch():
    """
    Score a batch of alerts or cases.

    Body:
    {
        "deployment_id": "uuid",
        "run_id":         "uuid",
        "entity_type":    "alert" | "case",
        "threshold":      0.4,
        "records":        [{ "entity_id": "A001", "feature1": 1.2, ... }, ...]
    }
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        body = request.get_json(force=True) or {}
        deployment_id = body.get("deployment_id") or ""
        run_id = body.get("run_id") or ""
        records = body.get("records") or []
        threshold = float(body.get("threshold") or 0.5)
        entity_type = body.get("entity_type") or "alert"

        if not deployment_id or not run_id:
            return _err("deployment_id and run_id are required")
        if not records:
            return _err("records list is empty")

        result = svc.score_batch(
            deployment_id=deployment_id,
            run_id=run_id,
            records=records,
            threshold=threshold,
            entity_type=entity_type,
        )
        return _ok(result)

    except FileNotFoundError as e:
        return _err(str(e), 404)
    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/live-simulate", methods=["POST"])
def live_simulate():
    """
    POST /live-simulate
    Body:
    {
      "deployment_id": "uuid",
      "run_id": "uuid",
      "threshold": 0.55,
      "simulation_mode": "synthetic_pipeline|source_batch",
      "persist_to_ledger": false,
      "auto_optimize_threshold": true,
      "max_event_loss_pct": 5.0,
      "scenario": "steady|noisy|drifted|bad_data",
      "batch_size": 200,
      "compare_run_ids": ["runA", "runB"],
      "seed": 42
    }
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        body = request.get_json(force=True) or {}
        deployment_id = str(body.get("deployment_id") or "").strip()
        run_id = str(body.get("run_id") or "").strip()
        threshold = float(body.get("threshold") or 0.5)
        simulation_mode = str(body.get("simulation_mode") or "synthetic_pipeline")
        persist_raw = body.get("persist_to_ledger", False)
        if isinstance(persist_raw, str):
            persist_to_ledger = persist_raw.strip().lower() in {"1", "true", "yes", "on"}
        else:
            persist_to_ledger = bool(persist_raw)
        threshold = _resolve_locked_deployment_threshold(env_root, deployment_id, threshold)
        auto_optimize_threshold = False
        max_event_loss_pct = float(body.get("max_event_loss_pct") or 5.0)
        scenario = str(body.get("scenario") or "steady")
        batch_size = int(body.get("batch_size") or 200)
        compare_run_ids = body.get("compare_run_ids") or []
        seed = body.get("seed")
        seed = None if seed is None else int(seed)
        pipeline_id = body.get("pipeline_id")
        pipeline_name = body.get("pipeline_name")

        if not deployment_id:
            return _err("deployment_id is required")
        if not run_id:
            return _err("run_id is required")

        result = svc.simulate_live_pipeline(
            deployment_id=deployment_id,
            run_id=run_id,
            threshold=threshold,
            simulation_mode=simulation_mode,
            persist_to_ledger=persist_to_ledger,
            auto_optimize_threshold=auto_optimize_threshold,
            max_event_loss_pct=max_event_loss_pct,
            scenario=scenario,
            batch_size=max(16, min(batch_size, 5000)),
            compare_run_ids=list(compare_run_ids) if isinstance(compare_run_ids, list) else [],
            seed=seed,
            pipeline_id=str(pipeline_id) if pipeline_id not in (None, "") else None,
            pipeline_name=str(pipeline_name) if pipeline_name not in (None, "") else None,
        )
        return _ok(result)

    except FileNotFoundError as e:
        return _err(str(e), 404)
    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/ledger", methods=["GET"])
def suppression_ledger():
    """
    GET /ledger?deployment_id=&run_id=&entity_type=alert|case&decision=suppressed&limit=100&offset=0
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        deployment_id = request.args.get("deployment_id") or ""
        run_id = request.args.get("run_id") or None
        entity_type = request.args.get("entity_type") or None
        decision = request.args.get("decision") or None
        include_simulation_raw = str(request.args.get("include_simulation") or "").strip().lower()
        include_simulation = include_simulation_raw in {"1", "true", "yes", "on"}
        limit = int(request.args.get("limit") or 100)
        offset = int(request.args.get("offset") or 0)

        if not deployment_id:
            return _err("deployment_id query param required")

        result = svc.suppression_ledger(
            deployment_id=deployment_id,
            run_id=run_id,
            entity_type=entity_type,
            decision=decision,
            include_simulation=include_simulation,
            limit=limit,
            offset=offset,
        )
        return _ok(result)

    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/kpis", methods=["GET"])
def kpi_summary():
    """
    GET /kpis?deployment_id=&run_id=&model_grain=alert|case
    Returns a compact KPI payload used by the live dashboard cards.
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        deployment_id = request.args.get("deployment_id") or ""
        run_id = request.args.get("run_id") or None
        model_grain = request.args.get("model_grain") or None
        include_simulation_raw = str(request.args.get("include_simulation") or "").strip().lower()
        include_simulation = include_simulation_raw in {"1", "true", "yes", "on"}

        if not deployment_id:
            return _err("deployment_id query param required")

        avc = svc.alert_vs_case_summary(
            deployment_id=deployment_id,
            run_id=run_id,
            model_grain=model_grain,
            include_simulation=include_simulation,
        )
        drift = svc.drift_stats(
            deployment_id=deployment_id,
            n_weeks=int(request.args.get("n_weeks") or 8),
            run_id=run_id,
            model_grain=model_grain,
            include_simulation=include_simulation,
        )

        resolved_grain = str((avc or {}).get("model_grain") or model_grain or "alert").strip().lower()
        if resolved_grain not in {"alert", "case"}:
            resolved_grain = "alert"
        row = (avc or {}).get(resolved_grain) or {}
        windows = (drift or {}).get("windows") or []
        latest_window = windows[-1] if windows else {}
        latest_event_loss_pct = latest_window.get("event_loss_pct")

        if latest_event_loss_pct is None and run_id:
            try:
                report_svc = _get_report_service(env_root)
                report = report_svc.get_run_report(str(tenant_id), str(env_id), str(run_id))
                if not report:
                    report = report_svc.generate_run_report(
                        tenant_id=str(tenant_id),
                        env_id=str(env_id),
                        run_id=str(run_id),
                    )
                threshold_analysis = report.get("threshold_analysis") if isinstance(report, dict) else {}
                business_impact = report.get("business_impact") if isinstance(report, dict) else {}
                latest_event_loss_pct = (
                    (threshold_analysis or {}).get("recommended_event_loss_pct")
                    if isinstance(threshold_analysis, dict)
                    else None
                )
                if latest_event_loss_pct is None and isinstance(business_impact, dict):
                    latest_event_loss_pct = business_impact.get("event_loss_pct")
            except Exception:
                latest_event_loss_pct = None

        total = int(row.get("total") or 0)
        suppressed = int(row.get("suppressed") or 0)
        escalated = int(row.get("escalated") or max(total - suppressed, 0))

        payload = {
            "model_grain": resolved_grain,
            "total_scored": total,
            "total_suppressed": suppressed,
            "total_escalated": escalated,
            "suppression_rate_pct": float(row.get("suppression_rate") or 0.0),
            "average_score": float(row.get("avg_score") or 0.0),
            "first_scored_at": row.get("first_scored"),
            "last_scored_at": row.get("last_scored"),
            "suppression_drift_pct": float((drift or {}).get("suppression_drift_pct") or 0.0),
            "latest_event_loss_pct": latest_event_loss_pct,
            "latest_window": latest_window.get("week"),
            "windows_count": len(windows),
        }
        return _ok(payload)
    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/handoff-sentinel", methods=["POST"])
def handoff_sentinel():
    """
    POST /handoff-sentinel

    One backend-owned FCC to Sentinel flow for the existing dashboard button.
    It can either:
      1. reuse a previously successful handoff for the same run, or
      2. simulate, publish, import, scope, and persist the shared workflow state.
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)
        report_service = _get_report_service(env_root)
        bridge = FCCSentinelBridgeService(env_root)

        body = request.get_json(force=True) or {}
        deployment_id = str(body.get("deployment_id") or "").strip()
        run_id = str(body.get("run_id") or "").strip()
        if not deployment_id:
            return _err("deployment_id is required")
        if not run_id:
            return _err("run_id is required")

        pipeline_id_raw = body.get("pipeline_id")
        pipeline_id = int(pipeline_id_raw) if pipeline_id_raw not in (None, "", []) else None
        pipeline_name = str(body.get("pipeline_name") or "").strip() or None
        threshold = float(body.get("threshold") or 0.5)
        force_refresh = _bool_value(body.get("force_refresh"), default=False)
        preferred_screen = str(body.get("preferred_screen") or "casepack").strip() or "casepack"
        requested_batch_id = str(body.get("batch_id") or "").strip()

        existing_session = report_service.get_workflow_session(
            tenant_id=str(tenant_id),
            env_id=str(env_id),
            pipeline_id=pipeline_id,
            run_id=run_id,
            deployment_id=deployment_id,
        )

        existing_handoff = dict(existing_session.get("handoff_summary") or {}) if existing_session else {}
        existing_scope = dict(existing_session.get("case_scope") or {}) if existing_session else {}
        existing_case_ids = [
            str(value).strip()
            for value in (
                existing_scope.get("case_ids")
                or existing_handoff.get("imported_case_ids")
                or []
            )
            if str(value or "").strip()
        ]

        if (
            existing_session
            and not force_refresh
            and (not requested_batch_id or requested_batch_id == str(existing_handoff.get("batch_id") or "").strip())
            and str(existing_session.get("publish_id") or "").strip()
            and existing_case_ids
        ):
            scope_result = bridge.set_active_case_scope(
                tenant_id=str(tenant_id),
                target_env_id=str(env_id),
                case_ids=existing_case_ids,
                run_id=existing_scope.get("run_id") or existing_handoff.get("focus_result", {}).get("run_id"),
                scope_type="CUSTOM",
                scope_value=existing_case_ids,
            )
            handoff_payload = {
                **existing_handoff,
                "preferred_screen": preferred_screen,
                "workflow_session_id": existing_session.get("session_id"),
                "reused_existing_handoff": True,
            }
            session = report_service.save_workflow_session(
                tenant_id=str(tenant_id),
                env_id=str(env_id),
                payload={
                    "session_id": existing_session.get("session_id"),
                    "pipeline_id": pipeline_id,
                    "pipeline_name": pipeline_name or existing_session.get("pipeline_name"),
                    "run_id": run_id,
                    "deployment_id": deployment_id,
                    "publish_id": existing_session.get("publish_id"),
                    "current_module": "investigation",
                    "current_step": preferred_screen,
                    "current_state": {
                        "preferred_screen": preferred_screen,
                        "selected_case_id": existing_session.get("selected_case_id") or (existing_case_ids[0] if existing_case_ids else None),
                        "pipeline_id": pipeline_id,
                        "pipeline_name": pipeline_name or existing_session.get("pipeline_name"),
                        "run_id": run_id,
                        "deployment_id": deployment_id,
                        "publish_id": existing_session.get("publish_id"),
                    },
                    "case_scope": scope_result,
                    "handoff_summary": handoff_payload,
                    "selected_case_id": existing_session.get("selected_case_id") or (existing_case_ids[0] if existing_case_ids else None),
                    "mark_current_stable": True,
                    "checkpoint_key": existing_session.get("checkpoint_key") or "SENTINEL_SCOPE_READY",
                    "status": "sentinel_ready",
                },
            )
            return _ok(
                {
                    "reused": True,
                    "simulation": None,
                    "publish": {"publish_id": session.get("publish_id")},
                    "import": {
                        "publish_id": session.get("publish_id"),
                        "imported_case_ids": existing_case_ids,
                        "imported_case_count": len(existing_case_ids),
                    },
                    "scope": scope_result,
                    "handoff": session.get("handoff_summary") or handoff_payload,
                    "workflow_session": session,
                }
            )

        simulation = None
        batch_id = requested_batch_id
        if batch_id:
            existing_batch = next(
                (
                    row for row in bridge.list_scored_batches(run_id=run_id, deployment_id=deployment_id)
                    if str(row.get("batch_id") or "").strip() == batch_id
                ),
                None,
            )
            if not existing_batch:
                return _err(f"Requested scored batch {batch_id} was not found for this FCC run.", 404)
            simulation = {
                "generated_at": existing_batch.get("scored_at") or existing_batch.get("created_at"),
                "preview_tables": {},
                "scoring": {
                    "batch_id": batch_id,
                    "total": int(existing_batch.get("total") or 0),
                    "suppressed": int(existing_batch.get("suppressed") or 0),
                    "escalated": int(existing_batch.get("escalated") or 0),
                    "threshold": float(existing_batch.get("threshold") or threshold),
                    "threshold_requested": float(existing_batch.get("threshold") or threshold),
                    "threshold_applied": float(existing_batch.get("threshold") or threshold),
                    "threshold_auto_optimized": False,
                },
            }
        else:
            simulation = svc.simulate_live_pipeline(
                deployment_id=deployment_id,
                run_id=run_id,
                threshold=threshold,
                simulation_mode=str(body.get("simulation_mode") or "synthetic_pipeline"),
                persist_to_ledger=_bool_value(body.get("persist_to_ledger"), default=True),
                auto_optimize_threshold=body.get("auto_optimize_threshold"),
                max_event_loss_pct=float(body.get("max_event_loss_pct") or 5.0),
                scenario=str(body.get("scenario") or "steady"),
                batch_size=max(16, min(int(body.get("batch_size") or 20), 5000)),
                compare_run_ids=list(body.get("compare_run_ids") or []) if isinstance(body.get("compare_run_ids"), list) else [],
                seed=(None if body.get("seed") in (None, "") else int(body.get("seed"))),
                pipeline_id=str(pipeline_id) if pipeline_id is not None else None,
                pipeline_name=pipeline_name,
            )
            batch_id = str(simulation.get("scoring", {}).get("batch_id") or "").strip()
        if not batch_id:
            return _err("Scored FCC batch was created, but no batch_id was returned for Sentinel handoff.", 500)

        publish_label = str(body.get("publish_label") or "").strip()
        if not publish_label:
            publish_label = (
                f"{pipeline_name} retained queue {simulation.get('generated_at') or ''}".strip()
                if pipeline_name
                else f"FCC retained queue {simulation.get('generated_at') or ''}".strip()
            )

        publish_payload = bridge.publish_batch(
            batch_id=batch_id,
            run_id=run_id,
            deployment_id=deployment_id,
            include_suppressed=_bool_value(body.get("include_suppressed"), default=False),
            publish_label=publish_label,
            pipeline_id=str(pipeline_id) if pipeline_id is not None else None,
            pipeline_name=pipeline_name,
        )
        publish_id = str(publish_payload.get("publish_id") or "").strip()
        if not publish_id:
            return _err("Sentinel publish package was created, but no publish_id was returned.", 500)

        import_payload = bridge.import_published_run(
            publish_id=publish_id,
            tenant_id=str(tenant_id),
            target_env_id=str(env_id),
            replace_existing=_bool_value(body.get("replace_existing"), default=True),
            merge_existing=_bool_value(body.get("merge_existing"), default=False),
            rerank_after_import=_bool_value(body.get("rerank_after_import"), default=True),
        )

        imported_case_ids = [
            str(value).strip()
            for value in (import_payload.get("imported_case_ids") or [])
            if str(value or "").strip()
        ]
        focus_result = import_payload.get("focus_result") or {}
        scope_result = bridge.set_active_case_scope(
            tenant_id=str(tenant_id),
            target_env_id=str(env_id),
            case_ids=imported_case_ids,
            run_id=focus_result.get("run_id"),
            scope_type="CUSTOM",
            scope_value=imported_case_ids,
        )

        selected_case_id = imported_case_ids[0] if imported_case_ids else None
        handoff_payload = {
            "source": "fcc_workbench",
            "handoff_type": "fcc_to_sentinel",
            "preferred_screen": preferred_screen,
            "env_id": env_id,
            "pipeline_id": pipeline_id,
            "pipeline_name": pipeline_name,
            "run_id": run_id,
            "deployment_id": deployment_id,
            "batch_id": batch_id,
            "publish_id": publish_id,
            "publish_label": publish_payload.get("publish_label"),
            "imported_case_ids": imported_case_ids,
            "imported_case_count": int(import_payload.get("imported_case_count") or len(imported_case_ids)),
            "imported_alert_count": int(import_payload.get("imported_alert_count") or 0),
            "source_published_rows": int(import_payload.get("source_published_rows") or publish_payload.get("published_rows") or 0),
            "case_generation_mode": import_payload.get("case_generation_mode"),
            "suppressed_count": int(simulation.get("scoring", {}).get("suppressed") or 0),
            "escalated_count": int(simulation.get("scoring", {}).get("escalated") or 0),
            "total_scored": int(simulation.get("scoring", {}).get("total") or 0),
            "threshold": float(simulation.get("scoring", {}).get("threshold_applied") or simulation.get("scoring", {}).get("threshold") or threshold),
            "requested_row_count": int(simulation.get("scoring", {}).get("total") or body.get("batch_size") or 20),
            "prediction_preview": simulation.get("preview_tables", {}).get("prediction_output"),
            "retained_preview": simulation.get("preview_tables", {}).get("retained_queue"),
            "master_data_preview": simulation.get("preview_tables", {}).get("master_data"),
            "prepared_feature_preview": simulation.get("preview_tables", {}).get("prepared_features"),
            "focus_result": focus_result,
            "selected_case_id": selected_case_id,
        }

        session = report_service.save_workflow_session(
            tenant_id=str(tenant_id),
            env_id=str(env_id),
            payload={
                "session_id": existing_session.get("session_id") if existing_session else None,
                "pipeline_id": pipeline_id,
                "pipeline_name": pipeline_name,
                "run_id": run_id,
                "deployment_id": deployment_id,
                "publish_id": publish_id,
                "current_module": "investigation",
                "current_step": preferred_screen,
                "current_state": {
                    "preferred_screen": preferred_screen,
                    "selected_case_id": selected_case_id,
                    "pipeline_id": pipeline_id,
                    "pipeline_name": pipeline_name,
                    "run_id": run_id,
                    "deployment_id": deployment_id,
                    "publish_id": publish_id,
                },
                "last_stable_step": preferred_screen,
                "case_scope": scope_result,
                "selected_case_id": selected_case_id,
                "handoff_summary": handoff_payload,
                "mark_current_stable": True,
                "checkpoint_key": "SENTINEL_SCOPE_READY",
                "status": "sentinel_ready",
            },
        )

        saved_handoff = {
            **(session.get("handoff_summary") or handoff_payload),
            "workflow_session_id": session.get("session_id"),
            "preferred_screen": preferred_screen,
        }
        return _ok(
            {
                "reused": False,
                "simulation": simulation,
                "publish": publish_payload,
                "import": import_payload,
                "scope": scope_result,
                "handoff": saved_handoff,
                "workflow_session": session,
            }
        )

    except FileNotFoundError as e:
        return _err(str(e), 404)
    except ValueError as e:
        return _err(str(e), 400)
    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/drift", methods=["GET"])
def drift_stats():
    """
    GET /drift?deployment_id=&run_id=&model_grain=alert|case&n_weeks=8
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        deployment_id = request.args.get("deployment_id") or ""
        run_id = request.args.get("run_id") or None
        model_grain = request.args.get("model_grain") or None
        include_simulation_raw = str(request.args.get("include_simulation") or "").strip().lower()
        include_simulation = include_simulation_raw in {"1", "true", "yes", "on"}
        n_weeks = int(request.args.get("n_weeks") or 8)

        if not deployment_id:
            return _err("deployment_id query param required")

        result = svc.drift_stats(
            deployment_id=deployment_id,
            n_weeks=n_weeks,
            run_id=run_id,
            model_grain=model_grain,
            include_simulation=include_simulation,
        )
        return _ok(result)

    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/model-lineage", methods=["GET", "POST"])
def model_lineage():
    """
    POST /model-lineage
    Body: { "run_id": "uuid", "deployment_id": "uuid", "run_meta": {...} }
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        if request.method == "GET":
            body = {}
            run_id = request.args.get("run_id") or ""
            deployment_id = request.args.get("deployment_id") or ""
            run_meta = {}
        else:
            body = request.get_json(force=True) or {}
            run_id = body.get("run_id") or ""
            deployment_id = body.get("deployment_id") or ""
            run_meta = body.get("run_meta") or {}

        if not run_id:
            return _err("run_id is required")

        result = svc.model_lineage(
            run_id=run_id,
            deployment_id=deployment_id,
            run_meta=run_meta,
        )
        return _ok(result)

    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/inference-explain", methods=["POST"])
def inference_explain():
    """
    POST /inference-explain
    Body: { "run_id": "uuid", "record": {...features...}, "threshold": 0.5, "top_n": 8 }
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        body = request.get_json(force=True) or {}
        run_id = str(body.get("run_id") or "").strip()
        record = body.get("record") or {}
        threshold = float(body.get("threshold") or 0.5)
        top_n = int(body.get("top_n") or 8)

        if not run_id:
            return _err("run_id is required")
        if not isinstance(record, dict):
            return _err("record must be an object")

        result = svc.inference_explain(
            run_id=run_id,
            record=record,
            threshold=threshold,
            top_n=max(1, min(top_n, 20)),
        )
        return _ok(result)

    except FileNotFoundError as e:
        return _err(str(e), 404)
    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/alert-vs-case", methods=["GET"])
def alert_vs_case():
    """
    GET /alert-vs-case?deployment_id=&run_id=&model_grain=alert|case
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        deployment_id = request.args.get("deployment_id") or ""
        run_id = request.args.get("run_id") or None
        model_grain = request.args.get("model_grain") or None
        include_simulation_raw = str(request.args.get("include_simulation") or "").strip().lower()
        include_simulation = include_simulation_raw in {"1", "true", "yes", "on"}
        if not deployment_id:
            return _err("deployment_id required")

        result = svc.alert_vs_case_summary(
            deployment_id=deployment_id,
            run_id=run_id,
            model_grain=model_grain,
            include_simulation=include_simulation,
        )
        return _ok(result)

    except Exception as e:
        return _err(str(e), 500)


@deployment_dashboard_bp.route("/event-loss-trend", methods=["GET"])
def event_loss_trend():
    """
    GET /event-loss-trend?deployment_id=&run_id=&model_grain=alert|case&n_weeks=8
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        svc = _get_service(env_root)

        deployment_id = request.args.get("deployment_id") or ""
        run_id = request.args.get("run_id") or None
        model_grain = request.args.get("model_grain") or None
        include_simulation_raw = str(request.args.get("include_simulation") or "").strip().lower()
        include_simulation = include_simulation_raw in {"1", "true", "yes", "on"}
        n_weeks = int(request.args.get("n_weeks") or 8)

        if not deployment_id:
            return _err("deployment_id required")

        result = svc.event_loss_trend(
            deployment_id=deployment_id,
            n_weeks=n_weeks,
            run_id=run_id,
            model_grain=model_grain,
            include_simulation=include_simulation,
        )
        return _ok(result)

    except Exception as e:
        return _err(str(e), 500)
