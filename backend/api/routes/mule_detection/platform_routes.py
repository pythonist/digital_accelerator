import json
import time
import uuid
import math
from datetime import datetime, timedelta
import hashlib
import pickle
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
from flask import Blueprint, jsonify, request
import threading

from features.feature_engineer import FeatureEngineer
from models.model_pipeline import ModelPipeline
from modules.inference_engine import InferenceEngine
from modules.network_analyzer import NetworkAnalyzer
from modules.rule_engine import RuleEngine
from services.mule_detection.money_flow import MoneyFlowAnalyzer, MoneyFlowConfig
from services.mule_detection.risk_dashboard_service import RiskDashboardService
from services.mule_detection.feature_workbench_service import FeatureWorkbenchService
from services.mule_detection.model_workbench_service import ModelWorkbenchService
from services.mule_detection.mule_inference_service import MuleInferenceService
from services.mule_detection.explanation_provider import ExplanationProvider
from services.mule_detection.target_service import TargetService
from services.mule_detection.feature_origin_service import FeatureOriginService
from services.mule_detection.db_service import get_md_db_service

platform_bp = Blueprint("mule_platform", __name__)
md_db = get_md_db_service()

_feature_jobs_lock = threading.Lock()
_feature_jobs = {}
_env_job_workers_lock = threading.Lock()
_env_job_workers = {}


def _env_id() -> str:
    return request.headers.get("X-Environment-ID", "fcip_env")


def _conn(env_id: str):
    return md_db.connect(env_id)

def _conn_ro(env_id: str):
    return md_db.connect(env_id)


def _hash_jsonable(obj) -> str:
    try:
        s = json.dumps(obj, sort_keys=True, default=str)
    except Exception:
        s = str(obj)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def _to_jsonable(obj):
    if obj is None:
        return None
    if isinstance(obj, (str, int, bool)):
        return obj
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {str(k): _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_to_jsonable(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return _to_jsonable(obj.tolist())
    if isinstance(obj, pd.Timestamp):
        return obj.isoformat()
    if hasattr(obj, "isoformat"):
        try:
            return obj.isoformat()
        except Exception:
            pass
    return str(obj)


def _jsonify_safe(payload, status_code: int | None = None):
    if status_code is None:
        return jsonify(_to_jsonable(payload))
    return jsonify(_to_jsonable(payload)), int(status_code)


def _get_data_version(conn: duckdb.DuckDBPyConnection, env_id: str) -> str:
    row = conn.execute(
        """
        SELECT upload_id, uploaded_at
        FROM mule_uploads
        WHERE environment_id = ?
        ORDER BY uploaded_at DESC
        LIMIT 1
        """,
        [env_id],
    ).fetchone()
    if not row:
        return "no_upload"
    upload_id = row[0]
    uploaded_at = row[1]
    return str(upload_id or uploaded_at or "unknown")


def _persist_module_run(
    conn: duckdb.DuckDBPyConnection,
    env_id: str,
    module: str,
    data_version: str,
    config_version: str,
    summary: dict,
    result: dict,
) -> dict:
    run_id = str(uuid.uuid4())
    conn.execute(
        """
        INSERT INTO mule_module_runs(run_id, environment_id, module, data_version, config_version, summary_json, result_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [
            run_id,
            env_id,
            module,
            data_version,
            config_version,
            json.dumps(summary, default=str),
            json.dumps(result, default=str),
        ],
    )
    return {"run_id": run_id, "created_at": datetime.now().isoformat()}


def _load_last_module_run(conn: duckdb.DuckDBPyConnection, env_id: str, module: str):
    row = conn.execute(
        """
        SELECT run_id, data_version, config_version, summary_json, result_json, created_at
        FROM mule_module_runs
        WHERE environment_id = ? AND module = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        [env_id, module],
    ).fetchone()
    if not row:
        return None
    run_id, data_version, config_version, summary_json, result_json, created_at = row
    return {
        "run_id": run_id,
        "data_version": data_version,
        "config_version": config_version,
        "summary": json.loads(summary_json) if summary_json else {},
        "result": json.loads(result_json) if result_json else {},
        "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
    }


@platform_bp.route("/runs/last", methods=["GET"])
def get_last_run():
    env_id = _env_id()
    module = request.args.get("module")
    if not module:
        return jsonify({"success": False, "error": "module is required"}), 400
    conn, _paths = _conn(env_id)
    try:
        last = _load_last_module_run(conn, env_id, module)
    finally:
        conn.close()
    if not last:
        return jsonify({"success": True, "has_results": False})
    return jsonify({"success": True, "has_results": True, **last})


@platform_bp.route("/targets/summary", methods=["GET"])
def targets_summary():
    env_id = _env_id()
    target_name = request.args.get("target_name") or "is_mule"
    svc = TargetService(env_id)
    return jsonify(svc.target_summary(target_name=target_name))


def _load_tx_acc(env_id: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    conn, _paths = _conn(env_id)
    try:
        tx = conn.execute("SELECT * FROM mule_transactions WHERE environment_id = ?", [env_id]).df()
        acc = conn.execute("SELECT * FROM mule_accounts WHERE environment_id = ?", [env_id]).df()
    finally:
        conn.close()
    if len(tx) > 0 and "direction" in tx.columns:
        dir_norm = tx["direction"].astype(str).str.strip().str.lower()
        tx["direction"] = dir_norm.replace(
            {
                "in": "inbound",
                "inbound": "inbound",
                "credit": "inbound",
                "cr": "inbound",
                "out": "outbound",
                "outbound": "outbound",
                "debit": "outbound",
                "dr": "outbound",
            }
        )
    if acc is None or len(acc) == 0:
        account_ids = tx["account_id"].dropna().astype(str).unique().tolist() if len(tx) else []
        acc = pd.DataFrame(
            {
                "account_id": account_ids,
                "customer_id": None,
                "account_open_date": None,
                "customer_type": None,
                "risk_rating": None,
                "occupation": None,
                "expected_turnover": None,
                "is_mule": None,
                "environment_id": env_id,
                "created_at": None,
            }
        )
    return tx, acc


def _ensure_has_data(env_id: str) -> tuple[bool, str | None]:
    conn, _paths = _conn(env_id)
    try:
        raw_count = int(conn.execute("SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
        base_count = int(conn.execute("SELECT COUNT(*) FROM mule_transactions WHERE environment_id = ?", [env_id]).fetchone()[0])
    finally:
        conn.close()
    if raw_count == 0 and base_count == 0:
        return False, "Upload Transactions First"
    return True, None


@platform_bp.route("/data/schema", methods=["GET"])
def data_schema():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        txn_cols = conn.execute("PRAGMA table_info('mule_transactions_raw')").df()
        acc_cols = conn.execute("PRAGMA table_info('mule_accounts_raw')").df()
        upload_row = conn.execute(
            "SELECT uploaded_at, txn_file_name, accounts_file_name FROM mule_uploads WHERE environment_id = ? ORDER BY uploaded_at DESC LIMIT 1",
            [env_id],
        ).fetchone()
    finally:
        conn.close()
    return jsonify(
        {
            "success": True,
            "environment_id": env_id,
            "transactions": txn_cols.to_dict("records"),
            "accounts": acc_cols.to_dict("records"),
            "last_upload": {
                "uploaded_at": str(upload_row[0]) if upload_row else None,
                "txn_file_name": upload_row[1] if upload_row else None,
                "accounts_file_name": upload_row[2] if upload_row else None,
            },
        }
    )

@platform_bp.route("/data/onboarding/profile", methods=["GET"])
def data_onboarding_profile():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        rows = int(conn.execute("SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
        accs = int(conn.execute("SELECT COUNT(DISTINCT account_id) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
        custs = int(conn.execute("SELECT COUNT(DISTINCT customer_id) FROM mule_accounts_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
        rng = conn.execute("SELECT MIN(txn_timestamp), MAX(txn_timestamp) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()
        start_ts, end_ts = rng[0], rng[1]
        tx_per_acc = conn.execute("SELECT AVG(c) FROM (SELECT account_id, COUNT(*) AS c FROM mule_transactions_raw WHERE environment_id = ? GROUP BY account_id)", [env_id]).fetchone()[0]
        dens = float(tx_per_acc or 0.0)
        return jsonify({"success": True, "rows": rows, "accounts": accs, "customers": custs, "date_coverage": {"start": str(start_ts), "end": str(end_ts)}, "activity_density": dens})
    finally:
        conn.close()

@platform_bp.route("/data/onboarding/validate", methods=["GET"])
def data_onboarding_validate():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        req_tx = ["txn_id","account_id","txn_timestamp","amount","direction"]
        req_acc = ["account_id","customer_id","account_open_date","customer_type","risk_rating","expected_turnover","is_mule"]
        tx_cols = [r[1] for r in conn.execute("PRAGMA table_info('mule_transactions_raw')").fetchall()]
        acc_cols = [r[1] for r in conn.execute("PRAGMA table_info('mule_accounts_raw')").fetchall()]
        missing_tx = [c for c in req_tx if c not in tx_cols]
        missing_acc = [c for c in req_acc if c not in acc_cols]
        null_tx = conn.execute("SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ? AND (txn_id IS NULL OR account_id IS NULL OR txn_timestamp IS NULL OR amount IS NULL)", [env_id]).fetchone()[0]
        dup_tx = conn.execute("SELECT COUNT(*) FROM (SELECT txn_id, COUNT(*) AS c FROM mule_transactions_raw WHERE environment_id = ? GROUP BY txn_id HAVING c>1)", [env_id]).fetchone()[0]
        status = "pass"
        if missing_tx or missing_acc or dup_tx > 0:
            status = "fail"
        elif null_tx > 0:
            status = "warning"
        return jsonify({"success": True, "status": status, "missing": {"transactions": missing_tx, "accounts": missing_acc}, "nulls": {"transactions_rows": int(null_tx)}, "duplicates": {"transactions_txn_id": int(dup_tx)}})
    finally:
        conn.close()

@platform_bp.route("/data/onboarding/integrity", methods=["GET"])
def data_onboarding_integrity():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        orphan_tx = conn.execute("SELECT COUNT(*) FROM mule_transactions_raw t LEFT JOIN mule_accounts_raw a ON a.environment_id=t.environment_id AND a.account_id=t.account_id WHERE t.environment_id = ? AND a.account_id IS NULL", [env_id]).fetchone()[0]
        dup_txid = conn.execute("SELECT COUNT(*) FROM (SELECT txn_id, COUNT(*) AS c FROM mule_transactions_raw WHERE environment_id = ? GROUP BY txn_id HAVING c>1)", [env_id]).fetchone()[0]
        broken_rel = orphan_tx
        return jsonify({"success": True, "orphan_transactions": int(orphan_tx), "duplicate_txn_id": int(dup_txid), "broken_relationships": int(broken_rel)})
    finally:
        conn.close()

@platform_bp.route("/data/onboarding/time-sanity", methods=["GET"])
def data_onboarding_time_sanity():
    from datetime import datetime, timezone
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        now = datetime.now(timezone.utc)
        fut = conn.execute("SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ? AND txn_timestamp > ?", [env_id, now]).fetchone()[0]
        rng = conn.execute("SELECT MIN(txn_timestamp), MAX(txn_timestamp) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()
        start_ts, end_ts = rng[0], rng[1]
        if start_ts is None or end_ts is None:
            return jsonify({"success": True, "future_dates": int(fut), "date_coverage": {"start": None, "end": None}, "missing_days": 0})
        days = conn.execute(
            "SELECT DISTINCT DATE_TRUNC('day', txn_timestamp) AS d FROM mule_transactions_raw WHERE environment_id = ?",
            [env_id],
        ).df()
        present = set(pd.to_datetime(days["d"], errors="coerce").dropna().dt.date.tolist()) if len(days) else set()
        full = pd.date_range(pd.to_datetime(start_ts).date(), pd.to_datetime(end_ts).date(), freq="D")
        missing = [d.date() for d in full if d.date() not in present]
        return jsonify(
            {
                "success": True,
                "future_dates": int(fut),
                "date_coverage": {"start": str(start_ts), "end": str(end_ts)},
                "missing_days": int(len(missing)),
            }
        )
    finally:
        conn.close()

@platform_bp.route("/data/onboarding/missingness", methods=["GET"])
def data_onboarding_missingness():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        tx_cols = conn.execute("PRAGMA table_info('mule_transactions_raw')").df()["name"].tolist()
        acc_cols = conn.execute("PRAGMA table_info('mule_accounts_raw')").df()["name"].tolist()
        tx = []
        for c in tx_cols:
            n = conn.execute(f"SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ? AND \"{c}\" IS NULL", [env_id]).fetchone()[0]
            total = conn.execute("SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()[0]
            pct = float(n) / float(total) if total else 0.0
            tx.append({"column": c, "nulls": int(n), "pct": pct})
        acc = []
        for c in acc_cols:
            n = conn.execute(f"SELECT COUNT(*) FROM mule_accounts_raw WHERE environment_id = ? AND \"{c}\" IS NULL", [env_id]).fetchone()[0]
            total = conn.execute("SELECT COUNT(*) FROM mule_accounts_raw WHERE environment_id = ?", [env_id]).fetchone()[0]
            pct = float(n) / float(total) if total else 0.0
            acc.append({"column": c, "nulls": int(n), "pct": pct})
        return jsonify({"success": True, "transactions": tx, "accounts": acc})
    finally:
        conn.close()

@platform_bp.route("/data/onboarding/cardinality", methods=["GET"])
def data_onboarding_cardinality():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        cols = ["direction","channel","txn_type","device_id","ip_address","counterparty_bank"]
        out = []
        for c in cols:
            d = conn.execute(f"SELECT COUNT(DISTINCT \"{c}\") FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()[0]
            top = conn.execute(f"SELECT \"{c}\", COUNT(*) AS c FROM mule_transactions_raw WHERE environment_id = ? GROUP BY \"{c}\" ORDER BY c DESC LIMIT 10", [env_id]).df().to_dict("records")
            out.append({"column": c, "distinct": int(d), "top": top})
        return jsonify({"success": True, "transactions": out})
    finally:
        conn.close()

@platform_bp.route("/data/onboarding/distribution", methods=["GET"])
def data_onboarding_distribution():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    bins = int(request.args.get("bins", 20))
    conn, _paths = _conn(env_id)
    try:
        r = conn.execute("SELECT MIN(amount), MAX(amount) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()
        min_v, max_v = float(r[0] or 0.0), float(r[1] or 0.0)
        width = float(max_v - min_v) / float(bins) if bins > 0 else 0.0
        if width == 0.0:
            return jsonify({"success": True, "amount_bins": [], "frequency_top": []})
        rows = conn.execute("SELECT FLOOR((TRY_CAST(amount AS DOUBLE) - ?) / ?) AS b, COUNT(*) AS c FROM mule_transactions_raw WHERE environment_id = ? AND TRY_CAST(amount AS DOUBLE) IS NOT NULL GROUP BY b ORDER BY b", [min_v, width, env_id]).fetchall()
        out_bins = []
        for b, c in rows:
            start = min_v + float(int(b)) * width
            end = start + width
            out_bins.append({"bin": int(b), "start": start, "end": end, "count": int(c)})
        freq = conn.execute("SELECT account_id, COUNT(*) AS tx_count FROM mule_transactions_raw WHERE environment_id = ? GROUP BY account_id ORDER BY tx_count DESC LIMIT 50", [env_id]).df().to_dict("records")
        return jsonify({"success": True, "amount_bins": out_bins, "frequency_top": freq})
    finally:
        conn.close()

@platform_bp.route("/data/onboarding/lineage", methods=["GET"])
def data_onboarding_lineage():
    env_id = _env_id()
    conn, _paths = _conn(env_id)
    try:
        df = conn.execute(
            "SELECT upload_id, uploaded_at, txn_file_name, accounts_file_name, txn_row_count, accounts_row_count, dataset_version, uploader, source_ip, checksum_txn, checksum_acc FROM mule_uploads WHERE environment_id = ? ORDER BY uploaded_at DESC LIMIT 10",
            [env_id],
        ).df()
        return jsonify({"success": True, "uploads": df.to_dict("records")})
    finally:
        conn.close()

@platform_bp.route("/data/forensics/report", methods=["GET"])
def data_forensics_report():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    sample_limit = int(request.args.get("limit", 20000))
    conn, _paths = _conn(env_id)
    try:
        tx = conn.execute("SELECT * FROM mule_transactions_raw WHERE environment_id = ? LIMIT ?", [env_id, sample_limit]).df()
        acc = conn.execute("SELECT * FROM mule_accounts_raw WHERE environment_id = ? LIMIT ?", [env_id, sample_limit]).df()
    finally:
        conn.close()

    def _infer_kind(col_name: str, dtype: str):
        name = col_name.lower()
        dt = str(dtype).upper()
        if "TIMESTAMP" in dt or "DATE" in dt or "time" in name or "date" in name:
            return "timestamp"
        if "BOOL" in dt or name.startswith("is_") or name.endswith("_flag"):
            return "boolean"
        if "id" in name and "device" not in name and "ip" not in name:
            return "id"
        if any(x in dt for x in ["DOUBLE", "FLOAT", "INT", "DECIMAL", "BIGINT"]):
            return "numeric"
        return "categorical"

    def _missingness(df):
        total = int(len(df))
        out = []
        for c in df.columns:
            n = int(df[c].isna().sum())
            out.append({"column": c, "nulls": n, "pct": float(n) / total if total else 0.0})
        return out

    def _cardinality(df, limit_cols=12):
        out = []
        for c in df.columns[:limit_cols]:
            if df[c].dtype == object:
                vc = df[c].value_counts(dropna=True).head(10)
                out.append({"column": c, "distinct": int(df[c].nunique(dropna=True)), "top": [{"value": str(k), "count": int(v)} for k, v in vc.items()]})
        return out

    def _rare_categories(df, max_rows=15):
        out = []
        for c in df.columns:
            if df[c].dtype == object:
                vc = df[c].value_counts(dropna=True)
                rare = vc[vc <= max(2, int(0.01 * len(df)))]
                if len(rare):
                    out.append({"column": c, "rare": [{"value": str(k), "count": int(v)} for k, v in rare.head(max_rows).items()]})
        return out

    def _correlation_hints(df, limit=10):
        num = df.select_dtypes(include=[np.number])
        if num.shape[1] < 2:
            return []
        corr = num.corr().abs()
        pairs = []
        cols = corr.columns
        for i in range(len(cols)):
            for j in range(i + 1, len(cols)):
                v = corr.iloc[i, j]
                if v >= 0.7:
                    pairs.append({"a": cols[i], "b": cols[j], "corr": float(v)})
        pairs.sort(key=lambda x: x["corr"], reverse=True)
        return pairs[:limit]

    def _leakage(df, label_col, limit=10):
        if label_col not in df.columns:
            return []
        y = pd.to_numeric(df[label_col], errors="coerce").fillna(0).astype(int)
        if y.nunique() < 2:
            return []
        out = []
        for c in df.select_dtypes(include=[np.number]).columns:
            if c == label_col:
                continue
            x = pd.to_numeric(df[c], errors="coerce")
            mu1 = float(x[y == 1].mean()) if (y == 1).any() else 0.0
            mu0 = float(x[y == 0].mean()) if (y == 0).any() else 0.0
            std = float(x.std() or 0.0)
            if std == 0:
                continue
            score = abs(mu1 - mu0) / std
            out.append({"feature": c, "separation": score})
        out.sort(key=lambda x: x["separation"], reverse=True)
        return out[:limit]

    def _type_suggestions(df):
        out = []
        for c in df.columns:
            if df[c].dtype != object:
                continue
            s = df[c].astype(str)
            num_ratio = pd.to_numeric(s, errors="coerce").notna().mean()
            if num_ratio > 0.8:
                out.append({"column": c, "suggest": "numeric", "confidence": float(num_ratio)})
            if ("date" in c.lower() or "time" in c.lower()) and pd.to_datetime(s, errors="coerce").notna().mean() > 0.8:
                out.append({"column": c, "suggest": "timestamp", "confidence": float(pd.to_datetime(s, errors="coerce").notna().mean())})
        return out[:20]

    def _extremes(df):
        if "amount" not in df.columns:
            return None
        s = pd.to_numeric(df["amount"], errors="coerce").dropna()
        if len(s) == 0:
            return None
        p1, p99 = s.quantile(0.01), s.quantile(0.99)
        low = int((s < p1).sum())
        high = int((s > p99).sum())
        return {"p1": float(p1), "p99": float(p99), "low_outliers": low, "high_outliers": high}

    report = {
        "transactions": {
            "schema": [{"column": c, "type": str(t), "kind": _infer_kind(c, t)} for c, t in zip(tx.columns, tx.dtypes)],
            "missingness": _missingness(tx),
            "cardinality": _cardinality(tx),
            "rare_categories": _rare_categories(tx),
            "correlation_hints": _correlation_hints(tx),
            "extreme_values": _extremes(tx),
        },
        "accounts": {
            "schema": [{"column": c, "type": str(t), "kind": _infer_kind(c, t)} for c, t in zip(acc.columns, acc.dtypes)],
            "missingness": _missingness(acc),
            "cardinality": _cardinality(acc),
            "rare_categories": _rare_categories(acc),
            "correlation_hints": _correlation_hints(acc),
        },
        "imbalance": {
            "is_mule": acc["is_mule"].value_counts(dropna=False).to_dict() if "is_mule" in acc.columns else {},
            "is_suspicious": tx["is_suspicious"].value_counts(dropna=False).to_dict() if "is_suspicious" in tx.columns else {},
        },
        "leakage": {
            "accounts": _leakage(acc, "is_mule"),
            "transactions": _leakage(tx, "is_suspicious"),
        },
        "type_suggestions": {
            "transactions": _type_suggestions(tx),
            "accounts": _type_suggestions(acc),
        },
    }
    return jsonify({"success": True, "report": report})

@platform_bp.route("/accounts/<account_id>/behavior", methods=["GET"])
def account_behavior_profile(account_id: str):
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        tx = conn.execute(
            """
            SELECT * FROM mule_transactions_raw
            WHERE environment_id = ? AND account_id = ?
            ORDER BY txn_timestamp
            """,
            [env_id, account_id],
        ).df()
        peers = conn.execute(
            """
            SELECT account_id,
                   COUNT(*) AS tx_count,
                   AVG(amount) AS avg_amount,
                   COUNT(DISTINCT counterparty_account) AS cp_count,
                   COUNT(DISTINCT device_id) AS device_count
            FROM mule_transactions_raw
            WHERE environment_id = ?
            GROUP BY account_id
            """,
            [env_id],
        ).df()
    finally:
        conn.close()
    if len(tx) == 0:
        return jsonify({"success": False, "error": "No transactions for account"}), 404

    tx["txn_timestamp"] = pd.to_datetime(tx["txn_timestamp"], errors="coerce")
    tx = tx.dropna(subset=["txn_timestamp"])
    tx_count = int(len(tx))
    active_days = int(tx["txn_timestamp"].dt.date.nunique())
    day_counts = tx.groupby(tx["txn_timestamp"].dt.date).size()
    avg_per_day = float(day_counts.mean()) if len(day_counts) else 0.0
    peak_day = int(day_counts.max()) if len(day_counts) else 0
    diffs = tx["txn_timestamp"].sort_values().diff().dropna()
    avg_gap_min = float(diffs.dt.total_seconds().mean() / 60.0) if len(diffs) else 0.0

    counterparties = int(tx["counterparty_account"].nunique()) if "counterparty_account" in tx.columns else 0
    banks = int(tx["counterparty_bank"].nunique()) if "counterparty_bank" in tx.columns else 0
    channels = tx["channel"].value_counts(dropna=False).head(10).to_dict() if "channel" in tx.columns else {}
    devices = int(tx["device_id"].nunique()) if "device_id" in tx.columns else 0
    ips = int(tx["ip_address"].nunique()) if "ip_address" in tx.columns else 0
    top_counterparty = (
        tx["counterparty_account"].value_counts(dropna=True).head(5).to_dict()
        if "counterparty_account" in tx.columns
        else {}
    )
    direction_counts = tx["direction"].value_counts(dropna=False).to_dict() if "direction" in tx.columns else {}

    peer_row = peers[peers["account_id"] == account_id]
    peer_metrics = {}
    if len(peers) and len(peer_row):
        def _percentile(col):
            v = float(peer_row[col].iloc[0] or 0.0)
            return float((peers[col] <= v).mean())
        peer_metrics = {
            "tx_count_pct": _percentile("tx_count"),
            "avg_amount_pct": _percentile("avg_amount"),
            "cp_count_pct": _percentile("cp_count"),
            "device_count_pct": _percentile("device_count"),
        }

    return jsonify(
        {
            "success": True,
            "account_id": account_id,
            "rhythm": {"tx_count": tx_count, "active_days": active_days, "avg_per_day": avg_per_day, "peak_day": peak_day, "avg_gap_minutes": avg_gap_min},
            "counterparty_diversity": {"counterparties": counterparties, "banks": banks, "top_counterparties": top_counterparty},
            "channel_mix": channels,
            "device_spread": {"devices": devices, "ip_addresses": ips},
            "direction_mix": direction_counts,
            "peer_comparison": peer_metrics,
        }
    )

@platform_bp.route("/risk/signal-preview", methods=["GET"])
def risk_signal_preview():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    conn, _paths = _conn(env_id)
    try:
        feature_count = int(conn.execute("SELECT COUNT(*) FROM mule_account_features WHERE environment_id = ?", [env_id]).fetchone()[0])
        if feature_count == 0:
            return jsonify({"success": False, "error": "No engineered features found. Run Feature Engineering first."}), 400
        df = conn.execute(
            """
            SELECT f.*, a.is_mule
            FROM mule_account_features f
            LEFT JOIN mule_accounts_raw a
              ON a.environment_id = f.environment_id AND a.account_id = f.account_id
            WHERE f.environment_id = ?
            """,
            [env_id],
        ).df()
    finally:
        conn.close()
    if "is_mule" not in df.columns:
        return jsonify({"success": False, "error": "No labels available for preview"}), 400
    y = pd.to_numeric(df["is_mule"], errors="coerce").fillna(0).astype(int)
    if y.nunique() < 2:
        return jsonify({"success": False, "error": "Labels are single-class; separability cannot be computed"}), 400

    features = []
    for c in df.select_dtypes(include=[np.number]).columns:
        if c in ["is_mule"]:
            continue
        s = pd.to_numeric(df[c], errors="coerce")
        mu1 = float(s[y == 1].mean()) if (y == 1).any() else 0.0
        mu0 = float(s[y == 0].mean()) if (y == 0).any() else 0.0
        std = float(s.std() or 0.0)
        if std == 0:
            continue
        sep = abs(mu1 - mu0) / std
        features.append({"feature": c, "separation": float(sep), "mean_mule": mu1, "mean_non_mule": mu0})
    features.sort(key=lambda x: x["separation"], reverse=True)
    return jsonify({"success": True, "signals": features[:20]})

@platform_bp.route("/data/sample", methods=["GET"])
def data_sample():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    table = request.args.get("table", "transactions")
    limit = request.args.get("limit", 25, type=int)
    limit = max(1, min(limit, 200))

    if table not in ["transactions", "accounts"]:
        return jsonify({"success": False, "error": "Invalid table"}), 400

    conn, _paths = _conn(env_id)
    try:
        if table == "transactions":
            raw_count = int(conn.execute("SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
            sql_table = "mule_transactions_raw" if raw_count > 0 else "mule_transactions"
        else:
            raw_count = int(conn.execute("SELECT COUNT(*) FROM mule_accounts_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
            sql_table = "mule_accounts_raw" if raw_count > 0 else "mule_accounts"
        df = conn.execute(f"SELECT * FROM {sql_table} WHERE environment_id = ? LIMIT ?", [env_id, limit]).df()
    finally:
        conn.close()
    return jsonify({"success": True, "table": table, "rows": df.to_dict("records")})


@platform_bp.route("/data/profile", methods=["GET"])
def data_profile():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    conn, _paths = _conn(env_id)
    try:
        txn_cols = conn.execute("PRAGMA table_info('mule_transactions_raw')").df()["name"].tolist()
        acc_cols = conn.execute("PRAGMA table_info('mule_accounts_raw')").df()["name"].tolist()

        def _null_sql(table_name: str, cols: list[str]) -> tuple[dict, int]:
            selects = ["COUNT(*) AS n"]
            for c in cols:
                if c in ["environment_id", "created_at"]:
                    continue
                selects.append(f"SUM(CASE WHEN {c} IS NULL THEN 1 ELSE 0 END) AS {c}_nulls")
            row = conn.execute(
                f"SELECT {', '.join(selects)} FROM {table_name} WHERE environment_id = ?",
                [env_id],
            ).fetchone()
            n = int(row[0] or 0)
            out = {}
            for i, c in enumerate([c for c in cols if c not in ['environment_id', 'created_at']]):
                out[c] = int(row[i + 1] or 0)
            return out, n

        txn_nulls, txn_n = _null_sql("mule_transactions_raw", txn_cols)
        acc_nulls, acc_n = _null_sql("mule_accounts_raw", acc_cols)

        ts_row = conn.execute(
            "SELECT MIN(txn_timestamp), MAX(txn_timestamp) FROM mule_transactions_raw WHERE environment_id = ?",
            [env_id],
        ).fetchone()
        start_ts = str(ts_row[0]) if ts_row and ts_row[0] else None
        end_ts = str(ts_row[1]) if ts_row and ts_row[1] else None
    finally:
        conn.close()

    return jsonify(
        {
            "success": True,
            "environment_id": env_id,
            "transactions": {"row_count": txn_n, "nulls": txn_nulls, "timestamp_range": {"start": start_ts, "end": end_ts}},
            "accounts": {"row_count": acc_n, "nulls": acc_nulls},
        }
    )


def _persist_features(conn: duckdb.DuckDBPyConnection, env_id: str, features_df: pd.DataFrame) -> None:
    features_df = features_df.copy()
    features_df["environment_id"] = env_id
    features_df["computed_at"] = datetime.now().isoformat()

    cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
    table_cols = cols_df.sort_values("cid")["name"].tolist()
    table_col_set = set(table_cols)

    for col in features_df.columns:
        if col in table_col_set:
            continue
        if col in ["account_id", "environment_id", "computed_at"]:
            continue
        dtype = features_df[col].dtype
        if pd.api.types.is_numeric_dtype(dtype):
            conn.execute(f'ALTER TABLE mule_account_features ADD COLUMN "{col}" DOUBLE')
        else:
            conn.execute(f'ALTER TABLE mule_account_features ADD COLUMN "{col}" VARCHAR')

    cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
    table_cols = cols_df.sort_values("cid")["name"].tolist()

    for col in table_cols:
        if col not in features_df.columns:
            features_df[col] = None

    features_df = features_df[table_cols]
    conn.execute("DELETE FROM mule_account_features WHERE environment_id = ?", [env_id])
    conn.register("feat", features_df)
    cols_sql = ", ".join([f'"{c}"' for c in table_cols])
    conn.execute(f"INSERT INTO mule_account_features ({cols_sql}) SELECT {cols_sql} FROM feat")


@platform_bp.route("/features/engineer", methods=["POST"])
def engineer_features():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400
    payload = request.get_json(silent=True) or {}
    mode = payload.get("mode") or payload.get("run_type") or "run"
    config = payload.get("config") if isinstance(payload.get("config"), dict) else payload
    if isinstance(config, dict):
        config = {**config, "run_type": mode}
    persist_payload = {
        "mode": mode,
        "config": config,
        "custom_feature": payload.get("custom_feature"),
        "feature_metadata": payload.get("feature_metadata"),
    }
    job_id = str(uuid.uuid4())
    conn, _paths = _conn(env_id)
    try:
        conn.execute(
            """
            INSERT INTO mule_jobs(job_id, job_type, state, step, message, processed_accounts, total_accounts, progress_pct, payload_json, result_json, error, environment_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                job_id,
                "feature_engineering",
                "queued",
                "queued",
                "Queued",
                0,
                None,
                0.0,
                json.dumps(persist_payload, default=str),
                None,
                None,
                env_id,
            ],
        )
    finally:
        conn.close()

    _ensure_env_feature_worker(env_id)
    return jsonify({"success": True, "job_id": job_id, "state": "queued"})


@platform_bp.route("/features/engineer/status", methods=["GET"])
def engineer_features_status():
    env_id = _env_id()
    job_id = request.args.get("job_id")
    _ensure_env_feature_worker(env_id)
    try:
        conn, _paths = _conn_ro(env_id)
    except Exception as e:
        return jsonify({"success": True, "state": "busy", "job_id": job_id, "error": str(e)}), 200
    try:
        def _row_to_status(row, queue_position: int | None = None):
            return {
                "success": True,
                "job_id": row[0],
                "state": row[1],
                "step": row[2],
                "message": row[3],
                "processed_accounts": int(row[4] or 0) if row[4] is not None else 0,
                "total_accounts": int(row[5] or 0) if row[5] is not None else 0,
                "progress_pct": float(row[6] or 0.0),
                "result": json.loads(row[7]) if row[7] else None,
                "error": row[8],
                "created_at": row[9].isoformat() if hasattr(row[9], "isoformat") else str(row[9]),
                "updated_at": row[10].isoformat() if hasattr(row[10], "isoformat") else str(row[10]),
                "queue_position": queue_position,
            }

        if job_id:
            row = conn.execute(
                """
                SELECT job_id, state, step, message, processed_accounts, total_accounts, progress_pct, result_json, error, created_at, updated_at
                FROM mule_jobs
                WHERE environment_id = ? AND job_id = ?
                """,
                [env_id, job_id],
            ).fetchone()
            if not row:
                return jsonify({"success": True, "state": "idle", "job_id": None})
            pos = conn.execute(
                """
                SELECT COUNT(*)
                FROM mule_jobs
                WHERE environment_id = ? AND job_type = 'feature_engineering' AND state = 'queued' AND created_at < (
                    SELECT created_at FROM mule_jobs WHERE environment_id = ? AND job_id = ?
                )
                """,
                [env_id, env_id, job_id],
            ).fetchone()[0]
            queue_position = int(pos or 0) + 1 if row[1] == "queued" else None
            return jsonify(_row_to_status(row, queue_position=queue_position))

        active = conn.execute(
            """
            SELECT job_id, state, step, message, processed_accounts, total_accounts, progress_pct, result_json, error, created_at, updated_at
            FROM mule_jobs
            WHERE environment_id = ?
              AND job_type = 'feature_engineering'
              AND state IN ('running', 'queued')
            ORDER BY
              CASE WHEN state = 'running' THEN 0 ELSE 1 END,
              created_at ASC
            LIMIT 1
            """,
            [env_id],
        ).fetchone()
        if active:
            pos = None
            if active[1] == "queued":
                pos = conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM mule_jobs
                    WHERE environment_id = ? AND job_type = 'feature_engineering' AND state = 'queued' AND created_at < ?
                    """,
                    [env_id, active[9]],
                ).fetchone()[0]
                pos = int(pos or 0) + 1
            return jsonify(_row_to_status(active, queue_position=pos))

        last = conn.execute(
            """
            SELECT job_id, state, step, message, processed_accounts, total_accounts, progress_pct, result_json, error, created_at, updated_at
            FROM mule_jobs
            WHERE environment_id = ? AND job_type = 'feature_engineering'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [env_id],
        ).fetchone()
        if not last:
            return jsonify({"success": True, "state": "idle", "job_id": None})
        return jsonify(_row_to_status(last))
    finally:
        conn.close()


@platform_bp.route("/jobs/list", methods=["GET"])
def jobs_list():
    env_id = _env_id()
    job_type = request.args.get("job_type")
    limit = int(request.args.get("limit", 50))
    limit = max(1, min(limit, 200))
    conn, _paths = _conn(env_id)
    try:
        sql = """
            SELECT job_id, job_type, state, step, message, processed_accounts, total_accounts, progress_pct, error, created_at, updated_at
            FROM mule_jobs
            WHERE environment_id = ?
        """
        args = [env_id]
        if job_type:
            sql += " AND job_type = ?"
            args.append(job_type)
        sql += " ORDER BY created_at DESC LIMIT ?"
        args.append(limit)
        df = conn.execute(sql, args).df()
    finally:
        conn.close()
    rows = []
    for _, r in df.iterrows():
        rows.append(
            {
                "job_id": r.get("job_id"),
                "job_type": r.get("job_type"),
                "state": r.get("state"),
                "step": r.get("step"),
                "message": r.get("message"),
                "processed_accounts": int(r.get("processed_accounts") or 0),
                "total_accounts": int(r.get("total_accounts") or 0) if r.get("total_accounts") is not None else None,
                "progress_pct": float(r.get("progress_pct") or 0.0),
                "error": r.get("error"),
                "created_at": str(r.get("created_at")),
                "updated_at": str(r.get("updated_at")),
            }
        )
    return jsonify({"success": True, "jobs": rows})


def _ensure_env_feature_worker(env_id: str):
    with _env_job_workers_lock:
        t = _env_job_workers.get(env_id)
        if t and t.is_alive():
            return
        nt = threading.Thread(target=_feature_worker_loop, args=(env_id,), daemon=True)
        _env_job_workers[env_id] = nt
        nt.start()


def _update_job(env_id: str, job_id: str, state: str, step: str, message: str, processed: int | None = None, total: int | None = None, result: dict | None = None, error: str | None = None):
    progress_pct = None
    if processed is not None and total not in [None, 0]:
        progress_pct = float(processed) / float(total) * 100.0
    conn, _paths = _conn(env_id)
    try:
        conn.execute(
            """
            UPDATE mule_jobs
            SET state = ?, step = ?, message = ?,
                processed_accounts = COALESCE(?, processed_accounts),
                total_accounts = COALESCE(?, total_accounts),
                progress_pct = COALESCE(?, progress_pct),
                result_json = COALESCE(?, result_json),
                error = COALESCE(?, error),
                updated_at = CURRENT_TIMESTAMP
            WHERE environment_id = ? AND job_id = ?
            """,
            [
                state,
                step,
                message,
                processed,
                total,
                progress_pct,
                json.dumps(result, default=str) if result is not None else None,
                error,
                env_id,
                job_id,
            ],
        )
    finally:
        conn.close()


def _safe_feature_name(name: str) -> str:
    s = str(name or "").strip()
    out = []
    for ch in s:
        if ch.isalnum() or ch == "_":
            out.append(ch.lower())
        elif ch in [" ", "-", "."]:
            out.append("_")
    cleaned = "".join(out).strip("_")
    return cleaned or "custom_feature"


def _parse_window_days(spec: dict) -> int:
    v = spec.get("window_days")
    if v is not None:
        try:
            n = int(v)
            return max(1, min(3650, n))
        except Exception:
            pass
    w = str(spec.get("window") or "").strip().lower()
    if w.endswith("d"):
        try:
            return max(1, min(3650, int(w[:-1])))
        except Exception:
            return 30
    if w in ["7", "7d"]:
        return 7
    if w in ["30", "30d"]:
        return 30
    if w in ["90", "90d"]:
        return 90
    return 30


def _compute_custom_feature(tx: pd.DataFrame, acc: pd.DataFrame, spec: dict) -> tuple[str, pd.DataFrame]:
    feature_name = _safe_feature_name(spec.get("feature_name"))
    agg = str(spec.get("aggregation") or "sum").strip().lower()
    direction = str(spec.get("direction") or "both").strip().lower()
    window_days = _parse_window_days(spec)

    df = tx.copy()
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    ref_ts = df["timestamp"].max() if "timestamp" in df.columns and len(df) else None
    if ref_ts is None or pd.isna(ref_ts):
        ref_ts = datetime.now()
    start_ts = pd.Timestamp(ref_ts) - pd.Timedelta(days=int(window_days))
    if "timestamp" in df.columns:
        df = df[df["timestamp"] >= start_ts]

    if direction in ["inbound", "outbound"]:
        if "direction" in df.columns:
            df = df[df["direction"].astype(str).str.lower() == direction]
        else:
            df = df.iloc[0:0]

    account_ids = []
    if acc is not None and len(acc) and "account_id" in acc.columns:
        account_ids = acc["account_id"].dropna().astype(str).unique().tolist()
    elif df is not None and len(df) and "account_id" in df.columns:
        account_ids = df["account_id"].dropna().astype(str).unique().tolist()

    out = pd.DataFrame({"account_id": account_ids})
    if len(out) == 0:
        return feature_name, pd.DataFrame({"account_id": [], feature_name: []})

    if agg == "count":
        g = df.groupby("account_id").size()
        out[feature_name] = out["account_id"].map(g).fillna(0).astype(float)
        return feature_name, out

    if agg == "sum":
        s = pd.to_numeric(df.get("amount"), errors="coerce").fillna(0.0)
        g = s.groupby(df["account_id"]).sum()
        out[feature_name] = out["account_id"].map(g).fillna(0.0).astype(float)
        return feature_name, out

    if agg == "distinct_counterparty":
        if "counterparty_account" not in df.columns:
            out[feature_name] = 0.0
            return feature_name, out
        g = df.groupby("account_id")["counterparty_account"].nunique(dropna=True)
        out[feature_name] = out["account_id"].map(g).fillna(0).astype(float)
        return feature_name, out

    if agg == "out_in_ratio":
        df2 = tx.copy()
        if "timestamp" in df2.columns:
            df2["timestamp"] = pd.to_datetime(df2["timestamp"], errors="coerce")
            df2 = df2[df2["timestamp"] >= start_ts]
        dir_norm = df2["direction"].astype(str).str.lower() if "direction" in df2.columns else pd.Series([""] * len(df2))
        amt = pd.to_numeric(df2.get("amount"), errors="coerce").fillna(0.0)
        out_sum = amt[dir_norm == "outbound"].groupby(df2["account_id"][dir_norm == "outbound"]).sum()
        in_sum = amt[dir_norm == "inbound"].groupby(df2["account_id"][dir_norm == "inbound"]).sum()
        eps = 1e-9
        out[feature_name] = out["account_id"].map(out_sum).fillna(0.0) / (out["account_id"].map(in_sum).fillna(0.0) + eps)
        out[feature_name] = out[feature_name].astype(float)
        return feature_name, out

    if agg == "avg_time_gap_seconds":
        if "timestamp" not in df.columns or len(df) == 0:
            out[feature_name] = None
            return feature_name, out
        vals = {}
        for aid, g in df.sort_values("timestamp").groupby("account_id"):
            ts = pd.to_datetime(g["timestamp"], errors="coerce").dropna()
            if len(ts) < 2:
                vals[str(aid)] = None
                continue
            diffs = ts.diff().dt.total_seconds().dropna()
            vals[str(aid)] = float(diffs.mean()) if len(diffs) else None
        out[feature_name] = out["account_id"].map(vals)
        return feature_name, out

    out[feature_name] = None
    return feature_name, out


def _ensure_feature_column(conn: duckdb.DuckDBPyConnection, feature_name: str) -> None:
    cols = conn.execute("PRAGMA table_info('mule_account_features')").df()
    if len(cols) and feature_name in cols["name"].tolist():
        return
    conn.execute(f'ALTER TABLE mule_account_features ADD COLUMN "{feature_name}" DOUBLE')


def _upsert_custom_feature(conn: duckdb.DuckDBPyConnection, env_id: str, feature_name: str, values_df: pd.DataFrame) -> None:
    if values_df is None or len(values_df) == 0:
        return
    values_df = values_df.copy()
    values_df["account_id"] = values_df["account_id"].astype(str)

    conn.register("feat_ids", values_df[["account_id"]].drop_duplicates())
    conn.execute(
        """
        INSERT INTO mule_account_features(account_id, environment_id, computed_at)
        SELECT feat_ids.account_id, ?, CURRENT_TIMESTAMP
        FROM feat_ids
        WHERE NOT EXISTS (
            SELECT 1 FROM mule_account_features f WHERE f.environment_id = ? AND f.account_id = feat_ids.account_id
        )
        """,
        [env_id, env_id],
    )

    _ensure_feature_column(conn, feature_name)
    conn.register("feat_update", values_df[["account_id", feature_name]])
    conn.execute(
        f"""
        UPDATE mule_account_features AS f
        SET "{feature_name}" = feat_update."{feature_name}", computed_at = CURRENT_TIMESTAMP
        FROM feat_update
        WHERE f.environment_id = ? AND f.account_id = feat_update.account_id
        """,
        [env_id],
    )


def _persist_feature_metadata(conn: duckdb.DuckDBPyConnection, env_id: str, feature_name: str, meta: dict | None) -> None:
    if not isinstance(meta, dict):
        return
    typology = meta.get("typology")
    typology_description = meta.get("typology_description")
    business_description = meta.get("business_description")
    expected_risk_direction = meta.get("expected_risk_direction")
    owner = meta.get("owner")
    window = meta.get("window")
    data_source = meta.get("data_source")
    entity_level = meta.get("entity_level")
    aggregation = meta.get("aggregation")
    direction = meta.get("direction")
    transformation_sql = meta.get("transformation_sql")
    origin_module = meta.get("origin_module")
    built_by = meta.get("built_by")
    code_location = meta.get("code_location")

    if typology and str(typology).strip():
        conn.execute(
            """
            INSERT INTO mule_typology_registry(typology, environment_id, description)
            VALUES (?, ?, ?)
            """,
            [str(typology), env_id, str(typology_description) if typology_description is not None else None],
        )

    cols_df = conn.execute("PRAGMA table_info('mule_feature_metadata')").df()
    col_set = set(cols_df["name"].tolist()) if len(cols_df) else set()

    window_col = "window_spec" if "window_spec" in col_set else ('"window"' if "window" in col_set else None)
    cols = ["feature_name", "environment_id", "typology", "business_description", "expected_risk_direction", "owner"]
    if window_col:
        cols.append(window_col)
    cols += ["data_source"]
    vals = [
        str(feature_name),
        env_id,
        str(typology) if typology is not None else None,
        str(business_description) if business_description is not None else None,
        str(expected_risk_direction) if expected_risk_direction is not None else None,
        str(owner) if owner is not None else None,
        str(data_source) if data_source is not None else None,
    ]
    if window_col:
        vals.insert(6, str(window) if window is not None else None)

    extra = [
        ("entity_level", entity_level),
        ("aggregation", aggregation),
        ("direction", direction),
        ("transformation_sql", transformation_sql),
        ("origin_module", origin_module),
        ("built_by", built_by),
        ("code_location", code_location),
    ]
    for c, v in extra:
        if c in col_set:
            cols.append(c)
            vals.append(str(v) if v is not None else None)

    placeholders = ", ".join(["?"] * len(cols))
    cols_sql = ", ".join(cols)
    conn.execute(f"INSERT INTO mule_feature_metadata({cols_sql}) VALUES ({placeholders})", vals)


def _feature_worker_loop(env_id: str):
    while True:
        try:
            conn, _paths = _conn(env_id)
        except Exception:
            time.sleep(0.25)
            continue
        try:
            row = conn.execute(
                """
                SELECT job_id, payload_json
                FROM mule_jobs
                WHERE environment_id = ? AND job_type = 'feature_engineering' AND state = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                """,
                [env_id],
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return
        job_id = str(row[0])
        payload_json = row[1]
        payload = json.loads(payload_json) if payload_json else {}
        config = payload.get("config") or {}
        mode = payload.get("mode") or (config.get("run_type") if isinstance(config, dict) else None) or "run"
        custom_feature = payload.get("custom_feature") if isinstance(payload, dict) else None
        feature_metadata = payload.get("feature_metadata") if isinstance(payload, dict) else None
        triggered_by = None
        if isinstance(config, dict):
            triggered_by = config.get("triggered_by") or config.get("owner")
            config = {**config, "run_type": mode, "triggered_by": triggered_by}
        logs = []
        input_version = None
        conn0, _paths0 = _conn(env_id)
        try:
            input_version = _get_data_version(conn0, env_id)
        finally:
            conn0.close()

        try:
            if isinstance(custom_feature, dict) and (mode in ["custom_feature", "feature_build", "build"]):
                safe_name = _safe_feature_name(custom_feature.get("feature_name"))
                logs.append({"ts": datetime.now().isoformat(), "step": "load_data", "message": "Loading transactions/accounts"})
                _update_job(env_id, job_id, "running", "load_data", "Loading transactions/accounts")
                tx, acc = _load_tx_acc(env_id)
                total_accounts = int(acc["account_id"].nunique()) if acc is not None and len(acc) and "account_id" in acc.columns else int(tx["account_id"].nunique()) if len(tx) else 0
                started = datetime.now()
                logs.append({"ts": datetime.now().isoformat(), "step": "persist_metadata", "message": "Persisting feature metadata"})
                _update_job(env_id, job_id, "running", "persist_metadata", "Persisting feature metadata", processed=0, total=total_accounts)
                connm, _pathsm = _conn(env_id)
                try:
                    _persist_feature_metadata(connm, env_id, safe_name, feature_metadata)
                finally:
                    connm.close()

                logs.append({"ts": datetime.now().isoformat(), "step": "compute_feature", "message": f"Computing feature {safe_name}"})
                _update_job(env_id, job_id, "running", "compute_feature", f"Computing feature {safe_name}", processed=0, total=total_accounts)
                feature_name, values_df = _compute_custom_feature(tx, acc, {**custom_feature, "feature_name": safe_name})
                conn2, _paths2 = _conn(env_id)
                try:
                    _upsert_custom_feature(conn2, env_id, feature_name, values_df)
                    data_version = _get_data_version(conn2, env_id)
                    duration_seconds = int((datetime.now() - started).total_seconds())
                    summary = {
                        "accounts": int(len(values_df)),
                        "features": 1,
                        "duration_seconds": duration_seconds,
                        "failures": 0,
                        "status": "success",
                        "run_type": mode,
                        "triggered_by": triggered_by,
                        "input_version": input_version,
                        "output_version": data_version,
                        "custom_feature": feature_name,
                    }
                    meta = _persist_module_run(
                        conn2,
                        env_id,
                        "feature_engineering",
                        data_version=data_version,
                        config_version=_hash_jsonable(config or {}),
                        summary=summary,
                        result={
                            "config": config,
                            "job_id": job_id,
                            "run_type": mode,
                            "triggered_by": triggered_by,
                            "input_version": input_version,
                            "output_version": data_version,
                            "custom_feature": feature_name,
                            "logs": logs,
                        },
                    )
                    run_id = meta.get("run_id")
                    if run_id and feature_name in values_df.columns:
                        s = pd.to_numeric(values_df[feature_name], errors="coerce")
                        missing_pct = float(s.isna().mean()) if len(values_df) else 0.0
                        sn = s.dropna()
                        if len(sn):
                            conn2.execute(
                                """
                                INSERT INTO mule_feature_profiles(run_id, feature_name, environment_id, missing_pct, mean, std, min, p25, p50, p75, max)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                """,
                                [
                                    run_id,
                                    feature_name,
                                    env_id,
                                    missing_pct,
                                    float(sn.mean()),
                                    float(sn.std() or 0.0),
                                    float(sn.min()),
                                    float(sn.quantile(0.25)),
                                    float(sn.quantile(0.50)),
                                    float(sn.quantile(0.75)),
                                    float(sn.max()),
                                ],
                            )
                            counts, edges = np.histogram(sn, bins=10)
                            for i in range(len(counts)):
                                conn2.execute(
                                    """
                                    INSERT INTO mule_feature_bins(run_id, feature_name, environment_id, bin_start, bin_end, count)
                                    VALUES (?, ?, ?, ?, ?, ?)
                                    """,
                                    [run_id, feature_name, env_id, float(edges[i]), float(edges[i + 1]), int(counts[i])],
                                )
                finally:
                    conn2.close()

                _update_job(
                    env_id,
                    job_id,
                    "completed",
                    "completed",
                    "Completed",
                    processed=int(total_accounts),
                    total=int(total_accounts),
                    result={"accounts": int(total_accounts), "features": 1, "run_id": meta.get("run_id") if "meta" in locals() else None, "dataset_version": data_version, "feature_name": feature_name},
                )
                continue

            logs.append({"ts": datetime.now().isoformat(), "step": "load_data", "message": "Loading transactions/accounts"})
            _update_job(env_id, job_id, "running", "load_data", "Loading transactions/accounts")
            tx, acc = _load_tx_acc(env_id)
            started = datetime.now()
            total_accounts = int(tx["account_id"].nunique()) if len(tx) and "account_id" in tx.columns else 0
            logs.append({"ts": datetime.now().isoformat(), "step": "engineer_features", "message": f"Engineering features 0/{total_accounts}"})
            _update_job(env_id, job_id, "running", "engineer_features", f"Engineering features 0/{total_accounts}", processed=0, total=total_accounts)
            fe = FeatureEngineer()

            def _progress(done: int, total: int):
                elapsed = int((datetime.now() - started).total_seconds())
                _update_job(env_id, job_id, "running", "engineer_features", f"Engineering features {done}/{total} · {elapsed}s", processed=int(done), total=int(total))

            features_df = fe.engineer_all_features(tx, acc, progress_cb=_progress)
            logs.append({"ts": datetime.now().isoformat(), "step": "persist", "message": "Persisting features to DuckDB"})
            _update_job(env_id, job_id, "running", "persist", "Persisting features to DuckDB")
            conn2, _paths2 = _conn(env_id)
            try:
                _persist_features(conn2, env_id, features_df)
                data_version = _get_data_version(conn2, env_id)
                duration_seconds = int((datetime.now() - started).total_seconds())
                summary = {
                    "accounts": int(len(features_df)),
                    "features": int(len(features_df.columns)),
                    "duration_seconds": duration_seconds,
                    "failures": 0,
                    "status": "success",
                    "run_type": mode,
                    "triggered_by": triggered_by,
                    "input_version": input_version,
                    "output_version": data_version,
                }
                meta = _persist_module_run(
                    conn2,
                    env_id,
                    "feature_engineering",
                    data_version=data_version,
                    config_version=_hash_jsonable(config or {}),
                    summary=summary,
                    result={
                        "config": config,
                        "job_id": job_id,
                        "run_type": mode,
                        "triggered_by": triggered_by,
                        "input_version": input_version,
                        "output_version": data_version,
                        "logs": logs,
                    },
                )
                run_id = meta.get("run_id")
                if run_id:
                    numeric_cols = [
                        c for c in features_df.columns
                        if c not in ["account_id", "environment_id", "computed_at"]
                        and pd.api.types.is_numeric_dtype(features_df[c])
                    ]
                    for c in numeric_cols:
                        s = pd.to_numeric(features_df[c], errors="coerce")
                        missing_pct = float(s.isna().mean())
                        sn = s.dropna()
                        if len(sn) == 0:
                            continue
                        conn2.execute(
                            """
                            INSERT INTO mule_feature_profiles(run_id, feature_name, environment_id, missing_pct, mean, std, min, p25, p50, p75, max)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            [
                                run_id,
                                c,
                                env_id,
                                missing_pct,
                                float(sn.mean()),
                                float(sn.std() or 0.0),
                                float(sn.min()),
                                float(sn.quantile(0.25)),
                                float(sn.quantile(0.50)),
                                float(sn.quantile(0.75)),
                                float(sn.max()),
                            ],
                        )
                        counts, edges = np.histogram(sn, bins=10)
                        for i in range(len(counts)):
                            conn2.execute(
                                """
                                INSERT INTO mule_feature_bins(run_id, feature_name, environment_id, bin_start, bin_end, count)
                                VALUES (?, ?, ?, ?, ?, ?)
                                """,
                                [run_id, c, env_id, float(edges[i]), float(edges[i + 1]), int(counts[i])],
                            )
            finally:
                conn2.close()
            example_feature = None
            try:
                preferred = ["inbound_amount_24h", "funds_exit_within_1h_flag", "shared_device_flag"]
                for p in preferred:
                    if p in features_df.columns:
                        example_feature = p
                        break
                if example_feature is None:
                    for c in list(features_df.columns):
                        if c not in ["account_id", "environment_id", "computed_at"]:
                            example_feature = str(c)
                            break
            except Exception:
                example_feature = None
            _update_job(
                env_id,
                job_id,
                "completed",
                "completed",
                "Completed",
                processed=int(len(features_df)),
                total=int(len(features_df)),
                result={
                    "accounts": int(len(features_df)),
                    "features": int(len(features_df.columns)),
                    "run_id": meta.get("run_id") if "meta" in locals() else None,
                    "dataset_version": data_version,
                    "feature_name": example_feature,
                },
            )
        except Exception as e:
            logs.append({"ts": datetime.now().isoformat(), "step": "failed", "message": str(e)})
            conn3, _paths3 = _conn(env_id)
            try:
                fail_summary = {
                    "accounts": 0,
                    "features": 0,
                    "duration_seconds": None,
                    "failures": 1,
                    "status": "failed",
                    "run_type": mode,
                    "triggered_by": triggered_by,
                    "input_version": input_version,
                    "output_version": None,
                    "error": str(e),
                }
                _persist_module_run(
                    conn3,
                    env_id,
                    "feature_engineering",
                    data_version=input_version,
                    config_version=_hash_jsonable(config or {}),
                    summary=fail_summary,
                    result={
                        "config": config,
                        "job_id": job_id,
                        "run_type": mode,
                        "triggered_by": triggered_by,
                        "input_version": input_version,
                        "output_version": None,
                        "logs": logs,
                        "error": str(e),
                    },
                )
            finally:
                conn3.close()
            _update_job(env_id, job_id, "failed", "failed", "Failed", error=str(e))


@platform_bp.route("/features/accounts", methods=["GET"])
def get_account_features():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    limit = request.args.get("limit", 500, type=int)
    limit = max(1, min(limit, 5000))

    conn, _paths = _conn(env_id)
    try:
        feature_count = int(
            conn.execute("SELECT COUNT(*) FROM mule_account_features WHERE environment_id = ?", [env_id]).fetchone()[0]
        )
        if feature_count == 0:
            return jsonify({"success": False, "error": "No engineered features found. Run Feature Engineering first."}), 400

        df = conn.execute(
            """
            SELECT f.*, a.customer_id, a.customer_type, a.risk_rating, a.occupation, a.expected_turnover, a.is_mule
            FROM mule_account_features f
            LEFT JOIN mule_accounts a
              ON a.environment_id = f.environment_id AND a.account_id = f.account_id
            WHERE f.environment_id = ?
            ORDER BY f.account_id
            LIMIT ?
            """,
            [env_id, limit],
        ).df()
    finally:
        conn.close()

    return jsonify({"success": True, "accounts": df.to_dict("records")})


@platform_bp.route("/features/list", methods=["GET"])
def list_features():
    env_id = _env_id()
    conn, _paths = _conn(env_id)
    try:
        cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
    finally:
        conn.close()
    cols = []
    for _, r in cols_df.iterrows():
        name = r.get("name")
        if name in ["account_id", "environment_id", "computed_at"]:
            continue
        cols.append({"name": name, "type": r.get("type")})
    return jsonify({"success": True, "features": cols})


@platform_bp.route("/features/distribution", methods=["GET"])
def feature_distribution():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    feature = request.args.get("feature")
    bins = request.args.get("bins", 20, type=int)
    bins = max(5, min(bins, 60))
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400

    conn, _paths = _conn(env_id)
    try:
        cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
        if feature not in cols_df["name"].tolist():
            return jsonify({"success": False, "error": "Unknown feature"}), 400

        col_type = (
            cols_df.loc[cols_df["name"] == feature, "type"].iloc[0]
            if len(cols_df.loc[cols_df["name"] == feature]) > 0
            else ""
        )
        col_type_u = str(col_type or "").upper()
        numeric_types = ["DOUBLE", "FLOAT", "DECIMAL", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "HUGEINT", "UBIGINT", "UINTEGER", "USMALLINT", "UTINYINT"]
        is_numeric = any(t in col_type_u for t in numeric_types)

        if not is_numeric:
            stats = conn.execute(
                f"""
                SELECT
                  COUNT(*) AS n,
                  SUM(CASE WHEN "{feature}" IS NULL THEN 1 ELSE 0 END) AS nulls,
                  COUNT(DISTINCT "{feature}") AS unique_v
                FROM mule_account_features
                WHERE environment_id = ?
                """,
                [env_id],
            ).fetchone()
            n, nulls, unique_v = stats
            rows = conn.execute(
                f"""
                SELECT
                  CAST("{feature}" AS VARCHAR) AS value,
                  COUNT(*) AS c
                FROM mule_account_features
                WHERE environment_id = ? AND "{feature}" IS NOT NULL
                GROUP BY value
                ORDER BY c DESC, value
                LIMIT 50
                """,
                [env_id],
            ).fetchall()
            return jsonify(
                {
                    "success": True,
                    "feature": feature,
                    "mode": "categorical",
                    "stats": {"count": int(n or 0), "nulls": int(nulls or 0), "unique": int(unique_v or 0)},
                    "categories": [{"value": v, "count": int(c)} for v, c in rows],
                }
            )

        stats = conn.execute(
            f"""
            SELECT
              COUNT(*) AS n,
              SUM(CASE WHEN "{feature}" IS NULL THEN 1 ELSE 0 END) AS nulls,
              MIN(TRY_CAST("{feature}" AS DOUBLE)) AS min_v,
              MAX(TRY_CAST("{feature}" AS DOUBLE)) AS max_v,
              AVG(TRY_CAST("{feature}" AS DOUBLE)) AS avg_v
            FROM mule_account_features
            WHERE environment_id = ?
            """,
            [env_id],
        ).fetchone()
        n, nulls, min_v, max_v, avg_v = stats
        if min_v is None or max_v is None or float(min_v) == float(max_v):
            non_null = int((int(n or 0) - int(nulls or 0)) if n is not None and nulls is not None else 0)
            return jsonify(
                {
                    "success": True,
                    "feature": feature,
                    "mode": "numeric",
                    "stats": {
                        "count": int(n or 0),
                        "nulls": int(nulls or 0),
                        "min": float(min_v) if min_v is not None else None,
                        "max": float(max_v) if max_v is not None else None,
                        "avg": float(avg_v) if avg_v is not None else 0.0,
                    },
                    "bins": (
                        [
                            {
                                "bin": 0,
                                "start": float(min_v) if min_v is not None else 0.0,
                                "end": float(max_v) if max_v is not None else 0.0,
                                "count": non_null,
                            }
                        ]
                        if non_null > 0
                        else []
                    ),
                }
            )

        width = float(max_v - min_v) / float(bins)
        rows = conn.execute(
            f"""
            SELECT
              FLOOR((TRY_CAST("{feature}" AS DOUBLE) - ?) / ?) AS bin_idx,
              COUNT(*) AS bin_count
            FROM mule_account_features
            WHERE environment_id = ? AND TRY_CAST("{feature}" AS DOUBLE) IS NOT NULL
            GROUP BY bin_idx
            ORDER BY bin_idx
            """,
            [float(min_v), width, env_id],
        ).fetchall()
    finally:
        conn.close()

    out_bins = []
    for bin_idx, bin_count in rows:
        b = int(bin_idx)
        start = float(min_v) + b * width
        end = start + width
        out_bins.append({"bin": b, "start": start, "end": end, "count": int(bin_count)})

    return jsonify(
        {
            "success": True,
            "feature": feature,
            "mode": "numeric",
            "stats": {"count": int(n or 0), "nulls": int(nulls or 0), "min": float(min_v), "max": float(max_v), "avg": float(avg_v or 0)},
            "bins": out_bins,
        }
    )


@platform_bp.route("/ml/train-model", methods=["POST"])
def train_model():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    payload = request.get_json(silent=True) or {}
    model_type = payload.get("model_type", "xgboost")
    test_size = float(payload.get("test_size", 0.2))
    use_smote = bool(payload.get("use_smote", True))
    model_params = payload.get("hyperparams") or payload.get("model_params") or {}
    cv_folds = int(payload.get("cv_folds", 5))
    random_state = int(payload.get("random_state", 42))

    conn, paths = _conn(env_id)
    try:
        feature_count = int(conn.execute("SELECT COUNT(*) FROM mule_account_features WHERE environment_id = ?", [env_id]).fetchone()[0])
        if feature_count == 0:
            return jsonify({"success": False, "error": "No engineered features found. Run Feature Engineering first."}), 400
        features_df = conn.execute(
            """
            SELECT f.*, a.is_mule
            FROM mule_account_features f
            JOIN mule_accounts a
              ON a.environment_id = f.environment_id AND a.account_id = f.account_id
            WHERE f.environment_id = ?
            """,
            [env_id],
        ).df()
    finally:
        conn.close()

    model_dir = str(paths["models_dir"])
    pipeline = ModelPipeline(model_dir=model_dir)
    features_df["is_mule"] = pd.to_numeric(features_df.get("is_mule"), errors="coerce").fillna(0).astype(int)
    if model_type in ["xgboost", "randomforest"] and features_df["is_mule"].nunique() < 2:
        return jsonify({"success": False, "error": "Training needs both mule and non-mule labels in accounts CSV. Use isolation_forest or provide is_mule labels."}), 400
    try:
        result = pipeline.train(
            data=features_df,
            model_type=model_type,
            test_size=test_size,
            use_smote=use_smote,
            model_params=model_params,
            cv_folds=cv_folds,
            random_state=random_state,
        )
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

    conn, _paths2 = _conn(env_id)
    try:
        conn.execute(
            """
            INSERT INTO mule_models
            VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, 'READY', false, ?)
            """,
            [
                result["model_version"],
                str((paths["models_dir"] / f"{result['model_version']}.pkl")),
                result["model_type"],
                int(len(features_df)),
                int(len(result["features_used"])),
                float(result["metrics"].get("roc_auc", 0)),
                float(result["metrics"].get("recall", 0)),
                float(result["metrics"].get("precision", 0)),
                float(result["metrics"].get("f1_score", 0)),
                env_id,
            ],
        )
    finally:
        conn.close()

    return jsonify({"success": True, "model_version": result["model_version"], "metrics": result["metrics"], "features_used": result["features_used"]})


@platform_bp.route("/ml/models/list", methods=["GET"])
def list_models():
    env_id = _env_id()
    conn, paths = _conn(env_id)
    try:
        df = conn.execute(
            """
            SELECT model_version, trained_at, algorithm, training_samples, feature_count,
                   auc, recall, precision, f1, status, active
            FROM mule_models
            WHERE environment_id = ?
            ORDER BY trained_at DESC
            """,
            [env_id],
        ).df()
    finally:
        conn.close()
    models = df.to_dict("records")
    models_dir = Path(str(paths["models_dir"]))
    for m in models:
        mv = m.get("model_version")
        if not mv:
            continue
        p = models_dir / f"{mv}.pkl"
        if not p.exists():
            continue
        try:
            with open(p, "rb") as f:
                d = pickle.load(f)
            meta = (d or {}).get("metadata", {}) or {}
            metrics = meta.get("metrics", {}) or {}
            m["accuracy"] = float(metrics.get("accuracy", 0) or 0)
            m["hyperparams"] = meta.get("model_params") or {}
            m["training_config"] = meta.get("training_config") or {}
        except Exception:
            continue
    return jsonify({"success": True, "models": models})


@platform_bp.route("/ml/models/delete", methods=["POST"])
def delete_model():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    model_version = payload.get("model_version") or request.args.get("model_version")
    if not model_version:
        return jsonify({"success": False, "error": "model_version is required"}), 400

    conn, paths = _conn(env_id)
    try:
        conn.execute(
            """
            UPDATE mule_models
            SET active = FALSE
            WHERE environment_id = ? AND model_version = ?
            """,
            [env_id, model_version],
        )
        conn.execute(
            "DELETE FROM mule_ml_model_approvals WHERE environment_id = ? AND model_version = ?",
            [env_id, model_version],
        )
        conn.execute(
            "DELETE FROM mule_models WHERE environment_id = ? AND model_version = ?",
            [env_id, model_version],
        )
    finally:
        conn.close()

    try:
        p = Path(str(paths["models_dir"])) / f"{model_version}.pkl"
        if p.exists():
            p.unlink()
    except Exception:
        pass

    return jsonify({"success": True, "model_version": model_version})


@platform_bp.route("/ml/infer-model", methods=["POST"])
def infer_model():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    payload = request.get_json(silent=True) or {}
    model_version = payload.get("model_version")
    force = bool(payload.get("force", False))

    conn, paths = _conn(env_id)
    try:
        data_version = _get_data_version(conn, env_id)
        feature_count = int(conn.execute("SELECT COUNT(*) FROM mule_account_features WHERE environment_id = ?", [env_id]).fetchone()[0])
        if feature_count == 0:
            return jsonify({"success": False, "error": "No engineered features found. Run Feature Engineering first."}), 400
        features_df = conn.execute(
            "SELECT * EXCLUDE(environment_id, computed_at) FROM mule_account_features WHERE environment_id = ?",
            [env_id],
        ).df()
        if model_version is None:
            row = conn.execute(
                "SELECT model_version FROM mule_models WHERE environment_id = ? ORDER BY trained_at DESC LIMIT 1",
                [env_id],
            ).fetchone()
            model_version = row[0] if row else None
    finally:
        conn.close()

    if not model_version:
        return jsonify({"success": False, "error": "No trained model found. Train a model first."}), 400

    config_version = str(model_version)
    if not force:
        conn, _paths2 = _conn(env_id)
        try:
            last = _load_last_module_run(conn, env_id, "ml_inference")
        finally:
            conn.close()
        if last and last.get("data_version") == data_version and last.get("config_version") == config_version:
            cached = last.get("result") or {}
            return jsonify({"success": True, "cached": True, "model_version": model_version, **cached})

    engine = InferenceEngine(model_store_path=str(paths["models_dir"]))
    engine.load_model(model_version)
    probs, results = engine.predict(model=None, data=features_df, model_version=model_version)

    out = []
    for idx, (_, row) in enumerate(features_df.iterrows()):
        out.append({"account_id": row.get("account_id"), "ml_score": float(probs[idx]) if idx < len(probs) else 0.0})

    conn, _paths2 = _conn(env_id)
    try:
        conn.execute("DELETE FROM mule_ml_scores WHERE environment_id = ?", [env_id])
        conn.register("s", pd.DataFrame(out))
        conn.execute(
            """
            INSERT INTO mule_ml_scores
            SELECT account_id, ml_score, ?, ?, CURRENT_TIMESTAMP
            FROM s
            """,
            [model_version, env_id],
        )
        preds = out
        high = sum(1 for p in preds if float(p.get("ml_score", 0) or 0) >= 0.7)
        med = sum(1 for p in preds if 0.4 <= float(p.get("ml_score", 0) or 0) < 0.7)
        low = max(0, len(preds) - high - med)
        summary = {
            "model_version": model_version,
            "total_accounts": int(len(preds)),
            "high_risk_count": int(high),
            "medium_risk_count": int(med),
            "low_risk_count": int(low),
            "thresholds": {"high": 0.7, "medium": 0.4},
        }
        result_payload = {"predictions": preds, "summary": results.get("summary"), "run_summary": summary}
        meta = _persist_module_run(
            conn,
            env_id,
            "ml_inference",
            data_version=data_version,
            config_version=config_version,
            summary=summary,
            result={"model_version": model_version, **result_payload},
        )
    finally:
        conn.close()

    return jsonify({"success": True, "cached": False, "model_version": model_version, "predictions": out, "summary": results.get("summary"), "run_summary": summary, "run_meta": meta})


@platform_bp.route("/rules/config", methods=["GET", "POST"])
def rules_config():
    env_id = _env_id()
    conn, _paths = _conn(env_id)
    try:
        if request.method == "GET":
            row = conn.execute("SELECT config_json FROM mule_rule_config WHERE environment_id = ?", [env_id]).fetchone()
            if not row or not row[0]:
                return jsonify({"success": True, "config": RuleEngine.default_config()})
            return jsonify({"success": True, "config": json.loads(row[0])})

        payload = request.get_json() or {}
        cfg = payload.get("config") if isinstance(payload.get("config"), dict) else payload
        if not isinstance(cfg, dict):
            cfg = {}
        cfg = RuleEngine(config=cfg).config
        conn.execute(
            """
            INSERT INTO mule_rule_config(environment_id, config_json, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(environment_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
            """,
            [env_id, json.dumps(cfg)],
        )
        return jsonify({"success": True, "config": cfg})
    finally:
        conn.close()


@platform_bp.route("/rules/run", methods=["POST"])
def run_rules():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    payload = request.get_json(silent=True) or {}
    force = bool(payload.get("force", False))

    tx, _acc = _load_tx_acc(env_id)
    conn, _paths = _conn(env_id)
    try:
        data_version = _get_data_version(conn, env_id)
        row = conn.execute("SELECT config_json FROM mule_rule_config WHERE environment_id = ?", [env_id]).fetchone()
        cfg = json.loads(row[0]) if row and row[0] else RuleEngine.default_config()
        config_version = _hash_jsonable(cfg)
        if not force:
            last = _load_last_module_run(conn, env_id, "rules")
            if last and last.get("data_version") == data_version and last.get("config_version") == config_version:
                cached = last.get("result") or {}
                return jsonify({"success": True, "cached": True, **cached})
    finally:
        conn.close()

    engine = RuleEngine(config=cfg)
    results = engine.apply_all_rules(tx)
    out = []
    for account_id, r in results.items():
        out.append(
            {
                "account_id": account_id,
                "risk_score": float(r.get("risk_score", 0)),
                "risk_category": r.get("risk_category"),
                "triggered_rules": r.get("triggered_rules", []),
                "triggered_by_category": r.get("triggered_by_category", {}),
                "rule_scores": r.get("rule_scores", {}),
                "rule_details": r.get("rule_details", {}),
            }
        )
    out.sort(key=lambda x: x["risk_score"], reverse=True)
    counts = {"High": 0, "Medium": 0, "Low": 0}
    rule_freq = {}
    rule_freq_by_category = {"velocity": {}, "recency": {}, "circularity": {}, "device": {}}
    for r in out:
        counts[str(r.get("risk_category") or "Low")] = counts.get(str(r.get("risk_category") or "Low"), 0) + 1
        for rn in (r.get("triggered_rules") or []):
            rule_freq[rn] = rule_freq.get(rn, 0) + 1
        tbc = r.get("triggered_by_category") or {}
        for cat, names in tbc.items():
            if cat not in rule_freq_by_category:
                continue
            for rn in (names or []):
                rule_freq_by_category[cat][rn] = rule_freq_by_category[cat].get(rn, 0) + 1
    top_rules = sorted(rule_freq.items(), key=lambda x: x[1], reverse=True)[:10]
    top_by_cat = {}
    for cat, freq in rule_freq_by_category.items():
        top_by_cat[cat] = [{"rule": k, "count": int(v)} for k, v in sorted(freq.items(), key=lambda x: x[1], reverse=True)[:10]]
    summary = {
        "total_accounts": int(len(out)),
        "high_risk_count": int(counts.get("High", 0)),
        "medium_risk_count": int(counts.get("Medium", 0)),
        "low_risk_count": int(counts.get("Low", 0)),
        "top_triggered_rules": [{"rule": k, "count": int(v)} for k, v in top_rules],
        "top_triggered_rules_by_category": top_by_cat,
        "rule_weights": (cfg or {}).get("rule_weights", {}),
        "rules": (cfg or {}).get("rules", {}),
    }
    result_payload = {"accounts": out, "summary": summary}
    conn, _paths2 = _conn(env_id)
    try:
        meta = _persist_module_run(
            conn,
            env_id,
            "rules",
            data_version=data_version,
            config_version=config_version,
            summary=summary,
            result=result_payload,
        )
    finally:
        conn.close()
    return jsonify({"success": True, "cached": False, **result_payload, "run_meta": meta})


@platform_bp.route("/network/graph", methods=["GET"])
def network_graph():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    tx, _acc = _load_tx_acc(env_id)
    analyzer = NetworkAnalyzer()
    analyzer._build_transaction_graph(tx)

    nodes = []
    for node_id, attrs in analyzer.transaction_graph.nodes(data=True):
        nodes.append({"id": str(node_id), "type": attrs.get("type", "account")})

    links = []
    for src, dst, attrs in analyzer.transaction_graph.edges(data=True):
        links.append(
            {
                "source": str(src),
                "target": str(dst),
                "amount": float(attrs.get("amount", 0) or 0),
            }
        )

    return jsonify({"success": True, "nodes": nodes, "links": links})


@platform_bp.route("/network/analyze", methods=["POST"])
def network_analyze():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    payload = request.get_json() or {}
    force = bool(payload.get("force", False))

    tx, _acc = _load_tx_acc(env_id)
    conn, _paths = _conn(env_id)
    try:
        data_version = _get_data_version(conn, env_id)
        config_version = "v1"
        if not force:
            last = _load_last_module_run(conn, env_id, "network_analysis")
            if last and last.get("data_version") == data_version and last.get("config_version") == config_version:
                cached = last.get("result") or {}
                return jsonify({"success": True, "cached": True, **cached})
    finally:
        conn.close()

    analyzer = NetworkAnalyzer()
    metrics = analyzer.analyze_transaction_network(tx)

    G = analyzer.transaction_graph
    try:
        import networkx as nx
        density = float(nx.density(G)) if G is not None and len(G) > 1 else 0.0
    except Exception:
        density = 0.0

    nodes = []
    for node_id, attrs in G.nodes(data=True):
        m = metrics.get(node_id) or metrics.get(str(node_id)) or {}
        nrs = float(m.get("network_risk_score", 0) or 0)
        if nrs >= 0.7:
            risk_level = "HIGH"
        elif nrs >= 0.4:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"
        nodes.append(
            {
                "id": str(node_id),
                "type": attrs.get("type", "account"),
                "network_risk_score": nrs,
                "risk_level": risk_level,
                "pagerank": float(m.get("pagerank", 0) or 0),
                "out_degree": int(m.get("out_degree", 0) or 0),
                "in_degree": int(m.get("in_degree", 0) or 0),
                "community_id": int(m.get("community_id", -1) or -1),
                "is_hub": bool(m.get("is_hub", False)),
                "is_bridge": bool(m.get("is_bridge", False)),
                "transaction_patterns": m.get("transaction_patterns", {}),
            }
        )
    links = [
        {"source": str(src), "target": str(dst), "amount": float(attrs.get("amount", 0) or 0)}
        for src, dst, attrs in G.edges(data=True)
    ]

    top_by_risk = []
    for account_id, m in metrics.items():
        top_by_risk.append(
            {
                "account_id": str(account_id),
                "network_risk_score": float(m.get("network_risk_score", 0) or 0),
                "pagerank": float(m.get("pagerank", 0) or 0),
                "out_degree": int(m.get("out_degree", 0) or 0),
                "in_degree": int(m.get("in_degree", 0) or 0),
                "community_id": int(m.get("community_id", -1) or -1),
                "patterns": m.get("transaction_patterns", {}),
                "is_hub": bool(m.get("is_hub", False)),
                "is_bridge": bool(m.get("is_bridge", False)),
            }
        )
    top_by_risk.sort(key=lambda x: x["network_risk_score"], reverse=True)

    reciprocal_pairs = 0
    try:
        edge_set = set((str(u), str(v)) for u, v in G.edges())
        seen = set()
        for u, v in edge_set:
            if (v, u) in edge_set and (v, u) not in seen:
                reciprocal_pairs += 1
                seen.add((u, v))
    except Exception:
        reciprocal_pairs = 0

    pattern_counts = {"fan_in": 0, "fan_out": 0, "mixer": 0, "isolated": 0, "hub": 0}
    for m in metrics.values():
        p = m.get("transaction_patterns") or {}
        for k in pattern_counts.keys():
            pattern_counts[k] += int(p.get(k, 0) or 0)

    summary = {
        "graph": {"nodes": int(G.number_of_nodes()), "edges": int(G.number_of_edges()), "density": float(density)},
        "reciprocal_pairs": int(reciprocal_pairs),
        "pattern_counts": pattern_counts,
        "top_accounts": top_by_risk[:50],
        "methodology": [
            "Build directed graph from outbound transfers (account -> counterparty).",
            "Compute centrality (degree, betweenness, pagerank), clustering, and communities when available.",
            "Flag hubs (high out-degree) and bridges (high betweenness) as potential mule coordinators.",
        ],
    }
    result_payload = {"nodes": nodes, "links": links, "summary": summary}
    conn, _paths2 = _conn(env_id)
    try:
        meta = _persist_module_run(
            conn,
            env_id,
            "network_analysis",
            data_version=data_version,
            config_version=config_version,
            summary=summary,
            result=result_payload,
        )
    finally:
        conn.close()

    return jsonify({"success": True, "cached": False, **result_payload, "run_meta": meta})


@platform_bp.route("/risk/hybrid/run", methods=["POST"])
def run_hybrid():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    payload = request.get_json() or {}
    use_trained_model = bool(payload.get("use_trained_model", True))
    model_version = payload.get("model_version")
    force = bool(payload.get("force", False))
    weights_payload = payload.get("weights") or {}
    ml_w = weights_payload.get("ml_weight", payload.get("ml_weight", 0.40))
    rule_w = weights_payload.get("rule_weight", payload.get("rule_weight", 0.30))
    net_w = weights_payload.get("network_weight", payload.get("network_weight", 0.30))

    def _norm(v, default):
        try:
            x = float(v)
            if x > 1.0:
                x = x / 100.0
            if x < 0:
                x = 0.0
            return x
        except Exception:
            return float(default)

    score_weights = {
        "ml_weight": _norm(ml_w, 0.40),
        "rule_weight": _norm(rule_w, 0.30),
        "network_weight": _norm(net_w, 0.30),
    }
    total_w = float(score_weights["ml_weight"] + score_weights["rule_weight"] + score_weights["network_weight"])
    if total_w > 0:
        score_weights = {k: float(v) / total_w for k, v in score_weights.items()}

    conn, paths = _conn(env_id)
    try:
        data_version = _get_data_version(conn, env_id)
        feature_count = int(conn.execute("SELECT COUNT(*) FROM mule_account_features WHERE environment_id = ?", [env_id]).fetchone()[0])
        if feature_count == 0:
            return jsonify({"success": False, "error": "No engineered features found. Run Feature Engineering first."}), 400
        features_df = conn.execute(
            "SELECT * EXCLUDE(environment_id, computed_at) FROM mule_account_features WHERE environment_id = ?",
            [env_id],
        ).df()
        row = conn.execute("SELECT config_json FROM mule_rule_config WHERE environment_id = ?", [env_id]).fetchone()
        rule_cfg = json.loads(row[0]) if row and row[0] else RuleEngine.default_config()
        rule_cfg_hash = _hash_jsonable(rule_cfg)
        if model_version is None:
            r = conn.execute(
                "SELECT model_version FROM mule_models WHERE environment_id = ? ORDER BY trained_at DESC LIMIT 1",
                [env_id],
            ).fetchone()
            model_version = r[0] if r else None
    finally:
        conn.close()

    started_at = datetime.now()
    if use_trained_model and not model_version:
        use_trained_model = False

    hybrid_cfg = {"model_version": model_version, "weights": score_weights, "rule_cfg_hash": rule_cfg_hash}
    hybrid_config_version = _hash_jsonable(hybrid_cfg)
    if not force:
        conn, _p = _conn(env_id)
        try:
            last = _load_last_module_run(conn, env_id, "hybrid")
        finally:
            conn.close()
        if last and last.get("data_version") == data_version and last.get("config_version") == hybrid_config_version:
            cached = last.get("result") or {}
            return jsonify({"success": True, "cached": True, **cached})

    tx, _acc = _load_tx_acc(env_id)

    ml_preds = None
    if model_version:
        conn, _p = _conn(env_id)
        try:
            last_ml = _load_last_module_run(conn, env_id, "ml_inference")
        finally:
            conn.close()
        if last_ml and last_ml.get("data_version") == data_version and last_ml.get("config_version") == str(model_version):
            ml_preds = (last_ml.get("result") or {}).get("predictions")

    if ml_preds is None and model_version:
        engine = InferenceEngine(model_store_path=str(paths["models_dir"]))
        engine.load_model(model_version)
        probs, _r = engine.predict(model=None, data=features_df, model_version=model_version)
        ml_preds = []
        for idx, (_, row) in enumerate(features_df.iterrows()):
            ml_preds.append({"account_id": row.get("account_id"), "ml_score": float(probs[idx]) if idx < len(probs) else 0.0})

    rules_payload = None
    conn, _p = _conn(env_id)
    try:
        last_rules = _load_last_module_run(conn, env_id, "rules")
    finally:
        conn.close()
    if last_rules and last_rules.get("data_version") == data_version and last_rules.get("config_version") == rule_cfg_hash:
        rules_payload = (last_rules.get("result") or {}).get("accounts")
    if rules_payload is None:
        engine = RuleEngine(config=rule_cfg)
        rules_map = engine.apply_all_rules(tx)
        rules_payload = []
        for account_id, r in rules_map.items():
            rules_payload.append({"account_id": account_id, "risk_score": float(r.get("risk_score", 0) or 0)})

    flow_by = {}
    try:
        analyzer = MoneyFlowAnalyzer(MoneyFlowConfig(window_hours=48.0, max_hops=4, amount_tolerance=0.12))
        flow_edges, _cm = analyzer.build_directed_edges(tx)
        for aid in features_df["account_id"].dropna().astype(str).unique().tolist():
            p = analyzer.compute_account_patterns(flow_edges, aid)
            flow_by[str(aid)] = float(p.get("flow_score", 0.0) or 0.0)
    except Exception:
        flow_by = {}

    ml_by = {str(p.get("account_id")): float(p.get("ml_score", 0) or 0) for p in (ml_preds or [])}
    rule_by = {str(p.get("account_id")): float(p.get("risk_score", 0) or 0) for p in (rules_payload or [])}

    all_ids = set()
    for x in [ml_by.keys(), rule_by.keys(), flow_by.keys()]:
        all_ids.update(list(x))

    accounts_out = []
    for account_id in all_ids:
        ml_s = float(ml_by.get(account_id, 0.0))
        rule_s = float(rule_by.get(account_id, 0.0))
        flow_s = float(flow_by.get(account_id, 0.0))
        hybrid_score = (ml_s * score_weights["ml_weight"]) + (rule_s * score_weights["rule_weight"]) + (flow_s * score_weights["network_weight"])
        if hybrid_score >= 0.7:
            risk_level = "HIGH"
        elif hybrid_score >= 0.4:
            risk_level = "MEDIUM"
        else:
            risk_level = "LOW"
        confidence = float(min(1.0, abs(hybrid_score - 0.5) * 2.0))
        accounts_out.append(
            {
                "account_id": account_id,
                "hybrid_score": float(hybrid_score),
                "risk_level": risk_level,
                "ml_score": float(ml_s),
                "rule_score": float(rule_s),
                "network_risk": float(flow_s),
                "money_flow_score": float(flow_s),
                "confidence": confidence,
                "decision_logic": json.dumps(
                    {
                        "weights": {"ml_weight": score_weights["ml_weight"], "rule_weight": score_weights["rule_weight"], "money_flow_weight": score_weights["network_weight"]},
                        "components": {"ml": ml_s, "rules": rule_s, "money_flow": flow_s},
                        "formula": "hybrid = 0.4*ml + 0.3*rules + 0.3*money_flow (weights normalized if overridden)",
                    }
                ),
            }
        )
    accounts_out.sort(key=lambda x: x["hybrid_score"], reverse=True)

    scores = [float(a.get("hybrid_score", 0) or 0) for a in accounts_out]
    summary = {
        "total_accounts": int(len(accounts_out)),
        "high_risk_count": int(sum(1 for a in accounts_out if a["risk_level"] == "HIGH")),
        "medium_risk_count": int(sum(1 for a in accounts_out if a["risk_level"] == "MEDIUM")),
        "low_risk_count": int(sum(1 for a in accounts_out if a["risk_level"] == "LOW")),
        "average_risk_score": float(np.mean(scores)) if scores else 0.0,
        "max_risk_score": float(np.max(scores)) if scores else 0.0,
        "weights": dict(score_weights),
        "model_version": model_version,
        "methodology": [
            "Reuse latest ML inference and rule engine outputs when available.",
            "Compute money flow score from time-ordered transaction paths, circular chains, bursts, and pass-through.",
            "Compute hybrid score = w_ml*ml + w_rules*rules + w_money_flow*money_flow.",
            "Map hybrid score to risk level using fixed thresholds (0.7/0.4).",
        ],
    }

    run_ts = datetime.now().isoformat()
    rows = []
    for a in accounts_out:
        rows.append(
            {
                "id": int(uuid.uuid4().int % (10**9)),
                "account_id": a.get("account_id"),
                "hybrid_score": float(a.get("hybrid_score", 0)),
                "risk_level": a.get("risk_level"),
                "ml_risk_score": float(a.get("ml_score")) if a.get("ml_score") is not None else None,
                "pattern_risk_score": float(a.get("rule_score")) if a.get("rule_score") is not None else None,
                "confidence": float(a.get("confidence")) if a.get("confidence") is not None else None,
                "decision_logic": a.get("decision_logic"),
                "environment_id": env_id,
                "created_at": run_ts,
            }
        )

    conn, _paths2 = _conn(env_id)
    try:
        conn.execute("DELETE FROM mule_risk_scores WHERE environment_id = ?", [env_id])
        conn.register("r", pd.DataFrame(rows))
        conn.execute(
            """
            INSERT INTO mule_risk_scores
            SELECT id, account_id, hybrid_score, risk_level, ml_risk_score, pattern_risk_score,
                   confidence, decision_logic, environment_id, created_at
            FROM r
            """,
        )
        result_payload = {"summary": summary, "accounts": accounts_out, "metadata": {"processing_time_ms": 0}}
        meta = _persist_module_run(
            conn,
            env_id,
            "hybrid",
            data_version=data_version,
            config_version=hybrid_config_version,
            summary=summary,
            result=result_payload,
        )
    finally:
        conn.close()

    duration_ms = int((datetime.now() - started_at).total_seconds() * 1000)
    metadata = {"processing_time_ms": duration_ms, "weights": dict(score_weights), "model_version": model_version, "run_meta": meta}
    return jsonify({"success": True, "cached": False, "summary": summary, "accounts": accounts_out, "metadata": metadata})


@platform_bp.route("/risk/summary", methods=["GET"])
def risk_summary():
    env_id = _env_id()
    conn, _paths = _conn(env_id)
    try:
        latest_ts = conn.execute("SELECT MAX(created_at) FROM mule_risk_scores WHERE environment_id = ?", [env_id]).fetchone()[0]
        if latest_ts is None:
            return jsonify({"success": True, "has_results": False})
        row = conn.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN risk_level = 'HIGH' THEN 1 ELSE 0 END) AS high,
                   SUM(CASE WHEN risk_level = 'MEDIUM' THEN 1 ELSE 0 END) AS med,
                   SUM(CASE WHEN risk_level = 'LOW' THEN 1 ELSE 0 END) AS low,
                   AVG(hybrid_score) AS avg_score,
                   MAX(hybrid_score) AS max_score
            FROM mule_risk_scores
            WHERE environment_id = ? AND created_at = ?
            """,
            [env_id, latest_ts],
        ).fetchone()
    finally:
        conn.close()
    total, high, med, low, avg_score, max_score = row
    return jsonify(
        {
            "success": True,
            "has_results": True,
            "last_run": str(latest_ts),
            "summary": {
                "total_accounts": int(total or 0),
                "high_risk_count": int(high or 0),
                "medium_risk_count": int(med or 0),
                "low_risk_count": int(low or 0),
                "high_risk_percentage": float((high or 0) / total * 100) if total else 0.0,
                "average_risk_score": float(avg_score or 0.0),
                "max_risk_score": float(max_score or 0.0),
            },
        }
    )

@platform_bp.route("/portfolio/summary", methods=["GET"])
def portfolio_summary():
    env_id = _env_id()
    service = RiskDashboardService(env_id)
    return jsonify(service.portfolio_summary())


@platform_bp.route("/portfolio/migration", methods=["GET"])
def portfolio_migration():
    env_id = _env_id()
    service = RiskDashboardService(env_id)
    return jsonify(service.portfolio_migration())


@platform_bp.route("/queue/priority", methods=["GET"])
def queue_priority():
    env_id = _env_id()
    filters = {
        "risk_level": request.args.get("risk_level"),
        "tag": request.args.get("tag"),
        "signal": request.args.get("signal"),
        "trigger": request.args.get("trigger"),
        "from_level": request.args.get("from_level"),
        "to_level": request.args.get("to_level"),
        "min_score": request.args.get("min_score"),
        "max_score": request.args.get("max_score"),
    }
    limit = request.args.get("limit", 200, type=int)
    service = RiskDashboardService(env_id)
    return jsonify(service.priority_queue(filters=filters, limit=limit))


@platform_bp.route("/patterns/emerging", methods=["GET"])
def patterns_emerging():
    env_id = _env_id()
    service = RiskDashboardService(env_id)
    return jsonify(service.emerging_patterns())


@platform_bp.route("/signals/top", methods=["GET"])
def signals_top():
    env_id = _env_id()
    limit = request.args.get("limit", 12, type=int)
    service = RiskDashboardService(env_id)
    return jsonify(service.top_signals(limit=limit))


@platform_bp.route("/model/health", methods=["GET"])
def model_health():
    env_id = _env_id()
    service = RiskDashboardService(env_id)
    return jsonify(service.model_health())

# ==================== FEATURE WORKBENCH ====================
@platform_bp.route("/runs/history", methods=["GET"])
def feature_runs_history():
    env_id = _env_id()
    svc = FeatureWorkbenchService(env_id)
    limit = request.args.get("limit", 25, type=int)
    return jsonify(svc.runs_history(limit=limit))

@platform_bp.route("/runs/details", methods=["GET"])
def feature_runs_details():
    env_id = _env_id()
    run_id = request.args.get("run_id")
    if not run_id:
        return jsonify({"success": False, "error": "run_id is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.runs_details(run_id))

@platform_bp.route("/typology/mapping", methods=["GET"])
def typology_mapping():
    env_id = _env_id()
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.typology_mapping())

@platform_bp.route("/features/catalog", methods=["GET"])
def features_catalog():
    env_id = _env_id()
    svc = FeatureWorkbenchService(env_id)
    target_name = request.args.get("target_name") or request.args.get("target") or None
    return _jsonify_safe(svc.features_catalog(target_name=target_name))

@platform_bp.route("/features/origin", methods=["GET"])
def features_origin():
    env_id = _env_id()
    feature = request.args.get("feature")
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureOriginService(env_id)
    return jsonify(svc.feature_origin(feature_name=feature))

@platform_bp.route("/features/explanation", methods=["GET"])
def features_explanation():
    env_id = _env_id()
    feature = request.args.get("feature")
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_explanation(feature_name=str(feature)))

@platform_bp.route("/features/profile", methods=["GET"])
def features_profile():
    env_id = _env_id()
    feature = request.args.get("feature")
    run_id = request.args.get("run_id")
    target_name = request.args.get("target_name") or request.args.get("target") or None
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_profile(feature_name=feature, run_id=run_id, target_name=target_name))

@platform_bp.route("/features/drift", methods=["GET"])
def features_drift():
    env_id = _env_id()
    feature = request.args.get("feature")
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_drift(feature_name=feature))

@platform_bp.route("/features/leakage", methods=["GET"])
def features_leakage():
    env_id = _env_id()
    feature = request.args.get("feature")
    target_name = request.args.get("target_name") or request.args.get("target") or None
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_leakage(feature_name=feature, target_name=target_name))

@platform_bp.route("/features/compare", methods=["GET"])
def features_compare():
    env_id = _env_id()
    feature = request.args.get("feature")
    left_run = request.args.get("left_run")
    right_run = request.args.get("right_run")
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_compare(feature_name=feature, left_run=left_run, right_run=right_run))

@platform_bp.route("/features/approve", methods=["POST"])
def features_approve():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    feature = payload.get("feature")
    status = payload.get("status")
    comment = payload.get("comment")
    owner = payload.get("owner")
    version = payload.get("version")
    if not feature or not status:
        return jsonify({"success": False, "error": "feature and status are required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_approve(feature_name=feature, status=status, comment=comment, owner=owner, version=version))

@platform_bp.route("/features/lineage", methods=["GET"])
def features_lineage():
    env_id = _env_id()
    feature = request.args.get("feature")
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_lineage(feature_name=feature))


@platform_bp.route("/features/correlations", methods=["GET"])
def features_correlations():
    env_id = _env_id()
    feature = request.args.get("feature")
    limit = request.args.get("limit", 10, type=int)
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_correlations(feature_name=feature, limit=limit))

@platform_bp.route("/features/governance/history", methods=["GET"])
def features_governance_history():
    env_id = _env_id()
    feature = request.args.get("feature")
    limit = request.args.get("limit", 50, type=int)
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_governance_history(feature_name=feature, limit=limit))

@platform_bp.route("/features/extremes", methods=["GET"])
def features_extremes():
    env_id = _env_id()
    feature = request.args.get("feature")
    limit = request.args.get("limit", 20, type=int)
    if not feature:
        return jsonify({"success": False, "error": "feature is required"}), 400
    svc = FeatureWorkbenchService(env_id)
    return jsonify(svc.feature_extremes(feature_name=feature, limit=limit))

# ==================== MODEL WORKBENCH ====================
@platform_bp.route("/experiments/create", methods=["POST"])
def experiments_create():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.experiments_create(payload))


@platform_bp.route("/experiments/list", methods=["GET"])
def experiments_list():
    env_id = _env_id()
    limit = request.args.get("limit", 50, type=int)
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.experiments_list(limit=limit))


@platform_bp.route("/features/eligible", methods=["POST"])
def features_eligible():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.features_eligible(payload))


@platform_bp.route("/validation/run", methods=["POST"])
def validation_run():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.validation_run(payload))


@platform_bp.route("/training/run", methods=["POST"])
def training_run():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.training_run(payload))


@platform_bp.route("/metrics", methods=["GET"])
def model_metrics():
    env_id = _env_id()
    svc = ModelWorkbenchService(env_id)
    params = {"experiment_id": request.args.get("experiment_id"), "model_version": request.args.get("model_version")}
    return _jsonify_safe(svc.metrics(params))


@platform_bp.route("/explain/global", methods=["GET"])
def explain_global():
    env_id = _env_id()
    model_version = request.args.get("model_version")
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.explain_global({"model_version": model_version}))


@platform_bp.route("/explain/local", methods=["GET"])
def explain_local():
    env_id = _env_id()
    model_version = request.args.get("model_version")
    account_id = request.args.get("account_id")
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.explain_local({"model_version": model_version, "account_id": account_id}))


@platform_bp.route("/bias", methods=["POST"])
def bias_checks():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.bias(payload))


@platform_bp.route("/compare", methods=["POST"])
def compare_models():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.compare(payload))


@platform_bp.route("/approve", methods=["POST"])
def approve_model():
    env_id = _env_id()
    payload = request.get_json(silent=True) or {}
    svc = ModelWorkbenchService(env_id)
    return _jsonify_safe(svc.approve(payload))

# ==================== INFERENCE WORKBENCH ====================
@platform_bp.route("/run/context", methods=["GET"])
def inference_run_context():
    env_id = _env_id()
    svc = MuleInferenceService(env_id)
    thresholds = {
        "high": request.args.get("high", 0.7, type=float),
        "medium": request.args.get("medium", 0.4, type=float),
    }
    population = {"population": request.args.get("population")}
    return _jsonify_safe(svc.run_context(thresholds=thresholds, population=population))


@platform_bp.route("/portfolio/outcome", methods=["GET"])
def inference_portfolio_outcome():
    env_id = _env_id()
    svc = MuleInferenceService(env_id)
    thresholds = {
        "high": request.args.get("high", 0.7, type=float),
        "medium": request.args.get("medium", 0.4, type=float),
    }
    return _jsonify_safe(svc.portfolio_outcome(thresholds=thresholds))


@platform_bp.route("/accounts/prioritized", methods=["GET"])
def inference_accounts_prioritized():
    env_id = _env_id()
    svc = MuleInferenceService(env_id)
    thresholds = {
        "high": request.args.get("high", 0.7, type=float),
        "medium": request.args.get("medium", 0.4, type=float),
    }
    filters = {
        "risk_level": request.args.get("risk_level"),
        "movement": request.args.get("movement"),
        "pattern": request.args.get("pattern"),
        "cluster_id": request.args.get("cluster_id"),
        "investigator": request.args.get("investigator"),
    }
    limit = request.args.get("limit", 500, type=int)
    return _jsonify_safe(svc.accounts_prioritized(thresholds=thresholds, filters=filters, limit=limit))


@platform_bp.route("/accounts/movement", methods=["GET"])
def inference_accounts_movement():
    env_id = _env_id()
    svc = MuleInferenceService(env_id)
    thresholds = {
        "high": request.args.get("high", 0.7, type=float),
        "medium": request.args.get("medium", 0.4, type=float),
    }
    return _jsonify_safe(svc.accounts_movement(thresholds=thresholds))


@platform_bp.route("/portfolio/patterns", methods=["GET"])
def inference_portfolio_patterns():
    env_id = _env_id()
    svc = MuleInferenceService(env_id)
    return _jsonify_safe(svc.portfolio_patterns())


@platform_bp.route("/suppression/confidence", methods=["GET"])
def inference_suppression_confidence():
    env_id = _env_id()
    svc = MuleInferenceService(env_id)
    thresholds = {
        "high": request.args.get("high", 0.7, type=float),
        "medium": request.args.get("medium", 0.4, type=float),
    }
    return _jsonify_safe(svc.suppression_confidence(thresholds=thresholds))


@platform_bp.route("/role/classification", methods=["GET"])
def inference_role_classification():
    env_id = _env_id()
    svc = MuleInferenceService(env_id)
    limit = request.args.get("limit", 2000, type=int)
    return _jsonify_safe(svc.role_classification(limit=limit))


@platform_bp.route("/accounts/assign", methods=["POST"])
def inference_assign_accounts():
    env_id = _env_id()
    svc = MuleInferenceService(env_id)
    payload = request.get_json(silent=True) or {}
    return _jsonify_safe(svc.assign_investigator(account_ids=payload.get("account_ids") or [], investigator=payload.get("investigator")))


@platform_bp.route("/explain/account", methods=["GET"])
def explain_account():
    env_id = _env_id()
    account_id = request.args.get("account_id")
    if not account_id:
        return jsonify({"success": False, "error": "account_id is required"}), 400
    model_version = request.args.get("model_version")
    thresholds = {
        "high": request.args.get("high", 0.7, type=float),
        "medium": request.args.get("medium", 0.4, type=float),
    }
    provider = ExplanationProvider(env_id)
    out = provider.explain_account(account_id=account_id, model_version=model_version, thresholds=thresholds)
    code = 200 if out.get("success") else 400
    return jsonify(out), code


@platform_bp.route("/risk/trend", methods=["GET"])
def risk_trend():
    env_id = _env_id()
    periods = request.args.get("periods", 12, type=int)
    periods = max(1, min(periods, 52))
    granularity = request.args.get("granularity", "week")
    if granularity not in {"day", "week"}:
        granularity = "week"

    conn, _paths = _conn(env_id)
    try:
        latest_ts = conn.execute("SELECT MAX(created_at) FROM mule_risk_scores WHERE environment_id = ?", [env_id]).fetchone()[0]
        if latest_ts is None:
            return jsonify({"success": True, "has_results": False, "trend": []})

        df = conn.execute(
            f"""
            SELECT
              date_trunc('{granularity}', created_at) AS bucket,
              SUM(CASE WHEN risk_level = 'HIGH' THEN 1 ELSE 0 END) AS high,
              SUM(CASE WHEN risk_level = 'MEDIUM' THEN 1 ELSE 0 END) AS medium,
              SUM(CASE WHEN risk_level = 'LOW' THEN 1 ELSE 0 END) AS low,
              COUNT(*) AS total
            FROM mule_risk_scores
            WHERE environment_id = ?
            GROUP BY bucket
            ORDER BY bucket DESC
            LIMIT ?
            """,
            [env_id, periods],
        ).df()
    finally:
        conn.close()

    rows = []
    for _idx, r in df.sort_values("bucket").iterrows():
        bucket = r.get("bucket")
        rows.append(
            {
                "bucket": bucket.isoformat() if hasattr(bucket, "isoformat") else str(bucket),
                "high": int(r.get("high") or 0),
                "medium": int(r.get("medium") or 0),
                "low": int(r.get("low") or 0),
                "total": int(r.get("total") or 0),
            }
        )
    return jsonify({"success": True, "has_results": True, "trend": rows, "granularity": granularity})


@platform_bp.route("/risk/accounts", methods=["GET"])
def risk_accounts():
    env_id = _env_id()
    limit = request.args.get("limit", 200, type=int)
    limit = max(1, min(limit, 5000))
    risk_level = request.args.get("risk_level")
    min_score = request.args.get("min_score", type=float)

    conn, _paths = _conn(env_id)
    try:
        latest_ts = conn.execute("SELECT MAX(created_at) FROM mule_risk_scores WHERE environment_id = ?", [env_id]).fetchone()[0]
        if latest_ts is None:
            return jsonify({"success": True, "has_results": False, "accounts": []})

        where = ["environment_id = ?", "created_at = ?"]
        params = [env_id, latest_ts]
        if risk_level:
            where.append("risk_level = ?")
            params.append(risk_level.upper())
        if min_score is not None:
            where.append("hybrid_score >= ?")
            params.append(float(min_score))

        df = conn.execute(
            f"""
            SELECT account_id, hybrid_score, risk_level, ml_risk_score, pattern_risk_score, decision_logic
            FROM mule_risk_scores
            WHERE {" AND ".join(where)}
            ORDER BY hybrid_score DESC
            LIMIT ?
            """,
            params + [limit],
        ).df()
    finally:
        conn.close()

    return jsonify({"success": True, "has_results": True, "last_run": str(latest_ts), "accounts": df.to_dict("records")})


@platform_bp.route("/account/<account_id>/summary", methods=["GET"])
def account_summary(account_id: str):
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    conn, _paths = _conn(env_id)
    try:
        acc_row = conn.execute(
            "SELECT * FROM mule_accounts_raw WHERE environment_id = ? AND account_id = ? LIMIT 1",
            [env_id, account_id],
        ).df()
        feat_row = conn.execute(
            "SELECT * FROM mule_account_features WHERE environment_id = ? AND account_id = ? LIMIT 1",
            [env_id, account_id],
        ).df()
        tx_df = conn.execute(
            """
            SELECT * FROM mule_transactions_raw
            WHERE environment_id = ? AND account_id = ?
            ORDER BY txn_timestamp DESC
            LIMIT 200
            """,
            [env_id, account_id],
        ).df()
        risk_row = conn.execute(
            """
            SELECT hybrid_score, risk_level, ml_risk_score, pattern_risk_score, created_at
            FROM mule_risk_scores
            WHERE environment_id = ? AND account_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [env_id, account_id],
        ).df()
    finally:
        conn.close()

    return jsonify(
        {
            "success": True,
            "account": acc_row.to_dict("records")[0] if len(acc_row) else None,
            "features": feat_row.to_dict("records")[0] if len(feat_row) else None,
            "transactions": tx_df.to_dict("records"),
            "risk": risk_row.to_dict("records")[0] if len(risk_row) else None,
        }
    )


@platform_bp.route("/explain/shap", methods=["GET"])
def explain_shap():
    env_id = _env_id()
    account_id = request.args.get("account_id")
    if not account_id:
        return jsonify({"success": False, "error": "account_id is required"}), 400

    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    conn, paths = _conn(env_id)
    try:
        row = conn.execute(
            "SELECT model_version FROM mule_models WHERE environment_id = ? ORDER BY trained_at DESC LIMIT 1",
            [env_id],
        ).fetchone()
        model_version = row[0] if row else None
        if not model_version:
            return jsonify({"success": False, "error": "No trained model found. Train a model first."}), 400

        features_df = conn.execute(
            "SELECT * EXCLUDE(environment_id, computed_at) FROM mule_account_features WHERE environment_id = ?",
            [env_id],
        ).df()
        x_row = features_df[features_df["account_id"] == account_id]
        if len(x_row) == 0:
            return jsonify({"success": False, "error": "Account not found in engineered features"}), 404
    finally:
        conn.close()

    engine = InferenceEngine(model_store_path=str(paths["models_dir"]))
    model_data = engine.load_model(model_version)
    model = model_data["model"]
    metadata = model_data.get("metadata", {}) or {}
    feature_cols = metadata.get("features", []) or []
    if not feature_cols:
        return jsonify({"success": False, "error": "Model metadata missing feature columns"}), 500

    x_arr = engine._prepare_features(x_row.drop(columns=["account_id"], errors="ignore"), feature_cols, metadata)
    x_arr = np.asarray(x_arr)

    pred = 0.0
    try:
        if hasattr(model, "predict_proba"):
            pred = float(model.predict_proba(x_arr)[:, 1][0])
        elif hasattr(model, "decision_function"):
            z = float(np.asarray(model.decision_function(x_arr))[0])
            pred = float(1.0 / (1.0 + np.exp(-z)))
        else:
            pred = float(np.asarray(model.predict(x_arr))[0])
    except Exception:
        pred = 0.0

    base_value = 0.0
    contribs = None
    try:
        import xgboost as xgb

        booster = model.get_booster() if hasattr(model, "get_booster") else None
        if booster is not None:
            c = booster.predict(xgb.DMatrix(x_arr), pred_contribs=True)
            if c is not None and len(c) > 0:
                row_c = np.asarray(c[0])
                if row_c.shape[0] == len(feature_cols) + 1:
                    base_value = float(row_c[-1])
                    contribs = row_c[:-1]
    except Exception:
        contribs = None

    if contribs is None:
        try:
            if hasattr(model, "feature_importances_"):
                importances = np.asarray(model.feature_importances_, dtype=float)
                if importances.shape[0] == len(feature_cols):
                    contribs = (x_arr[0] * importances)
        except Exception:
            contribs = None

    if contribs is None:
        contribs = np.zeros(len(feature_cols), dtype=float)

    pairs = list(zip(feature_cols, np.asarray(contribs, dtype=float)))
    pairs.sort(key=lambda p: abs(p[1]), reverse=True)
    top = [{"feature": f, "value": float(v)} for f, v in pairs[:15]]

    return jsonify(
        {
            "success": True,
            "model_version": model_version,
            "account_id": account_id,
            "base_value": float(base_value),
            "prediction": float(pred),
            "top_features": top,
        }
    )
