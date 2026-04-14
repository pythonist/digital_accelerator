from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd
import requests


def _now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _print_step(message: str) -> None:
    print(f"[MULE-E2E] {message}", flush=True)


class ApiClient:
    def __init__(self, base_url: str, env_id: str, timeout: int = 600):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({"X-Environment-ID": env_id})

    def call(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        expect_success: bool = True,
    ) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        merged_params = {"env_id": self.session.headers.get("X-Environment-ID")}
        if params:
            merged_params.update(params)
        response = self.session.request(
            method=method.upper(),
            url=url,
            params=merged_params,
            json=json_body,
            files=files,
            data=data,
            timeout=self.timeout,
        )
        payload: Dict[str, Any] = {}
        try:
            payload = response.json()
        except Exception:
            payload = {"success": False, "error": response.text}
        if response.status_code >= 400 or (expect_success and not payload.get("success", False)):
            message = payload.get("error") or payload.get("message") or response.text
            raise RuntimeError(
                f"{method.upper()} {path} failed ({response.status_code}): {message}"
            )
        return payload


def _copy_if_exists(src: Optional[str], dst_dir: Path) -> Optional[str]:
    if not src:
        return None
    path = Path(src)
    if not path.exists() or not path.is_file():
        return None
    dst = dst_dir / path.name
    shutil.copy2(path, dst)
    return str(dst)


def _upload_sources(client: ApiClient, pipeline_id: int, source_dir: Path) -> List[Dict[str, Any]]:
    uploaded: List[Dict[str, Any]] = []
    preferred_files = [
        "accounts.csv",
        "customers.csv",
        "transactions.csv",
        "counterparties.csv",
        "device_logs.csv",
        "external_signals.csv",
        "graph_nodes.csv",
        "graph_edges.csv",
        "mule_labels.csv",
        "mule_typology.csv",
        "account_daily_summary.csv",
    ]
    for name in preferred_files:
        path = source_dir / name
        if not path.exists():
            continue
        dataset_type = path.stem.strip().lower()
        _print_step(f"Uploading {name} as dataset_type={dataset_type}")
        with path.open("rb") as fh:
            result = client.call(
                "POST",
                f"/api/mlops/upload/{dataset_type}",
                params={"pipeline_id": pipeline_id, "pipeline_type": "mule"},
                files={"file": (path.name, fh, "text/csv")},
            )
        uploaded.append(result.get("data") or result)
    if not uploaded:
        raise RuntimeError(f"No Mule source files found under {source_dir}")
    return uploaded


def _pick_dataset_path(rows: Iterable[Dict[str, Any]], dataset_type: str) -> Optional[str]:
    for row in rows:
        if str(row.get("dataset_type", "")).strip().lower() == dataset_type:
            path = str(row.get("file_path") or "").strip()
            if path:
                return path
    return None


def run_e2e(base_url: str, env_id: str, source_dir: Path, output_root: Path) -> Dict[str, Any]:
    client = ApiClient(base_url=base_url, env_id=env_id)
    tag = _now_tag()
    run_name = f"Mule E2E API {tag}"

    _print_step("Creating a new Mule pipeline")
    pipeline_res = client.call(
        "POST",
        "/api/mlops/pipeline/save",
        json_body={
            "name": run_name,
            "pipeline_type": "mule",
            "model_family": "mule",
            "grain": "account",
            "output_name": "mule_master_dataset",
            "created_by_persona": "technical",
            "steps": [],
        },
    )
    pipeline = pipeline_res.get("data") or {}
    pipeline_id = int(pipeline.get("pipeline_id") or 0)
    if pipeline_id <= 0:
        raise RuntimeError("Pipeline creation returned an invalid pipeline_id")
    _print_step(f"Pipeline created: pipeline_id={pipeline_id}")

    _print_step("Uploading Mule source bundle through real upload APIs")
    uploaded = _upload_sources(client, pipeline_id, source_dir)

    _print_step("Running Master Dataset preview/build")
    master_preview = client.call(
        "POST",
        "/api/mule/master-dataset/preview",
        params={"pipeline_id": pipeline_id},
        json_body={"pipeline_id": pipeline_id},
    ).get("data") or {}
    master_build = client.call(
        "POST",
        "/api/mule/master-dataset/build",
        params={"pipeline_id": pipeline_id},
        json_body={
            "pipeline_id": pipeline_id,
            "output_table_name": f"mule_abt_e2e_{pipeline_id}",
        },
    ).get("data") or {}

    _print_step("Generating Feature Store")
    feature_generate: Dict[str, Any] = {}
    feature_store_error: Optional[str] = None
    try:
        feature_generate = client.call(
            "POST",
            "/api/mule/feature-store/generate",
            params={"pipeline_id": pipeline_id},
            json_body={"pipeline_id": pipeline_id, "regenerate": True},
        ).get("data") or {}
    except Exception as exc:
        feature_store_error = str(exc)
        _print_step(f"Feature Store generation failed, falling back to master-dataset preprocessing. {feature_store_error}")

    _print_step("Running Preprocessing")
    source_dataset_key = "feature_store" if not feature_store_error else "master"
    preprocess_run = client.call(
        "POST",
        "/api/mule/preprocessing/run",
        params={"pipeline_id": pipeline_id},
        json_body={
            "pipeline_id": pipeline_id,
            "source_dataset_key": source_dataset_key,
            "target_column": "mule_flag",
            "output_table_name": f"mule_feature_studio_e2e_{pipeline_id}",
        },
    ).get("data") or {}

    _print_step("Training model")
    model_train = client.call(
        "POST",
        "/api/mule/model-build/train",
        params={"pipeline_id": pipeline_id},
        json_body={
            "pipeline_id": pipeline_id,
            "config": {
                "supervised_algorithm": "random_forest",
                "typology_algorithm": "gradient_boosting",
                "anomaly_enabled": True,
                "decision_threshold": 0.5,
            },
        },
    ).get("data") or {}

    _print_step("Running model validation")
    validation_run = client.call(
        "POST",
        "/api/mule/model-validation/run",
        params={"pipeline_id": pipeline_id},
        json_body={"pipeline_id": pipeline_id},
    ).get("data") or {}

    _print_step("Collecting final statuses and datasets")
    feature_status = client.call("GET", f"/api/mule/feature-store/status/{pipeline_id}").get("data") or {}
    preprocess_status = client.call("GET", f"/api/mule/preprocessing/status/{pipeline_id}").get("data") or {}
    model_status = client.call("GET", f"/api/mule/model-build/status/{pipeline_id}").get("data") or {}
    validation_status = client.call("GET", f"/api/mule/model-validation/status/{pipeline_id}").get("data") or {}
    datasets_payload = client.call(
        "GET",
        "/api/mlops/datasets",
        params={"pipeline_id": pipeline_id, "pipeline_type": "mule"},
    )
    all_datasets = datasets_payload.get("data") or datasets_payload.get("datasets") or []

    output_dir = output_root / f"mule_e2e_pipeline_{pipeline_id}_{tag}"
    output_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir = output_dir / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=True)

    copied_files: Dict[str, Optional[str]] = {}
    copied_files["master_dataset"] = _copy_if_exists(
        (master_build.get("summary") or {}).get("output_file_path"), artifact_dir
    )
    copied_files["feature_store_selected"] = _copy_if_exists(
        feature_status.get("feature_store_path"), artifact_dir
    )
    copied_files["feature_store_full"] = _copy_if_exists(
        feature_status.get("full_feature_store_path"), artifact_dir
    )
    copied_files["feature_catalog"] = _copy_if_exists(
        feature_status.get("catalog_path"), artifact_dir
    )
    copied_files["preprocess_dataset"] = _copy_if_exists(
        _pick_dataset_path(all_datasets, "preprocess_dataset")
        or _pick_dataset_path(all_datasets, "preprocessed_dataset"),
        artifact_dir,
    )
    latest_model_run = (model_status.get("latest_run") or {})
    copied_files["model_bundle"] = _copy_if_exists(latest_model_run.get("model_path"), artifact_dir)
    copied_files["model_output"] = _copy_if_exists(latest_model_run.get("output_path"), artifact_dir)
    latest_validation = (validation_status.get("latest_validation") or {})
    copied_files["validation_graph"] = _copy_if_exists(latest_validation.get("graph_artifact_path"), artifact_dir)

    model_output_path = copied_files.get("model_output")
    inference_preview_path = None
    high_risk_path = None
    if model_output_path:
        model_df = pd.read_csv(model_output_path)
        keep_cols = [
            col for col in [
                "account_id",
                "mule_risk_score",
                "predicted_mule_flag",
                "predicted_mule_typology",
                "risk_band",
                "model_confidence",
                "top_drivers",
                "supporting_signals",
                "investigator_explanation",
            ]
            if col in model_df.columns
        ]
        inference_preview = model_df[keep_cols].head(250).copy() if keep_cols else model_df.head(250).copy()
        inference_preview_path = output_dir / "mule_inference_preview.csv"
        inference_preview.to_csv(inference_preview_path, index=False)

        if "risk_band" in model_df.columns:
            high_risk = model_df[model_df["risk_band"].astype(str).str.lower() == "high risk"].head(100).copy()
            if not high_risk.empty:
                high_risk_path = output_dir / "mule_high_risk_top100.csv"
                high_risk.to_csv(high_risk_path, index=False)

    summary = {
        "pipeline_id": pipeline_id,
        "pipeline_name": run_name,
        "env_id": env_id,
        "source_dir": str(source_dir),
        "uploaded_sources_count": len(uploaded),
        "master_preview_summary": master_preview.get("summary"),
        "master_build": {
            "row_count": master_build.get("row_count"),
            "column_count": master_build.get("column_count"),
            "output_table_name": master_build.get("output_table_name"),
        },
        "feature_store": {
            "status": feature_status.get("generation_status"),
            "total_features": feature_status.get("total_features"),
            "selected_features_count": feature_status.get("selected_features_count"),
            "generation_error": feature_store_error,
        },
        "preprocessing": {
            "build_status": preprocess_status.get("build_status"),
            "feature_count_estimate": preprocess_status.get("feature_count_estimate"),
        },
        "model": {
            "status": model_status.get("status"),
            "metrics": (model_status.get("latest_run") or {}).get("metrics") or model_train.get("metrics"),
            "typology_enabled": (model_status.get("latest_run") or {}).get("typology_enabled"),
        },
        "validation": {
            "status": validation_status.get("status"),
            "summary": latest_validation.get("summary"),
        },
        "artifacts": copied_files,
        "inference_preview_csv": str(inference_preview_path) if inference_preview_path else None,
        "high_risk_csv": str(high_risk_path) if high_risk_path else None,
        "output_dir": str(output_dir),
    }

    summary_path = output_dir / "run_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    _print_step(f"E2E run complete. Summary: {summary_path}")
    return summary


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run Mule E2E pipeline using backend APIs and export artifacts.")
    parser.add_argument("--base-url", default="http://127.0.0.1:5000")
    parser.add_argument("--env-id", default="fcc_env")
    parser.add_argument(
        "--source-dir",
        default=str(
            Path("AI_AML_tool")
            / "backend"
            / "data"
            / "environments"
            / "fcc_env"
            / "mlops"
            / "data"
            / "mule_bundle"
            / "pipeline_4"
        ),
    )
    parser.add_argument(
        "--output-root",
        default=str(Path("AI_AML_tool") / "mlops_e2e_outputs"),
    )
    args = parser.parse_args(argv)

    source_dir = Path(args.source_dir).resolve()
    output_root = Path(args.output_root).resolve()
    if not source_dir.exists():
        raise RuntimeError(f"Source directory not found: {source_dir}")

    summary = run_e2e(
        base_url=args.base_url,
        env_id=args.env_id,
        source_dir=source_dir,
        output_root=output_root,
    )
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
