CONFIG = {
    "random_state": 42,
    "records_per_category_min": 5000,
    "records_per_category_max": 7000,
    "channels": ["UPI", "ATM", "BRANCH", "MERCHANT", "API", "DIGITAL"],
    "mule_categories": [
        "legit", "first_time_mule", "sleeper_mule", "layering_mule", "pass_through_mule",
        "fanout_mule", "cashout_mule", "merchant_mule", "synthetic_mule"
    ],
    "risky_labels": [
        "first_time_mule", "sleeper_mule", "layering_mule", "pass_through_mule",
        "fanout_mule", "cashout_mule", "merchant_mule", "synthetic_mule", "fraud_alert", "sar"
    ],
    "train_end": "2024-03-31",
    "valid_end": "2024-08-31",
    "session_gap_minutes": 180,
    "sequence_max_len": 25,
    "alert_daily_capacity": 500,
    "review_daily_capacity": 1000
}
