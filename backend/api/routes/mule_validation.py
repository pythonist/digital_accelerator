from __future__ import annotations

from pathlib import Path

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.mule_validation_service import MuleValidationService
from api.tools.mlops.path_utils import resolve_env_root


mule_validation_bp = Blueprint("mule_validation", __name__)


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


@mule_validation_bp.route("/model-validation/run", methods=["POST"])
def mule_model_validation_run():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = int(request.args.get("pipeline_id") or body.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        result = MuleValidationService(_db_path(env_id, tenant_id)).run(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_validation_bp.route("/model-validation/status/<int:pipeline_id>", methods=["GET"])
def mule_model_validation_status(pipeline_id: int):
    try:
        tenant_id, env_id = _get_env_ids()
        result = MuleValidationService(_db_path(env_id, tenant_id)).status(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_validation_bp.route("/model-validation/graph/<int:pipeline_id>", methods=["GET"])
def mule_model_validation_graph(pipeline_id: int):
    try:
        tenant_id, env_id = _get_env_ids()
        result = MuleValidationService(_db_path(env_id, tenant_id)).graph(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500
