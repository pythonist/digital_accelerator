import pandas as pd
import numpy as np
import duckdb
from datetime import datetime
from services.mule_detection.db_service import get_md_db_service


class RiskDashboardService:
    def __init__(self, env_id: str):
        self.env_id = env_id
        self.md_db = get_md_db_service()

    def _conn(self) -> tuple[duckdb.DuckDBPyConnection, dict]:
        paths = self.md_db.init_env_structure(self.env_id)
        return duckdb.connect(str(paths["duckdb"])), paths

    def _latest_two_ts(self, conn: duckdb.DuckDBPyConnection):
        rows = conn.execute(
            """
            SELECT DISTINCT created_at
            FROM mule_risk_scores
            WHERE environment_id = ?
            ORDER BY created_at DESC
            LIMIT 2
            """,
            [self.env_id],
        ).fetchall()
        latest = rows[0][0] if len(rows) > 0 else None
        prev = rows[1][0] if len(rows) > 1 else None
        return latest, prev

    def _model_version(self, conn: duckdb.DuckDBPyConnection):
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

    def _feature_version(self, conn: duckdb.DuckDBPyConnection):
        row = conn.execute(
            "SELECT MAX(computed_at) FROM mule_account_features WHERE environment_id = ?",
            [self.env_id],
        ).fetchone()
        return str(row[0]) if row and row[0] is not None else None

    def _data_timestamp(self, conn: duckdb.DuckDBPyConnection):
        row = conn.execute(
            "SELECT MAX(created_at) FROM mule_risk_scores WHERE environment_id = ?",
            [self.env_id],
        ).fetchone()
        return str(row[0]) if row and row[0] is not None else None

    def _audit_meta(self, conn: duckdb.DuckDBPyConnection):
        return {
            "data_timestamp": self._data_timestamp(conn),
            "model_version": self._model_version(conn),
            "feature_version": self._feature_version(conn),
        }

    def portfolio_summary(self):
        conn, _paths = self._conn()
        try:
            latest_ts, prev_ts = self._latest_two_ts(conn)
            meta = self._audit_meta(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "metadata": meta}

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
                [self.env_id, latest_ts],
            ).fetchone()
            total, high, med, low, avg_score, max_score = row

            new_high = 0
            if prev_ts is None:
                new_high = int(high or 0)
            else:
                new_high = int(
                    conn.execute(
                        """
                        SELECT COUNT(*)
                        FROM mule_risk_scores cur
                        LEFT JOIN mule_risk_scores prev
                          ON prev.environment_id = cur.environment_id
                         AND prev.account_id = cur.account_id
                         AND prev.created_at = ?
                        WHERE cur.environment_id = ?
                          AND cur.created_at = ?
                          AND cur.risk_level = 'HIGH'
                          AND (prev.risk_level IS NULL OR prev.risk_level != 'HIGH')
                        """,
                        [prev_ts, self.env_id, latest_ts],
                    ).fetchone()[0]
                )

            bins = conn.execute(
                """
                SELECT FLOOR(hybrid_score / 10) * 10 AS bin_start,
                       COUNT(*) AS c
                FROM mule_risk_scores
                WHERE environment_id = ? AND created_at = ?
                GROUP BY bin_start
                ORDER BY bin_start
                """,
                [self.env_id, latest_ts],
            ).fetchall()
            histogram = [
                {"start": float(b[0]), "end": float(b[0] + 10), "count": int(b[1])}
                for b in bins
            ]

            migration = []
            if prev_ts is not None:
                mig_rows = conn.execute(
                    """
                    SELECT prev.risk_level AS from_level,
                           cur.risk_level AS to_level,
                           COUNT(*) AS c
                    FROM mule_risk_scores cur
                    JOIN mule_risk_scores prev
                      ON prev.environment_id = cur.environment_id
                     AND prev.account_id = cur.account_id
                     AND prev.created_at = ?
                    WHERE cur.environment_id = ? AND cur.created_at = ?
                    GROUP BY prev.risk_level, cur.risk_level
                    """,
                    [prev_ts, self.env_id, latest_ts],
                ).fetchall()
                migration = [
                    {"from": r[0], "to": r[1], "count": int(r[2])} for r in mig_rows
                ]

            summary = {
                "total_accounts": int(total or 0),
                "high_risk_count": int(high or 0),
                "medium_risk_count": int(med or 0),
                "low_risk_count": int(low or 0),
                "average_risk_score": float(avg_score or 0.0),
                "max_risk_score": float(max_score or 0.0),
                "suppression_rate": float((low or 0) / total) if total else 0.0,
                "escalation_rate": float((high or 0) / total) if total else 0.0,
                "net_new_high_today": int(new_high),
            }
            return {
                "success": True,
                "has_results": True,
                "summary": summary,
                "histogram": histogram,
                "migration": migration,
                "metadata": meta,
            }
        finally:
            conn.close()

    def portfolio_migration(self):
        conn, _paths = self._conn()
        try:
            latest_ts, prev_ts = self._latest_two_ts(conn)
            meta = self._audit_meta(conn)
            if latest_ts is None or prev_ts is None:
                return {"success": True, "has_results": False, "metadata": meta}
            rows = conn.execute(
                """
                SELECT prev.risk_level AS from_level,
                       cur.risk_level AS to_level,
                       COUNT(*) AS c
                FROM mule_risk_scores cur
                JOIN mule_risk_scores prev
                  ON prev.environment_id = cur.environment_id
                 AND prev.account_id = cur.account_id
                 AND prev.created_at = ?
                WHERE cur.environment_id = ? AND cur.created_at = ?
                GROUP BY prev.risk_level, cur.risk_level
                """,
                [prev_ts, self.env_id, latest_ts],
            ).fetchall()
            return {
                "success": True,
                "has_results": True,
                "migration": [{"from": r[0], "to": r[1], "count": int(r[2])} for r in rows],
                "metadata": meta,
            }
        finally:
            conn.close()

    def priority_queue(self, filters: dict | None = None, limit: int = 200):
        filters = filters or {}
        conn, _paths = self._conn()
        try:
            latest_ts, prev_ts = self._latest_two_ts(conn)
            meta = self._audit_meta(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "accounts": [], "metadata": meta}

            latest = conn.execute(
                """
                SELECT account_id, hybrid_score, risk_level, ml_risk_score, pattern_risk_score,
                       confidence, decision_logic, created_at
                FROM mule_risk_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            prev = pd.DataFrame()
            if prev_ts is not None:
                prev = conn.execute(
                    """
                    SELECT account_id, hybrid_score AS prev_score, risk_level AS prev_level, created_at AS prev_created_at
                    FROM mule_risk_scores
                    WHERE environment_id = ? AND created_at = ?
                    """,
                    [self.env_id, prev_ts],
                ).df()
            else:
                prev = pd.DataFrame(columns=["account_id", "prev_score", "prev_level", "prev_created_at"])
            feats = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()

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

        if "account_id" not in latest.columns:
            return {
                "success": True,
                "has_results": False,
                "accounts": [],
                "metadata": meta,
                "error": "risk_scores_missing_account_id",
            }

        if "account_id" not in prev.columns:
            prev = pd.DataFrame(columns=["account_id", "prev_score", "prev_level", "prev_created_at"])
        if "account_id" not in feats.columns:
            feats = pd.DataFrame()

        df = latest.merge(prev, on="account_id", how="left")
        if len(feats):
            df = df.merge(feats, on="account_id", how="left", suffixes=("", "_feat"))

        df["risk_delta"] = df["hybrid_score"] - df["prev_score"].fillna(df["hybrid_score"])
        df["last_reviewed"] = df["prev_created_at"]
        if df["last_reviewed"].notna().any():
            df["aging_days"] = (pd.to_datetime(latest_ts) - pd.to_datetime(df["last_reviewed"])).dt.days
        else:
            df["aging_days"] = None

        severity_order = {"LOW": 1, "MEDIUM": 2, "HIGH": 3}
        df["prev_sev"] = df["prev_level"].map(severity_order).fillna(0)
        df["cur_sev"] = df["risk_level"].map(severity_order).fillna(0)

        tags = []
        for _, r in df.iterrows():
            t = []
            if pd.isna(r.get("prev_level")):
                t.append("NEW")
            if r.get("cur_sev", 0) > r.get("prev_sev", 0):
                t.append("ESCALATING")
            if r.get("prev_level") == "HIGH" and r.get("risk_level") in ["MEDIUM", "LOW"]:
                t.append("RETURNED")
            tags.append(t)
        df["tags"] = tags

        age_vals = df["aging_days"].dropna()
        age_threshold = float(age_vals.quantile(0.75)) if len(age_vals) else None
        if age_threshold is not None:
            df["tags"] = df.apply(
                lambda r: r["tags"] + (["AGING"] if r.get("aging_days") is not None and r["aging_days"] >= age_threshold else []),
                axis=1,
            )

        counterparty_cols = [
            "unique_inbound_counterparties_30d",
            "unique_outbound_counterparties_30d",
            "unique_receivers",
            "unique_senders",
        ]
        velocity_cols = ["velocity", "tx_count_24h", "activity_spike"]

        def _pick_col(cols):
            for c in cols:
                if c in df.columns:
                    return c
            return None

        cp_col = _pick_col(counterparty_cols)
        vel_col = _pick_col(velocity_cols)

        df["new_counterparties"] = df[cp_col] if cp_col else None
        df["velocity_change"] = df[vel_col] if vel_col else None

        if "min_score" in filters and filters["min_score"] is not None:
            df = df[df["hybrid_score"] >= float(filters["min_score"])]
        if "max_score" in filters and filters["max_score"] is not None:
            df = df[df["hybrid_score"] < float(filters["max_score"])]
        if filters.get("risk_level"):
            df = df[df["risk_level"] == filters["risk_level"]]
        if filters.get("tag"):
            df = df[df["tags"].apply(lambda t: filters["tag"] in t)]
        if filters.get("signal") and filters["signal"] in df.columns:
            col = filters["signal"]
            df = df[df[col].notna()].sort_values(col, ascending=False)

        df["urgency"] = df["cur_sev"] * 100 + df["risk_delta"].fillna(0) * 10 + df["aging_days"].fillna(0)
        df = df.sort_values("urgency", ascending=False).head(int(limit))

        out = []
        for _, r in df.iterrows():
            out.append(
                {
                    "account_id": r.get("account_id"),
                    "risk_level": r.get("risk_level"),
                    "hybrid_score": float(r.get("hybrid_score") or 0.0),
                    "risk_delta": float(r.get("risk_delta") or 0.0),
                    "key_trigger": r.get("decision_logic"),
                    "new_counterparties": r.get("new_counterparties"),
                    "velocity_change": r.get("velocity_change"),
                    "model_confidence": r.get("confidence"),
                    "aging_days": r.get("aging_days"),
                    "last_reviewed": str(r.get("last_reviewed")) if r.get("last_reviewed") is not None else None,
                    "tags": r.get("tags") or [],
                }
            )

        return {"success": True, "has_results": True, "accounts": out, "metadata": meta}

    def emerging_patterns(self):
        conn, _paths = self._conn()
        try:
            latest_ts, prev_ts = self._latest_two_ts(conn)
            meta = self._audit_meta(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "patterns": [], "metadata": meta}

            tx = conn.execute(
                """
                SELECT txn_timestamp, amount, counterparty_bank
                FROM mule_transactions_raw
                WHERE environment_id = ?
                """,
                [self.env_id],
            ).df()
            rs = conn.execute(
                """
                SELECT account_id, hybrid_score, risk_level
                FROM mule_risk_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            prev_rs = pd.DataFrame()
            if prev_ts is not None:
                prev_rs = conn.execute(
                    """
                    SELECT account_id, risk_level
                    FROM mule_risk_scores
                    WHERE environment_id = ? AND created_at = ?
                    """,
                    [self.env_id, prev_ts],
                ).df()
            feats = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()

        patterns = []
        if len(tx):
            tx["txn_timestamp"] = pd.to_datetime(tx["txn_timestamp"], errors="coerce")
            tx = tx.dropna(subset=["txn_timestamp"])
            tx["day"] = tx["txn_timestamp"].dt.date
            day_counts = tx.groupby("day").size().sort_index()
            if len(day_counts) >= 2:
                last_day = day_counts.index[-1]
                prev_day = day_counts.index[-2]
                last_val = int(day_counts.iloc[-1])
                prev_val = int(day_counts.iloc[-2])
                delta = last_val - prev_val
                patterns.append(
                    {
                        "type": "sudden_spike",
                        "title": "Sudden spike in activity",
                        "metric": last_val,
                        "delta": delta,
                        "filter": {},
                    }
                )

            if "counterparty_bank" in tx.columns:
                bank_counts = tx.groupby(["day", "counterparty_bank"]).size().reset_index(name="c")
                last_day = bank_counts["day"].max() if len(bank_counts) else None
                if last_day is not None:
                    cur = bank_counts[bank_counts["day"] == last_day].sort_values("c", ascending=False).head(1)
                    if len(cur):
                        patterns.append(
                            {
                                "type": "corridor",
                                "title": "Unusual corridor",
                                "metric": int(cur["c"].iloc[0]),
                                "delta": 0,
                                "filter": {"corridor": str(cur["counterparty_bank"].iloc[0])},
                            }
                        )

        if len(rs) and len(prev_rs):
            merged = rs.merge(prev_rs, on="account_id", how="left", suffixes=("", "_prev"))
            rising = (merged["risk_level"] != merged["risk_level_prev"]).sum()
            patterns.append(
                {
                    "type": "many_rising",
                    "title": "Many accounts rising together",
                    "metric": int(rising),
                    "delta": 0,
                    "filter": {"tag": "ESCALATING"},
                }
            )

        if len(feats) and "degree_centrality" in feats.columns and len(rs):
            merged = rs.merge(feats[["account_id", "degree_centrality"]], on="account_id", how="left")
            threshold = merged["degree_centrality"].quantile(0.75)
            count = int((merged["degree_centrality"] >= threshold).sum())
            patterns.append(
                {
                    "type": "new_clusters",
                    "title": "New mule clusters",
                    "metric": count,
                    "delta": 0,
                    "filter": {"signal": "degree_centrality"},
                }
            )

        if len(feats) and "activity_spike" in feats.columns:
            burst = int((feats["activity_spike"] > 0).sum())
            patterns.append(
                {
                    "type": "burst_behavior",
                    "title": "Burst behaviour",
                    "metric": burst,
                    "delta": 0,
                    "filter": {"signal": "activity_spike"},
                }
            )

        return {"success": True, "has_results": True, "patterns": patterns, "metadata": meta}

    def top_signals(self, limit: int = 12):
        conn, _paths = self._conn()
        try:
            latest_ts, _prev_ts = self._latest_two_ts(conn)
            meta = self._audit_meta(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "signals": [], "metadata": meta}
            rs = conn.execute(
                """
                SELECT account_id, hybrid_score
                FROM mule_risk_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            feats = conn.execute(
                "SELECT * FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()

        if len(rs) == 0 or len(feats) == 0:
            return {"success": True, "has_results": False, "signals": [], "metadata": meta}

        df = rs.merge(feats, on="account_id", how="inner")
        num_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        num_cols = [c for c in num_cols if c not in ["hybrid_score"]]
        signals = []
        for c in num_cols:
            series = df[c]
            if series.isna().all():
                continue
            corr = series.corr(df["hybrid_score"])
            if pd.isna(corr):
                continue
            threshold = series.quantile(0.9)
            impacted = int((series >= threshold).sum())
            signals.append({"feature": c, "score": float(corr), "impacted_accounts": impacted})

        signals.sort(key=lambda x: abs(x["score"]), reverse=True)
        return {"success": True, "has_results": True, "signals": signals[: int(limit)], "metadata": meta}

    def model_health(self):
        conn, _paths = self._conn()
        try:
            latest_ts, prev_ts = self._latest_two_ts(conn)
            meta = self._audit_meta(conn)
            if latest_ts is None:
                return {"success": True, "has_results": False, "health": {}, "metadata": meta}

            latest = conn.execute(
                """
                SELECT account_id, hybrid_score, risk_level, decision_logic
                FROM mule_risk_scores
                WHERE environment_id = ? AND created_at = ?
                """,
                [self.env_id, latest_ts],
            ).df()
            prev = pd.DataFrame()
            if prev_ts is not None:
                prev = conn.execute(
                    """
                    SELECT account_id, hybrid_score, risk_level
                    FROM mule_risk_scores
                    WHERE environment_id = ? AND created_at = ?
                    """,
                    [self.env_id, prev_ts],
                ).df()

            uploads = conn.execute(
                """
                SELECT uploaded_at
                FROM mule_uploads
                WHERE environment_id = ?
                ORDER BY uploaded_at DESC
                LIMIT 1
                """,
                [self.env_id],
            ).fetchone()

            rules_run = conn.execute(
                """
                SELECT created_at
                FROM mule_module_runs
                WHERE environment_id = ? AND module = 'rules'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [self.env_id],
            ).fetchone()
            ml_run = conn.execute(
                """
                SELECT created_at
                FROM mule_module_runs
                WHERE environment_id = ? AND module = 'ml_inference'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [self.env_id],
            ).fetchone()
            hybrid_run = conn.execute(
                """
                SELECT created_at
                FROM mule_module_runs
                WHERE environment_id = ? AND module = 'hybrid'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [self.env_id],
            ).fetchone()

            acc = conn.execute(
                "SELECT account_id, is_mule FROM mule_accounts_raw WHERE environment_id = ?",
                [self.env_id],
            ).df()
        finally:
            conn.close()

        score_drift = None
        if len(latest) and len(prev):
            score_drift = float(latest["hybrid_score"].mean() - prev["hybrid_score"].mean())

        override_pct = 0.0
        if "decision_logic" in latest.columns and latest["decision_logic"].notna().any():
            override_cnt = latest["decision_logic"].astype(str).str.contains("override", case=False, na=False).sum()
            override_pct = float(override_cnt / max(len(latest), 1))

        fp_rate = None
        fp_delta = None
        if len(acc) and "is_mule" in acc.columns:
            merged = latest.merge(acc, on="account_id", how="left")
            high = merged[merged["risk_level"] == "HIGH"]
            if len(high):
                fp_rate = float((high["is_mule"] == 0).sum() / len(high))
            if len(prev):
                merged_prev = prev.merge(acc, on="account_id", how="left")
                high_prev = merged_prev[merged_prev["risk_level"] == "HIGH"]
                if len(high_prev):
                    prev_fp = float((high_prev["is_mule"] == 0).sum() / len(high_prev))
                    fp_delta = fp_rate - prev_fp if fp_rate is not None else None

        freshness_days = None
        if uploads and uploads[0] is not None:
            freshness_days = int((datetime.now() - uploads[0]).days)

        health = {
            "score_drift": score_drift,
            "override_rate": override_pct,
            "false_positive_rate": fp_rate,
            "false_positive_delta": fp_delta,
            "data_freshness_days": freshness_days,
            "pipeline": {
                "rules_last_run": str(rules_run[0]) if rules_run and rules_run[0] else None,
                "ml_last_run": str(ml_run[0]) if ml_run and ml_run[0] else None,
                "hybrid_last_run": str(hybrid_run[0]) if hybrid_run and hybrid_run[0] else None,
            },
        }
        return {"success": True, "has_results": True, "health": health, "metadata": meta}
