"""A teacher is paid for a class they took, not for a class they were assigned.

The bug this covers: the scheduler credited `Batch.teacher_cost_paise` as soon
as a class date passed. A teacher with a batch on the calendar — no students,
no attendance, no class — showed earnings on their dashboard and an amount to
pay under Admin -> Teacher Payouts.
"""
from datetime import datetime, timedelta

import pytest
from beanie import PydanticObjectId

from app.core.security import Role, hash_password
from app.db import fix_phantom_remuneration as cleanup
from app.db.models import Attendance, Batch, Remuneration, Teacher, User
from app.shared import batch_enrolment as enrol
from app.shared.scheduler import credit_completed_batches
from tests.test_weekly_batch_enrolment import _admin_headers

pytestmark = pytest.mark.asyncio

COST = 50000


async def _past_batch() -> tuple[Batch, str]:
    teacher = Teacher(name="Rahul Sen", phone="9998887777", whatsapp="9998887777",
                      email="rahul@speakedge.in", city="Kolkata",
                      qualification="MA English", cefr_level="C1",
                      teacher_id="TCH-26-AAA111", status="approved")
    await teacher.insert()
    date = (datetime.now(enrol.IST).date() - timedelta(days=3)).isoformat()
    batch = Batch(teacher_id=str(teacher.id), title="Evening Speaking",
                  class_dates=[date], teacher_cost_paise=COST)
    await batch.insert()
    return batch, date


async def _attendance(batch: Batch, date: str, **kw) -> Attendance:
    att = Attendance(batch_id=str(batch.id), teacher_id=batch.teacher_id, date=date, **kw)
    await att.insert()
    return att


async def test_an_assigned_batch_with_no_attendance_earns_nothing(client):
    admin = await _admin_headers(client)
    await _past_batch()
    await credit_completed_batches()
    assert await Remuneration.count() == 0
    data = (await client.get("/api/v1/teacher/admin/monthly-payouts", headers=admin)).json()["data"]
    assert data["teachers"] == [] and data["totals"]["total_paise"] == 0


async def test_pending_rejected_and_not_held_attendance_earn_nothing(client):
    batch, date = await _past_batch()
    await _attendance(batch, date, present_ids=["S1"], status="rejected")
    await _attendance(batch, date, present_ids=["S1"])  # pending admin verification
    await credit_completed_batches()
    assert await Remuneration.count() == 0

    await Attendance.find_all().delete()
    await _attendance(batch, date, class_held=False, status="approved", approved=True)
    await credit_completed_batches()
    assert await Remuneration.count() == 0


async def test_an_approved_class_is_credited_exactly_once(client):
    batch, date = await _past_batch()
    att = await _attendance(batch, date, present_ids=["S1"], status="approved", approved=True)
    await credit_completed_batches()
    await credit_completed_batches()
    rems = await Remuneration.find_all().to_list()
    assert [(r.amount, r.period, r.attendance_id) for r in rems] == [(COST, date, str(att.id))]


async def test_deploying_onto_existing_data_credits_nothing_retroactively(client):
    """What production looks like on the first run of the new job: dates the old
    job already credited, and attendance on a date outside the schedule."""
    batch, date = await _past_batch()
    await _attendance(batch, date, present_ids=["S1"], status="approved", approved=True)
    await _attendance(batch, "2026-01-05", present_ids=["S1"], status="approved", approved=True)
    await Remuneration(teacher_id=batch.teacher_id, period=date, amount=COST).insert()
    batch.cost_credited_dates = [date]
    await batch.save()
    await credit_completed_batches()
    assert await Remuneration.count() == 1


async def test_approval_with_an_amount_is_not_credited_again_by_the_scheduler(client):
    admin = await _admin_headers(client)
    batch, date = await _past_batch()
    att = await _attendance(batch, date, present_ids=["S1"])
    r = await client.post(f"/api/v1/teacher/attendance/{att.id}/review", headers=admin,
                          json={"action": "approve", "remuneration_paise": COST})
    assert r.status_code == 200, r.text
    await credit_completed_batches()
    assert await Remuneration.count() == 1


async def test_a_class_reported_as_not_held_cannot_be_paid(client):
    admin = await _admin_headers(client)
    batch, date = await _past_batch()
    att = await _attendance(batch, date, class_held=False)
    r = await client.post(f"/api/v1/teacher/attendance/{att.id}/review", headers=admin,
                          json={"action": "approve", "remuneration_paise": COST})
    assert r.status_code == 200, r.text
    assert await Remuneration.count() == 0
    r = await client.post(f"/api/v1/teacher/attendance/{att.id}/credit-remuneration",
                          headers=admin, json={"amount_paise": COST})
    assert r.status_code == 409


async def _run_cleanup(monkeypatch, dry: bool = False) -> None:
    async def _noop() -> None:
        return None
    monkeypatch.setattr(cleanup, "init_db", _noop)
    monkeypatch.setattr(cleanup, "close_db", _noop)
    await cleanup.fix(dry=dry)


async def test_cleanup_removes_only_pay_with_no_class_behind_it(client, monkeypatch):
    batch, date = await _past_batch()
    taken = (datetime.now(enrol.IST).date() - timedelta(days=4)).isoformat()
    settled = (datetime.now(enrol.IST).date() - timedelta(days=5)).isoformat()
    batch.class_dates = [settled, taken, date]
    batch.cost_credited_dates = [settled, taken, date]
    await batch.save()
    att = await _attendance(batch, taken, present_ids=["S1"], status="approved", approved=True)
    tid = batch.teacher_id
    phantom = await Remuneration(teacher_id=tid, period=date, amount=COST).insert()
    real = await Remuneration(teacher_id=tid, period=taken, amount=COST).insert()
    paid = await Remuneration(teacher_id=tid, period=settled, amount=COST, status="paid").insert()
    manual = await Remuneration(teacher_id=tid, period="2026-10", amount=COST).insert()

    await _run_cleanup(monkeypatch, dry=True)
    assert await Remuneration.count() == 4
    assert (await Remuneration.get(real.id)).attendance_id is None

    await _run_cleanup(monkeypatch)
    assert await Remuneration.get(phantom.id) is None
    assert (await Remuneration.get(real.id)).attendance_id == str(att.id)
    assert (await Remuneration.get(paid.id)).status == "paid"
    assert await Remuneration.get(manual.id) is not None
    batch = await Batch.get(batch.id)
    assert sorted(batch.cost_credited_dates) == sorted([settled, taken])

    # The cleared date earns normally once the class really is taken...
    await _attendance(batch, date, present_ids=["S1"], status="approved", approved=True)
    # ...and attendance filed late for the already-paid date does not pay it twice.
    await _attendance(batch, settled, present_ids=["S1"], status="approved", approved=True)
    await credit_completed_batches()
    assert await Remuneration.find(Remuneration.period == date).count() == 1
    assert await Remuneration.find(Remuneration.period == settled).count() == 1


async def test_both_screens_stay_at_zero_until_a_class_is_taken_and_approved(client):
    """The reported scenario end to end: Teacher Earnings and Admin -> Teacher
    Payouts read nothing for an assigned batch, and the amount only for a class
    the teacher reported and admin approved."""
    admin = await _admin_headers(client)
    batch, date = await _past_batch()
    await Teacher.find_one(Teacher.id == PydanticObjectId(batch.teacher_id)).update(
        {"$set": {"username": "rahul"}})
    await User(username="rahul", email="rahul@speakedge.in", full_name="Rahul Sen",
               password_hash=hash_password("Teacher@12345"), role=Role.teacher,
               student_id="rahul").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "rahul", "password": "Teacher@12345"})
    assert r.status_code == 200, r.text
    teacher = {"Authorization": f"Bearer {r.json()['data']['access_token']}"}

    async def screens() -> tuple[int, int, int, int]:
        d = (await client.get("/api/v1/teacher/dashboard", headers=teacher)).json()["data"]
        mine = (await client.get("/api/v1/teacher/my-remuneration", headers=teacher)).json()["data"]
        p = (await client.get("/api/v1/teacher/admin/monthly-payouts", headers=admin)).json()["data"]
        return (d["earnings"]["pending_paise"], sum(x["amount"] for x in mine),
                d["analytics"]["classes_approved"], p["totals"]["total_paise"])

    await credit_completed_batches()
    assert await screens() == (0, 0, 0, 0)

    r = await client.post("/api/v1/teacher/attendance", headers=teacher,
                          json={"batch_id": str(batch.id), "date": date, "present_ids": ["S1"]})
    assert r.status_code == 200, r.text
    await credit_completed_batches()
    assert await screens() == (0, 0, 0, 0)  # submitted, not yet verified

    att = await Attendance.find_one(Attendance.batch_id == str(batch.id))
    r = await client.post(f"/api/v1/teacher/attendance/{att.id}/review", headers=admin,
                          json={"action": "approve"})
    assert r.status_code == 200, r.text
    await credit_completed_batches()
    assert await screens() == (COST, COST, 1, COST)
