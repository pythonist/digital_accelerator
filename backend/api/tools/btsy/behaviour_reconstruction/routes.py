from flask import Blueprint, jsonify, request

from .service import get_behaviour_reconstruction_service


behaviour_reconstruction_bp = Blueprint("behaviour_reconstruction", __name__)


@behaviour_reconstruction_bp.route("/behaviour/reconstruct", methods=["POST"])
def reconstruct_behaviour():
    try:
        env_id = request.headers.get("X-Environment-ID")
        if not env_id:
            return jsonify({"error": "X-Environment-ID header required"}), 400
        data = request.get_json() or {}
        behavior_run_id = data.get("behavior_run_id")
        if behavior_run_id is None:
            behavior_run_id = data.get("behaviour_run_id") or data.get("run_id")
        entity_id = data.get("entity_id")
        as_of_date = data.get("as_of_date")
        entity_level = data.get("entity_level", "account")
        created_by = data.get("created_by", "user")
        if behavior_run_id is None:
            return jsonify({"error": "behavior_run_id required"}), 400
        if not entity_id:
            return jsonify({"error": "entity_id required"}), 400
        if not as_of_date:
            return jsonify({"error": "as_of_date required"}), 400
        svc = get_behaviour_reconstruction_service(str(env_id), "default")
        out = svc.reconstruct(
            behavior_run_id=int(behavior_run_id),
            entity_id=str(entity_id),
            as_of_date=str(as_of_date),
            entity_level=str(entity_level),
            created_by=str(created_by),
        )
        return jsonify({"success": True, "data": out}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

