from flask import Blueprint, request, jsonify
import logging

from api.tools.btsy.service import get_btsy_service
from api.tools.btsy.snapshot_manager import SnapshotManager

logger = logging.getLogger(__name__)

extension_bp = Blueprint("btsy_extensions", __name__)


@extension_bp.route("/extensions/<snapshot_id>", methods=["GET"])
def list_extensions(snapshot_id):
    try:
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400
        entity_scope = request.args.get("entity_scope")
        tenant_id = "default"
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
        rows = mgr.list_extension_attributes(snapshot_id=str(snapshot_id), entity_scope=entity_scope)
        return jsonify({"success": True, "data": rows}), 200
    except Exception as e:
        logger.error(f"[BTSY][EXT] List failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@extension_bp.route("/extensions/<snapshot_id>/<entity_scope>/<path:source_column_name>", methods=["PATCH"])
def update_extension(snapshot_id, entity_scope, source_column_name):
    try:
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400
        data = request.get_json() or {}
        status = data.get("status")
        display_name = data.get("display_name")
        data_type = data.get("data_type")
        if status is None and display_name is None and data_type is None:
            return jsonify({"error": "No updates provided"}), 400
        tenant_id = "default"
        service = get_btsy_service()
        folders = service.init_env_structure(tenant_id, env_id)
        mgr = SnapshotManager(folders["duckdb"] / "snapshots.duckdb")
        payload = {
            "source_column_name": source_column_name,
            "display_name": display_name,
            "data_type": data_type,
            "status": status,
        }
        result = mgr.upsert_extension_attributes(str(snapshot_id), str(entity_scope), [payload])
        return jsonify({"success": True, "data": result}), 200
    except Exception as e:
        logger.error(f"[BTSY][EXT] Update failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

