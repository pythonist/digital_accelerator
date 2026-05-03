import numpy as np
import pandas as pd
from utils import print_step

class FeedbackLoop:
    def weak_supervision_and_feedback(self, feature_df, alert_output):
        print_step("STEP 17: WEAK SUPERVISION + FEEDBACK")
        weak_df = feature_df.copy()
        weak_df["proxy_positive"] = ((weak_df["shared_device_risk"] == 1) | (weak_df["shared_ip_risk"] == 1) | (weak_df["dormant_activation_flag"] == 1) | (weak_df["fanout_flag"] == 1) | (weak_df["transition_score"] >= 0.60)).astype(int)
        weak_df["proxy_confidence"] = (0.2 * weak_df["shared_device_risk"].fillna(0) + 0.2 * weak_df["shared_ip_risk"].fillna(0) + 0.2 * weak_df["dormant_activation_flag"].fillna(0) + 0.2 * weak_df["fanout_flag"].fillna(0) + 0.2 * (weak_df["transition_score"].fillna(0) >= 0.60).astype(int))
        feedback_alerts = alert_output.copy()
        feedback_alerts["alert_id"] = "ALERT_" + np.arange(len(feedback_alerts)).astype(str)
        sample_n = min(500, len(feedback_alerts))
        analyst_feedback_master = pd.DataFrame({
            "alert_id": np.random.choice(feedback_alerts["alert_id"], size=sample_n, replace=False),
            "customer_id": np.random.choice(feedback_alerts["customer_id"], size=sample_n, replace=True),
            "account_id": np.random.choice(feedback_alerts["account_id"], size=sample_n, replace=True),
            "analyst_outcome": np.random.choice(["confirmed_mule", "false_positive", "insufficient_evidence", "sar_filed", "watchlist_only"], size=sample_n, p=[0.25, 0.35, 0.15, 0.10, 0.15]),
            "analyst_notes": "reviewed",
            "review_ts": pd.Timestamp("2025-01-01")
        })
        feedback_enriched = feedback_alerts.merge(analyst_feedback_master, on=["alert_id"], how="left", suffixes=("", "_fb"))
        relabel_candidate_table = feedback_enriched[feedback_enriched["analyst_outcome"].isin(["confirmed_mule", "sar_filed"])].copy()
        suppression_rule_candidates = feedback_enriched[feedback_enriched["analyst_outcome"] == "false_positive"].copy()
        active_learning_queue = feedback_enriched[feedback_enriched["final_mule_score"].between(0.45, 0.65)].copy()
        suppression_rules = pd.DataFrame()
        if not suppression_rule_candidates.empty:
            cols = [c for c in ["primary_reason", "primary_category", "priority_band"] if c in suppression_rule_candidates.columns]
            suppression_rules = suppression_rule_candidates.groupby(cols).size().reset_index(name="false_positive_count").sort_values("false_positive_count", ascending=False)
        precision_by_reason = pd.DataFrame()
        if "primary_reason" in feedback_enriched.columns:
            tmp = feedback_enriched.copy()
            tmp["is_tp"] = tmp["analyst_outcome"].isin(["confirmed_mule", "sar_filed"]).astype(int)
            precision_by_reason = tmp.groupby("primary_reason").agg(reviewed_alerts=("primary_reason", "count"), true_positives=("is_tp", "sum")).reset_index()
            precision_by_reason["precision"] = precision_by_reason["true_positives"] / precision_by_reason["reviewed_alerts"].replace(0, np.nan)
        retraining_pack = feedback_enriched[feedback_enriched["analyst_outcome"].isin(["confirmed_mule", "sar_filed", "false_positive"])].copy()
        return {"weak_df": weak_df, "feedback_enriched_alerts": feedback_enriched, "relabel_candidate_table": relabel_candidate_table, "suppression_rule_candidates": suppression_rule_candidates, "active_learning_queue": active_learning_queue, "suppression_rules": suppression_rules, "precision_by_reason": precision_by_reason, "retraining_pack": retraining_pack}
