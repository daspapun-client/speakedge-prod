"""Password hashing + JWT access/refresh tokens (stateless -> horizontally scalable)."""
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.exceptions import UnauthorizedError, ValidationAppError

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class Role(str, Enum):
    super_admin = "super_admin"
    admin = "admin"
    examiner = "examiner"
    teacher = "teacher"
    partner = "partner"
    student = "student"


# One floor for every account in the product. Enforced in hash_password rather
# than in each schema because there are eight places a password gets set
# (activation, staff/examiner/teacher/partner creation, the admin reset, the
# self-service change, the emailed reset link, the seed) and a browser-side
# rule is not a rule. Callers may still declare it on their schema for a
# nicer field-level 422 — this is the backstop.
MIN_PASSWORD_LENGTH = 8


def hash_password(password: str) -> str:
    if len(password or "") < MIN_PASSWORD_LENGTH:
        raise ValidationAppError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _create_token(subject: str, role: str, token_type: str, expires: timedelta, extra: dict | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "role": role,
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + expires).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str, role: str, extra: dict | None = None) -> str:
    return _create_token(
        subject, role, "access", timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES), extra
    )


def create_refresh_token(subject: str, role: str) -> str:
    return _create_token(subject, role, "refresh", timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS))


def decode_token(token: str, expected_type: Optional[str] = None) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError as e:
        raise UnauthorizedError("Invalid or expired token", str(e))
    if expected_type and payload.get("type") != expected_type:
        raise UnauthorizedError(f"Expected {expected_type} token")
    return payload
