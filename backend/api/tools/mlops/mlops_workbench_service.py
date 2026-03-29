from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import json
import uuid
import threading
import pickle
import logging
from datetime import datetime
from contextlib import nullcontext

import duckdb
import numpy as np
import pandas as pd
from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.path_utils import resolve_data_file_path
from api.tools.mlops.sklearn_pickle_compat import load_pickle_compat

logger = logging.getLogger(__name__)


def _safe_json_loads(raw: Any, fallback: Any):
    if raw in (None, ""):
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_optional_text(value: Any) -> Optional[str]:
    text = _normalize_text(value)
    return text or None


def _json_safe_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _json_safe_value(val) for key, val in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe_value(item) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, np.generic):
        try:
            value = value.item()
        except Exception:
            value = str(value)
    if isinstance(value, (pd.Timestamp, datetime)):
        try:
            return "" if pd.isna(value) else value.isoformat()
        except Exception:
            return str(value)
    try:
        if pd.isna(value):
            return ""
    except Exception:
        pass
    return value


def _merge_state_dicts(base: Any, patch: Any) -> Any:
    if not isinstance(base, dict) or not isinstance(patch, dict):
        return patch if patch is not None else base
    merged = dict(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_state_dicts(merged.get(key), value)
        else:
            merged[key] = value
    return merged


# High-cardinality event datasets should be aggregated before entity-key joins
# to prevent 1:many fan-out in master build.
_HIGH_CARDINALITY_EVENT_TYPES = frozenset({
    "transactions", "transaction", "txns", "txn",
    "events", "event", "activity", "activities",
    "payments", "payment", "transfers", "transfer",
    "wire_transfers", "wire_transfer",
})

_ENTITY_KEYS = frozenset({
    "account_id", "acct_id", "customer_id", "cust_id",
    "entity_id", "party_id", "client_id",
})

_HIGH_RISK_COUNTRIES = frozenset({"KY", "VG", "NG", "IR", "PK"})

_PIPELINE_STEP_LABELS = {
    "data": "Load Data",
    "data_upload": "Load Data",
    "master": "Master Dataset",
    "target": "Target Definition",
    "eda": "Pattern Analysis",
    "preprocess": "Feature Preparation",
    "model": "Model Development",
    "validation": "Validation",
    "registry": "Registry",
    "ready": "Deployment Readiness",
    "dashboard": "Monitoring",
    "pipelines": "Run Center",
    "reports": "Reports",
}

_MASTER_SUBSTEP_LABELS = {
    "base": "Choose Base Table",
    "tables": "Select Tables to Join",
    "rollup": "Aggregate Transaction History",
    "aggregation": "Review Aggregations",
    "transforms": "Apply Business Rules",
    "labels": "Define Outcome Labels",
    "preview": "Preview and Build",
}

_TARGET_SUBSTEP_LABELS = {
    0: "Choose Outcome",
    1: "Create Outcome",
    2: "Field Guide",
}

_EDA_SUBSTEP_LABELS = {
    "dashboard": "Dashboard",
    "imbalance": "Alert Imbalance",
    "riskscore": "Risk Score",
    "rules": "Rule Intelligence",
    "entity": "Entity Risk",
    "behaviour": "Behavioural Patterns",
    "compliance": "Compliance Enrichment",
    "columns": "Column Explorer",
    "quality": "Data Quality",
    "corr": "Correlation",
    "drivers": "Drivers",
    "advanced": "Advanced EDA",
    "insights": "Insights",
    "explorer": "Explorer",
}

_PREPROCESS_SUBSTEP_LABELS = {
    0: "Plan",
    1: "Builder",
    2: "Engineer",
    3: "Feature Review",
    4: "Preview",
    5: "Run",
}

_MODEL_SUBSTEP_LABELS = {
    0: "Configure",
    1: "Check",
    2: "Train",
    3: "Evaluate",
    4: "Business Understanding",
    5: "Compare",
    6: "Scoring Ledger",
    7: "Run Report",
}

_VALIDATION_SUBSTEP_LABELS = {
    0: "Overview",
    1: "Model Comparison",
    2: "Threshold Tuning",
    3: "OOT Validation",
    4: "Stability and Risks",
    5: "Summary",
}

_PROGRESS_STAGE_ORDER = (
    "data",
    "master",
    "target",
    "eda",
    "preprocess",
    "model",
    "validation",
    "registry",
    "ready",
    "dashboard",
)

_SCREEN_TO_STEP = {
    "data_upload": "data",
    "master": "master",
    "target": "target",
    "eda": "eda",
    "preprocess": "preprocess",
    "model": "model",
    "validation": "validation",
    "registry": "registry",
    "ready": "ready",
    "dashboard": "dashboard",
    "reports": "reports",
}

_DEPENDENCY_GRAPH = {
    "data_upload": ("master", "target", "eda", "preprocess", "model", "validation", "registry", "ready", "dashboard", "reports"),
    "master": ("target", "eda", "preprocess", "model", "validation", "registry", "ready", "dashboard", "reports"),
    "target": ("eda", "preprocess", "model", "validation", "registry", "ready", "dashboard", "reports"),
    "preprocess": ("model", "validation", "registry", "ready", "dashboard", "reports"),
    "model": ("validation", "registry", "ready", "dashboard", "reports"),
    "validation": ("registry", "ready", "dashboard", "reports"),
    "registry": ("ready", "dashboard", "reports"),
    "ready": ("dashboard", "reports"),
}

_DEPENDENCY_SOURCE_LABELS = {
    "data_upload": "loaded data",
    "master": "master dataset logic",
    "target": "target definition",
    "preprocess": "feature preparation",
    "model": "model selection",
    "validation": "validation settings",
    "registry": "registry decision",
    "ready": "deployment readiness settings",
}


def _is_event_table(dataset_type: str) -> bool:
    return str(dataset_type or "").strip().lower() in _HIGH_CARDINALITY_EVENT_TYPES


def _needs_aggregation(source_name: str, join_key: str, source_df: pd.DataFrame, base_df: pd.DataFrame) -> bool:
    if not _is_event_table(source_name):
        return False
    if str(join_key or "").strip().lower() not in _ENTITY_KEYS:
        return False

    jk_col_name = next(
        (c for c in source_df.columns if str(c).lower() == str(join_key).strip().lower()),
        None,
    )
    if jk_col_name is None:
        return False

    n_rows = int(len(source_df))
    n_unique = int(source_df[jk_col_name].nunique(dropna=True))
    return n_rows > max(int(n_unique * 1.5), int(len(base_df)))


def _aggregate_event_table(df: pd.DataFrame, group_key: str) -> pd.DataFrame:
    gk = group_key
    col_map: Dict[str, str] = {str(c).lower(): c for c in df.columns}

    def _col(*candidates: str) -> Optional[str]:
        for c in candidates:
            found = col_map.get(str(c).lower())
            if found:
                return found
        return None

    amount_col = _col("txn_amount", "amount", "transaction_amount", "amt")
    type_col = _col("txn_type", "transaction_type", "payment_type", "rail")
    channel_col = _col("channel", "txn_channel")
    bene_col = _col("beneficiary_country", "bene_country", "dest_country", "counterparty_country")
    id_col = _col("transaction_id", "txn_id", "event_id", "payment_id")

    if amount_col:
        work = df.copy()
        work["__amt__"] = pd.to_numeric(work[amount_col], errors="coerce")
        agg_dict: Dict[str, Any] = {}

        if id_col:
            agg_dict["txn_count"] = pd.NamedAgg(column=id_col, aggfunc="count")
        else:
            non_key_cols = [c for c in work.columns if c != gk]
            fallback_col = non_key_cols[0] if non_key_cols else gk
            agg_dict["txn_count"] = pd.NamedAgg(column=fallback_col, aggfunc="count")

        agg_dict["total_txn_volume"] = pd.NamedAgg(column="__amt__", aggfunc="sum")
        agg_dict["avg_txn_amount"] = pd.NamedAgg(column="__amt__", aggfunc="mean")
        agg_dict["max_txn_amount"] = pd.NamedAgg(column="__amt__", aggfunc="max")
        agg_dict["std_txn_amount"] = pd.NamedAgg(column="__amt__", aggfunc="std")

        if channel_col:
            agg_dict["unique_channels"] = pd.NamedAgg(column=channel_col, aggfunc="nunique")
        if bene_col:
            agg_dict["unique_beneficiary_countries"] = pd.NamedAgg(column=bene_col, aggfunc="nunique")

        if type_col:
            type_upper = work[type_col].astype(str).str.upper()
            work["__is_cash__"] = type_upper.isin(["CASH_DEPOSIT", "CASH_WITHDRAWAL", "CASH"]).astype(int)
            work["__is_swift__"] = (type_upper == "SWIFT").astype(int)
            agg_dict["cash_txn_count"] = pd.NamedAgg(column="__is_cash__", aggfunc="sum")
            agg_dict["swift_txn_count"] = pd.NamedAgg(column="__is_swift__", aggfunc="sum")

        if bene_col:
            work["__is_high_risk__"] = work[bene_col].astype(str).str.upper().isin(_HIGH_RISK_COUNTRIES).astype(float)
            agg_dict["pct_high_risk_dest"] = pd.NamedAgg(
                column="__is_high_risk__",
                aggfunc=lambda x: float(x.mean() * 100.0),
            )

        result = work.groupby(gk, as_index=False).agg(**agg_dict)
        if "std_txn_amount" in result.columns:
            result["std_txn_amount"] = result["std_txn_amount"].fillna(0)
        if {"max_txn_amount", "avg_txn_amount"}.issubset(set(result.columns)):
            result["velocity_ratio"] = result["max_txn_amount"] / (result["avg_txn_amount"] + 1)
        else:
            result["velocity_ratio"] = 0.0
        return result

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    numeric_cols = [c for c in numeric_cols if c != gk]
    if not numeric_cols:
        return df.drop_duplicates(subset=[gk])[[gk]].reset_index(drop=True)

    agg_spec = {c: ["sum", "mean", "max", "count"] for c in numeric_cols}
    result = df.groupby(gk, as_index=False).agg(agg_spec)
    result.columns = [
        gk if isinstance(c, str) and c == gk else (gk if c[0] == gk else f"{c[0]}_{c[1]}")
        for c in result.columns
    ]
    return result


def _screen_state_map(steps: List[Dict]) -> Dict[str, Dict]:
    states: Dict[str, Dict] = {}
    for step in steps or []:
        if str(step.get("type") or "").strip().lower() != "screen_state":
            continue
        screen = str(step.get("screen") or "").strip().lower()
        state = step.get("state")
        if screen and isinstance(state, dict):
            states[screen] = state
    return states


def _coerce_int(value, default: Optional[int] = None) -> Optional[int]:
    try:
        return int(value)
    except Exception:
        return default


def _sort_jsonable(value):
    if isinstance(value, list):
        return [_sort_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _sort_jsonable(value[key]) for key in sorted(value.keys())}
    return value


def _stable_json(value) -> str:
    return json.dumps(_sort_jsonable(value), default=str, sort_keys=True)


def _compact_join(join: Any) -> Dict[str, Any]:
    row = join if isinstance(join, dict) else {}
    return {
        "left": str(row.get("left") or "").strip().lower(),
        "right": str(row.get("right") or "").strip().lower(),
        "key": str(row.get("key") or "").strip().lower(),
        "join_type": str(row.get("join_type") or "left").strip().lower(),
        "enabled": bool(row.get("enabled", True)),
    }


def _compact_transform(step: Any) -> Dict[str, Any]:
    row = step if isinstance(step, dict) else {}
    compact = {
        "type": str(row.get("type") or "").strip().lower(),
    }
    if isinstance(row.get("config"), dict):
        compact["config"] = row.get("config")
    else:
        for key in ("columns", "column", "method", "frac", "threshold_pct", "key", "fill_value"):
            if key in row:
                compact[key] = row.get(key)
    return compact


def _normalize_dependency_state(screen_key: str, state: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    state = state if isinstance(state, dict) else {}
    screen = str(screen_key or "").strip().lower()
    if screen == "data_upload":
        return {
            "dataset_ids": sorted({
                int(x) for x in (state.get("dataset_ids") or [])
                if _coerce_int(x) is not None and int(x) > 0
            }),
            "uploaded_dataset_types": sorted({
                str(x).strip().lower()
                for x in (state.get("uploaded_dataset_types") or [])
                if str(x).strip()
            }),
            "has_str_dataset": bool(state.get("has_str_dataset")),
        }
    if screen == "master":
        return {
            "grain": str(state.get("grain") or "").strip().lower(),
            "anchorType": str(state.get("anchorType") or "").strip().lower(),
            "outputName": str(state.get("outputName") or "").strip().lower(),
            "enabledTables": sorted({
                str(x).strip().lower()
                for x in (state.get("enabledTables") or [])
                if str(x).strip()
            }),
            "joins": [_compact_join(join) for join in (state.get("joins") or [])],
            "transforms": [_compact_transform(step) for step in (state.get("transforms") or [])],
            "rollupConfirmed": bool(state.get("rollupConfirmed")),
            "strMode": str(state.get("strMode") or "").strip().lower(),
            "replacementLabelColumn": str(state.get("replacementLabelColumn") or "").strip().lower(),
            "dataset_ids": sorted({
                int(x) for x in (state.get("dataset_ids") or [])
                if _coerce_int(x) is not None and int(x) > 0
            }),
            "builtMasterDatasetId": _coerce_int(state.get("builtMasterDatasetId")),
        }
    if screen == "target":
        return {
            "strategy": str(state.get("strategy") or "").strip().lower(),
            "selectedTargetColumn": str(state.get("selectedTargetColumn") or "").strip().lower(),
            "currentTargetColumn": str(state.get("currentTargetColumn") or "").strip().lower(),
            "masterDatasetId": _coerce_int(state.get("masterDatasetId")),
        }
    if screen == "preprocess":
        return {
            "steps": [_compact_transform(step) for step in (state.get("steps") or [])],
            "masterDatasetId": _coerce_int(state.get("masterDatasetId")),
            "preprocessedDatasetId": _coerce_int(state.get("preprocessedDatasetId")),
        }
    if screen == "model":
        return {
            "job_id": str(state.get("job_id") or "").strip(),
            "algorithm": str(state.get("algorithm") or "").strip().lower(),
            "dataset_id": _coerce_int(state.get("dataset_id")),
            "threshold": state.get("threshold"),
        }
    if screen == "validation":
        return {
            "job_id": str(state.get("job_id") or "").strip(),
            "optimal_threshold": state.get("optimal_threshold"),
            "report_id": str(state.get("report_id") or "").strip(),
        }
    if screen == "registry":
        return {
            "job_id": str(state.get("job_id") or "").strip(),
            "stage": str(state.get("stage") or "").strip().lower(),
            "threshold": state.get("threshold"),
            "deployment_id": str(state.get("deployment_id") or "").strip(),
        }
    if screen == "ready":
        return {
            "deployment_id": str(state.get("deployment_id") or "").strip(),
            "job_id": str(state.get("job_id") or "").strip(),
        }
    return None


def _state_fingerprint(screen_key: str, state: Dict[str, Any]) -> str:
    normalized = _normalize_dependency_state(screen_key, state)
    return _stable_json(normalized) if normalized is not None else ""


def _dependency_state_payload(steps: List[Dict]) -> Dict[str, Any]:
    screen_states = _screen_state_map(steps or [])
    raw = screen_states.get("workbench_dependencies") or {}
    return raw if isinstance(raw, dict) else {}


def _join_labels(items: List[str]) -> str:
    labels = [str(item).strip() for item in items if str(item).strip()]
    if not labels:
        return ""
    if len(labels) == 1:
        return labels[0]
    if len(labels) == 2:
        return f"{labels[0]} and {labels[1]}"
    return f"{', '.join(labels[:-1])}, and {labels[-1]}"


def _build_dependency_message(screen_key: str, impacted_steps: List[str]) -> str:
    source_label = _DEPENDENCY_SOURCE_LABELS.get(screen_key, screen_key.replace("_", " "))
    impacted_labels = [_PIPELINE_STEP_LABELS.get(step, step.replace("_", " ").title()) for step in impacted_steps]
    return (
        f"You changed {source_label}. "
        f"{_join_labels(impacted_labels)} are now outdated and should be rerun."
    )


def _progress_stale_summary(steps: List[Dict]) -> Dict[str, Any]:
    dependency_state = _dependency_state_payload(steps)
    stale_map = dependency_state.get("stale_steps") or {}
    stage_order = {stage: idx for idx, stage in enumerate((*_PROGRESS_STAGE_ORDER, "reports"))}
    stale_steps = sorted([
        step for step in stale_map.keys()
        if str(step).strip().lower() in set(_PROGRESS_STAGE_ORDER) | {"reports"}
    ], key=lambda step: stage_order.get(str(step).strip().lower(), 999))
    latest_change = dependency_state.get("latest_change") or {}
    return {
        "stale_steps": stale_steps,
        "stale_details": stale_map if isinstance(stale_map, dict) else {},
        "latest_change": latest_change if isinstance(latest_change, dict) else {},
    }


def _extract_nested_identifier(state: Any, keys: Tuple[str, ...]) -> str:
    if not isinstance(state, dict):
        return ""
    for key in keys:
        value = _normalize_text(state.get(key))
        if value:
            return value
    for nested_key in ("entry", "active_model_run", "registry_entry", "validation_report", "model", "run"):
        nested = state.get(nested_key)
        value = _extract_nested_identifier(nested, keys)
        if value:
            return value
    return ""


def _screen_job_id(screen_states: Dict[str, Dict], screen_key: str) -> str:
    state = screen_states.get(str(screen_key or "").strip().lower()) or {}
    return _extract_nested_identifier(state, ("job_id", "run_id"))


def _screen_deployment_id(screen_states: Dict[str, Dict], screen_key: str) -> str:
    state = screen_states.get(str(screen_key or "").strip().lower()) or {}
    return _extract_nested_identifier(state, ("deployment_id",))


def _reconcile_dependency_state_steps(steps: List[Dict]) -> Tuple[List[Dict], bool]:
    if not isinstance(steps, list) or not steps:
        return steps, False

    screen_states = _screen_state_map(steps or [])
    dependency_state = _dependency_state_payload(steps or [])
    stale_steps = dict(dependency_state.get("stale_steps") or {})
    if not stale_steps:
        return steps, False

    model_job_id = _screen_job_id(screen_states, "model")
    validation_job_id = _screen_job_id(screen_states, "validation")
    registry_job_id = _screen_job_id(screen_states, "registry")
    registry_deployment_id = _screen_deployment_id(screen_states, "registry")
    ready_deployment_id = _screen_deployment_id(screen_states, "ready")

    cleared_steps: set[str] = set()
    if model_job_id and validation_job_id and model_job_id == validation_job_id:
        cleared_steps.add("validation")
        if not registry_job_id:
            cleared_steps.add("reports")
    if model_job_id and registry_job_id and model_job_id == registry_job_id:
        cleared_steps.update({"registry", "ready", "dashboard", "reports"})
        if not validation_job_id or validation_job_id == model_job_id:
            cleared_steps.add("validation")
    if registry_deployment_id or ready_deployment_id:
        cleared_steps.update({"ready", "dashboard", "reports"})
        if model_job_id and validation_job_id and model_job_id == validation_job_id:
            cleared_steps.add("validation")

    if not cleared_steps:
        return steps, False

    next_stale_steps = {
        str(step_id): value
        for step_id, value in stale_steps.items()
        if _normalize_text(step_id).lower() not in cleared_steps
    }
    next_latest_change = dependency_state.get("latest_change") if isinstance(dependency_state.get("latest_change"), dict) else {}
    if next_latest_change:
        impacted_steps = [
            str(step_id).strip().lower()
            for step_id in (next_latest_change.get("impacted_steps") or [])
            if _normalize_text(step_id).lower() not in cleared_steps
        ]
        if impacted_steps:
            next_latest_change = {
                **next_latest_change,
                "impacted_steps": impacted_steps,
            }
        else:
            next_latest_change = {}

    next_dependency_state = {
        **dependency_state,
        "stale_steps": next_stale_steps,
        "latest_change": next_latest_change if next_stale_steps else {},
    }

    next_steps: List[Dict] = []
    replaced = False
    for step in steps:
        if (
            str(step.get("type") or "").strip().lower() == "screen_state"
            and str(step.get("screen") or "").strip().lower() == "workbench_dependencies"
        ):
            next_steps.append({
                "type": "screen_state",
                "screen": "workbench_dependencies",
                "state": next_dependency_state,
            })
            replaced = True
            continue
        next_steps.append(step)
    if not replaced:
        next_steps.append({
            "type": "screen_state",
            "screen": "workbench_dependencies",
            "state": next_dependency_state,
        })
    return next_steps, True


def _derive_substep(screen_key: str, screen_states: Dict[str, Dict]) -> Tuple[str, str]:
    screen = str(screen_key or "").strip().lower()
    state = screen_states.get(screen) or {}
    if screen == "master":
        raw = str(state.get("currentStepId") or "").strip().lower()
        return raw, _MASTER_SUBSTEP_LABELS.get(raw, raw.replace("_", " ").title() if raw else "")
    if screen == "target":
        raw = _coerce_int(state.get("activeTab"))
        if raw is None:
            return "", ""
        return str(raw), _TARGET_SUBSTEP_LABELS.get(raw, f"Tab {raw + 1}")
    if screen == "eda":
        raw = str(state.get("activeTab") or state.get("tab") or "").strip().lower()
        if not raw:
            return "", ""
        return raw, _EDA_SUBSTEP_LABELS.get(raw, raw.replace("_", " ").title())
    if screen == "preprocess":
        raw = _coerce_int(state.get("activeTab") if "activeTab" in state else state.get("tab"))
        if raw is None:
            return "", ""
        return str(raw), _PREPROCESS_SUBSTEP_LABELS.get(raw, f"Tab {raw + 1}")
    if screen == "model":
        raw = _coerce_int(state.get("activeTab"))
        if raw is None:
            return "", ""
        return str(raw), _MODEL_SUBSTEP_LABELS.get(raw, f"Tab {raw + 1}")
    if screen == "validation":
        raw = _coerce_int(state.get("activeTab"))
        if raw is None:
            return "", ""
        return str(raw), _VALIDATION_SUBSTEP_LABELS.get(raw, f"Tab {raw + 1}")
    return "", ""


def _fallback_progress_summary(steps: List[Dict], status: Optional[str] = None) -> Dict[str, Any]:
    screen_states = _screen_state_map(steps or [])
    completed_flags = {
        "data": bool(screen_states.get("data_upload")),
        "master": bool(screen_states.get("master")),
        "target": bool(screen_states.get("target")),
        "eda": bool(screen_states.get("eda")),
        "preprocess": bool(screen_states.get("preprocess")),
        "model": bool(screen_states.get("model")),
        "validation": bool(screen_states.get("validation")),
        "registry": bool(screen_states.get("registry")),
        "ready": bool(screen_states.get("ready")),
        "dashboard": bool(screen_states.get("dashboard")),
    }
    completed_steps = sum(1 for key in _PROGRESS_STAGE_ORDER if completed_flags.get(key))
    total_steps = len(_PROGRESS_STAGE_ORDER)

    current_step = "data"
    for stage in reversed(_PROGRESS_STAGE_ORDER):
        if completed_flags.get(stage):
            current_step = stage
            break
    if completed_steps < total_steps:
        for stage in _PROGRESS_STAGE_ORDER:
            if not completed_flags.get(stage):
                current_step = stage
                break

    current_substep, current_substep_label = _derive_substep(current_step, screen_states)
    completion_pct = int(round((completed_steps / max(total_steps, 1)) * 100))
    summary_status = str(status or "").strip().lower() or ("complete" if completion_pct >= 100 else "in_progress")
    return {
        "current_step": current_step,
        "current_step_label": _PIPELINE_STEP_LABELS.get(current_step, current_step.replace("_", " ").title()),
        "current_substep": current_substep,
        "current_substep_label": current_substep_label,
        "completion_pct": completion_pct,
        "completed_steps": completed_steps,
        "total_steps": total_steps,
        "run_status": summary_status,
    }


def _progress_summary_from_steps(steps: List[Dict], status: Optional[str] = None) -> Dict[str, Any]:
    screen_states = _screen_state_map(steps or [])
    journey = screen_states.get("workbench_journey") or {}
    summary = _fallback_progress_summary(steps, status=status)
    stale_summary = _progress_stale_summary(steps)

    current_step = str(journey.get("current_step") or summary["current_step"]).strip().lower()
    current_step = current_step or summary["current_step"]
    current_step_label = _PIPELINE_STEP_LABELS.get(
        current_step,
        str(journey.get("current_step_label") or "").strip() or summary["current_step_label"],
    )

    current_substep = str(journey.get("current_substep") or "").strip()
    current_substep_label = str(journey.get("current_substep_label") or "").strip()
    if not current_substep_label:
        derived_substep, derived_substep_label = _derive_substep(current_step, screen_states)
        current_substep = current_substep or derived_substep
        current_substep_label = derived_substep_label

    completion_pct = _coerce_int(journey.get("completion_pct"), summary["completion_pct"])
    completed_steps = _coerce_int(journey.get("completed_steps"), summary["completed_steps"])
    total_steps = _coerce_int(journey.get("total_steps"), summary["total_steps"])
    run_status = str(journey.get("run_status") or summary["run_status"] or status or "").strip().lower()
    if not run_status:
        run_status = "complete" if int(completion_pct or 0) >= 100 else "in_progress"
    if stale_summary["stale_steps"]:
        run_status = "stale"

    return {
        "current_step": current_step,
        "current_step_label": current_step_label,
        "current_substep": current_substep,
        "current_substep_label": current_substep_label,
        "completion_pct": int(completion_pct or 0),
        "completed_steps": int(completed_steps or 0),
        "total_steps": int(total_steps or len(_PROGRESS_STAGE_ORDER)),
        "run_status": run_status,
        "stale_steps": stale_summary["stale_steps"],
        "stale_details": stale_summary["stale_details"],
        "latest_change": stale_summary["latest_change"],
    }


_INVESTIGATION_STEP_LABELS = {
    "priority": "Priority Inbox",
    "casepack": "Case Pack",
    "investigate": "Case Investigation",
    "datatree": "Data Tree",
    "compare": "Compare Cases",
    "chat": "Copilot",
    "graph": "Graph Analysis",
    "rules": "Rule Intelligence",
    "typology": "Typology Analysis",
    "baseline": "Baseline Analysis",
    "vector": "Vector Search",
    "audit": "Audit Trail",
}


def _workflow_workspace_label(module_name: Optional[str]) -> str:
    key = str(module_name or "").strip().lower()
    if key in {"investigation", "sentinel"}:
        return "Sentinel"
    return "FCC"


def _workflow_workspace_step_label(module_name: Optional[str], step_name: Optional[str]) -> str:
    normalized = str(step_name or "").strip().lower()
    if not normalized:
        return ""
    if normalized == "data_upload":
        normalized = "data"
    if str(module_name or "").strip().lower() in {"investigation", "sentinel"}:
        return _INVESTIGATION_STEP_LABELS.get(normalized, normalized.replace("_", " ").title())
    return _PIPELINE_STEP_LABELS.get(normalized, normalized.replace("_", " ").title())


def _workflow_case_ids(case_scope: Any, handoff_summary: Any) -> List[str]:
    case_scope_dict = case_scope if isinstance(case_scope, dict) else {}
    handoff_dict = handoff_summary if isinstance(handoff_summary, dict) else {}
    raw_values = case_scope_dict.get("case_ids") or handoff_dict.get("imported_case_ids") or []
    out: List[str] = []
    seen = set()
    for value in raw_values:
        text = str(value or "").strip()
        if not text:
            continue
        if text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


class MLOpsWorkbenchService:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
          if True:
            conn.execute("CREATE SEQUENCE IF NOT EXISTS mlops_dataset_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS mlops_snapshot_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS mlops_step_event_seq START 1")
            conn.execute("CREATE SEQUENCE IF NOT EXISTS mlops_asset_link_seq START 1")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_dataset_registry (
                  dataset_id INTEGER PRIMARY KEY DEFAULT nextval('mlops_dataset_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  dataset_type TEXT,
                  filename TEXT,
                  file_path TEXT,
                  row_count BIGINT,
                  columns_json TEXT,
                  column_types_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_jobs (
                  job_id TEXT PRIMARY KEY,
                  kind TEXT,
                  status TEXT,
                  payload_json TEXT,
                  result_json TEXT,
                  error TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  finished_at TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_snapshots (
                  snapshot_id INTEGER PRIMARY KEY DEFAULT nextval('mlops_snapshot_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  name TEXT,
                  dataset_id INTEGER,
                  payload_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_targets (
                  target_id INTEGER PRIMARY KEY DEFAULT nextval('mlops_snapshot_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  dataset_id INTEGER,
                  name TEXT,
                  strategy TEXT,
                  config_json TEXT,
                  summary_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_pipelines (
                  pipeline_id INTEGER PRIMARY KEY DEFAULT nextval('mlops_snapshot_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  dataset_id INTEGER,
                  name TEXT,
                  steps_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_workflow_sessions (
                  session_id TEXT PRIMARY KEY,
                  journey_key TEXT,
                  tenant_id TEXT,
                  env_id TEXT,
                  pipeline_id BIGINT,
                  pipeline_name TEXT,
                  run_id TEXT,
                  deployment_id TEXT,
                  publish_id TEXT,
                  current_module TEXT,
                  current_step TEXT,
                  current_state_json TEXT,
                  last_stable_step TEXT,
                  last_stable_state_json TEXT,
                  case_scope_json TEXT,
                  selected_case_id TEXT,
                  handoff_summary_json TEXT,
                  checkpoint_key TEXT,
                  status TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_pipeline_step_events (
                  event_id BIGINT PRIMARY KEY DEFAULT nextval('mlops_step_event_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  pipeline_id BIGINT,
                  session_id TEXT,
                  screen TEXT,
                  step_id TEXT,
                  event_type TEXT,
                  status TEXT,
                  checkpoint_key TEXT,
                  state_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_pipeline_asset_links (
                  link_id BIGINT PRIMARY KEY DEFAULT nextval('mlops_asset_link_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  pipeline_id BIGINT,
                  asset_kind TEXT,
                  asset_id TEXT,
                  stage TEXT,
                  relation TEXT,
                  metadata_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_cache (
                  cache_key TEXT PRIMARY KEY,
                  result_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_model_runs (
                  run_id TEXT PRIMARY KEY,
                  tenant_id TEXT,
                  env_id TEXT,
                  dataset_id INTEGER,
                  target_column TEXT,
                  algorithm TEXT,
                  feature_columns_json TEXT,
                  metrics_json TEXT,
                  threshold_metrics_json TEXT,
                  test_truth_json TEXT,
                  test_prob_json TEXT,
                  selected_threshold DOUBLE,
                  artifact_path TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_run_reports (
                  report_id TEXT PRIMARY KEY,
                  run_id TEXT NOT NULL,
                  pipeline_id TEXT,
                  tenant_id TEXT,
                  env_id TEXT,
                  report_json TEXT,
                  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  run_type TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_deployments (
                  deployment_id TEXT PRIMARY KEY,
                  run_id TEXT,
                  tenant_id TEXT,
                  env_id TEXT,
                  threshold DOUBLE,
                  bundle_path TEXT,
                  model_card_path TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            # ── Pipeline schema extensions (idempotent ALTER TABLE) ───────────
            # DuckDB does not support IF NOT EXISTS in ALTER TABLE ADD COLUMN,
            # so we check the column list first and only add missing ones.
            self._ensure_pipeline_columns(conn)

        # end _ensure_schema

    def _ensure_pipeline_columns(self, conn=None) -> None:
        """
        Idempotently add columns to mlops_pipelines that were not present in the
        original schema, and create the pipeline_versions and pipeline_runs tables.
        Safe to run on an existing populated database.
        """
        with (nullcontext(conn) if conn is not None else get_connection(self.db_path)) as conn:
            # Discover columns that already exist
            try:
                col_rows = conn.execute("PRAGMA table_info(mlops_pipelines)").fetchall()
                existing_cols = {r[1] for r in col_rows}
            except Exception:
                existing_cols = set()

            new_cols = {
                "grain":          "TEXT DEFAULT 'transaction'",
                "anchor_dataset_id": "INTEGER",
                "dataset_ids_json": "TEXT",
                "joins_json":     "TEXT",
                "transforms_json": "TEXT",
                "str_config_json": "TEXT",
                "schedule_json":  "TEXT",
                "output_name":    "TEXT",
                "status":         "TEXT DEFAULT 'draft'",
                "version":        "INTEGER DEFAULT 1",
                "last_run_at":    "TIMESTAMP",
                "output_dataset_id": "INTEGER",
                "created_by_persona": "TEXT",
            }
            for col, typedef in new_cols.items():
                if col not in existing_cols:
                    try:
                        conn.execute(
                            f"ALTER TABLE mlops_pipelines ADD COLUMN {col} {typedef}"
                        )
                    except Exception:
                        pass  # column may have been added by a concurrent thread

            # Pipeline version snapshots
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_pipeline_versions (
                  version_id INTEGER PRIMARY KEY DEFAULT nextval('mlops_snapshot_seq'),
                  pipeline_id INTEGER,
                  tenant_id TEXT,
                  env_id TEXT,
                  version INTEGER,
                  name TEXT,
                  grain TEXT,
                  steps_json TEXT,
                  status TEXT DEFAULT 'saved',
                  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

            # Async pipeline run records (separate from EDA jobs)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_pipeline_runs (
                  run_id TEXT PRIMARY KEY,
                  pipeline_id INTEGER,
                  tenant_id TEXT,
                  env_id TEXT,
                  status TEXT DEFAULT 'pending',
                  output_dataset_id INTEGER,
                  log_json TEXT,
                  error TEXT,
                  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  finished_at TIMESTAMP
                )
                """
            )

    def _model_training_db_path(self) -> Path:
        return self._env_root() / "mlops" / "duckdb" / "model_training.duckdb"

    def _normalize_pipeline_asset_id(self, value: Any, *, numeric: bool = False) -> Optional[str]:
        if isinstance(value, bool):
            return None
        if value in (None, "", [], {}, ()):
            return None
        if numeric:
            try:
                number = int(value)
            except Exception:
                try:
                    number = int(float(str(value).strip()))
                except Exception:
                    return None
            return str(number) if number > 0 else None
        text = str(value).strip()
        if not text or text.lower() in {"none", "null", "nan"}:
            return None
        return text

    def _upsert_pipeline_asset_link(
        self,
        conn,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        asset_kind: str,
        asset_id: Any,
        *,
        stage: str,
        relation: str = "reference",
        metadata: Optional[Dict[str, Any]] = None,
        numeric: bool = False,
    ) -> None:
        asset_id_text = self._normalize_pipeline_asset_id(asset_id, numeric=numeric)
        if not asset_id_text:
            return
        stage_key = _normalize_text(stage).lower() or "unknown"
        relation_key = _normalize_text(relation).lower() or "reference"
        kind_key = _normalize_text(asset_kind).lower()
        if not kind_key:
            return
        metadata_json = json.dumps(metadata or {}, default=str)
        row = conn.execute(
            """
            SELECT link_id
            FROM mlops_pipeline_asset_links
            WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ?
              AND asset_kind = ? AND asset_id = ? AND stage = ? AND relation = ?
            LIMIT 1
            """,
            [tenant_id, env_id, int(pipeline_id), kind_key, asset_id_text, stage_key, relation_key],
        ).fetchone()
        if row:
            conn.execute(
                """
                UPDATE mlops_pipeline_asset_links
                SET metadata_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE link_id = ?
                """,
                [metadata_json, int(row[0])],
            )
            return
        conn.execute(
            """
            INSERT INTO mlops_pipeline_asset_links (
              tenant_id, env_id, pipeline_id, asset_kind, asset_id, stage, relation, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [tenant_id, env_id, int(pipeline_id), kind_key, asset_id_text, stage_key, relation_key, metadata_json],
        )

    def _replace_pipeline_stage_asset_links(
        self,
        conn,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        stage: str,
        assets: List[Dict[str, Any]],
    ) -> None:
        stage_key = _normalize_text(stage).lower() or "unknown"
        conn.execute(
            """
            DELETE FROM mlops_pipeline_asset_links
            WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ? AND stage = ?
            """,
            [tenant_id, env_id, int(pipeline_id), stage_key],
        )
        for asset in assets or []:
            if not isinstance(asset, dict):
                continue
            self._upsert_pipeline_asset_link(
                conn,
                tenant_id,
                env_id,
                int(pipeline_id),
                str(asset.get("asset_kind") or ""),
                asset.get("asset_id"),
                stage=stage_key,
                relation=str(asset.get("relation") or "reference"),
                metadata=asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {},
                numeric=bool(asset.get("numeric")),
            )

    def _extract_pipeline_assets_from_state(self, stage: str, state: Any) -> List[Dict[str, Any]]:
        stage_key = _normalize_text(stage).lower() or "unknown"
        assets: List[Dict[str, Any]] = []
        seen: set[Tuple[str, str, str]] = set()
        dataset_scalar_keys = {
            "dataset_id",
            "masterdatasetid",
            "builtmasterdatasetid",
            "outputdatasetid",
            "preprocesseddatasetid",
            "master_dataset_id",
            "preprocess_dataset_id",
            "anchordatasetid",
            "anchor_dataset_id",
        }
        dataset_array_keys = {"dataset_ids"}
        run_keys = {"job_id", "model_job_id", "run_id", "report_run_id"}

        def add(kind: str, raw_value: Any, relation: str, *, numeric: bool = False, metadata: Optional[Dict[str, Any]] = None) -> None:
            asset_id = self._normalize_pipeline_asset_id(raw_value, numeric=numeric)
            if not asset_id:
                return
            key = (_normalize_text(kind).lower(), asset_id, _normalize_text(relation).lower())
            if key in seen:
                return
            seen.add(key)
            assets.append(
                {
                    "asset_kind": key[0],
                    "asset_id": asset_id,
                    "relation": key[2],
                    "metadata": metadata or {},
                    "numeric": numeric,
                }
            )

        def walk(obj: Any, parent_key: str = "") -> None:
            if isinstance(obj, dict):
                if parent_key in {"datasets", "master_dataset", "preprocess_dataset", "dataset"}:
                    add("dataset", obj.get("dataset_id"), f"{stage_key}_{parent_key}", numeric=True)
                if parent_key in {"active_model_run", "registry_entry", "validation_report"}:
                    add("training_job", obj.get("job_id") or obj.get("run_id"), f"{stage_key}_{parent_key}_job")
                    add("deployment", obj.get("deployment_id"), f"{stage_key}_{parent_key}_deployment")
                for key, value in obj.items():
                    lower_key = _normalize_text(key).lower()
                    if lower_key in dataset_scalar_keys:
                        add("dataset", value, f"{stage_key}_{lower_key}", numeric=True)
                    elif lower_key in dataset_array_keys and isinstance(value, list):
                        for item in value:
                            if isinstance(item, dict):
                                add("dataset", item.get("dataset_id"), f"{stage_key}_{lower_key}", numeric=True)
                            else:
                                add("dataset", item, f"{stage_key}_{lower_key}", numeric=True)
                    elif lower_key in run_keys:
                        add("training_job", value, f"{stage_key}_{lower_key}")
                    elif lower_key == "deployment_id":
                        add("deployment", value, f"{stage_key}_deployment")
                    elif lower_key == "datasets" and isinstance(value, list):
                        for item in value:
                            if isinstance(item, dict):
                                add("dataset", item.get("dataset_id"), f"{stage_key}_datasets", numeric=True)
                    walk(value, lower_key)
            elif isinstance(obj, list):
                for item in obj:
                    walk(item, parent_key)

        walk(state, "")
        return assets

    def _pipeline_definition_assets(
        self,
        dataset_id: Optional[int],
        anchor_dataset_id: Optional[int],
        dataset_ids: Optional[List[int]],
        output_dataset_id: Optional[int],
    ) -> List[Dict[str, Any]]:
        assets: List[Dict[str, Any]] = []
        seen: set[str] = set()

        def add_dataset(raw_id: Any, relation: str) -> None:
            asset_id = self._normalize_pipeline_asset_id(raw_id, numeric=True)
            if not asset_id:
                return
            key = f"dataset::{asset_id}::{relation}"
            if key in seen:
                return
            seen.add(key)
            assets.append(
                {
                    "asset_kind": "dataset",
                    "asset_id": asset_id,
                    "relation": relation,
                    "metadata": {"stage": "pipeline_definition"},
                    "numeric": True,
                }
            )

        add_dataset(dataset_id, "primary_dataset")
        add_dataset(anchor_dataset_id, "anchor_dataset")
        for raw_id in dataset_ids or []:
            add_dataset(raw_id, "selected_dataset")
        add_dataset(output_dataset_id, "pipeline_output")
        return assets

    def _sync_pipeline_asset_links_for_pipeline(
        self,
        conn,
        tenant_id: str,
        env_id: str,
        pipeline_row: Dict[str, Any],
        workflow_state: Optional[Dict[str, Any]] = None,
    ) -> None:
        pipeline_id = int(pipeline_row.get("pipeline_id") or 0)
        if pipeline_id <= 0:
            return
        self._replace_pipeline_stage_asset_links(
            conn,
            tenant_id,
            env_id,
            pipeline_id,
            "pipeline_definition",
            self._pipeline_definition_assets(
                pipeline_row.get("dataset_id"),
                pipeline_row.get("anchor_dataset_id"),
                pipeline_row.get("dataset_ids") if isinstance(pipeline_row.get("dataset_ids"), list) else [],
                pipeline_row.get("output_dataset_id"),
            ),
        )
        for step in pipeline_row.get("steps") or []:
            if not isinstance(step, dict):
                continue
            if _normalize_text(step.get("type")).lower() != "screen_state":
                continue
            screen = _normalize_text(step.get("screen")).lower()
            if not screen:
                continue
            self._replace_pipeline_stage_asset_links(
                conn,
                tenant_id,
                env_id,
                pipeline_id,
                screen,
                self._extract_pipeline_assets_from_state(screen, step.get("state") if isinstance(step.get("state"), dict) else {}),
            )
        if isinstance(workflow_state, dict):
            self._replace_pipeline_stage_asset_links(
                conn,
                tenant_id,
                env_id,
                pipeline_id,
                "workflow_session",
                self._extract_pipeline_assets_from_state("workflow_session", workflow_state),
            )

    def _backfill_pipeline_asset_links(
        self,
        conn,
        tenant_id: str,
        env_id: str,
        pipeline_ids: Optional[List[int]] = None,
    ) -> None:
        filters: List[str] = ["tenant_id = ?", "env_id = ?"]
        values: List[Any] = [tenant_id, env_id]
        pipeline_id_set = {
            int(pid) for pid in (pipeline_ids or [])
            if isinstance(pid, (int, float, str)) and str(pid).strip()
        }
        if pipeline_id_set:
            placeholders = ",".join(["?"] * len(pipeline_id_set))
            filters.append(f"pipeline_id IN ({placeholders})")
            values.extend(sorted(pipeline_id_set))
        rows = conn.execute(
            f"""
            SELECT pipeline_id, dataset_id, anchor_dataset_id, dataset_ids_json,
                   output_dataset_id, steps_json
            FROM mlops_pipelines
            WHERE {' AND '.join(filters)}
            """,
            values,
        ).fetchall()
        workflow_rows = conn.execute(
            """
            SELECT pipeline_id, current_state_json, updated_at
            FROM mlops_workflow_sessions
            WHERE tenant_id = ? AND env_id = ? AND pipeline_id IS NOT NULL
            ORDER BY updated_at DESC
            """,
            [tenant_id, env_id],
        ).fetchall()
        workflow_by_pipeline: Dict[int, Dict[str, Any]] = {}
        for row in workflow_rows:
            pid = int(row[0]) if row and row[0] is not None else 0
            if pid <= 0 or pid in workflow_by_pipeline:
                continue
            workflow_by_pipeline[pid] = _safe_json_loads(row[1], {})
        for row in rows:
            pipeline_row = {
                "pipeline_id": int(row[0]),
                "dataset_id": int(row[1]) if row[1] is not None else None,
                "anchor_dataset_id": int(row[2]) if row[2] is not None else None,
                "dataset_ids": _safe_json_loads(row[3], []),
                "output_dataset_id": int(row[4]) if row[4] is not None else None,
                "steps": _safe_json_loads(row[5], []),
            }
            self._sync_pipeline_asset_links_for_pipeline(
                conn,
                tenant_id,
                env_id,
                pipeline_row,
                workflow_state=workflow_by_pipeline.get(int(row[0])),
            )

    def _list_pipeline_asset_links(self, conn, tenant_id: str, env_id: str, pipeline_id: int) -> List[Dict[str, Any]]:
        rows = conn.execute(
            """
            SELECT asset_kind, asset_id, stage, relation, metadata_json, created_at, updated_at
            FROM mlops_pipeline_asset_links
            WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ?
            ORDER BY stage, asset_kind, asset_id
            """,
            [tenant_id, env_id, int(pipeline_id)],
        ).fetchall()
        return [
            {
                "asset_kind": _normalize_text(row[0]).lower(),
                "asset_id": _normalize_optional_text(row[1]),
                "stage": _normalize_optional_text(row[2]),
                "relation": _normalize_optional_text(row[3]),
                "metadata": _safe_json_loads(row[4], {}),
                "created_at": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
                "updated_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
            }
            for row in rows
        ]

    def _relation_expr(self, file_path: Path, sample_size: Optional[int] = None) -> str:
        resolved = self._resolve_file_path(file_path)
        # Use forward slashes for SQL path literals across platforms.
        p = str(resolved).replace("\\", "/").replace("'", "''")
        ext = file_path.suffix.lower()
        if ext in (".parquet", ".pq"):
            return f"read_parquet('{p}')"
        if sample_size is not None:
            return f"read_csv_auto('{p}', sample_size={int(sample_size)})"
        return f"read_csv_auto('{p}')"

    def _resolve_file_path(self, file_path: Path) -> Path:
        env_root = Path(self.db_path).resolve().parents[2]
        return resolve_data_file_path(file_path, env_root=env_root)

    def _connect(self):
        # Deprecated: use get_connection(self.db_path) context manager instead
        return duckdb.connect(str(self.db_path))

    def _cache_get(self, cache_key: str, ttl_seconds: int = 3600):
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT result_json, created_at
                FROM mlops_cache
                WHERE cache_key = ?
                """,
                [cache_key],
            ).fetchone()
        if not row:
            return None
        result_json, created_at = row
        if hasattr(created_at, "timestamp"):
            age = (pd.Timestamp.utcnow().timestamp() - created_at.timestamp())
            if age > ttl_seconds:
                return None
        try:
            return json.loads(result_json or "{}")
        except Exception:
            return None

    def _cache_set(self, cache_key: str, result: Dict):
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO mlops_cache (cache_key, result_json, created_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                """,
                [cache_key, json.dumps(result or {}, default=str)],
            )

    def _env_root(self) -> Path:
        # db path: <env_root>/mlops/duckdb/mlops.duckdb
        return self.db_path.parents[2]

    def _mlops_root(self) -> Path:
        path = self._env_root() / "mlops"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _data_dir(self) -> Path:
        path = self._mlops_root() / "data"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _model_dir(self) -> Path:
        path = self._mlops_root() / "models"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _deployment_dir(self) -> Path:
        path = self._mlops_root() / "deployments"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def register_dataset(
        self,
        tenant_id: str,
        env_id: str,
        dataset_type: str,
        filename: str,
        file_path: Path,
    ) -> Dict:
        rel = self._relation_expr(file_path, sample_size=20000)
        with duckdb.connect() as meta_conn:
            row_count = meta_conn.execute(f"SELECT COUNT(*) FROM {rel}").fetchone()[0]
            columns = meta_conn.execute(f"DESCRIBE SELECT * FROM {rel}").fetchall()

        column_names = [c[0] for c in columns]
        column_types = {c[0]: c[1] for c in columns}
        columns_json = json.dumps(column_names, default=str)
        column_types_json = json.dumps(column_types, default=str)

        with get_connection(self.db_path) as conn:
            existing = conn.execute(
                """
                SELECT dataset_id FROM mlops_dataset_registry
                WHERE tenant_id = ? AND env_id = ? AND dataset_type = ?
                """,
                [tenant_id, env_id, dataset_type],
            ).fetchone()

            if existing and existing[0]:
                dataset_id = int(existing[0])
                conn.execute(
                    """
                    UPDATE mlops_dataset_registry
                    SET filename = ?, file_path = ?, row_count = ?,
                        columns_json = ?, column_types_json = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE dataset_id = ?
                    """,
                    [
                        filename,
                        str(file_path),
                        int(row_count or 0),
                        columns_json,
                        column_types_json,
                        int(dataset_id),
                    ],
                )
            else:
                dataset_id = conn.execute("SELECT nextval('mlops_dataset_seq')").fetchone()[0]
                conn.execute(
                    """
                    INSERT INTO mlops_dataset_registry (
                      dataset_id, tenant_id, env_id, dataset_type, filename,
                      file_path, row_count, columns_json, column_types_json
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        int(dataset_id),
                        tenant_id,
                        env_id,
                        dataset_type,
                        filename,
                        str(file_path),
                        int(row_count or 0),
                        columns_json,
                        column_types_json,
                    ],
                )

        # ── Auto-profile on upload ─────────────────────────────────────────────
        # Compute basic profiling in background so it's cached for the EDA step
        dataset_meta = {
            "dataset_id": int(dataset_id),
            "file_path": str(file_path),
            "dataset_type": dataset_type,
        }
        try:
            self._auto_profile_background(dataset_meta, int(row_count or 0))
        except Exception:
            pass  # profiling failure must never break the upload response

        return {
            "dataset_id": int(dataset_id),
            "tenant_id": tenant_id,
            "env_id": env_id,
            "dataset_type": dataset_type,
            "filename": filename,
            "file_path": str(file_path),
            "row_count": int(row_count or 0),
            "columns": column_names,
            "column_types": column_types,
            "auto_profile": self._get_cached_profile(int(dataset_id)),
        }

    # ── Auto-profile helpers ───────────────────────────────────────────────────

    def _auto_profile_background(self, dataset_meta: Dict, row_count: int) -> None:
        """
        Run basic profiling in a background thread immediately after upload.
        Caches results so the EDA step is instant for the user.
        """
        import threading

        def _run():
            try:
                sample = min(row_count, 10_000)
                df = self._load_sample_df(Path(dataset_meta["file_path"]), None, sample)

                # 1. Per-column quick stats
                col_profiles = {}
                for col in df.columns:
                    series = df[col]
                    n = len(series)
                    n_null = int(series.isna().sum())
                    n_unique = int(series.nunique(dropna=True))
                    dtype = str(series.dtype)
                    entry = {
                        "dtype": dtype,
                        "null_count": n_null,
                        "null_pct": round(n_null / n, 4) if n else 0.0,
                        "unique_count": n_unique,
                        "is_binary": n_unique == 2,
                        "sample_value": None,
                    }
                    # Sample value
                    non_null = series.dropna()
                    if len(non_null):
                        entry["sample_value"] = str(non_null.iloc[0])
                    # Value counts for low-cardinality or binary columns
                    if n_unique <= 30:
                        vc = series.value_counts(dropna=False).head(20)
                        entry["value_counts"] = [
                            {"value": str(k) if not pd.isna(k) else "(missing)", "count": int(v)}
                            for k, v in vc.items()
                        ]
                    # Numeric stats
                    if pd.api.types.is_numeric_dtype(series) and non_null.shape[0] > 0:
                        vals = pd.to_numeric(series, errors="coerce").dropna()
                        entry.update({
                            "min":    round(float(vals.min()), 4),
                            "max":    round(float(vals.max()), 4),
                            "mean":   round(float(vals.mean()), 4),
                            "median": round(float(vals.median()), 4),
                            "std":    round(float(vals.std()), 4),
                            "skew":   round(float(vals.skew()), 4),
                        })
                        # Histogram (10 bins)
                        hist, edges = np.histogram(vals.to_numpy(), bins=10)
                        entry["histogram"] = [
                            {"bin_start": round(float(edges[i]), 4),
                             "bin_end": round(float(edges[i+1]), 4),
                             "count": int(hist[i])}
                            for i in range(len(hist))
                        ]
                    col_profiles[col] = entry

                # 2. Target candidates
                TARGET_KW = ["is_true_pos", "final_label", "is_tp", "label", "target", "flag",
                             "str", "sar", "fraud", "suspicious", "positive",
                             "outcome", "result"]
                candidates = []
                for col, prof in col_profiles.items():
                    name = col.lower()
                    score = 0
                    if any(kw in name for kw in TARGET_KW): score += 40
                    if name.startswith("is_") or name.endswith("_flag"): score += 20
                    if "bool" in prof["dtype"]: score += 30
                    if prof["is_binary"]: score += 25
                    elif prof["unique_count"] <= 5: score += 10
                    if prof["unique_count"] == 1: score -= 50
                    if score >= 35:
                        candidates.append({"name": col, "score": min(score, 100), **prof})
                candidates.sort(key=lambda c: c["score"], reverse=True)

                # 3. Overall quality signal
                overall_missing = round(df.isna().mean().mean(), 4)
                dup_pct = round(float(df.duplicated().mean()), 4)
                num_cols = df.select_dtypes(include=[np.number]).shape[1]
                cat_cols = df.select_dtypes(exclude=[np.number]).shape[1]
                quality_score = max(0.0, 100.0 - overall_missing * 60 - dup_pct * 30)

                profile = {
                    "dataset_id": dataset_meta["dataset_id"],
                    "rows_analyzed": int(df.shape[0]),
                    "total_columns": int(df.shape[1]),
                    "numeric_columns": int(num_cols),
                    "categorical_columns": int(cat_cols),
                    "overall_missing_pct": overall_missing,
                    "duplicate_pct": dup_pct,
                    "quality_score": round(quality_score, 1),
                    "target_candidates": candidates[:5],
                    "columns": col_profiles,
                    "profiled_at": datetime.utcnow().isoformat(),
                }

                cache_key = f"auto_profile:{dataset_meta['dataset_id']}"
                self._cache_set(cache_key, profile)

            except Exception as e:
                # Non-fatal — profiling failure is logged but swallowed
                import traceback
                traceback.print_exc()

        threading.Thread(target=_run, daemon=True).start()

    def _get_cached_profile(self, dataset_id: int) -> Optional[Dict]:
        """Return cached auto-profile if available (non-blocking)."""
        try:
            cache_key = f"auto_profile:{dataset_id}"
            return self._cache_get(cache_key, ttl_seconds=86400)  # 24h TTL
        except Exception:
            return None

    def get_dataset_profile(self, dataset_id: int) -> Optional[Dict]:
        """
        Public method: return cached profile or trigger a fresh one.
        Called by the new GET /api/mlops/datasets/<id>/profile endpoint.
        """
        cached = self._get_cached_profile(dataset_id)
        if cached:
            return cached
        # Profile not yet available (upload still processing) — return None
        return None


    def sync_from_directory(
        self,
        tenant_id: str,
        env_id: str,
        data_dir: Path,
        force: bool = False,
    ) -> List[Dict]:
        """
        Register CSV/Parquet files discovered in an env data folder.

        register_dataset() computes full row counts and schema, which is expensive
        for large CSVs. For startup responsiveness we skip files that are already
        in the registry unless force=True.
        """
        datasets: List[Dict[str, Any]] = []
        if not data_dir.exists():
            return datasets

        existing = {
            str(d.get("dataset_type") or "").strip().lower(): d
            for d in self.list_datasets(tenant_id, env_id)
            if d.get("dataset_type")
        }

        files: List[Path] = []
        files.extend(sorted(data_dir.glob("*.csv")))
        files.extend(sorted(data_dir.glob("*.parquet")))

        for file_path in files:
            dataset_type = str(file_path.stem or "").strip().lower()
            if not dataset_type:
                continue

            cached = existing.get(dataset_type)
            if cached and not force:
                datasets.append(cached)
                continue

            dataset = self.register_dataset(
                tenant_id=tenant_id,
                env_id=env_id,
                dataset_type=dataset_type,
                filename=file_path.name,
                file_path=file_path,
            )
            datasets.append(dataset)
            existing[dataset_type] = dataset

        return datasets

    def _build_column_intelligence(self, df: pd.DataFrame) -> Dict[str, Any]:
        """
        Build upload-time column intelligence used by Data Upload and EDA screens.
        Keeps output lightweight but rich enough for both business and technical personas.
        """
        total_rows = int(df.shape[0])
        details: List[Dict[str, Any]] = []
        columns_map: Dict[str, Dict[str, Any]] = {}
        id_columns: List[Dict[str, Any]] = []
        target_candidates: List[Dict[str, Any]] = []
        high_missing_columns: List[Dict[str, Any]] = []
        high_cardinality_columns: List[Dict[str, Any]] = []
        role_distribution = {
            "identifier": 0,
            "numeric": 0,
            "binary": 0,
            "datetime": 0,
            "categorical": 0,
            "text": 0,
        }

        target_kw = (
            "target", "label", "final_label", "is_true_pos", "is_tp", "is_str", "str_flag",
            "sar", "suspicious", "fraud", "outcome", "result", "decision",
        )

        for col in df.columns:
            series = df[col]
            name = str(col)
            lname = name.strip().lower()

            total = int(series.shape[0])
            null_count = int(series.isna().sum())
            non_null = series.dropna()
            non_null_count = int(non_null.shape[0])
            unique_count = int(non_null.nunique(dropna=True))
            unique_ratio = float(unique_count / max(non_null_count, 1))
            null_pct = float(null_count / max(total, 1))

            sample_value = None
            if non_null_count:
                try:
                    sample_value = str(non_null.iloc[0])
                except Exception:
                    sample_value = None

            is_numeric = pd.api.types.is_numeric_dtype(series)
            is_bool = pd.api.types.is_bool_dtype(series)
            is_datetime = pd.api.types.is_datetime64_any_dtype(series)
            if not is_datetime and (series.dtype == "object" or "date" in lname or "time" in lname):
                parsed = pd.to_datetime(non_null.head(500), errors="coerce")
                parse_ratio = float(parsed.notna().mean()) if len(parsed) else 0.0
                is_datetime = parse_ratio >= 0.80

            id_name_hint = (
                lname == "id"
                or lname.endswith("_id")
                or lname.startswith("id_")
                or "_id_" in lname
                or "identifier" in lname
                or lname.endswith("_key")
                or lname.startswith("key_")
                or "ref" in lname
            )

            identifier_confidence = 0
            id_reasons: List[str] = []
            if id_name_hint:
                identifier_confidence += 45
                id_reasons.append("name pattern suggests key/identifier")
            if unique_ratio >= 0.98:
                identifier_confidence += 30
                id_reasons.append("near-unique values")
            elif unique_ratio >= 0.90:
                identifier_confidence += 18
                id_reasons.append("very high cardinality")
            if null_pct <= 0.02:
                identifier_confidence += 10
            if non_null_count >= 100 and unique_count >= 100:
                identifier_confidence += 8
            if unique_ratio <= 0.25:
                identifier_confidence -= 12

            identifier_confidence = int(max(0, min(100, identifier_confidence)))
            is_identifier = identifier_confidence >= 60

            target_score = 0
            target_reasons: List[str] = []
            if any(k in lname for k in target_kw):
                target_score += 50
                target_reasons.append("name suggests label/target")
            if (is_bool or unique_count == 2) and unique_count > 0:
                target_score += 25
                target_reasons.append("binary distribution")
            if lname.startswith("is_") or lname.endswith("_flag"):
                target_score += 15
                target_reasons.append("boolean-like naming")
            is_target_candidate = target_score >= 45

            if is_identifier:
                role = "identifier"
            elif is_datetime:
                role = "datetime"
            elif is_bool or unique_count == 2:
                role = "binary"
            elif is_numeric:
                role = "numeric"
            elif unique_ratio <= 0.25 or unique_count <= 30:
                role = "categorical"
            else:
                role = "text"

            role_distribution[role] = role_distribution.get(role, 0) + 1

            issue_flags: List[str] = []
            if null_pct >= 0.20:
                issue_flags.append("high_missing")
            if unique_count <= 1:
                issue_flags.append("low_variance")
            if unique_ratio >= 0.85 and not is_identifier and role in {"text", "categorical"} and unique_count >= 50:
                issue_flags.append("high_cardinality")
            if is_target_candidate and role == "numeric" and unique_count > 10:
                issue_flags.append("target_review")

            model_action = "include"
            if is_identifier:
                model_action = "exclude"
            elif "high_missing" in issue_flags or "target_review" in issue_flags:
                model_action = "review"

            value_counts = []
            if unique_count <= 25:
                vc = series.fillna("(missing)").astype(str).value_counts(dropna=False).head(12)
                value_counts = [{"value": str(k), "count": int(v)} for k, v in vc.items()]

            numeric_stats: Dict[str, Any] = {}
            if is_numeric and non_null_count:
                vals = pd.to_numeric(series, errors="coerce").dropna()
                if len(vals):
                    numeric_stats = {
                        "min": float(vals.min()),
                        "max": float(vals.max()),
                        "mean": float(vals.mean()),
                        "median": float(vals.median()),
                        "std": float(vals.std()) if len(vals) > 1 else 0.0,
                    }

            detail = {
                "name": name,
                "dtype": str(series.dtype),
                "role": role,
                "null_count": null_count,
                "null_pct": round(null_pct, 6),
                "unique_count": unique_count,
                "unique_ratio": round(unique_ratio, 6),
                "sample_value": sample_value,
                "is_identifier": bool(is_identifier),
                "identifier_confidence": identifier_confidence,
                "identifier_reason": "; ".join(id_reasons) if id_reasons else "",
                "is_target_candidate": bool(is_target_candidate),
                "target_score": int(min(100, target_score)),
                "target_reason": "; ".join(target_reasons) if target_reasons else "",
                "issue_flags": issue_flags,
                "model_action": model_action,
                "value_counts": value_counts,
                "numeric_stats": numeric_stats,
            }
            details.append(detail)
            columns_map[name] = detail

            if is_identifier:
                id_columns.append({
                    "name": name,
                    "confidence": identifier_confidence,
                    "unique_ratio": round(unique_ratio, 6),
                    "null_pct": round(null_pct, 6),
                    "reason": detail["identifier_reason"],
                })
            if is_target_candidate:
                target_candidates.append({
                    "name": name,
                    "score": int(min(100, target_score)),
                    "dtype": str(series.dtype),
                    "reason": detail["target_reason"],
                })
            if "high_missing" in issue_flags:
                high_missing_columns.append({
                    "name": name,
                    "null_pct": round(null_pct, 6),
                })
            if "high_cardinality" in issue_flags:
                high_cardinality_columns.append({
                    "name": name,
                    "unique_ratio": round(unique_ratio, 6),
                })

        high_missing_columns.sort(key=lambda x: x["null_pct"], reverse=True)
        high_cardinality_columns.sort(key=lambda x: x["unique_ratio"], reverse=True)
        id_columns.sort(key=lambda x: x["confidence"], reverse=True)
        target_candidates.sort(key=lambda x: x["score"], reverse=True)

        overall_missing_pct = float(df.isna().mean().mean()) if total_rows else 0.0
        duplicate_pct = float(df.duplicated().mean()) if total_rows else 0.0
        quality_score = max(
            0.0,
            100.0
            - (overall_missing_pct * 65.0)
            - (duplicate_pct * 25.0)
            - min(20.0, float(len(high_missing_columns)) * 1.5),
        )

        business_signals: List[str] = []
        if id_columns:
            business_signals.append(
                f"Detected {len(id_columns)} identifier/key column(s); exclude them from model features and keep for traceability."
            )
        if high_missing_columns:
            top_missing = ", ".join(c["name"] for c in high_missing_columns[:3])
            business_signals.append(
                f"High missingness found in: {top_missing}. Consider imputation or data enrichment."
            )
        if target_candidates:
            top_target = ", ".join(c["name"] for c in target_candidates[:3])
            business_signals.append(
                f"Potential target label columns detected: {top_target}."
            )
        if duplicate_pct >= 0.02:
            business_signals.append(
                f"Sample duplicate rate is {duplicate_pct * 100:.1f}%; deduplication rules are recommended."
            )
        if not business_signals:
            business_signals.append("No major structural risk detected in sampled data.")

        return {
            "columns_detail": details,
            "columns": columns_map,
            "id_columns": id_columns,
            "target_candidates": target_candidates[:8],
            "high_missing_columns": high_missing_columns[:12],
            "high_cardinality_columns": high_cardinality_columns[:12],
            "role_distribution": role_distribution,
            "overall_missing_pct": round(overall_missing_pct, 6),
            "duplicate_pct": round(duplicate_pct, 6),
            "quality_score": round(quality_score, 2),
            "business_signals": business_signals,
        }

    def schema_preview(self, dataset: Dict, limit: int = 25) -> Dict:
        preview_limit = max(1, int(limit))
        cache_key = f"schema_preview:{dataset.get('dataset_id')}:{preview_limit}"
        cached = self._cache_get(cache_key, ttl_seconds=1800)
        if cached:
            return cached

        rel = self._relation_expr(Path(dataset["file_path"]), sample_size=20000)
        query = f"SELECT * FROM {rel} LIMIT {preview_limit}"
        with duckdb.connect() as conn:
            df = conn.execute(query).df()

        sample_rows = min(max(preview_limit * 200, 1000), 10000)
        sample_df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        intelligence = self._build_column_intelligence(sample_df)

        # ── Per-column technical signals ──────────────────────────────────────
        total = int(sample_df.shape[0])
        col_signals: Dict[str, Dict] = {}
        join_key_candidates: List[str] = []
        for col in sample_df.columns:
            series = sample_df[col]
            lname = col.strip().lower()
            n_unique = int(series.nunique(dropna=True))
            n_non_null = int(series.notna().sum())
            cardinality_ratio = round(float(n_unique / max(n_non_null, 1)), 4)

            # High-cardinality flag: non-identifier columns with cardinality > 95%
            is_id_hint = (
                lname == "id" or lname.endswith("_id") or lname.startswith("id_")
                or "identifier" in lname or lname.endswith("_key")
            )
            high_cardinality = (not is_id_hint) and cardinality_ratio > 0.95

            # Temporal gaps: datetime columns with irregular intervals
            temporal_gaps_detected = False
            if pd.api.types.is_datetime64_any_dtype(series) or any(
                kw in lname for kw in ("date", "time", "timestamp")
            ):
                try:
                    parsed = pd.to_datetime(series, errors="coerce").dropna().sort_values()
                    if len(parsed) > 10:
                        diffs = parsed.diff().dropna().dt.total_seconds()
                        cv = float(diffs.std() / (diffs.mean() + 1e-9))
                        temporal_gaps_detected = cv > 2.0
                except Exception:
                    pass

            # Join key candidate detection
            if is_id_hint and cardinality_ratio > 0.05:
                join_key_candidates.append(col)

            col_signals[col] = {
                "cardinality_ratio": cardinality_ratio,
                "high_cardinality": high_cardinality,
                "temporal_gaps_detected": temporal_gaps_detected,
                "is_join_key_candidate": col in join_key_candidates,
            }

        payload = {
            "columns": list(df.columns),
            "rows": df.fillna("").to_dict(orient="records"),
            "row_count": int(df.shape[0]),
            "total_rows": int(dataset.get("row_count") or 0),
            "column_types": dataset.get("column_types") or {},
            "columns_detail": intelligence.get("columns_detail") or [],
            "id_columns": intelligence.get("id_columns") or [],
            "role_distribution": intelligence.get("role_distribution") or {},
            "quality_score": intelligence.get("quality_score"),
            "col_signals": col_signals,
            "join_key_candidates": join_key_candidates,
        }
        self._cache_set(cache_key, payload)
        return payload

    def profile_metadata(self, dataset: Dict, sample_rows: int) -> Dict:
        cache_key = f"profile:{dataset['dataset_id']}:{sample_rows}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        intelligence = self._build_column_intelligence(df)
        missing_pct = {k: float(v) for k, v in df.isna().mean().to_dict().items()}
        cardinality = {k: int(v) for k, v in df.nunique(dropna=True).to_dict().items()}
        numeric_df = df.select_dtypes(include=[np.number])
        stats = numeric_df.describe().to_dict()

        # ── Business-persona enrichment ────────────────────────────────────────
        total_rows = int(df.shape[0])
        flag_rate: Optional[float] = None
        for col in df.columns:
            lname = col.strip().lower()
            if any(kw in lname for kw in ("flag", "str", "sar", "suspicious", "is_tp", "target", "label")):
                try:
                    numeric = pd.to_numeric(df[col], errors="coerce")
                    if numeric.notna().any() and numeric.dropna().isin([0, 1]).all():
                        flag_rate = round(float(numeric.mean()), 4)
                        break
                    text_series = df[col].astype(str).str.strip().str.lower()
                    pos = text_series.isin({"1", "true", "yes", "y", "flagged", "suspicious"})
                    flag_rate = round(float(pos.mean()), 4)
                    break
                except Exception:
                    continue

        # Coverage: fraction of rows where the most likely join key is non-null
        coverage_pct: Optional[float] = None
        for col in df.columns:
            lname = col.strip().lower()
            if lname.endswith("_id") or lname in ("account_id", "customer_id", "transaction_id"):
                coverage_pct = round(float(df[col].notna().mean()) * 100, 2)
                break

        # Data freshness: days since max value of any date-like column
        data_freshness_days: Optional[int] = None
        for col in df.columns:
            lname = col.strip().lower()
            if any(kw in lname for kw in ("date", "time", "timestamp", "created", "updated")):
                try:
                    parsed = pd.to_datetime(df[col], errors="coerce")
                    max_date = parsed.dropna().max()
                    if pd.notna(max_date):
                        data_freshness_days = int((pd.Timestamp.now() - max_date).days)
                        break
                except Exception:
                    continue

        # Unique entity count from a customer/account id column
        unique_entity_count: Optional[int] = None
        for col in df.columns:
            lname = col.strip().lower()
            if lname in ("customer_id", "account_id", "entity_id"):
                unique_entity_count = int(df[col].nunique(dropna=True))
                break

        # Business narrative string
        parts = []
        total_display = int(dataset.get("row_count") or total_rows)
        if total_display:
            parts.append(f"{total_display:,} {dataset.get('dataset_type', 'records').replace('_', ' ')} records")
        if data_freshness_days is not None and data_freshness_days >= 0:
            parts.append(f"{data_freshness_days} days since last record")
        if unique_entity_count is not None:
            parts.append(f"{unique_entity_count:,} unique entities")
        if flag_rate is not None:
            parts.append(f"{flag_rate * 100:.1f}% flagged")
        if coverage_pct is not None:
            parts.append(f"{coverage_pct:.0f}% key coverage")
        business_narrative = " · ".join(parts) if parts else "No summary available"

        payload = {
            "rows_analyzed": total_rows,
            "total_rows": int(dataset.get("row_count") or total_rows),
            "total_columns": int(df.shape[1]),
            "missing_pct": missing_pct,
            "cardinality": cardinality,
            "numeric_stats": stats,
            "columns": intelligence.get("columns") or {},
            "columns_detail": intelligence.get("columns_detail") or [],
            "id_columns": intelligence.get("id_columns") or [],
            "target_candidates": intelligence.get("target_candidates") or [],
            "high_missing_columns": intelligence.get("high_missing_columns") or [],
            "high_cardinality_columns": intelligence.get("high_cardinality_columns") or [],
            "role_distribution": intelligence.get("role_distribution") or {},
            "overall_missing_pct": intelligence.get("overall_missing_pct"),
            "duplicate_pct": intelligence.get("duplicate_pct"),
            "quality_score": intelligence.get("quality_score"),
            "model_excluded_columns": [c.get("name") for c in (intelligence.get("id_columns") or [])],
            "business_signals": intelligence.get("business_signals") or [],
            # Business-persona fields
            "flag_rate": flag_rate,
            "coverage_pct": coverage_pct,
            "data_freshness_days": data_freshness_days,
            "unique_entity_count": unique_entity_count,
            "business_narrative": business_narrative,
        }
        self._cache_set(cache_key, payload)
        return payload

    def join_relationships(self, datasets: List[Dict], sample_rows: int = 20000) -> Dict:
        join_keys = ["account_id", "customer_id", "transaction_id", "case_id"]
        joins = []
        for i, left in enumerate(datasets):
            for right in datasets[i + 1:]:
                left_cols = set(left.get("columns") or [])
                right_cols = set(right.get("columns") or [])
                common = [k for k in join_keys if k.upper() in {c.upper() for c in left_cols} and k.upper() in {c.upper() for c in right_cols}]
                if not common:
                    continue
                left_rel = self._relation_expr(Path(left["file_path"]), sample_size=20000)
                right_rel = self._relation_expr(Path(right["file_path"]), sample_size=20000)
                for key in common:
                    key_left = next((c for c in left_cols if c.upper() == key.upper()), key)
                    key_right = next((c for c in right_cols if c.upper() == key.upper()), key)
                    query = f"""
                        SELECT COUNT(*) AS matched
                        FROM (SELECT "{key_left}" AS k FROM {left_rel} LIMIT {int(sample_rows)}) l
                        INNER JOIN (SELECT "{key_right}" AS k FROM {right_rel} LIMIT {int(sample_rows)}) r
                        ON l.k = r.k
                    """
                    with duckdb.connect() as conn:
                        matched = conn.execute(query).fetchone()[0]
                    joins.append(
                        {
                            "left": left["dataset_type"],
                            "right": right["dataset_type"],
                            "key": key_left,
                            "matched_rows": int(matched or 0),
                        }
                    )
        return {"relationships": joins}

    def derive_target(
        self,
        tenant_id: str,
        env_id: str,
        dataset: Dict,
        strategy: str,
        config: Dict,
    ) -> Dict:
        config = dict(config or {})
        df = self._load_sample_df(Path(dataset["file_path"]), None, int(config.get("sample_rows", 5000)))
        strategy = (strategy or "case_outcome").lower()

        def _resolve_column(name: Optional[str]) -> Optional[str]:
            if not name:
                return None
            raw = str(name).strip()
            if not raw:
                return None
            if raw in df.columns:
                return raw
            lookup = {str(c).lower(): str(c) for c in df.columns}
            return lookup.get(raw.lower())

        target = None
        selected_target_col = None

        requested_col = (
            config.get("flag_column")
            or config.get("column")
            or config.get("target_column")
        )

        # "existing" is used by Step 3 when a user picks a concrete label column.
        if strategy in {"existing", "column", "manual"}:
            selected_target_col = _resolve_column(requested_col)
            if selected_target_col:
                target = df[selected_target_col]
        elif strategy == "str":
            selected_target_col = _resolve_column(requested_col or "is_str")
            if selected_target_col:
                target = df[selected_target_col]
        elif strategy == "case_outcome":
            selected_target_col = _resolve_column(requested_col or "case_outcome")
            if selected_target_col:
                target = df[selected_target_col]
        elif strategy == "hybrid":
            str_col = _resolve_column(config.get("str_column") or "is_str")
            case_col = _resolve_column(config.get("case_column") or "case_outcome")
            if str_col and case_col:
                target = (df[str_col].fillna(0).astype(int) | df[case_col].fillna(0).astype(int))

        # Fallback: if a specific column was requested, use it even if strategy was generic.
        if target is None and requested_col:
            selected_target_col = _resolve_column(requested_col)
            if selected_target_col:
                target = df[selected_target_col]

        # Fallback to a literal "target" column when present.
        if target is None:
            target_name = _resolve_column("target")
            if target_name:
                selected_target_col = target_name
                target = df[target_name]

        if target is None:
            raise ValueError(
                f"Target column not found for strategy '{strategy}'. "
                "Provide a valid column via 'column' or 'config.flag_column'."
            )

        counts = target.value_counts(dropna=False).to_dict()
        total = float(target.shape[0]) if target is not None else 0.0
        imbalance = None
        if total:
            positives = float(counts.get(1, counts.get(True, 0)) or 0.0)
            imbalance = positives / total
        summary = {
            "counts": {str(k): int(v) for k, v in counts.items()},
            "imbalance": float(imbalance) if imbalance is not None else None,
        }
        with get_connection(self.db_path) as conn:
            target_id = conn.execute("SELECT nextval('mlops_snapshot_seq')").fetchone()[0]
            conn.execute(
                """
                INSERT INTO mlops_targets (target_id, tenant_id, env_id, dataset_id, name, strategy, config_json, summary_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(target_id),
                    tenant_id,
                    env_id,
                    int(dataset["dataset_id"]),
                    config.get("name") or f"Target {selected_target_col or strategy}",
                    strategy,
                    json.dumps(config or {}, default=str),
                    json.dumps(summary or {}, default=str),
                ],
            )
        return {
            "target_id": int(target_id),
            "target_column": selected_target_col,
            "strategy": strategy,
            "summary": summary,
        }

    def list_pipelines(self, tenant_id: str, env_id: str, dataset_id: Optional[int]) -> List[Dict]:
        workflow_sessions = self._list_workflow_sessions(tenant_id, env_id)
        workflow_by_pipeline: Dict[int, Dict[str, Any]] = {}
        for session in workflow_sessions:
            pipeline_id = session.get("pipeline_id")
            if pipeline_id is None:
                continue
            pipeline_key = int(pipeline_id)
            if pipeline_key not in workflow_by_pipeline:
                workflow_by_pipeline[pipeline_key] = session

        with get_connection(self.db_path) as conn:
            if dataset_id is None:
                rows = conn.execute(
                    """
                    SELECT pipeline_id, name, steps_json, created_at, updated_at,
                           status, version, last_run_at, output_dataset_id,
                           dataset_id, grain, created_by_persona,
                           dataset_ids_json, schedule_json
                    FROM mlops_pipelines
                    WHERE tenant_id = ? AND env_id = ?
                    ORDER BY updated_at DESC
                    """,
                    [tenant_id, env_id],
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT pipeline_id, name, steps_json, created_at, updated_at,
                           status, version, last_run_at, output_dataset_id,
                           dataset_id, grain, created_by_persona,
                           dataset_ids_json, schedule_json
                    FROM mlops_pipelines
                    WHERE tenant_id = ? AND env_id = ? AND dataset_id = ?
                    ORDER BY updated_at DESC
                    """,
                    [tenant_id, env_id, int(dataset_id)],
                ).fetchall()
        results: List[Dict[str, Any]] = []
        healed_pipelines: List[Tuple[int, List[Dict[str, Any]]]] = []
        for r in rows:
            steps = json.loads(r[2] or "[]")
            steps, healed = _reconcile_dependency_state_steps(steps)
            if healed:
                healed_pipelines.append((int(r[0]), steps))
            record = {
                "pipeline_id": int(r[0]),
                "run_ref": f"FCC-RUN-{int(r[0]):05d}",
                "name": r[1],
                "steps": steps,
                "created_at": r[3].isoformat() if hasattr(r[3], "isoformat") else r[3],
                "updated_at": r[4].isoformat() if hasattr(r[4], "isoformat") else r[4],
                "status": r[5] or "draft",
                "version": int(r[6] or 1),
                "last_run_at": r[7].isoformat() if hasattr(r[7], "isoformat") else r[7],
                "output_dataset_id": int(r[8]) if r[8] is not None else None,
                "dataset_id": int(r[9]) if r[9] is not None else None,
                "grain": r[10] or "transaction",
                "created_by_persona": r[11] or "technical",
                "dataset_ids": json.loads(r[12] or "[]"),
                "schedule": json.loads(r[13] or "{}"),
            }
            record.update(_progress_summary_from_steps(steps, status=record["status"]))
            results.append(
                self._apply_workflow_summary(
                    record,
                    workflow_by_pipeline.get(int(record["pipeline_id"])),
                )
            )
        if healed_pipelines:
            with get_connection(self.db_path) as conn:
                for pipeline_id, healed_steps in healed_pipelines:
                    conn.execute(
                        """
                        UPDATE mlops_pipelines
                        SET steps_json = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                        """,
                        [json.dumps(healed_steps, default=str), int(pipeline_id), tenant_id, env_id],
                    )
        if dataset_id is None:
            valid_pipeline_ids = {
                int(record.get("pipeline_id"))
                for record in results
                if record.get("pipeline_id") is not None
            }
            valid_pipeline_names = {
                str(record.get("name") or "").strip().lower()
                for record in results
                if str(record.get("name") or "").strip()
            }
            orphan_session_ids: List[str] = []
            trivial_session_ids: List[str] = []

            def _session_pipeline_ref(session_record: Dict[str, Any]) -> Optional[int]:
                candidates = [
                    session_record.get("pipeline_id"),
                    (session_record.get("current_state") or {}).get("pipeline_id") if isinstance(session_record.get("current_state"), dict) else None,
                    (
                        (session_record.get("current_state") or {}).get("mlops_state") or {}
                    ).get("pipeline_id")
                    if isinstance((session_record.get("current_state") or {}).get("mlops_state"), dict)
                    else None,
                    (
                        (session_record.get("last_stable_state") or {}).get("mlops_state") or {}
                    ).get("pipeline_id")
                    if isinstance((session_record.get("last_stable_state") or {}).get("mlops_state"), dict)
                    else None,
                ]
                for value in candidates:
                    try:
                        parsed = int(value)
                        if parsed > 0:
                            return parsed
                    except Exception:
                        continue
                journey_key = str(session_record.get("journey_key") or "").strip().lower()
                if journey_key.startswith("pipeline::"):
                    try:
                        parsed = int(journey_key.split("::", 1)[1])
                        return parsed if parsed > 0 else None
                    except Exception:
                        return None
                return None

            seen_session_ids = {
                str(record.get("workflow_session_id") or "").strip()
                for record in results
                if str(record.get("workflow_session_id") or "").strip()
            }
            for session in workflow_sessions:
                session_id = str(session.get("session_id") or "").strip()
                if not session_id or session_id in seen_session_ids:
                    continue
                session_pipeline_id = _session_pipeline_ref(session)
                session_pipeline_name = str(session.get("pipeline_name") or "").strip().lower()
                if session_pipeline_id is not None:
                    if session_pipeline_id not in valid_pipeline_ids:
                        orphan_session_ids.append(session_id)
                    continue
                if session_pipeline_name and session_pipeline_name in valid_pipeline_names:
                    orphan_session_ids.append(session_id)
                    continue
                if not self._workflow_session_has_meaningful_state(session):
                    trivial_session_ids.append(session_id)
                    continue
                results.append(self._workflow_session_manager_record(session))
            cleanup_session_ids = orphan_session_ids + trivial_session_ids
            if cleanup_session_ids:
                placeholders = ",".join(["?"] * len(cleanup_session_ids))
                with get_connection(self.db_path) as conn:
                    conn.execute(
                        f"""
                        DELETE FROM mlops_workflow_sessions
                        WHERE tenant_id = ? AND env_id = ? AND session_id IN ({placeholders})
                        """,
                        [tenant_id, env_id, *cleanup_session_ids],
                    )
        results.sort(
            key=lambda record: str(
                record.get("last_active_at")
                or record.get("workflow_updated_at")
                or record.get("updated_at")
                or record.get("created_at")
                or ""
            ),
            reverse=True,
        )
        return results

    def save_pipeline(
        self,
        tenant_id: str,
        env_id: str,
        dataset_id: int,
        name: str,
        steps: List[Dict],
        *,
        grain: str = "transaction",
        anchor_dataset_id: Optional[int] = None,
        dataset_ids: Optional[List[int]] = None,
        joins: Optional[List[Dict]] = None,
        transforms: Optional[List[Dict]] = None,
        str_config: Optional[Dict] = None,
        schedule: Optional[Dict] = None,
        output_name: str = "master_dataset",
        created_by_persona: str = "technical",
    ) -> Dict:
        """
        Save or update a master-dataset pipeline definition.

        Accepts the original (tenant_id, env_id, dataset_id, name, steps) signature
        for backward compatibility, plus keyword-only extended parameters for the
        full pipeline engine.

        Returns { pipeline_id, version, name, status }
        """
        with get_connection(self.db_path) as conn:
            # Check for an existing pipeline for this env with the same name
            existing = conn.execute(
                """
                SELECT pipeline_id, version
                FROM mlops_pipelines
                WHERE tenant_id = ? AND env_id = ? AND name = ?
                LIMIT 1
                """,
                [tenant_id, env_id, name],
            ).fetchone()

            full_steps_json = json.dumps(steps or [], default=str)
            joins_json      = json.dumps(joins or [], default=str)
            transforms_json = json.dumps(transforms or [], default=str)
            str_config_json = json.dumps(str_config or {}, default=str)
            schedule_json   = json.dumps(schedule or {}, default=str)
            dataset_ids_json = json.dumps(dataset_ids or [], default=str)

            if existing:
                pipeline_id = int(existing[0])
                new_version = int(existing[1] or 1) + 1
                conn.execute(
                    """
                    UPDATE mlops_pipelines SET
                      dataset_id = ?, steps_json = ?, grain = ?,
                      anchor_dataset_id = ?, dataset_ids_json = ?,
                      joins_json = ?, transforms_json = ?, str_config_json = ?,
                      schedule_json = ?, output_name = ?,
                      created_by_persona = ?, status = 'saved',
                      version = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pipeline_id = ?
                    """,
                    [
                        int(dataset_id) if dataset_id else None,
                        full_steps_json, grain,
                        int(anchor_dataset_id) if anchor_dataset_id else None,
                        dataset_ids_json, joins_json, transforms_json,
                        str_config_json, schedule_json, output_name,
                        created_by_persona, new_version, pipeline_id,
                    ],
                )
            else:
                pipeline_id = conn.execute("SELECT nextval('mlops_snapshot_seq')").fetchone()[0]
                new_version = 1
                conn.execute(
                    """
                    INSERT INTO mlops_pipelines (
                      pipeline_id, tenant_id, env_id, dataset_id, name, steps_json,
                      grain, anchor_dataset_id, dataset_ids_json,
                      joins_json, transforms_json, str_config_json,
                      schedule_json, output_name, created_by_persona, status, version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?)
                    """,
                    [
                        int(pipeline_id), tenant_id, env_id,
                        int(dataset_id) if dataset_id else None,
                        name, full_steps_json, grain,
                        int(anchor_dataset_id) if anchor_dataset_id else None,
                        dataset_ids_json, joins_json, transforms_json,
                        str_config_json, schedule_json, output_name,
                        created_by_persona, new_version,
                    ],
                )

            # Write version snapshot
            try:
                ver_id = conn.execute("SELECT nextval('mlops_snapshot_seq')").fetchone()[0]
                conn.execute(
                    """
                    INSERT INTO mlops_pipeline_versions
                      (version_id, pipeline_id, tenant_id, env_id, version, name, grain, steps_json, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'saved')
                    """,
                    [
                        int(ver_id), int(pipeline_id), tenant_id, env_id,
                        new_version, name, grain, full_steps_json,
                    ],
                )
            except Exception:
                pass  # version snapshot is best-effort

            self._sync_pipeline_asset_links_for_pipeline(
                conn,
                tenant_id,
                env_id,
                {
                    "pipeline_id": int(pipeline_id),
                    "dataset_id": int(dataset_id) if dataset_id else None,
                    "anchor_dataset_id": int(anchor_dataset_id) if anchor_dataset_id else None,
                    "dataset_ids": list(dataset_ids or []),
                    "output_dataset_id": None,
                    "steps": list(steps or []),
                },
            )

        return {
            "pipeline_id": int(pipeline_id),
            "version": new_version,
            "name": name,
            "status": "saved",
        }

    def load_pipeline(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict:
        """Return the full pipeline definition record."""
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT pipeline_id, name, steps_json, dataset_id, grain, anchor_dataset_id,
                       dataset_ids_json, joins_json, transforms_json, str_config_json,
                       schedule_json, output_name, status, version,
                       created_by_persona, created_at, updated_at,
                       last_run_at, output_dataset_id
                FROM mlops_pipelines
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [int(pipeline_id), tenant_id, env_id],
            ).fetchone()
            if row:
                self._backfill_pipeline_asset_links(conn, tenant_id, env_id, [int(pipeline_id)])
            event_rows = conn.execute(
                """
                SELECT event_id, session_id, screen, step_id, event_type, status,
                       checkpoint_key, state_json, created_at
                FROM mlops_pipeline_step_events
                WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ?
                ORDER BY created_at DESC, event_id DESC
                LIMIT 50
                """,
                [tenant_id, env_id, int(pipeline_id)],
            ).fetchall()
            asset_link_rows = self._list_pipeline_asset_links(conn, tenant_id, env_id, int(pipeline_id)) if row else []
        if not row:
            raise ValueError(f"Pipeline {pipeline_id} not found")
        healed_steps, healed = _reconcile_dependency_state_steps(json.loads(row[2] or "[]"))
        if healed:
            with get_connection(self.db_path) as conn:
                conn.execute(
                    """
                    UPDATE mlops_pipelines
                    SET steps_json = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                    """,
                    [json.dumps(healed_steps, default=str), int(pipeline_id), tenant_id, env_id],
                )
        result = {
            "pipeline_id": int(row[0]),
            "run_ref": f"FCC-RUN-{int(row[0]):05d}",
            "name": row[1],
            "steps": healed_steps if healed else json.loads(row[2] or "[]"),
            "dataset_id": int(row[3]) if row[3] is not None else None,
            "grain": row[4] or "transaction",
            "anchor_dataset_id": int(row[5]) if row[5] is not None else None,
            "dataset_ids": json.loads(row[6] or "[]"),
            "joins": json.loads(row[7] or "[]"),
            "transforms": json.loads(row[8] or "[]"),
            "str_config": json.loads(row[9] or "{}"),
            "schedule": json.loads(row[10] or "{}"),
            "output_name": row[11] or "master_dataset",
            "status": row[12] or "draft",
            "version": int(row[13] or 1),
            "created_by_persona": row[14] or "technical",
            "created_at": row[15].isoformat() if hasattr(row[15], "isoformat") else row[15],
            "updated_at": row[16].isoformat() if hasattr(row[16], "isoformat") else row[16],
            "last_run_at": row[17].isoformat() if hasattr(row[17], "isoformat") else row[17],
            "output_dataset_id": int(row[18]) if row[18] is not None else None,
            "step_events": [
                {
                    "event_id": int(event_row[0]),
                    "session_id": _normalize_optional_text(event_row[1]),
                    "screen": _normalize_optional_text(event_row[2]),
                    "step_id": _normalize_optional_text(event_row[3]),
                    "event_type": _normalize_optional_text(event_row[4]),
                    "status": _normalize_optional_text(event_row[5]),
                    "checkpoint_key": _normalize_optional_text(event_row[6]),
                    "state": json.loads(event_row[7] or "{}"),
                    "created_at": event_row[8].isoformat() if hasattr(event_row[8], "isoformat") else event_row[8],
                }
                for event_row in (event_rows or [])
            ],
            "asset_links": asset_link_rows,
        }
        result.update(_progress_summary_from_steps(result["steps"], status=result["status"]))
        workflow_session = self.get_workflow_session(tenant_id, env_id, pipeline_id=int(pipeline_id))
        hydrated = self._apply_workflow_summary(result, workflow_session)
        if workflow_session:
            hydrated["workflow_session"] = workflow_session
        return hydrated

    def _list_workflow_sessions(self, tenant_id: str, env_id: str) -> List[Dict[str, Any]]:
        try:
            with get_connection(self.db_path) as conn:
                rows = conn.execute(
                    """
                    SELECT session_id, journey_key, tenant_id, env_id, pipeline_id, pipeline_name,
                           run_id, deployment_id, publish_id, current_module, current_step,
                           current_state_json, last_stable_step, last_stable_state_json,
                           case_scope_json, selected_case_id, handoff_summary_json,
                           checkpoint_key, status, created_at, updated_at
                    FROM mlops_workflow_sessions
                    WHERE tenant_id = ? AND env_id = ?
                    ORDER BY updated_at DESC
                    """,
                    [tenant_id, env_id],
                ).fetchall()
        except Exception:
            return []

        sessions: List[Dict[str, Any]] = []
        for row in rows:
            session = self._normalize_workflow_session_row(row)
            if session:
                sessions.append(session)
        return sessions

    def _apply_workflow_summary(
        self,
        record: Dict[str, Any],
        session: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        next_record = dict(record or {})
        next_record.setdefault("workflow_session_id", None)
        next_record.setdefault("workflow_status", next_record.get("run_status") or next_record.get("status"))
        next_record.setdefault("current_module", "mlops")
        next_record.setdefault("current_module_label", "FCC")
        next_record.setdefault("current_workspace", "FCC")
        next_record.setdefault("workspace_step", next_record.get("current_step"))
        next_record.setdefault("workspace_step_label", next_record.get("current_step_label"))
        next_record.setdefault("fcc_current_step", next_record.get("current_step"))
        next_record.setdefault("fcc_current_step_label", next_record.get("current_step_label"))
        next_record.setdefault("run_id", None)
        next_record.setdefault("deployment_id", None)
        next_record.setdefault("publish_id", None)
        next_record.setdefault("selected_case_id", None)
        next_record.setdefault("case_scope_count", 0)
        next_record.setdefault("case_ids", [])
        next_record.setdefault("last_checkpoint_key", None)
        next_record.setdefault("workflow_updated_at", None)
        next_record.setdefault("last_active_at", next_record.get("updated_at") or next_record.get("created_at"))
        next_record.setdefault("created_by_label", next_record.get("created_by_persona") or "technical")
        next_record["steps_completed_display"] = (
            f"{int(next_record.get('completed_steps') or 0)}/{int(next_record.get('total_steps') or len(_PROGRESS_STAGE_ORDER))}"
        )

        if not session:
            return next_record

        current_state = session.get("current_state") if isinstance(session.get("current_state"), dict) else {}
        last_stable_state = session.get("last_stable_state") if isinstance(session.get("last_stable_state"), dict) else {}
        mlops_state = current_state.get("mlops_state") if isinstance(current_state.get("mlops_state"), dict) else {}
        last_stable_mlops_state = (
            last_stable_state.get("mlops_state")
            if isinstance(last_stable_state.get("mlops_state"), dict)
            else {}
        )
        handoff_summary = session.get("handoff_summary") if isinstance(session.get("handoff_summary"), dict) else {}
        case_scope = session.get("case_scope") if isinstance(session.get("case_scope"), dict) else {}

        current_module = session.get("current_module") or "mlops"
        workspace_step = (
            session.get("current_step")
            or current_state.get("preferred_screen")
            or mlops_state.get("current_step")
            or next_record.get("current_step")
        )
        fcc_current_step = (
            mlops_state.get("current_step")
            or last_stable_mlops_state.get("current_step")
            or next_record.get("current_step")
        )
        case_ids = _workflow_case_ids(case_scope, handoff_summary)

        next_record.update(
            {
                "workflow_session_id": session.get("session_id"),
                "workflow_status": session.get("status") or next_record.get("workflow_status"),
                "current_module": current_module,
                "current_module_label": _workflow_workspace_label(current_module),
                "current_workspace": _workflow_workspace_label(current_module),
                "workspace_step": workspace_step,
                "workspace_step_label": _workflow_workspace_step_label(current_module, workspace_step)
                or next_record.get("current_step_label"),
                "fcc_current_step": fcc_current_step,
                "fcc_current_step_label": _workflow_workspace_step_label("mlops", fcc_current_step)
                or next_record.get("current_step_label"),
                "run_id": session.get("run_id")
                or mlops_state.get("run_id")
                or handoff_summary.get("run_id")
                or next_record.get("run_id"),
                "deployment_id": session.get("deployment_id")
                or mlops_state.get("deployment_id")
                or handoff_summary.get("deployment_id")
                or next_record.get("deployment_id"),
                "publish_id": session.get("publish_id")
                or handoff_summary.get("publish_id")
                or next_record.get("publish_id"),
                "selected_case_id": session.get("selected_case_id")
                or handoff_summary.get("selected_case_id"),
                "case_scope_count": len(case_ids),
                "case_ids": case_ids,
                "last_checkpoint_key": session.get("checkpoint_key"),
                "workflow_updated_at": session.get("updated_at"),
                "last_active_at": session.get("updated_at")
                or next_record.get("updated_at")
                or next_record.get("created_at"),
            }
        )
        next_record["created_by_label"] = (
            next_record.get("created_by_user")
            or mlops_state.get("created_by_user")
            or next_record.get("created_by_persona")
            or "technical"
        )
        next_record["steps_completed_display"] = (
            f"{int(next_record.get('completed_steps') or 0)}/{int(next_record.get('total_steps') or len(_PROGRESS_STAGE_ORDER))}"
        )
        return next_record

    def _workflow_session_manager_record(self, session: Dict[str, Any]) -> Dict[str, Any]:
        current_state = session.get("current_state") if isinstance(session.get("current_state"), dict) else {}
        mlops_state = current_state.get("mlops_state") if isinstance(current_state.get("mlops_state"), dict) else {}
        handoff_summary = session.get("handoff_summary") if isinstance(session.get("handoff_summary"), dict) else {}
        pipeline_name = (
            session.get("pipeline_name")
            or mlops_state.get("pipeline_name")
            or handoff_summary.get("pipeline_name")
            or session.get("run_id")
            or f"Workflow {str(session.get('session_id') or '')[:8]}"
        )
        dataset_id_raw = (
            mlops_state.get("preprocess_dataset_id")
            or mlops_state.get("master_dataset_id")
            or handoff_summary.get("dataset_id")
        )
        try:
            dataset_id = int(dataset_id_raw) if dataset_id_raw not in (None, "", []) else None
        except Exception:
            dataset_id = None

        completed_steps = mlops_state.get("completed_steps")
        total_steps = mlops_state.get("total_steps")
        completion_pct = mlops_state.get("completion_pct")
        current_step = (
            session.get("current_step")
            or current_state.get("preferred_screen")
            or mlops_state.get("current_step")
        )
        current_step_label = (
            _workflow_workspace_step_label(session.get("current_module"), current_step)
            or mlops_state.get("current_step_label")
            or _workflow_workspace_step_label("mlops", mlops_state.get("current_step"))
        )

        record = {
            "manager_key": f"workflow::{session.get('session_id')}",
            "pipeline_id": None,
            "run_ref": session.get("run_id")
            or session.get("publish_id")
            or session.get("deployment_id")
            or session.get("session_id"),
            "name": pipeline_name,
            "steps": [],
            "created_at": session.get("created_at"),
            "updated_at": session.get("updated_at"),
            "status": session.get("status") or "draft",
            "version": 1,
            "last_run_at": session.get("updated_at"),
            "output_dataset_id": None,
            "dataset_id": dataset_id,
            "grain": mlops_state.get("grain") or "transaction",
            "created_by_persona": mlops_state.get("persona") or "technical",
            "dataset_ids": [],
            "schedule": {},
            "completion_pct": completion_pct if completion_pct not in (None, "") else 0,
            "completed_steps": int(completed_steps) if completed_steps not in (None, "") else 0,
            "total_steps": int(total_steps) if total_steps not in (None, "") else len(_PROGRESS_STAGE_ORDER),
            "current_step": current_step,
            "current_step_label": current_step_label,
            "run_status": session.get("status") or "draft",
        }
        return self._apply_workflow_summary(record, session)

    def _workflow_session_has_meaningful_state(self, session: Optional[Dict[str, Any]]) -> bool:
        if not isinstance(session, dict):
            return False

        def _positive_int(value: Any) -> bool:
            try:
                return int(value) > 0
            except Exception:
                return False

        for key in ("pipeline_id", "run_id", "deployment_id", "publish_id", "selected_case_id"):
            value = session.get(key)
            if key == "pipeline_id":
                if _positive_int(value):
                    return True
            elif _normalize_optional_text(value):
                return True

        checkpoint_key = _normalize_optional_text(session.get("checkpoint_key"))
        if checkpoint_key and checkpoint_key != "FCC_SESSION_STARTED":
            return True

        status_text = _normalize_optional_text(session.get("status")) or ""
        if status_text and status_text not in {"draft", "in_progress"}:
            return True

        for container in ("case_scope", "handoff_summary"):
            value = session.get(container)
            if isinstance(value, dict) and value:
                return True

        def _state_has_details(state: Any) -> bool:
            if not isinstance(state, dict):
                return False
            mlops_state = state.get("mlops_state") if isinstance(state.get("mlops_state"), dict) else {}
            for candidate in (state, mlops_state):
                if not isinstance(candidate, dict):
                    continue
                if isinstance(candidate.get("datasets"), list) and candidate.get("datasets"):
                    return True
                if _positive_int(candidate.get("datasets_count")):
                    return True
                for numeric_key in (
                    "master_dataset_id",
                    "preprocess_dataset_id",
                    "dataset_id",
                    "completion_pct",
                    "completed_steps",
                ):
                    if _positive_int(candidate.get(numeric_key)):
                        return True
                for text_key in (
                    "target_column",
                    "model_job_id",
                    "validation_report_id",
                    "registry_stage",
                    "report_run_id",
                    "checkpoint_key",
                ):
                    text_value = _normalize_optional_text(candidate.get(text_key))
                    if text_value:
                        if text_key != "checkpoint_key" or text_value != "FCC_SESSION_STARTED":
                            return True
                if bool(candidate.get("eda_completed")):
                    return True
                if isinstance(candidate.get("preprocess_steps"), list) and candidate.get("preprocess_steps"):
                    return True
                if isinstance(candidate.get("preprocess_plan"), list) and candidate.get("preprocess_plan"):
                    return True
                current_step = _normalize_optional_text(
                    candidate.get("current_step") or candidate.get("preferred_screen")
                )
                if current_step and current_step not in {"data", "pipelines"}:
                    return True
                for object_key in ("master_dataset", "preprocess_dataset", "active_model_run", "validation_report", "registry_entry"):
                    object_value = candidate.get(object_key)
                    if isinstance(object_value, dict) and object_value:
                        return True
            return False

        return _state_has_details(session.get("current_state")) or _state_has_details(session.get("last_stable_state"))

    def _normalize_workflow_session_row(self, row) -> Optional[Dict[str, Any]]:
        if not row:
            return None
        return {
            "session_id": _normalize_text(row[0]),
            "journey_key": _normalize_optional_text(row[1]),
            "tenant_id": _normalize_optional_text(row[2]),
            "env_id": _normalize_optional_text(row[3]),
            "pipeline_id": int(row[4]) if row[4] is not None else None,
            "pipeline_name": _normalize_optional_text(row[5]),
            "run_id": _normalize_optional_text(row[6]),
            "deployment_id": _normalize_optional_text(row[7]),
            "publish_id": _normalize_optional_text(row[8]),
            "current_module": _normalize_optional_text(row[9]),
            "current_step": _normalize_optional_text(row[10]),
            "current_state": _safe_json_loads(row[11], {}),
            "last_stable_step": _normalize_optional_text(row[12]),
            "last_stable_state": _safe_json_loads(row[13], {}),
            "case_scope": _safe_json_loads(row[14], {}),
            "selected_case_id": _normalize_optional_text(row[15]),
            "handoff_summary": _safe_json_loads(row[16], {}),
            "checkpoint_key": _normalize_optional_text(row[17]),
            "status": _normalize_optional_text(row[18]) or "draft",
            "created_at": row[19].isoformat() if hasattr(row[19], "isoformat") else row[19],
            "updated_at": row[20].isoformat() if hasattr(row[20], "isoformat") else row[20],
        }

    def _derive_workflow_journey_key(
        self,
        *,
        pipeline_id: Optional[int] = None,
        run_id: Optional[str] = None,
        deployment_id: Optional[str] = None,
        publish_id: Optional[str] = None,
    ) -> str:
        if run_id:
            return f"run::{run_id}"
        if publish_id:
            return f"publish::{publish_id}"
        if deployment_id:
            return f"deployment::{deployment_id}"
        if pipeline_id is not None:
            return f"pipeline::{int(pipeline_id)}"
        return f"session::{uuid.uuid4().hex[:12]}"

    def get_workflow_session(
        self,
        tenant_id: str,
        env_id: str,
        *,
        session_id: Optional[str] = None,
        pipeline_id: Optional[int] = None,
        run_id: Optional[str] = None,
        deployment_id: Optional[str] = None,
        publish_id: Optional[str] = None,
        current_module: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        filters = ["tenant_id = ?", "env_id = ?"]
        values: List[Any] = [tenant_id, env_id]

        session_id_text = _normalize_optional_text(session_id)
        run_id_text = _normalize_optional_text(run_id)
        deployment_id_text = _normalize_optional_text(deployment_id)
        publish_id_text = _normalize_optional_text(publish_id)
        current_module_text = _normalize_optional_text(current_module)

        if session_id_text:
            filters.append("session_id = ?")
            values.append(session_id_text)
        elif publish_id_text:
            filters.append("publish_id = ?")
            values.append(publish_id_text)
        elif run_id_text:
            filters.append("run_id = ?")
            values.append(run_id_text)
        elif deployment_id_text:
            filters.append("deployment_id = ?")
            values.append(deployment_id_text)
        elif pipeline_id is not None:
            filters.append("pipeline_id = ?")
            values.append(int(pipeline_id))

        if current_module_text:
            filters.append("current_module = ?")
            values.append(current_module_text)

        where_clause = " AND ".join(filters)
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                f"""
                SELECT session_id, journey_key, tenant_id, env_id, pipeline_id, pipeline_name,
                       run_id, deployment_id, publish_id, current_module, current_step,
                       current_state_json, last_stable_step, last_stable_state_json,
                       case_scope_json, selected_case_id, handoff_summary_json,
                       checkpoint_key, status, created_at, updated_at
                FROM mlops_workflow_sessions
                WHERE {where_clause}
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                values,
            ).fetchone()
        return self._normalize_workflow_session_row(row)

    def save_workflow_session(
        self,
        tenant_id: str,
        env_id: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        body = dict(payload or {})
        current_state_patch = body.get("current_state")
        last_stable_state_patch = body.get("last_stable_state")
        handoff_summary_patch = body.get("handoff_summary")
        case_scope_patch = body.get("case_scope")
        mark_current_stable = bool(body.get("mark_current_stable"))

        pipeline_id_explicit = "pipeline_id" in body
        pipeline_name_explicit = "pipeline_name" in body
        run_id_explicit = "run_id" in body
        deployment_id_explicit = "deployment_id" in body
        publish_id_explicit = "publish_id" in body
        current_step_explicit = "current_step" in body

        pipeline_id_raw = body.get("pipeline_id")
        pipeline_id = int(pipeline_id_raw) if pipeline_id_raw not in (None, "", []) else None
        lookup_session_id = _normalize_optional_text(body.get("session_id"))
        lookup_run_id = _normalize_optional_text(body.get("run_id"))
        lookup_deployment_id = _normalize_optional_text(body.get("deployment_id"))
        lookup_publish_id = _normalize_optional_text(body.get("publish_id"))
        should_lookup_existing = any([
            lookup_session_id,
            pipeline_id is not None,
            lookup_run_id,
            lookup_deployment_id,
            lookup_publish_id,
        ])
        session = (
            self.get_workflow_session(
                tenant_id,
                env_id,
                session_id=lookup_session_id,
                pipeline_id=pipeline_id,
                run_id=lookup_run_id,
                deployment_id=lookup_deployment_id,
                publish_id=lookup_publish_id,
            )
            if should_lookup_existing
            else None
        ) or {}

        if lookup_session_id and not session.get("session_id"):
            raise ValueError(f"Workflow session {lookup_session_id} not found")

        if not pipeline_id_explicit:
            session_pipeline_id = session.get("pipeline_id")
            pipeline_id = int(session_pipeline_id) if session_pipeline_id not in (None, "", []) else None

        session_id = _normalize_optional_text(body.get("session_id")) or session.get("session_id") or f"WFS-{uuid.uuid4().hex[:12]}"
        pipeline_name = (
            _normalize_optional_text(body.get("pipeline_name"))
            if pipeline_name_explicit
            else session.get("pipeline_name")
        )
        run_id = (
            _normalize_optional_text(body.get("run_id"))
            if run_id_explicit
            else session.get("run_id")
        )
        deployment_id = (
            _normalize_optional_text(body.get("deployment_id"))
            if deployment_id_explicit
            else session.get("deployment_id")
        )
        publish_id = (
            _normalize_optional_text(body.get("publish_id"))
            if publish_id_explicit
            else session.get("publish_id")
        )
        current_module = _normalize_optional_text(body.get("current_module")) or session.get("current_module") or "mlops"
        current_step = (
            _normalize_optional_text(body.get("current_step"))
            if current_step_explicit
            else session.get("current_step")
        )
        selected_case_id = _normalize_optional_text(body.get("selected_case_id")) or session.get("selected_case_id")
        checkpoint_key = _normalize_optional_text(body.get("checkpoint_key")) or session.get("checkpoint_key")
        status = _normalize_optional_text(body.get("status")) or session.get("status") or "draft"

        if pipeline_id is None and pipeline_id_explicit and not pipeline_name_explicit:
            pipeline_name = None

        if pipeline_id is not None:
            with get_connection(self.db_path) as conn:
                pipeline_row = conn.execute(
                    """
                    SELECT pipeline_id, name
                    FROM mlops_pipelines
                    WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                    """,
                    [int(pipeline_id), tenant_id, env_id],
                ).fetchone()
            if not pipeline_row:
                raise ValueError(f"Pipeline {pipeline_id} not found")
            if not pipeline_name:
                pipeline_name = _normalize_optional_text(pipeline_row[1])

        current_state = _merge_state_dicts(session.get("current_state") or {}, current_state_patch or {})
        handoff_summary = _merge_state_dicts(session.get("handoff_summary") or {}, handoff_summary_patch or {})
        case_scope = _merge_state_dicts(session.get("case_scope") or {}, case_scope_patch or {})

        last_stable_step = session.get("last_stable_step")
        last_stable_state = session.get("last_stable_state") or {}
        if isinstance(last_stable_state_patch, dict):
            last_stable_state = _merge_state_dicts(last_stable_state, last_stable_state_patch)
            last_stable_step = _normalize_optional_text(body.get("last_stable_step")) or last_stable_step or current_step
        if mark_current_stable:
            last_stable_step = _normalize_optional_text(body.get("last_stable_step")) or current_step or last_stable_step
            last_stable_state = _merge_state_dicts(last_stable_state, current_state)
            if checkpoint_key and "checkpoint_key" not in last_stable_state:
                last_stable_state["checkpoint_key"] = checkpoint_key

        if isinstance(current_state, dict):
            current_state["pipeline_id"] = pipeline_id
            current_state["pipeline_name"] = pipeline_name
            current_state["run_id"] = run_id
            current_state["deployment_id"] = deployment_id
            current_state["publish_id"] = publish_id
            current_state["selected_case_id"] = selected_case_id
            current_state["preferred_screen"] = current_step

        journey_key = self._derive_workflow_journey_key(
            pipeline_id=pipeline_id,
            run_id=run_id,
            deployment_id=deployment_id,
            publish_id=publish_id,
        )

        candidate_session = {
            "session_id": session.get("session_id") or session_id,
            "pipeline_id": pipeline_id,
            "pipeline_name": pipeline_name,
            "run_id": run_id,
            "deployment_id": deployment_id,
            "publish_id": publish_id,
            "current_module": current_module,
            "current_step": current_step,
            "current_state": current_state if isinstance(current_state, dict) else {},
            "last_stable_step": last_stable_step,
            "last_stable_state": last_stable_state if isinstance(last_stable_state, dict) else {},
            "case_scope": case_scope if isinstance(case_scope, dict) else {},
            "selected_case_id": selected_case_id,
            "handoff_summary": handoff_summary if isinstance(handoff_summary, dict) else {},
            "checkpoint_key": checkpoint_key,
            "status": status,
        }
        if not session.get("session_id") and pipeline_id is None and not self._workflow_session_has_meaningful_state(candidate_session):
            return {
                "session_id": None,
                "pipeline_id": None,
                "pipeline_name": pipeline_name,
                "status": status,
                "skipped": True,
                "reason": "empty_draft_session",
            }

        with get_connection(self.db_path) as conn:
            created_row = conn.execute(
                "SELECT created_at FROM mlops_workflow_sessions WHERE session_id = ?",
                [session_id],
            ).fetchone()
            created_at_value = created_row[0] if created_row else None
            if created_at_value is not None:
                conn.execute(
                    "DELETE FROM mlops_workflow_sessions WHERE session_id = ?",
                    [session_id],
                )
            conn.execute(
                """
                INSERT INTO mlops_workflow_sessions (
                  session_id, journey_key, tenant_id, env_id, pipeline_id, pipeline_name,
                  run_id, deployment_id, publish_id, current_module, current_step,
                  current_state_json, last_stable_step, last_stable_state_json,
                  case_scope_json, selected_case_id, handoff_summary_json,
                  checkpoint_key, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    session_id,
                    journey_key,
                    tenant_id,
                    env_id,
                    pipeline_id,
                    pipeline_name,
                    run_id,
                    deployment_id,
                    publish_id,
                    current_module,
                    current_step,
                    json.dumps(current_state or {}, default=str),
                    last_stable_step,
                    json.dumps(last_stable_state or {}, default=str),
                    json.dumps(case_scope or {}, default=str),
                    selected_case_id,
                    json.dumps(handoff_summary or {}, default=str),
                    checkpoint_key,
                    status,
                    created_at_value if created_at_value is not None else datetime.utcnow(),
                ],
            )
            if pipeline_id is not None:
                conn.execute(
                    """
                    DELETE FROM mlops_workflow_sessions
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ? AND current_module = ? AND session_id <> ?
                    """,
                    [tenant_id, env_id, int(pipeline_id), current_module, session_id],
                )
            conn.execute(
                """
                INSERT INTO mlops_pipeline_step_events (
                  tenant_id, env_id, pipeline_id, session_id, screen, step_id,
                  event_type, status, checkpoint_key, state_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    tenant_id,
                    env_id,
                    int(pipeline_id) if pipeline_id is not None else None,
                    session_id,
                    "workflow_session",
                    current_step,
                    "workflow_session_saved",
                    status,
                    checkpoint_key,
                    json.dumps(
                        {
                            "pipeline_name": pipeline_name,
                            "current_step": current_step,
                            "current_state": current_state,
                            "last_stable_step": last_stable_step,
                            "last_stable_state": last_stable_state,
                            "handoff_summary": handoff_summary,
                            "case_scope": case_scope,
                        },
                        default=str,
                    ),
                ],
            )
            if pipeline_id is not None:
                self._replace_pipeline_stage_asset_links(
                    conn,
                    tenant_id,
                    env_id,
                    int(pipeline_id),
                    "workflow_session",
                    self._extract_pipeline_assets_from_state(
                        "workflow_session",
                        {
                            "current_state": current_state if isinstance(current_state, dict) else {},
                            "last_stable_state": last_stable_state if isinstance(last_stable_state, dict) else {},
                            "handoff_summary": handoff_summary if isinstance(handoff_summary, dict) else {},
                            "case_scope": case_scope if isinstance(case_scope, dict) else {},
                            "run_id": run_id,
                            "deployment_id": deployment_id,
                        },
                    ),
                )

        saved = self.get_workflow_session(tenant_id, env_id, session_id=session_id)
        if not saved:
            raise ValueError("Workflow session could not be saved")
        return saved

    def delete_workflow_session(
        self,
        tenant_id: str,
        env_id: str,
        session_id: str,
    ) -> Dict[str, Any]:
        session_id_text = _normalize_optional_text(session_id)
        if not session_id_text:
            raise ValueError("session_id is required")

        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT session_id, pipeline_id, pipeline_name, status
                FROM mlops_workflow_sessions
                WHERE session_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [session_id_text, tenant_id, env_id],
            ).fetchone()
            if not row:
                raise ValueError(f"Workflow session {session_id_text} not found")

            conn.execute(
                """
                DELETE FROM mlops_workflow_sessions
                WHERE session_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [session_id_text, tenant_id, env_id],
            )

        return {
            "session_id": _normalize_text(row[0]),
            "pipeline_id": int(row[1]) if row[1] is not None else None,
            "pipeline_name": _normalize_optional_text(row[2]),
            "status": _normalize_optional_text(row[3]) or "draft",
            "deleted_session": True,
        }

    def save_pipeline_screen_state(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        screen: str,
        state: Dict,
    ) -> Dict[str, Any]:
        screen_key = str(screen or "").strip().lower()
        if not screen_key:
            raise ValueError("screen is required")

        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT steps_json
                FROM mlops_pipelines
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [int(pipeline_id), tenant_id, env_id],
            ).fetchone()
            if not row:
                raise ValueError(f"Pipeline {pipeline_id} not found")

            steps = json.loads(row[0] or "[]")
            screen_states = _screen_state_map(steps or [])
            prior_state = screen_states.get(screen_key) or {}
            dependency_state = _dependency_state_payload(steps or {})
            fingerprints = dict(dependency_state.get("fingerprints") or {})
            stale_steps = dict(dependency_state.get("stale_steps") or {})
            latest_change = dependency_state.get("latest_change") if isinstance(dependency_state.get("latest_change"), dict) else {}

            stage_id = _SCREEN_TO_STEP.get(screen_key)
            if stage_id and stage_id in stale_steps:
                stale_steps.pop(stage_id, None)

            previous_fp = str(fingerprints.get(screen_key) or _state_fingerprint(screen_key, prior_state) or "")
            next_fp = _state_fingerprint(screen_key, state)
            if next_fp:
                fingerprints[screen_key] = next_fp

            if screen_key in _DEPENDENCY_GRAPH and previous_fp and next_fp and previous_fp != next_fp:
                impacted_steps = list(_DEPENDENCY_GRAPH.get(screen_key) or [])
                changed_at = datetime.utcnow().isoformat()
                message = _build_dependency_message(screen_key, impacted_steps)
                source_step = _SCREEN_TO_STEP.get(screen_key, screen_key)
                source_label = _PIPELINE_STEP_LABELS.get(source_step, source_step.replace("_", " ").title())
                for step_id in impacted_steps:
                    stale_steps[step_id] = {
                        "step": step_id,
                        "step_label": _PIPELINE_STEP_LABELS.get(step_id, step_id.replace("_", " ").title()),
                        "source_step": source_step,
                        "source_label": source_label,
                        "message": message,
                        "changed_at": changed_at,
                    }
                latest_change = {
                    "source_step": source_step,
                    "source_label": source_label,
                    "message": message,
                    "impacted_steps": impacted_steps,
                    "changed_at": changed_at,
                }

            if not stale_steps:
                latest_change = {}

            next_steps = [
                step for step in (steps or [])
                if not (
                    str(step.get("type") or "").strip().lower() == "screen_state"
                    and str(step.get("screen") or "").strip().lower() in {screen_key, "workbench_dependencies"}
                )
            ]
            next_steps.append({
                "type": "screen_state",
                "screen": screen_key,
                "state": state if isinstance(state, dict) else {},
            })
            next_steps.append({
                "type": "screen_state",
                "screen": "workbench_dependencies",
                "state": {
                    "fingerprints": fingerprints,
                    "stale_steps": stale_steps,
                    "latest_change": latest_change,
                },
            })

            conn.execute(
                """
                UPDATE mlops_pipelines
                SET steps_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [json.dumps(next_steps, default=str), int(pipeline_id), tenant_id, env_id],
            )
            conn.execute(
                """
                INSERT INTO mlops_pipeline_step_events (
                  tenant_id, env_id, pipeline_id, session_id, screen, step_id,
                  event_type, status, checkpoint_key, state_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    tenant_id,
                    env_id,
                    int(pipeline_id),
                    None,
                    screen_key,
                    stage_id or screen_key,
                    "screen_state_saved",
                    "saved",
                    str(fingerprints.get(screen_key) or ""),
                    json.dumps(
                        {
                            "screen": screen_key,
                            "state": state if isinstance(state, dict) else {},
                            "stale_steps": stale_steps,
                            "latest_change": latest_change,
                        },
                        default=str,
                    ),
                ],
            )
            self._replace_pipeline_stage_asset_links(
                conn,
                tenant_id,
                env_id,
                int(pipeline_id),
                screen_key,
                self._extract_pipeline_assets_from_state(
                    screen_key,
                    state if isinstance(state, dict) else {},
                ),
            )

        return self.load_pipeline(tenant_id, env_id, int(pipeline_id))

    def attach_pipeline_asset(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        asset_kind: str,
        asset_id: Any,
        stage: str,
        relation: str = "reference",
        metadata: Optional[Dict[str, Any]] = None,
        numeric: bool = False,
    ) -> None:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT pipeline_id
                FROM mlops_pipelines
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [int(pipeline_id), tenant_id, env_id],
            ).fetchone()
            if not row:
                raise ValueError(f"Pipeline {pipeline_id} not found")
            self._upsert_pipeline_asset_link(
                conn,
                tenant_id,
                env_id,
                int(pipeline_id),
                asset_kind,
                asset_id,
                stage=stage,
                relation=relation,
                metadata=metadata or {},
                numeric=numeric,
            )

    def list_pipeline_versions(self, tenant_id: str, env_id: str, pipeline_id: int) -> List[Dict]:
        """Return all saved version snapshots for one pipeline."""
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT version_id, version, name, grain, status, saved_at
                FROM mlops_pipeline_versions
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                ORDER BY version DESC
                """,
                [int(pipeline_id), tenant_id, env_id],
            ).fetchall()
        return [
            {
                "version_id": int(r[0]),
                "version": int(r[1]),
                "name": r[2],
                "grain": r[3],
                "status": r[4],
                "saved_at": r[5].isoformat() if hasattr(r[5], "isoformat") else r[5],
            }
            for r in rows
        ]

    def rename_pipeline(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        new_name: str,
    ) -> Dict[str, Any]:
        pid = int(pipeline_id)
        next_name = _normalize_text(new_name)
        if not next_name:
            raise ValueError("Pipeline name is required")

        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT pipeline_id, name
                FROM mlops_pipelines
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            ).fetchone()
            if not row:
                raise ValueError(f"Pipeline {pid} not found")

            duplicate = conn.execute(
                """
                SELECT pipeline_id
                FROM mlops_pipelines
                WHERE tenant_id = ? AND env_id = ? AND lower(name) = lower(?) AND pipeline_id <> ?
                LIMIT 1
                """,
                [tenant_id, env_id, next_name, pid],
            ).fetchone()
            if duplicate:
                raise ValueError(f'A pipeline named "{next_name}" already exists')

            conn.execute(
                """
                UPDATE mlops_pipelines
                SET name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [next_name, pid, tenant_id, env_id],
            )
            conn.execute(
                """
                UPDATE mlops_workflow_sessions
                SET pipeline_name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [next_name, pid, tenant_id, env_id],
            )

        renamed = self.load_pipeline(tenant_id, env_id, pid)
        renamed["previous_name"] = _normalize_optional_text(row[1])
        return renamed

    def schedule_pipeline(self, tenant_id: str, env_id: str, pipeline_id: int, schedule: Dict) -> Dict:
        """Persist schedule settings for a pipeline."""
        schedule_json = json.dumps(schedule or {}, default=str)
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE mlops_pipelines
                SET schedule_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [schedule_json, int(pipeline_id), tenant_id, env_id],
            )
        return {"pipeline_id": int(pipeline_id), "schedule": schedule}

    def delete_pipeline(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        delete_artifacts: bool = True,
        delete_files: bool = True,
    ) -> Dict[str, Any]:
        """
        Delete one saved pipeline and, when requested, any assets linked
        exclusively to that pipeline.
        """
        pid = int(pipeline_id)

        def _to_id(value: Any) -> Optional[int]:
            try:
                n = int(value)
                return n if n > 0 else None
            except Exception:
                return None

        deleted_datasets: List[Dict[str, Any]] = []
        deleted_training_jobs: List[Dict[str, Any]] = []
        deleted_reports: List[Dict[str, Any]] = []
        deleted_deployments: List[Dict[str, Any]] = []
        deleted_files: set[str] = set()
        deleted_pipeline_asset_link_count = 0

        def _safe_delete_file(raw_path: Any) -> None:
            if not delete_files or not raw_path:
                return
            try:
                resolved = self._resolve_file_path(Path(str(raw_path)))
            except Exception:
                resolved = Path(str(raw_path))
            try:
                if resolved.exists() and resolved.is_file():
                    resolved.unlink()
                    deleted_files.add(str(resolved))
            except Exception:
                return

        model_training_db = self._model_training_db_path()

        with get_connection(self.db_path) as conn:
            self._backfill_pipeline_asset_links(conn, tenant_id, env_id)
            row = conn.execute(
                """
                SELECT pipeline_id, name, steps_json, output_dataset_id,
                       dataset_id, anchor_dataset_id, dataset_ids_json
                FROM mlops_pipelines
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            ).fetchone()
            if not row:
                raise ValueError(f"Pipeline {pid} not found")

            pipeline_name = str(row[1] or f"Pipeline {pid}")
            steps = json.loads(row[2] or "[]")

            linked_assets = self._list_pipeline_asset_links(conn, tenant_id, env_id, pid)

            def _other_pipeline_link_count(asset_kind: str, asset_id: str) -> int:
                count_row = conn.execute(
                    """
                    SELECT COUNT(DISTINCT pipeline_id)
                    FROM mlops_pipeline_asset_links
                    WHERE tenant_id = ? AND env_id = ? AND asset_kind = ? AND asset_id = ? AND pipeline_id <> ?
                    """,
                    [tenant_id, env_id, str(asset_kind), str(asset_id), pid],
                ).fetchone()
                return int(count_row[0] or 0) if count_row else 0

            candidate_dataset_ids: set[int] = {
                int(asset["asset_id"])
                for asset in linked_assets
                if asset.get("asset_kind") == "dataset" and _to_id(asset.get("asset_id"))
            }
            training_job_ids: set[str] = {
                str(asset["asset_id"])
                for asset in linked_assets
                if asset.get("asset_kind") == "training_job" and _normalize_text(asset.get("asset_id"))
            }
            report_ids: set[str] = {
                str(asset["asset_id"])
                for asset in linked_assets
                if asset.get("asset_kind") == "run_report" and _normalize_text(asset.get("asset_id"))
            }
            deployment_ids: set[str] = {
                str(asset["asset_id"])
                for asset in linked_assets
                if asset.get("asset_kind") == "deployment" and _normalize_text(asset.get("asset_id"))
            }

            pipeline_output_id = _to_id(row[3])
            if pipeline_output_id:
                candidate_dataset_ids.add(pipeline_output_id)
            for legacy_id in (row[4], row[5]):
                next_id = _to_id(legacy_id)
                if next_id:
                    candidate_dataset_ids.add(next_id)
            for raw_id in _safe_json_loads(row[6], []):
                next_id = _to_id(raw_id)
                if next_id:
                    candidate_dataset_ids.add(next_id)

            run_rows = conn.execute(
                """
                SELECT output_dataset_id
                FROM mlops_pipeline_runs
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            ).fetchall()
            for run_row in run_rows:
                run_ds_id = _to_id(run_row[0] if run_row else None)
                if run_ds_id:
                    candidate_dataset_ids.add(run_ds_id)

            if isinstance(steps, list):
                for step in steps:
                    if str(step.get("type") or "").strip().lower() != "screen_state":
                        continue
                    state = step.get("state")
                    if not isinstance(state, dict):
                        continue
                    for key in ("builtMasterDatasetId", "preprocessedDatasetId", "outputDatasetId", "masterDatasetId"):
                        sid = _to_id(state.get(key))
                        if sid:
                            candidate_dataset_ids.add(sid)
                    for key in ("job_id", "run_id", "modelRunId", "activeRunId", "selectedRunId"):
                        run_value = _normalize_optional_text(state.get(key))
                        if run_value:
                            training_job_ids.add(run_value)

            if delete_artifacts and training_job_ids:
                training_job_list = sorted(training_job_ids)
                if model_training_db.exists():
                    try:
                        with get_connection(str(model_training_db)) as model_conn:
                            placeholders = ",".join(["?"] * len(training_job_list))
                            job_rows = model_conn.execute(
                                f"""
                                SELECT job_id, artifact_path
                                FROM model_training_runs
                                WHERE tenant_id = ? AND env_id = ? AND job_id IN ({placeholders})
                                """,
                                [tenant_id, env_id, *training_job_list],
                            ).fetchall()
                            job_artifacts = {str(job_id): artifact_path for job_id, artifact_path in (job_rows or [])}
                            for job_id in training_job_list:
                                if _other_pipeline_link_count("training_job", job_id) > 0:
                                    continue
                                model_conn.execute(
                                    """
                                    DELETE FROM model_registry
                                    WHERE tenant_id = ? AND env_id = ? AND job_id = ?
                                    """,
                                    [tenant_id, env_id, job_id],
                                )
                                model_conn.execute(
                                    """
                                    DELETE FROM model_training_runs
                                    WHERE tenant_id = ? AND env_id = ? AND job_id = ?
                                    """,
                                    [tenant_id, env_id, job_id],
                                )
                                deleted_training_jobs.append({"job_id": job_id})
                                _safe_delete_file(job_artifacts.get(job_id))
                    except Exception:
                        pass
                for job_id in training_job_list:
                    if _other_pipeline_link_count("training_job", job_id) > 0:
                        continue
                    conn.execute(
                        """
                        DELETE FROM mlops_model_runs
                        WHERE tenant_id = ? AND env_id = ? AND run_id = ?
                        """,
                        [tenant_id, env_id, job_id],
                    )
                    report_rows = conn.execute(
                        """
                        SELECT report_id
                        FROM mlops_run_reports
                        WHERE tenant_id = ? AND env_id = ? AND run_id = ?
                        """,
                        [tenant_id, env_id, job_id],
                    ).fetchall()
                    for report_row in report_rows or []:
                        if report_row and report_row[0]:
                            report_ids.add(str(report_row[0]))

            if delete_artifacts and candidate_dataset_ids:
                id_list = sorted(candidate_dataset_ids)
                placeholders = ",".join(["?"] * len(id_list))
                ds_rows = conn.execute(
                    f"""
                    SELECT dataset_id, dataset_type, file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND dataset_id IN ({placeholders})
                    """,
                    [tenant_id, env_id, *id_list],
                ).fetchall()

                for ds_row in ds_rows:
                    ds_id = int(ds_row[0])
                    ds_type = str(ds_row[1] or "").strip().lower()
                    ds_path = ds_row[2]
                    if _other_pipeline_link_count("dataset", str(ds_id)) > 0:
                        continue

                    conn.execute(
                        """
                        DELETE FROM mlops_dataset_registry
                        WHERE dataset_id = ? AND tenant_id = ? AND env_id = ?
                        """,
                        [ds_id, tenant_id, env_id],
                    )
                    conn.execute(
                        """
                        DELETE FROM mlops_targets
                        WHERE tenant_id = ? AND env_id = ? AND dataset_id = ?
                        """,
                        [tenant_id, env_id, ds_id],
                    )
                    deleted_datasets.append({
                        "dataset_id": ds_id,
                        "dataset_type": ds_type,
                    })
                    _safe_delete_file(ds_path)

            if delete_artifacts and report_ids:
                for report_id in sorted(report_ids):
                    if _other_pipeline_link_count("run_report", report_id) > 0:
                        continue
                    report_row = conn.execute(
                        """
                        SELECT report_id, run_id
                        FROM mlops_run_reports
                        WHERE tenant_id = ? AND env_id = ? AND report_id = ?
                        """,
                        [tenant_id, env_id, report_id],
                    ).fetchone()
                    if not report_row:
                        continue
                    conn.execute(
                        """
                        DELETE FROM mlops_run_reports
                        WHERE tenant_id = ? AND env_id = ? AND report_id = ?
                        """,
                        [tenant_id, env_id, report_id],
                    )
                    deleted_reports.append({
                        "report_id": str(report_row[0]),
                        "run_id": _normalize_optional_text(report_row[1]),
                    })

            if delete_artifacts and deployment_ids:
                for deployment_id in sorted(deployment_ids):
                    if _other_pipeline_link_count("deployment", deployment_id) > 0:
                        continue
                    dep_row = conn.execute(
                        """
                        SELECT deployment_id, bundle_path, model_card_path
                        FROM mlops_deployments
                        WHERE tenant_id = ? AND env_id = ? AND deployment_id = ?
                        """,
                        [tenant_id, env_id, deployment_id],
                    ).fetchone()
                    if not dep_row:
                        continue
                    conn.execute(
                        """
                        DELETE FROM mlops_deployments
                        WHERE tenant_id = ? AND env_id = ? AND deployment_id = ?
                        """,
                        [tenant_id, env_id, deployment_id],
                    )
                    deleted_deployments.append({"deployment_id": str(dep_row[0])})
                    _safe_delete_file(dep_row[1])
                    _safe_delete_file(dep_row[2])

            runs_count = conn.execute(
                """
                SELECT COUNT(*)
                FROM mlops_pipeline_runs
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            ).fetchone()
            versions_count = conn.execute(
                """
                SELECT COUNT(*)
                FROM mlops_pipeline_versions
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            ).fetchone()
            workflow_sessions_count = conn.execute(
                """
                SELECT COUNT(*)
                FROM mlops_workflow_sessions
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            ).fetchone()
            step_events_count = conn.execute(
                """
                SELECT COUNT(*)
                FROM mlops_pipeline_step_events
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            ).fetchone()
            asset_links_count = conn.execute(
                """
                SELECT COUNT(*)
                FROM mlops_pipeline_asset_links
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            ).fetchone()

            conn.execute(
                """
                DELETE FROM mlops_pipeline_runs
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            )
            conn.execute(
                """
                DELETE FROM mlops_pipeline_versions
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            )
            conn.execute(
                """
                DELETE FROM mlops_workflow_sessions
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            )
            conn.execute(
                """
                DELETE FROM mlops_pipeline_step_events
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            )
            conn.execute(
                """
                DELETE FROM mlops_pipeline_asset_links
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            )
            deleted_pipeline_asset_link_count = int((asset_links_count[0] or 0) if asset_links_count else 0)
            conn.execute(
                """
                DELETE FROM mlops_pipelines
                WHERE pipeline_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [pid, tenant_id, env_id],
            )

        return {
            "pipeline_id": pid,
            "name": pipeline_name,
            "deleted_pipeline": True,
            "delete_artifacts": bool(delete_artifacts),
            "delete_files": bool(delete_files),
            "deleted_artifacts_count": int(len(deleted_datasets)),
            "deleted_artifacts": deleted_datasets,
            "deleted_datasets_count": int(len(deleted_datasets)),
            "deleted_datasets": deleted_datasets,
            "deleted_training_jobs_count": int(len(deleted_training_jobs)),
            "deleted_training_jobs": deleted_training_jobs,
            "deleted_reports_count": int(len(deleted_reports)),
            "deleted_reports": deleted_reports,
            "deleted_deployments_count": int(len(deleted_deployments)),
            "deleted_deployments": deleted_deployments,
            "deleted_files_count": int(len(deleted_files)),
            "deleted_files": sorted(deleted_files),
            "deleted_runs_count": int((runs_count[0] or 0) if runs_count else 0),
            "deleted_versions_count": int((versions_count[0] or 0) if versions_count else 0),
            "deleted_workflow_sessions_count": int((workflow_sessions_count[0] or 0) if workflow_sessions_count else 0),
            "deleted_step_events_count": int((step_events_count[0] or 0) if step_events_count else 0),
            "deleted_pipeline_asset_links_count": int(deleted_pipeline_asset_link_count),
        }

    def run_pipeline_async(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
    ) -> str:
        """
        Trigger an async pipeline run. Returns a run_id to poll via
        get_pipeline_run_status(). The build executes in a background
        thread using the pipeline's saved definition.
        """
        run_id = str(uuid.uuid4())

        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO mlops_pipeline_runs (run_id, pipeline_id, tenant_id, env_id, status)
                VALUES (?, ?, ?, ?, 'pending')
                """,
                [run_id, int(pipeline_id), tenant_id, env_id],
            )

        def _execute():
            log_lines: List[str] = []
            try:
                pipeline = self.load_pipeline(tenant_id, env_id, pipeline_id)
                log_lines.append(f"Pipeline '{pipeline['name']}' v{pipeline['version']} started")

                dataset_ids = pipeline.get("dataset_ids") or []
                datasets = []
                for did in dataset_ids:
                    try:
                        ds = self.get_dataset(tenant_id, env_id, int(did))
                        if ds:
                            datasets.append(ds)
                            log_lines.append(f"Loaded dataset: {ds['dataset_type']} ({ds['row_count']:,} rows)")
                    except Exception as e:
                        log_lines.append(f"Warning: could not load dataset {did}: {e}")

                if not datasets:
                    # Fall back to all datasets in env
                    datasets = self.list_datasets(tenant_id, env_id)
                    log_lines.append(f"No explicit datasets selected; using all {len(datasets)} available datasets")

                output_name = pipeline.get("output_name") or "master_dataset"
                options = {
                    "join_steps": pipeline.get("joins") or [],
                    "base_dataset_type": pipeline.get("grain") or "transaction",
                    "str_policy": (pipeline.get("str_config") or {}).get("policy") or "detect",
                    "replacement_label_column": (pipeline.get("str_config") or {}).get("replacement_label_column"),
                    "preview_rows": 40,
                }

                log_lines.append("Building master dataset ...")
                result = self.build_master_dataset(tenant_id, env_id, datasets, output_name, options)
                output_dataset_id = result.get("dataset", {}).get("dataset_id")
                impact = result.get("impact") or result.get("output", {}).get("impact") or []
                for row in impact:
                    pct = row.get("coverage_pct", 0)
                    log_lines.append(
                        f"  Joined {row.get('source')} on {row.get('join_key')} — "
                        f"{row.get('rows_after'):,} rows, {pct:.1f}% coverage"
                    )
                log_lines.append(f"Master dataset written: {result.get('output', {}).get('path') or output_name}")

                # Run post-build transforms if any
                transforms = pipeline.get("transforms") or []
                if transforms:
                    log_lines.append(f"Applying {len(transforms)} transform step(s) ...")
                    master_ds = self.get_dataset(tenant_id, env_id, int(output_dataset_id)) if output_dataset_id else None
                    if master_ds:
                        self.preprocess_run(tenant_id, env_id, master_ds, transforms, output_name)
                        log_lines.append("Transforms applied")

                # Auto-generate report if a completed model run can be resolved.
                try:
                    candidate_run_id: Optional[str] = None
                    for step in (pipeline.get("steps") or []):
                        if not isinstance(step, dict):
                            continue
                        if str(step.get("type") or "").strip().lower() != "screen_state":
                            continue
                        if str(step.get("screen") or "").strip().lower() not in {"model", "model_training"}:
                            continue
                        state = step.get("state") or {}
                        if not isinstance(state, dict):
                            continue
                        for key in ("job_id", "run_id", "modelRunId", "activeRunId", "selectedRunId"):
                            val = state.get(key)
                            if val:
                                candidate_run_id = str(val)
                                break
                        if candidate_run_id:
                            break

                    if not candidate_run_id:
                        with get_connection(self.db_path) as conn:
                            row = conn.execute(
                                """
                                SELECT job_id
                                FROM model_training_runs
                                WHERE tenant_id = ? AND env_id = ?
                                ORDER BY trained_at DESC
                                LIMIT 1
                                """,
                                [str(tenant_id), str(env_id)],
                            ).fetchone()
                        if row and row[0]:
                            candidate_run_id = str(row[0])

                    if candidate_run_id:
                        self.generate_run_report(
                            tenant_id=str(tenant_id),
                            env_id=str(env_id),
                            run_id=str(candidate_run_id),
                            pipeline_id=str(pipeline_id),
                        )
                        log_lines.append(f"Run report generated for model run {candidate_run_id}")
                    else:
                        log_lines.append("No completed model run found for report generation; skipped.")
                except Exception as report_err:
                    log_lines.append(f"Report generation warning: {report_err}")

                log_lines.append("Pipeline completed successfully")
                with get_connection(self.db_path) as conn:
                    conn.execute(
                        """
                        UPDATE mlops_pipeline_runs
                        SET status = 'complete', output_dataset_id = ?,
                            log_json = ?, finished_at = CURRENT_TIMESTAMP
                        WHERE run_id = ?
                        """,
                        [
                            int(output_dataset_id) if output_dataset_id else None,
                            json.dumps(log_lines, default=str),
                            run_id,
                        ],
                    )
                    conn.execute(
                        """
                        UPDATE mlops_pipelines
                        SET status = 'complete', output_dataset_id = ?,
                            last_run_at = CURRENT_TIMESTAMP
                        WHERE pipeline_id = ?
                        """,
                        [int(output_dataset_id) if output_dataset_id else None, int(pipeline_id)],
                    )
                    if output_dataset_id:
                        self._upsert_pipeline_asset_link(
                            conn,
                            tenant_id,
                            env_id,
                            int(pipeline_id),
                            "dataset",
                            output_dataset_id,
                            stage="pipeline_run",
                            relation="pipeline_output",
                            metadata={"run_id": run_id},
                            numeric=True,
                        )

            except Exception as exc:
                import traceback
                log_lines.append(f"ERROR: {exc}")
                log_lines.append(traceback.format_exc())
                with get_connection(self.db_path) as conn:
                    conn.execute(
                        """
                        UPDATE mlops_pipeline_runs
                        SET status = 'failed', error = ?, log_json = ?,
                            finished_at = CURRENT_TIMESTAMP
                        WHERE run_id = ?
                        """,
                        [str(exc), json.dumps(log_lines, default=str), run_id],
                    )
                    conn.execute(
                        """
                        UPDATE mlops_pipelines
                        SET status = 'failed'
                        WHERE pipeline_id = ?
                        """,
                        [int(pipeline_id)],
                    )

        threading.Thread(target=_execute, daemon=True).start()
        return run_id

    def get_pipeline_run_status(self, run_id: str) -> Dict:
        """Poll the status of a specific pipeline run."""
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id, pipeline_id, status, output_dataset_id,
                       log_json, error, started_at, finished_at
                FROM mlops_pipeline_runs
                WHERE run_id = ?
                """,
                [run_id],
            ).fetchone()
        if not row:
            raise ValueError(f"Pipeline run {run_id} not found")
        return {
            "run_id": row[0],
            "pipeline_id": int(row[1]) if row[1] is not None else None,
            "status": row[2],
            "output_dataset_id": int(row[3]) if row[3] is not None else None,
            "log": json.loads(row[4] or "[]"),
            "error": row[5],
            "started_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
            "finished_at": row[7].isoformat() if hasattr(row[7], "isoformat") else row[7],
        }

    def preview_pipeline(self, dataset: Dict, steps: List[Dict], sample_rows: int) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        for step in steps or []:
            kind = str(step.get("type") or "").lower()
            if kind == "missing":
                method = step.get("method") or "median"
                for col in df.columns:
                    if pd.api.types.is_numeric_dtype(df[col]):
                        if method == "mean":
                            df[col] = df[col].fillna(df[col].mean())
                        elif method == "median":
                            df[col] = df[col].fillna(df[col].median())
                    else:
                        df[col] = df[col].fillna(step.get("fill_value") or "unknown")
            if kind == "scaling":
                for col in df.select_dtypes(include=[np.number]).columns:
                    mean = df[col].mean()
                    std = df[col].std() or 1.0
                    df[col] = (df[col] - mean) / std
            if kind == "encoding":
                cat_cols = step.get("columns") or df.select_dtypes(exclude=[np.number]).columns.tolist()
                df = pd.get_dummies(df, columns=cat_cols, dummy_na=False)
            if kind == "outliers":
                col = step.get("column")
                if col in df.columns and pd.api.types.is_numeric_dtype(df[col]):
                    q1 = df[col].quantile(0.25)
                    q3 = df[col].quantile(0.75)
                    iqr = q3 - q1
                    low = q1 - 1.5 * iqr
                    high = q3 + 1.5 * iqr
                    df[col] = df[col].clip(lower=low, upper=high)
            if kind == "sampling":
                frac = float(step.get("frac") or 0.5)
                df = df.sample(frac=min(max(frac, 0.05), 1.0), random_state=42)
            if kind == "filter":
                keep = step.get("columns") or []
                if keep:
                    df = df[[c for c in keep if c in df.columns]]
        return {
            "row_count": int(df.shape[0]),
            "columns": list(df.columns),
            "preview": df.head(25).fillna("").to_dict(orient="records"),
        }

    def list_datasets(self, tenant_id: str, env_id: str) -> List[Dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT dataset_id, dataset_type, filename, file_path, row_count, columns_json, column_types_json, created_at, updated_at
                FROM mlops_dataset_registry
                WHERE tenant_id = ? AND env_id = ?
                ORDER BY updated_at DESC
                """,
                [tenant_id, env_id],
            ).fetchall()

        results = []
        for r in rows:
            resolved_file_path = self._resolve_file_path(Path(r[3]))
            results.append(
                {
                    "dataset_id": int(r[0]),
                    "dataset_type": r[1],
                    "filename": r[2],
                    "file_path": str(resolved_file_path if resolved_file_path.exists() else r[3]),
                    "row_count": int(r[4] or 0),
                    "columns": json.loads(r[5] or "[]"),
                    "column_types": json.loads(r[6] or "{}"),
                    "created_at": r[7].isoformat() if hasattr(r[7], "isoformat") else r[7],
                    "updated_at": r[8].isoformat() if hasattr(r[8], "isoformat") else r[8],
                }
            )
        return results

    def get_dataset(self, *args) -> Dict:
        if len(args) == 1:
            tenant_id, env_id, dataset_id = None, None, int(args[0])
        elif len(args) == 3:
            tenant_id, env_id, dataset_id = str(args[0]), str(args[1]), int(args[2])
        else:
            raise ValueError("get_dataset expects dataset_id or (tenant_id, env_id, dataset_id)")

        with get_connection(self.db_path) as conn:
            if tenant_id and env_id:
                row = conn.execute(
                    """
                    SELECT dataset_id, tenant_id, env_id, dataset_type, filename, file_path, row_count,
                           columns_json, column_types_json, created_at, updated_at
                    FROM mlops_dataset_registry
                    WHERE dataset_id = ? AND tenant_id = ? AND env_id = ?
                    """,
                    [int(dataset_id), tenant_id, env_id],
                ).fetchone()
                if not row:
                    row = conn.execute(
                        """
                        SELECT dataset_id, tenant_id, env_id, dataset_type, filename, file_path, row_count,
                               columns_json, column_types_json, created_at, updated_at
                        FROM mlops_dataset_registry
                        WHERE dataset_id = ?
                        """,
                        [int(dataset_id)],
                    ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT dataset_id, tenant_id, env_id, dataset_type, filename, file_path, row_count,
                           columns_json, column_types_json, created_at, updated_at
                    FROM mlops_dataset_registry
                    WHERE dataset_id = ?
                    """,
                    [int(dataset_id)],
                ).fetchone()
        if not row:
            raise ValueError("dataset not found")
        resolved_file_path = self._resolve_file_path(Path(row[5]))
        return {
            "dataset_id": int(row[0]),
            "tenant_id": row[1],
            "env_id": row[2],
            "dataset_type": row[3],
            "filename": row[4],
            "file_path": str(resolved_file_path if resolved_file_path.exists() else row[5]),
            "row_count": int(row[6] or 0),
            "columns": json.loads(row[7] or "[]"),
            "column_types": json.loads(row[8] or "{}"),
            "created_at": row[9].isoformat() if hasattr(row[9], "isoformat") else row[9],
            "updated_at": row[10].isoformat() if hasattr(row[10], "isoformat") else row[10],
        }

    def preview_dataset_rows(
        self,
        dataset: Dict,
        sample_rows: int = 12,
        columns: Optional[List[str]] = None,
        include_aggregation: bool = False,
        aggregate_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Return a lightweight row preview for one dataset.

        When include_aggregation=True, this also returns an aggregated preview
        (for transaction-like/event data) so the UI can show before/after squeeze
        logic without building the full master dataset.
        """
        sample_n = max(1, min(int(sample_rows or 12), 200))
        requested_cols = [str(c) for c in (columns or []) if str(c).strip()]

        raw_df = self._load_sample_df(
            Path(dataset["file_path"]),
            requested_cols or None,
            sample_n,
        )
        raw_df = raw_df.replace([np.inf, -np.inf], np.nan)

        payload: Dict[str, Any] = {
            "dataset_id": int(dataset.get("dataset_id") or 0),
            "dataset_type": str(dataset.get("dataset_type") or ""),
            "row_count": int(dataset.get("row_count") or 0),
            "sample_row_count": int(raw_df.shape[0]),
            "columns": [str(c) for c in raw_df.columns],
            "preview": raw_df.head(sample_n).fillna("").to_dict(orient="records"),
            "aggregation": None,
        }

        if not include_aggregation:
            return payload

        agg_df = pd.DataFrame()
        group_key: Optional[str] = None

        if aggregate_by:
            group_key = self._find_col(raw_df, [str(aggregate_by)])
            if group_key:
                try:
                    agg_df = _aggregate_event_table(raw_df, group_key)
                except Exception:
                    agg_df = pd.DataFrame()

        if agg_df.empty:
            agg_df, fallback_key = self._build_txn_aggregate_frame(raw_df)
            group_key = group_key or fallback_key

        if agg_df.empty:
            return payload

        agg_df = agg_df.replace([np.inf, -np.inf], np.nan)
        payload["aggregation"] = {
            "group_key": str(group_key or ""),
            "rows_before_sample": int(raw_df.shape[0]),
            "rows_after_sample": int(agg_df.shape[0]),
            "columns": [str(c) for c in agg_df.columns],
            "preview": agg_df.head(sample_n).fillna("").to_dict(orient="records"),
            "is_sampled_preview": True,
        }
        return payload

    def delete_dataset(self, tenant_id: str, env_id: str, dataset_id: int) -> None:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT dataset_id
                FROM mlops_dataset_registry
                WHERE dataset_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [int(dataset_id), tenant_id, env_id],
            ).fetchone()
            if not row:
                raise ValueError("dataset not found")
            conn.execute(
                """
                DELETE FROM mlops_dataset_registry
                WHERE dataset_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [int(dataset_id), tenant_id, env_id],
            )
            conn.execute(
                """
                DELETE FROM mlops_pipeline_asset_links
                WHERE tenant_id = ? AND env_id = ? AND asset_kind = 'dataset' AND asset_id = ?
                """,
                [tenant_id, env_id, str(int(dataset_id))],
            )

    def reset_workspace(self, tenant_id: str, env_id: str, delete_files: bool = False) -> Dict[str, Any]:
        """
        Clear MLOps pipeline state for one environment.
        Keeps data files by default; set delete_files=True to remove CSV/Parquet files too.
        """
        scoped_tables = [
            "mlops_dataset_registry",
            "mlops_snapshots",
            "mlops_targets",
            "mlops_pipelines",
            "mlops_pipeline_versions",
            "mlops_pipeline_runs",
            "mlops_workflow_sessions",
            "mlops_pipeline_step_events",
            "mlops_pipeline_asset_links",
            "mlops_model_runs",
            "mlops_run_reports",
            "mlops_deployments",
        ]
        deleted_rows: Dict[str, int] = {}

        with get_connection(self.db_path) as conn:
            for table in scoped_tables:
                try:
                    count_row = conn.execute(
                        f"SELECT COUNT(*) FROM {table} WHERE tenant_id = ? AND env_id = ?",
                        [tenant_id, env_id],
                    ).fetchone()
                    deleted_rows[table] = int(count_row[0] or 0) if count_row else 0
                    conn.execute(
                        f"DELETE FROM {table} WHERE tenant_id = ? AND env_id = ?",
                        [tenant_id, env_id],
                    )
                except Exception:
                    deleted_rows[table] = 0

            # Best-effort cleanup for environment-scoped jobs/cache keys.
            for table in ("mlops_jobs", "mlops_cache"):
                try:
                    conn.execute(
                        f"DELETE FROM {table} WHERE payload_json LIKE ?",
                        [f"%{env_id}%"],
                    )
                except Exception:
                    pass

        deleted_files: List[str] = []
        if delete_files:
            data_dir = self._data_dir()
            if data_dir.exists():
                for file_path in data_dir.glob("*"):
                    if not file_path.is_file():
                        continue
                    if file_path.suffix.lower() not in {".csv", ".parquet", ".pq"}:
                        continue
                    try:
                        file_path.unlink()
                        deleted_files.append(str(file_path))
                    except Exception:
                        continue

        return {
            "deleted_rows": deleted_rows,
            "deleted_files": deleted_files,
            "delete_files": bool(delete_files),
        }

    def _load_sample_df(self, file_path: Path, columns: Optional[List[str]], sample_rows: int) -> pd.DataFrame:
        resolved_path = self._resolve_file_path(file_path)
        rel = self._relation_expr(file_path, sample_size=20000)
        if columns:
            cols = ", ".join(['"' + c.replace('"', '""') + '"' for c in columns])
        else:
            cols = "*"
        limit = f"LIMIT {int(sample_rows)}" if sample_rows else ""
        query = f"SELECT {cols} FROM {rel} {limit}"
        try:
            with duckdb.connect() as conn:
                return conn.execute(query).df()
        except Exception as duck_exc:
            # Fallback for malformed/very wide CSVs where DuckDB dialect sniffing fails.
            # We still support column projection and row limiting for parity.
            sample_n = int(sample_rows) if sample_rows else None
            usecols = columns or None
            ext = resolved_path.suffix.lower()
            if ext in (".parquet", ".pq"):
                df = pd.read_parquet(resolved_path, columns=usecols)
                return df.head(sample_n) if sample_n else df

            candidates = [
                {"sep": ",", "engine": "c"},
                {"sep": None, "engine": "python"},
                {"sep": ";", "engine": "python"},
                {"sep": "|", "engine": "python"},
                {"sep": "\t", "engine": "python"},
            ]

            last_exc = duck_exc
            for cand in candidates:
                try:
                    kwargs = {
                        "nrows": sample_n,
                        "usecols": usecols,
                    }
                    if cand["engine"] == "python":
                        kwargs.update({
                            "sep": cand["sep"],
                            "engine": "python",
                            "on_bad_lines": "skip",
                        })
                    else:
                        kwargs.update({
                            "sep": cand["sep"],
                            "engine": "c",
                            "low_memory": False,
                        })
                    return pd.read_csv(resolved_path, **kwargs)
                except Exception as read_exc:
                    last_exc = read_exc

            raise ValueError(f"Unable to read dataset file '{resolved_path}': {last_exc}") from duck_exc

    def compute_variable_stats(
        self,
        dataset: Dict,
        columns: Optional[List[str]],
        sample_rows: int,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), columns, sample_rows)
        results = {}
        for col in df.columns:
            series = df[col]
            missing = int(series.isna().sum())
            total = int(series.shape[0])
            distinct = int(series.nunique(dropna=True))
            numeric, numeric_ratio = self._coerce_numeric_series(series, min_ratio=0.85)
            entry = {
                "missing_count": missing,
                "missing_pct": float(missing / total) if total else 0.0,
                "distinct_count": distinct,
                "dtype": str(series.dtype),
                "numeric_parse_ratio": float(numeric_ratio),
                "sample_values": [
                    str(value)
                    for value in series.dropna().astype(str).unique()[:5].tolist()
                ],
            }
            if numeric is not None and numeric.notna().any():
                entry.update(
                    {
                        "min": float(np.nanmin(numeric)) if numeric.notna().any() else None,
                        "max": float(np.nanmax(numeric)) if numeric.notna().any() else None,
                        "mean": float(np.nanmean(numeric)) if numeric.notna().any() else None,
                        "variance": float(np.nanvar(numeric)) if numeric.notna().any() else None,
                        "std": float(np.nanstd(numeric)) if numeric.notna().any() else None,
                        "skewness": float(numeric.skew()) if numeric.notna().any() else None,
                        "kurtosis": float(numeric.kurtosis()) if numeric.notna().any() else None,
                    }
                )
                if numeric.notna().any():
                    values = numeric.dropna().to_numpy()
                    mean_v = float(np.nanmean(values))
                    median_v = float(np.nanmedian(values))
                    mad_mean = float(np.nanmean(np.abs(values - mean_v)))
                    mad_median = float(np.nanmean(np.abs(values - median_v)))
                    pos_abs = np.abs(values)
                    pos_abs = pos_abs[pos_abs > 0]
                    gmean_abs = float(np.exp(np.mean(np.log(pos_abs)))) if pos_abs.size else None
                    disp_ratio = (float(abs(mean_v) / gmean_abs) if gmean_abs and gmean_abs > 0 else None)
                    entry["mean_abs_deviation"] = mad_mean
                    entry["mean_abs_difference"] = mad_mean
                    entry["median_abs_deviation"] = mad_median
                    entry["geometric_mean_abs"] = gmean_abs
                    entry["dispersion_ratio"] = disp_ratio
                    hist, bin_edges = np.histogram(values, bins=10)
                    bins = []
                    for i in range(len(hist)):
                        bins.append(
                            {
                                "bin_start": float(bin_edges[i]),
                                "bin_end": float(bin_edges[i + 1]),
                                "count": int(hist[i]),
                            }
                        )
                    q1 = float(np.nanpercentile(values, 25))
                    q3 = float(np.nanpercentile(values, 75))
                    median = float(np.nanmedian(values))
                    entry["histogram"] = bins
                    entry["boxplot"] = {
                        "q1": q1,
                        "q3": q3,
                        "median": median,
                        "iqr": float(q3 - q1),
                    }
            else:
                freq = series.dropna().astype(str).value_counts().head(20)
                entry["top_categories"] = [
                    {"value": k, "count": int(v)} for k, v in freq.items()
                ]
            results[col] = entry
        return {
            "rows_analyzed": int(df.shape[0]),
            "columns": results,
        }

    def compute_correlation(
        self,
        dataset: Dict,
        columns: List[str],
        method: str,
        sample_rows: int,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), columns, sample_rows)
        numeric_df = df.select_dtypes(include=[np.number])
        corr = numeric_df.corr(method=method or "pearson")
        matrix = []
        cols = list(corr.columns)
        for i, c1 in enumerate(cols):
            for j, c2 in enumerate(cols):
                matrix.append(
                    {
                        "x": c1,
                        "y": c2,
                        "value": float(corr.iloc[i, j]) if not pd.isna(corr.iloc[i, j]) else None,
                    }
                )
        return {
            "rows_analyzed": int(numeric_df.shape[0]),
            "columns": cols,
            "matrix": matrix,
            "method": method or "pearson",
        }

    def compute_outliers(
        self,
        dataset: Dict,
        column: str,
        method: str,
        threshold: float,
        sample_rows: int,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), [column], sample_rows)
        series = pd.to_numeric(df[column], errors="coerce")
        values = series.dropna().to_numpy()
        if values.size == 0:
            return {"rows_analyzed": int(df.shape[0]), "outliers": 0}
        method = (method or "iqr").lower()
        if method == "zscore":
            mean = float(np.nanmean(values))
            std = float(np.nanstd(values)) or 1.0
            z = np.abs((values - mean) / std)
            count = int((z > float(threshold or 3.0)).sum())
            return {
                "rows_analyzed": int(df.shape[0]),
                "method": "zscore",
                "threshold": float(threshold or 3.0),
                "outliers": count,
            }
        if method == "percentile":
            low = np.nanpercentile(values, float(threshold or 1.0))
            high = np.nanpercentile(values, 100 - float(threshold or 1.0))
            count = int(((values < low) | (values > high)).sum())
            return {
                "rows_analyzed": int(df.shape[0]),
                "method": "percentile",
                "low": float(low),
                "high": float(high),
                "outliers": count,
            }
        q1 = np.nanpercentile(values, 25)
        q3 = np.nanpercentile(values, 75)
        iqr = q3 - q1
        k = float(threshold or 1.5)
        low = q1 - k * iqr
        high = q3 + k * iqr
        count = int(((values < low) | (values > high)).sum())
        return {
            "rows_analyzed": int(df.shape[0]),
            "method": "iqr",
            "threshold": float(k),
            "low": float(low),
            "high": float(high),
            "outliers": count,
        }

    def compute_duplicates(
        self,
        dataset: Dict,
        columns: Optional[List[str]],
        sample_rows: int,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), columns, sample_rows)
        total = int(df.shape[0])
        if columns:
            subset = columns
        else:
            subset = df.columns.tolist()
        dup_count = int(df.duplicated(subset=subset).sum())
        return {
            "rows_analyzed": total,
            "duplicate_rows": dup_count,
            "duplicate_pct": float(dup_count / total) if total else 0.0,
        }

    def compute_insights(
        self,
        dataset: Dict,
        sample_rows: int,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        insights = []
        missing_pct = df.isna().mean().sort_values(ascending=False)
        for col, pct in missing_pct.head(5).items():
            if pct > 0.2:
                insights.append({"type": "missingness", "column": col, "value": float(pct)})
        numeric_df = df.select_dtypes(include=[np.number])
        if not numeric_df.empty:
            skew = numeric_df.skew().sort_values(ascending=False)
            for col, val in skew.head(5).items():
                if abs(val) > 1.5:
                    insights.append({"type": "skewness", "column": col, "value": float(val)})
        corr = None
        if numeric_df.shape[1] >= 2:
            corr = numeric_df.corr().abs()
            upper = corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool))
            high_corr = (
                upper.stack().sort_values(ascending=False).head(5).reset_index()
            )
            for _, row in high_corr.iterrows():
                if row[0] >= 0.85:
                    insights.append(
                        {
                            "type": "correlation",
                            "columns": [row["level_0"], row["level_1"]],
                            "value": float(row[0]),
                        }
                    )
        duplicate_pct = float(df.duplicated().mean()) if df.shape[0] else 0.0
        score = 100.0
        score -= min(40.0, float(missing_pct.mean() * 100))
        score -= min(30.0, duplicate_pct * 100)
        if corr is not None and corr.shape[0] > 1:
            score -= min(20.0, float(corr.where(np.triu(np.ones(corr.shape), k=1).astype(bool)).max().max() * 20))
        score = max(0.0, min(100.0, score))
        return {
            "rows_analyzed": int(df.shape[0]),
            "insights": insights,
            "health_score": float(score),
        }

    def compute_column_profile(
        self,
        dataset: Dict,
        columns: Optional[List[str]],
        sample_rows: int,
        bins: int = 20,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), columns, sample_rows)
        results = {}
        for col in df.columns:
            series = df[col]
            missing = int(series.isna().sum())
            total = int(series.shape[0])
            distinct = int(series.nunique(dropna=True))
            entry = {
                "missing_count": missing,
                "missing_pct": float(missing / total) if total else 0.0,
                "distinct_count": distinct,
                "dtype": str(series.dtype),
            }
            if pd.api.types.is_numeric_dtype(series):
                numeric = pd.to_numeric(series, errors="coerce")
                if numeric.notna().any():
                    values = numeric.dropna().to_numpy()
                    hist, bin_edges = np.histogram(values, bins=int(bins))
                    density = (hist / (hist.sum() or 1)).tolist()
                    bins_out = []
                    for i in range(len(hist)):
                        bins_out.append(
                            {
                                "bin_start": float(bin_edges[i]),
                                "bin_end": float(bin_edges[i + 1]),
                                "count": int(hist[i]),
                                "density": float(density[i]),
                            }
                        )
                    q1 = float(np.nanpercentile(values, 25))
                    q3 = float(np.nanpercentile(values, 75))
                    median = float(np.nanmedian(values))
                    entry.update(
                        {
                            "min": float(np.nanmin(values)),
                            "max": float(np.nanmax(values)),
                            "mean": float(np.nanmean(values)),
                            "std": float(np.nanstd(values)),
                            "skewness": float(pd.Series(values).skew()),
                            "kurtosis": float(pd.Series(values).kurtosis()),
                            "histogram": bins_out,
                            "boxplot": {
                                "q1": q1,
                                "q3": q3,
                                "median": median,
                                "iqr": float(q3 - q1),
                            },
                        }
                    )
            else:
                freq = series.dropna().astype(str).value_counts().head(30)
                entry["top_categories"] = [
                    {"value": k, "count": int(v)} for k, v in freq.items()
                ]
            results[col] = entry
        return {"rows_analyzed": int(df.shape[0]), "columns": results}

    def compute_quality_score(
        self,
        dataset: Dict,
        target_column: Optional[str],
        sample_rows: int,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        missing_rate = float(df.isna().mean().mean()) if df.shape[0] else 0.0
        duplicate_rate = float(df.duplicated().mean()) if df.shape[0] else 0.0
        numeric_df = df.select_dtypes(include=[np.number])
        outlier_rate = 0.0
        if not numeric_df.empty:
            rates = []
            for col in numeric_df.columns:
                values = numeric_df[col].dropna().to_numpy()
                if values.size == 0:
                    continue
                q1 = np.nanpercentile(values, 25)
                q3 = np.nanpercentile(values, 75)
                iqr = q3 - q1
                low = q1 - 1.5 * iqr
                high = q3 + 1.5 * iqr
                rates.append(float(((values < low) | (values > high)).mean()))
            outlier_rate = float(np.mean(rates)) if rates else 0.0
        imbalance = None
        if target_column and target_column in df.columns:
            tgt = self._coerce_binary_target(df[target_column]).astype(int)
            if tgt.shape[0]:
                positives = float((tgt == 1).sum())
                imbalance = positives / float(max(tgt.shape[0], 1))
        leakage_risk = 0.0
        if target_column and target_column in df.columns:
            tgt = pd.to_numeric(self._coerce_binary_target(df[target_column]), errors="coerce")
            for col in numeric_df.columns:
                if col == target_column:
                    continue
                corr = pd.Series(tgt).corr(numeric_df[col])
                if corr and abs(corr) > 0.85:
                    leakage_risk = max(leakage_risk, abs(corr))
        score = 100.0
        score -= min(40.0, missing_rate * 100)
        score -= min(25.0, duplicate_rate * 100)
        score -= min(20.0, outlier_rate * 100)
        if imbalance is not None:
            score -= min(10.0, abs(0.5 - imbalance) * 20)
        score -= min(10.0, leakage_risk * 10)
        score = max(0.0, min(100.0, score))
        return {
            "missing_rate": missing_rate,
            "duplicate_rate": duplicate_rate,
            "outlier_rate": outlier_rate,
            "imbalance": imbalance,
            "leakage_risk": leakage_risk,
            "score": score,
        }

    def compute_feature_target_matrix(
        self,
        dataset: Dict,
        target_column: str,
        sample_rows: int,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        if target_column not in df.columns:
            raise ValueError("target_column not found")
        target = self._coerce_binary_target(df[target_column]).astype(int)
        valid_target_mask = target.notna()
        if int(valid_target_mask.sum()) < 10:
            raise ValueError("target_column must have enough binary (0/1) rows")
        target = target.loc[valid_target_mask].astype(int)

        try:
            from sklearn.feature_selection import mutual_info_classif
        except Exception:
            mutual_info_classif = None

        results = []
        for col in df.columns:
            if col == target_column:
                continue
            series = df.loc[valid_target_mask, col]
            value = None
            pearson_corr = None
            fisher_score = None
            chi_square = None
            info_gain = None
            if pd.api.types.is_numeric_dtype(series):
                series_num = pd.to_numeric(series, errors="coerce")
                valid = ~(series_num.isna() | target.isna())
                if int(valid.sum()) >= 10:
                    xv = series_num[valid]
                    yv = target[valid]
                    pearson_corr = float(yv.corr(xv))
                    value = pearson_corr
                    pos_vals = xv[yv == 1]
                    neg_vals = xv[yv == 0]
                    mu_pos = float(pos_vals.mean()) if len(pos_vals) else 0.0
                    mu_neg = float(neg_vals.mean()) if len(neg_vals) else 0.0
                    var_pos = float(pos_vals.var()) if len(pos_vals) > 1 else 0.0
                    var_neg = float(neg_vals.var()) if len(neg_vals) > 1 else 0.0
                    fisher_score = float(((mu_pos - mu_neg) ** 2) / (var_pos + var_neg + 1e-9))
                    if mutual_info_classif is not None:
                        try:
                            mi = mutual_info_classif(
                                xv.to_frame(name=str(col)),
                                yv,
                                discrete_features=False,
                                random_state=42,
                            )
                            info_gain = float(mi[0])
                        except Exception:
                            info_gain = None
            else:
                x_cat = series.fillna("").astype(str)
                contingency = pd.crosstab(x_cat, target.fillna(""))
                if contingency.shape[0] > 1 and contingency.shape[1] > 1:
                    observed = contingency.to_numpy()
                    n = observed.sum()
                    row_sums = observed.sum(axis=1, keepdims=True)
                    col_sums = observed.sum(axis=0, keepdims=True)
                    expected = row_sums @ col_sums / (n or 1)
                    chi2 = ((observed - expected) ** 2 / (expected + 1e-6)).sum()
                    phi2 = chi2 / (n or 1)
                    r, k = contingency.shape
                    denom = max(1, min(k - 1, r - 1))
                    value = float(np.sqrt(phi2 / denom))
                    value = min(1.0, value)
                    chi_square = float(chi2)
                    if mutual_info_classif is not None:
                        try:
                            codes, _ = pd.factorize(x_cat)
                            mi = mutual_info_classif(
                                pd.DataFrame({"_x": codes}),
                                target,
                                discrete_features=True,
                                random_state=42,
                            )
                            info_gain = float(mi[0])
                        except Exception:
                            info_gain = None
            results.append(
                {
                    "feature": col,
                    "value": float(value) if value is not None and not pd.isna(value) else None,
                    "dtype": str(series.dtype),
                    "pearson_correlation": float(pearson_corr) if pearson_corr is not None and not pd.isna(pearson_corr) else None,
                    "fisher_score": float(fisher_score) if fisher_score is not None and not pd.isna(fisher_score) else None,
                    "chi_square": float(chi_square) if chi_square is not None and not pd.isna(chi_square) else None,
                    "information_gain": float(info_gain) if info_gain is not None and not pd.isna(info_gain) else None,
                }
            )
        results = sorted(
            results,
            key=lambda x: abs(x.get("information_gain") if x.get("information_gain") is not None else (x.get("value") or 0.0)),
            reverse=True,
        )
        return {"rows_analyzed": int(valid_target_mask.sum()), "matrix": results}

    def compute_leakage_checks(
        self,
        dataset: Dict,
        target_column: Optional[str],
        sample_rows: int,
        corr_threshold: float = 0.85,
        unique_threshold: float = 0.95,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        warnings = []
        for col in df.columns:
            series = df[col]
            unique_ratio = float(series.nunique(dropna=False) / (series.shape[0] or 1))
            name = str(col).lower()
            if "id" in name and unique_ratio > unique_threshold:
                warnings.append({"column": col, "type": "identifier_leakage", "unique_ratio": unique_ratio})
        if target_column and target_column in df.columns:
            target = pd.to_numeric(self._coerce_binary_target(df[target_column]), errors="coerce")
            for col in df.select_dtypes(include=[np.number]).columns:
                if col == target_column:
                    continue
                corr = pd.Series(target).corr(df[col])
                if corr and abs(corr) >= corr_threshold:
                    warnings.append({"column": col, "type": "high_correlation", "value": float(corr)})
        return {"warnings": warnings, "rows_analyzed": int(df.shape[0])}

    def _generate_str_from_files(
        self,
        data_dir: Path,
        output_path: Path,
    ) -> Dict:
        files = {p.stem.lower(): p for p in data_dir.glob("*.csv")}
        alerts = pd.read_csv(files["alerts"]) if "alerts" in files else None
        cases = pd.read_csv(files["cases"]) if "cases" in files else None
        txns = pd.read_csv(files["transactions"]) if "transactions" in files else None

        def col(df: Optional[pd.DataFrame], names: List[str]) -> Optional[str]:
            if df is None:
                return None
            lookup = {str(c).lower(): str(c) for c in df.columns}
            for n in names:
                found = lookup.get(str(n).lower())
                if found:
                    return found
            return None

        rng = np.random.default_rng(42)

        # Build an account/date basis from alerts first (preferred), then transactions fallback.
        basis_df: Optional[pd.DataFrame] = None
        basis_acct_col: Optional[str] = None
        basis_date_col: Optional[str] = None

        if alerts is not None:
            a_acct = col(alerts, ["account_id", "acct_id"])
            a_date = col(alerts, ["alert_date", "alert_timestamp", "created_at", "txn_timestamp", "txn_date", "date"])
            if a_acct and a_date:
                basis_df = alerts[[a_acct, a_date]].copy()
                basis_acct_col = a_acct
                basis_date_col = a_date

        if basis_df is None and txns is not None:
            t_acct = col(txns, ["account_id", "acct_id"])
            t_date = col(txns, ["txn_timestamp", "txn_date", "date", "created_at"])
            if t_acct and t_date:
                basis_df = txns[[t_acct, t_date]].copy()
                basis_acct_col = t_acct
                basis_date_col = t_date

        if basis_df is None or not basis_acct_col or not basis_date_col:
            raise ValueError(
                "Unable to generate STR dataset: need alerts.csv (ACCOUNT_ID + ALERT_DATE) "
                "or transactions.csv (ACCOUNT_ID + TXN_TIMESTAMP)."
            )

        basis_df[basis_date_col] = pd.to_datetime(basis_df[basis_date_col], errors="coerce")
        basis_df = basis_df.dropna(subset=[basis_acct_col, basis_date_col]).copy()
        if basis_df.empty:
            raise ValueError("Unable to generate STR dataset: no valid account/date rows found.")

        basis_df[basis_acct_col] = basis_df[basis_acct_col].astype(str)
        acct_first = (
            basis_df.groupby(basis_acct_col, dropna=True)[basis_date_col]
            .min()
            .reset_index()
            .rename(columns={basis_acct_col: "ACCOUNT_ID", basis_date_col: "first_alert_date"})
        )

        candidate_accounts: set[str] = set()

        # Prefer SAR-like case outcomes when cases and alerts are available.
        if alerts is not None and cases is not None:
            case_status_col = col(cases, ["case_status", "case_outcome", "disposition"])
            case_alert_col = col(cases, ["alert_id"])
            alert_id_col = col(alerts, ["alert_id"])
            alert_acct_col = col(alerts, ["account_id", "acct_id"])
            if case_status_col and case_alert_col and alert_id_col and alert_acct_col:
                sar_values = {
                    "CLOSED_SAR_FILED",
                    "SAR_FILED",
                    "SAR FILED",
                    "TRUE_POSITIVE",
                }
                case_hits = cases[[case_alert_col, case_status_col]].copy()
                case_hits[case_status_col] = case_hits[case_status_col].astype(str).str.strip().str.upper()
                case_hits = case_hits[case_hits[case_status_col].isin(sar_values)]
                if not case_hits.empty:
                    alert_map = alerts[[alert_id_col, alert_acct_col]].dropna().drop_duplicates(subset=[alert_id_col])
                    merged = case_hits.merge(alert_map, left_on=case_alert_col, right_on=alert_id_col, how="inner")
                    candidate_accounts.update(merged[alert_acct_col].astype(str).tolist())

        # Fallback: high-risk accounts by alert risk-score distribution.
        if not candidate_accounts and alerts is not None:
            alert_acct_col = col(alerts, ["account_id", "acct_id"])
            risk_col = col(alerts, ["risk_score", "alert_score", "risk"])
            if alert_acct_col and risk_col:
                risk_vals = pd.to_numeric(alerts[risk_col], errors="coerce")
                if risk_vals.notna().any():
                    cutoff = float(risk_vals.quantile(0.80))
                    high_risk_accounts = alerts.loc[risk_vals >= cutoff, alert_acct_col].dropna().astype(str).unique().tolist()
                    candidate_accounts.update(high_risk_accounts)

        all_accounts = acct_first["ACCOUNT_ID"].astype(str).tolist()
        if not all_accounts:
            raise ValueError("Unable to generate STR dataset: no ACCOUNT_ID values available.")

        if not candidate_accounts:
            sample_n = max(1, int(len(all_accounts) * 0.20))
            sampled = rng.choice(np.array(all_accounts), size=min(sample_n, len(all_accounts)), replace=False).tolist()
            candidate_accounts.update(sampled)
        else:
            # Add a small analyst-error tail: ~1% extra random accounts.
            non_candidates = [a for a in all_accounts if a not in candidate_accounts]
            if non_candidates:
                noise_n = max(1, int(len(non_candidates) * 0.01))
                noise = rng.choice(np.array(non_candidates), size=min(noise_n, len(non_candidates)), replace=False).tolist()
                candidate_accounts.update(noise)

        out = acct_first[acct_first["ACCOUNT_ID"].isin(candidate_accounts)].copy()
        if out.empty:
            out = acct_first.sample(n=min(max(1, int(len(acct_first) * 0.20)), len(acct_first)), random_state=42).copy()

        delays = rng.integers(5, 75, size=len(out))
        out["str_filed_date"] = pd.to_datetime(out["first_alert_date"], errors="coerce") + pd.to_timedelta(delays, unit="D")
        out = out[["ACCOUNT_ID", "str_filed_date"]].dropna().sort_values("str_filed_date").reset_index(drop=True)
        out["str_filed_date"] = pd.to_datetime(out["str_filed_date"]).dt.strftime("%Y-%m-%d")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        out.to_csv(output_path, index=False)
        return {
            "rows": int(out.shape[0]),
            "path": str(output_path),
            "columns": ["ACCOUNT_ID", "str_filed_date"],
            "note": "STR dataset simplified to ACCOUNT_ID + str_filed_date.",
        }

    def generate_str_dataset(self, *args) -> Dict:
        # Backward compatibility:
        # 1) generate_str_dataset(data_dir, output_path)
        # 2) generate_str_dataset(tenant_id, env_id, datasets)
        if len(args) == 2 and isinstance(args[0], Path) and isinstance(args[1], Path):
            return self._generate_str_from_files(args[0], args[1])

        if len(args) == 3:
            tenant_id = str(args[0])
            env_id = str(args[1])
            _ = args[2]  # datasets list not required; we build from the MLOps data directory
            data_dir = self._data_dir()
            output_path = data_dir / "str.csv"
            result = self._generate_str_from_files(data_dir, output_path)
            dataset = self.register_dataset(
                tenant_id=tenant_id,
                env_id=env_id,
                dataset_type="str",
                filename=output_path.name,
                file_path=output_path,
            )
            return {"str": result, "dataset": dataset}

        raise ValueError("generate_str_dataset expects (data_dir, output_path) or (tenant_id, env_id, datasets)")

    def compute_pairplot(
        self,
        dataset: Dict,
        columns: List[str],
        sample_rows: int,
        bins: int = 20,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), columns, sample_rows)
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        numeric_cols = [c for c in numeric_cols if c in columns]
        result = {"columns": numeric_cols, "pairs": []}
        for i, x in enumerate(numeric_cols):
            for j, y in enumerate(numeric_cols):
                if j < i:
                    continue
                data = df[[x, y]].dropna()
                if data.empty:
                    continue
                if x == y:
                    values = data[x].to_numpy()
                    hist, bin_edges = np.histogram(values, bins=int(bins))
                    bins_out = []
                    for k in range(len(hist)):
                        bins_out.append(
                            {
                                "bin_start": float(bin_edges[k]),
                                "bin_end": float(bin_edges[k + 1]),
                                "count": int(hist[k]),
                            }
                        )
                    result["pairs"].append({"x": x, "y": y, "type": "hist", "bins": bins_out})
                else:
                    sampled = data.sample(min(800, len(data)), random_state=42)
                    points = sampled.to_dict(orient="records")
                    result["pairs"].append({"x": x, "y": y, "type": "scatter", "points": points})
        return result

    def compute_interaction_heatmap(
        self,
        dataset: Dict,
        columns: List[str],
        sample_rows: int,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), columns, sample_rows)
        numeric_df = df.select_dtypes(include=[np.number])
        corr = numeric_df.corr().fillna(0.0)
        matrix = []
        cols = list(corr.columns)
        for i, c1 in enumerate(cols):
            for j, c2 in enumerate(cols):
                matrix.append({"x": c1, "y": c2, "value": float(corr.iloc[i, j])})
        return {"columns": cols, "matrix": matrix}

    def compute_bivariate_categorical(
        self,
        dataset: Dict,
        column_x: str,
        column_y: str,
        sample_rows: int,
        limit: int = 20,
    ) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), [column_x, column_y], sample_rows)
        df[column_x] = df[column_x].astype(str).fillna("unknown")
        df[column_y] = df[column_y].astype(str).fillna("unknown")
        contingency = pd.crosstab(df[column_x], df[column_y])
        top_x = contingency.sum(axis=1).sort_values(ascending=False).head(limit).index
        top_y = contingency.sum(axis=0).sort_values(ascending=False).head(limit).index
        trimmed = contingency.loc[top_x, top_y]
        matrix = []
        for x_val in trimmed.index:
            for y_val in trimmed.columns:
                matrix.append(
                    {
                        "x": str(x_val),
                        "y": str(y_val),
                        "value": int(trimmed.loc[x_val, y_val]),
                    }
                )
        return {"x_values": [str(v) for v in trimmed.index], "y_values": [str(v) for v in trimmed.columns], "matrix": matrix}

    def save_str_rules(self, tenant_id: str, env_id: str, rules: List[Dict]) -> Dict:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_str_rules (
                  rule_id INTEGER PRIMARY KEY DEFAULT nextval('mlops_snapshot_seq'),
                  tenant_id TEXT,
                  env_id TEXT,
                  rules_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            rule_id = conn.execute("SELECT nextval('mlops_snapshot_seq')").fetchone()[0]
            conn.execute(
                """
                INSERT INTO mlops_str_rules (rule_id, tenant_id, env_id, rules_json)
                VALUES (?, ?, ?, ?)
                """,
                [int(rule_id), tenant_id, env_id, json.dumps(rules or [], default=str)],
            )
        return {"rule_id": int(rule_id)}

    def _coerce_numeric_series(
        self,
        series: pd.Series,
        min_ratio: float = 0.85,
    ) -> Tuple[Optional[pd.Series], float]:
        if pd.api.types.is_bool_dtype(series):
            numeric = pd.to_numeric(series.astype("Int64"), errors="coerce")
            return numeric, 1.0
        if pd.api.types.is_numeric_dtype(series):
            numeric = pd.to_numeric(series, errors="coerce")
            return numeric, 1.0

        numeric = pd.to_numeric(series, errors="coerce")
        non_null_mask = series.notna()
        parse_ratio = float(numeric.loc[non_null_mask].notna().mean()) if int(non_null_mask.sum()) else 0.0
        if parse_ratio >= min_ratio:
            return numeric, parse_ratio
        return None, parse_ratio

    def build_preprocessing_plan(self, dataset: Dict, sample_rows: int = 5000) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        grouped: Dict[str, Dict[str, Any]] = {}

        def add_grouped_suggestion(step_type: str, column: str, **payload) -> None:
            key_payload = {"type": step_type, **payload}
            group_key = json.dumps(key_payload, sort_keys=True, default=str)
            entry = grouped.setdefault(group_key, {"type": step_type, "columns": [], **payload})
            entry["columns"].append(column)

        def build_explanation(step: Dict[str, Any]) -> str:
            columns = list(step.get("columns") or [])
            count = len(columns)
            plural = "" if count == 1 else "s"
            preview = ", ".join(columns[:3])
            if count > 3:
                preview = f"{preview}, +{count - 3} more"

            if step["type"] == "mapping_id":
                return (
                    f"{count} identifier-like column{plural} can be retained for audit and mapping only"
                    f" while excluded from model features: {preview}."
                )
            if step["type"] == "imputation":
                strategy = str(step.get("strategy") or "median")
                value = step.get("value")
                value_msg = f" (fill value: {value})" if value is not None else ""
                return (
                    f"{count} column{plural} have missing values and can share one {strategy}"
                    f" imputation step{value_msg}: {preview}."
                )
            if step["type"] == "datetime_extract":
                return (
                    f"{count} datetime-like column{plural} can be expanded into reusable date parts: {preview}."
                )
            if step["type"] == "encoding_frequency":
                return (
                    f"{count} high-cardinality categorical column{plural} are better handled"
                    f" with frequency encoding: {preview}."
                )
            if step["type"] == "encoding_onehot":
                return (
                    f"{count} low-cardinality categorical column{plural} are suitable"
                    f" for one-hot encoding together: {preview}."
                )
            return f"{count} column{plural}: {preview}."

        for col in df.columns:
            series = df[col]
            missing_pct = float(series.isna().mean()) if len(series) else 0.0
            name = str(col).lower()
            non_null = series.dropna()
            unique_count = int(series.nunique(dropna=True))
            unique_ratio = float(unique_count / max(1, len(series)))
            numeric_series, numeric_ratio = self._coerce_numeric_series(series, min_ratio=0.85)
            is_numeric_like = numeric_series is not None and numeric_series.notna().any()

            id_name = (
                name == "id"
                or name.endswith("_id")
                or name.startswith("id_")
                or any(k in name for k in ["transaction_id", "account_id", "customer_id", "case_id", "alert_id"])
            )
            is_id_like = id_name and (unique_ratio >= 0.20 or unique_count >= 50)

            datetime_hint = any(k in name for k in ["date", "time", "timestamp", "dob", "created"])
            parse_ratio = 0.0
            if len(non_null) and (series.dtype == "object" or datetime_hint):
                sample_parse = pd.to_datetime(non_null.head(1000), errors="coerce")
                parse_ratio = float(sample_parse.notna().mean()) if len(sample_parse) else 0.0
            is_datetime_like = (
                pd.api.types.is_datetime64_any_dtype(series)
                or (datetime_hint and parse_ratio >= 0.30)
                or parse_ratio >= 0.80
            )

            if is_id_like:
                add_grouped_suggestion(
                    "mapping_id",
                    col,
                    mapping_only=True,
                )
                continue

            if missing_pct > 0:
                if is_numeric_like:
                    strategy = "median" if missing_pct > 0.2 else "mean"
                else:
                    strategy = "mode" if missing_pct < 0.5 else "constant"
                add_grouped_suggestion(
                    "imputation",
                    col,
                    strategy=strategy,
                    value="unknown" if strategy == "constant" else None,
                )
            if is_datetime_like:
                add_grouped_suggestion(
                    "datetime_extract",
                    col,
                    drop_original=True,
                )
                # Do not add one-hot/frequency encoding suggestions on date columns.
                continue
            if str(series.dtype) == "object" and numeric_ratio < 0.85:
                high_cardinality = unique_count > max(30, int(0.15 * max(1, len(series))))
                if high_cardinality:
                    add_grouped_suggestion(
                        "encoding_frequency",
                        col,
                    )
                else:
                    add_grouped_suggestion(
                        "encoding_onehot",
                        col,
                        max_categories=30,
                    )
        suggestions: List[Dict[str, Any]] = []
        priority = {
            "mapping_id": 0,
            "imputation": 1,
            "datetime_extract": 2,
            "encoding_frequency": 3,
            "encoding_onehot": 4,
        }
        for step in grouped.values():
            columns = sorted(dict.fromkeys(step.get("columns") or []))
            payload = {k: v for k, v in step.items() if k != "columns"}
            payload["columns"] = columns
            payload["column_count"] = len(columns)
            payload["column_preview"] = columns[:6]
            payload["explanation"] = build_explanation(payload)
            suggestions.append(payload)

        suggestions.sort(
            key=lambda item: (
                priority.get(str(item.get("type") or ""), 99),
                -int(item.get("column_count") or 0),
                str(item.get("type") or ""),
            )
        )
        return {"suggestions": suggestions}

    def _impute_knn(self, df: pd.DataFrame, column: str, k: int = 5, max_rows: int = 1500):
        if column not in df.columns:
            return df
        sample = df.copy()
        if len(sample) > max_rows:
            sample = sample.sample(max_rows, random_state=42)
        numeric_cols = sample.select_dtypes(include=[np.number]).columns.tolist()
        if column not in numeric_cols:
            return df
        other_cols = [c for c in numeric_cols if c != column]
        if not other_cols:
            return df
        missing_idx = sample[sample[column].isna()].index
        if missing_idx.empty:
            return df
        complete = sample.dropna(subset=[column])
        if complete.empty:
            return df
        X_complete = complete[other_cols].fillna(complete[other_cols].mean()).to_numpy()
        y_complete = complete[column].to_numpy()
        for idx in missing_idx:
            row = sample.loc[idx, other_cols].fillna(complete[other_cols].mean())
            x = row.to_numpy()
            distances = np.linalg.norm(X_complete - x, axis=1)
            nearest = np.argsort(distances)[:k]
            sample.loc[idx, column] = float(np.nanmean(y_complete[nearest]))
        df.loc[sample.index, column] = sample[column]
        return df

    def _impute_mice(self, df: pd.DataFrame, column: str, iterations: int = 3):
        if column not in df.columns:
            return df
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        if column not in numeric_cols:
            return df
        others = [c for c in numeric_cols if c != column]
        if not others:
            return df
        work = df[numeric_cols].copy()
        work = work.apply(lambda s: s.fillna(s.mean()), axis=0)
        for _ in range(iterations):
            known = df[column].notna()
            X = work.loc[known, others].to_numpy()
            y = df.loc[known, column].to_numpy()
            if len(y) == 0:
                break
            coef, *_ = np.linalg.lstsq(X, y, rcond=None)
            missing = df[column].isna()
            if missing.any():
                X_missing = work.loc[missing, others].to_numpy()
                preds = X_missing @ coef
                work.loc[missing, column] = preds
        df[column] = work[column]
        return df

    def _preprocess_step_meta(self, step_type: str) -> Dict[str, str]:
        stype = str(step_type or "").lower()
        category_map = {
            "mapping_id": "select",
            "tag_mapping_id": "select",
            "keep_mapping": "select",
            "drop_columns": "select",
            "imputation": "clean",
            "drop_duplicates": "clean",
            "encoding_label": "encode",
            "encoding_onehot": "encode",
            "encoding_ordinal": "encode",
            "encoding_frequency": "encode",
            "scaling_standard": "scale",
            "scaling_minmax": "scale",
            "scaling_robust": "scale",
            "normalize_l2": "scale",
            "feature_polynomial": "feat",
            "feature_interaction": "feat",
            "feature_ratio": "feat",
            "feature_aggregation": "feat",
            "datetime_extract": "feat",
            "text_features": "feat",
        }
        label_map = {
            "mapping_id": "Mapping ID",
            "tag_mapping_id": "Tag Mapping ID",
            "keep_mapping": "Keep Mapping",
            "drop_columns": "Drop Columns",
            "imputation": "Imputation",
            "drop_duplicates": "Drop Duplicates",
            "encoding_label": "Label Encoding",
            "encoding_onehot": "One-Hot Encoding",
            "encoding_ordinal": "Ordinal Encoding",
            "encoding_frequency": "Frequency Encoding",
            "scaling_standard": "Standard Scaling",
            "scaling_minmax": "Min-Max Scaling",
            "scaling_robust": "Robust Scaling",
            "normalize_l2": "L2 Normalization",
            "feature_polynomial": "Polynomial Features",
            "feature_interaction": "Feature Interaction",
            "feature_ratio": "Feature Ratio",
            "feature_aggregation": "Feature Aggregation",
            "datetime_extract": "Datetime Extract",
            "text_features": "Text Features",
        }
        return {
            "category": category_map.get(stype, "clean"),
            "label": label_map.get(stype, stype.replace("_", " ").title() or "Step"),
        }

    def _preprocess_step_columns(
        self,
        step: Dict[str, Any],
        available_columns: List[str],
    ) -> Tuple[List[str], List[str], List[str]]:
        available_set = set(available_columns)
        requested: List[str] = []
        for col in step.get("columns") or []:
            if isinstance(col, str) and col:
                requested.append(col)

        for pair in step.get("pairs") or []:
            if not isinstance(pair, dict):
                continue
            for key in ("a", "b"):
                value = pair.get(key)
                if isinstance(value, str) and value:
                    requested.append(value)

        for key in ("group_by", "target"):
            value = step.get(key)
            if isinstance(value, str) and value:
                requested.append(value)

        requested = list(dict.fromkeys(requested))
        affected = [c for c in requested if c in available_set]
        missing = [c for c in requested if c not in available_set]
        return affected, requested, missing

    def _build_preprocess_trace_step(
        self,
        step_index: int,
        step: Dict[str, Any],
        before_columns: List[str],
        after_columns: List[str],
        before_rows: int,
        after_rows: int,
        affected_columns: List[str],
        requested_columns: List[str],
        missing_columns: List[str],
    ) -> Dict[str, Any]:
        stype = str(step.get("type") or "").lower()
        meta = self._preprocess_step_meta(stype)
        before_set = set(before_columns)
        after_set = set(after_columns)
        added_columns = [c for c in after_columns if c not in before_set]
        dropped_columns = [c for c in before_columns if c not in after_set]
        col_delta = int(len(after_columns) - len(before_columns))
        row_delta = int(after_rows - before_rows)

        notes: List[str] = []
        if step.get("strategy"):
            notes.append(f"strategy={step.get('strategy')}")
        if stype == "encoding_onehot" and step.get("max_categories") is not None:
            notes.append(f"max_categories={int(step.get('max_categories') or 0)}")
        if stype == "feature_polynomial":
            notes.append(f"degree={int(step.get('degree') or 2)}")
        if stype == "feature_aggregation":
            group_by = step.get("group_by")
            target = step.get("target")
            agg = step.get("agg", "mean")
            if group_by and target:
                notes.append(f"{agg}({target}) by {group_by}")
        if stype in {"feature_ratio", "feature_interaction"} and (step.get("pairs") or []):
            notes.append(f"pairs={len(step.get('pairs') or [])}")
        if missing_columns:
            notes.append(f"missing={len(missing_columns)}")

        no_change = (
            before_rows == after_rows
            and before_columns == after_columns
            and len(affected_columns) == 0
            and len(added_columns) == 0
            and len(dropped_columns) == 0
        )

        return {
            "step_index": int(step_index),
            "step_type": stype,
            "label": meta["label"],
            "category": meta["category"],
            "status": "skipped" if no_change else "applied",
            "before_rows": int(before_rows),
            "after_rows": int(after_rows),
            "row_delta": row_delta,
            "before_columns_count": int(len(before_columns)),
            "after_columns_count": int(len(after_columns)),
            "col_delta": col_delta,
            "requested_columns": requested_columns,
            "requested_columns_count": int(len(requested_columns)),
            "missing_columns": missing_columns,
            "missing_columns_count": int(len(missing_columns)),
            "affected_columns": affected_columns,
            "affected_columns_count": int(len(affected_columns)),
            "affected_columns_sample": affected_columns[:12],
            "added_columns": added_columns if len(added_columns) <= 50 else [],
            "added_columns_count": int(len(added_columns)),
            "added_columns_sample": added_columns[:12],
            "dropped_columns": dropped_columns if len(dropped_columns) <= 50 else [],
            "dropped_columns_count": int(len(dropped_columns)),
            "dropped_columns_sample": dropped_columns[:12],
            "notes": notes,
        }

    def _summarize_preprocess_trace(
        self,
        trace_steps: List[Dict[str, Any]],
        input_rows: int,
        input_columns: int,
        output_rows: int,
        output_columns: int,
    ) -> Dict[str, Any]:
        category_labels = {
            "clean": "Cleaning",
            "encode": "Encoding",
            "scale": "Scaling",
            "feat": "Feature Engineering",
            "select": "Selection & Mapping",
        }
        by_category: Dict[str, Dict[str, Any]] = {}
        for item in trace_steps:
            cat = str(item.get("category") or "clean")
            current = by_category.setdefault(
                cat,
                {
                    "category": cat,
                    "label": category_labels.get(cat, cat.title()),
                    "steps": 0,
                    "applied_steps": 0,
                    "added_columns": 0,
                    "dropped_columns": 0,
                },
            )
            current["steps"] += 1
            if item.get("status") == "applied":
                current["applied_steps"] += 1
            current["added_columns"] += int(item.get("added_columns_count") or 0)
            current["dropped_columns"] += int(item.get("dropped_columns_count") or 0)

        ordered_categories = ["clean", "encode", "scale", "feat", "select"]
        categories = [by_category[c] for c in ordered_categories if c in by_category]
        for cat, payload in by_category.items():
            if cat not in ordered_categories:
                categories.append(payload)

        return {
            "input_rows": int(input_rows),
            "input_columns": int(input_columns),
            "output_rows": int(output_rows),
            "output_columns": int(output_columns),
            "row_delta": int(output_rows - input_rows),
            "column_delta": int(output_columns - input_columns),
            "total_steps": int(len(trace_steps)),
            "applied_steps": int(sum(1 for item in trace_steps if item.get("status") == "applied")),
            "categories": categories,
        }

    def apply_preprocessing(self, df: pd.DataFrame, steps: List[Dict], include_trace: bool = False):
        trace_steps: List[Dict[str, Any]] = []
        for idx, raw_step in enumerate(steps or [], start=1):
            step = raw_step if isinstance(raw_step, dict) else {}
            stype = str(step.get("type") or "").lower()
            columns = step.get("columns") or []

            before_rows = int(df.shape[0])
            before_columns = list(df.columns)
            affected_columns, requested_columns, missing_columns = self._preprocess_step_columns(step, before_columns)

            if stype in {"mapping_id", "tag_mapping_id", "keep_mapping"}:
                # Marker-only step: keep these columns in dataset for traceability.
                pass
            elif stype == "drop_columns":
                drop_cols = [c for c in columns if c in df.columns]
                if drop_cols:
                    df = df.drop(columns=drop_cols)
            elif stype == "imputation":
                strategy = step.get("strategy") or "mean"
                value = step.get("value")
                for col in columns:
                    if col not in df.columns:
                        continue
                    if strategy == "mean":
                        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(df[col].mean())
                    elif strategy == "median":
                        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(df[col].median())
                    elif strategy == "mode":
                        mode = df[col].mode()
                        df[col] = df[col].fillna(mode.iloc[0] if len(mode) else None)
                    elif strategy == "constant":
                        df[col] = df[col].fillna(value)
                    elif strategy == "ffill":
                        df[col] = df[col].fillna(method="ffill")
                    elif strategy == "bfill":
                        df[col] = df[col].fillna(method="bfill")
                    elif strategy == "interpolate":
                        df[col] = pd.to_numeric(df[col], errors="coerce").interpolate()
                    elif strategy == "knn":
                        df = self._impute_knn(df, col, k=int(step.get("k", 5)))
                    elif strategy == "mice":
                        df = self._impute_mice(df, col, iterations=int(step.get("iterations", 3)))
            elif stype == "encoding_label":
                for col in columns:
                    if col not in df.columns:
                        continue
                    labels = {k: i for i, k in enumerate(df[col].astype(str).unique())}
                    df[col] = df[col].astype(str).map(labels)
            elif stype == "encoding_onehot":
                max_categories = int(step.get("max_categories") or 30)
                safe_ohe = []
                fallback_freq = []
                for col in [c for c in columns if c in df.columns]:
                    levels = int(df[col].astype(str).fillna("UNKNOWN").nunique(dropna=False))
                    if levels <= max_categories:
                        safe_ohe.append(col)
                    else:
                        fallback_freq.append(col)

                if safe_ohe:
                    df = pd.get_dummies(df, columns=safe_ohe, dummy_na=False)

                for col in fallback_freq:
                    s = df[col].astype(str).str.strip().replace({"": "UNKNOWN", "nan": "UNKNOWN", "None": "UNKNOWN"}).fillna("UNKNOWN")
                    freq = s.value_counts(normalize=True).to_dict()
                    df[f"{col}_freq"] = s.map(freq).fillna(0.0).astype(float)
                    df = df.drop(columns=[col])
            elif stype == "encoding_ordinal":
                order = step.get("order") or []
                for col in columns:
                    if col not in df.columns:
                        continue
                    mapping = {v: i for i, v in enumerate(order)}
                    df[col] = df[col].astype(str).map(mapping).fillna(-1)
            elif stype == "encoding_frequency":
                for col in columns:
                    if col not in df.columns:
                        continue
                    s = df[col].astype(str).str.strip().replace({"": "UNKNOWN", "nan": "UNKNOWN", "None": "UNKNOWN"}).fillna("UNKNOWN")
                    freq = s.value_counts(normalize=True).to_dict()
                    df[col] = s.map(freq).fillna(0.0).astype(float)
            elif stype == "scaling_standard":
                for col in columns:
                    if col not in df.columns:
                        continue
                    v = pd.to_numeric(df[col], errors="coerce")
                    df[col] = (v - v.mean()) / (v.std() or 1.0)
            elif stype == "scaling_minmax":
                for col in columns:
                    if col not in df.columns:
                        continue
                    v = pd.to_numeric(df[col], errors="coerce")
                    minv, maxv = float(v.min()), float(v.max())
                    df[col] = (v - minv) / ((maxv - minv) or 1.0)
            elif stype == "scaling_robust":
                for col in columns:
                    if col not in df.columns:
                        continue
                    v = pd.to_numeric(df[col], errors="coerce")
                    q1 = v.quantile(0.25)
                    q3 = v.quantile(0.75)
                    df[col] = (v - q1) / ((q3 - q1) or 1.0)
            elif stype == "normalize_l2":
                cols = [c for c in columns if c in df.columns]
                if cols:
                    vals = df[cols].apply(pd.to_numeric, errors="coerce").fillna(0.0).to_numpy()
                    norms = np.linalg.norm(vals, axis=1, keepdims=True)
                    norms[norms == 0] = 1.0
                    df[cols] = vals / norms
            elif stype == "feature_polynomial":
                degree = int(step.get("degree", 2))
                cols = [c for c in columns if c in df.columns]
                for col in cols:
                    v = pd.to_numeric(df[col], errors="coerce")
                    for d in range(2, degree + 1):
                        df[f"{col}_pow{d}"] = v ** d
            elif stype == "feature_interaction":
                pairs = step.get("pairs") or []
                for p in pairs:
                    a, b = p.get("a"), p.get("b")
                    if a in df.columns and b in df.columns:
                        df[f"{a}_x_{b}"] = pd.to_numeric(df[a], errors="coerce") * pd.to_numeric(df[b], errors="coerce")
            elif stype == "feature_ratio":
                pairs = step.get("pairs") or []
                for p in pairs:
                    a, b = p.get("a"), p.get("b")
                    if a in df.columns and b in df.columns:
                        denom = pd.to_numeric(df[b], errors="coerce").replace(0, np.nan)
                        df[f"{a}_div_{b}"] = pd.to_numeric(df[a], errors="coerce") / denom
            elif stype == "feature_aggregation":
                group_by = step.get("group_by")
                target = step.get("target")
                agg = step.get("agg", "mean")
                if group_by in df.columns and target in df.columns:
                    agg_map = df.groupby(group_by)[target].agg(agg)
                    df[f"{target}_{agg}_by_{group_by}"] = df[group_by].map(agg_map)
            elif stype == "datetime_extract":
                for col in columns:
                    if col not in df.columns:
                        continue
                    dt = pd.to_datetime(df[col], errors="coerce")
                    if dt.notna().sum() == 0:
                        continue
                    df[f"{col}_year"] = dt.dt.year
                    df[f"{col}_month"] = dt.dt.month
                    df[f"{col}_day"] = dt.dt.day
                    df[f"{col}_dow"] = dt.dt.dayofweek
                    df[f"{col}_hour"] = dt.dt.hour
                    if bool(step.get("drop_original", True)):
                        df = df.drop(columns=[col])
            elif stype == "text_features":
                for col in columns:
                    if col not in df.columns:
                        continue
                    s = df[col].astype(str)
                    df[f"{col}_len"] = s.str.len()
                    df[f"{col}_words"] = s.str.split().str.len()
                    df[f"{col}_has_num"] = s.str.contains(r"\d").astype(int)

            if include_trace:
                trace_steps.append(
                    self._build_preprocess_trace_step(
                        step_index=idx,
                        step=step,
                        before_columns=before_columns,
                        after_columns=list(df.columns),
                        before_rows=before_rows,
                        after_rows=int(df.shape[0]),
                        affected_columns=affected_columns,
                        requested_columns=requested_columns,
                        missing_columns=missing_columns,
                    )
                )

        if include_trace:
            return df, trace_steps
        return df

    def _apply_preprocessing_preserve_target(
        self,
        df: pd.DataFrame,
        steps: List[Dict],
        target_column: Optional[str],
        include_trace: bool = False,
    ):
        if target_column and target_column in df.columns:
            target = df[target_column].copy()
            work_df = df.drop(columns=[target_column])
            if include_trace:
                work_df, trace_steps = self.apply_preprocessing(work_df, steps, include_trace=True)
                work_df[target_column] = target
                return work_df, trace_steps
            work_df = self.apply_preprocessing(work_df, steps)
            work_df[target_column] = target
            return work_df

        if include_trace:
            return self.apply_preprocessing(df, steps, include_trace=True)
        return self.apply_preprocessing(df, steps)

    def preview_preprocessing(self, dataset: Dict, steps: List[Dict], sample_rows: int, target_column: Optional[str] = None) -> Dict:
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        input_rows = int(df.shape[0])
        input_columns = int(df.shape[1])
        df, trace_steps = self._apply_preprocessing_preserve_target(df, steps, target_column, include_trace=True)
        summary = self._summarize_preprocess_trace(
            trace_steps=trace_steps,
            input_rows=input_rows,
            input_columns=input_columns,
            output_rows=int(df.shape[0]),
            output_columns=int(df.shape[1]),
        )
        return _json_safe_value({
            "row_count": int(df.shape[0]),
            "columns": list(df.columns),
            "preview": df.head(25).to_dict(orient="records"),
            "trace": {"summary": summary, "steps": trace_steps},
        })

    def run_preprocessing(self, dataset: Dict, steps: List[Dict], output_path: Path, target_column: Optional[str] = None) -> Dict:
        rel = self._relation_expr(Path(dataset["file_path"]), sample_size=None)
        with duckdb.connect() as conn:
            df = conn.execute(f"SELECT * FROM {rel}").df()
        input_rows = int(df.shape[0])
        input_columns = int(df.shape[1])
        df, trace_steps = self._apply_preprocessing_preserve_target(df, steps, target_column, include_trace=True)
        output_rows = int(df.shape[0])
        output_columns = int(df.shape[1])
        output_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(output_path, index=False)
        summary = self._summarize_preprocess_trace(
            trace_steps=trace_steps,
            input_rows=input_rows,
            input_columns=input_columns,
            output_rows=output_rows,
            output_columns=output_columns,
        )
        return _json_safe_value({
            "rows": output_rows,
            "path": str(output_path),
            "columns": list(df.columns),
            "trace": {
                "summary": summary,
                "steps": trace_steps,
                "dataset_type": str(dataset.get("dataset_type") or ""),
                "target_column_preserved": bool(target_column and target_column in list(df.columns)),
            },
        })

    def _find_col(self, df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
        lookup = {str(c).lower(): c for c in df.columns}
        for candidate in candidates:
            found = lookup.get(str(candidate).lower())
            if found:
                return found
        return None

    def _load_dataset_frame(self, dataset: Dict) -> pd.DataFrame:
        rel = self._relation_expr(Path(dataset["file_path"]), sample_size=None)
        with duckdb.connect() as conn:
            return conn.execute(f"SELECT * FROM {rel}").df()

    def _normalize_dataset_role(self, dataset_type: str) -> str:
        raw = str(dataset_type or "").strip().lower()
        if not raw:
            return ""
        compact = raw.replace("-", "_").replace(" ", "_")
        if compact in {"alert", "alerts"} or compact.startswith("alert_") or compact.endswith("_alerts"):
            return "alerts"
        if compact in {"case", "cases"} or compact.startswith("case_") or compact.endswith("_cases"):
            return "cases"
        if compact in {"transaction", "transactions", "txn", "txns"} or compact.startswith("txn_") or compact.startswith("transaction_") or compact.endswith("_transactions"):
            return "transactions"
        if compact in {"account", "accounts", "acct", "accts"} or compact.startswith("acct_") or compact.startswith("account_") or compact.endswith("_accounts"):
            return "accounts"
        if compact in {"customer", "customers", "cust", "custs"} or compact.startswith("cust_") or compact.startswith("customer_") or compact.endswith("_customers"):
            return "customers"
        if compact in {"str", "sar", "sars", "strs"} or compact.startswith("str_") or compact.startswith("sar_") or compact.endswith("_str") or compact.endswith("_sar"):
            return "str"
        return compact

    def _dataset_key_for_role(self, by_type: Dict[str, Dict], role: str) -> Optional[str]:
        wanted = self._normalize_dataset_role(role)
        if not wanted:
            return None
        for key in by_type.keys():
            if self._normalize_dataset_role(key) == wanted:
                return key
        return None

    def _build_txn_aggregate_frame(self, txn_df: pd.DataFrame) -> Tuple[pd.DataFrame, Optional[str]]:
        account_col = self._find_col(txn_df, ["account_id", "acct_id"])
        if not account_col:
            return pd.DataFrame(), None

        work = txn_df.copy()
        amount_col = self._find_col(work, ["txn_amount", "transaction_amount", "amount"])
        txn_id_col = self._find_col(work, ["transaction_id", "txn_id", "id"])
        type_col = self._find_col(work, ["txn_type", "transaction_type", "type"])
        channel_col = self._find_col(work, ["channel", "txn_channel"])
        ben_col = self._find_col(work, ["beneficiary_country", "beneficiary_ctry", "destination_country"])

        if amount_col:
            work[amount_col] = pd.to_numeric(work[amount_col], errors="coerce")

        if type_col:
            type_upper = work[type_col].astype(str).str.upper()
            work["__is_cash"] = type_upper.isin(["CASH_DEPOSIT", "CASH_WITHDRAWAL"]).astype(int)
            work["__is_swift"] = (type_upper == "SWIFT").astype(int)

        if ben_col:
            high_risk = {"KY", "VG", "NG", "IR", "PK"}
            work["__is_high_risk_dest"] = work[ben_col].astype(str).str.upper().isin(high_risk).astype(int)

        agg_spec: Dict[str, Tuple[str, str]] = {}
        agg_spec["txn_count"] = (txn_id_col or account_col, "count")
        if amount_col:
            agg_spec["total_txn_volume"] = (amount_col, "sum")
            agg_spec["avg_txn_amount"] = (amount_col, "mean")
            agg_spec["max_txn_amount"] = (amount_col, "max")
            agg_spec["std_txn_amount"] = (amount_col, "std")
        if channel_col:
            agg_spec["unique_channels"] = (channel_col, "nunique")
        if ben_col:
            agg_spec["unique_beneficiary_countries"] = (ben_col, "nunique")
        if "__is_cash" in work.columns:
            agg_spec["cash_txn_count"] = ("__is_cash", "sum")
        if "__is_swift" in work.columns:
            agg_spec["swift_txn_count"] = ("__is_swift", "sum")
        if "__is_high_risk_dest" in work.columns:
            agg_spec["pct_high_risk_dest"] = ("__is_high_risk_dest", "mean")

        if not agg_spec:
            agg_df = work[[account_col]].drop_duplicates().copy()
        else:
            agg_df = work.groupby(account_col, dropna=False).agg(**agg_spec).reset_index()

        if "pct_high_risk_dest" in agg_df.columns:
            agg_df["pct_high_risk_dest"] = pd.to_numeric(agg_df["pct_high_risk_dest"], errors="coerce").fillna(0.0) * 100.0
        if "std_txn_amount" in agg_df.columns:
            agg_df["std_txn_amount"] = pd.to_numeric(agg_df["std_txn_amount"], errors="coerce").fillna(0.0)

        if "max_txn_amount" in agg_df.columns and "avg_txn_amount" in agg_df.columns:
            avg_vals = pd.to_numeric(agg_df["avg_txn_amount"], errors="coerce").fillna(0.0)
            max_vals = pd.to_numeric(agg_df["max_txn_amount"], errors="coerce").fillna(0.0)
            agg_df["velocity_ratio"] = max_vals / (avg_vals + 1.0)
        else:
            agg_df["velocity_ratio"] = 0.0

        expected_metrics = [
            "total_txn_volume",
            "txn_count",
            "avg_txn_amount",
            "max_txn_amount",
            "std_txn_amount",
            "unique_channels",
            "unique_beneficiary_countries",
            "cash_txn_count",
            "swift_txn_count",
            "pct_high_risk_dest",
            "velocity_ratio",
            "w7_vol",
            "w7_cnt",
            "w7_avg_amt",
            "w7_max_amt",
            "w7_std_amt",
            "w30_vol",
            "w30_cnt",
            "w30_avg_amt",
            "w30_max_amt",
            "w30_std_amt",
            "w90_vol",
            "w90_cnt",
            "w90_avg_amt",
            "w90_max_amt",
            "w90_std_amt",
            "w365_vol",
            "w365_cnt",
            "w365_avg_amt",
            "vol_spike_30_vs_90",
            "cnt_spike_30_vs_90",
            "vol_spike_7_vs_30",
            "cnt_spike_7_vs_30",
            "avg_spike_30_vs_90",
            "counterparty_hhi",
            "top_dest_concentration",
            "pct_hr_dest_30d",
            "pct_fatf_dest_30d",
            "unique_dest_30d",
            "structuring_txn_cnt",
            "pct_just_below_10k",
            "swift_cnt_30d",
            "layering_score",
            "velocity_per_hour_7d",
            "txn_span_hours_7d",
            "pass_through_ratio_30d",
            "net_flow_30d",
            "credit_vol_30d",
            "debit_vol_30d",
            "pct_offhour_txns_30d",
            "pct_weekend_txns_30d",
            "actual_vs_expected_vol",
            "cash_intensity_30d",
            "cash_intensity_7d",
        ]
        for col in expected_metrics:
            if col not in agg_df.columns:
                agg_df[col] = 0.0

        return agg_df, account_col

    def _build_pre_alert_txn_aggregate_frame(
        self,
        txn_df: pd.DataFrame,
        alerts_df: pd.DataFrame,
    ) -> Tuple[pd.DataFrame, Optional[str]]:
        """
        Build transaction aggregates at alert grain using only pre-alert transactions.

        This enforces strict temporal leakage prevention:
        TXN_TIMESTAMP < ALERT_DATE for each alert row.
        """
        alert_id_col = self._find_col(alerts_df, ["alert_id"])
        alert_account_col = self._find_col(alerts_df, ["account_id", "acct_id"])
        alert_date_col = self._find_col(
            alerts_df,
            ["alert_date", "alert_timestamp", "event_date", "created_at", "txn_timestamp", "transaction_date"],
        )
        txn_account_col = self._find_col(txn_df, ["account_id", "acct_id"])
        txn_time_col = self._find_col(
            txn_df,
            ["txn_timestamp", "transaction_timestamp", "txn_date", "transaction_date", "timestamp", "created_at"],
        )
        expected_monthly_col = self._find_col(
            alerts_df,
            ["expected_monthly_txn", "expected_monthly_turnover", "expected_monthly_volume"],
        )

        if not alert_id_col or not alert_account_col or not alert_date_col or not txn_account_col or not txn_time_col:
            return pd.DataFrame(), None

        alert_cols = [alert_id_col, alert_account_col, alert_date_col]
        if expected_monthly_col:
            alert_cols.append(expected_monthly_col)

        rename_map = {
            alert_id_col: "__alert_id",
            alert_account_col: "__alert_account",
            alert_date_col: "__alert_date",
        }
        if expected_monthly_col:
            rename_map[expected_monthly_col] = "__expected_monthly"

        alerts_work = alerts_df[alert_cols].copy().rename(columns=rename_map)
        alerts_work["__alert_date"] = pd.to_datetime(alerts_work["__alert_date"], errors="coerce")
        if "__expected_monthly" in alerts_work.columns:
            alerts_work["__expected_monthly"] = pd.to_numeric(alerts_work["__expected_monthly"], errors="coerce")
        alerts_work = alerts_work.dropna(subset=["__alert_id", "__alert_account", "__alert_date"])
        if alerts_work.empty:
            return pd.DataFrame(), None

        work = txn_df.copy()
        work[txn_time_col] = pd.to_datetime(work[txn_time_col], errors="coerce")

        amount_col = self._find_col(work, ["txn_amount", "transaction_amount", "amount"])
        txn_id_col = self._find_col(work, ["transaction_id", "txn_id", "id"])
        type_col = self._find_col(work, ["txn_type", "transaction_type", "type"])
        channel_col = self._find_col(work, ["channel", "txn_channel"])
        ben_col = self._find_col(work, ["beneficiary_country", "beneficiary_ctry", "destination_country"])
        direction_col = self._find_col(work, ["txn_direction", "direction", "dr_cr", "debit_credit"])
        hour_col = self._find_col(work, ["txn_hour", "hour"])
        weekend_col = self._find_col(work, ["is_weekend"])
        offhour_col = self._find_col(work, ["is_off_hours", "is_offhour", "off_hours_flag"])

        if amount_col:
            work[amount_col] = pd.to_numeric(work[amount_col], errors="coerce")
        else:
            amount_col = "__txn_amount"
            work[amount_col] = 0.0

        if type_col:
            type_upper = work[type_col].astype(str).str.upper()
            work["__is_cash"] = type_upper.isin(["CASH_DEPOSIT", "CASH_WITHDRAWAL", "CASH"]).astype(int)
            work["__is_swift"] = (type_upper == "SWIFT").astype(int)
        else:
            work["__is_cash"] = 0
            work["__is_swift"] = 0

        if ben_col:
            ben_upper = work[ben_col].astype(str).str.upper()
            work["__dest_norm"] = ben_upper
            work["__is_high_risk_dest"] = ben_upper.isin(_HIGH_RISK_COUNTRIES).astype(int)
            work["__is_fatf_dest"] = ben_upper.isin({"KY", "VG", "NG", "IR", "PK", "SY", "MM", "YE"}).astype(int)
        else:
            work["__dest_norm"] = np.nan
            work["__is_high_risk_dest"] = 0
            work["__is_fatf_dest"] = 0

        if direction_col:
            dir_upper = work[direction_col].astype(str).str.upper()
            work["__is_credit"] = dir_upper.isin({"CREDIT", "CR", "CRDT", "IN"}).astype(int)
            work["__is_debit"] = dir_upper.isin({"DEBIT", "DR", "DBT", "OUT"}).astype(int)
        else:
            work["__is_credit"] = 0
            work["__is_debit"] = 0

        if weekend_col:
            weekend_raw = pd.to_numeric(work[weekend_col], errors="coerce")
            work["__is_weekend"] = weekend_raw.fillna(0).astype(int).clip(0, 1)
        else:
            work["__is_weekend"] = (work[txn_time_col].dt.dayofweek >= 5).astype(int)

        if offhour_col:
            offhour_raw = pd.to_numeric(work[offhour_col], errors="coerce")
            work["__is_offhour"] = offhour_raw.fillna(0).astype(int).clip(0, 1)
        else:
            if hour_col:
                txn_hour = pd.to_numeric(work[hour_col], errors="coerce")
            else:
                txn_hour = work[txn_time_col].dt.hour
            work["__is_offhour"] = ((txn_hour < 8) | (txn_hour > 20)).astype(int)

        joined = work.merge(
            alerts_work,
            left_on=txn_account_col,
            right_on="__alert_account",
            how="inner",
            suffixes=("", "_alert"),
        )
        joined = joined[
            joined[txn_time_col].notna()
            & joined["__alert_date"].notna()
            & (joined[txn_time_col] < joined["__alert_date"])
        ].copy()
        if joined.empty:
            return pd.DataFrame(), None

        joined["__days_before"] = (joined["__alert_date"] - joined[txn_time_col]).dt.days.fillna(999999)
        joined["__credit_amount"] = np.where(joined["__is_credit"] == 1, joined[amount_col], 0.0)
        joined["__debit_amount"] = np.where(joined["__is_debit"] == 1, joined[amount_col], 0.0)

        count_col = txn_id_col or txn_account_col

        # Backward-compatible pre-alert rollup over all history.
        all_spec: Dict[str, Tuple[str, str]] = {
            "txn_count": (count_col, "count"),
            "total_txn_volume": (amount_col, "sum"),
            "avg_txn_amount": (amount_col, "mean"),
            "max_txn_amount": (amount_col, "max"),
            "std_txn_amount": (amount_col, "std"),
            "cash_txn_count": ("__is_cash", "sum"),
            "swift_txn_count": ("__is_swift", "sum"),
            "pct_high_risk_dest": ("__is_high_risk_dest", "mean"),
        }
        if channel_col:
            all_spec["unique_channels"] = (channel_col, "nunique")
        if ben_col:
            all_spec["unique_beneficiary_countries"] = (ben_col, "nunique")
        all_agg = joined.groupby("__alert_id", dropna=False).agg(**all_spec).reset_index()
        all_agg["pct_high_risk_dest"] = pd.to_numeric(all_agg["pct_high_risk_dest"], errors="coerce").fillna(0.0) * 100.0

        def _window_agg(days: int, prefix: str) -> pd.DataFrame:
            subset = joined[joined["__days_before"] <= float(days)]
            if subset.empty:
                return pd.DataFrame(columns=["__alert_id"])
            spec: Dict[str, Tuple[str, str]] = {
                f"{prefix}_cnt": (count_col, "count"),
                f"{prefix}_vol": (amount_col, "sum"),
                f"{prefix}_avg_amt": (amount_col, "mean"),
                f"{prefix}_max_amt": (amount_col, "max"),
                f"{prefix}_std_amt": (amount_col, "std"),
                f"{prefix}_cash_cnt": ("__is_cash", "sum"),
                f"{prefix}_swift_cnt": ("__is_swift", "sum"),
                f"{prefix}_hr_dest_cnt": ("__is_high_risk_dest", "sum"),
                f"{prefix}_fatf_dest_cnt": ("__is_fatf_dest", "sum"),
                f"{prefix}_offhour_cnt": ("__is_offhour", "sum"),
                f"{prefix}_weekend_cnt": ("__is_weekend", "sum"),
                f"{prefix}_credit_vol": ("__credit_amount", "sum"),
                f"{prefix}_debit_vol": ("__debit_amount", "sum"),
                f"{prefix}_unique_dest": ("__dest_norm", "nunique"),
            }
            return subset.groupby("__alert_id", dropna=False).agg(**spec).reset_index()

        agg_df = alerts_work[["__alert_id"]].drop_duplicates().copy()
        if "__expected_monthly" in alerts_work.columns:
            agg_df = agg_df.merge(
                alerts_work[["__alert_id", "__expected_monthly"]].drop_duplicates(),
                on="__alert_id",
                how="left",
            )
        for part in [all_agg, _window_agg(7, "w7"), _window_agg(30, "w30"), _window_agg(90, "w90"), _window_agg(365, "w365")]:
            if part is not None and not part.empty:
                agg_df = agg_df.merge(part, on="__alert_id", how="left")

        for col in [c for c in agg_df.columns if c != "__alert_id"]:
            agg_df[col] = pd.to_numeric(agg_df[col], errors="coerce").fillna(0.0)

        def _col(name: str) -> pd.Series:
            if name in agg_df.columns:
                return pd.to_numeric(agg_df[name], errors="coerce").fillna(0.0)
            return pd.Series(np.zeros(len(agg_df), dtype=float), index=agg_df.index)

        agg_df["std_txn_amount"] = _col("std_txn_amount")
        agg_df["velocity_ratio"] = _col("max_txn_amount") / (_col("avg_txn_amount") + 1.0)

        # Velocity and behavioural-change family.
        agg_df["vol_spike_30_vs_90"] = _col("w30_vol") / (_col("w90_vol") + 1.0)
        agg_df["cnt_spike_30_vs_90"] = _col("w30_cnt") / (_col("w90_cnt") + 1.0)
        agg_df["vol_spike_7_vs_30"] = _col("w7_vol") / (_col("w30_vol") + 1.0)
        agg_df["cnt_spike_7_vs_30"] = _col("w7_cnt") / (_col("w30_cnt") + 1.0)
        agg_df["avg_spike_30_vs_90"] = _col("w30_avg_amt") / (_col("w90_avg_amt") + 1.0)

        # Counterparty concentration family (30-day window).
        agg_df["counterparty_hhi"] = 0.0
        agg_df["top_dest_concentration"] = 0.0
        if ben_col:
            sub30 = joined[joined["__days_before"] <= 30].copy()
            if not sub30.empty:
                dest_counts = (
                    sub30.groupby(["__alert_id", "__dest_norm"], dropna=False)
                    .size()
                    .reset_index(name="__n")
                )
                dest_counts["__total"] = dest_counts.groupby("__alert_id")["__n"].transform("sum")
                dest_counts = dest_counts[dest_counts["__total"] > 0]
                if not dest_counts.empty:
                    dest_counts["__share"] = dest_counts["__n"] / dest_counts["__total"]
                    hhi = dest_counts.groupby("__alert_id")["__share"].apply(lambda s: float(np.square(s).sum()))
                    top = dest_counts.groupby("__alert_id")["__share"].max()
                    agg_df = agg_df.merge(hhi.rename("counterparty_hhi_src"), left_on="__alert_id", right_index=True, how="left")
                    agg_df = agg_df.merge(top.rename("top_dest_concentration_src"), left_on="__alert_id", right_index=True, how="left")
                    agg_df["counterparty_hhi"] = pd.to_numeric(agg_df.get("counterparty_hhi_src"), errors="coerce").fillna(agg_df["counterparty_hhi"])
                    agg_df["top_dest_concentration"] = pd.to_numeric(agg_df.get("top_dest_concentration_src"), errors="coerce").fillna(agg_df["top_dest_concentration"])
                    agg_df = agg_df.drop(columns=["counterparty_hhi_src", "top_dest_concentration_src"], errors="ignore")

        agg_df["pct_hr_dest_30d"] = (_col("w30_hr_dest_cnt") / (_col("w30_cnt") + 1.0)) * 100.0
        agg_df["pct_fatf_dest_30d"] = (_col("w30_fatf_dest_cnt") / (_col("w30_cnt") + 1.0)) * 100.0
        agg_df["unique_dest_30d"] = _col("w30_unique_dest")

        # Typology-aligned signals.
        structuring = pd.Series(np.zeros(len(agg_df), dtype=float), index=agg_df.index)
        if amount_col:
            sub90 = joined[joined["__days_before"] <= 90]
            if not sub90.empty:
                structuring = (
                    ((sub90[amount_col] >= 8000.0) & (sub90[amount_col] < 10000.0))
                    .groupby(sub90["__alert_id"])
                    .sum()
                    .reindex(agg_df["__alert_id"])
                    .fillna(0.0)
                    .reset_index(drop=True)
                )
        agg_df["structuring_txn_cnt"] = pd.to_numeric(structuring, errors="coerce").fillna(0.0)
        agg_df["pct_just_below_10k"] = (agg_df["structuring_txn_cnt"] / (_col("w90_cnt") + 1.0)) * 100.0
        agg_df["swift_cnt_30d"] = _col("w30_swift_cnt")
        agg_df["layering_score"] = agg_df["swift_cnt_30d"] * _col("w30_unique_dest")

        agg_df["txn_span_hours_7d"] = 0.0
        sub7 = joined[joined["__days_before"] <= 7]
        if not sub7.empty:
            span = (
                sub7.groupby("__alert_id")[txn_time_col]
                .agg(["min", "max", "count"])
                .reset_index()
                .rename(columns={"count": "__count"})
            )
            span["txn_span_hours_7d"] = ((span["max"] - span["min"]).dt.total_seconds() / 3600.0).fillna(0.0)
            span.loc[span["__count"] < 2, "txn_span_hours_7d"] = 0.0
            agg_df = agg_df.merge(span[["__alert_id", "txn_span_hours_7d"]], on="__alert_id", how="left", suffixes=("", "_src"))
            if "txn_span_hours_7d_src" in agg_df.columns:
                agg_df["txn_span_hours_7d"] = pd.to_numeric(agg_df["txn_span_hours_7d_src"], errors="coerce").fillna(agg_df["txn_span_hours_7d"])
                agg_df = agg_df.drop(columns=["txn_span_hours_7d_src"], errors="ignore")
        agg_df["velocity_per_hour_7d"] = _col("w7_vol") / (_col("txn_span_hours_7d") + 1.0)

        credit30 = _col("w30_credit_vol")
        debit30 = _col("w30_debit_vol")
        agg_df["credit_vol_30d"] = credit30
        agg_df["debit_vol_30d"] = debit30
        agg_df["net_flow_30d"] = credit30 - debit30
        agg_df["pass_through_ratio_30d"] = np.minimum(credit30, debit30) / (np.maximum(credit30, debit30) + 1.0)

        agg_df["pct_offhour_txns_30d"] = (_col("w30_offhour_cnt") / (_col("w30_cnt") + 1.0)) * 100.0
        agg_df["pct_weekend_txns_30d"] = (_col("w30_weekend_cnt") / (_col("w30_cnt") + 1.0)) * 100.0
        agg_df["cash_intensity_30d"] = (_col("w30_cash_cnt") / (_col("w30_cnt") + 1.0)) * 100.0
        agg_df["cash_intensity_7d"] = (_col("w7_cash_cnt") / (_col("w7_cnt") + 1.0)) * 100.0

        if "__expected_monthly" in agg_df.columns:
            expected = _col("__expected_monthly")
            agg_df["actual_vs_expected_vol"] = np.where(expected > 0, _col("w30_vol") / (expected + 1.0), 0.0)
        else:
            agg_df["actual_vs_expected_vol"] = 0.0

        if "unique_channels" not in agg_df.columns:
            agg_df["unique_channels"] = 0.0
        if "unique_beneficiary_countries" not in agg_df.columns:
            agg_df["unique_beneficiary_countries"] = 0.0

        expected_metrics = [
            "total_txn_volume",
            "txn_count",
            "avg_txn_amount",
            "max_txn_amount",
            "std_txn_amount",
            "unique_channels",
            "unique_beneficiary_countries",
            "cash_txn_count",
            "swift_txn_count",
            "pct_high_risk_dest",
            "velocity_ratio",
            "w7_vol",
            "w7_cnt",
            "w7_avg_amt",
            "w7_max_amt",
            "w7_std_amt",
            "w30_vol",
            "w30_cnt",
            "w30_avg_amt",
            "w30_max_amt",
            "w30_std_amt",
            "w90_vol",
            "w90_cnt",
            "w90_avg_amt",
            "w90_max_amt",
            "w90_std_amt",
            "w365_vol",
            "w365_cnt",
            "w365_avg_amt",
            "vol_spike_30_vs_90",
            "cnt_spike_30_vs_90",
            "vol_spike_7_vs_30",
            "cnt_spike_7_vs_30",
            "avg_spike_30_vs_90",
            "counterparty_hhi",
            "top_dest_concentration",
            "pct_hr_dest_30d",
            "pct_fatf_dest_30d",
            "unique_dest_30d",
            "structuring_txn_cnt",
            "pct_just_below_10k",
            "swift_cnt_30d",
            "layering_score",
            "velocity_per_hour_7d",
            "txn_span_hours_7d",
            "pass_through_ratio_30d",
            "net_flow_30d",
            "credit_vol_30d",
            "debit_vol_30d",
            "pct_offhour_txns_30d",
            "pct_weekend_txns_30d",
            "actual_vs_expected_vol",
            "cash_intensity_30d",
            "cash_intensity_7d",
        ]
        for col in expected_metrics:
            if col not in agg_df.columns:
                agg_df[col] = 0.0
            agg_df[col] = pd.to_numeric(agg_df[col], errors="coerce").fillna(0.0)

        agg_df = agg_df.drop(columns=["__expected_monthly"], errors="ignore")
        agg_df = agg_df.rename(columns={"__alert_id": str(alert_id_col)})
        return agg_df, str(alert_id_col)

    def _build_master_from_datasets(
        self,
        datasets: List[Dict],
        output_path: Path,
        join_steps: Optional[List[Dict]] = None,
        base_dataset_type: Optional[str] = None,
        str_policy: str = "detect",
        replacement_label_column: Optional[str] = None,
        persist: bool = True,
        preview_rows: int = 40,
        master_mode: str = "auto",
    ) -> Dict:
        if not datasets:
            raise ValueError("No datasets provided for master build")

        by_type: Dict[str, Dict] = {}
        for ds in datasets:
            key = str(ds.get("dataset_type") or "").strip().lower()
            if not key:
                continue
            by_type[key] = {
                "meta": ds,
                "df": self._load_dataset_frame(ds),
            }

        if not by_type:
            raise ValueError("No valid datasets available for master build")

        join_steps = list(join_steps or [])
        str_policy_l = str(str_policy or "detect").strip().lower()
        master_mode_l = str(master_mode or "auto").strip().lower()
        label_summary: Optional[Dict[str, Any]] = None

        def _resolve_source_key(value: str) -> Optional[str]:
            v = str(value or "").strip().lower()
            if not v:
                return None
            if v in by_type:
                return v
            role = self._normalize_dataset_role(v)
            return self._dataset_key_for_role(by_type, role)

        def _normalize_join_type(value: str) -> str:
            jt = str(value or "left").strip().lower()
            if jt == "full":
                jt = "outer"
            if jt not in {"left", "inner", "right", "outer"}:
                jt = "left"
            return jt

        def _is_mapping_id(col_name: str) -> bool:
            lname = str(col_name or "").strip().lower()
            return (
                lname == "id"
                or lname.endswith("_id")
                or lname.startswith("id_")
                or any(k in lname for k in ["transaction_id", "account_id", "customer_id", "case_id", "alert_id"])
            )

        def _apply_case_status_labels(frame: pd.DataFrame, source_name: str) -> pd.DataFrame:
            nonlocal label_summary
            case_status_col = self._find_col(frame, ["CASE_STATUS", "case_status"])
            if not case_status_col:
                return frame

            status_map = {
                "CLOSED_SAR_FILED": 1,
                "SAR_FILED": 1,
                "SAR FILED": 1,
                "TRUE_POSITIVE": 1,
                "CLOSED_FALSE_POSITIVE": 0,
                "FALSE_POSITIVE": 0,
                "CLOSED_MONITORING": 0,
                "MONITORING": 0,
            }

            out = frame.copy()
            normalized = out[case_status_col].astype(str).str.strip().str.upper()
            case_labels = normalized.map(status_map).astype("float64")

            account_col = self._find_col(out, ["ACCOUNT_ID", "account_id", "acct_id"])
            alert_date_col = self._find_col(out, ["ALERT_DATE", "alert_date"])
            str_date_col = self._find_col(
                out,
                [
                    "str_filed_date",
                    "STR_FILED_DATE",
                    "sar_filed_date",
                    "SAR_FILED_DATE",
                    "str_date",
                    "sar_date",
                    "report_date",
                ],
            )
            str_window_days = 60
            tp_from_str = pd.Series(0, index=out.index, dtype="int64")
            str_candidate_count = 0
            str_primary_count = 0
            str_fanout_removed = 0
            str_dates_loaded = False
            if str_key and by_type.get(str_key) and account_col and alert_date_col:
                str_source = by_type[str_key]["df"]
                str_account_col = self._find_col(str_source, ["ACCOUNT_ID", "account_id", "acct_id"])
                str_date_source_col = self._find_col(
                    str_source,
                    [
                        "str_filed_date",
                        "STR_FILED_DATE",
                        "sar_filed_date",
                        "SAR_FILED_DATE",
                        "str_date",
                        "sar_date",
                        "report_date",
                    ],
                )
                if str_account_col and str_date_source_col:
                    str_hist = str_source[[str_account_col, str_date_source_col]].copy()
                    str_hist[str_date_source_col] = pd.to_datetime(str_hist[str_date_source_col], errors="coerce")
                    str_hist = str_hist.dropna(subset=[str_account_col, str_date_source_col])
                    if not str_hist.empty:
                        str_lookup = (
                            str_hist.groupby(str_account_col)[str_date_source_col]
                            .apply(list)
                            .to_dict()
                        )
                        alert_dates = pd.to_datetime(out[alert_date_col], errors="coerce")
                        days_to_next_str = pd.Series(np.nan, index=out.index, dtype="float64")
                        for idx, (acct, alert_dt) in enumerate(zip(out[account_col], alert_dates)):
                            if pd.isna(acct) or pd.isna(alert_dt):
                                continue
                            acct_key = str(acct)
                            cutoff = alert_dt + pd.to_timedelta(str_window_days, unit="D")
                            forward_days = [
                                float((d - alert_dt).days)
                                for d in str_lookup.get(acct_key, [])
                                if alert_dt < d <= cutoff
                            ]
                            if forward_days:
                                days_to_next_str.iat[idx] = float(min(forward_days))

                        candidate_mask = days_to_next_str.notna()
                        str_candidate_count = int(candidate_mask.sum())
                        if str_candidate_count > 0:
                            candidate_df = pd.DataFrame(
                                {
                                    "__acct": out[account_col].astype(str),
                                    "__days_to_str": days_to_next_str,
                                },
                                index=out.index,
                            ).loc[candidate_mask].copy()
                            # Fan-out fix: per account, keep only the alert closest before STR filing.
                            primary_idx = candidate_df.groupby("__acct")["__days_to_str"].idxmin()
                            tp_from_str.loc[primary_idx.values] = 1
                            str_primary_count = int(tp_from_str.sum())
                            str_fanout_removed = max(0, str_candidate_count - str_primary_count)
                        str_date_col = str_date_source_col
                        str_dates_loaded = True

            if not str_dates_loaded and str_date_col and alert_date_col:
                alert_dates = pd.to_datetime(out[alert_date_col], errors="coerce")
                str_dates = pd.to_datetime(out[str_date_col], errors="coerce")
                in_window = pd.Series(
                    alert_dates.notna()
                    & str_dates.notna()
                    & (str_dates > alert_dates)
                    & (str_dates <= (alert_dates + pd.to_timedelta(str_window_days, unit="D")))
                    ,
                    index=out.index,
                )
                if account_col:
                    in_window = in_window & out[account_col].notna()
                    days_to_next_str = (
                        pd.to_numeric((str_dates - alert_dates).dt.days, errors="coerce")
                        .where(in_window, np.nan)
                    )
                    candidate_mask = days_to_next_str.notna()
                    str_candidate_count = int(candidate_mask.sum())
                    if str_candidate_count > 0:
                        candidate_df = pd.DataFrame(
                            {
                                "__acct": out[account_col].astype(str),
                                "__days_to_str": days_to_next_str,
                            },
                            index=out.index,
                        ).loc[candidate_mask].copy()
                        primary_idx = candidate_df.groupby("__acct")["__days_to_str"].idxmin()
                        tp_from_str = pd.Series(0, index=out.index, dtype="int64")
                        tp_from_str.loc[primary_idx.values] = 1
                        str_primary_count = int(tp_from_str.sum())
                        str_fanout_removed = max(0, str_candidate_count - str_primary_count)
                else:
                    tp_from_str = in_window.astype(int)
                    str_candidate_count = int(tp_from_str.sum())
                    str_primary_count = str_candidate_count

            out["TP_FROM_STR"] = tp_from_str
            out["CASE_LABEL"] = case_labels
            out["FINAL_LABEL"] = np.where(out["TP_FROM_STR"] == 1, 1.0, out["CASE_LABEL"])
            out["IS_TRUE_POS"] = out["FINAL_LABEL"]
            # Keep legacy labels and expose a stable lowercase alias used by the UI.
            out["str_label"] = out["FINAL_LABEL"]

            n_before = int(len(out))
            n_excluded = int(out["IS_TRUE_POS"].isna().sum())
            n_str_linked = int(out["TP_FROM_STR"].sum())
            n_case_positive = int((out["CASE_LABEL"] == 1).sum())

            labelled = out[out["IS_TRUE_POS"].notna()].copy()
            if not labelled.empty:
                labelled["FINAL_LABEL"] = labelled["FINAL_LABEL"].astype(int)
                labelled["IS_TRUE_POS"] = labelled["FINAL_LABEL"].astype(int)
                labelled["str_label"] = labelled["FINAL_LABEL"].astype(int)
            n_after = int(len(labelled))
            n_pos = int((labelled["IS_TRUE_POS"] == 1).sum()) if n_after else 0
            n_neg = int((labelled["IS_TRUE_POS"] == 0).sum()) if n_after else 0

            strategy = "str_lookforward_plus_case_fallback" if str_date_col and alert_date_col else "case_status_sar_filed"
            label_summary = {
                "strategy": strategy,
                "source_column": str(case_status_col),
                "str_source_column": str(str_date_col or ""),
                "str_lookforward_days": int(str_window_days),
                "n_total": n_before,
                "n_labelled": n_after,
                "n_excluded": n_excluded,
                "n_positive": n_pos,
                "n_negative": n_neg,
                "n_str_linked": n_str_linked,
                "str_fanout_before": int(str_candidate_count),
                "str_fanout_after": int(str_primary_count or n_str_linked),
                "str_fanout_removed": int(str_fanout_removed),
                "n_case_positive": n_case_positive,
                "class_balance": round(float(n_pos / max(n_after, 1)), 4),
                "str_rate_overall": round(float(n_pos / max(n_before, 1)), 4),
            }

            logger.info(
                "Label derivation [%s]: %s alerts -> %s labelled (%s excluded). "
                "TP=%s (%.2f%%), FP=%s (%.2f%%), STR-window positives=%s, CASE positives=%s",
                str(source_name),
                n_before,
                n_after,
                n_excluded,
                n_pos,
                (n_pos / max(n_after, 1)) * 100.0,
                n_neg,
                (n_neg / max(n_after, 1)) * 100.0,
                n_str_linked,
                n_case_positive,
            )

            return labelled

        def _finalize_payload(
            current_df: pd.DataFrame,
            base_key: str,
            impact_rows: List[Dict[str, Any]],
            join_dag_edges: List[Dict[str, Any]],
        ) -> Dict[str, Any]:
            id_columns = [str(c) for c in current_df.columns if _is_mapping_id(c)]
            model_excluded_columns = sorted(set(id_columns))
            str_sources_present = [
                k for k in sorted(by_type.keys())
                if self._normalize_dataset_role(k) == "str"
            ]
            str_linked = bool(str_sources_present) and str_policy_l != "unlink"
            target_candidates = [
                c for c in current_df.columns
                if str(c).strip().lower() in {
                    "is_true_pos",
                    "final_label",
                    "str_label",
                    "str_flag",
                    "is_str",
                    "sar_flag",
                    "is_sar",
                    "is_generated_target",
                    "target",
                }
            ][:10]

            if persist:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                current_df.to_csv(output_path, index=False)
                out_path = str(output_path)
            else:
                out_path = None

            return {
                "rows": int(current_df.shape[0]),
                "path": out_path,
                "columns": list(current_df.columns),
                "preview": current_df.head(int(preview_rows)).fillna("").to_dict(orient="records"),
                "impact": impact_rows,
                "join_dag": join_dag_edges,
                "aggregated_joins": [
                    step for step in impact_rows
                    if bool(step.get("was_aggregated"))
                ],
                "id_columns": id_columns,
                "model_excluded_columns": model_excluded_columns,
                "base_dataset_type": base_key,
                "str_policy": str_policy_l,
                "str_sources_present": str_sources_present,
                "str_linked": str_linked,
                "label_summary": label_summary,
                "target_candidates": target_candidates,
                "grain_warning": (
                    None
                    if str(base_key).strip().lower() in {"alerts", "alert", "cases", "case"}
                    else (
                        f"Base grain is '{base_key}'. For AML FP suppression, use 'alerts' "
                        "as anchor to keep one row per alert decision."
                    )
                ),
            }

        alerts_key = self._dataset_key_for_role(by_type, "alerts")
        accounts_key = self._dataset_key_for_role(by_type, "accounts")
        customers_key = self._dataset_key_for_role(by_type, "customers")
        transactions_key = self._dataset_key_for_role(by_type, "transactions")
        cases_key = self._dataset_key_for_role(by_type, "cases")
        str_key = self._dataset_key_for_role(by_type, "str")

        required_for_notebook = all([alerts_key, accounts_key, customers_key, transactions_key])
        base_hint = self._normalize_dataset_role(str(base_dataset_type or ""))
        use_notebook_stage2 = required_for_notebook and (
            master_mode_l in {"notebook", "notebook_stage2", "aml_notebook"}
            or (
                master_mode_l in {"", "auto"}
                and base_hint in {"", "alerts", "transactions"}
            )
        )

        if use_notebook_stage2:
            base_key = str(alerts_key)
            current_df = by_type[base_key]["df"].copy()
            included_sources = {base_key}
            impact_rows: List[Dict[str, Any]] = []
            join_dag_edges: List[Dict[str, Any]] = []
            step_no = 0

            def _step_config(left_role: str, right_role: str, default_key: str, default_join: str = "left") -> Tuple[str, str]:
                for step in join_steps:
                    if not isinstance(step, dict):
                        continue
                    if not bool(step.get("enabled", True)):
                        continue
                    left = self._normalize_dataset_role(step.get("left") or "")
                    right = self._normalize_dataset_role(step.get("right") or "")
                    if {left, right} != {left_role, right_role}:
                        continue
                    key = str(step.get("key") or "").strip() or default_key
                    join_type = _normalize_join_type(step.get("join_type") or default_join)
                    return key, join_type
                return default_key, default_join

            def _merge_source(
                source_name: str,
                source_df: pd.DataFrame,
                left_col: str,
                right_col: str,
                join_key: str,
                join_type: str,
                from_source: str,
            ) -> bool:
                nonlocal current_df, step_no
                if not left_col or not right_col:
                    return False
                if left_col not in current_df.columns or right_col not in source_df.columns:
                    return False

                step_no += 1
                join_type_l = _normalize_join_type(join_type)
                before_rows = int(current_df.shape[0])
                matched = int(current_df[left_col].dropna().isin(source_df[right_col].dropna()).sum())

                merged = current_df.merge(
                    source_df,
                    left_on=left_col,
                    right_on=right_col,
                    how=join_type_l,
                    suffixes=("", f"_{source_name}"),
                )
                after_rows = int(merged.shape[0])

                if join_type_l == "left":
                    null_impact_pct = float(max(before_rows - matched, 0) / max(before_rows, 1) * 100)
                elif join_type_l == "inner":
                    null_impact_pct = float(max(before_rows - after_rows, 0) / max(before_rows, 1) * 100)
                else:
                    null_impact_pct = 0.0

                coverage_pct = float(matched / max(before_rows, 1) * 100)
                duplication_factor = float(after_rows / max(before_rows, 1))
                was_aggregated = str(source_name).strip().lower().endswith("_agg")
                aggregated_columns = [
                    str(c) for c in source_df.columns
                    if str(c).lower() != str(right_col).lower()
                ] if was_aggregated else []
                impact_rows.append(
                    {
                        "step": int(step_no),
                        "from_source": str(from_source),
                        "source": source_name,
                        "join_key": join_key,
                        "join_type": join_type_l,
                        "was_aggregated": was_aggregated,
                        "aggregated_columns": aggregated_columns[:40],
                        "rows_before": before_rows,
                        "matched_rows": matched,
                        "rows_after": after_rows,
                        "coverage_pct": round(coverage_pct, 2),
                        "duplication_factor": round(duplication_factor, 4),
                        "null_impact_pct": round(null_impact_pct, 2),
                    }
                )
                join_dag_edges.append(
                    {
                        "step": int(step_no),
                        "from": str(from_source),
                        "to": str(source_name),
                        "key": str(join_key),
                        "join_type": str(join_type_l),
                        "was_aggregated": was_aggregated,
                        "aggregated_columns": aggregated_columns[:40],
                        "matched_rows": int(matched),
                        "rows_before": int(before_rows),
                        "rows_after": int(after_rows),
                    }
                )
                current_df = merged
                included_sources.add(source_name)
                return True

            if cases_key:
                case_join_key, case_join_type = _step_config("alerts", "cases", "alert_id", "left")
                case_df = by_type[cases_key]["df"].copy()
                left_col = self._find_col(current_df, [case_join_key, "alert_id"])
                right_col = self._find_col(case_df, [case_join_key, "alert_id"])
                if right_col:
                    case_df = case_df.drop_duplicates(subset=[right_col], keep="first")
                _merge_source(
                    source_name=str(cases_key),
                    source_df=case_df,
                    left_col=str(left_col or ""),
                    right_col=str(right_col or ""),
                    join_key=case_join_key,
                    join_type=case_join_type,
                    from_source=base_key,
                )
                case_id_col = self._find_col(current_df, ["case_id"])
                if case_id_col:
                    current_df[case_id_col] = current_df[case_id_col].fillna("NO_CASE")
                priority_col = self._find_col(current_df, ["priority"])
                if priority_col:
                    current_df[priority_col] = current_df[priority_col].fillna("NONE")
                resolution_col = self._find_col(current_df, ["resolution_days"])
                if resolution_col:
                    current_df[resolution_col] = pd.to_numeric(current_df[resolution_col], errors="coerce").fillna(0)

            account_join_key, account_join_type = _step_config("alerts", "accounts", "account_id", "left")
            account_df = by_type[accounts_key]["df"].copy()
            left_col = self._find_col(current_df, [account_join_key, "account_id", "acct_id"])
            right_col = self._find_col(account_df, [account_join_key, "account_id", "acct_id"])
            if right_col:
                account_df = account_df.drop_duplicates(subset=[right_col], keep="first")
            _merge_source(
                source_name=str(accounts_key),
                source_df=account_df,
                left_col=str(left_col or ""),
                right_col=str(right_col or ""),
                join_key=account_join_key,
                join_type=account_join_type,
                from_source=base_key,
            )

            customer_join_key, customer_join_type = _step_config("accounts", "customers", "customer_id", "left")
            customer_df = by_type[customers_key]["df"].copy()
            left_col = self._find_col(current_df, [customer_join_key, "customer_id", "cust_id"])
            right_col = self._find_col(customer_df, [customer_join_key, "customer_id", "cust_id"])
            if right_col:
                customer_df = customer_df.drop_duplicates(subset=[right_col], keep="first")
            _merge_source(
                source_name=str(customers_key),
                source_df=customer_df,
                left_col=str(left_col or ""),
                right_col=str(right_col or ""),
                join_key=customer_join_key,
                join_type=customer_join_type,
                from_source=str(accounts_key),
            )

            txn_join_key, txn_join_type = _step_config("accounts", "transactions", "account_id", "left")
            txn_agg, txn_agg_key = self._build_pre_alert_txn_aggregate_frame(
                by_type[transactions_key]["df"],
                current_df,
            )
            txn_from_source = str(accounts_key)
            left_candidates = [txn_join_key, "account_id", "acct_id"]
            right_candidates = [txn_join_key, str(txn_agg_key or ""), "account_id", "acct_id"]
            if txn_agg.empty or not txn_agg_key:
                txn_agg, txn_agg_key = self._build_txn_aggregate_frame(by_type[transactions_key]["df"])
                right_candidates = [txn_join_key, str(txn_agg_key or ""), "account_id", "acct_id"]
            elif "alert" in str(txn_agg_key).lower():
                txn_join_key, txn_join_type = _step_config("alerts", "transactions", "alert_id", "left")
                left_candidates = [txn_join_key, str(txn_agg_key), "alert_id"]
                right_candidates = [txn_join_key, str(txn_agg_key), "alert_id"]
                txn_from_source = base_key
            left_col = self._find_col(current_df, left_candidates)
            right_col = self._find_col(txn_agg, right_candidates)
            _merge_source(
                source_name=f"{transactions_key}_agg",
                source_df=txn_agg,
                left_col=str(left_col or ""),
                right_col=str(right_col or ""),
                join_key=txn_join_key,
                join_type=txn_join_type,
                from_source=txn_from_source,
            )

            agg_fill_cols = [
                "total_txn_volume",
                "txn_count",
                "avg_txn_amount",
                "max_txn_amount",
                "std_txn_amount",
                "unique_channels",
                "unique_beneficiary_countries",
                "cash_txn_count",
                "swift_txn_count",
                "pct_high_risk_dest",
                "velocity_ratio",
                "w7_vol",
                "w7_cnt",
                "w7_avg_amt",
                "w7_max_amt",
                "w7_std_amt",
                "w30_vol",
                "w30_cnt",
                "w30_avg_amt",
                "w30_max_amt",
                "w30_std_amt",
                "w90_vol",
                "w90_cnt",
                "w90_avg_amt",
                "w90_max_amt",
                "w90_std_amt",
                "w365_vol",
                "w365_cnt",
                "w365_avg_amt",
                "vol_spike_30_vs_90",
                "cnt_spike_30_vs_90",
                "vol_spike_7_vs_30",
                "cnt_spike_7_vs_30",
                "avg_spike_30_vs_90",
                "counterparty_hhi",
                "top_dest_concentration",
                "pct_hr_dest_30d",
                "pct_fatf_dest_30d",
                "unique_dest_30d",
                "structuring_txn_cnt",
                "pct_just_below_10k",
                "swift_cnt_30d",
                "layering_score",
                "velocity_per_hour_7d",
                "txn_span_hours_7d",
                "pass_through_ratio_30d",
                "net_flow_30d",
                "credit_vol_30d",
                "debit_vol_30d",
                "pct_offhour_txns_30d",
                "pct_weekend_txns_30d",
                "actual_vs_expected_vol",
                "cash_intensity_30d",
                "cash_intensity_7d",
            ]
            for col in agg_fill_cols:
                real_col = self._find_col(current_df, [col])
                if real_col:
                    current_df[real_col] = pd.to_numeric(current_df[real_col], errors="coerce").fillna(0)

            if str_key and str_policy_l != "unlink":
                str_join_key, str_join_type = _step_config("alerts", "str", "transaction_id", "left")
                str_df = by_type[str_key]["df"].copy()
                key_candidates = [
                    str_join_key,
                    "transaction_id",
                    "txn_id",
                    "alert_id",
                    "account_id",
                    "case_id",
                    "customer_id",
                ]
                selected_join_key = None
                left_col = None
                right_col = None
                for candidate in key_candidates:
                    lc = self._find_col(current_df, [candidate])
                    rc = self._find_col(str_df, [candidate])
                    if lc and rc:
                        selected_join_key = str(candidate)
                        left_col = lc
                        right_col = rc
                        break
                if right_col:
                    str_df = str_df.drop_duplicates(subset=[right_col], keep="first")
                _merge_source(
                    source_name=str(str_key),
                    source_df=str_df,
                    left_col=str(left_col or ""),
                    right_col=str(right_col or ""),
                    join_key=str(selected_join_key or str_join_key),
                    join_type=str_join_type,
                    from_source=base_key,
                )

            if str_policy_l == "replace" and replacement_label_column:
                label_col = self._find_col(current_df, [replacement_label_column])
                if label_col:
                    current_df["str_flag"] = self._coerce_binary_target(current_df[label_col]).astype(int)

            current_df = _apply_case_status_labels(current_df, base_key)
            return _finalize_payload(current_df, base_key, impact_rows, join_dag_edges)

        base_key = _resolve_source_key(base_dataset_type or "") or (
            alerts_key if alerts_key else (transactions_key if transactions_key else next(iter(by_type.keys())))
        )
        current_df = by_type[base_key]["df"].copy()
        included_sources = {base_key}
        impact_rows: List[Dict[str, Any]] = []
        join_dag_edges: List[Dict[str, Any]] = []

        def _merge_step(
            step_idx: int,
            source_name: str,
            join_key: str,
            join_type: str,
            from_source: Optional[str] = None,
        ):
            nonlocal current_df
            source_key = _resolve_source_key(source_name or "")
            source = by_type.get(source_key or "")
            if source is None:
                return

            join_type_l = _normalize_join_type(join_type)
            left_col = self._find_col(current_df, [join_key])
            right_col = self._find_col(source["df"], [join_key])
            if not left_col or not right_col:
                return

            right_df = source["df"]
            was_aggregated = False
            if _needs_aggregation(str(source_key), str(join_key), right_df, current_df):
                right_df = _aggregate_event_table(right_df, right_col)
                was_aggregated = True

            if not was_aggregated and right_col in right_df.columns and right_df[right_col].duplicated().any():
                right_df = right_df.drop_duplicates(subset=[right_col], keep="first")

            before_rows = int(current_df.shape[0])
            matched = int(current_df[left_col].dropna().isin(right_df[right_col].dropna()).sum())

            merged = current_df.merge(
                right_df,
                left_on=left_col,
                right_on=right_col,
                how=join_type_l,
                suffixes=("", f"_{source_key}"),
            )
            after_rows = int(merged.shape[0])

            if join_type_l == "left" and after_rows > int(before_rows * 1.05) and right_col in right_df.columns:
                right_df = right_df.drop_duplicates(subset=[right_col], keep="first")
                merged = current_df.merge(
                    right_df,
                    left_on=left_col,
                    right_on=right_col,
                    how=join_type_l,
                    suffixes=("", f"_{source_key}"),
                )
                after_rows = int(merged.shape[0])

            if join_type_l == "left":
                null_impact_pct = float(max(before_rows - matched, 0) / max(before_rows, 1) * 100)
            elif join_type_l == "inner":
                null_impact_pct = float(max(before_rows - after_rows, 0) / max(before_rows, 1) * 100)
            else:
                null_impact_pct = 0.0

            coverage_pct = float(matched / max(before_rows, 1) * 100)
            duplication_factor = float(after_rows / max(before_rows, 1))
            aggregated_columns = [
                str(c) for c in right_df.columns
                if str(c).lower() != str(right_col).lower()
            ] if was_aggregated else []
            impact_rows.append(
                {
                    "step": int(step_idx),
                    "from_source": str(from_source or "master"),
                    "source": str(source_key),
                    "join_key": join_key,
                    "join_type": join_type_l,
                    "was_aggregated": was_aggregated,
                    "aggregated_columns": aggregated_columns[:40],
                    "rows_before": before_rows,
                    "matched_rows": matched,
                    "rows_after": after_rows,
                    "coverage_pct": round(coverage_pct, 2),
                    "duplication_factor": round(duplication_factor, 4),
                    "null_impact_pct": round(null_impact_pct, 2),
                }
            )
            join_dag_edges.append(
                {
                    "step": int(step_idx),
                    "from": str(from_source or "master"),
                    "to": str(source_key),
                    "key": str(join_key),
                    "join_type": str(join_type_l),
                    "was_aggregated": was_aggregated,
                    "aggregated_columns": aggregated_columns[:40],
                    "matched_rows": int(matched),
                    "rows_before": int(before_rows),
                    "rows_after": int(after_rows),
                }
            )
            current_df = merged
            included_sources.add(str(source_key))

        if join_steps:
            step_no = 0
            for step in join_steps:
                if not isinstance(step, dict):
                    continue
                if not bool(step.get("enabled", True)):
                    continue

                left = str(step.get("left") or "").strip().lower()
                right = str(step.get("right") or "").strip().lower()
                key = str(step.get("key") or "").strip()
                join_type = str(step.get("join_type") or "left")

                if not left or not right or not key:
                    continue
                if str_policy_l == "unlink" and ({self._normalize_dataset_role(left), self._normalize_dataset_role(right)} & {"str"}):
                    continue

                left_key = _resolve_source_key(left)
                right_key = _resolve_source_key(right)
                if not left_key or not right_key:
                    continue

                if left_key in included_sources and right_key not in included_sources:
                    source_name = right_key
                    from_source = left_key
                elif right_key in included_sources and left_key not in included_sources:
                    source_name = left_key
                    from_source = right_key
                elif left_key in included_sources and right_key in included_sources:
                    continue
                else:
                    continue

                step_no += 1
                _merge_step(step_no, source_name, key, join_type, from_source=from_source)
        else:
            default_plan = [
                ("accounts", ["account_id", "acct_id"], "left"),
                ("customers", ["customer_id", "cust_id"], "left"),
                ("cases", ["case_id"], "left"),
                ("alerts", ["transaction_id", "txn_id", "account_id", "acct_id", "case_id"], "left"),
                ("str", ["transaction_id", "txn_id", "account_id", "acct_id", "case_id"], "left"),
            ]
            step_no = 0
            for source_name, candidate_keys, join_type in default_plan:
                source_key = _resolve_source_key(source_name)
                if not source_key:
                    continue
                if self._normalize_dataset_role(source_key) == "str" and str_policy_l == "unlink":
                    continue
                key = None
                for k in candidate_keys:
                    if self._find_col(current_df, [k]) and self._find_col(by_type[source_key]["df"], [k]):
                        key = k
                        break
                if not key:
                    continue
                step_no += 1
                _merge_step(step_no, source_key, key, join_type, from_source=base_key)

        if str_policy_l == "replace" and replacement_label_column:
            label_col = self._find_col(current_df, [replacement_label_column])
            if label_col:
                current_df["str_flag"] = self._coerce_binary_target(current_df[label_col]).astype(int)

        current_df = _apply_case_status_labels(current_df, str(base_key))
        return _finalize_payload(current_df, str(base_key), impact_rows, join_dag_edges)

    def _build_master_from_dir(
        self,
        data_dir: Path,
        output_path: Path,
        join_steps: Optional[List[Dict]] = None,
        base_dataset_type: Optional[str] = None,
        str_policy: str = "detect",
        replacement_label_column: Optional[str] = None,
        persist: bool = True,
        preview_rows: int = 40,
        master_mode: str = "auto",
    ) -> Dict:
        files: List[Path] = []
        files.extend(list(data_dir.glob("*.csv")))
        files.extend(list(data_dir.glob("*.parquet")))
        datasets = [
            {"dataset_type": p.stem.lower(), "file_path": str(p)}
            for p in files
        ]
        if not datasets:
            raise ValueError("No datasets found in data directory")
        return self._build_master_from_datasets(
            datasets=datasets,
            output_path=output_path,
            join_steps=join_steps,
            base_dataset_type=base_dataset_type,
            str_policy=str_policy,
            replacement_label_column=replacement_label_column,
            persist=persist,
            preview_rows=preview_rows,
            master_mode=master_mode,
        )

    def build_master_dataset(self, *args) -> Dict:
        # Backward compatibility:
        # 1) build_master_dataset(data_dir, output_path)
        # 2) build_master_dataset(tenant_id, env_id, datasets, output_name[, options])
        if len(args) == 2 and isinstance(args[0], Path) and isinstance(args[1], Path):
            return self._build_master_from_dir(args[0], args[1])

        if len(args) in {4, 5}:
            tenant_id = str(args[0])
            env_id = str(args[1])
            datasets = args[2] if isinstance(args[2], list) else []
            output_name = str(args[3])
            options = args[4] if len(args) == 5 and isinstance(args[4], dict) else {}
            join_steps = options.get("join_keys") or options.get("join_steps") or []
            base_dataset_type = options.get("base_dataset_type")
            str_policy = options.get("str_policy") or "detect"
            replacement_label_column = options.get("replacement_label_column")
            preview_rows = int(options.get("preview_rows") or 40)
            master_mode = options.get("master_mode") or "auto"

            data_dir = self._data_dir()
            output_path = data_dir / f"{output_name}.csv"

            if datasets:
                result = self._build_master_from_datasets(
                    datasets=datasets,
                    output_path=output_path,
                    join_steps=join_steps,
                    base_dataset_type=base_dataset_type,
                    str_policy=str_policy,
                    replacement_label_column=replacement_label_column,
                    persist=True,
                    preview_rows=preview_rows,
                    master_mode=master_mode,
                )
            else:
                result = self._build_master_from_dir(
                    data_dir=data_dir,
                    output_path=output_path,
                    join_steps=join_steps,
                    base_dataset_type=base_dataset_type,
                    str_policy=str_policy,
                    replacement_label_column=replacement_label_column,
                    persist=True,
                    preview_rows=preview_rows,
                    master_mode=master_mode,
                )

            dataset = self.register_dataset(
                tenant_id=tenant_id,
                env_id=env_id,
                dataset_type=output_name,
                filename=output_path.name,
                file_path=output_path,
            )
            return {"output": result, "dataset": dataset, "impact": result.get("impact", [])}

        raise ValueError(
            "build_master_dataset expects (data_dir, output_path) or "
            "(tenant_id, env_id, datasets, output_name[, options])"
        )

    def preview_master_dataset(
        self,
        tenant_id: str,
        env_id: str,
        datasets: List[Dict],
        options: Optional[Dict] = None,
    ) -> Dict:
        opts = dict(options or {})
        join_steps = opts.get("join_keys") or opts.get("join_steps") or []
        base_dataset_type = opts.get("base_dataset_type")
        str_policy = opts.get("str_policy") or "detect"
        replacement_label_column = opts.get("replacement_label_column")
        preview_rows = int(opts.get("preview_rows") or 40)
        master_mode = opts.get("master_mode") or "auto"
        output_path = self._data_dir() / "__master_preview__.csv"

        if datasets:
            return self._build_master_from_datasets(
                datasets=datasets,
                output_path=output_path,
                join_steps=join_steps,
                base_dataset_type=base_dataset_type,
                str_policy=str_policy,
                replacement_label_column=replacement_label_column,
                persist=False,
                preview_rows=preview_rows,
                master_mode=master_mode,
            )

        data_dir = self._data_dir()
        return self._build_master_from_dir(
            data_dir=data_dir,
            output_path=output_path,
            join_steps=join_steps,
            base_dataset_type=base_dataset_type,
            str_policy=str_policy,
            replacement_label_column=replacement_label_column,
            persist=False,
            preview_rows=preview_rows,
            master_mode=master_mode,
        )

    # Compatibility wrappers for route layer
    def variable_stats(self, dataset: Dict, sample_rows: int = 5000) -> Dict:
        return self.compute_variable_stats(dataset, None, sample_rows)

    def correlation(self, dataset: Dict, columns: Optional[List[str]], sample_rows: int, method: str = "pearson") -> Dict:
        return self.compute_correlation(dataset, columns or [], method, sample_rows)

    def outliers(self, dataset: Dict, columns: Any, sample_rows: int, method: str = "iqr", threshold: float = 1.5) -> Dict:
        if isinstance(columns, str):
            columns = [columns]
        if not columns:
            columns = [
                c
                for c, t in (dataset.get("column_types") or {}).items()
                if str(t).upper().find("INT") >= 0 or str(t).upper().find("DOUBLE") >= 0 or str(t).upper().find("FLOAT") >= 0
            ]
            columns = columns[:1]
        if not columns:
            raise ValueError("No numeric columns available for outlier analysis")

        if len(columns) == 1:
            result = self.compute_outliers(dataset, columns[0], method, threshold, sample_rows)
            result["column"] = columns[0]
            return result

        results = {}
        for col in columns:
            try:
                results[col] = self.compute_outliers(dataset, col, method, threshold, sample_rows)
            except Exception:
                continue
        return {"columns": results, "rows_analyzed": sample_rows}

    def duplicates(self, dataset: Dict, sample_rows: int = 5000) -> Dict:
        return self.compute_duplicates(dataset, None, sample_rows)

    def insights(self, dataset: Dict, sample_rows: int = 5000) -> Dict:
        return self.compute_insights(dataset, sample_rows)

    def column_profile(self, dataset: Dict, columns: Optional[List[str]], sample_rows: int, bins: int = 20) -> Dict:
        return self.compute_column_profile(dataset, columns, sample_rows, bins=bins)

    def quality_score(self, dataset: Dict, target_column: Optional[str], sample_rows: int) -> Dict:
        return self.compute_quality_score(dataset, target_column, sample_rows)

    def feature_target(self, dataset: Dict, target_column: str, sample_rows: int) -> Dict:
        return self.compute_feature_target_matrix(dataset, target_column, sample_rows)

    def leakage_checks(
        self,
        dataset: Dict,
        target_column: Optional[str],
        sample_rows: int,
        corr_threshold: float = 0.85,
        unique_threshold: float = 0.95,
    ) -> Dict:
        return self.compute_leakage_checks(dataset, target_column, sample_rows, corr_threshold, unique_threshold)

    def pairplot(self, dataset: Dict, columns: Optional[List[str]], sample_rows: int, bins: int = 20) -> Dict:
        if not columns:
            numeric_cols = [
                c
                for c, t in (dataset.get("column_types") or {}).items()
                if str(t).upper().find("INT") >= 0 or str(t).upper().find("DOUBLE") >= 0 or str(t).upper().find("FLOAT") >= 0
            ]
            columns = numeric_cols[:4]
        return self.compute_pairplot(dataset, columns or [], sample_rows, bins=bins)

    def interaction_heatmap(self, dataset: Dict, columns: Optional[List[str]], sample_rows: int) -> Dict:
        if not columns:
            numeric_cols = [
                c
                for c, t in (dataset.get("column_types") or {}).items()
                if str(t).upper().find("INT") >= 0 or str(t).upper().find("DOUBLE") >= 0 or str(t).upper().find("FLOAT") >= 0
            ]
            columns = numeric_cols[:8]
        return self.compute_interaction_heatmap(dataset, columns or [], sample_rows)

    def segment_target(
        self,
        dataset: Dict,
        target_column: str,
        columns: List[str],
        sample_rows: int,
        max_categories: int = 25,
    ) -> Dict:
        """
        For each column in `columns`, compute the mean of `target_column`
        (assumed binary 0/1) per unique value of that column.
        Also computes overlapping histogram data for numeric columns (TP vs FP distributions).
        Returns:
            {
              segments: {
                COL_NAME: [{ label, tp_rate, count }, ...],  # categorical
                COL_NAME: { type: "histogram", bins: [{bin_start, bin_end, tp_count, fp_count}] }  # numeric
              },
              class_counts: { "0": N, "1": M },
              rows_analyzed: R
            }
        """
        load_cols = list({target_column} | set(columns))
        df = self._load_sample_df(Path(dataset["file_path"]), None, sample_rows)
        if target_column not in df.columns:
            raise ValueError(f"target_column '{target_column}' not found")

        # Robust binary coercion (supports numeric, bool, and text labels).
        tgt = self._coerce_binary_target(df[target_column]).astype(int)
        class_counts = tgt.value_counts().to_dict()

        segments: Dict = {}
        for col in columns:
            if col not in df.columns or col == target_column:
                continue
            series = df[col]
            if pd.api.types.is_numeric_dtype(series):
                # If low-cardinality numeric (e.g., risk rating 1-10), treat as categorical
                n_unique = int(pd.to_numeric(series, errors="coerce").nunique(dropna=True))
                if n_unique <= max_categories:
                    grp = pd.DataFrame({"cat": series.astype(str).fillna("unknown"), "tgt": tgt})
                    agg = (
                        grp.groupby("cat")["tgt"]
                        .agg(["mean", "count"])
                        .rename(columns={"mean": "tp_rate", "count": "count"})
                        .reset_index()
                    )
                    agg = agg.sort_values("count", ascending=False).head(max_categories)
                    segments[col] = [
                        {
                            "label":   str(row["cat"]),
                            "tp_rate": round(float(row["tp_rate"]) * 100, 2),
                            "count":   int(row["count"]),
                        }
                        for _, row in agg.iterrows()
                    ]
                else:
                    # Overlapping histogram: split into TP (1) vs FP (0) and bin together
                    vals = pd.to_numeric(series, errors="coerce").dropna()
                    if len(vals) < 10:
                        continue
                    lo, hi = float(vals.quantile(0.01)), float(vals.quantile(0.99))
                    if lo == hi:
                        continue
                    bins = np.linspace(lo, hi, 31)
                    tp_vals = vals[tgt.loc[vals.index] == 1]
                    fp_vals = vals[tgt.loc[vals.index] == 0]
                    tp_hist, _ = np.histogram(tp_vals, bins=bins)
                    fp_hist, _ = np.histogram(fp_vals, bins=bins)
                    segments[col] = {
                        "type": "histogram",
                        "bins": [
                            {
                                "bin_start": round(float(bins[i]), 3),
                                "bin_end":   round(float(bins[i + 1]), 3),
                                "tp_count":  int(tp_hist[i]),
                                "fp_count":  int(fp_hist[i]),
                            }
                            for i in range(len(bins) - 1)
                        ],
                    }
            else:
                # TP rate by category
                grp = pd.DataFrame({"cat": series.astype(str).fillna("unknown"), "tgt": tgt})
                agg = (
                    grp.groupby("cat")["tgt"]
                    .agg(["mean", "count"])
                    .rename(columns={"mean": "tp_rate", "count": "count"})
                    .reset_index()
                )
                # Sort by count descending, top N categories
                agg = agg.sort_values("count", ascending=False).head(max_categories)
                segments[col] = [
                    {
                        "label":   str(row["cat"]),
                        "tp_rate": round(float(row["tp_rate"]) * 100, 2),
                        "count":   int(row["count"]),
                    }
                    for _, row in agg.iterrows()
                ]

        return {
            "segments":     segments,
            "class_counts": {str(k): int(v) for k, v in class_counts.items()},
            "rows_analyzed": int(df.shape[0]),
        }

    def bivariate_categorical(self, dataset: Dict, column_x: str, column_y: str, sample_rows: int, limit: int = 20) -> Dict:
        return self.compute_bivariate_categorical(dataset, column_x, column_y, sample_rows, limit=limit)

    def preprocess_plan(self, dataset: Dict, sample_rows: int = 5000) -> Dict:
        return self.build_preprocessing_plan(dataset, sample_rows=sample_rows)

    def preprocess_preview(self, dataset: Dict, steps: List[Dict], sample_rows: int = 2000, target_column: Optional[str] = None) -> Dict:
        return self.preview_preprocessing(dataset, steps, sample_rows, target_column)

    def preprocess_run(
        self,
        tenant_id: str,
        env_id: str,
        dataset: Dict,
        steps: List[Dict],
        output_name: str,
        target_column: Optional[str] = None,
    ) -> Dict:
        output_path = self._data_dir() / f"{output_name}.csv"
        result = self.run_preprocessing(dataset, steps, output_path, target_column)
        reg = self.register_dataset(
            tenant_id=tenant_id,
            env_id=env_id,
            dataset_type=output_name,
            filename=output_path.name,
            file_path=output_path,
        )
        return {"output": result, "dataset": reg}

    def submit_job(self, kind: str, payload: Dict) -> str:
        kind_l = str(kind or "").lower()
        dataset_id = int(payload.get("dataset_id") or 0)
        if not dataset_id:
            raise ValueError("dataset_id required for async jobs")
        dataset = self.get_dataset(dataset_id)
        sample_rows = int(payload.get("sample_rows") or 5000)

        if kind_l == "correlation":
            columns = payload.get("columns") or []
            method = payload.get("method") or "pearson"
            return self.create_job(
                "correlation",
                payload,
                lambda: self.compute_correlation(dataset, columns, method, sample_rows),
            )
        if kind_l == "insights":
            return self.create_job(
                "insights",
                payload,
                lambda: self.compute_insights(dataset, sample_rows),
            )
        if kind_l == "variable_stats":
            columns = payload.get("columns")
            return self.create_job(
                "variable_stats",
                payload,
                lambda: self.compute_variable_stats(dataset, columns, sample_rows),
            )
        raise ValueError(f"Unsupported async job kind: {kind}")

    def get_job_status(self, job_id: str) -> Optional[Dict]:
        try:
            return self.get_job(job_id)
        except ValueError:
            return None

    def _coerce_binary_target(self, series: pd.Series) -> pd.Series:
        if pd.api.types.is_bool_dtype(series):
            return series.fillna(False).astype(int)

        numeric = pd.to_numeric(series, errors="coerce")
        if numeric.notna().any():
            uniq = set(numeric.dropna().unique().tolist())
            if uniq and uniq.issubset({0, 1}):
                return numeric.fillna(0).astype(int)
            midpoint = float(numeric.median()) if numeric.notna().any() else 0.0
            return (numeric.fillna(midpoint) >= midpoint).astype(int)

        text = series.fillna("").astype(str).str.strip().str.lower()
        positives = {"1", "true", "yes", "y", "tp", "positive", "suspicious", "sar", "str", "closed_sar_filed"}
        return text.isin(positives).astype(int)

    def _prepare_training_frame(self, dataset: Dict, target_column: str) -> Tuple[pd.DataFrame, pd.Series, Dict]:
        rel = self._relation_expr(Path(dataset["file_path"]), sample_size=None)
        with duckdb.connect() as conn:
            df = conn.execute(f"SELECT * FROM {rel}").df()

        if target_column not in df.columns:
            raise ValueError(f"target_column '{target_column}' not found in dataset")

        y = self._coerce_binary_target(df[target_column])
        X = df.drop(columns=[target_column]).copy()

        dropped = []
        for col in list(X.columns):
            lname = str(col).lower()
            unique_count = int(X[col].nunique(dropna=True))
            unique_ratio = float(unique_count / max(1, len(X)))
            id_name = (
                lname == "id"
                or lname.endswith("_id")
                or lname.startswith("id_")
                or any(k in lname for k in ["transaction_id", "account_id", "customer_id", "case_id", "alert_id"])
            )
            if id_name and (unique_ratio >= 0.20 or unique_count >= 50):
                dropped.append(col)
        if dropped:
            X = X.drop(columns=dropped)

        for col in list(X.columns):
            name = str(col).lower()
            if pd.api.types.is_datetime64_any_dtype(X[col]) or any(k in name for k in ["date", "time", "timestamp"]):
                dt = pd.to_datetime(X[col], errors="coerce")
                if dt.notna().sum() > 0:
                    X[f"{col}_year"] = dt.dt.year
                    X[f"{col}_month"] = dt.dt.month
                    X[f"{col}_day"] = dt.dt.day
                    X[f"{col}_dow"] = dt.dt.dayofweek
                    X = X.drop(columns=[col])

        num_cols = X.select_dtypes(include=[np.number, "bool"]).columns.tolist()
        cat_cols = [c for c in X.columns if c not in num_cols]

        for col in num_cols:
            values = pd.to_numeric(X[col], errors="coerce")
            X[col] = values.fillna(values.median())

        for col in cat_cols:
            s = X[col].astype(str).str.strip()
            s = s.replace({"": "UNKNOWN", "nan": "UNKNOWN", "None": "UNKNOWN"})
            X[col] = s.fillna("UNKNOWN")

        max_onehot = 30
        onehot_cols = []
        freq_cols = []
        for col in cat_cols:
            levels = int(X[col].nunique(dropna=False))
            if levels > max_onehot:
                freq_cols.append(col)
            else:
                onehot_cols.append(col)

        for col in freq_cols:
            freq = X[col].value_counts(normalize=True).to_dict()
            X[f"{col}_freq"] = X[col].map(freq).fillna(0.0).astype(float)
            X = X.drop(columns=[col])

        X_enc = pd.get_dummies(X, columns=onehot_cols, dummy_na=False) if onehot_cols else X.copy()
        X_enc = X_enc.replace([np.inf, -np.inf], np.nan).fillna(0.0)
        return X_enc.astype(float), y.astype(int), {"dropped_columns": dropped, "rows": int(len(df))}

    def _threshold_analysis(self, y_true: np.ndarray, y_prob: np.ndarray, thresholds: Optional[List[float]] = None) -> List[Dict]:
        from sklearn.metrics import confusion_matrix

        if thresholds is None:
            thresholds = [round(x, 2) for x in np.arange(0.1, 0.95, 0.05)]
        rows = []
        positives = int(np.sum(y_true == 1))
        total = int(len(y_true))
        positives = max(positives, 1)
        total = max(total, 1)

        for threshold in thresholds:
            pred = (y_prob >= float(threshold)).astype(int)
            tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
            suppression = float((tn + fn) / total * 100)
            event_loss = float(fn / positives * 100)
            precision = float(tp / (tp + fp + 1e-9))
            recall = float(tp / (tp + fn + 1e-9))
            rows.append(
                {
                    "threshold": float(threshold),
                    "tn": int(tn),
                    "fp": int(fp),
                    "fn": int(fn),
                    "tp": int(tp),
                    "suppression_rate_pct": suppression,
                    "event_loss_pct": event_loss,
                    "precision": precision,
                    "recall": recall,
                }
            )
        return rows

    def train_false_positive_model(
        self,
        tenant_id: str,
        env_id: str,
        dataset: Dict,
        target_column: str,
        test_size: float = 0.2,
        random_state: int = 42,
    ) -> Dict:
        from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import roc_auc_score, average_precision_score
        from sklearn.model_selection import train_test_split

        X, y, prep_meta = self._prepare_training_frame(dataset, target_column)
        if y.nunique() < 2:
            raise ValueError("Target column must contain at least two classes")

        stratify = y if y.nunique() > 1 else None
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=float(test_size),
            random_state=int(random_state),
            stratify=stratify,
        )

        models = {
            "Logistic Regression": LogisticRegression(C=0.5, max_iter=1000, class_weight="balanced", random_state=int(random_state)),
            "Random Forest": RandomForestClassifier(
                n_estimators=250,
                max_depth=12,
                min_samples_leaf=4,
                class_weight="balanced",
                random_state=int(random_state),
                # Use single-process training for Windows/sandbox stability.
                n_jobs=1,
            ),
            "Gradient Boosting": GradientBoostingClassifier(
                n_estimators=250,
                max_depth=3,
                learning_rate=0.08,
                random_state=int(random_state),
            ),
        }

        candidate_metrics = []
        best_name = None
        best_model = None
        best_probs = None
        best_auc = -1.0

        for name, model in models.items():
            model.fit(X_train, y_train)
            probs = model.predict_proba(X_test)[:, 1]
            auc = float(roc_auc_score(y_test, probs))
            ap = float(average_precision_score(y_test, probs))
            candidate_metrics.append({"model": name, "auc_roc": auc, "avg_precision": ap})
            if auc > best_auc:
                best_auc = auc
                best_name = name
                best_model = model
                best_probs = probs

        run_id = str(uuid.uuid4())
        artifact_path = self._model_dir() / f"{run_id}.pkl"
        with open(artifact_path, "wb") as file:
            pickle.dump(
                {
                    "model": best_model,
                    "feature_columns": X.columns.tolist(),
                    "target_column": target_column,
                    "trained_at": datetime.utcnow().isoformat(),
                    "dataset_id": int(dataset["dataset_id"]),
                    "algorithm": best_name,
                },
                file,
            )

        threshold_metrics = self._threshold_analysis(y_test.to_numpy(), np.asarray(best_probs))
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO mlops_model_runs (
                  run_id, tenant_id, env_id, dataset_id, target_column, algorithm,
                  feature_columns_json, metrics_json, threshold_metrics_json,
                  test_truth_json, test_prob_json, selected_threshold, artifact_path, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    run_id,
                    tenant_id,
                    env_id,
                    int(dataset["dataset_id"]),
                    target_column,
                    best_name,
                    json.dumps(X.columns.tolist(), default=str),
                    json.dumps({"candidates": candidate_metrics, "best_model": best_name}, default=str),
                    json.dumps(threshold_metrics, default=str),
                    json.dumps(y_test.astype(int).tolist(), default=str),
                    json.dumps(np.asarray(best_probs).astype(float).tolist(), default=str),
                    0.40,
                    str(artifact_path),
                ],
            )

        return {
            "run_id": run_id,
            "dataset_id": int(dataset["dataset_id"]),
            "target_column": target_column,
            "best_model": best_name,
            "candidates": candidate_metrics,
            "threshold_metrics": threshold_metrics,
            "artifact_path": str(artifact_path),
            "rows_train": int(len(X_train)),
            "rows_test": int(len(X_test)),
            "prep_meta": prep_meta,
        }

    def list_model_runs(self, tenant_id: str, env_id: str, dataset_id: Optional[int] = None) -> List[Dict]:
        with get_connection(self.db_path) as conn:
            if dataset_id is None:
                rows = conn.execute(
                    """
                    SELECT run_id, dataset_id, target_column, algorithm, metrics_json, selected_threshold, created_at, updated_at
                    FROM mlops_model_runs
                    WHERE tenant_id = ? AND env_id = ?
                    ORDER BY updated_at DESC
                    """,
                    [tenant_id, env_id],
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT run_id, dataset_id, target_column, algorithm, metrics_json, selected_threshold, created_at, updated_at
                    FROM mlops_model_runs
                    WHERE tenant_id = ? AND env_id = ? AND dataset_id = ?
                    ORDER BY updated_at DESC
                    """,
                    [tenant_id, env_id, int(dataset_id)],
                ).fetchall()

        results = []
        for row in rows:
            metrics = json.loads(row[4] or "{}")
            results.append(
                {
                    "run_id": row[0],
                    "dataset_id": int(row[1]),
                    "target_column": row[2],
                    "algorithm": row[3],
                    "metrics": metrics,
                    "selected_threshold": float(row[5]) if row[5] is not None else None,
                    "created_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
                    "updated_at": row[7].isoformat() if hasattr(row[7], "isoformat") else row[7],
                }
            )
        return results

    def get_model_run(self, run_id: str) -> Dict:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id, tenant_id, env_id, dataset_id, target_column, algorithm,
                       feature_columns_json, metrics_json, threshold_metrics_json,
                       test_truth_json, test_prob_json, selected_threshold, artifact_path,
                       created_at, updated_at
                FROM mlops_model_runs
                WHERE run_id = ?
                """,
                [run_id],
            ).fetchone()

        if not row:
            raise ValueError("model run not found")

        return {
            "run_id": row[0],
            "tenant_id": row[1],
            "env_id": row[2],
            "dataset_id": int(row[3]),
            "target_column": row[4],
            "algorithm": row[5],
            "feature_columns": json.loads(row[6] or "[]"),
            "metrics": json.loads(row[7] or "{}"),
            "threshold_metrics": json.loads(row[8] or "[]"),
            "test_truth": json.loads(row[9] or "[]"),
            "test_prob": json.loads(row[10] or "[]"),
            "selected_threshold": float(row[11]) if row[11] is not None else None,
            "artifact_path": row[12],
            "created_at": row[13].isoformat() if hasattr(row[13], "isoformat") else row[13],
            "updated_at": row[14].isoformat() if hasattr(row[14], "isoformat") else row[14],
        }

    def evaluate_model_run(self, run_id: str, threshold: float = 0.40) -> Dict:
        from sklearn.metrics import confusion_matrix, classification_report

        run = self.get_model_run(run_id)
        y_true = np.asarray(run["test_truth"], dtype=int)
        y_prob = np.asarray(run["test_prob"], dtype=float)
        pred = (y_prob >= float(threshold)).astype(int)
        tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
        positives = int(np.sum(y_true == 1))
        positives = max(positives, 1)
        total = max(int(len(y_true)), 1)
        report = classification_report(y_true, pred, output_dict=True, zero_division=0)
        return {
            "run_id": run_id,
            "threshold": float(threshold),
            "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
            "suppression_rate_pct": float((tn + fn) / total * 100),
            "event_loss_pct": float(fn / positives * 100),
            "precision": float(tp / (tp + fp + 1e-9)),
            "recall": float(tp / (tp + fn + 1e-9)),
            "classification_report": report,
            "threshold_metrics": run["threshold_metrics"],
        }

    def tune_model_threshold(self, run_id: str, max_event_loss_pct: float = 5.0) -> Dict:
        run = self.get_model_run(run_id)
        rows = run.get("threshold_metrics") or self._threshold_analysis(
            np.asarray(run["test_truth"], dtype=int),
            np.asarray(run["test_prob"], dtype=float),
        )
        valid = [row for row in rows if float(row.get("event_loss_pct") or 0.0) <= float(max_event_loss_pct)]
        if valid:
            best = max(valid, key=lambda row: (float(row.get("suppression_rate_pct") or 0.0), -float(row.get("event_loss_pct") or 0.0)))
            threshold = float(best["threshold"])
        else:
            best = None
            threshold = 0.50

        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE mlops_model_runs
                SET selected_threshold = ?, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = ?
                """,
                [threshold, run_id],
            )

        return {
            "run_id": run_id,
            "max_event_loss_pct": float(max_event_loss_pct),
            "optimal_threshold": float(threshold),
            "optimal_row": best,
            "threshold_metrics": rows,
        }

    def deploy_model_run(
        self,
        tenant_id: str,
        env_id: str,
        run_id: str,
        threshold: Optional[float] = None,
        deployment_name: Optional[str] = None,
    ) -> Dict:
        run = self.get_model_run(run_id)
        selected_threshold = float(threshold if threshold is not None else (run.get("selected_threshold") or 0.40))
        artifact_path = Path(run["artifact_path"])
        if not artifact_path.exists():
            raise ValueError("Model artifact missing; retrain model run")

        model_bundle = load_pickle_compat(artifact_path)

        safe_name = (deployment_name or f"deployment_{run_id}").strip().replace(" ", "_")
        bundle_path = self._deployment_dir() / f"{safe_name}.pkl"
        model_card_path = self._deployment_dir() / f"{safe_name}_model_card.json"

        deploy_bundle = {
            "model": model_bundle.get("model"),
            "feature_columns": model_bundle.get("feature_columns", []),
            "target_column": run["target_column"],
            "threshold": selected_threshold,
            "metadata": {
                "run_id": run_id,
                "algorithm": run["algorithm"],
                "dataset_id": run["dataset_id"],
                "deployed_at": datetime.utcnow().isoformat(),
            },
        }
        with open(bundle_path, "wb") as file:
            pickle.dump(deploy_bundle, file)

        model_card = {
            "name": safe_name,
            "run_id": run_id,
            "algorithm": run["algorithm"],
            "target_column": run["target_column"],
            "threshold": selected_threshold,
            "metrics": run.get("metrics") or {},
            "created_at": datetime.utcnow().isoformat(),
        }
        with open(model_card_path, "w", encoding="utf-8") as file:
            json.dump(model_card, file, indent=2)

        deployment_id = str(uuid.uuid4())
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO mlops_deployments (
                  deployment_id, run_id, tenant_id, env_id, threshold,
                  bundle_path, model_card_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    deployment_id,
                    run_id,
                    tenant_id,
                    env_id,
                    selected_threshold,
                    str(bundle_path),
                    str(model_card_path),
                ],
            )

        return {
            "deployment_id": deployment_id,
            "run_id": run_id,
            "threshold": selected_threshold,
            "bundle_path": str(bundle_path),
            "model_card_path": str(model_card_path),
        }

    def create_snapshot(
        self,
        tenant_id: str,
        env_id: str,
        name: str,
        dataset_id: Optional[int],
        payload: Dict,
    ) -> Dict:
        with get_connection(self.db_path) as conn:
            snapshot_id = conn.execute("SELECT nextval('mlops_snapshot_seq')").fetchone()[0]
            conn.execute(
                """
                INSERT INTO mlops_snapshots (snapshot_id, tenant_id, env_id, name, dataset_id, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    int(snapshot_id),
                    tenant_id,
                    env_id,
                    name,
                    int(dataset_id) if dataset_id else None,
                    json.dumps(payload or {}, default=str),
                ],
            )
        return {"snapshot_id": int(snapshot_id), "name": name}

    def list_snapshots(self, tenant_id: str, env_id: str) -> List[Dict]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT snapshot_id, name, dataset_id, payload_json, created_at
                FROM mlops_snapshots
                WHERE tenant_id = ? AND env_id = ?
                ORDER BY created_at DESC
                """,
                [tenant_id, env_id],
            ).fetchall()
        return [
            {
                "snapshot_id": int(r[0]),
                "name": r[1],
                "dataset_id": int(r[2]) if r[2] is not None else None,
                "payload": json.loads(r[3] or "{}"),
                "created_at": r[4].isoformat() if hasattr(r[4], "isoformat") else r[4],
            }
            for r in rows
        ]

    def create_job(self, kind: str, payload: Dict, fn) -> str:
        job_id = str(uuid.uuid4())
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO mlops_jobs (job_id, kind, status, payload_json)
                VALUES (?, ?, ?, ?)
                """,
                [job_id, kind, "running", json.dumps(payload or {}, default=str)],
            )

        def runner():
            try:
                result = fn()
                with get_connection(self.db_path) as conn_inner:
                    conn_inner.execute(
                        """
                        UPDATE mlops_jobs
                        SET status = ?, result_json = ?, finished_at = CURRENT_TIMESTAMP
                        WHERE job_id = ?
                        """,
                        ["completed", json.dumps(result, default=str), job_id],
                    )
            except Exception as e:
                with get_connection(self.db_path) as conn_inner:
                    conn_inner.execute(
                        """
                        UPDATE mlops_jobs
                        SET status = ?, error = ?, finished_at = CURRENT_TIMESTAMP
                        WHERE job_id = ?
                        """,
                        ["failed", str(e), job_id],
                    )

        threading.Thread(target=runner, daemon=True).start()
        return job_id

    def get_job(self, job_id: str) -> Dict:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT job_id, kind, status, payload_json, result_json, error, created_at, finished_at
                FROM mlops_jobs
                WHERE job_id = ?
                """,
                [job_id],
            ).fetchone()
        if not row:
            raise ValueError("job not found")
        return {
            "job_id": row[0],
            "kind": row[1],
            "status": row[2],
            "payload": json.loads(row[3] or "{}"),
            "result": json.loads(row[4] or "{}") if row[4] else None,
            "error": row[5],
            "created_at": row[6].isoformat() if hasattr(row[6], "isoformat") else row[6],
            "finished_at": row[7].isoformat() if hasattr(row[7], "isoformat") else row[7],
        }

    # -------------------- Run Report --------------------

    @staticmethod
    def _report_json_load(value: Any, default: Any) -> Any:
        if value is None:
            return default
        if isinstance(value, (dict, list)):
            return value
        try:
            return json.loads(value)
        except Exception:
            return default

    @staticmethod
    def _report_float(value: Any, default: float = 0.0) -> float:
        try:
            if value is None or value == "":
                return float(default)
            return float(value)
        except Exception:
            return float(default)

    @staticmethod
    def _report_int(value: Any, default: int = 0) -> int:
        try:
            if value is None or value == "":
                return int(default)
            return int(float(value))
        except Exception:
            return int(default)

    @staticmethod
    def _report_has_value(value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, str):
            text = value.strip().lower()
            if text in {"", "-", "--", "na", "n/a", "none", "null", "nan", "not recorded", "not available"}:
                return False
            return True
        if isinstance(value, (list, tuple, set, dict)):
            return len(value) > 0
        return True

    def _report_pick_value(
        self,
        *values: Any,
        numeric: bool = False,
        zero_means_missing: bool = False,
        default: Any = None,
    ) -> Any:
        fallback_numeric = None
        for value in values:
            if not self._report_has_value(value):
                continue
            if numeric:
                numeric_value = self._report_float(value, 0.0)
                if zero_means_missing and abs(numeric_value) < 1e-12:
                    if fallback_numeric is None:
                        fallback_numeric = value
                    continue
            return value
        if fallback_numeric is not None:
            return fallback_numeric
        return default

    @staticmethod
    def _report_iso(value: Any) -> Optional[str]:
        if value is None:
            return None
        if hasattr(value, "isoformat"):
            try:
                return value.isoformat()
            except Exception:
                return str(value)
        return str(value)

    def _report_fetch_row(
        self,
        conn,
        *,
        table: str,
        key_column: str,
        key_value: Any,
        columns: List[str],
    ) -> Optional[Dict[str, Any]]:
        try:
            info_rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        except Exception:
            return None

        existing = {str(r[1]) for r in info_rows}
        if key_column not in existing:
            return None

        wanted = [c for c in columns if c in existing]
        if not wanted:
            return None

        row = conn.execute(
            f"SELECT {', '.join(wanted)} FROM {table} WHERE {key_column} = ? LIMIT 1",
            [key_value],
        ).fetchone()
        if not row:
            return None
        return {col: row[idx] for idx, col in enumerate(wanted)}

    @staticmethod
    def _normalize_confusion_matrix(raw_cm: Any) -> Dict[str, int]:
        if isinstance(raw_cm, dict):
            return {
                "tn": int(raw_cm.get("tn", 0)),
                "fp": int(raw_cm.get("fp", 0)),
                "fn": int(raw_cm.get("fn", 0)),
                "tp": int(raw_cm.get("tp", 0)),
            }
        if isinstance(raw_cm, list) and len(raw_cm) == 2:
            try:
                return {
                    "tn": int(raw_cm[0][0]),
                    "fp": int(raw_cm[0][1]),
                    "fn": int(raw_cm[1][0]),
                    "tp": int(raw_cm[1][1]),
                }
            except Exception:
                pass
        return {"tn": 0, "fp": 0, "fn": 0, "tp": 0}

    def _report_map_training_row(
        self,
        row: Dict[str, Any],
        *,
        run_id: str,
        tenant_id: str,
        env_id: str,
    ) -> Dict[str, Any]:
        row_tenant = str(row.get("tenant_id") or "")
        row_env = str(row.get("env_id") or "")
        result_payload = self._report_json_load(row.get("result_json"), {})
        metrics_payload = self._report_json_load(row.get("metrics_json"), {})
        feature_diag = self._report_json_load(row.get("feature_diagnostics_json"), {})
        metrics = result_payload.get("metrics") if isinstance(result_payload, dict) else {}
        if not isinstance(metrics, dict) or not metrics:
            metrics = metrics_payload if isinstance(metrics_payload, dict) else {}

        split_summary = result_payload.get("split_summary") if isinstance(result_payload, dict) else {}
        split_summary = split_summary if isinstance(split_summary, dict) else {}

        return {
            "source": "model_training_runs",
            "run_id": str(row.get("job_id") or row.get("run_id") or run_id),
            "tenant_id": row_tenant or str(tenant_id),
            "env_id": row_env or str(env_id),
            "dataset_id": self._report_int(row.get("dataset_id"), 0),
            "target_column": str(row.get("target_column") or ""),
            "algorithm": str(row.get("algorithm") or ""),
            "grain": str(
                (result_payload.get("grain") if isinstance(result_payload, dict) else "")
                or row.get("grain")
                or "alert"
            ),
            "id_column": str(
                (result_payload.get("id_column") if isinstance(result_payload, dict) else "")
                or ""
            ),
            "run_name": str(
                (result_payload.get("model_name") if isinstance(result_payload, dict) else "")
                or f"{str(row.get('algorithm') or 'model').replace('_', ' ').title()} {str(run_id)[:8]}"
            ),
            "created_at": self._report_iso(row.get("trained_at")),
            "finished_at": self._report_iso(row.get("updated_at") or row.get("trained_at")),
            "artifact_path": str(row.get("artifact_path") or ""),
            "metrics": metrics,
            "result": result_payload if isinstance(result_payload, dict) else {},
            "feature_diagnostics": feature_diag if isinstance(feature_diag, dict) else {},
            "threshold_table": metrics.get("threshold_table") if isinstance(metrics, dict) else [],
            "test_truth": self._report_json_load(row.get("test_truth_json"), []),
            "test_prob": self._report_json_load(row.get("test_prob_json"), []),
            "selected_threshold": self._report_float(
                (result_payload.get("selected_threshold") if isinstance(result_payload, dict) else None)
                or row.get("selected_threshold"),
                0.5,
            ),
            "hml_high_threshold": self._report_float(
                (result_payload.get("hml_high_threshold") if isinstance(result_payload, dict) else None)
                or row.get("hml_high_threshold"),
                0.65,
            ),
            "hml_low_threshold": self._report_float(
                (result_payload.get("hml_low_threshold") if isinstance(result_payload, dict) else None)
                or row.get("hml_low_threshold"),
                0.35,
            ),
            "split_strategy": str(
                (result_payload.get("split_strategy") if isinstance(result_payload, dict) else "")
                or split_summary.get("split_strategy")
                or "random"
            ),
            "split_date": (
                (result_payload.get("split_date") if isinstance(result_payload, dict) else None)
                or split_summary.get("split_date")
            ),
            "date_column": (
                (result_payload.get("date_column") if isinstance(result_payload, dict) else None)
                or split_summary.get("date_column")
            ),
            "train_rows": self._report_int(
                (result_payload.get("train_rows") if isinstance(result_payload, dict) else None)
                or split_summary.get("train_rows"),
                0,
            ),
            "test_rows": self._report_int(
                (result_payload.get("test_rows") if isinstance(result_payload, dict) else None)
                or split_summary.get("test_rows"),
                0,
            ),
            "hml_summary": (
                result_payload.get("hml_summary", {})
                if isinstance(result_payload, dict)
                else {}
            ),
        }

    def _load_run_for_report(
        self,
        *,
        tenant_id: str,
        env_id: str,
        run_id: str,
    ) -> Optional[Dict[str, Any]]:
        def _accept_training_row(row: Optional[Dict[str, Any]], source_hint: str) -> Optional[Dict[str, Any]]:
            if not row:
                return None
            row_tenant = str(row.get("tenant_id") or "")
            row_env = str(row.get("env_id") or "")
            env_match = (not row_env) or (row_env == str(env_id))
            tenant_match = (not row_tenant) or (row_tenant == str(tenant_id))
            if not env_match:
                return None
            if not tenant_match and row_tenant:
                logger.warning(
                    "Report run lookup accepted env match with tenant mismatch for run_id=%s (%s): requested_tenant=%s row_tenant=%s",
                    run_id,
                    source_hint,
                    tenant_id,
                    row_tenant,
                )
            return self._report_map_training_row(
                row,
                run_id=run_id,
                tenant_id=tenant_id,
                env_id=env_id,
            )

        with get_connection(self.db_path) as conn:
            run_cols = [
                "job_id",
                "run_id",
                "tenant_id",
                "env_id",
                "dataset_id",
                "target_column",
                "algorithm",
                "metrics_json",
                "result_json",
                "test_truth_json",
                "test_prob_json",
                "selected_threshold",
                "artifact_path",
                "trained_at",
                "updated_at",
                "grain",
                "hml_high_threshold",
                "hml_low_threshold",
                "feature_diagnostics_json",
            ]
            row = self._report_fetch_row(
                conn,
                table="model_training_runs",
                key_column="job_id",
                key_value=run_id,
                columns=run_cols,
            )
            accepted = _accept_training_row(row, "mlops.duckdb:model_training_runs")
            if accepted is not None:
                return accepted
            # Compatibility: some schemas use run_id instead of job_id.
            row = self._report_fetch_row(
                conn,
                table="model_training_runs",
                key_column="run_id",
                key_value=run_id,
                columns=run_cols,
            )
            accepted = _accept_training_row(row, "mlops.duckdb:model_training_runs(run_id)")
            if accepted is not None:
                return accepted

        # Standalone training runs are persisted in sibling model_training.duckdb.
        sidecar_training_db = Path(self.db_path).with_name("model_training.duckdb")
        if sidecar_training_db.exists():
            try:
                with get_connection(str(sidecar_training_db)) as tconn:
                    row = self._report_fetch_row(
                        tconn,
                        table="model_training_runs",
                        key_column="job_id",
                        key_value=run_id,
                        columns=run_cols,
                    )
                accepted = _accept_training_row(row, "model_training.duckdb:model_training_runs")
                if accepted is not None:
                    return accepted
                with get_connection(str(sidecar_training_db)) as tconn:
                    row = self._report_fetch_row(
                        tconn,
                        table="model_training_runs",
                        key_column="run_id",
                        key_value=run_id,
                        columns=run_cols,
                    )
                accepted = _accept_training_row(row, "model_training.duckdb:model_training_runs(run_id)")
                if accepted is not None:
                    return accepted
            except Exception as exc:
                logger.warning("Report run lookup sidecar read failed for run_id=%s: %s", run_id, exc)

        with get_connection(self.db_path) as conn:
            legacy_cols = [
                "run_id",
                "tenant_id",
                "env_id",
                "dataset_id",
                "target_column",
                "algorithm",
                "metrics_json",
                "threshold_metrics_json",
                "test_truth_json",
                "test_prob_json",
                "selected_threshold",
                "artifact_path",
                "created_at",
                "updated_at",
            ]
            legacy = self._report_fetch_row(
                conn,
                table="mlops_model_runs",
                key_column="run_id",
                key_value=run_id,
                columns=legacy_cols,
            )
            if not legacy:
                artifact_candidates = sorted(
                    self._model_dir().glob(f"*{run_id}*.pkl"),
                    key=lambda path: path.stat().st_mtime,
                    reverse=True,
                )
                if not artifact_candidates:
                    return None

                artifact_path = artifact_candidates[0]
                try:
                    bundle = load_pickle_compat(artifact_path)
                except Exception as exc:
                    logger.warning("Report artifact fallback failed for run_id=%s: %s", run_id, exc)
                    return None

                if not isinstance(bundle, dict) or "model" not in bundle:
                    return None

                trained_at = bundle.get("trained_at")
                if hasattr(trained_at, "isoformat"):
                    trained_at = trained_at.isoformat()
                elif trained_at is None:
                    trained_at = datetime.utcfromtimestamp(artifact_path.stat().st_mtime).isoformat() + "Z"

                feature_columns = [str(value) for value in list(bundle.get("feature_columns") or [])]
                feature_diag = {
                    "selected_feature_count": int(len(feature_columns)),
                    "selected_features_preview": feature_columns[:25],
                }
                result_payload = {
                    "grain": bundle.get("grain") or "alert",
                    "id_column": bundle.get("id_column"),
                    "target_column": bundle.get("target_column"),
                    "selected_threshold": bundle.get("threshold"),
                    "hml_high_threshold": bundle.get("hml_high_threshold"),
                    "hml_low_threshold": bundle.get("hml_low_threshold"),
                    "feature_columns": feature_columns,
                    "trained_at": trained_at,
                    "source": "artifact_model_dir_scan",
                }
                fallback_row = {
                    "job_id": str(run_id),
                    "run_id": str(run_id),
                    "tenant_id": str(tenant_id),
                    "env_id": str(env_id),
                    "dataset_id": bundle.get("dataset_id"),
                    "target_column": bundle.get("target_column"),
                    "algorithm": bundle.get("algorithm") or type(bundle.get("model")).__name__,
                    "metrics_json": json.dumps({}, default=str),
                    "result_json": json.dumps(result_payload, default=str),
                    "test_truth_json": json.dumps([], default=str),
                    "test_prob_json": json.dumps([], default=str),
                    "selected_threshold": bundle.get("threshold"),
                    "artifact_path": str(artifact_path),
                    "trained_at": trained_at,
                    "updated_at": trained_at,
                    "grain": bundle.get("grain") or "alert",
                    "hml_high_threshold": bundle.get("hml_high_threshold"),
                    "hml_low_threshold": bundle.get("hml_low_threshold"),
                    "feature_diagnostics_json": json.dumps(feature_diag, default=str),
                }
                accepted = _accept_training_row(fallback_row, "model_dir:artifact_fallback")
                if accepted is not None:
                    return accepted
                return None

            row_tenant = str(legacy.get("tenant_id") or "")
            row_env = str(legacy.get("env_id") or "")
            env_match = (not row_env) or (row_env == str(env_id))
            if not env_match:
                return None
            if row_tenant and row_tenant != str(tenant_id):
                logger.warning(
                    "Report run lookup accepted env match with tenant mismatch for legacy run_id=%s: requested_tenant=%s row_tenant=%s",
                    run_id,
                    tenant_id,
                    row_tenant,
                )

            metrics = self._report_json_load(legacy.get("metrics_json"), {})
            threshold_table = self._report_json_load(legacy.get("threshold_metrics_json"), [])

            return {
                "source": "mlops_model_runs",
                "run_id": str(legacy.get("run_id") or run_id),
                "tenant_id": row_tenant or str(tenant_id),
                "env_id": row_env or str(env_id),
                "dataset_id": self._report_int(legacy.get("dataset_id"), 0),
                "target_column": str(legacy.get("target_column") or ""),
                "algorithm": str(legacy.get("algorithm") or ""),
                "run_name": f"{str(legacy.get('algorithm') or 'model').replace('_', ' ').title()} {str(run_id)[:8]}",
                "created_at": self._report_iso(legacy.get("created_at")),
                "finished_at": self._report_iso(legacy.get("updated_at") or legacy.get("created_at")),
                "artifact_path": str(legacy.get("artifact_path") or ""),
                "metrics": metrics if isinstance(metrics, dict) else {},
                "result": {},
                "feature_diagnostics": {},
                "threshold_table": threshold_table if isinstance(threshold_table, list) else [],
                "test_truth": self._report_json_load(legacy.get("test_truth_json"), []),
                "test_prob": self._report_json_load(legacy.get("test_prob_json"), []),
                "selected_threshold": self._report_float(legacy.get("selected_threshold"), 0.4),
                "split_strategy": "random",
                "split_date": None,
                "date_column": None,
                "train_rows": 0,
                "test_rows": self._report_int(
                    len(self._report_json_load(legacy.get("test_truth_json"), [])),
                    0,
                ),
                "hml_summary": {},
            }

    def _load_target_summary_for_dataset(
        self,
        *,
        tenant_id: str,
        env_id: str,
        dataset_id: int,
    ) -> Dict[str, Any]:
        if not dataset_id:
            return {}
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT strategy, config_json, summary_json, created_at
                FROM mlops_targets
                WHERE tenant_id = ? AND env_id = ? AND dataset_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [tenant_id, env_id, int(dataset_id)],
            ).fetchone()
            if not row:
                row = conn.execute(
                    """
                    SELECT strategy, config_json, summary_json, created_at
                    FROM mlops_targets
                    WHERE dataset_id = ?
                    ORDER BY created_at DESC
                    LIMIT 1
                    """,
                    [int(dataset_id)],
                ).fetchone()
            if not row:
                return {}
        return {
            "strategy": str(row[0] or ""),
            "config": self._report_json_load(row[1], {}),
            "summary": self._report_json_load(row[2], {}),
            "created_at": self._report_iso(row[3]),
        }

    def _load_eda_summary_for_dataset(
        self,
        *,
        dataset_id: int,
    ) -> Optional[Dict[str, Any]]:
        if not dataset_id:
            return None

        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT kind, payload_json, result_json, finished_at
                FROM mlops_jobs
                WHERE status = 'completed'
                ORDER BY finished_at DESC NULLS LAST, created_at DESC
                LIMIT 300
                """
            ).fetchall()

        def _extract_payload_dataset(payload_obj: Any) -> Optional[int]:
            if not isinstance(payload_obj, dict):
                return None
            raw = payload_obj.get("dataset_id")
            try:
                return int(raw) if raw is not None else None
            except Exception:
                return None

        for kind, payload_json, result_json, _finished_at in rows:
            kind_l = str(kind or "").lower()
            if "eda" not in kind_l and kind_l not in {"overview", "correlation", "feature_target"}:
                continue
            payload = self._report_json_load(payload_json, {})
            if _extract_payload_dataset(payload) != int(dataset_id):
                continue
            result = self._report_json_load(result_json, {})
            if not isinstance(result, dict) or not result:
                continue
            if isinstance(result.get("data"), dict):
                return result.get("data")
            return result
        return None

    def _report_binary_label_name(self, value: Any) -> str:
        label = str(value or "").strip().lower()
        if label in {"1", "true", "yes", "positive", "tp"}:
            return "Positive"
        if label in {"0", "false", "no", "negative", "tn"}:
            return "Negative"
        return str(value or "Class")

    def _build_report_validation_metrics(
        self,
        test_truth: Any,
        test_prob: Any,
        *,
        selected_threshold: float,
    ) -> Dict[str, Any]:
        truth = np.asarray(test_truth if isinstance(test_truth, list) else [], dtype=float).reshape(-1)
        prob = np.asarray(test_prob if isinstance(test_prob, list) else [], dtype=float).reshape(-1)
        if truth.size == 0 or prob.size == 0 or truth.size != prob.size:
            return {}

        try:
            from sklearn.metrics import (
                average_precision_score,
                confusion_matrix,
                precision_recall_curve,
                roc_auc_score,
                roc_curve,
            )
        except Exception:
            return {}

        y_true = truth.astype(int)
        y_prob = prob.astype(float)
        threshold = float(selected_threshold)

        def _sample_curve(points: List[Dict[str, Any]], limit: int = 180) -> List[Dict[str, Any]]:
            if len(points) <= limit:
                return points
            step = max(1, len(points) // max(limit - 1, 1))
            sampled = points[::step]
            if sampled and sampled[-1] != points[-1]:
                sampled.append(points[-1])
            return sampled[:limit]

        try:
            auc = float(roc_auc_score(y_true, y_prob))
        except Exception:
            auc = 0.0
        try:
            pr_auc = float(average_precision_score(y_true, y_prob))
        except Exception:
            pr_auc = 0.0

        threshold_table = self._threshold_analysis(y_true, y_prob)
        selected_row = {}
        if threshold_table:
            selected_row = min(
                threshold_table,
                key=lambda row: abs(float(row.get("threshold", 0.5)) - threshold),
            )

        try:
            fpr_arr, tpr_arr, _ = roc_curve(y_true, y_prob)
            roc_curve_data = _sample_curve([
                {"fpr": round(float(fpr), 4), "tpr": round(float(tpr), 4)}
                for fpr, tpr in zip(fpr_arr, tpr_arr)
            ])
        except Exception:
            roc_curve_data = []

        try:
            precision_arr, recall_arr, _ = precision_recall_curve(y_true, y_prob)
            pr_curve_data = _sample_curve([
                {"recall": round(float(recall), 4), "precision": round(float(precision), 4)}
                for precision, recall in zip(precision_arr, recall_arr)
            ])
        except Exception:
            pr_curve_data = []

        pred = (y_prob >= threshold).astype(int)
        try:
            tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
        except Exception:
            tn, fp, fn, tp = 0, 0, 0, 0

        total = max(int(len(y_true)), 1)
        positives = max(int(np.sum(y_true == 1)), 1)
        precision = float(tp / max(tp + fp, 1))
        recall = float(tp / max(tp + fn, 1))
        specificity = float(tn / max(tn + fp, 1))
        accuracy = float((tp + tn) / total)
        balanced_accuracy = float((recall + specificity) / 2.0)
        f1 = float((2 * tp) / max((2 * tp) + fp + fn, 1))
        suppression_rate_pct = float((tn + fn) / total * 100.0)
        event_loss_pct = float(fn / positives * 100.0)

        return {
            "roc_auc": round(auc, 4),
            "pr_auc": round(pr_auc, 4),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "accuracy": round(accuracy, 4),
            "specificity": round(specificity, 4),
            "balanced_accuracy": round(balanced_accuracy, 4),
            "suppression_rate_pct": round(
                self._report_float(selected_row.get("suppression_rate_pct"), suppression_rate_pct),
                2,
            ),
            "event_loss_pct": round(
                self._report_float(selected_row.get("event_loss_pct"), event_loss_pct),
                2,
            ),
            "confusion_matrix": {
                "tn": int(tn),
                "fp": int(fp),
                "fn": int(fn),
                "tp": int(tp),
            },
            "threshold_table": threshold_table,
            "roc_curve": roc_curve_data,
            "pr_curve": pr_curve_data,
        }

    def _build_report_eda_snapshot(
        self,
        *,
        tenant_id: str,
        env_id: str,
        dataset_id: int,
        target_col: str,
        existing_raw: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        merged = dict(existing_raw) if isinstance(existing_raw, dict) else {}
        chart_data: Dict[str, Any] = {}
        if isinstance(merged.get("chart_data"), dict):
            chart_data.update(merged.get("chart_data") or {})
        else:
            for key in (
                "class_distribution_chart",
                "risk_score_by_label_chart",
                "missing_values_chart",
                "sar_rate_by_rule_chart",
                "feature_correlation_chart",
                "column_role_chart",
                "correlation_pairs_chart",
                "row_completeness_chart",
            ):
                if key in merged:
                    chart_data[key] = merged.get(key)

        if not dataset_id:
            merged["chart_data"] = chart_data or None
            return merged

        try:
            dataset = self.get_dataset(tenant_id, env_id, int(dataset_id))
        except Exception as exc:
            logger.warning("Report EDA dataset lookup failed for dataset_id=%s: %s", dataset_id, exc)
            merged["chart_data"] = chart_data or None
            return merged

        try:
            from api.tools.mlops.eda_service import EDAService

            eda_service = EDAService()
        except Exception as exc:
            logger.warning("Report EDA service import failed for dataset_id=%s: %s", dataset_id, exc)
            merged["chart_data"] = chart_data or None
            return merged

        sample_rows = 30_000
        overview = {}
        missing = {}
        correlation = {}
        feature_target = {}

        try:
            overview = eda_service.dataset_overview(dataset, sample_rows=sample_rows)
        except Exception as exc:
            logger.warning("Report EDA overview failed for dataset_id=%s: %s", dataset_id, exc)
        try:
            missing = eda_service.missing_analysis(dataset, sample_rows=sample_rows)
        except Exception as exc:
            logger.warning("Report EDA missing analysis failed for dataset_id=%s: %s", dataset_id, exc)
        try:
            correlation = eda_service.correlation_matrix(dataset, sample_rows=min(sample_rows, 12_000))
        except Exception as exc:
            logger.warning("Report EDA correlation failed for dataset_id=%s: %s", dataset_id, exc)
        if target_col:
            try:
                feature_target = eda_service.feature_target_analysis(
                    dataset,
                    target_col=target_col,
                    sample_rows=min(sample_rows, 20_000),
                    max_features=80,
                )
            except Exception as exc:
                logger.warning(
                    "Report feature-target analysis failed for dataset_id=%s target=%s: %s",
                    dataset_id,
                    target_col,
                    exc,
                )

        if overview:
            merged["overview"] = overview
            if not chart_data.get("class_distribution_chart") and isinstance(overview.get("class_balance"), dict):
                chart_data["class_distribution_chart"] = [
                    {
                        "name": self._report_binary_label_name(label),
                        "value": round(self._report_float(value), 2),
                    }
                    for label, value in (overview.get("class_balance") or {}).items()
                ]
            if not chart_data.get("column_role_chart"):
                chart_data["column_role_chart"] = [
                    {"name": "Numeric", "value": len(overview.get("numeric_columns") or [])},
                    {"name": "Categorical", "value": len(overview.get("categorical_columns") or [])},
                    {"name": "Binary", "value": len(overview.get("binary_columns") or [])},
                    {"name": "Timestamp", "value": len(overview.get("timestamp_columns") or [])},
                    {"name": "ID", "value": len(overview.get("id_columns") or [])},
                ]

        if missing:
            merged["missing_analysis"] = missing
            merged["missing_columns"] = [
                row.get("column")
                for row in (missing.get("column_summary") or [])[:12]
                if isinstance(row, dict) and row.get("column")
            ]
            merged["max_missing_pct"] = (
                (missing.get("column_summary") or [{}])[0].get("pct_missing")
                if (missing.get("column_summary") or [])
                else missing.get("overall_missing_pct")
            )
            merged["overall_missing_pct"] = missing.get("overall_missing_pct")
            if not chart_data.get("missing_values_chart"):
                chart_data["missing_values_chart"] = [
                    {
                        "column": row.get("column"),
                        "pct_missing": row.get("pct_missing"),
                        "n_missing": row.get("n_missing"),
                    }
                    for row in (missing.get("column_summary") or [])[:10]
                    if isinstance(row, dict) and row.get("column")
                ]
            if not chart_data.get("row_completeness_chart"):
                chart_data["row_completeness_chart"] = [
                    {
                        "missing_columns": row.get("n_missing_cols"),
                        "rows": row.get("n_rows"),
                    }
                    for row in (missing.get("row_completeness_dist") or [])[:10]
                    if isinstance(row, dict)
                ]

        if correlation:
            merged["correlation_analysis"] = correlation
            if not chart_data.get("correlation_pairs_chart"):
                chart_data["correlation_pairs_chart"] = [
                    {
                        "pair": f"{str(row.get('col_a') or '').strip()} vs {str(row.get('col_b') or '').strip()}".strip(),
                        "correlation": row.get("correlation"),
                    }
                    for row in (correlation.get("top_pairs") or [])[:10]
                    if isinstance(row, dict) and row.get("col_a") and row.get("col_b")
                ]

        if feature_target:
            merged["feature_target_analysis"] = feature_target
            matrix = feature_target.get("matrix") or []
            if not chart_data.get("feature_correlation_chart"):
                chart_data["feature_correlation_chart"] = [
                    {
                        "feature": row.get("feature"),
                        "value": row.get("value"),
                        "metric": row.get("metric"),
                        "dtype": row.get("dtype"),
                    }
                    for row in matrix[:10]
                    if isinstance(row, dict) and row.get("feature") and row.get("value") is not None
                ]
            if not merged.get("top_correlated_with_target"):
                merged["top_correlated_with_target"] = [
                    {
                        "feature": row.get("feature"),
                        "score": row.get("value"),
                        "metric": row.get("metric"),
                    }
                    for row in matrix[:10]
                    if isinstance(row, dict) and row.get("feature")
                ]

        merged["chart_data"] = chart_data or None
        return merged

    def _build_report_eda_chart_fallback(
        self,
        *,
        n_positive: int,
        n_negative: int,
        hml_summary: Optional[Dict[str, Any]] = None,
        confusion_matrix: Optional[Dict[str, Any]] = None,
        feature_importance: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Build a minimal EDA snapshot when no persisted EDA job exists.

        Standalone runs often skip the dedicated EDA job, but the report still
        needs an interpretable class balance and risk-separation view.
        """
        chart_data: Dict[str, Any] = {}

        if int(n_positive) > 0 or int(n_negative) > 0:
            chart_data["class_distribution_chart"] = [
                {"name": "Positive", "value": int(max(n_positive, 0))},
                {"name": "Negative", "value": int(max(n_negative, 0))},
            ]

        hml = hml_summary if isinstance(hml_summary, dict) else {}
        hml_rows: List[Dict[str, Any]] = []
        for key, label in (("low", "Low"), ("medium", "Medium"), ("high", "High")):
            tier = hml.get(key) or {}
            if not isinstance(tier, dict):
                continue
            tp_val = self._report_int(tier.get("tp"), 0)
            fp_val = self._report_int(tier.get("fp"), 0)
            count_val = self._report_int(tier.get("count"), 0)
            if tp_val == 0 and fp_val == 0 and count_val == 0:
                continue
            hml_rows.append(
                {
                    "score_bucket": label,
                    "tp_count": tp_val,
                    "fp_count": fp_val,
                    "count": count_val,
                }
            )
        if hml_rows:
            chart_data["risk_score_by_label_chart"] = hml_rows
        else:
            cm = confusion_matrix if isinstance(confusion_matrix, dict) else {}
            tp_val = self._report_int(cm.get("tp"), 0)
            fp_val = self._report_int(cm.get("fp"), 0)
            fn_val = self._report_int(cm.get("fn"), 0)
            if tp_val or fp_val or fn_val:
                chart_data["risk_score_by_label_chart"] = [
                    {"score_bucket": "Below Threshold", "tp_count": fn_val, "fp_count": 0},
                    {"score_bucket": "Above Threshold", "tp_count": tp_val, "fp_count": fp_val},
                ]

        feature_rows = feature_importance if isinstance(feature_importance, list) else []
        feature_rows = [row for row in feature_rows if isinstance(row, dict) and row.get("feature")]
        if feature_rows:
            chart_data["feature_correlation_chart"] = [
                {
                    "feature": str(row.get("feature") or ""),
                    "importance": round(self._report_float(row.get("importance"), 0.0), 6),
                }
                for row in feature_rows[:8]
            ]

        return chart_data or None

    def _normalize_threshold_rows(
        self,
        rows: Any,
        *,
        hml_summary: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        hml_summary = hml_summary if isinstance(hml_summary, dict) else {}
        high_count = self._report_int(((hml_summary.get("high") or {}).get("count")), 0)
        med_count = self._report_int(((hml_summary.get("medium") or {}).get("count")), 0)
        low_count = self._report_int(((hml_summary.get("low") or {}).get("count")), 0)

        for item in rows or []:
            if not isinstance(item, dict):
                continue
            threshold = self._report_float(item.get("threshold"), -1)
            if threshold < 0:
                continue
            suppression_pct = item.get("suppression_pct")
            if suppression_pct is None:
                suppression_pct = item.get("suppression_rate_pct", item.get("suppression_rate", 0))
            suppression_pct = self._report_float(suppression_pct, 0.0)
            if suppression_pct <= 1.0:
                suppression_pct *= 100.0

            event_loss_pct = self._report_float(item.get("event_loss_pct", item.get("event_loss", 0.0)), 0.0)
            if event_loss_pct <= 1.0 and event_loss_pct > 0:
                event_loss_pct *= 100.0

            precision = self._report_float(item.get("precision"), 0.0)
            recall = self._report_float(item.get("recall"), 0.0)
            if precision > 1.0:
                precision = precision / 100.0
            if recall > 1.0:
                recall = recall / 100.0

            out.append(
                {
                    "threshold": round(float(threshold), 4),
                    "event_loss_pct": round(float(event_loss_pct), 2),
                    "suppression_pct": round(float(suppression_pct), 2),
                    "precision": round(float(precision), 4),
                    "recall": round(float(recall), 4),
                    "tn": self._report_int(item.get("tn"), 0),
                    "fp": self._report_int(item.get("fp"), 0),
                    "fn": self._report_int(item.get("fn"), 0),
                    "tp": self._report_int(item.get("tp"), 0),
                    "hml_high_count": self._report_int(item.get("hml_high_count"), high_count),
                    "hml_medium_count": self._report_int(item.get("hml_medium_count"), med_count),
                    "hml_low_count": self._report_int(item.get("hml_low_count"), low_count),
                    "recommended": bool(item.get("recommended") or item.get("is_optimal")),
                }
            )
        return out

    def _threshold_rows_have_metrics(self, rows: Any) -> bool:
        for item in rows or []:
            if not isinstance(item, dict):
                continue
            for key in (
                "suppression_pct",
                "suppression_rate_pct",
                "event_loss_pct",
                "event_loss",
                "precision",
                "recall",
                "tp",
                "fn",
            ):
                if self._report_has_value(item.get(key)):
                    return True
        return False

    def _select_recommended_threshold(
        self,
        rows: List[Dict[str, Any]],
        *,
        selected_threshold: float,
        max_event_loss_pct: float,
    ) -> Dict[str, Any]:
        if not rows:
            return {
                "threshold": round(float(selected_threshold), 4),
                "event_loss_pct": 0.0,
                "suppression_pct": 0.0,
                "precision": 0.0,
                "recall": 0.0,
                "tn": 0,
                "fp": 0,
                "fn": 0,
                "tp": 0,
                "recommended": True,
            }

        explicit = [r for r in rows if bool(r.get("recommended"))]
        if explicit:
            best = explicit[0]
            best["recommended"] = True
            best["selection_reason"] = "Using the threshold already flagged as recommended in the saved run."
            return best

        near_selected = min(
            rows,
            key=lambda r: abs(float(r.get("threshold", 0.0)) - float(selected_threshold)),
        )
        valid = [r for r in rows if self._report_float(r.get("event_loss_pct"), 0.0) <= float(max_event_loss_pct)]
        if valid:
            best_valid = max(
                valid,
                key=lambda r: (
                    self._report_float(r.get("suppression_pct"), 0.0),
                    -self._report_float(r.get("event_loss_pct"), 0.0),
                    self._report_float(r.get("recall"), 0.0),
                    self._report_float(r.get("precision"), 0.0),
                ),
            )
            best_valid["recommended"] = True
            best_valid["selection_reason"] = (
                "Selected as the threshold that gives the highest suppression while staying within the allowed event-loss limit."
            )
            if abs(float(best_valid.get("threshold", 0.0)) - float(selected_threshold)) <= 0.0005:
                best_valid["selection_reason"] = (
                    "The configured threshold already gave the best suppression available within the allowed event-loss limit."
                )
            return best_valid

        near_selected["recommended"] = True
        near_selected["selection_reason"] = (
            "No tested threshold stayed within the allowed event-loss limit, so the configured threshold was retained for reporting."
        )
        return near_selected

    def _build_narratives(self, report: Dict[str, Any]) -> Dict[str, str]:
        ds = report.get("data_summary") or {}
        mp = report.get("model_performance") or {}
        ta = report.get("threshold_analysis") or {}
        bi = report.get("business_impact") or {}
        td = report.get("target_definition") or {}

        total_alerts = self._report_int(bi.get("total_alerts"), 0)
        labelled_rows = self._report_int(ds.get("labelled_rows"), 0)
        excluded_rows = self._report_int(ds.get("excluded_rows"), 0)
        str_rate_overall = self._report_float(ds.get("str_rate_overall"), 0.0) * 100.0
        auc = self._report_float(mp.get("test_auc_roc"), 0.0)
        cv_mean = self._report_float(mp.get("cv_auc_mean"), 0.0)
        cv_std = self._report_float(mp.get("cv_auc_std"), 0.0)
        precision = self._report_float(mp.get("precision"), 0.0)
        recall = self._report_float(mp.get("recall"), 0.0)
        rec_threshold = self._report_float(ta.get("recommended_threshold"), 0.5)
        rec_supp = self._report_float(ta.get("recommended_suppression_pct"), 0.0)
        rec_event_loss = self._report_float(ta.get("recommended_event_loss_pct"), 0.0)
        reg_limit = self._report_float(ta.get("regulatory_limit_pct"), 5.0)

        cm = mp.get("confusion_matrix") or {}
        tn = self._report_int(cm.get("tn"), 0)
        fp = self._report_int(cm.get("fp"), 0)
        fn = self._report_int(cm.get("fn"), 0)
        tp = self._report_int(cm.get("tp"), 0)
        cm_total = max(tn + fp + fn + tp, 1)

        false_alarm_share = ((tn + fp) / cm_total) * 100.0
        escalated_share = ((tp + fp) / cm_total) * 100.0

        return {
            "problem": (
                f"The rule engine generated {total_alerts:,} alerts. From {labelled_rows:,} labelled investigations, "
                f"only {str_rate_overall:.1f}% became SAR-filed outcomes; the rest were operational noise."
            ),
            "data": (
                f"{labelled_rows:,} rows had confirmed outcomes and {excluded_rows:,} rows were excluded "
                "because outcomes were still open or never escalated."
            ),
            "target": (
                "Labels were derived from investigator case outcomes (CASE_STATUS): "
                "CLOSED_SAR_FILED=1, CLOSED_FALSE_POSITIVE/CLOSED_MONITORING=0, OPEN=no label."
                + (" Proxy target warning is active." if td.get("proxy_warning") else "")
            ),
            "model": (
                f"{mp.get('algorithm') or 'Model'} achieved AUC {auc:.2f} "
                f"(CV {cv_mean:.2f} ± {cv_std:.3f}). Precision {precision:.0%}, recall {recall:.1%}."
            ),
            "threshold": (
                f"Recommended threshold {rec_threshold:.2f} suppresses {rec_supp:.1f}% of workload "
                f"at {rec_event_loss:.2f}% Event Loss, within the {reg_limit:.1f}% limit."
            ),
            "impact": (
                f"{self._report_int(bi.get('alerts_suppressed'), 0):,} alerts move out of manual review, "
                f"{self._report_int(bi.get('alerts_escalated'), 0):,} remain in the investigation queue, and "
                f"{self._report_int(bi.get('sars_missed'), 0):,} suspicious cases remain the miss-risk to govern."
            ),
            "governance": (
                f"Split strategy: {ds.get('split_type') or 'random'}. Event Loss constraint enforced at <= {reg_limit:.1f}%."
            ),
            "confusion_matrix_business": (
                f"At the operating threshold, {tp:,} true SAR candidates were correctly escalated and {tn:,} low-risk alerts were correctly suppressed. "
                f"{fp:,} alerts were false escalations (extra analyst workload), while {fn:,} were missed SAR candidates "
                f"(Event Loss). In business terms: {escalated_share:.1f}% of cases still reach analysts and "
                f"{false_alarm_share:.1f}% of evaluated cases were false alarms."
            ),
            "thresholds_business": (
                "Threshold controls workload vs risk capture. Lower thresholds send more alerts to analysts "
                "(lower Event Loss, lower suppression). Higher thresholds suppress more volume but increase miss risk. "
                f"The selected operating point ({rec_threshold:.2f}) is the highest suppression observed while staying within the Event Loss ceiling."
            ),
        }

    def generate_run_report(
        self,
        tenant_id: str,
        env_id: str,
        run_id: str,
        pipeline_id: Optional[str] = None,
        analyst_hourly_cost: float = 85.0,
        cost_currency: str = "GBP",
    ) -> Dict:
        run = self._load_run_for_report(
            tenant_id=str(tenant_id),
            env_id=str(env_id),
            run_id=str(run_id),
        )
        if not run:
            raise ValueError(f"Run '{run_id}' not found in this environment")

        pipeline_id_int: Optional[int] = None
        try:
            pipeline_id_int = int(pipeline_id) if pipeline_id is not None else None
        except Exception:
            pipeline_id_int = None

        dataset_ids: List[int] = []
        if run.get("dataset_id"):
            dataset_ids.append(int(run["dataset_id"]))

        pipeline_meta: Dict[str, Any] = {}
        if pipeline_id_int is not None:
            try:
                pipeline_meta = self.load_pipeline(str(tenant_id), str(env_id), int(pipeline_id_int)) or {}
            except Exception:
                pipeline_meta = {}
            for dsid in pipeline_meta.get("dataset_ids") or []:
                try:
                    dataset_ids.append(int(dsid))
                except Exception:
                    continue
            for key in ("dataset_id", "output_dataset_id"):
                if pipeline_meta.get(key):
                    try:
                        dataset_ids.append(int(pipeline_meta.get(key)))
                    except Exception:
                        pass

        dataset_ids = sorted({int(x) for x in dataset_ids if int(x) > 0})
        dataset_rows: List[Dict[str, Any]] = []
        if dataset_ids:
            with get_connection(self.db_path) as conn:
                placeholders = ",".join(["?"] * len(dataset_ids))
                rows = conn.execute(
                    f"""
                    SELECT dataset_id, dataset_type, filename, row_count, columns_json
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND dataset_id IN ({placeholders})
                    """,
                    [str(tenant_id), str(env_id), *dataset_ids],
                ).fetchall()
            for d_id, d_type, filename, row_count, cols_json in rows:
                cols = self._report_json_load(cols_json, [])
                col_count = len(cols) if isinstance(cols, list) else 0
                d_type_l = str(d_type or "").lower()
                if d_type_l in {"alerts", "alert"}:
                    role = "Primary training dataset"
                elif d_type_l in {"cases", "case"}:
                    role = "Case outcomes / labels"
                elif d_type_l.startswith("master"):
                    role = "Master joined dataset"
                elif d_type_l.startswith("preprocess"):
                    role = "Preprocessed training dataset"
                else:
                    role = "Supporting dataset"
                dataset_rows.append(
                    {
                        "dataset_id": self._report_int(d_id, 0),
                        "filename": str(filename or f"{d_type or 'dataset'}.csv"),
                        "dataset_type": str(d_type or ""),
                        "row_count": self._report_int(row_count, 0),
                        "column_count": int(col_count),
                        "role": role,
                    }
                )

        pipeline_steps = pipeline_meta.get("steps") if isinstance(pipeline_meta, dict) else []
        pipeline_joins = pipeline_meta.get("joins") if isinstance(pipeline_meta, dict) else []
        pipeline_transforms = pipeline_meta.get("transforms") if isinstance(pipeline_meta, dict) else []
        pipeline_steps = pipeline_steps if isinstance(pipeline_steps, list) else []
        pipeline_joins = pipeline_joins if isinstance(pipeline_joins, list) else []
        pipeline_transforms = pipeline_transforms if isinstance(pipeline_transforms, list) else []

        def _transform_summary(step: Dict[str, Any]) -> str:
            stype = str(step.get("type") or "").lower()
            if stype == "imputation":
                return f"Fill missing values using {step.get('strategy') or 'configured'} logic."
            if stype.startswith("encoding_"):
                return "Convert business categories into model-usable numeric inputs."
            if stype.startswith("scaling_") or stype == "normalize_l2":
                return "Bring numeric columns onto a consistent scale."
            if stype.startswith("feature_") or stype in {"datetime_extract", "text_features"}:
                return "Create derived variables so the model can pick up behavioural patterns."
            if stype in {"drop_columns", "mapping_id", "tag_mapping_id", "keep_mapping"}:
                return "Control which columns are retained for modelling and traceability."
            return "Apply the configured preprocessing rule."

        preprocess_steps: List[Dict[str, Any]] = []
        preprocess_category_counts: Dict[str, Dict[str, Any]] = {}
        for idx, raw_step in enumerate(pipeline_transforms, start=1):
            step = raw_step if isinstance(raw_step, dict) else {}
            meta = self._preprocess_step_meta(step.get("type") or "")
            requested_columns = step.get("columns") if isinstance(step.get("columns"), list) else []
            category = str(meta.get("category") or "clean")
            category_bucket = preprocess_category_counts.setdefault(
                category,
                {
                    "category": category,
                    "label": meta.get("label") if category == "select" and category not in preprocess_category_counts else category.title(),
                    "steps": 0,
                    "applied_steps": 0,
                    "added_columns": 0,
                    "dropped_columns": 0,
                },
            )
            category_bucket["label"] = {
                "clean": "Cleaning",
                "encode": "Encoding",
                "scale": "Scaling",
                "feat": "Feature Engineering",
                "select": "Selection & Mapping",
            }.get(category, category.title())
            category_bucket["steps"] += 1
            category_bucket["applied_steps"] += 1

            preprocess_steps.append(
                {
                    "step_no": idx,
                    "type": str(step.get("type") or ""),
                    "label": str(meta.get("label") or "Step"),
                    "category": category,
                    "requested_columns": requested_columns[:12],
                    "requested_column_count": int(len(requested_columns)),
                    "summary": _transform_summary(step),
                }
            )

        pipeline_summary = {
            "pipeline_id": int(pipeline_id_int) if pipeline_id_int is not None else None,
            "name": pipeline_meta.get("name") if isinstance(pipeline_meta, dict) else None,
            "version": self._report_int((pipeline_meta or {}).get("version"), 0) if isinstance(pipeline_meta, dict) else None,
            "grain": str((pipeline_meta or {}).get("grain") or run.get("grain") or "alert") if isinstance(pipeline_meta, dict) else str(run.get("grain") or "alert"),
            "status": (pipeline_meta or {}).get("status") if isinstance(pipeline_meta, dict) else None,
            "output_name": (pipeline_meta or {}).get("output_name") if isinstance(pipeline_meta, dict) else None,
            "created_by_persona": (pipeline_meta or {}).get("created_by_persona") if isinstance(pipeline_meta, dict) else None,
            "created_at": (pipeline_meta or {}).get("created_at") if isinstance(pipeline_meta, dict) else None,
            "updated_at": (pipeline_meta or {}).get("updated_at") if isinstance(pipeline_meta, dict) else None,
            "last_run_at": (pipeline_meta or {}).get("last_run_at") if isinstance(pipeline_meta, dict) else None,
            "dataset_count": int(len(dataset_ids)),
            "join_count": int(len(pipeline_joins)),
            "step_count": int(len(pipeline_steps)),
        }

        preprocessing_summary = {
            "transform_count": int(len(preprocess_steps)),
            "categories": list(preprocess_category_counts.values()),
            "steps": preprocess_steps,
            "summary": {
                "input_rows": None,
                "output_rows": None,
                "input_columns": None,
                "output_columns": None,
                "applied_steps": int(len(preprocess_steps)),
            },
        }

        target_meta = self._load_target_summary_for_dataset(
            tenant_id=str(tenant_id),
            env_id=str(env_id),
            dataset_id=self._report_int(run.get("dataset_id"), 0),
        )
        target_cfg = target_meta.get("config") if isinstance(target_meta, dict) else {}
        target_summary = target_meta.get("summary") if isinstance(target_meta, dict) else {}
        target_cfg = target_cfg if isinstance(target_cfg, dict) else {}
        target_summary = target_summary if isinstance(target_summary, dict) else {}

        fd = run.get("feature_diagnostics") if isinstance(run.get("feature_diagnostics"), dict) else {}
        n_total = self._report_int(
            target_summary.get("n_total", fd.get("target_rows_input")),
            0,
        )
        n_labelled = self._report_int(
            target_summary.get("n_labelled", fd.get("target_rows_used")),
            0,
        )
        n_excluded = self._report_int(
            target_summary.get("n_excluded", fd.get("target_rows_excluded")),
            max(n_total - n_labelled, 0),
        )

        n_positive = self._report_int(target_summary.get("n_positive"), 0)
        n_negative = self._report_int(target_summary.get("n_negative"), 0)
        if (n_positive + n_negative) == 0 and isinstance(target_summary.get("counts"), dict):
            counts = target_summary.get("counts") or {}
            n_positive = self._report_int(counts.get("1", counts.get("True", counts.get("true"))), 0)
            n_negative = self._report_int(counts.get("0", counts.get("False", counts.get("false"))), 0)

        if n_total == 0:
            n_total = max(
                self._report_int(sum(d.get("row_count", 0) for d in dataset_rows), 0),
                n_labelled + n_excluded,
            )
        if n_labelled == 0:
            n_labelled = max(self._report_int(run.get("train_rows"), 0) + self._report_int(run.get("test_rows"), 0), 0)

        label_strategy = str(
            target_meta.get("strategy")
            or target_cfg.get("strategy")
            or ("case_status_sar_filed" if str(run.get("target_column", "")).strip().upper() == "IS_TRUE_POS" else "existing_column")
        )
        source_column = str(
            target_cfg.get("source_column")
            or ("CASE_STATUS" if "case_status" in label_strategy else run.get("target_column") or "IS_TRUE_POS")
        )
        proxy_warning = (
            "This is a RISK_SCORE proxy target - validate with compliance before production use."
            if "risk_score" in label_strategy
            else None
        )

        eda_raw = self._load_eda_summary_for_dataset(dataset_id=self._report_int(run.get("dataset_id"), 0))
        eda_raw = self._build_report_eda_snapshot(
            tenant_id=str(tenant_id),
            env_id=str(env_id),
            dataset_id=self._report_int(run.get("dataset_id"), 0),
            target_col=str(run.get("target_column") or ""),
            existing_raw=eda_raw if isinstance(eda_raw, dict) else None,
        )
        eda_chart_data = None
        if isinstance(eda_raw, dict):
            if isinstance(eda_raw.get("chart_data"), dict):
                eda_chart_data = eda_raw.get("chart_data")
            else:
                chart_keys = [
                    "class_distribution_chart",
                    "risk_score_by_label_chart",
                    "missing_values_chart",
                    "sar_rate_by_rule_chart",
                    "feature_correlation_chart",
                    "column_role_chart",
                    "correlation_pairs_chart",
                    "row_completeness_chart",
                ]
                if any(k in eda_raw for k in chart_keys):
                    eda_chart_data = {k: eda_raw.get(k) for k in chart_keys if k in eda_raw}

        metrics = run.get("metrics") if isinstance(run.get("metrics"), dict) else {}
        test_truth = run.get("test_truth") if isinstance(run.get("test_truth"), list) else []
        test_prob = run.get("test_prob") if isinstance(run.get("test_prob"), list) else []
        selected_threshold = self._report_float(run.get("selected_threshold"), 0.5)
        computed_validation = self._build_report_validation_metrics(
            test_truth,
            test_prob,
            selected_threshold=selected_threshold,
        )
        raw_cm = self._report_pick_value(
            metrics.get("confusion_matrix"),
            computed_validation.get("confusion_matrix"),
            default={},
        )
        cm = self._normalize_confusion_matrix(raw_cm)
        if sum(cm.values()) == 0 and isinstance(computed_validation.get("confusion_matrix"), dict):
            computed_cm = self._normalize_confusion_matrix(computed_validation.get("confusion_matrix"))
            if sum(computed_cm.values()) > 0:
                cm = computed_cm

        threshold_source_rows = run.get("threshold_table") if isinstance(run.get("threshold_table"), list) else []
        if (
            (not threshold_source_rows or not self._threshold_rows_have_metrics(threshold_source_rows))
            and isinstance(computed_validation.get("threshold_table"), list)
        ):
            threshold_source_rows = computed_validation.get("threshold_table") or []
        threshold_rows = self._normalize_threshold_rows(
            threshold_source_rows,
            hml_summary=run.get("hml_summary") if isinstance(run.get("hml_summary"), dict) else {},
        )
        max_event_loss_limit = self._report_float(
            metrics.get("max_event_loss_pct_constraint", 5.0),
            5.0,
        )
        recommended_row = self._select_recommended_threshold(
            threshold_rows,
            selected_threshold=selected_threshold,
            max_event_loss_pct=max_event_loss_limit,
        )

        hml_summary = run.get("hml_summary") if isinstance(run.get("hml_summary"), dict) else {}
        hml_tiers = {
            "low": {
                "threshold_below": round(float(recommended_row.get("threshold", selected_threshold)), 4),
                "pct_of_alerts": round(self._report_float(((hml_summary.get("low") or {}).get("pct")), 0.0), 2),
                "count": self._report_int(((hml_summary.get("low") or {}).get("count")), self._report_int(recommended_row.get("hml_low_count"), 0)),
                "action": "AUTO_SUPPRESS",
            },
            "medium": {
                "threshold_range": f"{round(float(recommended_row.get('threshold', selected_threshold)), 2)}-{round(self._report_float(((hml_summary.get('high') or {}).get('min_score')), 0.7), 2)}",
                "pct_of_alerts": round(self._report_float(((hml_summary.get("medium") or {}).get("pct")), 0.0), 2),
                "count": self._report_int(((hml_summary.get("medium") or {}).get("count")), self._report_int(recommended_row.get("hml_medium_count"), 0)),
                "action": "STANDARD_REVIEW",
            },
            "high": {
                "threshold_above": round(self._report_float(((hml_summary.get("high") or {}).get("min_score")), 0.7), 4),
                "pct_of_alerts": round(self._report_float(((hml_summary.get("high") or {}).get("pct")), 0.0), 2),
                "count": self._report_int(((hml_summary.get("high") or {}).get("count")), self._report_int(recommended_row.get("hml_high_count"), 0)),
                "action": "ESCALATE_IMMEDIATELY",
            },
        }

        train_rows = self._report_int(run.get("train_rows"), 0)
        test_rows = self._report_int(run.get("test_rows"), 0)
        split_type = str(run.get("split_strategy") or "random").lower()
        split_date = run.get("split_date")

        feature_importance_raw = []
        if isinstance(run.get("result"), dict):
            feature_importance_raw = run["result"].get("feature_importance") or []
        if not feature_importance_raw:
            feature_importance_raw = metrics.get("feature_importance") or []
        if not isinstance(feature_importance_raw, list):
            feature_importance_raw = []

        def _feature_category(name: str) -> str:
            lname = str(name or "").lower()
            if any(k in lname for k in ["risk", "rule", "sar", "str", "sanction"]):
                return "Rule Signal"
            if any(k in lname for k in ["velocity", "cash", "dest", "kyc", "country", "txn"]):
                return "Behaviour"
            return "Derived"

        feature_importance = []
        for item in feature_importance_raw[:20]:
            if isinstance(item, dict):
                fname = str(item.get("feature") or item.get("name") or "")
                importance = self._report_float(item.get("importance"), 0.0)
            elif isinstance(item, (list, tuple)) and len(item) >= 2:
                fname = str(item[0])
                importance = self._report_float(item[1], 0.0)
            else:
                continue
            if not fname:
                continue
            feature_importance.append(
                {
                    "feature": fname,
                    "importance": round(float(importance), 6),
                    "category": _feature_category(fname),
                }
            )

        preprocessing_summary["summary"].update(
            {
                "input_rows": int(max(n_total, 0)),
                "output_rows": int(max(n_labelled, 0)),
                "input_columns": int(self._report_int(fd.get("raw_feature_columns"), 0)),
                "output_columns": int(self._report_int(fd.get("encoded_feature_count"), 0)),
            }
        )

        feature_selection = {
            "raw_feature_columns": self._report_int(fd.get("raw_feature_columns"), 0),
            "encoded_feature_count": self._report_int(fd.get("encoded_feature_count"), 0),
            "feature_multiplier": round(self._report_float(fd.get("feature_multiplier"), 0.0), 3),
            "numeric_columns": self._report_int(fd.get("numeric_columns"), 0),
            "categorical_columns": self._report_int(fd.get("categorical_columns"), 0),
            "onehot_columns_count": self._report_int(fd.get("onehot_columns_count"), 0),
            "frequency_encoded_count": self._report_int(fd.get("frequency_encoded_count"), 0),
            "categorical_levels_total": self._report_int(fd.get("categorical_levels_total"), 0),
            "dropped_leakage_count": self._report_int(fd.get("dropped_leakage_count"), 0),
            "dropped_leakage_columns": fd.get("dropped_leakage_columns") or [],
            "dropped_id_count": self._report_int(fd.get("dropped_id_count"), 0),
            "dropped_id_columns": fd.get("dropped_id_columns") or [],
            "dropped_constant_count": self._report_int(fd.get("dropped_constant_count"), 0),
            "dropped_constant_columns": fd.get("dropped_constant_columns") or [],
            "datetime_expanded_count": self._report_int(fd.get("datetime_expanded_count"), 0),
            "datetime_expanded_columns": fd.get("datetime_expanded_columns") or [],
            "top_categorical_expansions": fd.get("top_categorical_expansions") or [],
        }

        run_result = run.get("result") if isinstance(run.get("result"), dict) else {}
        training_process = {
            "grain": str(run.get("grain") or run_result.get("grain") or "alert"),
            "id_column": str(run.get("id_column") or run_result.get("id_column") or ""),
            "cv_folds": self._report_int(run_result.get("cv_folds"), 0),
            "split_summary": run_result.get("split_summary") if isinstance(run_result.get("split_summary"), dict) else {},
            "class_weight": run_result.get("class_weight"),
            "calibration": run_result.get("calibration"),
            "timeline": run_result.get("timeline") if isinstance(run_result.get("timeline"), list) else [],
            "artifact_path": run.get("artifact_path"),
            "trained_at": run_result.get("trained_at") or run.get("finished_at"),
            "hml_high_threshold": round(self._report_float(run.get("hml_high_threshold"), 0.65), 4),
            "hml_low_threshold": round(self._report_float(run.get("hml_low_threshold"), 0.35), 4),
        }

        if not isinstance(eda_chart_data, dict) or not eda_chart_data:
            eda_chart_data = self._build_report_eda_chart_fallback(
                n_positive=n_positive,
                n_negative=n_negative,
                hml_summary=hml_summary,
                confusion_matrix=cm,
                feature_importance=feature_importance,
            )

        metric_roc_auc = self._report_pick_value(
            metrics.get("roc_auc"),
            metrics.get("test_auc_roc"),
            computed_validation.get("roc_auc"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_pr_auc = self._report_pick_value(
            metrics.get("pr_auc"),
            metrics.get("test_auc_pr"),
            metrics.get("avg_precision"),
            computed_validation.get("pr_auc"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_cv_auc_mean = self._report_pick_value(
            metrics.get("cv_auc_mean"),
            metrics.get("cv_auc"),
            computed_validation.get("roc_auc"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_cv_auc_std = self._report_pick_value(
            metrics.get("cv_auc_std"),
            default=0.0,
        )
        metric_precision = self._report_pick_value(
            metrics.get("precision"),
            computed_validation.get("precision"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_recall = self._report_pick_value(
            metrics.get("recall"),
            computed_validation.get("recall"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_f1 = self._report_pick_value(
            metrics.get("f1"),
            computed_validation.get("f1"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_accuracy = self._report_pick_value(
            metrics.get("accuracy"),
            computed_validation.get("accuracy"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_specificity = self._report_pick_value(
            metrics.get("specificity"),
            computed_validation.get("specificity"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_balanced_accuracy = self._report_pick_value(
            metrics.get("balanced_accuracy"),
            computed_validation.get("balanced_accuracy"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_suppression_pct = self._report_pick_value(
            metrics.get("suppression_rate_pct"),
            computed_validation.get("suppression_rate_pct"),
            recommended_row.get("suppression_pct"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )
        metric_event_loss_pct = self._report_pick_value(
            metrics.get("event_loss_pct"),
            computed_validation.get("event_loss_pct"),
            recommended_row.get("event_loss_pct"),
            numeric=True,
            zero_means_missing=True,
            default=0.0,
        )

        midpoint_row = (
            min(
                threshold_rows,
                key=lambda r: abs(float(r.get("threshold", 0.0)) - 0.5),
            )
            if threshold_rows
            else {}
        )
        midpoint_threshold = self._report_float(midpoint_row.get("threshold"), 0.5)
        midpoint_suppression_pct = self._report_float(midpoint_row.get("suppression_pct"), 0.0)
        midpoint_event_loss_pct = self._report_float(midpoint_row.get("event_loss_pct"), 0.0)
        threshold_band_min = 0.50
        threshold_band_max = 0.60
        deployable_rows = [
            row for row in threshold_rows
            if threshold_band_min <= self._report_float(row.get("threshold"), -1.0) <= threshold_band_max
            and self._report_float(row.get("event_loss_pct"), 999.0) <= float(max_event_loss_limit)
        ]
        if not deployable_rows:
            deployable_rows = [
                row for row in threshold_rows
                if threshold_band_min <= self._report_float(row.get("threshold"), -1.0) <= threshold_band_max
            ]
        deployable_row = (
            max(
                deployable_rows,
                key=lambda r: (
                    self._report_float(r.get("suppression_pct"), 0.0),
                    -self._report_float(r.get("event_loss_pct"), 999.0),
                ),
            )
            if deployable_rows
            else (midpoint_row or recommended_row)
        )
        operating_threshold = self._report_float(deployable_row.get("threshold"), midpoint_threshold)
        operating_suppression_pct = self._report_float(
            self._report_pick_value(deployable_row.get("suppression_pct"), metric_suppression_pct, numeric=True, zero_means_missing=True, default=0.0),
            0.0,
        )
        operating_event_loss_pct = self._report_float(
            self._report_pick_value(deployable_row.get("event_loss_pct"), metric_event_loss_pct, numeric=True, zero_means_missing=True, default=0.0),
            0.0,
        )
        operating_precision = self._report_float(
            self._report_pick_value(deployable_row.get("precision"), metric_precision, numeric=True, zero_means_missing=True, default=0.0),
            0.0,
        )
        operating_recall = self._report_float(
            self._report_pick_value(deployable_row.get("recall"), metric_recall, numeric=True, zero_means_missing=True, default=0.0),
            0.0,
        )

        model_performance = {
            "algorithm": str(run.get("algorithm") or ""),
            "hyperparameters": (
                run.get("result", {}).get("hyperparams", {})
                if isinstance(run.get("result"), dict)
                else {}
            ),
            "test_auc_roc": round(self._report_float(metric_roc_auc, 0.0), 4),
            "test_auc_pr": round(self._report_float(metric_pr_auc, 0.0), 4),
            "cv_auc_mean": round(self._report_float(metric_cv_auc_mean, 0.0), 4),
            "cv_auc_std": round(self._report_float(metric_cv_auc_std, 0.0), 4),
            "precision": round(self._report_float(metric_precision, 0.0), 4),
            "recall": round(self._report_float(metric_recall, 0.0), 4),
            "f1": round(self._report_float(metric_f1, 0.0), 4),
            "accuracy": round(self._report_float(metric_accuracy, 0.0), 4),
            "specificity": round(self._report_float(metric_specificity, 0.0), 4),
            "balanced_accuracy": round(self._report_float(metric_balanced_accuracy, 0.0), 4),
            "suppression_rate_pct": round(self._report_float(metric_suppression_pct, 0.0), 2),
            "event_loss_pct": round(self._report_float(metric_event_loss_pct, 0.0), 2),
            "confusion_matrix": cm,
            "auc_interpretation": (
                f"AUC {round(self._report_float(metric_roc_auc, 0.0), 2):.2f} is an honest baseline trained on investigator outcomes. "
                "Synthetic-label leakage can inflate AUC dramatically; production performance should be judged on out-of-time data."
            ),
            "feature_importance": feature_importance,
            "roc_curve": metrics.get("roc_curve") if isinstance(metrics.get("roc_curve"), list) and metrics.get("roc_curve") else (computed_validation.get("roc_curve") or []),
            "pr_curve": metrics.get("pr_curve") if isinstance(metrics.get("pr_curve"), list) and metrics.get("pr_curve") else (computed_validation.get("pr_curve") or []),
        }
        model_performance["confusion_matrix_business_explainer"] = (
            f"TP={cm['tp']} alerts correctly escalated (real suspicious cases kept), "
            f"TN={cm['tn']} correctly suppressed (analyst effort saved), "
            f"FP={cm['fp']} unnecessary escalations (extra workload), "
            f"FN={cm['fn']} missed suspicious cases (Event Loss risk)."
        )

        threshold_analysis = {
            "regulatory_limit_pct": round(float(max_event_loss_limit), 2),
            "default_threshold": threshold_band_min,
            "threshold_band_min": threshold_band_min,
            "threshold_band_max": threshold_band_max,
            "configured_threshold": round(float(selected_threshold), 4),
            "recommended_threshold": round(float(operating_threshold), 4),
            "recommended_suppression_pct": round(float(operating_suppression_pct), 2),
            "recommended_event_loss_pct": round(float(operating_event_loss_pct), 2),
            "recommended_precision": round(float(operating_precision), 4),
            "recommended_recall": round(float(operating_recall), 4),
            "within_regulatory_limit": float(operating_event_loss_pct) <= float(max_event_loss_limit),
            "midpoint_threshold": round(float(midpoint_threshold), 4),
            "midpoint_suppression_pct": round(float(midpoint_suppression_pct), 2),
            "midpoint_event_loss_pct": round(float(midpoint_event_loss_pct), 2),
            "recommendation_reason": str(deployable_row.get("selection_reason") or ""),
            "threshold_table": threshold_rows,
            "hml_tiers": hml_tiers,
        }
        threshold_analysis["business_threshold_explainer"] = (
            f"FCC uses a business operating default of {threshold_analysis['default_threshold']:.2f} and only allows deployable thresholds between "
            f"{threshold_analysis['threshold_band_min']:.2f} and {threshold_analysis['threshold_band_max']:.2f}. "
            f"For this run, the saved configuration was {threshold_analysis['configured_threshold']:.2f}, and the report recommends "
            f"{threshold_analysis['recommended_threshold']:.2f} inside the approved band because it provides the strongest suppression while keeping Event Loss within "
            f"{threshold_analysis['regulatory_limit_pct']:.1f}%. "
            f"The default 0.50 operating point would give {threshold_analysis['midpoint_suppression_pct']:.2f}% suppression at "
            f"{threshold_analysis['midpoint_event_loss_pct']:.2f}% Event Loss."
            + (
                f" {threshold_analysis['recommendation_reason']}"
                if threshold_analysis.get("recommendation_reason")
                else ""
            )
        )

        recommended_suppression_pct = self._report_float(threshold_analysis["recommended_suppression_pct"], 0.0)
        total_alerts = n_total if n_total > 0 else max(train_rows + test_rows, self._report_int(sum(d.get("row_count", 0) for d in dataset_rows), 0))
        alerts_suppressed = int(round(total_alerts * (recommended_suppression_pct / 100.0)))
        alerts_escalated = int(max(total_alerts - alerts_suppressed, 0))
        sars_caught = self._report_int(deployable_row.get("tp"), cm.get("tp", 0))
        sars_missed = self._report_int(deployable_row.get("fn"), cm.get("fn", 0))
        total_pos_eval = max(sars_caught + sars_missed, 1)
        event_loss_pct = round(float((sars_missed / total_pos_eval) * 100.0), 2)

        analyst_hours_per_alert = 0.5
        analyst_hourly_cost_f = self._report_float(analyst_hourly_cost, 85.0)
        hours_recovered = round(float(alerts_suppressed) * analyst_hours_per_alert, 2)
        cost_saving = round(hours_recovered * analyst_hourly_cost_f, 2)
        fp_rate_baseline_pct = round((n_negative / max(n_labelled, 1)) * 100.0, 2) if n_labelled else None

        business_impact = {
            "total_alerts": int(total_alerts),
            "alerts_suppressed": int(alerts_suppressed),
            "alerts_escalated": int(alerts_escalated),
            "sars_caught": int(sars_caught),
            "sars_missed": int(sars_missed),
            "event_loss_pct": float(event_loss_pct),
            "regulatory_limit_pct": float(threshold_analysis["regulatory_limit_pct"]),
            "within_limit": bool(event_loss_pct <= threshold_analysis["regulatory_limit_pct"]),
            "hours_recovered": float(hours_recovered),
            "cost_saving_estimate": float(cost_saving),
            "analyst_hourly_cost": float(analyst_hourly_cost_f),
            "cost_currency": str(cost_currency or "GBP"),
            "fp_rate_baseline_pct": fp_rate_baseline_pct,
            "workload_reduction_pct": float(recommended_suppression_pct),
            "before_model": {
                "analyst_reviews_all": True,
                "false_positive_burden_pct": round((100.0 - (self._report_float(target_summary.get("str_rate_overall"), 0.0) * 100.0)), 2)
                if target_summary.get("str_rate_overall") is not None
                else 92,
                "description": f"Without the model, analysts review all {int(total_alerts):,} alerts.",
            },
            "after_model": {
                "suppressed_automatically": int(alerts_suppressed),
                "escalated_to_queue": int(alerts_escalated),
                "description": (
                    f"At threshold {threshold_analysis['recommended_threshold']:.2f}: "
                    f"{int(alerts_suppressed):,} alerts auto-closed, {int(alerts_escalated):,} sent for review."
                ),
            },
        }

        model_card_path = None
        with get_connection(self.db_path) as conn:
            dep = conn.execute(
                """
                SELECT model_card_path
                FROM mlops_deployments
                WHERE run_id = ? AND tenant_id = ? AND env_id = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [str(run["run_id"]), str(tenant_id), str(env_id)],
            ).fetchone()
            if dep:
                model_card_path = dep[0]

        governance = {
            "label_audit_trail": (
                "Labels derived from case outcomes. CLOSED_SAR_FILED=1; CLOSED_FALSE_POSITIVE/CLOSED_MONITORING=0; OPEN excluded."
                if "case_status" in label_strategy
                else f"Target strategy: {label_strategy}."
            ),
            "split_strategy": (
                f"Temporal split at {split_date}."
                if split_type == "temporal" and split_date
                else f"{split_type.title()} split."
            ),
            "encoder_fit": "Encoders/scalers are fit on training data only and then applied to hold-out data.",
            "event_loss_constraint": (
                f"Event Loss ceiling {threshold_analysis['regulatory_limit_pct']:.1f}%; "
                f"selected threshold yields {threshold_analysis['recommended_event_loss_pct']:.2f}%."
            ),
            "regulatory_frameworks": [
                "SR 11-7",
                "MAS TRM",
                "RBI Model Risk Guidelines",
                "FATF Guidance",
            ],
            "retraining_recommendation": (
                "Retrain monthly or sooner when score PSI > 0.20, SAR conversion shifts >2%, or typology rules materially change."
            ),
            "model_card_path": model_card_path,
            "proxy_label_warning": proxy_warning,
        }

        data_summary = {
            "datasets_used": dataset_rows,
            "total_rows_before_exclusion": int(max(n_total, 0)),
            "labelled_rows": int(max(n_labelled, 0)),
            "excluded_rows": int(max(n_excluded, 0)),
            "exclusion_reason": "OPEN cases and no-case alerts excluded - outcome unknown.",
            "label_source": source_column,
            "label_derivation": "CLOSED_SAR_FILED=1, CLOSED_FALSE_POSITIVE=0, CLOSED_MONITORING=0, OPEN=NaN",
            "label_strategy": label_strategy,
            "str_rate_overall": round((n_positive / max(n_total, 1)), 4) if n_total else 0.0,
            "str_rate_labelled": round((n_positive / max(n_labelled, 1)), 4) if n_labelled else 0.0,
            "n_positive": int(max(n_positive, 0)),
            "n_negative": int(max(n_negative, 0)),
            "split_type": split_type,
            "split_date": split_date,
            "train_rows": int(max(train_rows, 0)),
            "test_rows": int(max(test_rows, 0)),
        }

        positive_pct = round(data_summary["str_rate_labelled"] * 100.0, 2) if n_labelled else 0.0
        negative_pct = round(100.0 - positive_pct, 2) if n_labelled else 0.0
        imbalance_ratio = round((max(positive_pct, negative_pct) / max(min(positive_pct, negative_pct), 0.0001)), 3) if n_labelled else 0.0

        eda_summary = {
            "class_balance": {
                "positive_pct": positive_pct,
                "negative_pct": negative_pct,
                "is_imbalanced": bool(n_labelled and (positive_pct < 40.0 or positive_pct > 60.0)),
                "imbalance_ratio": imbalance_ratio,
            },
            "missing_values": {
                "columns_with_missing": [],
                "max_missing_pct": None,
                "overall_missing_pct": None,
            },
            "top_correlated_with_target": [],
            "risk_score_separation": {
                "tp_mean_risk_score": None,
                "fp_mean_risk_score": None,
                "separation_ratio": None,
                "interpretation": "EDA data unavailable for this run.",
            },
            "sar_rate_by_rule": [],
            "chart_data": eda_chart_data,
        }

        if isinstance(eda_raw, dict):
            eda_summary["missing_values"]["columns_with_missing"] = (
                eda_raw.get("columns_with_missing")
                or eda_raw.get("missing_columns")
                or []
            )
            eda_summary["missing_values"]["max_missing_pct"] = eda_raw.get("max_missing_pct")
            eda_summary["missing_values"]["overall_missing_pct"] = eda_raw.get("overall_missing_pct")
            eda_summary["top_correlated_with_target"] = eda_raw.get("top_correlated_with_target") or []
            if isinstance(eda_raw.get("risk_score_separation"), dict):
                eda_summary["risk_score_separation"] = eda_raw.get("risk_score_separation")
            eda_summary["sar_rate_by_rule"] = eda_raw.get("sar_rate_by_rule") or []

        target_definition = {
            "strategy": label_strategy,
            "source_column": source_column,
            "derived_column": str(run.get("target_column") or "IS_TRUE_POS"),
            "excluded_count": int(max(n_excluded, 0)),
            "business_explanation": (
                "Completed investigator outcomes are used as the target so the model learns from confirmed suspicious and confirmed non-suspicious cases, while unresolved cases stay out of training."
            ),
            "mapping": {
                "CLOSED_SAR_FILED": 1,
                "CLOSED_FALSE_POSITIVE": 0,
                "CLOSED_MONITORING": 0,
                "OPEN": "excluded",
                "no_case": "excluded",
            },
            "why_not_risk_score": (
                "RISK_SCORE is an input signal, not a ground-truth outcome. "
                "Using it as label causes circular learning of rule logic."
            ),
            "why_not_is_typology": (
                "IS_TYPOLOGY is a simulator injection flag, not investigator truth. "
                "Production labels must come from case outcomes."
            ),
            "business_explanation": (
                "Labels are sourced from analyst case disposition history. "
                "Closed SAR outcomes are positives; other closed outcomes are negatives; unresolved outcomes are excluded."
            ),
            "excluded_count": int(max(n_excluded, 0)),
            "excluded_breakdown": {
                "open_cases": int(max(n_excluded, 0)),
                "no_case_assigned": 0,
            },
            "proxy_warning": proxy_warning,
        }

        run_identity = {
            "run_id": str(run["run_id"]),
            "pipeline_id": int(pipeline_id_int) if pipeline_id_int is not None else None,
            "run_type": "pipeline" if pipeline_id_int is not None else "standalone",
            "run_name": str(run.get("run_name") or f"Run {str(run['run_id'])[:8]}"),
            "algorithm": str(run.get("algorithm") or ""),
            "dataset_id": int(run.get("dataset_id") or 0),
            "target_column": str(run.get("target_column") or ""),
            "created_at": run.get("created_at"),
            "finished_at": run.get("finished_at"),
            "status": "completed",
            "tenant_id": str(run.get("tenant_id") or tenant_id),
            "env_id": str(run.get("env_id") or env_id),
        }

        report = {
            "report_id": str(uuid.uuid4()),
            "run_id": str(run["run_id"]),
            "pipeline_id": int(pipeline_id_int) if pipeline_id_int is not None else None,
            "run_type": "pipeline" if pipeline_id_int is not None else "standalone",
            "generated_at": datetime.utcnow().isoformat(),
            "tenant_id": str(tenant_id),
            "env_id": str(env_id),
            "run_identity": run_identity,
            "data_summary": data_summary,
            "eda_summary": eda_summary,
            "target_definition": target_definition,
            "model_performance": model_performance,
            "threshold_analysis": threshold_analysis,
            "business_impact": business_impact,
            "governance": governance,
            "pipeline_summary": pipeline_summary,
            "preprocessing_summary": preprocessing_summary,
            "feature_selection": feature_selection,
            "training_process": training_process,
        }
        report["narratives"] = self._build_narratives(report)

        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO mlops_run_reports
                (report_id, run_id, pipeline_id, tenant_id, env_id, report_json, generated_at, run_type)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                """,
                [
                    str(report["report_id"]),
                    str(report["run_id"]),
                    str(report["pipeline_id"]) if report["pipeline_id"] is not None else None,
                    str(tenant_id),
                    str(env_id),
                    json.dumps(report, default=str),
                    str(report["run_type"]),
                ],
            )
            if pipeline_id_int is not None:
                self._upsert_pipeline_asset_link(
                    conn,
                    str(tenant_id),
                    str(env_id),
                    int(pipeline_id_int),
                    "run_report",
                    report.get("report_id"),
                    stage="reports",
                    relation="generated_report",
                    metadata={
                        "run_id": str(report.get("run_id") or ""),
                        "run_type": str(report.get("run_type") or "pipeline"),
                    },
                )

        return report

    def get_run_report(self, tenant_id: str, env_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT report_id, report_json, generated_at
                FROM mlops_run_reports
                WHERE run_id = ? AND tenant_id = ? AND env_id = ?
                ORDER BY generated_at DESC
                LIMIT 1
                """,
                [str(run_id), str(tenant_id), str(env_id)],
            ).fetchone()
            if not row:
                row = conn.execute(
                    """
                    SELECT report_id, report_json, generated_at
                    FROM mlops_run_reports
                    WHERE run_id = ?
                    ORDER BY generated_at DESC
                    LIMIT 1
                    """,
                    [str(run_id)],
                ).fetchone()
        if not row:
            return None
        payload = self._report_json_load(row[1], {})
        if not isinstance(payload, dict):
            payload = {}
        payload.setdefault("report_id", row[0])
        payload.setdefault("generated_at", self._report_iso(row[2]))
        return payload

    def list_run_reports(
        self,
        tenant_id: str,
        env_id: str,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        cap = int(max(limit, 1))
        generated_by_run: Dict[str, Dict[str, Any]] = {}

        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT report_id, run_id, pipeline_id, run_type, generated_at, report_json
                FROM mlops_run_reports
                WHERE tenant_id = ? AND env_id = ?
                ORDER BY generated_at DESC
                """,
                [str(tenant_id), str(env_id)],
            ).fetchall()

        for report_id, run_id, pipeline_id, run_type, generated_at, report_json in rows:
            run_id_s = str(run_id or "").strip()
            if not run_id_s or run_id_s in generated_by_run:
                continue
            payload = self._report_json_load(report_json, {})
            run_identity = payload.get("run_identity") if isinstance(payload, dict) else {}
            model_perf = payload.get("model_performance") if isinstance(payload, dict) else {}
            threshold = payload.get("threshold_analysis") if isinstance(payload, dict) else {}
            generated_by_run[run_id_s] = {
                "report_id": str(report_id),
                "run_id": run_id_s,
                "pipeline_id": self._report_int(pipeline_id, 0) if pipeline_id is not None else None,
                "run_type": str(run_type or "standalone"),
                "generated_at": self._report_iso(generated_at),
                "trained_at": (run_identity or {}).get("finished_at") or (run_identity or {}).get("created_at"),
                "run_name": (run_identity or {}).get("run_name"),
                "algorithm": (run_identity or {}).get("algorithm") or (model_perf or {}).get("algorithm"),
                "auc": self._report_float((model_perf or {}).get("test_auc_roc"), 0.0),
                "suppression_pct": self._report_float((threshold or {}).get("recommended_suppression_pct"), 0.0),
                "event_loss_pct": self._report_float((threshold or {}).get("recommended_event_loss_pct"), 0.0),
                "report_status": "generated",
                "has_report": True,
                "_sort_ts": self._report_iso(generated_at) or "",
            }

        out_by_run: Dict[str, Dict[str, Any]] = dict(generated_by_run)

        def _add_training_candidates(db_file: Any) -> None:
            try:
                with get_connection(db_file) as conn:
                    rows_local = conn.execute(
                        """
                        SELECT job_id, run_id, tenant_id, env_id, dataset_id, target_column,
                               algorithm, metrics_json, result_json, test_truth_json, test_prob_json,
                               selected_threshold, artifact_path, trained_at, updated_at, grain,
                               hml_high_threshold, hml_low_threshold, feature_diagnostics_json
                        FROM model_training_runs
                        WHERE tenant_id = ? AND env_id = ?
                        ORDER BY COALESCE(updated_at, trained_at) DESC
                        LIMIT ?
                        """,
                        [str(tenant_id), str(env_id), int(max(cap * 3, 50))],
                    ).fetchall()
            except Exception:
                return

            cols = [
                "job_id", "run_id", "tenant_id", "env_id", "dataset_id", "target_column",
                "algorithm", "metrics_json", "result_json", "test_truth_json", "test_prob_json",
                "selected_threshold", "artifact_path", "trained_at", "updated_at", "grain",
                "hml_high_threshold", "hml_low_threshold", "feature_diagnostics_json",
            ]
            for values in rows_local:
                row = dict(zip(cols, values))
                mapped = self._report_map_training_row(
                    row,
                    run_id=str(row.get("job_id") or row.get("run_id") or ""),
                    tenant_id=str(tenant_id),
                    env_id=str(env_id),
                )
                run_id_s = str(mapped.get("run_id") or "").strip()
                if not run_id_s:
                    continue
                if run_id_s in out_by_run:
                    out_by_run[run_id_s].setdefault("trained_at", mapped.get("finished_at") or mapped.get("created_at"))
                    continue
                metrics = mapped.get("metrics") if isinstance(mapped.get("metrics"), dict) else {}
                threshold_rows = mapped.get("threshold_table") if isinstance(mapped.get("threshold_table"), list) else []
                recommended_row = self._select_recommended_threshold(
                    self._normalize_threshold_rows(
                        threshold_rows,
                        hml_summary=mapped.get("hml_summary") if isinstance(mapped.get("hml_summary"), dict) else {},
                    ),
                    selected_threshold=self._report_float(mapped.get("selected_threshold"), 0.5),
                    max_event_loss_pct=self._report_float(metrics.get("max_event_loss_pct_constraint", 5.0), 5.0),
                )
                sort_ts = mapped.get("finished_at") or mapped.get("created_at") or ""
                out_by_run[run_id_s] = {
                    "report_id": None,
                    "run_id": run_id_s,
                    "pipeline_id": None,
                    "run_type": "standalone",
                    "generated_at": None,
                    "trained_at": mapped.get("finished_at") or mapped.get("created_at"),
                    "run_name": mapped.get("run_name"),
                    "algorithm": mapped.get("algorithm"),
                    "auc": self._report_float(metrics.get("roc_auc", metrics.get("test_auc_roc")), 0.0),
                    "suppression_pct": self._report_float(recommended_row.get("suppression_pct"), 0.0),
                    "event_loss_pct": self._report_float(recommended_row.get("event_loss_pct"), 0.0),
                    "report_status": "available",
                    "has_report": False,
                    "_sort_ts": sort_ts,
                }

        _add_training_candidates(self.db_path)

        sidecar_training_db = Path(self.db_path).with_name("model_training.duckdb")
        if sidecar_training_db.exists():
            _add_training_candidates(str(sidecar_training_db))

        try:
            with get_connection(self.db_path) as conn:
                legacy_rows = conn.execute(
                    """
                    SELECT run_id, algorithm, metrics_json, selected_threshold, created_at, updated_at
                    FROM mlops_model_runs
                    WHERE tenant_id = ? AND env_id = ?
                    ORDER BY updated_at DESC
                    LIMIT ?
                    """,
                    [str(tenant_id), str(env_id), int(max(cap * 3, 50))],
                ).fetchall()
        except Exception:
            legacy_rows = []

        for run_id, algorithm, metrics_json, _selected_threshold, created_at, updated_at in legacy_rows:
            run_id_s = str(run_id or "").strip()
            if not run_id_s or run_id_s in out_by_run:
                continue
            metrics = self._report_json_load(metrics_json, {})
            sort_ts = self._report_iso(updated_at) or self._report_iso(created_at) or ""
            out_by_run[run_id_s] = {
                "report_id": None,
                "run_id": run_id_s,
                "pipeline_id": None,
                "run_type": "standalone",
                "generated_at": None,
                "trained_at": self._report_iso(updated_at) or self._report_iso(created_at),
                "run_name": f"{str(algorithm or 'model').replace('_', ' ').title()} {run_id_s[:8]}",
                "algorithm": str(algorithm or ""),
                "auc": self._report_float((metrics or {}).get("roc_auc"), 0.0),
                "suppression_pct": 0.0,
                "event_loss_pct": 0.0,
                "report_status": "available",
                "has_report": False,
                "_sort_ts": sort_ts,
            }

        ordered = sorted(
            out_by_run.values(),
            key=lambda row: str(row.get("_sort_ts") or row.get("generated_at") or row.get("trained_at") or ""),
            reverse=True,
        )
        return [{k: v for k, v in row.items() if k != "_sort_ts"} for row in ordered[:cap]]

    def compare_run_reports(
        self,
        tenant_id: str,
        env_id: str,
        run_id_a: str,
        run_id_b: str,
    ) -> Dict[str, Any]:
        a = self.get_run_report(tenant_id, env_id, run_id_a)
        if not a:
            a = self.generate_run_report(tenant_id, env_id, run_id_a)
        b = self.get_run_report(tenant_id, env_id, run_id_b)
        if not b:
            b = self.generate_run_report(tenant_id, env_id, run_id_b)
        if not a or not b:
            raise ValueError("Both reports must exist to compare runs")

        def _get(report: Dict[str, Any], path: List[str], default: float = 0.0) -> float:
            cur: Any = report
            for key in path:
                if not isinstance(cur, dict):
                    return default
                cur = cur.get(key)
            return self._report_float(cur, default)

        metrics = {
            "auc": (
                _get(a, ["model_performance", "test_auc_roc"]),
                _get(b, ["model_performance", "test_auc_roc"]),
            ),
            "suppression_pct": (
                _get(a, ["threshold_analysis", "recommended_suppression_pct"]),
                _get(b, ["threshold_analysis", "recommended_suppression_pct"]),
            ),
            "event_loss_pct": (
                _get(a, ["threshold_analysis", "recommended_event_loss_pct"]),
                _get(b, ["threshold_analysis", "recommended_event_loss_pct"]),
            ),
            "labelled_rows": (
                _get(a, ["data_summary", "labelled_rows"]),
                _get(b, ["data_summary", "labelled_rows"]),
            ),
            "threshold": (
                _get(a, ["threshold_analysis", "recommended_threshold"]),
                _get(b, ["threshold_analysis", "recommended_threshold"]),
            ),
        }

        deltas = {
            key: {
                "run_a": round(vals[0], 4),
                "run_b": round(vals[1], 4),
                "delta": round(vals[1] - vals[0], 4),
            }
            for key, vals in metrics.items()
        }

        return {
            "run_a": {
                "run_id": str(run_id_a),
                "run_name": ((a.get("run_identity") or {}).get("run_name")),
                "algorithm": ((a.get("run_identity") or {}).get("algorithm")),
            },
            "run_b": {
                "run_id": str(run_id_b),
                "run_name": ((b.get("run_identity") or {}).get("run_name")),
                "algorithm": ((b.get("run_identity") or {}).get("algorithm")),
            },
            "deltas": deltas,
        }
