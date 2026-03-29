# FCC Workbench and Sentinel Stateful Delivery Plan

## Delivery Window

Planned sprint window: March 23, 2026 to April 3, 2026

## Objective

The goal for this sprint is not to redesign the whole platform. The goal is to make the FCC Workbench and Sentinel behave like one continuous workflow so the user can stop, return later, and continue from the last meaningful point without starting again.

For the business demo, the same work should also support a clean 15 to 20 minute walkthrough. That means we need durable state, a reliable FCC to Sentinel handoff, a small set of fast-forward checkpoints, and a short hardening pass on number consistency and refresh issues.

## What the Codebase Already Gives Us

This plan is based on the current implementation, not on a greenfield assumption.

1. FCC already has a strong resume foundation.
   The FCC workbench already persists pipeline screen state and can resume runs through the MLOps pipeline model. The main pieces are in `frontend/src/tools/mlops/screens/MLOpsWorkbench.jsx`, `frontend/src/tools/mlops/services/mlopsApi.js`, `backend/api/routes/mlops/workbench_routes.py`, and `backend/api/tools/mlops/mlops_workbench_service.py`.

2. The FCC to Sentinel bridge already exists.
   The backend bridge is in `backend/api/routes/fcc_bridge.py` and `backend/services/fcc_sentinel_bridge.py`. It can publish retained FCC rows, import them into the investigation database, and populate case level investigation tables.

3. Sentinel already persists case scope, but not a full resumable workspace.
   Sentinel stores active case scope and focus results in the investigation database through `backend/api/routes/cases.py`. The frontend restores the active investigation screen, but it does not yet persist a full investigation session with selected case, selected tab, and last stable checkpoint.

4. The current bridge flow is still too browser-driven for a demo-critical path.
   Today the frontend orchestrates simulation, publish, import, case-scope update, browser session storage, and navigation. That is fast to build, but it is fragile if one step fails halfway through.

5. Kubernetes packaging exists, but the runtime is still single-node in practice.
   Docker and Kubernetes manifests are present, but the app still relies on local DuckDB, SQLite, and generated artefacts on mounted storage. The current deployment should stay single replica for now.

## Recommended Delivery Approach

The best two week strategy is to reuse the FCC persistence that already exists, add a thin shared workflow session layer for the FCC and Sentinel journey, and move the bridge orchestration into the backend so the handoff becomes durable and retryable.

In practical terms, the sprint should focus on three implementation areas:

1. Make FCC and Sentinel stateful across the same business journey.
2. Make the FCC to Sentinel bridge robust and backend-driven.
3. Make the demo path fast, stable, and consistent.

## Implementation Areas and Effort

### 1. Stateful FCC and Sentinel journey

Estimated effort: 4 days

Implementation points:

1. Add a shared workflow session record that stores current state and last stable state.
2. Persist key identifiers such as `pipeline_id`, `run_id`, `deployment_id`, `publish_id`, `selected_case_id`, and `case_scope`.
3. Update FCC save points so the cross-module session is refreshed whenever the run reaches a meaningful checkpoint.
4. Restore Sentinel from server-side state instead of relying only on browser session storage.
5. Add fallback logic so the application opens the last stable state if the latest state is incomplete.

Expected outcome:

The user can stop at FCC or Sentinel, return later, and continue from the last valid point instead of starting from the beginning.

### 2. Robust FCC to Sentinel bridge

Estimated effort: 3 days

Implementation points:

1. Move the full handoff sequence into one backend-owned flow.
2. Perform publish, import, case-scope update, and session update in one controlled sequence.
3. Persist a single handoff summary that both FCC and Sentinel can read.
4. Add idempotent handling so repeated clicks do not create duplicate imports.
5. Add failure handling so partial handoffs do not leave the system in an unclear state.

Expected outcome:

The handoff becomes reliable, repeatable, and easier to demo because FCC and Sentinel are reading the same persisted handoff result.

### 3. Demo acceleration and stability fixes

Estimated effort: 3 days

Implementation points:

1. Add a small checkpoint model for important business stages such as model-ready, retained-queue-ready, and Sentinel-scope-ready.
2. Standardize the main counts so FCC and Sentinel display the same retained, suppressed, and imported numbers.
3. Fix refresh issues where badges, cards, or scoped case counts do not reflect the latest handoff state.
4. Validate the Docker and single replica Kubernetes path for the demo setup.
5. Run end-to-end smoke checks using one fixed demo environment and one fixed demo run.

Expected outcome:

The demo flow becomes shorter, smoother, and less risky, with stable numbers and faster navigation through the important business story.

## Total Estimated Effort

1. Stateful FCC and Sentinel journey: 4 days
2. Robust FCC to Sentinel bridge: 3 days
3. Demo acceleration and stability fixes: 3 days

Total: 10 working days

## Target State for This Sprint

### 1. Shared Workflow Session

Create a new environment-scoped workflow session model, preferably in the same backend persistence layer that already stores FCC pipeline state.

Minimum fields:

1. `session_id`
2. `tenant_id`
3. `env_id`
4. `pipeline_id`
5. `pipeline_name`
6. `run_id`
7. `deployment_id`
8. `publish_id`
9. `current_module`
10. `current_step`
11. `current_state_json`
12. `last_stable_step`
13. `last_stable_state_json`
14. `case_scope_json`
15. `selected_case_id`
16. `handoff_summary_json`
17. `status`
18. `created_at`
19. `updated_at`

Why this matters:

1. `current_state_json` lets the user reopen the exact working context.
2. `last_stable_state_json` gives us a safe fallback if the latest state was saved in the middle of an incomplete action.
3. `handoff_summary_json` gives FCC and Sentinel one source of truth for counts and summary cards.

### 2. Backend Owned Handoff Orchestration

Replace the fragile browser side handoff sequence with one backend orchestration endpoint or service method that performs the following in order:

1. Score or pick the latest retained FCC batch.
2. Publish retained rows.
3. Import them into Sentinel.
4. Update case scope.
5. Create or update the shared workflow session.
6. Return a single durable response with `session_id`, `publish_id`, imported case counts, and recommended Sentinel landing screen.

This endpoint should be idempotent for a given `run_id` and `publish_id` combination so repeated clicks do not create duplicate imports.

### 3. Sentinel Resume Behavior

Sentinel should load from the shared workflow session, not only from browser storage.

The first sprint version only needs to restore:

1. active investigation screen
2. active case scope
3. selected case ID
4. handoff summary banner
5. last stable checkpoint for the demo

This is enough for business continuity without trying to persist every temporary copilot message or every open panel state.

### 4. Demo Checkpoints

Do not build a generic time machine in this sprint. Build a small checkpoint model aligned to the business story.

Recommended checkpoints:

1. `FCC_DATA_READY`
2. `FCC_MODEL_READY`
3. `FCC_RETAINED_QUEUE_READY`
4. `SENTINEL_SCOPE_READY`
5. `SENTINEL_CASE_OPEN`

Each checkpoint should save the right screen, the right summary counts, and the right underlying IDs so the presenter can jump ahead without breaking the story.

### 5. Metrics Contract

Counts shown in FCC and Sentinel should come from the same persisted handoff summary instead of being recomputed differently in multiple screens.

The summary contract should at least include:

1. requested_row_count
2. total_scored
3. suppressed_count
4. escalated_count
5. imported_case_count
6. imported_alert_count
7. threshold
8. pipeline_name
9. run_id
10. publish_id

## Sprint Scope

### In Scope

1. Shared workflow session table and API
2. Backend owned FCC to Sentinel orchestration
3. Resume from current state and last stable state
4. Sentinel landing with restored scoped queue
5. Demo checkpoints
6. Number consistency fixes on the FCC and Sentinel path
7. Docker and single replica Kubernetes smoke validation

### Explicitly Out of Scope for This Sprint

1. Full cloud-native multi replica deployment
2. Moving DuckDB and SQLite to managed shared services
3. Full collaborative multi user session editing
4. Deep redesign of the investigation UI
5. Persisting every copilot conversation and every local widget preference

## Suggested Sequence Across Two Weeks

### Days 1 to 4

Focus on the stateful FCC and Sentinel journey.

1. Finalize the workflow session contract.
2. Add the persistence model and APIs.
3. Wire FCC save points into the shared session.
4. Restore Sentinel state from the shared session.

### Days 5 to 7

Focus on the FCC to Sentinel bridge.

1. Move the handoff sequence to the backend.
2. Persist the handoff summary and session state together.
3. Add duplicate protection and fallback handling.

### Days 8 to 10

Focus on demo acceleration and hardening.

1. Add demo checkpoints.
2. Fix count mismatches and refresh issues.
3. Run smoke validation in Docker and single replica Kubernetes.
4. Freeze the demo environment and test the full walkthrough.

## Acceptance Criteria

The sprint should be considered complete only if all of the following are true:

1. A user can reopen FCC and return to the last meaningful step of the same run.
2. A user can push retained FCC rows to Sentinel through one reliable action.
3. Sentinel restores the scoped queue and preferred landing screen from server-side session state.
4. Sentinel can reopen the last selected case when it still exists in scope.
5. If the latest state is incomplete, the system falls back to the last stable checkpoint.
6. FCC and Sentinel show the same handoff counts after refresh.
7. The end-to-end demo fits into 15 to 20 minutes without manual data repair.
8. The packaged app runs successfully in Docker and in a single replica Kubernetes deployment.

## Business Demo Walkthrough

The demo should use the application as a real product, but it should rely on saved checkpoints so the story stays within time.

Recommended flow:

1. Start in FCC with a saved run at `FCC_MODEL_READY`.
2. Show the model summary and the dashboard with retained queue previews.
3. Jump to `FCC_RETAINED_QUEUE_READY` if needed.
4. Trigger the backend owned handoff.
5. Land directly in Sentinel with the scoped queue already set.
6. Open one case pack.
7. Open one case in Copilot.
8. Show graph or linked evidence view.
9. Download the FCC report and the Sentinel handoff report.

## Risks and Mitigations

### Risk 1: Handoff duplicates or partial imports

Mitigation:

Use one backend orchestration call with idempotency and a session status transition model.

### Risk 2: Existing data in the Sentinel environment pollutes the demo

Mitigation:

Use a dedicated demo environment and always drive Sentinel from the scoped case set created by the handoff session.

### Risk 3: Number mismatches damage trust in the demo

Mitigation:

Use one persisted handoff summary contract and feed all high-level counts from that contract.

### Risk 4: Scope expands into cloud scale work during the same sprint

Mitigation:

Keep the runtime single replica. Treat full cloud scale as a follow-up architecture stream.

## What We Should Not Promise in This Demo Sprint

We should be clear internally that this sprint makes the application much more stateful and demo-ready, but it does not complete the cloud modernization journey.

Post-demo backlog items:

1. Move runtime state from local disk to PostgreSQL and object storage.
2. Move long-running scoring, training, and report generation into background workers.
3. Add multi-replica safe locking and concurrency control.
4. Add structured observability and operational dashboards.

## Recommendation

This is achievable in two weeks if the scope stays focused on the FCC to Sentinel path. The key decision is to avoid a broad platform redesign and instead harden the specific business journey that matters for the demo:

1. persist the journey on the server
2. move the handoff into the backend
3. restore Sentinel from durable session state
4. add a small set of fast-forward checkpoints
5. clean up the numbers and refresh behavior

That gives the business a flow that looks continuous, reliable, and product-grade, while keeping the implementation realistic for the sprint window.
