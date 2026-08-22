from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.core.config import settings
from app.core.exceptions import UnauthorizedError
from app.core.security import (
    Role,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.models import User
from app.modules.auth.schemas import TokenPair
from app.shared import email_service


async def find_login_user(username: str) -> User | None:
    username = username.strip()
    user = await User.find_one(User.username == username, User.is_archived == False)  # noqa: E712
    if not user and "@" in username:
        user = await User.find_one(User.email == username, User.is_archived == False)  # noqa: E712
    return user


async def authenticate(username: str, password: str) -> TokenPair:
    user = await find_login_user(username)
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        raise UnauthorizedError("Invalid credentials")
    user.last_login_at = datetime.now(timezone.utc)
    await user.save()
    return _issue(user)


def _issue(user: User) -> TokenPair:
    subject = user.student_id or user.username
    extra = {"user_id": str(user.id)}
    if user.student_id:
        extra["student_id"] = user.student_id
    return TokenPair(
        access_token=create_access_token(subject, user.role.value, extra),
        refresh_token=create_refresh_token(subject, user.role.value),
        role=user.role.value,
        subject=subject,
    )


async def refresh(refresh_token: str) -> TokenPair:
    payload = decode_token(refresh_token, expected_type="refresh")
    subject = payload["sub"]
    user = await User.find_one({"$or": [{"username": subject}, {"student_id": subject}]})
    if not user or not user.is_active:
        raise UnauthorizedError("User no longer active")
    return _issue(user)


async def change_password(subject: str, old: str, new: str) -> None:
    user = await User.find_one({"$or": [{"username": subject}, {"student_id": subject}]})
    if not user or not verify_password(old, user.password_hash):
        raise UnauthorizedError("Old password is incorrect")
    user.password_hash = hash_password(new)
    await user.save()


async def create_user(username: str, password: str, role: Role, **kwargs) -> User:
    user = User(username=username, password_hash=hash_password(password), role=role, **kwargs)
    await user.insert()
    return user


# --- Forgot / reset password -------------------------------------------------
# The reset token is an ordinary JWT signed with SECRET_KEY *plus the user's
# current password hash*. That makes it single-use for free: completing a reset
# changes the hash, so the link (and any older one) stops verifying — no reset
# collection to store, expire and purge.


def _reset_key(user: User) -> str:
    return f"{settings.SECRET_KEY}:{user.password_hash}"


def _reset_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.username,
        "type": "reset",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, _reset_key(user), algorithm=settings.JWT_ALGORITHM)


async def request_password_reset(username: str) -> None:
    """Best-effort: mail a reset link if the account exists and has an email.

    Deliberately silent about the outcome — the caller always answers the same
    way, so this endpoint cannot be used to discover who has an account.
    """
    user = await find_login_user(username)
    if not user or not user.is_active or not user.email:
        return
    link = (
        f"{settings.PUBLIC_BASE_URL.rstrip('/')}/reset-password"
        f"?token={_reset_token(user)}"
    )
    email_service.password_reset_email(
        user.email,
        user.full_name or user.username,
        link,
        settings.PASSWORD_RESET_EXPIRE_MINUTES,
    )


async def reset_password(token: str, new_password: str) -> User:
    """Verify a reset token and set the new password."""
    try:
        subject = jwt.get_unverified_claims(token).get("sub")
    except JWTError:
        raise UnauthorizedError("Invalid or expired reset link")
    user = await User.find_one(User.username == subject, User.is_archived == False) if subject else None  # noqa: E712
    if not user or not user.is_active:
        raise UnauthorizedError("Invalid or expired reset link")
    try:
        payload = jwt.decode(token, _reset_key(user), algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        # Wrong signature also means the password already changed since it was
        # issued, i.e. the link was used once already.
        raise UnauthorizedError("Invalid or expired reset link")
    if payload.get("type") != "reset":
        raise UnauthorizedError("Invalid or expired reset link")
    user.password_hash = hash_password(new_password)
    await user.save()
    return user
