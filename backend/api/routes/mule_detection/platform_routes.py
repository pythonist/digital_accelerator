import json
import uuid
from datetime import datetime
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
from services.mule_detection.db_service import get_md_db_service

platform_bp = Blueprint("mule_platform", __name__)
md_db = get_md_db_service()

_feature_jobs_lock = threading.Lock()
_feature_jobs = {}


def _env_id() -> str:
    return request.headers.get("X-Environment-ID", "fcip_env")


def _conn(env_id: str):
    paths = md_db.init_env_structure(env_id)
    return duckdb.connect(str(paths["duckdb"])), paths


def _hash_jsonable(obj) -> str:
    try:
        s = json.dumps(obj, sort_keys=True, default=str)
    except Exception:
        s = str(obj)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


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
        txn_count = int(conn.execute("SELECT COUNT(*) FROM mule_transactions_raw WHERE environment_id = ?", [env_id]).fetchone()[0])
    finally:
        conn.close()
    if txn_count == 0:
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

    sql_table = "mule_transactions_raw" if table == "transactions" else "mule_accounts_raw"
    conn, _paths = _conn(env_id)
    try:
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
    with _feature_jobs_lock:
        existing = _feature_jobs.get(env_id)
        if existing and existing.get("state") in ["queued", "running"]:
            return jsonify({"success": True, "job_id": existing["job_id"], "state": existing["state"]})
        job_id = str(uuid.uuid4())
        _feature_jobs[env_id] = {
            "job_id": job_id,
            "state": "queued",
            "step": "queued",
            "message": "Queued",
            "started_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "result": None,
            "error": None,
        }

    def _run():
        def _update(state: str, step: str, message: str, result=None, error=None):
            with _feature_jobs_lock:
                j = _feature_jobs.get(env_id)
                if not j or j.get("job_id") != job_id:
                    return
                j["state"] = state
                j["step"] = step
                j["message"] = message
                j["updated_at"] = datetime.now().isoformat()
                if result is not None:
                    j["result"] = result
                if error is not None:
                    j["error"] = error

        try:
            _update("running", "load_data", "Loading transactions/accounts")
            tx, acc = _load_tx_acc(env_id)
            started = datetime.now()
            total_accounts = int(tx["account_id"].nunique()) if len(tx) and "account_id" in tx.columns else 0
            with _feature_jobs_lock:
                j = _feature_jobs.get(env_id)
                if j and j.get("job_id") == job_id:
                    j["total_accounts"] = total_accounts
                    j["processed_accounts"] = 0
            _update("running", "engineer_features", "Engineering features 0/" + str(total_accounts))
            fe = FeatureEngineer()
            def _progress(done: int, total: int):
                elapsed = int((datetime.now() - started).total_seconds())
                with _feature_jobs_lock:
                    j = _feature_jobs.get(env_id)
                    if j and j.get("job_id") == job_id:
                        j["processed_accounts"] = int(done)
                        j["total_accounts"] = int(total)
                        j["elapsed_seconds"] = elapsed
                _update("running", "engineer_features", f"Engineering features {done}/{total}")

            features_df = fe.engineer_all_features(tx, acc, progress_cb=_progress)
            _update("running", "persist", "Persisting features to DuckDB")
            conn, _paths = _conn(env_id)
            try:
                _persist_features(conn, env_id, features_df)
            finally:
                conn.close()
            _update(
                "completed",
                "completed",
                "Completed",
                result={"accounts": int(len(features_df)), "features": int(len(features_df.columns))},
            )
        except Exception as e:
            _update("failed", "failed", "Failed", error=str(e))

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return jsonify({"success": True, "job_id": job_id, "state": "queued"})


@platform_bp.route("/features/engineer/status", methods=["GET"])
def engineer_features_status():
    env_id = _env_id()
    job_id = request.args.get("job_id")
    with _feature_jobs_lock:
        j = _feature_jobs.get(env_id)
        if not j:
            return jsonify({"success": True, "state": "idle", "job_id": None})
        if job_id and j.get("job_id") != job_id:
            return jsonify({"success": True, "state": "idle", "job_id": None})
        return jsonify({"success": True, **j})


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

    payload = request.get_json() or {}
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


@platform_bp.route("/ml/infer-model", methods=["POST"])
def infer_model():
    env_id = _env_id()
    ok, msg = _ensure_has_data(env_id)
    if not ok:
        return jsonify({"success": False, "error": msg}), 400

    payload = request.get_json() or {}
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

    payload = request.get_json() or {}
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
        return jsonify({"success": False, "error": "No trained model found. Train a model first."}), 400

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
