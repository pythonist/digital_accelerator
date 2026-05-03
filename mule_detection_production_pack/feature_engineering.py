import numpy as np
import pandas as pd
from config import CONFIG
from utils import print_step

class FeatureEngineering:
    def run_eda_and_imputation(self, df):
        print_step("STEP 6: EDA + IMPUTATION")
        print("Shape:", df.shape)
        print(df["channel"].value_counts(dropna=False))
        print(df["mule_category"].value_counts(dropna=False))
        print(df.isna().mean().sort_values(ascending=False).head(20))
        out = df.copy()
        num_cols = out.select_dtypes(include=[np.number]).columns
        obj_cols = out.select_dtypes(include=["object"]).columns
        for c in num_cols:
            out[c] = out[c].fillna(out[c].median())
        for c in obj_cols:
            out[c] = out[c].fillna("UNKNOWN")
        return out

    def feature_engineering(self, df):
        print_step("STEP 7: FEATURE ENGINEERING")
        out = df.copy().sort_values(["customer_id", "event_ts"]).reset_index(drop=True)
        out["event_hour"] = out["event_ts"].dt.hour
        out["event_dayofweek"] = out["event_ts"].dt.dayofweek
        out["event_month"] = out["event_ts"].dt.month
        out["is_weekend"] = out["event_dayofweek"].isin([5, 6]).astype(int)
        out["is_night"] = out["event_hour"].isin([0, 1, 2, 3, 4, 5]).astype(int)
        if "customer_date_of_birth" in out.columns:
            out["customer_age_years"] = ((out["event_ts"] - out["customer_date_of_birth"]).dt.days / 365.25)
        if "customer_account_open_date" in out.columns:
            out["customer_tenure_days"] = (out["event_ts"] - out["customer_account_open_date"]).dt.days
        if "customer_last_kyc_update_date" in out.columns:
            out["days_since_kyc_update"] = (out["event_ts"] - out["customer_last_kyc_update_date"]).dt.days
        if "account_open_date" in out.columns:
            out["account_age_days"] = (out["event_ts"] - out["account_open_date"]).dt.days
        if "upi_vpa_creation_date" in out.columns:
            out["upi_vpa_age_days"] = (out["event_ts"] - out["upi_vpa_creation_date"]).dt.days
        if "merchant_onboarding_date" in out.columns:
            out["merchant_age_days"] = (out["event_ts"] - out["merchant_onboarding_date"]).dt.days
        if "sim_last_swap_date" in out.columns:
            out["days_since_sim_swap"] = (out["event_ts"] - out["sim_last_swap_date"]).dt.days
        out["prev_event_ts"] = out.groupby("customer_id")["event_ts"].shift(1)
        out["hours_since_prev_txn"] = (out["event_ts"] - out["prev_event_ts"]).dt.total_seconds() / 3600
        out["gap_minutes"] = (out["event_ts"] - out["prev_event_ts"]).dt.total_seconds() / 60
        out["new_session_flag"] = ((out["gap_minutes"].isna()) | (out["gap_minutes"] > CONFIG["session_gap_minutes"])).astype(int)
        out["session_seq"] = out.groupby("customer_id")["new_session_flag"].cumsum()
        out["session_id"] = out["customer_id"].astype(str) + "_S_" + out["session_seq"].astype(str)
        out["prev_channel"] = out.groupby("customer_id")["channel"].shift(1)
        out["transition_path"] = out["prev_channel"].fillna("START") + "->" + out["channel"].fillna("UNK")
        out["prev_amount"] = out.groupby("customer_id")["amount"].shift(1)
        out["amount_change_prev"] = out["amount"] - out["prev_amount"]
        out["amount_ratio_prev"] = out["amount"] / out["prev_amount"].replace(0, np.nan)
        out["cust_txn_count_so_far"] = out.groupby("customer_id").cumcount()
        out["acct_txn_count_so_far"] = out.groupby("account_id").cumcount()
        out["device_txn_count_so_far"] = out.groupby("device_id").cumcount()
        out["cust_mean_amount_so_far"] = out.groupby("customer_id")["amount"].expanding().mean().reset_index(level=0, drop=True)
        out["cust_std_amount_so_far"] = out.groupby("customer_id")["amount"].expanding().std().reset_index(level=0, drop=True)
        out["cust_amount_zscore"] = (out["amount"] - out["cust_mean_amount_so_far"]) / out["cust_std_amount_so_far"].replace(0, np.nan)
        out["first_time_counterparty"] = (out.groupby(["customer_id", "counterparty_id"]).cumcount() == 0).astype(int)
        out["first_time_device"] = (out.groupby(["customer_id", "device_id"]).cumcount() == 0).astype(int)
        out["first_time_channel"] = (out.groupby(["customer_id", "channel"]).cumcount() == 0).astype(int)
        if "device_ip_address" in out.columns:
            out["first_time_ip"] = (out.groupby(["customer_id", "device_ip_address"]).cumcount() == 0).astype(int)
        else:
            out["first_time_ip"] = 0
        ip_col = "device_ip_address" if "device_ip_address" in out.columns else "ip_address"
        out["shared_device_customer_count"] = out.groupby("device_id")["customer_id"].transform("nunique")
        if ip_col in out.columns:
            out["shared_ip_customer_count"] = out.groupby(ip_col)["customer_id"].transform("nunique")
        else:
            out["shared_ip_customer_count"] = 0
        out["shared_counterparty_customer_count"] = out.groupby("counterparty_id")["customer_id"].transform("nunique")
        out["shared_device_risk"] = (out["shared_device_customer_count"] >= 2).astype(int)
        out["shared_ip_risk"] = (out["shared_ip_customer_count"] >= 2).astype(int)
        out["shared_counterparty_risk"] = (out["shared_counterparty_customer_count"] >= 4).astype(int)
        out["daily_txn_count"] = out.groupby(["customer_id", out["event_ts"].dt.date])["transaction_id"].transform("count")
        out["daily_unique_counterparties"] = out.groupby(["customer_id", out["event_ts"].dt.date])["counterparty_id"].transform("nunique")
        out["velocity_flag"] = (out["daily_txn_count"] >= 5).astype(int)
        out["fanout_flag"] = (out["daily_unique_counterparties"] >= 3).astype(int)
        out["dormancy_days"] = (out["event_ts"] - out.groupby("customer_id")["event_ts"].shift(1)).dt.total_seconds() / (3600 * 24)
        out["dormant_activation_flag"] = (out["dormancy_days"] >= 30).fillna(0).astype(int)
        trans = out.groupby(["prev_channel", "channel"]).size().reset_index(name="cnt")
        trans["base"] = trans.groupby("prev_channel")["cnt"].transform("sum")
        trans["transition_prob"] = trans["cnt"] / trans["base"]
        out = out.merge(trans[["prev_channel", "channel", "transition_prob"]], on=["prev_channel", "channel"], how="left")
        out["transition_score"] = 1 - out["transition_prob"].fillna(0.5)
        out["sequence_score"] = (
            0.20 * out["first_time_counterparty"].fillna(0) +
            0.15 * out["first_time_device"].fillna(0) +
            0.10 * out["first_time_channel"].fillna(0) +
            0.10 * out["shared_device_risk"].fillna(0) +
            0.10 * out["shared_ip_risk"].fillna(0) +
            0.10 * out["fanout_flag"].fillna(0) +
            0.10 * out["velocity_flag"].fillna(0) +
            0.15 * out["dormant_activation_flag"].fillna(0)
        )
        out["label"] = out["mule_category"].astype(str)
        return out
