from __future__ import annotations

from typing import Any, Dict

from .repository import SUPERVISED_ALGORITHMS, _txt


class MuleModelSupervisedWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        config_state = self.repository.load_config(int(pipeline_id))
        config = config_state["config"]
        latest_run = self.repository.get_run(int(pipeline_id))
        dataset_meta, frame = self.repository.load_dataset(tenant_id, env_id, int(pipeline_id))
        frame = self.repository.augment_with_labels(tenant_id, env_id, int(pipeline_id), frame) if not frame.empty else frame
        target_info = self.repository.resolve_target(frame, config) if not frame.empty else {"classes": [], "ready": False}
        inventory = self.repository.feature_inventory(frame, target_info, config) if not frame.empty else {"selected_features": [], "family_summary": []}
        split_summary = self.repository.summarize_split(
            target_info["series"],
            self.repository.compute_splits(frame, target_info["series"], config),
        ) if (not frame.empty and target_info.get("ready")) else {"strategy": (config.get("validation") or {}).get("split_strategy"), "time_column": None, "boundaries": {}, "splits": []}
        supervised_cfg = config.get("supervised") or {}
        tuning_cfg = config.get("tuning") or {}
        available_algorithms = {item.get("id") for item in SUPERVISED_ALGORITHMS if item.get("available", True)}
        selected_algorithms_raw = supervised_cfg.get("selected_algorithms") or []
        selected_algorithms = [item for item in selected_algorithms_raw if item in available_algorithms] or selected_algorithms_raw
        configured_primary = _txt(supervised_cfg.get("primary_algorithm"))
        primary_algo = configured_primary if configured_primary in selected_algorithms else (selected_algorithms[0] if selected_algorithms else configured_primary)
        manual_params = tuning_cfg.get("manual_params") or {}
        return {
            "pipeline_id": int(pipeline_id),
            "algorithms": SUPERVISED_ALGORITHMS,
            "config": supervised_cfg,
            "dataset_summary": {
                "dataset_type": dataset_meta.get("dataset_type") if dataset_meta else "",
                "row_count": int(frame.shape[0]) if not frame.empty else 0,
                "column_count": int(frame.shape[1]) if not frame.empty else 0,
                "filename": dataset_meta.get("filename") if dataset_meta else "",
            },
            "target_definition": {key: value for key, value in (target_info or {}).items() if key != "series"},
            "split_summary": split_summary,
            "selected_features": inventory.get("selected_features") or [],
            "feature_family_summary": inventory.get("family_summary") or [],
            "target_classes": target_info.get("classes") or [],
            "tuning_config": tuning_cfg,
            "primary_algorithm": primary_algo,
            "primary_hyperparameters": manual_params.get(primary_algo, {}) if primary_algo else {},
            "latest_run": latest_run.get("supervised") if latest_run else {},
            "trainable": bool(frame.shape[0] and target_info.get("ready")),
        }

    def save(self, tenant_id: str, pipeline_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        patch = {"current_tab": "supervised", "supervised": payload or {}}
        self.repository.save_config(tenant_id, int(pipeline_id), patch)
        return self.repository.load_config(int(pipeline_id))
