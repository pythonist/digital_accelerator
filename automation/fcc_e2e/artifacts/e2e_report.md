# FCC to Sentinel E2E Automation Report

Date: 2026-04-01
App: `http://localhost:5173`
API: `http://localhost:5000`

## Run Summary

- FCC env: `automaed_pipeline_testing_bot_fcc_80401a85`
- Sentinel env: `automaed_pipeline_testing_bot_sentinel_80401a85`
- Pipeline name: `automaed_piepline testing bot`
- FCC pipeline id: `1`
- FCC run id: `759c85ae-9843-4c79-a21c-b6ec85d7b121`
- Deployment id: `375da9cf-6531-4b49-821e-88a69e6509d1`
- Publish id: `PUB-c74455232143`
- Sample Sentinel case: `CASE0000142`

## FCC Execution Result

- Uploaded/registered datasets: `accounts`, `alerts`, `cases`, `customers`, `str`, `transactions`, `master_dataset`, `preprocessed_dataset`
- Master dataset rows: `5,386`
- Preprocessed dataset rows: `5,386`
- Workflow manifest status: `completed`
- Resume ready: `true`
- Inconsistencies: `0`

Completed FCC steps:

1. Load Data
2. Master Dataset
3. Target Definition
4. Pattern Analysis
5. Feature Preparation
6. Model Development
7. Validation
8. Registry
9. Deployment Readiness
10. Monitoring
11. Reports

## Scoring / Bridge Result

- Scored rows: `250`
- Suppressed rows: `2`
- Escalated rows: `248`
- Suppression rate: `0.8%`
- Published rows to Sentinel: `248`
- Published case count: `248`

Sentinel imported table counts:

- Cases: `248`
- Alerts: `1,220`
- Transactions: `4,040`
- Accounts: `1,271`
- Customers: `1,271`

## Sentinel Verification Result

Passed:

- Priority rerank
- Priority inbox
- DB stats
- Case pack generation
- Full graph build
- Case facts build
- Back to Tools navigation

UI screens exercised:

1. FCC Bridge
2. Priority Inbox
3. Case Queue
4. Copilot Investigation
5. Case Resolution

## Navigation Verification

Passed:

- `/tools` -> `/mlops/runs`
- Browser back from `/mlops/runs` -> Module Selection
- FCC run route navigation across all step URLs
- Browser back: `/mlops/runs/1/model` -> `/mlops/runs/1/preprocess`
- Browser forward: `/mlops/runs/1/preprocess` -> `/mlops/runs/1/model`
- Sentinel header back button -> `/tools` Module Selection

Observed:

- Model Validation did not expose the expected in-app `Back to Model Training` button during the automated run, so that specific control was not validated.

## Remaining Defects Found

1. Case similarity is still broken in Sentinel.
   - `POST /api/v2/case-retrieval/similar` returned `500`
   - `GET /api/v2/case-retrieval/similar` returned `500`

2. The app previously had a route-blocking render loop in `WorkflowGraphDialog`.
   - This was fixed during the test run because it was preventing Sentinel -> Tools navigation from actually rendering Module Selection.

3. The browser still generated repeated FCC workflow/session traffic during UI traversal.
   - Counts captured in UI run:
   - `GET /api/v2/fcc-workflow/session`: `9`
   - `POST /api/mlops/pipeline/:id/screen-state`: `14`
   - This is much lower than the earlier runaway loop, but still worth watching.

## Evidence

Screenshots:

- `screenshots/01_tools_module_selection.png`
- `screenshots/03_back_to_tools.png`
- `screenshots/04_fcc_pipeline_hub.png`
- `screenshots/fcc_data.png`
- `screenshots/fcc_master.png`
- `screenshots/fcc_target.png`
- `screenshots/fcc_eda.png`
- `screenshots/fcc_preprocess.png`
- `screenshots/fcc_model.png`
- `screenshots/fcc_validation.png`
- `screenshots/fcc_registry.png`
- `screenshots/fcc_dashboard.png`
- `screenshots/fcc_reports.png`
- `screenshots/05_sentinel_fcc_bridge.png`
- `screenshots/06_sentinel_priority_inbox.png`
- `screenshots/07_sentinel_case_queue.png`
- `screenshots/08_sentinel_copilot_investigation.png`
- `screenshots/09_sentinel_case_resolution.png`
- `screenshots/10_final_tools.png`

Video:

- `videos/` contains the Playwright capture for the latest UI run

Machine-readable outputs:

- `backend_summary.json`
- `ui_summary.json`

## Notes

- The FCC data upload and step completion were executed programmatically through backend services and persisted into a fresh FCC run, then verified through the browser.
- The browser automation validated route behavior, screen rendering, and Sentinel navigation against the live app.
