"""
model_training_routes.py  — AML MLOps  (Enhanced v4)
════════════════════════════════════════════════════════════════════════════════
All existing routes from v3 preserved.  New in v4 (Evaluation Workbench):

  POST /api/model-training/compare
       ↑ Now returns full per-model roc_curve, pr_curve, confusion_matrix,
         feature_importance, and threshold_table for side-by-side charts.
         Body: { job_ids: [str, ...] }

  GET  /api/model-training/runs
       ↑ Now returns enriched list including metrics.roc_auc, metrics.f1,
         trained_at, registry_stage, grain, label, algorithm for the selector.

  POST /api/model-training/workbench/champion
       Atomically promote a model to champion and demote prior champion.
       Body: { job_id, notes?, tags? }

  GET  /api/model-training/workbench/summary
       Returns cross-model summary for the overview panel: best AUC, best F1,
       champion job_id, total runs, event_loss distribution.

  POST /api/model-training/workbench/bulk-label
       Set custom display labels on one or more jobs.
       Body: { labels: { job_id: label_str, ... } }

  GET  /api/model-training/workbench/labels
       Returns the label mapping for all runs in this env.

  POST /api/model-training/validation/compare
       Run validation report for multiple jobs at once and return results
       keyed by job_id.
       Body: { job_ids, max_event_loss_pct?, optimization_mode? }

Backward compatibility
  • All existing endpoint URLs, request bodies, and response shapes unchanged.
  • New fields are additive — existing callers receive extra keys harmlessly.
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import Blueprint, jsonify, request

from api.service_locator import services
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root
from api.tools.mlops.model_training_service import (
    ModelTrainingService,
    BUSINESS_DEFAULT_THRESHOLD,
    DEFAULT_SPLIT_STRATEGY,
    DEPLOYABLE_THRESHOLD_MAX,
    DEPLOYABLE_THRESHOLD_MIN,
    _classification_preview_metrics,
    _closest_threshold_row,
)
try:
    from api.tools.mlops.model_validation_service import ModelValidationService
except Exception:  # pragma: no cover - startup fallback for partial envs
    class ModelValidationService:  # type: ignore[no-redef]
        def __init__(self, training_service: ModelTrainingService):
            self.training = training_service

        def validation_report(
            self,
            *,
            job_id: str,
            max_event_loss_pct: float = 5.0,
            thresholds: Optional[List[float]] = None,
            optimization_mode: str = "max_suppression_under_event_loss",
            target_suppression_pct: Optional[float] = None,
            target_tolerance_pct: float = 2.0,
        ) -> Dict:
            return self.training.validation_report(
                job_id=job_id,
                max_event_loss_pct=max_event_loss_pct,
                thresholds=thresholds,
                optimization_mode=optimization_mode,
                target_suppression_pct=target_suppression_pct,
                target_tolerance_pct=target_tolerance_pct,
            )

        def validation_compare(
            self,
            *,
            job_ids: List[str],
            max_event_loss_pct: float = 5.0,
            optimization_mode: str = "max_suppression_under_event_loss",
            target_suppression_pct: Optional[float] = None,
        ) -> Dict:
            results: Dict = {}
            errors: Dict = {}
            for jid in job_ids:
                try:
                    results[jid] = self.validation_report(
                        job_id=str(jid),
                        max_event_loss_pct=max_event_loss_pct,
                        optimization_mode=optimization_mode,
                        target_suppression_pct=target_suppression_pct,
                    )
                except Exception as exc:
                    errors[jid] = str(exc)
            return {"results": results, "errors": errors}

model_training_bp = Blueprint("model_training", __name__)

_SERVICE_LOCK  = threading.Lock()
_SERVICE_CACHE: Dict[str, ModelTrainingService] = {}

# In-memory label store (per-process, resets on restart — acceptable for MVP)
_LABEL_STORE: Dict[str, Dict[str, str]] = {}  # env_key → { job_id: label }
_LABEL_LOCK  = threading.Lock()


# ─────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────────────────

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


def _get_dataset_service(env_root: Path) -> MLOpsWorkbenchService:
    return MLOpsWorkbenchService(env_root / "mlops" / "duckdb" / "mlops.duckdb")


def _get_training_service(env_root: Path) -> ModelTrainingService:
    disable_db = str(os.getenv("MLOPS_DISABLE_DUCKDB") or "").strip().lower() in {"1", "true", "yes"}
    key = f"{env_root.resolve()}::nodb={disable_db}"
    with _SERVICE_LOCK:
        svc = _SERVICE_CACHE.get(key)
        if svc is None:
            svc = ModelTrainingService(
                db_path=None if disable_db else (env_root / "mlops" / "duckdb" / "model_training.duckdb"),
                model_dir=env_root / "mlops" / "models",
            )
            _SERVICE_CACHE[key] = svc
    return svc


def _get_validation_service(env_root: Path) -> ModelValidationService:
    return ModelValidationService(_get_training_service(env_root))


def _get_dataset(env_root, tenant_id, env_id, dataset_id):
    return _get_dataset_service(env_root).get_dataset(tenant_id, env_id, dataset_id)


def _clean_lines(values: Any, max_items: int = 10) -> List[str]:
    if not isinstance(values, (list, tuple)):
        return []
    cleaned: List[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        cleaned.append(text)
        if len(cleaned) >= max_items:
            break
    return cleaned


def _extract_llm_json(text: str) -> Optional[Dict[str, Any]]:
    raw = str(text or "").strip()
    if not raw:
        return None
    candidates = [raw]
    match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if match:
        candidates.insert(0, match.group(1))
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    return None


def _build_score_distribution(
    y_true: List[Any],
    y_prob: List[Any],
    *,
    bins: int = 20,
) -> Dict[str, Any]:
    total_bins = max(8, min(int(bins or 20), 50))
    try:
        truth = [int(v) for v in list(y_true or [])]
        prob = [max(0.0, min(1.0, float(v))) for v in list(y_prob or [])]
    except Exception:
        truth, prob = [], []

    if not truth or not prob or len(truth) != len(prob):
        return {
            "bins": [],
            "bin_count": total_bins,
            "max_count": 0,
            "total_negative": 0,
            "total_positive": 0,
        }

    rows: List[Dict[str, Any]] = []
    neg_total = sum(1 for value in truth if value == 0)
    pos_total = sum(1 for value in truth if value == 1)
    max_count = 0
    width = 1.0 / total_bins

    for idx in range(total_bins):
        start = round(idx * width, 4)
        end = round((idx + 1) * width, 4)
        neg_count = 0
        pos_count = 0
        for label, score in zip(truth, prob):
            in_bin = start <= score < end if idx < total_bins - 1 else start <= score <= end
            if not in_bin:
                continue
            if label == 1:
                pos_count += 1
            else:
                neg_count += 1
        max_count = max(max_count, neg_count, pos_count)
        rows.append({
            "start": start,
            "end": end,
            "label": f"{start:.2f}-{end:.2f}",
            "negative_count": neg_count,
            "positive_count": pos_count,
            "negative_density": round((neg_count / max(neg_total, 1)) * 100.0, 3),
            "positive_density": round((pos_count / max(pos_total, 1)) * 100.0, 3),
        })

    return {
        "bins": rows,
        "bin_count": total_bins,
        "max_count": max_count,
        "total_negative": neg_total,
        "total_positive": pos_total,
    }


def _load_validation_scores(
    trainer: ModelTrainingService,
    dataset_service: MLOpsWorkbenchService,
    job_id: str,
) -> tuple[List[Any], List[Any], str]:
    try:
        y_true, y_prob = trainer._load_scores(str(job_id))
        if len(y_true) and len(y_prob):
            return list(y_true), list(y_prob), "model_training_runs"
    except Exception:
        pass

    try:
        legacy_run = dataset_service.get_model_run(str(job_id))
        legacy_truth = legacy_run.get("test_truth") if isinstance(legacy_run, dict) else []
        legacy_prob = legacy_run.get("test_prob") if isinstance(legacy_run, dict) else []
        if isinstance(legacy_truth, list) and isinstance(legacy_prob, list) and len(legacy_truth) and len(legacy_truth) == len(legacy_prob):
            return legacy_truth, legacy_prob, "mlops_model_runs"
    except Exception:
        pass

    return [], [], "unavailable"


def _build_validation_explain_fallback(body: Dict[str, Any]) -> Dict[str, Any]:
    title = str(body.get("chart_title") or body.get("title") or "Validation analysis").strip()
    scope = str(body.get("analysis_scope") or "validation").strip().lower() or "validation"
    focus = str(body.get("chart_focus") or title or "this validation view").strip()
    deterministic = body.get("deterministic_insight") if isinstance(body.get("deterministic_insight"), dict) else {}
    facts = _clean_lines(body.get("facts"), max_items=10)

    what = str(
        deterministic.get("what")
        or (
            f"{title} summarises {facts[0].lower()}"
            if facts
            else f"{title} shows the current pattern in {focus.lower()}."
        )
    ).strip()
    why = str(
        deterministic.get("why")
        or (
            f"This matters because {facts[1].lower()}"
            if len(facts) > 1
            else "This helps the business judge whether the validation holdout supports the current operating decision."
        )
    ).strip()
    how = str(
        deterministic.get("how_it_helps_model_building")
        or "Use this view to compare trade-offs, explain queue impact, and decide whether the operating threshold is acceptable."
    ).strip()
    action = str(
        deterministic.get("action")
        or deterministic.get("recommended_action")
        or "Use this evidence together with policy thresholds, drift checks, and analyst review outcomes before changing production settings."
    ).strip()
    watch_out = str(
        deterministic.get("watch_out")
        or body.get("watch_out")
        or "Do not rely on one chart alone. Read it together with event loss, suppression, and feature-level evidence."
    ).strip()

    return {
        "analysis_source": "deterministic",
        "llm_available": False,
        "chart_title": title,
        "analysis_scope": scope,
        "facts": facts,
        "sections": {
            "what_this_says": what,
            "why_it_matters": why,
            "how_it_helps_model_building": how,
            "recommended_action": action,
            "watch_out": watch_out,
        },
    }


def _maybe_upgrade_validation_explanation(body: Dict[str, Any], fallback: Dict[str, Any]) -> Dict[str, Any]:
    wrapper = getattr(services, "llm_provider", None) or getattr(services, "ollama_wrapper", None)
    if not wrapper:
        return fallback
    try:
        if not wrapper.check_connection():
            return fallback
    except Exception:
        return fallback

    prompt_payload = {
        "analysis_scope": fallback.get("analysis_scope"),
        "chart_title": fallback.get("chart_title"),
        "chart_focus": str(body.get("chart_focus") or "").strip(),
        "facts": fallback.get("facts") or [],
        "deterministic_sections": fallback.get("sections") or {},
    }
    system_prompt = (
        "You are an AML model validation assistant for business and technical stakeholders. "
        "Rewrite grounded validation facts in plain language. "
        "Use only the facts supplied. Do not invent causes, numbers, or recommendations. "
        "Avoid jargon where possible and explain any required technical label in brackets. "
        "Return valid JSON with keys what_this_says, why_it_matters, "
        "how_it_helps_model_building, recommended_action, watch_out."
    )
    response = wrapper.generate(
        prompt=json.dumps(prompt_payload, default=str),
        system_prompt=system_prompt,
        temperature=0.2,
        max_tokens=420,
    )
    if not response or not response.get("success"):
        return fallback

    parsed = _extract_llm_json(response.get("response", ""))
    if not isinstance(parsed, dict):
        return fallback

    upgraded = dict(fallback)
    upgraded["analysis_source"] = "ai"
    upgraded["llm_available"] = True
    upgraded["provider"] = response.get("provider")
    upgraded["model"] = response.get("model")
    upgraded["generated_at"] = response.get("timestamp")
    sections = dict(upgraded.get("sections") or {})
    for key in (
        "what_this_says",
        "why_it_matters",
        "how_it_helps_model_building",
        "recommended_action",
        "watch_out",
    ):
        text = str(parsed.get(key) or "").strip()
        if text:
            sections[key] = text
    upgraded["sections"] = sections
    return upgraded


def _build_release_summary_fallback(body: Dict[str, Any]) -> Dict[str, Any]:
    model_name = str(body.get("model_name") or "This model").strip() or "This model"
    algorithm = str(body.get("algorithm") or "the trained AML scoring approach").strip() or "the trained AML scoring approach"
    threshold = body.get("threshold")
    suppression_pct = body.get("suppression_pct")
    event_loss_pct = body.get("event_loss_pct")
    retained_risk_pct = body.get("suspicious_case_retention_pct")
    recommendation_badge = str(body.get("recommendation_badge") or body.get("validation_status") or "ready").strip()
    recommendation_reason = str(body.get("recommendation_reason") or "").strip()
    validation_status = str(body.get("validation_status") or "Validation complete").strip()
    registration_status = str(body.get("registration_status") or "Not registered").strip()
    deployment_status = str(body.get("deployment_status") or "Not deployed").strip()

    threshold_text = f"{float(threshold):.2f}" if threshold is not None else "the current cutoff"
    suppression_text = f"{float(suppression_pct):.1f}%" if suppression_pct is not None else "the expected share"
    event_loss_text = f"{float(event_loss_pct):.1f}%" if event_loss_pct is not None else "the current guardrail estimate"
    retained_text = f"{float(retained_risk_pct):.1f}%" if retained_risk_pct is not None else "the retained suspicious-case share"

    headline = f"{model_name} is {recommendation_badge.lower()} for the next business review step"
    executive_summary = (
        f"{model_name} uses {algorithm} to reduce manual alert review volume. "
        f"At the current cutoff of {threshold_text}, it is expected to suppress {suppression_text} "
        f"of review load while retaining {retained_text} of suspicious-case coverage."
    )
    next_step = (
        "The model is ready to be registered so business and technical reviewers can approve the governed release."
        if recommendation_badge.lower() == "ready for registration"
        else "The model is already registered and can move into deployment review with the selected locked threshold."
        if recommendation_badge.lower() == "ready for deployment"
        else recommendation_reason
        or "Review the release evidence and decide the next governed step."
    )

    return {
        "analysis_source": "deterministic",
        "llm_available": False,
        "headline": headline,
        "executive_summary": executive_summary,
        "sections": {
            "what_we_built": (
                f"{model_name} is an AML false-positive suppression model trained to remove lower-value alerts "
                f"from analyst queues while keeping higher-risk cases in review."
            ),
            "what_we_achieved": (
                f"The current release view shows {suppression_text} expected suppression with {event_loss_text} "
                f"potential risk miss at the selected threshold."
            ),
            "business_value": (
                "This can reduce manual review effort, shorten queue pressure, and focus investigators "
                "on the alerts most likely to need action."
            ),
            "next_step": next_step,
            "caution": recommendation_reason or (
                f"Validation status is {validation_status}, registration status is {registration_status}, "
                f"and deployment status is {deployment_status}."
            ),
        },
    }


def _maybe_upgrade_release_summary(body: Dict[str, Any], fallback: Dict[str, Any]) -> Dict[str, Any]:
    wrapper = getattr(services, "llm_provider", None) or getattr(services, "ollama_wrapper", None)
    if not wrapper:
        return fallback
    try:
        if not wrapper.check_connection():
            return fallback
    except Exception:
        return fallback

    prompt_payload = {
        "grounded_release_summary": fallback,
        "metrics": {
            "suppression_pct": body.get("suppression_pct"),
            "event_loss_pct": body.get("event_loss_pct"),
            "suspicious_case_retention_pct": body.get("suspicious_case_retention_pct"),
            "threshold": body.get("threshold"),
        },
        "statuses": {
            "validation_status": body.get("validation_status"),
            "registration_status": body.get("registration_status"),
            "deployment_status": body.get("deployment_status"),
            "recommendation_badge": body.get("recommendation_badge"),
            "recommendation_reason": body.get("recommendation_reason"),
        },
    }
    system_prompt = (
        "You are an AML model-release assistant writing for business stakeholders. "
        "Rewrite the supplied grounded release facts into concise business language. "
        "Use only the facts given. Do not invent numbers, claims, approvals, or outcomes. "
        "Avoid jargon and avoid em dashes. "
        "Return valid JSON with keys headline, executive_summary, what_we_built, "
        "what_we_achieved, business_value, next_step, caution."
    )
    response = wrapper.generate(
        prompt=json.dumps(prompt_payload, default=str),
        system_prompt=system_prompt,
        temperature=0.2,
        max_tokens=420,
    )
    if not response or not response.get("success"):
        return fallback

    parsed = _extract_llm_json(response.get("response", ""))
    if not isinstance(parsed, dict):
        return fallback

    upgraded = dict(fallback)
    upgraded["analysis_source"] = "ai"
    upgraded["llm_available"] = True
    upgraded["provider"] = response.get("provider")
    upgraded["model"] = response.get("model")
    upgraded["generated_at"] = response.get("timestamp")
    for key in ("headline", "executive_summary"):
        value = str(parsed.get(key) or "").strip()
        if value:
            upgraded[key] = value
    sections = dict(upgraded.get("sections") or {})
    for key in ("what_we_built", "what_we_achieved", "business_value", "next_step", "caution"):
        value = str(parsed.get(key) or "").strip()
        if value:
            sections[key] = value
    upgraded["sections"] = sections
    return upgraded


def _resolve_target_column(dataset: Dict, target_column: str) -> str:
    columns = [str(c) for c in (dataset.get("columns") or []) if c is not None]
    if not columns:
        return (target_column or "").strip()
    lookup = {c.lower(): c for c in columns}
    raw = (target_column or "").strip()
    if raw:
        if raw in columns:
            return raw
        mapped = lookup.get(raw.lower())
        if mapped:
            return mapped
        if raw.lower() in {"__generated_target__", "generated_target"}:
            for cand in ("mule_flag", "is_generated_target", "target", "final_label", "is_true_pos", "is_str", "case_outcome"):
                m = lookup.get(cand)
                if m:
                    return m
        return raw
    for cand in ("mule_flag", "is_generated_target", "target", "final_label", "is_true_pos", "is_str", "case_outcome"):
        m = lookup.get(cand)
        if m:
            return m
    return ""


def _validate_hml_thresholds(high: float, low: float) -> Optional[str]:
    if not (0 < low < high < 1):
        return f"Invalid HML thresholds: low ({low:.3f}) must be < high ({high:.3f}) and both in (0,1)."
    if (high - low) < 0.05:
        return f"HML thresholds too close: gap {high - low:.3f} < 0.05."
    return None


def _label_key(tenant_id: str, env_id: str) -> str:
    return f"{tenant_id}::{env_id}"


def _get_labels(tenant_id: str, env_id: str) -> Dict[str, str]:
    with _LABEL_LOCK:
        return dict(_LABEL_STORE.get(_label_key(tenant_id, env_id), {}))


def _set_labels(tenant_id: str, env_id: str, updates: Dict[str, str]) -> None:
    key = _label_key(tenant_id, env_id)
    with _LABEL_LOCK:
        store = _LABEL_STORE.setdefault(key, {})
        store.update(updates)


def _enrich_run_with_label(run: Dict, labels: Dict[str, str]) -> Dict:
    """Attach display label + algorithm_display to a run dict."""
    job_id = run.get("job_id", "")
    alg    = run.get("algorithm", "")
    alg_display = {
        "random_forest":          "Random Forest",
        "gradient_boosting":      "Gradient Boosting",
        "logistic_regression":    "Logistic Regression",
        "decision_tree":          "Decision Tree",
        "xgboost":                "XGBoost",
        "lightgbm":               "LightGBM",
        "hist_gradient_boosting": "Hist GBM",
        "extra_trees":            "Extra Trees",
        "adaboost":               "AdaBoost",
        "knn":                    "k-NN",
        "linear_svm":             "Linear SVM",
        "naive_bayes":            "Naive Bayes",
        "soft_voting_ensemble":   "Soft Voting Ensemble",
        "stacking_ensemble":      "Stacking Ensemble",
    }.get(alg, alg.replace("_", " ").title() if alg else "Unknown")

    run["algorithm_display"] = alg_display
    run["label"] = labels.get(job_id) or run.get("model_name") or alg_display or job_id[:8]
    return run


def _enrich_result_for_workbench(result: Dict) -> Dict:
    """
    Ensure a model result dict has all fields the workbench frontend expects.
    Normalises key names and computes derived metrics so the client never
    needs to do maths.
    """
    if not result:
        return result

    m = result.get("metrics", {})

    # Computed / derived fields the frontend uses directly
    auc  = float(m.get("roc_auc", 0))
    f1   = float(m.get("f1", 0))
    prec = float(m.get("precision", 0))
    rec  = float(m.get("recall", 0))
    spec = float(m.get("specificity", 0))
    ba   = float(m.get("balanced_accuracy", (rec + spec) / 2 if rec or spec else 0))
    ap   = float(m.get("average_precision", m.get("pr_auc", f1)))

    result["metrics"].update({
        "gini":               round(2 * auc - 1, 4),
        "balanced_accuracy":  round(ba, 4),
        "average_precision":  round(ap, 4),
    })

    # Ensure operational fields bubble up from nested results
    for key in ("suppression_rate_pct", "event_loss_pct", "optimal_threshold",
                "precision", "recall", "f1", "specificity", "confusion_matrix"):
        if key not in result and key in m:
            result[key] = m[key]

    policy = result.get("deploy_threshold_policy", {}) if isinstance(result.get("deploy_threshold_policy"), dict) else {}
    for key in ("configured_threshold", "deployable_threshold", "threshold_band_min", "threshold_band_max"):
        if key not in result and key in policy:
            result[key] = policy[key]

    return result


def _meaningful_value(*values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            text = value.strip()
            if not text or text == "-":
                continue
            return text
        return value
    return None


def _curve_has_points(curve: Any, x_key: str, y_key: str) -> bool:
    if not isinstance(curve, list) or not curve:
        return False
    for point in curve:
        if not isinstance(point, dict):
            continue
        try:
            float(point.get(x_key))
            float(point.get(y_key))
            return True
        except Exception:
            continue
    return False


def _to_float_or_default(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def _validate_deployable_threshold(threshold: Any) -> float:
    value = _to_float_or_default(threshold, BUSINESS_DEFAULT_THRESHOLD)
    if not (DEPLOYABLE_THRESHOLD_MIN <= value <= DEPLOYABLE_THRESHOLD_MAX):
        raise ValueError(
            f"Deployable threshold must stay within {DEPLOYABLE_THRESHOLD_MIN:.2f}-{DEPLOYABLE_THRESHOLD_MAX:.2f}."
        )
    return float(value)


def _deploy_dir(env_root: Path) -> Path:
    path = env_root / "mlops" / "deployments"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _deployment_file(deploy_dir: Path, deployment_id: str) -> Path:
    return deploy_dir / f"{deployment_id}.json"


def _active_deployment_file(deploy_dir: Path) -> Path:
    return deploy_dir / "_active_deployment.json"


def _load_active_deployment(deploy_dir: Path) -> Optional[Dict[str, Any]]:
    marker = _active_deployment_file(deploy_dir)
    if not marker.exists():
        return None
    try:
        active_meta = json.loads(marker.read_text(encoding="utf-8"))
    except Exception:
        return None
    dep_id = str(active_meta.get("deployment_id") or "").strip()
    if not dep_id:
        return None
    dep_path = _deployment_file(deploy_dir, dep_id)
    if not dep_path.exists():
        return None
    try:
        payload = json.loads(dep_path.read_text(encoding="utf-8"))
        payload["active"] = True
        return payload
    except Exception:
        return None


def _list_deployment_history(deploy_dir: Path) -> List[Dict[str, Any]]:
    active = _load_active_deployment(deploy_dir) or {}
    active_id = str(active.get("deployment_id") or "").strip()
    rows: List[Dict[str, Any]] = []
    for dep_path in sorted(deploy_dir.glob("*.json")):
        if dep_path.name.startswith("_"):
            continue
        try:
            payload = json.loads(dep_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        deployment_id = str(payload.get("deployment_id") or dep_path.stem).strip()
        payload["deployment_id"] = deployment_id
        payload["active"] = deployment_id == active_id
        payload["status"] = "active" if payload["active"] else str(payload.get("status") or "inactive")
        rows.append(payload)
    rows.sort(
        key=lambda row: str(row.get("created_at") or row.get("rolled_back_at") or ""),
        reverse=True,
    )
    return rows


def _set_active_deployment(deploy_dir: Path, deployment_id: str) -> None:
    marker = _active_deployment_file(deploy_dir)
    marker.write_text(
        json.dumps(
            {
                "deployment_id": str(deployment_id),
                "updated_at": datetime.utcnow().isoformat() + "Z",
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def _select_upload_dataset(
    *,
    env_root: Path,
    tenant_id: str,
    env_id: str,
    dataset_id: Optional[int],
    target_column: str,
) -> Optional[Dict]:
    ds_service = _get_dataset_service(env_root)
    if dataset_id:
        return ds_service.get_dataset(tenant_id, env_id, int(dataset_id))

    datasets = ds_service.list_datasets(tenant_id, env_id) or []
    if not datasets:
        return None

    target_norm = str(target_column or "").strip().lower()
    if target_norm:
        for ds in datasets:
            cols = [str(c).lower() for c in (ds.get("columns") or [])]
            if target_norm in cols:
                return ds

    return datasets[0]


# ─────────────────────────────────────────────────────────────────────────────
# ① Training  — POST /api/model-training/train  (unchanged from v3)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/train", methods=["POST"])
def train_model() -> tuple:
    try:
        unsupervised_algorithms = {
            "kmeans",
            "gaussian_mixture",
            "agglomerative_clustering",
            "dbscan",
            "isolation_forest",
            "local_outlier_factor",
            "one_class_svm",
        }
        deep_learning_algorithms = {
            "mlp_classifier",
            "deep_mlp_classifier",
            "tabular_autoencoder",
        }
        body           = request.get_json(silent=True) or {}
        dataset_id     = int(body.get("dataset_id") or 0)
        target_column  = str(body.get("target_column") or "").strip()
        algorithm      = str(body.get("algorithm") or "random_forest").strip().lower()
        requested_mode = str(body.get("mode") or "").strip().lower()
        if not requested_mode:
            if algorithm in unsupervised_algorithms:
                requested_mode = "unsupervised"
            elif algorithm in deep_learning_algorithms:
                requested_mode = "deep_learning"
            else:
                requested_mode = "supervised"
        hyperparams    = body.get("hyperparams") or {}
        test_size      = float(body.get("test_size") or 0.2)
        cv_folds       = int(body.get("cv_folds") or 5)
        stratify       = bool(body.get("stratify", True))
        random_state   = int(body.get("random_state") or 42)
        pipeline_id_raw = body.get("pipeline_id")
        pipeline_id = int(pipeline_id_raw) if pipeline_id_raw not in (None, "", []) else None
        pipeline_name = str(body.get("pipeline_name") or "").strip()
        grain          = str(body.get("grain") or "alert").strip().lower()
        hml_high       = float(body.get("hml_high_threshold") or 0.65)
        hml_low        = float(body.get("hml_low_threshold")  or 0.35)
        split_strategy = str(body.get("split_strategy") or DEFAULT_SPLIT_STRATEGY).strip().lower() or DEFAULT_SPLIT_STRATEGY
        split_date     = body.get("split_date")
        date_column    = str(body.get("date_column") or "ALERT_DATE").strip()

        if not dataset_id:
            return jsonify({"success": False, "error": "dataset_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400
        if requested_mode not in {"supervised", "unsupervised", "deep_learning"}:
            return jsonify({"success": False,
                            "error": "mode must be one of supervised, unsupervised, deep_learning",
                            "error_code": "VALIDATION_ERROR"}), 400
        if grain not in {"account", "alert", "case"}:
            return jsonify({"success": False,
                            "error": f"grain must be 'account', 'alert', or 'case', got '{grain}'",
                            "error_code": "VALIDATION_ERROR"}), 400
        hml_err = _validate_hml_thresholds(hml_high, hml_low)
        if hml_err:
            return jsonify({"success": False, "error": hml_err,
                            "error_code": "VALIDATION_ERROR"}), 400
        if not (0.05 <= test_size <= 0.8):
            return jsonify({"success": False,
                            "error": "test_size must be between 0.05 and 0.8",
                            "error_code": "VALIDATION_ERROR"}), 400
        if cv_folds < 3 or cv_folds > 10:
            return jsonify({"success": False,
                            "error": "cv_folds must be between 3 and 10",
                            "error_code": "VALIDATION_ERROR"}), 400
        if split_strategy not in {"auto", "random", "temporal"}:
            return jsonify({"success": False,
                            "error": "split_strategy must be 'auto', 'random', or 'temporal'",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root          = _resolve_env_path(env_id, tenant_id)
        dataset           = _get_dataset(env_root, tenant_id, env_id, dataset_id)
        resolved_target   = _resolve_target_column(dataset, target_column)
        columns           = [str(c) for c in (dataset.get("columns") or []) if c is not None]

        if not resolved_target and grain == "case":
            for cand in ("case_status", "case_outcome", "closed_sar_filed", "sar_filed"):
                if cand in [c.lower() for c in columns]:
                    resolved_target = next(c for c in columns if c.lower() == cand)
                    break
        if not resolved_target and grain == "account":
            for cand in ("mule_flag", "final_label", "target"):
                if cand in [c.lower() for c in columns]:
                    resolved_target = next(c for c in columns if c.lower() == cand)
                    break

        if not resolved_target:
            return jsonify({"success": False,
                            "error": f"target_column is required for grain='{grain}'.",
                            "error_code": "VALIDATION_ERROR"}), 400

        if columns and resolved_target not in columns:
            preview = ", ".join(columns[:12])
            return jsonify({"success": False,
                            "error": f"target_column '{resolved_target}' not found. Available: {preview}...",
                            "error_code": "VALIDATION_ERROR"}), 400

        trainer = _get_training_service(env_root)
        job_id  = trainer.submit_training_job(
            dataset=dataset, target_column=resolved_target,
            algorithm=algorithm, mode=requested_mode, hyperparams=hyperparams,
            test_size=test_size, cv_folds=cv_folds,
            stratify=stratify, random_state=random_state,
            tenant_id=tenant_id, env_id=env_id,
            pipeline_id=pipeline_id,
            pipeline_name=pipeline_name,
            grain=grain,
            hml_high_threshold=hml_high,
            hml_low_threshold=hml_low,
            split_strategy=split_strategy,
            split_date=(str(split_date).strip() if split_date is not None else None),
            date_column=date_column,
        )

        # Auto-apply label if provided
        custom_label = str(body.get("label") or "").strip()
        if custom_label:
            _set_labels(tenant_id, env_id, {job_id: custom_label})

        return jsonify({"success": True, "data": {
            "job_id":             job_id,
            "status":             "pending",
            "mode":               requested_mode,
            "grain":              grain,
            "split_strategy":     split_strategy,
            "split_date":         (str(split_date).strip() if split_date is not None else None),
            "date_column":        date_column,
            "hml_high_threshold": hml_high,
            "hml_low_threshold":  hml_low,
        }}), 202

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ② Job status  — GET /api/model-training/status/<job_id>  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/workbench/preview", methods=["POST"])
def training_workbench_preview() -> tuple:
    try:
        body = request.get_json(silent=True) or {}
        dataset_id = int(body.get("dataset_id") or 0)
        target_column = str(body.get("target_column") or "").strip()
        mode = str(body.get("mode") or "supervised").strip().lower()
        grain = str(body.get("grain") or "alert").strip().lower()
        supervised_algorithm = str(body.get("supervised_algorithm") or body.get("algorithm") or "random_forest").strip().lower()
        supervised_hyperparams = body.get("supervised_hyperparams") or body.get("hyperparams") or {}
        test_size = float(body.get("test_size") or 0.2)
        stratify = bool(body.get("stratify", True))
        random_state = int(body.get("random_state") or 42)
        sample_index = body.get("sample_index")
        split_strategy = str(body.get("split_strategy") or DEFAULT_SPLIT_STRATEGY).strip().lower() or DEFAULT_SPLIT_STRATEGY
        split_date = body.get("split_date")
        date_column = str(body.get("date_column") or "ALERT_DATE").strip()

        if not dataset_id:
            return jsonify({"success": False, "error": "dataset_id is required", "error_code": "VALIDATION_ERROR"}), 400
        if mode not in {"supervised", "unsupervised", "deep_learning"}:
            return jsonify({"success": False, "error": "mode must be one of supervised, unsupervised, deep_learning", "error_code": "VALIDATION_ERROR"}), 400
        if grain not in {"account", "alert", "case"}:
            return jsonify({"success": False, "error": "grain must be 'account', 'alert', or 'case'", "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        dataset = _get_dataset(env_root, tenant_id, env_id, dataset_id)
        resolved_target = _resolve_target_column(dataset, target_column)
        if not resolved_target:
            return jsonify({"success": False, "error": "target_column is required for training preview", "error_code": "VALIDATION_ERROR"}), 400

        trainer = _get_training_service(env_root)
        preview = trainer.build_training_workbench_preview(
            dataset=dataset,
            target_column=resolved_target,
            mode=mode,
            grain=grain,
            supervised_algorithm=supervised_algorithm,
            supervised_hyperparams=supervised_hyperparams if isinstance(supervised_hyperparams, dict) else {},
            test_size=test_size,
            stratify=stratify,
            random_state=random_state,
            sample_index=(int(sample_index) if sample_index is not None else None),
            split_strategy=split_strategy,
            split_date=(str(split_date).strip() if split_date is not None else None),
            date_column=date_column,
        )
        return jsonify({"success": True, "data": preview}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/status/<job_id>", methods=["GET"])
def job_status(job_id: str) -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        job      = trainer.get_job(str(job_id))
        if not job:
            return jsonify({"success": False, "error": "Job not found",
                            "error_code": "NOT_FOUND"}), 404
        # Backward-compatible status normalization for pollers.
        # Internal trainer uses "complete"; many clients expect "completed".
        if str(job.get("status") or "").lower() == "complete":
            job = dict(job)
            job["raw_status"] = "complete"
            job["status"] = "completed"
        return jsonify({"success": True, "data": job}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ③ Results  — GET /api/model-training/results/<job_id>  (v4: enriched)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/results/<job_id>", methods=["GET"])
def job_results(job_id: str) -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        labels   = _get_labels(tenant_id, env_id)

        result = trainer.get_job_result(str(job_id))
        if result is not None:
            result = _enrich_result_for_workbench(result)
            result["label"] = labels.get(job_id) or result.get("label") or job_id[:8]
            return jsonify({"success": True, "data": result}), 200

        job = trainer.get_job(str(job_id))
        if not job:
            return jsonify({"success": False, "error": "Job not found",
                            "error_code": "NOT_FOUND"}), 404
        if job.get("status") == "failed":
            return jsonify({"success": False, "error": job.get("error") or "Training failed",
                            "error_code": "TRAINING_FAILED", "data": job}), 400
        return jsonify({"success": False, "error": "Job is not complete yet",
                        "error_code": "JOB_NOT_READY", "data": job}), 202

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ④ Threshold re-score  — POST /api/model-training/threshold  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/threshold", methods=["POST"])
def rescore_threshold() -> tuple:
    try:
        body      = request.get_json(silent=True) or {}
        job_id    = str(body.get("job_id") or "").strip()
        threshold = _validate_deployable_threshold(body.get("threshold"))

        if not job_id:
            return jsonify({"success": False, "error": "job_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        result   = trainer.rescore_threshold(job_id, threshold)
        return jsonify({"success": True, "data": result}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑤ HML Rescore  — POST /api/model-training/hml/rescore  (unchanged from v3)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/hml/rescore", methods=["POST"])
def hml_rescore() -> tuple:
    try:
        body           = request.get_json(silent=True) or {}
        job_id         = str(body.get("job_id") or "").strip()
        high_threshold = float(body.get("high_threshold") or 0.65)
        low_threshold  = float(body.get("low_threshold")  or 0.35)

        if not job_id:
            return jsonify({"success": False, "error": "job_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400
        hml_err = _validate_hml_thresholds(high_threshold, low_threshold)
        if hml_err:
            return jsonify({"success": False, "error": hml_err,
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        result   = trainer.rescore_hml(job_id, high_threshold, low_threshold)
        return jsonify({"success": True, "data": result}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑥ Model internals  — GET /api/model-training/internals/<job_id>  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/internals/<job_id>", methods=["GET"])
def model_internals(job_id: str) -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        result   = trainer.model_internals(str(job_id))
        return jsonify({"success": True, "data": result}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "NOT_FOUND"}), 404
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑦ Ledger score  — POST /api/model-training/ledger/score  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/ledger/score", methods=["POST"])
def ledger_score() -> tuple:
    try:
        body           = request.get_json(silent=True) or {}
        job_id         = str(body.get("job_id") or "").strip()
        rows           = body.get("rows") or []
        grain          = str(body.get("grain") or "alert").strip().lower()
        high_threshold = float(body.get("hml_high_threshold") or 0.65)
        low_threshold  = float(body.get("hml_low_threshold")  or 0.35)

        if not job_id:
            return jsonify({"success": False, "error": "job_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400
        if not isinstance(rows, list) or not rows:
            return jsonify({"success": False, "error": "rows must be a non-empty array",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        result   = trainer.score_and_ledger(
            job_id=job_id, rows=rows,
            tenant_id=tenant_id, env_id=env_id,
            grain=grain,
            hml_high_threshold=high_threshold,
            hml_low_threshold=low_threshold,
        )
        return jsonify({"success": True, "data": result}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑧ Ledger query  — GET /api/model-training/ledger  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/ledger", methods=["GET"])
def list_ledger() -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root     = _resolve_env_path(env_id, tenant_id)
        trainer      = _get_training_service(env_root)
        job_id       = request.args.get("job_id") or None
        grain        = request.args.get("grain")  or None
        hml_decision = request.args.get("hml_decision") or None
        entity_id    = request.args.get("entity_id") or None
        limit        = min(int(request.args.get("limit") or 200), 2000)
        offset       = int(request.args.get("offset") or 0)
        result = trainer.list_ledger(
            job_id=job_id, tenant_id=tenant_id, env_id=env_id,
            grain=grain, hml_decision=hml_decision,
            entity_id=entity_id, limit=limit, offset=offset,
        )
        return jsonify({"success": True, "data": result}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑨ Export  — POST /api/model-training/export  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/export", methods=["POST"])
def export_model() -> tuple:
    try:
        body   = request.get_json(silent=True) or {}
        job_id = str(body.get("job_id") or "").strip()
        if not job_id:
            return jsonify({"success": False, "error": "job_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        result   = trainer.export_model(job_id)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑩ Validation report  — POST /api/model-training/validation/report  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/validation/report", methods=["POST"])
def validation_report() -> tuple:
    try:
        body               = request.get_json(silent=True) or {}
        job_id             = str(body.get("job_id") or "").strip()
        max_event_loss_pct = float(body.get("max_event_loss_pct") or 5.0)
        thresholds         = body.get("thresholds")
        optimization_mode  = str(body.get("optimization_mode") or "max_suppression_under_event_loss").strip().lower()
        target_supp_pct    = body.get("target_suppression_pct")
        target_tol_pct     = float(body.get("target_tolerance_pct") or 2.0)

        if not job_id:
            return jsonify({"success": False, "error": "job_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400
        if target_supp_pct is not None:
            target_supp_pct = float(target_supp_pct)
            if not (0 <= target_supp_pct <= 100):
                return jsonify({"success": False,
                                "error": "target_suppression_pct must be in [0, 100]",
                                "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        validator = _get_validation_service(env_root)
        result    = validator.validation_report(
            job_id=job_id,
            max_event_loss_pct=max_event_loss_pct,
            thresholds=thresholds if isinstance(thresholds, list) else None,
            optimization_mode=optimization_mode,
            target_suppression_pct=target_supp_pct,
            target_tolerance_pct=target_tol_pct,
        )
        try:
            validator.training.persist_validation_payload(
                job_id,
                {
                    "report": dict(result),
                    "selected_threshold": result.get("selected_threshold") or result.get("configured_threshold"),
                    "locked_threshold": result.get("locked_threshold") or result.get("selected_threshold") or result.get("configured_threshold"),
                    "recommended_threshold": result.get("optimal_threshold"),
                },
                merge=True,
            )
        except Exception:
            pass
        return jsonify({"success": True, "data": result}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑩-b Multi-model validation  — POST /api/model-training/validation/compare  (NEW v4)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/validation/compare", methods=["POST"])
def validation_compare() -> tuple:
    """
    Run validation/report for multiple jobs simultaneously.

    Body:
      job_ids              list[str]  required  (1–10 job IDs)
      max_event_loss_pct   float      default 5.0
      optimization_mode    str        default 'max_suppression_under_event_loss'
      target_suppression_pct  float   optional

    Returns:
      {
        results: { job_id: validation_report, ... },
        errors:  { job_id: error_message, ... }
      }
    """
    try:
        body               = request.get_json(silent=True) or {}
        job_ids            = body.get("job_ids") or []
        max_event_loss_pct = float(body.get("max_event_loss_pct") or 5.0)
        optimization_mode  = str(body.get("optimization_mode") or "max_suppression_under_event_loss").strip().lower()
        target_supp_pct    = body.get("target_suppression_pct")

        if not isinstance(job_ids, list) or not job_ids:
            return jsonify({"success": False, "error": "job_ids must be a non-empty list",
                            "error_code": "VALIDATION_ERROR"}), 400
        if len(job_ids) > 10:
            return jsonify({"success": False, "error": "Maximum 10 job_ids per request",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        validator = _get_validation_service(env_root)
        labels   = _get_labels(tenant_id, env_id)

        compare = validator.validation_compare(
            job_ids=[str(j) for j in job_ids],
            max_event_loss_pct=max_event_loss_pct,
            optimization_mode=optimization_mode,
            target_suppression_pct=float(target_supp_pct) if target_supp_pct is not None else None,
        )
        results = compare.get("results", {})
        errors  = compare.get("errors", {})

        for jid, r in results.items():
            r["label"] = labels.get(jid, jid[:8])

        return jsonify({
            "success": True,
            "data": {"results": results, "errors": errors},
        }), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑪ Registry CRUD  (all unchanged from v3)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/validation/detail/<job_id>", methods=["GET"])
def validation_detail(job_id: str) -> tuple:
    """
    Compact visual payload for rich validation dashboards.

    Returns score-distribution bins, business-readable confusion context,
    and top feature rows without exposing raw holdout arrays to the client.
    """
    try:
        bins = max(8, min(int(request.args.get("bins") or 20), 50))
        threshold_arg = request.args.get("threshold")

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer = _get_training_service(env_root)
        dataset_service = _get_dataset_service(env_root)
        labels = _get_labels(tenant_id, env_id)

        result = trainer.get_job_result(str(job_id))
        if result is None:
            job = trainer.get_job(str(job_id))
            if not job:
                return jsonify({"success": False, "error": "Job not found", "error_code": "NOT_FOUND"}), 404
            return jsonify({
                "success": False,
                "error": "Job is not complete yet",
                "error_code": "JOB_NOT_READY",
                "data": job,
            }), 202

        result = _enrich_result_for_workbench(result)
        result["label"] = labels.get(job_id) or result.get("label") or job_id[:8]

        y_true, y_prob, score_source = _load_validation_scores(
            trainer,
            dataset_service,
            str(job_id),
        )

        validation = {}
        try:
            validation = trainer.validation_report(str(job_id), max_event_loss_pct=5.0)
        except Exception:
            validation = {}

        persisted_validation = result.get("validation") if isinstance(result.get("validation"), dict) else {}
        selected_threshold = _to_float_or_default(
            threshold_arg,
            _to_float_or_default(
                persisted_validation.get("selected_threshold"),
                _to_float_or_default(
                    result.get("selected_threshold"),
                    _to_float_or_default(
                        validation.get("selected_threshold") or validation.get("configured_threshold"),
                        _to_float_or_default(
                            validation.get("optimal_threshold"),
                            _to_float_or_default(
                                result.get("optimal_threshold"),
                                BUSINESS_DEFAULT_THRESHOLD,
                            ),
                        ),
                    ),
                ),
            ),
        )

        metrics = result.get("metrics", {}) if isinstance(result.get("metrics"), dict) else {}
        confusion_matrix = (
            validation.get("confusion_matrix")
            or result.get("confusion_matrix")
            or metrics.get("confusion_matrix")
            or [[0, 0], [0, 0]]
        )
        tn = int((confusion_matrix or [[0, 0], [0, 0]])[0][0] if len(confusion_matrix) > 0 and len(confusion_matrix[0]) > 0 else 0)
        fp = int((confusion_matrix or [[0, 0], [0, 0]])[0][1] if len(confusion_matrix) > 0 and len(confusion_matrix[0]) > 1 else 0)
        fn = int((confusion_matrix or [[0, 0], [0, 0]])[1][0] if len(confusion_matrix) > 1 and len(confusion_matrix[1]) > 0 else 0)
        tp = int((confusion_matrix or [[0, 0], [0, 0]])[1][1] if len(confusion_matrix) > 1 and len(confusion_matrix[1]) > 1 else 0)

        feature_rows = result.get("feature_importance") or []
        internals = result.get("model_internals") if isinstance(result.get("model_internals"), dict) else {}
        if not feature_rows and internals.get("viz_type") == "feature_importance":
            feature_rows = internals.get("data") or []
        feature_rows = list(feature_rows or [])[:15]

        score_distribution = _build_score_distribution(y_true, y_prob, bins=bins)

        return jsonify({
            "success": True,
            "data": {
                "job_id": str(job_id),
                "label": result.get("label"),
                "algorithm": result.get("algorithm"),
                "selected_threshold": round(float(selected_threshold), 4),
                "recommended_threshold": validation.get("optimal_threshold"),
                "configured_threshold": validation.get("configured_threshold") or result.get("configured_threshold"),
                "business_summary": persisted_validation.get("business_summary"),
                "score_distribution": score_distribution,
                "score_distribution_source": score_source,
                "score_distribution_reason": (
                    None
                    if score_distribution.get("bins")
                    else "Saved holdout score vectors were not found for this historical run. Re-running validation will repopulate the score-distribution chart."
                ),
                "feature_importance": feature_rows,
                "confusion_matrix": confusion_matrix,
                "confusion_matrix_business_explainer": (
                    f"{tp:,} suspicious cases were correctly escalated (true positive), "
                    f"{tn:,} low-value alerts were correctly set aside (true negative), "
                    f"{fp:,} alerts were escalated unnecessarily (false positive), and "
                    f"{fn:,} suspicious cases were missed by the cut-off (false negative)."
                ),
            },
        }), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/validation/explain", methods=["POST"])
def validation_explain() -> tuple:
    """
    Deterministic-first validation explanation with optional local LLM rewrite.
    """
    try:
        body = request.get_json(silent=True) or {}
        fallback = _build_validation_explain_fallback(body)
        result = _maybe_upgrade_validation_explanation(body, fallback)
        job_id = str(body.get("job_id") or "").strip()
        if job_id and body.get("persist", True):
            tenant_id, env_id = _get_env_ids()
            env_root = _resolve_env_path(env_id, tenant_id)
            trainer = _get_training_service(env_root)
            trainer.persist_validation_payload(
                job_id,
                {
                    "business_summary": {
                        **dict(result),
                        "workflow_steps": body.get("workflow_steps") if isinstance(body.get("workflow_steps"), list) else [],
                        "conclusion": str(body.get("conclusion") or "").strip(),
                        "generated_for": str(body.get("generated_for") or body.get("analysis_scope") or "model_validation_summary").strip(),
                        "summary_metadata": body.get("summary_metadata") if isinstance(body.get("summary_metadata"), dict) else {},
                    },
                },
                merge=True,
            )
            result = {**dict(result), "saved": True}
        return jsonify({"success": True, "data": result}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/release/business-summary", methods=["POST"])
def release_business_summary() -> tuple:
    """
    Deterministic-first business summary for model release with optional local LLM rewrite.
    """
    try:
        body = request.get_json(silent=True) or {}
        fallback = _build_release_summary_fallback(body)
        result = _maybe_upgrade_release_summary(body, fallback)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/registry", methods=["GET"])
def list_registry() -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        labels   = _get_labels(tenant_id, env_id)
        result   = trainer.list_registry(tenant_id=tenant_id, env_id=env_id)
        for r in result:
            _enrich_run_with_label(r, labels)
        return jsonify({"success": True, "data": result}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/registry/<job_id>", methods=["GET"])
def get_registry_entry(job_id: str) -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        labels   = _get_labels(tenant_id, env_id)
        result   = trainer.get_registry_entry(str(job_id), tenant_id=tenant_id, env_id=env_id)
        _enrich_run_with_label(result, labels)
        return jsonify({"success": True, "data": result}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "NOT_FOUND"}), 404
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/registry/register", methods=["POST"])
def register_registry_entry() -> tuple:
    try:
        body   = request.get_json(silent=True) or {}
        job_id = str(body.get("job_id") or "").strip()
        if not job_id:
            return jsonify({"success": False, "error": "job_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        selected_threshold = body.get("selected_threshold")
        if selected_threshold is not None:
            selected_threshold = _validate_deployable_threshold(selected_threshold)
        result   = trainer.register_model(
            job_id=job_id, tenant_id=tenant_id, env_id=env_id,
            model_name=body.get("model_name"),
            stage=body.get("stage") or "candidate",
            selected_threshold=selected_threshold,
            max_event_loss_pct=body.get("max_event_loss_pct"),
            validation=body.get("validation") or {},
            tags=body.get("tags") if isinstance(body.get("tags"), list) else [],
            notes=str(body.get("notes") or ""),
            grain=body.get("grain") or None,
            hml_high_threshold=body.get("hml_high_threshold") or None,
            hml_low_threshold=body.get("hml_low_threshold")  or None,
            source=body.get("source") or "trained",
            change_reason=str(body.get("reason") or body.get("change_reason") or ""),
            changed_by=str(body.get("changed_by") or body.get("archived_by") or ""),
        )
        # Persist label if provided
        custom_label = str(body.get("label") or body.get("model_name") or "").strip()
        if custom_label:
            _set_labels(tenant_id, env_id, {job_id: custom_label})

        return jsonify({"success": True, "data": result}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/registry/<job_id>/stage", methods=["POST"])
def update_registry_stage(job_id: str) -> tuple:
    try:
        body  = request.get_json(silent=True) or {}
        stage = str(body.get("stage") or "").strip().lower()
        if not stage:
            return jsonify({"success": False, "error": "stage is required",
                            "error_code": "VALIDATION_ERROR"}), 400
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        result   = trainer.update_registry_stage(
            job_id=str(job_id),
            tenant_id=tenant_id,
            env_id=env_id,
            stage=stage,
            reason=str(body.get("reason") or ""),
            notes=str(body.get("notes") or ""),
            changed_by=str(body.get("changed_by") or body.get("archived_by") or ""),
        )
        return jsonify({"success": True, "data": result}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/registry/stage", methods=["PUT"])
def update_registry_stage_bulk() -> tuple:
    """
    Compatibility alias for clients that send:
      PUT /api/model-training/registry/stage
      { job_id, stage, reason?, notes?, changed_by? }
    """
    try:
        body = request.get_json(silent=True) or {}
        job_id = str(body.get("job_id") or "").strip()
        stage = str(body.get("stage") or "").strip().lower()
        if not job_id or not stage:
            return jsonify(
                {
                    "success": False,
                    "error": "job_id and stage are required",
                    "error_code": "VALIDATION_ERROR",
                }
            ), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer = _get_training_service(env_root)
        result = trainer.update_registry_stage(
            job_id=job_id,
            tenant_id=tenant_id,
            env_id=env_id,
            stage=stage,
            reason=str(body.get("reason") or ""),
            notes=str(body.get("notes") or ""),
            changed_by=str(body.get("changed_by") or body.get("archived_by") or ""),
        )
        return jsonify({"success": True, "data": result}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/registry/audit-log", methods=["GET"])
def registry_audit_log() -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer = _get_training_service(env_root)
        limit = int(request.args.get("limit") or 50)
        rows = trainer.list_registry_audit_log(
            tenant_id=tenant_id,
            env_id=env_id,
            limit=limit,
        )
        return jsonify({"success": True, "data": rows}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/registry/upload-pkl", methods=["POST"])
def registry_upload_pkl() -> tuple:
    """
    Upload an external .pkl model and register it as a comparable run.

    Multipart form fields:
      file           required
      model_name     optional
      target_column  optional (strongly recommended)
      dataset_id     optional (defaults to latest dataset in env)
      threshold      optional (default 0.50)
      stage          optional (candidate/challenger/champion)
      notes          optional
      grain          optional (alert/case; default alert)
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer = _get_training_service(env_root)

        file = request.files.get("file")
        if not file:
            return jsonify({"success": False, "error": "file is required", "error_code": "VALIDATION_ERROR"}), 400

        filename = str(file.filename or "").strip()
        if not filename.lower().endswith(".pkl"):
            return jsonify({"success": False, "error": "Only .pkl files are supported", "error_code": "VALIDATION_ERROR"}), 400

        model_name = str(request.form.get("model_name") or Path(filename).stem).strip()
        target_column = str(request.form.get("target_column") or "").strip()
        stage = str(request.form.get("stage") or "candidate").strip().lower()
        notes = str(request.form.get("notes") or "Uploaded external model").strip()
        grain = str(request.form.get("grain") or "alert").strip().lower()
        threshold = _validate_deployable_threshold(request.form.get("threshold"))
        hml_high_threshold = float(request.form.get("hml_high_threshold") or 0.65)
        hml_low_threshold = float(request.form.get("hml_low_threshold") or 0.35)
        test_size = float(request.form.get("test_size") or 0.2)
        random_state = int(request.form.get("random_state") or 42)
        stratify = str(request.form.get("stratify") or "true").strip().lower() not in {"0", "false", "no", "off"}
        pipeline_id_raw = request.form.get("pipeline_id")
        pipeline_id = int(pipeline_id_raw) if str(pipeline_id_raw or "").strip() else None
        pipeline_name = str(request.form.get("pipeline_name") or "").strip()
        dataset_id_raw = request.form.get("dataset_id")
        dataset_id = int(dataset_id_raw) if str(dataset_id_raw or "").strip() else None

        upload_dir = env_root / "mlops" / "models" / "uploaded_raw"
        upload_dir.mkdir(parents=True, exist_ok=True)
        raw_path = upload_dir / f"{Path(filename).stem}_{uuid.uuid4().hex[:10]}.pkl"
        file.save(str(raw_path))

        dataset: Optional[Dict[str, Any]] = None
        manual_dataset_path = str(request.form.get("dataset_file_path") or "").strip()
        if manual_dataset_path:
            manual_fp = Path(manual_dataset_path)
            if not manual_fp.is_absolute():
                manual_fp = (env_root / manual_fp).resolve()
            if not manual_fp.exists():
                return jsonify(
                    {
                        "success": False,
                        "error": f"dataset_file_path not found: {manual_fp}",
                        "error_code": "VALIDATION_ERROR",
                    }
                ), 400
            dataset = {
                "dataset_id": int(dataset_id or 0),
                "tenant_id": tenant_id,
                "env_id": env_id,
                "dataset_type": str(request.form.get("dataset_type") or "external"),
                "filename": manual_fp.name,
                "file_path": str(manual_fp),
                "row_count": None,
                "columns": [],
                "column_types": {},
            }
        else:
            dataset = _select_upload_dataset(
                env_root=env_root,
                tenant_id=tenant_id,
                env_id=env_id,
                dataset_id=dataset_id,
                target_column=target_column,
            )
        if not dataset:
            return jsonify(
                {
                    "success": False,
                    "error": "No dataset available in this environment. Upload/select a dataset first.",
                    "error_code": "VALIDATION_ERROR",
                }
            ), 400

        resolved_target = _resolve_target_column(dataset, target_column)
        if not resolved_target:
            return jsonify(
                {
                    "success": False,
                    "error": "target_column is required or must be inferable from the selected dataset.",
                    "error_code": "VALIDATION_ERROR",
                }
            ), 400

        imported = trainer.import_external_model(
            file_path=str(raw_path),
            dataset=dataset,
            target_column=resolved_target,
            tenant_id=tenant_id,
            env_id=env_id,
            model_name=model_name,
            stage=stage,
            notes=notes,
            selected_threshold=threshold,
            grain=grain,
            hml_high_threshold=hml_high_threshold,
            hml_low_threshold=hml_low_threshold,
            test_size=test_size,
            stratify=stratify,
            random_state=random_state,
            pipeline_id=pipeline_id,
            pipeline_name=pipeline_name,
            changed_by=str(request.form.get("changed_by") or request.form.get("uploaded_by") or ""),
        )

        return jsonify({"success": True, "data": imported}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑫ Compare  — POST /api/model-training/compare  (v4: full detail for workbench)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/compare", methods=["POST"])
def compare_runs() -> tuple:
    """
    Side-by-side comparison of multiple training runs.

    Body: { job_ids: [str, ...] }

    Returns full per-model data for the workbench comparison tab:
      - All metrics (roc_auc, f1, precision, recall, cv_auc_mean, etc.)
      - roc_curve, pr_curve arrays
      - feature_importance
      - confusion_matrix at optimal threshold
      - threshold_table (first 20 rows)
      - operational metrics (suppression_rate_pct, event_loss_pct)
      - hml_summary
      - label, algorithm_display
    """
    try:
        body    = request.get_json(silent=True) or {}
        job_ids = body.get("job_ids") or []
        if not isinstance(job_ids, list):
            return jsonify({"success": False, "error": "job_ids must be an array",
                            "error_code": "VALIDATION_ERROR"}), 400
        if len(job_ids) > 10:
            return jsonify({"success": False, "error": "Maximum 10 job_ids per compare call",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        labels   = _get_labels(tenant_id, env_id)

        out    = []
        errors = {}

        for jid in job_ids:
            try:
                result = trainer.get_job_result(str(jid))
                if not result:
                    errors[jid] = "Not found or not complete"
                    continue

                result = _enrich_result_for_workbench(result)
                m = result.get("metrics", {})
                validation = {}
                try:
                    validation = trainer.validation_report(str(jid), max_event_loss_pct=5.0)
                except Exception:
                    validation = {}

                selected_threshold = _to_float_or_default(
                    _meaningful_value(
                        result.get("selected_threshold"),
                        result.get("optimal_threshold"),
                        m.get("optimal_threshold"),
                        validation.get("optimal_threshold"),
                    ),
                    0.5,
                )
                display_threshold = _to_float_or_default(
                    _meaningful_value(
                        validation.get("optimal_threshold"),
                        result.get("optimal_threshold"),
                        m.get("optimal_threshold"),
                        selected_threshold,
                    ),
                    selected_threshold,
                )

                # Slim the threshold table for comparison (keep all columns, limit rows)
                threshold_table = validation.get("threshold_table") or result.get("threshold_table") or m.get("threshold_table") or []
                selected_row = _closest_threshold_row(threshold_table, display_threshold)

                preview = {}
                need_preview = (
                    not _curve_has_points(result.get("roc_curve"), "fpr", "tpr")
                    and not _curve_has_points(m.get("roc_curve"), "fpr", "tpr")
                ) or (
                    not _curve_has_points(result.get("pr_curve"), "recall", "precision")
                    and not _curve_has_points(m.get("pr_curve"), "recall", "precision")
                ) or not threshold_table
                if need_preview:
                    try:
                        y_true, y_prob = trainer._load_scores(str(jid))
                        preview = _classification_preview_metrics(y_true, y_prob, threshold=display_threshold)
                    except Exception:
                        preview = {}

                if not threshold_table:
                    threshold_table = preview.get("threshold_table") or []
                if not selected_row:
                    selected_row = _closest_threshold_row(threshold_table, display_threshold)
                threshold_table = threshold_table[:25]  # First 25 rows are sufficient for comparison

                roc_auc = _meaningful_value(m.get("roc_auc"), preview.get("roc_auc"))
                average_precision = _meaningful_value(
                    m.get("average_precision"),
                    m.get("pr_auc"),
                    preview.get("pr_auc"),
                )
                precision = _meaningful_value(
                    validation.get("precision"),
                    selected_row.get("precision"),
                    result.get("precision"),
                    m.get("precision"),
                    preview.get("precision"),
                )
                recall = _meaningful_value(
                    validation.get("recall"),
                    selected_row.get("recall"),
                    result.get("recall"),
                    m.get("recall"),
                    preview.get("recall"),
                )
                f1 = _meaningful_value(
                    validation.get("f1"),
                    selected_row.get("f1"),
                    result.get("f1"),
                    m.get("f1"),
                    preview.get("f1"),
                )
                accuracy = _meaningful_value(
                    validation.get("accuracy"),
                    selected_row.get("accuracy"),
                    m.get("accuracy"),
                    preview.get("accuracy"),
                )
                balanced_accuracy = _meaningful_value(
                    validation.get("balanced_accuracy"),
                    selected_row.get("balanced_accuracy"),
                    m.get("balanced_accuracy"),
                    preview.get("balanced_accuracy"),
                )
                specificity = _meaningful_value(
                    validation.get("specificity"),
                    selected_row.get("specificity"),
                    result.get("specificity"),
                    m.get("specificity"),
                    preview.get("specificity"),
                )
                suppression_rate_pct = _meaningful_value(
                    validation.get("suppression_rate_pct"),
                    selected_row.get("suppression_rate_pct"),
                    selected_row.get("suppression_rate"),
                    result.get("suppression_rate_pct"),
                    m.get("suppression_rate_pct"),
                )
                event_loss_pct = _meaningful_value(
                    validation.get("event_loss_pct"),
                    selected_row.get("event_loss_pct"),
                    result.get("event_loss_pct"),
                    m.get("event_loss_pct"),
                )
                gini = _meaningful_value(
                    m.get("gini"),
                    round((2.0 * float(roc_auc)) - 1.0, 4) if roc_auc is not None else None,
                )
                roc_curve = result.get("roc_curve") or m.get("roc_curve") or preview.get("roc_curve") or []
                pr_curve = result.get("pr_curve") or m.get("pr_curve") or preview.get("pr_curve") or []
                confusion_matrix = (
                    validation.get("confusion_matrix")
                    or result.get("confusion_matrix")
                    or m.get("confusion_matrix")
                    or preview.get("confusion_matrix")
                )

                entry = {
                    "job_id":               jid,
                    "label":                labels.get(jid) or result.get("label") or jid[:8],
                    "algorithm":            result.get("algorithm", ""),
                    "algorithm_display":    _enrich_run_with_label({
                                                "job_id": jid, "algorithm": result.get("algorithm", "")
                                            }, {}).get("algorithm_display", ""),
                    "grain":                result.get("grain", "alert"),
                    "trained_at":           result.get("trained_at"),
                    "metrics": {
                        "roc_auc":           roc_auc,
                        "average_precision": average_precision,
                        "f1":                f1,
                        "precision":         precision,
                        "recall":            recall,
                        "accuracy":          accuracy,
                        "balanced_accuracy": balanced_accuracy,
                        "specificity":       specificity,
                        "gini":              gini,
                        "cv_auc_mean":       m.get("cv_auc_mean"),
                        "cv_auc_std":        m.get("cv_auc_std"),
                        "cv_f1_mean":        m.get("cv_f1_mean"),
                        "cv_f1_std":         m.get("cv_f1_std"),
                        "brier_score":       m.get("brier_score"),
                        "log_loss":          m.get("log_loss"),
                        "optimal_threshold": display_threshold,
                        "suppression_rate_pct": suppression_rate_pct,
                        "event_loss_pct":    event_loss_pct,
                    },
                    "roc_curve":            roc_curve,
                    "pr_curve":             pr_curve,
                    "feature_importance":   result.get("feature_importance", [])[:20],
                    "confusion_matrix":     confusion_matrix,
                    "selected_threshold":   selected_threshold,
                    "optimal_threshold":    display_threshold,
                    "suppression_rate_pct": suppression_rate_pct,
                    "event_loss_pct":       event_loss_pct,
                    "precision":            precision,
                    "recall":               recall,
                    "f1":                   f1,
                    "specificity":          specificity,
                    "threshold_table":      threshold_table,
                    "hml_summary":          result.get("hml_summary"),
                    "hml_high_threshold":   result.get("hml_high_threshold"),
                    "hml_low_threshold":    result.get("hml_low_threshold"),
                }
                out.append(entry)
            except Exception as exc:
                errors[jid] = str(exc)

        return jsonify({"success": True, "data": out, "errors": errors}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑬ List runs  — GET /api/model-training/runs  (v4: enriched)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/runs", methods=["GET"])
def list_runs() -> tuple:
    """
    List completed training runs.

    Query params:
      dataset_id   optional int    filter by dataset
      limit        default 200

    Now returns enriched fields:
      label, algorithm_display, metrics.roc_auc, metrics.f1, trained_at, registry_stage
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root   = _resolve_env_path(env_id, tenant_id)
        trainer    = _get_training_service(env_root)
        dataset_svc = _get_dataset_service(env_root)
        labels     = _get_labels(tenant_id, env_id)
        dataset_id = request.args.get("dataset_id")
        pipeline_id = request.args.get("pipeline_id")
        limit      = int(request.args.get("limit") or 200)
        result     = trainer.list_runs(
            tenant_id=tenant_id, env_id=env_id,
            dataset_id=int(dataset_id) if dataset_id else None,
            limit=limit,
        )
        if pipeline_id:
            pipeline_job_ids = set(
                dataset_svc.list_pipeline_training_job_ids(
                    tenant_id=tenant_id,
                    env_id=env_id,
                    pipeline_id=int(pipeline_id),
                )
            )
            result = [
                row for row in result
                if str(row.get("job_id") or row.get("run_id") or "").strip() in pipeline_job_ids
            ]
        for r in result:
            _enrich_run_with_label(r, labels)
        return jsonify({"success": True, "data": result}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑭ Deploy  — POST /api/model-training/deploy  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/deploy", methods=["POST"])
def deploy_model() -> tuple:
    try:
        body = request.get_json(silent=True) or {}
        job_id = str(body.get("job_id") or "").strip()
        threshold = _validate_deployable_threshold(body.get("threshold"))

        if not job_id:
            return jsonify({"success": False, "error": "job_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer = _get_training_service(env_root)
        result = trainer.get_job_result(job_id)
        try:
            registry_entry = trainer.get_registry_entry(job_id, tenant_id=tenant_id, env_id=env_id)
        except Exception:
            registry_entry = None

        if result is None:
            return jsonify({"success": False, "error": "Job not found or not complete",
                            "error_code": "NOT_READY"}), 400
        if not registry_entry:
            return jsonify({
                "success": False,
                "error": "Model must be registered before deployment.",
                "error_code": "REGISTRATION_REQUIRED",
            }), 400
        registry_stage = str(registry_entry.get("stage") or "").strip().lower()
        if registry_stage in {"draft", "archived"}:
            return jsonify({
                "success": False,
                "error": f"Model cannot be deployed from registry stage '{registry_stage}'. Promote it to Candidate or Champion first.",
                "error_code": "INVALID_REGISTRY_STAGE",
            }), 400
        quality_review = result.get("quality_review") if isinstance(result, dict) else {}
        if isinstance(quality_review, dict) and quality_review.get("blocking"):
            return jsonify({
                "success": False,
                "error": "Deploy blocked because the run was flagged by the training quality guard. Review leakage / score behaviour first.",
                "error_code": "QUALITY_GUARD_BLOCK",
                "findings": quality_review.get("findings") or [],
            }), 400

        deploy_dir = _deploy_dir(env_root)
        current_active = _load_active_deployment(deploy_dir)
        previous_deployment_id = (current_active or {}).get("deployment_id")

        deployment_id = str(uuid.uuid4())
        payload = {
            "deployment_id": deployment_id,
            "job_id": job_id,
            "threshold": threshold,
            "grain": result.get("grain", "alert"),
            "hml_high_threshold": result.get("hml_high_threshold", 0.65),
            "hml_low_threshold": result.get("hml_low_threshold",  0.35),
            "created_at": datetime.utcnow().isoformat() + "Z",
            "algorithm": result.get("algorithm"),
            "target_column": result.get("target_column"),
            "id_column": result.get("id_column"),
            "deployment_name": str(body.get("deployment_name") or f"deployment_{job_id[:8]}"),
            "entity_type": str(body.get("entity_type") or "alert"),
            "scoring_mode": str(body.get("scoring_mode") or "real_time"),
            "notes": str(body.get("notes") or ""),
            "previous_deployment_id": previous_deployment_id,
            "status": "active",
        }
        _deployment_file(deploy_dir, deployment_id).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        _set_active_deployment(deploy_dir, deployment_id)
        return jsonify({"success": True, "data": payload}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/deployments/active", methods=["GET"])
def get_active_deployment() -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        deploy_dir = _deploy_dir(env_root)
        active = _load_active_deployment(deploy_dir)
        return jsonify({"success": True, "data": active}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/deployments/history", methods=["GET"])
def get_deployment_history() -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        deploy_dir = _deploy_dir(env_root)
        history = _list_deployment_history(deploy_dir)
        return jsonify({"success": True, "data": history}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/deployments/swap", methods=["POST"])
def swap_deployment() -> tuple:
    """
    Atomically switch active deployment to a new model run.
    Body: { new_job_id, threshold?, deployment_name?, entity_type?, scoring_mode?, notes?, validation_only? }
    """
    try:
        body = request.get_json(silent=True) or {}
        new_job_id = str(body.get("new_job_id") or body.get("job_id") or "").strip()
        threshold = _validate_deployable_threshold(body.get("threshold"))
        validation_raw = body.get("validation_only", False)
        if isinstance(validation_raw, str):
            validation_only = validation_raw.strip().lower() in {"1", "true", "yes", "on"}
        else:
            validation_only = bool(validation_raw)

        if not new_job_id:
            return jsonify({"success": False, "error": "new_job_id is required", "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer = _get_training_service(env_root)
        result = trainer.get_job_result(new_job_id)
        try:
            registry_entry = trainer.get_registry_entry(new_job_id, tenant_id=tenant_id, env_id=env_id)
        except Exception:
            registry_entry = None
        if result is None:
            return jsonify({"success": False, "error": "new_job_id not found or not complete", "error_code": "NOT_READY"}), 400
        if not registry_entry and not validation_only:
            return jsonify({
                "success": False,
                "error": "Model must be registered before creating a deployment version.",
                "error_code": "REGISTRATION_REQUIRED",
            }), 400
        registry_stage = str(registry_entry.get("stage") or "").strip().lower() if registry_entry else ""
        if registry_entry and registry_stage in {"draft", "archived"} and not validation_only:
            return jsonify({
                "success": False,
                "error": f"Model cannot create a deployment version from registry stage '{registry_stage}'.",
                "error_code": "INVALID_REGISTRY_STAGE",
            }), 400
        quality_review = result.get("quality_review") if isinstance(result, dict) else {}
        if isinstance(quality_review, dict) and quality_review.get("blocking"):
            return jsonify({
                "success": False,
                "error": "Deployment swap blocked because the selected run failed the training quality guard.",
                "error_code": "QUALITY_GUARD_BLOCK",
                "findings": quality_review.get("findings") or [],
            }), 400

        deploy_dir = _deploy_dir(env_root)
        current_active = _load_active_deployment(deploy_dir)
        previous_deployment_id = (current_active or {}).get("deployment_id")

        deployment_id = str(uuid.uuid4())
        payload = {
            "deployment_id": deployment_id,
            "job_id": new_job_id,
            "threshold": threshold,
            "grain": result.get("grain", "alert"),
            "hml_high_threshold": result.get("hml_high_threshold", 0.65),
            "hml_low_threshold": result.get("hml_low_threshold",  0.35),
            "created_at": datetime.utcnow().isoformat() + "Z",
            "algorithm": result.get("algorithm"),
            "target_column": result.get("target_column"),
            "id_column": result.get("id_column"),
            "deployment_name": str(body.get("deployment_name") or f"swap_{new_job_id[:8]}"),
            "entity_type": str(body.get("entity_type") or "alert"),
            "scoring_mode": str(body.get("scoring_mode") or "real_time"),
            "notes": str(body.get("notes") or ""),
            "previous_deployment_id": previous_deployment_id,
            "status": "active",
            "action": "validation_swap" if validation_only else "swap",
            "validation_only": validation_only,
        }
        _deployment_file(deploy_dir, deployment_id).write_text(json.dumps(payload, indent=2), encoding="utf-8")
        _set_active_deployment(deploy_dir, deployment_id)
        return jsonify({"success": True, "data": payload}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


@model_training_bp.route("/deployments/rollback", methods=["POST"])
def rollback_deployment() -> tuple:
    """
    Roll active deployment back to the previous deployment in the chain.
    Body: { deployment_id? }  # optional explicit target deployment
    """
    try:
        body = request.get_json(silent=True) or {}
        explicit_target = str(body.get("deployment_id") or "").strip()

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        deploy_dir = _deploy_dir(env_root)

        active = _load_active_deployment(deploy_dir)
        if not active:
            return jsonify({"success": False, "error": "No active deployment to roll back", "error_code": "NOT_FOUND"}), 404

        target_id = explicit_target or str(active.get("previous_deployment_id") or "").strip()
        if not target_id:
            return jsonify({"success": False, "error": "No previous deployment available for rollback", "error_code": "VALIDATION_ERROR"}), 400

        target_file = _deployment_file(deploy_dir, target_id)
        if not target_file.exists():
            return jsonify({"success": False, "error": f"Rollback target '{target_id}' not found", "error_code": "NOT_FOUND"}), 404

        target_payload = json.loads(target_file.read_text(encoding="utf-8"))
        target_payload["status"] = "active"
        target_payload["rolled_back_at"] = datetime.utcnow().isoformat() + "Z"
        target_payload["rolled_back_from"] = active.get("deployment_id")
        target_file.write_text(json.dumps(target_payload, indent=2), encoding="utf-8")
        _set_active_deployment(deploy_dir, target_id)
        return jsonify({"success": True, "data": target_payload}), 200
    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ⑮ Before/After preview  — GET /api/model-training/preprocess/before-after  (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/preprocess/before-after", methods=["GET"])
def preprocess_before_after() -> tuple:
    try:
        dataset_id       = int(request.args.get("dataset_id") or 0)
        after_dataset_id = int(request.args.get("after_dataset_id") or 0)
        n_rows           = int(request.args.get("n_rows") or 50)

        if not dataset_id:
            return jsonify({"success": False, "error": "dataset_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)

        before_meta = _get_dataset(env_root, tenant_id, env_id, dataset_id)
        before      = trainer.sample_dataset(before_meta.get("file_path"), n_rows=n_rows)

        after = None
        if after_dataset_id:
            after_meta = _get_dataset(env_root, tenant_id, env_id, after_dataset_id)
            after      = trainer.sample_dataset(after_meta.get("file_path"), n_rows=n_rows)

        return jsonify({"success": True, "data": {"before": before, "after": after}}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ── NEW v4 WORKBENCH ENDPOINTS ────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────

# ⑯ Workbench champion  — POST /api/model-training/workbench/champion  (NEW)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/workbench/champion", methods=["POST"])
def workbench_set_champion() -> tuple:
    """
    Atomically promote a job to champion and demote the current champion.

    Body:
      job_id   str   required
      notes    str   optional
      tags     list  optional

    Returns:
      { promoted: registry_entry, demoted: registry_entry | null }
    """
    try:
        body   = request.get_json(silent=True) or {}
        job_id = str(body.get("job_id") or "").strip()
        if not job_id:
            return jsonify({"success": False, "error": "job_id is required",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        labels   = _get_labels(tenant_id, env_id)

        # Find current champion so we can report demotion
        current_registry = trainer.list_registry(tenant_id=tenant_id, env_id=env_id)
        current_champion = next((r for r in current_registry if r.get("stage") == "champion" and r.get("job_id") != job_id), None)

        # Promote
        promoted = trainer.update_registry_stage(
            job_id=job_id, tenant_id=tenant_id, env_id=env_id, stage="champion",
        )
        _enrich_run_with_label(promoted, labels)

        demoted = None
        if current_champion:
            try:
                demoted = trainer.update_registry_stage(
                    job_id=current_champion["job_id"], tenant_id=tenant_id, env_id=env_id, stage="challenger",
                )
                _enrich_run_with_label(demoted, labels)
            except Exception:
                pass  # Non-fatal

        # Optionally update notes / tags
        if body.get("notes") or body.get("tags"):
            try:
                trainer.register_model(
                    job_id=job_id, tenant_id=tenant_id, env_id=env_id,
                    stage="champion",
                    notes=str(body.get("notes") or ""),
                    tags=body.get("tags") if isinstance(body.get("tags"), list) else [],
                )
            except Exception:
                pass

        return jsonify({"success": True, "data": {"promoted": promoted, "demoted": demoted}}), 200

    except ValueError as ve:
        return jsonify({"success": False, "error": str(ve), "error_code": "VALIDATION_ERROR"}), 400
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ⑰ Workbench summary  — GET /api/model-training/workbench/summary  (NEW)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/workbench/summary", methods=["GET"])
def workbench_summary() -> tuple:
    """
    Returns a cross-model overview used by the workbench overview panel.

    Response:
      {
        total_runs:    int,
        champion:      { job_id, label, algorithm, roc_auc, f1, trained_at } | null,
        best_auc:      { job_id, label, algorithm, value } | null,
        best_f1:       { job_id, label, algorithm, value } | null,
        event_loss_ok: int  (runs where event_loss_pct <= 5),
        event_loss_over: int,
        algorithms:    { algorithm: count },
        grains:        { grain: count },
      }
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        trainer  = _get_training_service(env_root)
        labels   = _get_labels(tenant_id, env_id)
        runs     = trainer.list_runs(tenant_id=tenant_id, env_id=env_id, limit=500)

        total      = len(runs)
        champion   = None
        best_auc   = None
        best_f1    = None
        el_ok      = 0
        el_over    = 0
        algorithms: Dict[str, int] = {}
        grains:     Dict[str, int] = {}

        for r in runs:
            _enrich_run_with_label(r, labels)
            m   = r.get("metrics") or {}
            alg = r.get("algorithm", "unknown")
            g   = r.get("grain", "alert")
            algorithms[alg] = algorithms.get(alg, 0) + 1
            grains[g]       = grains.get(g, 0) + 1

            auc = m.get("roc_auc")
            f1  = m.get("f1")
            el  = m.get("event_loss_pct") or r.get("event_loss_pct") or 0

            if el <= 5:
                el_ok += 1
            else:
                el_over += 1

            if r.get("registry_stage") == "champion":
                champion = {
                    "job_id":    r["job_id"],
                    "label":     r["label"],
                    "algorithm": alg,
                    "roc_auc":   auc,
                    "f1":        f1,
                    "trained_at": r.get("trained_at"),
                }

            if auc is not None:
                if best_auc is None or auc > best_auc["value"]:
                    best_auc = {"job_id": r["job_id"], "label": r["label"], "algorithm": alg, "value": auc}
            if f1 is not None:
                if best_f1 is None or f1 > best_f1["value"]:
                    best_f1 = {"job_id": r["job_id"], "label": r["label"], "algorithm": alg, "value": f1}

        return jsonify({"success": True, "data": {
            "total_runs":    total,
            "champion":      champion,
            "best_auc":      best_auc,
            "best_f1":       best_f1,
            "event_loss_ok": el_ok,
            "event_loss_over": el_over,
            "algorithms":    algorithms,
            "grains":        grains,
        }}), 200

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ⑱ Bulk label  — POST /api/model-training/workbench/bulk-label  (NEW)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/workbench/bulk-label", methods=["POST"])
def workbench_bulk_label() -> tuple:
    """
    Set or update display labels for one or more training runs.

    Body: { labels: { job_id: label_string, ... } }

    Labels are returned in /runs, /compare, and /workbench/summary responses.
    They survive across calls in the same process; use model_name in the
    registry for durable labelling.
    """
    try:
        body   = request.get_json(silent=True) or {}
        new_labels = body.get("labels") or {}
        if not isinstance(new_labels, dict):
            return jsonify({"success": False, "error": "labels must be an object",
                            "error_code": "VALIDATION_ERROR"}), 400
        if len(new_labels) > 100:
            return jsonify({"success": False, "error": "Maximum 100 labels per call",
                            "error_code": "VALIDATION_ERROR"}), 400

        tenant_id, env_id = _get_env_ids()
        _set_labels(tenant_id, env_id, {str(k): str(v) for k, v in new_labels.items()})
        all_labels = _get_labels(tenant_id, env_id)
        return jsonify({"success": True, "data": {"labels": all_labels}}), 200

    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500


# ⑲ Get labels  — GET /api/model-training/workbench/labels  (NEW)
# ─────────────────────────────────────────────────────────────────────────────

@model_training_bp.route("/workbench/labels", methods=["GET"])
def workbench_get_labels() -> tuple:
    try:
        tenant_id, env_id = _get_env_ids()
        labels = _get_labels(tenant_id, env_id)
        return jsonify({"success": True, "data": {"labels": labels}}), 200
    except Exception as exc:
        return jsonify({"success": False, "error": str(exc), "error_code": "SERVER_ERROR"}), 500
