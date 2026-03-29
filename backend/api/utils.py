# api/utils.py
from functools import wraps

from flask import jsonify, request

from api.services import services


def handle_errors(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        requested_env = request.args.get("env_id") or request.headers.get("X-Environment-ID")
        requested_tenant = (
            getattr(request, "tenant_id", None)
            or request.headers.get("X-Tenant-ID")
            or (services.metadata_manager.active_tenant if services.metadata_manager else None)
            or "default"
        )
        needs_binding = bool(
            requested_env and (
                not services.investigation_db
                or not services.metadata_manager
                or services.metadata_manager.active_env != requested_env
                or services.metadata_manager.active_tenant != requested_tenant
            )
        )

        if needs_binding:
            try:
                services.bind_environment_context(str(requested_env), str(requested_tenant))
            except Exception:
                pass

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
