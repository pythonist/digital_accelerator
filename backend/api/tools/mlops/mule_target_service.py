from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mule_config import MuleOutcomeConfig


class MuleTargetService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_target_definitions (
                  target_definition_id BIGINT PRIMARY KEY DEFAULT nextval('mlops_snapshot_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  pipeline_id BIGINT,
                  dataset_id BIGINT,
                  target_definition_type TEXT,
                  lookback_days INTEGER,
                  lookforward_days INTEGER,
                  prediction_grain TEXT,
                  config_json TEXT,
                  summary_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

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
        cfg = MuleOutcomeConfig(
            target_definition_type=str(target_definition_type or "confirmed_mule"),
            lookback_days=int(lookback_days or 90),
            lookforward_days=int(lookforward_days or 60),
            prediction_grain=str(prediction_grain or "account"),
        )
        config_payload = dict(config or {})
        config_payload.setdefault("target_definition_type", cfg.target_definition_type)
        config_payload.setdefault("lookback_days", cfg.lookback_days)
        config_payload.setdefault("lookforward_days", cfg.lookforward_days)
        config_payload.setdefault("prediction_grain", cfg.prediction_grain)

        summary = {
            "target_definition_type": cfg.target_definition_type,
            "lookback_days": cfg.lookback_days,
            "lookforward_days": cfg.lookforward_days,
            "prediction_grain": cfg.prediction_grain,
        }

        with get_connection(self.db_path) as conn:
            next_id = conn.execute(
                "SELECT COALESCE(MAX(target_definition_id), 0) + 1 FROM mule_target_definitions"
            ).fetchone()[0]
            target_definition_id = int(next_id or 1)
            conn.execute(
                """
                INSERT INTO mule_target_definitions (
                  target_definition_id, tenant_id, env_id, pipeline_id, dataset_id,
                  target_definition_type, lookback_days, lookforward_days, prediction_grain,
                  config_json, summary_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    target_definition_id,
                    tenant_id,
                    env_id,
                    int(pipeline_id),
                    int(dataset_id) if dataset_id else None,
                    cfg.target_definition_type,
                    cfg.lookback_days,
                    cfg.lookforward_days,
                    cfg.prediction_grain,
                    json.dumps(config_payload, default=str),
                    json.dumps(summary, default=str),
                ],
            )

        return {
            "target_definition_id": target_definition_id,
            "tenant_id": tenant_id,
            "env_id": env_id,
            "pipeline_id": int(pipeline_id),
            "dataset_id": int(dataset_id) if dataset_id else None,
            "summary": summary,
        }

    def load_latest_definition(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
    ) -> Optional[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT target_definition_id, dataset_id, target_definition_type, lookback_days,
                       lookforward_days, prediction_grain, config_json, summary_json, created_at
                FROM mule_target_definitions
                WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ?
                ORDER BY created_at DESC, target_definition_id DESC
                LIMIT 1
                """,
                [tenant_id, env_id, int(pipeline_id)],
            ).fetchone()
        if not row:
            return None
        return {
            "target_definition_id": int(row[0]),
            "dataset_id": int(row[1]) if row[1] is not None else None,
            "target_definition_type": row[2],
            "lookback_days": int(row[3]) if row[3] is not None else None,
            "lookforward_days": int(row[4]) if row[4] is not None else None,
            "prediction_grain": row[5],
            "config": json.loads(row[6] or "{}"),
            "summary": json.loads(row[7] or "{}"),
            "created_at": row[8].isoformat() if hasattr(row[8], "isoformat") else row[8],
        }

    def summarize_target_rate(self, frame: pd.DataFrame, label_column: Optional[str]) -> Dict[str, Any]:
        if frame is None or frame.empty or not label_column or label_column not in frame.columns:
            return {
                "event_rate": None,
                "class_imbalance": None,
                "monthly_trend": [],
            }
        series = frame[label_column]
        numeric = pd.to_numeric(series, errors="coerce")
        valid = numeric.dropna()
        event_rate = float(valid.mean()) if not valid.empty else None
        class_imbalance = None
        if event_rate is not None and 0 < event_rate < 1:
            class_imbalance = round(max(event_rate, 1 - event_rate) / max(min(event_rate, 1 - event_rate), 1e-6), 2)
        return {
            "event_rate": event_rate,
            "class_imbalance": class_imbalance,
            "monthly_trend": [],
        }
