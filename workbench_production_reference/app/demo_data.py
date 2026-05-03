from __future__ import annotations

from .extensions import db
from .models import FeatureCatalog

SEED_FEATURES = {
    "fcc": [
        ("alert_score", "risk", "feature_store", 0.84, 0.91, "selected", "Core scored risk signal from Feature Store."),
        ("customer_risk_band", "customer", "feature_store", 0.55, 0.73, "selected", "Governed customer-level risk band."),
        ("txn_velocity_7d", "behavior", "engineered", 0.63, 0.78, "selected", "Recent activity acceleration."),
        ("cash_intensity_ratio", "behavior", "engineered", 0.71, 0.82, "selected", "Cash-heavy transaction signal."),
        ("country_change_flag", "geography", "feature_store", 0.29, 0.44, "selected", "Useful but weaker on its own."),
        ("case_owner_id", "audit", "feature_store", 0.03, 0.07, "dropped", "Keep for audit, not for training."),
    ],
    "mule": [
        ("mule_flag", "target_proxy", "feature_store", 0.88, 0.93, "selected", "Persisted Feature Store label-safe proxy."),
        ("ring_depth_score", "graph", "feature_store", 0.77, 0.86, "selected", "Ring analysis output from the graph stage."),
        ("beneficiary_spread_14d", "behavior", "engineered", 0.64, 0.79, "selected", "Spread of outbound beneficiary activity."),
        ("account_velocity_ratio", "behavior", "engineered", 0.61, 0.75, "selected", "Acceleration in account movement."),
        ("shared_device_flag", "network", "feature_store", 0.49, 0.68, "selected", "Useful governance feature from device linkage."),
        ("account_id", "audit", "feature_store", 0.01, 0.04, "dropped", "Must persist for lineage, not for modelling."),
    ],
}


def ensure_seed_data() -> None:
    if FeatureCatalog.query.count():
        return
    for workbench_key, rows in SEED_FEATURES.items():
        for feature_name, family, source_tag, correlation_score, model_score, default_decision, notes in rows:
            db.session.add(
                FeatureCatalog(
                    workbench_key=workbench_key,
                    feature_name=feature_name,
                    family=family,
                    source_tag=source_tag,
                    correlation_score=correlation_score,
                    model_score=model_score,
                    default_decision=default_decision,
                    notes=notes,
                )
            )
    db.session.commit()
