from __future__ import annotations

from typing import Any, Dict

from .repository import GRAPH_FEATURES


class MuleModelGraphWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        config_state = self.repository.load_config(int(pipeline_id))
        _, frame = self.repository.load_dataset(tenant_id, env_id, int(pipeline_id))
        rows = []
        for algorithm_id, column, description in GRAPH_FEATURES:
            rows.append({
                "algorithm_id": algorithm_id,
                "column_name": column,
                "available": column in frame.columns if not frame.empty else False,
                "coverage_pct": round(float(frame[column].notna().mean() * 100.0), 2) if (not frame.empty and column in frame.columns) else 0.0,
                "description": description,
                "selected": algorithm_id in ((config_state["config"].get("graph") or {}).get("algorithms") or []),
            })
        latest = self.repository.get_run(int(pipeline_id))
        return {"pipeline_id": int(pipeline_id), "config": config_state["config"].get("graph") or {}, "rows": rows, "latest_run": latest.get("graph") if latest else {}}

    def save(self, tenant_id: str, pipeline_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        patch = {"current_tab": "graph", "graph": payload or {}}
        self.repository.save_config(tenant_id, int(pipeline_id), patch)
        return self.repository.load_config(int(pipeline_id))
