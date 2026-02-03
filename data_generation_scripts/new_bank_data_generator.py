import pandas as pd
import numpy as np
import random
from datetime import datetime, timedelta
import os

# ================= CONFIG =================
np.random.seed(42)
random.seed(42)

BANK_NAME = input("Enter bank name: ").strip() or "DefaultBank"

BASE_DIR = r"E:\VS code stuff\Banks Data"
OUTPUT_DIR = os.path.join(BASE_DIR, BANK_NAME)
os.makedirs(OUTPUT_DIR, exist_ok=True)

N_TXNS = 1000
MIN_ALERTS = 100

START = datetime(2023,1,1)
END = datetime(2024,12,31)

# ================= HELPERS =================
def rdate(start, end):
    return start + timedelta(seconds=random.randint(0, int((end-start).total_seconds())))

def ramt(mean):
    return round(min(np.random.lognormal(mean=np.log(mean), sigma=0.6), 2_000_000), 2)

def cid(i): return f"CUST{i:06d}"
def aid(i): return f"ACCT{i:06d}"
def tid(i): return f"TXN{i:07d}"
def alid(i): return f"AL{i:07d}"
def caseid(i): return f"CASE{i:06d}"

# ================= MASTER DATA =================
CUSTOMERS = [cid(i) for i in range(1, 6001)]
ACCOUNTS = [aid(i) for i in range(1, 9001)]

acct_to_cust = {a: random.choice(CUSTOMERS) for a in ACCOUNTS}

customer_profiles = {
    c: {
        "AVG_TXN": random.randint(3000, 60000),
        "STATE": random.choice(["MH","DL","KA","TN","GJ","WB","RJ","UP"]),
        "CUSTOMER_TYPE": random.choice(["INDIVIDUAL","CORPORATE"]),
        "OCCUPATION": random.choice(["EMPLOYEE","SELF_EMPLOYED","TRADER","STUDENT","RETIRED"]),
        "KYC_RISK": random.choice(["LOW","MEDIUM","HIGH"])
    } for c in CUSTOMERS
}

# ================= BUFFERS =================
TXNS, ALERTS = [], []
CASE_SET = set()
idx = 0

def add_txn(acc_from, acc_to, amt, tx_type, date, alert=False):
    global idx
    tx_id = tid(idx)
    case = caseid(random.randint(1,5000))

    TXNS.append({
        "TRANSACTION_ID": tx_id,
        "ACCOUNT_ID": acc_from,
        "CUSTOMER_ID": acct_to_cust[acc_from],
        "CASE_ID": case,
        "TXN_DATE": date.strftime("%Y-%m-%d"),
        "TXN_TYPE": tx_type,
        "TXN_AMOUNT": amt,
        "COUNTRY": random.choice(["IN","AE","SG","HK","US","GB"])
    })

    if alert:
        ALERTS.append({
            "ALERT_ID": alid(len(ALERTS)+1),
            "CASE_ID": case,
            "ACCOUNT_ID": acc_from,
            "CUSTOMER_ID": acct_to_cust[acc_from],
            "TRANSACTION_ID": tx_id,
            "ALERT_SCORE": random.randint(65,95),
            "ALERT_DATE": date.strftime("%Y-%m-%d")
        })
        CASE_SET.add(case)

    idx += 1

# ================= AML BEHAVIOR PATTERNS =================

# Hidden network reuse
shared_counterparties = random.sample(ACCOUNTS, 300)

for _ in range(600):
    add_txn(
        random.choice(ACCOUNTS),
        random.choice(shared_counterparties),
        ramt(40000) * random.uniform(0.6,1.4),
        random.choice(["UPI","NEFT","IMPS"]),
        rdate(START,END)
    )

for _ in range(200):
    add_txn(
        random.choice(shared_counterparties),
        random.choice(ACCOUNTS),
        ramt(35000) * random.uniform(0.7,1.3),
        random.choice(["NEFT","RTGS"]),
        rdate(START+timedelta(days=30),END),
        random.random() < 0.05
    )

# Layering
for _ in range(180):
    chain = random.sample(ACCOUNTS, random.randint(6,10))
    base = ramt(120000)
    d = rdate(START, END)
    for i,a in enumerate(chain):
        add_txn(
            a,
            chain[(i+1)%len(chain)],
            round(base*(0.7 + i*0.08),2),
            random.choice(["NEFT","IMPS"]),
            d+timedelta(minutes=i),
            i==len(chain)-1
        )

# Structuring
for _ in range(160):
    acc = random.choice(ACCOUNTS)
    d = rdate(START, END)
    for i in range(8):
        add_txn(
            acc,
            random.choice(ACCOUNTS),
            random.uniform(9000,9900),
            "CASH_DEPOSIT",
            d+timedelta(hours=i),
            i==7
        )

# Mule activity
for _ in range(120):
    mule = random.choice(ACCOUNTS)
    d = rdate(START, END)
    total = 0
    for i in range(6):
        amt = random.uniform(300,2000)
        total += amt
        add_txn(
            random.choice(ACCOUNTS),
            mule,
            amt,
            "UPI",
            d+timedelta(minutes=i)
        )
    add_txn(
        mule,
        random.choice(ACCOUNTS),
        round(total*0.95,2),
        "NEFT",
        d+timedelta(hours=1),
        True
    )

# Dormant reactivation
for _ in range(100):
    acc = random.choice(ACCOUNTS)
    d = rdate(START, END)
    for i in range(6):
        add_txn(
            acc,
            random.choice(ACCOUNTS),
            ramt(80000),
            "RTGS",
            d+timedelta(minutes=i),
            i==5
        )

# Velocity spike
for _ in range(120):
    acc = random.choice(ACCOUNTS)
    d = rdate(START, END)
    for ch in ["UPI","IMPS","NEFT","CASH_DEPOSIT"]:
        add_txn(acc, random.choice(ACCOUNTS),
                random.uniform(20000,70000),
                ch, d)
    add_txn(
        acc,
        random.choice(ACCOUNTS),
        ramt(150000),
        "RTGS",
        d+timedelta(minutes=15),
        True
    )

# Integration
for _ in range(150):
    acc = random.choice(ACCOUNTS)
    d = rdate(START, END)
    add_txn(acc, random.choice(ACCOUNTS),
            ramt(200000),
            "NEFT", d)
    add_txn(
        acc,
        "MERCHANT_ACCT_998",
        ramt(180000),
        "RTGS",
        d+timedelta(days=3),
        True
    )

# ================= BASELINE =================
while idx < N_TXNS:
    acc = random.choice(ACCOUNTS)
    prof = customer_profiles[acct_to_cust[acc]]
    add_txn(
        acc,
        random.choice(ACCOUNTS),
        ramt(prof["AVG_TXN"]),
        random.choice(["UPI","IMPS","NEFT"]),
        rdate(START,END),
        random.random() < 0.03
    )

# ================= ENFORCE ALERT FLOOR =================
if len(ALERTS) < MIN_ALERTS:
    need = MIN_ALERTS - len(ALERTS)
    for t in random.sample(TXNS, need):
        ALERTS.append({
            "ALERT_ID": alid(len(ALERTS)+1),
            "CASE_ID": t["CASE_ID"],
            "ACCOUNT_ID": t["ACCOUNT_ID"],
            "CUSTOMER_ID": t["CUSTOMER_ID"],
            "TRANSACTION_ID": t["TRANSACTION_ID"],
            "ALERT_SCORE": random.randint(60,85),
            "ALERT_DATE": t["TXN_DATE"]
        })
        CASE_SET.add(t["CASE_ID"])

# ================= DATAFRAMES =================
customers_df = pd.DataFrame([
    {"CUSTOMER_ID": c, **customer_profiles[c]} for c in CUSTOMERS
])

accounts_df = pd.DataFrame([
    {
        "ACCOUNT_ID": a,
        "CUSTOMER_ID": acct_to_cust[a],
        "ACCOUNT_TYPE": random.choice(["SAVINGS","CURRENT","NRE","NRO"]),
        "OPEN_DATE": rdate(datetime(2015,1,1), datetime(2022,12,31)).strftime("%Y-%m-%d"),
        "ACCOUNT_RISK": random.choice(["LOW","MEDIUM","HIGH"])
    } for a in ACCOUNTS
])

transactions_df = pd.DataFrame(TXNS)
alerts_df = pd.DataFrame(ALERTS)

cases_df = pd.DataFrame([
    {
        "CASE_ID": c,
        "CASE_DATE": rdate(START,END).strftime("%Y-%m-%d"),
        "CASE_STATUS": random.choice(["OPEN","ESCALATED","CLOSED"]),
        "CASE_RISK": random.choice(["MEDIUM","HIGH","CRITICAL"])
    } for c in CASE_SET
])

# ================= SAVE =================
customers_df.to_csv(os.path.join(OUTPUT_DIR,"customers.csv"), index=False)
accounts_df.to_csv(os.path.join(OUTPUT_DIR,"accounts.csv"), index=False)
transactions_df.to_csv(os.path.join(OUTPUT_DIR,"transactions.csv"), index=False)
alerts_df.to_csv(os.path.join(OUTPUT_DIR,"alerts.csv"), index=False)
cases_df.to_csv(os.path.join(OUTPUT_DIR,"cases.csv"), index=False)

# ================= OUTLINE =================
def outline(df, name):
    print(f"\n--- {name} ---")
    print("Rows:", len(df))
    print("Columns:", list(df.columns))
    print(df.head(3))

print("\n================ DATASET OUTLINE ================")
outline(customers_df, "CUSTOMERS")
outline(accounts_df, "ACCOUNTS")
outline(transactions_df, "TRANSACTIONS")
outline(alerts_df, "ALERTS")
outline(cases_df, "CASES")
print("=================================================")
print("Saved all CSVs to:", OUTPUT_DIR)
