from datetime import datetime, timezone

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
