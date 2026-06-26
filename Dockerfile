# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build


FROM python:3.11-slim AS app-runtime
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV AML_AUTO_BOOTSTRAP_VENV=0
ENV AML_BACKEND_PROFILE=full
ENV PORT=5000
ENV APP_PORT=5000
ENV WEB_CONCURRENCY=1
ENV GUNICORN_THREADS=16
ENV GUNICORN_TIMEOUT=600
ENV GUNICORN_GRACEFUL_TIMEOUT=60
ENV GUNICORN_KEEPALIVE=30

WORKDIR /app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /app/data /app/backend/data \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade "pip<25" "setuptools<70" wheel && \
    pip install --no-cache-dir --no-build-isolation -r requirements.txt

COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./dist

RUN chown -R appuser:appuser /app

EXPOSE 5000
USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 CMD curl -fsS "http://127.0.0.1:${APP_PORT:-5000}/ready" || exit 1

CMD ["gunicorn", "-c", "gunicorn.conf.py", "wsgi:app"]
