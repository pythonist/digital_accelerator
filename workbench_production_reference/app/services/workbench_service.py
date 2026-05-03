from __future__ import annotations

import uuid
from collections import Counter
from typing import Any

from flask import session

from ..extensions import cache, db
from ..models import FeatureCatalog, TaskRecord, WorkbenchState

TAB_DEFS = [
    ("overview", "Overview"),
    ("transform", "Transform"),
    ("feature_builder", "Feature Builder"),
    ("feature_selection", "Feature Selection"),
    ("pipeline_run", "Pipeline Run"),
    ("summary", "Summary"),
]

WORKBENCH_META = {
    "fcc": {
        "title": "FCC Workbench",
        "headline": "Prune, govern, and transform selected FCC features for training.",
        "badges": ["FCC pipeline active", "Feature governance on", "Case triage enabled"],
    },
    "mule": {
        "title": "Mule Workbench",
        "headline": "Prune, govern, and transform selected Mule features for training.",
        "badges": ["Mule pipeline active", "Feature governance on", "Ring analysis enabled"],
    },
}

SELECTION_METHODS = [
    {"name": "Variance Threshold", "description": "Removes near-constant features that add little signal."},
    {"name": "Correlation Filter", "description": "Flags overlapping variables so we do not ship redundant inputs."},
    {"name": "Business Rule Retention", "description": "Keeps mandatory governance features such as IDs and audit-safe controls."},
    {"name": "Model Surrogate Score", "description": "Uses cached model-aligned ranking to prioritize strong candidates."},
]


def ensure_session_id() -> str:
    current = session.get("workbench_session_id")
    if current:
        return current
    current = str(uuid.uuid4())
    session["workbench_session_id"] = current
    session.permanent = True
    return current


def default_transform_config(workbench_key: str) -> dict[str, Any]:
    return {
        "missing_strategy": "median",
        "categorical_encoding": "frequency",
        "numeric_scaling": "robust",
        "keep_identifiers": True,
        "workbench_key": workbench_key,
    }


def get_or_create_state(workbench_key: str, session_id: str) -> WorkbenchState:
    state = WorkbenchState.query.filter_by(workbench_key=workbench_key, session_id=session_id).first()
    if state:
        return state
    state = WorkbenchState(
        workbench_key=workbench_key,
        session_id=session_id,
        selected_tab="overview",
        feature_decisions={},
        transform_config=default_transform_config(workbench_key),
        ui_state={"last_message": "State restored from Postgres and Redis-backed session storage."},
    )
    db.session.add(state)
    db.session.commit()
    return state


@cache.memoize(timeout=120)
def get_feature_catalog_payload(workbench_key: str) -> list[dict[str, Any]]:
    rows = (
        FeatureCatalog.query.filter_by(workbench_key=workbench_key)
        .order_by(FeatureCatalog.family.asc(), FeatureCatalog.feature_name.asc())
        .all()
    )
    return [
        {
            "feature_name": row.feature_name,
            "family": row.family,
            "source_tag": row.source_tag,
            "correlation_score": row.correlation_score,
            "model_score": row.model_score,
            "default_decision": row.default_decision,
            "notes": row.notes or "",
        }
        for row in rows
    ]


def save_tab(workbench_key: str, session_id: str, tab: str) -> WorkbenchState:
    state = get_or_create_state(workbench_key, session_id)
    state.selected_tab = tab
    state.ui_state = {**(state.ui_state or {}), "last_message": f"Active tab persisted as {tab}."}
    db.session.commit()
    session[f"{workbench_key}_selected_tab"] = tab
    return state


def set_feature_decision(workbench_key: str, session_id: str, feature_name: str, decision: str) -> WorkbenchState:
    state = get_or_create_state(workbench_key, session_id)
    decisions = dict(state.feature_decisions or {})
    decisions[feature_name] = decision
    state.feature_decisions = decisions
    state.ui_state = {
        **(state.ui_state or {}),
        "last_message": f"Saved {feature_name} as {decision}.",
    }
    db.session.commit()
    return state


def update_transform(workbench_key: str, session_id: str, form_data: dict[str, Any]) -> WorkbenchState:
    state = get_or_create_state(workbench_key, session_id)
    config = dict(state.transform_config or {})
    config.update(
        {
            "missing_strategy": form_data.get("missing_strategy", config.get("missing_strategy", "median")),
            "categorical_encoding": form_data.get("categorical_encoding", config.get("categorical_encoding", "frequency")),
            "numeric_scaling": form_data.get("numeric_scaling", config.get("numeric_scaling", "robust")),
            "keep_identifiers": form_data.get("keep_identifiers", "true") == "true",
        }
    )
    state.transform_config = config
    state.ui_state = {
        **(state.ui_state or {}),
        "last_message": "Transform settings saved to PostgreSQL.",
    }
    db.session.commit()
    return state


def build_selection_rows(workbench_key: str, session_id: str) -> list[dict[str, Any]]:
    state = get_or_create_state(workbench_key, session_id)
    decisions = state.feature_decisions or {}
    rows = []
    for feature in get_feature_catalog_payload(workbench_key):
        decision = decisions.get(feature["feature_name"], feature["default_decision"])
        rows.append(
            {
                **feature,
                "decision": decision,
                "feature_store_tag": feature["source_tag"] == "feature_store",
            }
        )
    return rows


def build_workbench_context(workbench_key: str, session_id: str) -> dict[str, Any]:
    state = get_or_create_state(workbench_key, session_id)
    rows = build_selection_rows(workbench_key, session_id)
    selected_count = sum(1 for row in rows if row["decision"] == "selected")
    dropped_count = sum(1 for row in rows if row["decision"] == "dropped")
    family_counts = Counter(row["family"] for row in rows if row["decision"] == "selected")
    task = TaskRecord.query.filter_by(task_id=state.latest_task_id).first() if state.latest_task_id else None
    meta = WORKBENCH_META[workbench_key]
    return {
        "workbench_key": workbench_key,
        "meta": meta,
        "tabs": [{"id": key, "label": label} for key, label in TAB_DEFS],
        "active_tab": session.get(f"{workbench_key}_selected_tab", state.selected_tab or "overview"),
        "state": state,
        "selection_methods": SELECTION_METHODS,
        "selection_rows": rows,
        "selected_count": selected_count,
        "dropped_count": dropped_count,
        "family_counts": dict(family_counts),
        "latest_task": task,
        "summary_cards": [
            {"label": "Input dataset", "value": f"{workbench_key}_feature_store"},
            {"label": "Rows", "value": "10,000"},
            {"label": "Columns", "value": str(len(rows))},
            {"label": "Selected", "value": str(selected_count)},
        ],
    }
