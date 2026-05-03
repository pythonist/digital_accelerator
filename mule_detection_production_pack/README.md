# Mule Detection Production Package

## Contents
- config.py
- utils.py
- data_ingestion.py
- entity_resolution.py
- feature_engineering.py
- graph_analytics.py
- sequence_models.py
- multiclass_model.py
- alert_engine.py
- feedback_loop.py
- main_pipeline.py

## What it does
This package implements an end-to-end mule detection pipeline with:
- raw-style synthetic generation aligned to Finacle-style tables
- UPI / ATM / BRANCH / MERCHANT / API / DIGITAL channels
- single view creation
- feature engineering
- graph analytics
- ring detection
- hazard model
- HMM
- LSTM
- transformer-ready attention masks
- multiclass typology model
- calibration
- decision engine
- alert output
- threshold optimization
- weak supervision and feedback loop

## Install
Recommended:
```bash
pip install pandas numpy scikit-learn matplotlib seaborn networkx hmmlearn tensorflow shap
```

## Run
```bash
python main_pipeline.py
```

## Notes
- This package is import-safe and production-style.
- Synthetic generation follows the raw field inventory provided by the user.
- Replace synthetic generators with actual Finacle data loaders for production deployment.
