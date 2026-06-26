import json

from flask import Blueprint, jsonify, request

from api.services import services
from api.utils import handle_errors
from services.case_comparison_service import CaseComparisonService
from services.case_similarity_service import CaseSimilarityService
from services.case_vector_index_service import CaseVectorIndexService
from services.guide_content_service import GuideContentService


case_retrieval_bp = Blueprint("case_retrieval", __name__)


def _get_db_manager():
    env_id = request.args.get("env_id") or request.headers.get("X-Environment-ID") or services.metadata_manager.active_env
    tenant_id = getattr(request, "tenant_id", None)
    if not env_id:
        raise ValueError("No active environment selected.")
    return services.get_investigation_db(env_id, tenant_id)


@case_retrieval_bp.route("/case-retrieval/guide", methods=["GET"])
@handle_errors
def case_retrieval_guide():
    guide = GuideContentService().get_case_retrieval_guide()
    return jsonify({"success": True, **guide})


@case_retrieval_bp.route("/case-retrieval/index-status", methods=["GET"])
@handle_errors
def case_retrieval_index_status():
    service = CaseVectorIndexService(_get_db_manager())
    return jsonify({"success": True, **service.index_status()})


@case_retrieval_bp.route("/case-retrieval/rebuild-index", methods=["POST"])
@handle_errors
def case_retrieval_rebuild_index():
    payload = request.get_json(silent=True) or {}
    service = CaseVectorIndexService(_get_db_manager())
    metadata = service.build_index(force_rebuild=bool(payload.get("force_rebuild", True)))
    status = service.index_status()
    return jsonify({
        "success": True,
        "case_count": len(metadata.get("case_ids") or []),
        **status,
    })


@case_retrieval_bp.route("/case-retrieval/similar", methods=["GET", "POST"])
@handle_errors
def case_retrieval_similar():
    payload = request.get_json(silent=True) or {}
    if request.method == "GET":
        weights_raw = request.args.get("weights")
        filters_raw = request.args.get("filters")
        payload = {
            "base_case_id": request.args.get("base_case_id") or request.args.get("case_id"),
            "mode": request.args.get("mode"),
            "top_k": request.args.get("top_k"),
            "threshold": request.args.get("threshold"),
            "weights": json.loads(weights_raw) if weights_raw else None,
            "filters": json.loads(filters_raw) if filters_raw else {},
        }
    service = CaseSimilarityService(_get_db_manager())
    try:
        safe_top_k = int(payload.get("top_k") or 8)
    except (TypeError, ValueError):
        safe_top_k = 8
    try:
        safe_threshold = float(payload.get("threshold") or 0.0)
    except (TypeError, ValueError):
        safe_threshold = 0.0
    result = service.retrieve_similar_cases(
        base_case_id=str(payload.get("base_case_id") or ""),
        mode=payload.get("mode") or "hybrid",
        top_k=safe_top_k,
        threshold=safe_threshold,
        weights=payload.get("weights") or None,
        filters=payload.get("filters") or {},
    )
    return jsonify({"success": True, **result})


@case_retrieval_bp.route("/case-retrieval/compare", methods=["POST"])
@handle_errors
def case_retrieval_compare():
    payload = request.get_json(silent=True) or {}
    service = CaseComparisonService(_get_db_manager())
    result = service.compare_cases(
        case_ids=payload.get("case_ids") or [],
        base_case_id=payload.get("base_case_id"),
    )
    return jsonify({"success": True, **result})
