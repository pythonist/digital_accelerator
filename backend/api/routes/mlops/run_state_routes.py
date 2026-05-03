from __future__ import annotations

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.path_utils import resolve_env_root
from api.tools.mlops.run_state_service import (
    RunStateService,
    extract_step_inputs,
    extract_step_outputs,
)


run_state_bp = Blueprint("mlops_run_state", __name__)


def _get_env_ids():
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or services.metadata_manager.active_env
    )
    if not env_id:
        raise ValueError("X-Environment-ID header required")
    tenant_id = request.tenant_id
    return tenant_id, env_id


def _get_run_state_service(tenant_id: str, env_id: str) -> RunStateService:
    env_root = resolve_env_root(env_id, tenant_id, create_if_missing=False)
    db_path = env_root / "mlops" / "duckdb" / "mlops.duckdb"
    return RunStateService(db_path)


def _json_body() -> dict:
    payload = request.get_json(silent=True) or {}
    return payload if isinstance(payload, dict) else {}


@run_state_bp.route("/run/current", methods=["GET"])
def get_current_run_state():
    """
    GET /api/mlops/run/current?pipeline_id=123

    Returns the active RUN_STATE for a saved pipeline, creating one if needed
    unless create=0 is supplied.
    """
    try:
        tenant_id, env_id = _get_env_ids()
        pipeline_id = int(request.args.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return jsonify({
                "success": False,
                "error": "pipeline_id is required",
                "error_code": "VALIDATION_ERROR",
            }), 400
        create_if_missing = str(request.args.get("create", "1")).strip().lower() not in {"0", "false", "no"}
        svc = _get_run_state_service(tenant_id, env_id)
        result = svc.get_active_run_state(
            tenant_id,
            env_id,
            pipeline_id=pipeline_id,
            pipeline_uuid=request.args.get("pipeline_uuid"),
            pipeline_name=request.args.get("pipeline_name") or "",
            pipeline_type=request.args.get("pipeline_type") or "fcc",
            create_if_missing=create_if_missing,
        )
        if not result:
            return jsonify({"success": False, "error": "RUN_STATE not found", "error_code": "NOT_FOUND"}), 404
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@run_state_bp.route("/run", methods=["POST"])
def create_run_state():
    """
    POST /api/mlops/run

    Body: { pipeline_id?, pipeline_uuid?, pipeline_name?, pipeline_type?, run_id? }
    """
    try:
        body = _json_body()
        tenant_id, env_id = _get_env_ids()
        pipeline_id = body.get("pipeline_id")
        svc = _get_run_state_service(tenant_id, env_id)
        result = svc.create_run_state(
            tenant_id,
            env_id,
            pipeline_id=int(pipeline_id) if pipeline_id not in (None, "", []) else None,
            pipeline_uuid=str(body.get("pipeline_uuid") or "").strip() or None,
            pipeline_name=str(body.get("pipeline_name") or body.get("name") or "").strip(),
            pipeline_type=str(body.get("pipeline_type") or "fcc").strip().lower() or "fcc",
            run_id=str(body.get("run_id") or "").strip() or None,
            status=str(body.get("status") or "running").strip().lower() or "running",
            current_step=str(body.get("current_step") or "data_upload").strip().lower() or "data_upload",
            steps=body.get("steps_json") if isinstance(body.get("steps_json"), dict) else None,
        )
        return jsonify({"success": True, "data": result}), 201
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@run_state_bp.route("/run/<run_id>", methods=["GET"])
def get_run_state(run_id: str):
    """GET /api/mlops/run/<run_id> -> full persistent RUN_STATE."""
    try:
        tenant_id, env_id = _get_env_ids()
        svc = _get_run_state_service(tenant_id, env_id)
        result = svc.get_run_state(tenant_id, env_id, str(run_id))
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "NOT_FOUND"}), 404
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@run_state_bp.route("/step/<step_name>/execute", methods=["POST"])
def execute_step(step_name: str):
    """
    POST /api/mlops/step/<step_name>/execute

    Generic stateful step contract. If a completed step receives unchanged
    inputs, it returns skipped=true and does not overwrite outputs.
    """
    try:
        body = _json_body()
        tenant_id, env_id = _get_env_ids()
        svc = _get_run_state_service(tenant_id, env_id)

        run_id = str(body.get("run_id") or "").strip()
        pipeline_id = body.get("pipeline_id")
        if not run_id:
            if pipeline_id in (None, "", []):
                return jsonify({
                    "success": False,
                    "error": "run_id or pipeline_id is required",
                    "error_code": "VALIDATION_ERROR",
                }), 400
            active = svc.get_active_run_state(
                tenant_id,
                env_id,
                pipeline_id=int(pipeline_id),
                pipeline_uuid=str(body.get("pipeline_uuid") or "").strip() or None,
                pipeline_name=str(body.get("pipeline_name") or "").strip(),
                pipeline_type=str(body.get("pipeline_type") or "fcc").strip().lower() or "fcc",
                create_if_missing=True,
            )
            run_id = str(active.get("run_id") or "").strip()

        state = body.get("state") if isinstance(body.get("state"), dict) else {}
        inputs = body.get("inputs") if isinstance(body.get("inputs"), dict) else extract_step_inputs(step_name, state)
        outputs = body.get("outputs") if isinstance(body.get("outputs"), dict) else extract_step_outputs(step_name, state)
        result = svc.execute_step(
            tenant_id,
            env_id,
            run_id,
            step_name,
            inputs=inputs,
            outputs=outputs,
            status=str(body.get("status") or "completed").strip().lower() or "completed",
            force=bool(body.get("force")),
            pipeline_id=int(pipeline_id) if pipeline_id not in (None, "", []) else None,
            pipeline_uuid=str(body.get("pipeline_uuid") or "").strip() or None,
            pipeline_name=str(body.get("pipeline_name") or "").strip(),
            pipeline_type=str(body.get("pipeline_type") or "fcc").strip().lower() or "fcc",
        )
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@run_state_bp.route("/step/<step_name>/data", methods=["GET"])
def get_step_data(step_name: str):
    """GET /api/mlops/step/<step_name>/data?run_id=... -> saved output refs."""
    try:
        tenant_id, env_id = _get_env_ids()
        svc = _get_run_state_service(tenant_id, env_id)
        run_id = str(request.args.get("run_id") or "").strip()
        pipeline_id = request.args.get("pipeline_id")
        if not run_id and pipeline_id not in (None, "", []):
            active = svc.get_active_run_state(
                tenant_id,
                env_id,
                pipeline_id=int(pipeline_id),
                create_if_missing=False,
            )
            run_id = str((active or {}).get("run_id") or "").strip()
        if not run_id:
            return jsonify({
                "success": False,
                "error": "run_id or pipeline_id is required",
                "error_code": "VALIDATION_ERROR",
            }), 400
        result = svc.get_step_data(tenant_id, env_id, run_id, step_name)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "NOT_FOUND"}), 404
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500
