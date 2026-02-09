import os
import sys
import traceback
import subprocess
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from security.dotenv_loader import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"), override=False)

_VENV_PY = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv", "Scripts", "python.exe")
_REQ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
if __name__ == "__main__" and os.path.exists(_VENV_PY):
    exe = os.path.abspath(sys.executable).lower()
    vexe = os.path.abspath(_VENV_PY).lower()
    if exe != vexe:
        os.execv(_VENV_PY, [_VENV_PY] + sys.argv)
if __name__ == "__main__" and (not os.path.exists(_VENV_PY)) and os.path.exists(_REQ):
    subprocess.check_call([sys.executable, "-m", "venv", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv")])
    subprocess.check_call([_VENV_PY, "-m", "pip", "install", "-r", _REQ])
    os.execv(_VENV_PY, [_VENV_PY] + sys.argv)

from config import CALIBRATION_DB_PATH
from api.services import services
from core.module_registry import REGISTRY
from core.compat import log_startup_compat
from config_btsy import configure_btsy_app

from api.middleware.tenant_context import tenant_context_middleware
from security.app_secrets import get_app_secret_key

from api.routes.auth import auth_bp
from api.routes.admin import admin_bp
from api.routes.environment import env_bp
from api.routes.llm import llm_bp
from api.routes.data import data_bp
from api.routes.merge import merge_bp
from api.routes.clean import clean_bp
from api.routes.rules import rules_bp
from api.routes.discovery import discovery_bp
from api.routes.cases import cases_bp
from api.routes.compare import compare_bp
from api.routes.analysis import analysis_bp
from api.routes.typology import typology_bp
from api.routes.case_facts import case_facts_bp
from api.routes.calibration import calibration_bp
from api.routes.audit import audit_bp

try:
    from api.routes.connectors import connectors_bp
    CONNECTORS_ENABLED = True
except ImportError:
    connectors_bp = None
    CONNECTORS_ENABLED = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, "dist")


def _setup_cors(app: Flask) -> None:
    CORS(
        app,
        resources={r"/*": {"origins": "*"}},
        allow_headers=["Content-Type", "Authorization", "X-Environment-ID"],
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    )


def _iter_routes(app: Flask):
    return sorted(app.url_map.iter_rules(), key=lambda r: (r.rule, ",".join(sorted(r.methods or []))))


def _print_debug_routes(app: Flask) -> None:
    prefixes = os.getenv(
        "DEBUG_ROUTE_PREFIXES",
        "/health,/api/v2/mule,/api/btsy/behavior,/api/btsy/universe",
    ).split(",")
    prefixes = [p.strip() for p in prefixes if p.strip()]

    should_print = os.getenv("PRINT_DEBUG_ROUTES", "1") == "1"
    if not should_print:
        return

    routes = []
    for rule in _iter_routes(app):
        if rule.endpoint == "static":
            continue
        if any(rule.rule.startswith(p) for p in prefixes):
            methods = sorted(m for m in (rule.methods or set()) if m not in {"HEAD", "OPTIONS"})
            routes.append((methods, rule.rule))

    if not routes:
        return

    print("\n" + "=" * 70)
    print("DEBUG ROUTES")
    print("=" * 70)
    for methods, path in routes:
        print(f"{methods} {path}")
    print("=" * 70 + "\n")


def _print_startup_summary(app: Flask, core_ok: bool) -> None:
    active_env = services.metadata_manager.active_env if services.metadata_manager else None
    cal_db_exists = os.path.exists(CALIBRATION_DB_PATH)
    dist_index = os.path.join(app.static_folder, "index.html")

    print("\n" + "=" * 70)
    print("SENTINEL AML — STARTUP")
    print("=" * 70)
    print(f"Core services: {'READY' if core_ok else 'FAILED'}")
    print(f"Active env   : {active_env or 'NONE'}")
    print(f"Calibration DB: {CALIBRATION_DB_PATH} ({'FOUND' if cal_db_exists else 'MISSING'})")
    print(f"Frontend dist: {app.static_folder} ({'index.html OK' if os.path.exists(dist_index) else 'index.html MISSING'})")
    print("=" * 70)


def _register_blueprints(app: Flask) -> None:
    app.register_blueprint(auth_bp, url_prefix="/api")
    app.register_blueprint(admin_bp, url_prefix="/api")

    from api.tools.btsy.behaviour_reconstruction.routes import behaviour_reconstruction_bp
    app.register_blueprint(behaviour_reconstruction_bp, url_prefix="/api")

    app.register_blueprint(env_bp, url_prefix="/api/v2")
    app.register_blueprint(llm_bp, url_prefix="/api/v2")
    app.register_blueprint(audit_bp, url_prefix="/api/v2")
    app.register_blueprint(data_bp, url_prefix="/api/v2")
    app.register_blueprint(merge_bp, url_prefix="/api/v2")
    app.register_blueprint(clean_bp, url_prefix="/api/v2")
    app.register_blueprint(rules_bp, url_prefix="/api/v2")
    app.register_blueprint(discovery_bp, url_prefix="/api/v2/discovery")
    app.register_blueprint(compare_bp, url_prefix="/api/v2/compare")
    app.register_blueprint(analysis_bp, url_prefix="/api/v2/analysis")
    app.register_blueprint(cases_bp, url_prefix="/api/v2")
    app.register_blueprint(typology_bp, url_prefix="/api/v2")
    app.register_blueprint(case_facts_bp, url_prefix="/api/v2")

    try:
        from api.routes.mule_detection import mule_bp
        app.register_blueprint(mule_bp, url_prefix="/api/v2/mule")
        mule_ok = True
    except Exception as e:
        print("Mule module import failed:", repr(e))
        traceback.print_exc()
        mule_ok = False

    try:
        from api.routes.btsy import btsy_bp
        app.register_blueprint(btsy_bp, url_prefix="/api/btsy")
        btsy_ok = True
    except Exception:
        btsy_ok = False

    if CONNECTORS_ENABLED and connectors_bp:
        app.register_blueprint(connectors_bp, url_prefix="/api/v2")

    if calibration_bp:
        app.register_blueprint(calibration_bp, url_prefix="/api/v2/calibration")

    print(f"Mule module  : {'ENABLED' if mule_ok else 'DISABLED'}")
    print(f"BTSY module  : {'ENABLED' if btsy_ok else 'DISABLED'}")
    print(f"Connectors   : {'ENABLED' if CONNECTORS_ENABLED else 'DISABLED'}")
    print(f"Calibration  : {'ENABLED' if bool(calibration_bp) else 'DISABLED'}")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=DIST_DIR)
    app.secret_key = get_app_secret_key()
    app = configure_btsy_app(app)
    tenant_context_middleware(app)
    _setup_cors(app)

    core_ok = services.init_services()
    _register_blueprints(app)

    @app.errorhandler(Exception)
    def _api_error_handler(e):
        try:
            traceback.print_exc()
        except Exception:
            pass
        if request.path.startswith("/api"):
            return jsonify({"error": "Internal Server Error"}), 500
        return jsonify({"error": "Internal Server Error"}), 500

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def serve_react_app(path):
        if path.startswith("api"):
            return jsonify({"error": "API route not found"}), 404
        file_path = os.path.join(app.static_folder, path)
        if path and os.path.exists(file_path):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")

    @app.route("/health")
    def health():
        return jsonify({"status": "healthy"})

    @app.route("/health/deep")
    def health_deep():
        return jsonify({
            "status": "healthy",
            "modules": REGISTRY.status()
        })

    @app.route("/system/compatibility")
    def system_compatibility():
        from core.compat import get_python_info, detect_optional_libs, get_supported_features
        return jsonify({
            "python": get_python_info(),
            "optional_libs": detect_optional_libs(),
            "features": get_supported_features(REGISTRY, pdf_service_available=bool(getattr(services, "get_pdf_generator_service", None))),
        })

    warmup = os.getenv("WARMUP_MODULES", "").strip()
    if warmup:
        names = [s.strip() for s in warmup.split(",") if s.strip()]
        REGISTRY.warmup_async(names=names, delay_sec=0.2)
    else:
        REGISTRY.warmup_defaults(delay_sec=0.2)

    log_startup_compat(REGISTRY, pdf_service_available=bool(getattr(services, "get_pdf_generator_service", None)))

    _print_startup_summary(app, core_ok)
    _print_debug_routes(app)
    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.getenv("APP_PORT", os.getenv("PORT", "5001")))
    debug = (os.getenv("FLASK_DEBUG", "0") == "1") or (os.getenv("DEBUG", "0") == "1")
    app.run(debug=debug, use_reloader=False, threaded=True, host="0.0.0.0", port=port)
