from __future__ import annotations

import json
from pathlib import Path

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mule_feature_store_service import MuleFeatureStoreService
from api.tools.mlops.mule_master_dataset_service import MuleMasterDatasetService
from api.tools.mlops.mule_model_build_service import MuleModelBuildService
from api.tools.mlops.mule_preprocessing_service import MulePreprocessingService
from api.tools.mlops.mule_validation_service import MuleValidationService
from api.tools.mlops.mule_workspace_service import MuleWorkspaceService
from api.tools.mlops.path_utils import resolve_env_root


mule_master_dataset_bp = Blueprint("mule_master_dataset", __name__)


def _loads(value, fallback):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


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


def _service_for_env(env_id: str, tenant_id: str) -> MuleMasterDatasetService:
    db_path = _db_path_for_env(env_id, tenant_id)
    return MuleMasterDatasetService(db_path)


def _db_path_for_env(env_id: str, tenant_id: str) -> Path:
    env_root = resolve_env_root(env_id, tenant_id, create_if_missing=False)
    return Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"


def _extract_pipeline_id(body: dict) -> int:
    nested_data = body.get("data") if isinstance(body.get("data"), dict) else {}
    raw = (
        request.args.get("pipeline_id")
        or body.get("pipeline_id")
        or body.get("pipelineId")
        or nested_data.get("pipeline_id")
        or nested_data.get("pipelineId")
    )
    try:
        return int(raw or 0)
    except Exception:
        return 0


@mule_master_dataset_bp.route("/master-dataset/config", methods=["GET", "POST"])
def mule_master_dataset_config():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = _extract_pipeline_id(body)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _service_for_env(env_id, tenant_id)
        if request.method == "GET":
            result = service.load_mule_master_config(tenant_id, env_id, pipeline_id)
        else:
            result = service.save_mule_master_config(
                tenant_id,
                env_id,
                pipeline_id,
                config_patch=body.get("config") if isinstance(body.get("config"), dict) else body,
                pipeline_name=body.get("pipeline_name"),
            )
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_master_dataset_bp.route("/master-dataset/preview", methods=["POST"])
def mule_master_dataset_preview():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = _extract_pipeline_id(body)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _service_for_env(env_id, tenant_id)
        if isinstance(body.get("config"), dict) or any(key in body for key in ("selected_sources", "feature_config", "output_table_name")):
            service.save_mule_master_config(
                tenant_id,
                env_id,
                pipeline_id,
                config_patch=body.get("config") if isinstance(body.get("config"), dict) else body,
                pipeline_name=body.get("pipeline_name"),
            )
        result = service.preview_mule_master_dataset(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_master_dataset_bp.route("/master-dataset/build", methods=["POST"])
def mule_master_dataset_build():
    try:
        tenant_id, env_id = _get_env_ids()
        body = request.get_json(silent=True) or {}
        pipeline_id = _extract_pipeline_id(body)
        if pipeline_id <= 0:
            return jsonify({"success": False, "error": "pipeline_id is required", "error_code": "VALIDATION_ERROR"}), 400
        service = _service_for_env(env_id, tenant_id)
        if isinstance(body.get("config"), dict) or any(key in body for key in ("selected_sources", "feature_config", "output_table_name")):
            service.save_mule_master_config(
                tenant_id,
                env_id,
                pipeline_id,
                config_patch=body.get("config") if isinstance(body.get("config"), dict) else body,
                pipeline_name=body.get("pipeline_name"),
            )
        result = service.build_mule_master_dataset(tenant_id, env_id, pipeline_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_master_dataset_bp.route("/master-dataset/status/<int:pipeline_id>", methods=["GET"])
def mule_master_dataset_status(pipeline_id: int):
    try:
        tenant_id, env_id = _get_env_ids()
        service = _service_for_env(env_id, tenant_id)
        result = service.get_mule_master_dataset_status(tenant_id, env_id, int(pipeline_id))
        return jsonify({"success": True, "data": result}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@mule_master_dataset_bp.route("/runs/<int:run_id>/workspace", methods=["GET"])
def mule_workspace_snapshot(run_id: int):
    try:
        tenant_id, env_id = _get_env_ids()
        db_path = _db_path_for_env(env_id, tenant_id)
        workspace = MuleWorkspaceService(db_path)
        stage_payloads = {}

        with get_connection(db_path) as conn:
            source_rows = conn.execute(
                """
                SELECT dataset_id, dataset_type, filename, row_count, columns_json
                FROM mlops_dataset_registry
                WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND pipeline_id = ?
                ORDER BY updated_at DESC, dataset_id DESC
                """,
                [tenant_id, env_id, int(run_id)],
            ).fetchall()
        source_inventory = []
        seen_types = set()
        for row in source_rows:
            dataset_type = str(row[1] or "").strip().lower()
            if not dataset_type or dataset_type in seen_types:
                continue
            seen_types.add(dataset_type)
            source_inventory.append(
                {
                    "dataset_id": int(row[0]),
                    "dataset_type": dataset_type,
                    "filename": str(row[2] or "").strip(),
                    "row_count": int(row[3] or 0),
                    "column_count": len(_loads(row[4], [])),
                }
            )
        stage_payloads["data"] = {
            "sources_loaded": len(source_inventory),
            "source_inventory": source_inventory,
            "source_types": [item["dataset_type"] for item in source_inventory],
        }

        master_service = MuleMasterDatasetService(db_path)
        stage_payloads["master"] = master_service.get_mule_master_dataset_status(tenant_id, env_id, int(run_id))

        try:
            stage_payloads["featurestore"] = MuleFeatureStoreService(db_path).status(tenant_id, env_id, int(run_id))
        except Exception as exc:
            stage_payloads["featurestore"] = {"generation_status": "failed", "error": str(exc)}

        try:
            stage_payloads["preprocess"] = MulePreprocessingService(db_path).status(tenant_id, env_id, int(run_id))
        except Exception as exc:
            stage_payloads["preprocess"] = {"build_status": "failed", "error": str(exc)}

        try:
            stage_payloads["model"] = MuleModelBuildService(db_path).status(int(run_id), tenant_id=tenant_id)
        except Exception as exc:
            stage_payloads["model"] = {"status": "failed", "error": str(exc)}

        try:
            stage_payloads["validation"] = MuleValidationService(db_path).status(tenant_id, env_id, int(run_id))
        except Exception as exc:
            stage_payloads["validation"] = {"status": "failed", "error": str(exc)}

        snapshot = workspace.get_workspace_snapshot(
            int(run_id),
            user_id=getattr(request, "user_id", None) or tenant_id or "system",
            payloads=stage_payloads,
        )
        snapshot["stage_payloads"] = stage_payloads
        return jsonify({"success": True, "data": snapshot}), 200
    except ValueError as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500
