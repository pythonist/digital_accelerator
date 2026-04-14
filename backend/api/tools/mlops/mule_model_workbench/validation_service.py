from __future__ import annotations

from typing import Any, Dict

import pandas as pd

from .repository import _column_is_id, _column_is_leakage, _column_is_timestamp, _feature_family


class MuleModelValidationWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        config_state = self.repository.load_config(int(pipeline_id))
        dataset_meta, frame = self.repository.load_dataset(tenant_id, env_id, int(pipeline_id))
        if frame.empty:
            return {"pipeline_id": int(pipeline_id), "dataset_ready": False, "blockers": ["No preprocessing or feature-store dataset is available for model build."]}
        frame = self.repository.augment_with_labels(tenant_id, env_id, int(pipeline_id), frame)
        target_info = self.repository.resolve_target(frame, config_state["config"])
        typology_series = frame["mule_typology"] if "mule_typology" in frame.columns else pd.Series(dtype="object")
        typology_labeled = typology_series.fillna("").astype(str).str.strip() if not typology_series.empty else pd.Series(dtype="object")
        typology_labeled = typology_labeled[typology_labeled.ne("")] if not typology_labeled.empty else typology_labeled
        typology_labeled_classes = sorted(typology_labeled.unique().tolist()) if not typology_labeled.empty else []
        typology_labeled_rows = int(len(typology_labeled))
        typology_training_ready = typology_labeled_rows >= 20 and len(typology_labeled_classes) >= 2
        if "mule_typology" not in frame.columns:
            typology_training_reason = "The source dataset does not contain mule_typology, so category training cannot run yet."
        elif typology_labeled_rows < 20:
            typology_training_reason = "The dataset does not have enough labeled mule_typology rows yet. At least 20 labeled rows are required."
        elif len(typology_labeled_classes) < 2:
            typology_training_reason = "Only one labeled mule_typology class is available, so the Mule category model cannot learn a true multiclass split yet."
        else:
            typology_training_reason = "Enough labeled typology coverage is available for Mule category training."
        split_payload = self.repository.compute_splits(frame, target_info["series"], config_state["config"]) if target_info["ready"] else {"strategy": (config_state["config"].get("validation") or {}).get("split_strategy"), "time_column": None, "boundaries": {}, "train_idx": [], "validation_idx": [], "test_idx": []}
        split_summary = self.repository.summarize_split(target_info["series"], split_payload) if target_info["ready"] else {"strategy": split_payload.get("strategy"), "time_column": None, "boundaries": {}, "splits": []}
        split_class_counts = {}
        for split_row in split_summary.get("splits") or []:
            split_name = str(split_row.get("name") or "").strip().lower()
            if not split_name:
                continue
            classes = [item for item in (split_row.get("class_distribution") or []) if int(item.get("count") or 0) > 0]
            split_class_counts[split_name] = len(classes)
        inventory = self.repository.feature_inventory(frame, target_info, config_state["config"])
        leakage_rows, id_rows = [], []
        for column in frame.columns:
            if _column_is_leakage(column):
                leakage_rows.append({"column": column, "reason": "Leakage / output column"})
            elif _column_is_id(column):
                id_rows.append({"column": column, "reason": "Identifier"})
        column_roles = []
        for column in frame.columns[:160]:
            dtype = str(frame[column].dtype)
            role = "Target" if column == target_info.get("resolved_source") else ("Identifier" if _column_is_id(column) else "Leakage-risk" if _column_is_leakage(column) else "Timestamp" if _column_is_timestamp(column) else "Feature")
            column_roles.append({"column_name": column, "dtype": dtype, "role": role, "family": _feature_family(column), "missing_pct": round(float(frame[column].isna().mean() * 100.0), 2)})
        blockers = []
        if not target_info["ready"]:
            blockers.append("A multiclass Mule target could not be resolved from mule_typology, label, or mule_category.")
        if len(target_info["classes"]) < 2:
            blockers.append("At least two target classes are required before training.")
        if not typology_training_ready:
            blockers.append(typology_training_reason)
        if target_info["ready"] and split_class_counts.get("train", 0) < 2:
            blockers.append("Training split currently has fewer than two classes. Switch to stratified split in Validation Check.")
        return {
            "pipeline_id": int(pipeline_id),
            "dataset_ready": True,
            "dataset_summary": {"dataset_type": dataset_meta.get("dataset_type") if dataset_meta else "", "row_count": int(frame.shape[0]), "column_count": int(frame.shape[1]), "filename": dataset_meta.get("filename") if dataset_meta else ""},
            "target_definition": {key: value for key, value in target_info.items() if key != "series"},
            "typology_training": {
                "ready": typology_training_ready,
                "reason": typology_training_reason,
                "labeled_rows": typology_labeled_rows,
                "labeled_classes": typology_labeled_classes,
                "class_count": len(typology_labeled_classes),
            },
            "split_summary": split_summary,
            "split_class_counts": split_class_counts,
            "leakage_columns": leakage_rows,
            "excluded_id_columns": id_rows,
            "blocked_columns": inventory.get("blocked_columns") or [],
            "column_roles": column_roles,
            "blockers": blockers,
            "ready_for_training": not blockers,
        }

    def save(self, tenant_id: str, pipeline_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        patch = {
            "current_tab": "validation",
            "target": payload.get("target") or {},
            "validation": payload.get("validation") or {},
        }
        self.repository.save_config(tenant_id, int(pipeline_id), patch)
        return self.repository.load_config(int(pipeline_id))
