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
from pathlib import Path
from typing import Dict

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.deployment_dashboard_service import DeploymentDashboardService
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root

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
        auto_optimize_threshold = body.get("auto_optimize_threshold")
        max_event_loss_pct = float(body.get("max_event_loss_pct") or 5.0)
        scenario = str(body.get("scenario") or "steady")
        batch_size = int(body.get("batch_size") or 200)
        compare_run_ids = body.get("compare_run_ids") or []
        seed = body.get("seed")
        seed = None if seed is None else int(seed)

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
