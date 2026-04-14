from __future__ import annotations

from pathlib import Path

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.mule_model_build_service import MuleModelBuildService
from api.tools.mlops.mule_model_workbench import (
    MuleModelChampionWorkbenchService,
    MuleModelEvaluationWorkbenchService,
    MuleModelExplainabilityWorkbenchService,
    MuleModelGraphWorkbenchService,
    MuleModelPolicyWorkbenchService,
    MuleModelSequenceWorkbenchService,
    MuleModelSummaryWorkbenchService,
    MuleModelSupervisedWorkbenchService,
    MuleModelTuningWorkbenchService,
    MuleModelValidationWorkbenchService,
    MuleModelWorkbenchRepository,
    MuleModelWorkbenchRunner,
)
from api.tools.mlops.mule_preprocessing_service import MulePreprocessingService
from api.tools.mlops.path_utils import resolve_env_root


mule_model_build_bp = Blueprint("mule_model_build", __name__)


def _get_env_ids():
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or services.metadata_manager.active_env
    )
    if not env_id:
        raise ValueError("X-Environment-ID header required")
    tenant_id = getattr(request, "tenant_id", None) or "fccanalytics"
    return tenant_id, env_id


def _db_path(env_id: str, tenant_id: str) -> Path:
    env_root = resolve_env_root(env_id, tenant_id, create_if_missing=False)
    return Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"


def _workbench(env_id: str, tenant_id: str):
    repo = MuleModelWorkbenchRepository(_db_path(env_id, tenant_id))
    return {
        "repo": repo,
        "validation": MuleModelValidationWorkbenchService(repo),
        "supervised": MuleModelSupervisedWorkbenchService(repo),
        "sequence": MuleModelSequenceWorkbenchService(repo),
        "graph": MuleModelGraphWorkbenchService(repo),
        "tuning": MuleModelTuningWorkbenchService(repo),
        "evaluation": MuleModelEvaluationWorkbenchService(repo),
        "explainability": MuleModelExplainabilityWorkbenchService(repo),
        "champion": MuleModelChampionWorkbenchService(repo),
        "policy": MuleModelPolicyWorkbenchService(repo),
        "summary": MuleModelSummaryWorkbenchService(repo),
        "runner": MuleModelWorkbenchRunner(repo),
    }


@mule_model_build_bp.route("/model-build/config", methods=["GET", "POST"])
def mule_model_build_config():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        db_path = _db_path(env_id, tenant_id)
        governance = MulePreprocessingService(db_path).status(tenant_id, env_id, pipeline_id).get("feature_governance") or {}
        service = MuleModelBuildService(db_path)
        result = service.load_config(pipeline_id) if request.method == "GET" else service.save_config(
            tenant_id,
            pipeline_id,
            body.get("config") if isinstance(body.get("config"), dict) else body,
            governance.get("approved_features") or [],
            governance.get("blocked_features") or [],
        )
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/train", methods=["POST"])
def mule_model_build_train():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        db_path = _db_path(env_id, tenant_id)
        governance = MulePreprocessingService(db_path).status(tenant_id, env_id, pipeline_id).get("feature_governance") or {}
        result = MuleModelBuildService(db_path).train(
            tenant_id,
            env_id,
            pipeline_id,
            body.get("config") if isinstance(body.get("config"), dict) else body,
            governance,
        )
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/validation", methods=["GET", "POST"])
def mule_model_build_validation():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        wb = _workbench(env_id, tenant_id)
        result = wb["validation"].get_payload(tenant_id, env_id, pipeline_id) if request.method == "GET" else wb["validation"].save(tenant_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/supervised", methods=["GET", "POST"])
def mule_model_build_supervised():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        wb = _workbench(env_id, tenant_id)
        result = wb["supervised"].get_payload(tenant_id, env_id, pipeline_id) if request.method == "GET" else wb["supervised"].save(tenant_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/sequence", methods=["GET", "POST"])
def mule_model_build_sequence():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        wb = _workbench(env_id, tenant_id)
        result = wb["sequence"].get_payload(tenant_id, env_id, pipeline_id) if request.method == "GET" else wb["sequence"].save(tenant_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/graph", methods=["GET", "POST"])
def mule_model_build_graph():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        wb = _workbench(env_id, tenant_id)
        result = wb["graph"].get_payload(tenant_id, env_id, pipeline_id) if request.method == "GET" else wb["graph"].save(tenant_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/tuning", methods=["GET", "POST"])
def mule_model_build_tuning():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        wb = _workbench(env_id, tenant_id)
        result = wb["tuning"].get_payload(tenant_id, env_id, pipeline_id) if request.method == "GET" else wb["tuning"].save(tenant_id, env_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/evaluation", methods=["GET"])
def mule_model_build_evaluation():
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench(env_id, tenant_id)["evaluation"].get_payload(pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/explainability", methods=["GET"])
def mule_model_build_explainability():
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench(env_id, tenant_id)["explainability"].get_payload(pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/champion", methods=["GET", "POST"])
def mule_model_build_champion():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        wb = _workbench(env_id, tenant_id)
        result = wb["champion"].get_payload(pipeline_id) if request.method == "GET" else wb["champion"].promote(pipeline_id, int(body.get("run_id") or 0))
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/policy", methods=["GET", "POST"])
def mule_model_build_policy():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        wb = _workbench(env_id, tenant_id)
        result = wb["policy"].get_payload(pipeline_id) if request.method == "GET" else wb["policy"].save(tenant_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/summary", methods=["GET"])
def mule_model_build_summary():
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench(env_id, tenant_id)["summary"].get_payload(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/workbench-train", methods=["POST"])
def mule_model_build_workbench_train():
    tenant_id = None
    env_id = None
    pipeline_id = 0
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench(env_id, tenant_id)["runner"].run(tenant_id, env_id, pipeline_id, body if isinstance(body, dict) else {})
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        try:
            if tenant_id and env_id and pipeline_id > 0:
                wb = _workbench(env_id, tenant_id)
                wb["repo"].workspace.ensure_run(int(pipeline_id), user_id=tenant_id)
                wb["repo"].workspace.set_stage_state(
                    int(pipeline_id),
                    "model_build",
                    "failed",
                    substage="supervised",
                    summary={"status": "failed", "workspace_stage": "supervised"},
                    error={"message": str(exc)},
                )
                wb["repo"].workspace.upsert_job(
                    f"mule-model-workbench-{int(pipeline_id)}",
                    int(pipeline_id),
                    "model_build",
                    "model_workbench_train",
                    "failed",
                    progress_pct=100.0,
                    logs={"message": str(exc)},
                )
        except Exception:
            pass
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        try:
            if tenant_id and env_id and pipeline_id > 0:
                wb = _workbench(env_id, tenant_id)
                wb["repo"].workspace.ensure_run(int(pipeline_id), user_id=tenant_id)
                wb["repo"].workspace.set_stage_state(
                    int(pipeline_id),
                    "model_build",
                    "failed",
                    substage="supervised",
                    summary={"status": "failed", "workspace_stage": "supervised"},
                    error={"message": str(exc)},
                )
                wb["repo"].workspace.upsert_job(
                    f"mule-model-workbench-{int(pipeline_id)}",
                    int(pipeline_id),
                    "model_build",
                    "model_workbench_train",
                    "failed",
                    progress_pct=100.0,
                    logs={"message": str(exc)},
                )
        except Exception:
            pass
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_model_build_bp.route("/model-build/status/<int:pipeline_id>", methods=["GET"])
def mule_model_build_status(pipeline_id: int):
    try:
        tenant_id, env_id = _get_env_ids()
        db_path = _db_path(env_id, tenant_id)
        result = MuleModelBuildService(db_path).status(pipeline_id, tenant_id=tenant_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500
