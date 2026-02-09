import math
from datetime import datetime, timedelta

import duckdb
import numpy as np
import pandas as pd
from pathlib import Path

from modules.inference_engine import InferenceEngine
from services.mule_detection.db_service import get_md_db_service


class ExplanationProvider:
    def __init__(self, env_id: str):
        self.env_id = env_id
        self.md_db = get_md_db_service()

    def _conn(self) -> tuple[duckdb.DuckDBPyConnection, dict]:
        paths = self.md_db.init_env_structure(self.env_id)
        return duckdb.connect(str(paths["duckdb"])), paths

    def explain_account(self, account_id: str, model_version: str | None = None, thresholds: dict | None = None):
        thresholds = thresholds or {"high": 0.7, "medium": 0.4}
        high_t = float(thresholds.get("high", 0.7))
        med_t = float(thresholds.get("medium", 0.4))

        conn, paths = self._conn()
        try:
            if model_version is None:
                row = conn.execute(
                    "SELECT model_version FROM mule_models WHERE environment_id = ? ORDER BY trained_at DESC LIMIT 1",
                    [self.env_id],
                ).fetchone()
                model_version = row[0] if row else None
            if not model_version:
                try:
                    models_dir = Path(str(paths["models_dir"]))
                    candidates = list(models_dir.glob("*.pkl"))
                    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                    model_version = candidates[0].stem if candidates else None
                except Exception:
                    model_version = None
            if not model_version:
                return {"success": False, "error": "No trained model found"}

            features_df = conn.execute(
                "SELECT * EXCLUDE(environment_id, computed_at) FROM mule_account_features WHERE environment_id = ?",
                [self.env_id],
            ).df()
            x_row = features_df[features_df["account_id"] == account_id]
            if len(x_row) == 0:
                return {"success": False, "error": "Account not found in engineered features"}

            acc_meta = conn.execute(
                """
                SELECT *
                FROM mule_accounts_raw
                WHERE environment_id = ? AND account_id = ?
                LIMIT 1
                """,
                [self.env_id, account_id],
            ).df()
            acc_meta = acc_meta.iloc[0].to_dict() if len(acc_meta) else {}

            tx_df = conn.execute(
                """
                SELECT *
                FROM mule_transactions_raw
                WHERE environment_id = ? AND (account_id = ? OR counterparty_account = ?)
                """,
                [self.env_id, account_id, account_id],
            ).df()

            latest_ts = conn.execute(
                "SELECT MAX(created_at) FROM mule_ml_scores WHERE environment_id = ?",
                [self.env_id],
            ).fetchone()
            latest_ts = latest_ts[0] if latest_ts else None
            score_row = None
            if latest_ts is not None:
                score_row = conn.execute(
                    """
                    SELECT ml_score, model_version, created_at
                    FROM mule_ml_scores
                    WHERE environment_id = ? AND account_id = ? AND created_at = ?
                    """,
                    [self.env_id, account_id, latest_ts],
                ).fetchone()
            if score_row:
                score = float(score_row[0] or 0.0)
                scored_model_version = str(score_row[1] or model_version)
                score_timestamp = score_row[2].isoformat() if hasattr(score_row[2], "isoformat") else str(score_row[2])
            else:
                score = None
                scored_model_version = str(model_version)
                score_timestamp = None

            prev_ts_row = conn.execute(
                """
                SELECT DISTINCT created_at
                FROM mule_ml_scores
                WHERE environment_id = ?
                ORDER BY created_at DESC
                LIMIT 2
                """,
                [self.env_id],
            ).fetchall()
            prev_ts = prev_ts_row[1][0] if len(prev_ts_row) > 1 else None
            prev_score = None
            if prev_ts is not None:
                r = conn.execute(
                    """
                    SELECT ml_score
                    FROM mule_ml_scores
                    WHERE environment_id = ? AND account_id = ? AND created_at = ?
                    """,
                    [self.env_id, account_id, prev_ts],
                ).fetchone()
                if r:
                    prev_score = float(r[0] or 0.0)

            peers = self._peer_group(features_df, acc_meta)
            peer_stats = self._peer_stats(features_df, peers)
        finally:
            conn.close()

        engine = InferenceEngine(model_store_path=str(paths["models_dir"]))
        model_data = engine.load_model(str(model_version))
        model = model_data.get("model")
        metadata = model_data.get("metadata", {}) or {}
        feature_cols = metadata.get("features", []) or []

        raw_vals = {}
        for f in feature_cols:
            if f in x_row.columns:
                v = x_row.iloc[0][f]
                raw_vals[f] = float(v) if is_number(v) else None
            else:
                raw_vals[f] = 0.0

        shap_out = self._try_shap(model, engine, x_row, feature_cols, metadata)
        if shap_out.get("success"):
            contrib_method = "shap"
            contributions = self._build_contributions_from_shap(shap_out, raw_vals, peer_stats)
        else:
            contrib_method = "importance_proxy"
            contributions = self._build_contributions_from_importance(metadata, raw_vals, peer_stats)

        themes = self._themes_from_contributions(contributions)
        timeline = self._timeline_summary(account_id, tx_df)
        network = self._network_context(account_id, tx_df, thresholds, model_version=scored_model_version)
        peer_view = self._peer_deviation(peer_stats, raw_vals)
        narrative = self._narrative(timeline, network, peer_view, raw_vals)

        score_value = score if score is not None else self._score_on_demand(engine, model_version, x_row, feature_cols)
        risk_level = "HIGH" if float(score_value or 0.0) >= high_t else ("MEDIUM" if float(score_value or 0.0) >= med_t else "LOW")
        decision = "escalate" if risk_level == "HIGH" else ("review" if risk_level == "MEDIUM" else ("suppress" if float(score_value or 0.0) < 0.2 else "review"))
        confidence = self._confidence(score_value, high_t, med_t)
        counterfactual = self._counterfactuals(engine, model_version, x_row, feature_cols, peer_stats)

        summary = self._decision_summary(decision, risk_level, score_value, prev_score, narrative, themes, network)

        return {
            "success": True,
            "account_id": account_id,
            "timestamp": now_iso(),
            "run": {
                "model_version": scored_model_version,
                "feature_version": metadata.get("training_config", {}).get("feature_set_version") or None,
                "score_timestamp": score_timestamp,
                "thresholds": {"high": high_t, "medium": med_t},
            },
            "decision_summary": summary,
            "layers": {
                "model_math": {
                    "method": contrib_method,
                    "status": "ok" if contrib_method == "shap" else "fallback",
                    "engines": [
                        {"name": "shap", "success": bool(shap_out.get("success")), "error": shap_out.get("error")},
                        {"name": "importance_proxy", "success": True, "error": None},
                    ],
                    "contributions": contributions[:30],
                },
                "behaviour_narrative": narrative,
                "peer_deviation": peer_view[:20],
                "temporal_story": timeline,
                "network_context": network,
                "decision_justification": {
                    "themes": themes,
                    "confidence": confidence,
                    "counterfactual": counterfactual,
                },
            },
        }

    def _try_shap(self, model, engine: InferenceEngine, x_row: pd.DataFrame, feature_cols: list, metadata: dict):
        try:
            import shap  # type: ignore
        except Exception as e:
            return {"success": False, "error": f"shap_unavailable: {e}"}
        try:
            x = x_row.reindex(columns=feature_cols).copy()
            x = x.replace([np.inf, -np.inf], np.nan).fillna(0)
            x = x.apply(pd.to_numeric, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0)
            arr = engine._prepare_features(x, feature_cols, metadata)  # type: ignore[attr-defined]
            explainer = shap.TreeExplainer(model)
            shap_vals = explainer.shap_values(arr)
            if isinstance(shap_vals, list) and len(shap_vals) > 1:
                sv = np.array(shap_vals[1]).reshape(-1)
            else:
                sv = np.array(shap_vals).reshape(-1)
            base = float(getattr(explainer, "expected_value", 0.0) if not isinstance(getattr(explainer, "expected_value", 0.0), (list, tuple)) else getattr(explainer, "expected_value", [0.0])[0])
            return {"success": True, "base_value": base, "shap": sv.tolist(), "features": feature_cols}
        except Exception as e:
            return {"success": False, "error": f"shap_failed: {e}"}

    def _build_contributions_from_shap(self, shap_out: dict, raw_vals: dict, peer_stats: dict):
        feats = shap_out.get("features") or []
        sv = shap_out.get("shap") or []
        rows = []
        for i, f in enumerate(feats):
            v = raw_vals.get(f)
            ps = peer_stats.get(f) or {}
            mean = ps.get("mean")
            std = ps.get("std")
            z = None
            if mean is not None and std not in [None, 0]:
                z = (float(v or 0.0) - float(mean)) / float(std)
            rows.append(
                {
                    "feature": f,
                    "family": family_for_feature(f),
                    "value": v,
                    "peer_mean": mean,
                    "peer_std": std,
                    "z": z,
                    "impact": float(sv[i]) if i < len(sv) else 0.0,
                    "direction": "positive" if (i < len(sv) and float(sv[i]) >= 0) else "negative",
                }
            )
        rows.sort(key=lambda r: abs(float(r.get("impact") or 0.0)), reverse=True)
        return rows

    def _build_contributions_from_importance(self, metadata: dict, raw_vals: dict, peer_stats: dict):
        fi = (metadata or {}).get("feature_importance") or {}
        all_features = fi.get("all_features") if isinstance(fi, dict) else {}
        rows = []
        for f, imp in (all_features or {}).items():
            if f not in raw_vals:
                continue
            v = raw_vals.get(f)
            ps = peer_stats.get(f) or {}
            mean = ps.get("mean")
            std = ps.get("std")
            z = None
            if mean is not None and std not in [None, 0]:
                z = (float(v or 0.0) - float(mean)) / float(std)
            direction = risk_direction_for_feature(f)
            impact = float(imp or 0.0) * float(z or 0.0) * float(direction)
            rows.append(
                {
                    "feature": f,
                    "family": family_for_feature(f),
                    "value": v,
                    "peer_mean": mean,
                    "peer_std": std,
                    "z": z,
                    "impact": impact,
                    "direction": "positive" if impact >= 0 else "negative",
                }
            )
        rows.sort(key=lambda r: abs(float(r.get("impact") or 0.0)), reverse=True)
        return rows

    def _peer_group(self, features_df: pd.DataFrame, acc_meta: dict):
        ct = str(acc_meta.get("customer_type") or "").strip()
        rr = str(acc_meta.get("risk_rating") or "").strip()
        if not ct and not rr:
            return None
        return {"customer_type": ct or None, "risk_rating": rr or None}

    def _peer_stats(self, features_df: pd.DataFrame, peer_group: dict | None):
        stats = {}
        df = features_df.copy()
        if peer_group:
            conn, _paths = self._conn()
            try:
                meta = conn.execute(
                    """
                    SELECT account_id, customer_type, risk_rating
                    FROM mule_accounts_raw
                    WHERE environment_id = ?
                    """,
                    [self.env_id],
                ).df()
            finally:
                conn.close()
            if len(meta):
                df = df.merge(meta, on="account_id", how="left")
                ct_col = "customer_type" if "customer_type" in df.columns else ("customer_type_y" if "customer_type_y" in df.columns else None)
                rr_col = "risk_rating" if "risk_rating" in df.columns else ("risk_rating_y" if "risk_rating_y" in df.columns else None)
                if peer_group.get("customer_type") and ct_col:
                    df = df[df[ct_col].astype(str) == str(peer_group.get("customer_type"))]
                if peer_group.get("risk_rating") and rr_col:
                    df = df[df[rr_col].astype(str) == str(peer_group.get("risk_rating"))]
        if len(df) < 5:
            df = features_df
        for c in df.columns:
            if c == "account_id":
                continue
            s = pd.to_numeric(df[c], errors="coerce")
            if s.notna().any():
                stats[c] = {"mean": float(s.mean()), "std": float(s.std() or 0.0)}
        return stats

    def _peer_deviation(self, peer_stats: dict, raw_vals: dict):
        out = []
        for f, v in raw_vals.items():
            ps = peer_stats.get(f) or {}
            mean = ps.get("mean")
            std = ps.get("std")
            if mean is None or std in [None, 0]:
                continue
            z = (float(v or 0.0) - float(mean)) / float(std)
            if not np.isfinite(z):
                continue
            if abs(float(z)) < 1.0:
                continue
            out.append({"feature": f, "family": family_for_feature(f), "value": v, "peer_mean": mean, "z": float(z)})
        out.sort(key=lambda r: abs(float(r.get("z") or 0.0)), reverse=True)
        return out

    def _timeline_summary(self, account_id: str, tx_df: pd.DataFrame):
        if len(tx_df) == 0:
            return {"has_results": False}
        t = tx_df.copy()
        for col in ["txn_timestamp"]:
            if col in t.columns:
                t[col] = pd.to_datetime(t[col], errors="coerce")
        t = t[t["txn_timestamp"].notna()].sort_values("txn_timestamp")
        if len(t) == 0:
            return {"has_results": False}
        a = t[t["account_id"].astype(str) == str(account_id)].copy()
        a["direction"] = a["direction"].astype(str).str.lower()
        inflow = a[a["direction"].isin(["credit", "in", "inflow"])].copy()
        outflow = a[a["direction"].isin(["debit", "out", "outflow"])].copy()
        total_in = float(pd.to_numeric(inflow.get("amount"), errors="coerce").fillna(0).sum()) if len(inflow) else 0.0
        total_out = float(pd.to_numeric(outflow.get("amount"), errors="coerce").fillna(0).sum()) if len(outflow) else 0.0

        hold_hours = None
        fast_exit = False
        fast_exit_hours = None
        if len(inflow) and len(outflow):
            inflow_ts = inflow["txn_timestamp"].tolist()
            outflow_ts = outflow["txn_timestamp"].tolist()
            outflow_ts_sorted = sorted(outflow_ts)
            best = None
            for ts_in in inflow_ts:
                after = [ts for ts in outflow_ts_sorted if ts >= ts_in]
                if not after:
                    continue
                dt = (after[0] - ts_in).total_seconds() / 3600.0
                if best is None or dt < best:
                    best = dt
            if best is not None:
                hold_hours = float(best)
                if hold_hours <= 2:
                    fast_exit = True
                    fast_exit_hours = hold_hours

        ben_series = outflow.get("counterparty_account")
        unique_ben = int(ben_series.astype(str).nunique()) if ben_series is not None and len(outflow) else 0
        new_ben_ratio = None
        if len(outflow) >= 2:
            cutoff = outflow["txn_timestamp"].max() - timedelta(days=7)
            recent = outflow[outflow["txn_timestamp"] >= cutoff]
            prior = outflow[outflow["txn_timestamp"] < cutoff]
            recent_set = set(recent["counterparty_account"].astype(str).dropna().tolist())
            prior_set = set(prior["counterparty_account"].astype(str).dropna().tolist())
            if recent_set:
                new_ben = len([b for b in recent_set if b not in prior_set])
                new_ben_ratio = float(new_ben / max(len(recent_set), 1))

        return {
            "has_results": True,
            "window": {
                "start": t["txn_timestamp"].min().isoformat(),
                "end": t["txn_timestamp"].max().isoformat(),
            },
            "inflow": {"count": int(len(inflow)), "amount": total_in},
            "outflow": {"count": int(len(outflow)), "amount": total_out},
            "holding_time_hours": hold_hours,
            "fast_exit": {"flag": fast_exit, "hours": fast_exit_hours},
            "beneficiaries": {"unique": unique_ben, "new_ratio_7d": new_ben_ratio},
        }

    def _network_context(self, account_id: str, tx_df: pd.DataFrame, thresholds: dict, model_version: str | None = None):
        high_t = float((thresholds or {}).get("high", 0.7))
        if len(tx_df) == 0:
            return {"has_results": False}
        t = tx_df.copy()
        for col in ["account_id", "counterparty_account"]:
            if col in t.columns:
                t[col] = t[col].astype(str)
        t = t[t["account_id"].notna() & t["counterparty_account"].notna()]
        neighbors = set()
        for _, r in t.iterrows():
            a = str(r.get("account_id"))
            b = str(r.get("counterparty_account"))
            if a == account_id and b:
                neighbors.add(b)
            if b == account_id and a:
                neighbors.add(a)
        neighbors = {n for n in neighbors if n and n != account_id}

        conn, _paths = self._conn()
        try:
            latest_ts = conn.execute("SELECT MAX(created_at) FROM mule_ml_scores WHERE environment_id = ?", [self.env_id]).fetchone()[0]
            risky = 0
            risky_list = []
            if latest_ts is not None and neighbors:
                df = conn.execute(
                    f"""
                    SELECT account_id, ml_score
                    FROM mule_ml_scores
                    WHERE environment_id = ? AND created_at = ? AND account_id IN ({",".join(["?"] * len(neighbors))})
                    """,
                    [self.env_id, latest_ts, *list(neighbors)],
                ).df()
                for _, r in df.iterrows():
                    s = float(r.get("ml_score") or 0.0)
                    if s >= high_t:
                        risky += 1
                        risky_list.append({"account_id": r.get("account_id"), "risk_score": s})
        finally:
            conn.close()

        return {
            "has_results": True,
            "neighbor_count": int(len(neighbors)),
            "risky_neighbors_high": int(risky),
            "risky_neighbor_examples": sorted(risky_list, key=lambda r: float(r.get("risk_score") or 0.0), reverse=True)[:10],
        }

    def _themes_from_contributions(self, contributions: list[dict]):
        fam = {}
        for r in contributions[:20]:
            f = str(r.get("family") or "other")
            fam[f] = fam.get(f, 0.0) + abs(float(r.get("impact") or 0.0))
        out = [{"theme": k, "strength": float(v)} for k, v in sorted(fam.items(), key=lambda kv: kv[1], reverse=True)]
        return out[:6]

    def _narrative(self, timeline: dict, network: dict, peer_dev: list[dict], raw_vals: dict):
        bullets = []
        v = raw_vals.get("velocity")
        if is_number(v) and float(v) >= 5:
            bullets.append({"theme": "velocity", "text": "High transaction velocity observed."})
        pt = raw_vals.get("pass_through_ratio")
        if is_number(pt) and float(pt) >= 0.8:
            bullets.append({"theme": "velocity", "text": "Funds show high pass-through behavior (rapid inflow to outflow)."})
        if timeline.get("has_results") and timeline.get("fast_exit", {}).get("flag"):
            h = timeline.get("fast_exit", {}).get("hours")
            bullets.append({"theme": "velocity", "text": f"Funds exited quickly after receipt ({format_hours(h)})."})
        nr = (timeline.get("beneficiaries") or {}).get("new_ratio_7d")
        if nr is not None and float(nr) >= 0.5:
            bullets.append({"theme": "velocity", "text": f"High share of new beneficiaries detected ({int(float(nr) * 100)}% in last 7 days)."})
        sd = raw_vals.get("shared_device_flag")
        apd = raw_vals.get("accounts_per_device")
        if (is_number(sd) and float(sd) > 0) or (is_number(apd) and float(apd) >= 2):
            n = int(float(apd)) if is_number(apd) else None
            bullets.append({"theme": "device", "text": f"Device sharing detected{f' ({n} accounts per device)' if n else ''}."})
        if network.get("has_results") and int(network.get("risky_neighbors_high") or 0) > 0:
            bullets.append({"theme": "network", "text": f"Connected to {int(network.get('risky_neighbors_high'))} high-risk nodes in its neighborhood."})

        top_peer = [d for d in peer_dev if d.get("family") in ["velocity", "device", "network"]][:3]
        for d in top_peer:
            z = float(d.get("z") or 0.0)
            feat = str(d.get("feature"))
            dir_txt = "above" if z > 0 else "below"
            bullets.append({"theme": "peer", "text": f"Behaviour deviates from peer group: {feat} is {abs(z):.1f}σ {dir_txt} peer mean."})

        if not bullets:
            bullets.append({"theme": "summary", "text": "Account shows limited behavioural evidence beyond model score; use peer and network drilldowns."})
        return bullets[:12]

    def _confidence(self, score: float | None, high_t: float, med_t: float):
        if score is None:
            return {"level": "unknown", "value": None, "method": "unavailable"}
        s = float(score)
        margin = min(abs(s - med_t), abs(s - high_t))
        if margin >= 0.2:
            level = "high"
        elif margin >= 0.08:
            level = "medium"
        else:
            level = "low"
        return {"level": level, "value": float(margin), "method": "threshold_margin"}

    def _counterfactuals(self, engine: InferenceEngine, model_version: str, x_row: pd.DataFrame, feature_cols: list, peer_stats: dict):
        base = self._score_on_demand(engine, model_version, x_row, feature_cols)
        items = []
        for feat in ["velocity", "pass_through_ratio", "holding_time_avg", "fan_out_score", "fan_in_score"]:
            if feat not in feature_cols or feat not in x_row.columns:
                continue
            ps = peer_stats.get(feat) or {}
            mean = ps.get("mean")
            if mean is None:
                continue
            x_cf = x_row.copy()
            try:
                x_cf.loc[:, feat] = float(mean)
            except Exception:
                continue
            s_cf = self._score_on_demand(engine, model_version, x_cf, feature_cols)
            if s_cf is None or base is None:
                continue
            items.append({"feature": feat, "set_to": float(mean), "score": float(s_cf), "delta": float(s_cf - base)})
        items.sort(key=lambda r: abs(float(r.get("delta") or 0.0)), reverse=True)
        return {"has_results": True if items else False, "baseline_score": base, "what_if": items[:5]}

    def _score_on_demand(self, engine: InferenceEngine, model_version: str, x_row: pd.DataFrame, feature_cols: list):
        try:
            df = x_row.reindex(columns=["account_id"] + feature_cols, fill_value=0)
            probs, _ = engine.predict(model=None, data=df, model_version=model_version)
            if len(probs):
                return float(probs[0])
            return None
        except Exception:
            return None

    def _decision_summary(self, decision: str, risk_level: str, score: float | None, prev_score: float | None, narrative: list, themes: list, network: dict):
        delta = None
        if score is not None and prev_score is not None:
            delta = float(score - prev_score)
        reasons = []
        for b in (narrative or [])[:4]:
            reasons.append(b.get("text"))
        if network.get("has_results") and int(network.get("risky_neighbors_high") or 0) >= 1:
            reasons.append("Network proximity to risky nodes increases operational urgency.")
        return {
            "decision": decision,
            "risk_level": risk_level,
            "risk_score": float(score) if score is not None else None,
            "risk_delta_vs_last": delta,
            "why": reasons[:6],
            "themes": themes,
        }


def family_for_feature(name: str):
    n = str(name or "").lower()
    if any(k in n for k in ["velocity", "pass_through", "holding_time", "rapid", "turnover", "tx_count", "same_day"]):
        return "velocity"
    if any(k in n for k in ["device", "ip_", "vpn", "geo_", "shared_device", "accounts_per_device"]):
        return "device"
    if any(k in n for k in ["fan_in", "fan_out", "network", "centrality", "pagerank", "betweenness", "cluster"]):
        return "network"
    if any(k in n for k in ["cycle", "circular", "round_tripping", "loop"]):
        return "circularity"
    return "other"


def risk_direction_for_feature(name: str):
    n = str(name or "").lower()
    if any(k in n for k in ["holding_time"]):
        return -1.0
    if any(k in n for k in ["retention_ratio"]):
        return -1.0
    return 1.0


def is_number(v):
    try:
        if v is None:
            return False
        x = float(v)
        return math.isfinite(x)
    except Exception:
        return False


def format_hours(h):
    if h is None:
        return "unknown"
    try:
        hh = float(h)
    except Exception:
        return "unknown"
    if hh < 1:
        return f"{int(hh * 60)} minutes"
    return f"{hh:.1f} hours"


def now_iso():
    return datetime.now().isoformat()
