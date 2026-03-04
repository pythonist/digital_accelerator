"""
AutoPilot routes for business-user ML orchestration.

Thin blueprint layer:
- validates user selections
- runs existing MLOpsWorkbenchService methods in sequence
- exposes polling-friendly run status for the frontend
"""

from __future__ import annotations

import copy
import json
import pickle
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root

autopilot_bp = Blueprint("mlops_autopilot", __name__)


PIPELINE_STEPS = [
    {"id": "master", "label": "Combining your data tables"},
    {"id": "target", "label": "Setting up what to predict"},
    {"id": "preprocess", "label": "Cleaning and preparing data"},
    {"id": "train", "label": "Training your model"},
    {"id": "validate", "label": "Checking model performance"},
    {"id": "register", "label": "Saving your model"},
]

GOAL_CONFIGS = {
    "catch_most": {
        "label": "Catch as many cases as possible",
        "max_event_loss_pct": 2.0,
        "test_size": 0.20,
    },
    "minimize_false_alarms": {
        "label": "Minimize false alarms",
        "max_event_loss_pct": 10.0,
        "test_size": 0.20,
    },
    "balanced": {
        "label": "Balanced trade-off",
        "max_event_loss_pct": 5.0,
        "test_size": 0.20,
    },
    "custom": {
        "label": "Auto-tuned defaults",
        "max_event_loss_pct": 7.5,
        "test_size": 0.20,
    },
}

TARGET_FALLBACK_COLUMNS = [
    "is_true_pos",
    "final_label",
    "str_label",
    "case_label",
    "target",
    "label",
]

_RUNS: Dict[str, Dict[str, Any]] = {}
_RUNS_LOCK = threading.Lock()
_AUTOPILOT_RUN_TABLE = "mlops_autopilot_runs"


class RunCancelledError(RuntimeError):
    """Raised when a running autopilot job is cancelled by user action."""


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _append_log_entry(run: Dict[str, Any], *, message: str, level: str = "info", step_id: str | None = None) -> None:
    logs = run.setdefault("logs", [])
    logs.append(
        {
            "timestamp": _now_iso(),
            "level": str(level or "info"),
            "step_id": str(step_id) if step_id else None,
            "message": str(message or ""),
        }
    )
    if len(logs) > 250:
        del logs[:-250]


def _ok(data: Any, status_code: int = 200):
    return jsonify({"success": True, "data": data}), status_code


def _err(message: str, status_code: int = 400, error_code: str = "VALIDATION_ERROR"):
    return jsonify({"success": False, "error": str(message), "error_code": error_code}), status_code


def _get_env_ids() -> tuple[str, str]:
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or services.metadata_manager.active_env
    )
    if not env_id:
        raise ValueError("X-Environment-ID header required")
    tenant_id = getattr(request, "tenant_id", None) or "default"
    return str(tenant_id), str(env_id)


def _resolve_env_path(env_id: str, tenant_id: str) -> Path:
    return resolve_env_root(env_id, tenant_id, create_if_missing=True)


def _get_service(env_root: Path) -> MLOpsWorkbenchService:
    return MLOpsWorkbenchService(env_root / "mlops" / "duckdb" / "mlops.duckdb")


def _autopilot_db_path(env_root: Path) -> Path:
    return env_root / "mlops" / "duckdb" / "mlops.duckdb"


def _ensure_run_store(env_root: Path) -> None:
    db_path = _autopilot_db_path(env_root)
    with get_connection(db_path) as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {_AUTOPILOT_RUN_TABLE} (
              run_id TEXT PRIMARY KEY,
              tenant_id TEXT,
              env_id TEXT,
              status TEXT,
              config_json TEXT,
              run_json TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def _persist_run(run: Dict[str, Any]) -> None:
    env_root_str = str(run.get("_env_root") or "").strip()
    if not env_root_str:
        return
    env_root = Path(env_root_str)
    _ensure_run_store(env_root)
    db_path = _autopilot_db_path(env_root)
    payload = dict(run)
    with get_connection(db_path) as conn:
        conn.execute(
            f"DELETE FROM {_AUTOPILOT_RUN_TABLE} WHERE run_id = ?",
            [str(payload.get("run_id") or "")],
        )
        conn.execute(
            f"""
            INSERT INTO {_AUTOPILOT_RUN_TABLE}
            (run_id, tenant_id, env_id, status, config_json, run_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """,
            [
                str(payload.get("run_id") or ""),
                str(payload.get("tenant_id") or ""),
                str(payload.get("env_id") or ""),
                str(payload.get("status") or "pending"),
                json.dumps(payload.get("config") or {}, default=str),
                json.dumps(payload, default=str),
            ],
        )


def _load_run_from_store(env_root: Path, run_id: str) -> Dict[str, Any] | None:
    _ensure_run_store(env_root)
    db_path = _autopilot_db_path(env_root)
    with get_connection(db_path) as conn:
        row = conn.execute(
            f"SELECT run_json FROM {_AUTOPILOT_RUN_TABLE} WHERE run_id = ? LIMIT 1",
            [str(run_id)],
        ).fetchone()
    if not row:
        return None
    try:
        parsed = json.loads(row[0] or "{}")
        if isinstance(parsed, dict):
            parsed.setdefault("_env_root", str(env_root))
            return parsed
    except Exception:
        return None
    return None


def _list_runs_from_store(env_root: Path, tenant_id: str, env_id: str) -> List[Dict[str, Any]]:
    _ensure_run_store(env_root)
    db_path = _autopilot_db_path(env_root)
    with get_connection(db_path) as conn:
        rows = conn.execute(
            f"""
            SELECT run_json
            FROM {_AUTOPILOT_RUN_TABLE}
            WHERE tenant_id = ? AND env_id = ?
            ORDER BY updated_at DESC, created_at DESC
            """,
            [str(tenant_id), str(env_id)],
        ).fetchall()
    out: List[Dict[str, Any]] = []
    for row in rows:
        try:
            parsed = json.loads(row[0] or "{}")
        except Exception:
            continue
        if isinstance(parsed, dict):
            parsed.setdefault("_env_root", str(env_root))
            out.append(parsed)
    return out


def _coerce_dataset_ids(raw_ids: Any) -> List[int]:
    out: List[int] = []
    for value in raw_ids or []:
        try:
            out.append(int(value))
        except Exception:
            continue
    return out


def _make_run(env_id: str, tenant_id: str, env_root: Path, config: Dict[str, Any]) -> Dict[str, Any]:
    run_id = str(uuid.uuid4())
    run = {
        "run_id": run_id,
        "env_id": env_id,
        "tenant_id": tenant_id,
        "_env_root": str(env_root),
        "status": "pending",
        "config": config,
        "steps": [
            {
                **step,
                "status": "pending",
                "message": "",
                "started_at": None,
                "finished_at": None,
                "result": None,
            }
            for step in PIPELINE_STEPS
        ],
        "artifacts": {},
        "logs": [],
        "created_at": _now_iso(),
        "finished_at": None,
        "error": None,
    }
    _append_log_entry(run, message="Run created and queued.", level="info")
    with _RUNS_LOCK:
        _RUNS[run_id] = run
    _persist_run(run)
    return run


def _set_run(run_id: str, **updates: Any) -> None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if run:
            run.update(updates)
            _persist_run(run)


def _set_artifact(run_id: str, key: str, value: Any) -> None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if run:
            run.setdefault("artifacts", {})[key] = value
            _persist_run(run)


def _set_step(run_id: str, step_id: str, status: str, message: str = "", result: Any = None) -> None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return
        for step in run.get("steps", []):
            if step.get("id") != step_id:
                continue
            step["status"] = status
            step["message"] = message
            if result is not None:
                step["result"] = result
            if status == "running":
                step["started_at"] = _now_iso()
            if status in {"done", "error", "skipped"}:
                step["finished_at"] = _now_iso()
            _persist_run(run)
            return


def _log_run(run_id: str, message: str, *, level: str = "info", step_id: str | None = None) -> None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return
        _append_log_entry(run, message=message, level=level, step_id=step_id)
        _persist_run(run)


def _get_run_copy(run_id: str, env_root: Path | None = None) -> Dict[str, Any] | None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if run:
            return copy.deepcopy(run)
    if env_root is None:
        return None
    loaded = _load_run_from_store(env_root, run_id)
    if not loaded:
        return None
    with _RUNS_LOCK:
        _RUNS[run_id] = loaded
    return copy.deepcopy(loaded)


def _public_run(run: Dict[str, Any] | None) -> Dict[str, Any] | None:
    if not isinstance(run, dict):
        return None
    out = copy.deepcopy(run)
    out.pop("_env_root", None)
    return out


def _ensure_run_active(run_id: str, env_root: Path) -> None:
    run = _get_run_copy(run_id, env_root)
    if not run:
        raise RunCancelledError("Run not found")
    status = str(run.get("status") or "").lower()
    if status in {"canceled", "cancelled"}:
        raise RunCancelledError("Run canceled by user")


def _build_default_preprocess_steps(dataset: Dict[str, Any], target_column: str) -> List[Dict[str, Any]]:
    column_types = dataset.get("column_types") or {}
    target_norm = str(target_column or "").strip().lower()
    numeric_cols: List[str] = []
    categorical_cols: List[str] = []

    for col, dtype in column_types.items():
        col_name = str(col)
        if col_name.lower() == target_norm:
            continue
        dtype_s = str(dtype).lower()
        if any(token in dtype_s for token in ("int", "float", "double", "decimal", "numeric", "bool")):
            numeric_cols.append(col_name)
        else:
            categorical_cols.append(col_name)

    steps: List[Dict[str, Any]] = []
    if numeric_cols:
        steps.append({"type": "imputation", "strategy": "median", "columns": numeric_cols})
    if categorical_cols:
        steps.append({"type": "imputation", "strategy": "mode", "columns": categorical_cols})
        steps.append({"type": "encoding_onehot", "columns": categorical_cols, "max_categories": 20})
    return steps


def _resolve_target_candidates(dataset: Dict[str, Any], requested_target: str) -> List[str]:
    columns = list((dataset.get("column_types") or {}).keys())
    if not columns:
        columns = [str(c) for c in (dataset.get("columns") or [])]
    lookup = {str(col).strip().lower(): str(col) for col in columns}

    requested = str(requested_target or "").strip()
    requested_norm = requested.lower()

    candidates: List[str] = []
    if requested:
        candidates.append(lookup.get(requested_norm, requested))

    for fallback in TARGET_FALLBACK_COLUMNS:
        resolved = lookup.get(fallback)
        if resolved:
            candidates.append(resolved)

    ordered: List[str] = []
    seen = set()
    for col in candidates:
        key = str(col).strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        ordered.append(str(col))
    return ordered


def _register_uploaded_run(
    service: MLOpsWorkbenchService,
    tenant_id: str,
    env_id: str,
    *,
    artifact_path: Path,
    model_name: str,
    target_column: str,
    threshold: float,
    model_meta: Dict[str, Any],
) -> Dict[str, Any]:
    run_id = f"uploaded_{uuid.uuid4().hex}"
    algorithm = f"Uploaded::{model_meta.get('type') or 'PickleModel'}"
    with get_connection(service.db_path) as conn:
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
                0,
                target_column or "",
                algorithm,
                json.dumps(model_meta.get("feature_names") or []),
                json.dumps({"source": "uploaded", "model_name": model_name}),
                json.dumps([]),
                json.dumps([]),
                json.dumps([]),
                float(threshold),
                str(artifact_path),
            ],
        )
    return {
        "registry_id": run_id,
        "job_id": run_id,
        "stage": "candidate",
        "model_name": model_name,
        "threshold": float(threshold),
    }


def _mark_run_failed(run_id: str, error_text: str) -> None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return
        if str(run.get("status") or "").lower() in {"canceled", "cancelled"}:
            _persist_run(run)
            return
        failed_step_id = None
        for step in run.get("steps", []):
            if step.get("status") == "running":
                failed_step_id = str(step.get("id") or "")
                step["status"] = "error"
                step["message"] = error_text
                step["finished_at"] = _now_iso()
            elif step.get("status") == "pending":
                step["status"] = "skipped"
                step["finished_at"] = _now_iso()
        run["status"] = "error"
        run["error"] = error_text
        run["failed_step"] = failed_step_id
        run["finished_at"] = _now_iso()
        _append_log_entry(
            run,
            message=f"Run failed: {error_text}",
            level="error",
            step_id=failed_step_id or None,
        )
        _persist_run(run)


def _mark_run_canceled(run_id: str, reason: str = "Run canceled by user") -> None:
    with _RUNS_LOCK:
        run = _RUNS.get(run_id)
        if not run:
            return
        for step in run.get("steps", []):
            if step.get("status") == "running":
                step["status"] = "skipped"
                step["message"] = reason
                step["finished_at"] = _now_iso()
            elif step.get("status") == "pending":
                step["status"] = "skipped"
                step["finished_at"] = _now_iso()
        run["status"] = "canceled"
        run["error"] = reason
        run["finished_at"] = _now_iso()
        _append_log_entry(run, message=reason, level="warning")
        _persist_run(run)


def _run_pipeline(run_id: str, env_root: Path) -> None:
    run = _get_run_copy(run_id, env_root)
    if not run:
        return

    tenant_id = str(run["tenant_id"])
    env_id = str(run["env_id"])
    config = dict(run.get("config") or {})
    goal_cfg = GOAL_CONFIGS.get(config.get("business_goal"), GOAL_CONFIGS["balanced"])

    service = _get_service(env_root)
    _set_run(run_id, status="running")
    _log_run(run_id, "Pipeline execution started.")

    try:
        _ensure_run_active(run_id, env_root)
        dataset_ids = _coerce_dataset_ids(config.get("dataset_ids"))
        target_column = str(config.get("target_column") or "").strip()
        if not dataset_ids:
            raise ValueError("dataset_ids is required")
        if not target_column:
            raise ValueError("target_column is required")
        _log_run(
            run_id,
            f"Resolved {len(dataset_ids)} source dataset(s). Target requested: '{target_column}'.",
        )

        _ensure_run_active(run_id, env_root)
        _set_step(run_id, "master", "running", "Joining selected tables into one working dataset...")
        _log_run(run_id, "Starting master dataset build.", step_id="master")
        datasets: List[Dict[str, Any]] = []
        for did in dataset_ids:
            datasets.append(service.get_dataset(tenant_id, env_id, did))
        master_result = service.build_master_dataset(
            tenant_id,
            env_id,
            datasets,
            "master_dataset",
            {"master_mode": "auto", "preview_rows": 40},
        )
        master_dataset = master_result.get("dataset") or {}
        master_dataset_id = int(master_dataset.get("dataset_id") or 0)
        if not master_dataset_id:
            raise ValueError("Master dataset build did not return dataset_id")
        _set_artifact(run_id, "master_dataset_id", master_dataset_id)
        _set_step(
            run_id,
            "master",
            "done",
            f"Combined {len(datasets)} table(s) into one dataset.",
            result=master_result,
        )
        _log_run(run_id, f"Master dataset build complete. dataset_id={master_dataset_id}", step_id="master")

        _ensure_run_active(run_id, env_root)
        _set_step(run_id, "target", "running", f"Using '{target_column}' as the prediction target...")
        _log_run(run_id, f"Target selection accepted: '{target_column}'.", step_id="target")
        time.sleep(0.2)
        _set_step(
            run_id,
            "target",
            "done",
            f"Target set to '{target_column}'.",
            result={"target_column": target_column},
        )

        _ensure_run_active(run_id, env_root)
        _set_step(run_id, "preprocess", "running", "Applying default preprocessing and feature preparation...")
        _log_run(run_id, "Starting preprocessing stage.", step_id="preprocess")
        master_meta = service.get_dataset(tenant_id, env_id, master_dataset_id)
        preprocess_steps = _build_default_preprocess_steps(master_meta, target_column)
        preprocess_result = service.preprocess_run(
            tenant_id,
            env_id,
            master_meta,
            preprocess_steps,
            "preprocessed_dataset",
            target_column=target_column,
        )
        preprocessed_dataset = preprocess_result.get("dataset") or {}
        preprocessed_dataset_id = int(preprocessed_dataset.get("dataset_id") or 0)
        if not preprocessed_dataset_id:
            raise ValueError("Preprocessing did not return dataset_id")
        _set_artifact(run_id, "preprocessed_dataset_id", preprocessed_dataset_id)
        _set_step(
            run_id,
            "preprocess",
            "done",
            "Preprocessing complete.",
            result=preprocess_result,
        )
        _log_run(run_id, f"Preprocessing complete. dataset_id={preprocessed_dataset_id}", step_id="preprocess")

        _ensure_run_active(run_id, env_root)
        _set_step(run_id, "train", "running", "Training model candidates and selecting the best one...")
        _log_run(run_id, "Starting model training stage.", step_id="train")
        train_dataset = service.get_dataset(tenant_id, env_id, preprocessed_dataset_id)
        target_candidates = _resolve_target_candidates(train_dataset, target_column)
        if not target_candidates:
            target_candidates = [target_column]

        train_result = None
        train_target_used = None
        attempt_errors: List[str] = []
        for idx, candidate_target in enumerate(target_candidates):
            try:
                train_result = service.train_false_positive_model(
                    tenant_id=tenant_id,
                    env_id=env_id,
                    dataset=train_dataset,
                    target_column=candidate_target,
                    test_size=float(goal_cfg.get("test_size") or 0.2),
                    random_state=42,
                )
                train_target_used = str(candidate_target)
                break
            except Exception as exc:
                err_text = str(exc)
                attempt_errors.append(f"{candidate_target}: {err_text}")
                if idx < (len(target_candidates) - 1):
                    _log_run(
                        run_id,
                        f"Training attempt with target '{candidate_target}' failed: {err_text}. Trying fallback target.",
                        level="warning",
                        step_id="train",
                    )
                    continue
                raise ValueError(
                    "Training failed for all target candidates. "
                    + " | ".join(attempt_errors)
                ) from exc

        if not isinstance(train_result, dict):
            raise ValueError("Model training did not return a valid result payload")
        model_run_id = str(train_result.get("run_id") or "").strip()
        if not model_run_id:
            raise ValueError("Model training did not return run_id")
        best_model = str(train_result.get("best_model") or "")
        auc = 0.0
        for candidate in train_result.get("candidates") or []:
            if str(candidate.get("model")) == best_model:
                auc = float(candidate.get("auc_roc") or 0.0)
                break
        if auc <= 0.0 and train_result.get("candidates"):
            auc = max(float(c.get("auc_roc") or 0.0) for c in train_result.get("candidates") or [])
        train_result_enriched = dict(train_result)
        train_result_enriched["_auc"] = auc
        train_result_enriched["target_column_used"] = train_target_used
        _set_artifact(run_id, "job_id", model_run_id)
        _set_artifact(run_id, "model_url", f"/api/model-training/results/{model_run_id}")
        _set_artifact(run_id, "target_column_requested", target_column)
        _set_artifact(run_id, "target_column_used", train_target_used)
        _set_step(
            run_id,
            "train",
            "done",
            (
                f"Training complete using {best_model or 'the top model'}."
                + (
                    f" Target used: '{train_target_used}'."
                    if train_target_used and train_target_used != target_column
                    else ""
                )
            ),
            result=train_result_enriched,
        )
        _log_run(
            run_id,
            f"Training complete. run_id={model_run_id}, model={best_model or 'best_candidate'}, target='{train_target_used or target_column}'.",
            step_id="train",
        )

        _ensure_run_active(run_id, env_root)
        _set_step(run_id, "validate", "running", "Tuning threshold for your selected business goal...")
        _log_run(run_id, "Starting validation and threshold tuning.", step_id="validate")
        tune_result = service.tune_model_threshold(
            run_id=model_run_id,
            max_event_loss_pct=float(goal_cfg.get("max_event_loss_pct") or 5.0),
        )
        threshold = float(tune_result.get("optimal_threshold") or 0.40)
        eval_result = service.evaluate_model_run(run_id=model_run_id, threshold=threshold)
        validate_result = dict(tune_result)
        validate_result["evaluation"] = eval_result
        _set_step(
            run_id,
            "validate",
            "done",
            f"Validation complete. Recommended threshold: {threshold:.2f}.",
            result=validate_result,
        )
        _log_run(run_id, f"Validation complete. optimal_threshold={threshold:.4f}", step_id="validate")

        _ensure_run_active(run_id, env_root)
        _set_step(run_id, "register", "running", "Registering model output...")
        _log_run(run_id, "Registering trained model artifacts.", step_id="register")
        registry_id = model_run_id
        _set_artifact(run_id, "registry_id", registry_id)
        _set_step(
            run_id,
            "register",
            "done",
            "Model registered and ready for deployment.",
            result={
                "registry_id": registry_id,
                "job_id": model_run_id,
                "stage": "candidate",
            },
        )
        _log_run(run_id, f"Model registered. registry_id={registry_id}", step_id="register")

        try:
            report = service.generate_run_report(
                tenant_id=tenant_id,
                env_id=env_id,
                run_id=model_run_id,
                pipeline_id=None,
            )
            _set_artifact(run_id, "report_id", report.get("report_id"))
            _set_artifact(run_id, "report_run_id", model_run_id)
            _set_artifact(run_id, "report_url", f"/api/mlops/report/{model_run_id}")
            _set_artifact(run_id, "report_pdf_url", f"/api/mlops/report/{model_run_id}/pdf")
            _log_run(run_id, "Run report generated and linked to artifacts.", step_id="register")
        except Exception as report_exc:
            _log_run(
                run_id,
                f"Report generation warning: {report_exc}",
                level="warning",
                step_id="register",
            )

        _set_run(run_id, status="done", finished_at=_now_iso(), error=None)
        _log_run(run_id, "Pipeline completed successfully.")
    except RunCancelledError as exc:
        _mark_run_canceled(run_id, str(exc))
    except Exception as exc:
        _mark_run_failed(run_id, str(exc))


@autopilot_bp.route("/configure", methods=["POST"])
def configure():
    try:
        _, _ = _get_env_ids()
        body = request.get_json(silent=True) or {}
        dataset_ids = _coerce_dataset_ids(body.get("dataset_ids"))
        target_column = str(body.get("target_column") or "").strip()
        business_goal = str(body.get("business_goal") or "balanced").strip()
        if not dataset_ids:
            return _err("dataset_ids is required")
        if not target_column:
            return _err("target_column is required")
        if business_goal not in GOAL_CONFIGS:
            business_goal = "balanced"
        goal_cfg = GOAL_CONFIGS[business_goal]
        return _ok(
            {
                "config_valid": True,
                "dataset_count": len(dataset_ids),
                "target_column": target_column,
                "business_goal": business_goal,
                "goal_config": goal_cfg,
                "estimated_duration_mins": 3,
            }
        )
    except ValueError as exc:
        return _err(str(exc), 400, "VALIDATION_ERROR")
    except Exception as exc:
        return _err(str(exc), 500, "SERVER_ERROR")


@autopilot_bp.route("/run", methods=["POST"])
def run_pipeline():
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        body = request.get_json(silent=True) or {}

        dataset_ids = _coerce_dataset_ids(body.get("dataset_ids"))
        target_column = str(body.get("target_column") or "").strip()
        business_goal = str(body.get("business_goal") or "balanced").strip()
        description = str(body.get("description") or "")

        if not dataset_ids:
            return _err("dataset_ids is required")
        if not target_column:
            return _err("target_column is required")
        if business_goal not in GOAL_CONFIGS:
            business_goal = "balanced"

        config = {
            "dataset_ids": dataset_ids,
            "target_column": target_column,
            "business_goal": business_goal,
            "description": description,
        }

        run = _make_run(env_id, tenant_id, env_root, config)
        thread = threading.Thread(target=_run_pipeline, args=(run["run_id"], env_root), daemon=True)
        thread.start()

        return _ok({"run_id": run["run_id"], "status": "running"})
    except ValueError as exc:
        return _err(str(exc), 400, "VALIDATION_ERROR")
    except Exception as exc:
        return _err(str(exc), 500, "SERVER_ERROR")


@autopilot_bp.route("/status/<run_id>", methods=["GET"])
def run_status(run_id: str):
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        run = _get_run_copy(str(run_id), env_root)
        if not run:
            return _err("Run not found", 404, "NOT_FOUND")
        return _ok(_public_run(run))
    except ValueError as exc:
        return _err(str(exc), 400, "VALIDATION_ERROR")
    except Exception as exc:
        return _err(str(exc), 500, "SERVER_ERROR")


@autopilot_bp.route("/runs", methods=["GET"])
def list_runs():
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        runs = _list_runs_from_store(env_root, tenant_id, env_id)
        runs = [{k: v for k, v in _public_run(run).items() if k != "steps"} for run in runs]
        runs.sort(key=lambda r: str(r.get("created_at") or r.get("updated_at") or ""), reverse=True)
        return _ok(runs)
    except ValueError as exc:
        return _err(str(exc), 400, "VALIDATION_ERROR")
    except Exception as exc:
        return _err(str(exc), 500, "SERVER_ERROR")


@autopilot_bp.route("/deploy/<run_id>", methods=["POST"])
def deploy_run(run_id: str):
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        service = _get_service(env_root)
        body = request.get_json(silent=True) or {}

        run = _get_run_copy(str(run_id), env_root)
        if not run:
            return _err("Run not found", 404, "NOT_FOUND")
        if run.get("status") != "done":
            return _err("Pipeline must finish before deployment")

        model_run_id = str(run.get("artifacts", {}).get("job_id") or "").strip()
        if not model_run_id:
            return _err("No trained model found for this run", 400, "VALIDATION_ERROR")

        threshold = body.get("threshold")
        if threshold is None:
            validate_step = next((s for s in run.get("steps", []) if s.get("id") == "validate"), {})
            threshold = (
                (validate_step.get("result") or {}).get("optimal_threshold")
                if isinstance(validate_step.get("result"), dict)
                else None
            )
        threshold = float(threshold if threshold is not None else 0.40)

        result = service.deploy_model_run(
            tenant_id=tenant_id,
            env_id=env_id,
            run_id=model_run_id,
            threshold=threshold,
            deployment_name=body.get("deployment_name"),
        )
        _set_artifact(str(run_id), "deployment_id", result.get("deployment_id"))
        return _ok(result)
    except ValueError as exc:
        return _err(str(exc), 400, "VALIDATION_ERROR")
    except Exception as exc:
        return _err(str(exc), 500, "SERVER_ERROR")


@autopilot_bp.route("/cancel/<run_id>", methods=["POST"])
def cancel_run(run_id: str):
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        run = _get_run_copy(str(run_id), env_root)
        if not run:
            return _err("Run not found", 404, "NOT_FOUND")
        if str(run.get("tenant_id") or "") != str(tenant_id) or str(run.get("env_id") or "") != str(env_id):
            return _err("Run not found", 404, "NOT_FOUND")
        if str(run.get("status") or "").lower() in {"done", "error", "canceled", "cancelled"}:
            return _ok(_public_run(run))

        with _RUNS_LOCK:
            current = _RUNS.get(str(run_id)) or run
            _RUNS[str(run_id)] = current
        _mark_run_canceled(str(run_id), "Run canceled by user")
        updated = _get_run_copy(str(run_id), env_root)
        return _ok(_public_run(updated))
    except ValueError as exc:
        return _err(str(exc), 400, "VALIDATION_ERROR")
    except Exception as exc:
        return _err(str(exc), 500, "SERVER_ERROR")


@autopilot_bp.route("/upload-model", methods=["POST"])
def upload_model():
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        service = _get_service(env_root)

        file = request.files.get("file")
        if not file:
            return _err("file is required")
        filename = str(file.filename or "")
        if not filename.lower().endswith(".pkl"):
            return _err("Only .pkl files are supported")

        model_name = str(request.form.get("model_name") or Path(filename).stem).strip() or f"uploaded_{uuid.uuid4().hex[:8]}"
        target_column = str(request.form.get("target_column") or "").strip()
        threshold = float(request.form.get("threshold") or 0.50)
        notes = str(request.form.get("notes") or "Uploaded via AutoPilot")

        upload_dir = env_root / "mlops" / "models" / "uploaded"
        upload_dir.mkdir(parents=True, exist_ok=True)
        raw_path = upload_dir / f"{model_name}_{uuid.uuid4().hex[:8]}.pkl"
        file.save(str(raw_path))

        with open(raw_path, "rb") as input_file:
            model_obj = pickle.load(input_file)

        feature_names = []
        if hasattr(model_obj, "feature_names_in_"):
            try:
                feature_names = [str(v) for v in list(model_obj.feature_names_in_)]
            except Exception:
                feature_names = []

        wrapped_artifact_path = upload_dir / f"{model_name}_{uuid.uuid4().hex[:8]}_bundle.pkl"
        wrapped_bundle = {
            "model": model_obj,
            "feature_columns": feature_names,
            "target_column": target_column,
            "trained_at": _now_iso(),
            "dataset_id": 0,
            "algorithm": type(model_obj).__name__,
        }
        with open(wrapped_artifact_path, "wb") as output_file:
            pickle.dump(wrapped_bundle, output_file)

        model_meta: Dict[str, Any] = {
            "source": "uploaded",
            "type": type(model_obj).__name__,
            "file": str(raw_path),
        }
        if hasattr(model_obj, "n_features_in_"):
            try:
                model_meta["n_features"] = int(model_obj.n_features_in_)
            except Exception:
                pass
        if feature_names:
            model_meta["feature_names"] = feature_names
        if hasattr(model_obj, "classes_"):
            try:
                model_meta["classes"] = [str(v) for v in list(model_obj.classes_)]
            except Exception:
                pass

        registry_entry = _register_uploaded_run(
            service,
            tenant_id,
            env_id,
            artifact_path=wrapped_artifact_path,
            model_name=model_name,
            target_column=target_column,
            threshold=threshold,
            model_meta=model_meta,
        )
        registry_entry["notes"] = notes

        return _ok(
            {
                "registry_entry": registry_entry,
                "model_meta": model_meta,
                "pkl_path": str(raw_path),
                "message": "Model uploaded and registered. You can now deploy it.",
            }
        )
    except ValueError as exc:
        return _err(str(exc), 400, "VALIDATION_ERROR")
    except Exception as exc:
        return _err(str(exc), 500, "SERVER_ERROR")
