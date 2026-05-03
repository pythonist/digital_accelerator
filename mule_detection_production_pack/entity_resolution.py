from utils import print_step
import numpy as np
import pandas as pd
class EntityResolution:
    def build_entity_views(self, raw_tables):
        print_step("STEP 3: BUILD ENTITY VIEWS")
        customer_view = (
            raw_tables["CIF_MASTER"]
            .merge(raw_tables["CIF_KYC_DETAILS"], on="customer_id", how="left")
            .merge(raw_tables["CIF_ADDRESS"], on="customer_id", how="left")
            .merge(raw_tables["CIF_ADDRESS_DETAILS"], on="customer_id", how="left")
            .merge(raw_tables["CIF_ADDRESS_HISTORY"], on="customer_id", how="left")
            .merge(raw_tables["CIF_CONTACT_DETAILS"], on="customer_id", how="left")
            .merge(raw_tables["CIF_ID_DOCUMENTS"], on="customer_id", how="left")
            .merge(raw_tables["CIF_SOCIAL_PROFILE"], on="customer_id", how="left")
            .merge(raw_tables["CIF_EMPLOYMENT_DETAILS"], on="customer_id", how="left")
            .merge(raw_tables["CIF_TAX_DETAILS"], on="customer_id", how="left", suffixes=("", "_tax"))
            .merge(raw_tables["CIF_RISK_PROFILE"], on="customer_id", how="left")
            .merge(raw_tables["CIF_VIDEO_KYC_LOG"], on="customer_id", how="left")
        )
        account_view = (
            raw_tables["ACCOUNT_MASTER"]
            .merge(raw_tables["ACCOUNT_STATUS_HISTORY"], on="account_id", how="left")
            .merge(raw_tables["ACCOUNT_LIMIT_HISTORY"], on="account_id", how="left")
        )
        device_view = (
            raw_tables["DIGITAL_DEVICE_MASTER"]
            .merge(raw_tables["MOBILE_APP_DEVICE_REGISTRY"], on="device_id", how="left")
            .merge(raw_tables["MOBILE_SECURITY_PROFILE"], on="device_id", how="left")
            .merge(raw_tables["NETWORK_ACCESS_LOG"], on="device_id", how="left")
            .merge(raw_tables["NETWORK_INTELLIGENCE_FEED"], on="device_ip_address", how="left")
            .merge(raw_tables["DIGITAL_SESSION_LOG"], on="device_id", how="left")
            .merge(raw_tables["DIGITAL_LOGIN_EVENT_LOG"], on="device_id", how="left")
            .merge(raw_tables["DIGITAL_BEHAVIOR_MONITOR"], on="device_id", how="left")
            .merge(raw_tables["TELCO_DEVICE_REGISTRY"], on="device_id", how="left")
            .merge(raw_tables["TELCO_SIM_REGISTRY"], on="sim_card_number_hash", how="left")
            .merge(raw_tables["TELCO_DATA_FEED"], on="sim_card_number_hash", how="left")
        )
        merchant_view = (
            raw_tables["DIM_MERCHANT"]
            .merge(raw_tables["DIM_MERCHANT_TERMINAL"], on="merchant_id", how="left")
            .merge(raw_tables["FACT_MERCHANT_CHARGEBACK"], on="merchant_id", how="left")
            .merge(raw_tables["FACT_PAYMENT_GATEWAY_TXN"], on="merchant_id", how="left")
            .merge(raw_tables["FACT_PAYMENT_GATEWAY_SETTLEMENT"], on="merchant_id", how="left")
            .merge(raw_tables["MERCHANT_MASTER"], on="merchant_id", how="left")
            .merge(raw_tables["MERCHANT_KYC_DETAILS"], on="merchant_id", how="left")
            .merge(raw_tables["MERCHANT_PROFILE"], on="merchant_id", how="left")
            .merge(raw_tables["MERCHANT_SETTLEMENT_ACCOUNT"], on="merchant_id", how="left")
            .merge(raw_tables["MERCHANT_SETTLEMENT_CONFIG"], on="merchant_id", how="left")
            .merge(raw_tables["POS_TERMINAL_MASTER"], on="merchant_id", how="left")
        )
        beneficiary_view = raw_tables["BENEFICIARY_MASTER"].merge(raw_tables["TBAADM.GAM"], on="counterparty_account_number", how="left")
        return {
            "customer_view": customer_view,
            "account_view": account_view,
            "device_view": device_view,
            "merchant_view": merchant_view,
            "beneficiary_view": beneficiary_view,
        }

    def build_unified_events(self, txn_tables):
        print_step("STEP 4: BUILD UNIFIED EVENTS")
        upi = txn_tables["UPI_TRANSACTION"].copy()
        upi = upi.merge(txn_tables["UPI_PROFILE"], left_on="upi_payer_vpa", right_on="upi_vpa_id", how="left", suffixes=("", "_profile"))
        upi = upi.merge(txn_tables["AML_ALERT_ENGINE"], on="upi_transaction_id", how="left")
        upi["transaction_id"] = upi["upi_transaction_id"]
        upi["event_ts"] = pd.to_datetime(upi["upi_transaction_timestamp"])
        upi["amount"] = upi["upi_transaction_amount"]
        upi["transaction_type"] = upi["upi_transaction_type"]
        upi["transaction_status"] = upi["upi_transaction_status"]
        upi["channel"] = "UPI"
        upi["counterparty_id"] = upi["upi_payee_vpa"]
        upi["merchant_id"] = np.nan
        atm = txn_tables["ATM_TRANSACTION"].copy()
        atm = atm.merge(txn_tables["ATM_TRANSACTION_LOG"], on="atm_transaction_id", how="left")
        atm = atm.merge(txn_tables["ATM_DEVICE_MASTER"], on="atm_terminal_id", how="left")
        atm["transaction_id"] = atm["atm_transaction_id"]
        atm["event_ts"] = pd.to_datetime(atm["atm_transaction_timestamp"])
        atm["amount"] = atm["atm_transaction_amount"]
        atm["transaction_type"] = atm["atm_transaction_type"]
        atm["transaction_status"] = atm["atm_error_code"].fillna("SUCCESS")
        atm["channel"] = "ATM"
        atm["counterparty_id"] = np.nan
        atm["merchant_id"] = np.nan
        atm["ip_address"] = np.nan
        branch = txn_tables["TBAADM.T_TRAN"].copy()
        branch = branch.merge(txn_tables["AML_DEPOSITOR_MASTER"], on="branch_transaction_id", how="left")
        branch = branch.merge(txn_tables["BRANCH_MASTER"], on="branch_transaction_id", how="left")
        branch = branch.merge(txn_tables["BRANCH_AGENT_MASTER"], on="branch_transaction_id", how="left")
        branch = branch.merge(txn_tables["CRM_CUSTOMER_MASTER"], on="customer_id", how="left")
        branch = branch.merge(txn_tables["KYC_CUSTOMER_MASTER"], on="customer_id", how="left")
        branch = branch.merge(txn_tables["AML_SCREENING_RESULTS"], on="customer_id", how="left")
        branch["transaction_id"] = branch["branch_transaction_id"]
        branch["event_ts"] = pd.to_datetime(branch["branch_transaction_timestamp"])
        branch["amount"] = branch["branch_cash_deposit_amount"]
        branch["transaction_type"] = branch["branch_transaction_type"]
        branch["transaction_status"] = "SUCCESS"
        branch["channel"] = "BRANCH"
        branch["counterparty_id"] = branch["branch_depositor_identity_hash"]
        branch["merchant_id"] = np.nan
        branch["device_id"] = np.nan
        branch["ip_address"] = np.nan
        merch = txn_tables["FACT_MERCHANT_TRANSACTION"].copy()
        merch = merch.merge(txn_tables["AML_FRAUD_ALERTS"], on="merchant_id", how="left")
        merch = merch.merge(txn_tables["AML_SAR_CASES"], on="merchant_id", how="left")
        merch["transaction_id"] = merch["merchant_transaction_id"]
        merch["event_ts"] = pd.to_datetime(merch["merchant_transaction_timestamp"])
        merch["amount"] = merch["merchant_transaction_amount"]
        merch["transaction_type"] = merch["merchant_transaction_type"]
        merch["transaction_status"] = "SUCCESS"
        merch["channel"] = "MERCHANT"
        merch["customer_id"] = merch["merchant_customer_id"]
        merch["account_id"] = merch["merchant_account_id"]
        merch["device_id"] = merch["merchant_device_id"]
        merch["counterparty_id"] = merch["merchant_id"]
        merch["ip_address"] = np.nan
        api = txn_tables["API_GATEWAY_AUDIT_LOG"].copy()
        api["transaction_id"] = "API_" + api.index.astype(str)
        api["transaction_type"] = "API_CALL"
        api["transaction_status"] = api["api_response_code"].astype(str)
        api["channel"] = "API"
        api["merchant_id"] = np.nan
        api["ip_address"] = np.nan
        digital = txn_tables["DIGITAL_LOGIN_EVENTS_SYN"].copy()
        digital["transaction_id"] = "DIG_" + digital.index.astype(str)
        digital["event_ts"] = pd.to_datetime(digital["device_login_timestamp"])
        digital["transaction_type"] = "LOGIN"
        digital["transaction_status"] = digital["device_login_success_flag"].astype(str)
        digital["channel"] = "DIGITAL"
        digital["merchant_id"] = np.nan
        frames = [upi, atm, branch, merch, api, digital]
        common_cols = sorted(set().union(*[set(x.columns) for x in frames]))
        def align(df, cols):
            out = df.copy()
            for c in cols:
                if c not in out.columns:
                    out[c] = np.nan
            return out[cols]
        events = pd.concat([align(x, common_cols) for x in frames], ignore_index=True)
        events["event_ts"] = pd.to_datetime(events["event_ts"], errors="coerce")
        events = events.dropna(subset=["event_ts"]).sort_values("event_ts").reset_index(drop=True)
        return events

    def build_single_view(self, events, entity_views):
        print_step("STEP 5: BUILD SINGLE VIEW")
        out = events.copy()
        out = out.merge(entity_views["customer_view"], on="customer_id", how="left")
        out = out.merge(entity_views["account_view"], on="account_id", how="left")
        out = out.merge(entity_views["device_view"], on="device_id", how="left")
        out = out.merge(entity_views["merchant_view"], on="merchant_id", how="left")
        out = out.merge(entity_views["beneficiary_view"], on="counterparty_id", how="left")
        return out
