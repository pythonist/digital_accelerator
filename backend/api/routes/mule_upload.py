from __future__ import annotations

from pathlib import Path

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root


mule_upload_bp = Blueprint("mule_upload", __name__)


MULE_SOURCE_SPECS = [
    {"type": "accounts", "label": "Accounts", "required": True, "group": "Core"},
    {"type": "customers", "label": "Customers", "required": True, "group": "Core"},
    {"type": "transactions", "label": "Transactions", "required": True, "group": "Core"},
    {"type": "counterparties", "label": "Counterparties", "required": False, "group": "Network"},
    {"type": "device_logs", "label": "Device Logs", "required": False, "group": "Digital"},
    {"type": "external_signals", "label": "External Signals", "required": False, "group": "Enrichment"},
    {"type": "graph_nodes", "label": "Graph Nodes", "required": False, "group": "Graph"},
    {"type": "graph_edges", "label": "Graph Edges", "required": False, "group": "Graph"},
    {"type": "account_daily_summary", "label": "Account Daily Summary", "required": False, "group": "Enrichment"},
    {"type": "mule_labels", "label": "Mule Labels", "required": False, "group": "Outcome"},
    {"type": "mule_typology", "label": "Mule Typology", "required": False, "group": "Outcome"},
]


def _get_env_ids():
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or services.metadata_manager.active_env
    )
    if not env_id:
        raise ValueError("X-Environment-ID header required")
    tenant_id = getattr(request, "tenant_id", None) or "fccanalytics"
    return tenant_id, env_id


def _service_for_env(env_id: str, tenant_id: str) -> MLOpsWorkbenchService:
    env_root = resolve_env_root(env_id, tenant_id, create_if_missing=False)
    db_path = Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"
    return MLOpsWorkbenchService(db_path)


@mule_upload_bp.route("/upload/sources/<int:pipeline_id>", methods=["GET"])
def mule_upload_sources(pipeline_id: int):
    try:
        tenant_id, env_id = _get_env_ids()
        service = _service_for_env(env_id, tenant_id)
        pipeline = service.load_pipeline(tenant_id, env_id, int(pipeline_id))
        pipeline_type = str(pipeline.get("pipeline_type") or pipeline.get("model_family") or "fcc").strip().lower()
        if pipeline_type != "mule":
            return jsonify({
                "success": False,
                "error": "This upload browser is available only for Mule pipelines.",
                "error_code": "WRONG_PIPELINE_TYPE",
            }), 400

        datasets = service.list_datasets(tenant_id, env_id, pipeline_type="mule", pipeline_id=int(pipeline_id))
        by_type: dict[str, list[dict]] = {}
        for item in datasets:
            dtype = str(item.get("dataset_type") or "").strip().lower()
            if not dtype:
                continue
            by_type.setdefault(dtype, []).append(item)

        loaded_sources = []
        source_slots = []
        for spec in MULE_SOURCE_SPECS:
            items = sorted(by_type.get(spec["type"], []), key=lambda row: int(row.get("dataset_id") or 0), reverse=True)
            latest = items[0] if items else None
            profile = service.get_dataset_profile(int(latest["dataset_id"])) if latest else None
            if latest:
                loaded_sources.append({
                    **latest,
                    "profile": profile,
                    "versions": len(items),
                })
            source_slots.append({
                **spec,
                "loaded": bool(latest),
                "versions": len(items),
                "latest_dataset": latest,
                "profile": profile,
            })

        total_rows = sum(int(item.get("row_count") or 0) for item in loaded_sources)
        total_columns = sum(len(item.get("columns") or []) for item in loaded_sources)
        required_loaded = sum(1 for spec in source_slots if spec.get("required") and spec.get("loaded"))
        required_total = sum(1 for spec in source_slots if spec.get("required"))

        return jsonify({
            "success": True,
            "data": {
                "pipeline_id": int(pipeline_id),
                "pipeline_name": pipeline.get("name"),
                "pipeline_type": "mule",
                "source_specs": MULE_SOURCE_SPECS,
                "source_slots": source_slots,
                "loaded_sources": loaded_sources,
                "summary": {
                    "tables_loaded": len(loaded_sources),
                    "source_slots_loaded": sum(1 for spec in source_slots if spec.get("loaded")),
                    "required_loaded": required_loaded,
                    "required_total": required_total,
                    "total_rows": total_rows,
                    "total_columns": total_columns,
                },
            },
        }), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500
