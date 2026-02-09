import json
import numpy as np
import pandas as pd
import duckdb
from datetime import datetime
from services.mule_detection.db_service import get_md_db_service

try:
    from features.feature_store import FeatureStore
    _FEATURE_STORE_OK = True
except Exception:
    FeatureStore = None
    _FEATURE_STORE_OK = False


class FeatureWorkbenchService:
    def __init__(self, env_id: str):
        self.env_id = env_id
        self.md_db = get_md_db_service()
        self._feature_map = None

    def _conn(self) -> tuple[duckdb.DuckDBPyConnection, dict]:
        paths = self.md_db.init_env_structure(self.env_id)
        return duckdb.connect(str(paths["duckdb"])), paths

    def _dataset_version(self, conn: duckdb.DuckDBPyConnection):
        row = conn.execute(
            """
            SELECT dataset_version, upload_id, uploaded_at
            FROM mule_uploads
            WHERE environment_id = ?
            ORDER BY uploaded_at DESC
            LIMIT 1
            """,
            [self.env_id],
        ).fetchone()
        if not row:
            return None
        dataset_version, upload_id, uploaded_at = row
        return str(dataset_version or upload_id or uploaded_at or "unknown")

    def _feature_definitions(self):
        if self._feature_map is not None:
            return self._feature_map
        if not _FEATURE_STORE_OK:
            self._feature_map = {}
            return self._feature_map
        fs = FeatureStore()
        defs = fs.feature_definitions or {}
        self._feature_map = defs
        return defs

    def _latest_feature_runs(self, conn: duckdb.DuckDBPyConnection, limit: int = 2):
        rows = conn.execute(
            """
            SELECT run_id, data_version, config_version, summary_json, result_json, created_at
            FROM mule_module_runs
            WHERE environment_id = ? AND module = 'feature_engineering'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            [self.env_id, int(limit)],
        ).fetchall()
        out = []
        for r in rows:
            run_id, data_version, config_version, summary_json, result_json, created_at = r
            out.append(
                {
                    "run_id": run_id,
                    "data_version": data_version,
                    "config_version": config_version,
                    "summary": json_load(summary_json),
                    "result": json_load(result_json),
                    "created_at": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
                }
            )
        return out

    def runs_history(self, limit: int = 25):
        conn, _paths = self._conn()
        try:
            rows = conn.execute(
                """
                SELECT run_id, data_version, config_version, summary_json, result_json, created_at
                FROM mule_module_runs
                WHERE environment_id = ? AND module = 'feature_engineering'
                ORDER BY created_at DESC
                LIMIT ?
                """,
                [self.env_id, int(limit)],
            ).fetchall()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()
        runs = []
        for r in rows:
            run_id, data_version, config_version, summary_json, result_json, created_at = r
            summary = json_load(summary_json)
            result = json_load(result_json)
            runs.append(
                {
                    "run_id": run_id,
                    "timestamp": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
                    "duration_seconds": summary.get("duration_seconds"),
                    "features_produced": summary.get("features"),
                    "accounts": summary.get("accounts"),
                    "failures": summary.get("failures", 0),
                    "owner": (result.get("config") or {}).get("owner"),
                    "dataset_version": data_version or dataset_version,
                }
            )
        return {"success": True, "runs": runs, "dataset_version": dataset_version, "timestamp": now_iso()}

    def runs_details(self, run_id: str):
        conn, _paths = self._conn()
        try:
            row = conn.execute(
                """
                SELECT run_id, data_version, config_version, summary_json, result_json, created_at
                FROM mule_module_runs
                WHERE environment_id = ? AND module = 'feature_engineering' AND run_id = ?
                """,
                [self.env_id, run_id],
            ).fetchone()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()
        if not row:
            return {"success": False, "error": "Run not found"}
        run_id, data_version, config_version, summary_json, result_json, created_at = row
        return {
            "success": True,
            "run": {
                "run_id": run_id,
                "dataset_version": data_version or dataset_version,
                "config_version": config_version,
                "timestamp": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
                "summary": json_load(summary_json),
                "result": json_load(result_json),
            },
        }

    def features_catalog(self):
        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            features_df = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            labels_df = conn.execute(
                "SELECT account_id, is_mule FROM mule_accounts_raw WHERE environment_id = ?",
                [self.env_id],
            ).df()
            runs = self._latest_feature_runs(conn, 2)
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()

        if len(cols_df) == 0:
            return {"success": True, "features": [], "dataset_version": dataset_version, "timestamp": now_iso()}

        feature_defs = self._feature_definitions()
        feature_names = [r.get("name") for _, r in cols_df.iterrows() if r.get("name") not in ["account_id", "environment_id", "computed_at"]]
        missing_pct = {}
        if len(features_df):
            for f in feature_names:
                missing_pct[f] = float(features_df[f].isna().mean())

        leakage_map = {}
        if len(features_df) and len(labels_df) and "is_mule" in labels_df.columns:
            merged = features_df.merge(labels_df, on="account_id", how="left")
            y = pd.to_numeric(merged["is_mule"], errors="coerce").fillna(0).astype(int)
            for f in feature_names:
                if not pd.api.types.is_numeric_dtype(merged[f]):
                    continue
                x = pd.to_numeric(merged[f], errors="coerce")
                mu1 = float(x[y == 1].mean()) if (y == 1).any() else 0.0
                mu0 = float(x[y == 0].mean()) if (y == 0).any() else 0.0
                std = float(x.std() or 0.0)
                if std == 0:
                    continue
                leakage_map[f] = abs(mu1 - mu0) / std

        stability_map = {}
        if len(runs) >= 2:
            cur = runs[0]["run_id"]
            prev = runs[1]["run_id"]
            conn, _paths = self._conn()
            try:
                cur_prof = conn.execute(
                    """
                    SELECT feature_name, mean, std
                    FROM mule_feature_profiles
                    WHERE environment_id = ? AND run_id = ?
                    """,
                    [self.env_id, cur],
                ).df()
                prev_prof = conn.execute(
                    """
                    SELECT feature_name, mean, std
                    FROM mule_feature_profiles
                    WHERE environment_id = ? AND run_id = ?
                    """,
                    [self.env_id, prev],
                ).df()
            finally:
                conn.close()
            if len(cur_prof) and len(prev_prof):
                merged = cur_prof.merge(prev_prof, on="feature_name", how="inner", suffixes=("", "_prev"))
                for _, r in merged.iterrows():
                    std = float(r.get("std_prev") or 0.0) or 1.0
                    delta = abs(float(r.get("mean") or 0.0) - float(r.get("mean_prev") or 0.0)) / std
                    stability_map[r.get("feature_name")] = max(0.0, 1.0 - min(1.0, delta))

        rows = []
        for f in feature_names:
            d = feature_defs.get(f) if isinstance(feature_defs, dict) else None
            rows.append(
                {
                    "feature_name": f,
                    "category": getattr(d, "feature_category", None) if d else None,
                    "description": getattr(d, "description", None) if d else None,
                    "formula": getattr(d, "sql_query", None) if d else None,
                    "owner": None,
                    "version": runs[0]["run_id"] if runs else None,
                    "created_in_run": runs[0]["run_id"] if runs else None,
                    "missing_pct": missing_pct.get(f),
                    "stability": stability_map.get(f),
                    "leakage_risk": leakage_map.get(f),
                    "approval_status": "needs_review",
                }
            )
        return {"success": True, "features": rows, "dataset_version": dataset_version, "timestamp": now_iso()}

    def feature_profile(self, feature_name: str, run_id: str | None = None):
        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            if feature_name not in cols_df["name"].tolist():
                return {"success": False, "error": "Unknown feature"}
            data = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()

        series = data[feature_name]
        missing_pct = float(series.isna().mean()) if len(data) else 0.0
        profile = {"feature_name": feature_name, "missing_pct": missing_pct}
        if pd.api.types.is_numeric_dtype(series):
            s = pd.to_numeric(series, errors="coerce").dropna()
            if len(s):
                profile.update(
                    {
                        "min": float(s.min()),
                        "max": float(s.max()),
                        "mean": float(s.mean()),
                        "std": float(s.std() or 0.0),
                        "p25": float(s.quantile(0.25)),
                        "p50": float(s.quantile(0.50)),
                        "p75": float(s.quantile(0.75)),
                    }
                )
            bins = []
            if len(s):
                counts, edges = np.histogram(s, bins=10)
                for i in range(len(counts)):
                    bins.append({"start": float(edges[i]), "end": float(edges[i + 1]), "count": int(counts[i])})
            profile["bins"] = bins
        else:
            vc = series.astype(str).value_counts(dropna=True).head(20)
            profile["cardinality"] = int(series.nunique(dropna=True))
            profile["top_values"] = [{"value": str(k), "count": int(v)} for k, v in vc.items()]

        return {"success": True, "profile": profile, "run_id": run_id, "dataset_version": dataset_version, "timestamp": now_iso()}

    def feature_drift(self, feature_name: str):
        conn, _paths = self._conn()
        try:
            runs = self._latest_feature_runs(conn, 2)
            dataset_version = self._dataset_version(conn)
            if len(runs) < 2:
                return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
            cur = runs[0]["run_id"]
            prev = runs[1]["run_id"]
            cur_prof = conn.execute(
                """
                SELECT * FROM mule_feature_profiles
                WHERE environment_id = ? AND run_id = ? AND feature_name = ?
                """,
                [self.env_id, cur, feature_name],
            ).df()
            prev_prof = conn.execute(
                """
                SELECT * FROM mule_feature_profiles
                WHERE environment_id = ? AND run_id = ? AND feature_name = ?
                """,
                [self.env_id, prev, feature_name],
            ).df()
        finally:
            conn.close()
        if len(cur_prof) == 0 or len(prev_prof) == 0:
            return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
        cur_row = cur_prof.iloc[0].to_dict()
        prev_row = prev_prof.iloc[0].to_dict()
        std = float(prev_row.get("std") or 0.0) or 1.0
        drift = abs(float(cur_row.get("mean") or 0.0) - float(prev_row.get("mean") or 0.0)) / std
        return {
            "success": True,
            "has_results": True,
            "feature_name": feature_name,
            "current": cur_row,
            "previous": prev_row,
            "drift_score": float(drift),
            "dataset_version": dataset_version,
            "timestamp": now_iso(),
        }

    def feature_leakage(self, feature_name: str):
        conn, _paths = self._conn()
        try:
            data = conn.execute(
                "SELECT f.*, a.is_mule FROM mule_account_features f LEFT JOIN mule_accounts_raw a ON a.environment_id = f.environment_id AND a.account_id = f.account_id WHERE f.environment_id = ?",
                [self.env_id],
            ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()
        if feature_name not in data.columns:
            return {"success": False, "error": "Unknown feature"}
        if "is_mule" not in data.columns:
            return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
        y = pd.to_numeric(data["is_mule"], errors="coerce").fillna(0).astype(int)
        if y.nunique() < 2:
            return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
        x = pd.to_numeric(data[feature_name], errors="coerce")
        mu1 = float(x[y == 1].mean()) if (y == 1).any() else 0.0
        mu0 = float(x[y == 0].mean()) if (y == 0).any() else 0.0
        std = float(x.std() or 0.0)
        leakage = abs(mu1 - mu0) / std if std else 0.0
        return {
            "success": True,
            "has_results": True,
            "feature_name": feature_name,
            "leakage_score": float(leakage),
            "dataset_version": dataset_version,
            "timestamp": now_iso(),
        }

    def feature_compare(self, feature_name: str, left_run: str | None, right_run: str | None):
        conn, _paths = self._conn()
        try:
            runs = self._latest_feature_runs(conn, 2)
            dataset_version = self._dataset_version(conn)
            if not left_run or not right_run:
                if len(runs) >= 2:
                    left_run = runs[1]["run_id"]
                    right_run = runs[0]["run_id"]
            if not left_run or not right_run:
                return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
            left = conn.execute(
                """
                SELECT * FROM mule_feature_profiles
                WHERE environment_id = ? AND run_id = ? AND feature_name = ?
                """,
                [self.env_id, left_run, feature_name],
            ).df()
            right = conn.execute(
                """
                SELECT * FROM mule_feature_profiles
                WHERE environment_id = ? AND run_id = ? AND feature_name = ?
                """,
                [self.env_id, right_run, feature_name],
            ).df()
        finally:
            conn.close()
        if len(left) == 0 or len(right) == 0:
            return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
        return {
            "success": True,
            "has_results": True,
            "feature_name": feature_name,
            "left": left.iloc[0].to_dict(),
            "right": right.iloc[0].to_dict(),
            "left_run": left_run,
            "right_run": right_run,
            "dataset_version": dataset_version,
            "timestamp": now_iso(),
        }

    def feature_approve(self, feature_name: str, status: str, comment: str | None, owner: str | None, version: str | None):
        conn, _paths = self._conn()
        try:
            conn.execute(
                """
                INSERT INTO mule_feature_governance(feature_name, version, environment_id, status, owner, comment, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                [feature_name, version, self.env_id, status, owner, comment],
            )
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()
        return {"success": True, "feature_name": feature_name, "status": status, "dataset_version": dataset_version, "timestamp": now_iso()}

    def feature_lineage(self, feature_name: str):
        conn, _paths = self._conn()
        try:
            runs = self._latest_feature_runs(conn, 1)
            dataset_version = self._dataset_version(conn)
            lineage = {
                "feature_name": feature_name,
                "latest_run_id": runs[0]["run_id"] if runs else None,
                "dataset_version": dataset_version,
            }
        finally:
            conn.close()
        return {"success": True, "lineage": lineage, "timestamp": now_iso()}


def json_load(value):
    try:
        return json.loads(value) if value else {}
    except Exception:
        return {}


def now_iso():
    return datetime.now().isoformat()
