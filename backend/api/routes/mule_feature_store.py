from __future__ import annotations

from pathlib import Path

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.mule_feature_store_service import MuleFeatureStoreService
from api.tools.mlops.path_utils import resolve_env_root


mule_feature_store_bp = Blueprint("mule_feature_store", __name__)


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


def _service(env_id: str, tenant_id: str) -> MuleFeatureStoreService:
    env_root = resolve_env_root(env_id, tenant_id, create_if_missing=False)
    db_path = Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"
    return MuleFeatureStoreService(db_path)


@mule_feature_store_bp.route("/feature-store/config", methods=["GET", "POST"])
def mule_feature_store_config():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _service(env_id, tenant_id)
        result = service.load_config(pipeline_id) if request.method == "GET" else service.save_config(tenant_id, env_id, pipeline_id, patch=body)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_feature_store_bp.route("/feature-store/generate", methods=["POST"])
def mule_feature_store_generate():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        regenerate = bool(body.get("regenerate"))
        result = _service(env_id, tenant_id).generate(tenant_id, env_id, pipeline_id, regenerate=regenerate)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_feature_store_bp.route("/feature-store/status/<int:pipeline_id>", methods=["GET"])
def mule_feature_store_status(pipeline_id: int):
    try:
        tenant_id, env_id = _get_env_ids()
        result = _service(env_id, tenant_id).status(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500
