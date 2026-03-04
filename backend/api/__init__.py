import os
from flask import Flask, send_from_directory
from flask_cors import CORS

def create_app():
    app = Flask(__name__)
    
    app.config.update(
        SECRET_KEY=os.environ.get('SECRET_KEY', 'dev_secret'),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE='Lax',
        MAX_CONTENT_LENGTH=50 * 1024 * 1024
    )
    
    CORS(app, supports_credentials=True)

    # Initialize Services
    from api.service_locator import services
    services.init_services()

    # --- REGISTER BLUEPRINTS ---
    from api.routes.auth import auth_bp
    from api.routes.data import data_bp
    from api.routes.cases import cases_bp
    from api.routes.analysis import analysis_bp
    from api.routes.rules import rules_bp
    from api.routes.llm import llm_bp
    from api.routes.merge import merge_bp
    from api.routes.admin import admin_bp
    from api.routes.clean import clean_bp
    # NEW: Import Discovery
    from api.routes.discovery import discovery_bp 
    from api.routes.mule_detection import mule_bp
    from api.routes.mlops import mlops_bp
    from api.tools.mlops.autopilot_routes import autopilot_bp
    from api.routes.mlops.eda_routes import eda_bp
    from api.routes.mlops.model_training_routes import model_training_bp
    from api.routes.mlops.deployment_dashboard_routes import deployment_dashboard_bp

    app.register_blueprint(auth_bp, url_prefix='/api') 
    app.register_blueprint(data_bp, url_prefix='/api/v2')
    app.register_blueprint(cases_bp, url_prefix='/api/v2')
    app.register_blueprint(analysis_bp, url_prefix='/api/v2')
    app.register_blueprint(rules_bp, url_prefix='/api/v2')
    app.register_blueprint(llm_bp, url_prefix='/api/v2')
    app.register_blueprint(merge_bp, url_prefix='/api/v2')
    app.register_blueprint(admin_bp, url_prefix='/api/v2')

    app.register_blueprint(clean_bp, url_prefix='/api/v2')
    # NEW: Register Discovery with correct prefix
    app.register_blueprint(discovery_bp, url_prefix='/api/v2/discovery')
    app.register_blueprint(mule_bp, url_prefix='/api/v2/mule')
    app.register_blueprint(mlops_bp, url_prefix='/api/mlops')
    app.register_blueprint(autopilot_bp, url_prefix='/api/mlops/autopilot')
    # High-performance EDA endpoints used by the frontend workbench
    app.register_blueprint(eda_bp, url_prefix='/api/eda')
    app.register_blueprint(model_training_bp, url_prefix='/api/model-training')
    app.register_blueprint(deployment_dashboard_bp, url_prefix='/api/deployment-dashboard')

    @app.route('/data/logos/<path:filename>')
    def serve_logos(filename):
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        logo_dir = os.path.join(root_dir, 'data', 'logos')
        return send_from_directory(logo_dir, filename)

    return app
