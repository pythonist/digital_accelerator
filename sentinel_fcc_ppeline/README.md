## Sentinel FCC Pipeline

This folder contains a dedicated end-to-end FCC to Sentinel test harness.

What it does:
- generates synthetic FCC training data
- runs one FCC workbench training flow
- deploys the trained model
- generates a new unseen scoring batch
- scores that batch and publishes the retained queue
- imports the retained queue into a fresh Sentinel environment
- verifies core Sentinel investigation surfaces against the imported data

Files:
- `run_e2e_pipeline.py`: end-to-end test runner
- `data/`: generated FCC training and scoring CSV files
- `results/`: generated run summary JSON

Run from the project root:

```powershell
python sentinel_fcc_ppeline/run_e2e_pipeline.py
```
