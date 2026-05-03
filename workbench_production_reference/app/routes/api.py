from __future__ import annotations

import logging

from flask import jsonify, request
from werkzeug.exceptions import HTTPException

from ..models import TaskRecord

logger = logging.getLogger(__name__)


def register_routes(app):
    @app.get("/health")
    def health():
        return jsonify({"status": "ok"}), 200

    @app.get("/task-status/<task_id>")
    def task_status(task_id: str):
        task = TaskRecord.query.filter_by(task_id=task_id).first_or_404()
        return (
            jsonify(
                {
                    "task_id": task.task_id,
                    "status": task.status,
                    "progress": task.progress,
                    "message": task.message,
                    "result": task.result_payload,
                }
            ),
            200,
        )


def register_error_handlers(app):
    @app.errorhandler(HTTPException)
    def handle_http_exception(error):
        logger.warning("HTTP error %s %s", error.code, error.description)
        if request.path.startswith("/task-status") or request.path.startswith("/health"):
            return jsonify({"error": error.description}), error.code
        return error

    @app.errorhandler(Exception)
    def handle_unexpected_exception(error):
        logger.exception("Unhandled application error")
        if request.path.startswith("/task-status") or request.path.startswith("/health"):
            return jsonify({"error": "Internal Server Error"}), 500
        return jsonify({"error": "Internal Server Error"}), 500
