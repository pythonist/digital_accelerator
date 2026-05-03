from __future__ import annotations

import os
from datetime import timedelta


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://workbench:workbench@localhost:5434/workbench",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6385/0")
    SESSION_REDIS_URL = os.getenv("SESSION_REDIS_URL", "redis://localhost:6385/1")
    CACHE_REDIS_URL = os.getenv("CACHE_REDIS_URL", "redis://localhost:6385/2")
    CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6385/3")
    CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://localhost:6385/4")

    SESSION_TYPE = "redis"
    SESSION_KEY_PREFIX = "workbench:session:"
    SESSION_USE_SIGNER = True
    SESSION_PERMANENT = True
    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

    CACHE_TYPE = "RedisCache"
    CACHE_DEFAULT_TIMEOUT = 60

    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
