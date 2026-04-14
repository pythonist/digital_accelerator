from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd
from pandas.api.types import (
    is_bool_dtype,
    is_datetime64_any_dtype,
    is_numeric_dtype,
)

from api.tools.mlops.duckdb_manager import get_connection
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


def _table_name(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "mule_abt"


def _load_frame(file_path: Path) -> pd.DataFrame:
    suffix = file_path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(file_path)
    if suffix == ".json":
        return pd.read_json(file_path)
    return pd.read_csv(file_path)


def _load_columns_only(file_path: Path) -> List[str]:
    suffix = file_path.suffix.lower()
    try:
        if suffix in {".parquet", ".pq"}:
            return list(pd.read_parquet(file_path).columns)
        if suffix == ".json":
            return list(pd.read_json(file_path).columns)
        return list(pd.read_csv(file_path, nrows=0).columns)
    except Exception:
        return []


def _safe_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


class MuleMasterDatasetService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.workspace = MuleWorkspaceService(self.db_path)
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_pipeline_runs (
                  pipeline_id INTEGER PRIMARY KEY,
                  pipeline_name TEXT,
                  pipeline_type TEXT DEFAULT 'mule',
                  status TEXT DEFAULT 'draft',
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_master_dataset_config (
                  pipeline_id INTEGER PRIMARY KEY,
                  base_table TEXT DEFAULT 'accounts',
                  selected_sources_json TEXT,
                  feature_config_json TEXT,
                  build_status TEXT DEFAULT 'draft',
                  output_table_name TEXT,
                  row_count_estimate BIGINT,
                  column_count_estimate BIGINT,
                  warnings_json TEXT,
                  preview_summary_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_master_dataset_builds (
                  build_id BIGINT PRIMARY KEY,
                  pipeline_id INTEGER,
                  output_table_name TEXT,
                  row_count BIGINT,
                  column_count BIGINT,
                  build_summary_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _env_root(self) -> Path:
        return self.db_path.resolve().parents[2]

    def _data_dir(self) -> Path:
        path = resolve_mlops_data_dir(self._env_root(), create_if_missing=True) / "mule_master_dataset"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _resolve_file_path(self, raw_path: str) -> Path:
        return resolve_data_file_path(Path(raw_path), env_root=self._env_root())

    def _default_config(self, pipeline_id: int) -> Dict[str, Any]:
        return {
            "pipeline_id": int(pipeline_id),
            "base_table": "accounts",
            "grain": "account",
            "output_table_name": f"mule_abt_{int(pipeline_id)}",
            "selected_sources": {
                "customers": True,
                "transactions": True,
                "external_signals": True,
                "device_logs": True,
                "counterparties": True,
                "graph": True,
            },
            "feature_config": {
                "customer_context": {"enabled": True, "aggregation_windows": [], "feature_toggles": ["profile", "geography", "tenure"]},
                "transaction_behavior": {"enabled": True, "aggregation_windows": [30, 90, 180], "feature_toggles": ["volume", "velocity", "mix"]},
                "external_signals": {"enabled": True, "aggregation_windows": [90], "feature_toggles": ["risk_score", "complaint_flags"]},
                "device_intelligence": {"enabled": True, "aggregation_windows": [30, 90], "feature_toggles": ["device_count", "shared_access"]},
                "network_intelligence": {"enabled": True, "aggregation_windows": [90], "feature_toggles": ["counterparty_count", "network_degree"]},
            },
        }

    def _merge_config(self, base: Dict[str, Any], patch: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        merged = dict(base)
        for key, value in (patch or {}).items():
            if key in {"selected_sources", "feature_config"} and isinstance(value, dict):
                current = dict(merged.get(key) or {})
                for nested_key, nested_value in value.items():
                    if isinstance(current.get(nested_key), dict) and isinstance(nested_value, dict):
                        current[nested_key] = {**current[nested_key], **nested_value}
                    else:
                        current[nested_key] = nested_value
                merged[key] = current
            else:
                merged[key] = value
        merged["base_table"] = "accounts"
        merged["grain"] = "account"
        return merged

    def _load_pipeline_name(self, pipeline_id: int) -> str:
        pipeline = self._ensure_pipeline_exists(int(pipeline_id), expected_type=None)
        return _txt(pipeline.get("name")) or f"Mule Pipeline {int(pipeline_id)}"

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
                'Reopen a saved run from Pipeline Hub or create a new Mule run.'
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

    def _ensure_run_row(self, pipeline_id: int, pipeline_name: Optional[str] = None, status: str = "draft") -> None:
        pipeline = self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        name = _txt(pipeline_name) or _txt(pipeline.get("name")) or self._load_pipeline_name(int(pipeline_id))
        with get_connection(self.db_path) as conn:
            exists = conn.execute("SELECT pipeline_id FROM mule_pipeline_runs WHERE pipeline_id = ?", [int(pipeline_id)]).fetchone()
            if exists:
                conn.execute(
                    """
                    UPDATE mule_pipeline_runs
                    SET pipeline_name = ?, pipeline_type = 'mule', status = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pipeline_id = ?
                    """,
                    [name, status, int(pipeline_id)],
                )
            else:
                conn.execute(
                    "INSERT INTO mule_pipeline_runs (pipeline_id, pipeline_name, pipeline_type, status) VALUES (?, ?, 'mule', ?)",
                    [int(pipeline_id), name, status],
                )

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
            current_stage=_txt(current_stage) or "master_dataset",
            current_substage=_txt(current_substage or substage),
            conn=conn,
        )
        self.workspace.set_stage_state(
            int(pipeline_id),
            "master_dataset",
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
                current_stage=_txt(current_stage) or "master_dataset",
                current_substage=_txt(current_substage or substage),
                conn=conn,
            )

    def _list_sources(self, tenant_id: str, env_id: str, pipeline_id: Optional[int] = None) -> List[Dict[str, Any]]:
        query = """
                SELECT dataset_id, dataset_type, filename, file_path, row_count, columns_json
                FROM mlops_dataset_registry
                WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule'
                """
        params: List[Any] = [tenant_id, env_id]
        if pipeline_id is not None:
            query += " AND pipeline_id = ?"
            params.append(int(pipeline_id))
        query += " ORDER BY updated_at DESC"
        with get_connection(self.db_path) as conn:
            rows = conn.execute(query, params).fetchall()
        return [
            {
                "dataset_id": int(row[0]),
                "dataset_type": _low(row[1]),
                "filename": _txt(row[2]),
                "file_path": _txt(row[3]),
                "row_count": int(row[4] or 0),
                "columns": _loads(row[5], []),
            }
            for row in rows
        ]

    def _load_frames(self, tenant_id: str, env_id: str, pipeline_id: Optional[int] = None) -> Dict[str, pd.DataFrame]:
        frames: Dict[str, pd.DataFrame] = {}
        for row in self._list_sources(tenant_id, env_id, pipeline_id=pipeline_id):
            try:
                frame = _load_frame(self._resolve_file_path(row["file_path"]))
            except Exception:
                continue
            if not frame.empty:
                frames[row["dataset_type"]] = frame.copy()
        return frames

    def _load_persisted_master_frame(self, tenant_id: str, env_id: str, pipeline_id: int) -> Optional[Tuple[Dict[str, Any], pd.DataFrame]]:
        rows = self._list_sources(tenant_id, env_id, pipeline_id=pipeline_id)
        master_row = next((row for row in rows if _low(row.get("dataset_type")) == "master_dataset"), None)
        if not master_row:
            return None
        try:
            frame = _load_frame(self._resolve_file_path(master_row["file_path"]))
        except Exception:
            return None
        if frame is None or frame.empty:
            return None
        return master_row, frame.copy()

    def _source_inventory(self, tenant_id: str, env_id: str, pipeline_id: Optional[int] = None) -> List[Dict[str, Any]]:
        seen: set[str] = set()
        inventory: List[Dict[str, Any]] = []
        for row in self._list_sources(tenant_id, env_id, pipeline_id=pipeline_id):
            dataset_type = _low(row.get("dataset_type"))
            if not dataset_type or dataset_type in seen:
                continue
            seen.add(dataset_type)
            columns = row.get("columns") or []
            file_path = _txt(row.get("file_path"))
            if not columns and file_path:
                columns = _load_columns_only(self._resolve_file_path(file_path))
            inventory.append({
                "dataset_id": int(row.get("dataset_id") or 0),
                "dataset_type": dataset_type,
                "filename": _txt(row.get("filename")),
                "file_path": file_path,
                "row_count": int(row.get("row_count") or 0),
                "column_count": len(columns) if isinstance(columns, list) else 0,
                "columns": columns if isinstance(columns, list) else [],
            })
        return inventory

    def _column_family(self, series: pd.Series) -> str:
        if is_bool_dtype(series):
            return "boolean"
        if is_datetime64_any_dtype(series):
            return "datetime"
        if is_numeric_dtype(series):
            return "numeric"
        return "categorical"

    def _null_pct(self, series: pd.Series) -> float:
        if series.empty:
            return 0.0
        return float(series.isna().mean() * 100.0)

    def _build_frame_insights(self, frame: pd.DataFrame, column_source_map: Dict[str, str]) -> Dict[str, Any]:
        dtype_counts = {
            "numeric": 0,
            "categorical": 0,
            "datetime": 0,
            "boolean": 0,
        }
        source_group_counts: Dict[str, int] = {}
        column_catalog: List[Dict[str, Any]] = []
        categorical_highlights: List[Dict[str, Any]] = []
        numeric_highlights: List[Dict[str, Any]] = []

        for column in frame.columns:
            series = frame[column]
            family = self._column_family(series)
            dtype_counts[family] = dtype_counts.get(family, 0) + 1
            source_group = _txt(column_source_map.get(column) or "other")
            source_group_counts[source_group] = int(source_group_counts.get(source_group, 0) or 0) + 1
            unique_count = int(series.nunique(dropna=True))
            null_pct = self._null_pct(series)
            column_catalog.append({
                "column": column,
                "source_group": source_group,
                "dtype": str(series.dtype),
                "family": family,
                "null_pct": round(null_pct, 2),
                "unique_count": unique_count,
            })

            if family in {"categorical", "boolean"}:
                top_values = []
                top_counts = series.fillna("Missing").astype(str).value_counts(dropna=False).head(5)
                total = max(int(len(series) or 0), 1)
                for value, count in top_counts.items():
                    top_values.append({
                        "value": str(value),
                        "count": int(count),
                        "pct": round((float(count) / float(total)) * 100.0, 2),
                    })
                categorical_highlights.append({
                    "column": column,
                    "source_group": source_group,
                    "dtype": str(series.dtype),
                    "distinct_count": unique_count,
                    "null_pct": round(null_pct, 2),
                    "top_values": top_values,
                })
            elif family == "numeric":
                numeric_series = pd.to_numeric(series, errors="coerce").dropna()
                if numeric_series.empty:
                    continue
                numeric_highlights.append({
                    "column": column,
                    "source_group": source_group,
                    "dtype": str(series.dtype),
                    "null_pct": round(null_pct, 2),
                    "mean": round(float(numeric_series.mean()), 4),
                    "median": round(float(numeric_series.median()), 4),
                    "min": round(float(numeric_series.min()), 4),
                    "max": round(float(numeric_series.max()), 4),
                    "std": round(float(numeric_series.std(ddof=0) or 0.0), 4),
                })

        account_type_analysis = None
        account_type_column = _first(frame.columns, ["account_type", "acct_type"])
        if account_type_column:
            counts = frame[account_type_column].fillna("Missing").astype(str).value_counts(dropna=False).head(8)
            total = max(int(len(frame) or 0), 1)
            account_type_analysis = {
                "column": account_type_column,
                "distribution": [
                    {
                        "value": str(value),
                        "count": int(count),
                        "pct": round((float(count) / float(total)) * 100.0, 2),
                    }
                    for value, count in counts.items()
                ],
            }

        categorical_highlights.sort(key=lambda item: (item["null_pct"], -item["distinct_count"], item["column"]))
        numeric_highlights.sort(key=lambda item: (item["null_pct"], -abs(float(item["mean"] or 0.0)), item["column"]))
        column_catalog.sort(key=lambda item: (item["source_group"], item["column"]))

        return {
            "overview": {
                "row_count": int(frame.shape[0]),
                "column_count": int(frame.shape[1]),
                "numeric_columns": int(dtype_counts.get("numeric") or 0),
                "categorical_columns": int(dtype_counts.get("categorical") or 0),
                "datetime_columns": int(dtype_counts.get("datetime") or 0),
                "boolean_columns": int(dtype_counts.get("boolean") or 0),
            },
            "source_groups": [
                {"group": group, "column_count": int(count)}
                for group, count in sorted(source_group_counts.items(), key=lambda item: (-item[1], item[0]))
            ],
            "account_type_analysis": account_type_analysis,
            "categorical_highlights": categorical_highlights[:10],
            "numeric_highlights": numeric_highlights[:10],
            "column_catalog": column_catalog,
        }

    def load_mule_master_config(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        self._ensure_run_row(pipeline_id)
        self.workspace.ensure_run(
            int(pipeline_id),
            user_id=_txt(tenant_id) or "system",
            status="in_progress",
            current_stage="master_dataset",
            current_substage="configure",
        )
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT base_table, selected_sources_json, feature_config_json, build_status,
                       output_table_name, row_count_estimate, column_count_estimate, warnings_json, preview_summary_json
                FROM mule_master_dataset_config
                WHERE pipeline_id = ?
                """,
                [int(pipeline_id)],
            ).fetchone()
        default = self._default_config(pipeline_id)
        if not row:
            return {
                "pipeline_id": int(pipeline_id),
                "config": default,
                "build_status": "draft",
                "row_count_estimate": 0,
                "column_count_estimate": 0,
                "warnings": [],
                "preview_summary": {},
            }
        return {
            "pipeline_id": int(pipeline_id),
            "config": self._merge_config(default, {
                "base_table": row[0] or "accounts",
                "selected_sources": _loads(row[1], {}),
                "feature_config": _loads(row[2], {}),
                "output_table_name": row[4] or default["output_table_name"],
            }),
            "build_status": _txt(row[3]) or "draft",
            "row_count_estimate": int(row[5] or 0),
            "column_count_estimate": int(row[6] or 0),
            "warnings": _loads(row[7], []),
            "preview_summary": _loads(row[8], {}),
        }

    def save_mule_master_config(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        config_patch: Optional[Dict[str, Any]] = None,
        pipeline_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        self._ensure_run_row(pipeline_id, pipeline_name=pipeline_name)
        current = self.load_mule_master_config(tenant_id, env_id, pipeline_id)
        config = self._merge_config(current["config"], config_patch)
        with get_connection(self.db_path) as conn:
            exists = conn.execute("SELECT pipeline_id FROM mule_master_dataset_config WHERE pipeline_id = ?", [int(pipeline_id)]).fetchone()
            values = [
                int(pipeline_id),
                "accounts",
                json.dumps(config.get("selected_sources") or {}, default=str),
                json.dumps(config.get("feature_config") or {}, default=str),
                current["build_status"],
                _txt(config.get("output_table_name") or f"mule_abt_{int(pipeline_id)}"),
                int(current["row_count_estimate"] or 0),
                int(current["column_count_estimate"] or 0),
                json.dumps(current["warnings"] or [], default=str),
                json.dumps(current["preview_summary"] or {}, default=str),
            ]
            if exists:
                conn.execute(
                    """
                    UPDATE mule_master_dataset_config
                    SET base_table = ?, selected_sources_json = ?, feature_config_json = ?, build_status = ?,
                        output_table_name = ?, row_count_estimate = ?, column_count_estimate = ?, warnings_json = ?,
                        preview_summary_json = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pipeline_id = ?
                    """,
                    [values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], int(pipeline_id)],
                )
            else:
                conn.execute(
                    """
                    INSERT INTO mule_master_dataset_config (
                      pipeline_id, base_table, selected_sources_json, feature_config_json, build_status,
                      output_table_name, row_count_estimate, column_count_estimate, warnings_json, preview_summary_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    values,
                )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "in_progress",
                "configure",
                summary={
                    "output_table_name": _txt(config.get("output_table_name") or f"mule_abt_{int(pipeline_id)}"),
                    "selected_sources": config.get("selected_sources") or {},
                    "warnings": current.get("warnings") or [],
                },
                conn=conn,
            )
        return self.load_mule_master_config(tenant_id, env_id, pipeline_id)

    def _coverage(self, values: pd.Series) -> float:
        if values.empty:
            return 0.0
        return float(values.notna().mean() * 100.0)

    def _warnings(self, accounts: pd.DataFrame, frames: Dict[str, pd.DataFrame]) -> List[str]:
        warnings: List[str] = []
        account_key = _first(accounts.columns, ["account_id", "acct_id", "account_number"])
        if not account_key:
            return ["Accounts table is missing account_id."]
        dupes = int(accounts[account_key].duplicated(keep=False).sum())
        if dupes:
            warnings.append(f"Accounts contains {dupes} duplicate account_id values. Duplicates will be collapsed.")
        for name in ("transactions", "external_signals", "device_logs", "counterparties"):
            frame = frames.get(name)
            if frame is not None and not _first(frame.columns, ["account_id", "acct_id", "account_number", "party_id", "entity_id"]):
                warnings.append(f"{name.replace('_', ' ').title()} cannot be aggregated to account_id with the current schema.")
        leakage = [col for col in accounts.columns if any(token in _low(col) for token in ("mule_flag", "is_mule", "label", "target", "outcome"))]
        if leakage:
            warnings.append(f"Leakage-sensitive columns found in accounts: {', '.join(leakage[:4])}")
        return warnings

    def _aggregate_generic(self, frame: Optional[pd.DataFrame], prefix: str, extra_fields: Iterable[str]) -> pd.DataFrame:
        if frame is None:
            return pd.DataFrame(columns=["account_id"])
        key = _first(frame.columns, ["account_id", "acct_id", "account_number", "entity_id", "party_id"])
        if not key:
            return pd.DataFrame(columns=["account_id"])
        working = frame.rename(columns={key: "account_id"}).copy()
        agg = working.groupby("account_id", dropna=False).size().reset_index(name=f"{prefix}_count")
        for field in extra_fields:
            column = _first(working.columns, [field])
            if not column:
                continue
            if pd.api.types.is_numeric_dtype(working[column]):
                stats = working.groupby("account_id", dropna=False)[column].agg(["mean", "max"]).reset_index()
                stats.rename(columns={"mean": f"{prefix}_{column}_mean", "max": f"{prefix}_{column}_max"}, inplace=True)
                agg = agg.merge(stats, on="account_id", how="left")
            else:
                counts = working.groupby("account_id", dropna=False)[column].nunique(dropna=True).reset_index(name=f"{prefix}_{column}_nunique")
                agg = agg.merge(counts, on="account_id", how="left")
        return agg

    def _assemble(self, tenant_id: str, env_id: str, pipeline_id: int, config: Dict[str, Any]) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        frames = self._load_frames(tenant_id, env_id, pipeline_id=pipeline_id)
        if not frames:
            raise ValueError(
                "No Mule source tables are registered for this pipeline. "
                "Upload accounts.csv and the supporting Mule sources into this saved run, then try again."
            )
        accounts = frames.get("accounts")
        if accounts is None:
            available_sources = ", ".join(sorted(frames.keys()))
            available_hint = f" Available sources for this run: {available_sources}." if available_sources else ""
            raise ValueError(
                "Accounts table is required before using the Mule master dataset canvas."
                f"{available_hint}"
            )

        account_key = _first(accounts.columns, ["account_id", "acct_id", "account_number"])
        if not account_key:
            raise ValueError("Accounts table is missing account_id.")
        analytical = accounts.rename(columns={account_key: "account_id"}).copy()
        if analytical["account_id"].duplicated(keep=False).any():
            analytical = analytical.drop_duplicates(subset=["account_id"]).reset_index(drop=True)
        column_source_map = {column: "accounts" for column in analytical.columns}

        base_rows = int(analytical.shape[0])
        warnings = self._warnings(accounts, frames)
        cards: List[Dict[str, Any]] = []

        cards.append({
            "key": "accounts",
            "title": "Accounts",
            "description": "Anchor the analytical dataset at one row per account.",
            "sources": ["accounts"],
            "feature_count": max(int(analytical.shape[1] - 1), 0),
            "coverage_pct": 100.0,
            "status": "Ready",
            "generated_columns": [],
            "warnings": [],
        })

        selected = config.get("selected_sources") or {}

        customers = frames.get("customers")
        customer_id_accounts = _first(analytical.columns, ["customer_id", "party_id", "entity_id"])
        customer_id_customers = _first(customers.columns if customers is not None else [], ["customer_id", "party_id", "entity_id"])
        customer_generated: List[str] = []
        if customers is not None and customer_id_accounts and customer_id_customers and _bool(selected.get("customers"), True):
            cust = customers.rename(columns={customer_id_customers: "__customer_join_key"}).copy()
            base = analytical[["account_id", customer_id_accounts]].rename(columns={customer_id_accounts: "__customer_join_key"})
            joined = base.merge(cust, on="__customer_join_key", how="left")
            keep = [col for col in joined.columns if col not in {"account_id", "__customer_join_key"}][:10]
            rename = {col: f"customer_{col}" for col in keep}
            customer_frame = joined[["account_id", *keep]].rename(columns=rename)
            analytical = analytical.merge(customer_frame, on="account_id", how="left")
            customer_generated = list(rename.values())
            for column in customer_generated:
                column_source_map[column] = "customer_context"
        cards.append({
            "key": "customer_context",
            "title": "Customer Context",
            "description": "Bring customer profile and relationship context onto each account.",
            "sources": ["customers"],
            "feature_count": len(customer_generated),
            "coverage_pct": self._coverage(analytical[customer_generated].notna().any(axis=1)) if customer_generated else 0.0,
            "status": "Ready" if customer_generated else "Not configured",
            "generated_columns": customer_generated,
            "warnings": [] if customer_generated else ["Customer join is not configured or customers are missing."],
        })

        txn_frame = self._aggregate_generic(frames.get("transactions") if _bool(selected.get("transactions"), True) else None, "txn", ["amount", "txn_amount", "transaction_amount", "direction"])
        txn_generated = [col for col in txn_frame.columns if col != "account_id"]
        if txn_generated:
            analytical = analytical.merge(txn_frame, on="account_id", how="left")
            for column in txn_generated:
                column_source_map[column] = "transaction_behavior"
        cards.append({
            "key": "transaction_behavior",
            "title": "Transaction Behavior",
            "description": "Aggregate raw transactions into account-level behavioral signals.",
            "sources": ["transactions"],
            "feature_count": len(txn_generated),
            "coverage_pct": self._coverage(analytical[txn_generated].notna().any(axis=1)) if txn_generated else 0.0,
            "status": "Ready" if txn_generated else "Not configured",
            "generated_columns": txn_generated,
            "warnings": [] if txn_generated else ["Transactions are not enabled or cannot be aggregated to account_id."],
        })

        external_frame = self._aggregate_generic(frames.get("external_signals") if _bool(selected.get("external_signals"), True) else None, "external_signal", ["risk_score", "signal_score", "signal_type"])
        external_generated = [col for col in external_frame.columns if col != "account_id"]
        if external_generated:
            analytical = analytical.merge(external_frame, on="account_id", how="left")
            for column in external_generated:
                column_source_map[column] = "external_signals"
        cards.append({
            "key": "external_signals",
            "title": "External Signals",
            "description": "Add complaints, intelligence, and external risk cues to the account view.",
            "sources": ["external_signals"],
            "feature_count": len(external_generated),
            "coverage_pct": self._coverage(analytical[external_generated].notna().any(axis=1)) if external_generated else 0.0,
            "status": "Ready" if external_generated else "Not configured",
            "generated_columns": external_generated,
            "warnings": [] if external_generated else ["External signals are not enabled or not linked to account_id."],
        })

        device_frame = self._aggregate_generic(frames.get("device_logs") if _bool(selected.get("device_logs"), True) else None, "device_signal", ["device_id", "ip_address", "channel", "risk_score"])
        device_generated = [col for col in device_frame.columns if col != "account_id"]
        if device_generated:
            analytical = analytical.merge(device_frame, on="account_id", how="left")
            for column in device_generated:
                column_source_map[column] = "device_intelligence"
        cards.append({
            "key": "device_intelligence",
            "title": "Device Intelligence",
            "description": "Roll up device access and channel behavior into account-level signals.",
            "sources": ["device_logs"],
            "feature_count": len(device_generated),
            "coverage_pct": self._coverage(analytical[device_generated].notna().any(axis=1)) if device_generated else 0.0,
            "status": "Ready" if device_generated else "Not configured",
            "generated_columns": device_generated,
            "warnings": [] if device_generated else ["Device logs are not enabled or not linked to account_id."],
        })

        network_sources = []
        network = pd.DataFrame({"account_id": analytical["account_id"]})
        if _bool(selected.get("counterparties"), True):
            cp_frame = self._aggregate_generic(frames.get("counterparties"), "counterparty", ["counterparty_id", "beneficiary_id", "sender_id"])
            cp_generated = [col for col in cp_frame.columns if col != "account_id"]
            if cp_generated:
                network = network.merge(cp_frame, on="account_id", how="left")
                network_sources.append("counterparties")
        if _bool(selected.get("graph"), True):
            nodes = frames.get("graph_nodes")
            edges = frames.get("graph_edges")
            node_acc = _first(nodes.columns if nodes is not None else [], ["account_id", "acct_id", "account_number"])
            node_id = _first(nodes.columns if nodes is not None else [], ["node_id", "entity_id", "id"])
            edge_s = _first(edges.columns if edges is not None else [], ["source", "src", "from_node", "source_id"])
            edge_t = _first(edges.columns if edges is not None else [], ["target", "dst", "to_node", "target_id"])
            if nodes is not None and edges is not None and node_acc and node_id and edge_s and edge_t:
                node_map = nodes[[node_id, node_acc]].rename(columns={node_id: "node_id", node_acc: "account_id"})
                edge_counts = pd.concat([
                    edges[[edge_s]].rename(columns={edge_s: "node_id"}),
                    edges[[edge_t]].rename(columns={edge_t: "node_id"}),
                ], ignore_index=True).groupby("node_id").size().reset_index(name="network_degree")
                graph_frame = node_map.merge(edge_counts, on="node_id", how="left").groupby("account_id", dropna=False)["network_degree"].agg(["sum", "max"]).reset_index()
                graph_frame.rename(columns={"sum": "network_degree_sum", "max": "network_degree_max"}, inplace=True)
                network = network.merge(graph_frame, on="account_id", how="left")
                network_sources.extend(["graph_nodes", "graph_edges"])
        network_generated = [col for col in network.columns if col != "account_id"]
        if network_generated:
            analytical = analytical.merge(network, on="account_id", how="left")
            for column in network_generated:
                column_source_map[column] = "network_intelligence"
        cards.append({
            "key": "network_intelligence",
            "title": "Network Intelligence",
            "description": "Add counterparty and graph-derived exposure signals without raw many-to-many joins.",
            "sources": network_sources or ["counterparties", "graph_nodes", "graph_edges"],
            "feature_count": len(network_generated),
            "coverage_pct": self._coverage(analytical[network_generated].notna().any(axis=1)) if network_generated else 0.0,
            "status": "Ready" if network_generated else "Not configured",
            "generated_columns": network_generated,
            "warnings": [] if network_generated else ["Network features are not enabled or graph/counterparty joins are incomplete."],
        })

        if analytical["account_id"].duplicated(keep=False).any():
            warnings.append("Row explosion detected during assembly. Duplicate account_id rows were collapsed.")
            analytical = analytical.drop_duplicates(subset=["account_id"]).reset_index(drop=True)

        joined_sources = [card["key"] for card in cards[1:] if card["feature_count"] > 0]
        summary = {
            "base_rows": base_rows,
            "estimated_final_rows": int(analytical.shape[0]),
            "estimated_column_count": int(analytical.shape[1]),
            "feature_group_count": len(joined_sources),
            "data_quality_status": "warning" if warnings else "ready",
            "label_readiness": "mule_labels" in frames,
            "warnings": warnings,
            "joined_sources": joined_sources,
            "final_dataset_estimate": f"{int(analytical.shape[0]):,} rows x {int(analytical.shape[1]):,} columns",
            "target": "mule_flag" if "mule_labels" in frames else "Pending label linkage",
            "sources_loaded": len(frames),
        }
        insights = self._build_frame_insights(analytical, column_source_map)
        summary["insights"] = insights
        cards.append({
            "key": "analytical_base",
            "title": "Analytical Base Table",
            "description": "One row per account with selected Mule signals assembled for modeling.",
            "sources": joined_sources,
            "feature_count": max(int(analytical.shape[1] - 1), 0),
            "coverage_pct": 100.0,
            "status": "Ready",
            "generated_columns": list(analytical.columns),
            "warnings": warnings,
        })
        return {
            "config": config,
            "cards": cards,
            "summary": summary,
            "sample_rows": analytical.head(20).fillna("").to_dict(orient="records"),
            "preview_columns": list(analytical.columns),
            "insights": insights,
            "frame": analytical,
        }

    def preview_mule_master_dataset(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        current = self.load_mule_master_config(tenant_id, env_id, pipeline_id)
        self._workspace_mark(
            tenant_id,
            pipeline_id,
            "in_progress",
            "preview",
            summary={
                "build_status": _txt(current.get("build_status") or "draft"),
                "output_table_name": _txt((current.get("config") or {}).get("output_table_name")),
            },
        )
        try:
            assembled = self._assemble(tenant_id, env_id, pipeline_id, current["config"])
        except ValueError as error:
            persisted = self._load_persisted_master_frame(tenant_id, env_id, pipeline_id)
            build_status = _low(current.get("build_status") or "")
            if "accounts table is required" not in _low(error) or not persisted or build_status != "built":
                self._workspace_mark(
                    tenant_id,
                    pipeline_id,
                    "failed",
                    "preview",
                    summary={"build_status": _txt(current.get("build_status") or "draft")},
                    error={"message": str(error)},
                )
                raise
            _, frame = persisted
            source_inventory = self._source_inventory(tenant_id, env_id, pipeline_id=int(pipeline_id))
            summary = current.get("preview_summary") or {}
            summary = {
                **summary,
                "base_rows": int(summary.get("base_rows") or frame.shape[0]),
                "estimated_final_rows": int(summary.get("estimated_final_rows") or frame.shape[0]),
                "estimated_column_count": int(summary.get("estimated_column_count") or frame.shape[1]),
                "feature_group_count": int(summary.get("feature_group_count") or 0),
                "data_quality_status": _txt(summary.get("data_quality_status") or current.get("build_status") or "built"),
                "label_readiness": bool(summary.get("label_readiness")),
                "warnings": summary.get("warnings") or current.get("warnings") or [],
                "joined_sources": summary.get("joined_sources") or [],
                "final_dataset_estimate": summary.get("final_dataset_estimate") or f"{int(frame.shape[0]):,} rows x {int(frame.shape[1]):,} columns",
                "target": summary.get("target") or "mule_flag" if "mule_labels" in [item["dataset_type"] for item in source_inventory] else "Pending label linkage",
                "sources_loaded": len(source_inventory),
                "preview_mode": "persisted_master_dataset",
            }
            insights = self._build_frame_insights(frame, {column: "analytical_base" for column in frame.columns})
            insights["overview"] = {
                **(insights.get("overview") or {}),
                "row_count": int(frame.shape[0]),
                "column_count": int(frame.shape[1]),
            }
            assembled = {
                "config": current["config"],
                "cards": [],
                "summary": summary,
                "sample_rows": frame.head(20).fillna("").to_dict(orient="records"),
                "preview_columns": list(frame.columns),
                "insights": insights,
                "frame": frame,
            }
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                UPDATE mule_master_dataset_config
                SET row_count_estimate = ?, column_count_estimate = ?, warnings_json = ?, preview_summary_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ?
                """,
                [
                    int(assembled["summary"]["estimated_final_rows"]),
                    int(assembled["summary"]["estimated_column_count"]),
                    json.dumps(assembled["summary"]["warnings"], default=str),
                    json.dumps(assembled["summary"], default=str),
                    int(pipeline_id),
                ],
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "in_progress",
                "preview",
                summary={
                    "build_status": _txt(current.get("build_status") or "draft"),
                    "estimated_rows": int(assembled["summary"]["estimated_final_rows"]),
                    "estimated_columns": int(assembled["summary"]["estimated_column_count"]),
                    "warnings": assembled["summary"].get("warnings") or [],
                },
                conn=conn,
            )
        return {
            "pipeline_id": int(pipeline_id),
            "config": current["config"],
            "cards": assembled["cards"],
            "summary": assembled["summary"],
            "sample_rows": assembled["sample_rows"],
            "preview_columns": assembled["preview_columns"],
            "insights": assembled["insights"],
        }

    def build_mule_master_dataset(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        current = self.load_mule_master_config(tenant_id, env_id, pipeline_id)
        self._workspace_mark(
            tenant_id,
            pipeline_id,
            "in_progress",
            "build",
            summary={"build_status": "building"},
            current_stage="master_dataset",
            current_substage="build",
        )
        try:
            assembled = self._assemble(tenant_id, env_id, pipeline_id, current["config"])
        except Exception as exc:
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "failed",
                "build",
                summary={"build_status": "failed"},
                error={"message": str(exc)},
                current_stage="master_dataset",
                current_substage="build",
            )
            raise
        frame: pd.DataFrame = assembled["frame"]
        output_table_name = _table_name(current["config"].get("output_table_name") or f"mule_abt_{int(pipeline_id)}")
        output_path = self._data_dir() / f"{output_table_name}.csv"
        frame.to_csv(output_path, index=False)

        with get_connection(self.db_path) as conn:
            conn.register("__mule_master_df", frame)
            conn.execute(f'CREATE OR REPLACE TABLE "{output_table_name}" AS SELECT * FROM __mule_master_df')
            try:
                conn.unregister("__mule_master_df")
            except Exception:
                pass

            build_id = int(conn.execute("SELECT COALESCE(MAX(build_id), 0) + 1 FROM mule_master_dataset_builds").fetchone()[0] or 1)
            build_summary = {
                **assembled["summary"],
                "output_table_name": output_table_name,
                "output_file_path": str(output_path),
            }
            conn.execute(
                """
                INSERT INTO mule_master_dataset_builds (
                  build_id, pipeline_id, output_table_name, row_count, column_count, build_summary_json
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [build_id, int(pipeline_id), output_table_name, int(frame.shape[0]), int(frame.shape[1]), json.dumps(build_summary, default=str)],
            )
            conn.execute(
                """
                UPDATE mule_master_dataset_config
                SET build_status = 'built', output_table_name = ?, row_count_estimate = ?, column_count_estimate = ?,
                    warnings_json = ?, preview_summary_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE pipeline_id = ?
                """,
                [
                    output_table_name,
                    int(frame.shape[0]),
                    int(frame.shape[1]),
                    json.dumps(assembled["summary"]["warnings"], default=str),
                    json.dumps(build_summary, default=str),
                    int(pipeline_id),
                ],
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
                    dataset_id,
                    tenant_id,
                    env_id,
                    int(pipeline_id),
                    "mule",
                    "master_dataset",
                    output_path.name,
                    str(output_path),
                    int(frame.shape[0]),
                    json.dumps(list(frame.columns), default=str),
                    json.dumps({col: str(dtype) for col, dtype in frame.dtypes.items()}, default=str),
                ],
            )
            self.workspace.register_artifact(
                int(pipeline_id),
                "master_dataset",
                "master_dataset_csv",
                str(output_path),
                metadata={
                    "dataset_id": int(dataset_id),
                    "build_id": int(build_id),
                    "row_count": int(frame.shape[0]),
                    "column_count": int(frame.shape[1]),
                    "output_table_name": output_table_name,
                },
                conn=conn,
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "completed",
                "build",
                summary={
                    "build_status": "built",
                    "dataset_id": int(dataset_id),
                    "build_id": int(build_id),
                    "row_count": int(frame.shape[0]),
                    "column_count": int(frame.shape[1]),
                    "output_table_name": output_table_name,
                    "warnings": assembled["summary"].get("warnings") or [],
                },
                current_stage="feature_store",
                current_substage="configure",
                conn=conn,
            )
        self._ensure_run_row(pipeline_id, status="built")
        return {
            "pipeline_id": int(pipeline_id),
            "build_id": build_id,
            "output_table_name": output_table_name,
            "row_count": int(frame.shape[0]),
            "column_count": int(frame.shape[1]),
            "summary": {**assembled["summary"], "dataset_id": dataset_id, "output_table_name": output_table_name, "output_file_path": str(output_path)},
            "sample_rows": assembled["sample_rows"],
        }

    def get_mule_master_dataset_status(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        current = self.load_mule_master_config(tenant_id, env_id, pipeline_id)
        source_inventory = self._source_inventory(tenant_id, env_id, pipeline_id=int(pipeline_id))
        available_source_types = [item["dataset_type"] for item in source_inventory]
        frame_inventory = self._load_frames(tenant_id, env_id, pipeline_id=int(pipeline_id))
        available_frame_types = sorted(frame_inventory.keys())
        source_type_set = set(available_source_types)
        frame_type_set = set(available_frame_types)
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT build_id, output_table_name, row_count, column_count, build_summary_json, created_at
                FROM mule_master_dataset_builds
                WHERE pipeline_id = ?
                ORDER BY created_at DESC, build_id DESC
                LIMIT 1
                """,
                [int(pipeline_id)],
            ).fetchone()
        latest_build = None
        if row:
            latest_build = {
                "build_id": int(row[0]),
                "output_table_name": _txt(row[1]),
                "row_count": int(row[2] or 0),
                "column_count": int(row[3] or 0),
                "summary": _loads(row[4], {}),
                "created_at": row[5].isoformat() if hasattr(row[5], "isoformat") else row[5],
            }
        build_state = _low(current.get("build_status") or "")
        stage_status = "completed" if build_state in {"built", "completed"} and latest_build else "in_progress"
        self._workspace_mark(
            tenant_id,
            pipeline_id,
            stage_status,
            "build" if stage_status == "completed" else "configure",
            summary={
                "build_status": _txt(current.get("build_status") or "draft"),
                "latest_build": latest_build or {},
                "warnings": current.get("warnings") or [],
                "estimated_rows": int(current.get("row_count_estimate") or 0),
                "estimated_columns": int(current.get("column_count_estimate") or 0),
            },
            current_stage="feature_store" if stage_status == "completed" else "master_dataset",
            current_substage="configure" if stage_status == "completed" else "preview",
        )
        return {
            "pipeline_id": int(pipeline_id),
            "config": current["config"],
            "build_status": current["build_status"],
            "row_count_estimate": current["row_count_estimate"],
            "column_count_estimate": current["column_count_estimate"],
            "warnings": current["warnings"],
            "preview_summary": current["preview_summary"],
            "latest_build": latest_build,
            "sources_loaded": len(source_inventory),
            "source_inventory": source_inventory,
            "available_source_types": available_source_types,
            "available_frame_types": available_frame_types,
            "has_accounts_source": ("accounts" in source_type_set) or ("accounts" in frame_type_set),
            "has_accounts_frame": "accounts" in frame_type_set,
        }
