# AI_AML_tool

AML multi-workbench application with Flask backend and Vite + React frontend.

## Quick Start (Fresh Clone)

### 1. Prerequisites
- Python 3.10+
- Node.js 18+
- npm 9+

### 2. Backend
```bash
cd backend
cp .env.example .env   # use Copy-Item on PowerShell
python -m venv .venv
# Windows:
.\.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Backend runs on `http://localhost:5000` by default.

For MLOps-only backend startup (faster boot, fewer imported modules), set:
```bash
# Windows PowerShell
$env:AML_BACKEND_PROFILE='mlops'
# macOS/Linux
# export AML_BACKEND_PROFILE=mlops
```

### 3. Frontend
```bash
cd frontend
cp .env.example .env   # optional
npm ci
npm run dev
```

Frontend runs on `http://localhost:5173`.

## One-Line Dev Startup (Windows)
From the repo root:
```powershell
.\start-dev.ps1
```

or:
```powershell
.\start-dev.bat
```

This starts backend (`python app.py` with `backend/.venv`) and frontend (`npm run dev`) in separate PowerShell windows.

## Docker Run
Build and run anywhere with Docker:

```bash
docker compose up --build
```

App will be available at:
- `http://localhost:5000` (backend API + served frontend build)

Notes:
- Container runs the full FCC workbench profile by default.
- Override `AML_BACKEND_PROFILE=mlops` if you want the lighter MLOps-only backend.
- Production containers now start with Gunicorn multi-worker threading defaults:
  - `WEB_CONCURRENCY=4`
  - `GUNICORN_THREADS=8`
- Persistent environment data is mounted via:
  - `./backend/data -> /app/backend/data`
  - `./data -> /app/data`
- Health endpoints:
  - `GET /health` for liveness
  - `GET /ready` for readiness

## Performance Optimizations Applied
- Route-level lazy loading for all major screens/platforms.
- Suspense loading boundaries for faster first paint.
- Removed duplicate `AppProvider` mount (single context tree).
- Vite chunk splitting (`vendor-react`, `vendor-mui`, `vendor-charts`, `vendor-utils`) for improved cache reuse.

## Portability Notes
- `.env`, virtual environments, node_modules, temp datasets, and runtime DB files are git-ignored.
- Use `.env.example` files as templates on each machine.
- Backend supports cross-platform virtualenv bootstrap path resolution.
- Kubernetes deployment templates are available under `deploy/k8s`.
- Architecture and scaling guidance is documented in `docs/fcc_workbench_system_design_review.md`.

## Useful Commands
```bash
# Frontend
cd frontend
npm run dev
npm run build

# Backend
cd backend
python app.py
```

url - https://fcc-aml-workbench-ih5rjb44sq-uc.a.run.app

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
