import duckdb
import pandas as pd
import numpy as np
from datetime import datetime

from services.mule_detection.db_service import get_md_db_service


class MuleInferenceService:
    def __init__(self, env_id: str):
        self.env_id = env_id
        self.md_db = get_md_db_service()

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

    def _feature_version(self, conn: duckdb.DuckDBPyConnection):
        row = conn.execute(
            "SELECT MAX(computed_at) FROM mule_account_features WHERE environment_id = ?",
            [self.env_id],
        ).fetchone()
        return str(row[0]) if row and row[0] is not None else None

    def _active_model_version(self, conn: duckdb.DuckDBPyConnection):
        row = conn.execute(
            """
            SELECT model_version
            FROM mule_models
            WHERE environment_id = ? AND active = TRUE
            ORDER BY trained_at DESC
            LIMIT 1
            """,
            [self.env_id],
        ).fetchone()
        if row and row[0]:
            return str(row[0])
        row = conn.execute(
            """
            SELECT model_version
            FROM mule_models
            WHERE environment_id = ?
            ORDER BY trained_at DESC
            LIMIT 1
            """,
            [self.env_id],
        ).fetchone()
        return str(row[0]) if row and row[0] else None

    def _latest_two_score_ts(self, conn: duckdb.DuckDBPyConnection):
        rows = conn.execute(
            """
            SELECT DISTINCT created_at
            FROM mule_ml_scores
            WHERE environment_id = ?
            ORDER BY created_at DESC
            LIMIT 2
            """,
            [self.env_id],
        ).fetchall()
        latest = rows[0][0] if len(rows) > 0 else None
        prev = rows[1][0] if len(rows) > 1 else None
        return latest, prev

    def _latest_run_meta(self, conn: duckdb.DuckDBPyConnection):
        row = conn.execute(
            """
            SELECT run_id, data_version, config_version, created_at
            FROM mule_module_runs
            WHERE environment_id = ? AND module = 'ml_inference'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [self.env_id],
        ).fetchone()
        if not row:
            return None
        run_id, data_version, config_version, created_at = row
        return {
            "run_id": run_id,
            "data_version": data_version,
            "config_version": config_version,
            "timestamp": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
        }

    def _latest_approval(self, conn: duckdb.DuckDBPyConnection, model_version: str | None):
        if not model_version:
            return None
        row = conn.execute(
            """
            SELECT approval_id, reviewer, decision, comments, valid_until, created_at
            FROM mule_ml_model_approvals
            WHERE environment_id = ? AND model_version = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            [self.env_id, model_version],
        ).fetchone()
        if not row:
            return None
        approval_id, reviewer, decision, comments, valid_until, created_at = row
        return {
            "approval_id": approval_id,
            "reviewer": reviewer,
            "decision": decision,
            "comments": comments,
            "valid_until": str(valid_until) if valid_until is not None else None,
            "timestamp": created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at),
        }

    def run_context(self, thresholds: dict | None = None, population: dict | None = None):
        thresholds = thresholds or {"high": 0.7, "medium": 0.4}
        population = population or {}
        conn, paths = self._conn()
        try:
            dataset_version = self._dataset_version(conn)
            feature_version = self._feature_version(conn)
            active_model = self._active_model_version(conn)
            run_meta = self._latest_run_meta(conn)
            approval = self._latest_approval(conn, active_model)
            model_path = None
            if active_model:
                row = conn.execute(
                    "SELECT model_path FROM mule_models WHERE environment_id = ? AND model_version = ?",
                    [self.env_id, active_model],
                ).fetchone()
                model_path = str(row[0]) if row and row[0] else None
        finally:
            conn.close()

        warnings = []
        if run_meta and active_model and run_meta.get("config_version") and str(run_meta["config_version"]) != str(active_model):
            warnings.append("MODEL_VERSION_MISMATCH")
        if not approval:
            warnings.append("NO_APPROVAL_REFERENCE")

        return {
            "success": True,
            "run": {
                "run_id": (run_meta or {}).get("run_id"),
                "timestamp": (run_meta or {}).get("timestamp"),
                "dataset_version": dataset_version,
                "feature_version": feature_version,
                "model_version": active_model,
                "thresholds": thresholds,
                "population": population,
                "approval": approval,
                "lineage": {
                    "model_path": model_path,
                    "features_table": "mule_account_features",
                    "scores_table": "mule_ml_scores",
                },
                "warnings": warnings,
            },
            "timestamp": now_iso(),
        }

    def portfolio_outcome(self, thresholds: dict | None = None):
        thresholds = thresholds or {"high": 0.7, "medium": 0.4}
        high_t = float(thresholds.get("high", 0.7))
        med_t = float(thresholds.get("medium", 0.4))
        conn, _paths = self._conn()
        try:
            latest_ts, prev_ts = self._latest_two_score_ts(conn)
            dataset_version = self._dataset_version(conn)
            model_version = self._active_model_version(conn)
            feature_version = self._feature_version(conn)
            if latest_ts is None:
                return {
                    "success": True,
                    "has_results": False,
                    "dataset_version": dataset_version,
                    "timestamp": now_iso(),
                }
            latest = conn.execute(
                """
                SELECT account_id, ml_score
                FROM mule_ml_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            prev = pd.DataFrame()
            if prev_ts is not None:
                prev = conn.execute(
                    """
                    SELECT account_id, ml_score AS prev_score
                    FROM mule_ml_scores
                    WHERE environment_id = ? AND created_at = ?
                    """,
                    [self.env_id, prev_ts],
                ).df()
        finally:
            conn.close()

        if len(prev) == 0 or "account_id" not in prev.columns:
            df = latest.copy()
            df["prev_score"] = df["ml_score"]
        else:
            df = latest.merge(prev, on="account_id", how="left")
            df["prev_score"] = df["prev_score"].fillna(df["ml_score"])
        df["risk_delta"] = df["ml_score"] - df["prev_score"]

        def _bucket(s):
            if s >= high_t:
                return "HIGH"
            if s >= med_t:
                return "MEDIUM"
            return "LOW"

        df["risk_level"] = df["ml_score"].apply(_bucket)
        df["prev_level"] = df["prev_score"].apply(_bucket)

        total = int(len(df))
        high = int((df["risk_level"] == "HIGH").sum())
        med = int((df["risk_level"] == "MEDIUM").sum())
        low = int((df["risk_level"] == "LOW").sum())
        new_high = int(((df["risk_level"] == "HIGH") & (df["prev_level"] != "HIGH")).sum())
        upgrades = int((df["risk_level"] > df["prev_level"]).sum()) if False else int(
            ((df["prev_level"] == "LOW") & (df["risk_level"].isin(["MEDIUM", "HIGH"]))).sum()
            + ((df["prev_level"] == "MEDIUM") & (df["risk_level"] == "HIGH")).sum()
        )
        downgrades = int(
            ((df["prev_level"] == "HIGH") & (df["risk_level"].isin(["MEDIUM", "LOW"]))).sum()
            + ((df["prev_level"] == "MEDIUM") & (df["risk_level"] == "LOW")).sum()
        )
        suppression_candidates = int((df["ml_score"] < 0.2).sum())

        bins = np.linspace(0.0, 1.0, 11)
        hist, edges = np.histogram(df["ml_score"].astype(float).clip(0, 1), bins=bins)
        histogram = []
        for i in range(len(hist)):
            histogram.append({"start": float(edges[i]), "end": float(edges[i + 1]), "count": int(hist[i])})

        return {
            "success": True,
            "has_results": True,
            "summary": {
                "total_scored": total,
                "high": high,
                "medium": med,
                "low": low,
                "new_high": new_high,
                "risk_upgrades": upgrades,
                "risk_downgrades": downgrades,
                "suppression_candidates": suppression_candidates,
            },
            "histogram": histogram,
            "metadata": {
                "dataset_version": dataset_version,
                "model_version": model_version,
                "feature_version": feature_version,
                "score_timestamp": str(latest_ts),
            },
            "timestamp": now_iso(),
        }

    def _cluster_ids(self, tx_df: pd.DataFrame):
        if len(tx_df) == 0:
            return {}
        cols = set(tx_df.columns)
        if "account_id" not in cols or "counterparty_account" not in cols:
            return {}
        nodes = pd.concat([tx_df["account_id"].astype(str), tx_df["counterparty_account"].astype(str)]).dropna().unique().tolist()
        parent = {n: n for n in nodes}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

        for _, r in tx_df[["account_id", "counterparty_account"]].dropna().iterrows():
            a = str(r["account_id"])
            b = str(r["counterparty_account"])
            if a and b:
                union(a, b)

        roots = {}
        for n in nodes:
            roots[n] = find(n)
        root_to_id = {}
        out = {}
        next_id = 1
        for n, root in roots.items():
            if root not in root_to_id:
                root_to_id[root] = f"C{next_id:04d}"
                next_id += 1
            out[n] = root_to_id[root]
        return out

    def _role_for_row(self, r: dict):
        pt = float(r.get("pass_through_ratio") or 0.0)
        hold = float(r.get("holding_time_avg") or 999.0)
        fin = float(r.get("fan_in_score") or 0.0)
        fout = float(r.get("fan_out_score") or 0.0)
        rapid = float(r.get("rapid_turnover_score") or 0.0)
        new_ben = float(r.get("unique_receivers") or r.get("unique_outbound_counterparties_30d") or 0.0)

        if pt >= 0.9 and hold <= 6 and rapid >= 0.2:
            return "pass-through mule"
        if fin >= 0.7 and fout >= 0.7:
            return "transit node"
        if fin >= 0.9 and new_ben >= 10:
            return "aggregator"
        if fout >= 0.9 and new_ben >= 10:
            return "recruiter"
        return "unknown"

    def _top_driver(self, r: dict):
        candidates = [
            ("pass_through_ratio", "High pass-through"),
            ("holding_time_avg", "Fast turnover"),
            ("activity_spike", "Activity spike"),
            ("fan_in_score", "High fan-in"),
            ("fan_out_score", "High fan-out"),
            ("shared_device_flag", "Shared device"),
            ("vpn_proxy_flag", "VPN/proxy"),
        ]
        best = None
        best_val = -1e9
        for key, label in candidates:
            v = r.get(key)
            if v is None:
                continue
            try:
                fv = float(v)
            except Exception:
                fv = 0.0
            if key == "holding_time_avg":
                fv = -fv
            if fv > best_val:
                best_val = fv
                best = label
        return best or "Model score"

    def accounts_prioritized(self, thresholds: dict | None = None, filters: dict | None = None, limit: int = 500):
        thresholds = thresholds or {"high": 0.7, "medium": 0.4}
        filters = filters or {}
        high_t = float(thresholds.get("high", 0.7))
        med_t = float(thresholds.get("medium", 0.4))

        conn, _paths = self._conn()
        try:
            latest_ts, prev_ts = self._latest_two_score_ts(conn)
            dataset_version = self._dataset_version(conn)
            model_version = self._active_model_version(conn)
            feature_version = self._feature_version(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "accounts": [], "timestamp": now_iso()}

            latest = conn.execute(
                """
                SELECT account_id, ml_score, model_version, created_at
                FROM mule_ml_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            prev = pd.DataFrame()
            if prev_ts is not None:
                prev = conn.execute(
                    """
                    SELECT account_id, ml_score AS prev_score, created_at AS prev_created_at
                    FROM mule_ml_scores
                    WHERE environment_id = ? AND created_at = ?
                    """,
                    [self.env_id, prev_ts],
                ).df()
            else:
                prev = pd.DataFrame(columns=["account_id", "prev_score", "prev_created_at"])
            feats = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            tx = conn.execute(
                """
                SELECT account_id, counterparty_account, direction, amount, txn_timestamp, device_id
                FROM mule_transactions_raw
                WHERE environment_id = ?
                """,
                [self.env_id],
            ).df()
            assigns = conn.execute(
                """
                SELECT account_id, investigator, MAX(assigned_at) AS assigned_at
                FROM mule_inference_assignments
                WHERE environment_id = ?
                GROUP BY account_id, investigator
                """,
                [self.env_id],
            ).df()
        finally:
            conn.close()

        cluster_map = self._cluster_ids(tx)
        def _normalize(df: pd.DataFrame) -> pd.DataFrame:
            if df is None:
                return pd.DataFrame()
            out = df.copy()
            out.columns = [str(c).strip().lower() for c in out.columns]
            if "account_id" not in out.columns:
                for alt in ["acct_id", "account", "accountid"]:
                    if alt in out.columns:
                        out = out.rename(columns={alt: "account_id"})
                        break
            return out

        latest = _normalize(latest)
        prev = _normalize(prev)
        feats = _normalize(feats)
        assigns = _normalize(assigns)

        if "account_id" not in latest.columns:
            return {"success": True, "has_results": False, "accounts": [], "timestamp": now_iso(), "error": "scores_missing_account_id"}
        if "account_id" not in prev.columns:
            prev = pd.DataFrame(columns=["account_id", "prev_score", "prev_created_at"])
        if "account_id" not in feats.columns:
            feats = pd.DataFrame()
        if "account_id" not in assigns.columns:
            assigns = pd.DataFrame()

        df = latest.merge(prev, on="account_id", how="left")
        if len(feats):
            df = df.merge(feats, on="account_id", how="left", suffixes=("", "_feat"))
        if len(assigns):
            df = df.merge(assigns[["account_id", "investigator"]], on="account_id", how="left")

        df["prev_score"] = df["prev_score"].fillna(df["ml_score"])
        df["risk_delta"] = df["ml_score"] - df["prev_score"]

        def _bucket(s):
            if float(s or 0.0) >= high_t:
                return "HIGH"
            if float(s or 0.0) >= med_t:
                return "MEDIUM"
            return "LOW"

        df["risk_level"] = df["ml_score"].apply(_bucket)
        df["prev_level"] = df["prev_score"].apply(_bucket)

        movement = []
        for _, r in df.iterrows():
            tag = "stable"
            if pd.isna(r.get("prev_created_at")):
                tag = "new"
            elif r.get("risk_level") == "HIGH" and r.get("prev_level") != "HIGH":
                tag = "new high"
            elif float(r.get("risk_delta") or 0.0) >= 0.15:
                tag = "rising fast"
            elif float(r.get("risk_delta") or 0.0) <= -0.15:
                tag = "cooling"
            movement.append(tag)
        df["movement"] = movement

        df["network_cluster_id"] = df["account_id"].astype(str).map(cluster_map).fillna("C0000")
        df["probable_role"] = df.apply(lambda r: self._role_for_row(r.to_dict()), axis=1)
        df["top_driver"] = df.apply(lambda r: self._top_driver(r.to_dict()), axis=1)

        df["velocity_spike"] = df.get("activity_spike") if "activity_spike" in df.columns else None
        df["pass_through_indicator"] = df.get("pass_through_ratio") if "pass_through_ratio" in df.columns else None
        df["new_beneficiaries"] = df.get("unique_receivers") if "unique_receivers" in df.columns else df.get("unique_outbound_counterparties_30d")
        df["device_sharing"] = df.get("shared_device_flag") if "shared_device_flag" in df.columns else df.get("accounts_per_device")

        df["sla_aging_days"] = None
        if "prev_created_at" in df.columns and df["prev_created_at"].notna().any():
            df["sla_aging_days"] = (pd.to_datetime(latest_ts) - pd.to_datetime(df["prev_created_at"])).dt.days

        def _decision(level, score):
            s = float(score or 0.0)
            if level == "HIGH":
                return "escalate"
            if level == "MEDIUM":
                return "review"
            if s < 0.2:
                return "suppress"
            return "review"

        df["decision"] = df.apply(lambda r: _decision(r.get("risk_level"), r.get("ml_score")), axis=1)

        if filters.get("risk_level"):
            df = df[df["risk_level"] == filters["risk_level"]]
        if filters.get("movement"):
            df = df[df["movement"] == filters["movement"]]
        if filters.get("pattern"):
            df = self._apply_pattern_filter(df, filters["pattern"])
        if filters.get("cluster_id"):
            df = df[df["network_cluster_id"] == filters["cluster_id"]]
        if filters.get("investigator"):
            df = df[df["investigator"] == filters["investigator"]]

        df["operational_risk"] = (
            df["ml_score"].astype(float) * 100
            + df["risk_delta"].astype(float).fillna(0) * 50
            + df["sla_aging_days"].fillna(0) * 1
        )
        df = df.sort_values("operational_risk", ascending=False).head(int(limit))

        out = []
        for _, r in df.iterrows():
            out.append(
                {
                    "account_id": r.get("account_id"),
                    "risk_score": float(r.get("ml_score") or 0.0),
                    "risk_level": r.get("risk_level"),
                    "decision": r.get("decision"),
                    "risk_delta": float(r.get("risk_delta") or 0.0),
                    "velocity_spike": r.get("velocity_spike"),
                    "pass_through_indicator": r.get("pass_through_indicator"),
                    "new_beneficiaries": r.get("new_beneficiaries"),
                    "device_sharing": r.get("device_sharing"),
                    "network_cluster_id": r.get("network_cluster_id"),
                    "probable_role": r.get("probable_role"),
                    "top_driver": r.get("top_driver"),
                    "sla_aging_days": r.get("sla_aging_days"),
                    "assigned_investigator": r.get("investigator"),
                    "movement": r.get("movement"),
                }
            )

        return {
            "success": True,
            "has_results": True,
            "accounts": out,
            "metadata": {
                "dataset_version": dataset_version,
                "model_version": model_version,
                "feature_version": feature_version,
                "score_timestamp": str(latest_ts),
            },
            "timestamp": now_iso(),
        }

    def _apply_pattern_filter(self, df: pd.DataFrame, pattern: str):
        p = str(pattern or "").lower()
        if p in ["rapid_in_out", "rapid-in-out", "rapid"]:
            if "funds_exit_within_1h_flag" in df.columns:
                return df[df["funds_exit_within_1h_flag"] > 0]
            if "rapid_turnover_score" in df.columns:
                return df[df["rapid_turnover_score"] > 0.2]
        if p in ["burst_senders", "burst"]:
            if "tx_count_24h" in df.columns:
                return df[df["tx_count_24h"] >= 10]
            if "activity_spike" in df.columns:
                return df[df["activity_spike"] > 0]
        if p in ["fan_out_growth", "fanout"]:
            if "fan_out_score" in df.columns:
                return df[df["fan_out_score"] >= 0.7]
        if p in ["shared_devices", "device"]:
            if "shared_device_flag" in df.columns:
                return df[df["shared_device_flag"] > 0]
            if "accounts_per_device" in df.columns:
                return df[df["accounts_per_device"] >= 2]
        if p in ["circular_flows", "circular"]:
            if "round_tripping_flag" in df.columns:
                return df[df["round_tripping_flag"] > 0]
        return df

    def accounts_movement(self, thresholds: dict | None = None):
        thresholds = thresholds or {"high": 0.7, "medium": 0.4}
        high_t = float(thresholds.get("high", 0.7))
        med_t = float(thresholds.get("medium", 0.4))
        conn, _paths = self._conn()
        try:
            latest_ts, prev_ts = self._latest_two_score_ts(conn)
            dataset_version = self._dataset_version(conn)
            if latest_ts is None or prev_ts is None:
                return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
            latest = conn.execute(
                """
                SELECT account_id, ml_score
                FROM mule_ml_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            prev = conn.execute(
                """
                SELECT account_id, ml_score AS prev_score
                FROM mule_ml_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, prev_ts],
            ).df()
        finally:
            conn.close()

        df = latest.merge(prev, on="account_id", how="left")
        df["prev_score"] = df["prev_score"].fillna(df["ml_score"])
        df["risk_delta"] = df["ml_score"] - df["prev_score"]

        def _bucket(s):
            if float(s or 0.0) >= high_t:
                return "HIGH"
            if float(s or 0.0) >= med_t:
                return "MEDIUM"
            return "LOW"

        df["risk_level"] = df["ml_score"].apply(_bucket)
        df["prev_level"] = df["prev_score"].apply(_bucket)

        movement = {
            "new_high": int(((df["risk_level"] == "HIGH") & (df["prev_level"] != "HIGH")).sum()),
            "rising_fast": int((df["risk_delta"] >= 0.15).sum()),
            "cooling": int((df["risk_delta"] <= -0.15).sum()),
            "stable": int(((df["risk_delta"].abs() < 0.05)).sum()),
        }
        upgrades = int(
            ((df["prev_level"] == "LOW") & (df["risk_level"].isin(["MEDIUM", "HIGH"]))).sum()
            + ((df["prev_level"] == "MEDIUM") & (df["risk_level"] == "HIGH")).sum()
        )
        downgrades = int(
            ((df["prev_level"] == "HIGH") & (df["risk_level"].isin(["MEDIUM", "LOW"]))).sum()
            + ((df["prev_level"] == "MEDIUM") & (df["risk_level"] == "LOW")).sum()
        )

        return {
            "success": True,
            "has_results": True,
            "movement": movement,
            "risk_upgrades": upgrades,
            "risk_downgrades": downgrades,
            "timestamp": now_iso(),
        }

    def portfolio_patterns(self):
        conn, _paths = self._conn()
        try:
            latest_ts, _prev_ts = self._latest_two_score_ts(conn)
            dataset_version = self._dataset_version(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "dataset_version": dataset_version, "patterns": [], "timestamp": now_iso()}
            df = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()
        patterns = []
        if len(df):
            if "funds_exit_within_1h_flag" in df.columns:
                c = int((pd.to_numeric(df["funds_exit_within_1h_flag"], errors="coerce").fillna(0) > 0).sum())
                patterns.append({"id": "rapid_in_out", "title": "Accounts with rapid in-out", "count": c, "filter": {"pattern": "rapid_in_out"}})
            if "activity_spike" in df.columns:
                c = int((pd.to_numeric(df["activity_spike"], errors="coerce").fillna(0) > 0).sum())
                patterns.append({"id": "burst_senders", "title": "Burst senders", "count": c, "filter": {"pattern": "burst_senders"}})
            if "fan_out_score" in df.columns:
                c = int((pd.to_numeric(df["fan_out_score"], errors="coerce").fillna(0) >= 0.7).sum())
                patterns.append({"id": "fan_out_growth", "title": "Fan-out growth", "count": c, "filter": {"pattern": "fan_out_growth"}})
            if "shared_device_flag" in df.columns:
                c = int((pd.to_numeric(df["shared_device_flag"], errors="coerce").fillna(0) > 0).sum())
                patterns.append({"id": "shared_devices", "title": "Shared devices", "count": c, "filter": {"pattern": "shared_devices"}})
            if "round_tripping_flag" in df.columns:
                c = int((pd.to_numeric(df["round_tripping_flag"], errors="coerce").fillna(0) > 0).sum())
                patterns.append({"id": "circular_flows", "title": "Circular flows", "count": c, "filter": {"pattern": "circular_flows"}})

        return {"success": True, "has_results": True, "dataset_version": dataset_version, "patterns": patterns, "timestamp": now_iso()}

    def suppression_confidence(self, thresholds: dict | None = None):
        thresholds = thresholds or {"high": 0.7, "medium": 0.4}
        high_t = float(thresholds.get("high", 0.7))
        med_t = float(thresholds.get("medium", 0.4))
        conn, _paths = self._conn()
        try:
            latest_ts, _prev_ts = self._latest_two_score_ts(conn)
            dataset_version = self._dataset_version(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
            scores = conn.execute(
                """
                SELECT account_id, ml_score
                FROM mule_ml_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            labels = conn.execute(
                "SELECT account_id, is_mule FROM mule_accounts_raw WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()

        if len(scores) == 0:
            return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}

        scores["risk_level"] = scores["ml_score"].apply(lambda s: "HIGH" if float(s or 0.0) >= high_t else ("MEDIUM" if float(s or 0.0) >= med_t else "LOW"))
        suppressed = scores[scores["ml_score"] < 0.2].copy()
        expected_event_loss = None
        evidence = []
        curve = []
        if len(labels) and "is_mule" in labels.columns and len(suppressed):
            m = suppressed.merge(labels, on="account_id", how="left")
            y = pd.to_numeric(m["is_mule"], errors="coerce").fillna(0).astype(int)
            expected_event_loss = float((y == 1).sum() / max(len(m), 1))
            evidence.append({"type": "label_backtest", "metric": "mule_rate_in_suppression_candidates", "value": expected_event_loss})

        if len(labels) and "is_mule" in labels.columns:
            merged = scores.merge(labels, on="account_id", how="left")
            y_all = pd.to_numeric(merged["is_mule"], errors="coerce").fillna(0).astype(int)
            total_mules = int((y_all == 1).sum())
            for t in [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50, 0.60]:
                suppressed_mask = pd.to_numeric(merged["ml_score"], errors="coerce").fillna(0) < float(t)
                suppression_rate = float(suppressed_mask.mean())
                missed_mules = int(((y_all == 1) & suppressed_mask).sum())
                event_loss = float(missed_mules / max(total_mules, 1)) if total_mules else None
                curve.append({"threshold": float(t), "suppression": suppression_rate, "event_loss": event_loss})

        evidence.append({"type": "margin", "metric": "suppression_threshold", "value": 0.2})
        evidence.append({"type": "policy", "metric": "review_threshold_medium", "value": med_t})
        evidence.append({"type": "policy", "metric": "escalate_threshold_high", "value": high_t})

        return {
            "success": True,
            "has_results": True,
            "suppression": {
                "candidates": int(len(suppressed)),
                "expected_event_loss": expected_event_loss,
                "curve": curve,
                "why_safe": [
                    "Suppression candidates are far below the review threshold.",
                    "High-risk operational signals (rapid in-out, device sharing) should be screened before suppress.",
                ],
                "evidence": evidence,
            },
            "dataset_version": dataset_version,
            "timestamp": now_iso(),
        }

    def role_classification(self, limit: int = 2000):
        conn, _paths = self._conn()
        try:
            latest_ts, _prev_ts = self._latest_two_score_ts(conn)
            dataset_version = self._dataset_version(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "dataset_version": dataset_version, "timestamp": now_iso()}
            latest = conn.execute(
                """
                SELECT s.account_id, s.ml_score
                FROM mule_ml_scores s
                WHERE s.environment_id = ? AND s.created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            feats = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()
        df = latest.merge(feats, on="account_id", how="left") if len(feats) else latest
        df = df.head(int(limit))
        roles = []
        counts = {}
        for _, r in df.iterrows():
            role = self._role_for_row(r.to_dict())
            counts[role] = int(counts.get(role, 0) + 1)
            roles.append({"account_id": r.get("account_id"), "role": role})
        return {
            "success": True,
            "has_results": True,
            "roles": roles,
            "role_counts": counts,
            "dataset_version": dataset_version,
            "timestamp": now_iso(),
        }

    def assign_investigator(self, account_ids: list[str], investigator: str):
        inv = str(investigator or "").strip()
        if not inv:
            return {"success": False, "error": "investigator is required"}
        ids = [str(a) for a in (account_ids or []) if a]
        if not ids:
            return {"success": False, "error": "account_ids is required"}
        conn, _paths = self._conn()
        try:
            for a in ids:
                conn.execute(
                    """
                    INSERT INTO mule_inference_assignments(account_id, investigator, assigned_at, environment_id)
                    VALUES (?, ?, CURRENT_TIMESTAMP, ?)
                    """,
                    [a, inv, self.env_id],
                )
        finally:
            conn.close()
        return {"success": True, "assigned": len(ids), "investigator": inv, "timestamp": now_iso()}


def now_iso():
    return datetime.now().isoformat()
