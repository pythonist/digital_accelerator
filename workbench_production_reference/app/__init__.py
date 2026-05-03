from __future__ import annotations

from dotenv import load_dotenv
from flask import Flask, request
from redis import Redis
from celery import Celery

from .config import Config
from .extensions import cache, db, server_session
from .logging_config import configure_logging

load_dotenv()

celery = Celery(__name__)


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)

    configure_logging(app.config["LOG_LEVEL"])

    app.config["SESSION_REDIS"] = Redis.from_url(app.config["SESSION_REDIS_URL"])
    app.config["CACHE_REDIS_URL"] = app.config["CACHE_REDIS_URL"]

    db.init_app(app)
    cache.init_app(app)
    server_session.init_app(app)

    celery.conf.update(
        broker_url=app.config["CELERY_BROKER_URL"],
        result_backend=app.config["CELERY_RESULT_BACKEND"],
        task_ignore_result=False,
    )

    class FlaskContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = FlaskContextTask

    from .routes.api import register_error_handlers, register_routes
    from .routes.pages import pages_bp

    app.register_blueprint(pages_bp)
    register_routes(app)
    register_error_handlers(app)

    @app.before_request
    def log_request():
        app.logger.info("%s %s", request.method, request.path)

    with app.app_context():
        db.create_all()
        from .demo_data import ensure_seed_data

        ensure_seed_data()

    from .services import task_service  # noqa: F401

    return app


app = create_app()
