from __future__ import annotations

import json
import re
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

try:
    from sklearn.ensemble import RandomForestClassifier
except Exception:
    RandomForestClassifier = None

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mule_preprocessing_service import FEATURE_GROUPS, MulePreprocessingService, _bool, _load_frame, _low, _txt
from api.tools.mlops.path_utils import resolve_data_file_path, resolve_mlops_data_dir

STAGE_NAME = "preprocessing_feature_selection"
WORKBENCH_JOB_TYPE = "preprocessing_workbench_run"
WORKBENCH_JOB_PREFIX = "mule-preprocessing-workbench"
ALLOWED_ENCODINGS = {"one_hot", "ordinal", "frequency", "target_safe", "binary", "none"}
ALLOWED_MISSING = {"median", "mean", "mode", "constant", "missing_flag", "leave"}
ALLOWED_SCALING = {"none", "standard", "minmax", "robust", "log", "winsorize"}
SELECTION_METHOD_METADATA = {
    "correlation_filter": {
        "label": "Target Correlation",
        "description": "Ranks numeric features by absolute correlation with the mule target.",
    },
    "variance_threshold": {
        "label": "Variance Threshold",
        "description": "Screens out near-constant features that add little model value.",
    },
    "missingness_threshold": {
        "label": "Missingness Threshold",
        "description": "Flags unstable features with too much missing coverage.",
    },
    "redundancy_filter": {
        "label": "Redundancy Filter",
        "description": "Removes overlapping features when they contribute the same signal.",
    },
    "random_forest_importance": {
        "label": "Model Importance",
        "description": "Uses a balanced random forest to estimate univariate modelling value.",
    },
}

BUILTIN_ENGINEERED_FEATURES = [
    {"feature_name": "velocity_flag", "feature_family": "transaction_behavior", "source_columns": ["txn_count", "txn_amount_sum"], "logic": "Flags accounts with unusually high transaction velocity relative to the account-level volume baseline.", "formula": "zscore(txn_count) > 1.5", "business_meaning": "Rapid movement can indicate pass-through mule behavior."},
    {"feature_name": "fanout_flag", "feature_family": "counterparty_exposure", "source_columns": ["counterparty_count"], "logic": "Flags accounts distributing activity across an unusually high number of counterparties.", "formula": "counterparty_count above 90th percentile", "business_meaning": "High fan-out patterns can indicate dispersal behavior."},
    {"feature_name": "sequence_score", "feature_family": "behavioral_risk", "source_columns": ["txn_count", "txn_amount_std"], "logic": "Combines transaction frequency and amount volatility into a simple sequence-style behavior score.", "formula": "(txn_count rank + amount_std rank) / 2", "business_meaning": "Useful for spotting accounts whose behavioral rhythm changed abruptly."},
    {"feature_name": "shared_device_risk", "feature_family": "graph_ring", "source_columns": ["device_signal_count", "device_signal_risk_score_mean"], "logic": "Combines device reuse volume and average device risk into a single operational risk indicator.", "formula": "device count * average device risk", "business_meaning": "Highlights shared-device exposure associated with coordinated mule activity."},
    {"feature_name": "shared_ip_risk", "feature_family": "graph_ring", "source_columns": ["device_signal_risk_score_mean"], "logic": "Uses average IP/device risk as a proxy for shared-IP exposure.", "formula": "average IP risk score", "business_meaning": "Surfaces high-risk access behavior linked to connected accounts."},
    {"feature_name": "dormant_activation_flag", "feature_family": "transaction_behavior", "source_columns": ["txn_count"], "logic": "Flags accounts that were previously quiet and now show active movement.", "formula": "txn_count > 0 after prior dormancy", "business_meaning": "Dormant-then-active behavior is common in mule staging."},
    {"feature_name": "graph_pagerank", "feature_family": "graph_ring", "source_columns": ["network_degree_max", "network_degree_sum"], "logic": "Approximates connected-entity prominence from network degree measures.", "formula": "0.6 * degree max + 0.4 * degree sum", "business_meaning": "Helps identify highly connected entities within suspicious networks."},
    {"feature_name": "graph_clustering", "feature_family": "graph_ring", "source_columns": ["network_degree_sum", "counterparty_count"], "logic": "Approximates local network density from relationship counts.", "formula": "counterparty count / network degree sum", "business_meaning": "Useful for spotting tightly connected network pockets."},
    {"feature_name": "cycle_flag", "feature_family": "graph_ring", "source_columns": ["network_degree_sum"], "logic": "Flags dense network structures that may indicate cyclical money movement.", "formula": "network degree sum above percentile threshold", "business_meaning": "Supports graph-based mule ring investigation."},
    {"feature_name": "ring_count", "feature_family": "graph_ring", "source_columns": ["network_degree_sum"], "logic": "Uses network degree as a proxy for linked ring membership count.", "formula": "rounded network degree sum / 3", "business_meaning": "Summarizes how many suspicious relationship clusters touch the account."},
    {"feature_name": "ring_max_risk_score", "feature_family": "graph_ring", "source_columns": ["device_signal_risk_score_mean", "external_signal_risk_score_max"], "logic": "Combines device/IP risk and external signal risk to estimate maximum ring exposure.", "formula": "max(device risk, external signal risk / 5)", "business_meaning": "Represents the strongest connected-ring risk signal for the account."},
    {"feature_name": "ring_max_member_count", "feature_family": "graph_ring", "source_columns": ["network_degree_sum", "counterparty_count"], "logic": "Approximates the largest related-member cluster touching the account.", "formula": "max(network degree sum, counterparty count)", "business_meaning": "Shows the largest suspicious cluster size linked to the account."},
]


def _records(df: pd.DataFrame, limit: int = 20) -> List[Dict[str, Any]]:
    if df is None or df.empty:
        return []
    sample = df.head(limit).copy().replace({np.nan: None})
    return sample.to_dict(orient="records")


def _numeric_series_or_default(frame: pd.DataFrame, column: str, default: float = 0.0) -> pd.Series:
    if frame is None or frame.empty:
        return pd.Series(dtype="float64")
    if column not in frame.columns:
        return pd.Series(default, index=frame.index, dtype="float64")
    series = frame[column]
    if pd.api.types.is_bool_dtype(series):
        return series.fillna(False).astype(int).astype("float64")
    return pd.to_numeric(series, errors="coerce").fillna(default).astype("float64")


def _analysis_numeric_series(series: pd.Series, default: float = 0.0) -> pd.Series:
    if series is None:
        return pd.Series(dtype="float64")
    if pd.api.types.is_bool_dtype(series):
        return series.fillna(False).astype(int).astype("float64")
    return pd.to_numeric(series, errors="coerce").fillna(default).astype("float64")


def _numeric_columns(df: pd.DataFrame) -> List[str]:
    return [col for col in df.columns if pd.api.types.is_numeric_dtype(df[col])]


def _sample_non_null(series: pd.Series, limit: int = 400) -> pd.Series:
    if series is None:
        return pd.Series(dtype="object")
    sample = series.dropna()
    if len(sample) > limit:
        sample = sample.head(limit)
    return sample


def _numeric_parse_ratio(series: pd.Series) -> float:
    sample = _sample_non_null(series)
    if sample.empty:
        return 0.0
    try:
        coerced = pd.to_numeric(sample, errors="coerce")
    except Exception:
        return 0.0
    return float(coerced.notna().mean())


def _datetime_parse_ratio(series: pd.Series) -> float:
    sample = _sample_non_null(series)
    if sample.empty:
        return 0.0
    try:
        coerced = pd.to_datetime(sample, errors="coerce", utc=False)
    except Exception:
        return 0.0
    return float(coerced.notna().mean())


def _is_numeric_like(series: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(series) or _numeric_parse_ratio(series) >= 0.92


def _is_datetime_like(column: str, series: pd.Series) -> bool:
    if pd.api.types.is_datetime64_any_dtype(series):
        return True
    name = _low(column)
    if any(token in name for token in ("date", "time", "timestamp", "_dt", "_ts")) and _datetime_parse_ratio(series) >= 0.6:
        return True
    return _datetime_parse_ratio(series) >= 0.9


def _column_role(column: str, series: Optional[pd.Series] = None) -> str:
    name = _low(column)
    if name in {"account_id", "customer_id"} or name.endswith("_id"):
        return "identifier"
    if name in {"mule_flag", "mule_typology"}:
        return "target"
    if "date" in name or name.endswith("_ts") or "timestamp" in name or (series is not None and _is_datetime_like(column, series)):
        return "datetime"
    return "feature"


def _column_type(series: pd.Series, column: str = "") -> str:
    if pd.api.types.is_bool_dtype(series):
        return "boolean"
    if _is_numeric_like(series):
        return "numerical"
    if _is_datetime_like(column, series):
        return "datetime"
    return "categorical"


def _recommended_encoding(column: str, series: pd.Series, business_role: str) -> str:
    detected_type = _column_type(series, column)
    if business_role in {"identifier", "target", "datetime"}:
        return "none"
    if detected_type != "categorical":
        return "none"
    nunique = int(series.nunique(dropna=True))
    if nunique <= 2:
        return "binary"
    if nunique <= 12:
        return "one_hot"
    return "frequency"


def _recommended_missing_strategy(column: str, series: pd.Series, business_role: str) -> str:
    detected_type = _column_type(series, column)
    if business_role in {"identifier", "target"}:
        return "leave"
    if detected_type == "datetime":
        return "mode"
    if detected_type == "numerical":
        return "median"
    return "mode"


def _recommended_scaling(column: str, series: pd.Series, business_role: str, model_family_hint: str = "tree_ensemble") -> str:
    if business_role in {"identifier", "target", "datetime"} or not _is_numeric_like(series):
        return "none"
    name = _low(column)
    model_hint = _low(model_family_hint)
    if "tree" in model_hint or "forest" in model_hint or "boost" in model_hint:
        return "none"
    if any(token in name for token in ("ratio", "score", "flag", "count", "pct", "rate")):
        return "none"
    numeric = pd.to_numeric(series, errors="coerce").fillna(0)
    skew = abs(float(numeric.skew())) if len(numeric) else 0.0
    return "log" if skew > 2.5 else "standard"


def _feature_family_from_name(column: str) -> str:
    name = _low(column)
    if any(token in name for token in ("graph", "ring", "device", "network", "counterparty")):
        return "graph_ring"
    if any(token in name for token in ("txn", "amount", "velocity", "outflow", "dormant")):
        return "transaction_behavior"
    if any(token in name for token in ("complaint", "signal", "if4")):
        return "external_intelligence"
    if any(token in name for token in ("balance", "credit", "debit")):
        return "balance_retention"
    return "feature_store"


def _protected_feature(column: str) -> bool:
    name = _low(column)
    return any(token in name for token in ("device", "graph", "ring", "counterparty", "velocity", "outflow", "dormant", "risk"))


def _validate_formula_expression(expression: str, columns: Iterable[str]) -> Tuple[bool, str]:
    expr = _txt(expression)
    if not expr:
        return False, "Formula is required."
    if len(expr) > 500:
        return False, "Formula is too long."
    if not re.fullmatch(r"[\w\s\+\-\*\/\(\)\.\,\>\<\=\!\&\|\%]+", expr):
        return False, "Formula contains unsupported characters."
    lowered = expr.lower()
    if any(token in lowered for token in ("import", "lambda", "__", "exec", "eval", "open(")):
        return False, "Formula contains unsupported operations."
    available = set(map(str, columns))
    tokens = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", expr))
    reserved = {"and", "or", "not", "abs", "clip", "round", "log", "sqrt", "min", "max"}
    missing = sorted(token for token in tokens if token not in reserved and token not in available)
    if missing:
        return False, f"Unknown column(s): {', '.join(missing[:8])}"
    return True, "Formula looks valid."


class MulePreprocessingOverviewService:
    def __init__(self, base: MulePreprocessingService):
        self.base = base

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
        if not dataset_meta:
            return {"pipeline_id": int(pipeline_id), "dataset_ready": False, "message": "Feature Store output is not ready yet for preprocessing.", "dataset_summary": {}, "class_distribution": [], "missingness": [], "column_profiles": [], "feature_families": [], "target_metadata": current.get("target_validation") or {}}
        frame = _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root()))
        target_joined = self.base._join_labels(frame, tenant_id, env_id, pipeline_id)
        joined = target_joined["frame"]
        target_validation = target_joined["validation"]
        class_distribution = []
        if "mule_flag" in joined.columns:
            counts = joined["mule_flag"].fillna(0).astype(str).value_counts(dropna=False).to_dict()
            total = max(int(sum(counts.values())), 1)
            class_distribution = [{"label": label, "count": int(count), "pct": round((count / total) * 100.0, 2)} for label, count in counts.items()]
        missingness = [{"column": col, "missing_count": int(joined[col].isna().sum()), "missing_pct": round(float(joined[col].isna().mean() * 100.0), 2)} for col in joined.columns]
        missingness.sort(key=lambda item: (-item["missing_pct"], item["column"]))
        column_profiles = [{"column_name": col, "detected_type": _column_type(joined[col], col), "business_role": _column_role(col, joined[col]), "unique_values": int(joined[col].nunique(dropna=True)), "missing_pct": round(float(joined[col].isna().mean() * 100.0), 2), "family": _feature_family_from_name(col)} for col in joined.columns]
        families: Dict[str, int] = {}
        for col in joined.columns:
            fam = _feature_family_from_name(col)
            families[fam] = families.get(fam, 0) + 1
        return {"pipeline_id": int(pipeline_id), "dataset_ready": True, "dataset_summary": {"dataset_id": int(dataset_meta.get("dataset_id") or 0), "dataset_type": _txt(dataset_meta.get("dataset_type") or "feature_store"), "row_count": int(joined.shape[0]), "column_count": int(joined.shape[1]), "source_file": _txt(dataset_meta.get("filename") or Path(_txt(dataset_meta.get("file_path"))).name)}, "target_metadata": {**target_validation, "target_column": _txt(current["config"].get("target_column") or "mule_flag")}, "class_distribution": class_distribution, "missingness": missingness[:40], "column_profiles": column_profiles, "feature_families": [{"family": key, "feature_count": value} for key, value in sorted(families.items())], "sample_rows": _records(joined, limit=12)}


class MulePreprocessingTransformService:
    def __init__(self, base: MulePreprocessingService):
        self.base = base

    def _default_transform_config(self) -> Dict[str, Any]:
        return {
            "column_settings": {},
            "missing_strategy_default": "median",
            "scaling_default": "none",
            "normalization_default": "none",
            "model_family_hint": "tree_ensemble",
            "auto_summary": {},
        }

    def _current_transform(self, config: Dict[str, Any]) -> Dict[str, Any]:
        current = config.get("transform_workbench")
        return current if isinstance(current, dict) else self._default_transform_config()

    def has_saved_transform(self, config: Dict[str, Any]) -> bool:
        transform_config = config if "column_settings" in config else self._current_transform(config)
        return bool((transform_config.get("column_settings") or {}))

    def _recommendations(self) -> Dict[str, str]:
        return {
            "categorical": "Auto-classify categories, use binary encoding for two-value flags, one-hot for low-cardinality business fields, and frequency-style encoding for wider operational categories.",
            "datetime": "Date-like columns are identified automatically. Keep them flat by default unless the team explicitly wants derived age, weekday, or recency fields next.",
            "identifiers": "Identifier and entity keys are preserved for lineage and traceability, but they are not automatically encoded or scaled like model features.",
            "numeric": "Numeric fields default to median-style missing handling. Scaling stays off for tree-based tracks unless the model family hint is changed.",
        }

    def _build_column_profile(self, column: str, series: pd.Series, transform_config: Dict[str, Any]) -> Dict[str, Any]:
        existing = (transform_config.get("column_settings") or {}).get(column) or {}
        business_role = _column_role(column, series)
        detected_type = _column_type(series, column)
        recommended_encoding = _recommended_encoding(column, series, business_role)
        recommended_missing = _recommended_missing_strategy(column, series, business_role)
        recommended_scaling = _recommended_scaling(
            column,
            series,
            business_role,
            _txt(transform_config.get("model_family_hint") or "tree_ensemble"),
        )
        return {
            "column_name": column,
            "detected_type": detected_type,
            "business_role": business_role,
            "unique_values": int(series.nunique(dropna=True)),
            "missing_pct": round(float(series.isna().mean() * 100.0), 2),
            "recommended_encoding": recommended_encoding,
            "recommended_missing_strategy": recommended_missing,
            "recommended_scaling": recommended_scaling,
            "selected_encoding": _txt(existing.get("encoding") or recommended_encoding),
            "selected_scaling": _txt(existing.get("scaling") or recommended_scaling),
            "missing_strategy": _txt(existing.get("missing_strategy") or recommended_missing),
            "include": existing.get("include", True),
            "numeric_parse_ratio": round(_numeric_parse_ratio(series), 4),
            "datetime_parse_ratio": round(_datetime_parse_ratio(series), 4),
        }

    def _build_profiles(self, frame: pd.DataFrame, transform_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        if frame is None or frame.empty:
            return []
        return [self._build_column_profile(column, frame[column], transform_config) for column in frame.columns]

    def _build_summary(self, profiles: List[Dict[str, Any]]) -> Dict[str, Any]:
        role_counts: Dict[str, int] = {}
        type_counts: Dict[str, int] = {}
        for item in profiles:
            role = _txt(item.get("business_role") or "feature")
            detected_type = _txt(item.get("detected_type") or "unknown")
            role_counts[role] = role_counts.get(role, 0) + 1
            type_counts[detected_type] = type_counts.get(detected_type, 0) + 1
        return {
            "column_count": len(profiles),
            "role_counts": role_counts,
            "type_counts": type_counts,
            "auto_configured": bool(profiles),
        }

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
        frame = _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root())) if dataset_meta else pd.DataFrame()
        transform_config = self._current_transform(current["config"])
        profiles = self._build_profiles(frame, transform_config)
        if profiles and not transform_config.get("auto_summary"):
            transform_config = {**transform_config, "auto_summary": self._build_summary(profiles)}
        return {
            "pipeline_id": int(pipeline_id),
            "dataset_ready": not frame.empty,
            "transform_config": transform_config,
            "column_profiles": profiles,
            "transform_summary": transform_config.get("auto_summary") or self._build_summary(profiles),
            "recommendations": self._recommendations(),
        }

    def auto_configure(self, tenant_id: str, env_id: str, pipeline_id: int, patch: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
        if not dataset_meta:
            return {
                "pipeline_id": int(pipeline_id),
                "dataset_ready": False,
                "transform_config": self._default_transform_config(),
                "column_profiles": [],
                "transform_summary": {"column_count": 0, "role_counts": {}, "type_counts": {}, "auto_configured": False},
                "recommendations": self._recommendations(),
                "message": "Feature Store output is not ready for auto-configuration.",
            }
        frame = _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root()))
        existing = self._current_transform(current["config"])
        model_family_hint = _txt((patch or {}).get("model_family_hint") or existing.get("model_family_hint") or "tree_ensemble")
        auto_settings: Dict[str, Dict[str, Any]] = {}
        profiles = []
        for column in frame.columns:
            series = frame[column]
            business_role = _column_role(column, series)
            detected_type = _column_type(series, column)
            auto_settings[column] = {
                "include": True,
                "encoding": _recommended_encoding(column, series, business_role),
                "missing_strategy": _recommended_missing_strategy(column, series, business_role),
                "scaling": _recommended_scaling(column, series, business_role, model_family_hint),
                "business_role": business_role,
                "detected_type": detected_type,
                "auto_applied": True,
            }
            profiles.append(self._build_column_profile(column, series, {
                "column_settings": auto_settings,
                "model_family_hint": model_family_hint,
            }))
        summary = self._build_summary(profiles)
        next_config = {
            **self._default_transform_config(),
            **{k: v for k, v in existing.items() if k not in {"column_settings", "auto_summary"}},
            "model_family_hint": model_family_hint,
            "column_settings": auto_settings,
            "auto_summary": summary,
            "auto_generated": True,
            "auto_generated_at": pd.Timestamp.utcnow().isoformat(),
        }
        self.base.save_config(
            tenant_id,
            env_id,
            pipeline_id,
            {"transform_workbench": next_config, "workspace_stage": "transform"},
        )
        payload = self.get_payload(tenant_id, env_id, pipeline_id)
        payload["message"] = (
            f"Auto-configured {summary['column_count']} columns: "
            f"{summary['role_counts'].get('identifier', 0)} identifiers, "
            f"{summary['type_counts'].get('numerical', 0)} numerical, "
            f"{summary['type_counts'].get('categorical', 0)} categorical, "
            f"{summary['type_counts'].get('datetime', 0)} datetime."
        )
        return payload

    def save(self, tenant_id: str, env_id: str, pipeline_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        existing = self._current_transform(current["config"])
        merged = {**existing, **(patch or {})}
        if isinstance(existing.get("column_settings"), dict) and isinstance((patch or {}).get("column_settings"), dict):
            merged["column_settings"] = {**existing["column_settings"], **patch["column_settings"]}
        if merged.get("column_settings"):
            dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
            if dataset_meta:
                frame = _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root()))
                merged["auto_summary"] = self._build_summary(self._build_profiles(frame, merged))
        self.base.save_config(tenant_id, env_id, pipeline_id, {"transform_workbench": merged, "workspace_stage": "transform"})
        return self.get_payload(tenant_id, env_id, pipeline_id)

    def validate(self, tenant_id: str, env_id: str, pipeline_id: int, patch: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = self.save(tenant_id, env_id, pipeline_id, patch or {}) if patch else self.get_payload(tenant_id, env_id, pipeline_id)
        warnings = []
        for item in payload["column_profiles"]:
            if item["selected_encoding"] not in ALLOWED_ENCODINGS:
                warnings.append(f"{item['column_name']}: unsupported encoding {item['selected_encoding']}")
            if item["missing_strategy"] not in ALLOWED_MISSING:
                warnings.append(f"{item['column_name']}: unsupported missing strategy {item['missing_strategy']}")
            if item["selected_scaling"] not in ALLOWED_SCALING:
                warnings.append(f"{item['column_name']}: unsupported scaling {item['selected_scaling']}")
        return {"valid": not warnings, "warnings": warnings[:20], "transform_config": payload["transform_config"]}

    def _binary_encode(self, series: pd.Series) -> pd.Series:
        raw = series.copy()
        lowered = raw.astype(str).str.strip().str.lower()
        truthy = {"true", "yes", "y", "1", "t"}
        falsy = {"false", "no", "n", "0", "f"}
        unique = {value for value in lowered.dropna().unique() if value not in {"nan", "none", ""}}
        if unique and unique.issubset(truthy | falsy):
            return lowered.map(lambda value: 1 if value in truthy else 0 if value in falsy else np.nan).fillna(0).astype(int)
        numeric = pd.to_numeric(raw, errors="coerce")
        if numeric.notna().mean() >= 0.95:
            return (numeric.fillna(0) > 0).astype(int)
        categories = [value for value in lowered.dropna().unique() if value not in {"nan", "none", ""}]
        categories = sorted(categories)
        mapping = {value: idx for idx, value in enumerate(categories[:2])}
        return lowered.map(mapping).fillna(0).astype(int)

    def _fill_missing(self, column: str, series: pd.Series, strategy: str, detected_type: str) -> Tuple[pd.Series, List[Dict[str, Any]]]:
        plan: List[Dict[str, Any]] = []
        value = _txt(strategy or "leave")
        if value == "leave":
            return series, plan
        if value == "missing_flag":
            flag_name = f"{column}__missing_flag"
            filled = series.copy()
            if detected_type == "numerical":
                numeric = pd.to_numeric(series, errors="coerce")
                baseline = numeric.median()
                baseline = 0.0 if pd.isna(baseline) else float(baseline)
                filled = numeric.fillna(baseline)
            else:
                filled = series.fillna("missing")
            plan.append({"column": column, "action": "missing_flag", "created_columns": [flag_name]})
            return filled, plan
        if value == "constant":
            fill_value = 0.0 if detected_type == "numerical" else "missing"
            return series.fillna(fill_value), [{"column": column, "action": f"fillna(constant={fill_value})"}]
        if value in {"median", "mean"} and detected_type == "numerical":
            numeric = pd.to_numeric(series, errors="coerce")
            fill_value = float(numeric.median()) if value == "median" else float(numeric.mean())
            if pd.isna(fill_value):
                fill_value = 0.0
            return numeric.fillna(fill_value), [{"column": column, "action": f"fillna({value})"}]
        mode = series.mode(dropna=True)
        fill_value = mode.iloc[0] if not mode.empty else ("missing" if detected_type != "numerical" else 0.0)
        return series.fillna(fill_value), [{"column": column, "action": "fillna(mode)"}]

    def _scale_numeric(self, column: str, series: pd.Series, scaling: str) -> Tuple[pd.Series, Optional[Dict[str, Any]]]:
        value = _txt(scaling or "none")
        numeric = _analysis_numeric_series(series, default=np.nan)
        if value == "none" or numeric.notna().mean() <= 0:
            return numeric, None
        filled = numeric.fillna(numeric.median() if numeric.notna().any() else 0.0)
        if value == "log":
            return np.log1p(filled.clip(lower=0)), {"column": column, "action": "log1p"}
        if value == "standard":
            std = float(filled.std())
            if std <= 1e-12:
                return filled * 0, {"column": column, "action": "standard_scale"}
            return (filled - float(filled.mean())) / std, {"column": column, "action": "standard_scale"}
        if value == "minmax":
            min_value = float(filled.min())
            max_value = float(filled.max())
            if abs(max_value - min_value) <= 1e-12:
                return filled * 0, {"column": column, "action": "minmax_scale"}
            return (filled - min_value) / (max_value - min_value), {"column": column, "action": "minmax_scale"}
        if value == "robust":
            median = float(filled.median())
            q1 = float(filled.quantile(0.25))
            q3 = float(filled.quantile(0.75))
            iqr = q3 - q1
            if abs(iqr) <= 1e-12:
                return filled - median, {"column": column, "action": "robust_scale"}
            return (filled - median) / iqr, {"column": column, "action": "robust_scale"}
        if value == "winsorize":
            lower = float(filled.quantile(0.01))
            upper = float(filled.quantile(0.99))
            return filled.clip(lower=lower, upper=upper), {"column": column, "action": "winsorize_1_99"}
        return numeric, None

    def apply(self, frame: pd.DataFrame, transform_config: Dict[str, Any]) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
        if frame is None or frame.empty:
            return pd.DataFrame(), []
        transformed = frame.copy()
        plan: List[Dict[str, Any]] = []
        profiles = self._build_profiles(frame, transform_config)
        column_settings = transform_config.get("column_settings") or {}
        for profile in profiles:
            column = profile["column_name"]
            if column not in transformed.columns:
                continue
            settings = column_settings.get(column) or {}
            include = settings.get("include", True)
            detected_type = _txt(profile.get("detected_type"))
            selected_encoding = _txt(profile.get("selected_encoding") or "none")
            missing_strategy = _txt(profile.get("missing_strategy") or "leave")
            selected_scaling = _txt(profile.get("selected_scaling") or "none")
            series = transformed[column]

            if include is False:
                transformed = transformed.drop(columns=[column])
                plan.append({"column": column, "action": "exclude from downstream"})
                continue

            series, missing_plan = self._fill_missing(column, series, missing_strategy, detected_type)
            for item in missing_plan:
                if item.get("action") == "missing_flag":
                    transformed[item["created_columns"][0]] = transformed[column].isna().astype(int)
            transformed[column] = series
            plan.extend(missing_plan)

            if detected_type == "numerical":
                transformed[column] = pd.to_numeric(transformed[column], errors="coerce")

            if selected_encoding in {"frequency", "target_safe"} and detected_type == "categorical":
                encoded = transformed[column].fillna("missing").astype(str)
                counts = encoded.value_counts(dropna=False)
                transformed[column] = encoded.map(counts).astype(float)
                plan.append({"column": column, "action": "frequency_encode"})
            elif selected_encoding == "ordinal" and detected_type == "categorical":
                transformed[column] = pd.Categorical(transformed[column].fillna("missing").astype(str)).codes.astype(float)
                plan.append({"column": column, "action": "ordinal_encode"})
            elif selected_encoding == "binary" and detected_type in {"categorical", "boolean"}:
                transformed[column] = self._binary_encode(transformed[column])
                plan.append({"column": column, "action": "binary_encode"})
            elif selected_encoding == "one_hot" and detected_type == "categorical":
                encoded = transformed[column].fillna("missing").astype(str)
                dummies = pd.get_dummies(encoded, prefix=column, prefix_sep="__", dtype=int)
                transformed = pd.concat([transformed.drop(columns=[column]), dummies], axis=1)
                plan.append({"column": column, "action": "one_hot_encode", "created_columns": list(dummies.columns[:12])})
                continue

            if column in transformed.columns and _is_numeric_like(transformed[column]):
                scaled, scaling_plan = self._scale_numeric(column, transformed[column], selected_scaling)
                transformed[column] = scaled
                if scaling_plan:
                    plan.append(scaling_plan)

        return transformed, plan

    def preview(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
        if not dataset_meta:
            return {"sample_rows": [], "transform_plan": [], "message": "Feature Store output is not ready."}
        frame = _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root()))
        transform_config = self._current_transform(current["config"])
        transformed, plan = self.apply(frame, transform_config) if self.has_saved_transform(transform_config) else (frame.copy(), [])
        return {
            "sample_rows": _records(transformed, limit=12),
            "transform_plan": plan[:120],
            "column_count": int(transformed.shape[1]) if transformed is not None else 0,
        }


class MulePreprocessingFeatureBuilderService:
    def __init__(self, base: MulePreprocessingService):
        self.base = base

    def _default_config(self) -> Dict[str, Any]:
        return {"selected_builtin_features": [item["feature_name"] for item in BUILTIN_ENGINEERED_FEATURES], "custom_features": []}

    def _current(self, config: Dict[str, Any]) -> Dict[str, Any]:
        current = config.get("feature_builder")
        return current if isinstance(current, dict) else self._default_config()

    def _base_frame(self, tenant_id: str, env_id: str, pipeline_id: int) -> pd.DataFrame:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
        return _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root())) if dataset_meta else pd.DataFrame()

    def _apply_builtin(self, frame: pd.DataFrame, selected: Iterable[str]) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
        df = frame.copy()
        created = []
        selected_set = set(selected or [])
        numeric = lambda name, fallback=0: pd.to_numeric(df[name], errors="coerce") if name in df.columns else pd.Series([fallback] * len(df), index=df.index)
        for item in BUILTIN_ENGINEERED_FEATURES:
            name = item["feature_name"]
            if name not in selected_set:
                continue
            if name == "velocity_flag":
                base = numeric("txn_count", 0).fillna(0)
                thresh = base.quantile(0.9) if len(base) else 0
                df[name] = (base >= thresh).astype(int)
            elif name == "fanout_flag":
                base = numeric("counterparty_count", 0).fillna(0)
                thresh = base.quantile(0.9) if len(base) else 0
                df[name] = (base >= thresh).astype(int)
            elif name == "sequence_score":
                a = numeric("txn_count", 0).fillna(0)
                b = numeric("txn_amount_std", 0).fillna(0)
                df[name] = ((a.rank(pct=True) + b.rank(pct=True)) / 2).round(4)
            elif name == "shared_device_risk":
                df[name] = (numeric("device_signal_count", 0).fillna(0) * numeric("device_signal_risk_score_mean", 0).fillna(0)).round(4)
            elif name == "shared_ip_risk":
                df[name] = numeric("device_signal_risk_score_mean", 0).fillna(0).round(4)
            elif name == "dormant_activation_flag":
                df[name] = (numeric("txn_count", 0).fillna(0) > 0).astype(int)
            elif name == "graph_pagerank":
                df[name] = ((numeric("network_degree_max", 0).fillna(0) * 0.6) + (numeric("network_degree_sum", 0).fillna(0) * 0.4)).round(4)
            elif name == "graph_clustering":
                denom = numeric("network_degree_sum", 0).fillna(0).replace(0, np.nan)
                df[name] = (numeric("counterparty_count", 0).fillna(0) / denom).fillna(0).clip(0, 1).round(4)
            elif name == "cycle_flag":
                base = numeric("network_degree_sum", 0).fillna(0)
                df[name] = (base >= base.quantile(0.85)).astype(int)
            elif name == "ring_count":
                df[name] = np.maximum(np.round(numeric("network_degree_sum", 0).fillna(0) / 3), 0)
            elif name == "ring_max_risk_score":
                df[name] = np.maximum(numeric("device_signal_risk_score_mean", 0).fillna(0), numeric("external_signal_risk_score_max", 0).fillna(0) / 5.0).round(4)
            elif name == "ring_max_member_count":
                df[name] = np.maximum(numeric("network_degree_sum", 0).fillna(0), numeric("counterparty_count", 0).fillna(0))
            created.append({**item, "created_successfully": name in df.columns})
        return df, created

    def _apply_custom(self, frame: pd.DataFrame, custom_features: Iterable[Dict[str, Any]]) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
        df = frame.copy()
        results = []
        for item in custom_features or []:
            feature_name = _txt(item.get("feature_name"))
            formula = _txt(item.get("formula"))
            if not feature_name or not formula:
                continue
            valid, message = _validate_formula_expression(formula, df.columns)
            success = False
            if valid:
                try:
                    df[feature_name] = df.eval(formula)
                    success = True
                except Exception as exc:
                    message = str(exc)
            results.append({"feature_name": feature_name, "feature_family": _txt(item.get("feature_family") or "custom"), "source_columns": item.get("source_columns") or sorted(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", formula)), "logic": _txt(item.get("logic") or formula), "formula": formula, "business_meaning": _txt(item.get("business_meaning") or "Custom engineered feature."), "created_successfully": success, "validation_message": message})
        return df, results

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        config = self._current(current["config"])
        preview_df, builtin_preview = self._apply_builtin(self._base_frame(tenant_id, env_id, pipeline_id), config.get("selected_builtin_features") or [])
        preview_df, custom_preview = self._apply_custom(preview_df, config.get("custom_features") or [])
        return {"pipeline_id": int(pipeline_id), "feature_builder": config, "builtin_features": [{**item, "selected": item["feature_name"] in set(config.get("selected_builtin_features") or [])} for item in BUILTIN_ENGINEERED_FEATURES], "custom_features": custom_preview if custom_preview else config.get("custom_features") or [], "lineage_preview": builtin_preview + custom_preview, "sample_rows": _records(preview_df, limit=12)}

    def save(self, tenant_id: str, env_id: str, pipeline_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        existing = self._current(current["config"])
        merged = {**existing, **(patch or {})}
        self.base.save_config(tenant_id, env_id, pipeline_id, {"feature_builder": merged, "workspace_stage": "feature_builder"})
        return self.get_payload(tenant_id, env_id, pipeline_id)

    def validate_custom_feature(self, tenant_id: str, env_id: str, pipeline_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        frame = self._base_frame(tenant_id, env_id, pipeline_id)
        valid, message = _validate_formula_expression(payload.get("formula"), frame.columns)
        sample = []
        if valid:
            sample_df, preview = self._apply_custom(frame.head(50), [payload])
            if payload.get("feature_name") in sample_df.columns:
                sample = _records(sample_df[[payload.get("feature_name")]], limit=10)
            if preview and not preview[0]["created_successfully"]:
                valid = False
                message = preview[0].get("validation_message") or "Custom feature validation failed."
        return {"valid": valid, "message": message, "sample_rows": sample}

class MulePreprocessingFeatureSelectionService:
    def __init__(self, base: MulePreprocessingService, builder: MulePreprocessingFeatureBuilderService, transform: MulePreprocessingTransformService):
        self.base = base
        self.builder = builder
        self.transform = transform

    def _current(self, config: Dict[str, Any], all_columns: Optional[List[str]] = None) -> Dict[str, Any]:
        current = config.get("feature_selection")
        if isinstance(current, dict):
            return current
        return {"methods": {"correlation_filter": True, "variance_threshold": True, "missingness_threshold": True, "redundancy_filter": True, "random_forest_importance": True}, "protected_features": [], "mandatory_retain": [], "selected_features": list(all_columns or []), "dropped_features": []}

    def _method_catalog(self, methods: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        effective = methods if isinstance(methods, dict) else {}
        return [
            {
                "id": key,
                "label": meta["label"],
                "description": meta["description"],
                "enabled": bool(effective.get(key, False)),
            }
            for key, meta in SELECTION_METHOD_METADATA.items()
        ]

    def _base_input_columns(self, tenant_id: str, env_id: str, pipeline_id: int) -> List[str]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
        if not dataset_meta:
            return []
        frame = _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root()))
        return list(frame.columns)

    def _prepared_frame(self, tenant_id: str, env_id: str, pipeline_id: int) -> pd.DataFrame:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
        if not dataset_meta:
            return pd.DataFrame()
        frame = _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root()))
        joined = self.base._join_labels(frame, tenant_id, env_id, pipeline_id)["frame"]
        builder_payload = self.builder.get_payload(tenant_id, env_id, pipeline_id)
        config = builder_payload["feature_builder"]
        joined, _ = self.builder._apply_builtin(joined, config.get("selected_builtin_features") or [])
        joined, _ = self.builder._apply_custom(joined, config.get("custom_features") or [])
        transform_config = self.transform._current_transform(current["config"])
        if self.transform.has_saved_transform(transform_config):
            joined, _ = self.transform.apply(joined, transform_config)
            return joined
        return self.base._apply_controls(joined, current["config"])

    def analyze(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        frame = self._prepared_frame(tenant_id, env_id, pipeline_id)
        if frame.empty:
            selection_config = self._current(current["config"], all_columns=[])
            return {"candidate_features": [], "selected_features": [], "dropped_features": [], "family_summary": [], "selection_config": selection_config, "method_catalog": self._method_catalog(selection_config.get("methods"))}
        target_col = "mule_flag" if "mule_flag" in frame.columns else None
        numeric_cols = [
            col for col in _numeric_columns(frame)
            if col not in {"mule_flag"} and _column_role(col, frame[col]) not in {"identifier", "target"}
        ]
        selection_config = self._current(current["config"], all_columns=numeric_cols)
        protected = set(selection_config.get("protected_features") or [])
        mandatory = set(selection_config.get("mandatory_retain") or [])
        selected, dropped, candidates = [], [], []
        correlations = {}
        if target_col and numeric_cols:
            target_series = _analysis_numeric_series(frame[target_col], default=0.0)
            for col in numeric_cols:
                try:
                    feature_series = _analysis_numeric_series(frame[col], default=0.0)
                    correlations[col] = abs(float(feature_series.corr(target_series)))
                except Exception:
                    correlations[col] = 0.0
        model_scores = {}
        if target_col and numeric_cols and RandomForestClassifier is not None:
            try:
                model = RandomForestClassifier(n_estimators=80, random_state=42, class_weight="balanced")
                x = pd.DataFrame({
                    col: _analysis_numeric_series(frame[col], default=0.0)
                    for col in numeric_cols
                }, index=frame.index).fillna(0.0)
                y = _analysis_numeric_series(frame[target_col], default=0.0).astype(int)
                model.fit(x, y)
                model_scores = {col: float(score) for col, score in zip(numeric_cols, model.feature_importances_)}
            except Exception:
                model_scores = {}
        input_columns = set(self._base_input_columns(tenant_id, env_id, pipeline_id))
        for col in numeric_cols:
            try:
                series = _analysis_numeric_series(frame[col], default=np.nan)
                missing_pct = float(series.isna().mean() * 100.0)
                variance = float(series.fillna(0).var())
                corr = float(correlations.get(col, 0.0))
                model_score = float(model_scores.get(col, 0.0))
                family = _feature_family_from_name(col)
                reasons = []
                keep = True
                if missing_pct > 65:
                    keep = False
                    reasons.append("High missingness")
                if variance <= 1e-8:
                    keep = False
                    reasons.append("Near-zero variance")
                if corr < 0.01 and model_score < 0.005 and not _protected_feature(col):
                    keep = False
                    reasons.append("Low statistical and model signal")
                if _protected_feature(col) or col in protected or col in mandatory:
                    keep = True
                    reasons.append("Protected AML feature")
                origin = "feature_store" if col in input_columns else "engineered"
                record = {
                    "feature_name": col,
                    "family": family,
                    "missing_pct": round(missing_pct, 2),
                    "variance": round(variance, 6),
                    "correlation_score": round(corr, 6),
                    "model_score": round(model_score, 6),
                    "protected": _protected_feature(col) or col in protected or col in mandatory,
                    "business_reason": "Retained because it captures mule behaviour." if keep else "Dropped because it adds little signal or too much instability.",
                    "technical_reason": ", ".join(reasons) if reasons else "Retained by default.",
                    "origin": origin,
                    "source_type": origin,
                    "source_tag": "Feature Store" if origin == "feature_store" else "Engineered",
                    "selected_in_feature_store": bool(col in input_columns),
                    "selected": keep,
                    "decision": "selected" if keep else "dropped",
                    "reason": ", ".join(reasons) if reasons else ("Retained by default." if keep else "Dropped by selection logic."),
                }
                candidates.append(record)
                if keep:
                    selected.append(col)
                else:
                    dropped.append({
                        "feature": col,
                        "reason": record["technical_reason"],
                        "family": family,
                        "origin": origin,
                        "source_tag": record["source_tag"],
                    })
            except Exception as exc:
                dropped.append({"feature": col, "reason": f"Selection analysis error: {exc}"})
        family_summary = {}
        for item in candidates:
            fam = item["family"]
            family_summary.setdefault(fam, {"family": fam, "candidate_count": 0, "selected_count": 0})
            family_summary[fam]["candidate_count"] += 1
            if item["feature_name"] in selected:
                family_summary[fam]["selected_count"] += 1
        return {
            "candidate_features": candidates,
            "selected_features": selected,
            "dropped_features": dropped,
            "family_summary": list(family_summary.values()),
            "selection_config": selection_config,
            "method_catalog": self._method_catalog(selection_config.get("methods")),
            "input_feature_count": len(input_columns),
        }

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        def fallback_payload(warning_text: Optional[str] = None) -> Dict[str, Any]:
            base_columns = self._base_input_columns(tenant_id, env_id, pipeline_id)
            fallback_candidates = [
                {
                    "feature_name": column,
                    "family": _feature_family_from_name(column),
                    "missing_pct": 0.0,
                    "variance": 0.0,
                    "correlation_score": 0.0,
                    "model_score": 0.0,
                    "protected": _protected_feature(column),
                    "business_reason": "Visible from the persisted Feature Store selection. Statistical selection analysis is temporarily unavailable.",
                    "technical_reason": _txt(warning_text) or "Selection analysis fallback path active.",
                    "origin": "feature_store",
                    "source_tag": "Feature Store",
                    "selected_in_feature_store": True,
                    "selected": True,
                    "decision": "selected",
                    "reason": _txt(warning_text) or "Selection analysis fallback path active.",
                }
                for column in base_columns
                if _column_role(column) not in {"identifier", "target", "datetime"}
            ]
            selection_config = self._current(current["config"], all_columns=[item["feature_name"] for item in fallback_candidates])
            selected = selection_config.get("selected_features") or [item["feature_name"] for item in fallback_candidates]
            selected_set = set(selected)
            dropped = selection_config.get("dropped_features") or []
            if not dropped:
                dropped = [
                    {
                        "feature": item["feature_name"],
                        "reason": "Not included in selected feature set.",
                        "family": item.get("family"),
                        "origin": item.get("origin"),
                        "source_tag": item.get("source_tag"),
                    }
                    for item in fallback_candidates
                    if item["feature_name"] not in selected_set
                ]
            merged = [
                {
                    **item,
                    "selected": item["feature_name"] in selected_set,
                    "decision": "selected" if item["feature_name"] in selected_set else "dropped",
                }
                for item in fallback_candidates
            ]
            return {
                "candidate_features": merged,
                "selected_features": [item["feature_name"] for item in merged if item.get("selected")],
                "dropped_features": dropped,
                "family_summary": [],
                "selection_config": {**selection_config, "selected_features": [item["feature_name"] for item in merged if item.get("selected")], "dropped_features": dropped},
                "method_catalog": self._method_catalog(selection_config.get("methods")),
                "input_feature_count": len(base_columns),
                **({"warning": _txt(warning_text)} if _txt(warning_text) else {}),
            }
        try:
            analysis = self.analyze(tenant_id, env_id, pipeline_id)
        except Exception as exc:
            return fallback_payload(f"Selection analysis fallback: {exc}")
        selection_config = self._current(current["config"], all_columns=analysis.get("selected_features") or [])
        candidate_rows = analysis.get("candidate_features") or []
        if not candidate_rows:
            return fallback_payload("Selection analysis returned no candidate rows; using persisted Feature Store fallback.")
        candidate_lookup = {item.get("feature_name") for item in candidate_rows}
        candidate_map = {
            _txt(item.get("feature_name")): item
            for item in candidate_rows
            if _txt(item.get("feature_name"))
        }
        if selection_config.get("selected_features"):
            selected = [feature for feature in (selection_config.get("selected_features") or []) if feature in candidate_lookup]
            if not selected and selection_config.get("selected_features"):
                selected = [feature for feature in (analysis.get("selected_features") or []) if feature in candidate_lookup] or list(analysis.get("selected_features") or [])
            dropped = [
                item for item in (selection_config.get("dropped_features") or [])
                if _txt(item.get("feature") if isinstance(item, dict) else item) in candidate_lookup
            ]
            if not dropped:
                selected_set = set(selected)
                dropped = []
                for feature_name, candidate in candidate_map.items():
                    if feature_name in selected_set:
                        continue
                    dropped.append({
                        "feature": feature_name,
                        "reason": _txt(candidate.get("technical_reason") or candidate.get("reason") or "Not included in final selected feature set."),
                        "family": candidate.get("family"),
                        "origin": candidate.get("origin"),
                        "source_tag": candidate.get("source_tag"),
                    })
        else:
            selected = analysis["selected_features"]
            dropped = analysis["dropped_features"]
        selected_set = set(selected)
        dropped_lookup = {
            _txt(item.get("feature") if isinstance(item, dict) else item): item
            for item in dropped
        }
        merged_candidates = []
        for item in candidate_rows:
            feature_name = _txt(item.get("feature_name"))
            is_selected = feature_name in selected_set
            drop_meta = dropped_lookup.get(feature_name)
            merged_candidates.append({
                **item,
                "selected": is_selected,
                "decision": "selected" if is_selected else "dropped",
                "reason": _txt(
                    item.get("technical_reason")
                    or (drop_meta.get("reason") if isinstance(drop_meta, dict) else "")
                    or item.get("reason")
                ),
            })
        return {
            **analysis,
            "candidate_features": merged_candidates,
            "selection_config": {**selection_config, "selected_features": selected, "dropped_features": dropped},
            "selected_features": selected,
            "dropped_features": dropped,
            "method_catalog": self._method_catalog(selection_config.get("methods")),
        }

    def save(self, tenant_id: str, env_id: str, pipeline_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        analysis = self.get_payload(tenant_id, env_id, pipeline_id)
        existing = analysis["selection_config"]
        merged = {**existing, **(patch or {})}
        if isinstance(existing.get("methods"), dict) and isinstance((patch or {}).get("methods"), dict):
            merged["methods"] = {**existing["methods"], **patch["methods"]}
        self.base.save_config(tenant_id, env_id, pipeline_id, {"feature_selection": merged, "workspace_stage": "feature_selection"})
        return self.get_payload(tenant_id, env_id, pipeline_id)


class MulePreprocessingPipelineRunService:
    _locks: Dict[int, threading.Lock] = {}

    def __init__(self, base: MulePreprocessingService, builder: MulePreprocessingFeatureBuilderService, selection: MulePreprocessingFeatureSelectionService, transform: MulePreprocessingTransformService):
        self.base = base
        self.builder = builder
        self.selection = selection
        self.transform = transform

    def _job_id(self, pipeline_id: int) -> str:
        return f"{WORKBENCH_JOB_PREFIX}-{int(pipeline_id)}"

    def _timeline(self, steps: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [{"step": item["step"], "status": item["status"], "detail": item.get("detail"), "progress_pct": item.get("progress_pct")} for item in steps]

    def _update_job(self, pipeline_id: int, status: str, progress: float, logs: Dict[str, Any]) -> None:
        self.base.workspace.upsert_job(self._job_id(pipeline_id), int(pipeline_id), STAGE_NAME, WORKBENCH_JOB_TYPE, status, progress_pct=progress, logs=logs)

    def _build_output(self, tenant_id: str, env_id: str, pipeline_id: int, job_id: str) -> Dict[str, Any]:
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        dataset_meta = self.base._resolve_input_dataset(tenant_id, env_id, pipeline_id, current["config"])
        if not dataset_meta:
            raise ValueError("Feature Store output is not ready for preprocessing.")
        steps = []
        def mark(step: str, status: str, progress: float, detail: str) -> None:
            for item in steps:
                if item["step"] == step:
                    item["status"] = status
                    item["detail"] = detail
                    item["progress_pct"] = progress
                    break
            else:
                steps.append({"step": step, "status": status, "detail": detail, "progress_pct": progress})
            self._update_job(pipeline_id, "in_progress" if status != "failed" else "failed", progress, {"current_task": detail, "current_step": step, "current_step_index": len(steps), "total_steps": 6, "heartbeat_ts": pd.Timestamp.utcnow().isoformat(), "timeline": self._timeline(steps)})

        self.base._workspace_mark(tenant_id, pipeline_id, "in_progress", "pipeline_run", summary={"build_status": "running", "workspace_stage": "pipeline_run"}, current_stage=STAGE_NAME, current_substage="pipeline_run")
        mark("EDA", "running", 10.0, "Profiling feature-store dataset")
        frame = _load_frame(resolve_data_file_path(dataset_meta["file_path"], env_root=self.base._env_root()))
        joined = self.base._join_labels(frame, tenant_id, env_id, pipeline_id)["frame"]
        mark("EDA", "completed", 16.0, "Dataset profile complete")
        mark("Feature engineering", "running", 28.0, "Applying engineered Mule features")
        builder_payload = self.builder.get_payload(tenant_id, env_id, pipeline_id)
        builder_config = builder_payload["feature_builder"]
        joined, _ = self.builder._apply_builtin(joined, builder_config.get("selected_builtin_features") or [])
        joined, custom_preview = self.builder._apply_custom(joined, builder_config.get("custom_features") or [])
        mark("Feature engineering", "completed", 40.0, f"Applied {len(builder_payload['builtin_features'])} builtin and {len(custom_preview)} custom engineered features")
        mark("Graph analytics", "running", 52.0, "Applying graph and network feature derivations")
        graph_pagerank = _numeric_series_or_default(joined, "graph_pagerank")
        graph_degree = _numeric_series_or_default(joined, "graph_degree")
        joined["graph_signal_proxy"] = (graph_pagerank + graph_degree).round(4)
        mark("Graph analytics", "completed", 60.0, "Graph feature enrichment complete")
        mark("Ring detection", "running", 68.0, "Applying ring and shared-entity indicators")
        if "ring_count" not in joined.columns:
            network_degree_sum = _numeric_series_or_default(joined, "network_degree_sum")
            joined["ring_count"] = np.maximum(np.round(network_degree_sum / 3), 0)
        if "ring_max_risk_score" not in joined.columns:
            device_signal_risk = _numeric_series_or_default(joined, "device_signal_risk_score_mean")
            external_signal_risk = _numeric_series_or_default(joined, "external_signal_risk_score_max")
            joined["ring_max_risk_score"] = np.maximum(device_signal_risk, external_signal_risk / 5.0).round(4)
        mark("Ring detection", "completed", 76.0, "Ring feature derivation complete")
        mark("Transform", "running", 84.0, "Applying deterministic preprocessing controls")
        transform_config = self.transform._current_transform(current["config"])
        if self.transform.has_saved_transform(transform_config):
            transformed, transform_plan = self.transform.apply(joined, transform_config)
            mark("Transform", "completed", 90.0, f"Transform controls complete ({len(transform_plan)} actions)")
        else:
            transformed = self.base._apply_controls(joined, current["config"])
            mark("Transform", "completed", 90.0, "Transform controls complete")
        mark("Feature selection", "running", 94.0, "Applying final selected feature set")
        selection_payload = self.selection.get_payload(tenant_id, env_id, pipeline_id)
        selected_features = selection_payload.get("selected_features") or []
        identifier_columns = [col for col in transformed.columns if _column_role(col, transformed[col]) == "identifier"]
        trace_columns = set(identifier_columns + [col for col in {"mule_flag", "mule_typology"} if col in transformed.columns])
        keep = [col for col in transformed.columns if col in selected_features or col in trace_columns]
        final_df = transformed[keep].copy() if keep else transformed.copy()
        mark("Feature selection", "completed", 98.0, f"Selected {len(selected_features)} model-ready features")
        output_table = _txt(current["config"].get("output_table_name") or f"mule_feature_studio_{int(pipeline_id)}")
        output_path = (resolve_mlops_data_dir(self.base._env_root(), create_if_missing=True) / "mule_preprocessing") / f"{output_table}.csv"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        final_df.to_csv(output_path, index=False)
        with get_connection(self.base.db_path) as conn:
            conn.register("__mule_preprocess_df", final_df)
            conn.execute(f'CREATE OR REPLACE TABLE "{output_table}" AS SELECT * FROM __mule_preprocess_df')
            try:
                conn.unregister("__mule_preprocess_df")
            except Exception:
                pass
            run_id = int(conn.execute("SELECT COALESCE(MAX(run_id), 0) + 1 FROM mule_preprocessing_runs").fetchone()[0] or 1)
            run_summary = {"output_table_name": output_table, "row_count": int(final_df.shape[0]), "column_count": int(final_df.shape[1]), "selected_features": selected_features}
            conn.execute("INSERT INTO mule_preprocessing_runs (run_id, pipeline_id, output_table_name, row_count, column_count, run_summary_json) VALUES (?, ?, ?, ?, ?, ?)", [run_id, int(pipeline_id), output_table, int(final_df.shape[0]), int(final_df.shape[1]), json.dumps(run_summary, default=str)])
            dataset_id = int(conn.execute("SELECT COALESCE(MAX(dataset_id), 0) + 1 FROM mlops_dataset_registry").fetchone()[0] or 1)
            conn.execute("""
                INSERT INTO mlops_dataset_registry (
                  dataset_id, tenant_id, env_id, pipeline_id, pipeline_type, dataset_type, filename,
                  file_path, row_count, columns_json, column_types_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, [dataset_id, tenant_id, env_id, int(pipeline_id), "mule", "preprocess_dataset", output_path.name, str(output_path), int(final_df.shape[0]), json.dumps(list(final_df.columns), default=str), json.dumps({col: str(dtype) for col, dtype in final_df.dtypes.items()}, default=str)])
            conn.execute("UPDATE mule_preprocessing_config SET build_status = 'built', feature_count_estimate = ?, warnings_json = ?, updated_at = CURRENT_TIMESTAMP WHERE pipeline_id = ?", [int(len(selected_features)), json.dumps([], default=str), int(pipeline_id)])
            self.base.workspace.register_artifact(int(pipeline_id), STAGE_NAME, "preprocess_dataset_csv", str(output_path), metadata={"dataset_id": int(dataset_id), "run_id": int(run_id), "row_count": int(final_df.shape[0]), "column_count": int(final_df.shape[1])}, conn=conn)
            self.base.workspace.set_stage_state(int(pipeline_id), STAGE_NAME, "completed", substage="summary", summary={"build_status": "built", "workspace_stage": "summary", "dataset_id": int(dataset_id), "run_id": int(run_id), "selected_features": len(selected_features)}, error={}, conn=conn)
            self.base.workspace.update_run(int(pipeline_id), status="in_progress", current_stage="model_build", current_substage="configure", conn=conn)
        self.base.workspace.upsert_job(job_id, int(pipeline_id), STAGE_NAME, WORKBENCH_JOB_TYPE, "completed", progress_pct=100.0, logs={"current_task": "Preprocessing pipeline complete", "current_step": "Completed", "current_step_index": 6, "total_steps": 6, "heartbeat_ts": pd.Timestamp.utcnow().isoformat(), "timeline": self._timeline(steps + [{"step": "Persist output", "status": "completed", "detail": "Preprocessing output persisted", "progress_pct": 100.0}]), "records_total": int(final_df.shape[0]), "records_processed": int(final_df.shape[0]), "dataset_id": int(dataset_id), "run_id": int(run_id)})
        return {"pipeline_id": int(pipeline_id), "dataset_id": int(dataset_id), "run_id": int(run_id), "row_count": int(final_df.shape[0]), "column_count": int(final_df.shape[1]), "output_table_name": output_table}

    def _execute_background(self, tenant_id: str, env_id: str, pipeline_id: int) -> None:
        job_id = self._job_id(pipeline_id)
        lock = self._locks.setdefault(int(pipeline_id), threading.Lock())
        if not lock.acquire(blocking=False):
            return
        try:
            self._build_output(tenant_id, env_id, pipeline_id, job_id)
        except Exception as exc:
            self.base.workspace.upsert_job(job_id, int(pipeline_id), STAGE_NAME, WORKBENCH_JOB_TYPE, "failed", progress_pct=100.0, logs={"current_task": "Preprocessing pipeline failed", "message": str(exc), "heartbeat_ts": pd.Timestamp.utcnow().isoformat()})
            self.base._workspace_mark(tenant_id, pipeline_id, "failed", "pipeline_run", summary={"build_status": "failed", "workspace_stage": "pipeline_run"}, error={"message": str(exc)}, current_stage=STAGE_NAME, current_substage="pipeline_run")
        finally:
            lock.release()

    def get_status(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        base_status = self.base.status(tenant_id, env_id, pipeline_id)
        workspace = self.base.workspace.get_workspace_snapshot(int(pipeline_id))
        latest_job = workspace.get("latest_job") if isinstance(workspace, dict) else None
        if latest_job and _txt(latest_job.get("job_type")) != WORKBENCH_JOB_TYPE:
            latest_job = None
        return {"pipeline_id": int(pipeline_id), "latest_job": latest_job, "latest_run": base_status.get("latest_run"), "recent_runs": base_status.get("recent_runs") or [], "build_status": base_status.get("build_status")}

    def start(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        job_id = self._job_id(pipeline_id)
        self.base.workspace.upsert_job(job_id, int(pipeline_id), STAGE_NAME, WORKBENCH_JOB_TYPE, "queued", progress_pct=0.0, logs={"current_task": "Queued preprocessing pipeline", "heartbeat_ts": pd.Timestamp.utcnow().isoformat(), "timeline": []})
        thread = threading.Thread(target=self._execute_background, args=(tenant_id, env_id, int(pipeline_id)), daemon=True)
        thread.start()
        return self.get_status(tenant_id, env_id, pipeline_id)

    def retry(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        return self.start(tenant_id, env_id, pipeline_id)

    def cancel(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        job_id = self._job_id(pipeline_id)
        self.base.workspace.upsert_job(job_id, int(pipeline_id), STAGE_NAME, WORKBENCH_JOB_TYPE, "stale", progress_pct=0.0, logs={"current_task": "Cancellation requested", "heartbeat_ts": pd.Timestamp.utcnow().isoformat()})
        return self.get_status(tenant_id, env_id, pipeline_id)


class MulePreprocessingSummaryService:
    def __init__(self, base: MulePreprocessingService, selection: MulePreprocessingFeatureSelectionService):
        self.base = base
        self.selection = selection

    def get_payload(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        status = self.base.status(tenant_id, env_id, pipeline_id)
        selection_payload = self.selection.get_payload(tenant_id, env_id, pipeline_id)
        current = self.base.load_config(tenant_id, env_id, pipeline_id)
        workspace = self.base.workspace.get_workspace_snapshot(int(pipeline_id))
        return {"pipeline_id": int(pipeline_id), "latest_run": status.get("latest_run"), "artifacts": workspace.get("artifacts", []) if isinstance(workspace, dict) else [], "selected_features": selection_payload.get("selected_features") or [], "dropped_features": selection_payload.get("dropped_features") or [], "transformations_applied": current["config"].get("transform_workbench") or {}, "engineered_features_added": current["config"].get("feature_builder", {}).get("selected_builtin_features", []), "feature_count": len(selection_payload.get("selected_features") or []), "traceability": {"build_status": status.get("build_status"), "target_validation": status.get("target_validation") or {}, "warnings": status.get("warnings") or []}, "downstream_compatibility": {"supervised": True, "unsupervised": True, "graph_based": True, "notes": "Selected features include governed numeric and graph/ring indicators suitable for Mule model build tracks."}}


class MulePreprocessingWorkbenchService:
    def __init__(self, db_path: Path):
        self.base = MulePreprocessingService(db_path)
        self.overview = MulePreprocessingOverviewService(self.base)
        self.transform = MulePreprocessingTransformService(self.base)
        self.builder = MulePreprocessingFeatureBuilderService(self.base)
        self.selection = MulePreprocessingFeatureSelectionService(self.base, self.builder, self.transform)
        self.pipeline_run = MulePreprocessingPipelineRunService(self.base, self.builder, self.selection, self.transform)
        self.summary = MulePreprocessingSummaryService(self.base, self.selection)
