from __future__ import annotations

from dataclasses import dataclass


MULE_PIPELINE_TYPE = "mule"

MULE_STEP_LABELS = {
    "data": {
        "label": "Load Mule Data",
        "biz": "Load Mule Data",
        "desc": "Upload customers, accounts, transactions, and enrichment tables",
    },
    "master": {
        "label": "Analytical Dataset",
        "biz": "Build Analytical Dataset",
        "desc": "Join source tables into one account-level modeling dataset",
    },
    "target": {
        "label": "Outcome Definition",
        "biz": "Define Mule Outcome",
        "desc": "Set lookback and lookforward windows for mule outcome logic",
    },
    "eda": {
        "label": "Risk Indicators",
        "biz": "Create Mule Risk Indicators",
        "desc": "Review family-level risk indicators and readiness checks",
    },
    "preprocess": {
        "label": "Model Training",
        "biz": "Train Mule Detection Model",
        "desc": "Train and compare mule detection models",
    },
    "model": {
        "label": "Performance Review",
        "biz": "Review Model Performance",
        "desc": "Assess precision, recall, PR AUC, and capture tradeoffs",
    },
    "validation": {
        "label": "Typology Signals",
        "biz": "Review Mule Typology Signals",
        "desc": "Review typology propensities and explanation summaries",
    },
    "registry": {
        "label": "Publish to Sentinel",
        "biz": "Publish to Sentinel",
        "desc": "Send high-risk accounts to Sentinel for investigation",
    },
}


@dataclass(frozen=True)
class MuleOutcomeConfig:
    target_definition_type: str = "confirmed_mule"
    lookback_days: int = 90
    lookforward_days: int = 60
    prediction_grain: str = "account"
    source_note: str = "confirmed_or_proxy_mule"
