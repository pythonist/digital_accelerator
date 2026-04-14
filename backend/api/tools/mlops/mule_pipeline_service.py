from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

import json

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mule_evaluation_service import MuleEvaluationService
from api.tools.mlops.mule_feature_service import MuleFeatureService
from api.tools.mlops.mule_publish_service import MulePublishService
from api.tools.mlops.mule_dataset_builder import MuleDatasetBuilder
from api.tools.mlops.mule_target_service import MuleTargetService
from api.tools.mlops.mule_training_service import MuleTrainingService


class MulePipelineService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.dataset_builder = MuleDatasetBuilder(self.db_path)
        self.target_service = MuleTargetService(self.db_path)
        self.feature_service = MuleFeatureService(self.db_path)
        self.training_service = MuleTrainingService(self.db_path)
        self.evaluation_service = MuleEvaluationService(self.db_path)
        self.publish_service = MulePublishService(self.db_path)

    def _store_pipeline_family_state(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        state_patch: Dict[str, Any],
    ) -> None:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT pipeline_config_json, runtime_state_json
                FROM mlops_pipelines
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [int(pipeline_id), tenant_id, env_id],
            ).fetchone()
            if not row:
                return
            config = json.loads(row[0] or "{}") if row[0] else {}
            runtime_state = json.loads(row[1] or "{}") if row[1] else {}
            family_state = config.get("mule_state") if isinstance(config.get("mule_state"), dict) else {}
            family_state.update(state_patch or {})
            config["mule_state"] = family_state
            runtime_state["mule_state"] = family_state
            conn.execute(
                """
                UPDATE mlops_pipelines
                SET pipeline_config_json = ?, runtime_state_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [
                    json.dumps(config, default=str),
                    json.dumps(runtime_state, default=str),
                    int(pipeline_id),
                    tenant_id,
                    env_id,
                ],
            )

    def build_analytical_dataset(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        source_dataset_ids: Optional[list[int]] = None,
        dataset_name: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = self.dataset_builder.build_analytical_dataset(
            tenant_id,
            env_id,
            pipeline_id,
            source_dataset_ids=source_dataset_ids,
            dataset_name=dataset_name,
            config=config,
        )
        self._store_pipeline_family_state(
            tenant_id,
            env_id,
            pipeline_id,
            {
                "analytical_dataset": {
                    "dataset_id": result.get("dataset_id"),
                    "dataset_name": result.get("dataset_name"),
                    "row_count": result.get("row_count"),
                    "column_count": result.get("column_count"),
                    "source_summary": result.get("source_summary") or {},
                    "storage_path": result.get("storage_path"),
                },
            },
        )
        return result

    def define_outcome(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        dataset_id: Optional[int] = None,
        target_definition_type: Optional[str] = None,
        lookback_days: Optional[int] = None,
        lookforward_days: Optional[int] = None,
        prediction_grain: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = self.target_service.define_outcome(
            tenant_id,
            env_id,
            pipeline_id,
            dataset_id=dataset_id,
            target_definition_type=target_definition_type,
            lookback_days=lookback_days,
            lookforward_days=lookforward_days,
            prediction_grain=prediction_grain,
            config=config,
        )
        self._store_pipeline_family_state(
            tenant_id,
            env_id,
            pipeline_id,
            {
                "target_definition": {
                    "dataset_id": result.get("dataset_id"),
                    "target_definition_type": result.get("target_definition_type"),
                    "lookback_days": result.get("lookback_days"),
                    "lookforward_days": result.get("lookforward_days"),
                    "prediction_grain": result.get("prediction_grain"),
                    "event_rate": result.get("event_rate"),
                    "class_imbalance": result.get("class_imbalance"),
                    "summary": result.get("summary") or {},
                },
            },
        )
        return result

    def generate_risk_indicators(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        dataset_id: Optional[int] = None,
        feature_families: Optional[list[str]] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = self.feature_service.generate_feature_families(
            tenant_id,
            env_id,
            pipeline_id,
            dataset_id=dataset_id,
            feature_families=feature_families,
            config=config,
        )
        self._store_pipeline_family_state(
            tenant_id,
            env_id,
            pipeline_id,
            {
                "feature_families": result.get("summary", {}).get("feature_families") or [],
                "feature_summary": result.get("summary") or {},
                "feature_run_id": result.get("feature_run_id"),
                "feature_dataset_id": result.get("dataset_id"),
            },
        )
        return result

    def train_detection_model(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        dataset_id: Optional[int] = None,
        model_kind: Optional[str] = None,
        benchmark_enabled: bool = True,
        anomaly_enabled: bool = True,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = self.training_service.train_model(
            tenant_id,
            env_id,
            pipeline_id,
            dataset_id=dataset_id,
            model_kind=model_kind,
            benchmark_enabled=benchmark_enabled,
            anomaly_enabled=anomaly_enabled,
            config=config,
        )
        self._store_pipeline_family_state(
            tenant_id,
            env_id,
            pipeline_id,
            {
                "model_config": result.get("model_config") or {},
                "performance_summary": result.get("performance_summary") or {},
                "model_run_id": result.get("model_run_id"),
                "model_artifact_ref": result.get("artifact_ref"),
            },
        )
        return result

    def review_typology_signals(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        model_run_id: Optional[int] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = self.evaluation_service.review_typology_signals(
            tenant_id,
            env_id,
            pipeline_id,
            model_run_id=model_run_id,
            config=config,
        )
        self._store_pipeline_family_state(
            tenant_id,
            env_id,
            pipeline_id,
            {
                "typology": {
                    "overall_mule_score": result.get("overall_mule_score"),
                    "top_typology": result.get("top_typology"),
                    "scores": result.get("typology_scores") or {},
                    "explanation_summary": result.get("explanation_summary") or {},
                },
                "typology_output_id": result.get("typology_output_id"),
            },
        )
        return result

    def publish_high_risk_accounts(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        model_run_id: Optional[int] = None,
        threshold: float = 0.72,
        capacity: int = 250,
        source_record_type: str = "high_risk_account",
        destination_queue: str = "Sentinel Mule Intake",
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = self.publish_service.publish_high_risk_accounts(
            tenant_id,
            env_id,
            pipeline_id,
            model_run_id=model_run_id,
            threshold=threshold,
            capacity=capacity,
            source_record_type=source_record_type,
            destination_queue=destination_queue,
            config=config,
        )
        self._store_pipeline_family_state(
            tenant_id,
            env_id,
            pipeline_id,
            {
                "mule_publish": {
                    "publish_id": result.get("publish_id"),
                    "publish_status": result.get("summary", {}).get("publish_status"),
                    "selected_count": result.get("summary", {}).get("selected_count"),
                    "destination_queue": result.get("summary", {}).get("destination_queue"),
                    "source_record_type": result.get("summary", {}).get("source_record_type"),
                    "threshold": threshold,
                    "capacity": capacity,
                },
                "publish_id": result.get("publish_id"),
            },
        )
        return result
        self._store_pipeline_family_state(
            tenant_id,
            env_id,
            pipeline_id,
            {
                "target_definition": result.get("summary") or {},
                "target_definition_id": result.get("target_definition_id"),
                "target_dataset_id": result.get("dataset_id"),
            },
        )
        return result
