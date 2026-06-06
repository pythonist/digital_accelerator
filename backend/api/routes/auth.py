"""
Authentication: Portable Identity + Ephemeral Sessions
File: api/routes/auth.py
"""

from __future__ import annotations

import uuid
import time
import traceback
from typing import Dict, Optional

from flask import Blueprint, jsonify, request

from api.service_locator import services
from services.auth.identity_store import IdentityStore
from services.auth.session_tokens import SessionTokenService


auth_bp = Blueprint("auth", __name__)

identity_store = IdentityStore()
token_service = SessionTokenService()


def _audit_logger():
    return getattr(services, "audit_logger", None)


def _auth_token() -> Optional[str]:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    return auth_header.split(" ", 1)[1].strip()


def _issue_session(user: Dict, tenant_id: Optional[str] = None, env_id: Optional[str] = None) -> str:
    payload = {
        "sid": str(uuid.uuid4()),
        "iat": float(time.time()),
        "user_id": user.get("user_id"),
        "email": user.get("email"),
        "role": user.get("role") or "TENANT_USER",
        "tenant_id": tenant_id if tenant_id is not None else user.get("tenant_id"),
        "env_id": env_id,
    }
    return token_service.issue(payload)


def _require_session():
    token = _auth_token()
    if not token:
        return None, None, (jsonify({"error": "Unauthorized"}), 401)
    try:
        payload = token_service.verify(token)
    except Exception:
        return None, None, (jsonify({"error": "Invalid or expired token"}), 401)
    user_id = payload.get("user_id")
    user = identity_store.get_user_by_id(str(user_id)) if user_id else None
    if not user or int(user.get("disabled") or 0) == 1:
        return None, None, (jsonify({"error": "Invalid or expired token"}), 401)
    return user, payload, None


@auth_bp.route("/check-auth", methods=["GET"])
def check_auth():
    token = _auth_token()
    if not token:
        return jsonify({"authenticated": False}), 401
    try:
        payload = token_service.verify(token)
    except Exception:
        return jsonify({"authenticated": False}), 401

    user_id = payload.get("user_id")
    user = identity_store.get_user_by_id(str(user_id)) if user_id else None
    if not user or int(user.get("disabled") or 0) == 1:
        return jsonify({"authenticated": False}), 401

    return jsonify(
        {
            "authenticated": True,
            "user": {
                "user_id": user.get("user_id"),
                "username": user.get("email"),
                "role": user.get("role") or "TENANT_USER",
                "tenant_id": payload.get("tenant_id") or user.get("tenant_id"),
            },
            "context": {"tenant_id": payload.get("tenant_id"), "env_id": payload.get("env_id")},
        }
    )


@auth_bp.route("/register/init", methods=["POST"])
def register_init():
    data = request.json or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email:
        return jsonify({"error": "Email is required"}), 400
    if not password:
        return jsonify({"error": "Password is required"}), 400

    if identity_store.get_user_by_email(email):
        return jsonify({"error": "User already registered"}), 400

    tenant_id, tenant_name, _domain = identity_store.upsert_tenant_from_email(email)
    if not tenant_id:
        return jsonify({"error": "Invalid email format. Please use a valid email address."}), 400

    role = "TENANT_ADMIN" if identity_store.count_users_in_tenant(tenant_id) == 0 else "TENANT_USER"
    user = identity_store.create_user_with_hash(email, identity_store.hash_password(password), tenant_id, role)

    return jsonify(
        {
            "success": True,
            "tenant_name": tenant_name,
            "is_first_user": role == "TENANT_ADMIN",
            "user": {"username": user.get("email"), "role": user.get("role"), "tenant_id": user.get("tenant_id")},
            "message": f"Account created successfully as {user.get('role')}",
        }
    )


@auth_bp.route("/login", methods=["POST"])
def login():
    try:
        data = request.json or {}
        email = (data.get("username") or data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        print(
            "LOGIN_REQUEST",
            {
                "email": email,
                "has_password": bool(password),
                "ip": request.remote_addr,
                "ua": request.headers.get("User-Agent"),
            },
        )

        if not email or not password:
            return jsonify({"error": "Username and password required"}), 400

        user, ok = identity_store.authenticate(email, password)
        if not user:
            try:
                if _audit_logger():
                    _audit_logger().log_login(user=email, success=False, ip_address=request.remote_addr)
            except Exception:
                pass
            return jsonify({"error": "Invalid email or password"}), 401
        if int(user.get("disabled") or 0) == 1:
            try:
                if _audit_logger():
                    _audit_logger().log_login(user=email, success=False, ip_address=request.remote_addr)
            except Exception:
                pass
            return jsonify({"error": "Account has been disabled"}), 403
        if not ok:
            try:
                if _audit_logger():
                    _audit_logger().log_login(user=email, success=False, ip_address=request.remote_addr)
            except Exception:
                pass
            return jsonify({"error": "Invalid email or password"}), 401

        token = _issue_session(user)
        try:
            if _audit_logger():
                _audit_logger().log_login(user=str(user.get("email")), success=True, ip_address=request.remote_addr)
        except Exception:
            pass
        return jsonify(
            {
                "success": True,
                "user": {"username": user.get("email"), "role": user.get("role"), "tenant_id": user.get("tenant_id")},
                "token": token,
            }
        )
    except Exception as e:
        print("LOGIN_ERROR", repr(e))
        traceback.print_exc()
        return jsonify({"error": "Login failed"}), 500


@auth_bp.route("/logout", methods=["POST"])
def logout():
    token = _auth_token()
    if token:
        try:
            payload = token_service.verify(token)
            email = payload.get("email")
            if email:
                services.audit_logger.log_logout(user=str(email), ip_address=request.remote_addr)
        except Exception:
            pass
    return jsonify({"success": True, "message": "Logged out successfully"})


@auth_bp.route("/tenants/my", methods=["GET"])
def my_tenants():
    user, _payload, err = _require_session()
    if err:
        return err
    tenant_ids = identity_store.list_user_tenants(str(user.get("user_id")))
    tenants = []
    for tid in tenant_ids:
        t = identity_store.get_tenant(str(tid)) or {}
        tenants.append(
            {
                "tenant_id": str(tid),
                "tenant_name": t.get("tenant_name") or str(tid).upper(),
                "domain": t.get("domain"),
            }
        )
    return jsonify({"success": True, "tenants": tenants})


@auth_bp.route("/select-context", methods=["POST"])
def select_context():
    user, payload, err = _require_session()
    if err:
        return err
    data = request.json or {}
    tenant_id = data.get("tenant_id")
    env_id = data.get("env_id")
    allowed = set(identity_store.list_user_tenants(str(user.get("user_id"))))
    if tenant_id and str(tenant_id) not in allowed:
        return jsonify({"error": "Invalid tenant selection"}), 403
    new_token = _issue_session(user, tenant_id=str(tenant_id) if tenant_id else payload.get("tenant_id"), env_id=env_id)
    return jsonify({"success": True, "token": new_token, "context": {"tenant_id": tenant_id, "env_id": env_id}})
