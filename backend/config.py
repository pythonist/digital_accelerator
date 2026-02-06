"""
Shared Configuration - DB Path Management
CRITICAL: All calibration code must use paths from this file
"""
import os

# Get absolute path to backend directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))

# ============================================
# CALIBRATION DATABASE PATH (FIXED)
# ============================================
# OLD (DELETED): 'calibration_engine/data/aml.db'
# NEW: 'data/calibration/calibration.db'

CALIBRATION_DB_PATH = os.path.join(
    BACKEND_DIR,
    'data',
    'calibration',
    'calibration.db'
)

# Ensure directory exists
os.makedirs(os.path.dirname(CALIBRATION_DB_PATH), exist_ok=True)


class Config:
    RULE_WEIGHTS = {
        "rule_weights": {
            "velocity": 0.3,
            "recency": 0.2,
            "circularity": 0.3,
            "device": 0.2,
        }
    }

    RISK_THRESHOLDS = {
        "high": 0.7,
        "medium": 0.4,
        "low": 0.0,
    }

    MVP_FEATURES = [
        "tx_count_24h",
        "in_out_ratio",
        "pass_through_ratio",
        "degree_centrality",
        "clustering_coefficient",
        "accounts_per_device",
        "rule_risk_score",
    ]

