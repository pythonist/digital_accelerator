import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta
import os

# ---------- CONFIG ----------
np.random.seed(42)
random.seed(42)

# Ask user for bank name at runtime
BANK_NAME = input("Enter bank name: ").strip()
if BANK_NAME == "":
    BANK_NAME = "DefaultBank"

BASE_DIR = r"E:\VS code stuff\Banks Data"
OUTPUT_DIR = os.path.join(BASE_DIR, BANK_NAME)
os.makedirs(OUTPUT_DIR, exist_ok=True)

N = 10000  # number of transactions/alerts to generate
N_CUSTOMERS = int(N * 0.6)
N_ACCOUNTS = int(N * 0.9)
# --------------------------------

def random_date(start, end):
    return start + timedelta(seconds=random.randint(0, int((end - start).total_seconds())))

def random_amount(base_mean=20000, scale=1.0):
    base = np.random.exponential(scale=base_mean * scale)
    return round(min(base + np.random.randint(50, 2000), 2_000_000), 2)

def pick_state():
    return random.choice(["MH", "DL", "KA", "TN", "GJ", "WB", "RJ", "UP"])

def pick_risk():
    return random.choice(["LOW", "MEDIUM", "HIGH", "CRITICAL"])

def pick_txn_type():
    return random.choice(["CASH_DEPOSIT", "NEFT", "RTGS", "IMPS", "UPI", "SWIFT"])

# ---------- ID GENERATION ----------
def make_case_id(i):    return f"CASE{int(i):06d}"
def make_account_id(i): return f"123213217{int(i):06d}"
def make_customer_id(i):return f"CUST{int(i):06d}"
def make_alert_id(i):   return f"AL{100000 + int(i)}"
def make_txn_id(i):     return f"TX{200000 + int(i)}"

# ---------- Create master keys ----------
case_ids = [make_case_id(i+1) for i in range(int(N/3) if N >= 3 else 1)]
customer_ids = [make_customer_id(i+1) for i in range(N_CUSTOMERS)]
account_ids = [make_account_id(i+1) for i in range(N_ACCOUNTS)]
txn_ids = [make_txn_id(i+1) for i in range(N)]  # exactly N txn ids

# ---------- Base customer profiles ----------
customers_profile = {}
for i, cid in enumerate(customer_ids):
    monthly_avg = float(np.random.lognormal(mean=10, sigma=0.6))
    monthly_avg = min(max(monthly_avg, 1000), 300_000)
    txn_pref = random.choices(["UPI", "NEFT", "CASH_DEPOSIT", "IMPS", "RTGS"], weights=[40,25,15,15,5], k=3)
    customers_profile[cid] = {
        "monthly_avg": monthly_avg,
        "txn_pref": txn_pref,
        "state": pick_state(),
        "customer_type": random.choice(["INDIVIDUAL","CORPORATE"]),
        "occupation": random.choice(["EMPLOYEE","SELF_EMPLOYED","TRADER","STUDENT","HOUSEWIFE","RETIRED"]),
        "pan_flag": random.choices(["VALID","INVALID","MISSING"], weights=[0.75,0.1,0.15])[0],
        "kyc_risk": random.choice(["LOW","MEDIUM","HIGH"])
    }

# ---------- Map accounts to customers ----------
acct_to_cust = {}
for acc in account_ids:
    cust = random.choice(customer_ids)
    acct_to_cust[acc] = cust

# ---------- Inject special typology accounts ----------
num_circles = max(1, int(len(account_ids) * 0.3))  # reduce if few accounts
circle_groups = []
for _ in range(num_circles):
    size = random.randint(3, min(7, len(account_ids)))
    members = random.sample(account_ids, size)
    circle_groups.append(members)

num_chains = max(1, int(len(account_ids) * 0.5))
chains = []
for _ in range(num_chains):
    length = random.randint(5, min(12, len(account_ids)))
    chain = random.sample(account_ids, length)
    chains.append(chain)

num_mules = min(80, max(1, int(len(account_ids) * 0.3)))
mule_accounts = random.sample(account_ids, num_mules)

high_risk_accounts = set(random.sample(account_ids, max(1, int(len(account_ids)*0.05))))

# ---------- Build transactions & alerts ----------
alerts_rows = []
transactions_rows = []
accounts_rows = []
customers_rows = []
cases_rows = []

# Pre-create account rows (metadata)
for acc in account_ids:
    cust = acct_to_cust[acc]
    accounts_rows.append({
        "ACCOUNT_ID": acc,
        "CUSTOMER_ID": cust,
        "ACCT_TYPE": random.choice(["SAVINGS","CURRENT","NRE","NRO","OD"]),
        "BRANCH_CODE": str(1000 + (int(acc[-4:]) % 50)),
        "OPEN_DATE": random_date(datetime(2015,1,1), datetime(2022,12,31)).strftime("%Y-%m-%d"),
        "RISK_RATING": "HIGH" if acc in high_risk_accounts else random.choice(["LOW","MEDIUM"])
    })

# Pre-create customer rows
for cid in customer_ids:
    prof = customers_profile[cid]
    customers_rows.append({
        "CUSTOMER_ID": cid,
        "CUSTOMER_TYPE": prof["customer_type"],
        "OCCUPATION": prof["occupation"],
        "STATE": prof["state"],
        "PAN_FLAG": prof["pan_flag"],
        "KYC_RISK": prof["kyc_risk"]
    })

# Pre-create cases
for c in case_ids:
    cases_rows.append({
        "CASE_ID": c,
        "CASE_CREATE_DATE": random_date(datetime(2023,1,1), datetime(2024,12,31)).strftime("%Y-%m-%d"),
        "CASE_STATUS": random.choice(["OPEN","IN_REVIEW","ESCALATED","CLOSED"]),
        "CASE_RISK_LEVEL": random.choice(["LOW","MEDIUM","HIGH","CRITICAL"])
    })

# Helper to add a transaction + optional alert entry
def add_txn_alert(idx, acc_from, acc_to, cust_from, cust_to, case_id, tx_date, tx_type, amount, country="IN", alert_flag=False, alert_type=None):
    # guard to avoid index error on txn_ids
    if idx < 0 or idx >= len(txn_ids):
        return False
    txn_id = txn_ids[idx]
    transactions_rows.append({
        "TRANSACTION_ID": txn_id,
        "ACCOUNT_ID": acc_from,
        "CUSTOMER_ID": cust_from,
        "CASE_ID": case_id,
        "TXN_DATE": tx_date.strftime("%Y-%m-%d"),
        "TXN_TYPE": tx_type,
        "TXN_AMOUNT": amount,
        "COUNTERPARTY_COUNTRY": country
    })
    if alert_flag:
        alerts_rows.append({
            "ALERTID": make_alert_id(len(alerts_rows) + 1),
            "CASEID": case_id,
            "CUSTOMERID": cust_from,
            "ACCOUNTID": acc_from,
            "TRANSACTION_ID": txn_id,
            "ALERT_TYPE": alert_type or random.choice(["Unusual Cash Activity","Rapid Funds Movement","Structuring","Dormant Reactivation","High-Risk Jurisdiction"]),
            "ALERT_RISK_SCORE": int(min(max(np.random.normal(70,10),40),98)),
            "ALERT_DATE": tx_date.strftime("%Y-%m-%d")
        })
    return True

# MAIN loop: create up to N transactions, mixing normal + patterns
start_date = datetime(2023,1,1)
end_date = datetime(2024,12,31)

idx = 0
# 1) Circular flows
for group in circle_groups:
    if idx >= N: break
    loops = random.randint(1, 5)  # reduced loops to avoid overshoot
    for _ in range(loops):
        if idx >= N: break
        base_amount = random_amount(50000, scale=0.8)
        tx_date = random_date(start_date, end_date)
        for i in range(len(group)):
            if idx >= N: break
            acc_from = group[i]
            acc_to = group[(i+1) % len(group)]
            cust_from = acct_to_cust[acc_from]
            cust_to = acct_to_cust[acc_to]
            amt = round(base_amount * np.random.uniform(0.6, 1.2), 2)
            added = add_txn_alert(idx, acc_from, acc_to, cust_from, cust_to, random.choice(case_ids), tx_date, pick_txn_type(), amt, random.choice(["IN","AE","SG"]), alert_flag=True, alert_type="Circular Flow Detected")
            if not added:
                break
            idx += 1
        if idx >= N: break

# 2) Layering chains
for chain in chains:
    if idx >= N: break
    chain_txn_count = random.randint(4, 12)
    amt = random_amount(100000, scale=1.2)
    tx_date = random_date(start_date, end_date)
    for i in range(chain_txn_count):
        if idx >= N: break
        acc_from = chain[i % len(chain)]
        acc_to = chain[(i+1) % len(chain)]
        cust_from = acct_to_cust[acc_from]
        cust_to = acct_to_cust[acc_to]
        factor = 0.7 + 0.6 * (i / max(1, chain_txn_count))
        a = round(amt * factor * np.random.uniform(0.5, 1.0), 2)
        alert_flag = (i == chain_txn_count - 1)
        add_txn_alert(idx, acc_from, acc_to, cust_from, cust_to, random.choice(case_ids), tx_date + timedelta(minutes=i), "NEFT", a, random.choice(["IN","HK","SG"]), alert_flag=alert_flag, alert_type="Layering Chain" if alert_flag else None)
        idx += 1

# 3) Mule patterns
for mule in mule_accounts:
    if idx >= N: break
    num_incomings = random.randint(4, 12)
    total_in = 0.0
    for j in range(num_incomings):
        if idx >= N: break
        acc_from = random.choice(account_ids)
        cust_from = acct_to_cust[acc_from]
        acc_to = mule
        cust_to = acct_to_cust[acc_to]
        amt = round(np.random.uniform(200, 2000), 2)
        tx_date = random_date(start_date, end_date)
        add_txn_alert(idx, acc_from, acc_to, cust_from, cust_to, random.choice(case_ids), tx_date, "UPI", amt, "IN", alert_flag=False)
        total_in += amt
        idx += 1
    if idx < N:
        acc_from = mule
        acc_to = random.choice(account_ids)
        cust_from = acct_to_cust[acc_from]
        cust_to = acct_to_cust[acc_to]
        tx_date = random_date(start_date, end_date)
        add_txn_alert(idx, acc_from, acc_to, cust_from, cust_to, random.choice(case_ids), tx_date, "NEFT", round(total_in * np.random.uniform(0.85, 0.99), 2), "IN", alert_flag=True, alert_type="Mule Activity Suspected")
        idx += 1

# 4) Fill remaining transactions with baseline behavior + occasional deviations
while idx < N:
    acc_from = random.choice(account_ids)
    cust_from = acct_to_cust[acc_from]
    prof = customers_profile[cust_from]
    is_deviation = random.random() < 0.08
    if is_deviation:
        amt = random_amount(base_mean=prof["monthly_avg"]*3, scale=1.5)
        tx_type = random.choice(["RTGS","NEFT"])
        alert_flag = True
        alert_type = random.choice(["Unusual Cash Activity","Rapid Funds Movement","High-Risk Jurisdiction"])
    else:
        amt = random_amount(base_mean=prof["monthly_avg"], scale=0.9)
        tx_type = random.choice(prof["txn_pref"])
        alert_flag = False if random.random() < 0.95 else True
        alert_type = None

    acc_to = random.choice(account_ids)
    cust_to = acct_to_cust[acc_to]
    tx_date = random_date(start_date, end_date)
    country = random.choice(["IN","US","AE","SG","HK","GB"])
    add_txn_alert(idx, acc_from, acc_to, cust_from, cust_to, random.choice(case_ids), tx_date, tx_type, amt, country, alert_flag=alert_flag, alert_type=alert_type)
    idx += 1

# Convert to DataFrames
transactions_df = pd.DataFrame(transactions_rows[:N])  # ensure length <= N
alerts_df = pd.DataFrame(alerts_rows)
accounts_df = pd.DataFrame(accounts_rows)
customers_df = pd.DataFrame(customers_rows)
cases_df = pd.DataFrame(cases_rows)

# If alerts fewer than 20% of N, sample transactions to create synthetic alerts
if len(alerts_df) < int(N * 0.2) and len(transactions_df) > 0:
    missing = int(N*0.2) - len(alerts_df)
    sample_txns = transactions_df.sample(missing, replace=False, random_state=42)
    for _, row in sample_txns.iterrows():
        alerts_rows.append({
            "ALERTID": make_alert_id(len(alerts_rows) + 1),
            "CASEID": row["CASE_ID"],
            "CUSTOMERID": row["CUSTOMER_ID"],
            "ACCOUNTID": row["ACCOUNT_ID"],
            "TRANSACTION_ID": row["TRANSACTION_ID"],
            "ALERT_TYPE": random.choice(["Suspicious Pattern", "Unusual Cash Activity"]),
            "ALERT_RISK_SCORE": int(min(max(np.random.normal(65,12),40),98)),
            "ALERT_DATE": row["TXN_DATE"]
        })
    alerts_df = pd.DataFrame(alerts_rows)

# Save CSVs
# transactions_df.to_csv(os.path.join(OUTPUT_DIR, "transactions.csv"), index=False)
# alerts_df.to_csv(os.path.join(OUTPUT_DIR, "alerts.csv"), index=False)
# accounts_df.to_csv(os.path.join(OUTPUT_DIR, "accounts.csv"), index=False)
# customers_df.to_csv(os.path.join(OUTPUT_DIR, "customers.csv"), index=False)
# cases_df.to_csv(os.path.join(OUTPUT_DIR, "cases.csv"), index=False)

print("Generated rows:")
print(" transactions:", len(transactions_df))
print(" alerts:", len(alerts_df))
print(" accounts:", len(accounts_df))
print(" customers:", len(customers_df))
print(" cases:", len(cases_df))
print("Saved CSVs to:", OUTPUT_DIR)
