"""Every account belongs to exactly one portal.

An admin must not be able to reach the student, teacher, partner or examiner
surfaces, and none of those may reach each other's or the admin's. Super admin
is deliberately included: it inherits *admin* power, not every other role's.
"""
import pytest

from app.core.security import Role, hash_password
from app.db.models import User

pytestmark = pytest.mark.asyncio

PASSWORD = "Portal@12345"

# One representative endpoint per portal, each behind that portal's role guard.
SURFACES = {
    "student": "/api/v1/dashboard/",
    "teacher": "/api/v1/teacher/dashboard",
    "partner": "/api/v1/partner/dashboard",
    "examiner": "/api/v1/exams/examiner/assigned",
    "admin": "/api/v1/admin/overview",
}

# The portal each role owns; every other surface must answer 403.
ROLE_PORTAL = {
    Role.student: "student",
    Role.teacher: "teacher",
    Role.partner: "partner",
    Role.examiner: "examiner",
    Role.admin: "admin",
    Role.super_admin: "admin",
}


async def _headers(client, role: Role) -> dict:
    username = f"{role.value}@speakedge.in"
    await User(
        username=username, email=username, password_hash=hash_password(PASSWORD),
        role=role, full_name=role.value, student_id=username,
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


@pytest.mark.parametrize("role", list(ROLE_PORTAL))
async def test_role_cannot_reach_other_portals(client, role):
    headers = await _headers(client, role)
    own = ROLE_PORTAL[role]

    for portal, url in SURFACES.items():
        r = await client.get(url, headers=headers)
        if portal == own:
            # The account may still lack a profile row (404) — it must not be 403.
            assert r.status_code != 403, f"{role.value} locked out of its own {portal} portal"
        else:
            assert r.status_code == 403, (
                f"{role.value} reached the {portal} portal: {r.status_code} {r.text}"
            )


async def test_anonymous_is_unauthorized_everywhere(client):
    for url in SURFACES.values():
        assert (await client.get(url)).status_code == 401
