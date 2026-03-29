# FCC Workbench System Design Review

## Executive Summary

The FCC workbench is now materially better in two areas:

- Frontend shell and workbench navigation are stateful, so users can return to the last module and screen they were working on.
- The packaged runtime now uses a production-grade multi-worker Gunicorn server with readiness probes and Kubernetes deployment templates.

The biggest remaining architecture constraint is data locality. The system still stores important state in local files (`DuckDB`, SQLite, generated artefacts under mounted volumes). That is acceptable for single-node on-prem or single-replica Kubernetes deployments, but it is not yet safe for active-active horizontal scale across multiple pods or VMs.

## Current-State Review

### Strengths

- Single codebase serving React frontend and Flask backend keeps deployment simple.
- Environment-scoped workflows already exist across Investigation, Calibration, Mule, BTSY, and MLOps.
- Docker packaging is available and now production-bootable.
- Health endpoints exist for orchestration and operational checks.

### Gaps

1. Stateful navigation was inconsistent across workbenches.
   Status: Fixed in this change for shell routing plus Investigation, Calibration, Mule, and BTSY screen state.

2. Production serving used the Flask development server.
   Status: Fixed in this change by switching container runtime to Gunicorn with multi-worker threading.

3. Horizontal scale is limited by local persistent state.
   Impact: More than one replica can create file-locking, divergence, or stale-read issues depending on workload.
   Recommendation: Move environment metadata, runs, and audit data to PostgreSQL; move large artefacts to object storage; isolate long jobs behind a queue.

4. Background and analytical work is still mostly in-process.
   Impact: Heavy requests compete with HTTP handling, which reduces tail-latency and complicates autoscaling.
   Recommendation: Introduce worker processes for training, batch scoring, PDF/report generation, and long-running analytics.

5. Client persistence is browser-local.
   Impact: Good for user continuity, but not sufficient for collaborative multi-user state recovery.
   Recommendation: Persist critical user workspace state server-side when collaboration or cross-device continuity matters.

## Recommended Target Architecture

### Phase 1: Production-Safe Single Node

Best fit for:

- On-prem pilot
- Internal UAT
- Controlled bank-side sandbox

Shape:

- 1 container or VM
- Gunicorn multi-worker backend
- Mounted persistent storage
- Reverse proxy or ingress in front

This is the safest deployment shape today.

### Phase 2: Portable Kubernetes Baseline

Best fit for:

- AKS
- EKS
- On-prem Kubernetes clusters

Shape:

- 1 replica deployment
- PVC-backed persistent storage
- Readiness and liveness probes
- External ingress

This is now supported by the manifests under `deploy/k8s`.

### Phase 3: True Cloud Scale-Out

Required before enabling multi-replica autoscaling:

- Replace local `DuckDB`/SQLite runtime state with PostgreSQL or another managed relational store.
- Move model artefacts, uploaded files, and generated reports to blob/object storage.
- Add a job queue for heavy async work.
- Make environment/session locking explicit so multiple replicas cannot mutate the same run unsafely.
- Introduce centralized observability: logs, metrics, traces, audit export.

Once that is done, the service can scale through:

- AWS: `EKS + RDS + S3 + SQS`
- Azure: `AKS + Azure Database for PostgreSQL + Blob Storage + Service Bus`
- On-prem: `Kubernetes/OpenShift + PostgreSQL + S3-compatible object store + message broker`

## Multi-Core and Multi-Threading Notes

The current packaged runtime uses Gunicorn with:

- multiple worker processes to use more than one CPU core
- threaded workers to tolerate I/O-heavy API concurrency
- health/readiness probes for orchestrated rollout

Default container values:

- `WEB_CONCURRENCY=4`
- `GUNICORN_THREADS=8`

Tune these based on CPU, RAM, and workload mix.

## Deployment Recommendation Matrix

### AWS

- Start with ECS or EKS for packaging portability.
- Prefer EKS only if you already need Kubernetes.
- For full scale-out, externalize state before increasing replica count.

### Azure

- AKS is the cleanest fit if the bank already uses Azure landing zones.
- Use Managed Identity and Key Vault once secrets move out of local env files.

### On-Prem

- Short term: Docker Compose on a hardened Linux VM.
- Medium term: OpenShift or Kubernetes with the provided manifests as a base.
- Keep shared storage reliable and backed up.

## Priority Next Steps

1. Externalize runtime state from local files to managed/shared stores.
2. Move long-running analytical jobs off the request thread.
3. Add structured logging, metrics, and request correlation IDs.
4. Add server-side persistence for user workspace drafts if cross-device continuity is needed.
5. Introduce security hardening for secrets, RBAC, and audit export before production rollout.
