import random
import numpy as np
import pandas as pd
from config import CONFIG
from utils import random_date, print_step

class DataIngestion:
    def __init__(self):
        np.random.seed(CONFIG["random_state"])
        random.seed(CONFIG["random_state"])

    def generate_raw_tables(self):
        print_step("STEP 1: GENERATE RAW TABLES")
        n_customers, n_accounts, n_devices, n_merchants, n_counterparties, n_video_sessions = 18000, 22000, 14000, 2500, 12000, 18000
        CIF_MASTER = pd.DataFrame({
            "customer_id": [f"CUST{i:06d}" for i in range(n_customers)],
            "customer_type": np.random.choice(["INDIVIDUAL", "BUSINESS"], n_customers, p=[0.85, 0.15]),
            "customer_segment": np.random.choice(["RETAIL", "AFFLUENT", "SME", "CORPORATE"], n_customers),
            "customer_risk_rating": np.random.choice(["LOW", "MEDIUM", "HIGH"], n_customers, p=[0.72, 0.20, 0.08]),
            "customer_status": np.random.choice(["ACTIVE", "DORMANT", "INACTIVE"], n_customers, p=[0.82, 0.13, 0.05]),
            "customer_account_open_date": random_date("2018-01-01", "2024-06-30", n_customers),
            "customer_name": [f"Customer_{i}" for i in range(n_customers)],
            "customer_gender": np.random.choice(["M", "F", "O"], n_customers, p=[0.48, 0.48, 0.04]),
            "customer_date_of_birth": random_date("1960-01-01", "2005-12-31", n_customers),
            "customer_nationality": np.random.choice(["IN", "AE", "SG", "UK"], n_customers, p=[0.85, 0.05, 0.05, 0.05]),
            "customer_residency_status": np.random.choice(["RESIDENT", "NRI"], n_customers, p=[0.92, 0.08]),
            "customer_tax_residency_country": np.random.choice(["IN", "AE", "SG", "UK"], n_customers, p=[0.88, 0.04, 0.04, 0.04]),
            "customer_occupation": np.random.choice(["SALARIED", "SELF_EMPLOYED", "STUDENT", "UNEMPLOYED", "BUSINESS_OWNER"], n_customers),
            "customer_employer_name": np.random.choice(["EMP_A", "EMP_B", "EMP_C", "EMP_D", "NONE"], n_customers),
            "customer_industry_code": np.random.choice(["IT", "FIN", "CONS", "TRAD", "OTHR"], n_customers),
            "customer_employment_status": np.random.choice(["EMPLOYED", "SELF_EMPLOYED", "UNEMPLOYED"], n_customers),
            "customer_declared_income": np.random.lognormal(mean=10.5, sigma=0.8, size=n_customers),
            "customer_income_band": np.random.choice(["LOW", "MID", "UPPER_MID", "HIGH"], n_customers),
            "customer_net_worth_band": np.random.choice(["LOW", "MID", "HIGH", "UHNW"], n_customers),
            "customer_middle_name": np.random.choice(["A", "B", "C", "D", "E"], n_customers),
            "customer_name_suffix": np.random.choice(["", "Jr", "Sr"], n_customers, p=[0.9, 0.05, 0.05])
        })
        CIF_KYC_DETAILS = pd.DataFrame({
            "customer_id": CIF_MASTER["customer_id"],
            "customer_last_kyc_update_date": random_date("2022-01-01", "2024-12-01", n_customers),
            "customer_kyc_status": np.random.choice(["OK", "PENDING", "EXPIRED"], n_customers, p=[0.84, 0.08, 0.08]),
            "customer_pep_flag": np.random.binomial(1, 0.02, n_customers),
            "customer_sanction_flag": np.random.binomial(1, 0.005, n_customers),
            "customer_adverse_media_flag": np.random.binomial(1, 0.03, n_customers),
            "customer_income_verification_flag": np.random.binomial(1, 0.82, n_customers),
            "customer_identity_verification_method": np.random.choice(["DOC", "VIDEO", "BRANCH"], n_customers),
            "customer_marital_status": np.random.choice(["SINGLE", "MARRIED", "OTHER"], n_customers),
            "customer_education_level": np.random.choice(["SCHOOL", "GRAD", "PG", "OTHER"], n_customers)
        })
        CIF_ADDRESS = pd.DataFrame({
            "customer_id": CIF_MASTER["customer_id"],
            "customer_address_line1": [f"ADDR_{i}" for i in range(n_customers)],
            "customer_address_line2": [f"AREA_{i%500}" for i in range(n_customers)],
            "customer_city": np.random.choice(["MUMBAI", "DELHI", "BENGALURU", "DUBAI", "SINGAPORE"], n_customers),
            "customer_state": np.random.choice(["MH", "DL", "KA", "DXB", "SG"], n_customers),
            "customer_country": np.random.choice(["IN", "AE", "SG", "UK"], n_customers, p=[0.86, 0.05, 0.05, 0.04]),
            "customer_postcode": np.random.randint(100000, 999999, n_customers).astype(str)
        })
        CIF_ADDRESS_DETAILS = pd.DataFrame({"customer_id": CIF_MASTER["customer_id"], "customer_residence_type": np.random.choice(["OWNED", "RENTED", "FAMILY"], n_customers), "customer_residence_duration_months": np.random.randint(1, 240, n_customers)})
        CIF_ADDRESS_HISTORY = pd.DataFrame({"customer_id": CIF_MASTER["customer_id"], "customer_previous_address": [f"PREV_ADDR_{i}" for i in range(n_customers)]})
        CIF_CONTACT_DETAILS = pd.DataFrame({"customer_id": CIF_MASTER["customer_id"], "customer_phone_number": [f"9{np.random.randint(100000000,999999999)}" for _ in range(n_customers)], "customer_email": [f"user{i}@mail.com" for i in range(n_customers)], "customer_email_domain": np.random.choice(["gmail.com", "yahoo.com", "outlook.com", "corp.com"], n_customers), "customer_landline_number": [f"0{np.random.randint(10000000,99999999)}" for _ in range(n_customers)]})
        CIF_ID_DOCUMENTS = pd.DataFrame({"customer_id": CIF_MASTER["customer_id"], "customer_identity_document_type": np.random.choice(["PAN", "PASSPORT", "DL", "NID"], n_customers), "customer_identity_document_number": [f"DOC{i:09d}" for i in range(n_customers)], "customer_identity_document_issue_date": random_date("2015-01-01", "2023-12-31", n_customers), "customer_identity_document_expiry_date": random_date("2025-01-01", "2035-12-31", n_customers)})
        CIF_SOCIAL_PROFILE = pd.DataFrame({"customer_id": CIF_MASTER["customer_id"], "customer_linkedin_profile": [f"https://linkedin.com/in/user{i}" for i in range(n_customers)]})
        CIF_EMPLOYMENT_DETAILS = pd.DataFrame({"customer_id": CIF_MASTER["customer_id"], "customer_employer_address": [f"EMP_ADDR_{i}" for i in range(n_customers)]})
        CIF_TAX_DETAILS = pd.DataFrame({"customer_id": CIF_MASTER["customer_id"], "customer_tax_residency_country": CIF_MASTER["customer_tax_residency_country"]})
        CIF_RISK_PROFILE = pd.DataFrame({"customer_id": CIF_MASTER["customer_id"], "customer_pep_indicator": np.random.binomial(1, 0.02, n_customers), "counterparty_risk_rating": np.random.choice(["LOW", "MEDIUM", "HIGH"], n_customers, p=[0.75, 0.18, 0.07])})
        CIF_VIDEO_KYC_LOG = pd.DataFrame({"customer_id": np.random.choice(CIF_MASTER["customer_id"], n_video_sessions), "customer_video_kyc_flag": np.random.binomial(1, 0.68, n_video_sessions), "customer_video_kyc_liveness_score": np.clip(np.random.normal(0.86, 0.08, n_video_sessions), 0, 1), "customer_video_kyc_face_match_score": np.clip(np.random.normal(0.88, 0.07, n_video_sessions), 0, 1), "customer_video_kyc_attempt_count": np.random.randint(1, 5, n_video_sessions)}).drop_duplicates(subset=["customer_id"], keep="last")
        DIGITAL_KYC_SESSION_LOG = pd.DataFrame({"video_session_id": [f"VIDSES{i:07d}" for i in range(n_video_sessions)], "customer_id": np.random.choice(CIF_MASTER["customer_id"], n_video_sessions), "video_session_duration": np.random.randint(30, 900, n_video_sessions), "video_agent_id": [f"AGENT{i%150:04d}" for i in range(n_video_sessions)], "video_background_noise_level": np.random.uniform(0, 1, n_video_sessions), "video_ip_address": [f"172.{np.random.randint(0,255)}.{np.random.randint(0,255)}.{np.random.randint(1,255)}" for _ in range(n_video_sessions)]})
        DIGITAL_KYC_BIOMETRIC_RESULT = pd.DataFrame({"video_session_id": DIGITAL_KYC_SESSION_LOG["video_session_id"], "video_face_match_score": np.clip(np.random.normal(0.87, 0.09, n_video_sessions), 0, 1), "video_liveness_score": np.clip(np.random.normal(0.85, 0.10, n_video_sessions), 0, 1)})
        ACCOUNT_MASTER = pd.DataFrame({"account_id": [f"ACC{i:07d}" for i in range(n_accounts)], "customer_id": np.random.choice(CIF_MASTER["customer_id"], n_accounts), "account_type": np.random.choice(["SAVINGS", "CURRENT", "WALLET"], n_accounts, p=[0.65, 0.25, 0.10]), "account_currency": np.random.choice(["INR", "USD", "AED"], n_accounts, p=[0.90, 0.07, 0.03]), "account_open_date": random_date("2018-01-01", "2024-09-30", n_accounts), "account_status": np.random.choice(["ACTIVE", "DORMANT", "FROZEN"], n_accounts, p=[0.86, 0.09, 0.05]), "account_balance_current": np.random.lognormal(mean=10.2, sigma=1.0, size=n_accounts), "account_closure_date": pd.NaT, "account_upgrade_date": random_date("2019-01-01", "2024-09-30", n_accounts), "account_downgrade_date": random_date("2019-01-01", "2024-09-30", n_accounts)})
        ACCOUNT_STATUS_HISTORY = pd.DataFrame({"account_id": ACCOUNT_MASTER["account_id"], "account_freeze_flag": np.random.binomial(1, 0.03, n_accounts), "account_freeze_reason_code": np.random.choice(["KYC", "AML", "OPS", "NA"], n_accounts), "account_reactivation_date": random_date("2022-01-01", "2024-12-31", n_accounts)})
        ACCOUNT_LIMIT_HISTORY = pd.DataFrame({"account_id": ACCOUNT_MASTER["account_id"], "account_limit_change_date": random_date("2022-01-01", "2024-12-31", n_accounts), "account_limit_previous_value": np.random.randint(10000, 500000, n_accounts), "account_limit_new_value": np.random.randint(10000, 700000, n_accounts)})
        DIGITAL_DEVICE_MASTER = pd.DataFrame({"device_id": [f"DEV{i:06d}" for i in range(n_devices)], "device_fingerprint_hash": [f"FP{i:010d}" for i in range(n_devices)], "device_type": np.random.choice(["MOBILE", "WEB", "POS", "ATM"], n_devices, p=[0.55, 0.25, 0.10, 0.10]), "device_os_type": np.random.choice(["ANDROID", "IOS", "WINDOWS", "LINUX"], n_devices), "device_os_version": np.random.choice(["10", "11", "12", "13", "14"], n_devices), "device_browser_type": np.random.choice(["CHROME", "SAFARI", "EDGE", "FIREFOX"], n_devices), "device_browser_version": np.random.choice(["100", "110", "120"], n_devices), "device_manufacturer": np.random.choice(["APPLE", "SAMSUNG", "XIAOMI", "LENOVO", "HP"], n_devices), "device_model": np.random.choice(["M1", "M2", "M3", "M4"], n_devices)})
        MOBILE_APP_DEVICE_REGISTRY = pd.DataFrame({"device_id": DIGITAL_DEVICE_MASTER["device_id"], "device_app_version": np.random.choice(["1.0", "1.1", "1.2", "2.0"], n_devices)})
        MOBILE_SECURITY_PROFILE = pd.DataFrame({"device_id": DIGITAL_DEVICE_MASTER["device_id"], "device_rooted_flag": np.random.binomial(1, 0.04, n_devices), "device_emulator_flag": np.random.binomial(1, 0.03, n_devices), "device_jailbreak_flag": np.random.binomial(1, 0.01, n_devices)})
        NETWORK_ACCESS_LOG = pd.DataFrame({"device_id": DIGITAL_DEVICE_MASTER["device_id"], "device_vpn_usage_flag": np.random.binomial(1, 0.05, n_devices), "device_proxy_usage_flag": np.random.binomial(1, 0.04, n_devices), "device_tor_network_flag": np.random.binomial(1, 0.005, n_devices), "device_ip_address": [f"10.{np.random.randint(0,255)}.{np.random.randint(0,255)}.{np.random.randint(1,255)}" for _ in range(n_devices)], "device_ip_country": np.random.choice(["IN", "AE", "SG", "UK"], n_devices, p=[0.86, 0.05, 0.05, 0.04]), "device_ip_city": np.random.choice(["MUMBAI", "DELHI", "BENGALURU", "DUBAI", "SINGAPORE"], n_devices), "device_asn_number": np.random.randint(1000, 99999, n_devices), "device_network_type": np.random.choice(["4G", "5G", "WIFI", "BROADBAND"], n_devices), "device_wifi_ssid_hash": [f"SSID{i:08d}" for i in range(n_devices)]})
        NETWORK_INTELLIGENCE_FEED = pd.DataFrame({"device_ip_address": NETWORK_ACCESS_LOG["device_ip_address"], "device_ip_risk_score": np.clip(np.random.normal(35, 20, n_devices), 0, 100)})
        DIGITAL_SESSION_LOG = pd.DataFrame({"device_session_id": [f"DSES{i:08d}" for i in range(n_devices)], "device_id": DIGITAL_DEVICE_MASTER["device_id"], "device_session_start_time": random_date("2023-01-01", "2024-12-31", n_devices), "device_session_end_time": random_date("2023-01-01", "2024-12-31", n_devices)})
        DIGITAL_LOGIN_EVENT_LOG = pd.DataFrame({"device_id": DIGITAL_DEVICE_MASTER["device_id"], "device_login_timestamp": random_date("2023-01-01", "2024-12-31", n_devices), "device_login_success_flag": np.random.binomial(1, 0.92, n_devices)})
        DIGITAL_BEHAVIOR_MONITOR = pd.DataFrame({"device_id": DIGITAL_DEVICE_MASTER["device_id"], "device_browser_automation_flag": np.random.binomial(1, 0.02, n_devices), "device_headless_browser_flag": np.random.binomial(1, 0.01, n_devices)})
        TELCO_SIM_REGISTRY = pd.DataFrame({"sim_card_number_hash": [f"SIM{i:010d}" for i in range(n_devices)], "sim_operator_name": np.random.choice(["OP1", "OP2", "OP3"], n_devices), "sim_activation_date": random_date("2020-01-01", "2024-12-31", n_devices), "sim_swap_flag": np.random.binomial(1, 0.03, n_devices)})
        TELCO_DATA_FEED = pd.DataFrame({"sim_card_number_hash": TELCO_SIM_REGISTRY["sim_card_number_hash"], "sim_imsi_number": [f"IMSI{i:010d}" for i in range(n_devices)], "sim_iccid_number": [f"ICCID{i:010d}" for i in range(n_devices)], "sim_last_swap_date": random_date("2022-01-01", "2024-12-31", n_devices), "sim_home_network_code": np.random.choice(["H1", "H2", "H3"], n_devices), "sim_roaming_flag": np.random.binomial(1, 0.04, n_devices), "sim_activation_channel": np.random.choice(["STORE", "APP", "PARTNER"], n_devices)})
        TELCO_DEVICE_REGISTRY = pd.DataFrame({"sim_card_number_hash": TELCO_SIM_REGISTRY["sim_card_number_hash"], "device_id": DIGITAL_DEVICE_MASTER["device_id"], "sim_registered_device_imei": [f"IMEI{i:010d}" for i in range(n_devices)]})
        DIM_MERCHANT = pd.DataFrame({"merchant_id": [f"MER{i:05d}" for i in range(n_merchants)], "merchant_name": [f"Merchant_{i}" for i in range(n_merchants)], "merchant_category_code": np.random.choice(["5411", "5732", "6012", "7995", "4829"], n_merchants), "merchant_industry_type": np.random.choice(["RETAIL", "SERVICES", "GAMING", "CRYPTO", "PAYOUT"], n_merchants), "merchant_onboarding_date": random_date("2019-01-01", "2024-11-30", n_merchants), "merchant_account_id": np.random.choice(ACCOUNT_MASTER["account_id"], n_merchants), "merchant_city": np.random.choice(["MUMBAI", "DELHI", "BENGALURU", "DUBAI", "SINGAPORE"], n_merchants), "merchant_state": np.random.choice(["MH", "DL", "KA", "DXB", "SG"], n_merchants), "merchant_country": np.random.choice(["IN", "AE", "SG", "UK"], n_merchants, p=[0.80, 0.08, 0.06, 0.06])})
        DIM_MERCHANT_TERMINAL = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_terminal_id": [f"MTERM{i:07d}" for i in range(n_merchants)], "merchant_device_id": np.random.choice(DIGITAL_DEVICE_MASTER["device_id"], n_merchants)})
        FACT_MERCHANT_CHARGEBACK = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_chargeback_count": np.random.poisson(1.5, n_merchants)})
        FACT_PAYMENT_GATEWAY_TXN = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_payment_gateway_id": [f"PG{i:06d}" for i in range(n_merchants)]})
        FACT_PAYMENT_GATEWAY_SETTLEMENT = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_instant_settlement_flag": np.random.binomial(1, 0.12, n_merchants)})
        MERCHANT_MASTER = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_registered_address": [f"MADDR_{i}" for i in range(n_merchants)], "merchant_contact_number": [f"8{np.random.randint(100000000,999999999)}" for _ in range(n_merchants)], "merchant_owner_name": [f"Owner_{i}" for i in range(n_merchants)]})
        MERCHANT_KYC_DETAILS = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_owner_pan": [f"PAN{i:010d}" for i in range(n_merchants)], "merchant_business_registration_date": random_date("2017-01-01", "2024-01-01", n_merchants)})
        MERCHANT_PROFILE = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_website_url": [f"https://merchant{i}.com" for i in range(n_merchants)], "merchant_business_type": np.random.choice(["ONLINE", "OFFLINE", "HYBRID"], n_merchants)})
        MERCHANT_SETTLEMENT_ACCOUNT = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_bank_account_number": [f"MBANK{i:010d}" for i in range(n_merchants)]})
        MERCHANT_SETTLEMENT_CONFIG = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_settlement_cycle": np.random.choice(["T+0", "T+1", "T+2"], n_merchants)})
        POS_TERMINAL_MASTER = pd.DataFrame({"merchant_id": DIM_MERCHANT["merchant_id"], "merchant_device_serial_number": [f"POSSER{i:010d}" for i in range(n_merchants)]})
        BENEFICIARY_MASTER = pd.DataFrame({"counterparty_account_number": [f"CPACC{i:08d}" for i in range(n_counterparties)], "counterparty_id": [f"CP{i:06d}" for i in range(n_counterparties)], "counterparty_bank_code": np.random.choice(["BANKA", "BANKB", "BANKC", "BANKD"], n_counterparties), "counterparty_ifsc_code": [f"IFSC{np.random.randint(1000,9999)}" for _ in range(n_counterparties)]})
        TBAADM_GAM = pd.DataFrame({"counterparty_account_number": BENEFICIARY_MASTER["counterparty_account_number"], "counterparty_account_type": np.random.choice(["SAVINGS", "CURRENT"], n_counterparties)})
        return {
            "CIF_MASTER": CIF_MASTER, "CIF_KYC_DETAILS": CIF_KYC_DETAILS, "CIF_ADDRESS": CIF_ADDRESS,
            "CIF_ADDRESS_DETAILS": CIF_ADDRESS_DETAILS, "CIF_ADDRESS_HISTORY": CIF_ADDRESS_HISTORY,
            "CIF_CONTACT_DETAILS": CIF_CONTACT_DETAILS, "CIF_ID_DOCUMENTS": CIF_ID_DOCUMENTS,
            "CIF_SOCIAL_PROFILE": CIF_SOCIAL_PROFILE, "CIF_EMPLOYMENT_DETAILS": CIF_EMPLOYMENT_DETAILS,
            "CIF_TAX_DETAILS": CIF_TAX_DETAILS, "CIF_RISK_PROFILE": CIF_RISK_PROFILE,
            "CIF_VIDEO_KYC_LOG": CIF_VIDEO_KYC_LOG, "DIGITAL_KYC_SESSION_LOG": DIGITAL_KYC_SESSION_LOG,
            "DIGITAL_KYC_BIOMETRIC_RESULT": DIGITAL_KYC_BIOMETRIC_RESULT, "ACCOUNT_MASTER": ACCOUNT_MASTER,
            "ACCOUNT_STATUS_HISTORY": ACCOUNT_STATUS_HISTORY, "ACCOUNT_LIMIT_HISTORY": ACCOUNT_LIMIT_HISTORY,
            "DIGITAL_DEVICE_MASTER": DIGITAL_DEVICE_MASTER, "MOBILE_APP_DEVICE_REGISTRY": MOBILE_APP_DEVICE_REGISTRY,
            "MOBILE_SECURITY_PROFILE": MOBILE_SECURITY_PROFILE, "NETWORK_ACCESS_LOG": NETWORK_ACCESS_LOG,
            "NETWORK_INTELLIGENCE_FEED": NETWORK_INTELLIGENCE_FEED, "DIGITAL_SESSION_LOG": DIGITAL_SESSION_LOG,
            "DIGITAL_LOGIN_EVENT_LOG": DIGITAL_LOGIN_EVENT_LOG, "DIGITAL_BEHAVIOR_MONITOR": DIGITAL_BEHAVIOR_MONITOR,
            "TELCO_SIM_REGISTRY": TELCO_SIM_REGISTRY, "TELCO_DATA_FEED": TELCO_DATA_FEED,
            "TELCO_DEVICE_REGISTRY": TELCO_DEVICE_REGISTRY, "DIM_MERCHANT": DIM_MERCHANT,
            "DIM_MERCHANT_TERMINAL": DIM_MERCHANT_TERMINAL, "FACT_MERCHANT_CHARGEBACK": FACT_MERCHANT_CHARGEBACK,
            "FACT_PAYMENT_GATEWAY_TXN": FACT_PAYMENT_GATEWAY_TXN, "FACT_PAYMENT_GATEWAY_SETTLEMENT": FACT_PAYMENT_GATEWAY_SETTLEMENT,
            "MERCHANT_MASTER": MERCHANT_MASTER, "MERCHANT_KYC_DETAILS": MERCHANT_KYC_DETAILS,
            "MERCHANT_PROFILE": MERCHANT_PROFILE, "MERCHANT_SETTLEMENT_ACCOUNT": MERCHANT_SETTLEMENT_ACCOUNT,
            "MERCHANT_SETTLEMENT_CONFIG": MERCHANT_SETTLEMENT_CONFIG, "POS_TERMINAL_MASTER": POS_TERMINAL_MASTER,
            "BENEFICIARY_MASTER": BENEFICIARY_MASTER, "TBAADM.GAM": TBAADM_GAM
        }

    def generate_transaction_tables(self, raw_tables):
        print_step("STEP 2: GENERATE TRANSACTION TABLES")
        CIF_MASTER = raw_tables["CIF_MASTER"]
        ACCOUNT_MASTER = raw_tables["ACCOUNT_MASTER"]
        DIGITAL_DEVICE_MASTER = raw_tables["DIGITAL_DEVICE_MASTER"]
        NETWORK_ACCESS_LOG = raw_tables["NETWORK_ACCESS_LOG"]
        DIM_MERCHANT = raw_tables["DIM_MERCHANT"]
        DIM_MERCHANT_TERMINAL = raw_tables["DIM_MERCHANT_TERMINAL"]
        BENEFICIARY_MASTER = raw_tables["BENEFICIARY_MASTER"]
        accounts = ACCOUNT_MASTER["account_id"].tolist()
        devices = DIGITAL_DEVICE_MASTER["device_id"].tolist()
        merchants = DIM_MERCHANT["merchant_id"].tolist()
        counterparties = BENEFICIARY_MASTER["counterparty_id"].tolist()
        account_customer_map = ACCOUNT_MASTER.set_index("account_id")["customer_id"].to_dict()
        device_ip_map = NETWORK_ACCESS_LOG.set_index("device_id")["device_ip_address"].to_dict()
        rows_upi, rows_upi_profile, rows_aml, rows_atm, rows_atm_log = [], [], [], [], []
        rows_branch, rows_depositor, rows_branch_master, rows_crm, rows_kyc_customer, rows_screen, rows_branch_agent = [], [], [], [], [], [], []
        rows_merchant, rows_m_alert, rows_m_sar, rows_api, rows_digital_syn = [], [], [], [], []
        tx_id_counter = 0

        def choose_amount(category):
            mapping = {
                "legit": np.random.lognormal(8.8, 0.8), "first_time_mule": np.random.lognormal(9.7, 1.0),
                "sleeper_mule": np.random.lognormal(10.0, 1.1), "layering_mule": np.random.lognormal(9.4, 0.9),
                "pass_through_mule": np.random.lognormal(10.1, 0.8), "fanout_mule": np.random.lognormal(9.2, 0.8),
                "cashout_mule": np.random.lognormal(10.2, 0.7), "merchant_mule": np.random.lognormal(9.6, 1.0),
                "synthetic_mule": np.random.lognormal(8.9, 1.1)
            }
            return float(mapping[category])

        for category in CONFIG["mule_categories"]:
            n_cat = np.random.randint(CONFIG["records_per_category_min"], CONFIG["records_per_category_max"] + 1)
            for i in range(n_cat):
                tx_id_counter += 1
                channel = np.random.choice(CONFIG["channels"], p=[0.35, 0.10, 0.12, 0.18, 0.05, 0.20])
                account_id = random.choice(accounts)
                customer_id = account_customer_map[account_id]
                device_id = random.choice(devices)
                counterparty_id = random.choice(counterparties)
                merchant_id = random.choice(merchants)
                ts = pd.Timestamp("2023-01-01") + pd.to_timedelta(np.random.randint(0, 730 * 24 * 60), unit="m")
                amount = choose_amount(category)
                ip_addr = device_ip_map.get(device_id, None)
                if category == "first_time_mule": amount *= 1.6
                elif category == "sleeper_mule": ts = ts + pd.Timedelta(days=np.random.randint(30, 90))
                elif category == "fanout_mule": counterparty_id = f"CP_FAN_{tx_id_counter}_{np.random.randint(1000)}"
                elif category == "cashout_mule": channel = np.random.choice(["ATM", "BRANCH"])
                elif category == "merchant_mule": channel = "MERCHANT"
                is_alert = int(category in CONFIG["risky_labels"] and np.random.rand() < 0.35)
                is_sar = int(category in CONFIG["risky_labels"] and np.random.rand() < 0.12)
                if channel == "UPI":
                    upi_txn_id = f"UPI{tx_id_counter:010d}"
                    vpa_id = f"VPA_{customer_id}"
                    rows_upi_profile.append({"upi_vpa_id": vpa_id, "customer_id": customer_id, "account_id": account_id, "upi_vpa_creation_date": pd.Timestamp("2022-01-01") + pd.to_timedelta(np.random.randint(0, 1000), unit="D"), "upi_linked_account_count": np.random.randint(1, 4), "upi_device_binding_count": np.random.randint(1, 4), "upi_primary_device_id": device_id})
                    rows_upi.append({"upi_transaction_id": upi_txn_id, "upi_transaction_timestamp": ts, "upi_transaction_amount": amount, "upi_transaction_type": np.random.choice(["CREDIT", "DEBIT", "TRANSFER_IN", "TRANSFER_OUT", "PAYMENT"]), "upi_transaction_status": np.random.choice(["SUCCESS", "FAILED", "REVERSED"], p=[0.92, 0.05, 0.03]), "upi_payee_vpa": counterparty_id, "upi_payer_vpa": vpa_id, "upi_payee_bank_code": np.random.choice(["BANKA", "BANKB", "BANKC"]), "upi_chargeback_indicator": np.random.binomial(1, 0.03), "customer_id": customer_id, "account_id": account_id, "device_id": device_id, "mule_category": category})
                    rows_aml.append({"upi_transaction_id": upi_txn_id, "upi_fraud_alert_flag": is_alert, "upi_sar_report_flag": is_sar})
                elif channel == "ATM":
                    atm_txn_id = f"ATM{tx_id_counter:010d}"
                    atm_terminal_id = f"ATMTERM{np.random.randint(1000,9999)}"
                    rows_atm.append({"atm_transaction_id": atm_txn_id, "atm_transaction_timestamp": ts, "atm_transaction_type": np.random.choice(["CASHOUT", "BALANCE_INQ", "WITHDRAWAL"]), "atm_transaction_amount": amount, "atm_terminal_id": atm_terminal_id, "atm_terminal_location": np.random.choice(["MALL", "BRANCH", "STREET"]), "atm_city": np.random.choice(["MUMBAI", "DELHI", "BENGALURU"]), "atm_state": np.random.choice(["MH", "DL", "KA"]), "atm_country": "IN", "atm_card_number_hash": f"CARD{np.random.randint(1000000,9999999)}", "customer_id": customer_id, "account_id": account_id, "device_id": device_id, "mule_category": category})
                    rows_atm_log.append({"atm_transaction_id": atm_txn_id, "atm_card_capture_flag": np.random.binomial(1, 0.01), "atm_error_code": np.random.choice(["0", "1", "2", "NA"], p=[0.88, 0.04, 0.03, 0.05])})
                elif channel == "BRANCH":
                    br_txn_id = f"BRN{tx_id_counter:010d}"
                    rows_branch.append({"branch_transaction_id": br_txn_id, "branch_transaction_timestamp": ts, "branch_transaction_type": np.random.choice(["CASH_DEPOSIT", "CASH_WITHDRAWAL", "THIRD_PARTY_DEPOSIT"]), "branch_cash_deposit_amount": amount, "branch_third_party_deposit_flag": np.random.binomial(1, 0.15), "customer_id": customer_id, "account_id": account_id, "mule_category": category})
                    rows_depositor.append({"branch_transaction_id": br_txn_id, "branch_depositor_identity_hash": counterparty_id})
                    rows_branch_master.append({"branch_transaction_id": br_txn_id, "branch_high_risk_branch_flag": np.random.binomial(1, 0.06)})
                    rows_crm.append({"customer_id": customer_id, "branch_deposit_customer_risk_rating": np.random.choice(["LOW", "MEDIUM", "HIGH"])})
                    rows_kyc_customer.append({"customer_id": customer_id, "branch_deposit_kyc_risk_score": np.random.uniform(0, 100), "branch_deposit_pep_flag": np.random.binomial(1, 0.02)})
                    rows_screen.append({"customer_id": customer_id, "branch_deposit_sanction_match_flag": np.random.binomial(1, 0.01)})
                    rows_branch_agent.append({"branch_transaction_id": br_txn_id, "branch_deposit_agent_flag": np.random.binomial(1, 0.03)})
                elif channel == "MERCHANT":
                    merch_txn_id = f"MERCHTX{tx_id_counter:010d}"
                    merch_dev = random.choice(DIM_MERCHANT_TERMINAL["merchant_device_id"].tolist())
                    rows_merchant.append({"merchant_transaction_id": merch_txn_id, "merchant_transaction_timestamp": ts, "merchant_transaction_amount": amount, "merchant_transaction_type": np.random.choice(["PAYMENT", "REFUND", "SETTLEMENT"]), "merchant_card_present_flag": np.random.binomial(1, 0.4), "merchant_card_not_present_flag": np.random.binomial(1, 0.6), "merchant_customer_id": customer_id, "merchant_id": merchant_id, "merchant_account_id": account_id, "merchant_device_id": merch_dev, "mule_category": category})
                    rows_m_alert.append({"merchant_id": merchant_id, "merchant_fraud_alert_flag": is_alert})
                    rows_m_sar.append({"merchant_id": merchant_id, "merchant_sar_report_flag": is_sar})
                elif channel == "API":
                    rows_api.append({"api_client_id": f"API_{customer_id}", "api_application_name": np.random.choice(["MOBAPP", "WEBPORTAL", "PARTNERAPP"]), "api_endpoint_called": np.random.choice(["/transfer", "/balance", "/beneficiary", "/merchant/pay"]), "api_request_payload_size": np.random.randint(100, 10000), "api_response_code": np.random.choice([200, 400, 401, 429, 500], p=[0.80, 0.05, 0.03, 0.05, 0.07]), "api_authentication_method": np.random.choice(["OTP", "TOKEN", "BIOMETRIC"]), "api_rate_limit_exceeded_flag": np.random.binomial(1, 0.04), "customer_id": customer_id, "account_id": account_id, "device_id": device_id, "event_ts": ts, "amount": amount, "counterparty_id": counterparty_id, "mule_category": category})
                else:
                    rows_digital_syn.append({"device_id": device_id, "device_session_id": f"DSES_SYN_{tx_id_counter:010d}", "device_login_timestamp": ts, "device_login_success_flag": np.random.binomial(1, 0.92), "customer_id": customer_id, "account_id": account_id, "ip_address": ip_addr, "amount": amount, "counterparty_id": counterparty_id, "mule_category": category})
        UPI_PROFILE = pd.DataFrame(rows_upi_profile).drop_duplicates(subset=["upi_vpa_id"], keep="last")
        UPI_TRANSACTION = pd.DataFrame(rows_upi)
        AML_ALERT_ENGINE = pd.DataFrame(rows_aml).drop_duplicates()
        ATM_TRANSACTION = pd.DataFrame(rows_atm)
        ATM_TRANSACTION_LOG = pd.DataFrame(rows_atm_log)
        ATM_DEVICE_MASTER = pd.DataFrame({"atm_terminal_id": ATM_TRANSACTION["atm_terminal_id"].dropna().unique()})
        if len(ATM_DEVICE_MASTER) > 0:
            ATM_DEVICE_MASTER["atm_terminal_model"] = np.random.choice(["NCR", "DIEBOLD", "HITACHI"], len(ATM_DEVICE_MASTER))
            ATM_DEVICE_MASTER["atm_terminal_owner"] = np.random.choice(["BANK", "PARTNER"], len(ATM_DEVICE_MASTER))
        T_TRAN = pd.DataFrame(rows_branch)
        AML_DEPOSITOR_MASTER = pd.DataFrame(rows_depositor)
        BRANCH_MASTER = pd.DataFrame(rows_branch_master).drop_duplicates()
        CRM_CUSTOMER_MASTER = pd.DataFrame(rows_crm).drop_duplicates(subset=["customer_id"], keep="last")
        KYC_CUSTOMER_MASTER = pd.DataFrame(rows_kyc_customer).drop_duplicates(subset=["customer_id"], keep="last")
        AML_SCREENING_RESULTS = pd.DataFrame(rows_screen).drop_duplicates(subset=["customer_id"], keep="last")
        BRANCH_AGENT_MASTER = pd.DataFrame(rows_branch_agent).drop_duplicates()
        FACT_MERCHANT_TRANSACTION = pd.DataFrame(rows_merchant)
        AML_FRAUD_ALERTS = pd.DataFrame(rows_m_alert).drop_duplicates(subset=["merchant_id"], keep="last")
        AML_SAR_CASES = pd.DataFrame(rows_m_sar).drop_duplicates(subset=["merchant_id"], keep="last")
        API_GATEWAY_AUDIT_LOG = pd.DataFrame(rows_api)
        DIGITAL_LOGIN_EVENTS_SYN = pd.DataFrame(rows_digital_syn)
        return {
            "UPI_PROFILE": UPI_PROFILE, "UPI_TRANSACTION": UPI_TRANSACTION, "AML_ALERT_ENGINE": AML_ALERT_ENGINE,
            "ATM_TRANSACTION": ATM_TRANSACTION, "ATM_TRANSACTION_LOG": ATM_TRANSACTION_LOG, "ATM_DEVICE_MASTER": ATM_DEVICE_MASTER,
            "TBAADM.T_TRAN": T_TRAN, "AML_DEPOSITOR_MASTER": AML_DEPOSITOR_MASTER, "BRANCH_MASTER": BRANCH_MASTER,
            "CRM_CUSTOMER_MASTER": CRM_CUSTOMER_MASTER, "KYC_CUSTOMER_MASTER": KYC_CUSTOMER_MASTER,
            "AML_SCREENING_RESULTS": AML_SCREENING_RESULTS, "BRANCH_AGENT_MASTER": BRANCH_AGENT_MASTER,
            "FACT_MERCHANT_TRANSACTION": FACT_MERCHANT_TRANSACTION, "AML_FRAUD_ALERTS": AML_FRAUD_ALERTS,
            "AML_SAR_CASES": AML_SAR_CASES, "API_GATEWAY_AUDIT_LOG": API_GATEWAY_AUDIT_LOG,
            "DIGITAL_LOGIN_EVENTS_SYN": DIGITAL_LOGIN_EVENTS_SYN
        }
