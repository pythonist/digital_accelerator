from __future__ import annotations

from pathlib import Path

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.mule_preprocessing_service import MulePreprocessingService
from api.tools.mlops.mule_preprocessing_workbench_service import MulePreprocessingWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root


mule_preprocessing_bp = Blueprint("mule_preprocessing", __name__)


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


def _service(env_id: str, tenant_id: str) -> MulePreprocessingService:
    env_root = resolve_env_root(env_id, tenant_id, create_if_missing=False)
    db_path = Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"
    return MulePreprocessingService(db_path)


def _workbench_service(env_id: str, tenant_id: str) -> MulePreprocessingWorkbenchService:
    env_root = resolve_env_root(env_id, tenant_id, create_if_missing=False)
    db_path = Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"
    return MulePreprocessingWorkbenchService(db_path)


@mule_preprocessing_bp.route("/preprocessing/config", methods=["GET", "POST"])
def mule_preprocessing_config():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _service(env_id, tenant_id)
        result = service.load_config(tenant_id, env_id, pipeline_id) if request.method == "GET" else service.save_config(
            tenant_id,
            env_id,
            pipeline_id,
            patch=body.get("config") if isinstance(body.get("config"), dict) else body,
        )
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/preview", methods=["POST"])
def mule_preprocessing_preview():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _service(env_id, tenant_id)
        patch = body.get("config") if isinstance(body.get("config"), dict) else body
        if isinstance((patch or {}).get("steps"), list):
            result = service.preview_workbench(
                tenant_id,
                env_id,
                pipeline_id,
                patch=patch,
                sample_rows=int(body.get("sample_rows") or 100),
            )
        else:
            if isinstance(body.get("config"), dict) or any(key in body for key in ("controls", "feature_groups", "output_table_name")):
                service.save_config(tenant_id, env_id, pipeline_id, patch=patch)
            result = service.preview(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/run", methods=["POST"])
def mule_preprocessing_run():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _service(env_id, tenant_id)
        patch = body.get("config") if isinstance(body.get("config"), dict) else body
        if isinstance((patch or {}).get("steps"), list):
            result = service.run_workbench(tenant_id, env_id, pipeline_id, patch=patch)
        else:
            if isinstance(body.get("config"), dict) or any(key in body for key in ("controls", "feature_groups", "output_table_name")):
                service.save_config(tenant_id, env_id, pipeline_id, patch=patch)
            result = service.run(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/status/<int:pipeline_id>", methods=["GET"])
def mule_preprocessing_status(pipeline_id: int):
    try:
        tenant_id, env_id = _get_env_ids()
        result = _service(env_id, tenant_id).status(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/overview", methods=["GET"])
def mule_preprocessing_overview():
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).overview.get_payload(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/transform", methods=["GET", "POST"])
def mule_preprocessing_transform():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _workbench_service(env_id, tenant_id).transform
        result = service.get_payload(tenant_id, env_id, pipeline_id) if request.method == "GET" else service.save(tenant_id, env_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/transform/auto", methods=["POST"])
def mule_preprocessing_transform_auto():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).transform.auto_configure(tenant_id, env_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/transform/validate", methods=["POST"])
def mule_preprocessing_transform_validate():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).transform.validate(tenant_id, env_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/transform/preview", methods=["GET"])
def mule_preprocessing_transform_preview():
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).transform.preview(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/feature-builder", methods=["GET", "POST"])
def mule_preprocessing_feature_builder():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _workbench_service(env_id, tenant_id).builder
        result = service.get_payload(tenant_id, env_id, pipeline_id) if request.method == "GET" else service.save(tenant_id, env_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/feature-builder/validate", methods=["POST"])
def mule_preprocessing_feature_builder_validate():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).builder.validate_custom_feature(tenant_id, env_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/feature-selection", methods=["GET", "POST"])
def mule_preprocessing_feature_selection():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _workbench_service(env_id, tenant_id).selection
        result = service.get_payload(tenant_id, env_id, pipeline_id) if request.method == "GET" else service.save(tenant_id, env_id, pipeline_id, body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/feature-selection/analyze", methods=["GET"])
def mule_preprocessing_feature_selection_analyze():
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).selection.analyze(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/pipeline-run", methods=["GET"])
def mule_preprocessing_pipeline_run_status():
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).pipeline_run.get_status(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/pipeline-run/start", methods=["POST"])
def mule_preprocessing_pipeline_run_start():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).pipeline_run.start(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/pipeline-run/retry", methods=["POST"])
def mule_preprocessing_pipeline_run_retry():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).pipeline_run.retry(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/pipeline-run/cancel", methods=["POST"])
def mule_preprocessing_pipeline_run_cancel():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).pipeline_run.cancel(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_preprocessing_bp.route("/preprocessing/summary", methods=["GET"])
def mule_preprocessing_summary():
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = _workbench_service(env_id, tenant_id).summary.get_payload(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500
