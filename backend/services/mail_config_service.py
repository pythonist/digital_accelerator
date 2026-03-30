import json
import uuid
from typing import Any, Dict, List, Optional

from services.case_packet_builder import CasePacketBuilder
from services.case_queue_service import CaseQueueService, ensure_case_queue_schema, utcnow_iso
from services.notification_service import NotificationService


class MailConfigService:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.queue_service = CaseQueueService(db_manager)
        self.packet_builder = CasePacketBuilder(db_manager)
        self.notification_service = NotificationService()

    def _connect(self):
        conn = self.db_manager.connect()
        conn.row_factory = __import__("sqlite3").Row
        ensure_case_queue_schema(conn)
        self.queue_service._seed_default_templates(conn)
        return conn

    def _parse_json_list(self, value: Any) -> List[str]:
        if value in (None, "", []):
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item or "").strip()]
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(item).strip() for item in parsed if str(item or "").strip()]
        except Exception:
            pass
        text = str(value or "").replace(";", ",")
        return [item.strip() for item in text.split(",") if item.strip()]

    def _recipient_payload(self, row: Dict[str, Any]) -> Dict[str, Any]:
        payload = dict(row)
        payload["case_types_supported"] = self._parse_json_list(payload.get("case_types_supported"))
        payload["distribution_list"] = self._parse_json_list(payload.get("distribution_list"))
        payload["auto_route_enabled"] = bool(payload.get("auto_route_enabled"))
        payload["is_active"] = bool(payload.get("is_active"))
        payload["recipient_type"] = str(payload.get("recipient_type") or "individual")
        payload["description"] = str(payload.get("description") or "").strip()
        return payload

    def _expand_recipient_emails(self, recipient: Dict[str, Any]) -> List[str]:
        distribution_list = self._parse_json_list(recipient.get("distribution_list"))
        if distribution_list:
            return distribution_list
        email = str(recipient.get("email") or "").strip()
        return [email] if email else []

    def _unique_emails(self, values: List[str]) -> List[str]:
        seen = set()
        emails: List[str] = []
        for value in values:
            email = str(value or "").strip()
            if not email:
                continue
            lowered = email.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            emails.append(email)
        return emails

    def _build_multi_case_rows(self, case_ids: List[str]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        for case_id in case_ids:
            queue_row = self.queue_service.get_case_queue_row(case_id)
            if not queue_row:
                rows.append({
                    "case_id": case_id,
                    "customer_id": "-",
                    "severity": "-",
                    "scenario_name": "-",
                })
                continue
            rows.append({
                "case_id": case_id,
                "customer_id": queue_row.get("customer_id") or "-",
                "severity": queue_row.get("severity") or queue_row.get("risk_rating") or "-",
                "scenario_name": queue_row.get("scenario_name") or queue_row.get("alert_type") or "-",
            })
        return rows

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
                    if search in " ".join([
                        str(row.get("name") or ""),
                        str(row.get("email") or ""),
                        str(row.get("branch_code") or ""),
                        str(row.get("region") or ""),
                        str(row.get("distribution_list") or ""),
                        str(row.get("description") or ""),
                        str(row.get("recipient_type") or ""),
                    ]).lower()
                ]
            if role:
                rows = [row for row in rows if row.get("role") == role]
            return {"rows": [self._recipient_payload(row) for row in rows]}
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
                    name, role, email, recipient_type, distribution_list, description, branch_code, region, case_types_supported, auto_route_enabled, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.get("name"),
                    payload.get("role"),
                    payload.get("email"),
                    payload.get("recipient_type") or "individual",
                    json.dumps(payload.get("distribution_list") or []),
                    payload.get("description"),
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

    def delete_recipient(self, recipient_id: int) -> Dict[str, Any]:
        conn = self._connect()
        try:
            conn.execute("DELETE FROM mail_recipients WHERE id = ?", (int(recipient_id),))
            conn.commit()
            return {"success": True}
        finally:
            self.db_manager.close_connection(conn)

    def update_recipient(self, recipient_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE mail_recipients
                SET name = ?, role = ?, email = ?, recipient_type = ?, distribution_list = ?, description = ?, branch_code = ?, region = ?, case_types_supported = ?,
                    auto_route_enabled = ?, is_active = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    payload.get("name"),
                    payload.get("role"),
                    payload.get("email"),
                    payload.get("recipient_type") or "individual",
                    json.dumps(payload.get("distribution_list") or []),
                    payload.get("description"),
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

    def _resolve_recipient_rows(
        self,
        conn,
        *,
        recipient_ids: Optional[List[Any]] = None,
        recipient_id: Optional[Any] = None,
        email: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        selected_ids = [int(value) for value in (recipient_ids or []) if str(value or "").strip()]
        if recipient_id not in (None, ""):
            try:
                selected_ids.append(int(recipient_id))
            except Exception:
                pass
        selected_ids = sorted(set(selected_ids))
        cur = conn.cursor()
        if selected_ids:
            placeholders = ",".join("?" for _ in selected_ids)
            cur.execute(
                f"SELECT * FROM mail_recipients WHERE id IN ({placeholders}) ORDER BY role, name",
                selected_ids,
            )
            return [self._recipient_payload(dict(row)) for row in cur.fetchall()]
        if email:
            return [{
                "id": None,
                "name": str(email).split("@")[0],
                "role": "Ad hoc",
                "email": str(email),
                "recipient_type": "individual",
                "distribution_list": [],
            }]
        return []

    def _build_mail_metadata(
        self,
        case_id: Optional[str],
        batch_ref: Optional[str],
        body: str,
        case_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        metadata: Dict[str, Any] = {
            "workflow": "FCIP Investigation Workbench",
            "summary": "",
            "case_details": {},
            "sections": [],
            "case_rows": [],
        }
        normalized_case_ids = [str(item).strip() for item in (case_ids or []) if str(item or "").strip()]
        case_text = str(case_id or "").strip()
        if not case_text and len(normalized_case_ids) == 1:
            case_text = normalized_case_ids[0]
        if len(normalized_case_ids) > 1:
            metadata["summary"] = f"Manual FCIP mail prepared for {len(normalized_case_ids)} selected cases."
            metadata["case_details"] = {
                "Case Count": len(normalized_case_ids),
                "Batch Ref": batch_ref or "-",
            }
            metadata["case_rows"] = self._build_multi_case_rows(normalized_case_ids)
            if body:
                metadata["sections"].append({
                    "title": "Analyst Message",
                    "body": body,
                })
            return metadata
        if not case_text:
            if batch_ref:
                metadata["summary"] = f"Manual FCIP mail prepared for batch reference {batch_ref}."
            return metadata

        queue_row = self.queue_service.get_case_queue_row(case_text)
        if not queue_row:
            metadata["summary"] = f"Manual FCIP mail prepared for case {case_text}."
            metadata["case_details"] = {"Case ID": case_text, "Batch Ref": batch_ref or "-"}
            return metadata

        packet = self.packet_builder.build_case_summary(case_text, queue_row)
        mail_context = packet.get("mail_context") or {}
        resolution = packet.get("resolution_workspace") or {}
        metadata["summary"] = str(
            mail_context.get("why_review_needed")
            or packet.get("alert_summary", {}).get("why_generated")
            or f"Case {case_text} is being shared from FCIP for further review."
        )
        metadata["case_details"] = {
            "Case ID": case_text,
            "Customer ID": mail_context.get("customer_id") or "-",
            "Account ID": mail_context.get("account_id") or "-",
            "Severity": mail_context.get("severity") or "-",
            "Scenario": mail_context.get("scenario_name") or "-",
            "SLA Due": mail_context.get("sla_due_at") or "-",
        }
        metadata["sections"] = [
            {
                "title": "Investigation Explanation",
                "body": metadata["summary"],
            },
            {
                "title": "Transaction Context",
                "body": str(mail_context.get("transaction_summary") or "Transaction summary is not yet available for this case."),
            },
        ]
        sar_excerpt = str(
            resolution.get("accepted_sar_draft")
            or resolution.get("sar_excerpt")
            or resolution.get("sar_draft")
            or ""
        ).strip()
        if sar_excerpt:
            metadata["sections"].append({
                "title": "Potential SAR Narrative",
                "body": sar_excerpt[:1200],
            })
        elif body:
            metadata["sections"].append({
                "title": "Analyst Message",
                "body": body,
            })
        return metadata

    def list_mailbox(self, filters: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        filters = filters or {}
        conn = self._connect()
        try:
            cur = conn.cursor()
            mailbox_rows: List[Dict[str, Any]] = []

            cur.execute("SELECT * FROM case_escalations ORDER BY sent_at DESC")
            for row in cur.fetchall():
                item = dict(row)
                mailbox_rows.append({
                    "id": f"routing-{item.get('id')}",
                    "direction": "sent",
                    "source": "routing",
                    "case_id": item.get("case_id"),
                    "batch_ref": item.get("batch_ref"),
                    "sender_email": self.notification_service.smtp_sender,
                    "recipient_emails": item.get("recipient_email"),
                    "cc_emails": item.get("cc_emails"),
                    "subject": item.get("subject"),
                    "body_snapshot": item.get("body_snapshot"),
                    "mail_status": item.get("status") or "queued",
                    "created_at": item.get("sent_at"),
                    "thread_ref": item.get("batch_ref") or item.get("case_id"),
                    "recipient_role": item.get("recipient_role"),
                })

            cur.execute("SELECT * FROM mail_inbox_messages ORDER BY created_at DESC")
            for row in cur.fetchall():
                item = dict(row)
                mailbox_rows.append({
                    "id": f"mailbox-{item.get('id')}",
                    "direction": item.get("direction") or "received",
                    "source": "mailbox",
                    "case_id": item.get("case_id"),
                    "batch_ref": item.get("batch_ref"),
                    "sender_email": item.get("sender_email"),
                    "recipient_emails": item.get("recipient_emails"),
                    "cc_emails": item.get("cc_emails"),
                    "subject": item.get("subject"),
                    "body_snapshot": item.get("body_snapshot"),
                    "mail_status": item.get("mail_status") or "received",
                    "created_at": item.get("created_at"),
                    "thread_ref": item.get("thread_ref"),
                    "recipient_role": None,
                })

            direction = str(filters.get("direction") or "").strip().lower()
            search = str(filters.get("search") or "").strip().lower()
            if direction:
                mailbox_rows = [row for row in mailbox_rows if str(row.get("direction") or "").lower() == direction]
            if search:
                mailbox_rows = [
                    row for row in mailbox_rows
                    if search in " ".join([
                        str(row.get("case_id") or ""),
                        str(row.get("batch_ref") or ""),
                        str(row.get("sender_email") or ""),
                        str(row.get("recipient_emails") or ""),
                        str(row.get("cc_emails") or ""),
                        str(row.get("subject") or ""),
                        str(row.get("body_snapshot") or ""),
                    ]).lower()
                ]
            mailbox_rows.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
            return {"rows": mailbox_rows}
        finally:
            self.db_manager.close_connection(conn)

    def send_mail(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            to_recipients = self._resolve_recipient_rows(
                conn,
                recipient_ids=payload.get("to_recipient_ids") or payload.get("recipient_ids") or [],
                recipient_id=payload.get("to_recipient_id") or payload.get("recipient_id"),
                email=payload.get("email"),
            )
            cc_recipients = self._resolve_recipient_rows(
                conn,
                recipient_ids=payload.get("cc_recipient_ids") or [],
                recipient_id=payload.get("cc_recipient_id"),
            )
            if not to_recipients:
                raise ValueError("Select at least one primary recipient.")

            subject = str(payload.get("subject") or "FCC Sentinel Mail").strip()
            body = str(payload.get("body") or "").strip()
            if not subject or not body:
                raise ValueError("Subject and body are required.")

            case_id = str(payload.get("case_id") or "").strip() or None
            case_ids = [str(item).strip() for item in (payload.get("case_ids") or []) if str(item or "").strip()]
            batch_ref = str(payload.get("batch_ref") or "").strip() or None
            if len(case_ids) > 1 and not batch_ref:
                batch_ref = f"MAIL-{uuid.uuid4().hex[:8].upper()}"
            thread_ref = str(payload.get("thread_ref") or case_id or batch_ref or f"THREAD-{uuid.uuid4().hex[:8]}").strip()
            now = utcnow_iso()
            to_emails = self._unique_emails([
                email
                for recipient in to_recipients
                for email in self._expand_recipient_emails(recipient)
            ])
            cc_emails = self._unique_emails([
                email
                for recipient in cc_recipients
                for email in self._expand_recipient_emails(recipient)
            ])
            send_result = self.notification_service.send_email(
                to_emails,
                subject,
                body,
                metadata=self._build_mail_metadata(case_id, batch_ref, body, case_ids=case_ids),
                cc_emails=cc_emails,
            )
            for email in to_emails:
                conn.execute(
                    """
                    INSERT INTO mail_logs (case_id, batch_ref, recipient_email, delivery_role, subject, send_status, error_message, sent_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        case_id,
                        batch_ref,
                        email,
                        "to",
                        subject,
                        send_result.get("status") or "queued",
                        send_result.get("error") or "",
                        now,
                    ),
                )
            for email in cc_emails:
                conn.execute(
                    """
                    INSERT INTO mail_logs (case_id, batch_ref, recipient_email, delivery_role, subject, send_status, error_message, sent_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        case_id,
                        batch_ref,
                        email,
                        "cc",
                        subject,
                        send_result.get("status") or "queued",
                        send_result.get("error") or "",
                        now,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO mail_inbox_messages (
                        direction, case_id, batch_ref, sender_email, recipient_emails, cc_emails, subject, body_snapshot,
                        mail_status, created_at, thread_ref
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "sent",
                        case_id,
                        batch_ref,
                        self.notification_service.smtp_sender,
                        ", ".join(to_emails),
                        ", ".join(cc_emails),
                        subject,
                        body,
                        send_result.get("status") or "queued",
                        now,
                        thread_ref,
                    ),
                )
            conn.commit()
            return {
                "status": "processed",
                "thread_ref": thread_ref,
                "to_recipients": to_recipients,
                "cc_recipients": cc_recipients,
                "to_emails": to_emails,
                "cc_emails": cc_emails,
                "result": send_result,
            }
        finally:
            self.db_manager.close_connection(conn)

    def record_reply(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            sender_email = str(payload.get("sender_email") or "").strip()
            subject = str(payload.get("subject") or "").strip()
            body = str(payload.get("body") or "").strip()
            if not sender_email or not subject or not body:
                raise ValueError("Sender email, subject, and reply body are required.")
            conn.execute(
                """
                INSERT INTO mail_inbox_messages (
                    direction, case_id, batch_ref, sender_email, recipient_emails, cc_emails, subject, body_snapshot,
                    mail_status, created_at, thread_ref
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "received",
                    str(payload.get("case_id") or "").strip() or None,
                    str(payload.get("batch_ref") or "").strip() or None,
                    sender_email,
                    self.notification_service.smtp_sender,
                    None,
                    subject,
                    body,
                    "received",
                    utcnow_iso(),
                    str(payload.get("thread_ref") or payload.get("case_id") or payload.get("batch_ref") or f"THREAD-{uuid.uuid4().hex[:8]}").strip(),
                ),
            )
            conn.commit()
            return {"success": True}
        finally:
            self.db_manager.close_connection(conn)

    def test_mail(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            recipients = self._resolve_recipient_rows(
                conn,
                recipient_ids=payload.get("recipient_ids") or [],
                recipient_id=payload.get("recipient_id"),
                email=payload.get("email"),
            )
            if not recipients:
                raise ValueError("Select a saved recipient before sending a test mail.")
            subject = payload.get("subject") or "FCC Case Queue Test Mail"
            body = payload.get("body") or "This is a test mail from the FCC Case Queue mail configuration module."
            primary = recipients[0]
            result = self.notification_service.send_email(
                self._expand_recipient_emails(primary),
                subject,
                body,
                metadata={
                    "workflow": "FCIP Investigation Workbench",
                    "summary": "Test communication from FCIP Mail. Use this to verify sender configuration, recipient routing, and branded email rendering.",
                    "sections": [
                        {
                            "title": "Why You Received This",
                            "body": "This is a controlled FCIP mail test to validate SMTP delivery, sender identity, and mailbox rendering before using operational escalation workflows.",
                        }
                    ],
                },
            )
            conn.execute(
                """
                INSERT INTO mail_inbox_messages (
                    direction, case_id, batch_ref, sender_email, recipient_emails, cc_emails, subject, body_snapshot,
                    mail_status, created_at, thread_ref
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "sent",
                    None,
                    None,
                    self.notification_service.smtp_sender,
                    ", ".join(self._expand_recipient_emails(primary)),
                    None,
                    subject,
                    body,
                    result.get("status") or "queued",
                    utcnow_iso(),
                    f"TEST-{uuid.uuid4().hex[:8]}",
                ),
            )
            conn.commit()
            return result
        finally:
            self.db_manager.close_connection(conn)
