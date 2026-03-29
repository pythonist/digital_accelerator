from flask import Blueprint, jsonify, request, send_file

from api.utils import handle_errors
from api.services import services
from services.batch_report_service import BatchReportService
from services.report_builder_service import ReportBuilderService
from services.report_storage_service import ReportStorageService

reports_bp = Blueprint("reports", __name__)


def _get_db_manager():
    env_id = request.args.get("env_id") or request.headers.get("X-Environment-ID") or services.metadata_manager.active_env
    tenant_id = getattr(request, "tenant_id", None)
    if not env_id:
        raise ValueError("No active environment selected.")
    return services.get_investigation_db(env_id, tenant_id)


def _get_username():
    return getattr(request, "username", None) or "system"


@reports_bp.route("/reports/generate", methods=["POST"])
@handle_errors
def generate_case_report():
    payload = request.get_json(silent=True) or {}
    case_id = str(payload.get("case_id") or "").strip()
    if not case_id:
        return jsonify({"success": False, "error": "case_id is required"}), 400
    service = ReportBuilderService(_get_db_manager(), username=_get_username())
    result = service.generate_single(case_id, model=payload.get("model"))
    report = result["report"]
    return jsonify({
        "success": True,
        "report": {**report, "download_url": f"/api/v2/reports/download/{report['report_id']}"},
        "preview": result["preview"],
    })


@reports_bp.route("/reports/generate-batch", methods=["POST"])
@handle_errors
def generate_case_reports_batch():
    payload = request.get_json(silent=True) or {}
    service = BatchReportService(_get_db_manager(), username=_get_username())
    result = service.generate(
        payload.get("case_ids") or [],
        output_mode=payload.get("output_mode") or "separate",
        model=payload.get("model"),
    )
    if result.get("mode") == "combined":
        report = result["report"]
        return jsonify({
            "success": True,
            "mode": "combined",
            "report": {**report, "download_url": f"/api/v2/reports/download/{report['report_id']}"},
            "preview": result.get("preview"),
        })
    reports = [{**item, "download_url": f"/api/v2/reports/download/{item['report_id']}"} for item in result.get("reports", [])]
    return jsonify({
        "success": True,
        "mode": "separate",
        "reports": reports,
    })


@reports_bp.route("/reports/history", methods=["GET"])
@handle_errors
def list_report_history():
    db_manager = _get_db_manager()
    storage = ReportStorageService(db_manager)
    conn = db_manager.connect()
    try:
        rows = storage.list_history(conn.cursor(), case_id=request.args.get("case_id") or None, limit=request.args.get("limit") or 100)
        return jsonify({"success": True, "rows": rows})
    finally:
        conn.close()


@reports_bp.route("/reports/<case_id>", methods=["GET"])
@handle_errors
def get_case_reports(case_id):
    db_manager = _get_db_manager()
    storage = ReportStorageService(db_manager)
    conn = db_manager.connect()
    try:
        rows = storage.list_history(conn.cursor(), case_id=case_id, limit=request.args.get("limit") or 20)
        latest = rows[0] if rows else None
        return jsonify({"success": True, "case_id": case_id, "latest": latest, "rows": rows})
    finally:
        conn.close()


@reports_bp.route("/reports/download/<report_id>", methods=["GET"])
@handle_errors
def download_report(report_id):
    db_manager = _get_db_manager()
    storage = ReportStorageService(db_manager)
    conn = db_manager.connect()
    try:
        report = storage.get_report(conn.cursor(), report_id)
        if not report:
            return jsonify({"success": False, "error": "Report not found"}), 404
        return send_file(
            report["file_path"],
            mimetype="application/pdf",
            as_attachment=True,
            download_name=report["file_name"],
        )
    finally:
        conn.close()
