import numpy as np
import pandas as pd

def print_step(step_name: str):
    print("\n" + "=" * 100)
    print(step_name)
    print("=" * 100)

def ensure_col(df: pd.DataFrame, col: str, default=np.nan) -> pd.DataFrame:
    if col not in df.columns:
        df[col] = default
    return df

def assign_priority_band(score: float) -> str:
    if score >= 0.85:
        return "P1"
    elif score >= 0.65:
        return "P2"
    return "P3"

def random_date(start: str, end: str, n: int) -> pd.Series:
    start = pd.to_datetime(start)
    end = pd.to_datetime(end)
    return start + pd.to_timedelta(np.random.randint(0, (end - start).days + 1, n), unit="D")

def month_backtest_table(df_dates: pd.Series, y_true, y_pred) -> pd.DataFrame:
    from sklearn.metrics import accuracy_score, f1_score
    temp = pd.DataFrame({"event_ts": df_dates, "y_true": y_true, "y_pred": y_pred})
    temp["month"] = temp["event_ts"].dt.to_period("M").astype(str)
    rows = []
    for m, part in temp.groupby("month"):
        rows.append({
            "month": m,
            "accuracy": accuracy_score(part["y_true"], part["y_pred"]),
            "macro_f1": f1_score(part["y_true"], part["y_pred"], average="macro"),
            "weighted_f1": f1_score(part["y_true"], part["y_pred"], average="weighted"),
            "volume": len(part)
        })
    return pd.DataFrame(rows)
