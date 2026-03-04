"""
target_routes.py — Target Variable Detection & Column Profiling

New endpoints:
  POST /api/mlops/target/detect          — auto-detect candidate target columns
  POST /api/mlops/eda/column-profile     — single column stats (distribution, null%, class balance)
  POST /api/mlops/target/derive          — confirm a target column, compute stats on master dataset
  POST /api/mlops/target/str-rules       — apply / preview STR rule set to derive binary target
  POST /api/mlops/target/generate-str    — auto-generate STR target from STR/SAR filed columns
"""

from flask import Blueprint, request, jsonify
from pathlib import Path
import pandas as pd
import numpy as np
import json
import re

from api.service_locator import services
from api.tools.mlops.mlops_workbench_service import MLOpsWorkbenchService
from api.tools.mlops.path_utils import resolve_env_root

target_bp = Blueprint("mlops_target", __name__)

# ─── Helpers (same pattern as workbench_routes.py) ───────────────────────────

def _get_env_ids():
    env_id = (
        request.args.get("env_id")
        or request.headers.get("X-Environment-ID")
        or services.metadata_manager.active_env
    )
    if not env_id:
        raise ValueError("X-Environment-ID header required")
    tenant_id = request.tenant_id
    return tenant_id, env_id


def _resolve_env_path(env_id, tenant_id):
    return str(resolve_env_root(str(env_id), str(tenant_id), create_if_missing=True))


def _get_service(env_root):
    mlops_db = Path(env_root) / "mlops" / "duckdb" / "mlops.duckdb"
    return MLOpsWorkbenchService(mlops_db)


def _load_dataset_df(service, dataset_id, max_rows=500_000):
    """Load dataset CSV into a DataFrame. Returns (df, meta) or raises."""
    meta = service.get_dataset(dataset_id)
    if not meta:
        raise ValueError(f"Dataset {dataset_id} not found")
    file_path = meta.get("file_path") or meta.get("filepath")
    if not file_path or not Path(file_path).exists():
        raise FileNotFoundError(f"Data file not found: {file_path}")
    ext = Path(file_path).suffix.lower()
    if ext == ".parquet":
        df = pd.read_parquet(file_path)
    else:
        df = pd.read_csv(file_path, nrows=max_rows, low_memory=False)
    return df, meta


# ─── Heuristic scoring ───────────────────────────────────────────────────────

TARGET_KEYWORDS = [
    "is_true_pos", "is_tp", "label", "target", "flag", "str", "sar",
    "fraud", "suspicious", "alert", "positive", "bool", "indicator",
    "outcome", "result", "is_", "_flag", "_label",
]

LEAKAGE_HIGH = ["case_status", "resolution", "sar_filed", "report_date",
                "closed_by", "disposition", "filed"]
LEAKAGE_MED  = ["risk_score", "priority", "investigator", "alert_id",
                "case_id", "resolution_days"]
LABEL_SOURCE_COLS = [
    "case_status",
    "sar_filed",
    "str_filed",
    "disposition",
    "case_disposition",
    "outcome",
]


def _target_score(col_name: str, dtype: str, n_unique: int) -> int:
    """Return 0-100 heuristic score for being a target variable."""
    score = 0
    name = col_name.lower()

    # Name signals
    for kw in TARGET_KEYWORDS:
        if kw in name:
            score += 25
            break
    if name.startswith("is_") or name.endswith("_flag") or name.endswith("_label"):
        score += 20

    # Dtype signals
    dt = str(dtype).lower()
    if "bool" in dt:
        score += 30
    elif "int" in dt and n_unique <= 2:
        score += 25
    elif "int" in dt and n_unique <= 5:
        score += 10
    elif "object" in dt and n_unique <= 3:
        score += 10

    # Cardinality
    if n_unique == 2:
        score += 25
    elif n_unique == 1:
        score -= 50  # constant column

    return min(max(score, 0), 100)


def _leakage_risk(col_name: str) -> str:
    name = col_name.lower()
    if any(k in name for k in LEAKAGE_HIGH):
        return "high"
    if any(k in name for k in LEAKAGE_MED):
        return "medium"
    return "none"


def _is_label_source_column(col_name: str) -> bool:
    name = str(col_name or "").strip().lower()
    if not name:
        return False
    if name in LABEL_SOURCE_COLS:
        return True
    return any(token in name for token in ("case_status", "case_disposition", "disposition", "outcome"))


# ════════════════════════════════════════════════════════════════════════════════
# ROUTES
# ════════════════════════════════════════════════════════════════════════════════

# NOTE:
# This blueprint is registered under url_prefix="/api/mlops" (see app.py).
# Expose the canonical relative path first, while keeping the legacy full path
# for backward compatibility.
@target_bp.route("/target/detect", methods=["POST"])
@target_bp.route("/api/mlops/target/detect", methods=["POST"])
def detect_target_columns():
    """
    POST /api/mlops/target/detect
    Body: { "dataset_id": "..." }

    Returns scored list of candidate target columns.
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        service  = _get_service(env_root)
        body     = request.get_json() or {}
        dataset_id = body.get("dataset_id")
        if not dataset_id:
            return jsonify({"error": "dataset_id required"}), 400

        df, meta = _load_dataset_df(service, dataset_id, max_rows=50_000)

        candidates = []
        for col in df.columns:
            n_unique = int(df[col].nunique(dropna=True))
            dtype    = str(df[col].dtype)
            score    = _target_score(col, dtype, n_unique)
            is_label_source = _is_label_source_column(col)
            leak     = "none" if is_label_source else _leakage_risk(col)
            null_pct = float(df[col].isna().mean())

            candidates.append({
                "name":         col,
                "dtype":        dtype,
                "unique_count": n_unique,
                "null_pct":     round(null_pct, 4),
                "score":        score,
                "leakage_risk": leak,
                "is_binary":    n_unique == 2,
                "is_label_source": is_label_source,
                "label_source_hint": (
                    "This column contains case outcomes. Use /target/generate-str to derive IS_TRUE_POS, "
                    "then exclude this column from model features."
                ) if is_label_source else None,
                "is_recommended": score >= 40 and leak != "high" and not is_label_source,
            })

        # Sort by score descending
        candidates.sort(key=lambda c: c["score"], reverse=True)

        top = [c for c in candidates if c["score"] >= 35]
        recommended = [c for c in top if c.get("is_recommended")]
        non_label_top = [c for c in top if not c.get("is_label_source")]

        return jsonify({
            "dataset_id": dataset_id,
            "total_columns": len(candidates),
            "candidates": candidates,
            "top_candidates": top[:5],
            "auto_suggest": (
                recommended[0]["name"]
                if recommended
                else (non_label_top[0]["name"] if non_label_top else None)
            ),
        })

    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


@target_bp.route("/api/mlops/eda/column-profile", methods=["POST"])
def column_profile():
    """
    POST /api/mlops/eda/column-profile
    Body: { "dataset_id": "...", "column": "col_name" }

    Returns detailed stats for a single column including value_counts,
    null%, unique count, class_balance (for binary), dtype.
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        service  = _get_service(env_root)
        body     = request.get_json() or {}
        dataset_id = body.get("dataset_id")
        column     = body.get("column")

        if not dataset_id or not column:
            return jsonify({"error": "dataset_id and column required"}), 400

        df, meta = _load_dataset_df(service, dataset_id, max_rows=200_000)

        if column not in df.columns:
            return jsonify({"error": f"Column '{column}' not found in dataset"}), 400

        series   = df[column]
        n_total  = len(series)
        n_null   = int(series.isna().sum())
        n_unique = int(series.nunique(dropna=True))
        dtype    = str(series.dtype)

        # Value counts (top 20)
        vc = series.value_counts(dropna=False).head(20)
        value_counts = [
            {"value": str(k) if not pd.isna(k) else "(missing)", "count": int(v)}
            for k, v in vc.items()
        ]

        # Class balance for binary columns
        class_balance     = None
        class_imbalance_ratio = None
        if n_unique == 2:
            vals = series.dropna().unique()
            pos_val = 1 if 1 in vals else max(vals)
            neg_val = 0 if 0 in vals else min(vals)
            n_pos = int((series == pos_val).sum())
            n_neg = int((series == neg_val).sum())
            class_balance = round(n_pos / n_total, 4) if n_total else 0
            class_imbalance_ratio = round(n_neg / n_pos, 2) if n_pos > 0 else None

        # Numeric stats
        numeric_stats = {}
        if pd.api.types.is_numeric_dtype(series):
            desc = series.describe()
            numeric_stats = {
                "mean":   round(float(desc.get("mean", 0)), 4),
                "std":    round(float(desc.get("std", 0)), 4),
                "min":    round(float(desc.get("min", 0)), 4),
                "max":    round(float(desc.get("max", 0)), 4),
                "median": round(float(series.median()), 4),
                "p25":    round(float(desc.get("25%", 0)), 4),
                "p75":    round(float(desc.get("75%", 0)), 4),
            }

        # Sample value
        sample_value = None
        non_null = series.dropna()
        if len(non_null) > 0:
            sample_value = str(non_null.iloc[0])

        return jsonify({
            "column":       column,
            "dtype":        dtype,
            "total_count":  n_total,
            "null_count":   n_null,
            "null_pct":     round(n_null / n_total, 4) if n_total else 0,
            "unique_count": n_unique,
            "is_binary":    n_unique == 2,
            "class_balance": class_balance,
            "class_imbalance_ratio": class_imbalance_ratio,
            "value_counts": value_counts,
            "numeric_stats": numeric_stats,
            "sample_value": sample_value,
            "leakage_risk": _leakage_risk(column),
            "target_score": _target_score(column, dtype, n_unique),
        })

    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


@target_bp.route("/api/mlops/target/derive", methods=["POST"])
def derive_target():
    """
    POST /api/mlops/target/derive
    Body: { "dataset_id": "...", "column": "IS_TRUE_POS" }

    Confirms the target column, computes class balance, stores in registry.
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        service  = _get_service(env_root)
        body     = request.get_json() or {}
        dataset_id = body.get("dataset_id")
        column     = body.get("column")

        if not dataset_id or not column:
            return jsonify({"error": "dataset_id and column required"}), 400

        df, meta = _load_dataset_df(service, dataset_id, max_rows=500_000)

        if column not in df.columns:
            return jsonify({"error": f"Column '{column}' not found in dataset"}), 400

        series    = df[column]
        n_total   = len(series)
        n_pos     = int(series.sum()) if pd.api.types.is_numeric_dtype(series) else int((series == series.dropna().mode()[0]).sum())
        n_null    = int(series.isna().sum())
        n_unique  = int(series.nunique(dropna=True))
        balance   = round(n_pos / (n_total - n_null), 4) if (n_total - n_null) > 0 else 0

        # Persist to registry via service
        try:
            service.upsert_dataset_meta(dataset_id, {
                "target_column": column,
                "target_class_balance": balance,
                "target_n_positive": n_pos,
                "target_total": n_total,
            })
        except Exception:
            pass  # service may not have this method yet — non-fatal

        return jsonify({
            "status":          "ok",
            "dataset_id":      dataset_id,
            "target_column":   column,
            "class_balance":   balance,
            "n_positive":      n_pos,
            "n_negative":      n_total - n_pos - n_null,
            "n_null":          n_null,
            "total_rows":      n_total,
            "imbalance_ratio": round((n_total - n_pos - n_null) / n_pos, 2) if n_pos > 0 else None,
            "leakage_risk":    _leakage_risk(column),
            "message":         f"Target variable '{column}' confirmed. Class balance: {balance:.1%} positive.",
        })

    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


@target_bp.route("/api/mlops/target/str-rules", methods=["POST"])
def str_rules():
    """
    POST /api/mlops/target/str-rules
    Body: {
        "dataset_id": "...",
        "rules": [
            { "column": "RISK_SCORE", "operator": ">", "value": "70", "connector": "AND" },
            { "column": "PEP_FLAG", "operator": "==", "value": "1" }
        ],
        "preview_only": true    // if true, don't save; just return hit count
    }

    Applies rules to derive a binary IS_GENERATED_TARGET column.
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        service  = _get_service(env_root)
        body     = request.get_json() or {}
        dataset_id   = body.get("dataset_id")
        rules        = body.get("rules", [])
        preview_only = body.get("preview_only", False)

        if not dataset_id:
            return jsonify({"error": "dataset_id required"}), 400
        if not rules:
            return jsonify({"error": "rules list is required and cannot be empty"}), 400

        df, meta = _load_dataset_df(service, dataset_id, max_rows=500_000)

        # Build boolean mask from rules
        try:
            mask = _apply_rules(df, rules)
        except ValueError as rule_err:
            return jsonify({"error": f"Rule error: {str(rule_err)}"}), 400

        n_total   = len(df)
        n_flagged = int(mask.sum())
        hit_rate  = round(n_flagged / n_total, 4) if n_total else 0

        if preview_only:
            return jsonify({
                "preview_only":  True,
                "total_count":   n_total,
                "flagged_count": n_flagged,
                "hit_rate":      hit_rate,
                "rules_applied": len(rules),
            })

        # Apply: write derived column back to CSV
        df["IS_GENERATED_TARGET"] = mask.astype(int)
        file_path = meta.get("file_path") or meta.get("filepath")
        if file_path and Path(file_path).exists():
            if str(file_path).endswith(".parquet"):
                df.to_parquet(file_path, index=False)
            else:
                df.to_csv(file_path, index=False)

        return jsonify({
            "status":         "ok",
            "dataset_id":     dataset_id,
            "target_column":  "IS_GENERATED_TARGET",
            "total_count":    n_total,
            "flagged_count":  n_flagged,
            "hit_rate":       hit_rate,
            "rules_applied":  len(rules),
            "message":        f"Generated target column with {n_flagged:,} positive rows ({hit_rate:.1%} hit rate).",
        })

    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


@target_bp.route("/target/generate-str", methods=["POST"])
@target_bp.route("/api/mlops/target/generate-str", methods=["POST"])
def generate_str_target():
    """
    POST /api/mlops/target/generate-str
    Body: { "dataset_id": "...", "str_lookforward_days": 60 }

    v2.1 logic:
      1) CASE_STATUS -> CASE_LABEL
      2) STR filed within lookforward window -> TP_FROM_STR
      3) FINAL_LABEL = 1 if TP_FROM_STR==1 else CASE_LABEL
      4) IS_TRUE_POS = FINAL_LABEL (backward compatibility)
    """
    try:
        tenant_id, env_id = _get_env_ids()
        env_root = _resolve_env_path(env_id, tenant_id)
        service  = _get_service(env_root)
        body     = request.get_json() or {}
        dataset_id = body.get("dataset_id")
        str_lookforward_days = int(body.get("str_lookforward_days") or 60)

        if not dataset_id:
            datasets = service.list_datasets(tenant_id, env_id)
            if not datasets:
                return jsonify({"error": "No datasets found in this environment."}), 400

            def _pick_score(ds: dict) -> int:
                dtype = str(ds.get("dataset_type") or "").strip().lower()
                cols = {str(c).strip().lower() for c in (ds.get("columns") or [])}
                score = 0
                if "master" in dtype:
                    score += 120
                if "preprocessed" in dtype:
                    score += 60
                if {"case_status", "alert_date", "account_id"}.issubset(cols):
                    score += 100
                if "is_true_pos" in cols or "final_label" in cols:
                    score += 40
                if "str_filed_date" in cols or "sar_filed_date" in cols:
                    score += 30
                if dtype in {"alerts", "alert"}:
                    score += 10
                return score

            ranked = sorted(datasets, key=lambda d: (_pick_score(d), int(d.get("dataset_id") or 0)), reverse=True)
            dataset_id = ranked[0].get("dataset_id")

        df, meta = _load_dataset_df(service, dataset_id, max_rows=500_000)

        # Strategy 1: derive from CASE_STATUS (primary), enhanced with STR lookforward override.
        cs_col = next(
            (
                c for c in df.columns
                if str(c).strip().lower() in {"case_status", "disposition", "case_disposition"}
            ),
            None,
        )
        if cs_col:
            status_map = {
                "CLOSED_SAR_FILED": 1,
                "SAR_FILED": 1,
                "SAR FILED": 1,
                "TRUE_POSITIVE": 1,
                "CLOSED_FALSE_POSITIVE": 0,
                "FALSE_POSITIVE": 0,
                "CLOSED_MONITORING": 0,
                "MONITORING": 0,
            }

            account_col = next(
                (c for c in df.columns if str(c).strip().lower() in {"account_id", "acct_id"}),
                None,
            )
            alert_date_col = next(
                (c for c in df.columns if str(c).strip().lower() in {"alert_date", "alert_timestamp"}),
                None,
            )
            str_date_col = next(
                (
                    c for c in df.columns
                    if str(c).strip().lower() in {
                        "str_filed_date",
                        "sar_filed_date",
                        "str_date",
                        "sar_date",
                        "report_date",
                    }
                ),
                None,
            )

            normalized = df[cs_col].astype(str).str.strip().str.upper()
            case_labels = normalized.map(status_map).astype("float64")

            tp_from_str = pd.Series(0, index=df.index, dtype="int64")
            if alert_date_col and str_date_col:
                alert_dates = pd.to_datetime(df[alert_date_col], errors="coerce")
                str_dates = pd.to_datetime(df[str_date_col], errors="coerce")
                in_window = (
                    alert_dates.notna()
                    & str_dates.notna()
                    & (str_dates > alert_dates)
                    & (str_dates <= (alert_dates + pd.to_timedelta(str_lookforward_days, unit="D")))
                )
                if account_col:
                    in_window = in_window & df[account_col].notna()
                tp_from_str = in_window.astype(int)

            final_labels = pd.Series(np.where(tp_from_str == 1, 1.0, case_labels), index=df.index, dtype="float64")
            n_total = int(len(df))
            n_labelled = int(final_labels.notna().sum())
            n_excluded = int(final_labels.isna().sum())
            n_positive = int((final_labels == 1).sum())
            n_negative = int((final_labels == 0).sum())
            n_case_positive = int((case_labels == 1).sum())
            n_str_linked = int(tp_from_str.sum())

            df["TP_FROM_STR"] = tp_from_str
            df["CASE_LABEL"] = case_labels
            df["FINAL_LABEL"] = final_labels
            df["IS_TRUE_POS"] = final_labels
            file_path = meta.get("file_path") or meta.get("filepath")
            if file_path and Path(file_path).exists():
                if str(file_path).endswith(".parquet"):
                    df.to_parquet(file_path, index=False)
                else:
                    df.to_csv(file_path, index=False)

            warning = None
            if n_excluded > 0 and n_total > 0:
                warning = (
                    f"Only {n_labelled:,} of {n_total:,} rows have labels ({(n_labelled / n_total):.1%}). "
                    "Rows with OPEN/no-case outcomes are excluded from supervised training. "
                    "Do not impute labels for uninvestigated alerts."
                )
            if n_labelled > 0:
                pos_rate = n_positive / max(n_labelled, 1)
                if pos_rate > 0.35:
                    warning = (
                        f"Positive rate {pos_rate:.1%} is high for AML datasets. "
                        "Verify CASE_STATUS values and STR window rules."
                    )
                elif pos_rate < 0.01:
                    warning = (
                        f"Positive rate {pos_rate:.1%} is very low. "
                        "Check CLOSED_SAR_FILED and STR date coverage."
                    )

            strategy = "str_lookforward_plus_case_fallback" if (alert_date_col and str_date_col) else "case_status_sar_filed"

            return jsonify({
                "status":           "generated",
                "dataset_id":       int(dataset_id),
                "target_column":    "IS_TRUE_POS",
                "derived_column":   "FINAL_LABEL",
                "strategy":         strategy,
                "source_column":    cs_col,
                "str_source_column": str_date_col,
                "str_lookforward_days": int(str_lookforward_days),
                "n_total":          n_total,
                "n_labelled":       n_labelled,
                "n_excluded":       n_excluded,
                "n_positive":       n_positive,
                "n_negative":       n_negative,
                "n_case_positive":  n_case_positive,
                "n_str_linked":     n_str_linked,
                "class_balance":    round(n_positive / n_labelled, 4) if n_labelled else 0,
                "str_rate_overall": round(n_positive / n_total, 4) if n_total else 0,
                "message": (
                    "Derived FINAL_LABEL with STR lookforward + CASE_STATUS fallback. "
                    f"{n_positive:,} positives, {n_negative:,} negatives, "
                    f"{n_excluded:,} OPEN/no-case excluded."
                ),
                "label_logic": {
                    "TP_FROM_STR": f"1 if STR filed within {int(str_lookforward_days)} days after ALERT_DATE on same account",
                    "CLOSED_SAR_FILED": "1 - genuine SAR",
                    "CLOSED_FALSE_POSITIVE": "0 - confirmed FP",
                    "CLOSED_MONITORING": "0 - treated as FP",
                    "OPEN": "NaN - excluded (unknown outcome)",
                    "FINAL_LABEL": "1 if TP_FROM_STR=1 else CASE_LABEL",
                },
                "warning": warning,
            })

        # Strategy 2: existing explicit label column
        str_cols = ["is_true_pos", "final_label", "sar_filed", "str_filed", "is_sar", "is_str", "label"]
        positive_tokens = {"1", "true", "yes", "y", "sar", "str", "positive", "tp"}
        negative_tokens = {"0", "false", "no", "n", "fp", "negative"}

        for col in df.columns:
            if col.lower() not in str_cols:
                continue
            if int(df[col].nunique(dropna=True)) > 2:
                continue

            series = df[col]
            numeric = pd.to_numeric(series, errors="coerce")
            if numeric.notna().any() and set(numeric.dropna().unique().tolist()).issubset({0, 1}):
                valid_mask = numeric.notna()
                pos_mask = numeric == 1
            else:
                text = series.fillna("").astype(str).str.strip().str.lower()
                pos_mask = text.isin(positive_tokens)
                neg_mask = text.isin(negative_tokens)
                valid_mask = pos_mask | neg_mask

            n_valid = int(valid_mask.sum())
            if n_valid == 0:
                continue

            n_positive = int(pos_mask.sum())
            pos_rate = float(n_positive / n_valid)
            warning = None
            if pos_rate > 0.20:
                warning = (
                    f"Positive rate {pos_rate:.1%} is unusually high for AML (expected 2-15%). "
                    "Verify this label column."
                )
            elif pos_rate < 0.01:
                warning = f"Positive rate {pos_rate:.1%} is very low. Verify label quality."

            return jsonify({
                "status":        "found_existing",
                "dataset_id":    int(dataset_id),
                "target_column": col,
                "strategy":      "existing_column",
                "n_positive":    n_positive,
                "n_total":       int(len(series)),
                "class_balance": round(pos_rate, 4),
                "warning":       warning,
                "message":       f"Found existing target column: '{col}'",
            })

        # Strategy 3: risk-score proxy (last resort)
        if "RISK_SCORE" in df.columns or "risk_score" in df.columns:
            rs_col = "RISK_SCORE" if "RISK_SCORE" in df.columns else "risk_score"
            risk = pd.to_numeric(df[rs_col], errors="coerce")
            threshold = float(risk.quantile(0.85))
            mask = risk >= threshold
            n_total = int(len(df))
            n_flagged = int(mask.sum())

            df["IS_TRUE_POS"] = mask.astype(int)
            file_path = meta.get("file_path") or meta.get("filepath")
            if file_path and Path(file_path).exists():
                df.to_csv(file_path, index=False)

            return jsonify({
                "status":        "generated",
                "dataset_id":    int(dataset_id),
                "target_column": "IS_TRUE_POS",
                "strategy":      "risk_score_proxy",
                "source_column": rs_col,
                "threshold":     threshold,
                "n_positive":    n_flagged,
                "n_total":       n_total,
                "class_balance": round(n_flagged / n_total, 4) if n_total else 0,
                "message":       f"No case outcomes found. Generated proxy target from {rs_col} >= {threshold:.0f} (top 15%).",
                "warning": (
                    "PROXY LABEL ONLY: risk-score-derived labels are not valid substitutes for investigator outcomes. "
                    "Upload cases with CASE_STATUS for production-grade AML labeling."
                ),
            })

        return jsonify({
            "status":  "no_target_found",
            "message": (
                "Could not auto-generate a target. Upload/build a master dataset with CASE_STATUS "
                "and optional STR filed date columns, then re-run this endpoint."
            ),
        })

    except (ValueError, FileNotFoundError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)}"}), 500


# ─── Rule application engine ──────────────────────────────────────────────────

def _apply_rules(df: pd.DataFrame, rules: list) -> pd.Series:
    """Apply a list of rule dicts to df. Returns boolean Series."""
    if not rules:
        raise ValueError("No rules provided")

    masks = []
    for rule in rules:
        col  = rule.get("column")
        op   = rule.get("operator")
        val  = rule.get("value", "")
        conn = rule.get("connector", "AND")

        if col not in df.columns:
            raise ValueError(f"Column '{col}' not found in dataset")

        series = df[col]

        if op == "notnull":
            mask = series.notna()
        elif op == "==":
            # Try numeric cast first
            try:    mask = series == type(series.dropna().iloc[0])(val)
            except: mask = series.astype(str) == str(val)
        elif op == "!=":
            try:    mask = series != type(series.dropna().iloc[0])(val)
            except: mask = series.astype(str) != str(val)
        elif op == ">":
            mask = pd.to_numeric(series, errors="coerce") > float(val)
        elif op == ">=":
            mask = pd.to_numeric(series, errors="coerce") >= float(val)
        elif op == "<":
            mask = pd.to_numeric(series, errors="coerce") < float(val)
        elif op == "<=":
            mask = pd.to_numeric(series, errors="coerce") <= float(val)
        elif op == "in":
            values = [v.strip() for v in str(val).split(",")]
            try:
                num_vals = [float(v) for v in values]
                mask = pd.to_numeric(series, errors="coerce").isin(num_vals)
            except:
                mask = series.astype(str).isin(values)
        else:
            raise ValueError(f"Unknown operator: {op}")

        masks.append((mask, conn))

    # Combine masks
    result = masks[0][0]
    for i in range(1, len(masks)):
        current_mask, _ = masks[i]
        prev_connector  = masks[i - 1][1]
        if prev_connector == "OR":
            result = result | current_mask
        else:
            result = result & current_mask

    return result
