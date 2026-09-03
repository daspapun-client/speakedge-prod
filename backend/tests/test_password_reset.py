"""Forgot-password flow (`/auth/forgot-password` -> emailed link -> `/auth/reset-password`).

The reset token is signed with the user's current password hash, so the tests
here pin the two properties that follow from that: it is single-use, and it
dies when the password changes by any other route.
"""
import pytest

from app.core.exceptions import ValidationAppError
from app.core.security import Role, hash_password
from app.db.models import User
from app.modules.auth import service

pytestmark = pytest.mark.asyncio


async def _make_user(username="learner@speakedge.in", password="Student@123", **kw):
    kw.setdefault("email", username)
    kw.setdefault("role", Role.student)
    kw.setdefault("full_name", "Test Learner")
    user = User(username=username, password_hash=hash_password(password), **kw)
    await user.insert()
    return user


def _sent_links(monkeypatch):
    """Capture reset links instead of talking to SMTP."""
    links: list[str] = []
    monkeypatch.setattr(
        service.email_service,
        "password_reset_email",
        lambda to, name, link, minutes: links.append(link),
    )
    return links


async def _login(client, username, password):
    return await client.post("/api/v1/auth/login", json={"username": username, "password": password})


def _token_from(link: str) -> str:
    return link.split("token=", 1)[1]


async def test_reset_by_email_then_login(client, monkeypatch):
    await _make_user()
    links = _sent_links(monkeypatch)

    r = await client.post("/api/v1/auth/forgot-password", json={"username": "learner@speakedge.in"})
    assert r.status_code == 200, r.text
    assert len(links) == 1

    r = await client.post(
        "/api/v1/auth/reset-password",
        json={"token": _token_from(links[0]), "new_password": "Brand@New1"},
    )
    assert r.status_code == 200, r.text

    assert (await _login(client, "learner@speakedge.in", "Brand@New1")).status_code == 200
    assert (await _login(client, "learner@speakedge.in", "Student@123")).status_code == 401


async def test_link_is_single_use(client, monkeypatch):
    await _make_user()
    links = _sent_links(monkeypatch)
    await client.post("/api/v1/auth/forgot-password", json={"username": "learner@speakedge.in"})
    token = _token_from(links[0])

    assert (await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": "Brand@New1"}
    )).status_code == 200
    # Second use: the password hash it was signed with no longer exists.
    assert (await client.post(
        "/api/v1/auth/reset-password", json={"token": token, "new_password": "Another@1"}
    )).status_code == 401


async def test_reset_works_for_staff_and_by_student_id(client, monkeypatch):
    # Staff log in with a username; students with their Student ID.
    await _make_user("teacher1", "Teach@123", email="teacher@speakedge.in", role=Role.teacher)
    await _make_user("SPK-26-ABC123", "Student@123", email="pupil@speakedge.in",
                     role=Role.student, student_id="SPK-26-ABC123")
    links = _sent_links(monkeypatch)

    await client.post("/api/v1/auth/forgot-password", json={"username": "teacher1"})
    await client.post("/api/v1/auth/forgot-password", json={"username": "SPK-26-ABC123"})
    assert len(links) == 2

    for link, pwd in zip(links, ("Teach@New1", "Pupil@New1")):
        r = await client.post(
            "/api/v1/auth/reset-password", json={"token": _token_from(link), "new_password": pwd}
        )
        assert r.status_code == 200, r.text
    assert (await _login(client, "teacher1", "Teach@New1")).status_code == 200
    assert (await _login(client, "SPK-26-ABC123", "Pupil@New1")).status_code == 200


async def test_unknown_account_is_indistinguishable(client, monkeypatch):
    await _make_user()
    links = _sent_links(monkeypatch)

    known = await client.post("/api/v1/auth/forgot-password", json={"username": "learner@speakedge.in"})
    unknown = await client.post("/api/v1/auth/forgot-password", json={"username": "nobody@speakedge.in"})
    assert known.status_code == unknown.status_code == 200
    assert known.json()["message"] == unknown.json()["message"]
    assert len(links) == 1  # only the real account was mailed


async def test_inactive_account_gets_no_link(client, monkeypatch):
    await _make_user(is_active=False)
    links = _sent_links(monkeypatch)
    r = await client.post("/api/v1/auth/forgot-password", json={"username": "learner@speakedge.in"})
    assert r.status_code == 200 and links == []


async def test_garbage_and_short_passwords_are_refused(client, monkeypatch):
    await _make_user()
    links = _sent_links(monkeypatch)
    await client.post("/api/v1/auth/forgot-password", json={"username": "learner@speakedge.in"})

    assert (await client.post(
        "/api/v1/auth/reset-password", json={"token": "not-a-token", "new_password": "Brand@New1"}
    )).status_code == 401
    assert (await client.post(
        "/api/v1/auth/reset-password", json={"token": _token_from(links[0]), "new_password": "short"}
    )).status_code == 422


async def _admin(client):
    await User(
        username="admin@speakedge.in", email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"), role=Role.super_admin,
        full_name="Super Admin",
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def test_admin_reset_refuses_a_short_password(client):
    """The length floor lives on the server, not in the browser.

    `/admin/users/reset-password` used to accept any string — even "" — with the
    6-char rule enforced only by the admin UI. A truncated or mistyped password
    got hashed anyway and locked the account out with no way to discover what
    had been set.
    """
    await _make_user()
    admin = await _admin(client)

    r = await client.post("/api/v1/admin/users/reset-password", headers=admin,
                          json={"username": "learner@speakedge.in", "new_password": "short"})
    assert r.status_code == 422, r.text
    # ...and the old password still works: nothing was written.
    assert (await _login(client, "learner@speakedge.in", "Student@123")).status_code == 200

    r = await client.post("/api/v1/admin/users/reset-password", headers=admin,
                          json={"username": "learner@speakedge.in", "new_password": "Proper@Pass1"})
    assert r.status_code == 200, r.text
    assert (await _login(client, "learner@speakedge.in", "Proper@Pass1")).status_code == 200


async def test_hash_password_is_the_backstop_for_every_other_path():
    """Eight call sites set a password; the floor is enforced in the one place
    they all go through, so a new one cannot forget it."""
    with pytest.raises(ValidationAppError):
        hash_password("short")
    with pytest.raises(ValidationAppError):
        hash_password("")
