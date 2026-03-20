from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pandas as pd

from api.tools.mlops.path_utils import resolve_env_root, resolve_mlops_data_dir
from services.db_schema import DatabaseManager
from services.focus_engine import FocusEngine


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    if isinstance(value, Path):
        return str(value)
    return value


def _records_to_df(records: Iterable[Dict[str, Any]]) -> pd.DataFrame:
    rows = [{k: _json_safe(v) for k, v in dict(row).items()} for row in records]
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).replace({pd.NA: None})


def _prepare_sqlite_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame() if df is None else df

    def _normalize(value: Any) -> Any:
        if isinstance(value, (dict, list, tuple, set)):
            try:
                return json.dumps(value, default=str)
            except Exception:
                return str(value)
        return _json_safe(value)

    return df.apply(lambda col: col.map(_normalize))


def _coalesce(row: Dict[str, Any], *keys: str) -> Any:
    lowered = {str(k).lower(): k for k in row.keys()}
    for key in keys:
        actual = lowered.get(str(key).lower())
        if actual is None:
            continue
        value = row.get(actual)
        if value is not None and str(value).strip() != "":
            return value
    return None


def _derive_risk_level(score: float) -> str:
    if score >= 0.85:
        return "Critical"
    if score >= 0.65:
        return "High"
    if score >= 0.40:
        return "Medium"
    return "Low"


def build_investigation_tables(
    scored_rows: List[Dict[str, Any]],
    *,
    model_grain: str = "alert",
) -> Dict[str, pd.DataFrame]:
    cases: Dict[str, Dict[str, Any]] = {}
    alerts: Dict[str, Dict[str, Any]] = {}
    transactions: Dict[str, Dict[str, Any]] = {}
    accounts: Dict[str, Dict[str, Any]] = {}
    customers: Dict[str, Dict[str, Any]] = {}

    grain = "case" if str(model_grain).lower() == "case" else "alert"

    for idx, raw_row in enumerate(scored_rows, start=1):
        row = {str(k): _json_safe(v) for k, v in dict(raw_row).items()}
        entity_id = str(row.get("entity_id") or "").strip() or f"FCC-{idx:06d}"
        score = float(row.get("model_score") or 0.0)
        scored_at = row.get("scored_at") or _now_iso()

        case_id = _coalesce(row, "case_id", "caseid")
        alert_id = _coalesce(row, "alert_id", "alertid")
        transaction_id = _coalesce(row, "transaction_id", "txn_id", "trans_id")
        account_id = _coalesce(row, "account_id", "acct_id", "accountid", "account_no")
        customer_id = _coalesce(row, "customer_id", "cust_id", "customerid")

        if grain == "case":
            case_id = str(case_id or entity_id or f"CSE-{idx:06d}")
            alert_id = str(alert_id or f"ALT-{case_id}")
        else:
            alert_id = str(alert_id or entity_id or f"ALT-{idx:06d}")
            case_id = str(case_id or f"CASE-{alert_id}")

        if transaction_id is not None:
            transaction_id = str(transaction_id)
        if account_id is not None:
            account_id = str(account_id)
        if customer_id is not None:
            customer_id = str(customer_id)

        created_at = _coalesce(
            row,
            "created_at",
            "alert_created_at",
            "txn_timestamp",
            "transaction_date",
            "txn_date",
            "date",
            "time",
        ) or scored_at
        amount = _coalesce(row, "txn_amount", "transaction_amount", "amount", "amt", "value")
        counterparty_account = _coalesce(
            row,
            "counterparty_account",
            "counterparty_account_id",
            "to_account",
            "beneficiary_account",
            "receiver_account",
            "cp_account",
        )
        customer_name = _coalesce(row, "customer_name", "name", "customer")
        alert_type = _coalesce(
            row,
            "alert_type",
            "rule_name",
            "scenario",
            "typology",
            "alert_category",
        ) or "FCC retained queue"
        risk_level = _coalesce(row, "risk_rating", "risk_level", "severity") or _derive_risk_level(score)
        account_type = _coalesce(row, "account_type", "product_type", "acct_type")
        customer_country = _coalesce(row, "country", "customer_country", "nationality")
        customer_segment = _coalesce(row, "segment", "customer_segment", "customer_type")

        cases.setdefault(
            case_id,
            {
                "case_id": case_id,
                "alert_type": str(alert_type),
                "created_at": str(created_at),
                "risk_rating": str(risk_level),
                "customer_name": str(customer_name or customer_id or "Unknown"),
                "customer_id": customer_id,
                "account_id": account_id,
                "risk_score": round(score * 100, 2),
                "status": "NEW",
                "fcc_source_run_id": row.get("run_id"),
                "fcc_source_batch_id": row.get("batch_id"),
                "fcc_deployment_id": row.get("deployment_id"),
                "fcc_decision": row.get("decision"),
                "fcc_reason_code": row.get("reason_code"),
            },
        )

        alerts.setdefault(
            alert_id,
            {
                "alert_id": alert_id,
                "case_id": case_id,
                "alert_type": str(alert_type),
                "created_at": str(created_at),
                "customer_id": customer_id,
                "account_id": account_id,
                "transaction_id": transaction_id,
                "amount": amount,
                "severity": str(risk_level),
                "status": "OPEN",
                "fcc_score": round(score, 6),
                "fcc_decision": row.get("decision"),
                "fcc_reason_code": row.get("reason_code"),
            },
        )

        if transaction_id or account_id or amount or counterparty_account:
            txn_key = str(transaction_id or f"TXN-{alert_id}")
            transactions.setdefault(
                txn_key,
                {
                    "transaction_id": txn_key,
                    "case_id": case_id,
                    "account_id": account_id,
                    "customer_id": customer_id,
                    "counterparty_account": counterparty_account,
                    "txn_timestamp": str(created_at),
                    "amount": amount,
                    "direction": _coalesce(row, "direction", "dr_cr", "debit_credit", "type"),
                    "fcc_score": round(score, 6),
                    "fcc_decision": row.get("decision"),
                },
            )

        if account_id:
            accounts.setdefault(
                account_id,
                {
                    "account_id": account_id,
                    "case_id": case_id,
                    "customer_id": customer_id,
                    "account_type": account_type,
                    "risk_rating": str(risk_level),
                    "status": "ACTIVE",
                },
            )

        if customer_id:
            customers.setdefault(
                customer_id,
                {
                    "customer_id": customer_id,
                    "case_id": case_id,
                    "customer_name": str(customer_name or customer_id),
                    "risk_rating": str(risk_level),
                    "segment": customer_segment,
                    "country": customer_country,
                },
            )

    return {
        "cases": _records_to_df(cases.values()),
        "alerts": _records_to_df(alerts.values()),
        "transactions": _records_to_df(transactions.values()),
        "accounts": _records_to_df(accounts.values()),
        "customers": _records_to_df(customers.values()),
    }


class FCCSentinelBridgeService:
    CORE_REPLACE_TABLES = (
        "alerts",
        "transactions",
        "accounts",
        "customers",
        "cases",
        "master_case_summary",
        "master_cleaned_data",
        "focus_runs",
        "focus_results",
        "active_case_scope",
        "fcc_bridge_imports",
        "fcc_scored_entities",
    )

    def __init__(self, env_root: str | Path):
        self.env_root = Path(env_root)
        self.mlops_data_dir = resolve_mlops_data_dir(self.env_root)
        self.scored_batches_dir = self.mlops_data_dir / "scored_batches"
        self.publish_dir = self.mlops_data_dir / "fcc_sentinel_published"
        self.scored_batches_dir.mkdir(parents=True, exist_ok=True)
        self.publish_dir.mkdir(parents=True, exist_ok=True)

    def _batch_dir(self, batch_id: str) -> Path:
        return self.scored_batches_dir / str(batch_id)

    def _publish_dir(self, publish_id: str) -> Path:
        return self.publish_dir / str(publish_id)

    def _table_has_rows(self, cursor, table_name: str) -> bool:
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (str(table_name),),
        )
        if cursor.fetchone() is None:
            return False
        try:
            cursor.execute(f'SELECT COUNT(*) FROM "{table_name}"')
            row = cursor.fetchone()
            return int((row[0] if row else 0) or 0) > 0
        except Exception:
            return True

    def _existing_target_tables(self, cursor) -> List[str]:
        populated_tables: List[str] = []
        for table_name in self.CORE_REPLACE_TABLES:
            if self._table_has_rows(cursor, table_name):
                populated_tables.append(table_name)
        return populated_tables

    def list_scored_batches(
        self,
        *,
        run_id: Optional[str] = None,
        deployment_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for manifest_path in self.scored_batches_dir.glob("*/manifest.json"):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if run_id and str(manifest.get("run_id") or "") != str(run_id):
                continue
            if deployment_id and str(manifest.get("deployment_id") or "") != str(deployment_id):
                continue
            rows.append(manifest)
        rows.sort(key=lambda row: str(row.get("scored_at") or row.get("created_at") or ""), reverse=True)
        return rows

    def _load_scored_rows(self, batch_id: str) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
        batch_dir = self._batch_dir(batch_id)
        manifest_path = batch_dir / "manifest.json"
        rows_path = batch_dir / "scored_records.json"
        if not manifest_path.exists() or not rows_path.exists():
            raise FileNotFoundError(f"Scored batch package not found for batch_id={batch_id}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        rows = json.loads(rows_path.read_text(encoding="utf-8"))
        return manifest, rows

    def publish_batch(
        self,
        *,
        batch_id: Optional[str] = None,
        run_id: Optional[str] = None,
        deployment_id: Optional[str] = None,
        include_suppressed: bool = False,
        publish_label: Optional[str] = None,
    ) -> Dict[str, Any]:
        resolved_batch_id = str(batch_id or "").strip()
        if not resolved_batch_id:
            candidates = self.list_scored_batches(run_id=run_id, deployment_id=deployment_id)
            if not candidates:
                raise FileNotFoundError("No scored FCC batches available to publish")
            resolved_batch_id = str(candidates[0].get("batch_id") or "")
        manifest, scored_rows = self._load_scored_rows(resolved_batch_id)
        rows = list(scored_rows)
        if not include_suppressed:
            rows = [row for row in rows if str(row.get("decision") or "").lower() == "escalated"]
        if not rows:
            raise ValueError("No retained FCC rows available to publish to Sentinel")

        publish_id = f"PUB-{uuid.uuid4().hex[:12]}"
        publish_dir = self._publish_dir(publish_id)
        publish_dir.mkdir(parents=True, exist_ok=True)

        tables = build_investigation_tables(rows, model_grain=str(manifest.get("model_grain") or manifest.get("entity_type") or "alert"))
        published_manifest = {
            "publish_id": publish_id,
            "publish_label": str(publish_label or f"FCC publish {resolved_batch_id[:8]}").strip(),
            "source_env_id": self.env_root.name,
            "source_batch_id": resolved_batch_id,
            "run_id": manifest.get("run_id"),
            "deployment_id": manifest.get("deployment_id"),
            "model_grain": manifest.get("model_grain"),
            "threshold": manifest.get("threshold"),
            "published_at": _now_iso(),
            "include_suppressed": bool(include_suppressed),
            "total_scored_rows": int(manifest.get("total", 0) or 0),
            "published_rows": len(rows),
            "suppressed_rows_excluded": max(int(manifest.get("suppressed", 0) or 0), 0) if not include_suppressed else 0,
            "table_counts": {name: int(len(df.index)) for name, df in tables.items()},
        }

        (publish_dir / "manifest.json").write_text(json.dumps(published_manifest, indent=2, default=_json_safe), encoding="utf-8")
        (publish_dir / "scored_records.json").write_text(json.dumps(rows, indent=2, default=_json_safe), encoding="utf-8")
        for table_name, df in tables.items():
            (publish_dir / f"{table_name}.json").write_text(df.to_json(orient="records", indent=2), encoding="utf-8")

        return published_manifest

    def list_published_runs(self) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for manifest_path in self.publish_dir.glob("*/manifest.json"):
            try:
                rows.append(json.loads(manifest_path.read_text(encoding="utf-8")))
            except Exception:
                continue
        rows.sort(key=lambda row: str(row.get("published_at") or ""), reverse=True)
        return rows

    def import_published_run(
        self,
        *,
        publish_id: str,
        tenant_id: str,
        target_env_id: str,
        replace_existing: bool = False,
        rerank_after_import: bool = True,
    ) -> Dict[str, Any]:
        publish_dir = self._publish_dir(publish_id)
        manifest_path = publish_dir / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"Published FCC package not found for publish_id={publish_id}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        target_env_root = resolve_env_root(target_env_id, tenant_id, create_if_missing=True)
        metadata_style_db = target_env_root / "investigation" / "investigation.db"
        flat_db = target_env_root / "investigation.db"
        if metadata_style_db.exists() or (target_env_root / "investigation").exists():
            target_db_path = metadata_style_db
        else:
            target_db_path = flat_db
        db_manager = DatabaseManager(str(target_db_path))
        db_manager.init_schema()

        tables: Dict[str, pd.DataFrame] = {}
        for table_name in ("cases", "alerts", "transactions", "accounts", "customers"):
            table_path = publish_dir / f"{table_name}.json"
            if not table_path.exists():
                tables[table_name] = pd.DataFrame()
                continue
            try:
                payload = json.loads(table_path.read_text(encoding="utf-8"))
            except Exception:
                payload = []
            tables[table_name] = _records_to_df(payload)

        scored_records_path = publish_dir / "scored_records.json"
        scored_records = []
        if scored_records_path.exists():
            try:
                scored_records = json.loads(scored_records_path.read_text(encoding="utf-8"))
            except Exception:
                scored_records = []

        conn = db_manager.connect()
        try:
            cursor = conn.cursor()
            existing_tables = self._existing_target_tables(cursor)
            if existing_tables and not replace_existing:
                preview = ", ".join(existing_tables[:4])
                if len(existing_tables) > 4:
                    preview += ", ..."
                raise ValueError(
                    f'Target environment "{target_env_id}" already contains investigation data in '
                    f"{preview}. Create a fresh workspace or enable replace_existing to overwrite it."
                )
            if replace_existing:
                for table_name in self.CORE_REPLACE_TABLES:
                    cursor.execute(f'DROP TABLE IF EXISTS "{table_name}"')
                conn.commit()

            for table_name, df in tables.items():
                if df.empty:
                    continue
                df.to_sql(table_name, conn, if_exists="replace", index=False)

            cases_df = tables.get("cases", pd.DataFrame())
            if not cases_df.empty:
                cases_df.to_sql("master_case_summary", conn, if_exists="replace", index=False)
                cases_df.to_sql("master_cleaned_data", conn, if_exists="replace", index=False)

            scored_df = _records_to_df(scored_records)
            if not scored_df.empty:
                scored_df = _prepare_sqlite_df(scored_df)
                scored_df.to_sql("fcc_scored_entities", conn, if_exists="replace", index=False)

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS fcc_bridge_imports (
                    import_id TEXT PRIMARY KEY,
                    publish_id TEXT,
                    source_env_id TEXT,
                    target_env_id TEXT,
                    imported_at TEXT,
                    run_id TEXT,
                    deployment_id TEXT,
                    imported_rows INTEGER,
                    replace_existing INTEGER
                )
                """
            )
            cursor.execute(
                """
                INSERT INTO fcc_bridge_imports
                  (import_id, publish_id, source_env_id, target_env_id, imported_at, run_id, deployment_id, imported_rows, replace_existing)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (
                    f"IMP-{uuid.uuid4().hex[:12]}",
                    publish_id,
                    manifest.get("source_env_id"),
                    target_env_id,
                    _now_iso(),
                    manifest.get("run_id"),
                    manifest.get("deployment_id"),
                    int(manifest.get("published_rows") or 0),
                    1 if replace_existing else 0,
                ),
            )
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        focus_result = None
        alerts_df = tables.get("alerts", pd.DataFrame())
        if rerank_after_import and not alerts_df.empty:
            try:
                focus_engine = FocusEngine(db_manager)
                focus_result = focus_engine.run_focus_job()
            except Exception as exc:
                focus_result = {"success": False, "error": str(exc)}

        return {
            "success": True,
            "publish_id": publish_id,
            "source_env_id": manifest.get("source_env_id"),
            "target_env_id": target_env_id,
            "imported_at": _now_iso(),
            "table_counts": {name: int(len(df.index)) for name, df in tables.items()},
            "focus_result": focus_result,
        }
