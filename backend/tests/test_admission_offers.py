"""New Student Offer: a temporary discounted admission fee on a shareable link.

Admin picks plan + offer price + validity (24/48/72h) and gets a unique payment
link. While it is live the guest checkout charges the offer price; once it
expires the link stops resolving (the frontend then sends the visitor to the
regular Membership Plans page) and the catalogue price applies again.
"""
from datetime import timedelta

import pytest

from app.core.security import Role, hash_password
from app.db.base import utcnow
from app.db.models import ActivationCode, AdmissionOffer, BookOrder, User

pytestmark = pytest.mark.asyncio


async def _admin_headers(client):
    await User(
        username="admin@speakedge.in", email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"), role=Role.super_admin,
        full_name="Super Admin",
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _plan(client):
    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    plan["list_price"] = plan["offer_price"] if plan["offer_price"] is not None else plan["amount"]
    return plan


async def _make_offer(client, headers, plan, *, price, valid_hours=48):
    r = await client.post("/api/v1/payments/admin/admission-offers", headers=headers, json={
        "plan": plan["plan"], "price": price, "valid_hours": valid_hours,
        "student_name": "Asha Rao", "phone": "9990001111",
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def test_offer_link_prices_the_guest_checkout(client):
    headers = await _admin_headers(client)
    plan = await _plan(client)
    await ActivationCode(code="SPK-OFFER-1").insert()

    offer = await _make_offer(client, headers, plan, price=plan["list_price"] // 2)
    assert offer["token"] and offer["live"] is True
    assert offer["list_price"] == plan["list_price"]

    # Public: the link resolves to the plan and the discounted fee.
    r = await client.get(f"/api/v1/payments/admission-offers/{offer['token']}")
    assert r.status_code == 200, r.text
    view = r.json()["data"]
    assert (view["plan"], view["price"]) == (plan["plan"], offer["price"])

    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office",
        "accept_terms": True, "plan": plan["plan"], "months": 12, "offer": offer["token"],
    })
    assert r.status_code == 200, r.text
    order = r.json()["data"]
    # The offer replaces the admission fee — and only the admission fee.
    assert order["plan_amount"] == offer["price"] < plan["list_price"]
    assert order["amount"] == offer["price"]

    r = await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"], "phone": "9990001111",
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_1",
        "razorpay_signature": "test",
    })
    assert r.status_code == 200, r.text

    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    assert placed.offer_token == offer["token"]

    # The purchase is counted against the link so admin can see it converted.
    rows = (await client.get("/api/v1/payments/admin/admission-offers",
                             headers=headers)).json()["data"]["offers"]
    assert rows[0]["uses"] == 1
    assert rows[0]["order_numbers"] == [order["order_number"]]


async def test_expired_link_stops_resolving_and_stops_discounting(client):
    headers = await _admin_headers(client)
    plan = await _plan(client)
    offer = await _make_offer(client, headers, plan, price=plan["list_price"] // 2,
                              valid_hours=24)

    doc = await AdmissionOffer.find_one(AdmissionOffer.token == offer["token"])
    doc.expires_at = utcnow() - timedelta(minutes=1)
    await doc.save()

    # The link 404s — the frontend's cue to send the visitor to /plans.
    assert (await client.get(
        f"/api/v1/payments/admission-offers/{offer['token']}")).status_code == 404

    # And the price is gone: the checkout refuses rather than quietly charging
    # the full fee on an order the buyer started at the offer price.
    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office",
        "accept_terms": True, "plan": plan["plan"], "months": 12, "offer": offer["token"],
    })
    assert r.status_code == 422
    assert "expired" in r.json()["error"]["message"].lower()

    # Without the token the ordinary catalogue price applies as before.
    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office",
        "accept_terms": True, "plan": plan["plan"], "months": 12,
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["plan_amount"] == plan["list_price"]


async def test_revoked_link_is_dead_immediately(client):
    headers = await _admin_headers(client)
    plan = await _plan(client)
    offer = await _make_offer(client, headers, plan, price=plan["list_price"] // 2)

    r = await client.delete(f"/api/v1/payments/admin/admission-offers/{offer['id']}",
                            headers=headers)
    assert r.status_code == 200, r.text
    assert (await client.get(
        f"/api/v1/payments/admission-offers/{offer['token']}")).status_code == 404


async def test_offer_price_must_actually_be_a_discount(client):
    headers = await _admin_headers(client)
    plan = await _plan(client)

    r = await client.post("/api/v1/payments/admin/admission-offers", headers=headers, json={
        "plan": plan["plan"], "price": plan["list_price"], "valid_hours": 24,
    })
    assert r.status_code == 422

    # 24/48/72 hours only — a link is a short promise, never open-ended.
    r = await client.post("/api/v1/payments/admin/admission-offers", headers=headers, json={
        "plan": plan["plan"], "price": 100, "valid_hours": 720,
    })
    assert r.status_code == 422


async def test_offer_is_scoped_to_its_own_plan(client):
    headers = await _admin_headers(client)
    plans = (await client.get("/api/v1/payments/plans")).json()["data"]
    plan, other = plans[0], plans[1]
    offer = await _make_offer(client, headers, await _plan(client),
                              price=(plan["offer_price"] or plan["amount"]) // 2)

    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office",
        "accept_terms": True, "plan": other["plan"], "months": 12, "offer": offer["token"],
    })
    assert r.status_code == 422
    assert "does not apply" in r.json()["error"]["message"].lower()


async def test_offer_links_are_admin_only(client):
    assert (await client.get("/api/v1/payments/admin/admission-offers")).status_code == 401
    assert (await client.post("/api/v1/payments/admin/admission-offers",
                              json={"plan": "Tribe", "price": 100,
                                    "valid_hours": 24})).status_code == 401
