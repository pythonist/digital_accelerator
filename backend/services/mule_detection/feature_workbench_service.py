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

try:
    from services.mule_detection.feature_origin_service import _origin_index as _origin_index_fn
    _ORIGIN_OK = True
except Exception:
    _origin_index_fn = None
    _ORIGIN_OK = False


class FeatureWorkbenchService:
    def __init__(self, env_id: str):
        self.env_id = env_id
        self.md_db = get_md_db_service()
        self._feature_map = None

    def _iv_woe(self, x: pd.Series, y: pd.Series, bins: int = 10):
        xv = pd.to_numeric(x, errors="coerce")
        yv = pd.to_numeric(y, errors="coerce").fillna(0).astype(int)

        mask = xv.notna()
        if mask.sum() < 50:
            return None
        xv = xv[mask]
        yv = yv[mask]
        if yv.nunique() < 2:
            return None

        q = np.linspace(0.0, 1.0, int(bins) + 1)
        edges = np.unique(np.quantile(xv.to_numpy(), q))
        if len(edges) < 3:
            return None

        bucket = pd.cut(xv, bins=edges, include_lowest=True, duplicates="drop")
        tmp = pd.DataFrame({"bucket": bucket, "y": yv})
        agg = tmp.groupby("bucket", observed=True)["y"].agg(["count", "sum"]).reset_index()
        agg.rename(columns={"sum": "bad"}, inplace=True)
        agg["good"] = agg["count"] - agg["bad"]

        total_bad = float(agg["bad"].sum() or 0.0)
        total_good = float(agg["good"].sum() or 0.0)
        if total_bad <= 0.0 or total_good <= 0.0:
            return None

        eps = 1e-9
        bins_out = []
        iv = 0.0
        for _, r in agg.iterrows():
            b = float(r.get("bad") or 0.0)
            g = float(r.get("good") or 0.0)
            bad_dist = (b / total_bad) if total_bad else 0.0
            good_dist = (g / total_good) if total_good else 0.0
            woe = float(np.log((bad_dist + eps) / (good_dist + eps)))
            iv += float((bad_dist - good_dist) * woe)
            interval = r.get("bucket")
            start = float(interval.left) if interval is not None else None
            end = float(interval.right) if interval is not None else None
            bins_out.append(
                {
                    "start": start,
                    "end": end,
                    "count": int(r.get("count") or 0),
                    "bad": int(r.get("bad") or 0),
                    "good": int(r.get("good") or 0),
                    "bad_rate": float((b / float(r.get("count") or 1)) if float(r.get("count") or 0) else 0.0),
                    "woe": woe,
                }
            )
        return {"iv": float(iv), "woe_bins": bins_out}

    def _psi_from_bins(self, left_bins: pd.DataFrame, right_bins: pd.DataFrame):
        if len(left_bins) == 0 or len(right_bins) == 0:
            return None
        l = left_bins.sort_values(["bin_start", "bin_end"]).reset_index(drop=True)
        r = right_bins.sort_values(["bin_start", "bin_end"]).reset_index(drop=True)

        l_total = float(l["count"].sum() or 0.0)
        r_total = float(r["count"].sum() or 0.0)
        if l_total <= 0.0 or r_total <= 0.0:
            return None

        n = int(max(len(l), len(r)))
        eps = 1e-6
        psi = 0.0
        for i in range(n):
            lp = (float(l.iloc[i]["count"]) / l_total) if i < len(l) else 0.0
            rp = (float(r.iloc[i]["count"]) / r_total) if i < len(r) else 0.0
            lp = max(lp, eps)
            rp = max(rp, eps)
            psi += float((rp - lp) * np.log(rp / lp))
        return float(psi)

    def _conn(self) -> tuple[duckdb.DuckDBPyConnection, dict]:
        return self.md_db.connect(self.env_id)

    def _feature_metadata(self, conn: duckdb.DuckDBPyConnection) -> tuple[dict, dict]:
        cols_df = conn.execute("PRAGMA table_info('mule_feature_metadata')").df()
        col_set = set(cols_df["name"].tolist()) if len(cols_df) else set()
        wcol = "window_spec" if "window_spec" in col_set else ('"window"' if "window" in col_set else "NULL")

        meta_df = conn.execute(
            f"""
            SELECT feature_name, typology, business_description, expected_risk_direction,
                   owner, {wcol} AS window, data_source, updated_at
            FROM mule_feature_metadata
            WHERE environment_id = ?
            ORDER BY updated_at DESC
            """,
            [self.env_id],
        ).df()
        typ_df = conn.execute(
            """
            SELECT typology, description
            FROM mule_typology_registry
            WHERE environment_id = ?
            ORDER BY updated_at DESC
            """,
            [self.env_id],
        ).df()

        feature_meta = {}
        if len(meta_df):
            for _, r in meta_df.iterrows():
                name = r.get("feature_name")
                if not name:
                    continue
                if str(name) in feature_meta:
                    continue
                feature_meta[str(name)] = {
                    "typology": r.get("typology"),
                    "business_description": r.get("business_description"),
                    "expected_risk_direction": r.get("expected_risk_direction"),
                    "owner": r.get("owner"),
                    "window": r.get("window"),
                    "data_source": r.get("data_source"),
                    "updated_at": str(r.get("updated_at")),
                }

        typology_desc = {}
        if len(typ_df):
            for _, r in typ_df.iterrows():
                t = r.get("typology")
                if not t:
                    continue
                if str(t) in typology_desc:
                    continue
                typology_desc[str(t)] = r.get("description")

        return feature_meta, typology_desc

    def _resolve_target_column(self, conn: duckdb.DuckDBPyConnection, target_name: str | None):
        cols_df = conn.execute("PRAGMA table_info('mule_accounts_raw')").df()
        col_names = cols_df["name"].tolist() if len(cols_df) else []
        if target_name:
            return target_name if target_name in col_names else None
        return "is_mule" if "is_mule" in col_names else None

    def typology_mapping(self):
        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            feature_names = [
                r.get("name")
                for _, r in cols_df.iterrows()
                if r.get("name") not in ["account_id", "environment_id", "computed_at"]
            ]
            feature_meta, typology_desc = self._feature_metadata(conn)
        finally:
            conn.close()

        buckets = {}
        for f in feature_names:
            meta = feature_meta.get(f) or {}
            typ = meta.get("typology") or "UNMAPPED – requires classification"
            buckets.setdefault(typ, []).append(f)

        out = []
        for typology, feats in sorted(
            buckets.items(), key=lambda x: (x[0] != "UNMAPPED – requires classification", x[0])
        ):
            out.append(
                {
                    "typology": typology,
                    "description": typology_desc.get(typology),
                    "features": sorted([str(x) for x in feats]),
                }
            )
        return out

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
            config = result.get("config") or {}
            run_type = summary.get("run_type") or result.get("run_type") or config.get("run_type") or "run"
            triggered_by = summary.get("triggered_by") or result.get("triggered_by") or config.get("triggered_by") or config.get("owner")
            status = summary.get("status") or "success"
            input_version = summary.get("input_version") or result.get("input_version")
            output_version = summary.get("output_version") or result.get("output_version") or data_version or dataset_version
            logs = result.get("logs") or []
            runs.append(
                {
                    "run_id": run_id,
                    "run_type": run_type,
                    "triggered_by": triggered_by,
                    "timestamp": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
                    "input_version": input_version,
                    "output_version": output_version,
                    "duration_seconds": summary.get("duration_seconds"),
                    "status": status,
                    "features_produced": summary.get("features"),
                    "accounts": summary.get("accounts"),
                    "failures": summary.get("failures", 0),
                    "logs_count": int(len(logs)) if isinstance(logs, list) else 0,
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
        summary = json_load(summary_json)
        result = json_load(result_json)
        config = result.get("config") or {}
        return {
            "success": True,
            "run": {
                "run_id": run_id,
                "dataset_version": data_version or dataset_version,
                "config_version": config_version,
                "timestamp": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
                "summary": summary,
                "result": result,
                "run_type": summary.get("run_type") or result.get("run_type") or config.get("run_type") or "run",
                "triggered_by": summary.get("triggered_by") or result.get("triggered_by") or config.get("triggered_by") or config.get("owner"),
                "input_version": summary.get("input_version") or result.get("input_version"),
                "output_version": summary.get("output_version") or result.get("output_version") or data_version or dataset_version,
                "status": summary.get("status") or "success",
            },
        }

    def features_catalog(self, target_name: str | None = None):
        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            features_df = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            refresh_row = conn.execute(
                "SELECT MAX(computed_at) FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).fetchone()
            last_refresh = str(refresh_row[0]) if refresh_row and refresh_row[0] is not None else None
            target_col = self._resolve_target_column(conn, target_name)
            if target_col:
                labels_df = conn.execute(
                    f'SELECT account_id, "{target_col}" AS target FROM mule_accounts_raw WHERE environment_id = ?',
                    [self.env_id],
                ).df()
            else:
                labels_df = pd.DataFrame(columns=["account_id", "target"])
            runs = self._latest_feature_runs(conn, 2)
            gov_df = conn.execute(
                """
                SELECT feature_name, version, status, owner, comment, updated_at
                FROM mule_feature_governance
                WHERE environment_id = ?
                ORDER BY updated_at DESC
                """,
                [self.env_id],
            ).df()
            feature_meta, _typology_desc = self._feature_metadata(conn)
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

        rarity_map = {}
        if len(features_df) and feature_names:
            sample_df = features_df
            if len(sample_df) > 100_000:
                sample_df = sample_df.sample(n=100_000, random_state=17)
            for f in feature_names:
                if f not in sample_df.columns:
                    continue
                if not pd.api.types.is_numeric_dtype(sample_df.get(f)):
                    continue
                s = pd.to_numeric(sample_df[f], errors="coerce").dropna()
                if len(s) < 50:
                    continue
                p50 = float(s.quantile(0.50))
                p99 = float(s.quantile(0.99))
                if abs(p50) < 1e-9:
                    ratio = float("inf") if abs(p99) > 0 else 1.0
                else:
                    ratio = abs(p99 / p50)
                zero_pct = float((s == 0).mean())
                if zero_pct >= 0.95 or ratio >= 20.0:
                    rarity_map[f] = "EXTREME"
                elif zero_pct >= 0.80 or ratio >= 5.0:
                    rarity_map[f] = "UNUSUAL"
                else:
                    rarity_map[f] = "COMMON"

        origin_map = {}
        if _ORIGIN_OK and _origin_index_fn is not None:
            try:
                origin_map = (_origin_index_fn().get("python") or {})
            except Exception:
                origin_map = {}

        label_available = False
        label_pos = 0
        label_neg = 0
        if len(labels_df) and "target" in labels_df.columns:
            lbl = labels_df["target"]
            if lbl.notna().any():
                label_available = True
                y_all = pd.to_numeric(lbl, errors="coerce")
                label_pos = int((y_all == 1).sum())
                label_neg = int((y_all == 0).sum())

        iv_usable = bool(label_available and label_pos > 0 and label_neg > 0)

        iv_map = {}
        if iv_usable and len(features_df):
            merged = features_df.merge(labels_df, on="account_id", how="left")
            if len(merged) > 50_000:
                merged = merged.sample(n=50_000, random_state=7)
            y = pd.to_numeric(merged["target"], errors="coerce").astype("Int64")
            m = y.notna()
            y = y[m].astype(int)
            for f in feature_names:
                if not pd.api.types.is_numeric_dtype(merged.get(f)):
                    continue
                res = self._iv_woe(merged.loc[m, f], y, bins=10)
                if res:
                    iv_map[f] = res.get("iv")

        leakage_map = {}
        if iv_usable and len(features_df):
            merged = features_df.merge(labels_df, on="account_id", how="left")
            y = pd.to_numeric(merged["target"], errors="coerce").astype("Int64")
            m = y.notna()
            y = y[m].astype(int)
            for f in feature_names:
                if not pd.api.types.is_numeric_dtype(merged[f]):
                    continue
                x = pd.to_numeric(merged.loc[m, f], errors="coerce")
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

        psi_map = {}
        if len(runs) >= 2:
            right_run = runs[0]["run_id"]
            left_run = runs[1]["run_id"]
            conn, _paths = self._conn()
            try:
                left_bins_df = conn.execute(
                    """
                    SELECT feature_name, bin_start, bin_end, count
                    FROM mule_feature_bins
                    WHERE environment_id = ? AND run_id = ?
                    """,
                    [self.env_id, left_run],
                ).df()
                right_bins_df = conn.execute(
                    """
                    SELECT feature_name, bin_start, bin_end, count
                    FROM mule_feature_bins
                    WHERE environment_id = ? AND run_id = ?
                    """,
                    [self.env_id, right_run],
                ).df()
            finally:
                conn.close()
            if len(left_bins_df) and len(right_bins_df):
                for f in feature_names:
                    l = left_bins_df[left_bins_df["feature_name"] == f]
                    r = right_bins_df[right_bins_df["feature_name"] == f]
                    psi = self._psi_from_bins(l, r)
                    if psi is not None:
                        psi_map[f] = psi

        latest_gov = {}
        if len(gov_df):
            for _, r in gov_df.iterrows():
                name = r.get("feature_name")
                if name and name not in latest_gov:
                    latest_gov[str(name)] = {
                        "version": r.get("version"),
                        "status": r.get("status"),
                        "owner": r.get("owner"),
                        "comment": r.get("comment"),
                        "updated_at": str(r.get("updated_at")),
                    }

        rows = []
        for f in feature_names:
            d = feature_defs.get(f) if isinstance(feature_defs, dict) else None
            gov = latest_gov.get(f) or {}
            meta = feature_meta.get(f) or {}
            lifecycle_state = gov.get("status") or "Draft"
            leakage_score = leakage_map.get(f) if iv_usable else None
            stability_score = stability_map.get(f)
            drift_status = None
            if stability_score is None:
                drift_status = None
            else:
                drift_status = "DRIFT" if float(stability_score) < 0.6 else "OK"
            leakage_state = None
            if leakage_score is not None:
                lv = float(leakage_score)
                leakage_state = "LEAKING" if lv >= 1.0 else ("AT_RISK" if lv >= 0.5 else "CLEAR")

            iv = iv_map.get(f) if iv_usable else None
            predictive_strength = None
            if iv is not None:
                iv_f = float(iv)
                if iv_f >= 0.3:
                    predictive_strength = "HIGH"
                elif iv_f >= 0.1:
                    predictive_strength = "MEDIUM"
                else:
                    predictive_strength = "LOW"

            psi = psi_map.get(f)
            missing_val = missing_pct.get(f)
            stability_val = float(stability_score) if stability_score is not None else None
            psi_val = float(psi) if psi is not None else None
            production_ready = False
            if str(lifecycle_state).upper() == "PRODUCTION":
                production_ready = True
                if missing_val is not None and float(missing_val) >= 0.2:
                    production_ready = False
                if psi_val is not None and float(psi_val) >= 0.2:
                    production_ready = False
                if stability_val is not None and float(stability_val) < 0.6:
                    production_ready = False
                if leakage_score is not None and float(leakage_score) >= 0.5:
                    production_ready = False
            rows.append(
                {
                    "feature_name": f,
                    "typology": meta.get("typology") or "UNMAPPED – requires classification",
                    "window": meta.get("window"),
                    "data_source": meta.get("data_source"),
                    "expected_risk_direction": meta.get("expected_risk_direction"),
                    "category": getattr(d, "feature_category", None) if d else None,
                    "description": meta.get("business_description") or (getattr(d, "description", None) if d else None),
                    "formula": getattr(d, "sql_query", None) if d else None,
                    "owner": meta.get("owner") or gov.get("owner"),
                    "version": runs[0]["run_id"] if runs else None,
                    "created_in_run": runs[0]["run_id"] if runs else None,
                    "created_at": runs[0]["created_at"] if runs else None,
                    "last_refresh": last_refresh,
                    "iv": iv,
                    "predictive_strength": predictive_strength,
                    "psi": psi,
                    "stability_score": stability_score,
                    "missing_pct": missing_val,
                    "drift_status": drift_status,
                    "leakage_score": float(leakage_score) if leakage_score is not None else None,
                    "leakage_status": leakage_state,
                    "lifecycle_state": str(lifecycle_state).upper(),
                    "production_ready": bool(production_ready),
                    "production_live": bool(str(lifecycle_state).lower() == "production"),
                    "governance_updated_at": gov.get("updated_at"),
                    "governance_comment": gov.get("comment"),
                    "label_available": bool(label_available),
                    "rarity_verdict": rarity_map.get(f),
                    "origin_type": "sql" if (d and getattr(d, "sql_query", None)) else ("python" if (d and getattr(d, "python_function", None)) else ("python" if f in origin_map else None)),
                    "built_by": (getattr(d, "python_function", None) if d else None) or (origin_map.get(f) or {}).get("built_by"),
                    "origin_module": ("FeatureStore" if d else None) or (origin_map.get(f) or {}).get("origin_module"),
                    "construction_source": (
                        "DERIVED"
                        if ((origin_map.get(f) or {}).get("origin_module") in ["_add_derived_features"] or (origin_map.get(f) or {}).get("family") == "derived")
                        else ("EXTERNAL" if (d and getattr(d, "sql_query", None)) else "ENGINEERED")
                    ),
                }
            )
        return {"success": True, "features": rows, "dataset_version": dataset_version, "timestamp": now_iso()}

    def feature_explanation(self, feature_name: str):
        feature_name = str(feature_name or "").strip()
        if not feature_name:
            return {"success": False, "error": "feature is required"}

        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            if len(cols_df) == 0 or feature_name not in cols_df["name"].tolist():
                return {"success": False, "error": "Unknown feature"}
            feature_meta, _typology_desc = self._feature_metadata(conn)
            meta = feature_meta.get(feature_name) or {}
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()

        def _title_case_words(s: str) -> str:
            return " ".join([w[:1].upper() + w[1:] if w else "" for w in str(s or "").split()])

        def _parse_window(label: str | None):
            w = str(label or "").strip().lower()
            if w.endswith("d"):
                try:
                    n = int(w[:-1])
                    if n == 1:
                        return {"spec": "1d", "label": "last 24 hours"}
                    return {"spec": f"{n}d", "label": f"last {n} days"}
                except Exception:
                    return None
            if w.endswith("h"):
                try:
                    n = int(w[:-1])
                    if n == 1:
                        return {"spec": "1h", "label": "last 1 hour"}
                    return {"spec": f"{n}h", "label": f"last {n} hours"}
                except Exception:
                    return None
            return None

        def _infer_window_from_name(name: str, fallback: str | None):
            n = str(name or "").lower()
            for key in ["1h", "24h", "7d", "30d", "90d", "180d"]:
                if f"_{key}" in n or n.endswith(key) or n.endswith(f"{key}_flag"):
                    return _parse_window(key)
            return _parse_window(fallback) if fallback else None

        def _infer_tables_and_columns(name: str):
            n = str(name or "").lower()
            tables = []
            cols = set(["account_id"])
            if "device" in n or "ip_" in n or "vpn" in n or "login" in n or "geo_" in n:
                tables.append("transactions")
                cols |= {"timestamp", "device_id", "ip_address"}
            elif "network" in n or "pagerank" in n or "centrality" in n or "cycle" in n or "counterparty" in n:
                tables.append("transactions")
                cols |= {"timestamp", "counterparty_account", "direction"}
            elif "tx_" in n or "amount" in n or "inbound" in n or "outbound" in n or "pass_through" in n or "funds_" in n:
                tables.append("transactions")
                cols |= {"timestamp", "direction", "amount"}
                if "counterparty" in n:
                    cols.add("counterparty_account")
            else:
                tables.append("accounts")
            if "accounts" in tables:
                cols |= {"account_open_date", "customer_type", "risk_rating", "occupation", "expected_turnover"}
            if "transactions" in tables:
                cols.add("timestamp")
            tables = list(dict.fromkeys(tables))
            return {"tables": tables, "columns": sorted([c for c in cols if c])}

        def _infer_measured(name: str):
            n = str(name or "").lower()
            if n.endswith("_flag"):
                return {"kind": "indicator", "aggregation": "flag", "unit": None}
            if "ratio" in n:
                return {"kind": "ratio", "aggregation": "ratio", "unit": None}
            if "avg" in n or "mean" in n:
                return {"kind": "average", "aggregation": "average", "unit": None}
            if "unique" in n or "nunique" in n or "distinct" in n:
                return {"kind": "unique count", "aggregation": "unique", "unit": "count"}
            if "count" in n or n.startswith("tx_count"):
                return {"kind": "count", "aggregation": "count", "unit": "count"}
            if "amount" in n or n.startswith("inbound_amount") or n.startswith("outbound_amount"):
                return {"kind": "total amount", "aggregation": "sum", "unit": "currency amount"}
            if "time" in n or "gap" in n:
                return {"kind": "time gap", "aggregation": "average", "unit": "time"}
            return {"kind": "behavior metric", "aggregation": None, "unit": None}

        def _infer_direction(name: str):
            n = str(name or "").lower()
            if "inbound" in n or n.startswith("inbound_"):
                return "inbound"
            if "outbound" in n or n.startswith("outbound_"):
                return "outbound"
            return "both"

        def _default_business_meaning(name: str, measured: dict, direction: str, window_label: str | None):
            n = str(name or "").lower()
            wl = window_label or "a recent time window"
            if n == "inbound_amount_24h":
                return "High inbound volume over a short window can indicate the account is receiving funds from multiple sources for rapid onward movement."
            if n == "funds_exit_within_1h_flag":
                return "Rapid movement of funds after receipt is a common mule behavior used to reduce traceability and break the audit trail."
            if n == "shared_device_flag":
                return "Multiple accounts linked to the same device can indicate account farming, control by a single operator, or coordinated mule activity."
            if measured.get("kind") == "ratio":
                return "Ratios highlight imbalances that can indicate pass-through behavior, layering, or anomalous movement patterns."
            if measured.get("kind") == "unique count":
                return "High counterparty diversity can indicate structuring, account-as-a-hub activity, or money-mule collection behavior."
            if measured.get("kind") == "count":
                return "Unusually high transaction volume can indicate rapid cycling of funds, structuring, or automation."
            if measured.get("kind") == "total amount" and direction == "inbound":
                return f"High inbound totals over {wl} can indicate the account is being used to receive third-party funds."
            if measured.get("kind") == "total amount" and direction == "outbound":
                return f"High outbound totals over {wl} can indicate dispersal of funds, potential layering, or rapid cash-out behavior."
            if "device" in n or "ip_" in n:
                return "Device and access signals help detect shared control, location inconsistencies, and coordinated activity across accounts."
            if "network" in n or "centrality" in n or "pagerank" in n:
                return "Network structure signals help identify hub accounts and orchestrators in mule networks."
            return "This feature captures account behavior that may indicate mule activity depending on context."

        def _default_high_value_meaning(measured: dict, direction: str):
            k = measured.get("kind")
            if k == "indicator":
                return "A value of 1 means the suspicious condition was observed; 0 means it was not observed."
            if k == "ratio":
                return "A higher ratio indicates a stronger imbalance between the compared behaviors."
            if k == "unique count":
                return "A higher value means the account interacted with more distinct counterparties."
            if k == "count":
                return "A higher value means more transactions occurred in the window."
            if k == "total amount":
                if direction == "inbound":
                    return "A higher value means more funds were received in the window."
                if direction == "outbound":
                    return "A higher value means more funds were sent in the window."
                return "A higher value means more total funds moved in the window."
            if k == "time gap":
                return "A higher value means longer time between relevant events; a lower value means faster movement."
            return "A higher value indicates more of the measured behavior."

        window = _infer_window_from_name(feature_name, meta.get("window"))
        measured = _infer_measured(feature_name)
        direction = _infer_direction(feature_name)
        schema = _infer_tables_and_columns(feature_name)

        desc = meta.get("business_description")
        if desc is not None and str(desc).strip():
            business_meaning = str(desc).strip()
        else:
            business_meaning = _default_business_meaning(feature_name, measured, direction, window.get("label") if window else None)

        expected_dir = meta.get("expected_risk_direction")
        suspicious_direction = None
        if expected_dir:
            suspicious_direction = str(expected_dir)
        else:
            if measured.get("kind") == "time gap":
                suspicious_direction = "LOWER_MORE_SUSPICIOUS"
            elif measured.get("kind") in ["indicator", "count", "unique count", "total amount", "ratio"]:
                suspicious_direction = "HIGHER_MORE_SUSPICIOUS"

        typology = meta.get("typology")
        typology_label = _title_case_words(typology) if typology else None

        if feature_name == "inbound_amount_24h":
            display = "Total funds received by the account in the last 24 hours."
        elif feature_name == "funds_exit_within_1h_flag":
            display = "Indicates whether funds left the account within 1 hour of receipt."
        elif feature_name == "shared_device_flag":
            display = "Device linked to more than one account."
        else:
            base = feature_name.replace("_", " ").strip()
            display = _title_case_words(base)

        return {
            "success": True,
            "feature_name": feature_name,
            "dataset_version": dataset_version,
            "timestamp": now_iso(),
            "explanation": {
                "display_name": display,
                "typology": typology_label,
                "data_used": {
                    "tables": schema["tables"],
                    "columns": schema["columns"],
                    "entity_level": meta.get("entity_level") or "account",
                    "data_source": meta.get("data_source") or None,
                },
                "time_logic": {
                    "window": window.get("label") if window else (meta.get("window") or None),
                    "reference": "relative to the latest transaction timestamp in the dataset",
                },
                "what_was_measured": {
                    "measure": measured.get("kind"),
                    "aggregation": measured.get("aggregation"),
                    "direction": direction,
                },
                "business_meaning": business_meaning,
                "high_value_means": _default_high_value_meaning(measured, direction),
                "suspicious_direction": suspicious_direction,
            },
        }

    def feature_correlations(self, feature_name: str, limit: int = 10):
        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            if len(cols_df) == 0 or feature_name not in cols_df["name"].tolist():
                return {"success": False, "error": "Unknown feature"}
            df = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()

        if len(df) == 0 or feature_name not in df.columns:
            return {"success": True, "has_results": False, "correlations": [], "dataset_version": dataset_version, "timestamp": now_iso()}

        base = pd.to_numeric(df[feature_name], errors="coerce")
        if base.isna().all():
            return {"success": True, "has_results": False, "correlations": [], "dataset_version": dataset_version, "timestamp": now_iso()}

        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        numeric_cols = [c for c in numeric_cols if c not in ["computed_at"] and c != feature_name]
        rows = []
        for c in numeric_cols:
            s = pd.to_numeric(df[c], errors="coerce")
            if s.isna().all():
                continue
            corr = base.corr(s)
            if pd.isna(corr):
                continue
            rows.append({"feature_name": c, "corr": float(corr)})
        rows.sort(key=lambda x: abs(x["corr"]), reverse=True)
        rows = rows[: max(0, int(limit))]
        return {"success": True, "has_results": True, "feature_name": feature_name, "correlations": rows, "dataset_version": dataset_version, "timestamp": now_iso()}

    def feature_profile(self, feature_name: str, run_id: str | None = None, target_name: str | None = None):
        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            if feature_name not in cols_df["name"].tolist():
                return {"success": False, "error": "Unknown feature"}
            data = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            target_col = self._resolve_target_column(conn, target_name)
            if target_col:
                labels = conn.execute(
                    f'SELECT account_id, "{target_col}" AS target FROM mule_accounts_raw WHERE environment_id = ?',
                    [self.env_id],
                ).df()
            else:
                labels = pd.DataFrame(columns=["account_id", "target"])
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
                        "p02": float(s.quantile(0.02)),
                        "p98": float(s.quantile(0.98)),
                    }
                )
            bins = []
            if len(s):
                counts, edges = np.histogram(s, bins=10)
                for i in range(len(counts)):
                    bins.append({"start": float(edges[i]), "end": float(edges[i + 1]), "count": int(counts[i])})
            profile["bins"] = bins

            if len(data) and len(labels) and "target" in labels.columns and "account_id" in data.columns:
                merged = data[["account_id", feature_name]].merge(labels, on="account_id", how="left")
                y = pd.to_numeric(merged["target"], errors="coerce").fillna(0).astype(int)
                iv_res = self._iv_woe(merged[feature_name], y, bins=10)
                if iv_res:
                    profile["iv"] = iv_res.get("iv")
                    profile["woe_bins"] = iv_res.get("woe_bins")
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

    def feature_leakage(self, feature_name: str, target_name: str | None = None):
        conn, _paths = self._conn()
        try:
            target_col = self._resolve_target_column(conn, target_name)
            target_sql = f'"{target_col}"' if target_col else None
            data = conn.execute(
                f"SELECT f.*, a.{target_sql} AS target FROM mule_account_features f LEFT JOIN mule_accounts_raw a ON a.environment_id = f.environment_id AND a.account_id = f.account_id WHERE f.environment_id = ?"
                if target_sql
                else "SELECT f.* FROM mule_account_features f WHERE f.environment_id = ?",
                [self.env_id],
            ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()
        if feature_name not in data.columns:
            return {"success": False, "error": "Unknown feature"}
        if "target" not in data.columns:
            return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
        y = pd.to_numeric(data["target"], errors="coerce").fillna(0).astype(int)
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
            feature_defs = self._feature_definitions()
            d = feature_defs.get(feature_name) if isinstance(feature_defs, dict) else None
            lineage = {
                "feature_name": feature_name,
                "latest_run_id": runs[0]["run_id"] if runs else None,
                "dataset_version": dataset_version,
                "source_tables": ["mule_transactions_raw", "mule_accounts_raw"],
                "output_table": "mule_account_features",
                "pipeline": ["raw", "aggregate", "normalize", "score"],
                "definition_sql": getattr(d, "sql_query", None) if d else None,
            }
        finally:
            conn.close()
        return {"success": True, "lineage": lineage, "timestamp": now_iso()}

    def feature_governance_history(self, feature_name: str, limit: int = 50):
        conn, _paths = self._conn()
        try:
            df = conn.execute(
                """
                SELECT feature_name, version, status, owner, comment, updated_at
                FROM mule_feature_governance
                WHERE environment_id = ? AND feature_name = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                [self.env_id, feature_name, int(limit)],
            ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()
        return {"success": True, "feature_name": feature_name, "history": df.to_dict("records"), "dataset_version": dataset_version, "timestamp": now_iso()}

    def feature_extremes(self, feature_name: str, limit: int = 20):
        conn, _paths = self._conn()
        try:
            cols_df = conn.execute("PRAGMA table_info('mule_account_features')").df()
            if feature_name not in cols_df["name"].tolist():
                return {"success": False, "error": "Unknown feature"}
            df = conn.execute(
                f"""
                SELECT f.account_id,
                       TRY_CAST(f."{feature_name}" AS DOUBLE) AS value,
                       a.customer_id,
                       a.customer_type,
                       a.risk_rating,
                       a.is_mule
                FROM mule_account_features f
                LEFT JOIN mule_accounts_raw a
                  ON a.environment_id = f.environment_id AND a.account_id = f.account_id
                WHERE f.environment_id = ? AND f."{feature_name}" IS NOT NULL
                """,
                [self.env_id],
            ).df()
            dataset_version = self._dataset_version(conn)
        finally:
            conn.close()
        if len(df) == 0 or "value" not in df.columns:
            return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
        df = df.dropna(subset=["value"])
        df_sorted = df.sort_values("value", ascending=False)
        high = df_sorted.head(int(limit)).to_dict("records")
        low = df_sorted.tail(int(limit)).sort_values("value", ascending=True).to_dict("records")
        return {
            "success": True,
            "has_results": True,
            "feature_name": feature_name,
            "top_high": high,
            "top_low": low,
            "dataset_version": dataset_version,
            "timestamp": now_iso(),
        }


def json_load(value):
    try:
        return json.loads(value) if value else {}
    except Exception:
        return {}


def now_iso():
    return datetime.now().isoformat()
