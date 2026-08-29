"""Weekly teacher-led enrolment: fix the slot once, not every week.

The client requirement this covers, verbatim: *"Student will fix a class date
and day and time and it will be automatically available every week. Student
doesn't need to request every week. Once request approved from admin, it will be
continued for consecutive 4 sessions for 1 month payment."*

So: one request, one admin decision, four consecutive sittings — and the next
monthly fee rolls the seat forward without anybody asking again.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, hash_password
from app.db.models import (
    Batch,
    BatchSeries,
    PaymentStatus,
    PlanConfig,
    Student,
    Subscription,
    Teacher,
    User,
)
from app.shared import batch_enrolment as enrol

pytestmark = pytest.mark.asyncio

STUDENT = "SPK-26-WEEK01"


async def _admin_headers(client):
    await User(
        username="admin@speakedge.in", email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"), role=Role.super_admin,
        full_name="Super Admin",
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _student_headers(client):
    """A Gold member (classes_per_week = 1) with a live subscription."""
    await User(username=STUDENT, password_hash=hash_password("Student@123"),
               role=Role.student, full_name="Asha Rao").insert()
    await Student(student_id=STUDENT, full_name="Asha Rao", phone="9990001111").insert()
    now = datetime.now(timezone.utc)
    await Subscription(student_id=STUDENT, plan="Gold", started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": STUDENT, "password": "Student@123"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _weekly_course(weeks: int = 8) -> tuple[str, list[str]]:
    """A course repeating every Monday for `weeks` weeks, as admin's weekly
    schedule materialises it: one dated Batch per class date."""
    teacher = Teacher(name="Rahul Sen", phone="9998887777", whatsapp="9998887777",
                      email="rahul@speakedge.in", city="Kolkata",
                      qualification="MA English", cefr_level="C1",
                      teacher_id="TCH-26-AAA111", status="approved")
    await teacher.insert()
    series = BatchSeries(title="Evening Speaking", frequency="weekly",
                         start_date="", end_date="")
    await series.insert()
    start = datetime.now(enrol.IST).date() + timedelta(days=1)
    dates, ids = [], []
    for i in range(weeks):
        d = (start + timedelta(weeks=i)).isoformat()
        b = Batch(series_id=str(series.id), teacher_id=str(teacher.id), title="Evening Speaking",
                  date=d, class_time="7:00 PM", slot_start="19:00", slot_end="20:00")
        await b.insert()
        dates.append(d)
        ids.append(str(b.id))
    return str(series.id), ids


async def _seats(student_id: str, series_id: str) -> list[str]:
    return sorted(enrol.session_date(b) for b in await enrol.sessions(series_id)
                  if student_id in b.student_ids)


async def test_one_request_covers_a_cycle_and_one_approval_grants_it(client):
    """The whole requirement in one pass: request once, approve once, get four
    consecutive weekly classes."""
    admin = await _admin_headers(client)
    student = await _student_headers(client)
    series_id, batch_ids = await _weekly_course()

    # The student picks the weekly slot once — the request lands on the next
    # four sittings, not just the one card they clicked.
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join",
                          headers=student)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["sessions"] == enrol.SESSIONS_PER_CYCLE

    pending = [b for b in await enrol.sessions(series_id) if STUDENT in b.pending_ids]
    assert len(pending) == 4

    # Asking again is refused — the slot is already fixed, nothing to re-request.
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[1]}/request-join",
                          headers=student)
    assert r.status_code == 409

    # Admin decides once, on any one of the sittings, and it applies to all four.
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[2]}/approve-join",
                          json={"student_id": STUDENT}, headers=admin)
    assert r.status_code == 200, r.text

    assert await _seats(STUDENT, series_id) == sorted(
        enrol.session_date(b) for b in (await enrol.sessions(series_id))[:4]
    )
    assert not [b for b in await enrol.sessions(series_id) if STUDENT in b.pending_ids]


async def test_student_sees_the_course_once_with_its_weekly_promise(client):
    """`browse-batches` carries the course-wide view the dashboard renders: one
    card per weekly slot, and what a request buys."""
    student = await _student_headers(client)
    series_id, batch_ids = await _weekly_course()

    r = await client.get("/api/v1/teacher/browse-batches", headers=student)
    data = r.json()["data"]
    assert data["sessions_per_cycle"] == 4
    rows = [b for b in data["batches"] if b["series_id"] == series_id]
    assert len(rows) == 8  # every sitting is still listed…
    assert {b["series_status"] for b in rows} == {"none"}  # …under one course status
    assert len(rows[0]["series_session_dates"]) == 8
    assert rows[0]["my_session_dates"] == []

    await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)

    r = await client.get("/api/v1/teacher/browse-batches", headers=student)
    rows = [b for b in r.json()["data"]["batches"] if b["series_id"] == series_id]
    # The course now reads as pending as a whole, whichever sitting you look at,
    # and names the four dates the request covers.
    assert {b["series_status"] for b in rows} == {"pending"}
    assert len(rows[0]["my_session_dates"]) == 4


async def test_withdrawing_pulls_the_whole_request_back(client):
    student = await _student_headers(client)
    series_id, batch_ids = await _weekly_course()

    await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[3]}/withdraw-join",
                          headers=student)
    assert r.status_code == 200, r.text
    assert not [b for b in await enrol.sessions(series_id) if STUDENT in b.pending_ids]


async def test_rejecting_clears_every_session_the_request_touched(client):
    admin = await _admin_headers(client)
    student = await _student_headers(client)
    series_id, batch_ids = await _weekly_course()

    await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/reject-join",
                          json={"student_id": STUDENT}, headers=admin)
    assert r.status_code == 200, r.text
    rows = await enrol.sessions(series_id)
    assert not [b for b in rows if STUDENT in b.pending_ids]
    assert not [b for b in rows if STUDENT in b.student_ids]


async def test_monthly_payment_rolls_the_seat_forward_with_no_new_request(client):
    """The four classes run out; paying the next monthly fee books the next four
    on the same slot. No request, no second approval — that is the point."""
    admin = await _admin_headers(client)
    student = await _student_headers(client)
    series_id, batch_ids = await _weekly_course()

    await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/approve-join",
                      json={"student_id": STUDENT}, headers=admin)
    first_cycle = await _seats(STUDENT, series_id)
    assert len(first_cycle) == 4

    # Those four are behind us now.
    for b in (await enrol.sessions(series_id))[:4]:
        b.date = (datetime.now(enrol.IST).date() - timedelta(days=7)).isoformat()
        await b.save()

    from app.modules.payments import service as pay

    payment = pay.Payment(student_id=STUDENT, kind="monthly", amount=29900,
                          status=PaymentStatus.paid, plan="Gold", due_month="2026-10")
    await payment.insert()
    await pay._fulfil(payment)

    second_cycle = await _seats(STUDENT, series_id)
    # Four upcoming again — the next four Mondays, granted automatically.
    upcoming = [d for d in second_cycle if d >= datetime.now(enrol.IST).strftime("%Y-%m-%d")]
    assert len(upcoming) == 4
    assert set(upcoming).isdisjoint(first_cycle)

    # Idempotent: a duplicate webhook must not over-enrol beyond one cycle.
    assert await enrol.extend(STUDENT) == {}


async def test_a_plan_without_teacher_led_classes_is_refused_before_any_request(client):
    """Tribe includes no teacher-led class — the upgrade ask happens before a
    single pending row is written, so admin never sees a request to decline."""
    student = await _student_headers(client)
    sub = await Subscription.find_one(Subscription.student_id == STUDENT)
    sub.plan = "Tribe"
    await sub.save()
    await PlanConfig(plan="Tribe", label="Tribe", amount=79900,
                     duration_days=365, classes_per_week=0).insert()

    series_id, batch_ids = await _weekly_course()
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join",
                          headers=student)
    assert r.status_code == 403
    assert "Upgrade" in r.json()["error"]["message"]
    assert not [b for b in await enrol.sessions(series_id) if STUDENT in b.pending_ids]


async def test_admin_adding_a_student_enrols_them_for_the_whole_cycle(client):
    """Adding somebody from the teacher/admin batch roster sells the same cycle
    a monthly fee buys — one date on the roster used to mean one class only."""
    admin = await _admin_headers(client)
    await _student_headers(client)
    series_id, batch_ids = await _weekly_course()

    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/students",
                          json={"student_ids": [STUDENT]}, headers=admin)
    assert r.status_code == 200, r.text
    assert await _seats(STUDENT, series_id) == sorted(
        enrol.session_date(b) for b in (await enrol.sessions(series_id))[:4]
    )

    # Re-adding cannot push them past one cycle.
    await client.post(f"/api/v1/teacher/batches/{batch_ids[1]}/students",
                      json={"student_ids": [STUDENT]}, headers=admin)
    assert len(await _seats(STUDENT, series_id)) == enrol.SESSIONS_PER_CYCLE

    # Removing takes them off the course from here on, not off one sitting.
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[2]}/remove-student",
                          json={"student_id": STUDENT}, headers=admin)
    assert r.status_code == 200, r.text
    assert await _seats(STUDENT, series_id) == []


async def test_the_teacher_roster_shows_the_cycle_not_one_sitting(client):
    """`my-batches` (the teacher dashboard) carries every class the seat covers,
    so a one-month enrolment reads as four weeks, not one."""
    admin = await _admin_headers(client)
    student = await _student_headers(client)
    series_id, batch_ids = await _weekly_course()
    teacher_id = (await Batch.get(batch_ids[0])).teacher_id

    await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    r = await client.get(f"/api/v1/teacher/{teacher_id}/batches-manage", headers=admin)
    rows = [b for b in r.json()["data"] if b["series_id"] == series_id]
    assert rows[0]["sessions_per_cycle"] == 4
    assert len(rows[0]["series_session_dates"]) == 8
    pending = [p for p in rows[0]["pending"] if p["student_id"] == STUDENT][0]
    assert len(pending["session_dates"]) == 4

    await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/approve-join",
                      json={"student_id": STUDENT}, headers=admin)
    r = await client.get(f"/api/v1/teacher/{teacher_id}/batches-manage", headers=admin)
    rows = [b for b in r.json()["data"] if b["series_id"] == series_id]
    seated = [b for b in rows if any(s["student_id"] == STUDENT for s in b["students"])]
    assert len(seated) == 4  # the four sittings the seat covers…
    for b in seated:  # …and each row names them all, so the teacher sees the cycle
        s = [x for x in b["students"] if x["student_id"] == STUDENT][0]
        assert len(s["session_dates"]) == 4
