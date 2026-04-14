from __future__ import annotations

import json
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, OneHotEncoder

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mule_workspace_service import MuleWorkspaceService
from api.tools.mlops.path_utils import resolve_data_file_path, resolve_mlops_data_dir

try:
    from lightgbm import LGBMClassifier
except Exception:  # pragma: no cover
    LGBMClassifier = None

try:
    from xgboost import XGBClassifier
except Exception:  # pragma: no cover
    XGBClassifier = None

try:
    from catboost import CatBoostClassifier
except Exception:  # pragma: no cover
    CatBoostClassifier = None

try:
    import shap
    SHAP_AVAILABLE = True
except Exception:  # pragma: no cover
    shap = None
    SHAP_AVAILABLE = False

try:
    from hmmlearn import hmm
    HMM_AVAILABLE = True
except Exception:  # pragma: no cover
    hmm = None
    HMM_AVAILABLE = False

try:
    import torch
    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover
    torch = None
    TORCH_AVAILABLE = False


WORKBENCH_TABS = [
    "validation",
    "supervised",
    "sequence",
    "graph",
    "tuning",
    "evaluation",
    "explainability",
    "champion",
    "policy",
    "summary",
]

ID_KEYWORDS = {
    "account_id",
    "customer_id",
    "transaction_id",
    "session_id",
    "alert_id",
    "case_id",
    "entity_id",
}

LEAKAGE_COLUMNS = {
    "mule_flag",
    "mule_typology",
    "mule_category",
    "label",
    "typology_confidence",
    "typology_reason_summary",
    "final_mule_score",
    "model_top_prob",
    "primary_category",
    "secondary_category",
    "priority_band",
}

TARGET_CANDIDATES = [
    ("mule_category", "Existing mule category column"),
    ("label", "Existing model label column"),
    ("mule_typology", "Typology label joined from Mule metadata"),
]

SUPERVISED_ALGORITHMS = [
    {
        "id": "xgboost",
        "label": "XGBoost",
        "family": "Gradient boosting",
        "business_suitability": "Strong tabular performer for multiclass AML typology detection.",
        "interpretability": "Medium",
        "speed": "Medium",
        "multiclass_support": True,
        "available": XGBClassifier is not None,
    },
    {
        "id": "lightgbm",
        "label": "LightGBM",
        "family": "Gradient boosting",
        "business_suitability": "Fast challenger for wide governed feature sets.",
        "interpretability": "Medium",
        "speed": "Fast",
        "multiclass_support": True,
        "available": LGBMClassifier is not None,
    },
    {
        "id": "catboost",
        "label": "CatBoost",
        "family": "Gradient boosting",
        "business_suitability": "Useful when categorical Mule indicators matter heavily.",
        "interpretability": "Medium",
        "speed": "Medium",
        "multiclass_support": True,
        "available": CatBoostClassifier is not None,
    },
    {
        "id": "random_forest",
        "label": "Random Forest",
        "family": "Tree ensemble",
        "business_suitability": "Stable benchmark with robust AML baseline behavior.",
        "interpretability": "Medium",
        "speed": "Medium",
        "multiclass_support": True,
        "available": True,
    },
    {
        "id": "logistic_regression",
        "label": "Logistic Regression",
        "family": "Linear baseline",
        "business_suitability": "Interpretable multiclass benchmark and calibration baseline.",
        "interpretability": "High",
        "speed": "Fast",
        "multiclass_support": True,
        "available": True,
    },
]

SEQUENCE_TRACKS = [
    {
        "id": "hazard",
        "label": "Hazard Model",
        "kind": "Supervised",
        "required_columns": [
            "account_txn_velocity_1h",
            "account_txn_velocity_24h",
            "sequence_score",
            "shared_device_risk",
            "shared_ip_risk",
            "dormant_activation_flag",
        ],
    },
    {
        "id": "hmm",
        "label": "Hidden Markov Model",
        "kind": "Unsupervised",
        "required_columns": [
            "sequence_score",
            "account_txn_velocity_1h",
            "account_txn_velocity_24h",
        ],
    },
    {"id": "lstm", "label": "LSTM", "kind": "Supervised", "required_columns": ["customer_id"]},
    {"id": "transformer", "label": "Transformer", "kind": "Supervised", "required_columns": ["customer_id"]},
]

GRAPH_FEATURES = [
    ("pagerank", "graph_pagerank", "PageRank centrality for account linkage importance"),
    ("clustering", "graph_clustering", "Local clustering coefficient"),
    ("degree_centrality", "graph_degree", "Account degree / connectivity"),
    ("community_detection", "graph_community_id", "Detected graph community"),
    ("cycle_flag", "graph_cycle_flag", "Circular flow indicator"),
    ("ring_count", "ring_count", "Number of detected rings touching this account"),
    ("ring_max_risk_score", "ring_max_risk_score", "Highest connected ring risk score"),
    ("ring_max_member_count", "ring_max_member_count", "Largest connected ring size"),
]


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


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _json_default(value: Any):
    if isinstance(value, (np.integer, np.floating)):
        return value.item()
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    return str(value)


def _deep_merge(left: Dict[str, Any], right: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(left or {})
    for key, value in (right or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _load_frame(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    return pd.read_csv(path)


def _first_present(columns: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
    lookup = {str(col).strip().lower(): str(col) for col in columns}
    for candidate in candidates:
        hit = lookup.get(str(candidate).strip().lower())
        if hit:
            return hit
    return None


def _column_is_id(column: str) -> bool:
    raw = _low(column)
    return raw in ID_KEYWORDS or raw.endswith("_id")


def _column_is_leakage(column: str) -> bool:
    raw = _low(column)
    if raw in LEAKAGE_COLUMNS:
        return True
    return raw.startswith("prob_") or raw.startswith("predicted_")


def _column_is_timestamp(column: str) -> bool:
    raw = _low(column)
    return raw.endswith("_ts") or raw.endswith("_timestamp") or raw.endswith("_date")


def _feature_family(column: str) -> str:
    raw = _low(column)
    if raw.startswith("account_"):
        return "Account"
    if raw.startswith("customer_"):
        return "Customer / Identity"
    if raw.startswith("upi_"):
        return "UPI / Digital Transfer"
    if raw.startswith("atm_"):
        return "ATM / Cash"
    if raw.startswith("branch_"):
        return "Branch Deposit"
    if raw.startswith("merchant_"):
        return "Merchant / Gateway"
    if raw.startswith("counterparty_"):
        return "Counterparty Exposure"
    if raw.startswith("graph_") or raw.startswith("ring_"):
        return "Graph / Network"
    if "sequence" in raw or "velocity" in raw or "hazard" in raw:
        return "Sequence / Behaviour"
    return "General"


class MuleModelWorkbenchRepository:
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
                CREATE TABLE IF NOT EXISTS mule_model_workbench_config (
                  pipeline_id INTEGER PRIMARY KEY,
                  config_json TEXT,
                  latest_run_id BIGINT,
                  champion_run_id BIGINT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_model_workbench_runs (
                  run_id BIGINT PRIMARY KEY,
                  pipeline_id INTEGER,
                  status TEXT,
                  target_json TEXT,
                  split_json TEXT,
                  supervised_json TEXT,
                  sequence_json TEXT,
                  graph_json TEXT,
                  tuning_json TEXT,
                  evaluation_json TEXT,
                  explainability_json TEXT,
                  policy_json TEXT,
                  summary_json TEXT,
                  artifacts_json TEXT,
                  logs_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_model_build_config (
                  pipeline_id INTEGER PRIMARY KEY,
                  training_config_json TEXT,
                  approved_features_json TEXT,
                  blocked_features_json TEXT,
                  status TEXT DEFAULT 'draft',
                  metrics_json TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_model_build_runs (
                  run_id BIGINT PRIMARY KEY,
                  pipeline_id INTEGER,
                  model_path TEXT,
                  output_path TEXT,
                  output_table_name TEXT,
                  approved_features_json TEXT,
                  metrics_json TEXT,
                  feature_importance_json TEXT,
                  risk_bands_json TEXT,
                  typology_enabled BOOLEAN DEFAULT FALSE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _env_root(self) -> Path:
        return self.db_path.resolve().parents[2]

    def _artifacts_dir(self, pipeline_id: int) -> Path:
        path = resolve_mlops_data_dir(self._env_root(), create_if_missing=True) / "mule_model_workbench" / f"pipeline_{int(pipeline_id)}"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def default_config(self, pipeline_id: int) -> Dict[str, Any]:
        return {
            "pipeline_id": int(pipeline_id),
            "current_tab": "validation",
            "target": {"source": "auto", "derived_name": "mule_multiclass_target", "non_mule_class": "non_mule"},
            "validation": {"split_strategy": "time_based", "train_pct": 0.70, "validation_pct": 0.15, "test_pct": 0.15, "time_column": "auto"},
            "supervised": {"selected_algorithms": ["xgboost", "lightgbm", "catboost", "random_forest", "logistic_regression"], "primary_algorithm": "lightgbm"},
            "sequence": {"hazard_enabled": True, "hmm_enabled": True, "lstm_enabled": False, "transformer_enabled": False, "entity_column": "customer_id", "time_column": "auto", "max_sequence_length": 25},
            "graph": {"enabled": True, "algorithms": ["pagerank", "clustering", "degree_centrality", "community_detection", "cycle_flag", "ring_count"]},
            "tuning": {
                "mode": "manual",
                "cv_folds": 3,
                "search_iterations": 12,
                "class_weighting": "balanced",
                "calibration": "none",
                "manual_params": {
                    "xgboost": {"n_estimators": 250, "learning_rate": 0.08, "max_depth": 6},
                    "lightgbm": {"n_estimators": 250, "learning_rate": 0.08, "num_leaves": 63},
                    "catboost": {"iterations": 250, "learning_rate": 0.08, "depth": 6},
                    "random_forest": {"n_estimators": 240, "max_depth": 14, "min_samples_leaf": 2},
                    "logistic_regression": {"C": 1.0, "max_iter": 1200},
                },
            },
            "policy": {
                "priority_bands": {"critical": 0.85, "high": 0.70, "medium": 0.50},
                "class_thresholds": {},
                "routing": {
                    "m1": "Digital Mule Review Queue",
                    "m2": "Cash-Out Review Queue",
                    "m3": "Layering / Network Queue",
                    "m4": "Collection Mule Queue",
                    "m5": "Merchant Front Queue",
                    "non_mule": "No action / monitor",
                },
            },
        }

    def ensure_pipeline(self, pipeline_id: int, expected_type: str = "mule") -> Dict[str, Any]:
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
            raise ValueError(f"Pipeline {int(pipeline_id)} is not available in backend persistence.")
        pipeline_type = _low(row[2] or row[3] or "fcc") or "fcc"
        if expected_type and pipeline_type != _low(expected_type):
            raise ValueError(f'Pipeline {int(pipeline_id)} is saved as "{pipeline_type}", not "{_low(expected_type)}".')
        return {"pipeline_id": int(row[0]), "name": _txt(row[1]) or f"Mule Pipeline {int(pipeline_id)}", "pipeline_type": pipeline_type}

    def load_config(self, pipeline_id: int) -> Dict[str, Any]:
        self.ensure_pipeline(int(pipeline_id), expected_type="mule")
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT config_json, latest_run_id, champion_run_id
                FROM mule_model_workbench_config
                WHERE pipeline_id = ?
                """,
                [int(pipeline_id)],
            ).fetchone()
        default = self.default_config(int(pipeline_id))
        if not row:
            return {"pipeline_id": int(pipeline_id), "config": default, "latest_run_id": None, "champion_run_id": None}
        return {
            "pipeline_id": int(pipeline_id),
            "config": _deep_merge(default, _loads(row[0], {})),
            "latest_run_id": _safe_int(row[1], 0) or None,
            "champion_run_id": _safe_int(row[2], 0) or None,
        }

    def save_config(self, tenant_id: str, pipeline_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
        current = self.load_config(int(pipeline_id))
        config = _deep_merge(current["config"], patch or {})
        config["current_tab"] = _txt(config.get("current_tab") or current["config"].get("current_tab") or "validation")
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_model_workbench_config (
                  pipeline_id, config_json, latest_run_id, champion_run_id, created_at, updated_at
                ) VALUES (
                  ?,
                  ?,
                  COALESCE((SELECT latest_run_id FROM mule_model_workbench_config WHERE pipeline_id = ?), NULL),
                  COALESCE((SELECT champion_run_id FROM mule_model_workbench_config WHERE pipeline_id = ?), NULL),
                  COALESCE((SELECT created_at FROM mule_model_workbench_config WHERE pipeline_id = ?), CURRENT_TIMESTAMP),
                  CURRENT_TIMESTAMP
                )
                """,
                [int(pipeline_id), json.dumps(config, default=_json_default), int(pipeline_id), int(pipeline_id), int(pipeline_id)],
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_model_build_config (
                  pipeline_id, training_config_json, approved_features_json, blocked_features_json, status, metrics_json, created_at, updated_at
                ) VALUES (
                  ?,
                  ?,
                  COALESCE((SELECT approved_features_json FROM mule_model_build_config WHERE pipeline_id = ?), '[]'),
                  COALESCE((SELECT blocked_features_json FROM mule_model_build_config WHERE pipeline_id = ?), '[]'),
                  COALESCE((SELECT status FROM mule_model_build_config WHERE pipeline_id = ?), 'draft'),
                  COALESCE((SELECT metrics_json FROM mule_model_build_config WHERE pipeline_id = ?), '{}'),
                  COALESCE((SELECT created_at FROM mule_model_build_config WHERE pipeline_id = ?), CURRENT_TIMESTAMP),
                  CURRENT_TIMESTAMP
                )
                """,
                [int(pipeline_id), json.dumps(config, default=_json_default), int(pipeline_id), int(pipeline_id), int(pipeline_id), int(pipeline_id), int(pipeline_id)],
            )
            self.workspace.ensure_run(int(pipeline_id), user_id=_txt(tenant_id) or "system", status="in_progress", current_stage="model_build", current_substage="validation", conn=conn)
            self.workspace.set_stage_state(
                int(pipeline_id),
                "model_build",
                "in_progress",
                substage=config["current_tab"] if config["current_tab"] in WORKBENCH_TABS else "validation",
                summary={"workspace_stage": config["current_tab"], "selected_algorithms": config.get("supervised", {}).get("selected_algorithms", [])},
                conn=conn,
            )
        return self.load_config(int(pipeline_id))

    def promote_champion(self, pipeline_id: int, run_id: int) -> Dict[str, Any]:
        current = self.load_config(int(pipeline_id))
        with get_connection(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_model_workbench_config (
                  pipeline_id, config_json, latest_run_id, champion_run_id, created_at, updated_at
                ) VALUES (
                  ?,
                  ?,
                  COALESCE((SELECT latest_run_id FROM mule_model_workbench_config WHERE pipeline_id = ?), NULL),
                  ?,
                  COALESCE((SELECT created_at FROM mule_model_workbench_config WHERE pipeline_id = ?), CURRENT_TIMESTAMP),
                  CURRENT_TIMESTAMP
                )
                """,
                [int(pipeline_id), json.dumps(current["config"], default=_json_default), int(pipeline_id), int(run_id), int(pipeline_id)],
            )
        return self.load_config(int(pipeline_id))

    def _source_rows(self, tenant_id: str, env_id: str, pipeline_id: int) -> List[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT dataset_id, dataset_type, filename, file_path, row_count, columns_json, column_types_json
                FROM mlops_dataset_registry
                WHERE tenant_id = ? AND env_id = ? AND pipeline_type = 'mule' AND pipeline_id = ?
                ORDER BY updated_at DESC, dataset_id DESC
                """,
                [tenant_id, env_id, int(pipeline_id)],
            ).fetchall()
        return [
            {
                "dataset_id": int(row[0]),
                "dataset_type": _low(row[1]),
                "filename": _txt(row[2]),
                "file_path": _txt(row[3]),
                "row_count": _safe_int(row[4], 0),
                "columns": _loads(row[5], []),
                "column_types": _loads(row[6], {}),
            }
            for row in rows
        ]

    def load_dataset(self, tenant_id: str, env_id: str, pipeline_id: int) -> Tuple[Optional[Dict[str, Any]], pd.DataFrame]:
        preferred = ["preprocess_dataset", "preprocessed_dataset", "feature_store", "master_dataset"]
        for dataset_type in preferred:
            row = next((item for item in self._source_rows(tenant_id, env_id, pipeline_id) if item["dataset_type"] == dataset_type), None)
            if not row:
                continue
            path = resolve_data_file_path(Path(row["file_path"]), env_root=self._env_root())
            if not path.exists():
                continue
            try:
                frame = _load_frame(path)
            except Exception:
                continue
            if not frame.empty:
                return row, frame
        return None, pd.DataFrame()

    def load_auxiliary_dataset(self, tenant_id: str, env_id: str, pipeline_id: int, dataset_types: Iterable[str]) -> pd.DataFrame:
        wanted = {str(item).strip().lower() for item in dataset_types if str(item).strip()}
        for row in self._source_rows(tenant_id, env_id, pipeline_id):
            if row["dataset_type"] not in wanted:
                continue
            path = resolve_data_file_path(Path(row["file_path"]), env_root=self._env_root())
            if not path.exists():
                continue
            try:
                frame = _load_frame(path)
            except Exception:
                continue
            if not frame.empty:
                return frame
        return pd.DataFrame()

    def augment_with_labels(self, tenant_id: str, env_id: str, pipeline_id: int, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty:
            return frame
        df = frame.copy()
        account_col = _first_present(df.columns, ["account_id", "ACCOUNT_ID"])
        if account_col:
            df[account_col] = df[account_col].astype(str)
        if "mule_flag" not in df.columns:
            labels = self.load_auxiliary_dataset(tenant_id, env_id, pipeline_id, ["mule_labels"])
            label_key = _first_present(labels.columns, ["account_id", "ACCOUNT_ID"]) if not labels.empty else None
            if label_key and account_col:
                keep = [label_key] + [col for col in ["mule_flag"] if col in labels.columns]
                df = df.merge(labels[keep].rename(columns={label_key: account_col}), on=account_col, how="left")
        if "mule_typology" not in df.columns and "label" not in df.columns:
            typology = self.load_auxiliary_dataset(tenant_id, env_id, pipeline_id, ["mule_typology"])
            typology_key = _first_present(typology.columns, ["account_id", "ACCOUNT_ID"]) if not typology.empty else None
            if typology_key and account_col:
                keep = [typology_key] + [col for col in ["mule_typology"] if col in typology.columns]
                df = df.merge(typology[keep].rename(columns={typology_key: account_col}), on=account_col, how="left")
        if "mule_flag" in df.columns:
            df["mule_flag"] = pd.to_numeric(df["mule_flag"], errors="coerce").fillna(0).astype(int)
        return df

    def resolve_target(self, frame: pd.DataFrame, config: Dict[str, Any]) -> Dict[str, Any]:
        target_config = config.get("target") or {}
        requested = _low(target_config.get("source") or "auto")
        candidates = []
        for column, description in TARGET_CANDIDATES:
            if column in frame.columns:
                non_null = int(frame[column].fillna("").astype(str).str.strip().ne("").sum())
                candidates.append({"column": column, "description": description, "available_rows": non_null})
        selected = None
        if requested and requested != "auto":
            selected = next((item for item in candidates if _low(item["column"]) == requested), None)
        if selected is None:
            selected = candidates[0] if candidates else None
        target_series = pd.Series([_txt(target_config.get("non_mule_class") or "non_mule")] * len(frame), index=frame.index, dtype="object")
        resolved_source = None
        notes = []
        if selected is not None:
            resolved_source = selected["column"]
            base = frame[resolved_source].fillna("").astype(str).str.strip().replace({"": np.nan, "nan": np.nan})
            if "mule_flag" in frame.columns:
                non_mule_mask = pd.to_numeric(frame["mule_flag"], errors="coerce").fillna(0).astype(int) <= 0
                base = base.mask(non_mule_mask, np.nan)
            target_series = base.fillna(_txt(target_config.get("non_mule_class") or "non_mule")).astype(str)
        else:
            notes.append("No multiclass label column was found; training is blocked until mule_typology, label, or mule_category is available.")
        class_names = sorted(target_series.dropna().astype(str).unique().tolist())
        return {
            "requested_source": requested or "auto",
            "resolved_source": resolved_source,
            "derived_name": _txt(target_config.get("derived_name") or "mule_multiclass_target"),
            "non_mule_class": _txt(target_config.get("non_mule_class") or "non_mule"),
            "series": target_series.astype(str),
            "classes": class_names,
            "candidate_columns": candidates,
            "notes": notes,
            "ready": resolved_source is not None and len(class_names) >= 2,
        }

    def determine_time_column(self, frame: pd.DataFrame, config: Dict[str, Any]) -> Optional[str]:
        explicit = _txt(config.get("validation", {}).get("time_column") or "")
        if explicit and explicit != "auto" and explicit in frame.columns:
            return explicit
        return _first_present(frame.columns, ["event_ts", "transaction_timestamp", "last_activity_date", "EVENT_TS", "TXN_TS"])

    def compute_splits(self, frame: pd.DataFrame, target: pd.Series, config: Dict[str, Any]) -> Dict[str, Any]:
        validation = config.get("validation") or {}
        split_strategy = _low(validation.get("split_strategy") or "time_based")
        work = frame.copy()
        work["__target__"] = target.values
        time_col = self.determine_time_column(work, config)
        if split_strategy == "time_based" and time_col and time_col in work.columns:
            ts = pd.to_datetime(work[time_col], errors="coerce")
            if ts.notna().sum() >= max(25, int(len(work) * 0.3)):
                work = work.assign(__time__=ts).sort_values("__time__").reset_index(drop=False).rename(columns={"index": "__orig_index__"})
                n_rows = len(work)
                train_cut = max(1, int(round(n_rows * _safe_float(validation.get("train_pct"), 0.70))))
                valid_cut = max(train_cut + 1, int(round(n_rows * (_safe_float(validation.get("train_pct"), 0.70) + _safe_float(validation.get("validation_pct"), 0.15)))))
                valid_cut = min(valid_cut, n_rows - 1)
                return {
                    "strategy": "time_based",
                    "time_column": time_col,
                    "train_idx": work.loc[:train_cut - 1, "__orig_index__"].tolist(),
                    "validation_idx": work.loc[train_cut:valid_cut - 1, "__orig_index__"].tolist(),
                    "test_idx": work.loc[valid_cut:, "__orig_index__"].tolist(),
                    "boundaries": {
                        "train_end": work.loc[train_cut - 1, "__time__"].isoformat() if train_cut > 0 and pd.notna(work.loc[train_cut - 1, "__time__"]) else None,
                        "validation_end": work.loc[valid_cut - 1, "__time__"].isoformat() if valid_cut > 0 and pd.notna(work.loc[valid_cut - 1, "__time__"]) else None,
                    },
                }
        from sklearn.model_selection import train_test_split

        validation_pct = _safe_float(validation.get("validation_pct"), 0.15)
        test_pct = _safe_float(validation.get("test_pct"), 0.15)
        holdout_pct = max(validation_pct + test_pct, 0.20)
        train_idx, holdout_idx = train_test_split(frame.index.tolist(), test_size=holdout_pct, random_state=42, stratify=target if target.nunique() > 1 else None)
        holdout_target = target.loc[holdout_idx]
        relative_test = test_pct / max(validation_pct + test_pct, 1e-6)
        validation_idx, test_idx = train_test_split(holdout_idx, test_size=relative_test, random_state=42, stratify=holdout_target if holdout_target.nunique() > 1 else None)
        return {"strategy": "stratified_random", "time_column": time_col, "train_idx": list(train_idx), "validation_idx": list(validation_idx), "test_idx": list(test_idx), "boundaries": {}}

    def summarize_split(self, target: pd.Series, split_payload: Dict[str, Any]) -> Dict[str, Any]:
        summary = {"strategy": split_payload.get("strategy"), "time_column": split_payload.get("time_column"), "boundaries": split_payload.get("boundaries") or {}, "splits": []}
        for name, key in [("Train", "train_idx"), ("Validation", "validation_idx"), ("Test", "test_idx")]:
            idx = split_payload.get(key) or []
            part_target = target.loc[idx] if len(idx) else pd.Series(dtype="object")
            distribution = part_target.value_counts(dropna=False).reset_index()
            distribution.columns = ["class_name", "count"]
            total = max(int(len(part_target)), 1)
            summary["splits"].append(
                {
                    "name": name,
                    "row_count": int(len(idx)),
                    "class_distribution": [{"class_name": str(row.class_name), "count": int(row.count), "pct": round(float(row.count / total * 100.0), 2)} for row in distribution.itertuples(index=False)],
                }
            )
        return summary

    def feature_inventory(self, frame: pd.DataFrame, target_info: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
        selected = set(config.get("selected_features") or [])
        blocked, candidates = [], []
        for column in frame.columns:
            if column == target_info.get("resolved_source"):
                blocked.append({"column": column, "reason": "Target column"})
                continue
            if _column_is_id(column):
                blocked.append({"column": column, "reason": "Identifier"})
                continue
            if _column_is_leakage(column):
                blocked.append({"column": column, "reason": "Leakage / output column"})
                continue
            if _column_is_timestamp(column):
                blocked.append({"column": column, "reason": "Raw timestamp column"})
                continue
            candidates.append(column)
        selected_features = [column for column in candidates if not selected or column in selected] or list(candidates)
        family_summary: Dict[str, int] = {}
        for column in selected_features:
            family_summary[_feature_family(column)] = family_summary.get(_feature_family(column), 0) + 1
        return {
            "candidate_features": candidates,
            "selected_features": selected_features,
            "blocked_columns": blocked,
            "family_summary": [{"family": key, "feature_count": value} for key, value in sorted(family_summary.items())],
        }

    def build_preprocessor(self, frame: pd.DataFrame, feature_columns: List[str]) -> Tuple[ColumnTransformer, List[str], List[str]]:
        numeric_cols, categorical_cols = [], []
        for column in feature_columns:
            if pd.api.types.is_numeric_dtype(frame[column]):
                numeric_cols.append(column)
            else:
                categorical_cols.append(column)
        try:
            cat_encoder = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
        except TypeError:  # pragma: no cover
            cat_encoder = OneHotEncoder(handle_unknown="ignore", sparse=False)
        preprocessor = ColumnTransformer(
            transformers=[
                ("num", SimpleImputer(strategy="median"), numeric_cols),
                ("cat", Pipeline([("imputer", SimpleImputer(strategy="most_frequent")), ("encoder", cat_encoder)]), categorical_cols),
            ],
            remainder="drop",
        )
        return preprocessor, numeric_cols, categorical_cols

    def next_run_id(self) -> int:
        with get_connection(self.db_path) as conn:
            row = conn.execute("SELECT COALESCE(MAX(run_id), 0) + 1 FROM mule_model_workbench_runs").fetchone()
        return int(row[0] or 1)

    def latest_job(self, pipeline_id: int) -> Optional[Dict[str, Any]]:
        workspace = self.workspace.get_workspace_snapshot(int(pipeline_id))
        job = workspace.get("latest_job") if isinstance(workspace, dict) else None
        if job and _low(job.get("stage_name")) == "model_build":
            return job
        return None

    def save_run(self, tenant_id: str, pipeline_id: int, payload: Dict[str, Any], *, conn=None) -> Dict[str, Any]:
        with self._conn_ctx(conn) as db:
            run_id = _safe_int(payload.get("run_id"), 0) or self.next_run_id()
            db.execute(
                """
                INSERT OR REPLACE INTO mule_model_workbench_runs (
                  run_id, pipeline_id, status, target_json, split_json, supervised_json, sequence_json,
                  graph_json, tuning_json, evaluation_json, explainability_json, policy_json, summary_json,
                  artifacts_json, logs_json, created_at, updated_at
                ) VALUES (
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  COALESCE((SELECT created_at FROM mule_model_workbench_runs WHERE run_id = ?), CURRENT_TIMESTAMP),
                  CURRENT_TIMESTAMP
                )
                """,
                [
                    int(run_id),
                    int(pipeline_id),
                    _txt(payload.get("status") or "completed"),
                    json.dumps(payload.get("target") or {}, default=_json_default),
                    json.dumps(payload.get("split") or {}, default=_json_default),
                    json.dumps(payload.get("supervised") or {}, default=_json_default),
                    json.dumps(payload.get("sequence") or {}, default=_json_default),
                    json.dumps(payload.get("graph") or {}, default=_json_default),
                    json.dumps(payload.get("tuning") or {}, default=_json_default),
                    json.dumps(payload.get("evaluation") or {}, default=_json_default),
                    json.dumps(payload.get("explainability") or {}, default=_json_default),
                    json.dumps(payload.get("policy") or {}, default=_json_default),
                    json.dumps(payload.get("summary") or {}, default=_json_default),
                    json.dumps(payload.get("artifacts") or {}, default=_json_default),
                    json.dumps(payload.get("logs") or [], default=_json_default),
                    int(run_id),
                ],
            )
            current = self.load_config(int(pipeline_id))
            db.execute(
                """
                INSERT OR REPLACE INTO mule_model_workbench_config (
                  pipeline_id, config_json, latest_run_id, champion_run_id, created_at, updated_at
                ) VALUES (
                  ?, ?, ?, COALESCE((SELECT champion_run_id FROM mule_model_workbench_config WHERE pipeline_id = ?), ?),
                  COALESCE((SELECT created_at FROM mule_model_workbench_config WHERE pipeline_id = ?), CURRENT_TIMESTAMP),
                  CURRENT_TIMESTAMP
                )
                """,
                [int(pipeline_id), json.dumps(current["config"], default=_json_default), int(run_id), int(pipeline_id), int(run_id), int(pipeline_id)],
            )
            self.workspace.ensure_run(int(pipeline_id), user_id=_txt(tenant_id) or "system", status="in_progress", current_stage="model_build", current_substage="summary", conn=db)
            self.workspace.set_stage_state(
                int(pipeline_id),
                "model_build",
                "completed",
                substage="summary",
                summary={"latest_run_id": int(run_id), "champion_model": _txt((payload.get("supervised") or {}).get("champion_model")), "macro_f1": _safe_float((payload.get("evaluation") or {}).get("macro_f1"))},
                conn=db,
            )
        return self.get_run(int(pipeline_id), run_id=run_id)

    def get_run(self, pipeline_id: int, run_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            if run_id is not None:
                row = conn.execute(
                    """
                    SELECT run_id, status, target_json, split_json, supervised_json, sequence_json, graph_json,
                           tuning_json, evaluation_json, explainability_json, policy_json, summary_json, artifacts_json,
                           logs_json, created_at, updated_at
                    FROM mule_model_workbench_runs
                    WHERE pipeline_id = ? AND run_id = ?
                    """,
                    [int(pipeline_id), int(run_id)],
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT run_id, status, target_json, split_json, supervised_json, sequence_json, graph_json,
                           tuning_json, evaluation_json, explainability_json, policy_json, summary_json, artifacts_json,
                           logs_json, created_at, updated_at
                    FROM mule_model_workbench_runs
                    WHERE pipeline_id = ?
                    ORDER BY updated_at DESC, run_id DESC
                    LIMIT 1
                    """,
                    [int(pipeline_id)],
                ).fetchone()
        if not row:
            return None
        return {
            "run_id": int(row[0]),
            "status": _txt(row[1]) or "completed",
            "target": _loads(row[2], {}),
            "split": _loads(row[3], {}),
            "supervised": _loads(row[4], {}),
            "sequence": _loads(row[5], {}),
            "graph": _loads(row[6], {}),
            "tuning": _loads(row[7], {}),
            "evaluation": _loads(row[8], {}),
            "explainability": _loads(row[9], {}),
            "policy": _loads(row[10], {}),
            "summary": _loads(row[11], {}),
            "artifacts": _loads(row[12], {}),
            "logs": _loads(row[13], []),
            "created_at": row[14].isoformat() if hasattr(row[14], "isoformat") else row[14],
            "updated_at": row[15].isoformat() if hasattr(row[15], "isoformat") else row[15],
        }

    def list_runs(self, pipeline_id: int, limit: int = 10) -> List[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT run_id, status, summary_json, evaluation_json, created_at
                FROM mule_model_workbench_runs
                WHERE pipeline_id = ?
                ORDER BY updated_at DESC, run_id DESC
                LIMIT ?
                """,
                [int(pipeline_id), int(limit)],
            ).fetchall()
        champion_id = self.load_config(int(pipeline_id)).get("champion_run_id")
        return [
            {
                "run_id": int(row[0]),
                "status": _txt(row[1]),
                "summary": _loads(row[2], {}),
                "evaluation": _loads(row[3], {}),
                "created_at": row[4].isoformat() if hasattr(row[4], "isoformat") else row[4],
                "is_champion": int(row[0]) == champion_id,
            }
            for row in rows
        ]

    def persist_legacy_model_run(self, tenant_id: str, env_id: str, pipeline_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        artifacts = payload.get("artifacts") or {}
        evaluation = payload.get("evaluation") or {}
        supervised = payload.get("supervised") or {}
        summary = payload.get("summary") or {}
        output_path = _txt(artifacts.get("scored_output_path"))
        model_path = _txt(artifacts.get("model_bundle_path"))
        output_table_name = _txt(artifacts.get("output_table_name") or f"mule_model_output_{int(pipeline_id)}")
        risk_bands = (payload.get("policy") or {}).get("priority_bands") or {"high": 0.70, "medium": 0.50}
        with get_connection(self.db_path) as conn:
            run_id = int(payload["run_id"])
            conn.execute(
                """
                INSERT OR REPLACE INTO mule_model_build_runs (
                  run_id, pipeline_id, model_path, output_path, output_table_name, approved_features_json,
                  metrics_json, feature_importance_json, risk_bands_json, typology_enabled, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [
                    int(run_id),
                    int(pipeline_id),
                    model_path,
                    output_path,
                    output_table_name,
                    json.dumps(supervised.get("selected_features") or [], default=_json_default),
                    json.dumps({"macro_f1": evaluation.get("macro_f1"), "weighted_f1": evaluation.get("weighted_f1"), "top_2_accuracy": evaluation.get("top_2_accuracy"), "top_3_accuracy": evaluation.get("top_3_accuracy"), "champion_model": supervised.get("champion_model"), "target_column": summary.get("target_column"), "class_count": len((payload.get("target") or {}).get("classes") or [])}, default=_json_default),
                    json.dumps((payload.get("explainability") or {}).get("global_importance") or [], default=_json_default),
                    json.dumps(risk_bands, default=_json_default),
                    True,
                ],
            )
            if output_path:
                path = Path(output_path)
                scored = _load_frame(path) if path.exists() else pd.DataFrame()
                dataset_id = int(conn.execute("SELECT COALESCE(MAX(dataset_id), 0) + 1 FROM mlops_dataset_registry").fetchone()[0] or 1)
                conn.execute(
                    """
                    INSERT INTO mlops_dataset_registry (
                      dataset_id, tenant_id, env_id, pipeline_id, pipeline_type, dataset_type, filename,
                      file_path, row_count, columns_json, column_types_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [dataset_id, tenant_id, env_id, int(pipeline_id), "mule", "model_output", path.name, str(path), int(scored.shape[0]), json.dumps(list(scored.columns), default=_json_default), json.dumps({col: str(dtype) for col, dtype in scored.dtypes.items()}, default=_json_default)],
                )
                self.workspace.register_artifact(int(pipeline_id), "model_build", "model_output_csv", str(path), metadata={"run_id": int(run_id), "row_count": int(scored.shape[0]), "column_count": int(scored.shape[1]), "target_column": summary.get("target_column")}, conn=conn)
                if model_path:
                    self.workspace.register_artifact(int(pipeline_id), "model_build", "model_bundle_joblib", model_path, metadata={"run_id": int(run_id), "champion_model": supervised.get("champion_model")}, conn=conn)
                self.workspace.update_run(int(pipeline_id), status="in_progress", current_stage="model_output_validation", current_substage="validate", conn=conn)
        return self.get_run(int(pipeline_id), run_id=int(payload["run_id"])) or {}
