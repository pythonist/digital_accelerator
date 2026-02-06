import os
from pathlib import Path
import numpy as np
import pandas as pd

def main():
    snap = "SNAP_DEMO_202510"
    base = Path("data") / "tenants" / "default" / "envs" / "default" / "btsy"
    norm_dir = base / "normalized" / snap
    norm_dir.mkdir(parents=True, exist_ok=True)
    dates = pd.date_range("2025-10-01", "2025-10-31", freq="D")
    rows = []
    for acc in ["ACC_000001", "ACC_000002"]:
        cust = "CUST_" + acc[-6:]
        for dt in dates:
            rows.append({
                "account_id": acc,
                "customer_id": cust,
                "transaction_datetime": dt.isoformat(),
                "transaction_amount": float(np.random.randint(100, 10000)),
                "transaction_category": np.random.choice(["RTGS", "NEFT", "CASH"]),
                "transaction_type": "DEBIT"
            })
    df = pd.DataFrame(rows)
    out = norm_dir / "transactions.parquet"
    df.to_parquet(out, index=False)
    print(str(out))

if __name__ == "__main__":
    main()
