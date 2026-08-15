"""Mailer: template rendering, escaping, and SMTP send (mocked / no-op)."""

import pytest

from app.services import mailer


class FakeSMTP:
    """Records what a transport was asked to do. Shared by the SSL and the
    STARTTLS tests so both paths are held to the same contract."""

    instances: list["FakeSMTP"] = []

    def __init__(self, host, port, context=None, timeout=None):
        self.host, self.port, self.timeout = host, port, timeout
        self.started_tls = False
        self.credentials = None
        self.messages = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.closed = True
        return False

    def starttls(self, context=None):
        self.started_tls = True

    def login(self, user, password):
        self.credentials = (user, password)

    def send_message(self, msg):
        self.messages.append(msg)


@pytest.fixture()
def smtp(monkeypatch):
    """SMTP configured + both transports faked; yields the recorder class."""
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(s, "smtp_user", "user")
    monkeypatch.setattr(s, "smtp_pass", "pass")
    FakeSMTP.instances = []
    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSMTP)
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    return FakeSMTP


def test_verify_template_renders_html_and_text():
    html, text = mailer.render("verify", name="Martin", verify_url="https://zauberkoch.de/v?t=abc", valid_hours=24)
    # both parts carry the essentials
    for part in (html, text):
        assert "Martin" in part
        assert "https://zauberkoch.de/v?t=abc" in part
        assert "24" in part
    # html brand + bulletproof bits
    assert "E-Mail bestätigen" in html
    assert "roundrect" in html  # Outlook VML button
    assert 'name="color-scheme"' in html  # dark-mode meta
    assert "© 2026 Martin Pfeffer | celox.io" in text


def test_html_escapes_the_name_but_not_the_text_part():
    html, text = mailer.render("verify", name="<script>x</script>", verify_url="https://x/y", valid_hours=24)
    assert "<script>x</script>" not in html  # autoescaped in HTML
    assert "&lt;script&gt;" in html
    # the plain-text part is literal (not HTML) — no escaping needed/applied
    assert "<script>x</script>" in text


def test_missing_name_degrades_gracefully():
    html, _ = mailer.render("verify", name="", verify_url="https://x/y", valid_hours=24)
    assert "Hallo," in html  # no dangling "Hallo ,"


def test_send_is_noop_without_smtp(monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "smtp_host", "")
    assert mailer.send("a@b.de", "Hi", "<b>hi</b>", "hi") is False


def test_send_uses_smtp_ssl_when_configured(monkeypatch):
    from app.core.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(s, "smtp_port", 465)
    monkeypatch.setattr(s, "smtp_user", "user")
    monkeypatch.setattr(s, "smtp_pass", "pass")

    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, context=None, timeout=None):
            sent["host"] = host
            sent["port"] = port

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def login(self, u, p):
            sent["login"] = (u, p)

        def send_message(self, msg):
            sent["from"] = msg["From"]
            sent["to"] = msg["To"]
            sent["subject"] = msg["Subject"]
            sent["types"] = [p.get_content_type() for p in msg.get_payload()]

    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", FakeSMTP)
    ok = mailer.send_verification_email("new@user.de", "Ada", "https://zauberkoch.de/v?t=xyz")
    assert ok is True
    assert sent["host"] == "smtp.example.com" and sent["port"] == 465
    assert sent["login"] == ("user", "pass")
    assert sent["to"] == "new@user.de"
    assert "Zauberkoch" in sent["from"] and "support@celox.io" in sent["from"]
    assert sent["types"] == ["text/plain", "text/html"]  # multipart/alternative order


def test_non_465_port_upgrades_with_starttls(smtp, monkeypatch):
    """Port 587 is plain TCP until STARTTLS runs — skipping it would put the
    SMTP password and the whole message on the wire in the clear."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "smtp_port", 587)

    assert mailer.send("to@example.com", "Betreff", "<b>x</b>", "x") is True

    (srv,) = smtp.instances
    assert (srv.host, srv.port) == ("smtp.example.com", 587)
    assert srv.started_tls is True
    assert srv.credentials == ("user", "pass")
    assert srv.timeout, "a hanging SMTP connection would pin a background task"


def test_anonymous_relay_skips_login(smtp, monkeypatch):
    """An empty SMTP_USER means the relay takes no credentials — logging in
    with an empty user would make it reject the whole message."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "smtp_port", 465)
    monkeypatch.setattr(get_settings(), "smtp_user", "")

    assert mailer.send("to@example.com", "Betreff", "<b>x</b>", "x") is True
    (srv,) = smtp.instances
    assert srv.credentials is None


def test_send_failure_is_swallowed_and_reported_as_false(monkeypatch, caplog):
    """A dead mail server must not turn a successful registration into a 500 —
    the caller only learns that the mail did not go out."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "smtp_host", "smtp.example.com")
    monkeypatch.setattr(get_settings(), "smtp_port", 465)

    def explode(*a, **kw):
        raise OSError("connection refused")

    monkeypatch.setattr(mailer.smtplib, "SMTP_SSL", explode)

    assert mailer.send("to@example.com", "Betreff", "<b>x</b>", "x") is False
    assert "email send failed" in caplog.text


@pytest.mark.parametrize(
    "call, subject_fragment, must_appear",
    [
        (lambda: mailer.send_reset_email("u@e.de", "Ada", "https://zk.de/r?t=1"), "Passwort", "https://zk.de/r?t=1"),
        (lambda: mailer.send_welcome_email("u@e.de", "Ada", "https://zk.de", "https://github.com/x/y"), "Willkommen", "https://github.com/x/y"),
        (
            lambda: mailer.send_admin_signup_notification(
                "admin@e.de", email="neu@e.de", name="Ada", method="E-Mail", language="de", when="2026-08-15 10:00"
            ),
            "Neue Registrierung",
            "neu@e.de",
        ),
    ],
    ids=["reset", "welcome", "admin-signup"],
)
def test_every_transactional_mail_renders_and_sends(smtp, monkeypatch, call, subject_fragment, must_appear):
    """Each sender has its own pair of templates; a missing or renamed one
    would raise at render time and is caught here rather than in production."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "smtp_port", 465)

    assert call() is True
    (srv,) = smtp.instances
    (msg,) = srv.messages
    assert subject_fragment in msg["Subject"]
    body = "".join(part.get_payload(decode=True).decode() for part in msg.get_payload())
    assert must_appear in body
    assert [p.get_content_type() for p in msg.get_payload()] == ["text/plain", "text/html"]


def test_admin_notification_never_carries_an_ip_or_password(smtp, monkeypatch):
    """Data minimisation is a promise in the privacy policy, so it is asserted
    rather than merely intended."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "smtp_port", 465)
    mailer.send_admin_signup_notification(
        "admin@e.de", email="neu@e.de", name="Ada", method="E-Mail", language="de", when="2026-08-15 10:00"
    )
    (srv,) = smtp.instances
    body = "".join(part.get_payload(decode=True).decode() for part in srv.messages[0].get_payload()).lower()
    for forbidden in ("ip-adresse", "ip address", "passwort", "password", "hash"):
        assert forbidden not in body


def test_empty_optional_fields_render_as_a_dash(smtp, monkeypatch):
    """`name or "—"` in the sender: an empty value must not leave a blank gap."""
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "smtp_port", 465)
    mailer.send_admin_signup_notification(
        "admin@e.de", email="neu@e.de", name="", method="Google", language="", when="2026-08-15 10:00"
    )
    (srv,) = smtp.instances
    body = "".join(part.get_payload(decode=True).decode() for part in srv.messages[0].get_payload())
    assert "—" in body
