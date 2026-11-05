import multiprocessing
import os


def _int_env(name, default):
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


cpu_count = max(1, multiprocessing.cpu_count())

bind = f"0.0.0.0:{os.getenv('APP_PORT', os.getenv('PORT', '5000'))}"
workers = _int_env("WEB_CONCURRENCY", 1)
worker_class = os.getenv("GUNICORN_WORKER_CLASS", "gthread")
threads = _int_env("GUNICORN_THREADS", 8)
timeout = _int_env("GUNICORN_TIMEOUT", 600)
graceful_timeout = _int_env("GUNICORN_GRACEFUL_TIMEOUT", 60)
keepalive = _int_env("GUNICORN_KEEPALIVE", 30)
max_requests = _int_env("GUNICORN_MAX_REQUESTS", 1000)
max_requests_jitter = _int_env("GUNICORN_MAX_REQUESTS_JITTER", 100)
accesslog = "-"
errorlog = "-"
capture_output = True
preload_app = False
