"""Auth dependencies + role guards used by every router."""
from dataclasses import dataclass

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import Role, decode_token

bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    subject: str  # user_id or student_id
    role: Role
    claims: dict

    @property
    def is_admin(self) -> bool:
        return self.role in (Role.super_admin, Role.admin)


async def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> CurrentUser:
    if creds is None or not creds.credentials:
        raise UnauthorizedError("Missing authentication token")
    payload = decode_token(creds.credentials, expected_type="access")
    try:
        role = Role(payload["role"])
    except (KeyError, ValueError):
        raise UnauthorizedError("Token missing valid role")
    return CurrentUser(subject=payload["sub"], role=role, claims=payload)


async def get_optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> CurrentUser | None:
    """Like get_current_user but returns None for anonymous visitors (public pages)."""
    if creds is None or not creds.credentials:
        return None
    try:
        return await get_current_user(creds)
    except UnauthorizedError:
        return None


def require_role(*roles: Role, allow_super_admin: bool = True):
    """Return a dependency that allows only the given roles.

    ``allow_super_admin`` (default) lets the super admin through any
    admin-side guard. The **portal** guards below turn it off: each account
    belongs to exactly one portal, so an admin (super or not) is refused on
    student/teacher/partner/examiner endpoints just like a student is refused
    on admin endpoints. Admin surfaces that legitimately reach into another
    portal's data have their own endpoints or their own inline admin check
    (e.g. ``_accessible_team`` / ``_accessible_batch``).
    """
    allowed = set(roles) | ({Role.super_admin} if allow_super_admin else set())

    async def _guard(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise ForbiddenError(f"Requires one of roles: {', '.join(r.value for r in roles)}")
        return user

    return _guard


# Convenience guards
require_admin = require_role(Role.admin)
require_super_admin = require_role(Role.super_admin)  # super admin only (archive restore / purge)

# Portal guards — one role each, no cross-portal access (not even for super admin).
require_student = require_role(Role.student, allow_super_admin=False)
require_examiner = require_role(Role.examiner, allow_super_admin=False)
require_teacher = require_role(Role.teacher, allow_super_admin=False)
require_partner = require_role(Role.partner, allow_super_admin=False)
