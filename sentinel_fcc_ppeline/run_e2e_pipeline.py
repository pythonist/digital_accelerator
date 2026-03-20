from __future__ import annotations

import asyncio
import json
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import pandas as pd


PIPELINE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_ROOT.parent
BACKEND_ROOT = PROJECT_ROOT / "backend"
DATA_DIR = PIPELINE_ROOT / "data"
RESULTS_DIR = PIPELINE_ROOT / "results"

sys.dont_write_bytecode = True
sys.path.insert(0, str(BACKEND_ROOT))

from api.service_locator import services
from api.tools.mlops.autopilot_routes import _get_run_copy, _make_run, _run_pipeline
from api.tools.mlops.deployment_dashboard_service import DeploymentDashboardService
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root
from services.fcc_sentinel_bridge import FCCSentinelBridgeService


TENANT_ID = "default"
FCC_ENV = "sentinel_fcc_ppeline_fcc"
SENTINEL_ENV = "sentinel_fcc_ppeline_sentinel"
TRAINING_FILE = DATA_DIR / "fcc_training_alerts.csv"
SCORING_FILE = DATA_DIR / "fcc_scoring_alerts.csv"
SUMMARY_FILE = RESULTS_DIR / "e2e_summary.json"


def _log(message: str) -> None:
    print(f"[sentinel-fcc-pipeline] {message}")


def _sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-values))


def _clean_env(env_name: str) -> None:
    if not services.metadata_manager:
        services.init_services()
    base_dir = Path(services.metadata_manager.base_dir)
    env_dir = base_dir / TENANT_ID / env_name
    if env_dir.exists():
        shutil.rmtree(env_dir)


def _ensure_env(env_name: str) -> Path:
    env_root = resolve_env_root(env_name, TENANT_ID, create_if_missing=True)
    if env_root.exists():
        shutil.rmtree(env_root)
    services.metadata_manager.create_environment(env_name, TENANT_ID)
    return resolve_env_root(env_name, TENANT_ID, create_if_missing=True)


def _generate_alert_frame(rows: int, seed: int, prefix: str) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    base_dates = pd.date_range("2025-01-01", periods=max(rows, 1), freq="8h")
    channels = np.array(["wire", "cash", "online", "branch"])
    segments = np.array(["Retail", "SME", "Corporate", "Private"])
    countries = np.array(["US", "GB", "AE", "SG", "NG", "IR"])
    account_types = np.array(["Checking", "Savings", "Business"])
    directions = np.array(["outbound", "inbound"])

    channel = rng.choice(channels, size=rows, p=[0.35, 0.20, 0.30, 0.15])
    segment = rng.choice(segments, size=rows, p=[0.42, 0.28, 0.20, 0.10])
    country = rng.choice(countries, size=rows, p=[0.38, 0.14, 0.12, 0.12, 0.14, 0.10])
    account_type = rng.choice(account_types, size=rows, p=[0.48, 0.24, 0.28])
    direction = rng.choice(directions, size=rows, p=[0.62, 0.38])

    txn_amount = np.round(rng.lognormal(mean=7.1, sigma=0.72, size=rows), 2)
    txn_velocity_7d = np.clip(rng.normal(5.0, 2.1, size=rows), 0.4, None)
    cash_ratio_30d = np.clip(rng.beta(2.0, 4.0, size=rows), 0.0, 1.0)
    prior_alert_count = rng.poisson(lam=2.4, size=rows)
    prior_false_positive_count = rng.poisson(lam=1.6, size=rows)
    customer_tenure_months = rng.integers(6, 160, size=rows)
    high_risk_country_flag = np.isin(country, ["IR", "NG"]).astype(int)
    structuring_score = np.clip(
        (txn_amount / np.percentile(txn_amount, 85))
        + (cash_ratio_30d * 1.4)
        + (prior_alert_count / 6.0)
        + rng.normal(0.0, 0.35, size=rows),
        0.0,
        None,
    )
    rule_score = np.clip(
        0.25
        + (high_risk_country_flag * 0.35)
        + (cash_ratio_30d * 0.25)
        + (structuring_score * 0.08)
        + rng.normal(0.0, 0.08, size=rows),
        0.0,
        1.0,
    )

    logit = (
        -3.65
        + (np.log1p(txn_amount) * 0.34)
        + (txn_velocity_7d * 0.19)
        + (cash_ratio_30d * 2.2)
        + (high_risk_country_flag * 1.35)
        + (structuring_score * 0.78)
        + (rule_score * 1.95)
        + np.where(channel == "cash", 0.80, 0.0)
        + np.where(segment == "Corporate", 0.65, 0.0)
        + np.where(direction == "outbound", 0.28, 0.0)
        - (prior_false_positive_count * 0.42)
        - (customer_tenure_months / 190.0)
        + rng.normal(0.0, 0.48, size=rows)
    )
    true_positive_probability = _sigmoid(logit)
    is_true_positive = (rng.random(rows) < true_positive_probability).astype(int)
    case_status = np.where(is_true_positive == 1, "CLOSED_SAR_FILED", "CLOSED_FALSE_POSITIVE")

    customer_numbers = rng.integers(1000, 1400, size=rows)
    account_numbers = rng.integers(10000, 14500, size=rows)
    case_numbers = np.arange(rows) // 2

    frame = pd.DataFrame(
        {
            "ALERT_ID": [f"{prefix}_ALT_{idx:05d}" for idx in range(1, rows + 1)],
            "CASE_ID": [f"{prefix}_CASE_{idx:05d}" for idx in case_numbers + 1],
            "ACCOUNT_ID": [f"{prefix}_ACC_{idx:05d}" for idx in account_numbers],
            "CUSTOMER_ID": [f"{prefix}_CUST_{idx:04d}" for idx in customer_numbers],
            "transaction_id": [f"{prefix}_TXN_{idx:06d}" for idx in range(1, rows + 1)],
            "counterparty_account": [f"{prefix}_CP_{idx:05d}" for idx in rng.integers(15000, 18000, size=rows)],
            "txn_timestamp": pd.to_datetime(base_dates[:rows] + pd.to_timedelta(rng.integers(0, 72, size=rows), unit="h")).astype(str),
            "txn_amount": txn_amount,
            "txn_velocity_7d": np.round(txn_velocity_7d, 3),
            "cash_ratio_30d": np.round(cash_ratio_30d, 4),
            "prior_alert_count": prior_alert_count,
            "prior_false_positive_count": prior_false_positive_count,
            "customer_tenure_months": customer_tenure_months,
            "high_risk_country_flag": high_risk_country_flag,
            "structuring_score": np.round(structuring_score, 4),
            "rule_score": np.round(rule_score, 4),
            "channel": channel,
            "segment": segment,
            "country": country,
            "account_type": account_type,
            "direction": direction,
            "customer_name": [f"Customer {idx}" for idx in customer_numbers],
            "merchant_geo_risk": np.round(np.clip(rng.normal(0.45, 0.18, size=rows), 0.0, 1.0), 4),
            "IS_TRUE_POS": is_true_positive,
            "CASE_STATUS": case_status,
        }
    )

    return frame


def _write_source_data() -> Dict[str, Any]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    training_df = _generate_alert_frame(rows=420, seed=42, prefix="FCCTRAIN")
    scoring_df = _generate_alert_frame(rows=140, seed=314, prefix="FCCSCORE")

    training_df.to_csv(TRAINING_FILE, index=False)
    scoring_df.to_csv(SCORING_FILE, index=False)

    return {
        "training_rows": int(len(training_df)),
        "training_event_rate": round(float(training_df["IS_TRUE_POS"].mean()), 4),
        "scoring_rows": int(len(scoring_df)),
        "scoring_event_rate": round(float(scoring_df["IS_TRUE_POS"].mean()), 4),
    }


def _run_fcc_pipeline(env_root: Path) -> Dict[str, Any]:
    mlops_service = MLOpsWorkbenchService(env_root / "mlops" / "duckdb" / "mlops.duckdb")
    registered = mlops_service.register_dataset(
        tenant_id=TENANT_ID,
        env_id=FCC_ENV,
        dataset_type="alerts",
        filename=TRAINING_FILE.name,
        file_path=TRAINING_FILE,
    )
    _log(f"Registered FCC training dataset {registered['dataset_id']} with {registered['row_count']} rows.")

    run = _make_run(
        env_id=FCC_ENV,
        tenant_id=TENANT_ID,
        env_root=env_root,
        config={
            "run_name": "sentinel_fcc_ppeline_demo",
            "model_name": "sentinel_fcc_ppeline_model",
            "dataset_ids": [registered["dataset_id"]],
            "target_column": "IS_TRUE_POS",
            "business_goal": "balanced",
            "description": "sentinel_fcc_ppeline_e2e",
        },
    )
    run_id = str(run["run_id"])
    _log(f"Starting FCC autopilot run {run_id}.")
    _run_pipeline(run_id, env_root)
    final_run = _get_run_copy(run_id, env_root) or {}
    if str(final_run.get("status")) != "done":
        raise RuntimeError(f"FCC pipeline failed: {final_run.get('error')}")

    model_run_id = str(final_run.get("artifacts", {}).get("job_id") or "").strip()
    validate_step = next((step for step in final_run.get("steps", []) if step.get("id") == "validate"), {})
    threshold = float((validate_step.get("result") or {}).get("optimal_threshold") or 0.40)
    deployment_threshold = max(threshold, 0.58)
    deployment = mlops_service.deploy_model_run(
        tenant_id=TENANT_ID,
        env_id=FCC_ENV,
        run_id=model_run_id,
        threshold=deployment_threshold,
        deployment_name="sentinel_fcc_ppeline_deployment",
    )
    _log(f"FCC model trained as {model_run_id} and deployed as {deployment['deployment_id']}.")

    return {
        "registered_dataset": registered,
        "autopilot_run": final_run,
        "model_run_id": model_run_id,
        "threshold": deployment_threshold,
        "validated_threshold": threshold,
        "deployment": deployment,
    }


def _score_new_batch(env_root: Path, model_run_id: str, deployment_id: str, threshold: float) -> Dict[str, Any]:
    scoring_df = pd.read_csv(SCORING_FILE)
    deployment_service = DeploymentDashboardService(
        db_path=env_root / "mlops" / "duckdb" / "deployment.duckdb",
        model_dir=env_root / "mlops" / "models",
    )
    result = deployment_service.score_batch(
        deployment_id=deployment_id,
        run_id=model_run_id,
        records=scoring_df.to_dict(orient="records"),
        threshold=float(threshold),
        entity_type="alert",
    )
    ledger_df = pd.DataFrame(result.get("ledger") or [])
    if not ledger_df.empty:
        scoring_df["entity_id"] = scoring_df["ALERT_ID"].astype(str)
        merged = ledger_df.merge(
            scoring_df[["entity_id", "IS_TRUE_POS", "CASE_STATUS"]],
            on="entity_id",
            how="left",
        )
        result["hidden_outcome_summary"] = {
            "suppressed_true_positives": int(((merged["decision"] == "suppressed") & (merged["IS_TRUE_POS"] == 1)).sum()),
            "suppressed_false_positives": int(((merged["decision"] == "suppressed") & (merged["IS_TRUE_POS"] == 0)).sum()),
            "escalated_true_positives": int(((merged["decision"] == "escalated") & (merged["IS_TRUE_POS"] == 1)).sum()),
            "escalated_false_positives": int(((merged["decision"] == "escalated") & (merged["IS_TRUE_POS"] == 0)).sum()),
        }
    else:
        result["hidden_outcome_summary"] = {}
    _log(
        "Scored unseen FCC batch. "
        f"Suppressed={result['suppressed']}, escalated={result['escalated']}, threshold={threshold:.3f}"
    )
    return result


def _bridge_to_sentinel(source_env_root: Path, batch_id: str, model_run_id: str, deployment_id: str) -> Dict[str, Any]:
    bridge = FCCSentinelBridgeService(source_env_root)
    publish = bridge.publish_batch(
        batch_id=batch_id,
        run_id=model_run_id,
        deployment_id=deployment_id,
        include_suppressed=False,
        publish_label="sentinel_fcc_ppeline_retained_queue",
    )
    imported = bridge.import_published_run(
        publish_id=str(publish["publish_id"]),
        tenant_id=TENANT_ID,
        target_env_id=SENTINEL_ENV,
        replace_existing=False,
        rerank_after_import=True,
    )
    _log(
        "Published FCC retained queue and imported into Sentinel. "
        f"Published rows={publish['published_rows']}, target_env={imported['target_env_id']}"
    )
    return {"publish": publish, "import": imported}


def _verify_sentinel_workspace() -> Dict[str, Any]:
    from case_facts.facts_builder import build_case_facts
    from api.service_locator import services as shared_services
    from app import app as flask_app

    shared_services.activate_case(SENTINEL_ENV, TENANT_ID)
    client = flask_app.test_client()
    headers = {"X-Environment-ID": SENTINEL_ENV}

    rerank_resp = client.post("/api/v2/cases/rerank", headers=headers)
    rerank_json = rerank_resp.get_json() or {}
    focus_inbox_resp = client.get("/api/v2/focus/inbox", headers=headers)
    focus_inbox_json = focus_inbox_resp.get_json() or {}
    stats_resp = client.get("/api/v2/db/stats", headers=headers)
    stats_json = stats_resp.get_json() or {}

    shared_services.investigation_db = shared_services.get_investigation_db(SENTINEL_ENV, TENANT_ID)
    conn = shared_services.investigation_db.connect()
    try:
        case_rows = pd.read_sql("SELECT case_id, risk_rating, risk_score FROM cases LIMIT 5", conn)
        try:
            risk_index_rows = pd.read_sql(
                """
                SELECT entity_key, entity_type, risk_score, alert_count
                FROM investigation_risk_index
                WHERE entity_type = 'case'
                ORDER BY risk_score DESC
                LIMIT 5
                """,
                conn,
            )
        except Exception:
            risk_index_rows = pd.DataFrame()
    finally:
        shared_services.investigation_db.close_connection(conn)

    if case_rows.empty:
        raise RuntimeError("Sentinel import created no cases.")

    case_id = str(case_rows.iloc[0]["case_id"])
    case_pack_resp = client.get(f"/api/v2/case-pack/{case_id}", headers=headers)
    case_pack_json = case_pack_resp.get_json() or {}

    case_facts = asyncio.run(
        build_case_facts(
            case_id=case_id,
            env_id=SENTINEL_ENV,
            tenant_id=TENANT_ID,
            db_manager=shared_services.get_investigation_db(SENTINEL_ENV, TENANT_ID),
        )
    )

    scope_set_resp = client.post(
        "/api/v2/case-scope/set",
        headers=headers,
        json={"scope_type": "CUSTOM", "scope_value": [case_id]},
    )
    scope_set_json = scope_set_resp.get_json() or {}
    scope_get_resp = client.get("/api/v2/case-scope/get", headers=headers)
    scope_get_json = scope_get_resp.get_json() or {}
    scope_clear_resp = client.post("/api/v2/case-scope/clear", headers=headers)
    scope_clear_json = scope_clear_resp.get_json() or {}

    graph_resp = client.post(
        "/api/v2/analysis/graph/build-full-case",
        headers=headers,
        json={"case_id": case_id, "window_hours": 72, "max_hops": 3},
    )
    graph_json = graph_resp.get_json() or {}

    checks = {
        "rerank_ok": bool(rerank_resp.status_code == 200 and rerank_json.get("success")),
        "focus_inbox_ok": bool(focus_inbox_resp.status_code == 200 and focus_inbox_json.get("success")),
        "db_stats_ok": bool(stats_resp.status_code == 200 and stats_json.get("success")),
        "case_pack_ok": bool(case_pack_resp.status_code == 200 and not case_pack_json.get("error")),
        "case_facts_ok": bool(
            case_facts
            and case_facts.case_id == case_id
            and getattr(case_facts, "overall_risk_score", None) is not None
        ),
        "case_scope_ok": bool(
            scope_set_resp.status_code == 200
            and scope_set_json.get("success")
            and scope_get_resp.status_code == 200
            and scope_get_json.get("success")
            and scope_get_json.get("scope", {}).get("case_count") == 1
            and scope_clear_resp.status_code == 200
            and scope_clear_json.get("success")
        ),
        "graph_ok": bool(graph_resp.status_code == 200 and graph_json.get("success")),
        "risk_index_ready": bool(not risk_index_rows.empty),
    }

    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise RuntimeError(f"Sentinel verification failed for: {', '.join(failed)}")

    return {
        "checks": checks,
        "rerank_result": rerank_json,
        "focus_inbox_result": focus_inbox_json,
        "sample_case_id": case_id,
        "stats": stats_json,
        "case_preview": case_rows.to_dict(orient="records"),
        "risk_index_preview": risk_index_rows.to_dict(orient="records"),
        "case_pack_counts": {
            "alerts": int(len(case_pack_json.get("alerts") or [])),
            "transactions": int(len(case_pack_json.get("transactions") or [])),
            "accounts": int(len(case_pack_json.get("accounts") or [])),
            "customers": int(len(case_pack_json.get("customers") or [])),
        },
        "case_facts_summary": {
            "case_id": case_facts.case_id,
            "customer_id": case_facts.customer_id,
            "customer_name": case_facts.customer_name,
            "risk_score": round(float(case_facts.overall_risk_score), 2),
            "risk_level": case_facts.customer_risk_rating.value,
            "transaction_count_30d": int(case_facts.patterns_30d.total_count),
            "transaction_volume_30d": round(float(case_facts.patterns_30d.total_volume), 2),
            "risk_driver_count": int(len(case_facts.risk_drivers)),
        },
        "case_scope_summary": {
            "set": scope_set_json,
            "get": scope_get_json,
            "clear": scope_clear_json,
        },
        "graph_summary": {
            "nodes": int(len((graph_json.get("graph") or {}).get("nodes") or [])),
            "links": int(len((graph_json.get("graph") or {}).get("links") or [])),
            "narrative": graph_json.get("narrative"),
        },
    }


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    services.init_services()
    _clean_env(FCC_ENV)
    _clean_env(SENTINEL_ENV)

    source_summary = _write_source_data()
    _log(
        "Generated FCC source files. "
        f"Training rows={source_summary['training_rows']}, scoring rows={source_summary['scoring_rows']}"
    )

    fcc_env_root = _ensure_env(FCC_ENV)
    _ensure_env(SENTINEL_ENV)

    fcc_result = _run_fcc_pipeline(fcc_env_root)
    scoring_result = _score_new_batch(
        env_root=fcc_env_root,
        model_run_id=fcc_result["model_run_id"],
        deployment_id=str(fcc_result["deployment"]["deployment_id"]),
        threshold=float(fcc_result["threshold"]),
    )
    bridge_result = _bridge_to_sentinel(
        source_env_root=fcc_env_root,
        batch_id=str(scoring_result["batch_id"]),
        model_run_id=fcc_result["model_run_id"],
        deployment_id=str(fcc_result["deployment"]["deployment_id"]),
    )
    sentinel_result = _verify_sentinel_workspace()

    summary = {
        "tenant_id": TENANT_ID,
        "fcc_env": FCC_ENV,
        "sentinel_env": SENTINEL_ENV,
        "source_data": source_summary,
        "fcc_pipeline": {
            "run_id": fcc_result["autopilot_run"]["run_id"],
            "model_run_id": fcc_result["model_run_id"],
            "deployment_id": fcc_result["deployment"]["deployment_id"],
            "threshold": fcc_result["threshold"],
            "validated_threshold": fcc_result["validated_threshold"],
            "steps": [
                {
                    "id": step.get("id"),
                    "status": step.get("status"),
                    "message": step.get("message"),
                }
                for step in fcc_result["autopilot_run"].get("steps", [])
            ],
        },
        "scoring": {
            "batch_id": scoring_result["batch_id"],
            "total": scoring_result["total"],
            "suppressed": scoring_result["suppressed"],
            "escalated": scoring_result["escalated"],
            "suppression_rate": scoring_result["suppression_rate"],
            "hidden_outcome_summary": scoring_result.get("hidden_outcome_summary") or {},
        },
        "bridge": bridge_result,
        "sentinel": sentinel_result,
    }

    SUMMARY_FILE.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    _log(f"Wrote end-to-end summary to {SUMMARY_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
