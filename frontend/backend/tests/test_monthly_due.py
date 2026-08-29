"""Monthly fee due dates: the schedule derived from the subscription start day,
and the /payments/monthly-due reminder that keeps firing until the fee is paid."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.db.models import Payment, PaymentStatus, PlanConfig, Subscription, User
from app.core.security import Role, hash_password
from app.modules.payments import monthly

pytestmark = pytest.mark.asyncio

STUDENT = "SPK-26-MONTH1"


def _span(started: datetime, expires: datetime) -> SimpleNamespace:
    """due_dates() only reads the two dates — no Beanie init needed here."""
    return SimpleNamespace(started_at=started, expires_at=expires)


async def test_due_dates_clamp_to_short_months():
    """A 31st start day lands on the last day of shorter months, then recovers."""
    span = _span(datetime(2026, 1, 31, tzinfo=timezone.utc),
                 datetime(2026, 5, 31, tzinfo=timezone.utc))
    assert [d.date().isoformat() for d in monthly.due_dates(span)] == [
        "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31",
    ]


async def test_no_dues_past_expiry():
    # Expires before the first monthly fee would fall due.
    span = _span(datetime(2026, 1, 10, tzinfo=timezone.utc),
                 datetime(2026, 2, 5, tzinfo=timezone.utc))
    assert monthly.due_dates(span) == []


async def _login(client) -> dict:
    await User(username=STUDENT, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=STUDENT).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": STUDENT, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _subscribe(client, plan: str, started_at: datetime) -> Subscription:
    await client.get("/api/v1/payments/plans")  # seeds PlanConfig
    sub = Subscription(
        student_id=STUDENT, plan=plan, started_at=started_at,
        expires_at=started_at + timedelta(days=365), is_active=True,
    )
    await sub.insert()
    return sub


async def test_tribe_has_no_monthly_fee(client):
    h = await _login(client)
    await _subscribe(client, "Tribe", datetime.now(timezone.utc) - timedelta(days=28))
    assert (await client.get("/api/v1/payments/monthly-due", headers=h)).json()["data"] is None


async def test_reminder_activates_three_days_before_due(client):
    h = await _login(client)
    # Started 1 month + 2 days ago -> the first fee falls due in ~2 days.
    await _subscribe(client, "Silver", datetime.now(timezone.utc) - timedelta(days=28))

    due = (await client.get("/api/v1/payments/monthly-due", headers=h)).json()["data"]
    assert due is not None
    cfg = await PlanConfig.find_one(PlanConfig.plan == "Silver")
    assert due["amount"] == cfg.monthly_fee
    assert 0 <= due["days_until"] <= monthly.REMINDER_DAYS
    assert due["reminder_active"] is True
    assert due["overdue"] is False


async def test_due_is_outside_the_window_early_in_the_month(client):
    h = await _login(client)
    await _subscribe(client, "Silver", datetime.now(timezone.utc) - timedelta(days=5))

    due = (await client.get("/api/v1/payments/monthly-due", headers=h)).json()["data"]
    assert due["reminder_active"] is False, "should not nag ~25 days out"


async def test_overdue_month_keeps_being_returned_then_clears_when_paid(client):
    h = await _login(client)
    await _subscribe(client, "Silver", datetime.now(timezone.utc) - timedelta(days=40))

    due = (await client.get("/api/v1/payments/monthly-due", headers=h)).json()["data"]
    assert due["overdue"] is True and due["reminder_active"] is True
    first_month = due["due_month"]

    # An unpaid order does not settle the month.
    r = await client.post("/api/v1/payments/monthly-order", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["due_month"] == first_month
    still = (await client.get("/api/v1/payments/monthly-due", headers=h)).json()["data"]
    assert still["due_month"] == first_month

    # Once the payment is marked paid, the reminder rolls to the next month.
    payment = await Payment.find_one(Payment.student_id == STUDENT, Payment.kind == "monthly")
    payment.status = PaymentStatus.paid
    await payment.save()

    nxt = (await client.get("/api/v1/payments/monthly-due", headers=h)).json()["data"]
    assert nxt["due_month"] != first_month
    assert nxt["reminder_active"] is False
