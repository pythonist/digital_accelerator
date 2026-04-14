from __future__ import annotations

from typing import Any, Dict


class MuleModelChampionWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def get_payload(self, pipeline_id: int) -> Dict[str, Any]:
        config_state = self.repository.load_config(int(pipeline_id))
        latest = self.repository.get_run(int(pipeline_id))
        return {
            "pipeline_id": int(pipeline_id),
            "champion_run_id": config_state.get("champion_run_id"),
            "latest_run_id": config_state.get("latest_run_id"),
            "runs": self.repository.list_runs(int(pipeline_id), limit=12),
            "latest_run": latest.get("supervised") if latest else {},
        }

    def promote(self, pipeline_id: int, run_id: int) -> Dict[str, Any]:
        self.repository.promote_champion(int(pipeline_id), int(run_id))
        return self.get_payload(int(pipeline_id))

