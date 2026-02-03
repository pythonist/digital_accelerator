
"""
Tenant Context Middleware

Purpose:
---------
This middleware injects tenant-aware context into every authenticated request.

What it does:
-------------
- Reads the session token from `Authorization: Bearer <token>`
- Loads session data from `data/sessions.json`
- Validates session existence and expiry
- Injects the following attributes into `flask.request`:
    - request.tenant_id   → current tenant
    - request.user_role   → TENANT_ADMIN / TENANT_USER
    - request.username    → logged-in user

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
import json
import os
import time
from flask import request, jsonify

DATA_DIR = "data"
SESSIONS_FILE = os.path.join(DATA_DIR, "sessions.json")

def load_sessions():
    if not os.path.exists(SESSIONS_FILE):
        return {}
    try:
        with open(SESSIONS_FILE, "r") as f:
            return json.load(f)
    except:
        return {}

def tenant_context_middleware(app):
    @app.before_request
    def inject_tenant_context():
        # Skip preflight
        if request.method == "OPTIONS":
            return None

        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return None  # unauth routes will handle auth themselves

        token = auth_header.split(" ", 1)[1]
        sessions = load_sessions()

        session = sessions.get(token)
        if not session:
            return jsonify({"error": "Invalid or expired session"}), 401

        # Expiry check (24h)
        if time.time() - session.get("timestamp", 0) > 86400:
            del sessions[token]
            with open(SESSIONS_FILE, "w") as f:
                json.dump(sessions, f, indent=2)
            return jsonify({"error": "Session expired"}), 401

        # 🔥 THIS IS THE FIX
        request.tenant_id = session.get("tenant_id")
        request.user_role = session.get("role")
        request.username = session.get("username")

        return None
