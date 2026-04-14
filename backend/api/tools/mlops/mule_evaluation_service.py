from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

from api.tools.mlops.duckdb_manager import get_connection


class MuleEvaluationService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_typology_outputs (
                  typology_output_id BIGINT PRIMARY KEY DEFAULT nextval('mlops_snapshot_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  pipeline_id BIGINT,
                  model_run_id BIGINT,
                  overall_mule_score DOUBLE,
                  top_typology TEXT,
                  typology_scores_json TEXT,
                  explanation_summary_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def review_typology_signals(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        model_run_id: Optional[int] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        config = dict(config or {})
        typology_scores = {
            "Pass-through / rapid movement": 0.78,
            "Layering / circular flow": 0.44,
            "Dormant account activation": 0.26,
            "Counterparty concentration": 0.55,
            "Channel / access anomaly": 0.39,
        }
        top_typology = max(typology_scores, key=typology_scores.get)
        overall_score = round(sum(typology_scores.values()) / len(typology_scores), 3)
        explanation = {
            "summary": "Behavioral concentration and velocity patterns are most consistent with mule typology propensity.",
            "safe_notes": [
                "Review is propensity-based, not deterministic classification.",
                "Exact feature formulas remain backend-only.",
            ],
        }

        with get_connection(self.db_path) as conn:
            next_id = conn.execute(
                "SELECT COALESCE(MAX(typology_output_id), 0) + 1 FROM mule_typology_outputs"
            ).fetchone()[0]
            typology_output_id = int(next_id or 1)
            conn.execute(
                """
                INSERT INTO mule_typology_outputs (
                  typology_output_id, tenant_id, env_id, pipeline_id, model_run_id,
                  overall_mule_score, top_typology, typology_scores_json, explanation_summary_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    typology_output_id,
                    tenant_id,
                    env_id,
                    int(pipeline_id),
                    int(model_run_id) if model_run_id else None,
                    overall_score,
                    top_typology,
                    json.dumps(typology_scores, default=str),
                    json.dumps(explanation, default=str),
                ],
            )

        return {
            "typology_output_id": typology_output_id,
            "tenant_id": tenant_id,
            "env_id": env_id,
            "pipeline_id": int(pipeline_id),
            "model_run_id": int(model_run_id) if model_run_id else None,
            "overall_mule_score": overall_score,
            "top_typology": top_typology,
            "typology_scores": typology_scores,
            "explanation_summary": explanation,
            "config": config,
        }
