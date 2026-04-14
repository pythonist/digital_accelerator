from __future__ import annotations

import importlib.util
import json
import re
import sys
from contextlib import nullcontext
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.mule_workspace_service import MuleWorkspaceService
from api.tools.mlops.path_utils import resolve_data_file_path, resolve_mlops_data_dir

try:
    import networkx as nx
except Exception:  # pragma: no cover
    nx = None


ACCOUNT_ID = "ACCOUNT_ID"
CUSTOMER_ID = "CUSTOMER_ID"
SCHEMA_VERSION = "mule_feature_store_v1"

MODULE_ORDER = [
    "account_features",
    "customer_identity",
    "upi_digital_transfer",
    "atm_cash",
    "branch_deposits",
    "merchant_gateway",
    "counterparty_exposure",
    "cross_channel",
    "graph_network",
]

MODULE_META = {
    "account_features": {
        "label": "Account Features",
        "summary": "Base account behaviour, pass-through movement, and account lifecycle indicators.",
        "source_tables": ["accounts", "transactions", "account_daily_summary"],
        "groups": {"account", "base"},
        "feature_type": "calculated",
    },
    "customer_identity": {
        "label": "Customer / Identity Features",
        "summary": "Identity, KYC, contact, and customer linkage features that help explain mule ownership patterns.",
        "source_tables": ["customers", "accounts", "device_logs"],
        "groups": {"identity"},
        "feature_type": "identity",
    },
    "upi_digital_transfer": {
        "label": "UPI / Digital Transfer Features",
        "summary": "Digital payment velocity, counterparty, and pass-through patterns across UPI and related transfer rails.",
        "source_tables": ["transactions", "device_logs", "counterparties"],
        "groups": {"upi", "device"},
        "feature_type": "calculated",
    },
    "atm_cash": {
        "label": "ATM / Cash Features",
        "summary": "Cash movement, terminal reuse, and ATM-linked anomalies.",
        "source_tables": ["transactions", "account_daily_summary"],
        "groups": {"atm"},
        "feature_type": "calculated",
    },
    "branch_deposits": {
        "label": "Branch Deposit Features",
        "summary": "Structured cash deposits, same-day patterns, and deposit-to-transfer behaviour.",
        "source_tables": ["transactions", "account_daily_summary"],
        "groups": {"branch"},
        "feature_type": "calculated",
    },
    "merchant_gateway": {
        "label": "Merchant / Gateway Features",
        "summary": "Merchant acquiring, settlement, and gateway-linked activity for mule category M5 and hybrid cases.",
        "source_tables": ["transactions", "customers"],
        "groups": {"merchant", "cross_border"},
        "feature_type": "merchant",
    },
    "counterparty_exposure": {
        "label": "Counterparty Exposure Features",
        "summary": "Incoming and outgoing counterparty concentration, beneficiary recency, and risk transfer patterns.",
        "source_tables": ["transactions", "counterparties", "external_signals"],
        "groups": {"counterparty"},
        "feature_type": "identity",
    },
    "cross_channel": {
        "label": "Cross-channel Features",
        "summary": "Signals that link activity across transaction, session, and digital access channels.",
        "source_tables": ["transactions", "device_logs"],
        "groups": {"cross_channel"},
        "feature_type": "cross-channel",
    },
    "graph_network": {
        "label": "Graph / Network Features",
        "summary": "Network/ring structure, shared-device relationships, and propagated risk across linked entities.",
        "source_tables": ["graph_nodes", "graph_edges", "device_logs", "transactions"],
        "groups": {"graph", "network", "mule_ring"},
        "feature_type": "graph",
    },
}

FEATURE_GROUP_TO_MODULE = {
    group: module_key
    for module_key, module in MODULE_META.items()
    for group in module["groups"]
}


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


def _table_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or fallback


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


def _safe_json_rows(frame: pd.DataFrame, limit: int = 20) -> List[Dict[str, Any]]:
    preview = frame.head(limit).copy()
    for column in preview.columns:
        preview[column] = preview[column].map(_safe_value)
    return preview.to_dict(orient="records")


def _parse_categories(raw: Any) -> List[str]:
    text = _txt(raw).upper()
    if not text:
        return []
    categories: List[str] = []
    for token in re.split(r"[,/|]+", text):
        item = _txt(token).upper()
        if not item:
            continue
        match = re.fullmatch(r"M(\d+)\s*-\s*M?(\d+)", item)
        if match:
            start, end = int(match.group(1)), int(match.group(2))
            for number in range(min(start, end), max(start, end) + 1):
                categories.append(f"M{number}")
            continue
        if re.fullmatch(r"M\d+", item):
            categories.append(item)
    seen: List[str] = []
    for category in categories:
        if category not in seen:
            seen.append(category)
    return seen


def _coverage_pct(series: pd.Series) -> float:
    if series is None or len(series.index) == 0:
        return 0.0
    return round(float(series.notna().mean() * 100.0), 2)


def _infer_formula_preview(feature_name: str, feature_group: str, script_part: str) -> str:
    name = _low(feature_name)
    if name == "pass_through_ratio":
        return "total_debit_amount / max(total_credit_amount, 1)"
    if name == "round_amount_ratio":
        return "round_amount_transaction_count / max(total_transaction_count, 1)"
    if name == "cash_ratio":
        return "cash_transaction_count / max(total_transaction_count, 1)"
    if name == "night_ratio":
        return "night_transaction_count / max(total_transaction_count, 1)"
    if name == "credit_debit_ratio":
        return "total_credit_amount / max(total_debit_amount, 1)"
    if name == "cross_channel_pass_through_ratio":
        return "max(channel_amount) / max(total_amount_across_channels, 1)"
    if name == "cross_channel_velocity_score":
        return "z-score(transaction_count_in_last_24h)"
    if name == "graph_ring_network_score":
        return "z-score(linked_edge_count_for_account)"
    if name == "graph_layering_pattern_score":
        return "z-score(sequenced_graph_chain_count)"
    if name == "mule_network_risk_score":
        return "z-score(mule_ring_cluster_size)"
    if "ratio" in name:
        return "ratio of two account-level aggregates within the same module"
    if "count" in name:
        return "count of qualifying events grouped at account level"
    if "amount" in name:
        return "sum of qualifying transaction amounts grouped at account level"
    if "avg" in name or "mean" in name:
        return "average value of qualifying events grouped at account level"
    if "max" in name:
        return "maximum value observed for the qualifying account events"
    if "min" in name:
        return "minimum value observed for the qualifying account events"
    if "std" in name:
        return "standard deviation across qualifying account events"
    if "entropy" in name:
        return "entropy of the account-level distribution for the referenced behaviour"
    if "concentration" in name or "hhi" in name:
        return "concentration score across counterparties, channels, or linked entities"
    if "score" in name:
        return "normalized behavioural or risk score derived from grouped activity"
    if name.endswith("_flag") or "_flag_" in name:
        return "binary indicator triggered when the configured mule-risk rule is met"
    return f"engineered account-level feature derived in the {feature_group} module from {script_part}"


def _infer_source_columns(feature_name: str, feature_group: str) -> List[str]:
    name = _low(feature_name)
    exact = {
        "txn_count": ["transaction_id", "account_id"],
        "txn_avg_amount": ["transaction_amount"],
        "txn_max_amount": ["transaction_amount"],
        "txn_std_amount": ["transaction_amount"],
        "pass_through_ratio": ["transaction_amount", "transaction_type"],
        "round_amount_ratio": ["transaction_amount", "round_amount_flag"],
        "rapid_outflow_count": ["rapid_outflow_flag", "transaction_timestamp"],
        "credit_debit_ratio": ["transaction_amount", "transaction_type"],
        "cash_ratio": ["cash_flag", "transaction_channel"],
        "cash_txn_count": ["cash_flag", "transaction_id"],
        "signal_count": ["signal_id", "signal_type"],
        "signal_risk_max": ["risk_level"],
        "complaint_total": ["complaint_count"],
        "device_count": ["device_id"],
        "vpn_ratio": ["vpn_usage_flag"],
        "tor_ratio": ["tor_network_flag"],
        "automation_ratio": ["automation_flag"],
        "avg_ip_risk": ["ip_risk_score"],
        "foreign_ip_flag": ["ip_country"],
        "hi_risk_cp_count": ["counterparty_account_id", "high_risk_flag"],
        "hi_risk_cp_amount": ["transaction_amount", "counterparty_account_id"],
        "cp_hhi": ["counterparty_account_id", "transaction_amount"],
        "cross_channel_login_count_24h": ["event_ts", "channel"],
        "cross_channel_transaction_count_24h": ["txn_ts", "channel"],
        "cross_channel_transaction_amount_24h": ["txn_ts", "txn_amount", "channel"],
        "cross_channel_pass_through_ratio": ["channel", "txn_amount"],
        "cross_channel_velocity_score": ["txn_ts", "txn_amount"],
        "graph_ring_network_score": ["linked_account_id", "edge_type", "edge_ts"],
        "graph_layering_pattern_score": ["edge_ts", "linked_account_id"],
        "graph_structuring_pattern_score": ["amount", "linked_account_id"],
        "network_neighbor_mule_ratio": ["linked_account_id", "is_suspicious"],
        "network_propagation_risk_score": ["linked_account_id", "risk_score"],
        "mule_ring_cluster_size": ["cluster_id", "cluster_size"],
        "mule_ring_shared_device_count": ["edge_type", "linked_account_id"],
        "mule_ring_shared_ip_count": ["ip_address", "event_ts"],
    }
    if name in exact:
        return exact[name]
    inferred: List[str] = []
    if any(token in name for token in ["txn", "amount", "velocity", "counterparty", "beneficiary", "cash", "merchant", "gateway"]):
        inferred.extend(["transaction_amount", "transaction_timestamp"])
    if "channel" in name:
        inferred.append("channel")
    if "device" in name:
        inferred.append("device_id")
    if "ip" in name:
        inferred.append("ip_address")
    if any(token in name for token in ["customer", "identity", "kyc", "pep", "sanction", "adverse"]):
        inferred.extend(["customer_id", "customer_risk_rating", "customer_kyc_status"])
    if any(token in name for token in ["graph", "network", "ring", "cluster", "community", "hop", "neighbor", "pagerank", "centrality"]):
        inferred.extend(["linked_account_id", "edge_type", "edge_ts"])
    if "balance" in name or "account" in name:
        inferred.extend(["account_balance_current", "account_open_date"])
    if not inferred:
        module_meta = MODULE_META.get(FEATURE_GROUP_TO_MODULE.get(feature_group, "cross_channel"), MODULE_META["cross_channel"])
        for table in module_meta["source_tables"]:
            inferred.append(f"{table}.derived_column")
    seen: List[str] = []
    for column in inferred:
        text = _txt(column)
        if text and text not in seen:
            seen.append(text)
    return seen[:6]


def _infer_logic_summary(feature_name: str, feature_group: str, script_part: str) -> str:
    name = _low(feature_name)
    if name == "pass_through_ratio":
        return "Adds all debit amounts for the account and divides by total credited value to highlight fast pass-through movement."
    if name == "round_amount_ratio":
        return "Counts round-value transactions and divides by total transactions to surface structuring-like payment patterns."
    if name == "credit_debit_ratio":
        return "Compares incoming value with outgoing value to show whether funds are mainly being received, retained, or rapidly moved out."
    if name == "cross_channel_pass_through_ratio":
        return "Finds the channel carrying the highest amount and divides it by total cross-channel amount to expose concentration in one transfer rail."
    if name == "cross_channel_velocity_score":
        return "Measures last-24-hour activity intensity and standardizes it into a relative velocity score across accounts."
    if name == "network_neighbor_mule_ratio":
        return "Counts suspicious linked neighbors and divides by all linked neighbors to quantify propagated mule exposure."
    if name == "network_two_hop_mule_exposure":
        return "Counts distinct entities reachable within two hops from the account to estimate near-network exposure."
    if name == "network_three_hop_mule_exposure":
        return "Counts distinct entities reachable within three hops from the account to estimate broader network spread."
    if name == "mule_ring_cluster_size":
        return "Takes the largest linked ring or community size attached to the account as a proxy for organized mule participation."
    if name == "mule_ring_shared_device_count":
        return "Counts linked accounts that share a device relationship with the account."
    if "ratio" in name:
        return f"Builds two account-level aggregates inside the {feature_group} module and divides one by the other with safe zero protection."
    if "count" in name:
        return f"Counts qualifying records for the account after filtering the relevant {feature_group} events."
    if "amount" in name:
        return f"Sums qualifying transaction amounts for the account inside the {feature_group} module."
    if "score" in name:
        return f"Combines grouped behaviour in the {feature_group} module into a normalized score for downstream modelling."
    if "flag" in name:
        return f"Turns the underlying mule-risk condition in the {feature_group} module into a yes/no indicator."
    return f"Transforms raw {feature_group} activity from {script_part} into an account-level modelling feature."


def _load_frame(file_path: Path) -> pd.DataFrame:
    suffix = file_path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(file_path)
    if suffix == ".json":
        return pd.read_json(file_path)
    return pd.read_csv(file_path)


def _ensure_columns(frame: pd.DataFrame, defaults: Dict[str, Any]) -> pd.DataFrame:
    ensured = frame.copy()
    for column, default in defaults.items():
        if column not in ensured.columns:
            ensured[column] = default
    return ensured


def _rename_if_present(frame: pd.DataFrame, mapping: Dict[str, str]) -> pd.DataFrame:
    available = {source: target for source, target in mapping.items() if source in frame.columns}
    return frame.rename(columns=available)


def _dedupe_columns(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return frame
    return frame.loc[:, ~frame.columns.duplicated()].copy()


def _series(frame: pd.DataFrame, column: str, default: Any = "") -> pd.Series:
    if column in frame.columns:
        value = frame[column]
        if isinstance(value, pd.Series):
            return value
    if isinstance(default, pd.Series):
        return default.reindex(frame.index)
    return pd.Series(default, index=frame.index)


class MuleFeatureStoreService:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.workspace = MuleWorkspaceService(self.db_path)
        try:
            from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
            MLOpsWorkbenchService(self.db_path)
        except Exception:
            pass
        self._ensure_schema()

    def _conn_ctx(self, conn=None):
        return nullcontext(conn) if conn is not None else get_connection(self.db_path)

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
                CREATE TABLE IF NOT EXISTS mule_feature_store_config (
                  pipeline_id INTEGER PRIMARY KEY,
                  master_dataset_id INTEGER,
                  generation_status TEXT DEFAULT 'not_generated',
                  selected_features_json TEXT,
                  feature_catalog_json TEXT,
                  feature_group_counts_json TEXT,
                  module_summary_json TEXT,
                  source_tables_json TEXT,
                  schema_version TEXT,
                  generated_table_name TEXT,
                  feature_store_path TEXT,
                  full_feature_store_path TEXT,
                  catalog_path TEXT,
                  selected_features_count BIGINT DEFAULT 0,
                  total_features BIGINT DEFAULT 0,
                  generation_metadata_json TEXT,
                  generated_at TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_feature_store_runs (
                  run_id BIGINT PRIMARY KEY,
                  pipeline_id INTEGER,
                  master_dataset_id INTEGER,
                  generation_status TEXT,
                  part1_complete BOOLEAN DEFAULT FALSE,
                  part2_complete BOOLEAN DEFAULT FALSE,
                  part3_complete BOOLEAN DEFAULT FALSE,
                  final_merge_complete BOOLEAN DEFAULT FALSE,
                  total_features BIGINT DEFAULT 0,
                  selected_features_count BIGINT DEFAULT 0,
                  generated_table_name TEXT,
                  persisted_location TEXT,
                  source_tables_json TEXT,
                  schema_version TEXT,
                  generation_metadata_json TEXT,
                  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS mule_feature_catalog_entries (
                  pipeline_id INTEGER,
                  feature_name TEXT,
                  feature_group TEXT,
                  module_key TEXT,
                  module_name TEXT,
                  source_module TEXT,
                  source_tables_json TEXT,
                  raw_variables_json TEXT,
                  formula TEXT,
                  business_definition TEXT,
                  data_type TEXT,
                  mule_categories_json TEXT,
                  training_eligible BOOLEAN DEFAULT TRUE,
                  coverage_pct DOUBLE,
                  created_by_script_part TEXT,
                  downstream_step TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    def _env_root(self) -> Path:
        return self.db_path.resolve().parents[2]

    def _data_dir(self, pipeline_id: Optional[int] = None) -> Path:
        base = resolve_mlops_data_dir(self._env_root(), create_if_missing=True) / "mule_feature_store"
        if pipeline_id:
            base = base / f"pipeline_{int(pipeline_id)}"
        base.mkdir(parents=True, exist_ok=True)
        return base

    def _scripts_dir(self) -> Path:
        repo_root = Path(__file__).resolve().parents[4]
        return repo_root / "data_generation_scripts" / "mule_data" / "feature_store_scripts"

    def _resolve_file_path(self, raw_path: str) -> Path:
        return resolve_data_file_path(Path(raw_path), env_root=self._env_root())

    def _load_script_module(self, filename: str):
        scripts_dir = self._scripts_dir()
        path = scripts_dir / filename
        module_name = f"_mule_feature_store_{path.stem}_{abs(hash(str(path)))}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ValueError(f"Could not load feature store script {filename}.")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)
        return module

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

    def _ensure_run_row(self, pipeline_id: int, status: str = "draft") -> None:
        pipeline = self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        with get_connection(self.db_path) as conn:
            exists = conn.execute("SELECT pipeline_id FROM mule_pipeline_runs WHERE pipeline_id = ?", [int(pipeline_id)]).fetchone()
            if exists:
                conn.execute(
                    """
                    UPDATE mule_pipeline_runs
                    SET pipeline_name = ?, pipeline_type = 'mule', status = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE pipeline_id = ?
                    """,
                    [_txt(pipeline.get("name")), status, int(pipeline_id)],
                )
            else:
                conn.execute(
                    "INSERT INTO mule_pipeline_runs (pipeline_id, pipeline_name, pipeline_type, status) VALUES (?, ?, 'mule', ?)",
                    [int(pipeline_id), _txt(pipeline.get("name")), status],
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
            current_stage=_txt(current_stage) or "feature_store",
            current_substage=_txt(current_substage or substage),
            conn=conn,
        )
        self.workspace.set_stage_state(
            int(pipeline_id),
            "feature_store",
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
                current_stage=_txt(current_stage) or "feature_store",
                current_substage=_txt(current_substage or substage),
                conn=conn,
            )

    def _list_sources(self, tenant_id: str, env_id: str, pipeline_id: int) -> List[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT dataset_id, dataset_type, filename, file_path, row_count, columns_json, column_types_json
                FROM mlops_dataset_registry
                WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ? AND pipeline_type = 'mule'
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
                "row_count": int(row[4] or 0),
                "columns": _loads(row[5], []),
                "column_types": _loads(row[6], {}),
            }
            for row in rows
        ]

    def _load_dataset_by_type(self, tenant_id: str, env_id: str, pipeline_id: int, dataset_type: str) -> Tuple[Optional[Dict[str, Any]], pd.DataFrame]:
        rows = [row for row in self._list_sources(tenant_id, env_id, pipeline_id) if row["dataset_type"] == _low(dataset_type)]
        if not rows:
            return None, pd.DataFrame()
        row = rows[0]
        path = self._resolve_file_path(row["file_path"])
        if not path.exists():
            return row, pd.DataFrame()
        try:
            frame = _load_frame(path)
        except Exception:
            frame = pd.DataFrame()
        return row, frame

    def _load_master_dataset(self, tenant_id: str, env_id: str, pipeline_id: int) -> Tuple[Dict[str, Any], pd.DataFrame]:
        row, frame = self._load_dataset_by_type(tenant_id, env_id, pipeline_id, "master_dataset")
        if not row or frame.empty:
            raise ValueError("Build the Mule master dataset before opening Feature Store.")
        return row, frame

    def _default_config(self, pipeline_id: int, master_dataset_id: Optional[int] = None) -> Dict[str, Any]:
        return {
            "pipeline_id": int(pipeline_id),
            "master_dataset_id": int(master_dataset_id or 0) or None,
            "generation_status": "not_generated",
            "selected_features": [],
            "schema_version": SCHEMA_VERSION,
        }

    def load_config(self, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT master_dataset_id, generation_status, selected_features_json, feature_catalog_json,
                       feature_group_counts_json, module_summary_json, source_tables_json, schema_version,
                       generated_table_name, feature_store_path, full_feature_store_path, catalog_path,
                       selected_features_count, total_features, generation_metadata_json, generated_at
                FROM mule_feature_store_config
                WHERE pipeline_id = ?
                """,
                [int(pipeline_id)],
            ).fetchone()
        default = self._default_config(pipeline_id)
        if not row:
            return {
                **default,
                "feature_catalog": [],
                "feature_group_counts": {},
                "module_summaries": [],
                "source_tables": [],
                "generated_table_name": None,
                "feature_store_path": None,
                "full_feature_store_path": None,
                "catalog_path": None,
                "selected_features_count": 0,
                "total_features": 0,
                "generation_metadata": {},
                "generated_at": None,
            }
        return {
            "pipeline_id": int(pipeline_id),
            "master_dataset_id": int(row[0]) if row[0] is not None else None,
            "generation_status": _txt(row[1]) or "not_generated",
            "selected_features": _loads(row[2], []),
            "feature_catalog": _loads(row[3], []),
            "feature_group_counts": _loads(row[4], {}),
            "module_summaries": _loads(row[5], []),
            "source_tables": _loads(row[6], []),
            "schema_version": _txt(row[7]) or SCHEMA_VERSION,
            "generated_table_name": _txt(row[8]) or None,
            "feature_store_path": _txt(row[9]) or None,
            "full_feature_store_path": _txt(row[10]) or None,
            "catalog_path": _txt(row[11]) or None,
            "selected_features_count": int(row[12] or 0),
            "total_features": int(row[13] or 0),
            "generation_metadata": _loads(row[14], {}),
            "generated_at": row[15].isoformat() if hasattr(row[15], "isoformat") else row[15],
        }

    def _upsert_config_record(self, pipeline_id: int, payload: Dict[str, Any], conn=None) -> None:
        with self._conn_ctx(conn) as conn:
            exists = conn.execute("SELECT pipeline_id FROM mule_feature_store_config WHERE pipeline_id = ?", [int(pipeline_id)]).fetchone()
            values = [
                int(pipeline_id),
                int(payload.get("master_dataset_id") or 0) or None,
                _txt(payload.get("generation_status") or "not_generated"),
                json.dumps(payload.get("selected_features") or [], default=str),
                json.dumps(payload.get("feature_catalog") or [], default=str),
                json.dumps(payload.get("feature_group_counts") or {}, default=str),
                json.dumps(payload.get("module_summaries") or [], default=str),
                json.dumps(payload.get("source_tables") or [], default=str),
                _txt(payload.get("schema_version") or SCHEMA_VERSION),
                _txt(payload.get("generated_table_name") or ""),
                _txt(payload.get("feature_store_path") or ""),
                _txt(payload.get("full_feature_store_path") or ""),
                _txt(payload.get("catalog_path") or ""),
                int(payload.get("selected_features_count") or 0),
                int(payload.get("total_features") or 0),
                json.dumps(payload.get("generation_metadata") or {}, default=str),
            ]
            if exists:
                conn.execute(
                    """
                    UPDATE mule_feature_store_config
                    SET master_dataset_id = ?, generation_status = ?, selected_features_json = ?, feature_catalog_json = ?,
                        feature_group_counts_json = ?, module_summary_json = ?, source_tables_json = ?, schema_version = ?,
                        generated_table_name = ?, feature_store_path = ?, full_feature_store_path = ?, catalog_path = ?,
                        selected_features_count = ?, total_features = ?, generation_metadata_json = ?, generated_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE pipeline_id = ?
                    """,
                    values[1:] + [int(pipeline_id)],
                )
            else:
                conn.execute(
                    """
                    INSERT INTO mule_feature_store_config (
                      pipeline_id, master_dataset_id, generation_status, selected_features_json, feature_catalog_json,
                      feature_group_counts_json, module_summary_json, source_tables_json, schema_version,
                      generated_table_name, feature_store_path, full_feature_store_path, catalog_path,
                      selected_features_count, total_features, generation_metadata_json, generated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """,
                    values,
                )

    def _save_catalog_entries(self, pipeline_id: int, entries: List[Dict[str, Any]], conn=None) -> None:
        with self._conn_ctx(conn) as conn:
            conn.execute("DELETE FROM mule_feature_catalog_entries WHERE pipeline_id = ?", [int(pipeline_id)])
            for entry in entries:
                conn.execute(
                    """
                    INSERT INTO mule_feature_catalog_entries (
                      pipeline_id, feature_name, feature_group, module_key, module_name, source_module,
                      source_tables_json, raw_variables_json, formula, business_definition, data_type,
                      mule_categories_json, training_eligible, coverage_pct, created_by_script_part, downstream_step
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        int(pipeline_id),
                        _txt(entry.get("feature_name")),
                        _txt(entry.get("feature_group")),
                        _txt(entry.get("module_key")),
                        _txt(entry.get("module_name")),
                        _txt(entry.get("source_module")),
                        json.dumps(entry.get("source_tables") or [], default=str),
                        json.dumps(entry.get("raw_variables") or [], default=str),
                        _txt(entry.get("formula")),
                        _txt(entry.get("business_definition")),
                        _txt(entry.get("data_type")),
                        json.dumps(entry.get("mule_categories") or [], default=str),
                        bool(entry.get("training_eligible", True)),
                        float(entry.get("coverage_pct") or 0.0),
                        _txt(entry.get("created_by_script_part")),
                        _txt(entry.get("downstream_step") or "preprocessing"),
                    ],
                )

    def _upsert_feature_store_dataset(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        feature_frame: pd.DataFrame,
        output_path: Path,
        conn=None,
    ) -> Dict[str, Any]:
        with self._conn_ctx(conn) as conn:
            existing = conn.execute(
                """
                SELECT dataset_id
                FROM mlops_dataset_registry
                WHERE tenant_id = ? AND env_id = ? AND pipeline_id = ? AND pipeline_type = 'mule' AND dataset_type = 'feature_store'
                ORDER BY updated_at DESC, dataset_id DESC
                LIMIT 1
                """,
                [tenant_id, env_id, int(pipeline_id)],
            ).fetchone()
            column_list = list(feature_frame.columns)
            column_types = {column: str(dtype) for column, dtype in feature_frame.dtypes.items()}
            if existing:
                dataset_id = int(existing[0])
                conn.execute(
                    """
                    UPDATE mlops_dataset_registry
                    SET filename = ?, file_path = ?, row_count = ?, columns_json = ?, column_types_json = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE dataset_id = ?
                    """,
                    [
                        output_path.name,
                        str(output_path),
                        int(feature_frame.shape[0]),
                        json.dumps(column_list, default=str),
                        json.dumps(column_types, default=str),
                        int(dataset_id),
                    ],
                )
            else:
                dataset_id = int(conn.execute("SELECT COALESCE(MAX(dataset_id), 0) + 1 FROM mlops_dataset_registry").fetchone()[0] or 1)
                conn.execute(
                    """
                    INSERT INTO mlops_dataset_registry (
                      dataset_id, tenant_id, env_id, pipeline_id, pipeline_type, dataset_type,
                      filename, file_path, row_count, columns_json, column_types_json
                    ) VALUES (?, ?, ?, ?, 'mule', 'feature_store', ?, ?, ?, ?, ?)
                    """,
                    [
                        dataset_id,
                        tenant_id,
                        env_id,
                        int(pipeline_id),
                        output_path.name,
                        str(output_path),
                        int(feature_frame.shape[0]),
                        json.dumps(column_list, default=str),
                        json.dumps(column_types, default=str),
                    ],
                )
        return {
            "dataset_id": dataset_id,
            "dataset_type": "feature_store",
            "filename": output_path.name,
            "file_path": str(output_path),
            "row_count": int(feature_frame.shape[0]),
            "columns": list(feature_frame.columns),
        }

    def _derive_as_of_date(self, frames: Dict[str, pd.DataFrame], master_frame: pd.DataFrame) -> pd.Timestamp:
        candidates: List[pd.Timestamp] = []
        for frame, column_candidates in [
            (frames.get("transactions", pd.DataFrame()), ["transaction_timestamp"]),
            (frames.get("device_logs", pd.DataFrame()), ["login_timestamp", "session_end_time", "session_start_time"]),
            (frames.get("external_signals", pd.DataFrame()), ["signal_date"]),
            (frames.get("account_daily_summary", pd.DataFrame()), ["txn_date"]),
            (frames.get("mule_labels", pd.DataFrame()), ["mule_event_date"]),
            (master_frame, ["account_open_date"]),
        ]:
            if frame is None or frame.empty:
                continue
            column = _first(frame.columns, column_candidates)
            if not column:
                continue
            parsed = pd.to_datetime(frame[column], errors="coerce")
            if parsed.notna().any():
                candidates.append(parsed.max())
        return max(candidates) if candidates else pd.Timestamp.utcnow().normalize()

    def _normalize_accounts(self, accounts: pd.DataFrame) -> pd.DataFrame:
        frame = accounts.copy()
        frame = _rename_if_present(frame, {
            "account_id": ACCOUNT_ID,
            "customer_id": CUSTOMER_ID,
            "account_open_date": "ACCOUNT_OPEN_DATE",
            "account_status": "ACCOUNT_STATUS",
            "account_type": "ACCOUNT_TYPE",
            "account_balance_current": "ACCOUNT_BALANCE_CURRENT",
            "account_currency": "BANK_COUNTRY",
            "upi_primary_device_id": "PRIMARY_DEVICE_ID",
        })
        frame = _ensure_columns(frame, {
            ACCOUNT_ID: "",
            CUSTOMER_ID: "",
            "ACCOUNT_OPEN_DATE": pd.NaT,
            "ACCOUNT_STATUS": "",
            "ACCOUNT_TYPE": "",
            "ACCOUNT_BALANCE_CURRENT": 0.0,
            "BANK_COUNTRY": "IN",
            "PRIMARY_DEVICE_ID": "",
        })
        return frame[[ACCOUNT_ID, CUSTOMER_ID, "ACCOUNT_OPEN_DATE", "ACCOUNT_STATUS", "ACCOUNT_TYPE", "ACCOUNT_BALANCE_CURRENT", "BANK_COUNTRY", "PRIMARY_DEVICE_ID"]].drop_duplicates()

    def _normalize_customers(self, customers: pd.DataFrame) -> pd.DataFrame:
        frame = customers.copy()
        frame = _rename_if_present(frame, {
            "customer_id": CUSTOMER_ID,
            "customer_date_of_birth": "DATE_OF_BIRTH",
            "customer_last_kyc_update_date": "LAST_KYC_UPDATE_DATE",
            "customer_country": "CUSTOMER_COUNTRY",
            "customer_phone_number": "MOBILE_NUMBER",
            "customer_email": "EMAIL",
        })
        frame = _ensure_columns(frame, {
            CUSTOMER_ID: "",
            "DATE_OF_BIRTH": pd.NaT,
            "LAST_KYC_UPDATE_DATE": pd.NaT,
            "CUSTOMER_COUNTRY": "IN",
            "MOBILE_NUMBER": "",
            "EMAIL": "",
        })
        return frame[[CUSTOMER_ID, "DATE_OF_BIRTH", "LAST_KYC_UPDATE_DATE", "CUSTOMER_COUNTRY", "MOBILE_NUMBER", "EMAIL"]].drop_duplicates()

    def _direction_from_type(self, values: pd.Series) -> pd.Series:
        lowered = values.fillna("").astype(str).str.lower()
        return lowered.map(
            lambda value: "CREDIT" if any(token in value for token in ["credit", "cr", "deposit", "receive", "inflow", "cash_in"]) else "DEBIT"
        )

    def _normalize_transactions(
        self,
        transactions: pd.DataFrame,
        accounts: pd.DataFrame,
        customers: pd.DataFrame,
        counterparties: pd.DataFrame,
        device_logs: pd.DataFrame,
    ) -> pd.DataFrame:
        tx = transactions.copy()
        account_ref = self._normalize_accounts(accounts)
        customer_ref = self._normalize_customers(customers)
        device_ref = device_logs.copy()
        counterparty_ref = counterparties.copy()

        tx = _rename_if_present(tx, {
            "account_id": ACCOUNT_ID,
            "transaction_timestamp": "TXN_TS",
            "transaction_amount": "TXN_AMOUNT",
            "transaction_type": "TXN_TYPE_RAW",
            "transaction_status": "TXN_STATUS",
            "transaction_channel": "CHANNEL",
            "counterparty_account_id": "COUNTERPARTY_ACCOUNT_ID",
            "counterparty_bank_code": "COUNTERPARTY_BANK",
            "transaction_country": "TXN_COUNTRY",
            "merchant_id": "MERCHANT_ID",
            "transaction_city": "CITY",
            "cash_flag": "CASH_FLAG",
            "international_flag": "INTERNATIONAL_FLAG",
            "round_amount_flag": "ROUND_AMOUNT_FLAG",
            "rapid_outflow_flag": "RAPID_OUTFLOW_FLAG",
        })
        if ACCOUNT_ID not in tx.columns:
            if ACCOUNT_ID in account_ref.columns and not account_ref.empty:
                tx = account_ref[[ACCOUNT_ID]].drop_duplicates().copy()
            else:
                tx = pd.DataFrame(columns=[ACCOUNT_ID])
        tx["TXN_DIRECTION"] = self._direction_from_type(_series(tx, "TXN_TYPE_RAW", ""))
        tx["DIRECTION"] = tx["TXN_DIRECTION"]
        tx["IS_REFUND"] = _series(tx, "TXN_STATUS", "").astype(str).str.upper().eq("REFUND").astype(int)
        tx["IS_CHARGEBACK"] = _series(tx, "TXN_STATUS", "").astype(str).str.upper().eq("CHARGEBACK").astype(int)
        tx["TXN_AMOUNT"] = pd.to_numeric(_series(tx, "TXN_AMOUNT", 0), errors="coerce").fillna(0.0).abs()
        tx["CHANNEL"] = _series(tx, "CHANNEL", "").fillna("").astype(str).str.upper()
        tx["BANK_COUNTRY"] = "IN"

        if not counterparty_ref.empty:
            counterparty_ref = _rename_if_present(counterparty_ref, {
                "counterparty_account_id": "COUNTERPARTY_ACCOUNT_ID",
                "counterparty_country": "COUNTERPARTY_COUNTRY",
            })
            if {"COUNTERPARTY_ACCOUNT_ID", "COUNTERPARTY_COUNTRY"}.issubset(counterparty_ref.columns):
                tx = tx.merge(
                    counterparty_ref[["COUNTERPARTY_ACCOUNT_ID", "COUNTERPARTY_COUNTRY"]].drop_duplicates(),
                    on="COUNTERPARTY_ACCOUNT_ID",
                    how="left",
                )
                tx["TXN_COUNTRY"] = _series(tx, "TXN_COUNTRY", "").fillna(tx["COUNTERPARTY_COUNTRY"]).replace("", pd.NA).fillna("IN")
        tx["TXN_COUNTRY"] = _series(tx, "TXN_COUNTRY", "IN").replace("", pd.NA).fillna("IN")

        if not device_ref.empty:
            device_ref = _rename_if_present(device_ref, {
                "account_id": ACCOUNT_ID,
                "device_id": "DEVICE_ID",
                "ip_address": "IP_ADDRESS",
                "login_timestamp": "LOGIN_TS",
            })
            device_ref["LOGIN_TS"] = pd.to_datetime(_series(device_ref, "LOGIN_TS", pd.NaT), errors="coerce")
            device_ref = device_ref.sort_values("LOGIN_TS").dropna(subset=[ACCOUNT_ID]).groupby(ACCOUNT_ID).tail(1)
            tx = tx.merge(device_ref[[ACCOUNT_ID, "DEVICE_ID", "IP_ADDRESS"]], on=ACCOUNT_ID, how="left")
        else:
            tx["DEVICE_ID"] = ""
            tx["IP_ADDRESS"] = ""

        tx = tx.merge(account_ref[[ACCOUNT_ID, CUSTOMER_ID, "ACCOUNT_BALANCE_CURRENT", "ACCOUNT_OPEN_DATE"]], on=ACCOUNT_ID, how="left")
        tx = tx.merge(customer_ref[[CUSTOMER_ID, "CUSTOMER_COUNTRY"]], on=CUSTOMER_ID, how="left")
        tx["BALANCE_AFTER_TXN"] = pd.to_numeric(_series(tx, "ACCOUNT_BALANCE_CURRENT", 0), errors="coerce").fillna(0.0)
        tx["CUSTOMER_ID"] = _series(tx, CUSTOMER_ID, "").fillna("")
        tx["CUSTOMER_COUNTRY"] = _series(tx, "CUSTOMER_COUNTRY", "IN").replace("", pd.NA).fillna("IN")
        tx["MERCHANT_COUNTRY"] = tx.get("TXN_COUNTRY", "IN")
        tx["TERMINAL_ID"] = _series(tx, "MERCHANT_ID", "").fillna("").astype(str).map(lambda value: f"TERM_{value}" if value else "")
        tx["TERMINAL_LOCATION"] = _series(tx, "CITY", "").fillna("")
        tx["GATEWAY_ID"] = _series(tx, "CHANNEL", "").fillna("").astype(str)
        tx["SESSION_ID"] = tx.index.map(lambda idx: f"txn_session_{idx}")
        tx["COUNTERPARTY_ID"] = _series(tx, "COUNTERPARTY_ACCOUNT_ID", "").fillna("")
        tx["LOCATION"] = _series(tx, "CITY", "").fillna("")
        tx = _ensure_columns(tx, {
            ACCOUNT_ID: "",
            "TXN_TS": pd.NaT,
            "TXN_AMOUNT": 0.0,
            "TXN_STATUS": "SUCCESS",
            "TXN_DIRECTION": "DEBIT",
            "DIRECTION": "DEBIT",
            "COUNTERPARTY_ACCOUNT_ID": "",
            "COUNTERPARTY_BANK": "",
            "TXN_COUNTRY": "IN",
            "BANK_COUNTRY": "IN",
            "CHANNEL": "",
            "BALANCE_AFTER_TXN": 0.0,
            "MERCHANT_ID": "",
            "DEVICE_ID": "",
            "IP_ADDRESS": "",
            "CUSTOMER_ID": "",
            "CUSTOMER_COUNTRY": "IN",
            "MERCHANT_COUNTRY": "IN",
            "TERMINAL_ID": "",
            "TERMINAL_LOCATION": "",
            "CITY": "",
            "GATEWAY_ID": "",
            "SESSION_ID": "",
            "COUNTERPARTY_ID": "",
            "LOCATION": "",
            "IS_REFUND": 0,
            "IS_CHARGEBACK": 0,
        })
        return tx

    def _build_beneficiary_master(self, tx: pd.DataFrame) -> pd.DataFrame:
        if tx.empty:
            return pd.DataFrame(columns=[ACCOUNT_ID, "BENEFICIARY_ID", "BENEFICIARY_ADDED_TS", "BENEFICIARY_NAME", "IS_NEW_BENEFICIARY"])
        beneficiaries = (
            tx[[ACCOUNT_ID, "COUNTERPARTY_ACCOUNT_ID", "TXN_TS"]]
            .dropna(subset=[ACCOUNT_ID, "COUNTERPARTY_ACCOUNT_ID"])
            .groupby([ACCOUNT_ID, "COUNTERPARTY_ACCOUNT_ID"], as_index=False)["TXN_TS"]
            .min()
            .rename(columns={"COUNTERPARTY_ACCOUNT_ID": "BENEFICIARY_ID", "TXN_TS": "BENEFICIARY_ADDED_TS"})
        )
        beneficiaries["BENEFICIARY_NAME"] = beneficiaries["BENEFICIARY_ID"].astype(str)
        beneficiaries["IS_NEW_BENEFICIARY"] = 1
        return beneficiaries

    def _build_channel_activity(self, tx: pd.DataFrame) -> pd.DataFrame:
        if tx.empty:
            return pd.DataFrame(columns=[ACCOUNT_ID, "EVENT_TS", "CHANNEL", "DEVICE_ID", "LOCATION", "COUNTERPARTY_ID", "SESSION_ID"])
        return _ensure_columns(
            tx[[ACCOUNT_ID, "TXN_TS", "CHANNEL", "DEVICE_ID", "LOCATION", "COUNTERPARTY_ID", "SESSION_ID"]]
            .rename(columns={"TXN_TS": "EVENT_TS"}),
            {
                ACCOUNT_ID: "",
                "EVENT_TS": pd.NaT,
                "CHANNEL": "",
                "DEVICE_ID": "",
                "LOCATION": "",
                "COUNTERPARTY_ID": "",
                "SESSION_ID": "",
            },
        )

    def _build_device_login_logs(self, device_logs: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        if device_logs.empty:
            device_login = pd.DataFrame(
                columns=[
                    ACCOUNT_ID, "LOGIN_TS", "DEVICE_ID", "IP_ADDRESS", "COUNTRY", "LOCATION",
                    "LOGIN_STATUS", "FAILED_FLAG", "SESSION_ID", "SESSION_DURATION_SECONDS",
                    "TOUCH_PATTERN_ID", "TYPING_SPEED", "EVENT_TYPE",
                ]
            )
            channel_login = pd.DataFrame(
                columns=[ACCOUNT_ID, "LOGIN_TS", "DEVICE_ID", "IP_ADDRESS", "COUNTRY", "LOCATION", "CHANNEL"]
            )
            digital_store = pd.DataFrame(columns=[ACCOUNT_ID, "EVENT_TS", "DEVICE_ID", "IP_ADDRESS", "IP_RISK_SCORE"])
            return device_login, channel_login, digital_store
        frame = device_logs.copy()
        frame = _rename_if_present(frame, {
            "account_id": ACCOUNT_ID,
            "device_id": "DEVICE_ID",
            "ip_address": "IP_ADDRESS",
            "ip_country": "COUNTRY",
            "ip_city": "LOCATION",
            "session_id": "SESSION_ID",
            "session_start_time": "SESSION_START_TS",
            "session_end_time": "SESSION_END_TS",
            "login_timestamp": "LOGIN_TS",
            "login_success_flag": "LOGIN_SUCCESS_FLAG",
            "ip_risk_score": "IP_RISK_SCORE",
        })
        frame["LOGIN_TS"] = pd.to_datetime(_series(frame, "LOGIN_TS", pd.NaT), errors="coerce")
        frame["SESSION_START_TS"] = pd.to_datetime(_series(frame, "SESSION_START_TS", pd.NaT), errors="coerce")
        frame["SESSION_END_TS"] = pd.to_datetime(_series(frame, "SESSION_END_TS", pd.NaT), errors="coerce")
        duration = (frame["SESSION_END_TS"] - frame["SESSION_START_TS"]).dt.total_seconds()
        frame["SESSION_DURATION_SECONDS"] = duration.fillna(0).clip(lower=0)
        frame["FAILED_FLAG"] = (1 - pd.to_numeric(_series(frame, "LOGIN_SUCCESS_FLAG", 1), errors="coerce").fillna(1)).clip(lower=0)
        frame["LOGIN_STATUS"] = frame["FAILED_FLAG"].map(lambda flag: "FAILED" if flag else "SUCCESS")
        frame["TOUCH_PATTERN_ID"] = _series(frame, "DEVICE_ID", "").fillna("")
        frame["TYPING_SPEED"] = pd.to_numeric(_series(frame, "IP_RISK_SCORE", 0), errors="coerce").fillna(0)
        frame["EVENT_TYPE"] = "LOGIN"
        device_login = _ensure_columns(
            frame[[ACCOUNT_ID, "LOGIN_TS", "DEVICE_ID", "IP_ADDRESS", "COUNTRY", "LOCATION", "LOGIN_STATUS", "FAILED_FLAG", "SESSION_ID", "SESSION_DURATION_SECONDS", "TOUCH_PATTERN_ID", "TYPING_SPEED", "EVENT_TYPE"]],
            {
                ACCOUNT_ID: "",
                "LOGIN_TS": pd.NaT,
                "DEVICE_ID": "",
                "IP_ADDRESS": "",
                "COUNTRY": "IN",
                "LOCATION": "",
                "LOGIN_STATUS": "SUCCESS",
                "FAILED_FLAG": 0,
                "SESSION_ID": "",
                "SESSION_DURATION_SECONDS": 0.0,
                "TOUCH_PATTERN_ID": "",
                "TYPING_SPEED": 0.0,
                "EVENT_TYPE": "LOGIN",
            },
        )
        channel_login = _ensure_columns(
            device_login[[ACCOUNT_ID, "LOGIN_TS", "DEVICE_ID", "IP_ADDRESS", "COUNTRY", "LOCATION"]].copy(),
            {
                ACCOUNT_ID: "",
                "LOGIN_TS": pd.NaT,
                "DEVICE_ID": "",
                "IP_ADDRESS": "",
                "COUNTRY": "IN",
                "LOCATION": "",
            },
        )
        channel_login["CHANNEL"] = "MOBILE_BANKING"
        digital_store = _ensure_columns(
            frame[[ACCOUNT_ID, "LOGIN_TS", "DEVICE_ID", "IP_ADDRESS", "IP_RISK_SCORE"]].rename(columns={"LOGIN_TS": "EVENT_TS"}),
            {
                ACCOUNT_ID: "",
                "EVENT_TS": pd.NaT,
                "DEVICE_ID": "",
                "IP_ADDRESS": "",
                "IP_RISK_SCORE": 0.0,
            },
        )
        return device_login, channel_login, digital_store

    def _build_telco_identity_inputs(
        self,
        accounts: pd.DataFrame,
        customers: pd.DataFrame,
        device_logs: pd.DataFrame,
        graph_edges: pd.DataFrame,
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        account_ref = self._normalize_accounts(accounts)
        customer_ref = self._normalize_customers(customers)
        telco = account_ref[[ACCOUNT_ID, "ACCOUNT_OPEN_DATE", "PRIMARY_DEVICE_ID"]].copy()
        telco["SIM_ID"] = telco["PRIMARY_DEVICE_ID"].replace("", pd.NA).fillna(telco[ACCOUNT_ID].astype(str).map(lambda value: f"SIM_{value}"))
        telco["SIM_ACTIVATION_DATE"] = telco["ACCOUNT_OPEN_DATE"]
        telco["FOREIGN_SIM_FLAG"] = 0
        if not device_logs.empty and {"account_id", "ip_country"}.issubset(device_logs.columns):
            foreign_accounts = device_logs.copy()
            foreign_accounts["FOREIGN_SIM_FLAG"] = foreign_accounts["ip_country"].fillna("IN").astype(str).str.upper().ne("IN").astype(int)
            foreign_accounts = foreign_accounts.groupby("account_id")["FOREIGN_SIM_FLAG"].max().reset_index()
            telco = telco.merge(foreign_accounts.rename(columns={"account_id": ACCOUNT_ID}), on=ACCOUNT_ID, how="left", suffixes=("", "_NEW"))
            telco["FOREIGN_SIM_FLAG"] = _series(telco, "FOREIGN_SIM_FLAG_NEW", telco["FOREIGN_SIM_FLAG"]).fillna(telco["FOREIGN_SIM_FLAG"]).astype(int)
            telco = telco.drop(columns=[col for col in ["FOREIGN_SIM_FLAG_NEW"] if col in telco.columns])

        contact = account_ref[[ACCOUNT_ID, CUSTOMER_ID]].merge(customer_ref[[CUSTOMER_ID, "MOBILE_NUMBER", "EMAIL", "LAST_KYC_UPDATE_DATE"]], on=CUSTOMER_ID, how="left")
        contact = contact.rename(columns={"LAST_KYC_UPDATE_DATE": "PHONE_CHANGE_DATE"})
        contact = _ensure_columns(contact, {
            ACCOUNT_ID: "",
            CUSTOMER_ID: "",
            "MOBILE_NUMBER": "",
            "EMAIL": "",
            "PHONE_CHANGE_DATE": pd.NaT,
        })

        account_customer_link = account_ref[[ACCOUNT_ID, CUSTOMER_ID]].drop_duplicates()

        graph_link_frames: List[pd.DataFrame] = []
        if not device_logs.empty:
            device_link = device_logs.copy()
            device_link = _rename_if_present(device_link, {"account_id": ACCOUNT_ID, "device_id": "LINK_VALUE", "ip_address": "IP_LINK_VALUE"})
            graph_link_frames.append(device_link[[ACCOUNT_ID]].assign(LINK_TYPE="DEVICE", LINK_VALUE=_series(device_link, "LINK_VALUE", "").fillna("").astype(str)))
            graph_link_frames.append(device_link[[ACCOUNT_ID]].assign(LINK_TYPE="IP", LINK_VALUE=_series(device_link, "IP_LINK_VALUE", "").fillna("").astype(str)))
        if not contact.empty:
            graph_link_frames.append(contact[[ACCOUNT_ID]].assign(LINK_TYPE="PHONE", LINK_VALUE=contact["MOBILE_NUMBER"].fillna("").astype(str)))
            graph_link_frames.append(contact[[ACCOUNT_ID]].assign(LINK_TYPE="EMAIL", LINK_VALUE=contact["EMAIL"].fillna("").astype(str)))
        if not graph_edges.empty and {"source_node_id", "target_node_id", "edge_type"}.issubset(graph_edges.columns):
            derived = graph_edges.copy()
            derived = _rename_if_present(derived, {"edge_type": "LINK_TYPE"})
            derived[ACCOUNT_ID] = _series(derived, "source_node_id", "").astype(str)
            derived["LINK_VALUE"] = _series(derived, "target_node_id", "").astype(str)
            graph_link_frames.append(derived[[ACCOUNT_ID, "LINK_TYPE", "LINK_VALUE"]])
        customer_graph_link = pd.concat([frame for frame in graph_link_frames if not frame.empty], axis=0, ignore_index=True) if graph_link_frames else pd.DataFrame(columns=[ACCOUNT_ID, "LINK_TYPE", "LINK_VALUE"])
        customer_graph_link = customer_graph_link.dropna(subset=[ACCOUNT_ID]).drop_duplicates()

        return telco, contact, customer_graph_link, account_customer_link

    def _build_network_intelligence_feed(self, device_logs: pd.DataFrame, external_signals: pd.DataFrame) -> pd.DataFrame:
        frames: List[pd.DataFrame] = []
        if not device_logs.empty:
            device = device_logs.copy()
            device = _rename_if_present(device, {"account_id": ACCOUNT_ID, "ip_country": "IP_COUNTRY"})
            device["FOREIGN_IP_FLAG"] = _series(device, "IP_COUNTRY", "IN").fillna("IN").astype(str).str.upper().ne("IN").astype(int)
            frames.append(device[[ACCOUNT_ID, "FOREIGN_IP_FLAG"]])
        if not external_signals.empty:
            signals = external_signals.copy()
            signals = _rename_if_present(signals, {"account_id": ACCOUNT_ID, "risk_level": "RISK_LEVEL"})
            signals["HIGH_RISK_COUNTRY_FLAG"] = _series(signals, "RISK_LEVEL", "").fillna("").astype(str).str.upper().isin(["HIGH", "CRITICAL"]).astype(int)
            frames.append(signals[[ACCOUNT_ID, "HIGH_RISK_COUNTRY_FLAG"]])
        if not frames:
            return pd.DataFrame(columns=[ACCOUNT_ID, "FOREIGN_IP_FLAG", "HIGH_RISK_COUNTRY_FLAG"])
        merged = pd.concat(frames, axis=0, ignore_index=True)
        return merged.groupby(ACCOUNT_ID, as_index=False).max(numeric_only=False)

    def _build_graph_inputs(
        self,
        graph_nodes: pd.DataFrame,
        graph_edges: pd.DataFrame,
        transactions: pd.DataFrame,
        device_logs: pd.DataFrame,
        labels: pd.DataFrame,
    ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
        nodes = graph_nodes.copy()
        edges = graph_edges.copy()
        tx = transactions.copy()
        device = device_logs.copy()
        label_df = labels.copy()

        graph_entity_rows: List[Dict[str, Any]] = []
        if not nodes.empty and not edges.empty and {"node_id", "entity_id", "node_type"}.issubset(nodes.columns):
            node_lookup = nodes.set_index("node_id")[["entity_id", "node_type"]].to_dict("index")
            for row in edges.to_dict(orient="records"):
                source = node_lookup.get(row.get("source_node_id"))
                target = node_lookup.get(row.get("target_node_id"))
                edge_type = _txt(row.get("edge_type") or "LINK")
                edge_ts = row.get("last_seen_date") or row.get("first_seen_date")
                amount = row.get("edge_weight") or 0
                if source and _low(source.get("node_type")) == "account":
                    graph_entity_rows.append({
                        ACCOUNT_ID: _txt(source.get("entity_id")),
                        "LINKED_ACCOUNT_ID": _txt(target.get("entity_id") if target else row.get("target_node_id")),
                        "EDGE_TYPE": edge_type.upper(),
                        "EDGE_TS": edge_ts,
                        "AMOUNT": amount,
                        "CHANNEL": edge_type.upper(),
                        "LAYER_DEPTH": 1,
                    })
                if target and _low(target.get("node_type")) == "account":
                    graph_entity_rows.append({
                        ACCOUNT_ID: _txt(target.get("entity_id")),
                        "LINKED_ACCOUNT_ID": _txt(source.get("entity_id") if source else row.get("source_node_id")),
                        "EDGE_TYPE": edge_type.upper(),
                        "EDGE_TS": edge_ts,
                        "AMOUNT": amount,
                        "CHANNEL": edge_type.upper(),
                        "LAYER_DEPTH": 1,
                    })
        if not tx.empty and {ACCOUNT_ID, "COUNTERPARTY_ACCOUNT_ID", "TXN_TS", "TXN_AMOUNT", "CHANNEL"}.issubset(tx.columns):
            subset = tx[[ACCOUNT_ID, "COUNTERPARTY_ACCOUNT_ID", "TXN_TS", "TXN_AMOUNT", "CHANNEL"]].dropna(subset=[ACCOUNT_ID, "COUNTERPARTY_ACCOUNT_ID"])
            for row in subset.to_dict(orient="records"):
                graph_entity_rows.append({
                    ACCOUNT_ID: _txt(row.get(ACCOUNT_ID)),
                    "LINKED_ACCOUNT_ID": _txt(row.get("COUNTERPARTY_ACCOUNT_ID")),
                    "EDGE_TYPE": "TRANSFER",
                    "EDGE_TS": row.get("TXN_TS"),
                    "AMOUNT": row.get("TXN_AMOUNT") or 0,
                    "CHANNEL": _txt(row.get("CHANNEL") or "TRANSFER"),
                    "LAYER_DEPTH": 1,
                })
        if not device.empty and {"account_id", "device_id"}.issubset(device.columns):
            grouped = device.groupby("device_id")["account_id"].unique()
            for _, accounts in grouped.items():
                accounts = [str(value) for value in accounts if _txt(value)]
                if len(accounts) < 2:
                    continue
                for account in accounts:
                    for linked in accounts:
                        if account == linked:
                            continue
                        graph_entity_rows.append({
                            ACCOUNT_ID: account,
                            "LINKED_ACCOUNT_ID": linked,
                            "EDGE_TYPE": "DEVICE",
                            "EDGE_TS": None,
                            "AMOUNT": 1,
                            "CHANNEL": "DEVICE",
                            "LAYER_DEPTH": 1,
                        })
        graph_entity_network = pd.DataFrame(graph_entity_rows)
        graph_entity_network = _ensure_columns(graph_entity_network, {
            ACCOUNT_ID: "",
            "LINKED_ACCOUNT_ID": "",
            "EDGE_TYPE": "LINK",
            "EDGE_TS": pd.NaT,
            "AMOUNT": 0.0,
            "CHANNEL": "",
            "LAYER_DEPTH": 1,
        }).drop_duplicates()

        community_rows: List[Dict[str, Any]] = []
        if not graph_entity_network.empty:
            if nx is not None:
                graph = nx.Graph()
                for row in graph_entity_network.to_dict(orient="records"):
                    account = _txt(row.get(ACCOUNT_ID))
                    linked = _txt(row.get("LINKED_ACCOUNT_ID"))
                    if account and linked:
                        graph.add_edge(account, linked)
                for index, component in enumerate(nx.connected_components(graph), start=1):
                    component_accounts = sorted(_txt(value) for value in component if _txt(value))
                    cluster_size = len(component_accounts)
                    for account in component_accounts:
                        community_rows.append({
                            ACCOUNT_ID: account,
                            "CLUSTER_ID": f"cluster_{index}",
                            "CLUSTER_SIZE": cluster_size,
                            "SHARED_BENEFICIARY_RATIO": 0,
                            "SHARED_SENDER_RATIO": 0,
                            "COMMUNITY_ID": f"cluster_{index}",
                            "COMMUNITY_SIZE": cluster_size,
                            "MULE_RING_CLUSTER_SIZE": cluster_size,
                        })
            else:
                counts = graph_entity_network.groupby(ACCOUNT_ID)["LINKED_ACCOUNT_ID"].nunique().reset_index(name="CLUSTER_SIZE")
                counts["CLUSTER_ID"] = counts[ACCOUNT_ID].astype(str).map(lambda value: f"cluster_{value}")
                counts["SHARED_BENEFICIARY_RATIO"] = 0
                counts["SHARED_SENDER_RATIO"] = 0
                counts["COMMUNITY_ID"] = counts["CLUSTER_ID"]
                counts["COMMUNITY_SIZE"] = counts["CLUSTER_SIZE"]
                counts["MULE_RING_CLUSTER_SIZE"] = counts["CLUSTER_SIZE"]
                community_rows = counts.to_dict(orient="records")
        graph_community_analytics = pd.DataFrame(community_rows)
        graph_community_analytics = _ensure_columns(graph_community_analytics, {
            ACCOUNT_ID: "",
            "CLUSTER_ID": "",
            "CLUSTER_SIZE": 0,
            "SHARED_BENEFICIARY_RATIO": 0.0,
            "SHARED_SENDER_RATIO": 0.0,
            "COMMUNITY_ID": "",
            "COMMUNITY_SIZE": 0,
            "MULE_RING_CLUSTER_SIZE": 0,
        })

        enterprise_graph_rows: List[Dict[str, Any]] = []
        if not graph_entity_network.empty:
            grouped = graph_entity_network.groupby(ACCOUNT_ID)
            for account_id, group in grouped:
                degree = int(group["LINKED_ACCOUNT_ID"].nunique())
                total_edges = max(len(group.index), 1)
                transfer_edges = group["EDGE_TYPE"].astype(str).str.upper().eq("TRANSFER").sum()
                device_edges = group["EDGE_TYPE"].astype(str).str.upper().eq("DEVICE").sum()
                cross_border = group["CHANNEL"].astype(str).str.upper().eq("CROSS_BORDER").sum()
                enterprise_graph_rows.append({
                    ACCOUNT_ID: account_id,
                    "NODE_DEGREE": degree,
                    "IN_DEGREE": degree,
                    "OUT_DEGREE": degree,
                    "DEGREE_CENTRALITY": degree / max(total_edges, 1),
                    "BETWEENNESS_CENTRALITY": 0,
                    "CLOSENESS_CENTRALITY": 0,
                    "EIGENVECTOR_CENTRALITY": 0,
                    "PAGERANK_SCORE": degree / max(total_edges, 1),
                    "CLUSTERING_COEFFICIENT": 0,
                    "TRIANGLE_COUNT": 0,
                    "KCORE_SCORE": degree,
                    "COMMUNITY_SIZE": degree + 1,
                    "CROSS_BORDER_EDGE_RATIO": cross_border / total_edges,
                    "MONEY_FLOW_DEPTH": transfer_edges,
                    "TRANSACTION_PATH_LENGTH": transfer_edges,
                    "CYCLE_DETECTION_FLAG": int(degree >= 3),
                    "CHANNEL_DIVERSITY_SCORE": group["CHANNEL"].nunique(),
                    "CHANNEL_TRANSITION_SCORE": group["CHANNEL"].nunique(),
                    "NETWORK_TRANSACTION_ENTROPY": group["CHANNEL"].nunique(),
                    "NETWORK_MONEY_FLOW_CONCENTRATION": transfer_edges / total_edges,
                    "NETWORK_CLUSTER_RISK_SCORE": max(degree, device_edges),
                    "NETWORK_HIGH_RISK_NEIGHBOR_COUNT": device_edges,
                })
        enterprise_graph_feature_store = pd.DataFrame(enterprise_graph_rows)
        enterprise_graph_feature_store = _ensure_columns(enterprise_graph_feature_store, {ACCOUNT_ID: ""})

        graph_device_rows: List[Dict[str, Any]] = []
        if not device.empty and {"account_id", "device_id"}.issubset(device.columns):
            groups = device.groupby("device_id")["account_id"].unique()
            for _, accounts in groups.items():
                accounts = [str(value) for value in accounts if _txt(value)]
                if len(accounts) < 2:
                    continue
                for account in accounts:
                    for linked in accounts:
                        if account == linked:
                            continue
                        graph_device_rows.append({
                            ACCOUNT_ID: account,
                            "LINKED_ACCOUNT_ID": linked,
                            "SHARED_DEVICE_FLAG": 1,
                        })
        graph_device_network = pd.DataFrame(graph_device_rows)
        graph_device_network = _ensure_columns(graph_device_network, {
            ACCOUNT_ID: "",
            "LINKED_ACCOUNT_ID": "",
            "SHARED_DEVICE_FLAG": 1,
        }).drop_duplicates()

        known_suspicious_accounts = pd.DataFrame(columns=[ACCOUNT_ID, "IS_SUSPICIOUS", "RISK_SCORE"])
        if not label_df.empty:
            suspicious = label_df.copy()
            suspicious = _rename_if_present(suspicious, {"account_id": ACCOUNT_ID, "mule_flag": "IS_SUSPICIOUS", "event_strength_score": "RISK_SCORE"})
            suspicious = _ensure_columns(suspicious, {
                ACCOUNT_ID: "",
                "IS_SUSPICIOUS": 0,
                "RISK_SCORE": 0.0,
            })
            known_suspicious_accounts = suspicious[[ACCOUNT_ID, "IS_SUSPICIOUS", "RISK_SCORE"]]

        return enterprise_graph_feature_store, graph_entity_network, graph_community_analytics, graph_device_network, known_suspicious_accounts

    def _build_network_access_log(self, device_logs: pd.DataFrame) -> pd.DataFrame:
        if device_logs.empty:
            return pd.DataFrame(columns=[ACCOUNT_ID, "IP_ADDRESS", "EVENT_TS"])
        frame = device_logs.copy()
        frame = _rename_if_present(frame, {"account_id": ACCOUNT_ID, "ip_address": "IP_ADDRESS", "login_timestamp": "EVENT_TS"})
        frame = _ensure_columns(frame, {ACCOUNT_ID: "", "IP_ADDRESS": "", "EVENT_TS": pd.NaT})
        return frame[[ACCOUNT_ID, "IP_ADDRESS", "EVENT_TS"]]

    def _write_csv(self, path: Path, frame: pd.DataFrame) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        frame.to_csv(path, index=False)

    def _build_normalized_input_bundle(
        self,
        input_dir: Path,
        master_frame: pd.DataFrame,
        frames: Dict[str, pd.DataFrame],
    ) -> Dict[str, Any]:
        accounts = frames.get("accounts", pd.DataFrame())
        customers = frames.get("customers", pd.DataFrame())
        transactions = frames.get("transactions", pd.DataFrame())
        counterparties = frames.get("counterparties", pd.DataFrame())
        device_logs = frames.get("device_logs", pd.DataFrame())
        external_signals = frames.get("external_signals", pd.DataFrame())
        graph_nodes = frames.get("graph_nodes", pd.DataFrame())
        graph_edges = frames.get("graph_edges", pd.DataFrame())
        labels = frames.get("mule_labels", pd.DataFrame())

        account_ref = self._normalize_accounts(accounts)
        customer_ref = self._normalize_customers(customers)
        tx = self._normalize_transactions(transactions, accounts, customers, counterparties, device_logs)
        channel_activity = self._build_channel_activity(tx)
        beneficiary_master = self._build_beneficiary_master(tx)
        device_login, channel_login, digital_store = self._build_device_login_logs(device_logs)
        telco_registry, contact_details, customer_graph_link, account_customer_link = self._build_telco_identity_inputs(accounts, customers, device_logs, graph_edges)
        network_intelligence = self._build_network_intelligence_feed(device_logs, external_signals)
        enterprise_graph_feature_store, graph_entity_network, graph_community_analytics, graph_device_network, known_suspicious_accounts = self._build_graph_inputs(
            graph_nodes,
            graph_edges,
            tx,
            device_logs,
            labels,
        )
        network_access_log = self._build_network_access_log(device_logs)

        upi_transaction = tx[tx["CHANNEL"].isin(["UPI", "IMPS", "NEFT", "RTGS", "MOBILE_BANKING", "INTERNET_BANKING"])].copy()
        if upi_transaction.empty:
            upi_transaction = tx.copy()

        atm_transaction = tx[(pd.to_numeric(_series(tx, "CASH_FLAG", 0), errors="coerce").fillna(0) == 1) | tx["CHANNEL"].isin(["ATM", "CASH"])].copy()
        atm_transaction["TXN_TYPE"] = _series(atm_transaction, "TXN_TYPE_RAW", "").fillna("ATM")
        atm_transaction["CITY"] = _series(atm_transaction, "CITY", "").fillna("")
        atm_transaction["COUNTRY"] = _series(atm_transaction, "TXN_COUNTRY", "IN").fillna("IN")
        atm_terminal_usage = atm_transaction[[ACCOUNT_ID, "TXN_TS", "TERMINAL_ID", "CITY", "COUNTRY"]].rename(columns={"TXN_TS": "EVENT_TS"}) if not atm_transaction.empty else pd.DataFrame(columns=[ACCOUNT_ID, "EVENT_TS", "TERMINAL_ID", "CITY", "COUNTRY"])
        atm_terminal_master = atm_terminal_usage[["TERMINAL_ID", "CITY", "COUNTRY"]].drop_duplicates() if not atm_terminal_usage.empty else pd.DataFrame(columns=["TERMINAL_ID", "CITY", "COUNTRY"])

        tbaadm_t_tran = tx.copy()
        tbaadm_t_tran["TXN_TYPE"] = _series(tbaadm_t_tran, "TXN_TYPE_RAW", "").fillna("")
        tbaadm_t_tran["BRANCH_ID"] = _series(tbaadm_t_tran, "CITY", "").fillna("").astype(str).map(lambda value: f"BR_{value}" if value else "BR_DEFAULT")

        merchant_tx = tx[_series(tx, "MERCHANT_ID", "").fillna("").astype(str).ne("")].copy()
        merchant_tx["CUSTOMER_LOCATION"] = _series(merchant_tx, "CUSTOMER_COUNTRY", "IN").fillna("IN")
        merchant_tx["CARD_ID"] = merchant_tx[ACCOUNT_ID].astype(str)
        agg_merchant_behaviour = merchant_tx[[ACCOUNT_ID, "TXN_TS", "MERCHANT_ID", CUSTOMER_ID, "TXN_AMOUNT", "IS_REFUND", "IS_CHARGEBACK", "CARD_ID", "CUSTOMER_LOCATION", "MERCHANT_COUNTRY", "CUSTOMER_COUNTRY"]] if not merchant_tx.empty else pd.DataFrame(columns=[ACCOUNT_ID, "TXN_TS", "MERCHANT_ID", CUSTOMER_ID, "TXN_AMOUNT", "IS_REFUND", "IS_CHARGEBACK", "CARD_ID", "CUSTOMER_LOCATION", "MERCHANT_COUNTRY", "CUSTOMER_COUNTRY"])
        fact_merchant_transaction = merchant_tx[[ACCOUNT_ID, "TXN_TS", "MERCHANT_ID", "TXN_AMOUNT", "IS_REFUND", "IS_CHARGEBACK"]] if not merchant_tx.empty else pd.DataFrame(columns=[ACCOUNT_ID, "TXN_TS", "MERCHANT_ID", "TXN_AMOUNT", "IS_REFUND", "IS_CHARGEBACK"])
        agg_merchant_terminal = merchant_tx[[ACCOUNT_ID, "TXN_TS", "MERCHANT_ID", "TERMINAL_ID", "TERMINAL_LOCATION"]] if not merchant_tx.empty else pd.DataFrame(columns=[ACCOUNT_ID, "TXN_TS", "MERCHANT_ID", "TERMINAL_ID", "TERMINAL_LOCATION"])
        agg_gateway_behaviour = merchant_tx[[ACCOUNT_ID, "TXN_TS", "GATEWAY_ID", "TXN_AMOUNT", "IS_REFUND", "IS_CHARGEBACK", CUSTOMER_ID]] if not merchant_tx.empty else pd.DataFrame(columns=[ACCOUNT_ID, "TXN_TS", "GATEWAY_ID", "TXN_AMOUNT", "IS_REFUND", "IS_CHARGEBACK", CUSTOMER_ID])
        agg_gateway_settlement = merchant_tx[[ACCOUNT_ID, "TXN_TS", "TXN_AMOUNT"]].rename(columns={"TXN_TS": "SETTLEMENT_TS", "TXN_AMOUNT": "SETTLEMENT_AMOUNT"}) if not merchant_tx.empty else pd.DataFrame(columns=[ACCOUNT_ID, "SETTLEMENT_TS", "SETTLEMENT_AMOUNT"])

        customer_contact_master = contact_details[[ACCOUNT_ID, "MOBILE_NUMBER", "EMAIL"]].copy() if not contact_details.empty else pd.DataFrame(columns=[ACCOUNT_ID, "MOBILE_NUMBER", "EMAIL"])

        base_files = {
            "cif_master.csv": customer_ref[[CUSTOMER_ID, "DATE_OF_BIRTH"]].copy(),
            "cif_kyc_details.csv": customer_ref[[CUSTOMER_ID, "LAST_KYC_UPDATE_DATE"]].copy(),
            "cif_address.csv": customer_ref[[CUSTOMER_ID, "LAST_KYC_UPDATE_DATE"]].rename(columns={"LAST_KYC_UPDATE_DATE": "ADDRESS_CHANGE_DATE"}),
            "cif_contact_details.csv": contact_details[[ACCOUNT_ID, CUSTOMER_ID, "MOBILE_NUMBER", "EMAIL", "PHONE_CHANGE_DATE"]].copy() if not contact_details.empty else pd.DataFrame(columns=[ACCOUNT_ID, CUSTOMER_ID, "MOBILE_NUMBER", "EMAIL", "PHONE_CHANGE_DATE"]),
            "account_master.csv": account_ref[[ACCOUNT_ID, CUSTOMER_ID, "ACCOUNT_OPEN_DATE"]].copy(),
            "tbaadm_gam.csv": account_ref[[ACCOUNT_ID, "ACCOUNT_OPEN_DATE"]].copy(),
            "account_transaction_ledger.csv": tx[[ACCOUNT_ID, "TXN_TS", "TXN_AMOUNT", "TXN_DIRECTION", "COUNTERPARTY_ACCOUNT_ID", "COUNTERPARTY_BANK", "TXN_COUNTRY", "CHANNEL", "BALANCE_AFTER_TXN"]].copy(),
            "beneficiary_master.csv": beneficiary_master,
            "channel_activity_log.csv": channel_activity,
            "device_login_log.csv": device_login,
            "upi_transaction.csv": upi_transaction[[ACCOUNT_ID, "TXN_TS", "TXN_AMOUNT", "TXN_STATUS", "DIRECTION", "COUNTERPARTY_ACCOUNT_ID", "IP_ADDRESS", "DEVICE_ID"]].copy() if not upi_transaction.empty else pd.DataFrame(columns=[ACCOUNT_ID, "TXN_TS", "TXN_AMOUNT", "TXN_STATUS", "DIRECTION", "COUNTERPARTY_ACCOUNT_ID", "IP_ADDRESS", "DEVICE_ID"]),
            "atm_transaction.csv": atm_transaction[[ACCOUNT_ID, "TXN_TS", "TXN_TYPE", "TXN_AMOUNT", "TERMINAL_ID", "CITY", "COUNTRY", "TXN_STATUS"]].copy() if not atm_transaction.empty else pd.DataFrame(columns=[ACCOUNT_ID, "TXN_TS", "TXN_TYPE", "TXN_AMOUNT", "TERMINAL_ID", "CITY", "COUNTRY", "TXN_STATUS"]),
            "atm_terminal_usage.csv": atm_terminal_usage,
            "atm_terminal_master.csv": atm_terminal_master,
            "tbaadm_t_tran.csv": tbaadm_t_tran[[ACCOUNT_ID, "TXN_TS", "TXN_TYPE", "TXN_AMOUNT", "BRANCH_ID", "CITY", "CHANNEL", "TXN_DIRECTION", "TXN_COUNTRY", "BANK_COUNTRY"]].copy(),
            "agg_merchant_behaviour.csv": agg_merchant_behaviour,
            "fact_merchant_transaction.csv": fact_merchant_transaction,
            "agg_merchant_terminal.csv": agg_merchant_terminal,
            "agg_gateway_behaviour.csv": agg_gateway_behaviour,
            "agg_gateway_settlement.csv": agg_gateway_settlement,
            "digital_feature_store.csv": digital_store,
            "channel_login_log.csv": channel_login,
            "telco_sim_registry.csv": telco_registry[[ACCOUNT_ID, "SIM_ID", "SIM_ACTIVATION_DATE", "FOREIGN_SIM_FLAG"]].copy(),
            "customer_graph_link.csv": customer_graph_link,
            "account_customer_link.csv": account_customer_link[[ACCOUNT_ID, CUSTOMER_ID]].copy(),
            "network_intelligence_feed.csv": network_intelligence,
            "customer_contact_master.csv": customer_contact_master,
            "graph_device_network.csv": graph_device_network,
            "aml_feature_store.csv": _dedupe_columns(master_frame.copy()),
            "enterprise_graph_feature_store.csv": enterprise_graph_feature_store,
            "graph_entity_network.csv": graph_entity_network,
            "graph_community_analytics.csv": graph_community_analytics,
            "known_suspicious_accounts.csv": known_suspicious_accounts,
            "enterprise_feature_store.csv": _dedupe_columns(master_frame.copy()),
            "network_access_log.csv": network_access_log,
        }

        source_tables_used = []
        for filename, frame in base_files.items():
            safe_frame = _dedupe_columns(frame.copy())
            self._write_csv(input_dir / filename, safe_frame)
            if not safe_frame.empty:
                source_tables_used.append(filename)
        return {
            "source_tables_used": source_tables_used,
            "labels": labels.copy(),
            "typology": frames.get("mule_typology", pd.DataFrame()).copy(),
        }

    def _augment_catalog(self, catalog: pd.DataFrame, full_feature_store: pd.DataFrame, part_name: str) -> List[Dict[str, Any]]:
        if catalog.empty:
            return []
        entries: List[Dict[str, Any]] = []
        for row in catalog.to_dict(orient="records"):
            feature_name = _txt(row.get("feature_name"))
            if not feature_name:
                continue
            feature_group = _low(row.get("feature_group"))
            module_key = FEATURE_GROUP_TO_MODULE.get(feature_group, "cross_channel")
            module_meta = MODULE_META.get(module_key, MODULE_META["cross_channel"])
            data_type = ""
            coverage_pct = 0.0
            if feature_name in full_feature_store.columns:
                data_type = str(full_feature_store[feature_name].dtype)
                coverage_pct = _coverage_pct(full_feature_store[feature_name])
            entries.append({
                "feature_name": feature_name,
                "feature_group": feature_group,
                "module_key": module_key,
                "module_name": module_meta["label"],
                "source_module": module_meta["label"],
                "source_tables": list(module_meta["source_tables"]),
                "raw_variables": _infer_source_columns(feature_name, feature_group),
                "formula": _infer_formula_preview(feature_name, feature_group, part_name),
                "logic_summary": _infer_logic_summary(feature_name, feature_group, part_name),
                "business_definition": _txt(row.get("business_definition")),
                "data_type": data_type,
                "mule_categories": _parse_categories(row.get("mule_types")),
                "training_eligible": feature_name not in {"mule_flag", "mule_typology"},
                "coverage_pct": coverage_pct,
                "created_by_script_part": part_name,
                "downstream_step": "preprocessing",
                "feature_type": module_meta["feature_type"],
            })
        return entries

    def _build_module_summaries(self, entries: List[Dict[str, Any]], selected_features: Iterable[str]) -> List[Dict[str, Any]]:
        selected_set = {str(item) for item in (selected_features or []) if _txt(item)}
        summaries: List[Dict[str, Any]] = []
        for module_key in MODULE_ORDER:
            meta = MODULE_META[module_key]
            module_entries = [entry for entry in entries if entry.get("module_key") == module_key]
            if not module_entries:
                continue
            category_counts: Dict[str, int] = {}
            for entry in module_entries:
                for category in entry.get("mule_categories") or []:
                    category_counts[category] = int(category_counts.get(category, 0)) + 1
            summaries.append({
                "module_key": module_key,
                "module_name": meta["label"],
                "source_tables": list(meta["source_tables"]),
                "summary": meta["summary"],
                "feature_count": len(module_entries),
                "selected_features_count": sum(1 for entry in module_entries if entry.get("feature_name") in selected_set),
                "example_features": [entry.get("feature_name") for entry in module_entries[:5]],
                "mule_categories": sorted(category_counts.keys()),
                "category_counts": category_counts,
                "feature_type": meta["feature_type"],
            })
        return summaries

    def _build_selected_feature_frame(
        self,
        full_feature_store: pd.DataFrame,
        master_frame: pd.DataFrame,
        labels: pd.DataFrame,
        typology: pd.DataFrame,
        selected_features: List[str],
    ) -> pd.DataFrame:
        full = _dedupe_columns(full_feature_store.copy())
        master = _dedupe_columns(master_frame.copy())
        selected_columns = [column for column in selected_features if column in full.columns]
        join_key = _first(full.columns, [ACCOUNT_ID, "account_id"])
        if join_key and join_key != ACCOUNT_ID:
            full = full.rename(columns={join_key: ACCOUNT_ID})
        master_key = _first(master.columns, ["account_id", ACCOUNT_ID])
        if master_key and master_key != ACCOUNT_ID:
            master = master.rename(columns={master_key: ACCOUNT_ID})
        base_keep = [column for column in master.columns if _low(column) in {
            "account_id", "customer_id", "account_type", "account_status", "account_currency",
            "account_balance_current", "avg_balance_30d", "avg_balance_90d", "account_age_days",
        }]
        if ACCOUNT_ID not in base_keep and ACCOUNT_ID in master.columns:
            base_keep.insert(0, ACCOUNT_ID)
        dataset = master[base_keep].copy() if base_keep else full[[ACCOUNT_ID]].copy()
        dataset = dataset.drop_duplicates(subset=[ACCOUNT_ID]).merge(full[[ACCOUNT_ID] + selected_columns].copy(), on=ACCOUNT_ID, how="left")

        label_frame = labels.copy()
        if not label_frame.empty:
            label_frame = _rename_if_present(label_frame, {"account_id": ACCOUNT_ID})
            label_cols = [column for column in [ACCOUNT_ID, "mule_flag", "mule_event_date", "target_source_type", "target_reason_summary", "event_strength_score"] if column in label_frame.columns]
            if label_cols:
                dataset = dataset.merge(label_frame[label_cols].drop_duplicates(subset=[ACCOUNT_ID]), on=ACCOUNT_ID, how="left")

        typology_frame = typology.copy()
        if not typology_frame.empty:
            typology_frame = _rename_if_present(typology_frame, {"account_id": ACCOUNT_ID})
            typology_cols = [column for column in [ACCOUNT_ID, "mule_typology", "typology_confidence", "typology_reason_summary"] if column in typology_frame.columns]
            if typology_cols:
                dataset = dataset.merge(typology_frame[typology_cols].drop_duplicates(subset=[ACCOUNT_ID]), on=ACCOUNT_ID, how="left")

        return _dedupe_columns(dataset)

    def _run_feature_scripts(self, input_dir: Path, output_dir: Path, as_of_date: pd.Timestamp) -> Dict[str, pd.DataFrame]:
        part1 = self._load_script_module("feature_store_part1.py")
        part2 = self._load_script_module("feature_store_part2.py")
        part3 = self._load_script_module("feature_store_part3.py")
        result1 = part1.build_feature_store_part1(str(input_dir), str(output_dir), as_of_date=as_of_date.strftime("%Y-%m-%d"))
        result2 = part2.build_feature_store_part2(str(input_dir), str(output_dir), as_of_date=as_of_date.strftime("%Y-%m-%d"))
        result3 = part3.build_feature_store_part3(str(input_dir), str(output_dir), as_of_date=as_of_date.strftime("%Y-%m-%d"))
        return {**result1, **result2, **result3}

    def _persist_generation_run(self, pipeline_id: int, master_dataset_id: Optional[int], payload: Dict[str, Any], conn=None) -> int:
        with self._conn_ctx(conn) as conn:
            run_id = int(conn.execute("SELECT COALESCE(MAX(run_id), 0) + 1 FROM mule_feature_store_runs").fetchone()[0] or 1)
            conn.execute(
                """
                INSERT INTO mule_feature_store_runs (
                  run_id, pipeline_id, master_dataset_id, generation_status, part1_complete, part2_complete,
                  part3_complete, final_merge_complete, total_features, selected_features_count, generated_table_name,
                  persisted_location, source_tables_json, schema_version, generation_metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    int(run_id),
                    int(pipeline_id),
                    int(master_dataset_id or 0) or None,
                    _txt(payload.get("generation_status") or "ready"),
                    True,
                    True,
                    True,
                    True,
                    int(payload.get("total_features") or 0),
                    int(payload.get("selected_features_count") or 0),
                    _txt(payload.get("generated_table_name") or ""),
                    _txt(payload.get("feature_store_path") or ""),
                    json.dumps(payload.get("source_tables") or [], default=str),
                    _txt(payload.get("schema_version") or SCHEMA_VERSION),
                    json.dumps(payload.get("generation_metadata") or {}, default=str),
                ],
            )
        return run_id

    def _materialize_selected_dataset(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        master_dataset_id: Optional[int],
        selected_features: List[str],
        full_feature_store_path: Path,
        master_frame: pd.DataFrame,
        labels: pd.DataFrame,
        typology: pd.DataFrame,
        generated_table_name: str,
        current_config: Optional[Dict[str, Any]] = None,
        conn=None,
    ) -> Dict[str, Any]:
        full_feature_store = _load_frame(full_feature_store_path)
        selected_frame = self._build_selected_feature_frame(full_feature_store, master_frame, labels, typology, selected_features)
        selected_output_path = self._data_dir(pipeline_id) / f"{generated_table_name}_selected.csv"
        selected_frame.to_csv(selected_output_path, index=False)
        with self._conn_ctx(conn) as conn:
            conn.register("__mule_feature_store_selected_df", selected_frame)
            conn.execute(f'CREATE OR REPLACE TABLE "{generated_table_name}" AS SELECT * FROM __mule_feature_store_selected_df')
            try:
                conn.unregister("__mule_feature_store_selected_df")
            except Exception:
                pass
            dataset = self._upsert_feature_store_dataset(tenant_id, env_id, pipeline_id, selected_frame, selected_output_path, conn=conn)
            config = current_config if isinstance(current_config, dict) else self.load_config(pipeline_id)
            updated_payload = {
                **config,
                "master_dataset_id": int(master_dataset_id or 0) or None,
                "generation_status": config.get("generation_status") or "ready",
                "selected_features": selected_features,
                "selected_features_count": len(selected_features),
                "generated_table_name": generated_table_name,
                "feature_store_path": str(selected_output_path),
                "full_feature_store_path": str(full_feature_store_path),
            }
            self._upsert_config_record(pipeline_id, updated_payload, conn=conn)
        return {
            "dataset": dataset,
            "selected_output_path": str(selected_output_path),
            "row_count": int(selected_frame.shape[0]),
            "column_count": int(selected_frame.shape[1]),
        }

    def generate(self, tenant_id: str, env_id: str, pipeline_id: int, regenerate: bool = False) -> Dict[str, Any]:
        pipeline = self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        self._ensure_run_row(int(pipeline_id), status="feature_store_generating")
        master_row, master_frame = self._load_master_dataset(tenant_id, env_id, pipeline_id)
        current = self.load_config(pipeline_id)
        job_id = f"mule-feature-store-{int(pipeline_id)}"
        estimated_runtime_seconds = max(20, min(300, int(max(master_frame.shape[0], 1) / 250)))
        execution_logs: List[Dict[str, Any]] = []

        def _push_job_update(
            *,
            status: str,
            progress_pct: float,
            step_index: int,
            total_steps: int,
            current_task: str,
            current_module: str,
            records_total: int,
            level: str = "info",
            message: str = "",
            **extra: Any,
        ) -> None:
            log_entry = {
                "ts": pd.Timestamp.utcnow().isoformat(),
                "level": level,
                "status": _txt(status),
                "step_index": int(step_index),
                "total_steps": int(total_steps),
                "current_task": _txt(current_task),
                "current_module": _txt(current_module),
                "message": _txt(message),
            }
            for key, value in extra.items():
                log_entry[key] = _safe_value(value)
            execution_logs.append(log_entry)
            processed = int(round((max(0.0, min(float(progress_pct or 0.0), 100.0)) / 100.0) * max(int(records_total or 0), 1)))
            self.workspace.upsert_job(
                job_id,
                int(pipeline_id),
                "feature_store",
                "feature_generation",
                status,
                progress_pct=progress_pct,
                logs={
                    "current_task": _txt(current_task),
                    "current_module": _txt(current_module),
                    "current_step_index": int(step_index),
                    "total_steps": int(total_steps),
                    "records_total": int(records_total or 0),
                    "records_processed": processed,
                    "estimated_runtime_seconds": int(estimated_runtime_seconds),
                    "heartbeat_ts": pd.Timestamp.utcnow().isoformat(),
                    "entries": execution_logs[-60:],
                },
            )

        self._workspace_mark(
            tenant_id,
            pipeline_id,
            "in_progress",
            "generate",
            summary={
                "generation_status": "running",
                "master_dataset_id": int(master_row.get("dataset_id") or 0) or None,
                "selected_features_count": int(current.get("selected_features_count") or 0),
                "generated_table_name": _txt(current.get("generated_table_name")),
            },
            current_stage="feature_store",
            current_substage="generate",
        )
        _push_job_update(
            status="in_progress",
            progress_pct=5.0,
            step_index=1,
            total_steps=6,
            current_task="Validating feature-store configuration",
            current_module="Run initialization",
            records_total=int(master_frame.shape[0] or 0),
            message=f"Starting Mule Feature Store generation for {_txt(pipeline.get('name')) or f'pipeline {int(pipeline_id)}'}.",
            pipeline_name=_txt(pipeline.get("name")),
        )
        if current.get("generation_status") == "ready" and current.get("feature_store_path") and not regenerate:
            _push_job_update(
                status="completed",
                progress_pct=100.0,
                step_index=6,
                total_steps=6,
                current_task="Reusing persisted feature-store artifact",
                current_module="Persisted output",
                records_total=int(master_frame.shape[0] or 0),
                message="Existing persisted feature-store artifact was reused; no regeneration was required.",
                feature_store_path=_txt(current.get("feature_store_path")),
            )
            return self.status(tenant_id, env_id, pipeline_id)
        try:
            raw_frames: Dict[str, pd.DataFrame] = {}
            for dataset_type in [
                "accounts", "customers", "transactions", "counterparties", "device_logs",
                "external_signals", "graph_nodes", "graph_edges", "account_daily_summary",
                "mule_labels", "mule_typology",
            ]:
                _, frame = self._load_dataset_by_type(tenant_id, env_id, pipeline_id, dataset_type)
                raw_frames[dataset_type] = frame
            total_records = sum(int(frame.shape[0]) for frame in raw_frames.values()) + int(master_frame.shape[0] or 0)
            _push_job_update(
                status="in_progress",
                progress_pct=18.0,
                step_index=2,
                total_steps=6,
                current_task="Loading source datasets and master artifact",
                current_module="Source bundle preparation",
                records_total=total_records,
                message="Source tables and master dataset loaded for normalized bundle creation.",
                source_dataset_count=len(raw_frames),
            )

            run_dir = self._data_dir(pipeline_id)
            input_dir = run_dir / "normalized_inputs"
            output_dir = run_dir / "generated"
            input_dir.mkdir(parents=True, exist_ok=True)
            output_dir.mkdir(parents=True, exist_ok=True)
            normalized_info = self._build_normalized_input_bundle(input_dir, master_frame, raw_frames)
            as_of_date = self._derive_as_of_date(raw_frames, master_frame)
            _push_job_update(
                status="in_progress",
                progress_pct=35.0,
                step_index=3,
                total_steps=6,
                current_task="Normalizing inputs for governed feature generation",
                current_module="Input normalization",
                records_total=total_records,
                message="Normalized feature inputs prepared from source tables and master dataset.",
                input_dir=str(input_dir),
                as_of_date=as_of_date.isoformat(),
            )
            _push_job_update(
                status="in_progress",
                progress_pct=52.0,
                step_index=4,
                total_steps=6,
                current_task="Building governed feature modules",
                current_module="Account, transaction, cross-channel, and graph features",
                records_total=total_records,
                message="Feature generation scripts are assembling the Mule feature library.",
                output_dir=str(output_dir),
            )
            script_results = self._run_feature_scripts(input_dir, output_dir, as_of_date)

            full_feature_store = _dedupe_columns(script_results["mule_feature_store_final"].copy())
            join_key = _first(full_feature_store.columns, ["account_id", ACCOUNT_ID])
            if join_key and join_key != ACCOUNT_ID:
                full_feature_store = full_feature_store.rename(columns={join_key: ACCOUNT_ID})

            full_catalog: List[Dict[str, Any]] = []
            for part_name, key in [
                ("feature_store_part1", "feature_catalog_part1"),
                ("feature_store_part2", "feature_catalog_part2"),
                ("feature_store_part3", "feature_catalog_part3"),
            ]:
                full_catalog.extend(self._augment_catalog(script_results.get(key, pd.DataFrame()), full_feature_store, part_name))

            deduped_catalog: List[Dict[str, Any]] = []
            seen_features = set()
            for entry in full_catalog:
                name = entry["feature_name"]
                if name in seen_features:
                    continue
                seen_features.add(name)
                deduped_catalog.append(entry)

            selected_features = current.get("selected_features") or [entry["feature_name"] for entry in deduped_catalog if entry.get("training_eligible", True)]
            selected_features = [feature for feature in selected_features if feature in full_feature_store.columns]
            if not selected_features:
                selected_features = [entry["feature_name"] for entry in deduped_catalog if entry.get("feature_name") in full_feature_store.columns and entry.get("training_eligible", True)]

            generated_table_name = _table_name(f"mule_feature_store_{int(pipeline_id)}", f"mule_feature_store_{int(pipeline_id)}")
            full_feature_store_path = output_dir / "mule_feature_store_final.csv"
            full_catalog_path = output_dir / "mule_feature_catalog_final.csv"
            selected_materialization = self._materialize_selected_dataset(
                tenant_id=tenant_id,
                env_id=env_id,
                pipeline_id=int(pipeline_id),
                master_dataset_id=int(master_row.get("dataset_id") or 0) or None,
                selected_features=selected_features,
                full_feature_store_path=full_feature_store_path,
                master_frame=master_frame,
                labels=normalized_info.get("labels", pd.DataFrame()),
                typology=normalized_info.get("typology", pd.DataFrame()),
                generated_table_name=generated_table_name,
                current_config=current,
            )

            feature_group_counts: Dict[str, int] = {}
            for entry in deduped_catalog:
                feature_group = _txt(entry.get("feature_group"))
                feature_group_counts[feature_group] = int(feature_group_counts.get(feature_group, 0)) + 1
            module_summaries = self._build_module_summaries(deduped_catalog, selected_features)
            _push_job_update(
                status="in_progress",
                progress_pct=74.0,
                step_index=5,
                total_steps=6,
                current_task="Compiling catalog and selected feature set",
                current_module="Catalog assembly",
                records_total=total_records,
                message="Feature catalog entries, module summaries, and governed selection were compiled.",
                total_features=len(deduped_catalog),
                selected_features_count=len(selected_features),
            )
            category_summary: Dict[str, int] = {}
            for entry in deduped_catalog:
                if entry.get("feature_name") not in selected_features:
                    continue
                for category in entry.get("mule_categories") or []:
                    category_summary[category] = int(category_summary.get(category, 0)) + 1

            generation_metadata = {
                "pipeline_name": _txt(pipeline.get("name")),
                "master_dataset_id": int(master_row.get("dataset_id") or 0) or None,
                "master_dataset_rows": int(master_frame.shape[0]),
                "full_feature_rows": int(full_feature_store.shape[0]),
                "full_feature_columns": int(full_feature_store.shape[1]),
                "selected_feature_categories": category_summary,
                "label_columns_present": [column for column in ["mule_flag", "mule_typology"] if column in selected_materialization["dataset"]["columns"]],
                "multi_class_ready": "mule_typology" in selected_materialization["dataset"]["columns"],
                "generated_from_scripts": ["feature_store_part1.py", "feature_store_part2.py", "feature_store_part3.py"],
                "normalized_input_dir": str(input_dir),
                "generated_output_dir": str(output_dir),
                "as_of_date": as_of_date.isoformat(),
                "sample_rows": _safe_json_rows(full_feature_store),
                "estimated_runtime_seconds": int(estimated_runtime_seconds),
            }

            payload = {
                "master_dataset_id": int(master_row.get("dataset_id") or 0) or None,
                "generation_status": "ready",
                "selected_features": selected_features,
                "feature_catalog": deduped_catalog,
                "feature_group_counts": feature_group_counts,
                "module_summaries": module_summaries,
                "source_tables": normalized_info.get("source_tables_used") or [],
                "schema_version": SCHEMA_VERSION,
                "generated_table_name": generated_table_name,
                "feature_store_path": selected_materialization["selected_output_path"],
                "full_feature_store_path": str(full_feature_store_path),
                "catalog_path": str(full_catalog_path),
                "selected_features_count": len(selected_features),
                "total_features": len(deduped_catalog),
                "generation_metadata": generation_metadata,
            }
            with get_connection(self.db_path) as conn:
                self._upsert_config_record(int(pipeline_id), payload, conn=conn)
                self._save_catalog_entries(int(pipeline_id), deduped_catalog, conn=conn)
                run_id = self._persist_generation_run(int(pipeline_id), int(master_row.get("dataset_id") or 0) or None, payload, conn=conn)
                self.workspace.register_artifact(
                    int(pipeline_id),
                    "feature_store",
                    "feature_store_selected_csv",
                    _txt(selected_materialization["selected_output_path"]),
                    metadata={
                        "dataset_id": int(selected_materialization["dataset"].get("dataset_id") or 0),
                        "row_count": int(selected_materialization["row_count"]),
                        "column_count": int(selected_materialization["column_count"]),
                        "generated_table_name": generated_table_name,
                        "selected_features_count": len(selected_features),
                    },
                    conn=conn,
                )
                self.workspace.register_artifact(
                    int(pipeline_id),
                    "feature_store",
                    "feature_store_full_csv",
                    str(full_feature_store_path),
                    metadata={
                        "row_count": int(full_feature_store.shape[0]),
                        "column_count": int(full_feature_store.shape[1]),
                        "total_features": len(deduped_catalog),
                    },
                    conn=conn,
                )
                self.workspace.register_artifact(
                    int(pipeline_id),
                    "feature_store",
                    "feature_catalog_csv",
                    str(full_catalog_path),
                    metadata={
                        "total_features": len(deduped_catalog),
                        "module_count": len(module_summaries),
                    },
                    conn=conn,
                )
                execution_logs.append({
                    "ts": pd.Timestamp.utcnow().isoformat(),
                    "level": "info",
                    "status": "completed",
                    "step_index": 6,
                    "total_steps": 6,
                    "current_task": "Persisting feature-store artifacts",
                    "current_module": "Artifact registry",
                    "message": "Selected feature store, full feature store, and catalog artifacts were registered.",
                    "run_id": int(run_id),
                    "generated_table_name": generated_table_name,
                })
                processed = int(max(total_records, 1))
                self.workspace.upsert_job(
                    job_id,
                    int(pipeline_id),
                    "feature_store",
                    "feature_generation",
                    "completed",
                    progress_pct=100.0,
                    logs={
                        "current_task": "Persisting feature-store artifacts",
                        "current_module": "Artifact registry",
                        "current_step_index": 6,
                        "total_steps": 6,
                        "records_total": int(total_records),
                        "records_processed": processed,
                        "estimated_runtime_seconds": int(estimated_runtime_seconds),
                        "heartbeat_ts": pd.Timestamp.utcnow().isoformat(),
                        "entries": execution_logs[-60:],
                        "run_id": int(run_id),
                        "generated_table_name": generated_table_name,
                        "selected_output_path": _txt(selected_materialization["selected_output_path"]),
                    },
                    conn=conn,
                )
                self._workspace_mark(
                    tenant_id,
                    pipeline_id,
                    "completed",
                    "generate",
                    summary={
                        "generation_status": "ready",
                        "run_id": int(run_id),
                        "dataset_id": int(selected_materialization["dataset"].get("dataset_id") or 0),
                        "selected_features_count": len(selected_features),
                        "total_features": len(deduped_catalog),
                        "generated_table_name": generated_table_name,
                        "source_tables": payload.get("source_tables") or [],
                    },
                    current_stage="preprocessing_feature_selection",
                    current_substage="health",
                    conn=conn,
                )
            self._ensure_run_row(int(pipeline_id), status="feature_store_ready")

            status = self.status(tenant_id, env_id, pipeline_id)
            status["latest_run"] = {
                "run_id": int(run_id),
                "generation_status": "ready",
                "generated_table_name": generated_table_name,
                "generated_at": status.get("generated_at"),
                "dataset_id": int(selected_materialization["dataset"].get("dataset_id") or 0),
            }
            return status
        except Exception as exc:
            self._ensure_run_row(int(pipeline_id), status="feature_store_failed")
            execution_logs.append({
                "ts": pd.Timestamp.utcnow().isoformat(),
                "level": "error",
                "status": "failed",
                "step_index": 6,
                "total_steps": 6,
                "current_task": "Feature-store generation failed",
                "current_module": "Execution error",
                "message": str(exc),
            })
            self.workspace.upsert_job(
                job_id,
                int(pipeline_id),
                "feature_store",
                "feature_generation",
                "failed",
                progress_pct=100.0,
                logs={
                    "current_task": "Feature-store generation failed",
                    "current_module": "Execution error",
                    "current_step_index": 6,
                    "total_steps": 6,
                    "records_total": int(master_frame.shape[0] or 0),
                    "records_processed": int(master_frame.shape[0] or 0),
                    "estimated_runtime_seconds": int(estimated_runtime_seconds),
                    "heartbeat_ts": pd.Timestamp.utcnow().isoformat(),
                    "entries": execution_logs[-60:],
                    "message": str(exc),
                },
            )
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "failed",
                "generate",
                summary={
                    "generation_status": "failed",
                    "master_dataset_id": int(master_row.get("dataset_id") or 0) or None,
                    "selected_features_count": int(current.get("selected_features_count") or 0),
                },
                error={"message": str(exc)},
                current_stage="feature_store",
                current_substage="generate",
            )
            raise

    def save_config(self, tenant_id: str, env_id: str, pipeline_id: int, patch: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        self._ensure_run_row(int(pipeline_id), status="feature_store_configuring")
        current = self.load_config(pipeline_id)
        next_selected = patch.get("selected_features") if isinstance(patch, dict) else None
        if not isinstance(next_selected, list):
            next_selected = current.get("selected_features") or []
        next_selected = [str(item) for item in next_selected if _txt(item)]
        payload = {
            **current,
            "selected_features": next_selected,
            "selected_features_count": len(next_selected),
        }
        with get_connection(self.db_path) as conn:
            self._upsert_config_record(int(pipeline_id), payload, conn=conn)

            feature_store_path = _txt(current.get("full_feature_store_path"))
            materialized = None
            if feature_store_path:
                master_row, master_frame = self._load_master_dataset(tenant_id, env_id, pipeline_id)
                _, labels = self._load_dataset_by_type(tenant_id, env_id, pipeline_id, "mule_labels")
                _, typology = self._load_dataset_by_type(tenant_id, env_id, pipeline_id, "mule_typology")
                materialized = self._materialize_selected_dataset(
                    tenant_id=tenant_id,
                    env_id=env_id,
                    pipeline_id=int(pipeline_id),
                    master_dataset_id=int(master_row.get("dataset_id") or 0) or None,
                    selected_features=next_selected,
                    full_feature_store_path=self._resolve_file_path(feature_store_path),
                    master_frame=master_frame,
                    labels=labels,
                    typology=typology,
                    generated_table_name=_txt(current.get("generated_table_name") or f"mule_feature_store_{int(pipeline_id)}"),
                    current_config=payload,
                    conn=conn,
                )
            generation_state = _low(current.get("generation_status") or payload.get("generation_status"))
            stage_ready = bool(materialized or current.get("feature_store_path")) and generation_state in {"ready", "generated", "built", "completed"}
            self._workspace_mark(
                tenant_id,
                pipeline_id,
                "completed" if stage_ready else "in_progress",
                "configure",
                summary={
                    "generation_status": _txt(current.get("generation_status") or payload.get("generation_status") or "not_generated"),
                    "selected_features_count": len(next_selected),
                    "total_features": int(payload.get("total_features") or 0),
                    "generated_table_name": _txt(current.get("generated_table_name") or payload.get("generated_table_name")),
                },
                current_stage="preprocessing_feature_selection" if stage_ready else "feature_store",
                current_substage="health" if stage_ready else "configure",
                conn=conn,
            )
        return self.status(tenant_id, env_id, pipeline_id)

    def status(self, tenant_id: str, env_id: str, pipeline_id: int) -> Dict[str, Any]:
        self._ensure_pipeline_exists(int(pipeline_id), expected_type="mule")
        current = self.load_config(pipeline_id)
        feature_catalog = current.get("feature_catalog") or []
        selected_features = current.get("selected_features") or []
        selected_set = {str(item) for item in selected_features}
        category_summary: Dict[str, int] = {}
        for entry in feature_catalog:
            if entry.get("feature_name") not in selected_set:
                continue
            for category in entry.get("mule_categories") or []:
                category_summary[category] = int(category_summary.get(category, 0)) + 1
        latest_run = None
        latest_job = None
        stage_artifacts: List[Dict[str, Any]] = []
        with get_connection(self.db_path) as conn:
            row = conn.execute(
                """
                SELECT run_id, generation_status, generated_table_name, persisted_location, source_tables_json, schema_version, generation_metadata_json, generated_at
                FROM mule_feature_store_runs
                WHERE pipeline_id = ?
                ORDER BY generated_at DESC, run_id DESC
                LIMIT 1
                """,
                [int(pipeline_id)],
            ).fetchone()
        if row:
            latest_run = {
                "run_id": int(row[0]),
                "generation_status": _txt(row[1]),
                "generated_table_name": _txt(row[2]),
                "persisted_location": _txt(row[3]),
                "source_tables": _loads(row[4], []),
                "schema_version": _txt(row[5]) or SCHEMA_VERSION,
                "generation_metadata": _loads(row[6], {}),
                "generated_at": row[7].isoformat() if hasattr(row[7], "isoformat") else row[7],
            }

            dataset_row = conn.execute(
                """
                SELECT dataset_id, row_count, columns_json
                FROM mlops_dataset_registry
                WHERE pipeline_type = 'mule' AND pipeline_id = ? AND dataset_type = 'feature_store'
                ORDER BY updated_at DESC, dataset_id DESC
                LIMIT 1
                """,
                [int(pipeline_id)],
            ).fetchone()
            if dataset_row:
                latest_run["dataset_id"] = int(dataset_row[0])
                latest_run["row_count"] = int(dataset_row[1] or 0)
                latest_run["column_count"] = len(_loads(dataset_row[2], []))
            job_row = conn.execute(
                """
                SELECT job_id, stage_name, job_type, status, progress_pct, logs_json, started_at, finished_at, updated_at
                FROM job_registry
                WHERE run_id = ? AND stage_name = 'feature_store'
                ORDER BY updated_at DESC, started_at DESC
                LIMIT 1
                """,
                [int(pipeline_id)],
            ).fetchone()
            if job_row:
                latest_job = {
                    "job_id": _txt(job_row[0]),
                    "stage_name": _txt(job_row[1]),
                    "job_type": _txt(job_row[2]),
                    "status": _txt(job_row[3]),
                    "progress_pct": float(job_row[4] or 0.0),
                    "logs": _loads(job_row[5], {}),
                    "started_at": job_row[6].isoformat() if hasattr(job_row[6], "isoformat") else job_row[6],
                    "finished_at": job_row[7].isoformat() if hasattr(job_row[7], "isoformat") else job_row[7],
                    "updated_at": job_row[8].isoformat() if hasattr(job_row[8], "isoformat") else job_row[8],
                }
            artifact_rows = conn.execute(
                """
                SELECT artifact_id, artifact_type, version, storage_ref, metadata_json, created_at
                FROM artifact_registry
                WHERE run_id = ? AND stage_name = 'feature_store'
                ORDER BY created_at DESC, artifact_id DESC
                LIMIT 20
                """,
                [int(pipeline_id)],
            ).fetchall()
            stage_artifacts = [
                {
                    "artifact_id": int(item[0]),
                    "artifact_type": _txt(item[1]),
                    "version": int(item[2] or 1),
                    "storage_ref": _txt(item[3]),
                    "metadata": _loads(item[4], {}),
                    "created_at": item[5].isoformat() if hasattr(item[5], "isoformat") else item[5],
                }
                for item in artifact_rows
            ]

        result = {
            "pipeline_id": int(pipeline_id),
            "generation_status": current.get("generation_status") or "not_generated",
            "master_dataset_id": current.get("master_dataset_id"),
            "feature_store_status": current.get("generation_status") or "not_generated",
            "persisted": bool(current.get("feature_store_path")),
            "generated_table_name": current.get("generated_table_name"),
            "feature_store_path": current.get("feature_store_path"),
            "full_feature_store_path": current.get("full_feature_store_path"),
            "catalog_path": current.get("catalog_path"),
            "schema_version": current.get("schema_version") or SCHEMA_VERSION,
            "total_features": int(current.get("total_features") or 0),
            "selected_features_count": int(current.get("selected_features_count") or 0),
            "feature_group_counts": current.get("feature_group_counts") or {},
            "module_summaries": current.get("module_summaries") or [],
            "feature_catalog": feature_catalog,
            "selected_features": selected_features,
            "selected_features_by_category": category_summary,
            "source_tables": current.get("source_tables") or [],
            "generation_metadata": current.get("generation_metadata") or {},
            "generated_at": current.get("generated_at"),
            "latest_run": latest_run,
            "latest_job": latest_job,
            "stage_artifacts": stage_artifacts,
            "reuse_available": bool(current.get("feature_store_path")),
        }
        stage_state = _low(result.get("generation_status") or "")
        if stage_state in {"ready", "generated", "built", "completed"} and result.get("persisted"):
            workspace_status = "completed"
            workspace_substage = "generate"
        elif stage_state in {"failed", "error"}:
            workspace_status = "failed"
            workspace_substage = "generate"
        elif stage_state in {"running", "in_progress", "preview", "generating"}:
            workspace_status = "in_progress"
            workspace_substage = "generate"
        elif result.get("selected_features_count") or result.get("total_features"):
            workspace_status = "in_progress"
            workspace_substage = "configure"
        else:
            workspace_status = "not_started"
            workspace_substage = "configure"
        self.workspace.ensure_run(int(pipeline_id), user_id=_txt(tenant_id) or "system")
        self.workspace.set_stage_state(
            int(pipeline_id),
            "feature_store",
            workspace_status,
            substage=workspace_substage,
            summary={
                "generation_status": _txt(result.get("generation_status") or "not_generated"),
                "selected_features_count": int(result.get("selected_features_count") or 0),
                "total_features": int(result.get("total_features") or 0),
                "generated_table_name": _txt(result.get("generated_table_name")),
                "latest_run": latest_run or {},
            },
            error={"message": _txt(result.get("error"))} if workspace_status == "failed" and _txt(result.get("error")) else {},
        )
        return result
