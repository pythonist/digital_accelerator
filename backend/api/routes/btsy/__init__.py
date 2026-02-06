# backend/api/routes/btsy/__init__.py
"""
BTSY Routes - Main blueprint combining all BTSY endpoints
"""
from flask import Blueprint
from .upload_routes import upload_bp
from .profiling_routes import profiling_bp
from .snapshot_routes import snapshot_bp
from .mapping_routes import mapping_bp
from .normalization_routes import normalization_bp  # ADD THIS
from .transaction_universe_routes import universe_bp
from .behavior_routes import behavior_bp
from .calibration_workbench_routes import calibration_workbench_bp
from .signal_analysis_routes import signal_bp
from .threshold_simulation_routes import threshold_bp
from .risk_population_routes import risk_bp
from .ks_validation_routes import ks_validation_bp
from .step36_routes import step36_bp
from .ml_validation_routes import ml_validation_bp
from .orchestrated_calibration_routes import ocr_bp
from .alerting_routes import alerting_bp
from .str_alignment_routes import str_validation_bp
from .operations_intelligence_routes import ops_bp
from .autorun_routes import autorun_bp
from .calibration_runs_routes import calibration_runs_bp
from .scenario_routes import scenario_bp
from .extension_routes import extension_bp
from .datatype_routes import datatype_bp
from .cortex_scenario_routes import cortex_scenario_bp
# Create main BTSY blueprint
btsy_bp = Blueprint('btsy', __name__)

# Register sub-blueprints WITHOUT url_prefix
# The routes already have their paths in the decorators
btsy_bp.register_blueprint(upload_bp)
btsy_bp.register_blueprint(profiling_bp)
btsy_bp.register_blueprint(snapshot_bp)
btsy_bp.register_blueprint(mapping_bp)
btsy_bp.register_blueprint(normalization_bp)
btsy_bp.register_blueprint(universe_bp)
btsy_bp.register_blueprint(behavior_bp)
btsy_bp.register_blueprint(calibration_workbench_bp)
btsy_bp.register_blueprint(signal_bp)
btsy_bp.register_blueprint(threshold_bp)
btsy_bp.register_blueprint(risk_bp)
btsy_bp.register_blueprint(ks_validation_bp)
btsy_bp.register_blueprint(step36_bp)
btsy_bp.register_blueprint(ml_validation_bp)
btsy_bp.register_blueprint(ocr_bp)
btsy_bp.register_blueprint(alerting_bp)
btsy_bp.register_blueprint(str_validation_bp)
btsy_bp.register_blueprint(ops_bp)
btsy_bp.register_blueprint(autorun_bp)
btsy_bp.register_blueprint(calibration_runs_bp)
btsy_bp.register_blueprint(scenario_bp)
btsy_bp.register_blueprint(extension_bp)
btsy_bp.register_blueprint(datatype_bp)
btsy_bp.register_blueprint(cortex_scenario_bp)
