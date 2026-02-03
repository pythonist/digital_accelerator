# backend/api/routes/calibration/__init__.py
"""
Calibration API Blueprint - Main Router
✅ UPDATED: Includes Step 0 Data Foundation routes
"""
from flask import Blueprint

# Create main calibration blueprint
calibration_bp = Blueprint('calibration', __name__)

# ✅ NEW: Import Step 0 Data Foundation routes
from .calibration_data_routes import calibration_data_bp

# Import existing sub-routes
# from .data_routes import data_bp
from .run_routes import run_bp
from .population_routes import population_bp
from .aggregation_routes import aggregation_bp
from .percentile_routes import percentile_bp
from .threshold_routes import threshold_bp
from .approval_routes import approval_bp
from .validation_routes import validation_bp
from .report_routes import report_bp
from .scenario_routes import scenario_bp
from .ks_routes import ks_bp
from .atl_btl_routes import atl_btl_bp

# ✅ NEW: Register Step 0 routes FIRST
calibration_bp.register_blueprint(calibration_data_bp, url_prefix='/data')  # Mounts at /api/v2/calibration/data/*

# Register existing sub-blueprints
# calibration_bp.register_blueprint(data_bp, url_prclefix='/data')
calibration_bp.register_blueprint(run_bp, url_prefix='/run')
calibration_bp.register_blueprint(scenario_bp, url_prefix='/scenario')
calibration_bp.register_blueprint(population_bp, url_prefix='/population')
calibration_bp.register_blueprint(aggregation_bp, url_prefix='/aggregate')
calibration_bp.register_blueprint(validation_bp, url_prefix='/validation')
calibration_bp.register_blueprint(percentile_bp, url_prefix='/percentile')
calibration_bp.register_blueprint(threshold_bp, url_prefix='/threshold')
calibration_bp.register_blueprint(ks_bp, url_prefix='/ks')
calibration_bp.register_blueprint(atl_btl_bp, url_prefix='/atl-btl')
calibration_bp.register_blueprint(approval_bp, url_prefix='/approval')
calibration_bp.register_blueprint(report_bp, url_prefix='/report')

@calibration_bp.route('/health', methods=['GET'])
def health_check():
    return {'status': 'healthy', 'service': 'calibration', 'version': '3.0.0'}, 200

# DEBUG: Print registered routes
print("✅ Calibration Routes Loaded:")
print("   - /data/* (Step 0: Data Foundation) ✨ NEW")
print("   - /data/* (Existing)")
print("   - /run/*")
print("   - /scenario/*")
print("   - /population/*")
print("   - /aggregate/*")
print("   - /validation/*")
print("   - /percentile/*")
print("   - /threshold/*")
print("   - /approval/*")
print("   - /report/*")
print("   - /ks/*")
print("   - /atl-btl/*")

__all__ = ['calibration_bp']