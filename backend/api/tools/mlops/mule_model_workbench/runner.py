from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
    roc_auc_score,
    top_k_accuracy_score,
)
from sklearn.pipeline import Pipeline

from api.tools.mlops.mule_model_workbench.repository import (
    CatBoostClassifier,
    GRAPH_FEATURES,
    HMM_AVAILABLE,
    HMM_AVAILABLE as _HMM,
    LGBMClassifier,
    SEQUENCE_TRACKS,
    SHAP_AVAILABLE,
    SUPERVISED_ALGORITHMS,
    TORCH_AVAILABLE,
    XGBClassifier,
    _feature_family,
    _json_default,
    _low,
    _safe_float,
    _safe_int,
    _txt,
    hmm,
)

if _HMM:
    from sklearn.preprocessing import StandardScaler


def _algorithm_defaults(model_key: str, config: Dict[str, Any]) -> Dict[str, Any]:
    tuning_cfg = config.get("tuning") or {}
    manual = (tuning_cfg.get("manual_params") or {}).get(model_key) or {}
    selected = (tuning_cfg.get("selected_params") or {}).get(model_key) or {}
    mode = _low(tuning_cfg.get("mode") or "manual")
    if mode in {"grid", "grid_search", "random", "random_search", "bayesian"} and selected:
        base = {**manual, **selected}
    else:
        base = manual
    if model_key == "xgboost":
        return {"n_estimators": 250, "learning_rate": 0.08, "max_depth": 6, **base}
    if model_key == "lightgbm":
        return {"n_estimators": 250, "learning_rate": 0.08, "num_leaves": 63, **base}
    if model_key == "catboost":
        return {"iterations": 250, "learning_rate": 0.08, "depth": 6, **base}
    if model_key == "random_forest":
        return {"n_estimators": 240, "max_depth": 14, "min_samples_leaf": 2, **base}
    return {"C": 1.0, "max_iter": 1200, **base}


def _make_estimator(model_key: str, class_count: int, config: Dict[str, Any]):
    params = _algorithm_defaults(model_key, config)
    class_weight = "balanced" if _low((config.get("tuning") or {}).get("class_weighting")) == "balanced" else None
    if model_key == "xgboost" and XGBClassifier is not None:
        return XGBClassifier(
            objective="multi:softprob",
            num_class=int(class_count),
            eval_metric="mlogloss",
            random_state=42,
            n_estimators=_safe_int(params.get("n_estimators"), 250),
            learning_rate=_safe_float(params.get("learning_rate"), 0.08),
            max_depth=_safe_int(params.get("max_depth"), 6),
        )
    if model_key == "lightgbm" and LGBMClassifier is not None:
        return LGBMClassifier(
            objective="multiclass",
            num_class=int(max(class_count, 2)),
            class_weight=class_weight,
            random_state=42,
            n_estimators=_safe_int(params.get("n_estimators"), 250),
            learning_rate=_safe_float(params.get("learning_rate"), 0.08),
            num_leaves=_safe_int(params.get("num_leaves"), 63),
            verbose=-1,
        )
    if model_key == "catboost" and CatBoostClassifier is not None:
        return CatBoostClassifier(
            loss_function="MultiClass",
            random_seed=42,
            verbose=False,
            iterations=_safe_int(params.get("iterations"), 250),
            learning_rate=_safe_float(params.get("learning_rate"), 0.08),
            depth=_safe_int(params.get("depth"), 6),
        )
    if model_key == "random_forest":
        return RandomForestClassifier(
            n_estimators=_safe_int(params.get("n_estimators"), 240),
            max_depth=_safe_int(params.get("max_depth"), 14),
            min_samples_leaf=_safe_int(params.get("min_samples_leaf"), 2),
            random_state=42,
            class_weight=class_weight,
            n_jobs=-1,
        )
    return LogisticRegression(
        max_iter=_safe_int(params.get("max_iter"), 1200),
        C=_safe_float(params.get("C"), 1.0),
        class_weight=class_weight,
    )


def _to_dense(value):
    return value.toarray() if hasattr(value, "toarray") else value


def _monthly_backtest(test_df: pd.DataFrame, y_true: np.ndarray, y_pred: np.ndarray, time_col: str | None) -> List[Dict[str, Any]]:
    if not time_col or time_col not in test_df.columns:
        return []
    ts = pd.to_datetime(test_df[time_col], errors="coerce")
    if ts.notna().sum() == 0:
        return []
    frame = pd.DataFrame({"month": ts.dt.to_period("M").astype(str), "actual": y_true, "predicted": y_pred})
    out = []
    for month, part in frame.groupby("month"):
        out.append(
            {
                "month": month,
                "row_count": int(len(part)),
                "macro_f1": round(float(f1_score(part["actual"], part["predicted"], average="macro", zero_division=0)), 4),
                "weighted_f1": round(float(f1_score(part["actual"], part["predicted"], average="weighted", zero_division=0)), 4),
            }
        )
    return out


def _safe_top_k(y_true: np.ndarray, y_prob: np.ndarray, k: int) -> float:
    try:
        return float(top_k_accuracy_score(y_true, y_prob, k=k, labels=np.arange(y_prob.shape[1])))
    except Exception:
        top_idx = np.argsort(y_prob, axis=1)[:, -k:]
        hits = [(int(y_true[i]) in top_idx[i]) for i in range(len(y_true))]
        return float(np.mean(hits)) if hits else 0.0


class MuleModelWorkbenchRunner:
    def __init__(self, repository):
        self.repository = repository

    def _split_distribution_by_name(self, split_summary: Dict[str, Any]) -> Dict[str, Dict[str, int]]:
        out: Dict[str, Dict[str, int]] = {}
        for row in split_summary.get("splits") or []:
            key = str(row.get("name") or "").strip().lower()
            if not key:
                continue
            dist: Dict[str, int] = {}
            for item in row.get("class_distribution") or []:
                class_name = str(item.get("class_name") or "").strip()
                if not class_name:
                    continue
                dist[class_name] = int(item.get("count") or 0)
            out[key] = dist
        return out

    def _split_class_count(self, split_summary: Dict[str, Any], split_name: str) -> int:
        dist = self._split_distribution_by_name(split_summary).get(str(split_name or "").strip().lower(), {})
        return len([name for name, count in dist.items() if int(count) > 0 and name.lower() != "nan"])

    def _split_class_distribution_text(self, split_summary: Dict[str, Any], split_name: str) -> str:
        dist = self._split_distribution_by_name(split_summary).get(str(split_name or "").strip().lower(), {})
        if not dist:
            return "unavailable"
        return ", ".join([f"{name}:{int(count)}" for name, count in dist.items()])

    def _evaluate_model(
        self,
        model_key: str,
        model,
        preprocessor,
        train_df: pd.DataFrame,
        valid_df: pd.DataFrame,
        test_df: pd.DataFrame,
        feature_columns: List[str],
        label_encoder,
        target_column: str,
        time_col: str | None,
    ) -> Dict[str, Any]:
        X_train = _to_dense(preprocessor.fit_transform(train_df[feature_columns]))
        X_valid = _to_dense(preprocessor.transform(valid_df[feature_columns]))
        X_test = _to_dense(preprocessor.transform(test_df[feature_columns]))
        y_train = label_encoder.fit_transform(train_df[target_column].astype(str))
        y_valid = label_encoder.transform(valid_df[target_column].astype(str))
        y_test = label_encoder.transform(test_df[target_column].astype(str))
        model.fit(X_train, y_train)
        valid_prob = model.predict_proba(X_valid)
        test_prob = model.predict_proba(X_test)
        valid_pred = np.argmax(valid_prob, axis=1)
        test_pred = np.argmax(test_prob, axis=1)
        precision, recall, fscore, support = precision_recall_fscore_support(y_test, test_pred, labels=np.arange(len(label_encoder.classes_)), zero_division=0)
        feature_names = preprocessor.get_feature_names_out().tolist()
        if hasattr(model, "feature_importances_"):
            importance_scores = np.asarray(model.feature_importances_)
        elif hasattr(model, "coef_"):
            coefs = np.asarray(model.coef_)
            importance_scores = np.abs(coefs).mean(axis=0) if coefs.ndim > 1 else np.abs(coefs)
        else:
            importance_scores = np.zeros(len(feature_names))
        feature_importance = [
            {"feature": str(name), "importance": round(float(score), 6), "family": _feature_family(str(name))}
            for name, score in sorted(zip(feature_names, importance_scores), key=lambda item: item[1], reverse=True)[:40]
        ]
        auc = None
        try:
            auc = float(roc_auc_score(y_test, test_prob, multi_class="ovr"))
        except Exception:
            auc = None
        return {
            "model_key": model_key,
            "estimator": model,
            "preprocessor": preprocessor,
            "feature_names": feature_names,
            "valid_prob": valid_prob,
            "test_prob": test_prob,
            "full_prob": model.predict_proba(_to_dense(preprocessor.transform(pd.concat([train_df, valid_df, test_df], axis=0)[feature_columns]))),
            "macro_f1": round(float(f1_score(y_test, test_pred, average="macro", zero_division=0)), 4),
            "weighted_f1": round(float(f1_score(y_test, test_pred, average="weighted", zero_division=0)), 4),
            "top_2_accuracy": round(_safe_top_k(y_test, test_prob, min(2, len(label_encoder.classes_))), 4),
            "top_3_accuracy": round(_safe_top_k(y_test, test_prob, min(3, len(label_encoder.classes_))), 4),
            "ovr_auc": round(float(auc), 4) if auc is not None else None,
            "per_class_metrics": [{"class_name": str(label_encoder.classes_[idx]), "precision": round(float(precision[idx]), 4), "recall": round(float(recall[idx]), 4), "f1": round(float(fscore[idx]), 4), "support": int(support[idx])} for idx in range(len(label_encoder.classes_))],
            "confusion_matrix": confusion_matrix(y_test, test_pred, labels=np.arange(len(label_encoder.classes_))).tolist(),
            "monthly_backtest": _monthly_backtest(test_df, y_test, test_pred, time_col),
            "feature_importance": feature_importance,
            "test_pred_labels": label_encoder.inverse_transform(test_pred).tolist(),
            "test_actual_labels": label_encoder.inverse_transform(y_test).tolist(),
        }

    def _sequence_summary(self, train_df: pd.DataFrame, full_df: pd.DataFrame, target_series: pd.Series, config: Dict[str, Any]) -> Dict[str, Any]:
        sequence_cfg = config.get("sequence") or {}
        summaries = []
        hazard_cols = [column for column in SEQUENCE_TRACKS[0]["required_columns"] if column in full_df.columns]
        if sequence_cfg.get("hazard_enabled", True) and hazard_cols:
            model = LogisticRegression(max_iter=1000, class_weight="balanced")
            X_train = train_df[hazard_cols].fillna(0)
            y_train = (train_df["__binary_target__"] > 0).astype(int)
            model.fit(X_train, y_train)
            full_df["hazard_score"] = model.predict_proba(full_df[hazard_cols].fillna(0))[:, 1]
            summaries.append({"track": "Hazard Model", "status": "ready", "kind": "supervised", "score_column": "hazard_score", "required_columns": hazard_cols})
        else:
            summaries.append({"track": "Hazard Model", "status": "blocked", "kind": "supervised", "required_columns": hazard_cols, "reason": "Required behavioural columns are missing."})
        hmm_cols = [column for column in SEQUENCE_TRACKS[1]["required_columns"] if column in full_df.columns]
        if sequence_cfg.get("hmm_enabled", True) and hmm_cols:
            if HMM_AVAILABLE and len(hmm_cols) >= 2:
                scaler = StandardScaler()
                model = hmm.GaussianHMM(n_components=5, covariance_type="diag", n_iter=100, random_state=42)
                X_train = scaler.fit_transform(train_df[hmm_cols].fillna(0))
                model.fit(X_train)
                X_all = scaler.transform(full_df[hmm_cols].fillna(0))
                _, log_prob = model.score_samples(X_all)
                values = -pd.Series(log_prob)
                full_df["hmm_sequence_score"] = ((values - values.min()) / max(float(values.max() - values.min()), 1e-6)).astype(float)
            else:
                values = full_df[hmm_cols].fillna(0).abs().sum(axis=1)
                full_df["hmm_sequence_score"] = ((values - values.min()) / max(float(values.max() - values.min()), 1e-6)).astype(float)
            summaries.append({"track": "HMM", "status": "ready", "kind": "unsupervised", "score_column": "hmm_sequence_score", "required_columns": hmm_cols, "engine": "hmmlearn" if HMM_AVAILABLE else "fallback"})
        else:
            summaries.append({"track": "HMM", "status": "blocked", "kind": "unsupervised", "required_columns": hmm_cols, "reason": "Sequence-like inputs are missing."})
        for track in SEQUENCE_TRACKS[2:]:
            ready = TORCH_AVAILABLE and track["required_columns"][0] in full_df.columns
            summaries.append({"track": track["label"], "status": "ready" if ready else "not_available", "kind": track["kind"].lower(), "required_columns": track["required_columns"], "reason": None if ready else "Deep sequence runtime is unavailable in the current environment."})
        return {"tracks": summaries}

    def _graph_summary(self, frame: pd.DataFrame, config: Dict[str, Any]) -> Dict[str, Any]:
        selected = (config.get("graph") or {}).get("algorithms") or []
        rows = []
        for algorithm_id, column, description in GRAPH_FEATURES:
            rows.append({"algorithm_id": algorithm_id, "column_name": column, "available": column in frame.columns, "coverage_pct": round(float(frame[column].notna().mean() * 100.0), 2) if column in frame.columns else 0.0, "description": description, "selected": algorithm_id in selected})
        return {"enabled": bool((config.get("graph") or {}).get("enabled", True)), "available_features": rows}

    def _build_explainability(self, result: Dict[str, Any], X_sample, predicted_classes: List[str]) -> Dict[str, Any]:
        model = result["estimator"]
        feature_names = result["feature_names"]
        global_importance = result["feature_importance"]
        method = "native_feature_importance"
        if SHAP_AVAILABLE and hasattr(model, "feature_importances_"):
            try:
                explainer = shap.TreeExplainer(model)
                shap_values = explainer.shap_values(X_sample[: min(len(X_sample), 256)])
                if isinstance(shap_values, list):
                    matrix = np.mean(np.abs(np.stack(shap_values, axis=0)), axis=(0, 1))
                else:
                    matrix = np.mean(np.abs(shap_values), axis=0)
                global_importance = [{"feature": str(name), "importance": round(float(score), 6), "family": _feature_family(str(name))} for name, score in sorted(zip(feature_names, matrix), key=lambda item: item[1], reverse=True)[:40]]
                method = "shap"
            except Exception:
                method = "native_feature_importance"
        rationale_rows = []
        top_features = [row["feature"] for row in global_importance[:5]]
        for idx in range(min(len(predicted_classes), 20)):
            rationale_rows.append({"row_index": idx, "predicted_class": predicted_classes[idx], "reason": f"Top contributing indicators: {', '.join(top_features[:3])}"})
        return {"method": method, "global_importance": global_importance, "prediction_rationale": rationale_rows}

    def _decision_payload(self, frame: pd.DataFrame, full_prob: np.ndarray, class_names: List[str], config: Dict[str, Any], sequence_columns: Dict[str, str] | None = None) -> Dict[str, Any]:
        policy = config.get("policy") or {}
        thresholds = policy.get("priority_bands") or {"critical": 0.85, "high": 0.70, "medium": 0.50}
        class_thresholds = {str(key): _safe_float(value, 0.5) for key, value in (policy.get("class_thresholds") or {}).items()}
        routing = {str(key): str(value) for key, value in (policy.get("routing") or {}).items()}
        predicted_idx = np.argmax(full_prob, axis=1)
        top_prob = np.max(full_prob, axis=1)
        second_idx = np.argsort(full_prob, axis=1)[:, -2] if full_prob.shape[1] > 1 else predicted_idx
        predicted_class = [str(class_names[idx]) for idx in predicted_idx]
        second_class = [str(class_names[idx]) for idx in second_idx]
        def priority(score: float, label: str) -> str:
            if label == "non_mule":
                return "Low"
            if score >= _safe_float(thresholds.get("critical"), 0.85):
                return "Critical"
            if score >= _safe_float(thresholds.get("high"), 0.70):
                return "High"
            if score >= _safe_float(thresholds.get("medium"), 0.50):
                return "Medium"
            return "Low"
        decisions = []
        for idx, label in enumerate(predicted_class):
            threshold = class_thresholds.get(label, 0.50)
            action = "review" if top_prob[idx] >= threshold and label != "non_mule" else "monitor"
            decisions.append({"row_index": idx, "predicted_class": label, "secondary_class": second_class[idx], "confidence": round(float(top_prob[idx]), 4), "priority_band": priority(float(top_prob[idx]), label), "action": action, "route": routing.get(label, "General AML Review"), "threshold": threshold})
        return {"priority_bands": thresholds, "class_thresholds": class_thresholds, "routing": routing, "decisions": decisions}

    def run(self, tenant_id: str, env_id: str, pipeline_id: int, patch: Dict[str, Any] | None = None) -> Dict[str, Any]:
        config_state = self.repository.save_config(tenant_id, int(pipeline_id), patch or {})
        config = config_state["config"]
        dataset_meta, raw_frame = self.repository.load_dataset(tenant_id, env_id, int(pipeline_id))
        if raw_frame.empty:
            raise ValueError("No preprocessed or feature-store dataset is available for Mule model training.")
        frame = self.repository.augment_with_labels(tenant_id, env_id, int(pipeline_id), raw_frame)
        target_info = self.repository.resolve_target(frame, config)
        if not target_info["ready"]:
            raise ValueError("A multiclass target could not be resolved. Ensure mule_typology or an equivalent Mule class label is available.")
        frame[target_info["derived_name"]] = target_info["series"].values
        feature_inventory = self.repository.feature_inventory(frame, target_info, config)
        if not feature_inventory["selected_features"]:
            raise ValueError("No governed feature columns are available for model training.")
        split_payload = self.repository.compute_splits(frame, frame[target_info["derived_name"]], config)
        split_summary = self.repository.summarize_split(frame[target_info["derived_name"]], split_payload)
        train_df = frame.loc[split_payload["train_idx"]].copy()
        valid_df = frame.loc[split_payload["validation_idx"]].copy()
        test_df = frame.loc[split_payload["test_idx"]].copy()
        if train_df[target_info["derived_name"]].astype(str).nunique(dropna=True) < 2:
            fallback_config = {
                **config,
                "validation": {
                    **(config.get("validation") or {}),
                    "split_strategy": "stratified_random",
                },
            }
            split_payload = self.repository.compute_splits(frame, frame[target_info["derived_name"]], fallback_config)
            split_summary = self.repository.summarize_split(frame[target_info["derived_name"]], split_payload)
            train_df = frame.loc[split_payload["train_idx"]].copy()
            valid_df = frame.loc[split_payload["validation_idx"]].copy()
            test_df = frame.loc[split_payload["test_idx"]].copy()
        train_class_count = int(train_df[target_info["derived_name"]].astype(str).nunique(dropna=True))
        if train_class_count < 2:
            raise ValueError(
                "Training split contains fewer than two classes. "
                f"Train distribution: {self._split_class_distribution_text(split_summary, 'train')}. "
                "Adjust split settings in Validation Check."
            )
        if valid_df.empty or test_df.empty:
            raise ValueError("Validation or test split is empty. Adjust split settings before training.")
        train_df["__binary_target__"] = train_df[target_info["derived_name"]].ne(target_info["non_mule_class"]).astype(int)
        full_df = pd.concat([train_df, valid_df, test_df], axis=0).reset_index(drop=True)
        selected_models = [
            item["id"]
            for item in SUPERVISED_ALGORITHMS
            if item["id"] in ((config.get("supervised") or {}).get("selected_algorithms") or []) and item.get("available", True)
        ]
        if not selected_models:
            selected_models = [item["id"] for item in SUPERVISED_ALGORITHMS if item.get("available", True)]
        configured_primary = _txt((config.get("supervised") or {}).get("primary_algorithm"))
        resolved_primary = configured_primary if configured_primary in selected_models else (selected_models[0] if selected_models else configured_primary)
        label_encoder = __import__("sklearn.preprocessing", fromlist=["LabelEncoder"]).LabelEncoder()
        candidate_results = []
        model_failures = []
        best = None
        for model_key in selected_models[:5]:
            try:
                estimator = _make_estimator(model_key, len(target_info["classes"]), config)
                preprocessor, _, _ = self.repository.build_preprocessor(frame, feature_inventory["selected_features"])
                result = self._evaluate_model(
                    model_key,
                    estimator,
                    preprocessor,
                    train_df,
                    valid_df,
                    test_df,
                    feature_inventory["selected_features"],
                    label_encoder,
                    target_info["derived_name"],
                    split_summary.get("time_column"),
                )
                candidate_results.append({
                    **{key: value for key, value in result.items() if key not in {"estimator", "preprocessor", "valid_prob", "test_prob", "full_prob", "feature_names"}},
                    "status": "completed",
                })
                if best is None or result["macro_f1"] > best["macro_f1"] or (result["macro_f1"] == best["macro_f1"] and result["weighted_f1"] > best["weighted_f1"]):
                    best = result
            except Exception as exc:
                error_text = str(exc)
                model_failures.append({"model_key": model_key, "error": error_text})
                candidate_results.append({"model_key": model_key, "status": "failed", "error": error_text})
        if best is None:
            failure_text = "; ".join([f"{item['model_key']}: {item['error']}" for item in model_failures[:3]]) or "Unknown model training failure."
            raise ValueError(f"No selected algorithm could be trained successfully. {failure_text}")
        champion_model = best["model_key"]
        full_target_df = pd.concat([train_df, valid_df, test_df], axis=0)
        predicted_idx = np.argmax(best["full_prob"], axis=1)
        predicted_labels = label_encoder.inverse_transform(predicted_idx)
        sequence_payload = self._sequence_summary(train_df, full_df, frame[target_info["derived_name"]], config)
        graph_payload = self._graph_summary(full_df, config)
        explainability = self._build_explainability(best, _to_dense(best["preprocessor"].transform(test_df[feature_inventory["selected_features"]])), best["test_pred_labels"])
        policy_payload = self._decision_payload(full_df, best["full_prob"], list(label_encoder.classes_), config)
        scored_output = full_target_df.copy().reset_index(drop=True)
        scored_output["predicted_class"] = predicted_labels
        scored_output["prediction_confidence"] = np.max(best["full_prob"], axis=1)
        scored_output["secondary_class"] = [label_encoder.classes_[idx] for idx in np.argsort(best["full_prob"], axis=1)[:, -2]] if best["full_prob"].shape[1] > 1 else predicted_labels
        for idx, class_name in enumerate(label_encoder.classes_):
            scored_output[f"prob_{class_name}"] = best["full_prob"][:, idx]
        decision_df = pd.DataFrame(policy_payload["decisions"])
        scored_output = pd.concat([scored_output.reset_index(drop=True), decision_df.drop(columns=["row_index"]).reset_index(drop=True)], axis=1)
        for track in sequence_payload["tracks"]:
            score_col = track.get("score_column")
            if score_col and score_col in full_df.columns and score_col not in scored_output.columns:
                scored_output[score_col] = full_df[score_col].values
        run_id = self.repository.next_run_id()
        artifacts_dir = self.repository._artifacts_dir(int(pipeline_id))
        output_table_name = f"mule_model_output_{int(pipeline_id)}_{int(run_id)}"
        scores_path = artifacts_dir / f"{output_table_name}.csv"
        model_path = artifacts_dir / f"mule_model_bundle_{int(pipeline_id)}_{int(run_id)}.joblib"
        report_path = artifacts_dir / f"mule_model_report_{int(pipeline_id)}_{int(run_id)}.json"
        scored_output.sort_values(by="prediction_confidence", ascending=False).to_csv(scores_path, index=False)
        joblib.dump({"champion_model": best["estimator"], "preprocessor": best["preprocessor"], "label_encoder": label_encoder, "feature_columns": feature_inventory["selected_features"], "candidate_results": candidate_results}, model_path)
        report_path.write_text(json.dumps({"target": {key: value for key, value in target_info.items() if key != "series"}, "split": split_summary, "supervised": {"champion_model": champion_model, "candidate_results": candidate_results, "selected_features": feature_inventory["selected_features"]}, "evaluation": {"macro_f1": best["macro_f1"], "weighted_f1": best["weighted_f1"], "top_2_accuracy": best["top_2_accuracy"], "top_3_accuracy": best["top_3_accuracy"], "ovr_auc": best["ovr_auc"], "per_class_metrics": best["per_class_metrics"], "confusion_matrix": best["confusion_matrix"], "monthly_backtest": best["monthly_backtest"]}, "explainability": explainability, "policy": policy_payload}, indent=2), encoding="utf-8")
        payload = {
            "run_id": int(run_id),
            "status": "completed",
            "target": {key: value for key, value in target_info.items() if key != "series"},
            "split": split_summary,
            "supervised": {
                "champion_model": champion_model,
                "primary_model": resolved_primary,
                "candidate_results": candidate_results,
                "model_failures": model_failures,
                "selected_features": feature_inventory["selected_features"],
                "feature_inventory": feature_inventory,
            },
            "sequence": sequence_payload,
            "graph": graph_payload,
            "tuning": config.get("tuning") or {},
            "evaluation": {"macro_f1": best["macro_f1"], "weighted_f1": best["weighted_f1"], "top_2_accuracy": best["top_2_accuracy"], "top_3_accuracy": best["top_3_accuracy"], "ovr_auc": best["ovr_auc"], "per_class_metrics": best["per_class_metrics"], "confusion_matrix": best["confusion_matrix"], "monthly_backtest": best["monthly_backtest"]},
            "explainability": explainability,
            "policy": policy_payload,
            "summary": {
                "dataset_type": dataset_meta.get("dataset_type") if dataset_meta else "",
                "dataset_rows": int(len(frame)),
                "dataset_columns": int(frame.shape[1]),
                "selected_feature_count": int(len(feature_inventory["selected_features"])),
                "target_column": target_info["derived_name"],
                "resolved_target_source": target_info["resolved_source"],
                "class_names": target_info["classes"],
                "split_strategy": split_summary.get("strategy"),
                "split_distribution": split_summary.get("splits") or [],
                "selected_algorithms": selected_models[:5],
                "primary_algorithm": resolved_primary,
                "primary_algorithm_params": ((config.get("tuning") or {}).get("manual_params") or {}).get(resolved_primary or "", {}),
                "latest_action": "training_completed",
            },
            "artifacts": {"scored_output_path": str(scores_path), "model_bundle_path": str(model_path), "run_report_path": str(report_path), "output_table_name": output_table_name},
            "logs": [{"step": "validation", "status": "completed", "detail": "Resolved multiclass target and dataset split."}, {"step": "supervised_training", "status": "completed", "detail": f"Trained {len([item for item in candidate_results if item.get('status') == 'completed'])} supervised candidates, {len(model_failures)} failed, champion={champion_model}."}, {"step": "sequence_overlay", "status": "completed", "detail": "Computed available sequence overlays."}, {"step": "graph_summary", "status": "completed", "detail": "Assessed graph and ring feature availability."}, {"step": "persistence", "status": "completed", "detail": "Persisted scored output, bundle, and report artifacts."}],
        }
        saved = self.repository.save_run(tenant_id, int(pipeline_id), payload)
        self.repository.persist_legacy_model_run(tenant_id, env_id, int(pipeline_id), saved)
        return saved
