"""What each membership tier actually opens up (Section 6 membership sheet).

The two entry tiers are the ones that are easy to blur together, so they are
pinned here: **Tribe** is the speaking community + an individual speaking
partner and one Speaking Test — no community class, no CEFR test — while
**Basic** adds two community classes and the CEFR test. A Tribe member still
*sees* the community classes; joining one asks them to upgrade.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, hash_password
from app.db.models import (
    Batch,
    CommunityProfile,
    Teacher,
    SpeakingTeam,
    Student,
    Subscription,
    User,
)

pytestmark = pytest.mark.asyncio


async def _member(client, student_id: str, plan: str) -> dict:
    """A logged-in student holding an active membership on `plan`."""
    await Student(student_id=student_id, full_name="Asha Rao", phone="9990001111").insert()
    await User(username=student_id, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=student_id).insert()
    await CommunityProfile(student_id=student_id, display_name="Asha").insert()
    now = datetime.now(timezone.utc)
    await Subscription(student_id=student_id, plan=plan, started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": student_id, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _seed_catalogue(client) -> None:
    assert (await client.get("/api/v1/payments/plans")).status_code == 200


async def _a_class(owner: str = "SPK-26-OWNER") -> str:
    team = SpeakingTeam(name="Morning Club", description="Practice together",
                        max_members=4, owner_student_id=owner, member_ids=[owner])
    await team.insert()
    return str(team.id)


async def _a_batch(title: str = "Evening Batch") -> str:
    teacher = Teacher(name="Rita Sen", email="rita@example.com", phone="9998887777",
                      status="approved")
    await teacher.insert()
    batch = Batch(teacher_id=str(teacher.id), title=title, day_of_week="Monday",
                  class_time="7:00 PM")
    await batch.insert()
    return str(batch.id)


async def test_tribe_has_one_speaking_test_and_no_cefr_test(client):
    await _seed_catalogue(client)
    sh = await _member(client, "SPK-26-TRIBE1", "Tribe")

    data = (await client.get("/api/v1/exams/eligibility", headers=sh)).json()["data"]
    assert data["Speaking"]["allowed"] == 1
    assert data["CEFR"]["allowed"] == 0


async def test_basic_adds_the_cefr_test(client):
    await _seed_catalogue(client)
    sh = await _member(client, "SPK-26-BASIC1", "Basic")

    data = (await client.get("/api/v1/exams/eligibility", headers=sh)).json()["data"]
    assert data["Speaking"]["allowed"] == 1
    assert data["CEFR"]["allowed"] == 1


async def test_tribe_sees_community_classes_but_is_asked_to_upgrade(client):
    await _seed_catalogue(client)
    sh = await _member(client, "SPK-26-TRIBE2", "Tribe")
    team_id = await _a_class()

    access = (await client.get("/api/v1/community/class-access", headers=sh)).json()["data"]
    assert access == {"allowed": 0, "joined": 0, "included": False, "can_join": False}

    # Visible...
    teams = (await client.get("/api/v1/community/teams", headers=sh)).json()["data"]
    assert [t["name"] for t in teams] == ["Morning Club"]

    # ...but not joinable.
    r = await client.post(f"/api/v1/community/teams/{team_id}/join", headers=sh)
    assert r.status_code == 409, r.text
    assert "upgrade your membership" in r.json()["error"]["message"].lower()

    # And no request is filed for the owner to approve.
    assert await SpeakingTeam.get(team_id) is not None
    r = await client.get("/api/v1/community/teams/join-requests", headers=sh)
    assert r.json()["data"] == []


async def test_basic_may_join_two_community_classes(client):
    await _seed_catalogue(client)
    sh = await _member(client, "SPK-26-BASIC2", "Basic")
    team_id = await _a_class()

    access = (await client.get("/api/v1/community/class-access", headers=sh)).json()["data"]
    assert access["allowed"] == 2 and access["included"] is True

    r = await client.post(f"/api/v1/community/teams/{team_id}/join", headers=sh)
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("plan", ["Tribe", "Basic"])
async def test_entry_tiers_see_teacher_led_batches_but_cannot_request_one(client, plan):
    """Neither entry tier includes a teacher-led class (`classes_per_week` 0),
    so the batches stay listed but the join asks for an upgrade — no request is
    ever filed for an admin to decline."""
    await _seed_catalogue(client)
    sh = await _member(client, f"SPK-26-{plan.upper()}3", plan)
    batch_id = await _a_batch()

    data = (await client.get("/api/v1/teacher/browse-batches", headers=sh)).json()["data"]
    assert [b["title"] for b in data["batches"]] == ["Evening Batch"]
    assert data["batch_limit"] == 0
    assert data["included"] is False and data["can_join"] is False

    r = await client.post(f"/api/v1/teacher/batches/{batch_id}/request-join", headers=sh)
    assert r.status_code == 403, r.text
    assert "upgrade your membership" in r.json()["error"]["message"].lower()
    assert (await Batch.get(batch_id)).pending_ids == []


async def test_silver_may_request_one_teacher_led_batch(client):
    await _seed_catalogue(client)
    sh = await _member(client, "SPK-26-SILVER3", "Silver")
    batch_id = await _a_batch()

    data = (await client.get("/api/v1/teacher/browse-batches", headers=sh)).json()["data"]
    assert data["batch_limit"] == 1 and data["included"] is True

    r = await client.post(f"/api/v1/teacher/batches/{batch_id}/request-join", headers=sh)
    assert r.status_code == 200, r.text
    assert (await Batch.get(batch_id)).pending_ids == ["SPK-26-SILVER3"]
