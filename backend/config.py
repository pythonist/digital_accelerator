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

