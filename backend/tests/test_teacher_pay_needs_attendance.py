"""A teacher is paid for a class they took, not for a class they were assigned.

The bug this covers: the scheduler credited `Batch.teacher_cost_paise` as soon
as a class date passed. A teacher with a batch on the calendar — no students,
no attendance, no class — showed earnings on their dashboard and an amount to
pay under Admin -> Teacher Payouts.
"""
from datetime import datetime, timedelta

import pytest

from app.db.models import Attendance, Batch, Remuneration, Teacher
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
