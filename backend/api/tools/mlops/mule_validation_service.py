from __future__ import annotations

import json
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd
from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mule_graph_service import MuleGraphService
from api.tools.mlops.mule_workspace_service import MuleWorkspaceService
from api.tools.mlops.path_utils import resolve_data_file_path, resolve_mlops_data_dir


def _txt(value: Any) -> str:
    return str(value or "").strip()


def _low(value: Any) -> str:
    return _txt(value).lower()


def _loads(value: Any, fallback: Any):
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _load_frame(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    return pd.read_csv(path)


class MuleValidationService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()
        self.graph_service = MuleGraphService(db_path)
        self.workspace = MuleWorkspaceService(self.db_path)

    def _conn_ctx(self, conn=None):
        return nullcontext(conn) if conn is not None else get_connection(self.db_path)

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_model_validation_runs (
                  validation_run_id BIGINT PRIMARY KEY,
                  pipeline_id INTEGER,
                  model_run_id BIGINT,
                  validation_summary_json TEXT,
                  graph_summary_json TEXT,
                  graph_artifact_path TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _env_root(self) -> Path:
        return self.db_path.resolve().parents[2]

    def _artifacts_dir(self) -> Path:
        path = resolve_mlops_data_dir(self._env_root(), create_if_missing=True) / "mule_validation"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _ensure_pipeline_exists(self, pipeline_id: int, expected_type: str = "mule") -> Dict[str, Any]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT pipeline_id, name, pipeline_type, model_family
                FROM mlops_pipelines
                WHERE pipeline_id = ?
                """,
                [int(pipeline_id)],
            ).fetchone()
        if not row:
            raise ValueError(
                f'Pipeline {int(pipeline_id)} is not available in backend persistence. '
                'Reopen a saved Mule run from Pipeline Hub or create a new run.'
            )
        pipeline_type = _low(row[2] or row[3] or "fcc") or "fcc"
        if expected_type and pipeline_type != _low(expected_type):
            raise ValueError(
                f'Pipeline {int(pipeline_id)} is saved as "{pipeline_type}", not "{_low(expected_type)}". '
                'Open the correct run from Pipeline Hub before continuing.'
            )
        return {
            "pipeline_id": int(row[0]),
            "name": _txt(row[1]) or f"Mule Pipeline {int(pipeline_id)}",
            "pipeline_type": pipeline_type,
        }

    def _workspace_mark(
        self,
        tenant_id: str,
        pipeline_id: int,
        stage_status: str,
        substage: str,
        *,
        summary: Optional[Dict[str, Any]] = None,
        error: Optional[Dict[str, Any]] = None,
        current_stage: Optional[str] = None,
        current_substage: Optional[str] = None,
        conn=None,
    ) -> None:
        self.workspace.ensure_run(
            int(pipeline_id),
            user_id=_txt(tenant_id) or "system",
            status="in_progress",
            current_stage=_txt(current_stage) or "model_output_validation",
            current_substage=_txt(current_substage or substage),
            conn=conn,
        )
        self.workspace.set_stage_state(
            int(pipeline_id),
            "model_output_validation",
            stage_status,
            substage=_txt(substage),
            summary=summary or {},
            error=error or {},
            conn=conn,
        )
        if current_stage or current_substage:
            self.workspace.update_run(
                int(pipeline_id),
                status="failed" if stage_status == "failed" else "in_progress",
                current_stage=_txt(current_stage) or "model_output_validation",
                current_substage=_txt(current_substage or substage),
                conn=conn,
            )

    def _load_dataset_by_type(
        self,
        tenant_id: str,
        env_id: str,
        dataset_types: Iterable[str],
        pipeline_id: Optional[int] = None,
    ) -> Optional[pd.DataFrame]:
        wanted = {str(item).strip().lower() for item in dataset_types if str(item).strip()}
        with get_connection(self.db_path) as conn:
            if pipeline_id is not None:
                rows = conn.execute(
                    """
                    SELECT dataset_type, file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND pipeline_id = ?
                    ORDER BY updated_at DESC, dataset_id DESC
                    """,
                    [tenant_id, env_id, int(pipeline_id)],
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT dataset_type, file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule'
                    ORDER BY updated_at DESC, dataset_id DESC
                    """,
                    [tenant_id, env_id],
                ).fetchall()
        for dataset_type, file_path in rows:
            if _low(dataset_type) not in wanted:
                continue
            path = resolve_data_file_path(Path(file_path), env_root=self._env_root())
            if not path.exists():
                continue
            try:
                frame = _load_frame(path)
            except Exception:
                continue
            if not frame.empty:
                return frame
        return None

    def _load_latest_preprocessed(self, tenant_id: str, env_id: str, pipeline_id: Optional[int] = None) -> Optional[pd.DataFrame]:
        return self._load_dataset_by_type(tenant_id, env_id, ["preprocess_dataset", "preprocessed_dataset"], pipeline_id=pipeline_id)

    def _latest_model_run(self, pipeline_id: int) -> Optional[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id, output_path, output_table_name, metrics_json, risk_bands_json, created_at
                FROM mule_model_build_runs
                WHERE pipeline_id = ?
                ORDER BY created_at DESC, run_id DESC
                LIMIT 1
                """,
                [int(pipeline_id)],
            ).fetchone()
        if not row:
            return None
        return {
            "model_run_id": int(row[0]),
            "output_path": _txt(row[1]),
            "output_table_name": _txt(row[2]),
            "metrics": _loads(row[3], {}),
            "risk_bands": _loads(row[4], {"high": 0.75, "medium": 0.45}),
            "created_at": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
        }

    def _latest_validation_row(self, pipeline_id: int):
        with get_connection(self.db_path) as conn:
            return conn.execute(
                """
                SELECT validation_run_id, model_run_id, validation_summary_json, graph_summary_json, graph_artifact_path, created_at
                FROM mule_model_validation_runs
                WHERE pipeline_id = ?
                ORDER BY created_at DESC, validation_run_id DESC
                LIMIT 1
                """,
                [int(pipeline_id)],
            ).fetchone()

    def _merge_truth(self, tenant_id: str, env_id: str, pipeline_id: int, output_df: pd.DataFrame) -> pd.DataFrame:
        merged = output_df.copy()
        if "account_id" not in merged.columns:
            return merged
        merged["account_id"] = merged["account_id"].astype(str)

        preprocessed = self._load_latest_preprocessed(tenant_id, env_id, pipeline_id=pipeline_id)
        labels = self._load_dataset_by_type(tenant_id, env_id, ["mule_labels"], pipeline_id=pipeline_id)
        typology = self._load_dataset_by_type(tenant_id, env_id, ["mule_typology"], pipeline_id=pipeline_id)

        candidate_frames: List[pd.DataFrame] = []
        if preprocessed is not None and "account_id" in preprocessed.columns:
            keep = [column for column in ["account_id", "mule_flag", "mule_typology"] if column in preprocessed.columns]
            if keep:
                candidate_frames.append(preprocessed[keep].copy())
        if labels is not None and "account_id" in labels.columns:
            keep = [column for column in ["account_id", "mule_flag", "mule_event_date", "target_source_type", "target_reason_summary"] if column in labels.columns]
            candidate_frames.append(labels[keep].copy())
        if typology is not None and "account_id" in typology.columns:
            keep = [column for column in ["account_id", "mule_typology", "typology_confidence", "typology_reason_summary"] if column in typology.columns]
            candidate_frames.append(typology[keep].copy())

        for frame in candidate_frames:
            frame["account_id"] = frame["account_id"].astype(str)
            deduped = frame.drop_duplicates(subset=["account_id"], keep="first")
            merged = merged.merge(deduped, on="account_id", how="left", suffixes=("", "__dup"))
            duplicate_columns = [column for column in merged.columns if column.endswith("__dup")]
            for duplicate in duplicate_columns:
                canonical = duplicate[:-5]
                if canonical in merged.columns:
                    merged[canonical] = merged[canonical].where(merged[canonical].notna(), merged[duplicate])
                else:
                    merged.rename(columns={duplicate: canonical}, inplace=True)
            merged.drop(columns=[column for column in merged.columns if column.endswith("__dup")], inplace=True, errors="ignore")
        return merged

    def _build_summary(
        self,
        model_run: Dict[str, Any],
        scored: pd.DataFrame,
        graph_result: Dict[str, Any],
    ) -> Dict[str, Any]:
        ordered = scored.sort_values(by="mule_risk_score", ascending=False).reset_index(drop=True)
        total = int(len(ordered))
        high_risk = int((ordered.get("risk_band", pd.Series(dtype=object)) == "High Risk").sum()) if "risk_band" in ordered.columns else 0
        medium_risk = int((ordered.get("risk_band", pd.Series(dtype=object)) == "Medium Risk").sum()) if "risk_band" in ordered.columns else 0
        low_risk = int((ordered.get("risk_band", pd.Series(dtype=object)) == "Low Risk").sum()) if "risk_band" in ordered.columns else 0
        summary: Dict[str, Any] = {
            "total_accounts_scored": total,
            "high_risk_count": high_risk,
            "medium_risk_count": medium_risk,
            "low_risk_count": low_risk,
            "average_score": float(pd.to_numeric(ordered.get("mule_risk_score"), errors="coerce").fillna(0.0).mean()) if total else 0.0,
            "thresholds": model_run.get("risk_bands") or {"high": 0.75, "medium": 0.45},
            "typology_prediction_coverage": 0.0,
            "typology_classes_detected": [],
            "positive_class_rate": None,
            "precision": None,
            "recall": None,
            "f1": None,
            "pr_auc": None,
            "top_n_capture": None,
            "event_loss_rate": None,
            "confusion_matrix": None,
            "warnings": [],
            "validation_status": "ready",
            "graph_enabled": bool((graph_result.get("summary") or {}).get("enabled")),
        }

        if "predicted_mule_typology" in ordered.columns:
            predicted_typology = ordered["predicted_mule_typology"].apply(_txt)
            summary["typology_prediction_coverage"] = float(predicted_typology.apply(lambda value: bool(value) and _low(value) != "nan").mean()) if total else 0.0
            summary["typology_classes_detected"] = sorted({_txt(value) for value in predicted_typology.tolist() if _txt(value) and _low(value) != "nan"})

        if "mule_flag" in ordered.columns and ordered["mule_flag"].notna().any():
            y_true = pd.to_numeric(ordered["mule_flag"], errors="coerce").fillna(0).astype(int)
            y_pred = pd.to_numeric(ordered.get("predicted_mule_flag", 0), errors="coerce").fillna(0).astype(int)
            y_score = pd.to_numeric(ordered.get("mule_risk_score", 0.0), errors="coerce").fillna(0.0)
            positives = int(y_true.sum())
            tp = int(((y_true == 1) & (y_pred == 1)).sum())
            fp = int(((y_true == 0) & (y_pred == 1)).sum())
            tn = int(((y_true == 0) & (y_pred == 0)).sum())
            fn = int(((y_true == 1) & (y_pred == 0)).sum())
            top_n = min(100, len(ordered))
            top_capture = float(y_true.iloc[:top_n].sum() / positives) if positives > 0 else 0.0
            pr_auc = float(average_precision_score(y_true, y_score)) if y_true.nunique() > 1 else 0.0
            summary.update(
                {
                    "positive_class_rate": float(positives / max(total, 1)),
                    "precision": float(precision_score(y_true, y_pred, zero_division=0)),
                    "recall": float(recall_score(y_true, y_pred, zero_division=0)),
                    "f1": float(f1_score(y_true, y_pred, zero_division=0)),
                    "pr_auc": pr_auc,
                    "top_n_capture": top_capture,
                    "event_loss_rate": float(fn / positives) if positives > 0 else 0.0,
                    "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
                }
            )
            if positives <= 0:
                summary["warnings"].append("No positive mule labels were found in the validation set.")
            if summary["precision"] is not None and summary["precision"] < 0.2:
                summary["warnings"].append("Precision is low for the current threshold. Review the risk cutoff before handoff.")
            if summary["event_loss_rate"] is not None and summary["event_loss_rate"] > 0.4:
                summary["warnings"].append("Event loss is elevated. The model is missing too many known mule accounts.")
        else:
            summary["warnings"].append("Validated labels are not available, so outcome metrics are limited to score distribution and graph patterns.")

        if not summary["graph_enabled"]:
            summary["warnings"].append("Graph analysis is not available because graph source tables were not found or could not be connected.")

        if summary["high_risk_count"] <= 0:
            summary["warnings"].append("No accounts fell into the High Risk band. Review thresholds or model calibration.")

        if summary["typology_prediction_coverage"] <= 0:
            summary["warnings"].append("Typology prediction is not available for the current output.")

        top_accounts = ordered.head(12).copy()
        keep = [
            column for column in [
                "account_id",
                "mule_risk_score",
                "predicted_mule_flag",
                "predicted_mule_typology",
                "risk_band",
                "graph_cluster_id",
                "graph_risk_score",
                "top_drivers",
                "supporting_signals",
            ]
            if column in top_accounts.columns
        ]
        summary["top_accounts"] = top_accounts[keep].fillna("").to_dict(orient="records") if keep else []
        graph_summary = graph_result.get("summary") or {}
        if graph_summary:
            summary["graph_summary"] = graph_summary
        return summary

    def _compute(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        model_run = self._latest_model_run(pipeline_id)
        if not model_run:
            return {
                "pipeline_id": int(pipeline_id),
                "status": "not_ready",
                "latest_validation": None,
                "graph_payload": {"nodes": [], "links": [], "clusters": [], "focus_cluster_id": "", "truncated": False},
            }

        output_path = resolve_data_file_path(Path(model_run["output_path"]), env_root=self._env_root())
        if not output_path.exists():
            raise ValueError("The latest Mule model output file is missing.")

        scored = _load_frame(output_path)
        scored = self._merge_truth(tenant_id, env_id, int(pipeline_id), scored)
        graph_result = self.graph_service.analyze(tenant_id, env_id, scored, pipeline_id=int(pipeline_id))
        summary = self._build_summary(model_run, scored, graph_result)

        latest_validation = {
            "model_run_id": int(model_run["model_run_id"]),
            "summary": summary,
            "graph_summary": graph_result.get("summary") or {},
            "created_at": model_run.get("created_at"),
        }
        return {
            "pipeline_id": int(pipeline_id),
            "status": "preview",
            "latest_validation": latest_validation,
            "graph_payload": graph_result.get("payload") or {"nodes": [], "links": [], "clusters": [], "focus_cluster_id": "", "truncated": False},
        }

    def run(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        pipeline = self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        job_id = f"mule-model-validation-{int(pipeline_id)}"
        self._workspace_mark(
            tenant_id,
            int(pipeline_id),
            "in_progress",
            "validate",
            summary={"status": "running"},
            current_stage="model_output_validation",
            current_substage="validate",
        )
        self.workspace.upsert_job(
            job_id,
            int(pipeline_id),
            "model_output_validation",
            "model_validation",
            "in_progress",
            progress_pct=10.0,
            logs={"event": "validation_started", "pipeline_name": _txt(pipeline.get("name"))},
        )
        try:
            computed = self._compute(tenant_id, env_id, pipeline_id)
        except Exception as exc:
            self.workspace.upsert_job(
                job_id,
                int(pipeline_id),
                "model_output_validation",
                "model_validation",
                "failed",
                progress_pct=100.0,
                logs={"event": "validation_failed", "message": str(exc)},
            )
            self._workspace_mark(
                tenant_id,
                int(pipeline_id),
                "failed",
                "validate",
                summary={"status": "failed"},
                error={"message": str(exc)},
                current_stage="model_output_validation",
                current_substage="validate",
            )
            raise
        if not computed.get("latest_validation"):
            self.workspace.upsert_job(
                job_id,
                int(pipeline_id),
                "model_output_validation",
                "model_validation",
                "completed",
                progress_pct=100.0,
                logs={"event": "validation_skipped", "status": _txt(computed.get("status") or "not_ready")},
            )
            self._workspace_mark(
                tenant_id,
                int(pipeline_id),
                "not_started",
                "validate",
                summary={"status": _txt(computed.get("status") or "not_ready")},
                current_stage="model_output_validation",
                current_substage="validate",
            )
            return computed

        payload = computed.get("graph_payload") or {"nodes": [], "links": [], "clusters": [], "focus_cluster_id": "", "truncated": False}
        summary = computed["latest_validation"]["summary"]
        graph_summary = computed["latest_validation"]["graph_summary"]
        model_run_id = int(computed["latest_validation"]["model_run_id"])
        try:
            with get_connection(self.db_path) as conn:
                validation_run_id = int(conn.execute("SELECT COALESCE(MAX(validation_run_id), 0) + 1 FROM mule_model_validation_runs").fetchone()[0] or 1)
                artifact_path = self._artifacts_dir() / f"mule_validation_graph_{int(pipeline_id)}_{validation_run_id}.json"
                summary_path = self._artifacts_dir() / f"mule_validation_summary_{int(pipeline_id)}_{validation_run_id}.json"
                artifact_path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
                summary_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")
                conn.execute(
                    """
                    INSERT INTO mule_model_validation_runs (
                      validation_run_id, pipeline_id, model_run_id, validation_summary_json,
                      graph_summary_json, graph_artifact_path
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        validation_run_id,
                        int(pipeline_id),
                        model_run_id,
                        json.dumps(summary, default=str),
                        json.dumps(graph_summary, default=str),
                        str(artifact_path),
                    ],
                )
                self.workspace.register_artifact(
                    int(pipeline_id),
                    "model_output_validation",
                    "validation_summary_json",
                    str(summary_path),
                    metadata={
                        "validation_run_id": int(validation_run_id),
                        "model_run_id": int(model_run_id),
                        "high_risk_count": int(summary.get("high_risk_count") or 0),
                        "total_accounts_scored": int(summary.get("total_accounts_scored") or 0),
                    },
                    conn=conn,
                )
                self.workspace.register_artifact(
                    int(pipeline_id),
                    "model_output_validation",
                    "validation_graph_json",
                    str(artifact_path),
                    metadata={
                        "validation_run_id": int(validation_run_id),
                        "model_run_id": int(model_run_id),
                        "rings_detected": int(graph_summary.get("rings_detected") or 0),
                        "max_cluster_size": int(graph_summary.get("max_cluster_size") or 0),
                    },
                    conn=conn,
                )
                self.workspace.upsert_job(
                    job_id,
                    int(pipeline_id),
                    "model_output_validation",
                    "model_validation",
                    "completed",
                    progress_pct=100.0,
                    logs={
                        "event": "validation_completed",
                        "validation_run_id": int(validation_run_id),
                        "model_run_id": int(model_run_id),
                    },
                    conn=conn,
                )
                self._workspace_mark(
                    tenant_id,
                    int(pipeline_id),
                    "completed",
                    "validate",
                    summary={
                        "status": "validated",
                        "validation_run_id": int(validation_run_id),
                        "model_run_id": int(model_run_id),
                        "high_risk_count": int(summary.get("high_risk_count") or 0),
                        "total_accounts_scored": int(summary.get("total_accounts_scored") or 0),
                        "warnings": summary.get("warnings") or [],
                        "graph_summary": graph_summary,
                    },
                    current_stage="pipeline_hub",
                    current_substage="history",
                    conn=conn,
                )
            computed["status"] = "validated"
            computed["latest_validation"] = {
                **(computed["latest_validation"] or {}),
                "validation_run_id": validation_run_id,
                "graph_artifact_path": str(artifact_path),
                "summary_artifact_path": str(summary_path),
            }
            return computed
        except Exception as exc:
            self.workspace.upsert_job(
                job_id,
                int(pipeline_id),
                "model_output_validation",
                "model_validation",
                "failed",
                progress_pct=100.0,
                logs={"event": "validation_failed", "message": str(exc)},
            )
            self._workspace_mark(
                tenant_id,
                int(pipeline_id),
                "failed",
                "validate",
                summary={"status": "failed"},
                error={"message": str(exc)},
                current_stage="model_output_validation",
                current_substage="validate",
            )
            raise

    def status(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        row = self._latest_validation_row(pipeline_id)
        if not row:
            result = self._compute(tenant_id, env_id, pipeline_id)
        else:
            graph_payload = {"nodes": [], "links": [], "clusters": [], "focus_cluster_id": "", "truncated": False}
            graph_artifact_path = _txt(row[4])
            if graph_artifact_path:
                path = resolve_data_file_path(Path(graph_artifact_path), env_root=self._env_root())
                if path.exists():
                    try:
                        graph_payload = _loads(path.read_text(encoding="utf-8"), graph_payload)
                    except Exception:
                        graph_payload = graph_payload

            latest_validation = {
                "validation_run_id": int(row[0]),
                "model_run_id": int(row[1]) if row[1] is not None else None,
                "summary": _loads(row[2], {}),
                "graph_summary": _loads(row[3], {}),
                "graph_artifact_path": graph_artifact_path,
                "created_at": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
            }
            result = {
                "pipeline_id": int(pipeline_id),
                "status": "validated",
                "latest_validation": latest_validation,
                "graph_payload": graph_payload,
            }

        status_value = _low(result.get("status") or "")
        latest_validation = result.get("latest_validation") or {}
        if status_value in {"validated", "ready", "completed"} or latest_validation.get("validation_run_id"):
            stage_status = "completed"
            substage = "validate"
        elif status_value in {"preview", "in_progress", "running"}:
            stage_status = "in_progress"
            substage = "preview"
        elif status_value in {"failed", "error"}:
            stage_status = "failed"
            substage = "validate"
        else:
            stage_status = "not_started"
            substage = "validate"
        self.workspace.ensure_run(int(pipeline_id), user_id=_txt(tenant_id) or "system")
        self.workspace.set_stage_state(
            int(pipeline_id),
            "model_output_validation",
            stage_status,
            substage=substage,
            summary={
                "status": _txt(result.get("status") or "not_ready"),
                "validation_run_id": int(latest_validation.get("validation_run_id") or 0) or None,
                "model_run_id": int(latest_validation.get("model_run_id") or 0) or None,
                "warnings": ((latest_validation.get("summary") or {}).get("warnings")) or [],
                "graph_summary": latest_validation.get("graph_summary") or {},
            },
            error={},
        )
        return result

    def graph(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        current = self.status(tenant_id, env_id, pipeline_id)
        return {
            "pipeline_id": int(pipeline_id),
            "status": current.get("status") or "not_ready",
            "graph_payload": current.get("graph_payload") or {"nodes": [], "links": [], "clusters": [], "focus_cluster_id": "", "truncated": False},
            "graph_summary": ((current.get("latest_validation") or {}).get("graph_summary")) or {},
        }
