from __future__ import annotations

import json
import random
import shutil
import uuid
from datetime import datetime, timedelta
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


def _with_sentinel_aliases(df: pd.DataFrame, aliases: Dict[str, Any]) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame() if df is None else df
    out = df.copy()
    lowered = {str(col).lower(): col for col in out.columns}
    for source, alias in aliases.items():
        source_col = lowered.get(str(source).lower())
        if not source_col:
            continue
        alias_list = alias if isinstance(alias, (list, tuple, set)) else [alias]
        for target_alias in alias_list:
            if str(target_alias).lower() in {str(col).lower() for col in out.columns}:
                continue
            out[target_alias] = out[source_col]
    return out


def _ready_for_sentinel(tables: Dict[str, pd.DataFrame]) -> Dict[str, pd.DataFrame]:
    return {
        "cases": _with_sentinel_aliases(
            tables.get("cases", pd.DataFrame()),
            {
                "case_id": ["CASE_ID", "Case_ID"],
                "alert_type": "ALERT_TYPE",
                "created_at": "CREATED_AT",
                "risk_rating": "RISK_RATING",
                "customer_id": ["CUSTOMER_ID", "Customer_ID"],
                "account_id": ["ACCOUNT_ID", "Account_ID"],
                "risk_score": "RISK_SCORE",
                "status": "STATUS",
            },
        ),
        "alerts": _with_sentinel_aliases(
            tables.get("alerts", pd.DataFrame()),
            {
                "alert_id": ["ALERT_ID", "Alert_ID"],
                "case_id": ["CASE_ID", "Case_ID"],
                "account_id": ["ACCOUNT_ID", "Account_ID"],
                "customer_id": ["CUSTOMER_ID", "Customer_ID"],
                "transaction_id": ["TRANSACTION_ID", "Transaction_ID"],
                "amount": "AMOUNT",
                "severity": "SEVERITY",
                "status": "STATUS",
                "fcc_score": "FCC_SCORE",
            },
        ),
        "transactions": _with_sentinel_aliases(
            tables.get("transactions", pd.DataFrame()),
            {
                "transaction_id": ["TRANSACTION_ID", "Transaction_ID"],
                "case_id": ["CASE_ID", "Case_ID"],
                "account_id": ["ACCOUNT_ID", "Account_ID"],
                "customer_id": ["CUSTOMER_ID", "Customer_ID"],
                "counterparty_account": "COUNTERPARTY_ACCOUNT",
                "txn_timestamp": "TXN_TIMESTAMP",
                "amount": "AMOUNT",
                "direction": "DIRECTION",
                "fcc_score": "FCC_SCORE",
            },
        ),
        "accounts": _with_sentinel_aliases(
            tables.get("accounts", pd.DataFrame()),
            {
                "account_id": ["ACCOUNT_ID", "Account_ID"],
                "case_id": ["CASE_ID", "Case_ID"],
                "customer_id": ["CUSTOMER_ID", "Customer_ID"],
                "account_type": "ACCOUNT_TYPE",
                "risk_rating": "RISK_RATING",
                "status": "STATUS",
            },
        ),
        "customers": _with_sentinel_aliases(
            tables.get("customers", pd.DataFrame()),
            {
                "customer_id": ["CUSTOMER_ID", "Customer_ID"],
                "case_id": ["CASE_ID", "Case_ID"],
                "customer_name": "CUSTOMER_NAME",
                "risk_rating": "RISK_RATING",
                "segment": "SEGMENT",
                "country": "COUNTRY",
            },
        ),
    }


def _prepare_sqlite_df(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame() if df is None else df

    # SQLite treats column names case-insensitively, so collapse duplicates like
    # KYC_INCOMPLETE_FLAG vs kyc_incomplete_flag before writing or merging.
    grouped_columns: Dict[str, Dict[str, Any]] = {}
    for index, raw_col in enumerate(list(df.columns)):
        col_name = str(raw_col or "").strip() or f"column_{index}"
        key = col_name.lower()
        meta = grouped_columns.setdefault(
            key,
            {"name": col_name, "indexes": []},
        )
        meta["indexes"].append(index)

    normalized_df = pd.DataFrame(index=df.index)
    for meta in grouped_columns.values():
        series = None
        for index in meta["indexes"]:
            next_series = df.iloc[:, index]
            series = next_series.copy() if series is None else series.combine_first(next_series)
        normalized_df[meta["name"]] = series

    def _normalize(value: Any) -> Any:
        if isinstance(value, (dict, list, tuple, set)):
            try:
                return json.dumps(value, default=str)
            except Exception:
                return str(value)
        return _json_safe(value)

    return normalized_df.apply(lambda col: col.map(_normalize))


def _read_sqlite_table(conn, table_name: str) -> pd.DataFrame:
    try:
        return pd.read_sql(f'SELECT * FROM "{table_name}"', conn)
    except Exception:
        return pd.DataFrame()


def _resolve_target_db_path(target_env_root: Path) -> Path:
    """Choose the investigation DB file the live Sentinel routes will read."""
    root = Path(target_env_root)
    existing_candidates = [
        root / "database.db",
        root / "investigation" / "investigation.db",
        root / "investigation.db",
    ]
    ranked_candidates = []
    for candidate in existing_candidates:
        if not candidate.exists():
            continue
        try:
            size = int(candidate.stat().st_size or 0)
        except Exception:
            size = 0
        useful_tables = 0
        try:
            import sqlite3
            with sqlite3.connect(candidate) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
                table_names = {str(row[0] or "").strip().lower() for row in cursor.fetchall()}
            useful_tables = sum(
                1
                for name in ("cases", "alerts", "focus_results", "focus_runs", "fcc_bridge_imports")
                if name in table_names
            )
        except Exception:
            useful_tables = 0
        ranked_candidates.append(((useful_tables, size), candidate))
    if ranked_candidates:
        ranked_candidates.sort(key=lambda item: item[0], reverse=True)
        return ranked_candidates[0][1]

    if (root / "investigation").exists():
        return root / "investigation" / "investigation.db"
    return root / "database.db"


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


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or str(value).strip() == "":
            return float(default)
        return float(value)
    except Exception:
        return float(default)


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or str(value).strip() == "":
            return int(default)
        return int(float(value))
    except Exception:
        return int(default)


def _numeric_suffix(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _normalize_enterprise_case_id(
    raw_case_id: Any,
    *,
    alert_id: Any = None,
    idx: int = 1,
    used_ids: Optional[set[str]] = None,
) -> str:
    used_ids = used_ids if used_ids is not None else set()
    preferred_seeds = [raw_case_id, alert_id, idx]
    for seed in preferred_seeds:
        digits = _numeric_suffix(seed)
        if not digits:
            continue
        candidate = f"CASE{int(digits):07d}"
        if candidate not in used_ids:
            used_ids.add(candidate)
            return candidate

    fallback_number = max(len(used_ids) + 1, int(idx or 1))
    while True:
        candidate = f"CASE{fallback_number:07d}"
        if candidate not in used_ids:
            used_ids.add(candidate)
            return candidate
        fallback_number += 1


def _parse_datetime(value: Any, default: Optional[datetime] = None) -> datetime:
    if isinstance(value, datetime):
        return value
    if value is None:
        return default or datetime.utcnow()
    try:
        text = str(value).strip()
        if not text:
            return default or datetime.utcnow()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is not None:
            return parsed.replace(tzinfo=None)
        return parsed
    except Exception:
        return default or datetime.utcnow()


def _normalize_risk_level(value: Any, score_hint: Optional[float] = None) -> str:
    text = str(value or "").strip().lower()
    if text in {"critical", "crit"}:
        return "Critical"
    if text in {"high", "severe"}:
        return "High"
    if text in {"medium", "moderate"}:
        return "Medium"
    if text in {"low", "normal"}:
        return "Low"
    normalized_score = _safe_float(score_hint)
    if normalized_score > 1.0:
        normalized_score = normalized_score / 100.0
    return _derive_risk_level(normalized_score)


def _priority_from_risk_level(risk_level: str, risk_score: float) -> str:
    normalized = str(risk_level or "").strip().lower()
    if normalized == "critical" or risk_score >= 88:
        return "High"
    if normalized == "high" or risk_score >= 65:
        return "Medium"
    return "Low"


def _historical_frequency_label(txn_count: int) -> str:
    if txn_count >= 22:
        return "Dense"
    if txn_count >= 10:
        return "Active"
    if txn_count >= 4:
        return "Moderate"
    return "Sparse"


def _iso_z(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat() + "Z"


def _ensure_sentinel_case_linkage(tables: Dict[str, pd.DataFrame]) -> Dict[str, pd.DataFrame]:
    """
    Guarantee each Sentinel case has customer/account linkage and transaction evidence.
    This keeps Rule Engine and Baseline usable after FCC advanced-context imports.
    """
    prepared = _ready_for_sentinel(tables)
    cases = prepared.get("cases", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    alerts = prepared.get("alerts", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    transactions = prepared.get("transactions", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    accounts = prepared.get("accounts", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    customers = prepared.get("customers", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")

    alerts_by_case: Dict[str, List[Dict[str, Any]]] = {}
    txns_by_case: Dict[str, List[Dict[str, Any]]] = {}
    accounts_by_id: Dict[str, Dict[str, Any]] = {}
    customers_by_id: Dict[str, Dict[str, Any]] = {}

    for row in alerts:
        case_id = str(_coalesce(row, "case_id", "CASE_ID", "caseid") or "").strip()
        if case_id:
            alerts_by_case.setdefault(case_id, []).append(row)
    for row in transactions:
        case_id = str(_coalesce(row, "case_id", "CASE_ID", "caseid") or "").strip()
        if case_id:
            txns_by_case.setdefault(case_id, []).append(row)
    for row in accounts:
        account_id = str(_coalesce(row, "account_id", "ACCOUNT_ID", "acct_id") or "").strip()
        if account_id:
            accounts_by_id[account_id] = row
    for row in customers:
        customer_id = str(_coalesce(row, "customer_id", "CUSTOMER_ID", "cust_id") or "").strip()
        if customer_id:
            customers_by_id[customer_id] = row

    used_txn_ids = {
        str(_coalesce(row, "transaction_id", "TRANSACTION_ID", "txn_id") or "").strip()
        for row in transactions
    }
    used_txn_ids.discard("")

    for idx, case_row in enumerate(cases, start=1):
        case_id = str(_coalesce(case_row, "case_id", "CASE_ID", "caseid") or "").strip()
        if not case_id:
            continue

        case_alerts = alerts_by_case.get(case_id, [])
        case_txns = txns_by_case.get(case_id, [])
        lookup_rows = [case_row] + case_alerts + case_txns
        seed = _numeric_suffix(case_id) or f"{idx:06d}"

        customer_id = str(_coalesce(case_row, "customer_id", "CUSTOMER_ID", "cust_id") or "").strip()
        if not customer_id and case_alerts:
            customer_id = str(_coalesce(case_alerts[0], "customer_id", "CUSTOMER_ID", "cust_id") or "").strip()
        if not customer_id:
            customer_id = str(_coalesce(case_txns[0], "customer_id", "CUSTOMER_ID", "cust_id") if case_txns else "").strip()
        if not customer_id:
            customer_id = f"CUST-{seed.zfill(6)[-6:]}"

        account_id = str(_coalesce(case_row, "account_id", "ACCOUNT_ID", "acct_id") or "").strip()
        if not account_id and case_alerts:
            account_id = str(_coalesce(case_alerts[0], "account_id", "ACCOUNT_ID", "acct_id") or "").strip()
        if not account_id:
            account_id = str(_coalesce(case_txns[0], "account_id", "ACCOUNT_ID", "acct_id") if case_txns else "").strip()
        if not account_id:
            account_id = f"ACCT-{seed.zfill(6)[-6:]}"

        case_row["customer_id"] = customer_id
        case_row["account_id"] = account_id
        case_row.setdefault("customer_name", f"Customer {seed.zfill(6)[-6:]}")

        for alert_row in case_alerts:
            alert_row["case_id"] = case_id
            alert_row["customer_id"] = str(_coalesce(alert_row, "customer_id", "CUSTOMER_ID", "cust_id") or customer_id)
            alert_row["account_id"] = str(_coalesce(alert_row, "account_id", "ACCOUNT_ID", "acct_id") or account_id)

        for txn_row in case_txns:
            txn_row["case_id"] = case_id
            txn_row["customer_id"] = str(_coalesce(txn_row, "customer_id", "CUSTOMER_ID", "cust_id") or customer_id)
            txn_row["account_id"] = str(_coalesce(txn_row, "account_id", "ACCOUNT_ID", "acct_id") or account_id)

        accounts_by_id.setdefault(
            account_id,
            {
                "account_id": account_id,
                "case_id": case_id,
                "customer_id": customer_id,
                "account_type": "Operating Account",
                "risk_rating": str(_coalesce(case_row, "risk_rating", "RISK_RATING") or "Medium"),
                "status": "ACTIVE",
                "current_balance": 250000,
            },
        )
        customers_by_id.setdefault(
            customer_id,
            {
                "customer_id": customer_id,
                "case_id": case_id,
                "customer_name": str(_coalesce(case_row, "customer_name", "CUSTOMER_NAME") or f"Customer {seed.zfill(6)[-6:]}"),
                "risk_rating": str(_coalesce(case_row, "risk_rating", "RISK_RATING") or "Medium"),
                "segment": "Commercial",
                "country": "IN",
            },
        )

        if case_txns:
            continue

        base_alert = case_alerts[0] if case_alerts else {}
        base_dt = _parse_datetime(
            _coalesce(case_row, "created_at", "CREATED_AT")
            or _coalesce(base_alert, "created_at", "CREATED_AT", "alert_date")
            or _now_iso(),
        )
        base_amount = _safe_float(
            _coalesce(base_alert, "amount", "AMOUNT")
            or _coalesce(case_row, "amount", "AMOUNT", "risk_score", "RISK_SCORE"),
            default=45000.0,
        )
        if base_amount <= 0:
            base_amount = 45000.0
        for offset in range(8):
            txn_id = f"TXN-AUTO-{seed.zfill(6)[-6:]}-{offset + 1:02d}"
            while txn_id in used_txn_ids:
                txn_id = f"{txn_id}-{len(used_txn_ids) + 1}"
            used_txn_ids.add(txn_id)
            tx_dt = base_dt - timedelta(days=(offset + 1) * 9, hours=offset * 2)
            amount = round(max(2500.0, base_amount * (0.55 + (offset % 4) * 0.18)), 2)
            txn_row = {
                "transaction_id": txn_id,
                "case_id": case_id,
                "account_id": account_id,
                "customer_id": customer_id,
                "counterparty_account": f"CP-{seed.zfill(6)[-6:]}-{offset + 1:02d}",
                "txn_timestamp": _iso_z(tx_dt),
                "amount": amount,
                "direction": "DEBIT" if offset % 2 else "CREDIT",
                "channel": ["NEFT", "IMPS", "RTGS", "CASH"][offset % 4],
                "beneficiary_country": ["IN", "AE", "SG", "US"][offset % 4],
                "typology_type": str(_coalesce(base_alert, "rule_triggered", "typology_type") or "FCC_RETAINED_ALERT"),
                "narrative": "Generated Sentinel investigation context for FCC-retained case",
                "fcc_bridge_context_role": "repaired_case_transaction",
            }
            transactions.append(txn_row)
            txns_by_case.setdefault(case_id, []).append(txn_row)

        if case_alerts:
            case_alerts[0]["transaction_id"] = str(_coalesce(case_alerts[0], "transaction_id", "TRANSACTION_ID") or txns_by_case[case_id][0]["transaction_id"])

    return _ready_for_sentinel(
        {
            "cases": _records_to_df(cases),
            "alerts": _records_to_df(alerts),
            "transactions": _records_to_df(transactions),
            "accounts": _records_to_df(accounts_by_id.values()),
            "customers": _records_to_df(customers_by_id.values()),
        }
    )


def _sentinel_rule_profile(rule_value: Any, idx: int, score: float) -> Dict[str, Any]:
    text = str(rule_value or "").upper()
    if "STRUCTUR" in text:
        return {
            "key": "structuring",
            "alert_type": "Repeated threshold-sized cash activity",
            "channels": ["BRANCH", "ATM", "CASH"],
            "txn_types": ["CASH_DEPOSIT", "CASH_DEPOSIT", "NEFT"],
            "countries": ["IN", "IN", "AE"],
            "amount_band": (9100, 9850),
            "txn_count": 8 + (idx % 3),
            "typology": "STRUCTURING",
            "narrative": "Repeated deposits just below the reporting threshold",
        }
    if "VELOCITY" in text or "RAPID" in text:
        return {
            "key": "velocity",
            "alert_type": "Velocity spike across rapid transfers",
            "channels": ["MOBILE", "WEB", "IMPS"],
            "txn_types": ["IMPS", "UPI", "RTGS"],
            "countries": ["IN", "SG", "AE"],
            "amount_band": (12000, 65000),
            "txn_count": 10 + (idx % 4),
            "typology": "VELOCITY_SPIKE",
            "narrative": "Short-window burst of transfer activity",
        }
    if "HIGH_RISK_DEST" in text or "HIGH RISK" in text or "DEST" in text:
        return {
            "key": "high_risk_destination",
            "alert_type": "High-risk destination corridor",
            "channels": ["SWIFT", "RTGS", "WEB"],
            "txn_types": ["SWIFT", "RTGS", "NEFT"],
            "countries": ["KY", "VG", "NG", "AE"],
            "amount_band": (65000, 280000),
            "txn_count": 7 + (idx % 4),
            "typology": "HIGH_RISK_DESTINATION",
            "narrative": "Funds moved through higher-risk beneficiary corridors",
        }
    if "LAYER" in text:
        return {
            "key": "layering",
            "alert_type": "Layering through multiple counterparties",
            "channels": ["SWIFT", "NEFT", "RTGS"],
            "txn_types": ["SWIFT", "NEFT", "INTERNAL_TRANSFER"],
            "countries": ["SG", "HK", "AE", "GB"],
            "amount_band": (45000, 180000),
            "txn_count": 9 + (idx % 3),
            "typology": "LAYERING",
            "narrative": "Multi-hop movement through related counterparties",
        }
    if "MULE" in text:
        return {
            "key": "mule",
            "alert_type": "Mule-account pass-through activity",
            "channels": ["UPI", "IMPS", "MOBILE"],
            "txn_types": ["UPI", "IMPS", "NEFT"],
            "countries": ["IN", "NP", "AE"],
            "amount_band": (4500, 42000),
            "txn_count": 8 + (idx % 4),
            "typology": "MULE",
            "narrative": "Funds pass quickly through a low-balance relationship",
        }
    high_value_floor = 75000 if score >= 0.65 else 25000
    return {
        "key": "high_value_cash",
        "alert_type": "High-value cash or transfer activity",
        "channels": ["BRANCH", "RTGS", "NEFT"],
        "txn_types": ["CASH_DEPOSIT", "RTGS", "NEFT"],
        "countries": ["IN", "US", "AE"],
        "amount_band": (high_value_floor, max(high_value_floor + 50000, int(high_value_floor * 2.4))),
        "txn_count": 6 + (idx % 4),
        "typology": "HIGH_VALUE_CASH",
        "narrative": "Unusually large movement compared with expected behavior",
    }


def _demo_transaction_rows(
    *,
    case_id: str,
    alert_id: str,
    transaction_id: str,
    account_id: str,
    customer_id: str,
    counterparty_account: str,
    created_dt: datetime,
    amount: float,
    score: float,
    rule_value: Any,
    idx: int,
    row: Dict[str, Any],
    pipeline_id: Any,
    pipeline_name: Any,
    publish_id: Any,
    publish_label: Any,
) -> List[Dict[str, Any]]:
    profile = _sentinel_rule_profile(rule_value, idx, score)
    rng = random.Random(f"{case_id}|{alert_id}|{transaction_id}|{profile['key']}")
    low, high = profile["amount_band"]
    base_amount = max(float(amount or 0.0), float(low))
    count = int(profile["txn_count"])
    rows: List[Dict[str, Any]] = []

    for txn_idx in range(count):
        if profile["key"] == "velocity":
            tx_dt = created_dt - timedelta(hours=max(count - txn_idx, 1), minutes=rng.randint(2, 55))
        elif profile["key"] == "structuring":
            tx_dt = created_dt - timedelta(days=(count - txn_idx) * 2 + rng.randint(0, 2), hours=rng.randint(1, 22))
        elif profile["key"] == "layering":
            tx_dt = created_dt - timedelta(days=(count - txn_idx) * rng.choice([3, 5, 8]), hours=rng.randint(0, 23))
        else:
            tx_dt = created_dt - timedelta(days=(count - txn_idx) * rng.choice([4, 7, 11]), hours=rng.randint(0, 23))

        if profile["key"] == "structuring":
            txn_amount = round(rng.uniform(low, high), 2)
        elif profile["key"] == "velocity":
            txn_amount = round(rng.uniform(low, high) * rng.uniform(0.65, 1.25), 2)
        else:
            txn_amount = round(max(base_amount * rng.uniform(0.42, 1.45), rng.uniform(low, high)), 2)

        cp_suffix = (txn_idx % max(2, min(6, count))) + 1
        cp_account = counterparty_account if txn_idx == 0 else f"{counterparty_account}-{cp_suffix:02d}"
        direction = "CREDIT" if (profile["key"] in {"mule", "layering"} and txn_idx % 3 == 0) else "DEBIT"
        txn_type = rng.choice(profile["txn_types"])
        channel = rng.choice(profile["channels"])
        country = rng.choice(profile["countries"])
        tx_id = transaction_id if txn_idx == 0 else f"{transaction_id}-CTX-{txn_idx + 1:02d}"

        rows.append(
            {
                "transaction_id": tx_id,
                "case_id": case_id,
                "alert_id": alert_id,
                "account_id": account_id,
                "customer_id": customer_id,
                "counterparty_account": cp_account,
                "counterparty_customer_id": f"CUST-{cp_account}",
                "txn_timestamp": _iso_z(tx_dt),
                "created_at": _iso_z(tx_dt),
                "amount": txn_amount,
                "txn_amount": txn_amount,
                "direction": direction,
                "txn_type": txn_type,
                "channel": channel,
                "beneficiary_country": country,
                "counterparty_country": country,
                "party": cp_account,
                "narrative": profile["narrative"],
                "typology_type": profile["typology"],
                "rule_triggered": str(rule_value or profile["typology"]),
                "fcc_score": round(score, 6),
                "fcc_decision": row.get("decision"),
                "fcc_reason_code": row.get("reason_code"),
                "fcc_pipeline_id": pipeline_id,
                "fcc_pipeline_name": pipeline_name,
                "fcc_publish_id": publish_id,
                "fcc_publish_label": publish_label,
            }
        )

    return rows


def _profile_templates() -> List[Dict[str, Any]]:
    return [
        {
            "key": "dense_network",
            "label": "Rapid movement across shared counterparties",
            "txn_range": (18, 30),
            "prior_alert_range": (3, 6),
            "prior_case_range": (1, 3),
            "linked_case_range": (2, 5),
            "counterparty_range": (4, 7),
            "channels": ["SWIFT", "RTGS", "NEFT"],
            "countries": ["AE", "SG", "HK", "GB"],
            "typologies": ["LAYERING", "RAPID_MOVEMENT"],
            "amount_band": (85000, 360000),
            "customer_segment": "CORPORATE",
        },
        {
            "key": "structuring",
            "label": "Repeated threshold-sized cash and transfer activity",
            "txn_range": (9, 16),
            "prior_alert_range": (2, 4),
            "prior_case_range": (1, 2),
            "linked_case_range": (1, 3),
            "counterparty_range": (2, 4),
            "channels": ["CASH", "UPI", "NEFT"],
            "countries": ["IN", "AE"],
            "typologies": ["STRUCTURING", "HIGH_VALUE_CASH"],
            "amount_band": (9000, 55000),
            "customer_segment": "RETAIL",
        },
        {
            "key": "legacy_repeat",
            "label": "Recurring alerts on an already known relationship",
            "txn_range": (12, 20),
            "prior_alert_range": (4, 7),
            "prior_case_range": (2, 4),
            "linked_case_range": (2, 4),
            "counterparty_range": (2, 5),
            "channels": ["NEFT", "IMPS", "RTGS"],
            "countries": ["IN", "SG", "US"],
            "typologies": ["MULE", "RAPID_MOVEMENT"],
            "amount_band": (35000, 180000),
            "customer_segment": "SME",
        },
        {
            "key": "noisy_commercial",
            "label": "High-volume commercial behavior with a few suspicious spikes",
            "txn_range": (16, 26),
            "prior_alert_range": (1, 3),
            "prior_case_range": (0, 1),
            "linked_case_range": (0, 2),
            "counterparty_range": (5, 8),
            "channels": ["UPI", "NEFT", "CARD", "RTGS"],
            "countries": ["IN", "AE", "GB"],
            "typologies": ["NONE", "NONE", "VELOCITY_SPIKE"],
            "amount_band": (12000, 90000),
            "customer_segment": "COMMERCIAL",
        },
        {
            "key": "sparse_watch",
            "label": "Sparse history with limited prior review activity",
            "txn_range": (2, 6),
            "prior_alert_range": (0, 2),
            "prior_case_range": (0, 1),
            "linked_case_range": (0, 1),
            "counterparty_range": (1, 3),
            "channels": ["UPI", "ATM", "NEFT"],
            "countries": ["IN", "NP"],
            "typologies": ["NONE", "HIGH_RISK_DEST"],
            "amount_band": (4000, 30000),
            "customer_segment": "RETAIL",
        },
    ]


def _choose_context_profile(risk_score: float, rng: random.Random) -> Dict[str, Any]:
    profiles = _profile_templates()
    if risk_score >= 85:
        candidates = [profiles[0], profiles[2], profiles[1]]
    elif risk_score >= 65:
        candidates = [profiles[1], profiles[2], profiles[3]]
    elif risk_score >= 40:
        candidates = [profiles[3], profiles[4], profiles[1]]
    else:
        candidates = [profiles[4], profiles[3]]
    return candidates[rng.randrange(len(candidates))]


def _build_investigation_context(
    tables: Dict[str, pd.DataFrame],
    *,
    manifest: Dict[str, Any],
    context_profile: str = "balanced",
) -> Dict[str, pd.DataFrame]:
    case_records = [
        {str(k): _json_safe(v) for k, v in row.items()}
        for row in tables.get("cases", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    ]
    alert_records = [
        {str(k): _json_safe(v) for k, v in row.items()}
        for row in tables.get("alerts", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    ]
    transaction_records = [
        {str(k): _json_safe(v) for k, v in row.items()}
        for row in tables.get("transactions", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    ]
    account_records = [
        {str(k): _json_safe(v) for k, v in row.items()}
        for row in tables.get("accounts", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    ]
    customer_records = [
        {str(k): _json_safe(v) for k, v in row.items()}
        for row in tables.get("customers", pd.DataFrame()).replace({pd.NA: None}).to_dict(orient="records")
    ]

    if not case_records:
        return tables

    publish_id = str(manifest.get("publish_id") or "PUBCTX")
    publish_token = publish_id.replace("-", "").replace("_", "")[:8] or "PUBCTX"
    pipeline_id = manifest.get("pipeline_id")
    pipeline_name = manifest.get("pipeline_name")
    run_id = manifest.get("run_id")
    publish_label = manifest.get("publish_label")

    alerts_by_case: Dict[str, List[Dict[str, Any]]] = {}
    for row in alert_records:
        case_id = str(row.get("case_id") or "").strip()
        if case_id:
            alerts_by_case.setdefault(case_id, []).append(row)

    accounts_by_id = {
        str(row.get("account_id") or "").strip(): row
        for row in account_records
        if str(row.get("account_id") or "").strip()
    }
    customers_by_id = {
        str(row.get("customer_id") or "").strip(): row
        for row in customer_records
        if str(row.get("customer_id") or "").strip()
    }
    transactions_by_id = {
        str(row.get("transaction_id") or "").strip(): row
        for row in transaction_records
        if str(row.get("transaction_id") or "").strip()
    }

    for case_index, case_row in enumerate(case_records, start=1):
        case_id = str(case_row.get("case_id") or "").strip()
        if not case_id:
            continue

        case_alerts = alerts_by_case.get(case_id, [])
        primary_alert = case_alerts[0] if case_alerts else {}
        account_id = str(
            case_row.get("account_id")
            or primary_alert.get("account_id")
            or f"FCC-ACCT-{publish_token}-{case_index:03d}"
        ).strip()
        customer_id = str(
            case_row.get("customer_id")
            or primary_alert.get("customer_id")
            or f"FCC-CUST-{publish_token}-{case_index:03d}"
        ).strip()
        seed = "|".join([publish_id, case_id, account_id, customer_id, context_profile])
        rng = random.Random(seed)

        current_dt = _parse_datetime(
            case_row.get("created_at")
            or primary_alert.get("created_at")
            or primary_alert.get("alert_date")
            or manifest.get("published_at")
            or _now_iso(),
        )
        risk_score = _safe_float(case_row.get("risk_score") or primary_alert.get("risk_score") or 0.0)
        if risk_score <= 1.0:
            risk_score *= 100.0
        risk_level = _normalize_risk_level(
            case_row.get("risk_rating") or primary_alert.get("severity"),
            score_hint=risk_score,
        )
        profile = _choose_context_profile(risk_score, rng)

        history_txn_count = rng.randint(*profile["txn_range"])
        prior_alert_count = rng.randint(*profile["prior_alert_range"])
        prior_case_count = rng.randint(*profile["prior_case_range"])
        linked_case_count = rng.randint(*profile["linked_case_range"])
        counterparty_count = rng.randint(*profile["counterparty_range"])
        history_span_days = max(14, min(220, history_txn_count * rng.randint(4, 10)))
        amount_low, amount_high = profile["amount_band"]
        base_amount = max(amount_low, min(amount_high, _safe_float(primary_alert.get("amount"), default=amount_low * 1.2)))
        if base_amount <= 0:
            base_amount = rng.randint(amount_low, amount_high)

        customer_name = str(
            case_row.get("customer_name")
            or customers_by_id.get(customer_id, {}).get("customer_name")
            or f"Customer {case_index:03d}"
        )
        customer_country = str(
            customers_by_id.get(customer_id, {}).get("country")
            or customers_by_id.get(customer_id, {}).get("nationality")
            or rng.choice(profile["countries"])
        )

        case_priority = _priority_from_risk_level(risk_level, risk_score)
        historical_frequency = _historical_frequency_label(history_txn_count)
        linked_case_refs = [
            f"CASECTX-{publish_token}-{case_index:03d}-{idx + 1:02d}"
            for idx in range(max(linked_case_count, prior_case_count))
        ]

        account_record = accounts_by_id.setdefault(
            account_id,
            {
                "account_id": account_id,
                "case_id": case_id,
                "customer_id": customer_id,
            },
        )
        account_record.update(
            {
                "case_id": case_id,
                "customer_id": customer_id,
                "account_type": account_record.get("account_type") or "Checking",
                "status": account_record.get("status") or "ACTIVE",
                "risk_rating": account_record.get("risk_rating") or risk_level,
                "account_risk_rating": account_record.get("account_risk_rating") or risk_level,
                "current_balance": round(base_amount * rng.uniform(1.4, 5.8), 2),
                "expected_monthly_txn": history_txn_count * rng.randint(2, 6),
                "num_linked_accounts": max(linked_case_count, counterparty_count),
                "currency": account_record.get("currency") or "USD",
                "fcc_bridge_context_ready": 1,
                "fcc_bridge_context_profile": profile["key"],
                "behavior_context": profile["label"],
            }
        )

        customer_record = customers_by_id.setdefault(
            customer_id,
            {
                "customer_id": customer_id,
                "case_id": case_id,
                "customer_name": customer_name,
            },
        )
        customer_record.update(
            {
                "case_id": case_id,
                "customer_name": customer_name,
                "risk_rating": customer_record.get("risk_rating") or risk_level,
                "customer_risk_rating": customer_record.get("customer_risk_rating") or risk_level,
                "segment": customer_record.get("segment") or profile["customer_segment"],
                "country": customer_country,
                "nationality": customer_record.get("nationality") or customer_country,
                "pep_flag": customer_record.get("pep_flag") if customer_record.get("pep_flag") is not None else (1 if risk_level in {"High", "Critical"} and rng.random() < 0.35 else 0),
                "adverse_media_flag": customer_record.get("adverse_media_flag") if customer_record.get("adverse_media_flag") is not None else (1 if rng.random() < 0.28 else 0),
                "sanction_hit": customer_record.get("sanction_hit") if customer_record.get("sanction_hit") is not None else (1 if risk_level == "Critical" and rng.random() < 0.12 else 0),
                "kyc_completeness_pct": customer_record.get("kyc_completeness_pct") or rng.randint(68, 99),
                "days_since_kyc": customer_record.get("days_since_kyc") or rng.randint(14, 540),
                "years_as_customer": customer_record.get("years_as_customer") or round(rng.uniform(0.8, 14.0), 1),
                "num_products_held": customer_record.get("num_products_held") or rng.randint(1, 5),
                "fcc_bridge_context_ready": 1,
                "fcc_bridge_context_profile": profile["key"],
                "behavior_context": profile["label"],
            }
        )

        counterparty_pairs: List[tuple[str, str]] = []
        for cp_index in range(counterparty_count):
            cp_account_id = f"FCC-CP-ACCT-{publish_token}-{case_index:03d}-{cp_index + 1:02d}"
            cp_customer_id = f"FCC-CP-CUST-{publish_token}-{case_index:03d}-{cp_index + 1:02d}"
            counterparty_pairs.append((cp_account_id, cp_customer_id))
            accounts_by_id.setdefault(
                cp_account_id,
                {
                    "account_id": cp_account_id,
                    "customer_id": cp_customer_id,
                    "account_type": rng.choice(["Checking", "Savings", "Corporate"]),
                    "status": "ACTIVE",
                    "risk_rating": rng.choice(["Low", "Medium", risk_level]),
                    "account_risk_rating": rng.choice(["Low", "Medium", risk_level]),
                    "current_balance": round(base_amount * rng.uniform(0.8, 4.2), 2),
                    "currency": "USD",
                    "fcc_bridge_context_role": "counterparty",
                    "fcc_bridge_context_profile": profile["key"],
                },
            )
            customers_by_id.setdefault(
                cp_customer_id,
                {
                    "customer_id": cp_customer_id,
                    "customer_name": f"Related Party {case_index:03d}-{cp_index + 1:02d}",
                    "risk_rating": rng.choice(["Low", "Medium", risk_level]),
                    "customer_risk_rating": rng.choice(["Low", "Medium", risk_level]),
                    "segment": rng.choice(["RETAIL", "SME", "CORPORATE"]),
                    "country": rng.choice(profile["countries"]),
                    "fcc_bridge_context_role": "counterparty",
                    "fcc_bridge_context_profile": profile["key"],
                },
            )

        generated_txn_ids: List[str] = []
        for txn_index in range(history_txn_count):
            tx_id = f"TXNCTX-{publish_token}-{case_index:03d}-{txn_index + 1:03d}"
            cp_account_id, cp_customer_id = counterparty_pairs[txn_index % len(counterparty_pairs)]
            days_back = max(1, int(((txn_index + 1) * history_span_days) / max(1, history_txn_count + 1)))
            tx_dt = current_dt - timedelta(days=days_back, hours=rng.randint(0, 21), minutes=rng.randint(0, 59))
            multiplier = rng.uniform(0.42, 1.65)
            if profile["key"] == "dense_network":
                multiplier = rng.uniform(0.9, 2.8)
            elif profile["key"] == "structuring":
                multiplier = rng.uniform(0.08, 0.24)
            elif profile["key"] == "sparse_watch":
                multiplier = rng.uniform(0.4, 0.9)
            amount = round(max(1500.0, base_amount * multiplier), 2)
            txn_row = {
                "transaction_id": tx_id,
                "case_id": case_id,
                "account_id": account_id,
                "customer_id": customer_id,
                "counterparty_account": cp_account_id,
                "counterparty_customer_id": cp_customer_id,
                "txn_timestamp": tx_dt.isoformat() + "Z",
                "amount": amount,
                "direction": rng.choice(["DEBIT", "CREDIT"]),
                "channel": rng.choice(profile["channels"]),
                "beneficiary_country": rng.choice(profile["countries"]),
                "typology_type": rng.choice(profile["typologies"]),
                "narrative": profile["label"],
                "fcc_pipeline_id": pipeline_id,
                "fcc_pipeline_name": pipeline_name,
                "fcc_publish_id": publish_id,
                "fcc_publish_label": publish_label,
                "fcc_source_run_id": run_id,
                "fcc_bridge_context_role": "historical_transaction",
                "fcc_bridge_context_profile": profile["key"],
                "behavior_context": profile["label"],
            }
            transactions_by_id[tx_id] = txn_row
            generated_txn_ids.append(tx_id)

        for alert_index in range(prior_alert_count):
            history_alert_id = f"ALTCTX-{publish_token}-{case_index:03d}-{alert_index + 1:03d}"
            alert_dt = current_dt - timedelta(days=max(1, rng.randint(3, history_span_days)))
            linked_txn_id = generated_txn_ids[alert_index % len(generated_txn_ids)] if generated_txn_ids else None
            alert_records.append(
                {
                    "alert_id": history_alert_id,
                    "case_id": case_id,
                    "alert_type": profile["label"],
                    "created_at": alert_dt.isoformat() + "Z",
                    "customer_id": customer_id,
                    "account_id": account_id,
                    "transaction_id": linked_txn_id,
                    "amount": transactions_by_id.get(linked_txn_id, {}).get("amount") if linked_txn_id else None,
                    "severity": risk_level if alert_index == 0 else rng.choice(["Medium", risk_level]),
                    "status": "CLOSED" if alert_dt < current_dt - timedelta(days=7) else "OPEN",
                    "fcc_score": round(max(0.15, min(0.99, risk_score / 100.0 * rng.uniform(0.62, 1.0))), 6),
                    "fcc_decision": "RETAIN",
                    "fcc_pipeline_id": pipeline_id,
                    "fcc_pipeline_name": pipeline_name,
                    "fcc_publish_id": publish_id,
                    "fcc_publish_label": publish_label,
                    "rule_triggered": rng.choice(["R001_HIGH_VALUE_CASH", "R006_HIGH_RISK_DEST", "R007_VELOCITY_SPIKE"]),
                    "historical_frequency": historical_frequency,
                    "behavior_context": profile["label"],
                    "fcc_bridge_context_role": "historical_alert",
                    "fcc_bridge_context_profile": profile["key"],
                }
            )

        for alert_row in case_alerts:
            alert_row.setdefault("historical_frequency", historical_frequency)
            alert_row.setdefault("behavior_context", profile["label"])
            alert_row.setdefault("fcc_publish_label", publish_label)
            alert_row.setdefault("fcc_bridge_context_profile", profile["key"])
            alert_row.setdefault("fcc_bridge_context_role", "imported_alert")
            if not alert_row.get("severity"):
                alert_row["severity"] = risk_level
            if not alert_row.get("transaction_id") and generated_txn_ids:
                alert_row["transaction_id"] = generated_txn_ids[0]

        case_row.update(
            {
                "account_id": account_id,
                "customer_id": customer_id,
                "customer_name": customer_name,
                "risk_rating": risk_level,
                "risk_score": round(max(risk_score, _safe_float(case_row.get("risk_score"), default=0.0)), 2),
                "status": case_row.get("status") or "NEW",
                "priority": case_row.get("priority") or case_priority,
                "customer_risk_rating": customer_record.get("customer_risk_rating") or risk_level,
                "account_risk_rating": account_record.get("account_risk_rating") or risk_level,
                "prior_alerts_count": prior_alert_count,
                "prior_case_count": prior_case_count,
                "linked_cases_count": linked_case_count,
                "linked_case_refs": json.dumps(linked_case_refs),
                "history_transaction_count": history_txn_count,
                "historical_frequency": historical_frequency,
                "behavior_context": profile["label"],
                "alert_count": max(_safe_int(case_row.get("alert_count"), default=0), len(case_alerts) + prior_alert_count),
                "counterparty_count": len(counterparty_pairs),
                "investigation_readiness": "Prepared",
                "fcc_bridge_context_ready": 1,
                "fcc_bridge_context_profile": profile["key"],
                "fcc_source_run_id": case_row.get("fcc_source_run_id") or run_id,
                "fcc_pipeline_id": case_row.get("fcc_pipeline_id") or pipeline_id,
                "fcc_pipeline_name": case_row.get("fcc_pipeline_name") or pipeline_name,
                "fcc_publish_id": case_row.get("fcc_publish_id") or publish_id,
                "fcc_publish_label": case_row.get("fcc_publish_label") or publish_label,
            }
        )

    return {
        "cases": _records_to_df(case_records),
        "alerts": _records_to_df(alert_records),
        "transactions": _records_to_df(transactions_by_id.values()),
        "accounts": _records_to_df(accounts_by_id.values()),
        "customers": _records_to_df(customers_by_id.values()),
    }


def build_investigation_tables(
    scored_rows: List[Dict[str, Any]],
    *,
    model_grain: str = "alert",
    generation_mode: str = "advanced",
) -> Dict[str, pd.DataFrame]:
    cases: Dict[str, Dict[str, Any]] = {}
    alerts: Dict[str, Dict[str, Any]] = {}
    transactions: Dict[str, Dict[str, Any]] = {}
    accounts: Dict[str, Dict[str, Any]] = {}
    customers: Dict[str, Dict[str, Any]] = {}

    grain = "case" if str(model_grain).lower() == "case" else "alert"
    mode = str(generation_mode or "advanced").strip().lower()
    advanced_mode = mode not in {"default", "basic", "legacy", "standard"}
    used_case_ids: set[str] = set()

    for idx, raw_row in enumerate(scored_rows, start=1):
        row = {str(k): _json_safe(v) for k, v in dict(raw_row).items()}
        entity_id = str(row.get("entity_id") or "").strip() or f"FCC-{idx:06d}"
        score = _safe_float(row.get("model_score") or row.get("fcc_score"), 0.0)
        if score > 1:
            score = min(score / 100.0, 1.0)
        scored_at = row.get("scored_at") or _now_iso()

        source_case_id = _coalesce(row, "case_id", "caseid")
        alert_id = _coalesce(row, "alert_id", "alertid")
        transaction_id = _coalesce(row, "transaction_id", "txn_id", "trans_id")
        account_id = _coalesce(row, "account_id", "acct_id", "accountid", "account_no")
        customer_id = _coalesce(row, "customer_id", "cust_id", "customerid")

        if grain == "case":
            case_id = _normalize_enterprise_case_id(
                source_case_id or entity_id,
                alert_id=alert_id,
                idx=idx,
                used_ids=used_case_ids,
            )
            alert_id = str(alert_id or f"ALT-{case_id}")
        else:
            alert_id = str(alert_id or entity_id or f"ALT-{idx:06d}")
            case_id = _normalize_enterprise_case_id(
                None,
                alert_id=alert_id,
                idx=idx,
                used_ids=used_case_ids,
            )

        if transaction_id is not None:
            transaction_id = str(transaction_id)
        if account_id is not None:
            account_id = str(account_id)
        if customer_id is not None:
            customer_id = str(customer_id)

        account_seed = _numeric_suffix(account_id or entity_id or alert_id or idx) or f"{idx:06d}"
        if not account_id:
            account_id = f"ACCT-{account_seed.zfill(6)[-6:]}"
        if not customer_id:
            customer_id = f"CUST-{account_seed.zfill(6)[-6:]}"
        if not transaction_id:
            transaction_id = f"TXN-{account_seed.zfill(6)[-6:]}-{idx:03d}"

        created_raw = _coalesce(
            row,
            "created_at",
            "alert_created_at",
            "txn_timestamp",
            "transaction_date",
            "txn_date",
            "date",
            "time",
        ) or scored_at
        created_dt = _parse_datetime(
            created_raw,
            default=datetime.utcnow() - timedelta(days=(idx % 45), hours=(idx * 3) % 24),
        )
        created_at = _iso_z(created_dt)
        amount = _coalesce(row, "txn_amount", "transaction_amount", "amount", "amt", "value")
        if amount is None:
            amount = round(2500.0 + (score * 125000.0) + (idx * 97.35), 2)
        amount_value = _safe_float(amount, 2500.0 + (score * 125000.0) + (idx * 97.35))
        counterparty_account = _coalesce(
            row,
            "counterparty_account",
            "counterparty_account_id",
            "to_account",
            "beneficiary_account",
            "receiver_account",
            "cp_account",
        )
        if not counterparty_account:
            counterparty_account = f"CP-{(idx * 17) % 999999:06d}"
        customer_name = _coalesce(row, "customer_name", "name", "customer")
        rule_triggered = _coalesce(row, "rule_triggered", "RULE_TRIGGERED", "rule_name", "typology", "reason_code")
        rule_profile = _sentinel_rule_profile(rule_triggered, idx, score)
        alert_type = _coalesce(
            row,
            "alert_type",
            "rule_name",
            "scenario",
            "typology",
            "alert_category",
        ) or (rule_profile["alert_type"] if advanced_mode else "FCC retained queue")
        risk_level = _coalesce(row, "risk_rating", "risk_level", "severity") or _derive_risk_level(score)
        account_type = _coalesce(row, "account_type", "product_type", "acct_type")
        customer_country = _coalesce(row, "country", "customer_country", "nationality")
        customer_segment = _coalesce(row, "segment", "customer_segment", "customer_type")
        pipeline_id = _coalesce(row, "fcc_pipeline_id", "pipeline_id")
        pipeline_name = _coalesce(row, "fcc_pipeline_name", "pipeline_name")
        publish_id = _coalesce(row, "fcc_publish_id", "publish_id")
        publish_label = _coalesce(row, "fcc_publish_label", "publish_label")

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
                "priority": _priority_from_risk_level(str(risk_level), score * 100),
                "alert_count": 0,
                "fcc_source_run_id": row.get("run_id"),
                "fcc_source_batch_id": row.get("batch_id"),
                "fcc_deployment_id": row.get("deployment_id"),
                "fcc_decision": row.get("decision"),
                "fcc_reason_code": row.get("reason_code"),
                "fcc_pipeline_id": pipeline_id,
                "fcc_pipeline_name": pipeline_name,
                "fcc_publish_id": publish_id,
                "fcc_publish_label": publish_label,
                "fcc_source_case_id": str(source_case_id or "").strip() or None,
            },
        )
        cases[case_id]["alert_count"] = _safe_int(cases[case_id].get("alert_count"), default=0) + 1

        alert_payload = {
            "alert_id": alert_id,
            "case_id": case_id,
            "alert_type": str(alert_type),
            "created_at": str(created_at),
            "customer_id": customer_id,
            "account_id": account_id,
            "transaction_id": transaction_id,
            "amount": amount_value,
            "severity": str(risk_level),
            "status": "OPEN",
            "fcc_score": round(score, 6),
            "fcc_decision": row.get("decision"),
            "fcc_reason_code": row.get("reason_code"),
            "fcc_pipeline_id": pipeline_id,
            "fcc_pipeline_name": pipeline_name,
            "fcc_publish_id": publish_id,
            "fcc_publish_label": publish_label,
        }
        if advanced_mode:
            alert_payload.update(
                {
                    "rule_triggered": str(rule_triggered or rule_profile["typology"]),
                    "typology_type": rule_profile["typology"],
                    "behavior_context": rule_profile["narrative"],
                }
            )

        alerts.setdefault(
            alert_id,
            alert_payload,
        )

        txn_key = str(transaction_id or f"TXN-{alert_id}")
        txn_rows = (
            _demo_transaction_rows(
                case_id=case_id,
                alert_id=alert_id,
                transaction_id=txn_key,
                account_id=account_id,
                customer_id=customer_id,
                counterparty_account=str(counterparty_account),
                created_dt=created_dt,
                amount=amount_value,
                score=score,
                rule_value=rule_triggered or alert_type,
                idx=idx,
                row=row,
                pipeline_id=pipeline_id,
                pipeline_name=pipeline_name,
                publish_id=publish_id,
                publish_label=publish_label,
            )
            if advanced_mode
            else [
                {
                    "transaction_id": txn_key,
                    "case_id": case_id,
                    "account_id": account_id,
                    "customer_id": customer_id,
                    "counterparty_account": counterparty_account,
                    "txn_timestamp": str(created_at),
                    "amount": amount_value,
                    "direction": _coalesce(row, "direction", "dr_cr", "debit_credit", "type") or "DEBIT",
                    "fcc_score": round(score, 6),
                    "fcc_decision": row.get("decision"),
                    "fcc_pipeline_id": pipeline_id,
                    "fcc_pipeline_name": pipeline_name,
                    "fcc_publish_id": publish_id,
                    "fcc_publish_label": publish_label,
                }
            ]
        )
        for txn_row in txn_rows:
            transactions.setdefault(
                str(txn_row.get("transaction_id") or f"{txn_key}-{len(transactions) + 1}"),
                txn_row,
            )

        profile_key = rule_profile["key"]
        expected_monthly_txn = 60 if profile_key == "velocity" else 36 if profile_key in {"layering", "high_risk_destination"} else 18
        account_balance = max(amount_value * (1.1 if profile_key == "mule" else 2.7), 5000.0)
        account_status = "ACTIVE" if profile_key != "mule" else "RECENTLY_ACTIVE"
        customer_country_hint = customer_country or (
            "KY" if profile_key == "high_risk_destination" and idx % 3 == 0 else "IN"
        )

        account_payload = {
            "account_id": account_id,
            "case_id": case_id,
            "customer_id": customer_id,
            "account_type": account_type or "Operating Account",
            "risk_rating": str(risk_level),
            "status": account_status if advanced_mode else "ACTIVE",
        }
        if advanced_mode:
            account_payload.update(
                {
                    "current_balance": round(account_balance, 2),
                    "expected_monthly_txn": expected_monthly_txn,
                    "num_linked_accounts": max(2, int(rule_profile["txn_count"] // 2)),
                    "currency": "USD" if profile_key == "high_risk_destination" else "INR",
                    "behavior_context": rule_profile["narrative"],
                }
            )
        accounts.setdefault(account_id, account_payload)

        customer_payload = {
            "customer_id": customer_id,
            "case_id": case_id,
            "customer_name": str(customer_name or customer_id),
            "risk_rating": str(risk_level),
            "segment": customer_segment or "Commercial",
            "country": customer_country_hint if advanced_mode else (customer_country or "US"),
        }
        if advanced_mode:
            customer_payload.update(
                {
                    "nationality": customer_country_hint,
                    "pep_flag": 1 if profile_key == "high_risk_destination" and score >= 0.7 else 0,
                    "adverse_media_flag": 1 if score >= 0.75 else 0,
                    "kyc_completeness_pct": 72 if score >= 0.75 else 91,
                    "behavior_context": rule_profile["narrative"],
                }
            )
        customers.setdefault(customer_id, customer_payload)

    return _ready_for_sentinel(
        {
            "cases": _records_to_df(cases.values()),
            "alerts": _records_to_df(alerts.values()),
            "transactions": _records_to_df(transactions.values()),
            "accounts": _records_to_df(accounts.values()),
            "customers": _records_to_df(customers.values()),
        }
    )


class FCCSentinelBridgeService:
    TABLE_PRIMARY_KEYS = {
        "cases": "case_id",
        "alerts": "alert_id",
        "transactions": "transaction_id",
        "accounts": "account_id",
        "customers": "customer_id",
        "master_case_summary": "case_id",
        "master_cleaned_data": "case_id",
        "fcc_scored_entities": "record_id",
    }

    IMPORT_ACTIVITY_TABLES = (
        "case_resolution_workspaces",
        "case_resolution_support",
        "case_queue",
        "case_status_history",
        "case_escalations",
        "mail_logs",
        "report_history",
        "generated_reports",
        "mail_inbox_messages",
    )

    CASE_ID_FALLBACK_TABLES = (
        "cases",
        "master_case_summary",
        "master_cleaned_data",
        "case_resolution_workspaces",
        "case_resolution_support",
        "case_queue",
        "case_status_history",
        "case_escalations",
        "mail_logs",
        "report_history",
        "generated_reports",
        "active_case_scope",
    )

    ALERT_ID_FALLBACK_TABLES = (
        "alerts",
        "focus_results",
        "investigation_risk_index",
        "fcc_scored_entities",
    )

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

    INVESTIGATION_RESET_TABLES = (
        *CORE_REPLACE_TABLES,
        "case_queue",
        "case_status_history",
        "case_escalations",
        "escalation_batches",
        "mail_logs",
        "mail_inbox_messages",
        "case_resolution_support",
        "report_history",
        "generated_reports",
    )

    def __init__(self, env_root: str | Path):
        self.env_root = Path(env_root)
        self.mlops_data_dir = resolve_mlops_data_dir(self.env_root)
        self.scored_batches_dir = self.mlops_data_dir / "scored_batches"
        self.publish_dir = self.mlops_data_dir / "fcc_sentinel_published"
        self.scored_batches_dir.mkdir(parents=True, exist_ok=True)
        self.publish_dir.mkdir(parents=True, exist_ok=True)

    def _clear_case_retrieval_index(self, target_env_root: Path) -> None:
        index_dir = Path(target_env_root) / "investigation" / "case_retrieval"
        if index_dir.exists():
            shutil.rmtree(index_dir, ignore_errors=True)
        index_dir.mkdir(parents=True, exist_ok=True)

    def _batch_dir(self, batch_id: str) -> Path:
        return self.scored_batches_dir / str(batch_id)

    def _publish_dir(self, publish_id: str) -> Path:
        return self.publish_dir / str(publish_id)

    def _resolve_locked_deployment_threshold(self, deployment_id: Optional[str], fallback: Any = None) -> Optional[float]:
        deployment_text = str(deployment_id or "").strip()
        if not deployment_text:
            try:
                return float(fallback) if fallback is not None else None
            except Exception:
                return None
        deploy_file = self.env_root / "mlops" / "deployments" / f"{deployment_text}.json"
        if not deploy_file.exists():
            try:
                return float(fallback) if fallback is not None else None
            except Exception:
                return None
        try:
            payload = json.loads(deploy_file.read_text(encoding="utf-8"))
            return float(payload.get("threshold") or fallback)
        except Exception:
            try:
                return float(fallback) if fallback is not None else None
            except Exception:
                return None

    def _table_exists(self, cursor, table_name: str) -> bool:
        cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (str(table_name),),
        )
        return cursor.fetchone() is not None

    def _table_has_rows(self, cursor, table_name: str) -> bool:
        if not self._table_exists(cursor, table_name):
            return False
        try:
            cursor.execute(f'SELECT COUNT(*) FROM "{table_name}"')
            row = cursor.fetchone()
            return int((row[0] if row else 0) or 0) > 0
        except Exception:
            return True

    def _table_columns(self, cursor, table_name: str) -> List[str]:
        if not self._table_exists(cursor, table_name):
            return []
        try:
            cursor.execute(f'PRAGMA table_info("{table_name}")')
            return [str(row[1]) for row in cursor.fetchall() if row and len(row) > 1]
        except Exception:
            return []

    def _ensure_bridge_import_columns(self, cursor) -> None:
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
                pipeline_id TEXT,
                pipeline_name TEXT,
                publish_label TEXT,
                imported_rows INTEGER,
                replace_existing INTEGER,
                merge_existing INTEGER,
                prepare_investigation_context INTEGER,
                context_profile TEXT,
                generation_mode TEXT
            )
            """
        )
        cursor.execute("PRAGMA table_info(fcc_bridge_imports)")
        existing_cols = {str(row[1]) for row in cursor.fetchall()}
        for col_name, col_type in (
            ("pipeline_id", "TEXT"),
            ("pipeline_name", "TEXT"),
            ("publish_label", "TEXT"),
            ("merge_existing", "INTEGER"),
            ("prepare_investigation_context", "INTEGER"),
            ("context_profile", "TEXT"),
            ("generation_mode", "TEXT"),
            ("source_pipeline_deleted", "INTEGER"),
            ("source_pipeline_deleted_at", "TEXT"),
            ("source_pipeline_deleted_reason", "TEXT"),
        ):
            if col_name not in existing_cols:
                cursor.execute(f'ALTER TABLE fcc_bridge_imports ADD COLUMN "{col_name}" {col_type}')

    def _read_publish_table(self, publish_id: str, table_name: str) -> pd.DataFrame:
        table_path = self._publish_dir(publish_id) / f"{table_name}.json"
        if not table_path.exists():
            return pd.DataFrame()
        try:
            payload = json.loads(table_path.read_text(encoding="utf-8"))
        except Exception:
            payload = []
        return _records_to_df(payload if isinstance(payload, list) else [])

    def _collect_publish_keys(self, publish_id: str) -> Dict[str, List[str]]:
        def _values(df: pd.DataFrame, column: str) -> List[str]:
            if df.empty or column not in df.columns:
                return []
            return [
                str(value).strip()
                for value in df[column].dropna().astype(str).tolist()
                if str(value).strip()
            ]

        cases_df = self._read_publish_table(publish_id, "cases")
        alerts_df = self._read_publish_table(publish_id, "alerts")
        return {
            "case_ids": _values(cases_df, "case_id"),
            "alert_ids": _values(alerts_df, "alert_id"),
        }

    def _count_matching_rows(
        self,
        cursor,
        table_name: str,
        *,
        publish_id: Optional[str] = None,
        case_ids: Optional[List[str]] = None,
        alert_ids: Optional[List[str]] = None,
    ) -> int:
        if not self._table_exists(cursor, table_name):
            return 0
        columns = set(self._table_columns(cursor, table_name))
        clauses: List[str] = []
        params: List[Any] = []
        if publish_id and "fcc_publish_id" in columns:
            clauses.append('"fcc_publish_id" = ?')
            params.append(str(publish_id))
        if case_ids and "case_id" in columns:
            placeholders = ",".join(["?"] * len(case_ids))
            clauses.append(f'"case_id" IN ({placeholders})')
            params.extend(case_ids)
        if alert_ids and "alert_id" in columns:
            placeholders = ",".join(["?"] * len(alert_ids))
            clauses.append(f'"alert_id" IN ({placeholders})')
            params.extend(alert_ids)
        if not clauses:
            return 0
        try:
            cursor.execute(
                f'SELECT COUNT(*) FROM "{table_name}" WHERE ' + " OR ".join(clauses),
                params,
            )
            row = cursor.fetchone()
            return int((row[0] if row else 0) or 0)
        except Exception:
            return 0

    def _delete_matching_rows(
        self,
        cursor,
        table_name: str,
        *,
        publish_id: Optional[str] = None,
        case_ids: Optional[List[str]] = None,
        alert_ids: Optional[List[str]] = None,
    ) -> int:
        if not self._table_exists(cursor, table_name):
            return 0
        columns = set(self._table_columns(cursor, table_name))
        clauses: List[str] = []
        params: List[Any] = []
        if publish_id and "fcc_publish_id" in columns:
            clauses.append('"fcc_publish_id" = ?')
            params.append(str(publish_id))
        elif table_name in self.CASE_ID_FALLBACK_TABLES and case_ids and "case_id" in columns:
            placeholders = ",".join(["?"] * len(case_ids))
            clauses.append(f'"case_id" IN ({placeholders})')
            params.extend(case_ids)
        elif table_name in self.ALERT_ID_FALLBACK_TABLES and alert_ids and "alert_id" in columns:
            placeholders = ",".join(["?"] * len(alert_ids))
            clauses.append(f'"alert_id" IN ({placeholders})')
            params.extend(alert_ids)
        if not clauses:
            return 0
        try:
            cursor.execute(
                f'SELECT COUNT(*) FROM "{table_name}" WHERE ' + " OR ".join(clauses),
                params,
            )
            before = int(((cursor.fetchone() or [0])[0]) or 0)
            if before <= 0:
                return 0
            cursor.execute(
                f'DELETE FROM "{table_name}" WHERE ' + " OR ".join(clauses),
                params,
            )
            return before
        except Exception:
            return 0

    def _summarize_import_activity(
        self,
        cursor,
        *,
        publish_id: str,
        case_ids: List[str],
        alert_ids: List[str],
    ) -> Dict[str, Any]:
        table_counts = {
            table_name: self._count_matching_rows(
                cursor,
                table_name,
                publish_id=publish_id,
                case_ids=case_ids,
                alert_ids=alert_ids,
            )
            for table_name in self.IMPORT_ACTIVITY_TABLES
        }
        total_rows = int(sum(int(value or 0) for value in table_counts.values()))
        return {
            "has_activity": total_rows > 0,
            "total_rows": total_rows,
            "tables": table_counts,
        }

    def _existing_target_tables(self, cursor) -> List[str]:
        populated_tables: List[str] = []
        for table_name in self.CORE_REPLACE_TABLES:
            if self._table_has_rows(cursor, table_name):
                populated_tables.append(table_name)
        return populated_tables

    def _merge_table_data(
        self,
        conn,
        *,
        table_name: str,
        incoming_df: pd.DataFrame,
        dedupe_key: Optional[str] = None,
    ) -> None:
        if incoming_df is None or incoming_df.empty:
            return

        existing_df = _read_sqlite_table(conn, table_name)
        if existing_df.empty:
            _prepare_sqlite_df(incoming_df).to_sql(table_name, conn, if_exists="replace", index=False)
            return

        combined = pd.concat([existing_df, incoming_df], ignore_index=True, sort=False)
        key = str(dedupe_key or "").strip()
        if key and key in combined.columns:
            non_null = combined[key].notna()
            deduped = combined.loc[~non_null].copy()
            deduped = pd.concat(
                [
                    deduped,
                    combined.loc[non_null].drop_duplicates(subset=[key], keep="last"),
                ],
                ignore_index=True,
                sort=False,
            )
            combined = deduped

        _prepare_sqlite_df(combined).to_sql(table_name, conn, if_exists="replace", index=False)

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
            locked_threshold = self._resolve_locked_deployment_threshold(
                manifest.get("deployment_id"),
                manifest.get("threshold"),
            )
            if locked_threshold is not None:
                manifest["threshold"] = float(locked_threshold)
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
        pipeline_id: Optional[str] = None,
        pipeline_name: Optional[str] = None,
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

        resolved_pipeline_id = str(
            pipeline_id
            or manifest.get("pipeline_id")
            or manifest.get("fcc_pipeline_id")
            or ""
        ).strip() or None
        resolved_pipeline_name = str(
            pipeline_name
            or manifest.get("pipeline_name")
            or manifest.get("fcc_pipeline_name")
            or ""
        ).strip() or None
        prepared_rows: List[Dict[str, Any]] = []
        for raw_row in rows:
            row = dict(raw_row)
            if resolved_pipeline_id and not row.get("fcc_pipeline_id"):
                row["fcc_pipeline_id"] = resolved_pipeline_id
            if resolved_pipeline_name and not row.get("fcc_pipeline_name"):
                row["fcc_pipeline_name"] = resolved_pipeline_name
            prepared_rows.append(row)

        publish_id = f"PUB-{uuid.uuid4().hex[:12]}"
        publish_dir = self._publish_dir(publish_id)
        publish_dir.mkdir(parents=True, exist_ok=True)
        publish_label_value = str(publish_label or f"FCC publish {resolved_batch_id[:8]}").strip()
        for idx, row in enumerate(prepared_rows, start=1):
            if not row.get("record_id"):
                row["record_id"] = f"{publish_id}-REC-{idx:06d}"
            row["fcc_publish_id"] = publish_id
            row["fcc_publish_label"] = publish_label_value

        tables = build_investigation_tables(
            prepared_rows,
            model_grain=str(manifest.get("model_grain") or manifest.get("entity_type") or "alert"),
            generation_mode="advanced",
        )
        published_manifest = {
            "publish_id": publish_id,
            "publish_label": publish_label_value,
            "source_env_id": self.env_root.name,
            "source_batch_id": resolved_batch_id,
            "run_id": manifest.get("run_id"),
            "deployment_id": manifest.get("deployment_id"),
            "model_grain": manifest.get("model_grain"),
            "threshold": self._resolve_locked_deployment_threshold(
                manifest.get("deployment_id"),
                manifest.get("threshold"),
            ),
            "pipeline_id": resolved_pipeline_id,
            "pipeline_name": resolved_pipeline_name,
            "published_at": _now_iso(),
            "include_suppressed": bool(include_suppressed),
            "total_scored_rows": int(manifest.get("total", 0) or 0),
            "published_rows": len(prepared_rows),
            "suppressed_rows_excluded": max(int(manifest.get("suppressed", 0) or 0), 0) if not include_suppressed else 0,
            "table_counts": {name: int(len(df.index)) for name, df in tables.items()},
            "generation_mode": "advanced",
        }

        (publish_dir / "manifest.json").write_text(json.dumps(published_manifest, indent=2, default=_json_safe), encoding="utf-8")
        (publish_dir / "scored_records.json").write_text(json.dumps(prepared_rows, indent=2, default=_json_safe), encoding="utf-8")
        for table_name, df in tables.items():
            (publish_dir / f"{table_name}.json").write_text(df.to_json(orient="records", indent=2), encoding="utf-8")

        return published_manifest

    def list_published_runs(self) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for manifest_path in self.publish_dir.glob("*/manifest.json"):
            try:
                payload = json.loads(manifest_path.read_text(encoding="utf-8"))
                locked_threshold = self._resolve_locked_deployment_threshold(
                    payload.get("deployment_id"),
                    payload.get("threshold"),
                )
                if locked_threshold is not None:
                    payload["threshold"] = float(locked_threshold)
                rows.append(payload)
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
        merge_existing: bool = False,
        rerank_after_import: bool = False,
        prepare_investigation_context: bool = False,
        context_profile: str = "balanced",
        generation_mode: str = "advanced",
    ) -> Dict[str, Any]:
        publish_dir = self._publish_dir(publish_id)
        manifest_path = publish_dir / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"Published FCC package not found for publish_id={publish_id}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        target_env_root = resolve_env_root(target_env_id, tenant_id, create_if_missing=True)
        target_db_path = _resolve_target_db_path(target_env_root)
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
        for idx, row in enumerate(scored_records, start=1):
            if isinstance(row, dict) and not row.get("record_id"):
                row["record_id"] = f"{publish_id}-REC-{idx:06d}"

        generation_mode_value = str(generation_mode or "advanced").strip().lower()
        if generation_mode_value not in {"default", "advanced"}:
            generation_mode_value = "advanced"

        missing_core_tables = any(
            tables.get(table_name, pd.DataFrame()).empty
            for table_name in ("cases", "alerts", "transactions", "accounts", "customers")
        )
        if scored_records:
            rebuilt_tables = build_investigation_tables(
                scored_records,
                model_grain=str(manifest.get("model_grain") or manifest.get("entity_type") or "alert"),
                generation_mode=generation_mode_value,
            )
            for table_name, rebuilt_df in rebuilt_tables.items():
                if not rebuilt_df.empty:
                    tables[table_name] = rebuilt_df
        elif missing_core_tables:
            generation_mode_value = "package"

        if prepare_investigation_context:
            tables = _build_investigation_context(
                tables,
                manifest=manifest,
                context_profile=str(context_profile or "balanced"),
            )
        tables = _ready_for_sentinel(tables)
        tables = _ensure_sentinel_case_linkage(tables)

        conn = db_manager.connect()
        try:
            cursor = conn.cursor()
            existing_tables = self._existing_target_tables(cursor)
            if existing_tables and not replace_existing and not merge_existing:
                preview = ", ".join(existing_tables[:4])
                if len(existing_tables) > 4:
                    preview += ", ..."
                raise ValueError(
                    f'Target environment "{target_env_id}" already contains investigation data in '
                    f"{preview}. Enable replace_existing to reset the shared workspace, "
                    "or enable merge_existing to append FCC-retained cases into the current investigation context."
                )
            if replace_existing:
                for table_name in self.CORE_REPLACE_TABLES:
                    cursor.execute(f'DROP TABLE IF EXISTS "{table_name}"')
                conn.commit()
                self._clear_case_retrieval_index(target_env_root)

            for table_name, df in tables.items():
                if df.empty:
                    continue
                if merge_existing and not replace_existing:
                    self._merge_table_data(
                        conn,
                        table_name=table_name,
                        incoming_df=df,
                        dedupe_key=self.TABLE_PRIMARY_KEYS.get(table_name),
                    )
                else:
                    _prepare_sqlite_df(df).to_sql(table_name, conn, if_exists="replace", index=False)

            cases_df = tables.get("cases", pd.DataFrame())
            if not cases_df.empty:
                if merge_existing and not replace_existing:
                    self._merge_table_data(
                        conn,
                        table_name="master_case_summary",
                        incoming_df=cases_df,
                        dedupe_key=self.TABLE_PRIMARY_KEYS.get("master_case_summary"),
                    )
                    self._merge_table_data(
                        conn,
                        table_name="master_cleaned_data",
                        incoming_df=cases_df,
                        dedupe_key=self.TABLE_PRIMARY_KEYS.get("master_cleaned_data"),
                    )
                else:
                    _prepare_sqlite_df(cases_df).to_sql("master_case_summary", conn, if_exists="replace", index=False)
                    _prepare_sqlite_df(cases_df).to_sql("master_cleaned_data", conn, if_exists="replace", index=False)

            scored_df = _records_to_df(scored_records)
            if not scored_df.empty:
                if merge_existing and not replace_existing:
                    self._merge_table_data(
                        conn,
                        table_name="fcc_scored_entities",
                        incoming_df=scored_df,
                        dedupe_key=self.TABLE_PRIMARY_KEYS.get("fcc_scored_entities"),
                    )
                else:
                    _prepare_sqlite_df(scored_df).to_sql("fcc_scored_entities", conn, if_exists="replace", index=False)

            self._ensure_bridge_import_columns(cursor)
            cursor.execute(
                """
                INSERT INTO fcc_bridge_imports
                  (import_id, publish_id, source_env_id, target_env_id, imported_at, run_id, deployment_id, pipeline_id, pipeline_name, publish_label, imported_rows, replace_existing, merge_existing, prepare_investigation_context, context_profile, generation_mode)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    f"IMP-{uuid.uuid4().hex[:12]}",
                    publish_id,
                    manifest.get("source_env_id"),
                    target_env_id,
                    _now_iso(),
                    manifest.get("run_id"),
                    manifest.get("deployment_id"),
                    manifest.get("pipeline_id"),
                    manifest.get("pipeline_name"),
                    manifest.get("publish_label"),
                    int(manifest.get("published_rows") or 0),
                    1 if replace_existing else 0,
                    1 if merge_existing and not replace_existing else 0,
                    1 if prepare_investigation_context else 0,
                    str(context_profile or "balanced"),
                    generation_mode_value,
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
            "merge_existing": bool(merge_existing and not replace_existing),
            "replace_existing": bool(replace_existing),
            "pipeline_id": manifest.get("pipeline_id"),
            "pipeline_name": manifest.get("pipeline_name"),
            "publish_label": manifest.get("publish_label"),
            "source_published_rows": int(manifest.get("published_rows") or 0),
            "source_published_case_count": int((manifest.get("table_counts") or {}).get("cases") or 0),
            "source_published_alert_count": int((manifest.get("table_counts") or {}).get("alerts") or 0),
            "source_threshold": self._resolve_locked_deployment_threshold(
                manifest.get("deployment_id"),
                manifest.get("threshold"),
            ),
            "case_generation_mode": "one_case_per_retained_alert" if str(manifest.get("model_grain") or "").lower() != "case" else "source_case_grain",
            "prepare_investigation_context": bool(prepare_investigation_context),
            "context_profile": str(context_profile or "balanced"),
            "generation_mode": generation_mode_value,
            "table_counts": {name: int(len(df.index)) for name, df in tables.items()},
            "imported_case_ids": [
                str(value)
                for value in tables.get("cases", pd.DataFrame()).get("case_id", pd.Series(dtype=object)).dropna().astype(str).tolist()
            ],
            "imported_alert_ids": [
                str(value)
                for value in tables.get("alerts", pd.DataFrame()).get("alert_id", pd.Series(dtype=object)).dropna().astype(str).tolist()
            ],
            "imported_case_count": int(len(tables.get("cases", pd.DataFrame()).index)),
            "imported_alert_count": int(len(tables.get("alerts", pd.DataFrame()).index)),
            "consistency": {
                "published_rows_match_imported_alerts": int(manifest.get("published_rows") or 0) == int(len(tables.get("alerts", pd.DataFrame()).index)),
                "published_case_count_match_imported_cases": int((manifest.get("table_counts") or {}).get("cases") or 0) == int(len(tables.get("cases", pd.DataFrame()).index)),
                "published_alert_count_match_imported_alerts": int((manifest.get("table_counts") or {}).get("alerts") or 0) == int(len(tables.get("alerts", pd.DataFrame()).index)),
            },
            "focus_result": focus_result,
        }

    def inspect_pipeline_delete_impact(
        self,
        *,
        tenant_id: str,
        pipeline_id: str | int,
    ) -> Dict[str, Any]:
        pipeline_text = str(pipeline_id or "").strip()
        pipeline_name = None
        try:
            mlops_db_path = self.env_root / "mlops" / "duckdb" / "mlops.duckdb"
            with duckdb.connect(str(mlops_db_path), read_only=True) as conn:
                row = conn.execute(
                    "SELECT name FROM mlops_pipelines WHERE pipeline_id = ? LIMIT 1",
                    [int(pipeline_text)],
                ).fetchone()
                if row:
                    pipeline_name = str(row[0] or "").strip() or None
        except Exception:
            pipeline_name = None

        published_runs = [
            manifest
            for manifest in self.list_published_runs()
            if str(manifest.get("pipeline_id") or "").strip() == pipeline_text
        ]
        imports: List[Dict[str, Any]] = []
        env_parent = self.env_root.parent
        for env_root in sorted(env_parent.iterdir(), key=lambda path: path.name.lower()):
            if not env_root.is_dir() or env_root.name == self.env_root.name:
                continue
            target_db_path = _resolve_target_db_path(env_root)
            if not target_db_path.exists():
                continue
            db_manager = DatabaseManager(str(target_db_path))
            conn = db_manager.connect()
            try:
                cursor = conn.cursor()
                if not self._table_exists(cursor, "fcc_bridge_imports"):
                    continue
                self._ensure_bridge_import_columns(cursor)
                rows = cursor.execute(
                    """
                    SELECT import_id, publish_id, source_env_id, target_env_id, imported_at,
                           run_id, deployment_id, pipeline_id, pipeline_name, publish_label,
                           imported_rows, replace_existing, merge_existing,
                           source_pipeline_deleted, source_pipeline_deleted_at
                    FROM fcc_bridge_imports
                    WHERE source_env_id = ? AND pipeline_id = ?
                    ORDER BY imported_at DESC
                    """,
                    [self.env_root.name, pipeline_text],
                ).fetchall()
                for row in rows:
                    publish_id = str(row[1] or "").strip()
                    keys = self._collect_publish_keys(publish_id) if publish_id else {"case_ids": [], "alert_ids": []}
                    case_ids = keys.get("case_ids") or []
                    alert_ids = keys.get("alert_ids") or []
                    activity = self._summarize_import_activity(
                        cursor,
                        publish_id=publish_id,
                        case_ids=case_ids,
                        alert_ids=alert_ids,
                    )
                    imports.append(
                        {
                            "import_id": str(row[0] or "").strip(),
                            "publish_id": publish_id,
                            "source_env_id": str(row[2] or "").strip(),
                            "target_env_id": str(row[3] or env_root.name).strip() or env_root.name,
                            "imported_at": row[4],
                            "run_id": str(row[5] or "").strip() or None,
                            "deployment_id": str(row[6] or "").strip() or None,
                            "pipeline_id": str(row[7] or "").strip() or pipeline_text,
                            "pipeline_name": str(row[8] or "").strip() or pipeline_name,
                            "publish_label": str(row[9] or "").strip() or None,
                            "imported_rows": int(row[10] or 0),
                            "replace_existing": bool(row[11]),
                            "merge_existing": bool(row[12]),
                            "source_pipeline_deleted": bool(row[13]),
                            "source_pipeline_deleted_at": row[14],
                            "imported_case_count": int(
                                self._count_matching_rows(
                                    cursor,
                                    "cases",
                                    publish_id=publish_id,
                                    case_ids=case_ids,
                                )
                            ),
                            "imported_alert_count": int(
                                self._count_matching_rows(
                                    cursor,
                                    "alerts",
                                    publish_id=publish_id,
                                    alert_ids=alert_ids,
                                )
                            ),
                            "analyst_activity": activity,
                            "purge_allowed": not bool(activity.get("has_activity")),
                        }
                    )
            finally:
                db_manager.close_connection(conn)

        has_published = bool(published_runs)
        has_imports = bool(imports)
        has_activity = any(bool(item.get("analyst_activity", {}).get("has_activity")) for item in imports)
        if not has_published and not has_imports:
            state = "not_published"
        elif has_published and not has_imports:
            state = "published_only"
        elif has_imports and not has_activity:
            state = "imported_no_activity"
        else:
            state = "imported_with_activity"

        return {
            "pipeline_id": pipeline_text,
            "pipeline_name": pipeline_name,
            "source_env_id": self.env_root.name,
            "state": state,
            "published_package_count": len(published_runs),
            "published_packages": [
                {
                    "publish_id": str(item.get("publish_id") or "").strip(),
                    "publish_label": item.get("publish_label"),
                    "published_at": item.get("published_at"),
                    "published_rows": int(item.get("published_rows") or 0),
                    "published_case_count": int((item.get("table_counts") or {}).get("cases") or 0),
                }
                for item in published_runs
            ],
            "linked_import_count": len(imports),
            "linked_target_env_count": len({str(item.get("target_env_id") or "").strip() for item in imports if str(item.get("target_env_id") or "").strip()}),
            "linked_imports": imports,
            "has_analyst_activity": has_activity,
            "sentinel_purge_allowed": has_imports and not has_activity,
        }

    def mark_source_pipeline_deleted(
        self,
        *,
        tenant_id: str,
        pipeline_id: str | int,
        reason: str = "deleted_from_fcc",
    ) -> Dict[str, Any]:
        pipeline_text = str(pipeline_id or "").strip()
        updated_imports = 0
        updated_envs: List[str] = []
        env_parent = self.env_root.parent
        for env_root in sorted(env_parent.iterdir(), key=lambda path: path.name.lower()):
            if not env_root.is_dir():
                continue
            target_db_path = _resolve_target_db_path(env_root)
            if not target_db_path.exists():
                continue
            db_manager = DatabaseManager(str(target_db_path))
            conn = db_manager.connect()
            try:
                cursor = conn.cursor()
                if not self._table_exists(cursor, "fcc_bridge_imports"):
                    continue
                self._ensure_bridge_import_columns(cursor)
                cursor.execute(
                    """
                    UPDATE fcc_bridge_imports
                    SET source_pipeline_deleted = 1,
                        source_pipeline_deleted_at = ?,
                        source_pipeline_deleted_reason = ?
                    WHERE source_env_id = ? AND pipeline_id = ?
                    """,
                    [_now_iso(), str(reason or "deleted_from_fcc"), self.env_root.name, pipeline_text],
                )
                changed = int(cursor.rowcount or 0)
                if changed > 0:
                    conn.commit()
                    updated_imports += changed
                    updated_envs.append(env_root.name)
            finally:
                db_manager.close_connection(conn)
        return {
            "success": True,
            "pipeline_id": pipeline_text,
            "updated_import_count": updated_imports,
            "updated_envs": updated_envs,
        }

    def purge_imported_run(
        self,
        *,
        publish_id: str,
        tenant_id: str,
        target_env_id: str,
        require_no_activity: bool = True,
    ) -> Dict[str, Any]:
        publish_text = str(publish_id or "").strip()
        if not publish_text:
            raise ValueError("publish_id is required")

        target_env_root = resolve_env_root(target_env_id, tenant_id, create_if_missing=True)
        target_db_path = _resolve_target_db_path(target_env_root)
        db_manager = DatabaseManager(str(target_db_path))
        db_manager.init_schema()
        keys = self._collect_publish_keys(publish_text)
        case_ids = keys.get("case_ids") or []
        alert_ids = keys.get("alert_ids") or []

        deleted_rows: Dict[str, int] = {}
        conn = db_manager.connect()
        try:
            cursor = conn.cursor()
            if require_no_activity:
                activity = self._summarize_import_activity(
                    cursor,
                    publish_id=publish_text,
                    case_ids=case_ids,
                    alert_ids=alert_ids,
                )
                if activity.get("has_activity"):
                    raise ValueError(
                        "Sentinel investigation activity already exists for this FCC publish. Keep the Sentinel record and delete FCC only."
                    )

            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            table_names = [str(row[0]) for row in cursor.fetchall() if row and row[0]]
            for table_name in table_names:
                if table_name == "fcc_bridge_imports":
                    continue
                deleted_count = self._delete_matching_rows(
                    cursor,
                    table_name,
                    publish_id=publish_text,
                    case_ids=case_ids,
                    alert_ids=alert_ids,
                )
                if deleted_count > 0:
                    deleted_rows[table_name] = int(deleted_count)

            if self._table_exists(cursor, "active_case_scope") and case_ids:
                try:
                    row = cursor.execute(
                        "SELECT case_ids FROM active_case_scope WHERE id = 1"
                    ).fetchone()
                    existing_case_ids = json.loads(str((row or [None])[0] or "[]"))
                    if isinstance(existing_case_ids, list):
                        remove_set = set(case_ids)
                        remaining_case_ids = [str(value) for value in existing_case_ids if str(value) not in remove_set]
                        if remaining_case_ids != existing_case_ids:
                            cursor.execute(
                                """
                                UPDATE active_case_scope
                                SET case_ids = ?, scope_value = ?, updated_at = CURRENT_TIMESTAMP
                                WHERE id = 1
                                """,
                                [
                                    json.dumps(remaining_case_ids, default=str),
                                    json.dumps(remaining_case_ids, default=str),
                                ],
                            )
                except Exception:
                    pass

            if self._table_exists(cursor, "fcc_bridge_imports"):
                self._ensure_bridge_import_columns(cursor)
                cursor.execute('DELETE FROM "fcc_bridge_imports" WHERE publish_id = ?', [publish_text])
                bridge_import_rows = int(cursor.rowcount or 0)
                if bridge_import_rows > 0:
                    deleted_rows["fcc_bridge_imports"] = bridge_import_rows
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        if deleted_rows:
            self._clear_case_retrieval_index(target_env_root)

        focus_result = None
        conn = db_manager.connect()
        try:
            cursor = conn.cursor()
            alerts_remaining = self._count_matching_rows(cursor, "alerts")
        finally:
            db_manager.close_connection(conn)
        if alerts_remaining > 0:
            try:
                focus_engine = FocusEngine(db_manager)
                focus_result = focus_engine.run_focus_job()
            except Exception as exc:
                focus_result = {"success": False, "error": str(exc)}

        return {
            "success": True,
            "publish_id": publish_text,
            "target_env_id": target_env_id,
            "deleted_rows_by_table": deleted_rows,
            "deleted_case_count": len(case_ids),
            "deleted_alert_count": len(alert_ids),
            "focus_result": focus_result,
        }

    def delete_published_run(
        self,
        *,
        publish_id: str,
        tenant_id: str,
        target_env_id: str,
        purge_imported: bool = True,
        delete_package: bool = True,
        require_no_activity: bool = False,
    ) -> Dict[str, Any]:
        publish_text = str(publish_id or "").strip()
        if not publish_text:
            raise ValueError("publish_id is required")

        purge_result: Dict[str, Any] | None = None
        if purge_imported:
            purge_result = self.purge_imported_run(
                publish_id=publish_text,
                tenant_id=tenant_id,
                target_env_id=target_env_id,
                require_no_activity=bool(require_no_activity),
            )

        package_deleted = False
        package_dir = self._publish_dir(publish_text)
        if delete_package and package_dir.exists():
            shutil.rmtree(package_dir)
            package_deleted = True

        return {
            "success": True,
            "publish_id": publish_text,
            "target_env_id": target_env_id,
            "purged_imported": bool(purge_imported),
            "purge_result": purge_result,
            "package_deleted": package_deleted,
        }

    def clear_imported_queue(
        self,
        *,
        tenant_id: str,
        target_env_id: str,
    ) -> Dict[str, Any]:
        target_env_root = resolve_env_root(target_env_id, tenant_id, create_if_missing=True)
        target_db_path = _resolve_target_db_path(target_env_root)
        db_manager = DatabaseManager(str(target_db_path))
        db_manager.init_schema()

        deleted_tables: List[str] = []
        conn = db_manager.connect()
        try:
            cursor = conn.cursor()
            for table_name in self.INVESTIGATION_RESET_TABLES:
                cursor.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                    (str(table_name),),
                )
                if cursor.fetchone() is None:
                    continue
                cursor.execute(f'DROP TABLE IF EXISTS "{table_name}"')
                deleted_tables.append(str(table_name))
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        if deleted_tables:
            self._clear_case_retrieval_index(target_env_root)

        return {
            "success": True,
            "target_env_id": target_env_id,
            "cleared_at": _now_iso(),
            "deleted_tables": deleted_tables,
        }

    def set_active_case_scope(
        self,
        *,
        tenant_id: str,
        target_env_id: str,
        case_ids: List[str],
        run_id: Optional[str] = None,
        scope_type: str = "CUSTOM",
        scope_value: Optional[Any] = None,
    ) -> Dict[str, Any]:
        target_env_root = resolve_env_root(target_env_id, tenant_id, create_if_missing=True)
        target_db_path = _resolve_target_db_path(target_env_root)
        db_manager = DatabaseManager(str(target_db_path))
        db_manager.init_schema()
        normalized_case_ids = [str(value).strip() for value in (case_ids or []) if str(value or "").strip()]
        stored_scope_value = scope_value if scope_value is not None else normalized_case_ids
        if isinstance(stored_scope_value, (list, dict)):
            stored_scope_value = json.dumps(stored_scope_value, default=str)

        conn = db_manager.connect()
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS active_case_scope (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    scope_type TEXT NOT NULL,
                    scope_value TEXT,
                    case_ids TEXT,
                    run_id TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            cursor.execute(
                """
                INSERT OR REPLACE INTO active_case_scope
                  (id, scope_type, scope_value, case_ids, run_id, updated_at)
                VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (
                    str(scope_type or "CUSTOM"),
                    stored_scope_value,
                    json.dumps(normalized_case_ids, default=str),
                    str(run_id or "").strip() or None,
                ),
            )
            conn.commit()
        finally:
            db_manager.close_connection(conn)

        return {
            "success": True,
            "scope_type": str(scope_type or "CUSTOM"),
            "run_id": str(run_id or "").strip() or None,
            "case_ids": normalized_case_ids,
            "case_count": len(normalized_case_ids),
        }
