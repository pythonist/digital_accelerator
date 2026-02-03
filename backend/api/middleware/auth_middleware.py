"""
Authentication Middleware - Tenant Validation with Disabled User Check
File: api/middleware/auth_middleware.py
"""
from flask import request, jsonify
from functools import wraps
import json
import os
import time

DATA_DIR = 'data'
SESSIONS_FILE = os.path.join(DATA_DIR, 'sessions.json')
USERS_FILE = os.path.join(DATA_DIR, 'users.json')

def load_json(filepath):
    """Load JSON file safely"""
    if not os.path.exists(filepath):
        return {}
    try:
        with open(filepath, 'r') as f:
            return json.load(f)
    except:
        return {}

def require_auth(required_role=None):
    """
    Decorator to enforce authentication and optional role check.
    """
    def decorator(func):
        @wraps(func)
        def decorated_function(*args, **kwargs):

            # 🔥 REQUIRED: allow CORS preflight to pass
            if request.method == "OPTIONS":
                return "", 204

            auth_header = request.headers.get('Authorization')
            
            if not auth_header or not auth_header.startswith("Bearer "):
                return jsonify({'error': 'Unauthorized - No token provided'}), 401
            
            token = auth_header.split(" ", 1)[1]
            sessions = load_json(SESSIONS_FILE)
            
            if token not in sessions:
                return jsonify({'error': 'Invalid or expired token'}), 401
            
            session = sessions[token]
            
            # Check expiry (24 hours)
            if time.time() - session.get('timestamp', 0) > 86400:
                return jsonify({'error': 'Session expired'}), 401
            
            # Check if user is disabled
            users = load_json(USERS_FILE)
            username = session.get('username')
            
            if username in users:
                user_data = users[username]
                if user_data.get('disabled', False):
                    # Immediately invalidate session
                    del sessions[token]
                    with open(SESSIONS_FILE, 'w') as f:
                        json.dump(sessions, f, indent=2)
                    return jsonify({'error': 'Account has been disabled'}), 403
            
            # Check role if specified
            user_role = session.get('role', 'TENANT_USER')
            if required_role and user_role != required_role:
                return jsonify({'error': 'Insufficient permissions'}), 403
            
            # Attach session data to request for use in route
            request.tenant_id = session.get('tenant_id')
            request.username = session.get('username')
            request.user_role = user_role
            
            return func(*args, **kwargs)
        
        return decorated_function
    return decorator