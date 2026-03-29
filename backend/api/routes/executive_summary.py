from flask import Blueprint, jsonify, request

from api.service_locator import services
from services.pipeline_summary_service import PipelineSummaryService


executive_summary_bp = Blueprint("executive_summary", __name__)


def _active_context():
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or getattr(getattr(services, "metadata_manager", None), "active_env", None)
    )
    tenant_id = getattr(request, "tenant_id", None) or "default"
    return str(tenant_id), str(env_id or "")


@executive_summary_bp.get("/executive-summary")
def get_executive_summary():
    tenant_id, env_id = _active_context()
    service = PipelineSummaryService(services, tenant_id=tenant_id, env_id=env_id)
    payload = service.get_summary(
        run_id=request.args.get("run_id"),
        pipeline_id=request.args.get("pipeline_id"),
        publish_id=request.args.get("publish_id"),
    )
    return jsonify(
        {
            "success": True,
            "summary": payload,
        }
    )


@executive_summary_bp.get("/executive-summary/graph-flow")
def get_executive_summary_graph_flow():
    tenant_id, env_id = _active_context()
    service = PipelineSummaryService(services, tenant_id=tenant_id, env_id=env_id)
    payload = service.get_graph_flow_payload(
        run_id=request.args.get("run_id"),
        pipeline_id=request.args.get("pipeline_id"),
        publish_id=request.args.get("publish_id"),
    )
    return jsonify(
        {
            "success": True,
            "graph_flow_payload": payload,
        }
    )
