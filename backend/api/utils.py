# api/utils.py
from functools import wraps

from flask import jsonify

from api.services import services


def handle_errors(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not services.investigation_db:
            if services.metadata_manager and services.metadata_manager.active_env:
                print("Warning: DB missing but environment is active. Attempting restore...")
                try:
                    services.activate_case(
                        services.metadata_manager.active_env,
                        services.metadata_manager.active_tenant or "default",
                    )
                except Exception:
                    pass

            if not services.investigation_db:
                return jsonify({"error": "No active environment selected. Please select a case."}), 400

        try:
            return f(*args, **kwargs)
        except Exception as e:
            print(f"API Error: {str(e)}")
            return jsonify({"error": str(e), "success": False}), 500

    return wrapper
