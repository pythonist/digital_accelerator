from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd

from api.tools.mlops.duckdb_manager import get_connection
from api.tools.mlops.path_utils import resolve_data_file_path


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _first_existing_column(columns: Iterable[str], candidates: Iterable[str]) -> Optional[str]:
    lookup = {str(col).strip().lower(): str(col) for col in columns}
    for candidate in candidates:
        hit = lookup.get(str(candidate).strip().lower())
        if hit:
            return hit
    return None


def _load_frame(file_path: Path) -> pd.DataFrame:
    suffix = file_path.suffix.lower()
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(file_path)
    if suffix in {".csv", ".txt"}:
        return pd.read_csv(file_path)
    if suffix in {".json"}:
        return pd.read_json(file_path)
    return pd.read_csv(file_path)


class MuleDatasetBuilder:
    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)

    def _env_root(self) -> Path:
        return self.db_path.resolve().parents[2]

    def _mlops_data_dir(self) -> Path:
        path = self._env_root() / "mlops" / "data" / "mule"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _resolve_file_path(self, raw_path: str) -> Path:
        return resolve_data_file_path(Path(raw_path), env_root=self._env_root())

    def _list_registry_rows(self, tenant_id: str, env_id: str, pipeline_type: str = "mule") -> List[Dict[str, Any]]:
        with get_connection(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT dataset_id, dataset_type, filename, file_path, row_count, columns_json, column_types_json
                FROM mlops_dataset_registry
                WHERE tenant_id = ? AND env_id = ? AND pipeline_type = ?
                ORDER BY updated_at DESC
                """,
                [tenant_id, env_id, pipeline_type],
            ).fetchall()
        results: List[Dict[str, Any]] = []
        for row in rows:
            results.append({
                "dataset_id": int(row[0]),
                "dataset_type": _normalize_text(row[1]).lower(),
                "filename": _normalize_text(row[2]),
                "file_path": _normalize_text(row[3]),
                "row_count": int(row[4] or 0),
                "columns": json.loads(row[5] or "[]"),
                "column_types": json.loads(row[6] or "{}"),
            })
        return results

    def _load_selected_sources(
        self,
        tenant_id: str,
        env_id: str,
        *,
        source_dataset_ids: Optional[List[int]] = None,
    ) -> Dict[str, pd.DataFrame]:
        registry_rows = self._list_registry_rows(tenant_id, env_id, pipeline_type="mule")
        selected = []
        if source_dataset_ids:
            wanted = {int(value) for value in source_dataset_ids if int(value) > 0}
            selected = [row for row in registry_rows if row["dataset_id"] in wanted]
        else:
            selected = registry_rows

        frames: Dict[str, pd.DataFrame] = {}
        for row in selected:
            try:
                frame = _load_frame(self._resolve_file_path(row["file_path"]))
            except Exception:
                continue
            if frame.empty:
                continue
            frames[row["dataset_type"] or f"dataset_{row['dataset_id']}"] = frame.copy()
        return frames

    def _build_transaction_aggregates(self, frame: pd.DataFrame, account_col: str) -> pd.DataFrame:
        numeric_candidates = [
            "amount", "txn_amount", "transaction_amount", "value", "debit_amount",
            "credit_amount", "turnover", "balance", "cash_amount",
        ]
        amount_col = _first_existing_column(frame.columns, numeric_candidates)
        grouped = frame.groupby(account_col, dropna=False).size().reset_index(name="transaction_count")
        grouped.rename(columns={account_col: "account_id"}, inplace=True)
        if amount_col:
            amount_stats = frame.groupby(account_col, dropna=False)[amount_col].agg(["sum", "mean", "max", "min", "std"]).reset_index()
            amount_stats.rename(columns={
                account_col: "account_id",
                "sum": "transaction_amount_sum",
                "mean": "transaction_amount_mean",
                "max": "transaction_amount_max",
                "min": "transaction_amount_min",
                "std": "transaction_amount_std",
            }, inplace=True)
            grouped = grouped.merge(amount_stats, on="account_id", how="left")
        return grouped

    def build_analytical_dataset(
        self,
        tenant_id: str,
        env_id: str,
        pipeline_id: int,
        *,
        source_dataset_ids: Optional[List[int]] = None,
        dataset_name: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        frames = self._load_selected_sources(tenant_id, env_id, source_dataset_ids=source_dataset_ids)
        if not frames:
            raise ValueError("No source datasets are available for mule analytical build")

        accounts_frame = None
        customers_frame = None
        transactions_frame = None
        enrichment_frames: List[Tuple[str, pd.DataFrame]] = []

        for dataset_type, frame in frames.items():
            if dataset_type in {"accounts", "account"} and accounts_frame is None:
                accounts_frame = frame
            elif dataset_type in {"customers", "customer"} and customers_frame is None:
                customers_frame = frame
            elif dataset_type in {"transactions", "transaction", "txn", "txns", "payments", "transfers"} and transactions_frame is None:
                transactions_frame = frame
            else:
                enrichment_frames.append((dataset_type, frame))

        if accounts_frame is not None:
            base_frame = accounts_frame.copy()
        elif customers_frame is not None:
            base_frame = customers_frame.copy()
        else:
            base_frame = next(iter(frames.values())).copy()
        account_col = _first_existing_column(base_frame.columns, [
            "account_id", "acct_id", "account", "acct_no", "account_number",
            "customer_id", "party_id", "entity_id",
        ])
        if not account_col:
            raise ValueError("Could not identify an account key for mule analytical dataset build")

        base_frame = base_frame.copy()
        base_frame = base_frame.rename(columns={account_col: "account_id"})
        analytical = base_frame.copy()

        if customers_frame is not None and customers_frame is not base_frame:
            customer_key = _first_existing_column(customers_frame.columns, ["account_id", "customer_id", "acct_id", "party_id"])
            if customer_key:
                customers = customers_frame.rename(columns={customer_key: "account_id"}).copy()
                analytical = analytical.merge(customers, on="account_id", how="left", suffixes=("", "_customer"))

        if transactions_frame is not None:
            transaction_key = _first_existing_column(transactions_frame.columns, ["account_id", "acct_id", "customer_id", "party_id"])
            if transaction_key:
                aggregates = self._build_transaction_aggregates(transactions_frame.rename(columns={transaction_key: "account_id"}), "account_id")
                analytical = analytical.merge(aggregates, on="account_id", how="left")

        for source_name, frame in enrichment_frames:
            enrich_key = _first_existing_column(frame.columns, ["account_id", "customer_id", "entity_id", "party_id", "acct_id"])
            if not enrich_key:
                continue
            enrich = frame.rename(columns={enrich_key: "account_id"}).copy()
            analytical = analytical.merge(enrich, on="account_id", how="left", suffixes=("", f"_{source_name}"))

        analytical = analytical.drop_duplicates(subset=["account_id"]).reset_index(drop=True)
        analytical = analytical.replace([pd.NA, float("inf"), float("-inf")], None)

        output_dir = self._mlops_data_dir()
        output_name = _normalize_text(dataset_name) or f"mule_analytical_dataset_{int(pipeline_id)}"
        output_format = "parquet"
        output_path = output_dir / f"{output_name}.parquet"
        try:
            analytical.to_parquet(output_path, index=False)
        except (ImportError, ModuleNotFoundError, ValueError):
            output_format = "csv"
            output_path = output_dir / f"{output_name}.csv"
            analytical.to_csv(output_path, index=False)

        columns_json = json.dumps(list(analytical.columns), default=str)
        column_types_json = json.dumps({col: str(dtype) for col, dtype in analytical.dtypes.items()}, default=str)

        with get_connection(self.db_path) as conn:
            next_dataset_id = conn.execute(
                "SELECT COALESCE(MAX(dataset_id), 0) + 1 FROM mlops_dataset_registry"
            ).fetchone()[0]
            dataset_id = int(next_dataset_id or 1)
            conn.execute(
                """
                INSERT INTO mlops_dataset_registry (
                  dataset_id, tenant_id, env_id, pipeline_type, dataset_type, filename,
                  file_path, row_count, columns_json, column_types_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    dataset_id,
                    tenant_id,
                    env_id,
                    "mule",
                    "analytical_dataset",
                    output_path.name,
                    str(output_path),
                    int(analytical.shape[0]),
                    columns_json,
                    column_types_json,
                ],
            )

        preview_rows = analytical.head(20).fillna("").to_dict(orient="records")
        return {
            "dataset_id": dataset_id,
            "tenant_id": tenant_id,
            "env_id": env_id,
            "pipeline_id": int(pipeline_id),
            "dataset_type": "analytical_dataset",
            "dataset_name": output_name,
            "output_format": output_format,
            "storage_path": str(output_path),
            "row_count": int(analytical.shape[0]),
            "column_count": int(analytical.shape[1]),
            "source_summary": {
                "accounts": bool(accounts_frame is not None),
                "customers": bool(customers_frame is not None),
                "transactions": bool(transactions_frame is not None),
                "enrichments": [name for name, _ in enrichment_frames],
            },
            "preview": preview_rows,
        }
