# Workbench Production Reference

This is a production-oriented reference app for FCC and Mule workbenches built with:

- Flask API and server-rendered pages
- PostgreSQL for durable state
- Redis for cache and session storage
- Celery for background jobs
- HTMX + Alpine.js for partial-page updates
- Gunicorn in containers and Waitress on Windows

It exists to solve the exact UX problem you described: the application should not feel like it restarts or loses its place on every interaction.

## Why the current dev app feels janky

Your existing product uses a Vite + React development shell. In development that commonly causes:

- component mount and unmount churn
- repeated `useEffect` fetches
- StrictMode double-invocation in React 18
- hot-module replacement refreshes
- autosave and polling making the screen look like it is rebuilding

That is normal for a dev SPA, but it is not how a production SaaS experience should feel.

This reference app shows the production shape:

- no Flask debug reloader
- no React runtime
- no in-memory-only screen state
- no full-page reload for tab changes
- long tasks moved to Celery
- task progress polled from a durable task record

## Folder Structure

```text
workbench_production_reference/
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── extensions.py
│   ├── logging_config.py
│   ├── models.py
│   ├── seed_demo.py
│   ├── routes/
│   │   ├── api.py
│   │   └── pages.py
│   ├── services/
│   │   ├── task_service.py
│   │   └── workbench_service.py
│   ├── static/
│   │   ├── css/app.css
│   │   └── js/app.js
│   └── templates/
│       ├── base.html
│       ├── workbench.html
│       └── fragments/
│           ├── task_panel.html
│           └── workbench_content.html
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── gunicorn.conf.py
└── requirements.txt
```

## Setup

### 1. Copy environment file

```powershell
Copy-Item .env.example .env
```

### 2. Start with Docker

```powershell
docker compose up --build
```

Open:

- `http://localhost:8088/workbench/fcc`
- `http://localhost:8088/workbench/mule`

### 3. Local Windows run with Waitress

Start PostgreSQL and Redis first, then:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
Copy-Item .env.example .env
python -m app.seed_demo
waitress-serve --listen=0.0.0.0:8080 app:app
```

Start Celery worker in another shell:

```powershell
celery -A app.celery worker --loglevel=INFO
```

## Example Endpoints

- `GET /workbench/fcc`
- `GET /workbench/mule`
- `POST /workbench/<workbench_key>/tab`
- `POST /workbench/<workbench_key>/transform`
- `POST /workbench/<workbench_key>/feature-decision`
- `POST /workbench/<workbench_key>/start-task`
- `GET /fragments/task/<task_id>`
- `GET /task-status/<task_id>`
- `GET /health`

## What persists

- selected tab: Redis session + PostgreSQL `workbench_state`
- feature decisions: PostgreSQL `workbench_state.feature_decisions`
- transform preferences: PostgreSQL `workbench_state.transform_config`
- task audit and progress: PostgreSQL `task_record`
- cached feature catalog: Redis

## Why this feels better in cloud

If the browser reconnects to another app instance:

- Redis restores the session
- PostgreSQL restores the workbench state
- Celery workers keep running the background job
- HTMX only refreshes the fragment that needs to change

That means the UI does not bounce back to a blank shell or restart the entire page just to change one tab or poll one task.
