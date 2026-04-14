from __future__ import annotations

from typing import Any, Dict


class MuleModelPolicyWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def get_payload(self, pipeline_id: int) -> Dict[str, Any]:
        config_state = self.repository.load_config(int(pipeline_id))
        latest = self.repository.get_run(int(pipeline_id))
        return {
            "pipeline_id": int(pipeline_id),
            "config": config_state["config"].get("policy") or {},
            "latest_run": latest.get("policy") if latest else {},
        }

    def save(self, tenant_id: str, pipeline_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        patch = {"current_tab": "policy", "policy": payload or {}}
        self.repository.save_config(tenant_id, int(pipeline_id), patch)
        return self.repository.load_config(int(pipeline_id))

