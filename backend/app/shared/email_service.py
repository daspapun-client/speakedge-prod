"""Transactional email via SMTP (Mailhog locally). Non-blocking best-effort:
failures are logged but never break the request path."""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

log = logging.getLogger("speakedge.email")


def send_email(to: str, subject: str, html: str) -> bool:
    if not to:
        return False
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.SMTP_FROM
        msg["To"] = to
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            if settings.SMTP_TLS:
                server.starttls()
            if settings.SMTP_USER:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_FROM, [to], msg.as_string())
        return True
    except Exception as e:  # pragma: no cover
        log.warning("Email to %s failed: %s", to, e)
        return False


def welcome_email(to: str, name: str, student_id: str) -> None:
    send_email(
        to,
        "Welcome to SpeakEdge",
        f"<h2>Welcome, {name}!</h2><p>Your Student ID is <b>{student_id}</b>. "
        f"Your membership is under verification (up to 72 hours).</p>",
    )


def approval_email(to: str, name: str) -> None:
    send_email(to, "Your SpeakEdge membership is Active",
               f"<h2>Congratulations {name}!</h2><p>Your membership is now <b>Active</b>.</p>")


def payment_email(to: str, name: str, invoice_no: str) -> None:
    send_email(to, "SpeakEdge payment received",
               f"<p>Hi {name}, we received your payment. Invoice <b>{invoice_no}</b> is available in your dashboard.</p>")
