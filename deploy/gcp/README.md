# GCP Cloud Run Deployment

This path deploys the combined app container: Vite frontend is built into `backend/dist`, and Flask/Gunicorn serves both the API and frontend from Cloud Run.

Use only a new GCP project for this app. Do not deploy it into any existing Adviso project.

## Prerequisites

- Docker Desktop installed and running for local checks.
- `gcloud` logged in as the deployment owner, for example `syyash14@gmail.com`.
- Firebase CLI is optional unless you later split frontend hosting from the backend.
- Optional: `OPENAI_API_KEY` in your shell if you want fast AI explanations through the OpenAI API.

## New Project Deploy

From the repo root:

```powershell
gcloud auth login
gcloud config set account syyash14@gmail.com

.\deploy\gcp\deploy-cloud-run.ps1 `
  -ProjectId "<new-gcp-project-id>" `
  -CreateProject `
  -BillingAccount "<billing-account-id>" `
  -OpenAIApiKey $env:OPENAI_API_KEY
```

If the project already exists and billing is already linked:

```powershell
.\deploy\gcp\deploy-cloud-run.ps1 `
  -ProjectId "<new-gcp-project-id>" `
  -OpenAIApiKey $env:OPENAI_API_KEY
```

The script enables Cloud Run, Cloud Build, Artifact Registry, Secret Manager, and Cloud Storage, creates a Docker repository and state bucket if needed, stores the OpenAI key in Secret Manager when supplied, builds the repo Dockerfile, deploys Cloud Run, and prints the public service URL. It runs the service as one Cloud Run instance with one Gunicorn worker because the demo workspace uses local file-backed DuckDB databases. Cloud state is restored from the bucket on startup and synced after mutating API calls so users, environments, uploads, pipeline state, trained model artifacts, deployments, and Sentinel handoff files survive logout, restart, and redeploy.

## Cleaner URL

Cloud Run always creates a URL with a generated suffix. For a clean URL, pass a verified custom domain:

```powershell
.\deploy\gcp\deploy-cloud-run.ps1 `
  -ProjectId "<new-gcp-project-id>" `
  -OpenAIApiKey $env:OPENAI_API_KEY `
  -CustomDomain "fcc-demo.yourdomain.com"
```

Google will print the DNS records to add if the domain has not already been mapped. The service name defaults to `fcc-aml-workbench`.

## Local OpenAI Setup

Create or update `backend/.env`:

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
LLM_PROVIDER=openai
LLM_ENABLE_OLLAMA_FALLBACK=false
```

If `OPENAI_API_KEY` is missing, the app falls back to GPT4All when a local `.gguf` model is available.

## Local Verification

```powershell
cd frontend
npm run build

cd ..
docker build -t ai-aml-tool:deploy-check .
```

If Docker Desktop reports a content-store or snapshot error after all app layers have built, restart Docker Desktop and rebuild. The app build itself is valid once frontend build and backend dependency install complete.
