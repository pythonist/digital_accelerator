from __future__ import annotations

import json
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
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


def _first(columns: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
    lookup = {str(col).strip().lower(): str(col) for col in columns}
    for candidate in candidates:
        hit = lookup.get(str(candidate).strip().lower())
        if hit:
            return hit
    return None


def _bool(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() not in {"0", "false", "no", "off", ""}


def _load_frame(file_path: Path) -> pd.DataFrame:
    suffix = file_path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(file_path)
    if suffix == ".json":
        return pd.read_json(file_path)
    return pd.read_csv(file_path)


FEATURE_GROUPS = {
    "transaction_behavior": {
        "title": "Transaction behavior features",
        "why": "Shows how the account normally moves money and whether the pattern looks unusual for mule activity.",
        "columns": ["txn_count_30d", "total_credit_30d", "total_debit_30d"],
    },
    "velocity_outflow": {
        "title": "Velocity and rapid outflow features",
        "why": "Highlights rapid pass-through movement and unusual money-out speed.",
        "columns": ["rapid_outflow_count_30d", "inflow_outflow_ratio_30d", "round_amount_ratio_30d", "cash_txn_ratio_30d", "dormancy_break_flag"],
    },
    "counterparty_exposure": {
        "title": "Counterparty exposure features",
        "why": "Shows how concentrated or risky the account's counterparties are.",
        "columns": ["unique_counterparties_30d", "counterparty_link_count"],
    },
    "balance_retention": {
        "title": "Balance retention features",
        "why": "Shows whether value stays in the account or leaves quickly after credits land.",
        "columns": ["balance_retention_ratio"],
    },
    "device_risk": {
        "title": "Device and digital risk features",
        "why": "Surfaces unusual device, IP, and digital access patterns linked to mule behavior.",
        "columns": ["unique_devices_30d", "avg_ip_risk_score"],
    },
    "external_intelligence": {
        "title": "External complaint/intelligence features",
        "why": "Adds customer complaints and intelligence indicators that can support mule detection.",
        "columns": ["complaint_count_90d", "if4_flag"],
    },
    "network_graph": {
        "title": "Network / graph features",
        "why": "Captures how exposed the account is to known risky networks and connected entities.",
        "columns": ["connected_to_flagged_account_count", "graph_degree"],
    },
    "typology_support": {
        "title": "Typology-supporting features",
        "why": "Prepares the feature set for later mule category prediction when typology data is available.",
        "columns": ["typology_available_flag"],
    },
}


class MulePreprocessingService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.workspace = MuleWorkspaceService(self.db_path)
        self._ensure_schema()

    def _conn_ctx(self, conn=None):
        return nullcontext(conn) if conn is not None else get_connection(self.db_path)

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_preprocessing_config (
                  pipeline_id INTEGER PRIMARY KEY,
                  preprocessing_config_json TEXT,
                  feature_groups_json TEXT,
                  target_validation_json TEXT,
                  build_status TEXT DEFAULT 'draft',
                  feature_count_estimate BIGINT,
                  warnings_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_preprocessing_runs (
                  run_id BIGINT PRIMARY KEY,
                  pipeline_id INTEGER,
                  output_table_name TEXT,
                  row_count BIGINT,
                  column_count BIGINT,
                  run_summary_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_feature_governance (
                  pipeline_id INTEGER PRIMARY KEY,
                  approved_features_json TEXT,
                  needs_review_json TEXT,
                  blocked_features_json TEXT,
                  weak_features_json TEXT,
                  lineage_json TEXT,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _env_root(self) -> Path:
        return self.db_path.resolve().parents[2]

    def _data_dir(self) -> Path:
        path = resolve_mlops_data_dir(self._env_root(), create_if_missing=True) / "mule_preprocessing"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _resolve_path(self, raw_path: str) -> Path:
        return resolve_data_file_path(Path(raw_path), env_root=self._env_root())

    def _ensure_pipeline_exists(self, pipeline_id: int, expected_type: Optional[str] = "mule") -> Dict[str, Any]:
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

    def _workspace_stage_id(self, raw_stage: Any, fallback: str = "health") -> str:
        stage = _low(raw_stage)
        return stage if stage in {
            "health", "controls", "governance", "preview", "run",
            "overview", "transform", "feature_builder", "feature_selection", "pipeline_run", "summary",
        } else fallback

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
            current_stage=_txt(current_stage) or "preprocessing_feature_selection",
            current_substage=self._workspace_stage_id(current_substage or substage, fallback="health"),
            conn=conn,
        )
        self.workspace.set_stage_state(
            int(pipeline_id),
            "preprocessing_feature_selection",
            stage_status,
            substage=self._workspace_stage_id(substage, fallback="health"),
            summary=summary or {},
            error=error or {},
            conn=conn,
        )
        if current_stage or current_substage:
            self.workspace.update_run(
                int(pipeline_id),
                status="failed" if stage_status == "failed" else "in_progress",
                current_stage=_txt(current_stage) or "preprocessing_feature_selection",
                current_substage=self._workspace_stage_id(current_substage or substage, fallback="health"),
                conn=conn,
            )

    def _default_config(self, pipeline_id: int) -> Dict[str, Any]:
        return {
            "pipeline_id": int(pipeline_id),
            "input_dataset_id": None,
            "source_dataset_key": "feature_store",
            "target_column": "mule_flag",
            "steps": [],
            "controls": {
                "missing_values": {"enabled": True, "strategy": "median_or_mode"},
                "outlier_handling": {"enabled": True, "strategy": "clip_1_99"},
                "date_conversion": {"enabled": True, "strategy": "age_in_days"},
                "encoding": {"enabled": True, "strategy": "frequency"},
                "scaling": {"enabled": False, "strategy": "zscore"},
                "class_imbalance": {"enabled": True, "strategy": "balanced_class_weight"},
            },
            "feature_groups": {key: {"enabled": True, "columns": meta["columns"]} for key, meta in FEATURE_GROUPS.items()},
            "output_table_name": f"mule_feature_studio_{int(pipeline_id)}",
        }

    def _merge(self, base: Dict[str, Any], patch: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        merged = dict(base)
        for key, value in (patch or {}).items():
            if key in {"controls", "feature_groups"} and isinstance(value, dict):
                current = dict(merged.get(key) or {})
                for nested_key, nested_value in value.items():
                    if isinstance(current.get(nested_key), dict) and isinstance(nested_value, dict):
                        current[nested_key] = {**current[nested_key], **nested_value}
                    else:
                        current[nested_key] = nested_value
                merged[key] = current
            else:
                merged[key] = value
        return merged

    def _source_rows(self, tenant_id: str, env_id: str, pipeline_id: Optional[int] = None) -> List[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            if pipeline_id is not None:
                rows = conn.execute(
                    """
                    SELECT dataset_id, dataset_type, file_path, filename, row_count, columns_json, column_types_json
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND pipeline_id = ?
                    ORDER BY updated_at DESC
                    """,
                    [tenant_id, env_id, int(pipeline_id)],
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT dataset_id, dataset_type, file_path, filename, row_count, columns_json, column_types_json
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule'
                    ORDER BY updated_at DESC
                    """,
                    [tenant_id, env_id],
                ).fetchall()
        return [{
            "dataset_id": int(r[0]),
            "dataset_type": _low(r[1]),
            "file_path": _txt(r[2]),
            "filename": _txt(r[3]),
            "row_count": int(r[4] or 0),
            "columns": _loads(r[5], []),
            "column_types": _loads(r[6], {}),
        } for r in rows]

    def _load_dataset_by_type(self, tenant_id: str, env_id: str, dataset_type: str, pipeline_id: Optional[int] = None) -> Optional[pd.DataFrame]:
        row = next((item for item in self._source_rows(tenant_id, env_id, pipeline_id) if item["dataset_type"] == dataset_type), None)
        if not row:
            return None
        try:
            frame = _load_frame(self._resolve_path(row["file_path"]))
        except Exception:
            return None
        return frame if not frame.empty else None

    def _load_latest_master(self, tenant_id: str, env_id: str, pipeline_id: Optional[int] = None) -> Optional[pd.DataFrame]:
        with get_connection(self.db_path) as conn:
            if pipeline_id is not None:
                row = conn.execute(
                    """
                    SELECT file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND pipeline_id = ? AND dataset_type = 'master_dataset'
                    ORDER BY updated_at DESC, dataset_id DESC
                    LIMIT 1
                    """,
                    [tenant_id, env_id, int(pipeline_id)],
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT file_path
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND dataset_type = 'master_dataset'
                    ORDER BY updated_at DESC, dataset_id DESC
                    LIMIT 1
                    """,
                    [tenant_id, env_id],
                ).fetchone()
        if not row:
            return None
        try:
            frame = _load_frame(self._resolve_path(row[0]))
        except Exception:
            return None
        return frame if not frame.empty else None

    def _workbench_service(self) -> MLOpsWorkbenchService:
        return MLOpsWorkbenchService(self.db_path)

    def _resolve_input_dataset(self, tenant_id: str, env_id: str, pipeline_id: int, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        service = self._workbench_service()
        dataset_id = config.get("input_dataset_id")
        try:
            dataset_id_int = int(dataset_id) if dataset_id not in (None, "", []) else None
        except Exception:
            dataset_id_int = None
        if dataset_id_int:
            try:
                return service.get_dataset(tenant_id, env_id, dataset_id_int)
            except Exception:
                pass

        workspace_candidate = self._resolve_input_dataset_from_workspace(pipeline_id)
        if workspace_candidate:
            return workspace_candidate

        preferred_types = ["feature_store", "preprocess_dataset", "preprocessed_dataset", "master_dataset"]
        sources = self._source_rows(tenant_id, env_id, pipeline_id)
        for dataset_type in preferred_types:
            hit = next((row for row in sources if row["dataset_type"] == dataset_type), None)
            if not hit:
                continue
            try:
                return service.get_dataset(tenant_id, env_id, int(hit["dataset_id"]))
            except Exception:
                continue
        return None

    def _resolve_input_dataset_from_workspace(self, pipeline_id: int) -> Optional[Dict[str, Any]]:
        try:
            snapshot = self.workspace.get_workspace_snapshot(int(pipeline_id))
        except Exception:
            return None
        artifacts = snapshot.get("artifacts") if isinstance(snapshot, dict) else None
        if not isinstance(artifacts, list):
            return None
        preferred = [
            ("feature_store", "feature_store_selected_csv", "feature_store"),
            ("feature_store", "feature_store_full_csv", "feature_store"),
            ("master_dataset", "master_dataset_csv", "master_dataset"),
        ]
        for stage_name, artifact_type, dataset_type in preferred:
            artifact = next(
                (
                    item for item in artifacts
                    if _low(item.get("stage_name")) == stage_name
                    and _low(item.get("artifact_type")) == artifact_type
                    and _txt(item.get("storage_ref"))
                ),
                None,
            )
            if not artifact:
                continue
            storage_ref = _txt(artifact.get("storage_ref"))
            metadata = artifact.get("metadata") if isinstance(artifact.get("metadata"), dict) else {}
            return {
                "dataset_id": int(metadata.get("dataset_id") or 0),
                "dataset_type": dataset_type,
                "filename": Path(storage_ref).name,
                "file_path": storage_ref,
                "row_count": int(metadata.get("row_count") or 0),
                "columns": metadata.get("columns") or [],
                "column_types": metadata.get("column_types") or {},
                "artifact_type": artifact_type,
            }
        return None

    def _build_step_governance(self, columns: List[str], steps: List[Dict[str, Any]], target_column: Optional[str]) -> Dict[str, Any]:
        target_name = _low(target_column)
        blocked: List[Dict[str, Any]] = []
        blocked_lookup: Dict[str, str] = {}
        for step in steps or []:
            if _low(step.get("type")) != "drop_columns":
                continue
            reason = _txt(step.get("reason") or "Excluded")
            for column in step.get("columns") or []:
                col_name = _txt(column)
                if not col_name:
                    continue
                blocked_lookup[col_name] = reason
        approved = []
        lineage = []
        for column in columns or []:
            col_name = _txt(column)
            if not col_name:
                continue
            if col_name in blocked_lookup:
                reason = blocked_lookup[col_name]
                blocked.append({"feature": col_name, "reason": reason})
                lineage.append({"feature": col_name, "group": "pipeline_step", "status": "blocked"})
                continue
            if _low(col_name) in {"account_id", "customer_id"}:
                lineage.append({"feature": col_name, "group": "identifier", "status": "trace_only"})
                continue
            if target_name and _low(col_name) == target_name:
                blocked.append({"feature": col_name, "reason": "Blocked as Leakage"})
                lineage.append({"feature": col_name, "group": "target", "status": "blocked"})
                continue
            if _low(col_name) == "mule_typology":
                blocked.append({"feature": col_name, "reason": "Blocked as Leakage"})
                lineage.append({"feature": col_name, "group": "target", "status": "blocked"})
                continue
            approved.append(col_name)
            lineage.append({"feature": col_name, "group": "pipeline_step", "status": "approved"})
        return {
            "approved_features": approved,
            "needs_review": [],
            "blocked_features": blocked,
            "weak_features": [],
            "lineage": lineage,
        }

    def load_config(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        default = self._default_config(pipeline_id)
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT preprocessing_config_json, feature_groups_json, target_validation_json, build_status, feature_count_estimate, warnings_json
                FROM mule_preprocessing_config
                WHERE pipeline_id = ?
                """,
                [int(pipeline_id)],
            ).fetchone()
        if not row:
            return {
                "pipeline_id": int(pipeline_id),
                "config": default,
                "build_status": "draft",
                "feature_count_estimate": 0,
                "warnings": [],
                "target_validation": {},
            }
        raw_preprocess = _loads(row[0], {})
        raw_feature_groups = _loads(row[1], {})
        if isinstance(raw_preprocess, dict) and any(
            key in raw_preprocess for key in ("controls", "feature_groups", "steps", "input_dataset_id", "target_column", "source_dataset_key")
        ):
            merged_config = self._merge(default, raw_preprocess)
            if raw_feature_groups and not merged_config.get("feature_groups"):
                merged_config["feature_groups"] = raw_feature_groups
        else:
            merged_config = self._merge(default, {
                "controls": raw_preprocess,
                "feature_groups": raw_feature_groups,
            })
        return {
            "pipeline_id": int(pipeline_id),
            "config": merged_config,
            "build_status": _txt(row[3]) or "draft",
            "feature_count_estimate": int(row[4] or 0),
            "warnings": _loads(row[5], []),
            "target_validation": _loads(row[2], {}),
        }

    def save_config(self, tenant_id: str, env_id: str, pipeline_id: int, patch: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        current = self.load_config(tenant_id, env_id, pipeline_id)
        config = self._merge(current["config"], patch)
        with get_connection(self.db_path) as conn:
            exists = conn.execute("SELECT pipeline_id FROM mule_preprocessing_config WHERE pipeline_id = ?", [int(pipeline_id)]).fetchone()
            payload = [
                int(pipeline_id),
                json.dumps(config, default=str),
                json.dumps(config.get("feature_groups") or {}, default=str),
                json.dumps(current.get("target_validation") or {}, default=str),
                current.get("build_status") or "draft",
                int(current.get("feature_count_estimate") or 0),
                json.dumps(current.get("warnings") or [], default=str),
            ]
            if exists:
                conn.execute(
                    """
                    UPDATE mule_preprocessing_config
                    SET preprocessing_config_json = ?, feature_groups_json = ?, target_validation_json = ?,
                        build_status = ?, feature_count_estimate = ?, warnings_json = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pipeline_id = ?
                    """,
                    [payload[1], payload[2], payload[3], payload[4], payload[5], payload[6], int(pipeline_id)],
                )
            else:
                conn.execute(
                    """
                    INSERT INTO mule_preprocessing_config (
                      pipeline_id, preprocessing_config_json, feature_groups_json, target_validation_json, build_status, feature_count_estimate, warnings_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    payload,
                )
            build_status = _low(current.get("build_status") or "")
            workspace_stage = self._workspace_stage_id(config.get("workspace_stage"), fallback="health")
            stage_completed = build_status in {"built", "completed"}
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "completed" if stage_completed else "in_progress",
                workspace_stage,
                summary={
                    "build_status": _txt(current.get("build_status") or "draft"),
                    "workspace_stage": workspace_stage,
                    "feature_count_estimate": int(current.get("feature_count_estimate") or 0),
                    "warnings": current.get("warnings") or [],
                },
                current_stage="model_build" if stage_completed else "preprocessing_feature_selection",
                current_substage="configure" if stage_completed else workspace_stage,
                conn=conn,
            )
        return self.load_config(tenant_id, env_id, pipeline_id)

    def _join_labels(self, master: pd.DataFrame, tenant_id: str, env_id: str, pipeline_id: Optional[int] = None) -> Dict[str, Any]:
        labels = self._load_dataset_by_type(tenant_id, env_id, "mule_labels", pipeline_id)
        typology = self._load_dataset_by_type(tenant_id, env_id, "mule_typology", pipeline_id)
        validation = {
            "mule_flag_found": False,
            "positive_class_pct": None,
            "mule_typology_found": typology is not None,
            "typology_classes": [],
            "leakage_columns": [],
        }
        df = master.copy()
        account_key = _first(df.columns, ["account_id", "acct_id", "account_number"])
        if not account_key:
            raise ValueError("Master dataset is missing account_id.")
        if account_key != "account_id":
            df.rename(columns={account_key: "account_id"}, inplace=True)

        if labels is not None:
            label_key = _first(labels.columns, ["account_id", "acct_id", "account_number"])
            flag_col = _first(labels.columns, ["mule_flag", "is_mule_account", "target", "label"])
            if label_key and flag_col:
                joined = labels[[label_key, flag_col]].rename(columns={label_key: "account_id", flag_col: "mule_flag"})
                if "mule_flag" in df.columns:
                    merged = df.merge(joined, on="account_id", how="left", suffixes=("", "__label"))
                    label_series = merged["mule_flag__label"] if "mule_flag__label" in merged.columns else None
                    if label_series is not None:
                        merged["mule_flag"] = merged["mule_flag"].where(merged["mule_flag"].notna(), label_series)
                        merged.drop(columns=["mule_flag__label"], inplace=True, errors="ignore")
                    df = merged
                else:
                    df = df.merge(joined, on="account_id", how="left")
                if "mule_flag" in df.columns:
                    validation["mule_flag_found"] = True
                    validation["positive_class_pct"] = float(pd.to_numeric(df["mule_flag"], errors="coerce").fillna(0).mean() * 100.0)
        if typology is not None:
            typology_key = _first(typology.columns, ["account_id", "acct_id", "account_number"])
            typology_col = _first(typology.columns, ["mule_typology", "typology", "category", "top_typology"])
            if typology_key and typology_col:
                joined = typology[[typology_key, typology_col]].rename(columns={typology_key: "account_id", typology_col: "mule_typology"})
                if "mule_typology" in df.columns:
                    merged = df.merge(joined, on="account_id", how="left", suffixes=("", "__label"))
                    label_series = merged["mule_typology__label"] if "mule_typology__label" in merged.columns else None
                    if label_series is not None:
                        merged["mule_typology"] = merged["mule_typology"].where(merged["mule_typology"].notna(), label_series)
                        merged.drop(columns=["mule_typology__label"], inplace=True, errors="ignore")
                    df = merged
                else:
                    df = df.merge(joined, on="account_id", how="left")
                if "mule_typology" in df.columns:
                    validation["typology_classes"] = sorted([str(v) for v in df["mule_typology"].dropna().astype(str).unique().tolist()])[:12]

        validation["leakage_columns"] = [col for col in df.columns if any(token in _low(col) for token in ("future_", "post_", "investigation_", "sar_", "str_"))]
        return {"frame": df, "validation": validation}

    def _generate_features(self, frame: pd.DataFrame, config: Dict[str, Any]) -> Dict[str, Any]:
        df = frame.copy()
        groups = config.get("feature_groups") or {}
        created, selected_groups = {}, []
        row_index = df.index

        def _col(name: str, default: Any = 0) -> pd.Series:
            if name in df.columns:
                return df[name]
            return pd.Series([default] * len(row_index), index=row_index)

        def _col_any(names: Iterable[str], default: Any = 0) -> pd.Series:
            for name in names:
                if name in df.columns:
                    return df[name]
            return pd.Series([default] * len(row_index), index=row_index)

        if _bool(groups.get("transaction_behavior", {}).get("enabled"), True):
            df["txn_count_30d"] = _col("txn_count", 0).fillna(0)
            df["total_credit_30d"] = _col("txn_amount_sum", 0).fillna(0) * 0.55
            df["total_debit_30d"] = _col("txn_amount_sum", 0).fillna(0) * 0.45
            created["transaction_behavior"] = FEATURE_GROUPS["transaction_behavior"]["columns"]
            selected_groups.append("transaction_behavior")
        if _bool(groups.get("velocity_outflow", {}).get("enabled"), True):
            credits = _col("total_credit_30d", 0).fillna(0) + 1
            debits = _col("total_debit_30d", 0).fillna(0)
            df["rapid_outflow_count_30d"] = _col_any(["debit_txn_count", "txn_count_30d"], 0).fillna(0)
            df["inflow_outflow_ratio_30d"] = debits / credits
            df["round_amount_ratio_30d"] = (_col("txn_amount_mean", 0).fillna(0) % 100 == 0).astype(int)
            df["cash_txn_ratio_30d"] = 0.0
            df["dormancy_break_flag"] = (_col("txn_count_30d", 0).fillna(0) > 0).astype(int)
            created["velocity_outflow"] = FEATURE_GROUPS["velocity_outflow"]["columns"]
            selected_groups.append("velocity_outflow")
        if _bool(groups.get("counterparty_exposure", {}).get("enabled"), True):
            df["unique_counterparties_30d"] = _col_any(["counterparty_counterparty_id_nunique", "counterparty_count"], 0).fillna(0)
            if "counterparty_link_count" not in df.columns:
                df["counterparty_link_count"] = _col("counterparty_count", 0).fillna(0)
            created["counterparty_exposure"] = FEATURE_GROUPS["counterparty_exposure"]["columns"]
            selected_groups.append("counterparty_exposure")
        if _bool(groups.get("balance_retention", {}).get("enabled"), True):
            inflow = _col("total_credit_30d", 0).fillna(0) + 1
            df["balance_retention_ratio"] = (inflow - _col("total_debit_30d", 0).fillna(0)) / inflow
            created["balance_retention"] = FEATURE_GROUPS["balance_retention"]["columns"]
            selected_groups.append("balance_retention")
        if _bool(groups.get("device_risk", {}).get("enabled"), True):
            df["unique_devices_30d"] = _col_any(["device_signal_device_id_nunique", "device_signal_count"], 0).fillna(0)
            df["avg_ip_risk_score"] = _col("device_signal_risk_score_mean", 0).fillna(0)
            created["device_risk"] = FEATURE_GROUPS["device_risk"]["columns"]
            selected_groups.append("device_risk")
        if _bool(groups.get("external_intelligence", {}).get("enabled"), True):
            df["complaint_count_90d"] = _col("external_signal_count", 0).fillna(0)
            df["if4_flag"] = (_col("external_signal_risk_score_max", 0).fillna(0) > 3).astype(int)
            created["external_intelligence"] = FEATURE_GROUPS["external_intelligence"]["columns"]
            selected_groups.append("external_intelligence")
        if _bool(groups.get("network_graph", {}).get("enabled"), True):
            df["connected_to_flagged_account_count"] = _col_any(["network_degree_sum", "counterparty_link_count"], 0).fillna(0)
            df["graph_degree"] = _col("network_degree_max", 0).fillna(0)
            created["network_graph"] = FEATURE_GROUPS["network_graph"]["columns"]
            selected_groups.append("network_graph")
        if _bool(groups.get("typology_support", {}).get("enabled"), True):
            df["typology_available_flag"] = _col("mule_typology", "").fillna("").astype(str).ne("").astype(int)
            created["typology_support"] = FEATURE_GROUPS["typology_support"]["columns"]
            selected_groups.append("typology_support")

        return {"frame": df, "created": created, "selected_groups": selected_groups}

    def _apply_controls(self, frame: pd.DataFrame, config: Dict[str, Any]) -> pd.DataFrame:
        df = frame.copy()
        controls = config.get("controls") or {}
        bool_cols = [col for col in df.columns if pd.api.types.is_bool_dtype(df[col])]
        numeric_cols = [col for col in df.columns if pd.api.types.is_numeric_dtype(df[col]) and col not in bool_cols]
        categorical_cols = [col for col in df.columns if col not in numeric_cols and col not in bool_cols and col not in {"account_id"}]
        if _bool((controls.get("missing_values") or {}).get("enabled"), True):
            for col in numeric_cols:
                df[col] = df[col].fillna(df[col].median() if not df[col].dropna().empty else 0)
            for col in bool_cols:
                df[col] = df[col].fillna(False).astype(int)
            for col in categorical_cols:
                df[col] = df[col].fillna("missing")
        if _bool((controls.get("outlier_handling") or {}).get("enabled"), True):
            for col in numeric_cols:
                low, high = df[col].quantile(0.01), df[col].quantile(0.99)
                df[col] = df[col].clip(lower=low, upper=high)
        if _bool((controls.get("date_conversion") or {}).get("enabled"), True):
            for col in list(df.columns):
                if "date" in _low(col):
                    parsed = pd.to_datetime(df[col], errors="coerce")
                    if parsed.notna().any():
                        df[f"{col}_age_days"] = (parsed.max() - parsed).dt.days.fillna(0)
        return df

    def _govern_features(self, frame: pd.DataFrame, created: Dict[str, List[str]]) -> Dict[str, Any]:
        approved, needs_review, blocked, weak = [], [], [], []
        lineage = []
        leakage_tokens = {
            "mule_flag": "Blocked as Leakage",
            "mule_typology": "Blocked as Leakage",
            "target_reason_summary": "Blocked as Leakage",
            "target_source_type": "Blocked as Leakage",
            "event_strength_score": "Blocked as Leakage",
        }
        post_tokens = ("post_", "future_", "investigation", "case_outcome", "alert_outcome")
        for group_key, columns in created.items():
            for column in columns:
                name = _low(column)
                reason = None
                if name in leakage_tokens:
                    reason = leakage_tokens[name]
                elif any(token in name for token in post_tokens):
                    reason = "Blocked as Post-Outcome"
                elif any(token in name for token in ("complaint_reason", "complaint_outcome", "investigator_decision")):
                    reason = "Blocked as Leakage"
                elif column not in frame.columns:
                    continue
                elif frame[column].nunique(dropna=True) <= 1:
                    weak.append({"feature": column, "reason": "Weak / Redundant"})
                    lineage.append({"feature": column, "group": group_key, "status": "weak"})
                    continue
                elif float(frame[column].isna().mean()) > 0.85:
                    needs_review.append({"feature": column, "reason": "Needs Review"})
                    lineage.append({"feature": column, "group": group_key, "status": "needs_review"})
                    continue
                if reason:
                    blocked.append({"feature": column, "reason": reason})
                    lineage.append({"feature": column, "group": group_key, "status": "blocked"})
                else:
                    approved.append(column)
                    lineage.append({"feature": column, "group": group_key, "status": "approved"})
        return {
            "approved_features": approved,
            "needs_review": needs_review,
            "blocked_features": blocked,
            "weak_features": weak,
            "lineage": lineage,
        }

    def preview_workbench(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        patch: Optional[Dict[str, Any]] = None,
        sample_rows: int = 100,
    ) -> Dict[str, Any]:
        workspace_stage = self._workspace_stage_id((patch or {}).get("workspace_stage"), fallback="preview")
        preview_job_id = f"mule-preprocessing-preview-{int(pipeline_id)}"
        self._workspace_mark(
            tenant_id,
            pipeline_id,
            "in_progress",
            workspace_stage,
            summary={"build_status": "preview", "workspace_stage": workspace_stage},
            current_stage="preprocessing_feature_selection",
            current_substage=workspace_stage,
        )
        self.workspace.upsert_job(
            preview_job_id,
            int(pipeline_id),
            "preprocessing_feature_selection",
            "preprocessing_preview",
            "in_progress",
            progress_pct=10.0,
            logs={"event": "preview_started", "workspace_stage": workspace_stage},
        )
        current = self.save_config(tenant_id, env_id, pipeline_id, patch=patch)
        config = current["config"]
        steps = list(config.get("steps") or [])
        dataset = self._resolve_input_dataset(tenant_id, env_id, pipeline_id, config)
        if not dataset:
            self.workspace.upsert_job(
                preview_job_id,
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocessing_preview",
                "failed",
                progress_pct=100.0,
                logs={"event": "preview_failed", "message": "Input dataset missing"},
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "failed",
                workspace_stage,
                summary={"build_status": _txt(current.get("build_status") or "draft")},
                error={"message": "Prepare the Mule master dataset or feature store before preprocessing."},
                current_stage="preprocessing_feature_selection",
                current_substage=workspace_stage,
            )
            raise ValueError("Prepare the Mule master dataset or feature store before preprocessing.")
        if not steps:
            self.workspace.upsert_job(
                preview_job_id,
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocessing_preview",
                "failed",
                progress_pct=100.0,
                logs={"event": "preview_failed", "message": "No preprocessing steps configured"},
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "failed",
                workspace_stage,
                summary={"build_status": _txt(current.get("build_status") or "draft")},
                error={"message": "Add at least one Mule preprocessing step before preview."},
                current_stage="preprocessing_feature_selection",
                current_substage=workspace_stage,
            )
            raise ValueError("Add at least one Mule preprocessing step before preview.")

        target_column = _txt(config.get("target_column") or "mule_flag") or None
        preview = self._workbench_service().preprocess_preview(dataset, steps, sample_rows, target_column=target_column)
        governance = self._build_step_governance(preview.get("columns") or [], steps, target_column)
        warnings = []
        if governance["blocked_features"]:
            warnings.append(f"{len(governance['blocked_features'])} columns are marked for exclusion before training.")
        if target_column and target_column not in (preview.get("columns") or []):
            warnings.append(f'Target "{target_column}" is not present after the current preprocessing plan.')
        target_validation = {
            "mule_flag_found": bool(target_column and target_column in (preview.get("columns") or [])),
            "positive_class_pct": None,
            "mule_typology_found": "mule_typology" in (preview.get("columns") or []),
            "typology_classes": [],
            "leakage_columns": [item["feature"] for item in governance["blocked_features"] if "Leakage" in _txt(item.get("reason"))],
        }

        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE mule_preprocessing_config
                SET target_validation_json = ?, build_status = ?, feature_count_estimate = ?, warnings_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ?
                """,
                [
                    json.dumps(target_validation, default=str),
                    "preview",
                    int(len(governance["approved_features"])),
                    json.dumps(warnings, default=str),
                    int(pipeline_id),
                ],
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_feature_governance (
                  pipeline_id, approved_features_json, needs_review_json, blocked_features_json, weak_features_json, lineage_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    int(pipeline_id),
                    json.dumps(governance["approved_features"], default=str),
                    json.dumps(governance["needs_review"], default=str),
                    json.dumps(governance["blocked_features"], default=str),
                    json.dumps(governance["weak_features"], default=str),
                    json.dumps(governance["lineage"], default=str),
                ],
            )
            self.workspace.upsert_job(
                preview_job_id,
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocessing_preview",
                "completed",
                progress_pct=100.0,
                logs={
                    "event": "preview_completed",
                    "feature_count": int(len(governance["approved_features"])),
                    "sample_rows": int(len(preview.get("preview") or [])),
                },
                conn=conn,
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "in_progress",
                "preview",
                summary={
                    "build_status": "preview",
                    "workspace_stage": "preview",
                    "feature_count_estimate": int(len(governance["approved_features"])),
                    "warnings": warnings,
                },
                current_stage="preprocessing_feature_selection",
                current_substage="preview",
                conn=conn,
            )

        return {
            "pipeline_id": int(pipeline_id),
            "config": config,
            "dataset": dataset,
            "preview_contract": preview,
            "feature_governance": governance,
            "target_validation": target_validation,
            "warnings": warnings,
            "output_preview": {
                "final_feature_count": len(governance["approved_features"]),
                "sample_rows": preview.get("preview") or [],
                "ready_for_model_build": bool(target_validation.get("mule_flag_found")),
            },
        }

    def run_workbench(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        patch: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        run_job_id = f"mule-preprocessing-run-{int(pipeline_id)}"
        self._workspace_mark(
            tenant_id,
            pipeline_id,
            "in_progress",
            "run",
            summary={"build_status": "running", "workspace_stage": "run"},
            current_stage="preprocessing_feature_selection",
            current_substage="run",
        )
        self.workspace.upsert_job(
            run_job_id,
            int(pipeline_id),
            "preprocessing_feature_selection",
            "preprocessing_run",
            "in_progress",
            progress_pct=10.0,
            logs={"event": "run_started"},
        )
        preview_payload = self.preview_workbench(tenant_id, env_id, pipeline_id, patch=patch, sample_rows=100)
        config = preview_payload["config"]
        dataset = preview_payload["dataset"]
        steps = list(config.get("steps") or [])
        target_column = _txt(config.get("target_column") or "mule_flag") or None
        output_name = _txt(config.get("output_table_name") or f"mule_feature_studio_{int(pipeline_id)}")
        output_path = self._data_dir() / f"{output_name}.csv"

        service = self._workbench_service()
        output = service.run_preprocessing(dataset, steps, output_path, target_column=target_column)
        registered = service.register_dataset(
            tenant_id=tenant_id,
            env_id=env_id,
            dataset_type="preprocess_dataset",
            filename=output_path.name,
            file_path=output_path,
            pipeline_type="mule",
            pipeline_id=int(pipeline_id),
        )
        governance = self._build_step_governance(output.get("columns") or [], steps, target_column)
        target_validation = {
            "mule_flag_found": bool(target_column and target_column in (output.get("columns") or [])),
            "positive_class_pct": None,
            "mule_typology_found": "mule_typology" in (output.get("columns") or []),
            "typology_classes": [],
            "leakage_columns": [item["feature"] for item in governance["blocked_features"] if "Leakage" in _txt(item.get("reason"))],
        }
        with get_connection(self.db_path) as conn:
            run_id = int(conn.execute("SELECT COALESCE(MAX(run_id), 0) + 1 FROM mule_preprocessing_runs").fetchone()[0] or 1)
            run_summary = {
                "output_table_name": output_name,
                "row_count": int(output.get("rows") or registered.get("row_count") or 0),
                "column_count": int(len(output.get("columns") or [])),
                "step_count": len(steps),
                "dataset_id": int(registered.get("dataset_id") or 0),
            }
            conn.execute(
                "INSERT INTO mule_preprocessing_runs (run_id, pipeline_id, output_table_name, row_count, column_count, run_summary_json) VALUES (?, ?, ?, ?, ?, ?)",
                [run_id, int(pipeline_id), output_name, int(output.get("rows") or 0), int(len(output.get("columns") or [])), json.dumps(run_summary, default=str)],
            )
            conn.execute(
                """
                UPDATE mule_preprocessing_config
                SET target_validation_json = ?, build_status = 'built', feature_count_estimate = ?, warnings_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ?
                """,
                [
                    json.dumps(target_validation, default=str),
                    int(len(governance["approved_features"])),
                    json.dumps(preview_payload.get("warnings") or [], default=str),
                    int(pipeline_id),
                ],
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_feature_governance (
                  pipeline_id, approved_features_json, needs_review_json, blocked_features_json, weak_features_json, lineage_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    int(pipeline_id),
                    json.dumps(governance["approved_features"], default=str),
                    json.dumps(governance["needs_review"], default=str),
                    json.dumps(governance["blocked_features"], default=str),
                    json.dumps(governance["weak_features"], default=str),
                    json.dumps(governance["lineage"], default=str),
                ],
            )
            self.workspace.register_artifact(
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocess_dataset_csv",
                _txt(registered.get("file_path") or output_path),
                metadata={
                    "dataset_id": int(registered.get("dataset_id") or 0),
                    "run_id": int(run_id),
                    "row_count": int(output.get("rows") or registered.get("row_count") or 0),
                    "column_count": int(len(output.get("columns") or [])),
                    "output_table_name": output_name,
                },
                conn=conn,
            )
            self.workspace.upsert_job(
                run_job_id,
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocessing_run",
                "completed",
                progress_pct=100.0,
                logs={
                    "event": "run_completed",
                    "run_id": int(run_id),
                    "dataset_id": int(registered.get("dataset_id") or 0),
                    "output_table_name": output_name,
                },
                conn=conn,
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "completed",
                "run",
                summary={
                    "build_status": "built",
                    "workspace_stage": "run",
                    "run_id": int(run_id),
                    "dataset_id": int(registered.get("dataset_id") or 0),
                    "feature_count_estimate": int(len(governance["approved_features"])),
                    "warnings": preview_payload.get("warnings") or [],
                },
                current_stage="model_build",
                current_substage="configure",
                conn=conn,
            )

        return {
            "pipeline_id": int(pipeline_id),
            "run_id": run_id,
            "dataset": registered,
            "output": output,
            "feature_governance": governance,
            "target_validation": target_validation,
        }

    def preview(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        preview_job_id = f"mule-preprocessing-preview-{int(pipeline_id)}"
        self._workspace_mark(
            tenant_id,
            pipeline_id,
            "in_progress",
            "preview",
            summary={"build_status": "preview", "workspace_stage": "preview"},
            current_stage="preprocessing_feature_selection",
            current_substage="preview",
        )
        self.workspace.upsert_job(
            preview_job_id,
            int(pipeline_id),
            "preprocessing_feature_selection",
            "preprocessing_preview",
            "in_progress",
            progress_pct=10.0,
            logs={"event": "preview_started", "mode": "native"},
        )
        current = self.load_config(tenant_id, env_id, pipeline_id)
        master = self._load_latest_master(tenant_id, env_id, pipeline_id)
        if master is None:
            self.workspace.upsert_job(
                preview_job_id,
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocessing_preview",
                "failed",
                progress_pct=100.0,
                logs={"event": "preview_failed", "message": "Master dataset missing"},
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "failed",
                "preview",
                summary={"build_status": _txt(current.get("build_status") or "draft")},
                error={"message": "Build the Mule master dataset before opening Feature Studio."},
                current_stage="preprocessing_feature_selection",
                current_substage="preview",
            )
            raise ValueError("Build the Mule master dataset before opening Feature Studio.")
        joined = self._join_labels(master, tenant_id, env_id, pipeline_id)
        with_features = self._generate_features(joined["frame"], current["config"])
        transformed = self._apply_controls(with_features["frame"], current["config"])
        governance = self._govern_features(transformed, with_features["created"])
        duplicate_check = int(transformed["account_id"].duplicated(keep=False).sum()) if "account_id" in transformed.columns else 0
        missing_cells = int(transformed.isna().sum().sum())
        warnings = []
        if duplicate_check:
            warnings.append(f"Duplicate account_id rows detected: {duplicate_check}")
        warnings.extend([f"Leakage-sensitive columns flagged: {', '.join(joined['validation']['leakage_columns'][:4])}"] if joined["validation"].get("leakage_columns") else [])
        summary = {
            "total_rows": int(transformed.shape[0]),
            "total_columns": int(transformed.shape[1]),
            "missing_values_summary": missing_cells,
            "duplicate_account_id_count": duplicate_check,
            "class_balance_pct": joined["validation"].get("positive_class_pct"),
            "typology_available": bool(joined["validation"].get("mule_typology_found")),
            "final_feature_count": sum(len(cols) for cols in with_features["created"].values()),
            "selected_feature_groups": with_features["selected_groups"],
            "excluded_columns": [item["feature"] for item in governance["blocked_features"]],
            "ready_for_model_build": joined["validation"].get("mule_flag_found", False),
        }
        target_validation = joined["validation"]
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_preprocessing_config (
                  pipeline_id, preprocessing_config_json, feature_groups_json, target_validation_json, build_status, feature_count_estimate, warnings_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    int(pipeline_id),
                    json.dumps(current["config"].get("controls") or {}, default=str),
                    json.dumps(current["config"].get("feature_groups") or {}, default=str),
                    json.dumps(target_validation, default=str),
                    current["build_status"],
                    int(summary["final_feature_count"]),
                    json.dumps(warnings, default=str),
                ],
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_feature_governance (
                  pipeline_id, approved_features_json, needs_review_json, blocked_features_json, weak_features_json, lineage_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    int(pipeline_id),
                    json.dumps(governance["approved_features"], default=str),
                    json.dumps(governance["needs_review"], default=str),
                    json.dumps(governance["blocked_features"], default=str),
                    json.dumps(governance["weak_features"], default=str),
                    json.dumps(governance["lineage"], default=str),
                ],
            )
            self.workspace.upsert_job(
                preview_job_id,
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocessing_preview",
                "completed",
                progress_pct=100.0,
                logs={
                    "event": "preview_completed",
                    "feature_count": int(len(governance["approved_features"])),
                    "row_count": int(transformed.shape[0]),
                },
                conn=conn,
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "in_progress",
                "preview",
                summary={
                    "build_status": "preview",
                    "workspace_stage": "preview",
                    "feature_count_estimate": int(summary["final_feature_count"]),
                    "warnings": warnings,
                },
                current_stage="preprocessing_feature_selection",
                current_substage="preview",
                conn=conn,
            )
        return {
            "pipeline_id": int(pipeline_id),
            "config": current["config"],
            "data_health": summary,
            "feature_groups": [
                {
                    "key": key,
                    "title": meta["title"],
                    "why_it_matters": meta["why"],
                    "variables_created": len(with_features["created"].get(key, [])),
                    "preview_columns": with_features["created"].get(key, []),
                    "enabled": _bool((current["config"].get("feature_groups") or {}).get(key, {}).get("enabled"), True),
                }
                for key, meta in FEATURE_GROUPS.items()
            ],
            "target_validation": target_validation,
            "feature_governance": governance,
            "output_preview": {
                "final_feature_count": len(governance["approved_features"]),
                "selected_feature_groups": with_features["selected_groups"],
                "excluded_columns": summary["excluded_columns"],
                "sample_rows": transformed.head(20).fillna("").to_dict(orient="records"),
                "ready_for_model_build": summary["ready_for_model_build"],
            },
            "warnings": warnings,
        }

    def run(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        run_job_id = f"mule-preprocessing-run-{int(pipeline_id)}"
        self._workspace_mark(
            tenant_id,
            pipeline_id,
            "in_progress",
            "run",
            summary={"build_status": "running", "workspace_stage": "run"},
            current_stage="preprocessing_feature_selection",
            current_substage="run",
        )
        self.workspace.upsert_job(
            run_job_id,
            int(pipeline_id),
            "preprocessing_feature_selection",
            "preprocessing_run",
            "in_progress",
            progress_pct=10.0,
            logs={"event": "run_started", "mode": "native"},
        )
        preview = self.preview(tenant_id, env_id, pipeline_id)
        current = self.load_config(tenant_id, env_id, pipeline_id)
        master = self._load_latest_master(tenant_id, env_id, pipeline_id)
        joined = self._join_labels(master, tenant_id, env_id, pipeline_id)
        feature_result = self._generate_features(joined["frame"], current["config"])
        transformed = self._apply_controls(feature_result["frame"], current["config"])
        governance = self._govern_features(transformed, feature_result["created"])
        target_column = _txt(current["config"].get("target_column") or "mule_flag")
        blocked_cols = {item["feature"] for item in governance["blocked_features"]}
        safe_columns = [col for col in transformed.columns if col not in blocked_cols]
        if target_column and target_column in transformed.columns and target_column not in safe_columns:
            safe_columns.append(target_column)
        transformed = transformed[safe_columns].copy()
        output_table = _txt(current["config"].get("output_table_name") or f"mule_feature_studio_{int(pipeline_id)}")
        output_path = self._data_dir() / f"{output_table}.csv"
        transformed.to_csv(output_path, index=False)
        with get_connection(self.db_path) as conn:
            conn.register("__mule_preprocess_df", transformed)
            conn.execute(f'CREATE OR REPLACE TABLE "{output_table}" AS SELECT * FROM __mule_preprocess_df')
            try:
                conn.unregister("__mule_preprocess_df")
            except Exception:
                pass
            run_id = int(conn.execute("SELECT COALESCE(MAX(run_id), 0) + 1 FROM mule_preprocessing_runs").fetchone()[0] or 1)
            run_summary = {
                "output_table_name": output_table,
                "row_count": int(transformed.shape[0]),
                "column_count": int(transformed.shape[1]),
                "feature_groups": preview["output_preview"]["selected_feature_groups"],
            }
            conn.execute(
                "INSERT INTO mule_preprocessing_runs (run_id, pipeline_id, output_table_name, row_count, column_count, run_summary_json) VALUES (?, ?, ?, ?, ?, ?)",
                [run_id, int(pipeline_id), output_table, int(transformed.shape[0]), int(transformed.shape[1]), json.dumps(run_summary, default=str)],
            )
            dataset_id = int(conn.execute("SELECT COALESCE(MAX(dataset_id), 0) + 1 FROM mlops_dataset_registry").fetchone()[0] or 1)
            conn.execute(
                """
                INSERT INTO mlops_dataset_registry (
                  dataset_id, tenant_id, env_id, pipeline_id, pipeline_type, dataset_type, filename,
                  file_path, row_count, columns_json, column_types_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    dataset_id, tenant_id, env_id, int(pipeline_id), "mule", "preprocess_dataset", output_path.name, str(output_path),
                    int(transformed.shape[0]), json.dumps(list(transformed.columns), default=str),
                    json.dumps({col: str(dtype) for col, dtype in transformed.dtypes.items()}, default=str),
                ],
            )
            conn.execute(
                """
                UPDATE mule_preprocessing_config
                SET build_status = 'built', feature_count_estimate = ?, warnings_json = ?, target_validation_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ?
                """,
                [
                    int(len(governance["approved_features"])),
                    json.dumps(preview["warnings"], default=str),
                    json.dumps(preview["target_validation"], default=str),
                    int(pipeline_id),
                ],
            )
            self.workspace.register_artifact(
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocess_dataset_csv",
                str(output_path),
                metadata={
                    "dataset_id": int(dataset_id),
                    "run_id": int(run_id),
                    "row_count": int(transformed.shape[0]),
                    "column_count": int(transformed.shape[1]),
                    "output_table_name": output_table,
                },
                conn=conn,
            )
            self.workspace.upsert_job(
                run_job_id,
                int(pipeline_id),
                "preprocessing_feature_selection",
                "preprocessing_run",
                "completed",
                progress_pct=100.0,
                logs={
                    "event": "run_completed",
                    "dataset_id": int(dataset_id),
                    "run_id": int(run_id),
                    "output_table_name": output_table,
                },
                conn=conn,
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "completed",
                "run",
                summary={
                    "build_status": "built",
                    "workspace_stage": "run",
                    "run_id": int(run_id),
                    "dataset_id": int(dataset_id),
                    "feature_count_estimate": int(len(governance["approved_features"])),
                    "warnings": preview.get("warnings") or [],
                },
                current_stage="model_build",
                current_substage="configure",
                conn=conn,
            )
        return {
            "pipeline_id": int(pipeline_id),
            "run_id": run_id,
            "dataset_id": dataset_id,
            "output_table_name": output_table,
            "summary": preview["data_health"],
            "output_preview": preview["output_preview"],
        }

    def status(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        current = self.load_config(tenant_id, env_id, pipeline_id)
        with get_connection(self.db_path) as conn:
            governance_row = conn.execute(
                """
                SELECT approved_features_json, needs_review_json, blocked_features_json, weak_features_json, lineage_json
                FROM mule_feature_governance
                WHERE pipeline_id = ?
                """,
                [int(pipeline_id)],
            ).fetchone()
            row = conn.execute(
                """
                SELECT run_id, output_table_name, row_count, column_count, run_summary_json, created_at
                FROM mule_preprocessing_runs
                WHERE pipeline_id = ?
                ORDER BY created_at DESC, run_id DESC
                LIMIT 1
                """,
                [int(pipeline_id)],
            ).fetchone()
            history_rows = conn.execute(
                """
                SELECT run_id, output_table_name, row_count, column_count, run_summary_json, created_at
                FROM mule_preprocessing_runs
                WHERE pipeline_id = ?
                ORDER BY created_at DESC, run_id DESC
                LIMIT 8
                """,
                [int(pipeline_id)],
            ).fetchall()
        latest_run = None
        if row:
            latest_run = {
                "run_id": int(row[0]),
                "output_table_name": _txt(row[1]),
                "row_count": int(row[2] or 0),
                "column_count": int(row[3] or 0),
                "summary": _loads(row[4], {}),
                "created_at": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
            }
            with get_connection(self.db_path) as conn:
                dataset_row = conn.execute(
                    """
                    SELECT dataset_id
                    FROM mlops_dataset_registry
                    WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND pipeline_id = ? AND dataset_type IN ('preprocess_dataset', 'preprocessed_dataset')
                    ORDER BY updated_at DESC, dataset_id DESC
                    LIMIT 1
                    """,
                    [tenant_id, env_id, int(pipeline_id)],
                ).fetchone()
            if dataset_row:
                latest_run["dataset_id"] = int(dataset_row[0])
        recent_runs = [
            {
                "run_id": int(hist_row[0]),
                "output_table_name": _txt(hist_row[1]),
                "row_count": int(hist_row[2] or 0),
                "column_count": int(hist_row[3] or 0),
                "summary": _loads(hist_row[4], {}),
                "created_at": hist_row[5].isoformat() if hasattr(hist_row[5], "isoformat") else hist_row[5],
            }
            for hist_row in (history_rows or [])
        ]
        feature_governance = {
            "approved_features": _loads(governance_row[0], []) if governance_row else [],
            "needs_review": _loads(governance_row[1], []) if governance_row else [],
            "blocked_features": _loads(governance_row[2], []) if governance_row else [],
            "weak_features": _loads(governance_row[3], []) if governance_row else [],
            "lineage": _loads(governance_row[4], []) if governance_row else [],
        }
        result = {
            "pipeline_id": int(pipeline_id),
            "config": current["config"],
            "build_status": current["build_status"],
            "feature_count_estimate": current["feature_count_estimate"],
            "warnings": current["warnings"],
            "target_validation": current["target_validation"],
            "feature_governance": feature_governance,
            "latest_run": latest_run,
            "recent_runs": recent_runs,
        }
        build_status = _low(result.get("build_status") or "")
        workspace_stage = self._workspace_stage_id((result.get("config") or {}).get("workspace_stage"), fallback="health")
        if build_status in {"built", "completed"} and latest_run:
            stage_status = "completed"
            substage = "run"
        elif build_status in {"failed", "error"}:
            stage_status = "failed"
            substage = workspace_stage if workspace_stage in {"preview", "run"} else "run"
        elif build_status in {"preview", "in_progress", "running"}:
            stage_status = "in_progress"
            substage = "preview" if build_status == "preview" else workspace_stage
        elif int(result.get("feature_count_estimate") or 0) > 0 or (result.get("config") or {}).get("steps") or (result.get("config") or {}).get("workspace_stage"):
            stage_status = "in_progress"
            substage = workspace_stage
        else:
            stage_status = "not_started"
            substage = "health"
        self.workspace.ensure_run(int(pipeline_id), user_id=_txt(tenant_id) or "system")
        self.workspace.set_stage_state(
            int(pipeline_id),
            "preprocessing_feature_selection",
            stage_status,
            substage=substage,
            summary={
                "build_status": _txt(result.get("build_status") or "draft"),
                "workspace_stage": workspace_stage,
                "feature_count_estimate": int(result.get("feature_count_estimate") or 0),
                "warnings": result.get("warnings") or [],
                "latest_run": latest_run or {},
            },
            error={},
        )
        return result
