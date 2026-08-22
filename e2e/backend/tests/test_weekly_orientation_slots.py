"""Weekly orientation slots.

Admin sets a session as a weekday + a time — "Sunday – 11:00 AM" — and it
repeats every week until it is changed or removed. The recurring rule is what
admin manages; the dated sessions students join are generated from it, so a
session somebody has already joined survives every later edit.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, create_access_token
from app.db.models import MembershipStatus, OrientationBatch, OrientationSlotRule, Student
from app.modules.orientation import service

pytestmark = pytest.mark.asyncio

ADMIN = {"Authorization": f"Bearer {create_access_token('admin@test', Role.admin.value)}"}


def _student_auth(sid: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token(sid, Role.student.value)}"}


async def _student(sid: str = "SPK-26-ORW01") -> dict:
    await Student(student_id=sid, full_name="Weekly Learner",
                  membership_status=MembershipStatus.active).insert()
    return _student_auth(sid)


async def _add_rule(client, **overrides):
    body = {"title": "New Student Orientation", "day_of_week": "Sunday", "time_of_day": "11:00"}
    body.update(overrides)
    return await client.post("/api/v1/orientation/slot-rules", headers=ADMIN, json=body)


async def _live_sessions() -> list[OrientationBatch]:
    return await OrientationBatch.find(OrientationBatch.is_archived == False).to_list()  # noqa: E712


async def test_weekly_session_repeats_every_week(client):
    """One rule -> a session every week, same weekday and clock time."""
    r = await _add_rule(client, meeting_url="https://meet.example/orientation")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["created_sessions"] == service.SLOT_HORIZON_WEEKS
    assert "Sunday – 11:00 AM" in r.json()["message"]

    rows = (await client.get("/api/v1/orientation/slot-rules", headers=ADMIN)).json()["data"]
    assert len(rows) == 1
    assert rows[0]["label"] == "Sunday – 11:00 AM"
    assert rows[0]["upcoming_sessions"] == service.SLOT_HORIZON_WEEKS
    assert rows[0]["enrolled_upcoming"] == 0

    sessions = sorted(await _live_sessions(), key=lambda b: b.scheduled_at)
    ist = [service.to_ist(b.scheduled_at) for b in sessions]
    assert {d.strftime("%A") for d in ist} == {"Sunday"}
    assert {(d.hour, d.minute) for d in ist} == {(11, 0)}
    assert [b - a for a, b in zip(ist, ist[1:])] == [timedelta(days=7)] * (len(ist) - 1)
    # Generated sessions are live and carry the rule's details.
    assert {b.mode for b in sessions} == {"live"}
    assert {b.meeting_url for b in sessions} == {"https://meet.example/orientation"}
    assert all(b.rule_id == rows[0]["id"] for b in sessions)


async def test_students_can_join_a_generated_session(client):
    """The generated sessions are ordinary joinable orientation classes."""
    sh = await _student()
    await _add_rule(client)

    me = (await client.get("/api/v1/orientation/me", headers=sh)).json()["data"]
    assert len(me["open_batches"]) == service.SLOT_HORIZON_WEEKS
    first = me["open_batches"][0]
    # The time on the wire is an explicit instant, not a naive local string.
    when = datetime.fromisoformat(first["scheduled_at"])
    assert when.tzinfo is not None
    assert when.astimezone(service.IST).strftime("%A %H:%M") == "Sunday 11:00"

    r = await client.post("/api/v1/orientation/me/join", headers=sh, json={"batch_id": first["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["batch"]["id"] == first["id"]
    # A live session is completed by the teacher, not self-served.
    assert r.json()["data"]["can_self_complete"] is False


async def test_rescheduling_moves_the_upcoming_sessions(client):
    """Edit the rule and the sessions nobody joined move with it."""
    rule_id = (await _add_rule(client)).json()["data"]["id"]

    r = await client.patch(f"/api/v1/orientation/slot-rules/{rule_id}", headers=ADMIN,
                           json={"day_of_week": "Wednesday", "time_of_day": "18:30",
                                 "duration_min": 60, "title": "Evening Orientation"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["removed_sessions"] == service.SLOT_HORIZON_WEEKS
    assert r.json()["data"]["created_sessions"] == service.SLOT_HORIZON_WEEKS
    assert r.json()["data"]["label"] == "Wednesday – 6:30 PM"

    sessions = await _live_sessions()
    assert len(sessions) == service.SLOT_HORIZON_WEEKS
    ist = [service.to_ist(b.scheduled_at) for b in sessions]
    assert {d.strftime("%A %H:%M") for d in ist} == {"Wednesday 18:30"}
    assert {b.duration_min for b in sessions} == {60}
    assert {b.title for b in sessions} == {"Evening Orientation"}


async def test_editing_never_moves_a_session_students_joined(client):
    """A session with an enrolled student keeps its date; the rest are re-cut."""
    sh = await _student()
    rule_id = (await _add_rule(client)).json()["data"]["id"]
    me = (await client.get("/api/v1/orientation/me", headers=sh)).json()["data"]
    joined = me["open_batches"][0]
    await client.post("/api/v1/orientation/me/join", headers=sh, json={"batch_id": joined["id"]})

    r = await client.patch(f"/api/v1/orientation/slot-rules/{rule_id}", headers=ADMIN,
                           json={"time_of_day": "15:00"})
    assert r.json()["data"]["enrolled_sessions_kept"] == 1
    assert r.json()["data"]["removed_sessions"] == service.SLOT_HORIZON_WEEKS - 1

    still = (await client.get("/api/v1/orientation/me", headers=sh)).json()["data"]["batch"]
    assert still["id"] == joined["id"]
    assert still["scheduled_at"] == joined["scheduled_at"]

    rebuilt = [b for b in await _live_sessions() if str(b.id) != joined["id"]]
    assert {service.to_ist(b.scheduled_at).strftime("%H:%M") for b in rebuilt} == {"15:00"}


async def test_removing_a_weekly_slot_stops_it_repeating(client):
    """Delete withdraws the sessions nobody joined and stops producing more."""
    sh = await _student()
    rule_id = (await _add_rule(client)).json()["data"]["id"]
    me = (await client.get("/api/v1/orientation/me", headers=sh)).json()["data"]
    joined = me["open_batches"][0]
    await client.post("/api/v1/orientation/me/join", headers=sh, json={"batch_id": joined["id"]})

    r = await client.delete(f"/api/v1/orientation/slot-rules/{rule_id}", headers=ADMIN)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["removed_sessions"] == service.SLOT_HORIZON_WEEKS - 1
    assert r.json()["data"]["enrolled_sessions_kept"] == 1

    assert await service.sync_all() == {"rules": 0, "created": 0, "purged": 0}
    assert [str(b.id) for b in await _live_sessions()] == [joined["id"]]
    assert (await client.get("/api/v1/orientation/slot-rules", headers=ADMIN)).json()["data"] == []


async def test_horizon_rolls_forward_without_duplicating(client):
    """The scheduler pass is idempotent — it tops up, it does not re-create."""
    rule_id = (await _add_rule(client)).json()["data"]["id"]
    assert (await service.sync_all())["created"] == 0
    assert len(await _live_sessions()) == service.SLOT_HORIZON_WEEKS

    rule = await OrientationSlotRule.get(rule_id)
    now = datetime.now(timezone.utc)
    this_week = service.occurrences(rule, now=now)
    next_week = service.occurrences(rule, now=now + timedelta(days=7))
    assert next_week[:-1] == this_week[1:]
    assert next_week[-1] not in this_week


async def test_a_cancelled_session_is_not_resurrected(client):
    """Cancelling one session is permanent — the rule does not re-cut it."""
    await _add_rule(client)
    nearest = min(await _live_sessions(), key=lambda b: b.scheduled_at)
    r = await client.patch(f"/api/v1/orientation/batches/{nearest.id}", headers=ADMIN,
                           json={"status": "cancelled"})
    assert r.status_code == 200, r.text

    # A cancelled session is in use as far as the rule is concerned: it is left
    # alone, and no replacement is cut at that time.
    assert (await service.sync_all())["created"] == 0
    assert len(await _live_sessions()) == service.SLOT_HORIZON_WEEKS
    assert (await OrientationBatch.get(str(nearest.id))).status == "cancelled"


async def test_a_session_that_has_started_is_not_joinable(client):
    """Weekly slots keep producing dates, so a past session must drop out of the
    join list rather than linger until the purge grace period is up."""
    sh = await _student()
    await _add_rule(client)
    past = min(await _live_sessions(), key=lambda b: b.scheduled_at)
    past.scheduled_at = datetime.now(timezone.utc) - timedelta(hours=2)
    await past.save()

    me = (await client.get("/api/v1/orientation/me", headers=sh)).json()["data"]
    assert str(past.id) not in [b["id"] for b in me["open_batches"]]
    assert len(me["open_batches"]) == service.SLOT_HORIZON_WEEKS - 1

    r = await client.post("/api/v1/orientation/me/join", headers=sh,
                          json={"batch_id": str(past.id)})
    assert r.status_code == 409
    assert "already started" in r.json()["error"]["message"]


async def test_past_sessions_with_nobody_enrolled_are_tidied_away(client):
    """Generated sessions that came and went unused get archived."""
    await _add_rule(client)
    stale = min(await _live_sessions(), key=lambda b: b.scheduled_at)
    stale.scheduled_at = datetime.now(timezone.utc) - timedelta(days=30)
    await stale.save()

    assert await service.purge_past() == 1
    assert (await OrientationBatch.get(str(stale.id))).is_archived


async def test_weekly_slot_validation(client):
    """A bad weekday, a bad clock time or a duplicate slot are all refused."""
    assert (await _add_rule(client, day_of_week="Someday")).status_code == 422
    assert (await _add_rule(client, time_of_day="7pm")).status_code == 422
    assert (await _add_rule(client, title="  ")).status_code == 422
    assert (await _add_rule(client, teacher_id="65a000000000000000000000")).status_code == 404

    assert (await _add_rule(client)).status_code == 200
    assert (await _add_rule(client, day_of_week="sunday")).status_code == 409  # any casing
    # A different day or time is fine.
    assert (await _add_rule(client, day_of_week="Monday")).status_code == 200
    assert await OrientationSlotRule.find(
        OrientationSlotRule.is_archived == False).count() == 2  # noqa: E712


async def test_weekly_slots_are_admin_only(client):
    """Students never touch the recurrence — they only see generated sessions."""
    sh = await _student()
    await _add_rule(client)
    assert (await client.get("/api/v1/orientation/slot-rules", headers=sh)).status_code == 403
    assert (await client.post("/api/v1/orientation/slot-rules", headers=sh, json={
        "title": "x", "day_of_week": "Monday", "time_of_day": "10:00"})).status_code == 403
