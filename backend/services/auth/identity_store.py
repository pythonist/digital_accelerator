from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from werkzeug.security import check_password_hash


try:
    import bcrypt
except Exception:  # pragma: no cover
    bcrypt = None


@dataclass
class IdentityStoreConfig:
    db_path: str


def _backend_dir() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def default_identity_db_path() -> str:
    base = os.path.join(_backend_dir(), "data", "identity")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "identity.db")


class IdentityStore:
    def __init__(self, config: Optional[IdentityStoreConfig] = None):
        self.config = config or IdentityStoreConfig(db_path=default_identity_db_path())
        os.makedirs(os.path.dirname(self.config.db_path), exist_ok=True)
        self._init_schema()
        self._ensure_bcrypt()
        self.migrate_legacy_files()
        self._enforce_single_demo_user()


    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.config.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS tenants (
                    tenant_id TEXT PRIMARY KEY,
                    domain TEXT UNIQUE,
                    tenant_name TEXT,
                    created_at REAL
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    tenant_id TEXT,
                    role TEXT,
                    disabled INTEGER DEFAULT 0,
                    created_at REAL,
                    updated_at REAL,
                    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id)
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)")
            conn.commit()
        finally:
            conn.close()

    def _legacy_paths(self) -> Tuple[str, str]:
        base = os.path.join(_backend_dir(), "data")
        return (os.path.join(base, "users.json"), os.path.join(base, "tenants.json"))

    def migrate_legacy_files(self) -> None:
        users_file, tenants_file = self._legacy_paths()
        tenants = {}
        if os.path.exists(tenants_file):
            try:
                with open(tenants_file, "r") as f:
                    tenants = json.load(f) or {}
            except Exception:
                tenants = {}
        users = {}
        if os.path.exists(users_file):
            try:
                with open(users_file, "r") as f:
                    users = json.load(f) or {}
            except Exception:
                users = {}

        if not tenants and not users:
            return

        conn = self._connect()
        try:
            cur = conn.cursor()
            for domain, info in (tenants or {}).items():
                tid = str((info or {}).get("tenant_id") or "").strip() or str(domain).split(".")[0].lower()
                tname = (info or {}).get("tenant_name") or tid.upper()
                created_at = float((info or {}).get("created_at") or time.time())
                cur.execute(
                    """
                    INSERT OR IGNORE INTO tenants (tenant_id, domain, tenant_name, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (tid, str(domain).lower(), str(tname), created_at),
                )

            for email, info in (users or {}).items():
                email_s = str(email).strip().lower()
                if not email_s:
                    continue
                cur.execute("SELECT 1 FROM users WHERE email = ?", (email_s,))
                if cur.fetchone():
                    continue
                tid = (info or {}).get("tenant_id")
                role = (info or {}).get("role") or "TENANT_USER"
                pwd_hash = (info or {}).get("password_hash")
                if not pwd_hash:
                    continue
                created_at = float((info or {}).get("created_at") or time.time())
                disabled = 1 if bool((info or {}).get("disabled", False)) else 0
                cur.execute(
                    """
                    INSERT INTO users (user_id, email, password_hash, tenant_id, role, disabled, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (str(uuid.uuid4()), email_s, str(pwd_hash), tid, str(role), disabled, created_at, created_at),
                )
            conn.commit()
        finally:
            conn.close()

    def _enforce_single_demo_user(self) -> None:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM users WHERE email != 'admin@fccanalytics.com'")
            cur.execute("DELETE FROM tenants WHERE domain != 'fccanalytics.com'")
            
            cur.execute("SELECT tenant_id FROM tenants WHERE domain = 'fccanalytics.com'")
            tenant = cur.fetchone()
            if not tenant:
                cur.execute(
                    "INSERT INTO tenants (tenant_id, domain, tenant_name, created_at) VALUES (?, ?, ?, ?)",
                    ("fccanalytics", "fccanalytics.com", "FCCANALYTICS", float(time.time()))
                )
            
            cur.execute("SELECT user_id FROM users WHERE email = 'admin@fccanalytics.com'")
            user = cur.fetchone()
            pwd_hash = self.hash_password("admin")
            now = float(time.time())
            if not user:
                cur.execute(
                    """
                    INSERT INTO users (user_id, email, password_hash, tenant_id, role, disabled, created_at, updated_at)
                    VALUES (?, 'admin@fccanalytics.com', ?, 'fccanalytics', 'TENANT_ADMIN', 0, ?, ?)
                    """,
                    (str(uuid.uuid4()), pwd_hash, now, now)
                )
            else:
                cur.execute(
                    "UPDATE users SET password_hash = ?, role = 'TENANT_ADMIN', disabled = 0, updated_at = ? WHERE email = 'admin@fccanalytics.com'",
                    (pwd_hash, now)
                )
            conn.commit()
        finally:
            conn.close()

    def _ensure_bcrypt(self) -> None:
        if bcrypt is None:
            raise RuntimeError("bcrypt is required for password hashing")

    def hash_password(self, password: str) -> str:
        self._ensure_bcrypt()
        pw = (password or "").encode("utf-8")
        hashed = bcrypt.hashpw(pw, bcrypt.gensalt(rounds=12))
        return hashed.decode("utf-8")

    def verify_password(self, password: str, stored_hash: str) -> Tuple[bool, Optional[str]]:
        if not stored_hash:
            return False, None
        ph = str(stored_hash)
        if ph.startswith("$2a$") or ph.startswith("$2b$") or ph.startswith("$2y$"):
            self._ensure_bcrypt()
            ok = bcrypt.checkpw((password or "").encode("utf-8"), ph.encode("utf-8"))
            return bool(ok), None
        ok = bool(check_password_hash(ph, password or ""))
        if ok:
            return True, self.hash_password(password)
        return False, None

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        if not email:
            return None
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM users WHERE email = ?", (str(email).strip().lower(),))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        if not user_id:
            return None
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM users WHERE user_id = ?", (str(user_id),))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def upsert_tenant_from_email(self, email: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        if not email or "@" not in email:
            return None, None, None
        domain = str(email).split("@", 1)[1].lower()
        tenant_id = domain.split(".", 1)[0].lower()
        tenant_name = tenant_id.upper()

        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT tenant_id, tenant_name FROM tenants WHERE domain = ?", (domain,))
            row = cur.fetchone()
            if row:
                return str(row["tenant_id"]), str(row["tenant_name"]), domain

            cur.execute(
                "INSERT INTO tenants (tenant_id, domain, tenant_name, created_at) VALUES (?, ?, ?, ?)",
                (tenant_id, domain, tenant_name, float(time.time())),
            )
            conn.commit()
            return tenant_id, tenant_name, domain
        finally:
            conn.close()

    def get_tenant(self, tenant_id: str) -> Optional[Dict[str, Any]]:
        if not tenant_id:
            return None
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM tenants WHERE tenant_id = ?", (str(tenant_id),))
            row = cur.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def list_user_tenants(self, user_id: str) -> List[str]:
        u = self.get_user_by_id(user_id)
        if not u:
            return []
        tid = u.get("tenant_id")
        return [str(tid)] if tid else []

    def count_users_in_tenant(self, tenant_id: str) -> int:
        if not tenant_id:
            return 0
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(1) AS n FROM users WHERE tenant_id = ?", (str(tenant_id),))
            row = cur.fetchone()
            return int(row["n"]) if row else 0
        finally:
            conn.close()

    def create_user(self, email: str, password: str, tenant_id: Optional[str], role: str) -> Dict[str, Any]:
        email_s = str(email or "").strip().lower()
        if not email_s:
            raise ValueError("Email is required")
        if email_s != "admin@fccanalytics.com":
            raise ValueError("Registration is disabled. Only the root user admin@fccanalytics.com is allowed.")
        pwd_hash = self.hash_password(password or "")
        now = float(time.time())
        user_id = str(uuid.uuid4())

        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO users (user_id, email, password_hash, tenant_id, role, disabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (user_id, email_s, pwd_hash, tenant_id, str(role or "TENANT_USER"), now, now),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_user_by_id(user_id) or {}

    def create_user_with_hash(self, email: str, password_hash: str, tenant_id: Optional[str], role: str) -> Dict[str, Any]:
        email_s = str(email or "").strip().lower()
        if not email_s:
            raise ValueError("Email is required")
        if email_s != "admin@fccanalytics.com":
            raise ValueError("Registration is disabled. Only the root user admin@fccanalytics.com is allowed.")
        if not password_hash:
            raise ValueError("Password hash is required")
        now = float(time.time())
        user_id = str(uuid.uuid4())

        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO users (user_id, email, password_hash, tenant_id, role, disabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (user_id, email_s, str(password_hash), tenant_id, str(role or "TENANT_USER"), now, now),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_user_by_id(user_id) or {}

    def authenticate(self, email: str, password: str) -> Tuple[Optional[Dict[str, Any]], bool]:
        user = self.get_user_by_email(email)
        if not user:
            return None, False
        if int(user.get("disabled") or 0) == 1:
            return user, False
        ok, upgraded = self.verify_password(password, str(user.get("password_hash") or ""))
        if ok and upgraded:
            self.update_password_hash(str(user["user_id"]), upgraded)
            user["password_hash"] = upgraded
        return user, ok

    def update_password_hash(self, user_id: str, password_hash: str) -> None:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE users SET password_hash = ?, updated_at = ? WHERE user_id = ?",
                (str(password_hash), float(time.time()), str(user_id)),
            )
            conn.commit()
        finally:
            conn.close()

    def list_users_by_tenant(self, tenant_id: str) -> List[Dict[str, Any]]:
        if not tenant_id:
            return []
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT u.user_id, u.email, u.tenant_id, u.role, u.disabled, u.created_at, u.updated_at
                FROM users u
                WHERE u.tenant_id = ?
                ORDER BY u.created_at DESC
                """,
                (str(tenant_id),),
            )
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()

    def set_user_disabled(self, user_id: str, disabled: bool) -> None:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE users SET disabled = ?, updated_at = ? WHERE user_id = ?",
                (1 if disabled else 0, float(time.time()), str(user_id)),
            )
            conn.commit()
        finally:
            conn.close()

    def set_user_role(self, user_id: str, role: str) -> None:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                "UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?",
                (str(role or "TENANT_USER"), float(time.time()), str(user_id)),
            )
            conn.commit()
        finally:
            conn.close()

    def delete_user(self, user_id: str) -> None:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM users WHERE user_id = ?", (str(user_id),))
            conn.commit()
        finally:
            conn.close()
