from flask import Blueprint, jsonify, request

from api.utils import handle_errors
from api.services import services
from services.case_queue_service import CaseQueueService
from services.case_packet_builder import CasePacketBuilder
from services.mail_config_service import MailConfigService
from services.escalation_service import EscalationService


case_queue_bp = Blueprint("case_queue", __name__)


def _get_db_manager():
    env_id = request.args.get("env_id") or request.headers.get("X-Environment-ID") or services.metadata_manager.active_env
    tenant_id = getattr(request, "tenant_id", None)
    if not env_id:
        raise ValueError("No active environment selected.")
    return services.get_investigation_db(env_id, tenant_id)


def _get_username():
    return getattr(request, "username", None) or "system"


@case_queue_bp.route("/case-queue", methods=["GET"])
@handle_errors
def list_case_queue():
    filters = {
        "search": request.args.get("search"),
        "status": request.args.get("status"),
        "stage": request.args.get("stage"),
        "risk": request.args.get("risk"),
        "escalated_to": request.args.get("escalated_to"),
        "branch": request.args.get("branch"),
        "region": request.args.get("region"),
        "date_from": request.args.get("date_from"),
        "date_to": request.args.get("date_to"),
        "saved_view": request.args.get("saved_view"),
        "page": request.args.get("page", default=1, type=int),
        "page_size": request.args.get("page_size", default=25, type=int),
        "sort_by": request.args.get("sort_by"),
        "sort_dir": request.args.get("sort_dir"),
    }
    service = CaseQueueService(_get_db_manager(), username=_get_username())
    result = service.list_queue(filters)
    return jsonify({"success": True, **result})


@case_queue_bp.route("/case-queue/<case_id>", methods=["GET"])
@handle_errors
def get_case_queue_detail(case_id):
    service = CaseQueueService(_get_db_manager(), username=_get_username())
    queue_row = service.get_case_queue_row(case_id)
    if not queue_row:
        return jsonify({"success": False, "error": f"Case {case_id} not found."}), 404
    packet_builder = CasePacketBuilder(_get_db_manager())
    escalation_service = EscalationService(_get_db_manager(), username=_get_username())
    detail = packet_builder.build_case_summary(case_id, queue_row)
    history = service.get_status_history(case_id)
    escalation_history = escalation_service.get_history({"case_id": case_id}).get("rows", [])
    return jsonify({
        "success": True,
        "case": queue_row,
        "detail": {
            **detail,
            "analyst_notes": history[:5],
            "escalation_history": escalation_history,
            "status_history": history,
        },
    })


@case_queue_bp.route("/case-queue/<case_id>/status", methods=["PATCH", "POST"])
@handle_errors
def patch_case_status(case_id):
    payload = request.get_json(silent=True) or {}
    service = CaseQueueService(_get_db_manager(), username=_get_username())
    updated = service.update_status(
        case_id=case_id,
        new_status=str(payload.get("new_status") or payload.get("status") or ""),
        remarks=str(payload.get("remarks") or ""),
        changed_by=_get_username(),
    )
    return jsonify({"success": True, "case": updated})


@case_queue_bp.route("/case-queue/batch/status", methods=["POST"])
@handle_errors
def batch_update_case_status():
    payload = request.get_json(silent=True) or {}
    service = CaseQueueService(_get_db_manager(), username=_get_username())
    result = service.batch_update_status(
        case_ids=payload.get("case_ids") or [],
        new_status=str(payload.get("new_status") or ""),
        remarks=str(payload.get("remarks") or ""),
        changed_by=_get_username(),
    )
    return jsonify({"success": True, **result})


@case_queue_bp.route("/case-queue/<case_id>/assign", methods=["PATCH", "POST"])
@handle_errors
def assign_case_owner(case_id):
    payload = request.get_json(silent=True) or {}
    service = CaseQueueService(_get_db_manager(), username=_get_username())
    updated = service.assign_owner(
        case_id=case_id,
        owner=str(payload.get("owner") or ""),
        changed_by=_get_username(),
        remarks=str(payload.get("remarks") or ""),
    )
    return jsonify({"success": True, "case": updated})


@case_queue_bp.route("/escalations/preview", methods=["POST"])
@handle_errors
def preview_escalation():
    payload = request.get_json(silent=True) or {}
    service = EscalationService(_get_db_manager(), username=_get_username())
    if payload.get("case_ids"):
        return jsonify({"success": True, **service.preview_batch(payload)})
    result = service.preview_single(payload)
    return jsonify({"success": True, **result})


@case_queue_bp.route("/escalations/single", methods=["POST"])
@handle_errors
def escalate_single():
    payload = request.get_json(silent=True) or {}
    service = EscalationService(_get_db_manager(), username=_get_username())
    if payload.get("preview_only"):
        return jsonify({"success": True, **service.preview_single(payload)})
    return jsonify({"success": True, **service.escalate_single(payload)})


@case_queue_bp.route("/escalations/batch", methods=["POST"])
@handle_errors
def escalate_batch():
    payload = request.get_json(silent=True) or {}
    service = EscalationService(_get_db_manager(), username=_get_username())
    if payload.get("preview_only"):
        return jsonify({"success": True, **service.preview_batch(payload)})
    return jsonify({"success": True, **service.escalate_batch(payload)})


@case_queue_bp.route("/escalations/history", methods=["GET"])
@handle_errors
def escalation_history():
    filters = {
        "case_id": request.args.get("case_id"),
        "recipient_role": request.args.get("recipient_role"),
        "mail_status": request.args.get("mail_status"),
    }
    service = EscalationService(_get_db_manager(), username=_get_username())
    return jsonify({"success": True, **service.get_history(filters)})


@case_queue_bp.route("/mail-config/recipients", methods=["GET", "POST"])
@handle_errors
def mail_recipients():
    service = MailConfigService(_get_db_manager())
    if request.method == "POST":
        return jsonify({"success": True, **service.create_recipient(request.get_json(silent=True) or {})})
    return jsonify({"success": True, **service.list_recipients({"search": request.args.get("search"), "role": request.args.get("role")})})


@case_queue_bp.route("/mail-config/recipients/<int:recipient_id>", methods=["PUT"])
@handle_errors
def update_mail_recipient(recipient_id):
    service = MailConfigService(_get_db_manager())
    return jsonify({"success": True, **service.update_recipient(recipient_id, request.get_json(silent=True) or {})})


@case_queue_bp.route("/mail-config/rules", methods=["GET", "POST"])
@handle_errors
def mail_rules():
    service = MailConfigService(_get_db_manager())
    if request.method == "POST":
        return jsonify({"success": True, **service.create_rule(request.get_json(silent=True) or {})})
    return jsonify({"success": True, **service.list_rules()})


@case_queue_bp.route("/mail-config/templates", methods=["GET", "POST"])
@handle_errors
def mail_templates():
    service = MailConfigService(_get_db_manager())
    if request.method == "POST":
        return jsonify({"success": True, **service.create_template(request.get_json(silent=True) or {})})
    return jsonify({"success": True, **service.list_templates()})


@case_queue_bp.route("/mail-config/test-mail", methods=["POST"])
@handle_errors
def test_mail():
    service = MailConfigService(_get_db_manager())
    return jsonify({"success": True, **service.test_mail(request.get_json(silent=True) or {})})
