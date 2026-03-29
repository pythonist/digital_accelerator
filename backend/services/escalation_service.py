import json
import re
import uuid
from typing import Any, Dict, List, Tuple

from services.audit_log_service import AuditLogService
from services.case_packet_builder import CasePacketBuilder
from services.case_queue_service import CaseQueueService, REVIEW_REQUIRED_STATUSES, ensure_case_queue_schema, utcnow_iso
from services.notification_service import NotificationService


class EscalationService:
    def __init__(self, db_manager, username: str = "system"):
        self.db_manager = db_manager
        self.username = username or "system"
        self.queue_service = CaseQueueService(db_manager, username=username)
        self.packet_builder = CasePacketBuilder(db_manager)
        self.audit_service = AuditLogService()
        self.notification_service = NotificationService()

    def _connect(self):
        conn = self.db_manager.connect()
        conn.row_factory = __import__("sqlite3").Row
        ensure_case_queue_schema(conn)
        self.queue_service._seed_default_templates(conn)
        return conn

    def _resolve_template(self, conn, template_type: str):
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM mail_templates WHERE template_type = ? AND is_active = 1 ORDER BY id LIMIT 1",
            (template_type,),
        )
        row = cur.fetchone()
        return dict(row) if row else None

    def _resolve_recipients(self, conn, queue_row: Dict[str, Any], target_role: str) -> List[Dict[str, Any]]:
        cur = conn.cursor()
        cur.execute("SELECT * FROM mail_recipients WHERE role = ? AND is_active = 1 ORDER BY auto_route_enabled DESC, id", (target_role,))
        recipients = [dict(row) for row in cur.fetchall()]
        if not recipients:
            return []

        branch = str(queue_row.get("branch_code") or "").strip().lower()
        region = str(queue_row.get("region") or "").strip().lower()
        branch_matches = [row for row in recipients if branch and str(row.get("branch_code") or "").strip().lower() == branch]
        if branch_matches:
            return branch_matches
        region_matches = [row for row in recipients if region and str(row.get("region") or "").strip().lower() == region]
        if region_matches:
            return region_matches
        return recipients[:1]

    def _resolve_routing_rules(self, conn, queue_row: Dict[str, Any]) -> List[Dict[str, Any]]:
        cur = conn.cursor()
        cur.execute("SELECT * FROM mail_routing_rules WHERE is_active = 1 AND auto_route_enabled = 1 ORDER BY id")
        rows = [dict(row) for row in cur.fetchall()]
        matched = []
        scenario_name = str(queue_row.get("scenario_name") or "").lower()
        branch = str(queue_row.get("branch_code") or "").lower()
        region = str(queue_row.get("region") or "").lower()
        risk_score = float(queue_row.get("risk_score") or 0.0)
        for row in rows:
            if row.get("branch_code") and str(row.get("branch_code")).lower() != branch:
                continue
            if row.get("region") and str(row.get("region")).lower() != region:
                continue
            if row.get("risk_score_min") is not None and risk_score < float(row.get("risk_score_min") or 0.0):
                continue
            pattern = str(row.get("case_type_pattern") or "").strip()
            if pattern and not re.search(pattern, scenario_name, re.IGNORECASE):
                continue
            matched.append(row)
        return matched

    def _render_template(self, template: Dict[str, Any], context: Dict[str, Any]) -> Tuple[str, str]:
        subject = str(template.get("subject_template") or "").format(**context)
        body = str(template.get("body_template") or "").format(**context)
        return subject, body

    def _apply_status_for_target(self, target_role: str) -> str:
        mapping = {
            "L2 Reviewer": "Pending L2 Review",
            "Branch Manager": "Pending BM Review",
            "Vigilance Officer": "Pending Vigilance Review",
            "Compliance SPOC": "Escalated",
            "Regional Head": "Escalated",
        }
        return mapping.get(target_role, "Escalated")

    def preview_single(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            case_id = str(payload.get("case_id") or "")
            queue_row = self.queue_service.get_case_queue_row(case_id)
            if not queue_row:
                raise ValueError(f"Case {case_id} not found.")

            target_role = payload.get("target_role") or "L2 Reviewer"
            template = self._resolve_template(conn, payload.get("template_type") or target_role)
            if not template:
                raise ValueError(f"No active template found for {target_role}.")

            recipients = self._resolve_recipients(conn, queue_row, target_role)
            packet = self.packet_builder.build_case_summary(case_id, queue_row)
            context = {
                **packet.get("mail_context", {}),
                "analyst_comment": payload.get("analyst_comment") or "",
                "escalation_reason": payload.get("escalation_reason") or "Further review required",
            }
            subject, body = self._render_template(template, context)
            return {
                "case_id": case_id,
                "target_role": target_role,
                "recipients": recipients,
                "subject": subject,
                "body": body,
                "status_after_send": self._apply_status_for_target(target_role),
            }
        finally:
            self.db_manager.close_connection(conn)

    def preview_batch(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        case_ids = [str(item) for item in (payload.get("case_ids") or []) if str(item).strip()]
        if len(case_ids) < 1:
            raise ValueError("At least one case is required.")

        target_role = payload.get("target_role") or "L2 Reviewer"
        group_mode = payload.get("mail_mode") or "grouped"

        conn = self._connect()
        try:
            grouped = {}
            warnings = []
            for case_id in case_ids:
                queue_row = self.queue_service.get_case_queue_row(case_id)
                if not queue_row:
                    warnings.append(f"Case {case_id} is missing from queue.")
                    continue
                recipients = self._resolve_recipients(conn, queue_row, target_role)
                if not recipients:
                    warnings.append(f"No active recipient mapping for case {case_id}.")
                    continue
                if len(recipients) > 1:
                    warnings.append(f"Multiple recipients matched for case {case_id}; first active recipient used.")
                recipient = recipients[0]
                key = recipient.get("email") if group_mode == "grouped" else f"{recipient.get('email')}::{case_id}"
                grouped.setdefault(key, {"recipient": recipient, "cases": []})["cases"].append((case_id, queue_row))

            previews = []
            for group in grouped.values():
                recipient = group["recipient"]
                lines = []
                compact_rows = []
                for case_id, queue_row in group["cases"]:
                    packet = self.packet_builder.build_case_summary(case_id, queue_row)
                    context = packet.get("mail_context", {})
                    lines.append(
                        f"Case {case_id} | Customer {context.get('customer_id')} | Account {context.get('account_id')} | "
                        f"Severity {context.get('severity')} | Scenario {context.get('scenario_name')} | "
                        f"Reason {context.get('why_review_needed')}"
                    )
                    compact_rows.append({
                        "case_id": case_id,
                        "customer_id": context.get("customer_id"),
                        "account_id": context.get("account_id"),
                        "severity": context.get("severity"),
                        "scenario_name": context.get("scenario_name"),
                        "why_review_needed": context.get("why_review_needed"),
                    })

                subject = (
                    f"FCC Escalation Required | {len(group['cases'])} Cases | {target_role} Review Pending"
                    if len(group["cases"]) > 1 else
                    f"FCC Escalation Required | Case {group['cases'][0][0]} | {target_role}"
                )
                previews.append({
                    "recipient": recipient,
                    "target_role": target_role,
                    "case_count": len(group["cases"]),
                    "case_ids": [case_id for case_id, _ in group["cases"]],
                    "subject": subject,
                    "body": "\n\n".join(lines),
                    "status_after_send": self._apply_status_for_target(target_role),
                    "cases": compact_rows,
                })

            return {
                "target_role": target_role,
                "mail_mode": group_mode,
                "previews": previews,
                "warnings": warnings,
            }
        finally:
            self.db_manager.close_connection(conn)

    def escalate_single(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        preview = self.preview_single(payload)
        conn = self._connect()
        try:
            case_id = preview["case_id"]
            remarks = payload.get("analyst_comment") or payload.get("remarks") or ""
            queue_row = self.queue_service.get_case_queue_row(case_id)
            result_logs = []
            for recipient in preview["recipients"]:
                send_result = self.notification_service.send_email(recipient.get("email"), preview["subject"], preview["body"])
                self.audit_service.record_escalation(
                    conn,
                    case_id=case_id,
                    batch_ref=None,
                    escalation_type="Single",
                    escalation_level=int(queue_row.get("escalation_level") or 1),
                    recipient_role=preview["target_role"],
                    recipient_email=recipient.get("email"),
                    subject=preview["subject"],
                    body_snapshot=preview["body"],
                    status=send_result.get("status") or "queued",
                    sent_by=self.username,
                    remarks=remarks,
                )
                self.audit_service.record_mail_log(
                    conn,
                    case_id=case_id,
                    batch_ref=None,
                    recipient_email=recipient.get("email"),
                    subject=preview["subject"],
                    send_status=send_result.get("status") or "queued",
                    error_message=send_result.get("error") or "",
                )
                result_logs.append({"recipient": recipient, "result": send_result})

            self.audit_service.record_status_change(
                conn,
                case_id,
                queue_row.get("current_status"),
                preview["status_after_send"],
                self.username,
                remarks or f"Escalated to {preview['target_role']}",
            )
            conn.execute(
                """
                UPDATE case_queue
                SET current_status = ?, current_stage = ?, escalated_to = ?, last_updated_at = ?
                WHERE case_id = ?
                """,
                (preview["status_after_send"], "Escalation", preview["target_role"], utcnow_iso(), case_id),
            )
            conn.commit()
            return {
                "case_id": case_id,
                "status": preview["status_after_send"],
                "logs": result_logs,
            }
        finally:
            self.db_manager.close_connection(conn)

    def escalate_batch(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        case_ids = [str(item) for item in (payload.get("case_ids") or []) if str(item).strip()]
        if len(case_ids) < 1:
            raise ValueError("At least one case is required.")

        target_role = payload.get("target_role") or "L2 Reviewer"
        group_mode = payload.get("mail_mode") or "grouped"
        batch_ref = f"BATCH-{uuid.uuid4().hex[:8].upper()}"

        conn = self._connect()
        try:
            grouped = {}
            warnings = []
            for case_id in case_ids:
                queue_row = self.queue_service.get_case_queue_row(case_id)
                if not queue_row:
                    warnings.append(f"Case {case_id} is missing from queue.")
                    continue
                recipients = self._resolve_recipients(conn, queue_row, target_role)
                if not recipients:
                    warnings.append(f"No active recipient mapping for case {case_id}.")
                    continue
                if len(recipients) > 1:
                    warnings.append(f"Multiple recipients matched for case {case_id}; first active recipient used.")
                recipient = recipients[0]
                key = recipient.get("email") if group_mode == "grouped" else f"{recipient.get('email')}::{case_id}"
                grouped.setdefault(key, {"recipient": recipient, "cases": []})["cases"].append((case_id, queue_row))

            conn.execute(
                """
                INSERT INTO escalation_batches (batch_ref, total_cases, recipient_group, created_by, created_at, mail_status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (batch_ref, len(case_ids), target_role, self.username, utcnow_iso(), "Queued"),
            )

            summary_logs = []
            for group in grouped.values():
                recipient = group["recipient"]
                lines = []
                for case_id, queue_row in group["cases"]:
                    packet = self.packet_builder.build_case_summary(case_id, queue_row)
                    context = packet.get("mail_context", {})
                    lines.append(
                        f"Case {case_id} | Customer {context.get('customer_id')} | Account {context.get('account_id')} | "
                        f"Severity {context.get('severity')} | Scenario {context.get('scenario_name')} | "
                        f"Reason {context.get('why_review_needed')}"
                    )
                subject = (
                    f"FCC Escalation Required | {len(group['cases'])} Cases | {target_role} Review Pending"
                    if len(group["cases"]) > 1 else
                    f"FCC Escalation Required | Case {group['cases'][0][0]} | {target_role}"
                )
                body = "\n\n".join(lines)
                send_result = self.notification_service.send_email(recipient.get("email"), subject, body)
                self.audit_service.record_mail_log(conn, None, batch_ref, recipient.get("email"), subject, send_result.get("status") or "queued", send_result.get("error") or "")

                for case_id, queue_row in group["cases"]:
                    self.audit_service.record_escalation(
                        conn,
                        case_id=case_id,
                        batch_ref=batch_ref,
                        escalation_type="Batch",
                        escalation_level=int(queue_row.get("escalation_level") or 1),
                        recipient_role=target_role,
                        recipient_email=recipient.get("email"),
                        subject=subject,
                        body_snapshot=body,
                        status=send_result.get("status") or "queued",
                        sent_by=self.username,
                        remarks=payload.get("analyst_comment") or "",
                    )
                    self.audit_service.record_status_change(conn, case_id, queue_row.get("current_status"), self._apply_status_for_target(target_role), self.username, payload.get("analyst_comment") or "")
                    conn.execute(
                        """
                        UPDATE case_queue
                        SET current_status = ?, current_stage = ?, escalated_to = ?, last_updated_at = ?
                        WHERE case_id = ?
                        """,
                        (self._apply_status_for_target(target_role), "Escalation", target_role, utcnow_iso(), case_id),
                    )
                summary_logs.append({"recipient": recipient, "case_count": len(group["cases"]), "result": send_result})

            conn.execute("UPDATE escalation_batches SET mail_status = ? WHERE batch_ref = ?", ("Processed", batch_ref))
            conn.commit()
            return {
                "batch_ref": batch_ref,
                "groups": summary_logs,
                "warnings": warnings,
            }
        finally:
            self.db_manager.close_connection(conn)

    def get_history(self, filters: Dict[str, Any]) -> Dict[str, Any]:
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute("SELECT * FROM case_escalations ORDER BY sent_at DESC")
            rows = [dict(row) for row in cur.fetchall()]
            case_id = str(filters.get("case_id") or "").strip().lower()
            recipient_role = str(filters.get("recipient_role") or "").strip()
            mail_status = str(filters.get("mail_status") or "").strip().lower()
            if case_id:
                rows = [row for row in rows if case_id in str(row.get("case_id") or row.get("batch_ref") or "").lower()]
            if recipient_role:
                rows = [row for row in rows if row.get("recipient_role") == recipient_role]
            if mail_status:
                rows = [row for row in rows if mail_status in str(row.get("status") or "").lower()]
            return {"rows": rows}
        finally:
            self.db_manager.close_connection(conn)
