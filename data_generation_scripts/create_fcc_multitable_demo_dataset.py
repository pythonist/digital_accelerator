"""Create a fast multi-table FCC/MLOps synthetic dataset.

Outputs relational CSVs for the synthetic pipeline:
customers, accounts, transactions, alerts, cases, str_reports, alert_labels.

Also writes master_labelled.csv and master_pre_features.csv so the same data can
be used directly in the FCC MLOps workbench when a prejoined master is useful.
The model-ready view is tuned around the platform's default 0.50 threshold:
roughly 50% suppression with event loss below 10%.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "aml_pipeline_output_multitable_fast_50_10"

N_ALERTS = 6000
BACKGROUND_TXNS_PER_ALERT = 4
POSITIVE_RATE = 0.082
NEGATIVE_CLEAN_LIKE_RATE = 0.55
POSITIVE_CLEAN_LIKE_RATE = 0.04
RANDOM_SEED = 20260606


def _ids(prefix: str, n: int, width: int = 7) -> list[str]:
    return [f"{prefix}{i:0{width}d}" for i in range(1, n + 1)]


def _choice(rng: np.random.Generator, values: list[str], n: int, p: list[float] | None = None) -> np.ndarray:
    return rng.choice(values, size=n, p=p)


def _date_strings(rng: np.random.Generator, n: int, *, start: str = "2024-01-01", days: int = 420) -> list[str]:
    base = datetime.fromisoformat(start)
    offsets = rng.integers(0, days, n)
    return [(base + timedelta(days=int(offset))).strftime("%Y-%m-%d") for offset in offsets]


def build_alert_level_features() -> pd.DataFrame:
    rng = np.random.default_rng(RANDOM_SEED)
    y = np.zeros(N_ALERTS, dtype=int)
    y[: int(round(N_ALERTS * POSITIVE_RATE))] = 1
    rng.shuffle(y)

    positive = y == 1
    negative = ~positive
    clean_like = np.zeros(N_ALERTS, dtype=bool)
    clean_like[negative] = rng.random(int(negative.sum())) < NEGATIVE_CLEAN_LIKE_RATE
    clean_like[positive] = rng.random(int(positive.sum())) < POSITIVE_CLEAN_LIKE_RATE
    review_like = ~clean_like

    behavior_signal = np.where(review_like, rng.normal(78, 7, N_ALERTS), rng.normal(20, 8, N_ALERTS)).clip(0, 100)
    risk_score = np.where(review_like, rng.normal(76, 9, N_ALERTS), rng.normal(24, 9, N_ALERTS)).clip(0, 100)
    counterparty_risk = np.where(review_like, rng.normal(72, 11, N_ALERTS), rng.normal(22, 10, N_ALERTS)).clip(0, 100)
    activity_spike = np.where(review_like, rng.normal(68, 12, N_ALERTS), rng.normal(18, 11, N_ALERTS)).clip(0, 100)

    df = pd.DataFrame(
        {
            "FINAL_LABEL": y,
            "ALERT_RISK_GROUP": np.where(review_like, "Review-like", "Clean-like"),
            "AML_BEHAVIOR_SIGNAL": behavior_signal.round(2),
            "RISK_SCORE": risk_score.round().astype(int),
            "COUNTERPARTY_RISK_SIGNAL": counterparty_risk.round(2),
            "RECENT_ACTIVITY_SPIKE_SCORE": activity_spike.round(2),
            "RULE_RISK_PROFILE": np.where(review_like, rng.integers(3, 5, N_ALERTS), rng.integers(1, 3, N_ALERTS)),
            "ACCOUNT_RISK_RATING": rng.integers(1, 11, N_ALERTS),
            "CUSTOMER_RISK_RATING": rng.integers(1, 11, N_ALERTS),
            "ACCOUNT_TYPE": _choice(
                rng,
                ["CURRENT", "SAVINGS", "BUSINESS", "TRADE", "PRIVATE"],
                N_ALERTS,
                [0.30, 0.22, 0.24, 0.14, 0.10],
            ),
            "ACCOUNT_STATUS": _choice(rng, ["ACTIVE", "DORMANT", "REVIEW"], N_ALERTS, [0.86, 0.08, 0.06]),
            "OCCUPATION": _choice(
                rng,
                ["Retail", "ImportExport", "Consulting", "Construction", "Services", "Technology"],
                N_ALERTS,
            ),
            "NATIONALITY": _choice(rng, ["US", "GB", "AE", "IN", "SG", "DE", "FR", "ZA"], N_ALERTS),
            "INCOME_BRACKET": _choice(rng, ["LOW", "MID", "UPPER_MID", "HIGH"], N_ALERTS, [0.22, 0.44, 0.24, 0.10]),
            "CDD_TIER": _choice(rng, ["STANDARD", "ENHANCED", "SIMPLIFIED"], N_ALERTS, [0.67, 0.24, 0.09]),
            "KYC_COMPLETENESS_PCT": rng.normal(82, 10, N_ALERTS).clip(40, 100).round(2),
            "DAYS_SINCE_KYC": rng.integers(0, 730, N_ALERTS),
            "CURRENT_BALANCE": rng.lognormal(10, 1, N_ALERTS).round(2),
            "EXPECTED_MONTHLY_TXN": rng.lognormal(4, 1, N_ALERTS).round(2),
            "ALERT_HOUR": rng.integers(0, 24, N_ALERTS),
            "ALERT_IS_WEEKEND": rng.integers(0, 2, N_ALERTS),
            "PEP_FLAG": np.where(review_like, rng.binomial(1, 0.08, N_ALERTS), rng.binomial(1, 0.02, N_ALERTS)),
            "SANCTION_HIT": np.where(review_like, rng.binomial(1, 0.035, N_ALERTS), rng.binomial(1, 0.005, N_ALERTS)),
            "ADVERSE_MEDIA_FLAG": np.where(review_like, rng.binomial(1, 0.10, N_ALERTS), rng.binomial(1, 0.02, N_ALERTS)),
            "KYC_REVIEW_OVERDUE": np.where(review_like, rng.binomial(1, 0.18, N_ALERTS), rng.binomial(1, 0.06, N_ALERTS)),
            "NUM_PRODUCTS_HELD": rng.integers(1, 6, N_ALERTS),
            "NUM_LINKED_ACCOUNTS": rng.integers(0, 5, N_ALERTS),
            "ACCT_ALERT_COUNT": np.where(review_like, rng.integers(2, 7, N_ALERTS), rng.integers(1, 4, N_ALERTS)),
            "NUM_SIGNATORIES": rng.integers(1, 5, N_ALERTS),
            "DEBIT_CARD_ISSUED": rng.binomial(1, 0.72, N_ALERTS),
            "INTERNET_BANKING": rng.binomial(1, 0.81, N_ALERTS),
            "ONBOARDING_CHANNEL": _choice(rng, ["BRANCH", "DIGITAL", "RELATIONSHIP_MANAGER"], N_ALERTS, [0.38, 0.42, 0.20]),
            "YEARS_AS_CUSTOMER": rng.integers(0, 21, N_ALERTS),
            "FATF_HIGH_RISK_NATIONALITY": rng.binomial(1, 0.06, N_ALERTS),
            "IS_ACTIVE": rng.binomial(1, 0.95, N_ALERTS),
            "LAST_TRANSACTION_DAYS_AGO": rng.integers(0, 90, N_ALERTS),
            "CORRESPONDENT_BANK_FLAG": rng.binomial(1, 0.08, N_ALERTS),
            "SHELL_CO_INDICATOR": rng.binomial(1, 0.04, N_ALERTS),
        }
    )
    return df.sample(frac=1, random_state=RANDOM_SEED + 1).reset_index(drop=True)


def build_tables(features: pd.DataFrame) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(RANDOM_SEED + 100)
    n = len(features)

    ids = pd.DataFrame(
        {
            "ALERT_ID": _ids("ALT", n),
            "TRANSACTION_ID": _ids("TXN", n),
            "ACCOUNT_ID": _ids("ACC", n),
            "CUSTOMER_ID": _ids("CUS", n),
        }
    )
    base = pd.concat([ids, features.reset_index(drop=True)], axis=1)
    alert_dates = _date_strings(rng, n)
    txn_dates = alert_dates

    customers = base[
        [
            "CUSTOMER_ID",
            "NATIONALITY",
            "OCCUPATION",
            "INCOME_BRACKET",
            "CUSTOMER_RISK_RATING",
            "PEP_FLAG",
            "SANCTION_HIT",
            "ADVERSE_MEDIA_FLAG",
            "KYC_COMPLETENESS_PCT",
            "DAYS_SINCE_KYC",
            "ONBOARDING_CHANNEL",
            "YEARS_AS_CUSTOMER",
            "NUM_PRODUCTS_HELD",
            "FATF_HIGH_RISK_NATIONALITY",
            "IS_ACTIVE",
            "CDD_TIER",
            "KYC_REVIEW_OVERDUE",
            "LAST_TRANSACTION_DAYS_AGO",
            "CORRESPONDENT_BANK_FLAG",
            "SHELL_CO_INDICATOR",
        ]
    ].copy()

    accounts = base[
        [
            "ACCOUNT_ID",
            "CUSTOMER_ID",
            "ACCOUNT_TYPE",
            "ACCOUNT_STATUS",
            "CURRENT_BALANCE",
            "NUM_SIGNATORIES",
            "EXPECTED_MONTHLY_TXN",
            "ACCOUNT_RISK_RATING",
            "NUM_LINKED_ACCOUNTS",
            "DEBIT_CARD_ISSUED",
            "INTERNET_BANKING",
        ]
    ].copy()
    accounts.insert(4, "OPEN_DATE", _date_strings(rng, n, start="2017-01-01", days=2500))
    accounts.insert(6, "CURRENCY", _choice(rng, ["USD", "GBP", "EUR", "AED", "INR"], n, [0.56, 0.14, 0.16, 0.08, 0.06]))

    txn_amount = np.where(
        base["ALERT_RISK_GROUP"].eq("Review-like"),
        rng.lognormal(9.4, 0.9, n),
        rng.lognormal(7.5, 0.8, n),
    ).round(2)
    transactions_alert = pd.DataFrame(
        {
            "TRANSACTION_ID": base["TRANSACTION_ID"],
            "ACCOUNT_ID": base["ACCOUNT_ID"],
            "TXN_TIMESTAMP": txn_dates,
            "TXN_HOUR": base["ALERT_HOUR"],
            "TXN_TYPE": _choice(rng, ["WIRE", "ACH", "CASH", "CARD", "INTERNAL"], n, [0.34, 0.22, 0.17, 0.17, 0.10]),
            "TXN_AMOUNT": txn_amount,
            "CURRENCY": accounts["CURRENCY"],
            "NARRATIVE": _choice(rng, ["Invoice", "Payroll", "Supplier", "Transfer", "Cash activity"], n),
            "BENEFICIARY_COUNTRY": _choice(rng, ["US", "GB", "AE", "IN", "SG", "DE", "FR", "ZA"], n),
            "CHANNEL": _choice(rng, ["Online", "Branch", "Mobile", "API"], n, [0.44, 0.18, 0.24, 0.14]),
            "TXN_DIRECTION": _choice(rng, ["IN", "OUT"], n, [0.48, 0.52]),
            "IS_TYPOLOGY": base["FINAL_LABEL"],
            "TYPOLOGY_TYPE": np.where(base["FINAL_LABEL"].eq(1), "Known STR pattern", "None"),
            "TXN_DAY_OF_WEEK": rng.integers(0, 7, n),
            "IS_WEEKEND": base["ALERT_IS_WEEKEND"],
            "IS_OFF_HOURS": ((base["ALERT_HOUR"] < 7) | (base["ALERT_HOUR"] > 20)).astype(int),
        }
    )

    bg_n = n * BACKGROUND_TXNS_PER_ALERT
    bg_accounts = rng.choice(base["ACCOUNT_ID"].to_numpy(), bg_n)
    transactions_bg = pd.DataFrame(
        {
            "TRANSACTION_ID": _ids("BTX", bg_n),
            "ACCOUNT_ID": bg_accounts,
            "TXN_TIMESTAMP": _date_strings(rng, bg_n),
            "TXN_HOUR": rng.integers(0, 24, bg_n),
            "TXN_TYPE": _choice(rng, ["WIRE", "ACH", "CASH", "CARD", "INTERNAL"], bg_n, [0.20, 0.30, 0.12, 0.28, 0.10]),
            "TXN_AMOUNT": rng.lognormal(7.2, 0.9, bg_n).round(2),
            "CURRENCY": _choice(rng, ["USD", "GBP", "EUR", "AED", "INR"], bg_n, [0.56, 0.14, 0.16, 0.08, 0.06]),
            "NARRATIVE": _choice(rng, ["Invoice", "Payroll", "Supplier", "Transfer", "Fees"], bg_n),
            "BENEFICIARY_COUNTRY": _choice(rng, ["US", "GB", "AE", "IN", "SG", "DE", "FR", "ZA"], bg_n),
            "CHANNEL": _choice(rng, ["Online", "Branch", "Mobile", "API"], bg_n, [0.44, 0.18, 0.24, 0.14]),
            "TXN_DIRECTION": _choice(rng, ["IN", "OUT"], bg_n, [0.48, 0.52]),
            "IS_TYPOLOGY": 0,
            "TYPOLOGY_TYPE": "None",
            "TXN_DAY_OF_WEEK": rng.integers(0, 7, bg_n),
            "IS_WEEKEND": rng.integers(0, 2, bg_n),
            "IS_OFF_HOURS": rng.binomial(1, 0.28, bg_n),
        }
    )
    transactions = pd.concat([transactions_alert, transactions_bg], ignore_index=True)

    alerts = pd.DataFrame(
        {
            "ALERT_ID": base["ALERT_ID"],
            "TRANSACTION_ID": base["TRANSACTION_ID"],
            "ACCOUNT_ID": base["ACCOUNT_ID"],
            "RULE_TRIGGERED": np.where(
                base["ALERT_RISK_GROUP"].eq("Review-like"),
                _choice(rng, ["STRUCTURING", "HIGH_RISK_GEO", "RAPID_MOVEMENT", "UNUSUAL_VOLUME"], n),
                _choice(rng, ["LOW_VALUE_PATTERN", "CUSTOMER_PROFILE", "VELOCITY", "ROUND_AMOUNT"], n),
            ),
            "RISK_SCORE": base["RISK_SCORE"],
            "ALERT_DATE": alert_dates,
            "ACCT_ALERT_COUNT": base["ACCT_ALERT_COUNT"],
            "ALERT_HOUR": base["ALERT_HOUR"],
            "ALERT_IS_WEEKEND": base["ALERT_IS_WEEKEND"],
            "RULE_RISK_PROFILE": base["RULE_RISK_PROFILE"],
            "ALERT_RISK_GROUP": base["ALERT_RISK_GROUP"],
            "AML_BEHAVIOR_SIGNAL": base["AML_BEHAVIOR_SIGNAL"],
            "COUNTERPARTY_RISK_SIGNAL": base["COUNTERPARTY_RISK_SIGNAL"],
            "RECENT_ACTIVITY_SPIKE_SCORE": base["RECENT_ACTIVITY_SPIKE_SCORE"],
        }
    )

    positive_alerts = base.loc[base["FINAL_LABEL"].eq(1), ["ALERT_ID", "ACCOUNT_ID"]].copy()
    str_reports = positive_alerts[["ACCOUNT_ID"]].copy()
    str_reports["str_filed_date"] = _date_strings(rng, len(str_reports), start="2024-02-01", days=420)

    case_mask = base["FINAL_LABEL"].eq(1) | (
        base["ALERT_RISK_GROUP"].eq("Review-like") & (rng.random(n) < 0.22)
    )
    case_base = base.loc[case_mask].reset_index(drop=True)
    cases = pd.DataFrame(
        {
            "CASE_ID": _ids("CASE", len(case_base)),
            "ALERT_ID": case_base["ALERT_ID"],
            "INVESTIGATOR_ID": _choice(rng, ["INV001", "INV002", "INV003", "INV004", "INV005"], len(case_base)),
            "PRIORITY": np.where(case_base["FINAL_LABEL"].eq(1), "HIGH", _choice(rng, ["LOW", "MEDIUM"], len(case_base), [0.65, 0.35])),
            "CASE_STATUS": np.where(case_base["FINAL_LABEL"].eq(1), "CLOSED_SAR_FILED", "CLOSED_FALSE_POSITIVE"),
            "RESOLUTION_DAYS": np.where(case_base["FINAL_LABEL"].eq(1), rng.integers(8, 45, len(case_base)), rng.integers(1, 15, len(case_base))),
            "CASE_OPEN_DATE": _date_strings(rng, len(case_base)),
            "ANALYST_RISK_SCORE": np.where(case_base["FINAL_LABEL"].eq(1), rng.normal(82, 8, len(case_base)), rng.normal(44, 12, len(case_base))).clip(0, 100).round(2),
            "DOCS_REQUESTED": np.where(case_base["FINAL_LABEL"].eq(1), rng.binomial(1, 0.68, len(case_base)), rng.binomial(1, 0.22, len(case_base))),
            "CUSTOMER_CONTACTED": np.where(case_base["FINAL_LABEL"].eq(1), rng.binomial(1, 0.52, len(case_base)), rng.binomial(1, 0.12, len(case_base))),
            "EDD_TRIGGERED": np.where(case_base["FINAL_LABEL"].eq(1), rng.binomial(1, 0.71, len(case_base)), rng.binomial(1, 0.18, len(case_base))),
            "LINKED_CASES_COUNT": rng.integers(0, 5, len(case_base)),
        }
    )

    alert_labels = base[["ALERT_ID", "FINAL_LABEL"]].copy()
    alert_labels["OUTCOME_REASON"] = np.where(alert_labels["FINAL_LABEL"].eq(1), "STR filed after alert", "No STR / false positive")

    master_labelled = (
        alerts.merge(transactions_alert.drop(columns=["ACCOUNT_ID"]), on="TRANSACTION_ID", how="left")
        .merge(accounts, on="ACCOUNT_ID", how="left")
        .merge(customers, on="CUSTOMER_ID", how="left")
        .merge(cases[["ALERT_ID", "CASE_STATUS", "PRIORITY", "EDD_TRIGGERED"]], on="ALERT_ID", how="left")
        .merge(alert_labels, on="ALERT_ID", how="left")
    )
    master_labelled["HAS_CASE"] = master_labelled["CASE_STATUS"].notna().astype(int)
    master_labelled["HAS_STR"] = master_labelled["FINAL_LABEL"].astype(int)
    master_labelled["CASE_STATUS"] = master_labelled["CASE_STATUS"].fillna("NO_CASE")
    master_labelled["PRIORITY"] = master_labelled["PRIORITY"].fillna("NONE")
    master_labelled["EDD_TRIGGERED"] = master_labelled["EDD_TRIGGERED"].fillna(0).astype(int)

    fast_drop = {
        "ALERT_ID",
        "TRANSACTION_ID",
        "ACCOUNT_ID",
        "CUSTOMER_ID",
        "ALERT_DATE",
        "TXN_TIMESTAMP",
        "OPEN_DATE",
        "OUTCOME_REASON",
    }
    leakage_drop = {"CASE_STATUS", "PRIORITY", "EDD_TRIGGERED", "HAS_CASE", "HAS_STR", "IS_TYPOLOGY", "TYPOLOGY_TYPE"}
    master_pre_features = master_labelled.drop(columns=[c for c in fast_drop | leakage_drop if c in master_labelled.columns])

    return {
        "customers": customers,
        "accounts": accounts,
        "transactions": transactions,
        "alerts": alerts,
        "cases": cases,
        "str_reports": str_reports,
        "alert_labels": alert_labels,
        "master_labelled": master_labelled,
        "master_pre_features": master_pre_features,
    }


def evaluate_master(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, float | int]]:
    x = df.drop(columns=["FINAL_LABEL"])
    y = df["FINAL_LABEL"].astype(int)
    cat_cols = x.select_dtypes(include=["object", "string"]).columns.tolist()
    num_cols = [col for col in x.columns if col not in cat_cols]
    x_train, x_test, y_train, y_test = train_test_split(
        x, y, test_size=0.25, random_state=99, stratify=y
    )
    model = Pipeline(
        [
            (
                "prep",
                ColumnTransformer(
                    [
                        ("num", StandardScaler(), num_cols),
                        ("cat", OneHotEncoder(handle_unknown="ignore"), cat_cols),
                    ]
                ),
            ),
            ("model", LogisticRegression(max_iter=1000, class_weight={0: 1.0, 1: 15.0})),
        ]
    )
    model.fit(x_train, y_train)
    probabilities = model.predict_proba(x_test)[:, 1]
    y_true = y_test.to_numpy()

    rows = []
    for threshold in np.arange(0.05, 0.951, 0.01):
        pred = (probabilities >= float(threshold)).astype(int)
        tp = int(((pred == 1) & (y_true == 1)).sum())
        tn = int(((pred == 0) & (y_true == 0)).sum())
        fp = int(((pred == 1) & (y_true == 0)).sum())
        fn = int(((pred == 0) & (y_true == 1)).sum())
        positives = int((y_true == 1).sum())
        total = int(len(y_true))
        rows.append(
            {
                "threshold": round(float(threshold), 2),
                "tp": tp,
                "tn": tn,
                "fp": fp,
                "fn": fn,
                "event_loss_pct": round(100.0 * fn / max(positives, 1), 2),
                "suppression_rate_pct": round(100.0 * (tn + fn) / max(total, 1), 2),
            }
        )
    threshold_table = pd.DataFrame(rows)
    operating = threshold_table.loc[(threshold_table["threshold"] - 0.50).abs().idxmin()].to_dict()
    summary = {
        "rows": int(len(df)),
        "columns": int(len(df.columns)),
        "positive_rows": int(df["FINAL_LABEL"].sum()),
        "positive_rate_pct": round(100.0 * float(df["FINAL_LABEL"].mean()), 2),
        "roc_auc": round(float(roc_auc_score(y_true, probabilities)), 4),
        "operating_threshold": 0.50,
        "suppression_rate_pct": float(operating["suppression_rate_pct"]),
        "event_loss_pct": float(operating["event_loss_pct"]),
        "tp": int(operating["tp"]),
        "tn": int(operating["tn"]),
        "fp": int(operating["fp"]),
        "fn": int(operating["fn"]),
    }
    return threshold_table, summary


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    features = build_alert_level_features()
    tables = build_tables(features)
    threshold_table, summary = evaluate_master(tables["master_pre_features"])

    for name, frame in tables.items():
        frame.to_csv(OUTPUT_DIR / f"{name}.csv", index=False)
    threshold_table.to_csv(OUTPUT_DIR / "threshold_table_logistic_default.csv", index=False)

    cardinality = {
        col: int(tables["master_pre_features"][col].nunique(dropna=False))
        for col in tables["master_pre_features"].select_dtypes(include=["object", "string"]).columns
    }
    model_card = {
        "name": "FCC multi-table AML demo dataset",
        "version": "multitable_fast_50_10",
        "target_column": "FINAL_LABEL",
        "tables": {name: {"rows": int(len(frame)), "columns": int(len(frame.columns))} for name, frame in tables.items()},
        "join_path": [
            "alerts.TRANSACTION_ID -> transactions.TRANSACTION_ID",
            "alerts.ACCOUNT_ID -> accounts.ACCOUNT_ID",
            "accounts.CUSTOMER_ID -> customers.CUSTOMER_ID",
            "alerts.ALERT_ID -> cases.ALERT_ID",
            "alerts.ALERT_ID -> alert_labels.ALERT_ID",
            "accounts.ACCOUNT_ID -> str_reports.ACCOUNT_ID",
        ],
        "recommended_mlop_use": {
            "load_tables": ["customers", "accounts", "transactions", "alerts", "cases", "str_reports", "alert_labels"],
            "target_column": "FINAL_LABEL",
            "fast_master": "master_pre_features.csv",
            "audit_master": "master_labelled.csv",
        },
        "validation_summary": summary,
        "categorical_cardinality_in_fast_master": cardinality,
        "note": (
            "Raw IDs and date fields are present in the relational tables for joins and audit, "
            "but the fast master excludes them to keep preprocessing responsive."
        ),
    }
    (OUTPUT_DIR / "model_card_multitable_fast_50_10.json").write_text(json.dumps(model_card, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "README.md").write_text(
        "\n".join(
            [
                "# FCC multi-table AML demo dataset",
                "",
                "Use the relational CSVs to run the synthetic pipeline:",
                "- customers.csv",
                "- accounts.csv",
                "- transactions.csv",
                "- alerts.csv",
                "- cases.csv",
                "- str_reports.csv",
                "- alert_labels.csv",
                "",
                "For fastest FCC MLOps testing, use master_pre_features.csv directly and select FINAL_LABEL as the target.",
                "For audit-style review, use master_labelled.csv.",
                "",
                "Expected validation at threshold 0.50:",
                f"- Suppression: {summary['suppression_rate_pct']}%",
                f"- Event loss: {summary['event_loss_pct']}%",
            ]
        ),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_DIR}")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
