"""
eda_service.py  — AML MLOps EDA Service
Production-grade exploratory data analysis engine for the AML workbench.
Provides all analytics needed for the SAS Viya-style EDA dashboard.

Covers:
  - Dataset overview & health scoring
  - Column profiling (numeric + categorical)
  - Missing value analysis
  - Outlier detection (IQR, Z-score, Modified Z-score, Isolation Forest proxy)
  - Duplicate analysis
  - Correlation matrices (Pearson / Spearman / Kendall)
  - Target-feature analysis & TP rate segmentation
  - Distribution fitting
  - Leakage detection
  - AML-domain insights engine
  - Pairplot data
  - Time-series trend analysis
  - ID column detection
"""

from __future__ import annotations

import math
import re
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from scipy import stats as scipy_stats

warnings.filterwarnings("ignore")

# ─── Constants ────────────────────────────────────────────────────────────────

AML_ID_PATTERNS = [
    "id", "_id", "key", "uuid", "guid", "ref", "no", "num", "nbr",
    "account_id", "customer_id", "transaction_id", "alert_id", "case_id",
    "acct_id", "cust_id", "txn_id", "str_id", "sar_id",
    "beneficiary_id", "sender_id", "counterparty_id",
]

AML_TIMESTAMP_PATTERNS = [
    "date", "time", "timestamp", "ts", "dt", "created", "updated",
    "txn_date", "alert_date", "open_date", "close_date",
]

FEATURE_SELECTION_FILTER_TECHNIQUES = [
    {"id": "leakage_name_scan", "label": "Leakage Name Scan", "family": "Leakage", "scope": "filter", "roles": ["all"], "description": "Flags columns whose names indicate post-event or outcome leakage."},
    {"id": "leakage_target_corr", "label": "Leakage Target Correlation", "family": "Leakage", "scope": "filter", "roles": ["numeric", "binary"], "description": "Flags near-perfect numeric correlations against the target."},
    {"id": "vif_multicollinearity", "label": "Variance Inflation Factor", "family": "Multicollinearity", "scope": "filter", "roles": ["numeric", "binary"], "description": "Flags columns that are overly explained by other predictors."},
    {"id": "variance_threshold", "label": "Variance Threshold", "family": "Unsupervised", "scope": "filter", "roles": ["numeric", "binary"], "description": "Removes near-constant numeric columns."},
    {"id": "mean_abs_deviation", "label": "Mean Absolute Deviation", "family": "Unsupervised", "scope": "filter", "roles": ["numeric", "binary"], "description": "Finds low-spread columns even when variance is small."},
    {"id": "dispersion_ratio", "label": "Dispersion Ratio", "family": "Unsupervised", "scope": "filter", "roles": ["numeric", "binary"], "description": "Checks whether values move enough relative to their magnitude."},
    {"id": "correlation_filter", "label": "Correlation Filter", "family": "Unsupervised", "scope": "filter", "roles": ["numeric", "binary"], "description": "Drops one feature from highly correlated pairs."},
]

FEATURE_SELECTION_SCORE_TECHNIQUES = [
    {"id": "information_gain", "label": "Information Gain", "family": "Information Theory", "scope": "score", "roles": ["numeric", "binary", "categorical"], "description": "Mutual information between feature and binary target."},
    {"id": "information_value", "label": "Weight of Evidence / Information Value", "family": "Scorecard", "scope": "score", "roles": ["numeric", "binary", "categorical"], "description": "WoE-based separation strength commonly used in AML and credit risk."},
    {"id": "uncertainty_coefficient", "label": "Uncertainty Coefficient", "family": "Information Theory", "scope": "score", "roles": ["numeric", "binary", "categorical"], "description": "Normalised information gain against target entropy."},
    {"id": "pearson_abs", "label": "Pearson |r|", "family": "Correlation", "scope": "score", "roles": ["numeric", "binary"], "description": "Absolute linear association with the binary target."},
    {"id": "spearman_abs", "label": "Spearman |rho|", "family": "Correlation", "scope": "score", "roles": ["numeric", "binary"], "description": "Absolute rank correlation for monotonic relationships."},
    {"id": "kendall_abs", "label": "Kendall |tau|", "family": "Correlation", "scope": "score", "roles": ["numeric", "binary"], "description": "Rank-order agreement between feature and target."},
    {"id": "point_biserial_abs", "label": "Point-Biserial |r|", "family": "Correlation", "scope": "score", "roles": ["numeric", "binary"], "description": "Binary-target correlation specialised for numeric features."},
    {"id": "fisher_score", "label": "Fisher Score", "family": "Class Separation", "scope": "score", "roles": ["numeric", "binary"], "description": "Difference in class means relative to within-class spread."},
    {"id": "anova_f_score", "label": "ANOVA F Score", "family": "Hypothesis Test", "scope": "score", "roles": ["numeric", "binary"], "description": "Between-class versus within-class variance ratio."},
    {"id": "t_statistic_abs", "label": "Welch |t|", "family": "Hypothesis Test", "scope": "score", "roles": ["numeric", "binary"], "description": "Absolute Welch t-statistic between positive and negative classes."},
    {"id": "ks_statistic", "label": "KS Statistic", "family": "Distribution Test", "scope": "score", "roles": ["numeric", "binary"], "description": "Maximum distance between positive and negative distributions."},
    {"id": "roc_auc_univariate", "label": "Univariate ROC AUC", "family": "Ranking", "scope": "score", "roles": ["numeric", "binary"], "description": "Single-feature discriminatory power against the target."},
    {"id": "gini_gain", "label": "Univariate Gini", "family": "Ranking", "scope": "score", "roles": ["numeric", "binary"], "description": "Scaled ROC AUC, useful for quick feature ordering."},
    {"id": "chi_square", "label": "Chi-Square", "family": "Categorical Test", "scope": "score", "roles": ["categorical"], "description": "Association strength between a categorical feature and the target."},
    {"id": "likelihood_ratio", "label": "Likelihood Ratio G", "family": "Categorical Test", "scope": "score", "roles": ["categorical"], "description": "Log-likelihood ratio for categorical dependence."},
    {"id": "cramers_v", "label": "Cramer's V", "family": "Categorical Association", "scope": "score", "roles": ["categorical"], "description": "Normalised categorical association score."},
    {"id": "target_rate_range", "label": "Target Rate Range", "family": "Segmentation", "scope": "score", "roles": ["numeric", "binary", "categorical"], "description": "Spread between weakest and strongest segment event rates."},
    {"id": "target_rate_lift", "label": "Top Segment Lift", "family": "Segmentation", "scope": "score", "roles": ["numeric", "binary", "categorical"], "description": "Best observed segment target rate divided by overall target rate."},
    {"id": "event_rate_std", "label": "Event Rate Volatility", "family": "Segmentation", "scope": "score", "roles": ["numeric", "binary", "categorical"], "description": "Standard deviation of segment event rates."},
    {"id": "woe_peak_abs", "label": "Weight of Evidence Peak", "family": "Scorecard", "scope": "score", "roles": ["numeric", "binary", "categorical"], "description": "Largest absolute WoE shift across bins or categories."},
    {"id": "missingness_delta", "label": "Missingness Delta", "family": "Data Quality Signal", "scope": "score", "roles": ["numeric", "binary", "categorical"], "description": "Difference in target rate between missing and non-missing rows."},
]

FEATURE_SELECTION_LIBRARY = FEATURE_SELECTION_FILTER_TECHNIQUES + FEATURE_SELECTION_SCORE_TECHNIQUES
FEATURE_SELECTION_LOOKUP = {tech["id"]: tech for tech in FEATURE_SELECTION_LIBRARY}

LEAKAGE_NAME_KEYWORDS = [
    "sar", "str", "suspicious", "fraud", "investigation", "case_status",
    "resolution", "filed", "outcome", "label", "true_pos", "final_label",
]

DIRECT_LEAKAGE_PATTERNS = {
    "label",
    "target",
    "final_label",
    "case_label",
    "str_label",
    "sar_label",
    "is_true_pos",
    "tp_from_str",
    "true_positive",
    "ground_truth",
    "actual_label",
}

TARGET_PROXY_PATTERNS = {
    "prior_sar_rate",
    "prior_str_rate",
    "sar_rate",
    "str_rate",
    "case_outcome",
    "case_disposition",
    "outcome_flag",
}

POST_OUTCOME_PATTERNS = {
    "case_status",
    "resolution",
    "resolution_days",
    "closed_by",
    "filed",
    "investigation",
    "review_outcome",
    "analyst_risk_score",
    "docs_requested",
    "customer_contacted",
    "edd_triggered",
    "investigator",
    "linked_cases_count",
}

FUTURE_INFORMATION_PATTERNS = {
    "future",
    "next_",
    "post_",
    "days_to",
    "resolution_days",
    "close_date",
    "closed_date",
    "filed_date",
}

FEATURE_FAMILY_PATTERNS = [
    ("transaction_behavior", ("txn", "amount", "volume", "count", "velocity", "balance", "ratio")),
    ("risk_controls", ("risk", "score", "profile", "flag", "pep", "sanction", "watchlist")),
    ("customer_context", ("customer", "party", "counterparty", "account", "segment", "kyc")),
    ("time_behavior", ("date", "time", "hour", "day", "month", "recency", "age")),
    ("network_case_context", ("case", "link", "network", "rule", "alert")),
]

GOVERNANCE_DECISION_ORDER = {
    "approved": 0,
    "needs_review": 1,
    "blocked_leakage": 2,
    "blocked_post_outcome": 3,
    "weak_redundant": 4,
}

GOVERNANCE_BUCKET_LABELS = {
    "approved": "Approved Operational Features",
    "needs_review": "Needs Review",
    "blocked_leakage": "Leakage / Target Proxy Blocked",
    "blocked_post_outcome": "Post-Outcome / Future Information Blocked",
    "weak_redundant": "Redundant / Weak Features",
}

HIGH_CARDINALITY_THRESHOLD = 0.95   # > 95% unique → likely ID column
LOW_CARDINALITY_THRESHOLD  = 50     # ≤ 50 unique values → categorical

# ─── Helper: safe read ────────────────────────────────────────────────────────

def _load_df(dataset: dict, sample_rows: int | None = None) -> pd.DataFrame:
    """Load a dataset dict (from MLOps registry) into a DataFrame."""
    file_path = dataset.get("file_path") or dataset.get("filename")
    if not file_path or not Path(str(file_path)).exists():
        raise FileNotFoundError(f"Dataset file not found: {file_path}")

    path = Path(str(file_path))
    if path.suffix.lower() == ".parquet":
        df = pd.read_parquet(path)
    else:
        df = pd.read_csv(path, low_memory=False)

    if sample_rows and len(df) > sample_rows:
        df = df.sample(n=sample_rows, random_state=42).reset_index(drop=True)

    return df


def _safe_float(value: Any, digits: int = 6) -> float | None:
    try:
        number = float(value)
    except Exception:
        return None
    if not math.isfinite(number):
        return None
    return round(number, digits)


def _numeric_like_ratio(series: pd.Series) -> float:
    if pd.api.types.is_bool_dtype(series) or pd.api.types.is_numeric_dtype(series):
        return 1.0
    numeric = pd.to_numeric(series, errors="coerce")
    valid = series.notna()
    return float(numeric.loc[valid].notna().mean()) if int(valid.sum()) else 0.0


def _classify_column(col: str, series: pd.Series, df: pd.DataFrame) -> dict:
    """Classify a column: id / timestamp / categorical / numeric / binary / text."""
    col_lower = col.lower()
    n         = len(series)
    n_unique  = series.nunique(dropna=True)
    numeric_ratio = _numeric_like_ratio(series)
    sample_strings = series.dropna().astype(str).head(200)
    avg_str_len = float(sample_strings.str.len().mean()) if len(sample_strings) else 0.0

    # ID detection
    is_id_name = any(p in col_lower for p in AML_ID_PATTERNS)
    cardinality_ratio = n_unique / max(n, 1)
    is_high_card = cardinality_ratio > HIGH_CARDINALITY_THRESHOLD and n_unique > 50
    if is_id_name:
        role = "id"
    elif any(p in col_lower for p in AML_TIMESTAMP_PATTERNS):
        role = "timestamp"
    elif series.dtype in [np.float64, np.float32, np.int64, np.int32, np.int16, np.int8]:
        if n_unique == 2:
            role = "binary"
        else:
            role = "numeric"
    elif series.dtype == object:
        if numeric_ratio >= 0.85:
            role = "binary" if n_unique == 2 else "numeric"
        elif is_high_card and avg_str_len >= 32:
            role = "text"
        elif n_unique <= LOW_CARDINALITY_THRESHOLD:
            role = "categorical"
        else:
            role = "categorical"
    elif str(series.dtype).startswith("datetime"):
        role = "timestamp"
    elif str(series.dtype) == "bool":
        role = "binary"
    else:
        role = "other"

    return {
        "col":             col,
        "dtype":           str(series.dtype),
        "role":            role,
        "n_unique":        int(n_unique),
        "cardinality_pct": round(cardinality_ratio * 100, 2),
        "is_id":           role == "id",
        "is_high_card":    is_high_card,
        "numeric_ratio":   round(float(numeric_ratio), 4),
        "avg_str_len":     round(avg_str_len, 2),
    }


def _coerce_binary_target(series: pd.Series) -> pd.Series:
    """Best-effort coercion of common AML target labels into a 0/1 float series."""
    if pd.api.types.is_bool_dtype(series):
        out = pd.Series(np.nan, index=series.index, dtype=float)
        valid = series.notna()
        out.loc[valid] = series.loc[valid].astype(int).astype(float)
        return out

    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.notna().any():
        uniq = sorted({float(v) for v in numeric.dropna().unique().tolist()})
        if uniq and set(uniq).issubset({0.0, 1.0}):
            return numeric.astype(float)
        if len(uniq) == 2:
            out = pd.Series(np.nan, index=series.index, dtype=float)
            out.loc[numeric == uniq[0]] = 0.0
            out.loc[numeric == uniq[1]] = 1.0
            return out

    text = series.fillna("").astype(str).str.strip().str.lower()
    positives = {
        "1", "true", "yes", "y", "tp", "positive", "suspicious", "sar", "str",
        "filed", "sar_filed", "str_filed", "closed_sar_filed", "closed_str_filed",
        "true_positive", "is_true_pos", "confirmed", "fraud",
    }
    negatives = {
        "0", "false", "no", "n", "fp", "negative", "non_sar", "non_str",
        "not_suspicious", "noise", "cleared", "false_positive", "benign",
    }
    mapped = pd.Series(np.nan, index=series.index, dtype=float)
    mapped.loc[text.isin(positives)] = 1.0
    mapped.loc[text.isin(negatives)] = 0.0
    if mapped.notna().any():
        return mapped

    if numeric.notna().any():
        midpoint = float(numeric.median())
        out = pd.Series(np.nan, index=series.index, dtype=float)
        valid = numeric.notna()
        out.loc[valid] = (numeric.loc[valid] >= midpoint).astype(float)
        return out

    return mapped


def _sample_values(series: pd.Series, limit: int = 5) -> list[str]:
    values = []
    seen = set()
    for value in series.dropna().astype(str).tolist():
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        values.append(cleaned)
        if len(values) >= limit:
            break
    return values


def _prepare_categorical_series(series: pd.Series, max_categories: int = 25) -> pd.Series:
    cleaned = series.fillna("UNKNOWN").astype(str).str.strip()
    cleaned = cleaned.replace({"": "UNKNOWN", "nan": "UNKNOWN", "None": "UNKNOWN"})
    if cleaned.nunique(dropna=False) <= max_categories:
        return cleaned
    top_values = set(cleaned.value_counts().head(max_categories - 1).index.tolist())
    return cleaned.where(cleaned.isin(top_values), "__OTHER__")


def _normalize_feature_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _feature_family(name: str) -> str:
    normalized = _normalize_feature_token(name)
    for family, tokens in FEATURE_FAMILY_PATTERNS:
        if any(token in normalized for token in tokens):
            return family
    return "general_context"


def _timing_classification(name: str) -> tuple[str, list[str]]:
    normalized = _normalize_feature_token(name)
    flags: list[str] = []

    if normalized in DIRECT_LEAKAGE_PATTERNS or any(pattern in normalized for pattern in DIRECT_LEAKAGE_PATTERNS):
        flags.append("direct_target_leakage")
        return "direct_target_proxy", flags

    if normalized in TARGET_PROXY_PATTERNS or any(pattern in normalized for pattern in TARGET_PROXY_PATTERNS):
        flags.append("target_proxy_risk")
        return "target_proxy_history", flags

    if normalized in POST_OUTCOME_PATTERNS or any(pattern in normalized for pattern in POST_OUTCOME_PATTERNS):
        flags.append("post_outcome")
        if "analyst" in normalized or "investigator" in normalized or "contacted" in normalized or "requested" in normalized:
            flags.append("analyst_action")
        return "post_investigation", flags

    if any(pattern in normalized for pattern in FUTURE_INFORMATION_PATTERNS):
        flags.append("future_information")
        return "future_information", flags

    return "decision_time_assumed", flags


def _vif_rows(
    df: pd.DataFrame,
    columns: list[str],
    max_features: int = 40,
) -> list[dict[str, Any]]:
    numeric_cols: list[str] = []
    for col in columns:
        if col not in df.columns:
            continue
        numeric = pd.to_numeric(df[col], errors="coerce")
        if int(numeric.notna().sum()) < 25:
            continue
        if float(numeric.var()) <= 1e-12:
            continue
        numeric_cols.append(col)

    if len(numeric_cols) < 2:
        return []

    selected_cols = numeric_cols[:max_features]
    frame = df[selected_cols].apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan)
    frame = frame.fillna(frame.median(numeric_only=True)).fillna(0.0)
    values = frame.to_numpy(dtype=float)
    if values.ndim != 2 or values.shape[1] < 2:
        return []

    means = np.nanmean(values, axis=0)
    stds = np.nanstd(values, axis=0)
    stds = np.where(stds <= 1e-12, 1.0, stds)
    scaled = (values - means) / stds
    corr = np.corrcoef(scaled, rowvar=False)
    if np.ndim(corr) != 2:
        return []
    corr = np.nan_to_num(corr, nan=0.0, posinf=0.0, neginf=0.0)
    np.fill_diagonal(corr, 1.0)
    inv_corr = np.linalg.pinv(corr)
    diag = np.diag(inv_corr)

    rows: list[dict[str, Any]] = []
    for idx, col in enumerate(selected_cols):
        vif_value = _safe_float(diag[idx], 6)
        if vif_value is None:
            continue
        rows.append({
            "feature": col,
            "score": float(vif_value),
            "reason": f"Variance inflation factor {float(vif_value):.2f}",
        })
    rows.sort(key=lambda item: (-float(item["score"]), str(item["feature"])))
    return rows


# ════════════════════════════════════════════════════════════════════════════
# EDAService
# ════════════════════════════════════════════════════════════════════════════

class EDAService:
    """All EDA analytics for the AML MLOps workbench."""

    # ── 1. Dataset Overview ───────────────────────────────────────────────────

    def dataset_overview(self, dataset: dict, sample_rows: int = 50_000) -> dict:
        """
        Full overview: shape, dtypes, role classification, memory, ID columns,
        quality score headline, missing pct, class balance (if target present).
        """
        df        = _load_df(dataset, sample_rows)
        total_n   = len(df)
        total_col = len(df.columns)

        columns_meta = []
        id_cols      = []
        ts_cols      = []
        num_cols     = []
        cat_cols     = []
        bin_cols     = []

        total_missing = 0
        total_cells   = total_n * total_col

        for col in df.columns:
            s    = df[col]
            meta = _classify_column(col, s, df)
            n_miss = int(s.isna().sum())
            meta["n_missing"]     = n_miss
            meta["missing_pct"]   = round(n_miss / max(total_n, 1) * 100, 2)
            meta["n_total"]       = total_n
            total_missing        += n_miss

            role = meta["role"]
            if role == "id":
                id_cols.append(col)
            elif role == "timestamp":
                ts_cols.append(col)
            elif role == "numeric":
                num_cols.append(col)
            elif role in ("categorical",):
                cat_cols.append(col)
            elif role == "binary":
                bin_cols.append(col)

            columns_meta.append(meta)

        overall_missing_pct = round(total_missing / max(total_cells, 1) * 100, 2)
        n_dup               = int(df.duplicated().sum())
        dup_pct             = round(n_dup / max(total_n, 1) * 100, 2)

        # Quality score (0-100)
        missing_penalty   = min(overall_missing_pct * 2, 40)
        dup_penalty       = min(dup_pct * 3, 20)
        id_col_penalty    = min(len(id_cols) / max(total_col, 1) * 30, 20)
        quality_score     = max(0, round(100 - missing_penalty - dup_penalty - id_col_penalty))

        # Memory
        mem_bytes = df.memory_usage(deep=True).sum()
        mem_mb    = round(mem_bytes / 1024 / 1024, 2)

        # Target column (auto-detect common AML target names)
        target_col = None
        for c in ["FINAL_LABEL", "final_label", "IS_TRUE_POS", "IS_SAR", "IS_STR", "IS_FRAUD", "LABEL", "TARGET", "is_true_pos"]:
            if c in df.columns:
                target_col = c
                break

        class_balance = None
        if target_col and target_col in df.columns:
            vc = df[target_col].value_counts(normalize=True)
            class_balance = {str(k): round(float(v) * 100, 2) for k, v in vc.items()}

        return {
            "dataset_id":       dataset.get("dataset_id"),
            "dataset_type":     dataset.get("dataset_type"),
            "filename":         dataset.get("filename"),
            "row_count":        total_n,
            "col_count":        total_col,
            "memory_mb":        mem_mb,
            "quality_score":    quality_score,
            "overall_missing_pct": overall_missing_pct,
            "duplicate_count":  n_dup,
            "duplicate_pct":    dup_pct,
            "id_columns":       id_cols,
            "timestamp_columns":ts_cols,
            "numeric_columns":  num_cols,
            "categorical_columns": cat_cols,
            "binary_columns":   bin_cols,
            "columns_meta":     columns_meta,
            "target_column":    target_col,
            "class_balance":    class_balance,
            "sample_rows_used": total_n,
        }

    # ── 2. Column Profile ─────────────────────────────────────────────────────

    def column_profile(self, dataset: dict, column: str,
                       sample_rows: int = 50_000, n_bins: int = 40,
                       target_col: str | None = None) -> dict:
        """Full per-column profile: stats, histogram, quantiles, top values."""
        df = _load_df(dataset, sample_rows)

        if column not in df.columns:
            raise ValueError(f"Column '{column}' not found in dataset")

        s    = df[column].copy()
        meta = _classify_column(column, s, df)
        role = meta["role"]

        result: dict[str, Any] = {
            "column":       column,
            "dtype":        str(s.dtype),
            "role":         role,
            "n_total":      len(s),
            "n_missing":    int(s.isna().sum()),
            "missing_pct":  round(s.isna().mean() * 100, 2),
            "n_unique":     int(s.nunique(dropna=True)),
            "cardinality_pct": meta["cardinality_pct"],
            "is_id":        meta["is_id"],
        }

        if role in ("numeric", "binary"):
            sn = pd.to_numeric(s, errors="coerce").dropna()
            if len(sn) == 0:
                result["stats"] = {}
                return result

            desc = sn.describe(percentiles=[0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99])
            skw  = float(sn.skew())
            kurt = float(sn.kurtosis())

            # Histogram
            counts, edges = np.histogram(sn, bins=n_bins)
            histogram = [
                {"bin_start": round(float(edges[i]), 4),
                 "bin_end":   round(float(edges[i+1]), 4),
                 "count":     int(counts[i])}
                for i in range(len(counts))
            ]

            # Quantile plot (for box / violin)
            quantiles = {
                str(k): round(float(v), 4)
                for k, v in desc.items()
                if k.endswith("%") or k in ("min", "max", "mean", "50%")
            }

            # Normality test (only if <= 5000 samples)
            normality = None
            if len(sn) <= 5000:
                try:
                    stat, p = scipy_stats.shapiro(sn.sample(min(len(sn), 5000), random_state=42))
                    normality = {"test": "shapiro", "stat": round(float(stat), 4), "p_value": round(float(p), 4)}
                except Exception:
                    pass

            # Target breakdown (TP rate by numeric bin)
            target_breakdown = None
            if target_col and target_col in df.columns:
                tdf = df[[column, target_col]].dropna()
                tdf[column] = pd.to_numeric(tdf[column], errors="coerce")
                tdf[target_col] = _coerce_binary_target(tdf[target_col])
                tdf = tdf.dropna()
                if len(tdf) > 0:
                    tdf["_bin"] = pd.qcut(tdf[column], q=10, duplicates="drop", labels=False)
                    grp = tdf.groupby("_bin").agg(
                        mean_val=(column, "mean"),
                        tp_rate=(target_col, "mean"),
                        count=(target_col, "count")
                    ).reset_index()
                    target_breakdown = grp[["mean_val", "tp_rate", "count"]].round(4).to_dict("records")

            result["stats"] = {
                "mean":   round(float(desc["mean"]), 4),
                "std":    round(float(desc["std"]), 4),
                "min":    round(float(desc["min"]), 4),
                "max":    round(float(desc["max"]), 4),
                "median": round(float(desc["50%"]), 4),
                "p25":    round(float(desc["25%"]), 4),
                "p75":    round(float(desc["75%"]), 4),
                "p1":     round(float(desc["1%"]), 4),
                "p99":    round(float(desc["99%"]), 4),
                "skewness":  round(skw, 4),
                "kurtosis":  round(kurt, 4),
                "iqr":       round(float(desc["75%"] - desc["25%"]), 4),
                "range":     round(float(desc["max"] - desc["min"]), 4),
                "cv":        round(float(desc["std"] / (abs(desc["mean"]) + 1e-9)), 4),
            }
            result["histogram"]        = histogram
            result["quantiles"]        = quantiles
            result["normality"]        = normality
            result["target_breakdown"] = target_breakdown

        else:  # categorical / text / id
            vc       = s.value_counts(dropna=False).head(50)
            vcp      = s.value_counts(normalize=True, dropna=False).head(50)
            top_vals = [
                {"value": str(k), "count": int(v), "pct": round(float(vcp.get(k, 0)) * 100, 2)}
                for k, v in vc.items()
            ]

            # Target TP rate per category
            target_breakdown = None
            if target_col and target_col in df.columns:
                tdf = df[[column, target_col]].dropna()
                tdf[target_col] = _coerce_binary_target(tdf[target_col])
                tdf = tdf.dropna()
                if len(tdf) > 0:
                    grp = (
                        tdf.groupby(column)[target_col]
                        .agg(["mean", "count"])
                        .rename(columns={"mean": "tp_rate"})
                        .reset_index()
                        .sort_values("count", ascending=False)
                        .head(30)
                    )
                    grp["tp_rate"] = grp["tp_rate"].round(4)
                    target_breakdown = grp.rename(columns={column: "value"}).to_dict("records")

            result["top_values"]       = top_vals
            result["target_breakdown"] = target_breakdown
            result["stats"]            = {
                "mode":          str(vc.index[0]) if len(vc) else None,
                "mode_count":    int(vc.iloc[0]) if len(vc) else 0,
                "entropy":       round(float((-vcp * np.log2(vcp + 1e-12)).sum()), 4),
                "n_categories":  int(s.nunique(dropna=True)),
            }

        return result

    # ── 3. Missing Value Analysis ─────────────────────────────────────────────

    def missing_analysis(self, dataset: dict, sample_rows: int = 50_000) -> dict:
        """Detailed missing-value analysis: counts, heatmap pattern, MCAR/MAR guess."""
        df      = _load_df(dataset, sample_rows)
        n       = len(df)

        miss_per_col = df.isnull().sum()
        miss_per_row = df.isnull().sum(axis=1)

        col_summary = []
        for col in df.columns:
            n_miss = int(miss_per_col[col])
            pct    = round(n_miss / max(n, 1) * 100, 2)
            role   = _classify_column(col, df[col], df)["role"]
            severity = "critical" if pct > 30 else "high" if pct > 10 else "medium" if pct > 1 else "ok"
            col_summary.append({
                "column":       col,
                "n_missing":    n_miss,
                "pct_missing":  pct,
                "role":         role,
                "severity":     severity,
            })

        col_summary.sort(key=lambda x: x["pct_missing"], reverse=True)

        # Missingness correlation (do columns tend to be missing together?)
        miss_matrix = df.isnull()
        miss_corr   = []
        high_miss   = [c for c in df.columns if miss_per_col[c] > 0]
        if len(high_miss) > 1:
            for i, c1 in enumerate(high_miss[:20]):
                for c2 in high_miss[i+1:20]:
                    try:
                        r = float(miss_matrix[c1].corr(miss_matrix[c2]))
                        if abs(r) > 0.3:
                            miss_corr.append({"col_a": c1, "col_b": c2, "correlation": round(r, 3)})
                    except Exception:
                        pass

        # Row completeness distribution
        row_completeness = miss_per_row.value_counts().sort_index()
        row_dist = [
            {"n_missing_cols": int(k), "n_rows": int(v)}
            for k, v in row_completeness.items()
        ]

        return {
            "total_rows":         n,
            "total_cols":         len(df.columns),
            "total_missing":      int(miss_per_col.sum()),
            "total_cells":        n * len(df.columns),
            "overall_missing_pct":round(miss_per_col.sum() / max(n * len(df.columns), 1) * 100, 2),
            "cols_with_missing":  int((miss_per_col > 0).sum()),
            "cols_fully_missing": int((miss_per_col == n).sum()),
            "column_summary":     col_summary,
            "missingness_correlation": sorted(miss_corr, key=lambda x: abs(x["correlation"]), reverse=True)[:20],
            "row_completeness_dist":   row_dist,
            "rows_complete":      int((miss_per_row == 0).sum()),
            "rows_with_any_missing":   int((miss_per_row > 0).sum()),
        }

    # ── 4. Outlier Detection ──────────────────────────────────────────────────

    def outlier_analysis(self, dataset: dict, columns: list[str] | None = None,
                         sample_rows: int = 50_000) -> dict:
        """Multi-method outlier detection: IQR, Z-score, Modified Z-score."""
        df  = _load_df(dataset, sample_rows)
        n   = len(df)

        # Use provided columns or auto-select numeric
        if columns:
            num_cols = [c for c in columns if c in df.columns]
        else:
            num_cols = [c for c in df.columns
                        if pd.api.types.is_numeric_dtype(df[c])
                        and not _classify_column(c, df[c], df)["is_id"]
                        and df[c].nunique() > 5][:30]

        results = []
        total_outlier_rows = set()

        for col in num_cols:
            s = pd.to_numeric(df[col], errors="coerce").dropna()
            if len(s) < 10:
                continue

            q1, q3 = float(s.quantile(0.25)), float(s.quantile(0.75))
            iqr    = q3 - q1
            iqr_lo = q1 - 1.5 * iqr
            iqr_hi = q3 + 1.5 * iqr
            iqr_mask  = (s < iqr_lo) | (s > iqr_hi)

            mean_v, std_v = float(s.mean()), float(s.std())
            z_mask        = (np.abs((s - mean_v) / (std_v + 1e-9)) > 3)

            med   = float(s.median())
            mad   = float((s - med).abs().median())
            mod_z = 0.6745 * (s - med) / (mad + 1e-9)
            modz_mask = np.abs(mod_z) > 3.5

            iqr_n  = int(iqr_mask.sum())
            z_n    = int(z_mask.sum())
            modz_n = int(modz_mask.sum())
            consensus = int((iqr_mask & z_mask).sum())

            total_outlier_rows.update(iqr_mask[iqr_mask].index.tolist()[:100])

            results.append({
                "column":         col,
                "n_total":        int(len(s)),
                "iqr_outliers":   iqr_n,
                "iqr_pct":        round(iqr_n / len(s) * 100, 2),
                "iqr_lower":      round(iqr_lo, 4),
                "iqr_upper":      round(iqr_hi, 4),
                "zscore_outliers": z_n,
                "zscore_pct":     round(z_n / len(s) * 100, 2),
                "modz_outliers":  modz_n,
                "modz_pct":       round(modz_n / len(s) * 100, 2),
                "consensus_outliers": consensus,
                "consensus_pct":  round(consensus / len(s) * 100, 2),
                "mean":           round(mean_v, 4),
                "std":            round(std_v, 4),
                "median":         round(med, 4),
                "mad":            round(mad, 4),
                "q1":             round(q1, 4),
                "q3":             round(q3, 4),
                "iqr":            round(iqr, 4),
                "skewness":       round(float(s.skew()), 4),
                "severity":       "critical" if consensus > len(s) * 0.1 else
                                  "high"     if consensus > len(s) * 0.03 else
                                  "medium"   if consensus > 0 else "ok",
            })

        results.sort(key=lambda x: x["consensus_pct"], reverse=True)

        return {
            "total_rows":         n,
            "columns_analyzed":   len(results),
            "columns":            results,
            "estimated_outlier_rows": len(total_outlier_rows),
            "outlier_row_pct":    round(len(total_outlier_rows) / max(n, 1) * 100, 2),
        }

    # ── 5. Duplicate Analysis ─────────────────────────────────────────────────

    def duplicate_analysis(self, dataset: dict, sample_rows: int = 100_000) -> dict:
        """Duplicate detection: exact rows, near-dupes by key columns."""
        df = _load_df(dataset, sample_rows)
        n  = len(df)

        # Exact duplicates
        dup_mask  = df.duplicated(keep="first")
        n_dup     = int(dup_mask.sum())

        # Subset duplicates (drop ID cols)
        id_cols   = [c for c in df.columns if _classify_column(c, df[c], df)["is_id"]]
        non_id    = [c for c in df.columns if c not in id_cols]
        n_dup_non_id = int(df.duplicated(subset=non_id, keep="first").sum()) if non_id else 0

        # Sample of duplicate rows
        sample_dups = []
        if n_dup > 0:
            dup_df = df[dup_mask].head(10)
            sample_dups = dup_df.to_dict("records")

        return {
            "total_rows":             n,
            "exact_duplicates":       n_dup,
            "exact_dup_pct":          round(n_dup / max(n, 1) * 100, 2),
            "non_id_duplicates":      n_dup_non_id,
            "non_id_dup_pct":         round(n_dup_non_id / max(n, 1) * 100, 2),
            "id_columns_excluded":    id_cols,
            "unique_rows":            n - n_dup,
            "sample_duplicate_rows":  sample_dups,
        }

    # ── 6. Correlation Matrix ─────────────────────────────────────────────────

    def correlation_matrix(self, dataset: dict, method: str = "pearson",
                           columns: list[str] | None = None,
                           sample_rows: int = 50_000) -> dict:
        """Correlation matrix with significance testing."""
        df = _load_df(dataset, sample_rows)

        # Select numeric non-ID columns
        if columns:
            num_cols = [c for c in columns if c in df.columns]
        else:
            num_cols = [
                c for c in df.columns
                if pd.api.types.is_numeric_dtype(df[c])
                and not _classify_column(c, df[c], df)["is_id"]
                and df[c].nunique() > 2
            ][:40]

        if len(num_cols) < 2:
            return {"matrix": [], "columns": [], "method": method, "error": "Need ≥2 numeric columns"}

        df_num = df[num_cols].apply(pd.to_numeric, errors="coerce")

        corr   = df_num.corr(method=method)  # type: ignore[arg-type]
        matrix = []
        for r in corr.index:
            for c in corr.columns:
                v = corr.loc[r, c]
                matrix.append({
                    "x":     r,
                    "y":     c,
                    "value": round(float(v), 4) if not math.isnan(v) else None,
                })

        # Top correlated pairs (excluding diagonal)
        top_pairs = []
        for r in corr.index:
            for c in corr.columns:
                if r >= c:
                    continue
                v = corr.loc[r, c]
                if math.isnan(v):
                    continue
                top_pairs.append({"col_a": r, "col_b": c, "correlation": round(float(v), 4)})

        top_pairs.sort(key=lambda x: abs(x["correlation"]), reverse=True)

        return {
            "method":    method,
            "columns":   num_cols,
            "matrix":    matrix,
            "top_pairs": top_pairs[:30],
            "n_cols":    len(num_cols),
            "n_rows_used": len(df_num.dropna()),
        }

    # ── 7. Feature vs Target ──────────────────────────────────────────────────

    def feature_target_analysis(
        self,
        dataset: dict,
        target_col: str,
        sample_rows: int = 50_000,
        feature_columns: list[str] | None = None,
        max_features: int | None = 250,
        analysis_mode: str = "auto",
        positive_class: Any | None = None,
    ) -> dict:
        """
        Full feature-target analysis:
        - Pearson / point-biserial correlation (numeric vs binary target)
        - Cramer's V + Chi-square (categorical vs binary target)
        - Information Gain (mutual information)
        - Fisher score (numeric class separability)
        - IV (Information Value) for each feature
        """
        df = _load_df(dataset, sample_rows)

        if target_col not in df.columns:
            raise ValueError(f"Target column '{target_col}' not found")

        raw_target = df[target_col]
        target_non_null = raw_target.dropna()
        target_classes = [
            str(v) for v in target_non_null.astype(str).value_counts().head(50).index.tolist()
        ]
        requested_mode = str(analysis_mode or "auto").strip().lower()
        if requested_mode not in {"auto", "binary", "multiclass", "regression"}:
            requested_mode = "auto"

        if requested_mode == "auto":
            target_unique = int(target_non_null.nunique(dropna=True))
            numeric_target = pd.to_numeric(target_non_null, errors="coerce")
            numeric_ratio = float(numeric_target.notna().mean()) if len(target_non_null) else 0.0
            if target_unique > 2 and numeric_ratio >= 0.9 and target_unique > 10:
                resolved_mode = "regression"
            elif target_unique > 2:
                resolved_mode = "multiclass"
            else:
                resolved_mode = "binary"
        else:
            resolved_mode = requested_mode

        features = []
        id_cols = [c for c in df.columns if _classify_column(c, df[c], df)["is_id"]]
        candidate_cols = [c for c in (feature_columns or df.columns.tolist()) if c in df.columns]
        analysis_cols = [c for c in candidate_cols if c != target_col and c not in id_cols]
        if max_features is not None and len(analysis_cols) > max_features:
            analysis_cols = analysis_cols[:max_features]

        try:
            from sklearn.feature_selection import mutual_info_classif, mutual_info_regression
        except Exception:
            mutual_info_classif = None
            mutual_info_regression = None

        def _return_non_binary_mode(mode_name: str) -> dict:
            valid_target = raw_target.notna()
            y_raw = df.loc[valid_target, target_col]
            rows_analyzed = int(valid_target.sum())
            mode_features: list[dict[str, Any]] = []
            y_class_codes = None
            if mode_name == "multiclass":
                y_class_codes = pd.factorize(y_raw.astype(str))[0]

            for col in analysis_cols:
                s = df.loc[valid_target, col]
                meta = _classify_column(col, s, df)
                role = meta.get("role")
                entry: dict[str, Any] = {
                    "column": col,
                    "role": role,
                    "dtype": meta.get("dtype"),
                    "missing_pct": _safe_float(s.isna().mean(), 6),
                    "distinct_count": int(s.nunique(dropna=True)),
                    "information_gain": None,
                    "importance": 0.0,
                    "spearman_correlation": None,
                    "spearman_abs": None,
                    "analysis_mode": mode_name,
                    "rows_used": 0,
                    "woe_bins": [],
                }

                if role in ("numeric", "binary"):
                    xv = pd.to_numeric(s, errors="coerce")
                    if mode_name == "regression":
                        y_num = pd.to_numeric(y_raw, errors="coerce")
                        valid = ~(xv.isna() | y_num.isna())
                        if int(valid.sum()) >= 10:
                            xv_valid = xv[valid]
                            y_valid = y_num[valid]
                            entry["rows_used"] = int(valid.sum())
                            try:
                                spearman_r, _ = scipy_stats.spearmanr(xv_valid, y_valid)
                                entry["spearman_correlation"] = _safe_float(spearman_r, 4)
                                entry["spearman_abs"] = _safe_float(abs(spearman_r), 6)
                            except Exception:
                                pass
                            if mutual_info_regression is not None and int(xv_valid.nunique()) > 1:
                                try:
                                    mi = mutual_info_regression(
                                        xv_valid.to_frame(name=str(col)),
                                        y_valid,
                                        random_state=42,
                                    )
                                    entry["information_gain"] = _safe_float(mi[0], 6)
                                except Exception:
                                    pass
                    else:
                        valid = ~xv.isna()
                        if int(valid.sum()) >= 10 and y_class_codes is not None:
                            xv_valid = xv[valid]
                            y_valid = y_class_codes[valid.to_numpy()]
                            entry["rows_used"] = int(valid.sum())
                            if mutual_info_classif is not None and int(xv_valid.nunique()) > 1:
                                try:
                                    mi = mutual_info_classif(
                                        xv_valid.to_frame(name=str(col)),
                                        y_valid,
                                        discrete_features=False,
                                        random_state=42,
                                    )
                                    entry["information_gain"] = _safe_float(mi[0], 6)
                                except Exception:
                                    pass
                else:
                    xv = _prepare_categorical_series(s)
                    valid = ~xv.isna()
                    if int(valid.sum()) >= 10:
                        xv_valid = xv[valid].astype(str)
                        entry["rows_used"] = int(valid.sum())
                        if mode_name == "regression":
                            y_num = pd.to_numeric(y_raw[valid], errors="coerce")
                            valid_reg = ~y_num.isna()
                            if int(valid_reg.sum()) >= 10 and mutual_info_regression is not None:
                                try:
                                    x_codes = pd.factorize(xv_valid[valid_reg])[0]
                                    mi = mutual_info_regression(
                                        pd.DataFrame({"_x": x_codes}),
                                        y_num[valid_reg],
                                        random_state=42,
                                    )
                                    entry["information_gain"] = _safe_float(mi[0], 6)
                                except Exception:
                                    pass
                        else:
                            if y_class_codes is not None and mutual_info_classif is not None:
                                try:
                                    x_codes = pd.factorize(xv_valid)[0]
                                    y_valid = y_class_codes[valid.to_numpy()]
                                    mi = mutual_info_classif(
                                        pd.DataFrame({"_x": x_codes}),
                                        y_valid,
                                        discrete_features=True,
                                        random_state=42,
                                    )
                                    entry["information_gain"] = _safe_float(mi[0], 6)
                                except Exception:
                                    pass

                if entry.get("information_gain") is not None:
                    entry["importance"] = float(entry["information_gain"])
                elif entry.get("spearman_abs") is not None:
                    entry["importance"] = float(entry["spearman_abs"])
                mode_features.append(entry)

            mode_features.sort(key=lambda item: float(item.get("importance") or 0.0), reverse=True)
            matrix = [
                {
                    "feature": f.get("column"),
                    "value": float(f.get("importance") or 0.0),
                    "dtype": f.get("role"),
                    "metric": "information_gain" if mode_name == "multiclass" else "spearman_abs",
                    "information_gain": f.get("information_gain"),
                    "spearman_abs": f.get("spearman_abs"),
                }
                for f in mode_features
            ]
            guidance = (
                "Multiclass analysis selected. Use class-specific target mapping to compare positive class behavior."
                if mode_name == "multiclass"
                else "Regression analysis selected. Feature ranking reflects monotonic and information-based association with numeric target."
            )
            return {
                "target_column": target_col,
                "analysis_mode_used": mode_name,
                "available_target_classes": target_classes,
                "target_mean": None,
                "target_n_pos": None,
                "target_n_neg": None,
                "rows_analyzed": rows_analyzed,
                "recommended_metric": "information_gain" if mode_name == "multiclass" else "spearman_abs",
                "recommended_reason": guidance,
                "metric_coverage": {
                    "information_gain": round(sum(1 for f in mode_features if f.get("information_gain") is not None) / max(len(mode_features), 1), 4),
                    "spearman_abs": round(sum(1 for f in mode_features if f.get("spearman_abs") is not None) / max(len(mode_features), 1), 4),
                },
                "techniques": [dict(tech) for tech in FEATURE_SELECTION_SCORE_TECHNIQUES],
                "matrix": matrix,
                "features": mode_features,
                "top_numeric": [f for f in mode_features if f.get("role") in ("numeric", "binary")][:15],
                "top_categorical": [f for f in mode_features if f.get("role") == "categorical"][:15],
                "needs_binary_guidance": True,
                "positive_class": positive_class,
            }

        if resolved_mode != "binary":
            return _return_non_binary_mode(resolved_mode)

        if positive_class is not None:
            y = (raw_target.astype(str) == str(positive_class)).astype(int)
            valid_target_mask = raw_target.notna()
        else:
            y = _coerce_binary_target(raw_target)
            valid_target_mask = y.isin([0, 1])

        if int(valid_target_mask.sum()) < 10:
            if requested_mode == "auto" and int(target_non_null.nunique(dropna=True)) > 2:
                return _return_non_binary_mode("multiclass")
            raise ValueError("Target column must contain enough binary labels for this analysis")
        y = y.loc[valid_target_mask].astype(int)

        target_rate_overall = float(y.mean())
        target_entropy = 0.0
        if 0.0 < target_rate_overall < 1.0:
            target_entropy = float(
                scipy_stats.entropy(
                    [target_rate_overall, 1.0 - target_rate_overall],
                    base=2,
                )
            )

        techniques = [dict(tech) for tech in FEATURE_SELECTION_SCORE_TECHNIQUES]

        for col in analysis_cols:
            s = df.loc[valid_target_mask, col]
            meta = _classify_column(col, s, df)
            role = meta["role"]
            entry: dict[str, Any] = {
                "column": col,
                "role": role,
                "dtype": meta.get("dtype"),
                "missing_pct": _safe_float(s.isna().mean(), 6),
                "distinct_count": int(s.nunique(dropna=True)),
                "information_gain": None,
                "information_value": None,
                "uncertainty_coefficient": None,
                "pearson_correlation": None,
                "pearson_abs": None,
                "spearman_correlation": None,
                "spearman_abs": None,
                "kendall_tau": None,
                "kendall_abs": None,
                "point_biserial": None,
                "point_biserial_abs": None,
                "fisher_score": None,
                "anova_f_score": None,
                "anova_p_value": None,
                "t_statistic": None,
                "t_statistic_abs": None,
                "t_test_p_value": None,
                "ks_statistic": None,
                "ks_p_value": None,
                "roc_auc_univariate": None,
                "gini_gain": None,
                "chi_square": None,
                "chi_square_p_value": None,
                "likelihood_ratio": None,
                "cramers_v": None,
                "target_rate_range": None,
                "target_rate_lift": None,
                "event_rate_std": None,
                "woe_peak_abs": None,
                "missingness_delta": None,
                "variance": None,
                "mean_abs_deviation": None,
                "dispersion_ratio": None,
                "woe_bins": [],
            }

            missing_mask = s.isna()
            if missing_mask.any() and (~missing_mask).any():
                missing_rate = _safe_float(y.loc[missing_mask].mean(), 6)
                present_rate = _safe_float(y.loc[~missing_mask].mean(), 6)
                if missing_rate is not None and present_rate is not None:
                    entry["missingness_delta"] = round(abs(missing_rate - present_rate), 6)

            if role in ("numeric", "binary"):
                sn = pd.to_numeric(s, errors="coerce")
                valid = ~(sn.isna() | y.isna())
                entry["rows_used"] = int(valid.sum())
                if int(valid.sum()) >= 2:
                    xv = sn[valid]
                    yv = y[valid]
                    pos_vals = xv[yv == 1]
                    neg_vals = xv[yv == 0]

                    entry["variance"] = _safe_float(xv.var(), 6)
                    mean_v = float(xv.mean())
                    entry["mean_abs_deviation"] = _safe_float(np.mean(np.abs(xv - mean_v)), 6)
                    pos_abs = np.abs(xv.to_numpy())
                    pos_abs = pos_abs[pos_abs > 0]
                    gmean_abs = float(np.exp(np.mean(np.log(pos_abs)))) if pos_abs.size else None
                    entry["dispersion_ratio"] = _safe_float(
                        abs(mean_v) / gmean_abs if gmean_abs and gmean_abs > 0 else None,
                        6,
                    )

                    if len(pos_vals) >= 2 and len(neg_vals) >= 2:
                        try:
                            r, p = scipy_stats.pointbiserialr(yv, xv)
                            entry["correlation"] = _safe_float(r, 4)
                            entry["pearson_correlation"] = _safe_float(r, 4)
                            entry["point_biserial"] = _safe_float(r, 4)
                            entry["pearson_abs"] = _safe_float(abs(r), 6)
                            entry["point_biserial_abs"] = _safe_float(abs(r), 6)
                            entry["p_value"] = _safe_float(p, 6)
                        except Exception:
                            pass

                        try:
                            spearman_r, _ = scipy_stats.spearmanr(yv, xv)
                            entry["spearman_correlation"] = _safe_float(spearman_r, 4)
                            entry["spearman_abs"] = _safe_float(abs(spearman_r), 6)
                        except Exception:
                            pass

                        try:
                            kendall_tau, _ = scipy_stats.kendalltau(yv, xv)
                            entry["kendall_tau"] = _safe_float(kendall_tau, 4)
                            entry["kendall_abs"] = _safe_float(abs(kendall_tau), 6)
                        except Exception:
                            pass

                        mu_pos = float(pos_vals.mean())
                        mu_neg = float(neg_vals.mean())
                        var_pos = float(pos_vals.var()) if len(pos_vals) > 1 else 0.0
                        var_neg = float(neg_vals.var()) if len(neg_vals) > 1 else 0.0
                        fisher = ((mu_pos - mu_neg) ** 2) / (var_pos + var_neg + 1e-9)
                        entry["fisher_score"] = _safe_float(fisher, 6)

                        try:
                            f_stat, f_p = scipy_stats.f_oneway(pos_vals, neg_vals)
                            entry["anova_f_score"] = _safe_float(f_stat, 6)
                            entry["anova_p_value"] = _safe_float(f_p, 6)
                        except Exception:
                            pass

                        try:
                            t_stat, t_p = scipy_stats.ttest_ind(pos_vals, neg_vals, equal_var=False, nan_policy="omit")
                            entry["t_statistic"] = _safe_float(t_stat, 6)
                            entry["t_statistic_abs"] = _safe_float(abs(t_stat), 6)
                            entry["t_test_p_value"] = _safe_float(t_p, 6)
                        except Exception:
                            pass

                        try:
                            ks_stat, ks_p = scipy_stats.ks_2samp(pos_vals, neg_vals)
                            entry["ks_statistic"] = _safe_float(ks_stat, 6)
                            entry["ks_p_value"] = _safe_float(ks_p, 6)
                        except Exception:
                            pass

                        try:
                            mw_u, _ = scipy_stats.mannwhitneyu(pos_vals, neg_vals, alternative="two-sided")
                            denom = max(len(pos_vals) * len(neg_vals), 1)
                            auc = max(float(mw_u) / denom, 1.0 - (float(mw_u) / denom))
                            entry["roc_auc_univariate"] = _safe_float(auc, 6)
                            entry["gini_gain"] = _safe_float((2.0 * auc) - 1.0, 6)
                        except Exception:
                            pass

                    if mutual_info_classif is not None and int(yv.nunique()) > 1 and int(xv.nunique()) > 1:
                        try:
                            mi = mutual_info_classif(
                                xv.to_frame(name=str(col)),
                                yv,
                                discrete_features=False,
                                random_state=42,
                            )
                            entry["information_gain"] = _safe_float(mi[0], 6)
                        except Exception:
                            entry["information_gain"] = None

                    if int(yv.nunique()) > 1 and int(xv.nunique()) > 1:
                        iv, woe_bins = self._compute_iv(xv, yv, bins=10, is_cat=False)
                        entry["information_value"] = _safe_float(iv, 4)
                        entry["woe_bins"] = woe_bins

            elif role in ("categorical", "text"):
                valid = ~(s.isna() | y.isna())
                entry["rows_used"] = int(valid.sum())
                if int(valid.sum()) >= 2:
                    xv = _prepare_categorical_series(s[valid])
                    yv = y[valid]
                    ct = pd.crosstab(xv, yv)

                    if ct.shape[0] >= 2 and ct.shape[1] >= 2:
                        observed = ct.to_numpy(dtype=float)
                        chi2, chi2_p, _, expected = scipy_stats.chi2_contingency(ct, correction=False)
                        chi2 = float(chi2)
                        n_v = int(valid.sum())
                        k = max(min(ct.shape) - 1, 1)
                        v = math.sqrt(chi2 / max(n_v * k, 1))
                        mask = observed > 0
                        likelihood_ratio = 2.0 * np.sum(observed[mask] * np.log(observed[mask] / expected[mask]))

                        entry["cramers_v"] = _safe_float(v, 4)
                        entry["importance"] = _safe_float(v, 6)
                        entry["correlation"] = _safe_float(v, 4)
                        entry["chi_square"] = _safe_float(chi2, 4)
                        entry["chi_square_p_value"] = _safe_float(chi2_p, 6)
                        entry["likelihood_ratio"] = _safe_float(likelihood_ratio, 6)

                    if mutual_info_classif is not None and int(yv.nunique()) > 1 and int(xv.nunique()) > 1:
                        try:
                            codes, _ = pd.factorize(xv)
                            mi = mutual_info_classif(
                                pd.DataFrame({"_x": codes}),
                                yv,
                                discrete_features=True,
                                random_state=42,
                            )
                            entry["information_gain"] = _safe_float(mi[0], 6)
                        except Exception:
                            entry["information_gain"] = None

                    if int(yv.nunique()) > 1 and int(xv.nunique()) > 1:
                        iv, woe_bins = self._compute_iv(xv, yv, bins=None, is_cat=True)
                        entry["information_value"] = _safe_float(iv, 4)
                        entry["woe_bins"] = woe_bins

            else:
                entry["rows_used"] = 0

            rates = [float(b.get("tp_rate")) for b in entry.get("woe_bins") or [] if b.get("tp_rate") is not None]
            if rates:
                entry["target_rate_range"] = _safe_float(max(rates) - min(rates), 6)
                if target_rate_overall > 0:
                    entry["target_rate_lift"] = _safe_float(max(rates) / target_rate_overall, 6)
                entry["event_rate_std"] = _safe_float(np.std(rates), 6)
            if entry.get("woe_bins"):
                entry["woe_peak_abs"] = _safe_float(
                    max(abs(float(bin_row.get("woe") or 0.0)) for bin_row in entry["woe_bins"]),
                    6,
                )

            if entry.get("information_gain") is not None and target_entropy > 0:
                entry["uncertainty_coefficient"] = _safe_float(
                    float(entry["information_gain"]) / target_entropy,
                    6,
                )

            entry["tp_rate_overall"] = round(float(y.mean()), 4)
            if entry.get("importance") is None:
                entry["importance"] = (
                    entry.get("information_gain")
                    or entry.get("information_value")
                    or entry.get("roc_auc_univariate")
                    or entry.get("pearson_abs")
                    or entry.get("cramers_v")
                    or 0.0
                )
            features.append(entry)

        def _rank_score(item: dict) -> float:
            for metric_id in ("information_value", "information_gain", "roc_auc_univariate", "pearson_abs", "cramers_v"):
                value = item.get(metric_id)
                if value is not None:
                    return float(value or 0.0)
            return float(item.get("importance") or 0.0)

        features.sort(key=_rank_score, reverse=True)

        for f in features:
            iv = f.get("information_value", 0) or 0
            f["iv"] = f.get("information_value")
            f["iv_strength"] = (
                "Very Strong" if iv > 0.5 else
                "Strong" if iv > 0.3 else
                "Medium" if iv > 0.1 else
                "Weak" if iv > 0.02 else "Useless"
            )

        total_features = max(len(features), 1)
        metric_coverage = {
            tech["id"]: round(
                sum(1 for feat in features if feat.get(tech["id"]) is not None) / total_features,
                4,
            )
            for tech in techniques
        }

        has_numeric = any(f.get("role") in ("numeric", "binary") for f in features)
        has_categorical = any(f.get("role") == "categorical" for f in features)
        if has_numeric and has_categorical and metric_coverage.get("information_value", 0) >= 0.25:
            recommended_metric = "information_value"
            recommended_reason = "Information Value is a strong default for binary AML targets and works across numeric and categorical features."
        elif metric_coverage.get("information_gain", 0) >= 0.25:
            recommended_metric = "information_gain"
            recommended_reason = "Information Gain gives the broadest coverage across the current feature mix."
        elif has_numeric and metric_coverage.get("roc_auc_univariate", 0) >= 0.15:
            recommended_metric = "roc_auc_univariate"
            recommended_reason = "Univariate ROC AUC is the most stable numeric discriminator available in this sample."
        elif has_categorical and metric_coverage.get("cramers_v", 0) >= 0.15:
            recommended_metric = "cramers_v"
            recommended_reason = "Cramer's V is the clearest categorical association signal in this dataset."
        else:
            recommended_metric = "pearson_abs"
            recommended_reason = "Pearson / point-biserial correlation is the fallback signal when other techniques have sparse coverage."

        matrix = []
        for f in features:
            score_value = f.get(recommended_metric)
            if score_value is None:
                score_value = f.get("information_gain")
            if score_value is None:
                score_value = f.get("importance")
            matrix.append({
                "feature": f.get("column"),
                "value": float(score_value) if score_value is not None else None,
                "dtype": f.get("role"),
                "metric": recommended_metric,
                "pearson_correlation": f.get("pearson_correlation"),
                "chi_square": f.get("chi_square"),
                "fisher_score": f.get("fisher_score"),
                "information_gain": f.get("information_gain"),
                "information_value": f.get("information_value"),
                "uncertainty_coefficient": f.get("uncertainty_coefficient"),
                "pearson_abs": f.get("pearson_abs"),
                "spearman_abs": f.get("spearman_abs"),
                "kendall_abs": f.get("kendall_abs"),
                "point_biserial_abs": f.get("point_biserial_abs"),
                "anova_f_score": f.get("anova_f_score"),
                "t_statistic_abs": f.get("t_statistic_abs"),
                "ks_statistic": f.get("ks_statistic"),
                "roc_auc_univariate": f.get("roc_auc_univariate"),
                "gini_gain": f.get("gini_gain"),
                "cramers_v": f.get("cramers_v"),
                "target_rate_range": f.get("target_rate_range"),
                "target_rate_lift": f.get("target_rate_lift"),
                "event_rate_std": f.get("event_rate_std"),
                "woe_peak_abs": f.get("woe_peak_abs"),
                "missingness_delta": f.get("missingness_delta"),
            })

        return {
            "target_column": target_col,
            "analysis_mode_used": "binary",
            "available_target_classes": target_classes,
            "positive_class": positive_class,
            "target_mean": round(float(y.mean()), 4),
            "target_n_pos": int(y.sum()),
            "target_n_neg": int((y == 0).sum()),
            "rows_analyzed": int(valid_target_mask.sum()),
            "recommended_metric": recommended_metric,
            "recommended_reason": recommended_reason,
            "metric_coverage": metric_coverage,
            "techniques": techniques,
            "matrix": matrix,
            "features": features,
            "top_numeric": [f for f in features if f["role"] in ("numeric", "binary")][:15],
            "top_categorical": [f for f in features if f["role"] == "categorical"][:15],
        }

    def _feature_selection_inventory(self, df: pd.DataFrame, columns: list[str]) -> list[dict[str, Any]]:
        inventory = []
        for col in columns:
            if col not in df.columns:
                continue
            series = df[col]
            meta = _classify_column(col, series, df)
            entry: dict[str, Any] = {
                "name": col,
                "role": meta.get("role"),
                "dtype": meta.get("dtype"),
                "is_id": bool(meta.get("is_id")),
                "missing_pct": _safe_float(series.isna().mean(), 6),
                "distinct_count": int(series.nunique(dropna=True)),
                "sample_values": _sample_values(series, limit=5),
            }
            if meta.get("role") in ("numeric", "binary"):
                numeric = pd.to_numeric(series, errors="coerce")
                if numeric.notna().any():
                    mean_v = float(numeric.mean())
                    entry["variance"] = _safe_float(numeric.var(), 6)
                    entry["mean_abs_deviation"] = _safe_float(np.mean(np.abs(numeric.dropna() - mean_v)), 6)
                    pos_abs = np.abs(numeric.dropna().to_numpy())
                    pos_abs = pos_abs[pos_abs > 0]
                    gmean_abs = float(np.exp(np.mean(np.log(pos_abs)))) if pos_abs.size else None
                    entry["dispersion_ratio"] = _safe_float(
                        abs(mean_v) / gmean_abs if gmean_abs and gmean_abs > 0 else None,
                        6,
                    )
                    entry["min"] = _safe_float(numeric.min(), 6)
                    entry["max"] = _safe_float(numeric.max(), 6)
            else:
                entry["top_categories"] = [
                    {"value": value, "count": int(count)}
                    for value, count in _prepare_categorical_series(series).value_counts().head(5).items()
                ]
            inventory.append(entry)
        return inventory

    def feature_selection_workbench(
        self,
        dataset: dict,
        target_col: str | None = None,
        sample_rows: int = 50_000,
        selected_columns: list[str] | None = None,
        top_n: int = 20,
        var_threshold: float = 0.01,
        corr_threshold: float = 0.95,
        mad_threshold: float | None = None,
        dispersion_threshold: float | None = None,
    ) -> dict:
        df = _load_df(dataset, sample_rows)

        if target_col and target_col not in df.columns:
            raise ValueError(f"Target column '{target_col}' not found")

        available_columns = [c for c in df.columns if c != target_col]
        requested_columns = [
            c for c in (selected_columns or available_columns)
            if c in df.columns and c != target_col
        ]

        inventory = self._feature_selection_inventory(df, requested_columns)
        inventory_lookup = {item["name"]: item for item in inventory}
        feature_columns = [item["name"] for item in inventory if not item.get("is_id")]

        target_result = None
        if target_col:
            target_result = self.feature_target_analysis(
                dataset,
                target_col=target_col,
                sample_rows=sample_rows,
                feature_columns=feature_columns,
                max_features=max(len(feature_columns), 1),
            )
        feature_lookup = {
            feat.get("column"): feat
            for feat in (target_result.get("features") if target_result else [])
            if feat.get("column")
        }
        recommended_metric = target_result.get("recommended_metric") if target_result else None

        def feature_signal(column: str) -> float:
            if not target_result:
                return -1.0
            feat = feature_lookup.get(column, {})
            primary = feat.get(recommended_metric) if recommended_metric else None
            if primary is None:
                primary = feat.get("information_gain")
            if primary is None:
                primary = feat.get("importance")
            return float(primary) if primary is not None else -1.0

        technique_results: dict[str, Any] = {}

        leak_name_rows = []
        for col in feature_columns:
            matches = [kw for kw in LEAKAGE_NAME_KEYWORDS if kw in col.lower()]
            if not matches:
                continue
            meta = inventory_lookup.get(col, {})
            leak_name_rows.append({
                "feature": col,
                "score": float(len(matches)),
                "role": meta.get("role"),
                "dtype": meta.get("dtype"),
                "missing_pct": meta.get("missing_pct"),
                "sample_values": meta.get("sample_values", []),
                "reason": f"Matched leakage keywords: {', '.join(matches[:4])}",
            })
        leak_name_rows.sort(key=lambda item: (-float(item["score"]), str(item["feature"])))
        technique_results["leakage_name_scan"] = {
            "technique_id": "leakage_name_scan",
            "scope": "filter",
            "rows": leak_name_rows,
            "selected_count": len(leak_name_rows),
            "suggested_drop": [row["feature"] for row in leak_name_rows],
            "message": "Name-based outcome leakage scan.",
        }

        leak_corr_rows = []
        if target_col:
            leakage = self.leakage_checks(dataset, target_col=target_col, sample_rows=sample_rows)
            for risk in leakage.get("risks", []):
                column = risk.get("column")
                correlation = risk.get("correlation")
                if column not in feature_columns or correlation is None:
                    continue
                meta = inventory_lookup.get(column, {})
                leak_corr_rows.append({
                    "feature": column,
                    "score": abs(float(correlation)),
                    "role": meta.get("role"),
                    "dtype": meta.get("dtype"),
                    "missing_pct": meta.get("missing_pct"),
                    "sample_values": meta.get("sample_values", []),
                    "risk_level": risk.get("risk_level"),
                    "reason": risk.get("reason"),
                })
        leak_corr_rows.sort(key=lambda item: (-float(item["score"]), str(item["feature"])))
        technique_results["leakage_target_corr"] = {
            "technique_id": "leakage_target_corr",
            "scope": "filter",
            "rows": leak_corr_rows,
            "selected_count": len(leak_corr_rows),
            "suggested_drop": [row["feature"] for row in leak_corr_rows],
            "message": "Target-correlation leakage scan." if target_col else "Target column required.",
        }

        numeric_inventory = [
            item for item in inventory
            if item.get("name") in feature_columns and item.get("role") in ("numeric", "binary")
        ]
        mad_values = [float(item["mean_abs_deviation"]) for item in numeric_inventory if item.get("mean_abs_deviation") is not None]
        dispersion_values = [float(item["dispersion_ratio"]) for item in numeric_inventory if item.get("dispersion_ratio") is not None]
        effective_mad_threshold = float(mad_threshold) if mad_threshold is not None else (float(np.quantile(mad_values, 0.10)) if mad_values else None)
        effective_dispersion_threshold = (
            float(dispersion_threshold)
            if dispersion_threshold is not None
            else (float(np.quantile(dispersion_values, 0.10)) if dispersion_values else None)
        )

        variance_rows = [
            {
                "feature": item["name"],
                "score": float(item["variance"]),
                "role": item.get("role"),
                "dtype": item.get("dtype"),
                "missing_pct": item.get("missing_pct"),
                "sample_values": item.get("sample_values", []),
                "mean_abs_deviation": item.get("mean_abs_deviation"),
                "dispersion_ratio": item.get("dispersion_ratio"),
                "reason": f"Variance {float(item['variance']):.6f} <= threshold {float(var_threshold):.6f}",
            }
            for item in numeric_inventory
            if item.get("variance") is not None and float(item["variance"]) <= float(var_threshold)
        ]
        variance_rows.sort(key=lambda item: (float(item["score"]), str(item["feature"])))
        technique_results["variance_threshold"] = {
            "technique_id": "variance_threshold",
            "scope": "filter",
            "rows": variance_rows,
            "selected_count": len(variance_rows),
            "suggested_drop": [row["feature"] for row in variance_rows],
            "threshold": float(var_threshold),
            "message": "Low-variance stability filter.",
        }

        mad_rows = [
            {
                "feature": item["name"],
                "score": float(item["mean_abs_deviation"]),
                "role": item.get("role"),
                "dtype": item.get("dtype"),
                "missing_pct": item.get("missing_pct"),
                "sample_values": item.get("sample_values", []),
                "variance": item.get("variance"),
                "dispersion_ratio": item.get("dispersion_ratio"),
                "reason": f"MAD {float(item['mean_abs_deviation']):.6f} <= threshold {float(effective_mad_threshold):.6f}",
            }
            for item in numeric_inventory
            if effective_mad_threshold is not None and item.get("mean_abs_deviation") is not None and float(item["mean_abs_deviation"]) <= effective_mad_threshold
        ]
        mad_rows.sort(key=lambda item: (float(item["score"]), str(item["feature"])))
        technique_results["mean_abs_deviation"] = {
            "technique_id": "mean_abs_deviation",
            "scope": "filter",
            "rows": mad_rows,
            "selected_count": len(mad_rows),
            "suggested_drop": [row["feature"] for row in mad_rows],
            "threshold": effective_mad_threshold,
            "message": "Low-spread filter using mean absolute deviation.",
        }

        dispersion_rows = [
            {
                "feature": item["name"],
                "score": float(item["dispersion_ratio"]),
                "role": item.get("role"),
                "dtype": item.get("dtype"),
                "missing_pct": item.get("missing_pct"),
                "sample_values": item.get("sample_values", []),
                "variance": item.get("variance"),
                "mean_abs_deviation": item.get("mean_abs_deviation"),
                "reason": f"Dispersion ratio {float(item['dispersion_ratio']):.6f} <= threshold {float(effective_dispersion_threshold):.6f}",
            }
            for item in numeric_inventory
            if effective_dispersion_threshold is not None and item.get("dispersion_ratio") is not None and float(item["dispersion_ratio"]) <= effective_dispersion_threshold
        ]
        dispersion_rows.sort(key=lambda item: (float(item["score"]), str(item["feature"])))
        technique_results["dispersion_ratio"] = {
            "technique_id": "dispersion_ratio",
            "scope": "filter",
            "rows": dispersion_rows,
            "selected_count": len(dispersion_rows),
            "suggested_drop": [row["feature"] for row in dispersion_rows],
            "threshold": effective_dispersion_threshold,
            "message": "Low-dispersion filter relative to feature magnitude.",
        }

        corr_rows = []
        numeric_cols = [item["name"] for item in numeric_inventory]
        if len(numeric_cols) >= 2:
            corr = df[numeric_cols].apply(pd.to_numeric, errors="coerce").corr(method="pearson")
            drop_map: dict[str, dict[str, Any]] = {}

            def choose_drop(col_a: str, col_b: str) -> tuple[str, str]:
                score_a = feature_signal(col_a)
                score_b = feature_signal(col_b)
                if score_a != score_b:
                    return (col_a, col_b) if score_a < score_b else (col_b, col_a)
                miss_a = float(inventory_lookup.get(col_a, {}).get("missing_pct") or 0.0)
                miss_b = float(inventory_lookup.get(col_b, {}).get("missing_pct") or 0.0)
                if miss_a != miss_b:
                    return (col_a, col_b) if miss_a > miss_b else (col_b, col_a)
                return (col_b, col_a) if col_a < col_b else (col_a, col_b)

            for idx, left in enumerate(numeric_cols):
                for right in numeric_cols[idx + 1:]:
                    value = corr.loc[left, right]
                    if pd.isna(value) or abs(float(value)) < float(corr_threshold):
                        continue
                    drop_col, keep_col = choose_drop(left, right)
                    meta = inventory_lookup.get(drop_col, {})
                    current = drop_map.setdefault(drop_col, {
                        "feature": drop_col,
                        "score": 0.0,
                        "role": meta.get("role"),
                        "dtype": meta.get("dtype"),
                        "missing_pct": meta.get("missing_pct"),
                        "sample_values": meta.get("sample_values", []),
                        "partners": [],
                    })
                    abs_value = abs(float(value))
                    current["score"] = max(float(current["score"]), abs_value)
                    current["partners"].append({
                        "feature": keep_col,
                        "correlation": round(abs_value, 6),
                    })

            for row in drop_map.values():
                partners = row.get("partners", [])
                partner_text = ", ".join(
                    f"{p['feature']} ({p['correlation']:.3f})"
                    for p in partners[:3]
                )
                row["reason"] = f"Highly correlated with {partner_text}" if partner_text else "Highly correlated feature"
                corr_rows.append(row)
        corr_rows.sort(key=lambda item: (-float(item["score"]), str(item["feature"])))
        technique_results["correlation_filter"] = {
            "technique_id": "correlation_filter",
            "scope": "filter",
            "rows": corr_rows,
            "selected_count": len(corr_rows),
            "suggested_drop": [row["feature"] for row in corr_rows],
            "threshold": float(corr_threshold),
            "message": "Pairwise Pearson correlation filter.",
        }

        vif_scored_rows = _vif_rows(
            df,
            [
                item["name"]
                for item in numeric_inventory
                if item.get("name") in feature_columns
            ],
            max_features=min(max(len(numeric_inventory), 2), 40),
        )
        vif_threshold = 5.0
        vif_warning_threshold = 10.0
        vif_rows = []
        for row in vif_scored_rows:
            meta = inventory_lookup.get(str(row.get("feature") or ""), {})
            score = float(row.get("score") or 0.0)
            if score < vif_threshold:
                continue
            vif_rows.append({
                "feature": row.get("feature"),
                "score": score,
                "role": meta.get("role"),
                "dtype": meta.get("dtype"),
                "missing_pct": meta.get("missing_pct"),
                "sample_values": meta.get("sample_values", []),
                "risk_level": "critical" if score >= vif_warning_threshold else "high",
                "reason": (
                    f"VIF {score:.2f} suggests severe multicollinearity"
                    if score >= vif_warning_threshold
                    else f"VIF {score:.2f} suggests multicollinearity review"
                ),
            })
        technique_results["vif_multicollinearity"] = {
            "technique_id": "vif_multicollinearity",
            "scope": "filter",
            "rows": vif_rows,
            "scored_rows": vif_scored_rows,
            "selected_count": len(vif_rows),
            "suggested_drop": [row["feature"] for row in vif_rows],
            "threshold": vif_threshold,
            "warning_threshold": vif_warning_threshold,
            "message": "Variance inflation factor scan for multicollinearity.",
        }

        score_feature_rows = target_result.get("features", []) if target_result else []
        for tech in FEATURE_SELECTION_SCORE_TECHNIQUES:
            tech_id = tech["id"]
            rows = []
            for feat in score_feature_rows:
                column = feat.get("column")
                value = feat.get(tech_id)
                if not column or value is None:
                    continue
                meta = inventory_lookup.get(column, {})
                rows.append({
                    "feature": column,
                    "score": float(value),
                    "role": feat.get("role") or meta.get("role"),
                    "dtype": feat.get("dtype") or meta.get("dtype"),
                    "missing_pct": meta.get("missing_pct"),
                    "sample_values": meta.get("sample_values", []),
                    "iv_strength": feat.get("iv_strength"),
                    "information_value": feat.get("information_value"),
                    "information_gain": feat.get("information_gain"),
                    "reason": f"{tech['label']} = {float(value):.6f}",
                })
            rows.sort(key=lambda item: (-float(item["score"]), str(item["feature"])))
            keep_count = min(max(int(top_n or 20), 1), len(rows)) if rows else 0
            technique_results[tech_id] = {
                "technique_id": tech_id,
                "scope": "score",
                "rows": rows,
                "selected_count": len(rows),
                "coverage": (target_result.get("metric_coverage", {}) if target_result else {}).get(tech_id),
                "suggested_keep": [row["feature"] for row in rows[:keep_count]],
                "suggested_drop": [row["feature"] for row in rows[keep_count:]],
                "message": "Binary-target supervised ranking." if target_result else "Target column required.",
            }

        recommended_filters = [
            {
                "technique_id": tech_id,
                "selected_count": payload.get("selected_count", 0),
            }
            for tech_id, payload in technique_results.items()
            if FEATURE_SELECTION_LOOKUP.get(tech_id, {}).get("scope") == "filter" and payload.get("selected_count", 0) > 0
        ]
        recommended_filters.sort(key=lambda item: (-int(item["selected_count"]), str(item["technique_id"])))

        default_technique_id = None
        if target_result and target_result.get("recommended_metric"):
            default_technique_id = str(target_result["recommended_metric"])
        elif recommended_filters:
            default_technique_id = str(recommended_filters[0]["technique_id"])
        elif FEATURE_SELECTION_LIBRARY:
            default_technique_id = str(FEATURE_SELECTION_LIBRARY[0]["id"])

        leakage_name_set = {str(row.get("feature")) for row in leak_name_rows if row.get("feature")}
        leakage_target_set = {str(row.get("feature")) for row in leak_corr_rows if row.get("feature")}
        low_variance_set = {str(row.get("feature")) for row in variance_rows if row.get("feature")}
        low_mad_set = {str(row.get("feature")) for row in mad_rows if row.get("feature")}
        low_dispersion_set = {str(row.get("feature")) for row in dispersion_rows if row.get("feature")}
        redundancy_set = {str(row.get("feature")) for row in corr_rows if row.get("feature")}
        redundancy_partners = {
            str(row.get("feature")): list(row.get("partners") or [])
            for row in corr_rows
            if row.get("feature")
        }
        vif_map = {
            str(row.get("feature")): float(row.get("score") or 0.0)
            for row in vif_scored_rows
            if row.get("feature")
        }

        ranked_scores = [feature_signal(column) for column in feature_columns if feature_signal(column) >= 0]
        min_score = min(ranked_scores) if ranked_scores else 0.0
        max_score = max(ranked_scores) if ranked_scores else 0.0
        score_range = max_score - min_score

        governance_profiles: list[dict[str, Any]] = []
        decision_buckets = {key: [] for key in GOVERNANCE_BUCKET_LABELS}
        approved_feature_set: list[dict[str, Any]] = []
        excluded_feature_set: list[dict[str, Any]] = []

        for item in inventory:
            feature = str(item.get("name") or "")
            if not feature or item.get("is_id"):
                continue

            normalized = _normalize_feature_token(feature)
            timing_class, timing_flags = _timing_classification(feature)
            raw_score = feature_signal(feature) if target_result else None
            score_norm = None
            if raw_score is not None and raw_score >= 0:
                score_norm = 1.0 if score_range <= 0 else max(0.0, min(1.0, (raw_score - min_score) / score_range))
            feature_meta = feature_lookup.get(feature, {})
            primary_rank = int(feature_meta.get("rank") or 0) if feature_meta else 0
            missing_pct = float(item.get("missing_pct") or 0.0)
            vif_value = float(vif_map.get(feature) or 0.0)
            direct_leakage = normalized in DIRECT_LEAKAGE_PATTERNS or "direct_target_leakage" in timing_flags
            target_proxy = normalized in TARGET_PROXY_PATTERNS or "target_proxy_risk" in timing_flags
            leakage_flag = feature in leakage_name_set or feature in leakage_target_set
            post_outcome = timing_class == "post_investigation"
            future_info = timing_class == "future_information"
            analyst_action = "analyst_action" in timing_flags
            not_available = timing_class != "decision_time_assumed"
            low_variance = feature in low_variance_set or feature in low_mad_set or feature in low_dispersion_set
            redundant = feature in redundancy_set
            weak_signal = bool(target_result) and score_norm is not None and score_norm < 0.18
            strong_signal = bool(target_result) and (
                (score_norm is not None and score_norm >= 0.58)
                or (primary_rank > 0 and primary_rank <= max(int(top_n or 20), 10))
            )

            issue_flags: list[str] = []
            if direct_leakage:
                issue_flags.append("Direct target leakage")
            if target_proxy:
                issue_flags.append("Target proxy risk")
            if post_outcome:
                issue_flags.append("Post-outcome field")
            if future_info:
                issue_flags.append("Future information")
            if analyst_action:
                issue_flags.append("Analyst action / investigation step")
            if redundant:
                issue_flags.append("Redundant with another feature")
            if vif_value >= vif_threshold:
                issue_flags.append(f"High VIF ({vif_value:.2f})")
            if low_variance:
                issue_flags.append("Low variation")
            if missing_pct >= 0.35:
                issue_flags.append("High missingness")
            if weak_signal:
                issue_flags.append("Weak supervised signal")

            if direct_leakage or (target_proxy and leakage_flag):
                decision_key = "blocked_leakage"
                reason = "This field is too close to the answer or derived from the target outcome."
            elif post_outcome or future_info or analyst_action or target_proxy:
                decision_key = "blocked_post_outcome"
                reason = "This field is not reliably available at alert-decision time or depends on later investigation activity."
            elif redundant or low_variance or weak_signal or missing_pct >= 0.35 or vif_value >= vif_warning_threshold:
                decision_key = "weak_redundant"
                if redundant or vif_value >= vif_threshold:
                    reason = "This field overlaps heavily with other features and is a weak governance choice for training."
                else:
                    reason = "This field looks weak or unstable in the current sample and is excluded by default."
            elif strong_signal or not target_result:
                decision_key = "approved"
                reason = "This field looks operationally safe and useful enough to flow into model training."
            else:
                decision_key = "needs_review"
                reason = "This field is not clearly unsafe, but it still needs a human review before approval."

            partner_list = redundancy_partners.get(feature) or []
            partner_text = ", ".join(
                f"{str(partner.get('feature') or '')} ({float(partner.get('correlation') or 0.0):.2f})"
                for partner in partner_list[:3]
                if partner.get("feature")
            )
            family = _feature_family(feature)
            evidence = []
            if target_result:
                if raw_score is not None and raw_score >= 0:
                    evidence.append(f"Primary supervised score = {raw_score:.6f}")
                else:
                    evidence.append("No supervised score is available for this field in the current target setup.")
            else:
                evidence.append("Target column is not set yet, so supervised usefulness cannot be estimated.")
            if issue_flags:
                evidence.extend(issue_flags[:4])
            if partner_text:
                evidence.append(f"Most similar retained features: {partner_text}")
            if missing_pct > 0:
                evidence.append(f"Missingness = {missing_pct * 100:.1f}%")

            business_explanation = reason
            if decision_key == "approved":
                business_explanation = (
                    "Safe to use at alert time and helpful for separating low-value reviews from riskier cases."
                )
            elif decision_key == "needs_review":
                business_explanation = (
                    "Potentially useful, but the team should confirm it is available at decision time and not unfairly close to the answer."
                )
            elif decision_key == "blocked_leakage":
                business_explanation = (
                    "Too close to the answer. Using it would make the model look unrealistically strong and untrustworthy in production."
                )
            elif decision_key == "blocked_post_outcome":
                business_explanation = (
                    "Known only after investigation or later in the workflow, so it is not fair to use when deciding which alerts to suppress."
                )
            elif decision_key == "weak_redundant":
                business_explanation = (
                    "Does not add enough stable value on top of other fields, so it is excluded from the governed feature set."
                )

            technical_explanation = "; ".join(evidence) if evidence else reason
            profile = {
                "feature": feature,
                "normalized_name": normalized,
                "role": item.get("role"),
                "dtype": item.get("dtype"),
                "feature_family": family,
                "decision": decision_key,
                "decision_label": GOVERNANCE_BUCKET_LABELS[decision_key],
                "decision_reason": reason,
                "selected_for_training": decision_key == "approved",
                "needs_override_for_training": decision_key != "approved",
                "available_at_decision_time": not not_available,
                "timing_classification": timing_class,
                "missing_pct": missing_pct,
                "distinct_count": int(item.get("distinct_count") or 0),
                "sample_values": item.get("sample_values", []),
                "top_categories": item.get("top_categories", []),
                "primary_score": _safe_float(raw_score, 6) if raw_score is not None and raw_score >= 0 else None,
                "score_norm": _safe_float(score_norm, 6) if score_norm is not None else None,
                "rank_position": primary_rank or None,
                "information_gain": feature_meta.get("information_gain"),
                "information_value": feature_meta.get("information_value"),
                "iv_strength": feature_meta.get("iv_strength"),
                "vif": _safe_float(vif_value, 6) if vif_value else None,
                "max_partner_correlation": _safe_float(max((float(p.get("correlation") or 0.0) for p in partner_list), default=0.0), 6) if partner_list else None,
                "firewall_flags": sorted(set(issue_flags + timing_flags)),
                "direct_target_leakage": direct_leakage,
                "target_proxy_risk": target_proxy or leakage_flag,
                "post_outcome_risk": post_outcome,
                "future_information_risk": future_info,
                "analyst_action_risk": analyst_action,
                "redundant_risk": redundant,
                "weak_signal_risk": weak_signal,
                "low_variance_risk": low_variance,
                "business_explanation": business_explanation,
                "technical_explanation": technical_explanation,
                "evidence": evidence,
            }
            governance_profiles.append(profile)
            decision_buckets[decision_key].append(profile)
            if decision_key == "approved":
                approved_feature_set.append({
                    "feature": feature,
                    "feature_family": family,
                    "approval_reason": reason,
                })
            else:
                excluded_feature_set.append({
                    "feature": feature,
                    "feature_family": family,
                    "exclusion_reason": reason,
                    "decision": decision_key,
                })

        governance_profiles.sort(
            key=lambda item: (
                GOVERNANCE_DECISION_ORDER.get(str(item.get("decision") or ""), 99),
                -float(item.get("score_norm") or 0.0),
                float(item.get("missing_pct") or 0.0),
                str(item.get("feature") or ""),
            )
        )

        firewall_checks = [
            {
                "id": "direct_target_leakage",
                "label": "Direct target leakage",
                "count": sum(1 for item in governance_profiles if item.get("direct_target_leakage")),
                "examples": [item.get("feature") for item in governance_profiles if item.get("direct_target_leakage")][:6],
                "description": "Fields that directly encode the label or the answer.",
            },
            {
                "id": "target_proxy_risk",
                "label": "Target proxy risk",
                "count": sum(1 for item in governance_profiles if item.get("target_proxy_risk")),
                "examples": [item.get("feature") for item in governance_profiles if item.get("target_proxy_risk")][:6],
                "description": "Outcome-linked history or proxy logic such as prior SAR / STR rates.",
            },
            {
                "id": "post_outcome_risk",
                "label": "Post-investigation fields",
                "count": sum(1 for item in governance_profiles if item.get("post_outcome_risk")),
                "examples": [item.get("feature") for item in governance_profiles if item.get("post_outcome_risk")][:6],
                "description": "Fields that are only known after analysts or investigators act.",
            },
            {
                "id": "future_information_risk",
                "label": "Future information",
                "count": sum(1 for item in governance_profiles if item.get("future_information_risk")),
                "examples": [item.get("feature") for item in governance_profiles if item.get("future_information_risk")][:6],
                "description": "Fields that describe what happened later, not at decision time.",
            },
            {
                "id": "analyst_action_risk",
                "label": "Analyst action dependence",
                "count": sum(1 for item in governance_profiles if item.get("analyst_action_risk")),
                "examples": [item.get("feature") for item in governance_profiles if item.get("analyst_action_risk")][:6],
                "description": "Fields such as analyst risk score, docs requested, customer contacted, or EDD triggered.",
            },
            {
                "id": "multicollinearity_risk",
                "label": "Multicollinearity / redundancy",
                "count": sum(1 for item in governance_profiles if item.get("redundant_risk") or (float(item.get("vif") or 0.0) >= vif_threshold)),
                "examples": [item.get("feature") for item in governance_profiles if item.get("redundant_risk") or (float(item.get("vif") or 0.0) >= vif_threshold)][:6],
                "description": "Columns that repeat one another and can distort stability or interpretation.",
            },
        ]

        business_summary = (
            f"{len(approved_feature_set)} features are approved for training. "
            f"{len(decision_buckets['blocked_leakage']) + len(decision_buckets['blocked_post_outcome'])} fields are blocked because they are too close to the answer or only known later. "
            f"{len(decision_buckets['needs_review'])} fields still need review, and {len(decision_buckets['weak_redundant'])} are excluded as weak or redundant."
        )
        technical_summary = (
            "Governance combines leakage name scans, target-correlation checks, timing availability rules, "
            f"variance filters, correlation filters, and VIF>{vif_threshold:.1f} multicollinearity screening. "
            "High predictive power alone does not approve a feature."
        )

        return {
            "target_column": target_col,
            "rows_analyzed": int(len(df)),
            "candidate_columns": len(feature_columns),
            "columns": inventory,
            "available_techniques": FEATURE_SELECTION_LIBRARY,
            "technique_results": technique_results,
            "recommended_supervised_metric": target_result.get("recommended_metric") if target_result else None,
            "recommended_supervised_reason": target_result.get("recommended_reason") if target_result else None,
            "recommended_filters": recommended_filters[:5],
            "default_technique_id": default_technique_id,
            "thresholds": {
                "variance_threshold": float(var_threshold),
                "mad_threshold": effective_mad_threshold,
                "dispersion_threshold": effective_dispersion_threshold,
                "corr_threshold": float(corr_threshold),
                "vif_threshold": float(vif_threshold),
                "vif_warning_threshold": float(vif_warning_threshold),
                "top_n": int(top_n or 20),
            },
            "ranked_feature_count": len(score_feature_rows),
            "governance_profiles": governance_profiles,
            "governance_summary": {
                "business_summary": business_summary,
                "technical_summary": technical_summary,
                "counts": {
                    "total_features": len(governance_profiles),
                    "approved": len(decision_buckets["approved"]),
                    "needs_review": len(decision_buckets["needs_review"]),
                    "blocked_leakage": len(decision_buckets["blocked_leakage"]),
                    "blocked_post_outcome": len(decision_buckets["blocked_post_outcome"]),
                    "weak_redundant": len(decision_buckets["weak_redundant"]),
                },
            },
            "decision_buckets": {
                key: {
                    "label": GOVERNANCE_BUCKET_LABELS[key],
                    "count": len(value),
                    "features": [item.get("feature") for item in value],
                }
                for key, value in decision_buckets.items()
            },
            "firewall": {
                "checks": firewall_checks,
                "blocked_count": len(decision_buckets["blocked_leakage"]) + len(decision_buckets["blocked_post_outcome"]),
                "review_count": len(decision_buckets["needs_review"]),
            },
            "approved_feature_set": approved_feature_set,
            "excluded_feature_set": excluded_feature_set,
            "default_training_columns": [item["feature"] for item in approved_feature_set],
            "default_excluded_columns": [item["feature"] for item in excluded_feature_set],
        }

    def _compute_iv(self, x: pd.Series, y: pd.Series, bins: int | None, is_cat: bool) -> tuple[float, list]:
        """Compute Information Value (IV) and Weight of Evidence (WoE) bins."""
        try:
            total_pos = max(int(y.sum()), 1)
            total_neg = max(int((y == 0).sum()), 1)

            if is_cat:
                grps = pd.DataFrame({"x": x, "y": y}).groupby("x")
            else:
                q_labels = pd.qcut(x, q=bins or 10, duplicates="drop", labels=False)
                grps = pd.DataFrame({"x": q_labels, "y": y}).groupby("x")

            woe_bins = []
            iv = 0.0
            for name, g in grps:
                pos = int(g["y"].sum())
                neg = int((g["y"] == 0).sum())
                p_pos = pos / total_pos
                p_neg = neg / total_neg
                if p_pos == 0 or p_neg == 0:
                    continue
                woe  = math.log(p_pos / p_neg)
                iv  += (p_pos - p_neg) * woe
                woe_bins.append({
                    "bin":    str(name),
                    "pos":    pos,
                    "neg":    neg,
                    "woe":    round(woe, 4),
                    "iv":     round((p_pos - p_neg) * woe, 6),
                    "tp_rate":round(pos / max(pos + neg, 1), 4),
                })
            return iv, woe_bins
        except Exception:
            return 0.0, []

    # ── 8. Data Quality Score ─────────────────────────────────────────────────

    def quality_score(self, dataset: dict, sample_rows: int = 50_000) -> dict:
        """
        Compute a comprehensive data quality score with dimension breakdown:
        Completeness, Uniqueness, Consistency, Validity, Timeliness.
        """
        df = _load_df(dataset, sample_rows)
        n  = len(df)

        # Completeness
        miss_pct     = df.isnull().mean().mean() * 100
        completeness = round(max(0, 100 - miss_pct * 2), 1)

        # Uniqueness (dedup score)
        dup_pct    = df.duplicated().mean() * 100
        uniqueness = round(max(0, 100 - dup_pct * 5), 1)

        # Validity: numeric cols within reasonable range (IQR × 5 check)
        n_invalid = 0
        n_checked = 0
        for col in df.select_dtypes(include=np.number).columns:
            if _classify_column(col, df[col], df)["is_id"]:
                continue
            s  = df[col].dropna()
            if len(s) == 0:
                continue
            q1, q3 = s.quantile(0.25), s.quantile(0.75)
            iqr    = q3 - q1
            n_invalid += int(((s < q1 - 5*iqr) | (s > q3 + 5*iqr)).sum())
            n_checked += len(s)
        validity = round(max(0, 100 - (n_invalid / max(n_checked, 1)) * 100 * 2), 1)

        # Consistency: string cols with mixed case / leading spaces
        n_inconsistent = 0
        n_str_checked  = 0
        for col in df.select_dtypes(include=object).columns:
            s   = df[col].dropna()
            n_str_checked += len(s)
            n_inconsistent += int((s != s.str.strip()).sum())

        consistency = round(max(0, 100 - (n_inconsistent / max(n_str_checked, 1)) * 100 * 3), 1)

        # ID column penalty
        id_cols = [c for c in df.columns if _classify_column(c, df[c], df)["is_id"]]
        id_penalty = min(len(id_cols) / max(len(df.columns), 1) * 20, 15)

        overall = round(
            completeness * 0.30 +
            uniqueness   * 0.20 +
            validity     * 0.25 +
            consistency  * 0.15 +
            max(0, 100 - id_penalty * 5) * 0.10,
            1
        )

        # Recommendations
        recs = []
        if miss_pct > 5:
            recs.append({"type": "warning", "message": f"High missing data ({miss_pct:.1f}%) — consider imputation or removal of sparse columns."})
        if dup_pct > 1:
            recs.append({"type": "warning", "message": f"Duplicate rows detected ({dup_pct:.1f}%) — deduplicate before modelling."})
        if len(id_cols) > 0:
            recs.append({"type": "info", "message": f"ID columns detected: {', '.join(id_cols[:5])}. Exclude from model features, retain for case mapping."})
        if n_inconsistent > 0:
            recs.append({"type": "info", "message": "String inconsistencies (mixed case, whitespace) found — standardise before encoding."})
        if overall >= 80:
            recs.append({"type": "success", "message": "Dataset is in good shape for modelling."})

        return {
            "overall_score":  overall,
            "dimensions": {
                "completeness":  completeness,
                "uniqueness":    uniqueness,
                "validity":      validity,
                "consistency":   consistency,
            },
            "recommendations": recs,
            "id_columns":      id_cols,
            "missing_pct":     round(miss_pct, 2),
            "duplicate_pct":   round(dup_pct, 2),
        }

    # ── 9. Leakage Detection ──────────────────────────────────────────────────

    def leakage_checks(self, dataset: dict, target_col: str,
                       sample_rows: int = 50_000) -> dict:
        """
        Detect potential data leakage:
        - Columns with perfect/near-perfect correlation to target
        - Post-event timestamp columns
        - Near-duplicate target columns
        """
        df = _load_df(dataset, sample_rows)

        if target_col not in df.columns:
            raise ValueError(f"Target column '{target_col}' not found")

        y     = _coerce_binary_target(df[target_col])
        risks = []
        id_cols = [c for c in df.columns if _classify_column(c, df[c], df)["is_id"]]

        for col in df.columns:
            if col == target_col or col in id_cols:
                continue

            risk_level = "ok"
            reason     = ""
            correlation = None

            s    = df[col]
            role = _classify_column(col, s, df)["role"]

            if role in ("numeric", "binary"):
                sn = pd.to_numeric(s, errors="coerce")
                valid = ~(sn.isna() | y.isna())
                if valid.sum() > 10:
                    try:
                        r, _ = scipy_stats.pointbiserialr(y[valid], sn[valid])
                        correlation = round(float(r), 4)
                        if abs(r) > 0.95:
                            risk_level = "critical"
                            reason = f"Near-perfect correlation ({r:.3f}) — likely leakage"
                        elif abs(r) > 0.80:
                            risk_level = "high"
                            reason = f"Very high correlation ({r:.3f}) — potential leakage"
                    except Exception:
                        pass

            # Name-based leakage signals
            lower = col.lower()
            if any(kw in lower for kw in ["sar", "str", "suspicious", "fraud", "investigation",
                                            "case_status", "resolution", "filed", "outcome"]):
                if risk_level == "ok":
                    risk_level = "high"
                    reason = "Column name suggests post-event information (regulatory outcome)"

            if risk_level != "ok":
                risks.append({
                    "column":      col,
                    "risk_level":  risk_level,
                    "reason":      reason,
                    "correlation": correlation,
                    "role":        role,
                    "recommended_action": (
                        "Drop from model features and keep only for audit / downstream investigation context."
                        if risk_level in {"critical", "high"}
                        else "Review with the data scientist before modelling."
                    ),
                })

        risks.sort(key=lambda x: {"critical": 0, "high": 1, "medium": 2, "ok": 3}.get(x["risk_level"], 4))

        return {
            "target_column": target_col,
            "risks":         risks,
            "n_critical":    sum(1 for r in risks if r["risk_level"] == "critical"),
            "n_high":        sum(1 for r in risks if r["risk_level"] == "high"),
            "n_total":       len(risks),
            "checks_performed": [
                "Point-biserial correlation against the binary target for numeric / binary features",
                "Name-based scan for post-event or outcome-style columns such as case status, SAR/STR, resolution, outcome",
                "Role-aware screening that ignores identifier columns and focuses on model features",
            ],
        }

    # ── 10. AML Insights Engine ───────────────────────────────────────────────

    def aml_insights(self, dataset: dict, target_col: str | None = None,
                     sample_rows: int = 50_000) -> dict:
        """
        Domain-aware insights for AML datasets:
        - Class imbalance assessment
        - Rule engine coverage
        - High-risk segment identification
        - Actionable modelling recommendations
        """
        df = _load_df(dataset, sample_rows)
        insights = []
        n = len(df)

        target_series = None

        # Class balance
        if target_col and target_col in df.columns:
            target_series = _coerce_binary_target(df[target_col])
            y  = target_series[target_series.isin([0, 1])].dropna()
            if len(y) > 0:
                tp = float(y.mean())
                if tp < 0.05:
                    insights.append({
                        "type": "critical",
                        "category": "Class Imbalance",
                        "message": f"Severe class imbalance: only {tp:.1%} True Positives. Use class_weight='balanced', SMOTE, or cost-sensitive learning.",
                        "metric": tp,
                    })
                elif tp < 0.20:
                    insights.append({
                        "type": "warning",
                        "category": "Class Imbalance",
                        "message": f"Moderate imbalance: {tp:.1%} TP rate. Monitor precision-recall over accuracy.",
                        "metric": tp,
                    })

        # Rule risk profile is preferred for modelling (ordinal 1-4), raw rule names are operational diagnostics.
        if "RULE_RISK_PROFILE" in df.columns:
            rp = pd.to_numeric(df["RULE_RISK_PROFILE"], errors="coerce").dropna()
            if len(rp):
                band_counts = rp.value_counts().sort_index()
                top_band = int(band_counts.idxmax())
                insights.append({
                    "type": "info",
                    "category": "Rule Risk Profile",
                    "message": (
                        f"RULE_RISK_PROFILE present with {len(band_counts)} bands (1-4). "
                        f"Most alerts are in profile {top_band} ({int(band_counts.loc[top_band]):,} alerts). "
                        "Use this ordinal signal for modelling instead of raw rule name."
                    ),
                    "metric": int(len(band_counts)),
                })

        if "RULE_TRIGGERED" in df.columns:
            rc = df["RULE_TRIGGERED"].astype(str).value_counts()
            insights.append({
                "type": "info",
                "category": "Rule Coverage",
                "message": (
                    f"Rule engine fires {len(rc)} distinct rules. Top rule: '{rc.index[0]}' ({rc.iloc[0]:,} alerts). "
                    "Treat RULE_TRIGGERED as operational diagnostics; avoid using it as a raw model feature."
                ),
                "metric": len(rc),
            })

        # PEP/Sanction enrichment
        for flag_col, label in [("PEP_FLAG", "PEP"), ("SANCTION_HIT", "Sanction"), ("ADVERSE_MEDIA_FLAG", "Adverse Media")]:
            if flag_col in df.columns and target_series is not None:
                flag_series = _coerce_binary_target(df[flag_col])
                tdf = pd.DataFrame({"flag": flag_series, "target": target_series}).dropna()
                grp = tdf.groupby("flag")["target"].mean()
                if len(grp) == 2:
                    lift = float(grp.get(1.0, 0)) / max(float(grp.get(0.0, 0.001)), 0.001)
                    if lift > 1.5:
                        insights.append({
                            "type": "info",
                            "category": "Risk Flag Signal",
                            "message": f"{label} flag provides {lift:.1f}× lift on TP rate — strong feature.",
                            "metric": lift,
                        })

        # Risk score discriminatory power
        if "RISK_SCORE" in df.columns and target_series is not None:
            tdf = pd.DataFrame({
                "RISK_SCORE": pd.to_numeric(df["RISK_SCORE"], errors="coerce"),
                "_target": target_series,
            }).dropna()
            tdf = tdf.dropna()
            if len(tdf) > 50:
                try:
                    auc = float(scipy_stats.pointbiserialr(tdf["_target"], tdf["RISK_SCORE"])[0])
                    if abs(auc) > 0.3:
                        insights.append({
                            "type": "success",
                            "category": "Risk Score Signal",
                            "message": f"RISK_SCORE has point-biserial r={auc:.3f} with target — solid starting feature.",
                            "metric": auc,
                        })
                except Exception:
                    pass

        # Missing data warnings
        miss_cols = [(c, round(df[c].isna().mean() * 100, 1)) for c in df.columns if df[c].isna().mean() > 0.10]
        if miss_cols:
            worst = sorted(miss_cols, key=lambda x: x[1], reverse=True)[:3]
            names = ", ".join(f"{c} ({p}%)" for c, p in worst)
            insights.append({
                "type": "warning",
                "category": "Data Quality",
                "message": f"High missingness in: {names}. Impute or remove before feature engineering.",
                "metric": len(miss_cols),
            })

        # ID column recommendations
        id_cols = [c for c in df.columns if _classify_column(c, df[c], df)["is_id"]]
        if id_cols:
            insights.append({
                "type": "info",
                "category": "ID Columns",
                "message": f"Detected {len(id_cols)} ID/key columns: {', '.join(id_cols[:5])}. "
                            "Exclude from model training — they add no predictive value and cause overfitting. "
                            "Retain for case mapping after scoring.",
                "metric": len(id_cols),
            })

        # Scale / normalisation recommendation
        num_cols = df.select_dtypes(include=np.number).columns.tolist()
        if num_cols:
            ranges = []
            for c in num_cols[:10]:
                s = pd.to_numeric(df[c], errors="coerce").dropna()
                if len(s) > 0:
                    ranges.append(float(s.max()) - float(s.min()))
            if ranges and max(ranges) / (min(ranges) + 1) > 100:
                insights.append({
                    "type": "info",
                    "category": "Feature Scaling",
                    "message": "Large variance in numeric feature ranges detected. Apply StandardScaler or RobustScaler before training linear/distance-based models.",
                    "metric": max(ranges),
                })

        return {
            "insights":      insights,
            "n_critical":    sum(1 for i in insights if i["type"] == "critical"),
            "n_warnings":    sum(1 for i in insights if i["type"] == "warning"),
            "n_info":        sum(1 for i in insights if i["type"] == "info"),
            "n_success":     sum(1 for i in insights if i["type"] == "success"),
            "total":         len(insights),
        }

    # ── 11. Pairplot data ─────────────────────────────────────────────────────

    def pairplot_data(self, dataset: dict, columns: list[str],
                      sample_rows: int = 2000, n_bins: int = 20) -> dict:
        """Generate pairplot data: diagonal=histogram, off-diagonal=scatter sample."""
        df   = _load_df(dataset, sample_rows)
        cols = [c for c in columns if c in df.columns][:8]

        pairs = []
        for i, c1 in enumerate(cols):
            for c2 in cols:
                s1 = pd.to_numeric(df[c1], errors="coerce")
                s2 = pd.to_numeric(df[c2], errors="coerce")

                if c1 == c2:
                    valid = s1.dropna()
                    counts, edges = np.histogram(valid, bins=n_bins)
                    pairs.append({
                        "x": c1, "y": c2, "type": "hist",
                        "bins": [{"bin_start": round(float(edges[i]), 3), "count": int(counts[i])}
                                 for i in range(len(counts))]
                    })
                else:
                    valid = ~(s1.isna() | s2.isna())
                    s1v, s2v = s1[valid], s2[valid]
                    if len(s1v) > sample_rows:
                        idx = np.random.choice(len(s1v), sample_rows, replace=False)
                        s1v, s2v = s1v.iloc[idx], s2v.iloc[idx]
                    pairs.append({
                        "x": c1, "y": c2, "type": "scatter",
                        "points": [{"x": round(float(x), 4), "y": round(float(y), 4)}
                                   for x, y in zip(s1v, s2v)][:500]
                    })

        return {"pairs": pairs, "columns": cols}

    # ── 12. Time Trend Analysis ───────────────────────────────────────────────

    def time_trend(self, dataset: dict, date_col: str,
                   metric_col: str | None = None, target_col: str | None = None,
                   freq: str = "W", sample_rows: int = 200_000) -> dict:
        """Aggregate metric and TP rate over time (weekly/monthly)."""
        df = _load_df(dataset, sample_rows)

        if date_col not in df.columns:
            raise ValueError(f"Date column '{date_col}' not found")

        df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
        df = df.dropna(subset=[date_col])
        df["_period"] = df[date_col].dt.to_period(freq).dt.start_time

        agg: dict[str, Any] = {"count": ("_period", "count")}

        if metric_col and metric_col in df.columns:
            df[metric_col] = pd.to_numeric(df[metric_col], errors="coerce")
            agg["metric_sum"]  = (metric_col, "sum")
            agg["metric_mean"] = (metric_col, "mean")

        if target_col and target_col in df.columns:
            df[target_col] = _coerce_binary_target(df[target_col])
            agg["tp_rate"] = (target_col, "mean")
            agg["tp_count"] = (target_col, "sum")

        grp = df.groupby("_period").agg(**agg).reset_index()
        grp["_period"] = grp["_period"].dt.strftime("%Y-%m-%d")

        return {
            "date_col":    date_col,
            "metric_col":  metric_col,
            "target_col":  target_col,
            "freq":        freq,
            "trend":       grp.fillna(0).round(4).to_dict("records"),
            "n_periods":   len(grp),
        }

    # ── 13. Distribution Comparison ───────────────────────────────────────────

    def distribution_comparison(self, dataset: dict, column: str,
                                 group_col: str, sample_rows: int = 50_000) -> dict:
        """Compare distributions of a numeric column across groups."""
        df = _load_df(dataset, sample_rows)

        if column not in df.columns or group_col not in df.columns:
            raise ValueError(f"Columns not found")

        df[column]    = pd.to_numeric(df[column], errors="coerce")
        groups        = df[group_col].dropna().unique()[:10]  # max 10 groups

        distributions = []
        for g in groups:
            mask = df[group_col] == g
            s    = df.loc[mask, column].dropna()
            if len(s) < 5:
                continue
            counts, edges = np.histogram(s, bins=30)
            distributions.append({
                "group": str(g),
                "count": len(s),
                "mean":  round(float(s.mean()), 4),
                "std":   round(float(s.std()), 4),
                "histogram": [
                    {"bin_start": round(float(edges[i]), 4), "count": int(counts[i])}
                    for i in range(len(counts))
                ]
            })

        # KS test between first two groups
        ks_result = None
        if len(distributions) >= 2:
            g1 = df[df[group_col] == groups[0]][column].dropna()
            g2 = df[df[group_col] == groups[1]][column].dropna()
            try:
                stat, p = scipy_stats.ks_2samp(g1, g2)
                ks_result = {"statistic": round(float(stat), 4), "p_value": round(float(p), 6)}
            except Exception:
                pass

        return {
            "column":        column,
            "group_col":     group_col,
            "distributions": distributions,
            "ks_test":       ks_result,
        }
