"""Weekly exam slots (Module 11).

Admin sets a slot as a weekday + a time — "Sunday – 11:00 AM" — and it repeats
every week on that day and time until it is edited or removed. The recurring
rule is what admin manages; the bookable rows students see are generated from
it, so a slot somebody already booked survives every later edit.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, hash_password
from app.db.models import Exam, ExamSlotRule, Student, Subscription, User
from app.modules.exams import service as slots

pytestmark = pytest.mark.asyncio

IST = slots.IST
STUDENT = "SPK-26-WEEK01"


async def _admin(client) -> dict:
    await User(username="admin@speakedge.in", email="admin@speakedge.in",
               password_hash=hash_password("Admin@12345"), role=Role.super_admin,
               full_name="Super Admin").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _student(client, student_id: str = STUDENT) -> dict:
    await Student(student_id=student_id, full_name="Asha Rao", phone="9990001111").insert()
    await User(username=student_id, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=student_id).insert()
    # Exam eligibility comes from the membership tier, so the fixture needs one.
    now = datetime.now(timezone.utc)
    await Subscription(student_id=student_id, plan="Gold", started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True,
                       cefr_tests=5, speaking_tests=5).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": student_id, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _add_rule(client, ah: dict, **overrides):
    body = {"kind": "CEFR", "title": "CEFR Assessment",
            "day_of_week": "Sunday", "time_of_day": "11:00"}
    body.update(overrides)
    return await client.post("/api/v1/exams/admin/slot-rules", headers=ah, json=body)


async def test_weekly_slot_repeats_every_week(client):
    """One rule -> a bookable date every week, same weekday and clock time."""
    ah = await _admin(client)
    r = await _add_rule(client, ah)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["created_slots"] == slots.SLOT_HORIZON_WEEKS
    assert "Sunday – 11:00 AM" in r.json()["message"]

    rows = (await client.get("/api/v1/exams/admin/slot-rules", headers=ah)).json()["data"]
    assert len(rows) == 1
    assert rows[0]["label"] == "Sunday – 11:00 AM"
    assert rows[0]["upcoming_slots"] == slots.SLOT_HORIZON_WEEKS

    generated = sorted(await Exam.find(Exam.is_archived == False).to_list(),  # noqa: E712
                       key=lambda e: e.scheduled_at)
    assert len(generated) == slots.SLOT_HORIZON_WEEKS
    ist = [slots.to_ist(e.scheduled_at) for e in generated]
    # Every occurrence is a Sunday at 11:00 IST, exactly seven days apart.
    assert {d.strftime("%A") for d in ist} == {"Sunday"}
    assert {(d.hour, d.minute) for d in ist} == {(11, 0)}
    assert [b - a for a, b in zip(ist, ist[1:])] == [timedelta(days=7)] * (len(ist) - 1)
    assert all(e.rule_id == rows[0]["id"] for e in generated)


async def test_slot_time_is_ist_on_the_wire(client):
    """11:00 AM IST is published as the same instant, not a naive local string."""
    ah = await _admin(client)
    sh = await _student(client)
    await _add_rule(client, ah, time_of_day="11:00")

    row = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    when = datetime.fromisoformat(row["scheduled_at"])
    assert when.tzinfo is not None  # explicit offset — never browser-local
    assert when.astimezone(IST).strftime("%A %H:%M") == "Sunday 11:00"
    assert datetime.fromisoformat(row["ends_at"]) - when == timedelta(minutes=20)


async def test_rescheduling_a_weekly_slot_moves_its_future_dates(client):
    """Edit the rule and the upcoming dates move with it."""
    ah = await _admin(client)
    rule_id = (await _add_rule(client, ah)).json()["data"]["id"]

    r = await client.patch(f"/api/v1/exams/admin/slot-rules/{rule_id}", headers=ah,
                           json={"day_of_week": "Tuesday", "time_of_day": "16:30",
                                 "duration_minutes": 30})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["removed_slots"] == slots.SLOT_HORIZON_WEEKS
    assert r.json()["data"]["created_slots"] == slots.SLOT_HORIZON_WEEKS

    live = await Exam.find(Exam.is_archived == False).to_list()  # noqa: E712
    assert len(live) == slots.SLOT_HORIZON_WEEKS
    ist = [slots.to_ist(e.scheduled_at) for e in live]
    assert {d.strftime("%A %H:%M") for d in ist} == {"Tuesday 16:30"}
    assert {e.duration_minutes for e in live} == {30}

    rows = (await client.get("/api/v1/exams/admin/slot-rules", headers=ah)).json()["data"]
    assert rows[0]["label"] == "Tuesday – 4:30 PM"


async def test_editing_never_moves_a_slot_somebody_booked(client):
    """A booked date keeps its appointment; only unbooked ones are re-cut."""
    ah = await _admin(client)
    sh = await _student(client)
    rule_id = (await _add_rule(client, ah)).json()["data"]["id"]

    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    assert (await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)).status_code == 200

    r = await client.patch(f"/api/v1/exams/admin/slot-rules/{rule_id}", headers=ah,
                           json={"time_of_day": "15:00"})
    assert r.json()["data"]["booked_slots_kept"] == 1
    assert r.json()["data"]["removed_slots"] == slots.SLOT_HORIZON_WEEKS - 1

    booking = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"][0]
    assert booking["scheduled_at"] == slot["scheduled_at"]
    assert booking["status"] == "booked"

    # And the rebuilt weeks all sit at the new time.
    live = await Exam.find(Exam.is_archived == False).to_list()  # noqa: E712
    rebuilt = [e for e in live if str(e.id) != slot["id"]]
    assert {slots.to_ist(e.scheduled_at).strftime("%H:%M") for e in rebuilt} == {"15:00"}


async def test_removing_a_weekly_slot_stops_it_repeating(client):
    """Delete withdraws the unbooked dates and the rule stops producing more."""
    ah = await _admin(client)
    sh = await _student(client)
    rule_id = (await _add_rule(client, ah)).json()["data"]["id"]
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)

    r = await client.delete(f"/api/v1/exams/admin/slot-rules/{rule_id}", headers=ah)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["removed_slots"] == slots.SLOT_HORIZON_WEEKS - 1
    assert r.json()["data"]["booked_slots_kept"] == 1

    # Only the booked sitting survives, and the horizon is not topped up again.
    assert await slots.sync_all() == {"rules": 0, "created": 0, "purged": 0}
    live = await Exam.find(Exam.is_archived == False).to_list()  # noqa: E712
    assert [str(e.id) for e in live] == [slot["id"]]
    assert (await client.get("/api/v1/exams/admin/slot-rules", headers=ah)).json()["data"] == []


async def test_horizon_rolls_forward_without_duplicating(client):
    """The scheduler pass is idempotent — it tops up, it does not re-create."""
    ah = await _admin(client)
    rule_id = (await _add_rule(client, ah)).json()["data"]["id"]
    assert (await slots.sync_all())["created"] == 0
    assert await Exam.find(Exam.is_archived == False).count() == slots.SLOT_HORIZON_WEEKS  # noqa: E712

    # A week on, the window has slid by exactly one sitting: the same dates
    # minus the one that has passed, plus one fresh date at the far end.
    rule = await ExamSlotRule.get(rule_id)
    now = datetime.now(timezone.utc)
    this_week = slots.occurrences(rule, now=now)
    next_week = slots.occurrences(rule, now=now + timedelta(days=7))
    assert next_week[:-1] == this_week[1:]
    assert next_week[-1] not in this_week


async def test_a_cancelled_date_is_not_resurrected(client):
    """Cancelling one sitting is permanent — the rule does not re-cut it."""
    ah = await _admin(client)
    await _add_rule(client, ah)
    nearest = min(await Exam.find(Exam.is_archived == False).to_list(),  # noqa: E712
                  key=lambda e: e.scheduled_at)
    assert (await client.delete(f"/api/v1/exams/{nearest.id}", headers=ah)).status_code == 200

    assert (await slots.sync_all())["created"] == 0
    live = await Exam.find(Exam.is_archived == False).to_list()  # noqa: E712
    assert len(live) == slots.SLOT_HORIZON_WEEKS - 1
    assert str(nearest.id) not in [str(e.id) for e in live]


async def test_past_unbooked_dates_are_tidied_away(client):
    """Generated dates that came and went with nobody on them get archived."""
    ah = await _admin(client)
    await _add_rule(client, ah)
    stale = min(await Exam.find(Exam.is_archived == False).to_list(),  # noqa: E712
                key=lambda e: e.scheduled_at)
    stale.scheduled_at = datetime.now(timezone.utc) - timedelta(days=30)
    await stale.save()

    assert await slots.purge_past() == 1
    assert await Exam.get(str(stale.id)) and (await Exam.get(str(stale.id))).is_archived


async def test_weekly_slot_validation(client):
    """A bad weekday, a bad clock time or a duplicate slot are all refused."""
    ah = await _admin(client)
    assert (await _add_rule(client, ah, day_of_week="Someday")).status_code == 422
    assert (await _add_rule(client, ah, time_of_day="25:00")).status_code == 422
    assert (await _add_rule(client, ah, capacity=0)).status_code == 422
    assert (await _add_rule(client, ah, examiner_id="nobody@speakedge.in")).status_code == 404

    assert (await _add_rule(client, ah)).status_code == 200
    dupe = await _add_rule(client, ah, day_of_week="sunday")  # same slot, any casing
    assert dupe.status_code == 409

    # A different exam type may share the day and time.
    assert (await _add_rule(client, ah, kind="Speaking",
                            title="Speaking Test")).status_code == 200
    assert await ExamSlotRule.find(ExamSlotRule.is_archived == False).count() == 2  # noqa: E712


async def test_weekly_slots_are_admin_only(client):
    """Students never touch the recurrence — they only see generated dates."""
    ah = await _admin(client)
    sh = await _student(client)
    await _add_rule(client, ah)

    assert (await client.get("/api/v1/exams/admin/slot-rules", headers=sh)).status_code == 403
    assert (await _add_rule(client, sh)).status_code == 403
    assert len((await client.get("/api/v1/exams/", headers=sh)).json()["data"]) == \
        slots.SLOT_HORIZON_WEEKS
