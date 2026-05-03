import traceback

from flask import Blueprint

from .target_routes import target_bp
from .workbench_routes import mlops_workbench_bp
from .eda_routes import eda_bp
from .report_routes import report_bp
from .run_state_routes import run_state_bp

mlops_bp = Blueprint("mlops", __name__)
mlops_bp.register_blueprint(mlops_workbench_bp)
mlops_bp.register_blueprint(target_bp)
mlops_bp.register_blueprint(eda_bp)
mlops_bp.register_blueprint(report_bp)
mlops_bp.register_blueprint(run_state_bp)

try:
    from .model_training_routes import model_training_bp

    mlops_bp.register_blueprint(model_training_bp)
except Exception as exc:  # pragma: no cover - defensive startup fallback
    print("MLOps package model training import failed:", repr(exc))
    traceback.print_exc()

try:
    from .deployment_dashboard_routes import deployment_dashboard_bp

    mlops_bp.register_blueprint(deployment_dashboard_bp)
except Exception as exc:  # pragma: no cover - defensive startup fallback
    print("MLOps package deployment dashboard import failed:", repr(exc))
    traceback.print_exc()
