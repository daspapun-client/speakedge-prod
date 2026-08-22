"""Dashboard exclusive offers: a targeted price (e.g. Silver at ₹500) is what
the member is quoted and charged — not the catalogue upgrade difference.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, hash_password
from app.db.models import Student, Subscription, User

pytestmark = pytest.mark.asyncio

STUDENT = "SPK-26-OFFR01"
OFFER_PAISE = 50000  # ₹500


async def _admin(client):
    await User(username="admin@speakedge.in", email="admin@speakedge.in",
               password_hash=hash_password("Admin@12345"), role=Role.super_admin,
               full_name="Super Admin").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _student(client):
    await Student(student_id=STUDENT, full_name="Asha Rao", phone="9990001111").insert()
    await User(username=STUDENT, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=STUDENT).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": STUDENT, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _subscribe(plan: str) -> Subscription:
    now = datetime.now(timezone.utc)
    sub = Subscription(student_id=STUDENT, plan=plan, started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True, months=12)
    await sub.insert()
    return sub


async def _offer(client, admin, **extra) -> dict:
    body = {
        "title": "Silver for you", "body": "Upgrade at 500",
        "offer_type": "subscription_upgrade", "plan": "Silver",
        "amount": OFFER_PAISE, "target_student_ids": [STUDENT], "active": True,
        **extra,
    }
    r = await client.post("/api/v1/admin/offers", headers=admin, json=body)
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def test_member_offer_prices_the_upgrade_not_the_catalogue(client):
    admin, student = await _admin(client), await _student(client)
    await client.get("/api/v1/payments/plans")
    await _subscribe("Tribe")
    offer = await _offer(client, admin)

    standard = (await client.get("/api/v1/payments/upgrade-quote",
                                 params={"plan": "Silver"}, headers=student)).json()["data"]
    assert standard["is_upgrade"] is True
    assert standard["payable"] > OFFER_PAISE

    quoted = (await client.get("/api/v1/payments/upgrade-quote",
                               params={"plan": "Silver", "offer": offer["id"]},
                               headers=student)).json()["data"]
    assert quoted["payable"] == OFFER_PAISE
    assert quoted["list_price"] == standard["payable"]
    assert quoted["offer_id"] == offer["id"]

    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "accept_terms": True, "plan": "Silver", "months": 12, "offer": offer["id"],
    })).json()["data"]
    assert order["amount"] == OFFER_PAISE
    assert order["plan_amount"] == OFFER_PAISE


async def test_member_offer_wrong_plan_is_refused(client):
    admin, student = await _admin(client), await _student(client)
    await client.get("/api/v1/payments/plans")
    await _subscribe("Tribe")
    offer = await _offer(client, admin)

    r = await client.get("/api/v1/payments/upgrade-quote",
                         params={"plan": "Gold", "offer": offer["id"]}, headers=student)
    assert r.status_code == 422

    r = await client.post("/api/v1/payments/order", headers=student, json={
        "accept_terms": True, "plan": "Gold", "months": 12, "offer": offer["id"],
    })
    assert r.status_code == 422


async def test_member_offer_without_token_still_charges_catalogue(client):
    admin, student = await _admin(client), await _student(client)
    await client.get("/api/v1/payments/plans")
    await _subscribe("Tribe")
    await _offer(client, admin)

    standard = (await client.get("/api/v1/payments/upgrade-quote",
                                 params={"plan": "Silver"}, headers=student)).json()["data"]
    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "accept_terms": True, "plan": "Silver", "months": 12,
    })).json()["data"]
    assert order["amount"] == standard["payable"] != OFFER_PAISE
