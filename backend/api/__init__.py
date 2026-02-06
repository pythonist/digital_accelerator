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
    from api.services import services
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

    @app.route('/data/logos/<path:filename>')
    def serve_logos(filename):
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        logo_dir = os.path.join(root_dir, 'data', 'logos')
        return send_from_directory(logo_dir, filename)

    return app
