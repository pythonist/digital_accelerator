from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd


def _dt(start: datetime, end: datetime) -> datetime:
    span = int((end - start).total_seconds())
    return start + timedelta(seconds=random.randint(0, max(span, 1)))


def _money(mean: float, scale: float = 0.8) -> float:
    base = np.random.lognormal(mean=np.log(max(mean, 1.0)), sigma=scale)
    return round(float(min(base, 2_000_000.0)), 2)


def _choice(values: List[str]) -> str:
    return random.choice(values)


def _build_customers(n_customers: int) -> pd.DataFrame:
    rows = []
    for idx in range(1, n_customers + 1):
        age = random.randint(18, 79)
        rows.append(
            {
                "customer_id": f"CUST{idx:06d}",
                "customer_type": _choice(["individual", "business"]),
                "segment": _choice(["retail", "mass_affluent", "sme", "corporate"]),
                "country": _choice(["IN", "US", "GB", "SG", "AE"]),
                "state": _choice(["MH", "DL", "KA", "TN", "GJ", "WB", "RJ", "UP"]),
                "age": age,
                "income_band": _choice(["low", "mid", "high", "very_high"]),
                "kyc_risk": _choice(["low", "medium", "high"]),
                "pep_flag": random.random() < 0.03,
                "adverse_media_flag": random.random() < 0.06,
                "created_at": _dt(datetime(2016, 1, 1), datetime(2024, 1, 1)).strftime("%Y-%m-%d"),
            }
        )
    return pd.DataFrame(rows)


def _build_accounts(customers: pd.DataFrame, n_accounts: int) -> pd.DataFrame:
    customer_ids = customers["customer_id"].tolist()
    rows = []
    for idx in range(1, n_accounts + 1):
        customer_id = random.choice(customer_ids)
        open_date = _dt(datetime(2017, 1, 1), datetime(2024, 1, 1))
        risk = _choice(["low", "medium", "high"])
        is_mule = random.random() < 0.08
        rows.append(
            {
                "account_id": f"ACCT{idx:06d}",
                "customer_id": customer_id,
                "account_type": _choice(["savings", "current", "nre", "nro", "od"]),
                "currency": _choice(["INR", "USD", "GBP", "SGD", "AED"]),
                "branch_code": f"{1000 + (idx % 250):04d}",
                "open_date": open_date.strftime("%Y-%m-%d"),
                "status": _choice(["active", "active", "active", "dormant", "frozen"]),
                "risk_rating": "high" if is_mule else risk,
                "is_mule_candidate": is_mule,
                "last_activity_date": (_dt(open_date, datetime(2025, 1, 1))).strftime("%Y-%m-%d"),
            }
        )
    return pd.DataFrame(rows)


def _build_transactions(accounts: pd.DataFrame, customers: pd.DataFrame, n_transactions: int) -> pd.DataFrame:
    account_ids = accounts["account_id"].tolist()
    customer_lookup = dict(zip(accounts["account_id"], accounts["customer_id"]))
    mule_accounts = [row.account_id for row in accounts.itertuples() if bool(row.is_mule_candidate)]
    rows = []
    start = datetime(2023, 1, 1)
    end = datetime(2025, 1, 1)

    for idx in range(1, n_transactions + 1):
        if mule_accounts and random.random() < 0.18:
            account_id = random.choice(mule_accounts)
        else:
            account_id = random.choice(account_ids)
        customer_id = customer_lookup[account_id]
        is_mule = bool(accounts.loc[accounts["account_id"] == account_id, "is_mule_candidate"].iloc[0])

        direction = _choice(["inbound", "outbound"])
        if is_mule and random.random() < 0.65:
            direction = "outbound"

        if is_mule:
            amount = _money(18_000, 1.1)
            counterparty = f"CP{random.randint(100000, 999999)}"
            channel = _choice(["mobile", "online", "api"])
        else:
            amount = _money(2_500, 0.9)
            counterparty = f"CP{random.randint(100000, 999999)}"
            channel = _choice(["mobile", "online", "branch"])

        tx_date = _dt(start, end)
        rows.append(
            {
                "transaction_id": f"TXN{idx:08d}",
                "account_id": account_id,
                "customer_id": customer_id,
                "transaction_date": tx_date.strftime("%Y-%m-%d"),
                "transaction_timestamp": tx_date.isoformat(sep=" "),
                "amount": amount,
                "direction": direction,
                "transaction_type": _choice(["cash_deposit", "transfer", "card", "ach", "wire", "p2p"]),
                "channel": channel,
                "counterparty_account": counterparty,
                "counterparty_country": _choice(["IN", "US", "GB", "SG", "AE", "HK", "NL"]),
                "merchant_category": _choice(["retail", "gaming", "travel", "marketplace", "utilities", "cash"]),
                "device_id": f"DEV{random.randint(1000, 9999)}",
                "ip_address": f"10.{random.randint(1, 254)}.{random.randint(1, 254)}.{random.randint(1, 254)}",
                "mule_pattern_hint": _choice(
                    ["velocity", "circular", "pass_through", "dormant_spike", "counterparty_concentration"]
                )
                if is_mule
                else None,
                "is_suspicious": bool(is_mule or random.random() < 0.05),
            }
        )

    return pd.DataFrame(rows)


def _build_external_intel(accounts: pd.DataFrame, n_rows: int) -> pd.DataFrame:
    rows = []
    account_ids = accounts["account_id"].tolist()
    for idx in range(1, n_rows + 1):
        account_id = random.choice(account_ids)
        rows.append(
            {
                "intel_id": f"INT{idx:07d}",
                "account_id": account_id,
                "customer_id": accounts.loc[accounts["account_id"] == account_id, "customer_id"].iloc[0],
                "source_name": _choice(["sanctions", "watchlist", "adverse_media", "pep", "open_source"]),
                "risk_score": round(float(np.clip(np.random.normal(0.42, 0.22), 0, 1)), 3),
                "hit_flag": random.random() < 0.12,
                "review_status": _choice(["new", "reviewed", "cleared", "escalated"]),
                "last_review_date": _dt(datetime(2024, 1, 1), datetime(2025, 1, 1)).strftime("%Y-%m-%d"),
            }
        )
    return pd.DataFrame(rows)


def _build_device_signals(transactions: pd.DataFrame) -> pd.DataFrame:
    rows = []
    device_ids = sorted(set(transactions["device_id"].dropna().astype(str).tolist()))
    for idx, device_id in enumerate(device_ids, start=1):
        device_txns = transactions[transactions["device_id"] == device_id]
        rows.append(
            {
                "device_signal_id": f"DEVSIG{idx:07d}",
                "device_id": device_id,
                "account_count": int(device_txns["account_id"].nunique()),
                "transaction_count": int(len(device_txns)),
                "shared_device_flag": int(device_txns["account_id"].nunique() > 1),
                "geo_mismatch_flag": bool(random.random() < 0.15),
                "vpn_flag": bool(random.random() < 0.1),
                "login_velocity_score": round(float(np.clip(np.random.normal(0.5, 0.2), 0, 1)), 3),
                "channel_risk_score": round(float(np.clip(np.random.normal(0.44, 0.18), 0, 1)), 3),
            }
        )
    return pd.DataFrame(rows)


def _write_csv(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Mule-ready synthetic banking data.")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "mule_data" / "generated")
    parser.add_argument("--customers", type=int, default=2500)
    parser.add_argument("--accounts", type=int, default=4500)
    parser.add_argument("--transactions", type=int, default=15000)
    parser.add_argument("--intel-rows", type=int, default=800)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    np.random.seed(args.seed)
    random.seed(args.seed)

    customers = _build_customers(args.customers)
    accounts = _build_accounts(customers, args.accounts)
    transactions = _build_transactions(accounts, customers, args.transactions)
    external_intel = _build_external_intel(accounts, args.intel_rows)
    device_signals = _build_device_signals(transactions)

    summary = {
        "customers": len(customers),
        "accounts": len(accounts),
        "transactions": len(transactions),
        "external_intel": len(external_intel),
        "device_signals": len(device_signals),
        "mule_candidate_accounts": int(accounts["is_mule_candidate"].sum()),
        "output_dir": str(args.output_dir),
    }

    _write_csv(customers, args.output_dir / "customers.csv")
    _write_csv(accounts, args.output_dir / "accounts.csv")
    _write_csv(transactions, args.output_dir / "transactions.csv")
    _write_csv(external_intel, args.output_dir / "external_intel.csv")
    _write_csv(device_signals, args.output_dir / "device_signals.csv")
    (args.output_dir / "manifest.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
