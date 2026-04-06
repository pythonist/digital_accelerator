from __future__ import annotations

import json
import os
import pickle
import shutil
import sys
import uuid
import warnings
from pathlib import Path
from typing import Any, Dict, List

import duckdb
import pandas as pd


AUTOMATION_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = AUTOMATION_ROOT.parents[1]
BACKEND_ROOT = PROJECT_ROOT / "backend"
ARTIFACTS_DIR = AUTOMATION_ROOT / "artifacts"
SCREENSHOTS_DIR = ARTIFACTS_DIR / "screenshots"
VIDEOS_DIR = ARTIFACTS_DIR / "videos"
SOURCE_ENV_ROOT = PROJECT_ROOT / "data" / "environments" / "e2e_smoke_ba792b71"
SUMMARY_PATH = ARTIFACTS_DIR / "backend_summary.json"

TENANT_ID = "fccanalytics"
RUN_TAG = uuid.uuid4().hex[:8]
FCC_ENV_ID = f"automaed_pipeline_testing_bot_fcc_{RUN_TAG}"
SENTINEL_ENV_ID = f"automaed_pipeline_testing_bot_sentinel_{RUN_TAG}"
PIPELINE_NAME = "automaed_piepline testing bot"
DEPLOYMENT_NAME = "automaed_pipeline_testing_bot_deployment"
PUBLISH_LABEL = "automaed_pipeline_testing_bot_retained_queue"
SOURCE_BATCH_ROWS = 250

os.chdir(BACKEND_ROOT)

sys.dont_write_bytecode = True
sys.path.insert(0, str(BACKEND_ROOT))

from api.service_locator import services  # noqa: E402
from api.tools.mlops.deployment_dashboard_service import DeploymentDashboardService  # noqa: E402
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService  # noqa: E402
from api.tools.mlops.path_utils import resolve_env_root  # noqa: E402
from case_facts.facts_builder import build_case_facts  # noqa: E402
from services.fcc_sentinel_bridge import FCCSentinelBridgeService  # noqa: E402


warnings.filterwarnings("ignore", category=pd.errors.PerformanceWarning)


def _log(message: str) -> None:
    print(f"[fcc-e2e] {message}")


def _json_dump(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def _clean_environment(env_id: str) -> Path:
    env_root = resolve_env_root(env_id, TENANT_ID, create_if_missing=True)
    if env_root.exists():
        shutil.rmtree(env_root)
    services.metadata_manager.create_environment(env_id, TENANT_ID)
    env_root = resolve_env_root(env_id, TENANT_ID, create_if_missing=True)
    (env_root / "data").mkdir(parents=True, exist_ok=True)
    (env_root / "mlops" / "models").mkdir(parents=True, exist_ok=True)
    return env_root


def _copy_and_register_datasets(mlops_service: MLOpsWorkbenchService, env_root: Path) -> Dict[str, Dict[str, Any]]:
    registrations: Dict[str, Dict[str, Any]] = {}
    for name in [
        "accounts",
        "alerts",
        "cases",
        "customers",
        "str",
        "transactions",
        "master_dataset",
        "preprocessed_dataset",
    ]:
        source_path = SOURCE_ENV_ROOT / "data" / f"{name}.csv"
        target_path = env_root / "data" / source_path.name
        shutil.copy2(source_path, target_path)
        registrations[name] = mlops_service.register_dataset(
            tenant_id=TENANT_ID,
            env_id=FCC_ENV_ID,
            dataset_type=name,
            filename=target_path.name,
            file_path=target_path,
        )
    return registrations


def _seed_model_run(
    mlops_service: MLOpsWorkbenchService,
    env_root: Path,
    dataset_id: int,
) -> Dict[str, Any]:
    source_training_db = SOURCE_ENV_ROOT / "mlops" / "duckdb" / "model_training.duckdb"
    target_training_db = env_root / "mlops" / "duckdb" / "model_training.duckdb"
    shutil.copy2(source_training_db, target_training_db)

    source_conn = duckdb.connect(str(source_training_db))
    row = source_conn.execute(
        "SELECT * FROM model_training_runs ORDER BY trained_at DESC LIMIT 1"
    ).fetchone()
    columns = [record[0] for record in source_conn.execute("DESCRIBE model_training_runs").fetchall()]
    source_conn.close()
    if not row:
        raise RuntimeError("No source model_training_runs row found in seeded environment")

    training_row = dict(zip(columns, row))
    source_model_path = Path(str(training_row["artifact_path"]))
    if not source_model_path.exists():
        candidate = SOURCE_ENV_ROOT / "mlops" / "models" / source_model_path.name
        if candidate.exists():
            source_model_path = candidate
    if not source_model_path.exists():
        matches = sorted((SOURCE_ENV_ROOT / "mlops" / "models").glob(f"*{source_model_path.suffix}"))
        if matches:
            source_model_path = matches[0]
    if not source_model_path.exists():
        raise FileNotFoundError(f"Could not resolve seeded model artifact for {training_row['job_id']}: {training_row['artifact_path']}")
    target_model_path = env_root / "mlops" / "models" / source_model_path.name
    shutil.copy2(source_model_path, target_model_path)

    with open(target_model_path, "rb") as handle:
        model_bundle = pickle.load(handle)
    feature_columns = list(model_bundle.get("feature_columns") or [])

    target_conn = duckdb.connect(str(target_training_db))
    target_conn.execute("DELETE FROM model_training_runs")
    placeholders = ",".join(["?"] * len(columns))
    insert_cols = ",".join(columns)
    values: List[Any] = []
    for column in columns:
        value = training_row[column]
        if column == "tenant_id":
            value = TENANT_ID
        elif column == "env_id":
            value = FCC_ENV_ID
        elif column == "dataset_id":
            value = int(dataset_id)
        elif column == "artifact_path":
            value = str(target_model_path)
        values.append(value)
    target_conn.execute(
        f"INSERT INTO model_training_runs ({insert_cols}) VALUES ({placeholders})",
        values,
    )
    target_conn.close()

    mlops_db = env_root / "mlops" / "duckdb" / "mlops.duckdb"
    mlops_conn = duckdb.connect(str(mlops_db))
    mlops_conn.execute("DELETE FROM mlops_model_runs")
    mlops_conn.execute(
        """
        INSERT INTO mlops_model_runs (
          run_id, tenant_id, env_id, dataset_id, target_column, algorithm,
          feature_columns_json, metrics_json, threshold_metrics_json,
          test_truth_json, test_prob_json, selected_threshold, artifact_path
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            str(training_row["job_id"]),
            TENANT_ID,
            FCC_ENV_ID,
            int(dataset_id),
            training_row["target_column"],
            training_row["algorithm"],
            json.dumps(feature_columns),
            training_row["metrics_json"],
            training_row.get("validation_json") or "[]",
            training_row["test_truth_json"],
            training_row["test_prob_json"],
            training_row["selected_threshold"],
            str(target_model_path),
        ],
    )
    mlops_conn.close()

    return {
        "run_id": str(training_row["job_id"]),
        "algorithm": str(training_row["algorithm"]),
        "target_column": str(training_row["target_column"]),
        "selected_threshold": float(training_row["selected_threshold"] or 0.4),
        "artifact_path": str(target_model_path),
    }


def _create_pipeline(
    mlops_service: MLOpsWorkbenchService,
    dataset_ids: Dict[str, Dict[str, Any]],
    model_run_id: str,
    deployment_id: str,
    threshold: float,
) -> Dict[str, Any]:
    pipeline = mlops_service.save_pipeline(
        tenant_id=TENANT_ID,
        env_id=FCC_ENV_ID,
        dataset_id=int(dataset_ids["preprocessed_dataset"]["dataset_id"]),
        name=PIPELINE_NAME,
        steps=[],
        grain="alert",
        anchor_dataset_id=int(dataset_ids["alerts"]["dataset_id"]),
        dataset_ids=[int(info["dataset_id"]) for info in dataset_ids.values()],
        joins=[],
        transforms=[],
        output_name="preprocessed_dataset",
        created_by_persona="technical",
    )
    pipeline_id = int(pipeline["pipeline_id"])

    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "data_upload",
        {
            "status": "completed",
            "completed": True,
            "datasets_count": len(dataset_ids),
            "datasetIds": [int(info["dataset_id"]) for info in dataset_ids.values()],
            "expected_dataset_types": [
                {"type": key, "file_name": f"{key}.csv"}
                for key in ["accounts", "alerts", "cases", "customers", "str", "transactions"]
            ],
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "master",
        {
            "status": "completed",
            "completed": True,
            "builtMasterDatasetId": int(dataset_ids["master_dataset"]["dataset_id"]),
            "outputDatasetId": int(dataset_ids["master_dataset"]["dataset_id"]),
            "currentStepId": "preview",
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "target",
        {
            "status": "completed",
            "completed": True,
            "currentTargetColumn": "IS_TRUE_POS",
            "selectedTargetColumn": "IS_TRUE_POS",
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "eda",
        {
            "status": "completed",
            "completed": True,
            "currentSubstep": "overview",
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "preprocess",
        {
            "status": "completed",
            "completed": True,
            "preprocessedDatasetId": int(dataset_ids["preprocessed_dataset"]["dataset_id"]),
            "activeTab": 5,
            "steps": [
                {"name": "Clean & Encode", "status": "completed"},
                {"name": "Scaling", "status": "completed"},
                {"name": "Feature Engineering", "status": "completed"},
            ],
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "model",
        {
            "status": "completed",
            "completed": True,
            "job_id": model_run_id,
            "activeRunId": model_run_id,
            "algorithm": "gradient_boosting",
            "activeTab": 4,
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "validation",
        {
            "status": "completed",
            "completed": True,
            "job_id": model_run_id,
            "report_id": "AUTO-E2E-VALIDATION",
            "optimal_threshold": float(threshold),
            "activeTab": 4,
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "registry",
        {
            "status": "completed",
            "completed": True,
            "job_id": model_run_id,
            "deployment_id": deployment_id,
            "stage": "candidate",
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "ready",
        {
            "status": "completed",
            "completed": True,
            "deployment_id": deployment_id,
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "dashboard",
        {
            "status": "completed",
            "completed": True,
            "deployment_id": deployment_id,
            "run_id": model_run_id,
        },
    )
    mlops_service.save_pipeline_screen_state(
        TENANT_ID,
        FCC_ENV_ID,
        pipeline_id,
        "workbench_journey",
        {
            "current_step": "dashboard",
            "current_step_label": "Live Dashboard",
            "current_substep": "",
            "current_substep_label": "",
            "completion_pct": 100,
            "completed_steps": 10,
            "total_steps": 10,
            "run_status": "complete",
        },
    )

    pipeline_detail = mlops_service.load_pipeline(TENANT_ID, FCC_ENV_ID, pipeline_id)
    report = mlops_service.generate_run_report(
        tenant_id=TENANT_ID,
        env_id=FCC_ENV_ID,
        run_id=model_run_id,
        pipeline_id=str(pipeline_id),
    )
    return {"pipeline_id": pipeline_id, "pipeline": pipeline_detail, "report": report}


def _score_and_bridge(
    mlops_service: MLOpsWorkbenchService,
    env_root: Path,
    model_run: Dict[str, Any],
) -> Dict[str, Any]:
    deployment = mlops_service.deploy_model_run(
        tenant_id=TENANT_ID,
        env_id=FCC_ENV_ID,
        run_id=model_run["run_id"],
        threshold=model_run["selected_threshold"],
        deployment_name=DEPLOYMENT_NAME,
    )

    scoring_df = pd.read_csv(env_root / "data" / "preprocessed_dataset.csv").head(SOURCE_BATCH_ROWS)
    deployment_service = DeploymentDashboardService(
        db_path=env_root / "mlops" / "duckdb" / "deployment.duckdb",
        model_dir=env_root / "mlops" / "models",
    )
    scoring = deployment_service.score_batch(
        deployment_id=str(deployment["deployment_id"]),
        run_id=str(model_run["run_id"]),
        records=scoring_df.to_dict(orient="records"),
        threshold=float(deployment["threshold"]),
        entity_type="alert",
    )

    bridge = FCCSentinelBridgeService(env_root)
    publish = bridge.publish_batch(
        batch_id=str(scoring["batch_id"]),
        run_id=str(model_run["run_id"]),
        deployment_id=str(deployment["deployment_id"]),
        include_suppressed=False,
        publish_label=PUBLISH_LABEL,
    )
    imported = bridge.import_published_run(
        publish_id=str(publish["publish_id"]),
        tenant_id=TENANT_ID,
        target_env_id=SENTINEL_ENV_ID,
        replace_existing=False,
        rerank_after_import=True,
    )
    return {"deployment": deployment, "scoring": scoring, "publish": publish, "import": imported}


def _verify_sentinel_workspace() -> Dict[str, Any]:
    from api.service_locator import services as shared_services
    from app import app as flask_app

    shared_services.activate_case(SENTINEL_ENV_ID, TENANT_ID)
    client = flask_app.test_client()
    headers = {"X-Environment-ID": SENTINEL_ENV_ID}

    rerank_resp = client.post("/api/v2/cases/rerank", headers=headers)
    inbox_resp = client.get("/api/v2/focus/inbox", headers=headers)
    stats_resp = client.get("/api/v2/db/stats", headers=headers)

    shared_services.investigation_db = shared_services.get_investigation_db(SENTINEL_ENV_ID, TENANT_ID)
    conn = shared_services.investigation_db.connect()
    try:
        case_rows = pd.read_sql(
            "SELECT case_id, risk_rating, risk_score FROM cases ORDER BY risk_score DESC LIMIT 5",
            conn,
        )
    finally:
        shared_services.investigation_db.close_connection(conn)
    if case_rows.empty:
        raise RuntimeError("Sentinel import created no cases")

    case_id = str(case_rows.iloc[0]["case_id"])
    case_pack_resp = client.get(f"/api/v2/case-pack/{case_id}", headers=headers)
    graph_resp = client.post(
        "/api/v2/analysis/graph/build-full-case",
        headers=headers,
        json={"case_id": case_id, "window_hours": 72, "max_hops": 3},
    )
    similarity_post_resp = client.post(
        "/api/v2/case-retrieval/similar",
        headers=headers,
        json={"base_case_id": case_id, "top_k": 5},
    )
    similarity_get_resp = client.get(
        f"/api/v2/case-retrieval/similar?base_case_id={case_id}&top_k=5",
        headers=headers,
    )

    case_facts = __import__("asyncio").run(
        build_case_facts(
            case_id=case_id,
            env_id=SENTINEL_ENV_ID,
            tenant_id=TENANT_ID,
            db_manager=shared_services.get_investigation_db(SENTINEL_ENV_ID, TENANT_ID),
        )
    )

    rerank_json = rerank_resp.get_json() or {}
    inbox_json = inbox_resp.get_json() or {}
    stats_json = stats_resp.get_json() or {}
    case_pack_json = case_pack_resp.get_json() or {}
    graph_json = graph_resp.get_json() or {}
    similarity_post_json = similarity_post_resp.get_json() or {}
    similarity_get_json = similarity_get_resp.get_json() or {}

    checks = {
        "rerank_ok": bool(rerank_resp.status_code == 200 and rerank_json.get("success")),
        "priority_inbox_ok": bool(inbox_resp.status_code == 200 and inbox_json.get("success")),
        "db_stats_ok": bool(stats_resp.status_code == 200 and stats_json.get("success")),
        "case_pack_ok": bool(case_pack_resp.status_code == 200 and not case_pack_json.get("error")),
        "graph_ok": bool(graph_resp.status_code == 200 and graph_json.get("success")),
        "case_facts_ok": bool(case_facts and case_facts.case_id == case_id),
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        raise RuntimeError(f"Sentinel verification failed: {', '.join(failed)}")

    return {
        "sample_case_id": case_id,
        "checks": checks,
        "priority_inbox_count": int(len(inbox_json.get("cases") or [])),
        "stats": stats_json,
        "case_preview": case_rows.to_dict(orient="records"),
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
            "risk_score": round(float(case_facts.overall_risk_score or 0.0), 2),
            "risk_level": case_facts.customer_risk_rating.value,
            "transaction_count_30d": int(case_facts.patterns_30d.total_count),
        },
        "graph_summary": {
            "nodes": int(len((graph_json.get("graph") or {}).get("nodes") or [])),
            "links": int(len((graph_json.get("graph") or {}).get("links") or [])),
        },
        "case_similarity": {
            "post_status": similarity_post_resp.status_code,
            "get_status": similarity_get_resp.status_code,
            "post_keys": sorted(list(similarity_post_json.keys())),
            "get_keys": sorted(list(similarity_get_json.keys())),
            "post_ok": similarity_post_resp.status_code == 200,
            "get_ok": similarity_get_resp.status_code == 200,
        },
    }


def _save_workflow_sessions(
    fcc_service: MLOpsWorkbenchService,
    sentinel_service: MLOpsWorkbenchService,
    pipeline_id: int,
    model_run_id: str,
    deployment_id: str,
    publish_id: str,
    selected_case_id: str,
    report_id: str,
) -> Dict[str, Any]:
    fcc_session = fcc_service.save_workflow_session(
        tenant_id=TENANT_ID,
        env_id=FCC_ENV_ID,
        payload={
            "pipeline_id": pipeline_id,
            "pipeline_name": PIPELINE_NAME,
            "run_id": model_run_id,
            "deployment_id": deployment_id,
            "publish_id": publish_id,
            "current_module": "mlops",
            "current_step": "dashboard",
            "current_state": {
                "mlops_state": {
                    "pipeline_id": pipeline_id,
                    "pipeline_name": PIPELINE_NAME,
                    "datasets_count": 8,
                    "datasets": ["accounts", "alerts", "cases", "customers", "str", "transactions"],
                    "report_id": report_id,
                },
            },
            "mark_current_stable": True,
            "status": "fcc_complete",
        },
    )
    sentinel_session = sentinel_service.save_workflow_session(
        tenant_id=TENANT_ID,
        env_id=SENTINEL_ENV_ID,
        payload={
            "run_id": model_run_id,
            "deployment_id": deployment_id,
            "publish_id": publish_id,
            "current_module": "investigation",
            "current_step": "priority",
            "selected_case_id": selected_case_id,
            "current_state": {
                "preferred_screen": "priority",
                "selected_case_id": selected_case_id,
            },
            "handoff_summary": {
                "pipeline_id": pipeline_id,
                "pipeline_name": PIPELINE_NAME,
                "run_id": model_run_id,
                "deployment_id": deployment_id,
                "publish_id": publish_id,
                "publish_label": PUBLISH_LABEL,
                "preferred_screen": "priority",
                "selected_case_id": selected_case_id,
            },
            "mark_current_stable": True,
            "status": "sentinel_ready",
        },
    )
    return {
        "fcc_session_id": fcc_session.get("session_id"),
        "sentinel_session_id": sentinel_session.get("session_id"),
    }


def run() -> Dict[str, Any]:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)

    services.init_services()
    fcc_env_root = _clean_environment(FCC_ENV_ID)
    _clean_environment(SENTINEL_ENV_ID)
    _log(f"Created clean FCC env '{FCC_ENV_ID}' and Sentinel env '{SENTINEL_ENV_ID}'.")

    fcc_service = MLOpsWorkbenchService(fcc_env_root / "mlops" / "duckdb" / "mlops.duckdb")
    registrations = _copy_and_register_datasets(fcc_service, fcc_env_root)
    _log(f"Registered {len(registrations)} FCC datasets in '{FCC_ENV_ID}'.")

    model_run = _seed_model_run(
        mlops_service=fcc_service,
        env_root=fcc_env_root,
        dataset_id=int(registrations["preprocessed_dataset"]["dataset_id"]),
    )
    _log(f"Seeded model run '{model_run['run_id']}' for FCC scoring.")

    deployment_state = _score_and_bridge(fcc_service, fcc_env_root, model_run)
    _log(
        "Scored and bridged FCC retained queue "
        f"(suppressed={deployment_state['scoring']['suppressed']}, "
        f"escalated={deployment_state['scoring']['escalated']})."
    )

    pipeline_state = _create_pipeline(
        mlops_service=fcc_service,
        dataset_ids=registrations,
        model_run_id=model_run["run_id"],
        deployment_id=str(deployment_state["deployment"]["deployment_id"]),
        threshold=float(deployment_state["deployment"]["threshold"]),
    )
    _log(f"Created FCC workbench pipeline '{PIPELINE_NAME}' as pipeline {pipeline_state['pipeline_id']}.")

    sentinel_service = MLOpsWorkbenchService(
        resolve_env_root(SENTINEL_ENV_ID, TENANT_ID, create_if_missing=True) / "mlops" / "duckdb" / "mlops.duckdb"
    )
    sentinel_checks = _verify_sentinel_workspace()
    session_ids = _save_workflow_sessions(
        fcc_service=fcc_service,
        sentinel_service=sentinel_service,
        pipeline_id=int(pipeline_state["pipeline_id"]),
        model_run_id=str(model_run["run_id"]),
        deployment_id=str(deployment_state["deployment"]["deployment_id"]),
        publish_id=str(deployment_state["publish"]["publish_id"]),
        selected_case_id=str(sentinel_checks["sample_case_id"]),
        report_id=str(pipeline_state["report"].get("report_id") or ""),
    )
    _log(f"Saved FCC/Sentinel workflow sessions for pipeline {pipeline_state['pipeline_id']}.")

    summary = {
        "tenant_id": TENANT_ID,
        "fcc_env_id": FCC_ENV_ID,
        "sentinel_env_id": SENTINEL_ENV_ID,
        "pipeline_name": PIPELINE_NAME,
        "pipeline_id": int(pipeline_state["pipeline_id"]),
        "pipeline_route": f"/mlops/runs/{int(pipeline_state['pipeline_id'])}/pipelines",
        "source_env_template": str(SOURCE_ENV_ROOT),
        "datasets": {
            key: {
                "dataset_id": int(info["dataset_id"]),
                "row_count": int(info["row_count"]),
                "dataset_type": str(info["dataset_type"]),
            }
            for key, info in registrations.items()
        },
        "model_run": model_run,
        "deployment": deployment_state["deployment"],
        "scoring": {
            "batch_id": str(deployment_state["scoring"]["batch_id"]),
            "total": int(deployment_state["scoring"]["total"]),
            "suppressed": int(deployment_state["scoring"]["suppressed"]),
            "escalated": int(deployment_state["scoring"]["escalated"]),
            "suppression_rate": float(deployment_state["scoring"]["suppression_rate"]),
        },
        "bridge": {
            "publish_id": str(deployment_state["publish"]["publish_id"]),
            "published_rows": int(deployment_state["publish"]["published_rows"]),
            "published_case_count": int(
                deployment_state["publish"].get("published_case_count")
                or (deployment_state["publish"].get("table_counts") or {}).get("cases")
                or deployment_state["import"].get("source_published_case_count")
                or 0
            ),
            "import_table_counts": deployment_state["import"].get("table_counts") or {},
        },
        "fcc_pipeline": {
            "workflow_manifest": pipeline_state["pipeline"]["workflow_manifest"],
            "report_id": pipeline_state["report"].get("report_id"),
        },
        "sentinel": sentinel_checks,
        "workflow_sessions": session_ids,
        "artifacts": {
            "backend_summary": str(SUMMARY_PATH),
            "screenshots_dir": str(SCREENSHOTS_DIR),
            "videos_dir": str(VIDEOS_DIR),
        },
    }
    _json_dump(SUMMARY_PATH, summary)
    _log(f"Wrote backend summary to {SUMMARY_PATH}")
    return summary


if __name__ == "__main__":
    run()
