from __future__ import annotations

from typing import Any, Dict

from .repository import SEQUENCE_TRACKS, TORCH_AVAILABLE, HMM_AVAILABLE


class MuleModelSequenceWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        config_state = self.repository.load_config(int(pipeline_id))
        dataset_meta, frame = self.repository.load_dataset(tenant_id, env_id, int(pipeline_id))
        readiness = []
        available_columns = set(frame.columns.tolist()) if not frame.empty else set()
        for track in SEQUENCE_TRACKS:
            required = track.get("required_columns") or []
            missing = [column for column in required if column not in available_columns]
            status = "ready" if not missing else "blocked"
            if track["id"] == "hmm" and not HMM_AVAILABLE:
                status = "fallback"
            if track["id"] in {"lstm", "transformer"} and not TORCH_AVAILABLE:
                status = "not_available"
            readiness.append({
                "id": track["id"],
                "label": track["label"],
                "kind": track["kind"],
                "required_columns": required,
                "missing_columns": missing,
                "status": status,
            })
        latest = self.repository.get_run(int(pipeline_id))
        return {
            "pipeline_id": int(pipeline_id),
            "config": config_state["config"].get("sequence") or {},
            "tracks": readiness,
            "latest_run": latest.get("sequence") if latest else {},
            "runtime_support": {"hmm": HMM_AVAILABLE, "torch": TORCH_AVAILABLE},
        }

    def save(self, tenant_id: str, pipeline_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        patch = {"current_tab": "sequence", "sequence": payload or {}}
        self.repository.save_config(tenant_id, int(pipeline_id), patch)
        return self.repository.load_config(int(pipeline_id))

