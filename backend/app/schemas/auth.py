"""Request bodies for email/password auth. Validation is server-side; the
password strength policy lives in services/passwords.py (single source)."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, field_validator

from app.services.passwords import PasswordError, validate_password


class RegisterBody(BaseModel):
    email: EmailStr
    password: str
    password_confirm: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()

    def check(self) -> None:
        """Cross-field + strength checks. Raises PasswordError (message shown
        to the user). Called from the endpoint after model validation."""
        if self.password != self.password_confirm:
            raise PasswordError("Die Passwörter stimmen nicht überein.")
        validate_password(self.password, email=self.email)


class LoginBody(BaseModel):
    email: EmailStr
    password: str

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class ForgotBody(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class ResetBody(BaseModel):
    token: str
    password: str
    password_confirm: str

    def check(self) -> None:
        if self.password != self.password_confirm:
            raise PasswordError("Die Passwörter stimmen nicht überein.")
        validate_password(self.password)


class VerifyBody(BaseModel):
    token: str


__all__ = ["RegisterBody", "LoginBody", "ForgotBody", "ResetBody", "VerifyBody", "PasswordError"]
