import io
import re

from flask import Blueprint, request, jsonify, Response, send_file
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

from api.agent_db import (
    get_activities,
    get_document,
    get_documents,
    get_findings,
    get_llm_interactions,
    get_memory,
    get_plan,
    get_session,
    get_session_by_case,
    get_tool_execution_log,
)
from api.agentic_workflow import WORKFLOW_FILE, WORKFLOW_LOADED_AT, WORKFLOW_VERSION, start_investigation_async
import json
import time

agentic_bp = Blueprint('agentic', __name__)

@agentic_bp.route('/api/v2/agentic/start', methods=['POST'])
def start_investigation():
    data = request.get_json(silent=True) or {}
    case_id = data.get('case_id')
    if not case_id:
        return jsonify({"error": "case_id is required"}), 400

    context = {
        "env_id": data.get("env_id") or request.args.get("env_id") or request.headers.get("X-Environment-ID"),
        "tenant_id": getattr(request, "tenant_id", None),
        "username": getattr(request, "username", None),
    }
    session_id = start_investigation_async(case_id, context=context)
    return jsonify({"session_id": session_id, "status": "running"}), 200

@agentic_bp.route('/api/v2/agentic/status/<case_id>', methods=['GET'])
def get_status(case_id):
    session = get_session_by_case(case_id)
    if not session:
        return jsonify({"status": "not_started"}), 200
        
    session_id = session["id"]
    plan = get_plan(session_id)
    memory = get_memory(session_id)
    documents = get_documents(session_id)
    findings = get_findings(session_id)
    tool_logs = get_tool_execution_log(session_id)
    llm_logs = get_llm_interactions(session_id)
    expected_documents = {
        "Executive Summary",
        "Full Investigation Report",
        "SAR Draft",
        "Internal Email",
        "Case Notes",
        "Evidence Report",
        "Risk Assessment Report",
        "Investigation Timeline",
        "Recommendations",
        "Resolution Notes",
    }
    produced_doc_types = {str(row.get("doc_type") or "") for row in documents}
    findings_count = len((findings or {}).get("findings") or []) if isinstance(findings, dict) else 0
    evidence_count = len((findings or {}).get("evidence_items") or []) if isinstance(findings, dict) else 0
    real_agentic = bool(llm_logs) and bool(findings) and findings_count > 0 and expected_documents.issubset(produced_doc_types)
    legacy_or_incomplete = session.get("status") == "completed" and not real_agentic
    trace = {
        "real_agentic": real_agentic,
        "legacy_or_incomplete": legacy_or_incomplete,
        "workflow_version": WORKFLOW_VERSION,
        "workflow_file": WORKFLOW_FILE,
        "workflow_loaded_at": WORKFLOW_LOADED_AT,
        "llm_call_count": len(llm_logs),
        "tool_execution_count": len(tool_logs),
        "findings_count": findings_count,
        "evidence_count": evidence_count,
        "document_count": len(documents),
        "missing_document_types": sorted(expected_documents.difference(produced_doc_types)),
    }
    
    return jsonify({
        "status": session.get("status"),
        "session": session,
        "plan": plan,
        "memory": memory,
        "documents": [] if legacy_or_incomplete else documents,
        "legacy_documents": documents if legacy_or_incomplete else [],
        "findings": None if legacy_or_incomplete else findings,
        "tool_logs": tool_logs,
        "llm_logs": [
            {
                "id": row.get("id"),
                "stage": row.get("stage"),
                "provider": row.get("provider"),
                "model": row.get("model"),
                "timestamp": row.get("timestamp"),
                "metadata": json.loads(row.get("metadata_json") or "{}"),
                "prompt_preview": (row.get("prompt_text") or "")[:8000],
                "response_preview": (row.get("response_text") or "")[:8000],
            }
            for row in llm_logs
        ],
        "trace": trace,
    }), 200


@agentic_bp.route('/api/v2/agentic/document/<document_id>/pdf', methods=['GET'])
def download_document_pdf(document_id):
    doc = get_document(document_id)
    if not doc:
        return jsonify({"error": "Document not found"}), 404

    buffer = io.BytesIO()
    pdf = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=42, rightMargin=42, topMargin=48, bottomMargin=42)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(str(doc.get("doc_type") or "Agentic Investigation Document"), styles["Title"]),
        Spacer(1, 12),
    ]
    for block in str(doc.get("content") or "").split("\n\n"):
        text = block.strip()
        if not text:
            continue
        if text.startswith("#"):
            text = re.sub(r"^#+\s*", "", text)
            story.append(Paragraph(text, styles["Heading2"]))
        else:
            safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
            story.append(Paragraph(safe, styles["BodyText"]))
        story.append(Spacer(1, 8))
    pdf.build(story)
    buffer.seek(0)
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(doc.get("doc_type") or "document")).strip("_").lower()
    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"{safe_name or 'agentic_document'}.pdf",
    )

@agentic_bp.route('/api/v2/agentic/stream/<case_id>', methods=['GET'])
def stream_activities(case_id):
    session = get_session_by_case(case_id)
    if not session:
        return jsonify({"error": "No session found"}), 404
        
    session_id = session["id"]
    
    def generate():
        last_id = None
        while True:
            activities = get_activities(session_id)
            if activities:
                new_activities = []
                if last_id is None:
                    new_activities = activities
                else:
                    try:
                        last_idx = next(i for i, a in enumerate(activities) if a["id"] == last_id)
                        new_activities = activities[last_idx+1:]
                    except StopIteration:
                        new_activities = activities
                        
                for act in new_activities:
                    yield f"data: {json.dumps(act)}\n\n"
                    last_id = act["id"]
            
            # Check if session is completed
            current_session = get_session(session_id)
            if current_session and current_session["status"] in {"completed", "failed"} and activities and last_id == activities[-1]["id"]:
                yield f"data: {json.dumps({'status': current_session['status']})}\n\n"
                break
                
            time.sleep(1)
            
    return Response(generate(), mimetype='text/event-stream')
