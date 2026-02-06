"""
Authentication: Portable Identity + Ephemeral Sessions
File: api/routes/auth.py
"""

from __future__ import annotations

import time
import uuid
import os
import traceback
from typing import Dict, Optional

import pyotp
from flask import Blueprint, jsonify, request

from api.services import services
from services.auth.identity_store import IdentityStore
from services.auth.session_tokens import SessionTokenService
from security.app_secrets import _is_production


auth_bp = Blueprint("auth", __name__)

identity_store = IdentityStore()
token_service = SessionTokenService()

PENDING_REG_CACHE: Dict[str, Dict] = {}
PENDING_LOGIN_CACHE: Dict[str, Dict] = {}


def _audit_logger():
    return getattr(services, "audit_logger", None)


def _mfa_bypass_enabled() -> bool:
    v = (os.getenv("MFA_BYPASS_ENABLED") or "false").strip().lower()
    return (not _is_production()) and v in {"1", "true", "yes", "y"}


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
    phone = data.get("phone")

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

    secret = pyotp.random_base32()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=email, issuer_name="Sentinel AML")

    temp_token = str(uuid.uuid4())
    PENDING_REG_CACHE[temp_token] = {
        "email": email,
        "password_hash": identity_store.hash_password(password),
        "phone": phone,
        "secret": secret,
        "tenant_id": tenant_id,
        "role": role,
        "timestamp": float(time.time()),
    }

    return jsonify(
        {
            "success": True,
            "temp_token": temp_token,
            "qr_uri": uri,
            "tenant_name": tenant_name,
            "is_first_user": role == "TENANT_ADMIN",
            "message": "Scan QR code with your authenticator app",
        }
    )


@auth_bp.route("/register/verify", methods=["POST"])
def register_verify():
    data = request.json or {}
    temp_token = data.get("temp_token")
    code = data.get("code")

    reg_data = PENDING_REG_CACHE.get(str(temp_token))
    if not reg_data:
        return jsonify({"error": "Registration session expired"}), 400

    if not pyotp.TOTP(reg_data["secret"]).verify(str(code or "")):
        return jsonify({"error": "Invalid 2FA code"}), 400

    user = identity_store.create_user_with_hash(
        reg_data["email"], reg_data["password_hash"], reg_data.get("tenant_id"), reg_data.get("role") or "TENANT_USER"
    )
    identity_store.set_mfa(str(user.get("user_id")), str(reg_data["secret"]), True)

    del PENDING_REG_CACHE[str(temp_token)]
    return jsonify({"success": True, "message": f"Account created successfully as {user.get('role')}"})


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

        mfa = identity_store.get_mfa(str(user.get("user_id")))
        if (not _mfa_bypass_enabled()) and mfa and int(mfa.get("enabled") or 0) == 1:
            temp_token = str(uuid.uuid4())
            PENDING_LOGIN_CACHE[temp_token] = {"user_id": str(user.get("user_id")), "timestamp": float(time.time())}
            return jsonify({"success": True, "require_mfa": True, "temp_token": temp_token})

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


@auth_bp.route("/login/verify", methods=["POST"])
def login_verify():
    try:
        data = request.json or {}
        temp_token = data.get("temp_token")
        code = data.get("code")
        print(
            "LOGIN_VERIFY_REQUEST",
            {
                "temp_token": bool(temp_token),
                "has_code": bool(code),
                "ip": request.remote_addr,
                "ua": request.headers.get("User-Agent"),
            },
        )

        user = None
        if temp_token:
            pending = PENDING_LOGIN_CACHE.get(str(temp_token))
            if not pending:
                return jsonify({"error": "Login session expired"}), 400
            if float(time.time()) - float(pending.get("timestamp") or 0) > 600:
                del PENDING_LOGIN_CACHE[str(temp_token)]
                return jsonify({"error": "Login session expired"}), 400
            user = identity_store.get_user_by_id(str(pending.get("user_id")))
            if not user:
                del PENDING_LOGIN_CACHE[str(temp_token)]
                return jsonify({"error": "User not found"}), 401
        else:
            email = (data.get("username") or data.get("email") or "").strip().lower()
            password = data.get("password") or ""
            if not email or not password or not code:
                return jsonify({"error": "temp_token and code required"}), 400
            user, ok = identity_store.authenticate(email, password)
            if not user or not ok:
                return jsonify({"error": "Invalid email or password"}), 401

        if int(user.get("disabled") or 0) == 1:
            return jsonify({"error": "Account has been disabled"}), 403

        mfa = identity_store.get_mfa(str(user.get("user_id")))
        if _mfa_bypass_enabled():
            token = _issue_session(user)
            return jsonify(
                {
                    "success": True,
                    "user": {"username": user.get("email"), "role": user.get("role"), "tenant_id": user.get("tenant_id")},
                    "token": token,
                }
            )

        if not mfa or int(mfa.get("enabled") or 0) != 1 or not mfa.get("secret"):
            return jsonify({"error": "MFA not enabled"}), 400
        if not code:
            return jsonify({"error": "code required"}), 400
        if not pyotp.TOTP(str(mfa.get("secret"))).verify(str(code)):
            return jsonify({"error": "Invalid 2FA code"}), 400

        if temp_token:
            del PENDING_LOGIN_CACHE[str(temp_token)]

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
        print("LOGIN_VERIFY_ERROR", repr(e))
        traceback.print_exc()
        return jsonify({"error": "Login verification failed"}), 500


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
