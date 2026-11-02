"""An unpaid monthly fee and the teacher-led class it pays for.

The bug this covers: a student opened the monthly-fee checkout, cancelled it,
then asked to join a class — and admin approved, because nothing on the join
request said the fee was still due. So: an overdue fee refuses the request
outright, the admin queue shows what each requester owes, and a checkout nobody
completed no longer sits in the payments list looking like a payment.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.db.models import Attendance, Batch, Payment, PaymentStatus, Subscription
from app.modules.payments import monthly
from tests.test_weekly_batch_enrolment import (
    STUDENT,
    _admin_headers,
    _student_headers,
    _weekly_course,
)

pytestmark = pytest.mark.asyncio


async def _backdate(client, *, days: int, class_started: bool) -> Subscription:
    """Move the Gold membership's start `days` back. With `class_started` the
    student also attended a class that first day, so month 1 is owed."""
    await client.get("/api/v1/payments/plans")  # seeds PlanConfig
    sub = await Subscription.find_one(Subscription.student_id == STUDENT)
    sub.started_at = datetime.now(timezone.utc) - timedelta(days=days)
    sub.billing_start_at = sub.started_at if class_started else None
    await sub.save()
    if class_started:
        await Attendance(batch_id="B0", date=f"{sub.started_at:%Y-%m-%d}", present_ids=[STUDENT],
                         status="approved", approved=True).insert()
    return sub


async def test_overdue_fee_blocks_a_join_request_until_it_is_paid(client):
    student = await _student_headers(client)
    _, batch_ids = await _weekly_course()
    await _backdate(client, days=40, class_started=True)

    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    assert r.status_code == 403, r.text
    assert "monthly fee" in r.json()["message"]
    assert not (await Batch.get(batch_ids[0])).pending_ids  # nothing reached admin

    data = (await client.get("/api/v1/teacher/browse-batches", headers=student)).json()["data"]
    assert data["fee_due"]["overdue"] is True
    assert data["can_join"] is False

    # A checkout that was opened and abandoned settles nothing…
    due = await monthly.next_due(STUDENT)
    pay = Payment(student_id=STUDENT, kind="monthly", plan="Gold", amount=due["amount"],
                  due_month=due["due_month"], razorpay_order_id="order_test_abandoned")
    await pay.insert()
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    assert r.status_code == 403

    # …and once the fee is really paid the same request goes through.
    pay.status = PaymentStatus.paid
    await pay.save()
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    assert r.status_code == 200, r.text


async def test_a_fee_only_coming_up_does_not_block(client):
    student = await _student_headers(client)
    _, batch_ids = await _weekly_course()
    await _backdate(client, days=10, class_started=True)
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    assert r.status_code == 200, r.text


async def test_a_member_who_never_had_a_class_can_request_their_first(client):
    """No class ever attended: nothing is owed, however long ago they joined."""
    student = await _student_headers(client)
    _, batch_ids = await _weekly_course()
    await _backdate(client, days=40, class_started=False)
    r = await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    assert r.status_code == 200, r.text


async def test_admin_sees_the_due_on_the_join_request(client):
    admin = await _admin_headers(client)
    student = await _student_headers(client)
    series_id, batch_ids = await _weekly_course()
    await client.post(f"/api/v1/teacher/batches/{batch_ids[0]}/request-join", headers=student)
    # The fee falls overdue while the request is still waiting on admin.
    await _backdate(client, days=40, class_started=True)

    rows = (await client.get("/api/v1/teacher/admin/batches", headers=admin)).json()["data"]
    course = [r for r in rows if r["series_id"] == series_id][0]
    fee = [p for p in course["pending"] if p["student_id"] == STUDENT][0]["fee_due"]
    assert fee["overdue"] is True and fee["amount"] > 0 and fee["due_date"]

    profile = (await client.get(f"/api/v1/teacher/admin/batches/{batch_ids[0]}/profile",
                                headers=admin)).json()["data"]
    assert profile["pending"][0]["fee_due"]["overdue"] is True


async def test_abandoned_checkouts_stay_out_of_the_default_payments_list(client):
    admin = await _admin_headers(client)
    await Payment(student_id=STUDENT, kind="monthly", plan="Gold", amount=100000,
                  razorpay_order_id="order_test_abandoned").insert()
    await Payment(student_id=STUDENT, kind="monthly", plan="Gold", amount=100000,
                  razorpay_order_id="order_test_paid", status=PaymentStatus.paid).insert()

    listed = (await client.get("/api/v1/payments/admin/all", headers=admin)).json()["data"]
    assert [p["razorpay_order_id"] for p in listed["items"]] == ["order_test_paid"]
    asked = (await client.get("/api/v1/payments/admin/all?status=created",
                              headers=admin)).json()["data"]
    assert [p["razorpay_order_id"] for p in asked["items"]] == ["order_test_abandoned"]
