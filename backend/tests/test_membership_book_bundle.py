"""Membership Purchase & Activation workflow.

Choose Your Membership -> SpeakEdge Book -> one checkout -> one Razorpay
payment -> order confirmation + receipt, then Activation turns the plan the
buyer already paid for into their first Subscription.
"""
import io

import pytest
from PIL import Image

from app.core.security import Role, hash_password
from app.db.models import ActivationCode, BookOrder, Subscription, User

pytestmark = pytest.mark.asyncio


def _png() -> bytes:
    """A real image — uploads are re-encoded through Pillow."""
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(buf, format="PNG")
    return buf.getvalue()


PNG = _png()


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


async def _make_book(client, headers, *, sku="SPK-BOOK-1", speakedge=True, price=49900):
    r = await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "SpeakEdge Book", "sku": sku, "price": price, "stock": 10,
        "description": "The companion book for the SpeakEdge journey.",
        "is_speakedge_book": speakedge,
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def test_bundled_checkout_charges_plan_plus_book(client):
    headers = await _admin_headers(client)
    await _make_book(client, headers)

    # The checkout resolves the bundled book without being told its id.
    r = await client.get("/api/v1/books/speakedge")
    assert r.status_code == 200, r.text
    book = r.json()["data"]
    assert book["is_speakedge_book"] is True

    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    months = plan["durations"][0]
    # Joining charges the one-time admission fee — the monthly fee is billed
    # separately and must never be folded into the order.
    plan_price = plan["offer_price"] if plan["offer_price"] is not None else plan["amount"]

    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office", "accept_terms": True,
        "product_id": book["id"], "plan": plan["plan"], "months": months,
    })
    assert r.status_code == 200, r.text
    order = r.json()["data"]
    assert order["plan"] == plan["plan"]
    assert order["plan_amount"] == plan_price
    # One order, one amount: membership + book (+ GST, office pickup is free).
    assert order["amount"] == plan_price + book["sell_price"]

    # The receipt is downloadable as soon as the order exists.
    r = await client.get(f"/api/v1/books/receipt/{order['order_number']}?phone=9990001111")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")

    # ...but only to whoever knows the buyer's phone number.
    r = await client.get(f"/api/v1/books/receipt/{order['order_number']}?phone=9998887777")
    assert r.status_code == 404


async def test_speakedge_book_cannot_be_bought_without_a_membership(client):
    headers = await _admin_headers(client)
    book = await _make_book(client, headers)

    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office", "accept_terms": True,
        "product_id": book["id"],
    })
    assert r.status_code == 422
    assert "membership" in r.json()["error"]["message"].lower()


async def test_other_books_use_the_normal_purchase_flow(client):
    headers = await _admin_headers(client)
    other = await _make_book(client, headers, sku="SUJ-GRAMMAR", speakedge=False, price=29900)

    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Ravi K", "phone": "9995556666", "delivery_type": "office", "accept_terms": True,
        "product_id": other["id"],
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["amount"] == 29900
    assert r.json()["data"]["plan"] is None

    # And they cannot smuggle a membership into the order.
    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Ravi K", "phone": "9995556666", "delivery_type": "office", "accept_terms": True,
        "product_id": other["id"], "plan": plan["plan"], "months": plan["durations"][0],
    })
    assert r.status_code == 422


async def test_paid_plan_becomes_a_subscription_at_activation(client):
    headers = await _admin_headers(client)
    book = await _make_book(client, headers)
    r = await client.post("/api/v1/activation-codes/generate", json={"count": 1}, headers=headers)
    assert r.status_code == 200, r.text

    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    months = plan["durations"][0]
    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office", "accept_terms": True,
        "product_id": book["id"], "plan": plan["plan"], "months": months,
    })
    order = r.json()["data"]

    # Payment lands. Guest book orders reconcile server-side (webhook, or an
    # admin approving a payment taken outside Razorpay) — there is no student
    # session at this point in the journey.
    r = await client.post("/api/v1/payments/manual-approve", headers=headers, json={
        "order_id": order["order_id"], "payment_mode": "upi_manual",
        "transaction_ref": "TXN-1",
    })
    assert r.status_code == 200, r.text

    # The plan rides along on the activation code shipped with the book.
    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    code = await ActivationCode.find_one(ActivationCode.code == placed.activation_code)
    assert code.plan == plan["plan"] and code.plan_months == months

    # Activation is where it becomes a live subscription.
    r = await client.post("/api/v1/membership/activate", data={
        "code": code.code, "full_name": "Asha Rao", "password": "Student@123",
        "age": "24", "gender": "Female", "phone": "9990001111", "whatsapp": "9990001111",
        "address": "1 Main St", "state": "WB", "district": "Kolkata", "pin_code": "700001",
        "consent_community_rules": "true", "consent_terms": "true",
        "consent_safety_policy": "true", "consent_non_refund": "true",
        "consent_process": "true", "id_proof_type": "Aadhaar Card",
    }, files={
        "photo": ("p.png", PNG, "image/png"),
        "id_proof": ("id.png", PNG, "image/png"),
    })
    assert r.status_code == 200, r.text

    sub = await Subscription.find_one(Subscription.student_id == code.code)
    assert sub is not None and sub.is_active
    assert sub.plan == plan["plan"] and sub.months == months


async def test_activation_without_a_paid_plan_creates_no_subscription(client):
    """Codes sold outside the bundle still activate — just with no subscription."""
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/activation-codes/generate", json={"count": 1}, headers=headers)
    code = r.json()["data"]["codes"][0]

    r = await client.post("/api/v1/membership/activate", data={
        "code": code, "full_name": "Ravi K", "password": "Student@123",
        "age": "30", "gender": "Male", "phone": "9995556666", "whatsapp": "9995556666",
        "address": "2 Main St", "state": "WB", "district": "Kolkata", "pin_code": "700002",
        "consent_community_rules": "true", "consent_terms": "true",
        "consent_safety_policy": "true", "consent_non_refund": "true",
        "consent_process": "true", "id_proof_type": "Aadhaar Card",
    }, files={
        "photo": ("p.png", PNG, "image/png"),
        "id_proof": ("id.png", PNG, "image/png"),
    })
    assert r.status_code == 200, r.text
    assert await Subscription.find_one(Subscription.student_id == code) is None
