import json
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

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

    def _expand_recipient_emails(self, recipient: Dict[str, Any]) -> List[str]:
        distribution_list = self._parse_json_list(recipient.get("distribution_list"))
        if distribution_list:
            return distribution_list
        email = str(recipient.get("email") or "").strip()
        return [email] if email else []

    def _unique_emails(self, values: List[str]) -> List[str]:
        seen = set()
        normalized: List[str] = []
        for value in values:
            email = str(value or "").strip()
            if not email:
                continue
            lowered = email.lower()
            if lowered in seen:
                continue
            seen.add(lowered)
            normalized.append(email)
        return normalized

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

    def _resolve_copy_role(self, conn, queue_row: Dict[str, Any], target_role: str, explicit_copy_role: Optional[str] = None) -> Optional[str]:
        explicit = str(explicit_copy_role or "").strip()
        if explicit:
            return explicit
        for rule in self._resolve_routing_rules(conn, queue_row):
            if str(rule.get("recipient_role") or "").strip() == str(target_role or "").strip():
                copy_role = str(rule.get("copy_role") or "").strip()
                if copy_role:
                    return copy_role
        return None

    def _render_template(self, template: Dict[str, Any], context: Dict[str, Any]) -> Tuple[str, str]:
        subject = str(template.get("subject_template") or "").format(**context)
        body = str(template.get("body_template") or "").format(**context)
        return subject, body

    def _build_mail_metadata(
        self,
        *,
        case_id: Optional[str] = None,
        queue_row: Optional[Dict[str, Any]] = None,
        packet: Optional[Dict[str, Any]] = None,
        batch_ref: Optional[str] = None,
        case_rows: Optional[List[Dict[str, Any]]] = None,
        summary: Optional[str] = None,
    ) -> Dict[str, Any]:
        metadata: Dict[str, Any] = {
            "workflow": "FCIP Investigation Workbench",
            "summary": summary or "",
            "case_details": {},
            "sections": [],
            "case_rows": case_rows or [],
        }
        if case_id and queue_row and packet:
            mail_context = packet.get("mail_context") or {}
            resolution = packet.get("resolution_workspace") or {}
            metadata["summary"] = metadata["summary"] or str(
                mail_context.get("why_review_needed")
                or packet.get("alert_summary", {}).get("why_generated")
                or f"Case {case_id} is being escalated for additional review in FCIP."
            )
            metadata["case_details"] = {
                "Case ID": case_id,
                "Customer ID": mail_context.get("customer_id") or "-",
                "Account ID": mail_context.get("account_id") or "-",
                "Severity": mail_context.get("severity") or "-",
                "Scenario": mail_context.get("scenario_name") or "-",
                "SLA Due": mail_context.get("sla_due_at") or "-",
            }
            metadata["sections"].append({
                "title": "Investigation Explanation",
                "body": metadata["summary"],
            })
            metadata["sections"].append({
                "title": "Transaction Context",
                "body": str(mail_context.get("transaction_summary") or "Transaction summary is not yet available for this case."),
            })
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
        elif batch_ref and not metadata["summary"]:
            metadata["summary"] = f"Batch escalation prepared in FCIP under reference {batch_ref}."
        return metadata

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
            copy_role = self._resolve_copy_role(conn, queue_row, target_role, payload.get("copy_role"))
            cc_recipients = self._resolve_recipients(conn, queue_row, copy_role) if copy_role else []
            packet = self.packet_builder.build_case_summary(case_id, queue_row)
            context = {
                **packet.get("mail_context", {}),
                "analyst_comment": payload.get("analyst_comment") or "",
                "escalation_reason": payload.get("escalation_reason") or "Further review required",
            }
            subject, body = self._render_template(template, context)
            recipient_emails = self._unique_emails([
                email
                for recipient in recipients
                for email in self._expand_recipient_emails(recipient)
            ])
            if not recipient_emails:
                raise ValueError(f"No routable primary recipient was found for case {case_id}.")
            cc_emails = self._unique_emails([
                email
                for recipient in cc_recipients
                for email in self._expand_recipient_emails(recipient)
            ])
            return {
                "case_id": case_id,
                "target_role": target_role,
                "recipients": recipients,
                "recipient_emails": recipient_emails,
                "copy_role": copy_role,
                "cc_recipients": cc_recipients,
                "cc_emails": cc_emails,
                "subject": subject,
                "body": body,
                "mail_metadata": self._build_mail_metadata(
                    case_id=case_id,
                    queue_row=queue_row,
                    packet=packet,
                    summary=f"Escalation prepared for {target_role} review from the FCIP case-resolution workflow.",
                ),
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
                copy_role = self._resolve_copy_role(conn, queue_row, target_role, payload.get("copy_role"))
                cc_recipients = self._resolve_recipients(conn, queue_row, copy_role) if copy_role else []
                to_emails = self._unique_emails([email for recipient in recipients for email in self._expand_recipient_emails(recipient)])
                cc_emails = self._unique_emails([email for recipient in cc_recipients for email in self._expand_recipient_emails(recipient)])
                if not to_emails:
                    warnings.append(f"No routable email addresses were found for case {case_id}.")
                    continue
                key = "|".join(to_emails + ["cc"] + cc_emails) if group_mode == "grouped" else f"{'|'.join(to_emails)}::{case_id}"
                grouped.setdefault(key, {
                    "recipients": recipients,
                    "recipient_emails": to_emails,
                    "cc_recipients": cc_recipients,
                    "cc_emails": cc_emails,
                    "copy_role": copy_role,
                    "cases": [],
                })["cases"].append((case_id, queue_row))

            previews = []
            for group in grouped.values():
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
                    "recipient": group["recipients"][0] if group["recipients"] else None,
                    "recipients": group["recipients"],
                    "recipient_emails": group["recipient_emails"],
                    "copy_role": group["copy_role"],
                    "cc_recipients": group["cc_recipients"],
                    "cc_emails": group["cc_emails"],
                    "target_role": target_role,
                    "case_count": len(group["cases"]),
                    "case_ids": [case_id for case_id, _ in group["cases"]],
                    "subject": subject,
                    "body": "\n\n".join(lines),
                    "mail_metadata": self._build_mail_metadata(
                        batch_ref="preview",
                        case_rows=compact_rows,
                        summary=f"{len(group['cases'])} cases are grouped for {target_role} review from the FCIP escalation workflow.",
                    ),
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
            send_result = self.notification_service.send_email(
                preview.get("recipient_emails") or [],
                preview["subject"],
                preview["body"],
                metadata=preview.get("mail_metadata"),
                cc_emails=preview.get("cc_emails") or [],
            )
            self.audit_service.record_escalation(
                conn,
                case_id=case_id,
                batch_ref=None,
                escalation_type="Single",
                escalation_level=int(queue_row.get("escalation_level") or 1),
                recipient_role=preview["target_role"],
                recipient_email=", ".join(preview.get("recipient_emails") or []),
                subject=preview["subject"],
                body_snapshot=preview["body"],
                status=send_result.get("status") or "queued",
                sent_by=self.username,
                cc_emails=", ".join(preview.get("cc_emails") or []),
                remarks=remarks,
            )
            for email in preview.get("recipient_emails") or []:
                self.audit_service.record_mail_log(
                    conn,
                    case_id=case_id,
                    batch_ref=None,
                    recipient_email=email,
                    subject=preview["subject"],
                    send_status=send_result.get("status") or "queued",
                    error_message=send_result.get("error") or "",
                    delivery_role="to",
                )
            for email in preview.get("cc_emails") or []:
                self.audit_service.record_mail_log(
                    conn,
                    case_id=case_id,
                    batch_ref=None,
                    recipient_email=email,
                    subject=preview["subject"],
                    send_status=send_result.get("status") or "queued",
                    error_message=send_result.get("error") or "",
                    delivery_role="cc",
                )
            result_logs.append({
                "recipients": preview.get("recipients") or [],
                "recipient_emails": preview.get("recipient_emails") or [],
                "cc_recipients": preview.get("cc_recipients") or [],
                "cc_emails": preview.get("cc_emails") or [],
                "result": send_result,
            })

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
                copy_role = self._resolve_copy_role(conn, queue_row, target_role, payload.get("copy_role"))
                cc_recipients = self._resolve_recipients(conn, queue_row, copy_role) if copy_role else []
                to_emails = self._unique_emails([email for recipient in recipients for email in self._expand_recipient_emails(recipient)])
                cc_emails = self._unique_emails([email for recipient in cc_recipients for email in self._expand_recipient_emails(recipient)])
                if not to_emails:
                    warnings.append(f"No routable email addresses were found for case {case_id}.")
                    continue
                key = "|".join(to_emails + ["cc"] + cc_emails) if group_mode == "grouped" else f"{'|'.join(to_emails)}::{case_id}"
                grouped.setdefault(key, {
                    "recipients": recipients,
                    "recipient_emails": to_emails,
                    "cc_recipients": cc_recipients,
                    "cc_emails": cc_emails,
                    "copy_role": copy_role,
                    "cases": [],
                })["cases"].append((case_id, queue_row))

            conn.execute(
                """
                INSERT INTO escalation_batches (batch_ref, total_cases, recipient_group, created_by, created_at, mail_status)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (batch_ref, len(case_ids), target_role, self.username, utcnow_iso(), "Queued"),
            )

            summary_logs = []
            for group in grouped.values():
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
                    })
                subject = (
                    f"FCC Escalation Required | {len(group['cases'])} Cases | {target_role} Review Pending"
                    if len(group["cases"]) > 1 else
                    f"FCC Escalation Required | Case {group['cases'][0][0]} | {target_role}"
                )
                body = "\n\n".join(lines)
                send_result = self.notification_service.send_email(
                    group.get("recipient_emails") or [],
                    subject,
                    body,
                    metadata=self._build_mail_metadata(
                        batch_ref=batch_ref,
                        case_rows=compact_rows,
                        summary=f"{len(group['cases'])} cases are being escalated to {target_role} from FCIP for additional review.",
                    ),
                    cc_emails=group.get("cc_emails") or [],
                )
                for email in group.get("recipient_emails") or []:
                    self.audit_service.record_mail_log(conn, None, batch_ref, email, subject, send_result.get("status") or "queued", send_result.get("error") or "", "to")
                for email in group.get("cc_emails") or []:
                    self.audit_service.record_mail_log(conn, None, batch_ref, email, subject, send_result.get("status") or "queued", send_result.get("error") or "", "cc")

                for case_id, queue_row in group["cases"]:
                    self.audit_service.record_escalation(
                        conn,
                        case_id=case_id,
                        batch_ref=batch_ref,
                        escalation_type="Batch",
                        escalation_level=int(queue_row.get("escalation_level") or 1),
                        recipient_role=target_role,
                        recipient_email=", ".join(group.get("recipient_emails") or []),
                        subject=subject,
                        body_snapshot=body,
                        status=send_result.get("status") or "queued",
                        sent_by=self.username,
                        cc_emails=", ".join(group.get("cc_emails") or []),
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
                summary_logs.append({
                    "recipients": group.get("recipients") or [],
                    "recipient_emails": group.get("recipient_emails") or [],
                    "cc_recipients": group.get("cc_recipients") or [],
                    "cc_emails": group.get("cc_emails") or [],
                    "case_count": len(group["cases"]),
                    "result": send_result,
                })

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
