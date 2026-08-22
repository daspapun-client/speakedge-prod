"""Membership upgrades and downgrades (spec: Membership Upgrade — Payment
Calculation, Facilities After Upgrade, Activation Date, How Downgrade Works).

Four rules are asserted here, because each of them is easy to break silently:

* an upgrade costs the **standard** price difference — a discount the learner
  once received never changes it;
* the upgraded membership starts on the date the learner picks (up to 30 days
  out) and the old one runs untouched until then;
* benefits carry forward — the new tier's entitlements are counted from the
  first membership start, not restarted;
* only Pro tiers downgrade, and only from the next monthly payment cycle.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, hash_password
from app.db.models import PlanConfig, Student, Subscription, User
from app.modules.payments import service as pay

pytestmark = pytest.mark.asyncio

STUDENT = "SPK-26-PLAN01"


async def _student_headers(client):
    await Student(student_id=STUDENT, full_name="Asha Rao", phone="9990001111").insert()
    await User(username=STUDENT, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=STUDENT).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": STUDENT, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _subscribe(plan: str, *, started_days_ago: int = 0) -> Subscription:
    started = datetime.now(timezone.utc) - timedelta(days=started_days_ago)
    sub = Subscription(student_id=STUDENT, plan=plan, started_at=started,
                       expires_at=started + timedelta(days=365), is_active=True,
                       months=12)
    await sub.insert()
    return sub


async def _plans(client) -> dict:
    return {p["plan"]: p for p in (await client.get("/api/v1/payments/plans")).json()["data"]}


async def _pay(client, headers, **body) -> dict:
    order = (await client.post("/api/v1/payments/order", headers=headers,
                               json={"accept_terms": True, "months": 12, **body})).json()["data"]
    r = await client.post("/api/v1/payments/verify", headers=headers, json={
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_plan",
        "razorpay_signature": "test",
    })
    assert r.status_code == 200, r.text
    return order


async def _current(client, headers) -> dict:
    return (await client.get("/api/v1/subscription/current", headers=headers)).json()["data"]


# ---------------------------------------------------------------------------
# Price = standard difference
# ---------------------------------------------------------------------------
async def test_upgrade_price_ignores_a_discount_the_learner_received(client):
    """Tribe bought on a discounted admission offer still credits the standard
    Tribe fee, and a discounted Basic still costs its standard price."""
    student = await _student_headers(client)
    plans = await _plans(client)
    tribe, basic = plans["Tribe"]["amount"], plans["Basic"]["amount"]
    # A catalogue discount on both ends: neither may move the upgrade price.
    await PlanConfig.find_one(PlanConfig.plan == "Tribe").update(
        {"$set": {"offer_price": 49900}})
    await PlanConfig.find_one(PlanConfig.plan == "Basic").update(
        {"$set": {"offer_price": 99900}})
    await _subscribe("Tribe")

    quote = (await client.get("/api/v1/payments/upgrade-quote",
                              params={"plan": "Basic"}, headers=student)).json()["data"]
    assert quote["is_upgrade"] is True
    assert (quote["admission"], quote["adjustment"]) == (basic, tribe)
    assert quote["payable"] == basic - tribe

    order = await _pay(client, student, plan="Basic")
    assert order["amount"] == basic - tribe


# ---------------------------------------------------------------------------
# Activation date
# ---------------------------------------------------------------------------
async def test_upgrade_starts_immediately_when_no_date_is_chosen(client):
    student = await _student_headers(client)
    await _plans(client)
    await _subscribe("Silver")

    await _pay(client, student, plan="Gold")
    assert (await _current(client, student))["plan"] == "Gold"


async def test_chosen_activation_date_keeps_the_current_membership_running(client):
    """The upgraded tier waits; the membership held stays active until the day,
    which is exactly what the pre-payment notice promises."""
    student = await _student_headers(client)
    await _plans(client)
    await _subscribe("Silver")
    when = (datetime.now(timezone.utc) + timedelta(days=10)).strftime("%Y-%m-%d")

    order = await _pay(client, student, plan="Gold", activate_on=when)
    assert order["activate_on"].startswith(when)

    current = await _current(client, student)
    assert current["plan"] == "Silver"          # unchanged, benefits still running
    assert current["pending_plan"] == "Gold"

    state = (await client.get("/api/v1/payments/plan-change", headers=student)).json()["data"]
    assert state["pending"]["kind"] == "upgrade"
    assert state["pending"]["cancellable"] is False   # it has been paid for

    # A paid upgrade cannot be called off from the student side.
    assert (await client.delete("/api/v1/payments/plan-change", headers=student)).status_code == 409

    # The scheduler switches it over on the day.
    sub = await pay.active_subscription(STUDENT)
    sub.pending_plan_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await sub.save()
    assert await pay.apply_due_plan_changes() == 1
    assert (await _current(client, student))["plan"] == "Gold"
    assert await pay.apply_due_plan_changes() == 0   # never applied twice


async def test_activation_date_beyond_thirty_days_is_refused(client):
    student = await _student_headers(client)
    await _plans(client)
    await _subscribe("Silver")
    when = (datetime.now(timezone.utc) + timedelta(days=31)).strftime("%Y-%m-%d")

    r = await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Gold", "months": 12, "accept_terms": True, "activate_on": when,
    })
    assert r.status_code == 422
    assert "30 days" in r.json()["error"]["message"]


# ---------------------------------------------------------------------------
# Benefits carry forward
# ---------------------------------------------------------------------------
async def test_upgrade_carries_forward_the_time_already_consumed(client):
    """Six months into Basic, upgrading to Diamond does not restart the clock:
    the entitlement window still counts from the original membership start."""
    student = await _student_headers(client)
    await _plans(client)
    original = await _subscribe("Basic", started_days_ago=182)

    await _pay(client, student, plan="Diamond")
    sub = await pay.active_subscription(STUDENT)
    assert sub.plan == "Diamond"
    assert pay.monthly.as_utc(sub.benefits_start_at).date() \
        == pay.monthly.as_utc(original.started_at).date()
    # ~183 days left of the year, not a fresh 365.
    left = (pay.monthly.as_utc(sub.expires_at) - datetime.now(timezone.utc)).days
    assert 175 <= left <= 190


async def test_a_renewal_starts_a_fresh_window(client):
    """Only a plan change carries usage forward — buying the same plan again is
    a renewal and must not inherit a nearly-spent year."""
    student = await _student_headers(client)
    await _plans(client)
    await _subscribe("Silver", started_days_ago=300)

    await _pay(client, student, plan="Silver")
    sub = await pay.active_subscription(STUDENT)
    assert (pay.monthly.as_utc(sub.expires_at) - datetime.now(timezone.utc)).days >= 360


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------
async def test_pro_downgrade_takes_effect_from_the_next_monthly_cycle(client):
    student = await _student_headers(client)
    await _plans(client)
    # Half way through a monthly cycle: the Pro benefits run to the end of it.
    sub = await _subscribe("Silver Pro", started_days_ago=15)

    state = (await client.get("/api/v1/payments/plan-change", headers=student)).json()["data"]
    assert state["downgrade"]["plan"] == "Silver"

    state = (await client.post("/api/v1/payments/downgrade", headers=student)).json()["data"]
    effective = datetime.fromisoformat(state["pending"]["effective_at"])
    assert state["pending"]["kind"] == "downgrade"
    assert effective > datetime.now(timezone.utc)
    assert (await _current(client, student))["plan"] == "Silver Pro"   # still Pro today

    # Cancelling is allowed while nobody has paid for it.
    state = (await client.delete("/api/v1/payments/plan-change",
                                 headers=student)).json()["data"]
    assert state["pending"] is None

    # And when the cycle arrives, the standard tier takes over.
    await client.post("/api/v1/payments/downgrade", headers=student)
    sub = await pay.active_subscription(STUDENT)
    sub.pending_plan_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await sub.save()
    await pay.apply_due_plan_changes()
    after = await pay.active_subscription(STUDENT)
    assert after.plan == "Silver"
    assert after.benefits_start_at is not None       # usage carried, not restarted


async def test_only_pro_memberships_can_be_downgraded(client):
    student = await _student_headers(client)
    await _plans(client)
    await _subscribe("Gold")

    state = (await client.get("/api/v1/payments/plan-change", headers=student)).json()["data"]
    assert state["downgrade"] is None
    r = await client.post("/api/v1/payments/downgrade", headers=student)
    assert r.status_code == 422
