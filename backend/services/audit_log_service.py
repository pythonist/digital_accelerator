from typing import Optional

from services.case_queue_service import utcnow_iso


class AuditLogService:
    def record_status_change(self, conn, case_id: str, old_status: Optional[str], new_status: str, changed_by: str, remarks: str = "") -> None:
        conn.execute(
            """
            INSERT INTO case_status_history (case_id, old_status, new_status, changed_by, changed_at, remarks)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (str(case_id), old_status, new_status, changed_by, utcnow_iso(), remarks),
        )

    def record_escalation(
        self,
        conn,
        case_id: Optional[str],
        batch_ref: Optional[str],
        escalation_type: str,
        escalation_level: int,
        recipient_role: str,
        recipient_email: str,
        subject: str,
        body_snapshot: str,
        status: str,
        sent_by: str,
        cc_emails: str = "",
        remarks: str = "",
    ) -> None:
        conn.execute(
            """
            INSERT INTO case_escalations (
                case_id, batch_ref, escalation_type, escalation_level, recipient_role,
                recipient_email, cc_emails, subject, body_snapshot, status, sent_at, sent_by, response_status, remarks
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case_id,
                batch_ref,
                escalation_type,
                int(escalation_level or 0),
                recipient_role,
                recipient_email,
                cc_emails,
                subject,
                body_snapshot,
                status,
                utcnow_iso(),
                sent_by,
                "Pending",
                remarks,
            ),
        )

    def record_mail_log(
        self,
        conn,
        case_id: Optional[str],
        batch_ref: Optional[str],
        recipient_email: str,
        subject: str,
        send_status: str,
        error_message: str = "",
        delivery_role: str = "to",
    ) -> None:
        conn.execute(
            """
            INSERT INTO mail_logs (case_id, batch_ref, recipient_email, delivery_role, subject, send_status, error_message, sent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (case_id, batch_ref, recipient_email, delivery_role, subject, send_status, error_message, utcnow_iso()),
        )
