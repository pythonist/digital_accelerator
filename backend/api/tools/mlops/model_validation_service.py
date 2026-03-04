"""
model_validation_service.py - Validation and threshold tuning helpers.

Thin wrapper around ModelTrainingService to separate validation logic
from training orchestration. Keeps endpoints stable while reducing
monolithic service responsibilities.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from api.tools.mlops.model_training_service import ModelTrainingService


class ModelValidationService:
    def __init__(self, training_service: ModelTrainingService):
        self.training = training_service

    def validation_report(
        self,
        *,
        job_id: str,
        max_event_loss_pct: float = 5.0,
        thresholds: Optional[List[float]] = None,
        optimization_mode: str = "max_suppression_under_event_loss",
        target_suppression_pct: Optional[float] = None,
        target_tolerance_pct: float = 2.0,
    ) -> Dict:
        return self.training.validation_report(
            job_id=job_id,
            max_event_loss_pct=max_event_loss_pct,
            thresholds=thresholds,
            optimization_mode=optimization_mode,
            target_suppression_pct=target_suppression_pct,
            target_tolerance_pct=target_tolerance_pct,
        )

    def validation_compare(
        self,
        *,
        job_ids: List[str],
        max_event_loss_pct: float = 5.0,
        optimization_mode: str = "max_suppression_under_event_loss",
        target_suppression_pct: Optional[float] = None,
    ) -> Dict:
        results: Dict = {}
        errors: Dict = {}
        for jid in job_ids:
            try:
                results[jid] = self.validation_report(
                    job_id=str(jid),
                    max_event_loss_pct=max_event_loss_pct,
                    optimization_mode=optimization_mode,
                    target_suppression_pct=target_suppression_pct,
                )
            except Exception as exc:  # pragma: no cover - passthrough
                errors[jid] = str(exc)
        return {"results": results, "errors": errors}
