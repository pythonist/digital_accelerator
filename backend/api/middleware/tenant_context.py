
"""
Tenant Context Middleware

Purpose:
---------
This middleware injects tenant-aware context into every authenticated request.

What it does:
-------------
- Reads the session token from `Authorization: Bearer <token>`
- Verifies signed session token and expiry (TTL)
- Injects the following attributes into `flask.request`:
    - request.tenant_id   → current tenant
    - request.user_role   → TENANT_ADMIN / TENANT_USER
    - request.username    → logged-in user
    - request.user_id     → logged-in user id
    - request.env_id      → selected environment (optional)

Why this is required:
---------------------
Many API routes assume `request.tenant_id` exists.
Without a global middleware, these routes fail with:
    'Request' object has no attribute 'tenant_id'

This middleware ensures:
------------------------
- Consistent tenant context across ALL routes
- No need to manually extract tenant in every API
- Clean separation between auth logic and business logic

Notes:
------
- Skips OPTIONS (CORS preflight) requests
- Allows unauthenticated routes to handle auth themselves
- Session expiry enforced (24 hours)
"""
from flask import jsonify, request

from services.auth.identity_store import IdentityStore
from services.auth.session_tokens import SessionTokenService


identity_store = IdentityStore()
token_service = SessionTokenService()

def tenant_context_middleware(app):
    @app.before_request
    def inject_tenant_context():
        request.user_id = None
        request.username = None
        request.user_role = None
        request.tenant_id = "default"
        request.env_id = None
        # Skip preflight
        if request.method == "OPTIONS":
            return None

        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None  # unauth routes will handle auth themselves

        token = auth_header.split(" ", 1)[1]
        try:
            payload = token_service.verify(token)
        except Exception:
            return jsonify({"error": "Invalid or expired session"}), 401

        user_id = payload.get("user_id")
        user = identity_store.get_user_by_id(str(user_id)) if user_id else None
        if not user or int(user.get("disabled") or 0) == 1:
            return jsonify({"error": "Invalid or expired session"}), 401

        request.user_id = str(user.get("user_id"))
        request.username = user.get("email")
        request.user_role = user.get("role") or "TENANT_USER"
        request.tenant_id = payload.get("tenant_id") or user.get("tenant_id")
        request.env_id = payload.get("env_id")

        return None
