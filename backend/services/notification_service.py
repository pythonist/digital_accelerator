import html
import os
import smtplib
from email.message import EmailMessage
from typing import Any, Dict, Iterable, List, Optional


class NotificationService:
    def __init__(self):
        self.smtp_host = os.getenv("FCC_SMTP_HOST", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("FCC_SMTP_PORT", "587"))
        self.smtp_user = os.getenv("FCC_SMTP_USER", "")
        self.smtp_pass = os.getenv("FCC_SMTP_PASS", "")
        self.smtp_sender = os.getenv("FCC_SMTP_SENDER", "fcc-ops@bank.demo")

    def _escape(self, value: Any) -> str:
        return html.escape(str(value or ""))

    def _normalize_email_list(self, values: Any) -> List[str]:
        if values in (None, ""):
            return []
        if isinstance(values, str):
            candidates: Iterable[Any] = values.replace(";", ",").split(",")
        elif isinstance(values, (list, tuple, set)):
            candidates = values
        else:
            candidates = [values]

        seen = set()
        normalized: List[str] = []
        for item in candidates:
            text = str(item or "").strip()
            if not text:
                continue
            lower_text = text.lower()
            if lower_text in seen:
                continue
            seen.add(lower_text)
            normalized.append(text)
        return normalized

    def _render_case_details(self, case_details: Dict[str, Any]) -> str:
        rows = []
        for label, value in (case_details or {}).items():
            if value in (None, ""):
                continue
            rows.append(
                f"""
                <tr>
                  <td style="padding:8px 10px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0;width:38%;">{self._escape(label)}</td>
                  <td style="padding:8px 10px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;font-weight:600;">{self._escape(value)}</td>
                </tr>
                """
            )
        if not rows:
            return ""
        return (
            '<div style="background:#ffffff;border:1px solid #d7dee8;border-radius:4px;padding:16px 18px;margin:0 0 18px;">'
            '<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:10px;">Case Snapshot</div>'
            '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">'
            f"{''.join(rows)}"
            "</table></div>"
        )

    def _render_sections(self, sections: List[Dict[str, Any]]) -> str:
        blocks = []
        for section in sections or []:
            title = str(section.get("title") or "").strip()
            body = str(section.get("body") or "").strip()
            if not title and not body:
                continue
            blocks.append(
                f"""
                <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;margin:0 0 14px;">
                  <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#334155;margin-bottom:8px;">{self._escape(title)}</div>
                  <div style="font-size:14px;line-height:1.7;color:#0f172a;white-space:pre-wrap;">{self._escape(body)}</div>
                </div>
                """
            )
        return "".join(blocks)

    def _render_case_rows(self, case_rows: List[Dict[str, Any]]) -> str:
        if not case_rows:
            return ""
        rows = []
        for item in case_rows[:12]:
            rows.append(
                f"""
                <tr>
                  <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#0f172a;font-weight:700;">{self._escape(item.get('case_id') or '-')}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">{self._escape(item.get('customer_id') or '-')}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">{self._escape(item.get('severity') or '-')}</td>
                  <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;color:#334155;">{self._escape(item.get('scenario_name') or '-')}</td>
                </tr>
                """
            )
        return (
            '<div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;margin:0 0 18px;">'
            '<div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#334155;margin-bottom:10px;">Cases Included</div>'
            '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">'
            '<thead><tr>'
            '<th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:1px solid #cbd5e1;">Case</th>'
            '<th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:1px solid #cbd5e1;">Customer</th>'
            '<th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:1px solid #cbd5e1;">Severity</th>'
            '<th align="left" style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:1px solid #cbd5e1;">Scenario</th>'
            "</tr></thead><tbody>"
            f"{''.join(rows)}"
            "</tbody></table></div>"
        )

    def _render_html_email(self, subject: str, body: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        metadata = metadata or {}
        workflow = str(metadata.get("workflow") or "FCIP Investigation Workbench").strip()
        summary = str(metadata.get("summary") or "").strip()
        sections = list(metadata.get("sections") or [])
        case_details = metadata.get("case_details") if isinstance(metadata.get("case_details"), dict) else {}
        case_rows = list(metadata.get("case_rows") or [])

        summary_block = (
            f"""
            <div style="background:#ffffff;border:1px solid #d7dee8;border-left:4px solid #d04a02;border-radius:4px;padding:16px 18px;margin:0 0 18px;">
              <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Executive Context</div>
              <div style="font-size:14px;line-height:1.7;color:#0f172a;white-space:pre-wrap;">{self._escape(summary)}</div>
            </div>
            """
            if summary else ""
        )
        main_body = (
            f"""
            <div style="background:#ffffff;border:1px solid #d7dee8;border-radius:4px;padding:18px 20px;margin:0 0 18px;">
              <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">Message</div>
              <div style="font-size:14px;line-height:1.8;color:#0f172a;white-space:pre-wrap;">{self._escape(body)}</div>
            </div>
            """
            if body else ""
        )

        return f"""<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:900px;margin:0 auto;padding:28px 10px;">
      <div style="background:#ffffff;border:1px solid #d7dee8;overflow:hidden;">
        <div style="padding:22px 28px 18px;">
          <div style="font-size:12px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:#64748b;">FCIP Notifications</div>
          <div style="font-size:18px;font-weight:500;line-height:1.4;color:#64748b;margin-top:14px;">Structured case communication</div>
          <div style="font-size:42px;font-weight:800;line-height:1.15;color:#0f2747;margin-top:6px;">{self._escape(subject)}</div>
          <div style="font-size:14px;line-height:1.7;color:#475569;margin-top:14px;">Generated from {self._escape(workflow)}</div>
        </div>
        <div style="height:4px;background:#d04a02;"></div>
        <div style="padding:24px 28px;">
          {summary_block}
          {self._render_case_details(case_details)}
          {main_body}
          {self._render_case_rows(case_rows)}
          {self._render_sections(sections)}
          <div style="padding-top:8px;border-top:1px solid #d7dee8;font-size:12px;line-height:1.7;color:#64748b;">
            This message was prepared inside FCIP to support investigation, escalation, and case-resolution workflows. Analysts should validate the evidence and final disposition in the platform before closure or filing.
          </div>
        </div>
      </div>
    </div>
  </body>
</html>"""

    def _compose_plain_text(self, body: str, metadata: Optional[Dict[str, Any]] = None) -> str:
        metadata = metadata or {}
        parts: List[str] = []
        summary = str(metadata.get("summary") or "").strip()
        if summary:
            parts.append(f"Executive Context\n{summary}")
        case_details = metadata.get("case_details") if isinstance(metadata.get("case_details"), dict) else {}
        if case_details:
            lines = [f"{key}: {value}" for key, value in case_details.items() if value not in (None, "")]
            if lines:
                parts.append("Case Snapshot\n" + "\n".join(lines))
        if body:
            parts.append(body)
        for section in list(metadata.get("sections") or []):
            title = str(section.get("title") or "").strip()
            content = str(section.get("body") or "").strip()
            if title or content:
                parts.append(f"{title}\n{content}".strip())
        return "\n\n".join(part for part in parts if part).strip()

    def send_email(
        self,
        recipient_email: Any,
        subject: str,
        body: str,
        metadata: Optional[Dict[str, Any]] = None,
        cc_emails: Any = None,
    ) -> Dict[str, Any]:
        to_emails = self._normalize_email_list(recipient_email)
        cc_list = self._normalize_email_list(cc_emails)
        if not to_emails:
            return {"success": False, "status": "failed", "error": "At least one primary recipient is required."}

        plain_text = self._compose_plain_text(body or "", metadata)
        html_body = self._render_html_email(subject, body or "", metadata)

        if self.smtp_host:
            try:
                message = EmailMessage()
                message["Subject"] = subject
                message["From"] = self.smtp_sender
                message["To"] = ", ".join(to_emails)
                if cc_list:
                    message["Cc"] = ", ".join(cc_list)
                message.set_content(plain_text or subject)
                message.add_alternative(html_body, subtype="html")

                with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=15) as server:
                    server.ehlo()
                    if self.smtp_user and self.smtp_pass:
                        try:
                            server.starttls()
                        except Exception:
                            pass
                        server.login(self.smtp_user, self.smtp_pass)
                    server.sendmail(self.smtp_sender, [*to_emails, *cc_list], message.as_string())
                return {
                    "success": True,
                    "status": "sent",
                    "delivery_mode": "smtp",
                    "to_emails": to_emails,
                    "cc_emails": cc_list,
                }
            except Exception as exc:
                return {"success": False, "status": "failed", "error": str(exc)}

        return {
            "success": True,
            "status": "queued",
            "delivery_mode": "mock",
            "error": "",
            "to_emails": to_emails,
            "cc_emails": cc_list,
        }
