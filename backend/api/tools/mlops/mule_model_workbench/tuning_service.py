from __future__ import annotations

import copy
from typing import Any, Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.metrics import f1_score
from sklearn.model_selection import ParameterGrid, ParameterSampler, StratifiedKFold, TimeSeriesSplit
from sklearn.preprocessing import LabelEncoder

from .repository import SUPERVISED_ALGORITHMS, _low, _safe_float, _safe_int, _txt
from .runner import _make_estimator, _to_dense


PARAMETER_SCHEMA: Dict[str, List[Dict[str, Any]]] = {
    "xgboost": [
        {"key": "n_estimators", "label": "Boosting Rounds", "type": "int", "min": 80, "max": 800, "step": 40, "default": 250},
        {"key": "learning_rate", "label": "Learning Rate", "type": "float", "min": 0.01, "max": 0.30, "step": 0.01, "default": 0.08},
        {"key": "max_depth", "label": "Max Depth", "type": "int", "min": 2, "max": 12, "step": 1, "default": 6},
    ],
    "lightgbm": [
        {"key": "n_estimators", "label": "Boosting Rounds", "type": "int", "min": 80, "max": 800, "step": 40, "default": 250},
        {"key": "learning_rate", "label": "Learning Rate", "type": "float", "min": 0.01, "max": 0.30, "step": 0.01, "default": 0.08},
        {"key": "num_leaves", "label": "Num Leaves", "type": "int", "min": 16, "max": 256, "step": 8, "default": 63},
    ],
    "catboost": [
        {"key": "iterations", "label": "Iterations", "type": "int", "min": 80, "max": 800, "step": 40, "default": 250},
        {"key": "learning_rate", "label": "Learning Rate", "type": "float", "min": 0.01, "max": 0.30, "step": 0.01, "default": 0.08},
        {"key": "depth", "label": "Tree Depth", "type": "int", "min": 3, "max": 12, "step": 1, "default": 6},
    ],
    "random_forest": [
        {"key": "n_estimators", "label": "Trees", "type": "int", "min": 80, "max": 900, "step": 40, "default": 240},
        {"key": "max_depth", "label": "Max Depth", "type": "int", "min": 4, "max": 24, "step": 1, "default": 14},
        {"key": "min_samples_leaf", "label": "Min Samples Leaf", "type": "int", "min": 1, "max": 12, "step": 1, "default": 2},
    ],
    "logistic_regression": [
        {"key": "C", "label": "Regularization C", "type": "float", "min": 0.05, "max": 4.0, "step": 0.05, "default": 1.0},
        {"key": "max_iter", "label": "Max Iterations", "type": "int", "min": 200, "max": 3000, "step": 100, "default": 1200},
    ],
}


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def _typed_value(raw_value: Any, schema: Dict[str, Any]) -> Any:
    value_type = _low(schema.get("type") or "float")
    if value_type == "int":
        return _safe_int(raw_value, _safe_int(schema.get("default"), 0))
    return _safe_float(raw_value, _safe_float(schema.get("default"), 0.0))


def _param_values(schema: Dict[str, Any], provided_space: Dict[str, Any] | None = None) -> List[Any]:
    space = provided_space if isinstance(provided_space, dict) else {}
    if isinstance(space.get("values"), list) and space.get("values"):
        values = [_typed_value(value, schema) for value in space.get("values") or []]
        deduped = []
        seen = set()
        for value in values:
            key = str(value)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(value)
        return deduped or [_typed_value(schema.get("default"), schema)]
    minimum = _typed_value(space.get("min", schema.get("min")), schema)
    maximum = _typed_value(space.get("max", schema.get("max")), schema)
    step = _typed_value(space.get("step", schema.get("step")), schema)
    if maximum < minimum:
        minimum, maximum = maximum, minimum
    if _safe_float(step, 0.0) <= 0:
        step = schema.get("step") or 1
    values: List[Any] = []
    if _low(schema.get("type")) == "int":
        current = int(minimum)
        while current <= int(maximum):
            values.append(int(current))
            current += int(step)
    else:
        current = float(minimum)
        while current <= float(maximum) + (float(step) / 2.0):
            values.append(round(float(current), 6))
            current += float(step)
    values = values[:20]
    return values or [_typed_value(schema.get("default"), schema)]


def _candidate_param_sets(model_key: str, tuning_cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    mode = _low(tuning_cfg.get("mode") or "manual")
    schema_rows = PARAMETER_SCHEMA.get(model_key) or []
    manual_params = (tuning_cfg.get("manual_params") or {}).get(model_key) or {}
    search_spaces = (tuning_cfg.get("search_spaces") or {}).get(model_key) or {}
    if mode == "manual":
        return [manual_params]

    param_grid: Dict[str, List[Any]] = {}
    for row in schema_rows:
        key = _txt(row.get("key"))
        if not key:
            continue
        values = _param_values(row, search_spaces.get(key) if isinstance(search_spaces, dict) else None)
        if key in manual_params:
            manual_value = _typed_value(manual_params.get(key), row)
            if manual_value not in values:
                values = [manual_value] + values
        param_grid[key] = values

    if not param_grid:
        return [manual_params]

    max_trials = _clamp(_safe_int(tuning_cfg.get("search_iterations"), 12), 1, 200)
    if mode == "random":
        seed = _safe_int(tuning_cfg.get("random_state"), 42)
        return list(ParameterSampler(param_grid, n_iter=max_trials, random_state=seed))

    combinations = list(ParameterGrid(param_grid))
    return combinations[:max_trials]


def _time_ordered_subset(frame: pd.DataFrame, target: pd.Series, time_col: str | None) -> Tuple[pd.DataFrame, pd.Series]:
    if not time_col or time_col not in frame.columns:
        return frame, target
    ts = pd.to_datetime(frame[time_col], errors="coerce")
    if ts.notna().sum() < max(20, int(len(frame) * 0.3)):
        return frame, target
    ordered = frame.assign(__time__=ts).sort_values("__time__")
    out_frame = ordered.drop(columns=["__time__"])
    out_target = target.loc[out_frame.index]
    return out_frame, out_target


def _cross_validate_model(
    repository,
    model_key: str,
    config: Dict[str, Any],
    frame: pd.DataFrame,
    target: pd.Series,
    feature_columns: List[str],
    class_count: int,
) -> Dict[str, Any]:
    tuning_cfg = config.get("tuning") or {}
    cv_folds = _clamp(_safe_int(tuning_cfg.get("cv_folds"), 3), 2, 10)
    cv_strategy = _low(tuning_cfg.get("cv_strategy") or "stratified_kfold")
    time_col = repository.determine_time_column(frame, config)
    cv_frame = frame.copy()
    cv_target = target.copy()
    if cv_strategy == "time_series":
        cv_frame, cv_target = _time_ordered_subset(cv_frame, cv_target, time_col)
        splitter = TimeSeriesSplit(n_splits=cv_folds)
        split_iter = splitter.split(cv_frame)
    else:
        splitter = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
        split_iter = splitter.split(cv_frame, cv_target.astype(str))

    fold_scores: List[float] = []
    skipped = 0
    for train_idx, valid_idx in split_iter:
        fold_train = cv_frame.iloc[train_idx]
        fold_valid = cv_frame.iloc[valid_idx]
        y_train_raw = cv_target.iloc[train_idx].astype(str)
        y_valid_raw = cv_target.iloc[valid_idx].astype(str)
        if y_train_raw.nunique(dropna=True) < 2 or y_valid_raw.nunique(dropna=True) < 2:
            skipped += 1
            continue
        preprocessor, _, _ = repository.build_preprocessor(fold_train, feature_columns)
        X_train = _to_dense(preprocessor.fit_transform(fold_train[feature_columns]))
        X_valid = _to_dense(preprocessor.transform(fold_valid[feature_columns]))
        encoder = LabelEncoder()
        y_train = encoder.fit_transform(y_train_raw)
        unseen = set(y_valid_raw.unique().tolist()) - set(encoder.classes_.tolist())
        if unseen:
            skipped += 1
            continue
        y_valid = encoder.transform(y_valid_raw)
        estimator = _make_estimator(model_key, class_count, config)
        estimator.fit(X_train, y_train)
        if hasattr(estimator, "predict_proba"):
            probs = estimator.predict_proba(X_valid)
            y_pred = np.argmax(probs, axis=1)
        else:
            y_pred = estimator.predict(X_valid)
        score = float(f1_score(y_valid, y_pred, average="macro", zero_division=0))
        fold_scores.append(score)

    if not fold_scores:
        return {"scored_folds": 0, "skipped_folds": skipped, "cv_mean_macro_f1": None, "cv_std_macro_f1": None, "fold_scores": []}
    return {
        "scored_folds": int(len(fold_scores)),
        "skipped_folds": int(skipped),
        "cv_mean_macro_f1": float(np.mean(fold_scores)),
        "cv_std_macro_f1": float(np.std(fold_scores)),
        "fold_scores": [round(float(item), 6) for item in fold_scores],
    }


class MuleModelTuningWorkbenchService:
    def __init__(self, repository):
        self.repository = repository

    def _selected_algorithms(self, config: Dict[str, Any]) -> List[str]:
        configured = (config.get("supervised") or {}).get("selected_algorithms") or []
        available = {
            item.get("id")
            for item in SUPERVISED_ALGORITHMS
            if item.get("available", True)
        }
        selected = [item for item in configured if item in available]
        if selected:
            return selected[:5]
        return [item.get("id") for item in SUPERVISED_ALGORITHMS if item.get("available", True)][:5]

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        config_state = self.repository.load_config(int(pipeline_id))
        latest = self.repository.get_run(int(pipeline_id))
        config = config_state["config"]
        tuning_cfg = config.get("tuning") or {}
        dataset_meta, frame = self.repository.load_dataset(tenant_id, env_id, int(pipeline_id))
        frame = self.repository.augment_with_labels(tenant_id, env_id, int(pipeline_id), frame) if not frame.empty else frame
        target_info = self.repository.resolve_target(frame, config) if not frame.empty else {"ready": False, "classes": []}
        return {
            "pipeline_id": int(pipeline_id),
            "config": tuning_cfg,
            "latest_run": latest.get("tuning") if latest else {},
            "latest_cv_results": tuning_cfg.get("latest_cv_results") or {},
            "selected_params": tuning_cfg.get("selected_params") or {},
            "parameter_schema": PARAMETER_SCHEMA,
            "selected_algorithms": self._selected_algorithms(config),
            "dataset_summary": {
                "dataset_type": dataset_meta.get("dataset_type") if dataset_meta else "",
                "row_count": int(frame.shape[0]) if not frame.empty else 0,
                "column_count": int(frame.shape[1]) if not frame.empty else 0,
            },
            "target_definition": {
                key: value for key, value in (target_info or {}).items() if key != "series"
            },
        }

    def run_cv(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        state = self.repository.load_config(int(pipeline_id))
        config = copy.deepcopy(state["config"])
        tuning_cfg = config.get("tuning") or {}
        dataset_meta, frame = self.repository.load_dataset(tenant_id, env_id, int(pipeline_id))
        if frame.empty:
            raise ValueError("No dataset is available for tuning. Complete preprocessing first.")
        frame = self.repository.augment_with_labels(tenant_id, env_id, int(pipeline_id), frame)
        target_info = self.repository.resolve_target(frame, config)
        if not target_info.get("ready"):
            raise ValueError("Multiclass target is not ready. Resolve typology labels before tuning.")
        frame[target_info["derived_name"]] = target_info["series"].values
        feature_inventory = self.repository.feature_inventory(frame, target_info, config)
        feature_columns = feature_inventory.get("selected_features") or []
        if not feature_columns:
            raise ValueError("No selected feature columns are available for tuning.")

        split_payload = self.repository.compute_splits(frame, frame[target_info["derived_name"]], config)
        dev_idx = list(split_payload.get("train_idx") or []) + list(split_payload.get("validation_idx") or [])
        if not dev_idx:
            dev_idx = list(frame.index)
        dev_frame = frame.loc[dev_idx].copy()
        dev_target = dev_frame[target_info["derived_name"]].astype(str)
        if dev_target.nunique(dropna=True) < 2:
            raise ValueError("Cross-validation dataset has fewer than two classes.")

        selected_models = self._selected_algorithms(config)
        mode = _low(tuning_cfg.get("mode") or "manual")
        leaderboard: List[Dict[str, Any]] = []
        best_params_by_model: Dict[str, Dict[str, Any]] = {}
        failures: List[Dict[str, Any]] = []

        for model_key in selected_models:
            candidates = _candidate_param_sets(model_key, tuning_cfg)
            model_rows: List[Dict[str, Any]] = []
            for idx, params in enumerate(candidates, start=1):
                trial_config = copy.deepcopy(config)
                trial_tuning = trial_config.get("tuning") or {}
                manual_params = trial_tuning.get("manual_params") or {}
                manual_params[model_key] = params
                trial_tuning["manual_params"] = manual_params
                trial_config["tuning"] = trial_tuning
                try:
                    metrics = _cross_validate_model(
                        self.repository,
                        model_key,
                        trial_config,
                        dev_frame,
                        dev_target,
                        feature_columns,
                        int(len(target_info.get("classes") or [])),
                    )
                    row = {
                        "model_key": model_key,
                        "candidate_id": int(idx),
                        "params": params,
                        **metrics,
                    }
                    if metrics.get("cv_mean_macro_f1") is not None:
                        model_rows.append(row)
                except Exception as exc:
                    failures.append({"model_key": model_key, "candidate_id": int(idx), "error": str(exc)})

            if model_rows:
                model_rows.sort(key=lambda item: float(item.get("cv_mean_macro_f1") or -1), reverse=True)
                best = model_rows[0]
                best_params_by_model[model_key] = best.get("params") or {}
                leaderboard.extend(model_rows[: min(8, len(model_rows))])
            else:
                failures.append({"model_key": model_key, "candidate_id": 0, "error": "No valid CV candidate completed."})

        leaderboard.sort(key=lambda item: float(item.get("cv_mean_macro_f1") or -1), reverse=True)
        best_overall = leaderboard[0] if leaderboard else {}
        cv_result = {
            "executed_at": pd.Timestamp.utcnow().isoformat(),
            "mode": mode,
            "cv_folds": _clamp(_safe_int(tuning_cfg.get("cv_folds"), 3), 2, 10),
            "cv_strategy": _low(tuning_cfg.get("cv_strategy") or "stratified_kfold"),
            "search_iterations": _clamp(_safe_int(tuning_cfg.get("search_iterations"), 12), 1, 200),
            "score_metric": _low(tuning_cfg.get("score_metric") or "macro_f1"),
            "model_count": int(len(selected_models)),
            "feature_count": int(len(feature_columns)),
            "target_classes": target_info.get("classes") or [],
            "leaderboard": leaderboard,
            "best_overall": best_overall,
            "best_params_by_model": best_params_by_model,
            "failures": failures,
        }

        merged_tuning = {
            **tuning_cfg,
            "latest_cv_results": cv_result,
            "selected_params": {**(tuning_cfg.get("selected_params") or {}), **best_params_by_model},
        }
        self.repository.save_config(
            tenant_id,
            int(pipeline_id),
            {"current_tab": "tuning", "tuning": merged_tuning},
        )
        payload = self.get_payload(tenant_id, env_id, int(pipeline_id))
        payload["cv_results"] = cv_result
        return payload

    def save(self, tenant_id: str, env_id: str, pipeline_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        body = payload or {}
        action = _low(body.get("action"))
        patch = {key: value for key, value in body.items() if key != "action"}
        if patch:
            self.repository.save_config(tenant_id, int(pipeline_id), {"current_tab": "tuning", "tuning": patch})
        if action == "run_cv":
            return self.run_cv(tenant_id, env_id, int(pipeline_id))
        return self.get_payload(tenant_id, env_id, int(pipeline_id))
