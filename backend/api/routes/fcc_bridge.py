from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root
from services.fcc_sentinel_bridge import FCCSentinelBridgeService


fcc_bridge_bp = Blueprint("fcc_bridge", __name__)


def _bool_value(value, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _resolve_source_context():
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or services.metadata_manager.active_env
    )
    if not env_id:
        raise ValueError("X-Environment-ID header required")
    tenant_id = getattr(request, "tenant_id", None) or "default"
    return str(tenant_id), str(env_id)


def _ensure_sentinel_environment_initialized(env_id: str, tenant_id: str) -> None:
    env_name = str(env_id or "").strip()
    tenant_name = str(tenant_id or "").strip() or "default"
    if not env_name:
        return

    metadata_manager = getattr(services, "metadata_manager", None)
    if metadata_manager is None:
        return

    env_root = Path(metadata_manager.base_dir) / tenant_name / env_name
    for relative_dir in (
        Path("investigation/source_data"),
        Path("investigation/master_data"),
        Path("investigation/vector_store"),
        Path("calibration/experiments"),
        Path("calibration/datasets"),
        Path("audit_logs"),
    ):
        (env_root / relative_dir).mkdir(parents=True, exist_ok=True)

    registry_path = env_root / "registry.json"
    if not registry_path.exists():
        registry_path.write_text(json.dumps({
            "case_id": env_name,
            "tenant_id": tenant_name,
            "created_at": datetime.now().isoformat(),
            "tables": {},
            "pipeline_stage": "INIT",
        }, indent=2), encoding="utf-8")

    for db_path in (
        env_root / "investigation" / "investigation.db",
        env_root / "calibration" / "calibration.db",
    ):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(db_path):
            pass


def _get_mlops_service(env_root: Path) -> MLOpsWorkbenchService:
    mlops_db = Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"
    return MLOpsWorkbenchService(mlops_db)


@fcc_bridge_bp.route("/fcc-bridge/scored-batches", methods=["GET"])
def list_scored_batches():
    try:
        tenant_id, env_id = _resolve_source_context()
        env_root = resolve_env_root(env_id, tenant_id, create_if_missing=True)
        bridge = FCCSentinelBridgeService(env_root)
        rows = bridge.list_scored_batches(
            run_id=request.args.get("run_id") or None,
            deployment_id=request.args.get("deployment_id") or None,
        )
        return jsonify({"success": True, "batches": rows, "count": len(rows), "env_id": env_id})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@fcc_bridge_bp.route("/fcc-bridge/publish", methods=["POST"])
def publish_to_sentinel():
    try:
        tenant_id, env_id = _resolve_source_context()
        env_root = resolve_env_root(env_id, tenant_id, create_if_missing=True)
        bridge = FCCSentinelBridgeService(env_root)
        body = request.get_json(force=True) or {}
        result = bridge.publish_batch(
            batch_id=str(body.get("batch_id") or "").strip() or None,
            run_id=str(body.get("run_id") or "").strip() or None,
            deployment_id=str(body.get("deployment_id") or "").strip() or None,
            include_suppressed=_bool_value(body.get("include_suppressed"), default=False),
            publish_label=str(body.get("publish_label") or "").strip() or None,
            pipeline_id=str(body.get("pipeline_id") or "").strip() or None,
            pipeline_name=str(body.get("pipeline_name") or "").strip() or None,
        )
        return jsonify({"success": True, "publish": result, "env_id": env_id})
    except FileNotFoundError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@fcc_bridge_bp.route("/fcc-bridge/published", methods=["GET"])
def list_published_runs():
    try:
        tenant_id, env_id = _resolve_source_context()
        env_root = resolve_env_root(env_id, tenant_id, create_if_missing=True)
        bridge = FCCSentinelBridgeService(env_root)
        rows = bridge.list_published_runs()
        return jsonify({"success": True, "published": rows, "count": len(rows), "env_id": env_id})
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@fcc_bridge_bp.route("/fcc-bridge/import", methods=["POST"])
def import_published_run():
    try:
        tenant_id, env_id = _resolve_source_context()
        body = request.get_json(force=True) or {}
        source_env_id = str(body.get("source_env_id") or env_id).strip() or env_id
        target_env_id = str(body.get("target_env_id") or env_id).strip() or env_id
        publish_id = str(body.get("publish_id") or "").strip()
        if not publish_id:
            return jsonify({"success": False, "error": "publish_id is required"}), 400
        _ensure_sentinel_environment_initialized(target_env_id, tenant_id)
        bridge = FCCSentinelBridgeService(resolve_env_root(source_env_id, tenant_id, create_if_missing=True))
        result = bridge.import_published_run(
            publish_id=publish_id,
            tenant_id=str(tenant_id),
            target_env_id=target_env_id,
            replace_existing=_bool_value(body.get("replace_existing"), default=True),
            merge_existing=_bool_value(body.get("merge_existing"), default=False),
            rerank_after_import=_bool_value(body.get("rerank_after_import"), default=True),
            prepare_investigation_context=_bool_value(body.get("prepare_investigation_context"), default=True),
            context_profile=str(body.get("context_profile") or "balanced").strip() or "balanced",
        )
        return jsonify({"success": True, "import": result})
    except FileNotFoundError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@fcc_bridge_bp.route("/fcc-bridge/published/<publish_id>/delete", methods=["POST", "DELETE"])
def delete_published_run(publish_id):
    try:
        tenant_id, env_id = _resolve_source_context()
        body = request.get_json(silent=True) or {}
        source_env_id = str(body.get("source_env_id") or env_id).strip() or env_id
        target_env_id = str(body.get("target_env_id") or env_id).strip() or env_id
        bridge = FCCSentinelBridgeService(resolve_env_root(source_env_id, tenant_id, create_if_missing=True))
        result = bridge.delete_published_run(
            publish_id=str(publish_id or "").strip(),
            tenant_id=str(tenant_id),
            target_env_id=target_env_id,
            purge_imported=_bool_value(body.get("purge_imported"), default=True),
            delete_package=_bool_value(body.get("delete_package"), default=True),
            require_no_activity=_bool_value(body.get("require_no_activity"), default=False),
        )
        return jsonify({"success": True, "data": result})
    except FileNotFoundError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@fcc_bridge_bp.route("/fcc-bridge/imported-queue/reset", methods=["POST"])
def clear_imported_queue():
    try:
        tenant_id, env_id = _resolve_source_context()
        body = request.get_json(force=True) or {}
        target_env_id = str(body.get("target_env_id") or env_id).strip() or env_id
        source_env_id = str(body.get("source_env_id") or env_id).strip() or env_id
        _ensure_sentinel_environment_initialized(target_env_id, tenant_id)
        bridge = FCCSentinelBridgeService(resolve_env_root(source_env_id, tenant_id, create_if_missing=True))
        result = bridge.clear_imported_queue(
            tenant_id=str(tenant_id),
            target_env_id=target_env_id,
        )
        return jsonify({"success": True, "data": result})
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@fcc_bridge_bp.route("/fcc-workflow/session", methods=["GET"])
def get_workflow_session():
    try:
        tenant_id, env_id = _resolve_source_context()
        env_root = resolve_env_root(env_id, tenant_id, create_if_missing=True)
        mlops_service = _get_mlops_service(env_root)
        pipeline_id_raw = request.args.get("pipeline_id")
        pipeline_id = int(pipeline_id_raw) if str(pipeline_id_raw or "").strip() else None
        session = mlops_service.get_workflow_session(
            tenant_id=str(tenant_id),
            env_id=str(env_id),
            session_id=request.args.get("session_id") or None,
            pipeline_id=pipeline_id,
            run_id=request.args.get("run_id") or None,
            deployment_id=request.args.get("deployment_id") or None,
            publish_id=request.args.get("publish_id") or None,
            current_module=request.args.get("current_module") or request.args.get("module") or None,
        )
        return jsonify({"success": True, "session": session, "env_id": env_id})
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@fcc_bridge_bp.route("/fcc-workflow/session", methods=["POST", "PUT", "OPTIONS"])
def save_workflow_session():
    try:
        tenant_id, env_id = _resolve_source_context()
        env_root = resolve_env_root(env_id, tenant_id, create_if_missing=True)
        mlops_service = _get_mlops_service(env_root)
        body = request.get_json(force=True) or {}
        session = mlops_service.save_workflow_session(
            tenant_id=str(tenant_id),
            env_id=str(env_id),
            payload=body,
        )
        return jsonify({"success": True, "session": session, "env_id": env_id})
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500


@fcc_bridge_bp.route("/fcc-workflow/session/<session_id>", methods=["DELETE"])
def delete_workflow_session(session_id):
    try:
        tenant_id, env_id = _resolve_source_context()
        env_root = resolve_env_root(env_id, tenant_id, create_if_missing=True)
        mlops_service = _get_mlops_service(env_root)
        result = mlops_service.delete_workflow_session(
            tenant_id=str(tenant_id),
            env_id=str(env_id),
            session_id=session_id,
        )
        return jsonify({"success": True, "data": result, "env_id": env_id})
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
