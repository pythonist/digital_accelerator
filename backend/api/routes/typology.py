from flask import Blueprint, jsonify, request

from api.utils import handle_errors
from api.services import services
from services.typology_history_service import TypologyHistoryService
from services.typology_intelligence_service import TypologyIntelligenceService


typology_bp = Blueprint("typology", __name__)


def _guide_sections():
    return [
        {
            "title": "What typology means",
            "body": "A typology is a suspicious behavioral pattern such as mule activity, structuring, layering, funnel behavior, pass-through activity, or high-risk corridor movement.",
        },
        {
            "title": "What this module does",
            "body": "Typology Intelligence assesses whether visible case behavior aligns with known AML and fraud patterns using structured case signals.",
        },
        {
            "title": "How the assessment works",
            "body": "The module uses transaction behavior, alert profile, customer and account risk, network relationships, and other supporting signals to score multiple typologies and rank the strongest pattern.",
        },
        {
            "title": "Why the result is not a final decision",
            "body": "Typology alignment is an investigation indicator that helps focus review. It is not proof by itself and should be reconciled with broader case evidence.",
        },
        {
            "title": "Why confidence may vary",
            "body": "Confidence can be reduced by synthetic data, partial cross-bank visibility, sparse network evidence, or limited historical comparison support.",
        },
        {
            "title": "How analysts should use the output",
            "body": "Use the assessment to understand suspicious patterns, ask better review questions, guide escalation, and strengthen the final case narrative.",
        },
    ]


@typology_bp.route("/typology/guide", methods=["GET"])
@handle_errors
def get_typology_guide():
    return jsonify({"success": True, "module": "Typology Intelligence", "sections": _guide_sections()})


@typology_bp.route("/typology/analyze", methods=["POST"])
@handle_errors
def analyze_typology():
    data = request.get_json(silent=True) or {}
    case_id = str(data.get("case_id") or "").strip()
    if not case_id:
        return jsonify({"error": "Case ID is required"}), 400
    service = TypologyIntelligenceService(services.investigation_db)
    payload = service.analyze(case_id, options=data.get("options") or {})
    return jsonify({"success": True, **payload})


@typology_bp.route("/typology/analyze-case", methods=["POST"])
@handle_errors
def analyze_typology_alias():
    return analyze_typology()


@typology_bp.route("/typology/<case_id>", methods=["GET"])
@handle_errors
def get_saved_typology(case_id):
    conn = services.investigation_db.connect()
    try:
        history = TypologyHistoryService()
        saved = history.load_case_result(conn.cursor(), str(case_id))
        return jsonify({"success": True, "case_id": case_id, "saved": saved})
    finally:
        services.investigation_db.close_connection(conn)


@typology_bp.route("/typology/history/<case_id>", methods=["GET"])
@handle_errors
def get_typology_history(case_id):
    conn = services.investigation_db.connect()
    try:
        history = TypologyHistoryService()
        rows = history.list_case_history(conn.cursor(), str(case_id), limit=request.args.get("limit", 12))
        return jsonify({"success": True, "case_id": case_id, "history": rows})
    finally:
        services.investigation_db.close_connection(conn)


@typology_bp.route("/typology/save", methods=["POST"])
@handle_errors
def save_typology():
    data = request.get_json(silent=True) or {}
    case_id = str(data.get("case_id") or "").strip()
    payload = data.get("payload") if isinstance(data.get("payload"), dict) else {}
    if not case_id or not payload:
        return jsonify({"error": "case_id and payload are required"}), 400

    conn = services.investigation_db.connect()
    try:
        history = TypologyHistoryService()
        saved = history.save_case_result(
            conn.cursor(),
            case_id,
            payload,
            include_in_report=bool(data.get("include_in_report", True)),
            generated_by=str(data.get("generated_by") or "analyst"),
        )
        conn.commit()
        return jsonify({"success": True, "saved": saved})
    finally:
        services.investigation_db.close_connection(conn)


@typology_bp.route("/typology/list", methods=["GET"])
@handle_errors
def list_typologies():
    meta = [
        {"id": "mule_account_behavior", "label": "Mule Account Behavior"},
        {"id": "structuring", "label": "Structuring"},
        {"id": "layering", "label": "Layering"},
        {"id": "funnel_account", "label": "Funnel Account"},
        {"id": "pass_through_behavior", "label": "Pass-Through Behavior"},
        {"id": "circular_movement", "label": "Circular Movement"},
        {"id": "high_risk_corridor", "label": "High-Risk Corridor"},
        {"id": "concentrated_beneficiary_pattern", "label": "Concentrated Beneficiary Pattern"},
        {"id": "burst_spike_transaction_pattern", "label": "Burst / Spike Transaction Pattern"},
    ]
    return jsonify({"success": True, "typologies": meta})


@typology_bp.route("/typology/report/<case_id>", methods=["GET"])
@handle_errors
def typology_report(case_id):
    conn = services.investigation_db.connect()
    try:
        history = TypologyHistoryService()
        saved = history.load_case_result(conn.cursor(), str(case_id))
        if saved:
            payload = saved.get("payload") or {}
            return jsonify({"success": True, "case_id": case_id, "report": payload.get("report_payload") or {}})
    finally:
        services.investigation_db.close_connection(conn)

    service = TypologyIntelligenceService(services.investigation_db)
    payload = service.analyze(case_id, options={})
    return jsonify({"success": True, "case_id": case_id, "report": payload.get("report_payload") or {}})
