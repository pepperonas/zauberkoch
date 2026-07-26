"""Transactional email — Jinja2-rendered multipart/alternative via SMTP.

Templates live in app/templates/email/ as `<name>.html.j2` + `<name>.txt.j2`.
HTML rendering autoescapes; the text part is rendered without escaping. When
SMTP is not configured (empty SMTP_HOST) send() is a logged no-op, so dev/tests
never touch the network.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.core.config import get_settings

logger = logging.getLogger("zauberkoch.mailer")

_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "email"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATE_DIR)),
    # autoescape only the .html.j2 templates; .txt.j2 stays literal
    autoescape=select_autoescape(enabled_extensions=("html.j2",), default_for_string=False),
    trim_blocks=True,
    lstrip_blocks=True,
)


def render(template: str, **ctx: object) -> tuple[str, str]:
    """Render (html, text) for the given email template base name."""
    html = _env.get_template(f"{template}.html.j2").render(**ctx)
    text = _env.get_template(f"{template}.txt.j2").render(**ctx)
    return html, text


def send(to: str, subject: str, html: str, text: str) -> bool:
    """Send a multipart/alternative email. Returns False (no-op) if SMTP is off."""
    s = get_settings()
    if not s.smtp_host:
        logger.warning("SMTP not configured — email to %s not sent (subject=%r)", to, subject)
        return False

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((s.smtp_from_name, s.smtp_from))
    msg["To"] = to
    # text first, html last — clients pick the last part they can render
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        if s.smtp_port == 465:
            ctx = ssl.create_default_context()
            with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=ctx, timeout=15) as srv:
                if s.smtp_user:
                    srv.login(s.smtp_user, s.smtp_pass)
                srv.send_message(msg)
        else:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as srv:
                srv.starttls(context=ssl.create_default_context())
                if s.smtp_user:
                    srv.login(s.smtp_user, s.smtp_pass)
                srv.send_message(msg)
        logger.info("email sent to %s (subject=%r)", to, subject)
        return True
    except Exception:
        logger.exception("email send failed to %s", to)
        return False


def send_verification_email(to: str, name: str, verify_url: str) -> bool:
    """Double-opt-in confirmation mail for a new email registration."""
    html, text = render("verify", name=name, verify_url=verify_url, valid_hours=24)
    return send(to, "Bestätige deine E-Mail für Zauberkoch", html, text)


def send_reset_email(to: str, name: str, reset_url: str, valid_hours: int = 1) -> bool:
    """Password-reset link mail."""
    html, text = render("reset", name=name, reset_url=reset_url, valid_hours=valid_hours)
    return send(to, "Passwort zurücksetzen bei Zauberkoch", html, text)


def send_welcome_email(to: str, name: str, app_url: str, repo_url: str) -> bool:
    """Welcome mail after a confirmed email registration (open-source note)."""
    html, text = render("welcome", name=name, app_url=app_url, repo_url=repo_url)
    return send(to, "Willkommen bei Zauberkoch 🧑‍🍳", html, text)


def send_admin_signup_notification(
    admin_to: str, *, email: str, name: str, method: str, language: str, when: str
) -> bool:
    """Notify the operator about a new registration (data-minimal)."""
    html, text = render(
        "admin_signup", email=email, name=name or "—", method=method, language=language or "—", when=when
    )
    return send(admin_to, f"Neue Registrierung: {email}", html, text)
