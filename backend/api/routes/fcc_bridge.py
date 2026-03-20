from __future__ import annotations

from flask import Blueprint, jsonify, request

from api.service_locator import services
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
        bridge = FCCSentinelBridgeService(resolve_env_root(source_env_id, tenant_id, create_if_missing=True))
        result = bridge.import_published_run(
            publish_id=publish_id,
            tenant_id=str(tenant_id),
            target_env_id=target_env_id,
            replace_existing=_bool_value(body.get("replace_existing"), default=False),
            rerank_after_import=_bool_value(body.get("rerank_after_import"), default=True),
        )
        return jsonify({"success": True, "import": result})
    except FileNotFoundError as exc:
        return jsonify({"success": False, "error": str(exc)}), 404
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc)}), 500
