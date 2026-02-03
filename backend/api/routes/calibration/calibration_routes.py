# backend/api/routes/calibration/calibration_routes.py
"""
Main Calibration Router - Delegates to sub-routers
"""
from flask import Blueprint

# Import sub-routers
from .data_routes import data_bp
from .run_routes import run_bp
from .population_routes import population_bp
from .aggregation_routes import aggregation_bp
from .percentile_routes import percentile_bp
from .threshold_routes import threshold_bp
from .approval_routes import approval_bp
from .comparison_routes import comparison_bp

# Main calibration blueprint
calibration_bp = Blueprint('calibration', __name__, url_prefix='/api/v2/calibration')

# Register sub-blueprints
calibration_bp.register_blueprint(data_bp, url_prefix='/data')
calibration_bp.register_blueprint(run_bp, url_prefix='/run')
calibration_bp.register_blueprint(population_bp, url_prefix='/population')
calibration_bp.register_blueprint(aggregation_bp, url_prefix='/aggregate')
calibration_bp.register_blueprint(percentile_bp, url_prefix='/percentile')
calibration_bp.register_blueprint(threshold_bp, url_prefix='/threshold')
calibration_bp.register_blueprint(approval_bp, url_prefix='/approval')
calibration_bp.register_blueprint(comparison_bp, url_prefix='/comparison')

@calibration_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return {
        'status': 'healthy',
        'service': 'calibration',
        'version': '2.0.0'
    }, 200