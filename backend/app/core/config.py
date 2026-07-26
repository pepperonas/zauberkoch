"""Application settings, loaded from environment / backend/.env.

All variables are documented in the repo-root .env.example.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Environment
    zk_env: str = "dev"  # dev | prod
    zk_base_url: str = "http://localhost:5173"
    zk_port: int = 8742
    zk_db_path: str = "data/zauberkoch.db"

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"
    anthropic_max_tokens: int = 8000

    # Google OAuth
    google_client_id: str = ""
    google_client_secret: str = ""

    # Sessions & security
    session_secret: str = ""
    session_ttl_hours: int = 720

    # Access & limits
    open_signup: bool = True  # self-service registration (no invite/allowlist gate)
    # Intro animation on shared-recipe links: motif (pot/shaker) | crt | off
    share_intro: str = "motif"
    zk_dev_login: bool = False  # dev-only fake login (hard-refused in prod)
    zk_admin_emails: str = ""  # comma-separated admin emails
    # System limits — DEFAULTS. Editable at runtime in the admin panel (persisted
    # in the app_settings singleton, which overrides these); see services/limits.py.
    daily_limit_per_user: int = 5  # per-user daily default (users with daily_limit=NULL)
    daily_limit_global: int = 200  # total generations/day
    daily_registration_limit: int = 20  # new accounts/day
    anon_ip_limit: int = 3  # taster generations per IP/day
    daily_limit_anon: int = 15  # taster generations total/day (global anon cap)

    # Outgoing mail (verification / password-reset). Empty host = mail disabled
    # (send is a no-op + logs a warning; useful in dev/tests).
    smtp_host: str = ""
    smtp_port: int = 465  # 465 = implicit TLS (SMTP_SSL)
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_from: str = "support@celox.io"
    smtp_from_name: str = "Zauberkoch"
    # Where new-registration notifications go (operator inbox).
    admin_notify_email: str = "martin.pfeffer@celox.io"

    @property
    def admin_emails(self) -> set[str]:
        return {e.strip().lower() for e in self.zk_admin_emails.split(",") if e.strip()}

    @property
    def is_prod(self) -> bool:
        return self.zk_env == "prod"

    @property
    def db_path(self) -> Path:
        p = Path(self.zk_db_path)
        return p if p.is_absolute() else BACKEND_DIR / p

    @property
    def oauth_redirect_uri(self) -> str:
        # In dev the callback goes straight to the backend port (see docs/GOOGLE-OAUTH.md)
        base = self.zk_base_url if self.is_prod else f"http://localhost:{self.zk_port}"
        return f"{base}/api/v1/auth/callback"


@lru_cache
def get_settings() -> Settings:
    return Settings()
