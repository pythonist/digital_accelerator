from __future__ import annotations

import copy
import hashlib
import json
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from api.tools.mlops.duckdb_manager import get_connection


RUN_STATE_STATUSES = {"not_started", "running", "completed", "stale", "failed"}


STEP_ALIASES = {
    "data": "data_upload",
    "data_upload": "data_upload",
    "upload": "data_upload",
    "load_data": "data_upload",
    "master": "master_dataset",
    "master_dataset": "master_dataset",
    "target": "target_definition",
    "target_definition": "target_definition",
    "eda": "explore_data",
    "explore": "explore_data",
    "explore_data": "explore_data",
    "preprocess": "preprocessing",
    "preprocessing": "preprocessing",
    "featurestore": "feature_store",
    "feature_store": "feature_store",
    "mule_featurestore": "feature_store",
    "model": "model_training",
    "train": "model_training",
    "model_training": "model_training",
    "training": "model_training",
    "validation": "validation",
    "model_validation": "validation",
    "registry": "model_release",
    "release": "model_release",
    "model_release": "model_release",
    "ready": "model_release",
    "dashboard": "deployment_monitoring",
    "deployment": "deployment_monitoring",
    "deployment_monitoring": "deployment_monitoring",
    "reports": "reports",
    "report": "reports",
}


STEP_TO_UI_STAGE = {
    "data_upload": "data",
    "master_dataset": "master",
    "target_definition": "target",
    "explore_data": "eda",
    "preprocessing": "preprocess",
    "feature_store": "featurestore",
    "model_training": "model",
    "validation": "validation",
    "model_release": "registry",
    "deployment_monitoring": "dashboard",
    "reports": "reports",
}


DEFAULT_STEP_ORDER = (
    "data_upload",
    "master_dataset",
    "target_definition",
    "explore_data",
    "feature_store",
    "preprocessing",
    "model_training",
    "validation",
    "model_release",
    "deployment_monitoring",
    "reports",
)


DEPENDENCY_GRAPH = {
    "data_upload": ("master_dataset", "target_definition", "explore_data", "feature_store", "preprocessing", "model_training", "validation", "model_release", "deployment_monitoring", "reports"),
    "master_dataset": ("target_definition", "explore_data", "feature_store", "preprocessing", "model_training", "validation", "model_release", "deployment_monitoring", "reports"),
    "target_definition": ("explore_data", "preprocessing", "model_training", "validation", "model_release", "deployment_monitoring", "reports"),
    "explore_data": ("preprocessing", "model_training", "validation", "model_release", "deployment_monitoring", "reports"),
    "feature_store": ("preprocessing", "model_training", "validation", "model_release", "deployment_monitoring", "reports"),
    "preprocessing": ("model_training", "validation", "model_release", "deployment_monitoring", "reports"),
    "model_training": ("validation", "model_release", "deployment_monitoring", "reports"),
    "validation": ("model_release", "deployment_monitoring", "reports"),
    "model_release": ("deployment_monitoring", "reports"),
    "deployment_monitoring": ("reports",),
}


STEP_LABELS = {
    "data_upload": "Data Upload",
    "master_dataset": "Master Dataset",
    "target_definition": "Target Definition",
    "explore_data": "Explore Data",
    "feature_store": "Feature Store",
    "preprocessing": "Preprocessing",
    "model_training": "Model Training",
    "validation": "Validation",
    "model_release": "Model Release",
    "deployment_monitoring": "Deployment Monitoring",
    "reports": "Reports",
}


INPUT_KEYS = {
    "filters",
    "filter",
    "where",
    "selected_columns",
    "columns",
    "features",
    "approved_features",
    "hyperparameters",
    "hyperparams",
    "params",
    "thresholds",
    "threshold",
    "selected_threshold",
    "locked_threshold",
    "algorithm",
    "algorithm_id",
    "model_kind",
    "training_mode",
    "split_strategy",
    "test_size",
    "random_state",
    "cv_folds",
    "target_column",
    "strategy",
    "config",
    "steps",
    "transforms",
    "joins",
    "dataset_id",
    "dataset_ids",
    "masterDatasetId",
    "preprocessedDatasetId",
    "activeTab",
    "currentStepId",
}


OUTPUT_KEYS = {
    "dataset_id",
    "dataset_ids",
    "dataset_ref",
    "data_snapshot_ref",
    "snapshot_id",
    "sample_preview_id",
    "preview_id",
    "builtMasterDatasetId",
    "preprocessedDatasetId",
    "outputDatasetId",
    "output_dataset_id",
    "featureStoreDatasetId",
    "job_id",
    "run_id",
    "model_id",
    "model_path",
    "artifact_path",
    "artifact_ref",
    "metrics",
    "validation_metrics",
    "confusion_matrix",
    "feature_importance",
    "active_model_run",
    "validation_report",
    "report",
    "report_id",
    "registry_entry",
    "entry",
    "deployment_id",
    "status",
    "completed",
    "row_count",
    "column_count",
}


OMIT_DATA_KEYS = {
    "dataframe",
    "df",
    "full_data",
    "raw_data",
    "rawRows",
    "raw_rows",
    "tableData",
    "table_data",
}


SAMPLE_LIST_KEYS = {
    "rows",
    "preview",
    "sample",
    "sample_rows",
    "raw_preview",
    "preprocessed_preview",
    "sample_outputs",
}


_CACHE_LOCK = threading.RLock()
_RUN_STATE_CACHE: Dict[str, Dict[str, Any]] = {}


def _utc_now() -> str:
    return datetime.utcnow().isoformat()


def _safe_json_loads(raw: Any, fallback: Any) -> Any:
    if raw in (None, ""):
        return fallback
    try:
        return json.loads(raw)
    except Exception:
        return fallback


def _jsonable(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)


def _stable_json(value: Any) -> str:
    return json.dumps(_sort_jsonable(_jsonable(value)), sort_keys=True, separators=(",", ":"))


def _sort_jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _sort_jsonable(value[key]) for key in sorted(value.keys(), key=str)}
    if isinstance(value, list):
        return [_sort_jsonable(item) for item in value]
    return value


def _signature(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def canonical_step_name(step_name: Any) -> str:
    raw = str(step_name or "").strip().lower().replace("-", "_").replace(" ", "_")
    if raw.startswith("mule_"):
        raw = raw.replace("mule_", "", 1)
    return STEP_ALIASES.get(raw, raw or "unknown_step")


def _cache_key(db_path: Path, tenant_id: str, env_id: str, run_id: str) -> str:
    return "::".join([str(Path(db_path).resolve()), str(tenant_id), str(env_id), str(run_id)])


def _make_run_id(pipeline_type: str = "fcc") -> str:
    prefix = "MULE" if str(pipeline_type or "").strip().lower() == "mule" else "FCC"
    return f"{prefix}-RUN-{uuid.uuid4().hex[:12]}"


def _deepcopy(value: Any) -> Any:
    try:
        return copy.deepcopy(value)
    except Exception:
        return _jsonable(value)


def _compact_value(value: Any, key: str = "") -> Any:
    key_text = str(key or "")
    if key_text in OMIT_DATA_KEYS:
        return {"omitted": True, "reason": "RUN_STATE stores dataset references and sample snapshots, not full data."}
    if isinstance(value, dict):
        return {
            str(k): _compact_value(v, str(k))
            for k, v in value.items()
            if str(k) not in OMIT_DATA_KEYS
        }
    if isinstance(value, (list, tuple)):
        items = list(value)
        if key_text in SAMPLE_LIST_KEYS or len(items) > 100:
            sample = [_compact_value(item, key_text) for item in items[:100]]
            return {
                "sample_rows": sample,
                "sample_size": len(sample),
                "total_rows": len(items),
                "truncated": len(items) > len(sample),
            }
        return [_compact_value(item, key_text) for item in items]
    return _jsonable(value)


def _subset_payload(state: Dict[str, Any], keys: Iterable[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key in keys:
        if key in state:
            out[key] = _compact_value(state.get(key), key)
    return out


def _nested_payload(state: Dict[str, Any], key: str) -> Dict[str, Any]:
    nested = state.get(key)
    return _compact_value(nested, key) if isinstance(nested, dict) else {}


def extract_step_inputs(step_name: str, state: Dict[str, Any]) -> Dict[str, Any]:
    state = state if isinstance(state, dict) else {}
    inputs = _subset_payload(state, INPUT_KEYS)
    step = canonical_step_name(step_name)
    if step == "model_training":
        inputs.setdefault("algorithm", state.get("algorithm") or state.get("algorithm_id") or state.get("model_kind"))
        inputs.setdefault("params", state.get("params") or state.get("hyperparams") or state.get("hyperparameters") or {})
    if step == "validation":
        inputs.setdefault("threshold", state.get("selected_threshold") or state.get("locked_threshold") or state.get("threshold"))
        inputs.setdefault("model_run_id", state.get("job_id") or state.get("run_id"))
    if step == "preprocessing":
        inputs.setdefault("steps", _compact_value(state.get("steps") or state.get("transforms") or [], "steps"))
    return {k: v for k, v in inputs.items() if v not in (None, "", [], {})}


def extract_step_outputs(step_name: str, state: Dict[str, Any]) -> Dict[str, Any]:
    state = state if isinstance(state, dict) else {}
    outputs = _subset_payload(state, OUTPUT_KEYS)
    outputs.update({f"active_model_run_{k}": v for k, v in _nested_payload(state, "active_model_run").items() if k in OUTPUT_KEYS})
    outputs.update({f"report_{k}": v for k, v in _nested_payload(state, "report").items() if k in OUTPUT_KEYS})
    outputs.update({f"entry_{k}": v for k, v in _nested_payload(state, "entry").items() if k in OUTPUT_KEYS})
    return {k: v for k, v in outputs.items() if v not in (None, "", [], {})}


def _infer_step_status(step_name: str, state: Dict[str, Any], explicit_status: Optional[str] = None) -> str:
    explicit = str(explicit_status or state.get("status") or "").strip().lower()
    if explicit in RUN_STATE_STATUSES:
        return explicit
    if explicit in {"complete", "done", "success", "saved"}:
        return "completed"
    if explicit in {"in_progress", "pending", "started"}:
        return "running"
    if bool(state.get("completed") or state.get("done")):
        return "completed"

    step = canonical_step_name(step_name)
    if step == "data_upload" and (state.get("dataset_ids") or state.get("total_rows") or state.get("total_tables")):
        return "completed"
    if step == "master_dataset" and (state.get("builtMasterDatasetId") or state.get("outputDatasetId")):
        return "completed"
    if step == "target_definition" and (state.get("currentTargetColumn") or state.get("selectedTargetColumn") or state.get("target_column")):
        return "completed"
    if step == "explore_data" and (state.get("eda_completed") or state.get("completed")):
        return "completed"
    if step == "feature_store" and (state.get("featureStoreDatasetId") or state.get("outputDatasetId") or state.get("dataset_id")):
        return "completed"
    if step == "preprocessing" and (state.get("preprocessedDatasetId") or state.get("outputDatasetId")):
        return "completed"
    if step == "model_training" and (state.get("job_id") or state.get("run_id") or state.get("active_model_run")):
        return "completed"
    if step == "validation" and (state.get("report_id") or state.get("validation_id") or state.get("selected_threshold") is not None):
        return "completed"
    if step == "model_release" and (state.get("deployment_id") or state.get("entry") or state.get("registry_entry")):
        return "completed"
    if step == "deployment_monitoring" and (state.get("deployment_id") or state.get("run_id") or state.get("publish_id")):
        return "completed"
    return "running" if state else "not_started"


def _flatten_common_fields(record: Dict[str, Any]) -> Dict[str, Any]:
    inputs = record.get("inputs") if isinstance(record.get("inputs"), dict) else {}
    outputs = record.get("outputs") if isinstance(record.get("outputs"), dict) else {}
    merged = dict(record)
    for key in (
        "filters",
        "selected_columns",
        "columns",
        "algorithm",
        "params",
        "hyperparameters",
        "threshold",
        "thresholds",
        "target_column",
    ):
        if key in inputs:
            merged[key] = inputs[key]
    for key in (
        "dataset_id",
        "dataset_ref",
        "data_snapshot_ref",
        "sample_preview_id",
        "model_id",
        "model_path",
        "artifact_path",
        "job_id",
        "run_id",
        "metrics",
        "validation_metrics",
        "confusion_matrix",
        "feature_importance",
        "report_id",
        "deployment_id",
    ):
        if key in outputs:
            merged[key] = outputs[key]
    return merged


def _walk_dependents(step_name: str) -> List[str]:
    seen: set[str] = set()
    ordered: List[str] = []

    def visit(node: str) -> None:
        for child in DEPENDENCY_GRAPH.get(node, ()):
            if child in seen:
                continue
            seen.add(child)
            ordered.append(child)
            visit(child)

    visit(canonical_step_name(step_name))
    return ordered


class RunStateService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.ensure_schema()

    def ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_run_state (
                  run_id TEXT PRIMARY KEY,
                  tenant_id TEXT,
                  env_id TEXT,
                  pipeline_id BIGINT,
                  pipeline_uuid TEXT,
                  pipeline_name TEXT,
                  pipeline_type TEXT DEFAULT 'fcc',
                  status TEXT DEFAULT 'running',
                  current_step TEXT,
                  steps_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  completed_at TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mlops_run_state_events (
                  event_id TEXT PRIMARY KEY,
                  run_id TEXT,
                  tenant_id TEXT,
                  env_id TEXT,
                  pipeline_id BIGINT,
                  step_name TEXT,
                  event_type TEXT,
                  status TEXT,
                  input_signature TEXT,
                  output_signature TEXT,
                  payload_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _set_cache(self, run_state: Dict[str, Any]) -> None:
        key = _cache_key(self.db_path, run_state.get("tenant_id"), run_state.get("env_id"), run_state.get("run_id"))
        with _CACHE_LOCK:
            _RUN_STATE_CACHE[key] = _deepcopy(run_state)

    def _get_cache(self, tenant_id: str, env_id: str, run_id: str) -> Optional[Dict[str, Any]]:
        key = _cache_key(self.db_path, tenant_id, env_id, run_id)
        with _CACHE_LOCK:
            cached = _RUN_STATE_CACHE.get(key)
            return _deepcopy(cached) if cached else None

    def _invalidate_cache(self, tenant_id: str, env_id: str, run_id: str) -> None:
        key = _cache_key(self.db_path, tenant_id, env_id, run_id)
        with _CACHE_LOCK:
            _RUN_STATE_CACHE.pop(key, None)

    def _row_to_state(self, row: Tuple[Any, ...]) -> Dict[str, Any]:
        steps = _safe_json_loads(row[9], {})
        if not isinstance(steps, dict):
            steps = {}
        state = {
            "run_id": str(row[0]),
            "tenant_id": str(row[1]),
            "env_id": str(row[2]),
            "pipeline_id": int(row[3]) if row[3] is not None else None,
            "pipeline_uuid": str(row[4] or "") or None,
            "pipeline_name": str(row[5] or ""),
            "pipeline_type": str(row[6] or "fcc"),
            "status": str(row[7] or "running"),
            "current_step": canonical_step_name(row[8] or self._derive_current_step(steps)),
            "steps_json": steps,
            "steps": steps,
            "created_at": row[10].isoformat() if hasattr(row[10], "isoformat") else row[10],
            "updated_at": row[11].isoformat() if hasattr(row[11], "isoformat") else row[11],
            "completed_at": row[12].isoformat() if hasattr(row[12], "isoformat") else row[12],
        }
        state["ui_step_statuses"] = self.to_ui_step_statuses(state)
        return state

    def _derive_current_step(self, steps: Dict[str, Any]) -> str:
        for step_name in DEFAULT_STEP_ORDER:
            status = str((steps.get(step_name) or {}).get("status") or "not_started").lower()
            if status in {"stale", "failed", "running", "not_started"}:
                return step_name
        return "reports" if steps else "data_upload"

    def create_run_state(
        self,
        tenant_id: str,
        env_id: str,
        *,
        pipeline_id: Optional[int] = None,
        pipeline_uuid: Optional[str] = None,
        pipeline_name: str = "",
        pipeline_type: str = "fcc",
        run_id: Optional[str] = None,
        status: str = "running",
        current_step: str = "data_upload",
        steps: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        run_id_text = str(run_id or "").strip() or _make_run_id(pipeline_type)
        now = _utc_now()
        step_payload = steps if isinstance(steps, dict) else {}
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO mlops_run_state (
                  run_id, tenant_id, env_id, pipeline_id, pipeline_uuid, pipeline_name,
                  pipeline_type, status, current_step, steps_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (run_id) DO UPDATE SET
                  pipeline_id = excluded.pipeline_id,
                  pipeline_uuid = excluded.pipeline_uuid,
                  pipeline_name = excluded.pipeline_name,
                  pipeline_type = excluded.pipeline_type,
                  status = excluded.status,
                  current_step = excluded.current_step,
                  steps_json = excluded.steps_json,
                  updated_at = ?
                """,
                [
                    run_id_text,
                    tenant_id,
                    env_id,
                    int(pipeline_id) if pipeline_id is not None else None,
                    pipeline_uuid,
                    pipeline_name,
                    str(pipeline_type or "fcc").strip().lower() or "fcc",
                    status if status in {"running", "completed", "failed", "stale"} else "running",
                    canonical_step_name(current_step),
                    json.dumps(step_payload, default=str),
                    now,
                    now,
                    now,
                ],
            )
        self._invalidate_cache(tenant_id, env_id, run_id_text)
        run_state = self.get_run_state(tenant_id, env_id, run_id_text)
        run_state.setdefault("created_at", now)
        return run_state

    def get_run_state(self, tenant_id: str, env_id: str, run_id: str, *, use_cache: bool = True) -> Dict[str, Any]:
        run_id_text = str(run_id or "").strip()
        if not run_id_text:
            raise ValueError("run_id is required")
        if use_cache:
            cached = self._get_cache(tenant_id, env_id, run_id_text)
            if cached:
                return cached
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id, tenant_id, env_id, pipeline_id, pipeline_uuid, pipeline_name,
                       pipeline_type, status, current_step, steps_json, created_at, updated_at, completed_at
                FROM mlops_run_state
                WHERE run_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [run_id_text, tenant_id, env_id],
            ).fetchone()
        if not row:
            raise ValueError(f"RUN_STATE {run_id_text} not found")
        run_state = self._row_to_state(row)
        self._set_cache(run_state)
        return run_state

    def get_active_run_state(
        self,
        tenant_id: str,
        env_id: str,
        *,
        pipeline_id: int,
        pipeline_uuid: Optional[str] = None,
        pipeline_name: str = "",
        pipeline_type: str = "fcc",
        create_if_missing: bool = True,
    ) -> Optional[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id, tenant_id, env_id, pipeline_id, pipeline_uuid, pipeline_name,
                       pipeline_type, status, current_step, steps_json, created_at, updated_at, completed_at
                FROM mlops_run_state
                WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ?
                ORDER BY updated_at DESC, created_at DESC
                LIMIT 1
                """,
                [tenant_id, env_id, int(pipeline_id)],
            ).fetchone()
        if row:
            run_state = self._row_to_state(row)
            self._set_cache(run_state)
            return run_state
        if not create_if_missing:
            return None
        return self.create_run_state(
            tenant_id,
            env_id,
            pipeline_id=int(pipeline_id),
            pipeline_uuid=pipeline_uuid,
            pipeline_name=pipeline_name,
            pipeline_type=pipeline_type,
        )

    def sync_screen_state(
        self,
        tenant_id: str,
        env_id: str,
        *,
        pipeline_id: int,
        pipeline_uuid: Optional[str],
        pipeline_name: str,
        pipeline_type: str,
        screen: str,
        state: Dict[str, Any],
    ) -> Dict[str, Any]:
        run_state = self.get_active_run_state(
            tenant_id,
            env_id,
            pipeline_id=int(pipeline_id),
            pipeline_uuid=pipeline_uuid,
            pipeline_name=pipeline_name,
            pipeline_type=pipeline_type,
            create_if_missing=True,
        )
        if not run_state:
            raise ValueError("Unable to create RUN_STATE")
        status = _infer_step_status(screen, state)
        return self.update_step_state(
            tenant_id,
            env_id,
            run_state["run_id"],
            screen,
            inputs=extract_step_inputs(screen, state),
            outputs=extract_step_outputs(screen, state),
            status=status,
            pipeline_id=int(pipeline_id),
            pipeline_uuid=pipeline_uuid,
            pipeline_name=pipeline_name,
            pipeline_type=pipeline_type,
            raw_state=state,
        )

    def execute_step(
        self,
        tenant_id: str,
        env_id: str,
        run_id: str,
        step_name: str,
        *,
        inputs: Optional[Dict[str, Any]] = None,
        outputs: Optional[Dict[str, Any]] = None,
        status: str = "completed",
        force: bool = False,
        pipeline_id: Optional[int] = None,
        pipeline_uuid: Optional[str] = None,
        pipeline_name: str = "",
        pipeline_type: str = "fcc",
    ) -> Dict[str, Any]:
        run_state = self.get_run_state(tenant_id, env_id, run_id)
        step = canonical_step_name(step_name)
        steps = run_state.get("steps_json") if isinstance(run_state.get("steps_json"), dict) else {}
        prev = steps.get(step) if isinstance(steps.get(step), dict) else {}
        next_inputs = _compact_value(inputs or {}, "inputs")
        input_signature = _signature(next_inputs)
        prev_status = str(prev.get("status") or "").lower()
        if (
            not force
            and prev_status == "completed"
            and str(prev.get("input_signature") or "") == input_signature
        ):
            return {
                "skipped": True,
                "reason": "completed_with_unchanged_inputs",
                "run_state": run_state,
                "step": prev,
            }
        next_status = status if status in RUN_STATE_STATUSES else "completed"
        updated = self.update_step_state(
            tenant_id,
            env_id,
            run_id,
            step,
            inputs=next_inputs,
            outputs=outputs or {},
            status=next_status,
            pipeline_id=pipeline_id or run_state.get("pipeline_id"),
            pipeline_uuid=pipeline_uuid or run_state.get("pipeline_uuid"),
            pipeline_name=pipeline_name or run_state.get("pipeline_name") or "",
            pipeline_type=pipeline_type or run_state.get("pipeline_type") or "fcc",
        )
        return {
            "skipped": False,
            "reason": "executed",
            "run_state": updated,
            "step": updated.get("steps_json", {}).get(step),
        }

    def update_step_state(
        self,
        tenant_id: str,
        env_id: str,
        run_id: str,
        step_name: str,
        *,
        inputs: Optional[Dict[str, Any]] = None,
        outputs: Optional[Dict[str, Any]] = None,
        status: str = "completed",
        pipeline_id: Optional[int] = None,
        pipeline_uuid: Optional[str] = None,
        pipeline_name: str = "",
        pipeline_type: str = "fcc",
        raw_state: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        run_state = self.get_run_state(tenant_id, env_id, run_id)
        step = canonical_step_name(step_name)
        steps = _deepcopy(run_state.get("steps_json") if isinstance(run_state.get("steps_json"), dict) else {})
        prev = steps.get(step) if isinstance(steps.get(step), dict) else {}
        next_inputs = _compact_value(inputs or {}, "inputs")
        next_outputs = _compact_value(outputs or {}, "outputs")
        input_signature = _signature(next_inputs)
        output_signature = _signature(next_outputs)
        prior_input_signature = str(prev.get("input_signature") or "")
        now = _utc_now()
        next_status = status if status in RUN_STATE_STATUSES else _infer_step_status(step, raw_state or {}, status)
        version = int(prev.get("version") or 0) + (0 if prior_input_signature == input_signature and prev else 1)

        record = {
            **prev,
            "step": step,
            "label": STEP_LABELS.get(step, step.replace("_", " ").title()),
            "status": next_status,
            "inputs": next_inputs,
            "outputs": next_outputs,
            "input_signature": input_signature,
            "output_signature": output_signature,
            "version": max(version, 1),
            "updated_at": now,
        }
        if next_status == "completed":
            record["completed_at"] = record.get("completed_at") or now
            record.pop("stale_reason", None)
            record.pop("stale_from_step", None)
        elif next_status == "running":
            record["started_at"] = record.get("started_at") or now
        steps[step] = _flatten_common_fields(record)

        stale_steps: List[str] = []
        if prior_input_signature and prior_input_signature != input_signature:
            for dependent in _walk_dependents(step):
                dependent_record = steps.get(dependent)
                if not isinstance(dependent_record, dict):
                    continue
                if str(dependent_record.get("status") or "").lower() in {"completed", "running", "failed", "stale"}:
                    dependent_record = dict(dependent_record)
                    dependent_record["status"] = "stale"
                    dependent_record["stale_reason"] = f"{STEP_LABELS.get(step, step)} inputs changed"
                    dependent_record["stale_from_step"] = step
                    dependent_record["stale_at"] = now
                    steps[dependent] = dependent_record
                    stale_steps.append(dependent)

        if step in steps and steps[step].get("status") == "completed":
            steps[step].pop("stale_reason", None)
            steps[step].pop("stale_from_step", None)

        run_status = self._derive_run_status(steps)
        current_step = step if next_status in {"running", "completed"} else self._derive_current_step(steps)
        completed_at = now if run_status == "completed" else None
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE mlops_run_state
                SET pipeline_id = COALESCE(?, pipeline_id),
                    pipeline_uuid = COALESCE(?, pipeline_uuid),
                    pipeline_name = COALESCE(NULLIF(?, ''), pipeline_name),
                    pipeline_type = COALESCE(NULLIF(?, ''), pipeline_type),
                    status = ?,
                    current_step = ?,
                    steps_json = ?,
                    updated_at = CURRENT_TIMESTAMP,
                    completed_at = CASE WHEN ? IS NULL THEN completed_at ELSE CURRENT_TIMESTAMP END
                WHERE run_id = ? AND tenant_id = ? AND env_id = ?
                """,
                [
                    int(pipeline_id) if pipeline_id is not None else None,
                    pipeline_uuid,
                    pipeline_name,
                    str(pipeline_type or "").strip().lower(),
                    run_status,
                    current_step,
                    json.dumps(steps, default=str),
                    completed_at,
                    run_id,
                    tenant_id,
                    env_id,
                ],
            )
            conn.execute(
                """
                INSERT INTO mlops_run_state_events (
                  event_id, run_id, tenant_id, env_id, pipeline_id, step_name,
                  event_type, status, input_signature, output_signature, payload_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    str(uuid.uuid4()),
                    run_id,
                    tenant_id,
                    env_id,
                    int(pipeline_id) if pipeline_id is not None else run_state.get("pipeline_id"),
                    step,
                    "step_state_saved",
                    next_status,
                    input_signature,
                    output_signature,
                    json.dumps(
                        {
                            "stale_steps": stale_steps,
                            "inputs": next_inputs,
                            "outputs": next_outputs,
                        },
                        default=str,
                    ),
                ],
            )
        self._invalidate_cache(tenant_id, env_id, run_id)
        return self.get_run_state(tenant_id, env_id, run_id, use_cache=False)

    def _derive_run_status(self, steps: Dict[str, Any]) -> str:
        statuses = [str((step or {}).get("status") or "").lower() for step in steps.values() if isinstance(step, dict)]
        if any(status == "failed" for status in statuses):
            return "failed"
        if any(status == "stale" for status in statuses):
            return "stale"
        if statuses and all(status == "completed" for status in statuses):
            return "completed"
        if any(status in {"completed", "running"} for status in statuses):
            return "running"
        return "running"

    def get_step_data(self, tenant_id: str, env_id: str, run_id: str, step_name: str) -> Dict[str, Any]:
        run_state = self.get_run_state(tenant_id, env_id, run_id)
        step = canonical_step_name(step_name)
        record = (run_state.get("steps_json") or {}).get(step)
        if not isinstance(record, dict):
            raise ValueError(f"Step {step} not found in RUN_STATE {run_id}")
        return {
            "run_id": run_state.get("run_id"),
            "step_name": step,
            "status": record.get("status") or "not_started",
            "inputs": record.get("inputs") or {},
            "outputs": record.get("outputs") or {},
            "step": record,
        }

    def to_ui_step_statuses(self, run_state: Dict[str, Any]) -> Dict[str, str]:
        steps = run_state.get("steps_json") if isinstance(run_state.get("steps_json"), dict) else {}
        statuses: Dict[str, str] = {}
        for step_name, record in steps.items():
            ui_key = STEP_TO_UI_STAGE.get(canonical_step_name(step_name))
            if not ui_key or not isinstance(record, dict):
                continue
            status = str(record.get("status") or "not_started").lower()
            statuses[ui_key] = "invalidated" if status == "stale" else status
        return statuses
