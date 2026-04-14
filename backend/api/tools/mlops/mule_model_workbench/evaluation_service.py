from __future__ import annotations

from typing import Any, Dict


class MuleModelEvaluationWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def get_payload(self, pipeline_id: int) -> Dict[str, Any]:
        latest = self.repository.get_run(int(pipeline_id))
        return {
            "pipeline_id": int(pipeline_id),
            "latest_run": latest.get("evaluation") if latest else {},
            "run_meta": latest.get("summary") if latest else {},
        }

