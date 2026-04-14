from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd


def _now_tag() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def _log(message: str) -> None:
    print(f"[MULE-TESTCLIENT] {message}", flush=True)


def _copy_if_exists(path_value: Optional[str], dst_dir: Path) -> Optional[str]:
    if not path_value:
        return None
    src = Path(path_value)
    if not src.exists() or not src.is_file():
        return None
    dst = dst_dir / src.name
    shutil.copy2(src, dst)
    return str(dst)


def _pick_dataset(rows: Iterable[Dict[str, Any]], dataset_type: str) -> Optional[Dict[str, Any]]:
    for row in rows:
        if str(row.get("dataset_type", "")).strip().lower() == dataset_type:
            return row
    return None


class LocalApi:
    def __init__(self, env_id: str):
        os.environ.setdefault("AML_AUTO_BOOTSTRAP_VENV", "0")
        backend_root = Path(__file__).resolve().parents[1]
        if str(backend_root) not in sys.path:
            sys.path.insert(0, str(backend_root))
        from app import app  # pylint: disable=import-outside-toplevel

        self.env_id = env_id
        self.client = app.test_client()
        self.headers = {"X-Environment-ID": env_id}

    def call(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        form: Optional[Dict[str, Any]] = None,
        expect_success: bool = True,
    ) -> Dict[str, Any]:
        params = {"env_id": self.env_id}
        if query:
            params.update(query)
        query_str = "&".join(f"{key}={value}" for key, value in params.items())
        url = f"{path}?{query_str}"
        if json_body is not None:
            response = self.client.open(url, method=method.upper(), json=json_body, headers=self.headers)
        elif form is not None:
            response = self.client.open(url, method=method.upper(), data=form, headers=self.headers, content_type="multipart/form-data")
        else:
            response = self.client.open(url, method=method.upper(), headers=self.headers)

        payload: Dict[str, Any] = {}
        try:
            payload = response.get_json(silent=True) or {}
        except Exception:
            payload = {"success": False, "error": response.get_data(as_text=True)}

        if response.status_code >= 400 or (expect_success and not payload.get("success", False)):
            message = payload.get("error") or payload.get("message") or response.get_data(as_text=True)
            raise RuntimeError(f"{method.upper()} {path} failed ({response.status_code}): {message}")
        return payload


def run_e2e(env_id: str, source_dir: Path, output_root: Path) -> Dict[str, Any]:
    api = LocalApi(env_id=env_id)
    tag = _now_tag()

    _log("Creating Mule pipeline")
    pipeline_res = api.call(
        "POST",
        "/api/mlops/pipeline/save",
        json_body={
            "name": f"Mule TestClient E2E {tag}",
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
        raise RuntimeError("Pipeline creation did not return a valid pipeline_id")
    _log(f"Pipeline created: {pipeline_id}")

    upload_order = [
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
    uploaded: List[Dict[str, Any]] = []
    _log("Uploading source bundle")
    for file_name in upload_order:
        source_path = source_dir / file_name
        if not source_path.exists():
            continue
        dtype = source_path.stem.lower()
        with source_path.open("rb") as fh:
            payload = api.call(
                "POST",
                f"/api/mlops/upload/{dtype}",
                query={"pipeline_id": pipeline_id, "pipeline_type": "mule"},
                form={
                    "pipeline_id": str(pipeline_id),
                    "pipeline_type": "mule",
                    "file": (fh, source_path.name),
                },
            )
        uploaded.append(payload.get("data") or payload)
    if not uploaded:
        raise RuntimeError(f"No source CSV files found in {source_dir}")
    _log(f"Uploaded {len(uploaded)} source tables")

    _log("Running master preview/build")
    master_preview = api.call(
        "POST",
        "/api/mule/master-dataset/preview",
        query={"pipeline_id": pipeline_id},
        json_body={"pipeline_id": pipeline_id},
    ).get("data") or {}
    master_build = api.call(
        "POST",
        "/api/mule/master-dataset/build",
        query={"pipeline_id": pipeline_id},
        json_body={"pipeline_id": pipeline_id, "output_table_name": f"mule_abt_e2e_{pipeline_id}"},
    ).get("data") or {}

    _log("Generating feature store (fallback to master if needed)")
    feature_error: Optional[str] = None
    try:
        api.call(
            "POST",
            "/api/mule/feature-store/generate",
            query={"pipeline_id": pipeline_id},
            json_body={"pipeline_id": pipeline_id, "regenerate": True},
        )
    except Exception as exc:
        feature_error = str(exc)
        _log(f"Feature store failed: {feature_error}")

    _log("Running preprocessing")
    preprocess_run = api.call(
        "POST",
        "/api/mule/preprocessing/run",
        query={"pipeline_id": pipeline_id},
        json_body={
            "pipeline_id": pipeline_id,
            "source_dataset_key": "feature_store" if feature_error is None else "master",
            "target_column": "mule_flag",
            "output_table_name": f"mule_feature_studio_e2e_{pipeline_id}",
        },
    ).get("data") or {}

    _log("Training model build")
    model_train = api.call(
        "POST",
        "/api/mule/model-build/train",
        query={"pipeline_id": pipeline_id},
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

    _log("Running validation")
    validation_run = api.call(
        "POST",
        "/api/mule/model-validation/run",
        query={"pipeline_id": pipeline_id},
        json_body={"pipeline_id": pipeline_id},
    ).get("data") or {}

    _log("Collecting statuses and dataset inventory")
    feature_status = api.call("GET", f"/api/mule/feature-store/status/{pipeline_id}").get("data") or {}
    preprocess_status = api.call("GET", f"/api/mule/preprocessing/status/{pipeline_id}").get("data") or {}
    model_status = api.call("GET", f"/api/mule/model-build/status/{pipeline_id}").get("data") or {}
    validation_status = api.call("GET", f"/api/mule/model-validation/status/{pipeline_id}").get("data") or {}
    datasets_payload = api.call("GET", "/api/mlops/datasets", query={"pipeline_id": pipeline_id, "pipeline_type": "mule"})
    datasets = datasets_payload.get("data") or datasets_payload.get("datasets") or []

    out_dir = output_root / f"mule_testclient_e2e_pipeline_{pipeline_id}_{tag}"
    out_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir = out_dir / "artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    copied: Dict[str, Optional[str]] = {}
    copied["master_dataset"] = _copy_if_exists((master_build.get("summary") or {}).get("output_file_path"), artifacts_dir)
    copied["feature_store_selected"] = _copy_if_exists(feature_status.get("feature_store_path"), artifacts_dir)
    copied["feature_store_full"] = _copy_if_exists(feature_status.get("full_feature_store_path"), artifacts_dir)
    copied["feature_catalog"] = _copy_if_exists(feature_status.get("catalog_path"), artifacts_dir)
    preprocess_dataset = _pick_dataset(datasets, "preprocess_dataset") or _pick_dataset(datasets, "preprocessed_dataset")
    copied["preprocess_dataset"] = _copy_if_exists(str((preprocess_dataset or {}).get("file_path") or ""), artifacts_dir)

    latest_model = model_status.get("latest_run") or {}
    copied["model_bundle"] = _copy_if_exists(latest_model.get("model_path"), artifacts_dir)
    copied["model_output"] = _copy_if_exists(latest_model.get("output_path"), artifacts_dir)

    latest_validation = validation_status.get("latest_validation") or {}
    copied["validation_graph"] = _copy_if_exists(latest_validation.get("graph_artifact_path"), artifacts_dir)

    inference_preview_csv = None
    high_risk_csv = None
    model_output_path = copied.get("model_output")
    if model_output_path:
        scored = pd.read_csv(model_output_path)
        wanted = [
            col
            for col in [
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
            if col in scored.columns
        ]
        inference_preview = scored[wanted].head(300).copy() if wanted else scored.head(300).copy()
        inference_preview_csv = out_dir / "mule_inference_preview.csv"
        inference_preview.to_csv(inference_preview_csv, index=False)

        if "risk_band" in scored.columns:
            high_risk = scored[scored["risk_band"].astype(str).str.lower() == "high risk"].copy()
            if not high_risk.empty:
                high_risk_csv = out_dir / "mule_high_risk_top100.csv"
                high_risk.head(100).to_csv(high_risk_csv, index=False)

    summary = {
        "env_id": env_id,
        "pipeline_id": pipeline_id,
        "uploaded_sources": len(uploaded),
        "feature_store_error": feature_error,
        "master_build": {
            "output_table_name": master_build.get("output_table_name"),
            "row_count": master_build.get("row_count"),
            "column_count": master_build.get("column_count"),
        },
        "preprocess_run": {
            "run_id": preprocess_run.get("run_id"),
            "dataset": preprocess_run.get("dataset"),
        },
        "model_train": {
            "run_id": model_train.get("run_id"),
            "metrics": model_train.get("metrics"),
            "typology_enabled": model_train.get("typology_enabled"),
        },
        "validation_summary": (validation_run.get("latest_validation") or {}).get("summary"),
        "copied_artifacts": copied,
        "inference_preview_csv": str(inference_preview_csv) if inference_preview_csv else None,
        "high_risk_csv": str(high_risk_csv) if high_risk_csv else None,
        "output_dir": str(out_dir),
    }
    summary_path = out_dir / "run_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
    _log(f"Done. Summary saved at {summary_path}")
    return summary


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run Mule E2E backend APIs with Flask test_client and export artifacts.")
    parser.add_argument("--env-id", default="fcc_e2e_codex")
    parser.add_argument(
        "--source-dir",
        default=str(
            Path(__file__).resolve().parents[1]
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
        default=str(Path(__file__).resolve().parents[2] / "mlops_e2e_outputs"),
    )
    args = parser.parse_args(argv)

    source_dir = Path(args.source_dir).resolve()
    if not source_dir.exists():
        raise RuntimeError(f"Source directory not found: {source_dir}")
    output_root = Path(args.output_root).resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    summary = run_e2e(env_id=args.env_id, source_dir=source_dir, output_root=output_root)
    print(json.dumps(summary, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
