import json
from typing import Any, Dict, List, Optional

from services.case_queue_service import CaseQueueService, ensure_case_queue_schema, utcnow_iso
from services.notification_service import NotificationService


class MailConfigService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.queue_service = CaseQueueService(db_manager)
        self.notification_service = NotificationService()

    def _connect(self):
        conn = self.db_manager.connect()
        conn.row_factory = __import__("sqlite3").Row
        ensure_case_queue_schema(conn)
        self.queue_service._seed_default_templates(conn)
        return conn

    def list_recipients(self, filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        filters = filters or {}
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM mail_recipients ORDER BY role, name")
            rows = [dict(row) for row in cur.fetchall()]
            search = str(filters.get("search") or "").strip().lower()
            role = str(filters.get("role") or "").strip()
            if search:
                rows = [
                    row for row in rows
                    if search in " ".join([str(row.get("name") or ""), str(row.get("email") or ""), str(row.get("branch_code") or ""), str(row.get("region") or "")]).lower()
                ]
            if role:
                rows = [row for row in rows if row.get("role") == role]
            for row in rows:
                try:
                    row["case_types_supported"] = json.loads(row.get("case_types_supported") or "[]")
                except Exception:
                    row["case_types_supported"] = []
                row["auto_route_enabled"] = bool(row.get("auto_route_enabled"))
                row["is_active"] = bool(row.get("is_active"))
            return {"rows": rows}
        finally:
            self.db_manager.close_connection(conn)

    def create_recipient(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            now = utcnow_iso()
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO mail_recipients (
                    name, role, email, branch_code, region, case_types_supported, auto_route_enabled, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("name"),
                    payload.get("role"),
                    payload.get("email"),
                    payload.get("branch_code"),
                    payload.get("region"),
                    json.dumps(payload.get("case_types_supported") or []),
                    1 if payload.get("auto_route_enabled", True) else 0,
                    1 if payload.get("is_active", True) else 0,
                    now,
                    now,
                ),
            )
            conn.commit()
            return {"id": cur.lastrowid}
        finally:
            self.db_manager.close_connection(conn)

    def update_recipient(self, recipient_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE mail_recipients
                SET name = ?, role = ?, email = ?, branch_code = ?, region = ?, case_types_supported = ?,
                    auto_route_enabled = ?, is_active = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    payload.get("name"),
                    payload.get("role"),
                    payload.get("email"),
                    payload.get("branch_code"),
                    payload.get("region"),
                    json.dumps(payload.get("case_types_supported") or []),
                    1 if payload.get("auto_route_enabled", True) else 0,
                    1 if payload.get("is_active", True) else 0,
                    utcnow_iso(),
                    int(recipient_id),
                ),
            )
            conn.commit()
            return {"success": True}
        finally:
            self.db_manager.close_connection(conn)

    def list_rules(self) -> Dict[str, Any]:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM mail_routing_rules ORDER BY rule_name")
            rows = [dict(row) for row in cur.fetchall()]
            return {"rows": rows}
        finally:
            self.db_manager.close_connection(conn)

    def create_rule(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            now = utcnow_iso()
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO mail_routing_rules (
                    rule_name, recipient_role, branch_code, region, risk_score_min, pep_required, sanctions_required,
                    adverse_media_required, linked_accounts_threshold, case_type_pattern, copy_role,
                    auto_route_enabled, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("rule_name"),
                    payload.get("recipient_role"),
                    payload.get("branch_code"),
                    payload.get("region"),
                    payload.get("risk_score_min"),
                    1 if payload.get("pep_required") else 0,
                    1 if payload.get("sanctions_required") else 0,
                    1 if payload.get("adverse_media_required") else 0,
                    payload.get("linked_accounts_threshold"),
                    payload.get("case_type_pattern"),
                    payload.get("copy_role"),
                    1 if payload.get("auto_route_enabled", True) else 0,
                    1 if payload.get("is_active", True) else 0,
                    now,
                    now,
                ),
            )
            conn.commit()
            return {"id": cur.lastrowid}
        finally:
            self.db_manager.close_connection(conn)

    def list_templates(self) -> Dict[str, Any]:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM mail_templates ORDER BY template_type, template_name")
            return {"rows": [dict(row) for row in cur.fetchall()]}
        finally:
            self.db_manager.close_connection(conn)

    def create_template(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            now = utcnow_iso()
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO mail_templates (
                    template_name, template_type, subject_template, body_template, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("template_name"),
                    payload.get("template_type"),
                    payload.get("subject_template"),
                    payload.get("body_template"),
                    1 if payload.get("is_active", True) else 0,
                    now,
                    now,
                ),
            )
            conn.commit()
            return {"id": cur.lastrowid}
        finally:
            self.db_manager.close_connection(conn)

    def test_mail(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        result = self.notification_service.send_email(
            payload.get("email"),
            payload.get("subject") or "FCC Case Queue Test Mail",
            payload.get("body") or "This is a test mail from the FCC Case Queue mail configuration module.",
        )
        return result
