"""Razorpay gateway integration guards, across both purchase routes.

Covers the trust boundaries rather than the happy path (that lives in
test_membership_book_bundle / test_golden_path): who may confirm a payment,
what a webhook has to prove, and what the client is allowed to price.
"""
import hashlib
import hmac
import json

import pytest

from app.core.config import settings
from app.core.security import Role, hash_password
from app.db.models import (
    BookOrder, OrderStatus, Payment, PaymentStatus, Student, Subscription, User,
)
from app.modules.payments import service as pay

pytestmark = pytest.mark.asyncio

REAL_SECRET = "a-real-webhook-secret"


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


async def _guest_book_order(client) -> dict:
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "Grammar Basics", "sku": "SUJ-G1", "price": 29900, "stock": 5,
    })
    assert r.status_code == 200, r.text
    product = r.json()["data"]
    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Ravi K", "phone": "9995551234", "delivery_type": "office",
        "product_id": product["id"], "accept_terms": True,
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _signed(payload: dict, secret: str) -> tuple[bytes, str]:
    raw = json.dumps(payload).encode()
    return raw, hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


async def _post_webhook(client, payload: dict, secret: str):
    raw, sig = _signed(payload, secret)
    return await client.post("/api/v1/payments/webhook", content=raw,
                             headers={"X-Razorpay-Signature": sig,
                                      "Content-Type": "application/json"})


async def test_webhook_rejected_while_the_secret_is_the_shipped_placeholder(client):
    """The default secret is public, so signing with it must not authenticate a
    'payment captured' event — that path skips the per-order signature."""
    order = await _guest_book_order(client)
    assert pay.webhook_configured() is False

    r = await _post_webhook(client, {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_forged",
                                           "order_id": order["order_id"]}}},
    }, pay._PLACEHOLDER_WEBHOOK_SECRET)
    assert r.status_code == 422

    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.created


async def test_webhook_with_a_real_secret_fulfils_the_order(client, monkeypatch):
    order = await _guest_book_order(client)
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", REAL_SECRET)

    # A wrong signature is still refused.
    r = await _post_webhook(client, {"event": "payment.captured", "payload": {}}, "guessed")
    assert r.status_code == 422

    # order.paid carries the id on the order entity, not the payment.
    r = await _post_webhook(client, {
        "event": "order.paid",
        "payload": {"order": {"entity": {"id": order["order_id"]}},
                    "payment": {"entity": {"id": "pay_live_1"}}},
    }, REAL_SECRET)
    assert r.status_code == 200, r.text

    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.paid
    assert payment.invoice_no
    placed = await BookOrder.find_one(BookOrder.order_number == order["order_number"])
    assert placed.status != OrderStatus.payment_pending

    # Replaying it cannot double-fulfil.
    invoice = payment.invoice_no
    r = await _post_webhook(client, {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_live_1",
                                           "order_id": order["order_id"]}}},
    }, REAL_SECRET)
    assert r.status_code == 200
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.invoice_no == invoice


async def test_a_failed_event_records_the_failure_without_fulfilling(client, monkeypatch):
    """payment.failed must land on the record — otherwise the attempt sits at
    `created` forever and the admin list under-reports failures — but it must
    never fulfil anything."""
    order = await _guest_book_order(client)
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", REAL_SECRET)
    r = await _post_webhook(client, {
        "event": "payment.failed",
        "payload": {"payment": {"entity": {"id": "p1", "order_id": order["order_id"],
                                           "error_description": "card declined"}}},
    }, REAL_SECRET)
    assert r.status_code == 200
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.failed
    assert payment.failure_reason == "card declined"
    assert not payment.invoice_no


async def test_a_failed_event_cannot_undo_a_paid_order(client, monkeypatch):
    """A buyer who fails once and then pays must not be flipped back to failed
    by the late-arriving failure event."""
    order = await _guest_book_order(client)
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", REAL_SECRET)
    await _post_webhook(client, {
        "event": "payment.captured",
        "payload": {"payment": {"entity": {"id": "pay_ok", "order_id": order["order_id"]}}},
    }, REAL_SECRET)
    await _post_webhook(client, {
        "event": "payment.failed",
        "payload": {"payment": {"entity": {"id": "p1", "order_id": order["order_id"]}}},
    }, REAL_SECRET)
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.paid


async def test_unrelated_events_are_ignored(client, monkeypatch):
    order = await _guest_book_order(client)
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", REAL_SECRET)
    r = await _post_webhook(client, {
        "event": "payment.authorized",
        "payload": {"payment": {"entity": {"id": "p1", "order_id": order["order_id"]}}},
    }, REAL_SECRET)
    assert r.status_code == 200
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.created


async def test_a_student_cannot_verify_someone_elses_order(client):
    """/payments/verify is student-scoped: another student must not be able to
    push the order through, nor park it in `failed` with a bad signature."""
    order = await _guest_book_order(client)  # student_id = guest:9995551234

    await User(username="SPK001", password_hash=hash_password("Student@123"),
               role=Role.student, full_name="Other Student", student_id="SPK001").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "SPK001", "password": "Student@123"})
    token = r.json()["data"]["access_token"]

    r = await client.post("/api/v1/payments/verify",
                          headers={"Authorization": f"Bearer {token}"},
                          json={"razorpay_order_id": order["order_id"],
                                "razorpay_payment_id": "pay_x", "razorpay_signature": "test"})
    assert r.status_code == 404

    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.created


async def test_the_client_cannot_name_its_own_price(client):
    """/payments/order always prices the plan server-side from PlanConfig — a
    client-supplied amount or payment kind is ignored, not honoured."""
    await User(username="SPK002", password_hash=hash_password("Student@123"),
               role=Role.student, full_name="Payer", student_id="SPK002").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "SPK002", "password": "Student@123"})
    token = r.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    r = await client.post("/api/v1/payments/order", headers=headers, json={
        "plan": plan["plan"], "accept_terms": True,
        "kind": "monthly", "amount": 100,  # both ignored
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["amount"] == (plan["offer_price"] or plan["amount"])

    payment = await Payment.find_one(Payment.razorpay_order_id == r.json()["data"]["order_id"])
    assert payment.kind == "subscription"
    assert payment.terms_accepted_at is not None


async def test_membership_checkout_captures_the_billing_address(client):
    """The membership checkout collects the same contact/address block the book
    checkout does. It is stored on the Payment and refreshes the profile."""
    await User(username="SPK004", password_hash=hash_password("Student@123"),
               role=Role.student, full_name="Payer", student_id="SPK004").insert()
    await Student(student_id="SPK004", full_name="Payer", phone="9000000000").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "SPK004", "password": "Student@123"})
    token = r.json()["data"]["access_token"]

    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    r = await client.post("/api/v1/payments/order",
                          headers={"Authorization": f"Bearer {token}"},
                          json={"plan": plan["plan"], "accept_terms": True, "billing": {
                              "name": "Payer", "phone": "9995550000",
                              "address_line1": "12 MG Road", "city": "Kolkata",
                              "district": "Kolkata", "state": "West Bengal",
                              "pin_code": "700001",
                          }})
    assert r.status_code == 200, r.text

    payment = await Payment.find_one(Payment.razorpay_order_id == r.json()["data"]["order_id"])
    assert payment.billing.pin_code == "700001"
    assert payment.billing.address_line1 == "12 MG Road"

    student = await Student.find_one(Student.student_id == "SPK004")
    assert student.address == "12 MG Road, Kolkata"
    assert student.pin_code == "700001"
    assert student.phone == "9995550000"


async def test_terms_are_required_on_both_purchase_routes(client):
    await User(username="SPK003", password_hash=hash_password("Student@123"),
               role=Role.student, full_name="Payer", student_id="SPK003").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "SPK003", "password": "Student@123"})
    token = r.json()["data"]["access_token"]

    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    r = await client.post("/api/v1/payments/order",
                          headers={"Authorization": f"Bearer {token}"},
                          json={"plan": plan["plan"]})
    assert r.status_code == 422

    r = await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Ravi K", "phone": "9995551234", "delivery_type": "office",
    })
    assert r.status_code == 422


async def test_concurrent_confirmations_fulfil_exactly_once(client):
    """Razorpay fires payment.captured and order.paid while the browser posts
    /verify. All three racing must still produce one invoice and one
    subscription — the claim is a conditional update, not a read-then-write."""
    import asyncio

    await User(username="SPK010", password_hash=hash_password("Student@123"),
               role=Role.student, full_name="Racer", student_id="SPK010").insert()
    await Student(student_id="SPK010", full_name="Racer").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "SPK010", "password": "Student@123"})
    token = r.json()["data"]["access_token"]

    plan = (await client.get("/api/v1/payments/plans")).json()["data"][0]
    order = (await client.post("/api/v1/payments/order",
                               headers={"Authorization": f"Bearer {token}"},
                               json={"plan": plan["plan"], "accept_terms": True})).json()["data"]

    await asyncio.gather(*[
        pay.verify_and_activate(order["order_id"], f"pay_{i}", "", trusted=True)
        for i in range(4)
    ])

    payments = await Payment.find(Payment.razorpay_order_id == order["order_id"]).to_list()
    assert len(payments) == 1
    assert payments[0].status == PaymentStatus.paid
    assert payments[0].paid_at is not None
    assert await Subscription.find(Subscription.student_id == "SPK010").count() == 1


async def test_refunding_marks_the_record_and_needs_a_partial_amount(client):
    """The admin refund action is the only thing that flips a payment to
    refunded, and a partial refund must say how much."""
    order = await _guest_book_order(client)
    await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"], "phone": "9995551234",
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_test_refund", "razorpay_signature": "test",
    })
    headers = {"Authorization": (await client.post(
        "/api/v1/auth/login",
        json={"username": "admin@speakedge.in", "password": "Admin@12345"},
    )).json()["data"]["access_token"]}
    headers = {"Authorization": f"Bearer {headers['Authorization']}"}

    # Intermediate lifecycle states do not move money.
    r = await client.post(f"/api/v1/payments/{order['order_id']}/refund-status",
                          headers=headers, json={"refund_status": "Refund Under Review"})
    assert r.status_code == 200, r.text
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.paid

    # A partial refund without an amount is refused rather than guessed.
    r = await client.post(f"/api/v1/payments/{order['order_id']}/refund-status",
                          headers=headers, json={"refund_status": "Partially Refunded"})
    assert r.status_code == 422

    r = await client.post(f"/api/v1/payments/{order['order_id']}/refund-status",
                          headers=headers, json={"refund_status": "Refunded"})
    assert r.status_code == 200, r.text
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.refunded


async def test_a_dashboard_refund_is_reconciled_by_webhook(client, monkeypatch):
    """A refund issued in the Razorpay dashboard must still land on the record."""
    order = await _guest_book_order(client)
    await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"], "phone": "9995551234",
        "razorpay_order_id": order["order_id"],
        "razorpay_payment_id": "pay_dash_1", "razorpay_signature": "test",
    })
    monkeypatch.setattr(settings, "RAZORPAY_WEBHOOK_SECRET", REAL_SECRET)
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])

    r = await _post_webhook(client, {
        "event": "refund.processed",
        "payload": {"refund": {"entity": {"id": "rfnd_1", "payment_id": "pay_dash_1",
                                          "amount": payment.amount}}},
    }, REAL_SECRET)
    assert r.status_code == 200

    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert payment.status == PaymentStatus.refunded
    assert payment.refund_id == "rfnd_1"
