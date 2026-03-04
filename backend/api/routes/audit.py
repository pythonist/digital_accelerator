import sqlite3

from flask import Blueprint, jsonify, request

from api.middleware.auth_middleware import require_auth
from api.service_locator import services
from api.utils import handle_errors

audit_bp = Blueprint("audit", __name__)


@audit_bp.route("/audit/get-trail", methods=["POST"])
@require_auth()
@handle_errors
def get_audit_trail():
    payload = request.json or {}
    logs = services.audit_logger.get_audit_trail(
        user=payload.get("user"),
        action=payload.get("action"),
        entity_type=payload.get("entity_type"),
        entity_id=payload.get("entity_id"),
        limit=payload.get("limit", 200),
    )
    return jsonify({"success": True, "logs": logs})


@audit_bp.route("/audit/session/event", methods=["POST"])
@require_auth()
@handle_errors
def log_session_event():
    payload = request.json or {}
    session_id = str(payload.get("session_id") or request.headers.get("X-Session-ID") or "")
    event_type = str(payload.get("event_type") or "event")
    if not session_id:
        return jsonify({"success": False, "error": "session_id required"}), 400
    details = dict(payload)
    details.pop("session_id", None)
    details.pop("event_type", None)
    services.audit_logger.log_action(
        user=request.username,
        action=event_type,
        entity_type="session",
        entity_id=session_id,
        details=details,
        ip_address=request.remote_addr,
    )
    return jsonify({"success": True})


@audit_bp.route("/audit/session/timeline/<session_id>", methods=["GET"])
@require_auth()
@handle_errors
def get_session_timeline(session_id: str):
    logs = services.audit_logger.get_audit_trail(entity_type="session", entity_id=str(session_id), limit=2000)
    logs = list(reversed(logs))
    return jsonify({"success": True, "session_id": str(session_id), "events": logs})


@audit_bp.route("/audit/session/list", methods=["GET"])
@require_auth()
@handle_errors
def list_sessions():
    limit = request.args.get("limit", default=50, type=int)
    limit = max(1, min(int(limit or 50), 200))
    conn = sqlite3.connect(services.audit_logger.db_path)
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT entity_id, user, MIN(timestamp) as start_ts, MAX(timestamp) as end_ts, COUNT(*) as event_count
            FROM audit_log
            WHERE entity_type = 'session'
            GROUP BY entity_id, user
            ORDER BY end_ts DESC
            LIMIT ?
            """,
            (limit,),
        )
        sessions = []
        for row in cur.fetchall():
            sessions.append(
                {
                    "session_id": row[0],
                    "user": row[1],
                    "started_at": row[2],
                    "ended_at": row[3],
                    "event_count": int(row[4] or 0),
                }
            )
        return jsonify({"success": True, "sessions": sessions})
    finally:
        conn.close()

