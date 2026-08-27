"""Membership Purchase & Activation workflow.

Choose Your Membership -> SpeakEdge Book -> one checkout -> one Razorpay
payment -> order confirmation + receipt, then Activation turns the plan the
buyer already paid for into their first Subscription.
"""
import io
from datetime import date

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


async def test_bundled_checkout_charges_the_plan_and_ships_the_book_free(client):
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
    # One order, one amount: the membership fee covers the book, so the copy
    # ships without a book line, GST on one, or (on pickup) a delivery charge.
    assert order["book_amount"] == 0
    assert order["gst_amount"] == 0
    assert order["amount"] == plan_price

    # The receipt is downloadable as soon as the order exists.
    r = await client.get(f"/api/v1/books/receipt/{order['order_number']}?phone=9990001111")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")

    # ...but only to whoever knows the buyer's phone number.
    r = await client.get(f"/api/v1/books/receipt/{order['order_number']}?phone=9998887777")
    assert r.status_code == 404


async def test_membership_only_checkout_when_no_speakedge_book_is_configured(client):
    """No book flagged as the SpeakEdge Book: /plans -> Subscribe must still sell
    the membership rather than dead-end. Nothing ships, so no book price and no
    delivery charge, and the order goes straight to activation."""
    assert (await client.get("/api/v1/books/speakedge")).status_code == 404
    await ActivationCode(code="SPK-FREEPOOL-1").insert()

    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    plan_price = plan["offer_price"] if plan["offer_price"] is not None else plan["amount"]

    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990002222", "delivery_type": "office",
        "accept_terms": True, "plan": plan["plan"], "months": 12,
        "address_line1": "12 MG Road", "pin_code": "700001",
    })
    assert r.status_code == 200, r.text
    order = r.json()["data"]
    assert (order["book_amount"], order["delivery_charge"], order["gst_amount"]) == (0, 0, 0)
    assert order["amount"] == plan_price == order["plan_amount"]

    # Demo mode issues an order_test_* id it accepts without a signature.
    r = await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"], "phone": "9990002222",
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_1",
        "razorpay_signature": "test",
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["paid"] is True

    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    assert placed.status.value == "Membership Activation Pending"
    assert placed.activation_code == "SPK-FREEPOOL-1"  # rides the plan to activation
    assert placed.pickup_otp is None  # nothing to collect

    r = await client.get(f"/api/v1/books/receipt/{order['order_number']}?phone=9990002222")
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


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

    # Guest verify path (demo keys — no Razorpay signature required).
    order = r.json()["data"]
    r = await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"],
        "phone": "9995556666",
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_test_guest",
        "razorpay_signature": "test",
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["paid"] is True

    # And they cannot smuggle a membership into the order.
    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Ravi K", "phone": "9995556666", "delivery_type": "office", "accept_terms": True,
        "product_id": other["id"], "plan": plan["plan"], "months": plan["durations"][0],
    })
    assert r.status_code == 422


async def test_a_plain_book_order_does_not_burn_an_activation_code(client):
    """Only a membership rides on a code. Reserving one for an ordinary book
    would hand the buyer a free membership and drain the pool."""
    headers = await _admin_headers(client)
    other = await _make_book(client, headers, sku="SUJ-ESSAYS", speakedge=False, price=19900)
    await client.post("/api/v1/activation-codes/generate", json={"count": 2}, headers=headers)

    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Ravi K", "phone": "9995550000", "delivery_type": "office",
        "accept_terms": True, "product_id": other["id"],
    })
    order = r.json()["data"]
    await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"], "phone": "9995550000",
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_test_plain", "razorpay_signature": "test",
    })

    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    assert placed.activation_code is None
    assert await ActivationCode.find({"status": "unused"}).count() == 2


async def test_stock_is_held_from_checkout_not_from_payment(client):
    """Two buyers must not both be able to pay for the last copy."""
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "Last Copy", "sku": "SUJ-LAST", "price": 10000, "stock": 1,
    })
    product = r.json()["data"]

    first = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "A", "phone": "9990000001", "delivery_type": "office",
        "accept_terms": True, "product_id": product["id"],
    })
    assert first.status_code == 200, first.text

    second = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "B", "phone": "9990000002", "delivery_type": "office",
        "accept_terms": True, "product_id": product["id"],
    })
    assert second.status_code == 409
    assert "stock" in second.json()["error"]["message"].lower()


async def test_an_abandoned_order_can_be_resumed_and_expires(client):
    from app.modules.book.service import expire_abandoned_orders
    from app.db.base import utcnow
    from datetime import timedelta

    headers = await _admin_headers(client)
    product = (await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "Grammar", "sku": "SUJ-G2", "price": 10000, "stock": 1,
    })).json()["data"]

    created = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "C", "phone": "9990000003", "delivery_type": "office",
        "accept_terms": True, "product_id": product["id"],
    })
    order = created.json()["data"]

    # The buyer comes back: same order, fresh gateway attempt.
    r = await client.post("/api/v1/books/resume-payment", json={
        "order_number": order["order_number"], "phone": "9990000003",
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["order_number"] == order["order_number"]
    assert r.json()["data"]["order_id"] != order["order_id"]
    assert r.json()["data"]["amount"] == order["amount"]

    # A different phone cannot reopen someone else's order.
    r = await client.post("/api/v1/books/resume-payment", json={
        "order_number": order["order_number"], "phone": "9998887777",
    })
    assert r.status_code == 404

    # Left unpaid past the window, it is cancelled and the copy comes back.
    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    placed.created_at = utcnow() - timedelta(days=7)
    await placed.save()
    assert await expire_abandoned_orders() == 1

    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    assert placed.status.value == "Cancelled"
    assert placed.stock_reserved is False
    r = await client.get(f"/api/v1/books/product/{product['id']}")
    assert r.json()["data"]["available"] == 1


async def test_a_paid_order_is_never_expired(client):
    from app.modules.book.service import expire_abandoned_orders
    from app.db.base import utcnow
    from datetime import timedelta

    headers = await _admin_headers(client)
    product = (await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "Idioms", "sku": "SUJ-I1", "price": 10000, "stock": 3,
    })).json()["data"]
    order = (await client.post("/api/v1/books/checkout", json={
        "buyer_name": "D", "phone": "9990000004", "delivery_type": "office",
        "accept_terms": True, "product_id": product["id"],
    })).json()["data"]
    await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"], "phone": "9990000004",
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_ok", "razorpay_signature": "test",
    })

    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    placed.created_at = utcnow() - timedelta(days=7)
    await placed.save()
    await expire_abandoned_orders()

    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    assert placed.status.value != "Cancelled"


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
        "dob": f"{date.today().year - 24}-01-01", "gender": "Female",
        "phone": "9990001111", "whatsapp": "9990001111", "education_level": "Graduate",
        "address": "1 Main St", "state": "WB", "district": "Kolkata", "pin_code": "700001",
        "consent_community_rules": "true", "consent_terms": "true",
        "consent_safety_policy": "true", "consent_non_refund": "true",
        "consent_process": "true", "id_proof_type": "Masked Aadhaar",
    }, files={
        "photo": ("p.png", PNG, "image/png"),
        "id_proof": ("id.png", PNG, "image/png"),
        "education_proof": ("edu.png", PNG, "image/png"),
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
        "dob": f"{date.today().year - 30}-01-01", "gender": "Male",
        "phone": "9995556666", "whatsapp": "9995556666", "education_level": "Graduate",
        "address": "2 Main St", "state": "WB", "district": "Kolkata", "pin_code": "700002",
        "consent_community_rules": "true", "consent_terms": "true",
        "consent_safety_policy": "true", "consent_non_refund": "true",
        "consent_process": "true", "id_proof_type": "Masked Aadhaar",
    }, files={
        "photo": ("p.png", PNG, "image/png"),
        "id_proof": ("id.png", PNG, "image/png"),
        "education_proof": ("edu.png", PNG, "image/png"),
    })
    assert r.status_code == 200, r.text
    assert await Subscription.find_one(Subscription.student_id == code) is None


async def test_a_free_bundled_book_still_ships(client):
    """The membership fee covers the book, so its price is 0 — but a copy is
    still dispatched. Fulfilment must key off the product, not the price, or a
    ₹0 book would be mistaken for a membership-only order and never sent."""
    headers = await _admin_headers(client)
    book = await _make_book(client, headers)
    await ActivationCode(code="SPK-FREEPOOL-2").insert()
    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]

    order = (await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990003333", "delivery_type": "office",
        "accept_terms": True, "product_id": book["id"], "plan": plan["plan"], "months": 12,
    })).json()["data"]
    assert order["book_amount"] == 0

    r = await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"], "phone": "9990003333",
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_free",
        "razorpay_signature": "test",
    })
    assert r.status_code == 200, r.text

    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    assert placed.status.value == "Ready for Pickup"
    assert placed.pickup_otp is not None
    assert placed.activation_code == "SPK-FREEPOOL-2"
