"""Create a fast MLOps demo dataset tuned for suppression validation.

The output is a single master CSV intended for the MLOps workbench. It avoids
high-cardinality IDs and timestamp strings, which keeps preprocessing fast, and
it is calibrated around the platform's default 0.50 operating threshold.
"""

from __future__ import annotations

import json
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
OUTPUT_DIR = ROOT / "aml_pipeline_output_fast_50_10"
OUTPUT_CSV = OUTPUT_DIR / "master_fast_50_10.csv"
THRESHOLD_CSV = OUTPUT_DIR / "threshold_table_logistic_default.csv"
MODEL_CARD_JSON = OUTPUT_DIR / "model_card_fast_50_10.json"

N_ROWS = 6000
POSITIVE_RATE = 0.082
NEGATIVE_CLEAN_LIKE_RATE = 0.55
POSITIVE_CLEAN_LIKE_RATE = 0.04
RANDOM_SEED = 20260606


def _choice(rng: np.random.Generator, values: list[str], n: int, p: list[float] | None = None) -> np.ndarray:
    return rng.choice(values, size=n, p=p)


def build_dataset() -> pd.DataFrame:
    rng = np.random.default_rng(RANDOM_SEED)
    y = np.zeros(N_ROWS, dtype=int)
    y[: int(round(N_ROWS * POSITIVE_RATE))] = 1
    rng.shuffle(y)

    positive = y == 1
    negative = ~positive

    clean_like = np.zeros(N_ROWS, dtype=bool)
    clean_like[negative] = rng.random(int(negative.sum())) < NEGATIVE_CLEAN_LIKE_RATE
    clean_like[positive] = rng.random(int(positive.sum())) < POSITIVE_CLEAN_LIKE_RATE
    review_like = ~clean_like

    behavior_signal = np.where(
        review_like,
        rng.normal(78, 7, N_ROWS),
        rng.normal(20, 8, N_ROWS),
    ).clip(0, 100)
    risk_score = np.where(
        review_like,
        rng.normal(76, 9, N_ROWS),
        rng.normal(24, 9, N_ROWS),
    ).clip(0, 100)
    counterparty_risk = np.where(
        review_like,
        rng.normal(72, 11, N_ROWS),
        rng.normal(22, 10, N_ROWS),
    ).clip(0, 100)
    activity_spike = np.where(
        review_like,
        rng.normal(68, 12, N_ROWS),
        rng.normal(18, 11, N_ROWS),
    ).clip(0, 100)

    df = pd.DataFrame(
        {
            "FINAL_LABEL": y,
            "ALERT_RISK_GROUP": np.where(review_like, "Review-like", "Clean-like"),
            "AML_BEHAVIOR_SIGNAL": behavior_signal.round(2),
            "RISK_SCORE": risk_score.round().astype(int),
            "COUNTERPARTY_RISK_SIGNAL": counterparty_risk.round(2),
            "RECENT_ACTIVITY_SPIKE_SCORE": activity_spike.round(2),
            "RULE_RISK_PROFILE": np.where(review_like, rng.integers(3, 5, N_ROWS), rng.integers(1, 3, N_ROWS)),
            "ACCOUNT_RISK_RATING": rng.integers(1, 11, N_ROWS),
            "CUSTOMER_RISK_RATING": rng.integers(1, 11, N_ROWS),
            "ACCOUNT_TYPE": _choice(
                rng,
                ["CURRENT", "SAVINGS", "BUSINESS", "TRADE", "PRIVATE"],
                N_ROWS,
                [0.30, 0.22, 0.24, 0.14, 0.10],
            ),
            "ACCOUNT_STATUS": _choice(rng, ["ACTIVE", "DORMANT", "REVIEW"], N_ROWS, [0.86, 0.08, 0.06]),
            "OCCUPATION": _choice(
                rng,
                ["Retail", "ImportExport", "Consulting", "Construction", "Services", "Technology"],
                N_ROWS,
            ),
            "NATIONALITY": _choice(rng, ["US", "GB", "AE", "IN", "SG", "DE", "FR", "ZA"], N_ROWS),
            "INCOME_BRACKET": _choice(rng, ["LOW", "MID", "UPPER_MID", "HIGH"], N_ROWS, [0.22, 0.44, 0.24, 0.10]),
            "CDD_TIER": _choice(rng, ["STANDARD", "ENHANCED", "SIMPLIFIED"], N_ROWS, [0.67, 0.24, 0.09]),
            "KYC_COMPLETENESS_PCT": rng.normal(82, 10, N_ROWS).clip(40, 100).round(2),
            "DAYS_SINCE_KYC": rng.integers(0, 730, N_ROWS),
            "CURRENT_BALANCE": rng.lognormal(10, 1, N_ROWS).round(2),
            "EXPECTED_MONTHLY_TXN": rng.lognormal(4, 1, N_ROWS).round(2),
            "ALERT_HOUR": rng.integers(0, 24, N_ROWS),
            "ALERT_IS_WEEKEND": rng.integers(0, 2, N_ROWS),
            "PEP_FLAG": np.where(review_like, rng.binomial(1, 0.08, N_ROWS), rng.binomial(1, 0.02, N_ROWS)),
            "SANCTION_HIT": np.where(review_like, rng.binomial(1, 0.035, N_ROWS), rng.binomial(1, 0.005, N_ROWS)),
            "ADVERSE_MEDIA_FLAG": np.where(review_like, rng.binomial(1, 0.10, N_ROWS), rng.binomial(1, 0.02, N_ROWS)),
            "KYC_REVIEW_OVERDUE": np.where(review_like, rng.binomial(1, 0.18, N_ROWS), rng.binomial(1, 0.06, N_ROWS)),
            "NUM_PRODUCTS_HELD": rng.integers(1, 6, N_ROWS),
            "NUM_LINKED_ACCOUNTS": rng.integers(0, 5, N_ROWS),
            "ACCT_ALERT_COUNT": np.where(review_like, rng.integers(2, 7, N_ROWS), rng.integers(1, 4, N_ROWS)),
        }
    )
    return df.sample(frac=1, random_state=RANDOM_SEED + 1).reset_index(drop=True)


def evaluate_dataset(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, float | int]]:
    x = df.drop(columns=["FINAL_LABEL"])
    y = df["FINAL_LABEL"].astype(int)
    cat_cols = x.select_dtypes(include=["object", "string"]).columns.tolist()
    num_cols = [col for col in x.columns if col not in cat_cols]
    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.25,
        random_state=99,
        stratify=y,
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
    df = build_dataset()
    threshold_table, summary = evaluate_dataset(df)
    df.to_csv(OUTPUT_CSV, index=False)
    threshold_table.to_csv(THRESHOLD_CSV, index=False)
    MODEL_CARD_JSON.write_text(
        json.dumps(
            {
                "name": "Fast AML demo dataset for FCC suppression",
                "version": "fast_50_10",
                "purpose": "Fast MLOps workbench demo with no MFA/data-heavy preprocessing dependency.",
                "target_column": "FINAL_LABEL",
                "operating_goal": {
                    "threshold": 0.50,
                    "target_suppression_pct": 50.0,
                    "max_event_loss_pct": 10.0,
                },
                "validation_summary": summary,
                "preprocessing_note": (
                    "Use this single master CSV directly. It intentionally avoids IDs, raw timestamps, "
                    "free text, and other high-cardinality columns that make preprocessing slow."
                ),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT_CSV}")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
