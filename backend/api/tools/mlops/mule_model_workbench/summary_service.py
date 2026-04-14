from __future__ import annotations

from typing import Any, Dict

from .repository import SUPERVISED_ALGORITHMS

class MuleModelSummaryWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        config_state = self.repository.load_config(int(pipeline_id))
        config = config_state["config"]
        latest = self.repository.get_run(int(pipeline_id))
        dataset_meta, frame = self.repository.load_dataset(tenant_id, env_id, int(pipeline_id))
        frame = self.repository.augment_with_labels(tenant_id, env_id, int(pipeline_id), frame) if not frame.empty else frame
        target_info = self.repository.resolve_target(frame, config) if not frame.empty else {"ready": False, "classes": []}
        split_summary = self.repository.summarize_split(
            target_info["series"],
            self.repository.compute_splits(frame, target_info["series"], config),
        ) if (not frame.empty and target_info.get("ready")) else {"strategy": (config.get("validation") or {}).get("split_strategy"), "time_column": None, "boundaries": {}, "splits": []}
        supervised_cfg = config.get("supervised") or {}
        tuning_cfg = config.get("tuning") or {}
        available_algorithms = {item.get("id") for item in SUPERVISED_ALGORITHMS if item.get("available", True)}
        selected_algorithms_raw = supervised_cfg.get("selected_algorithms") or []
        selected_algorithms = [item for item in selected_algorithms_raw if item in available_algorithms] or selected_algorithms_raw
        configured_primary = str(supervised_cfg.get("primary_algorithm") or "").strip()
        primary_algo = configured_primary if configured_primary in selected_algorithms else (selected_algorithms[0] if selected_algorithms else configured_primary)
        manual_params = tuning_cfg.get("manual_params") or {}
        return {
            "pipeline_id": int(pipeline_id),
            "config": config,
            "training_context": {
                "dataset_ready": bool(not frame.empty),
                "dataset_type": dataset_meta.get("dataset_type") if dataset_meta else "",
                "dataset_rows": int(frame.shape[0]) if not frame.empty else 0,
                "dataset_columns": int(frame.shape[1]) if not frame.empty else 0,
                "dataset_file": dataset_meta.get("filename") if dataset_meta else "",
                "target_ready": bool(target_info.get("ready")),
                "target_column": target_info.get("derived_name"),
                "resolved_target_source": target_info.get("resolved_source"),
                "class_names": target_info.get("classes") or [],
                "split_summary": split_summary,
                "selected_algorithms": selected_algorithms,
                "primary_algorithm": primary_algo,
                "primary_algorithm_params": manual_params.get(primary_algo, {}) if primary_algo else {},
                "manual_hyperparameters": manual_params,
            },
            "latest_run": latest or {},
            "recent_runs": self.repository.list_runs(int(pipeline_id), limit=8),
            "latest_job": self.repository.latest_job(int(pipeline_id)),
        }
