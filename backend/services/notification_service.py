import os
import smtplib
from email.mime.text import MIMEText
from typing import Dict


class NotificationService:
    def __init__(self):
        self.smtp_host = os.getenv("FCC_SMTP_HOST")
        self.smtp_port = int(os.getenv("FCC_SMTP_PORT", "25"))
        self.smtp_user = os.getenv("FCC_SMTP_USER")
        self.smtp_pass = os.getenv("FCC_SMTP_PASS")
        self.smtp_sender = os.getenv("FCC_SMTP_SENDER", "fcc-ops@bank.demo")

    def send_email(self, recipient_email: str, subject: str, body: str) -> Dict:
        if not recipient_email:
            return {"success": False, "status": "failed", "error": "Recipient email is required."}

        if self.smtp_host:
            try:
                message = MIMEText(body or "", "plain", "utf-8")
                message["Subject"] = subject
                message["From"] = self.smtp_sender
                message["To"] = recipient_email

                with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=15) as server:
                    server.ehlo()
                    if self.smtp_user and self.smtp_pass:
                        try:
                            server.starttls()
                        except Exception:
                            pass
                        server.login(self.smtp_user, self.smtp_pass)
                    server.sendmail(self.smtp_sender, [recipient_email], message.as_string())
                return {"success": True, "status": "sent", "delivery_mode": "smtp"}
            except Exception as exc:
                return {"success": False, "status": "failed", "error": str(exc)}

        return {
            "success": True,
            "status": "queued",
            "delivery_mode": "mock",
            "error": "",
        }
