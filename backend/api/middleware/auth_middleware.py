"""
Authentication Middleware - Signed Session Tokens with Disabled User Check
File: api/middleware/auth_middleware.py
"""

from functools import wraps

from flask import jsonify, request

from services.auth.identity_store import IdentityStore
from services.auth.session_tokens import SessionTokenService


identity_store = IdentityStore()
token_service = SessionTokenService()


def require_auth(required_role=None):
    def decorator(func):
        @wraps(func)
        def decorated_function(*args, **kwargs):
            if request.method == "OPTIONS":
                return "", 204

            auth_header = request.headers.get("Authorization")
            if not auth_header or not auth_header.startswith("Bearer "):
                return jsonify({"error": "Unauthorized - No token provided"}), 401

            token = auth_header.split(" ", 1)[1].strip()
            try:
                payload = token_service.verify(token)
            except Exception:
                return jsonify({"error": "Invalid or expired token"}), 401

            user_id = payload.get("user_id")
            user = identity_store.get_user_by_id(str(user_id)) if user_id else None
            if not user or int(user.get("disabled") or 0) == 1:
                return jsonify({"error": "Invalid or expired token"}), 401

            user_role = user.get("role") or "TENANT_USER"
            if required_role and user_role != required_role:
                return jsonify({"error": "Insufficient permissions"}), 403

            request.user_id = str(user.get("user_id"))
            request.username = user.get("email")
            request.user_role = user_role
            request.tenant_id = payload.get("tenant_id") or user.get("tenant_id")
            request.env_id = payload.get("env_id")

            return func(*args, **kwargs)

        return decorated_function

    return decorator

