"""Payment / Order Receipt: one format for every payment type.

The fields that vary are what matters here — Student ID and Delivery appear
only where they apply, and the "what happens next" message follows what was
actually paid for. Asserted on the values handed to the renderer rather than by
parsing the PDF back, so the tests describe the document, not ReportLab.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, hash_password
from app.db.models import BookOrder, Payment, PaymentStatus, Student, Subscription, User
from app.shared import pdf_service

pytestmark = pytest.mark.asyncio

STUDENT = "SPK-26-RCPT01"


@pytest.fixture
def rendered(monkeypatch):
    """Capture the kwargs the receipt renderer is called with."""
    calls: list[dict] = []
    real = pdf_service.payment_receipt_bytes

    def spy(**kwargs):
        calls.append(kwargs)
        return real(**kwargs)  # still render, so a layout crash fails the test

    monkeypatch.setattr(pdf_service, "payment_receipt_bytes", spy)
    return calls


async def _admin_headers(client):
    await User(username="admin@speakedge.in", email="admin@speakedge.in",
               password_hash=hash_password("Admin@12345"), role=Role.super_admin).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _student_headers(client, student_id=STUDENT):
    await Student(student_id=student_id, full_name="Asha Rao", phone="9990001111").insert()
    await User(username=student_id, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=student_id).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": student_id, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _subscribe(client, plan: str, student_id=STUDENT) -> Subscription:
    """Give the member an active membership to upgrade away from."""
    now = datetime.now(timezone.utc)
    sub = Subscription(student_id=student_id, plan=plan, started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True)
    await sub.insert()
    return sub


async def _make_book(client, headers):
    r = await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "SpeakEdge Book", "sku": "SPK-BOOK-RC", "price": 69900, "stock": 10,
        "is_speakedge_book": True,
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


# ---------------------------------------------------------------------------
async def test_guest_membership_receipt_has_no_student_id_but_has_delivery(client, rendered):
    headers = await _admin_headers(client)
    book = await _make_book(client, headers)
    await client.get("/api/v1/payments/plans")

    order = (await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "home",
        "address_line1": "1 Test Road", "city": "Kolkata", "pin_code": "700001",
        "accept_terms": True, "product_id": book["id"], "plan": "Silver", "months": 12,
        "include_first_month": True,
    })).json()["data"]

    r = await client.get(f"/api/v1/books/receipt/{order['order_number']}",
                         params={"phone": "9990001111"})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")

    doc = rendered[-1]
    assert doc["receipt_no"] == order["order_number"]
    # The buyer has no account yet, so there is no Student ID to print.
    assert doc["student_id"] is None
    assert doc["delivery"].startswith("Home delivery")
    assert "1 Test Road" in doc["delivery"]
    assert doc["transaction_type"] == "New Membership"
    assert doc["note_title"] == pdf_service.RECEIPT_NOTES["new_membership"][0]
    # Payment has not been verified yet, so it must not claim to be paid.
    assert doc["payment_status"] == "Pending"

    labels = [label for label, _ in doc["lines"]]
    assert any("admission fee" in label for label in labels)
    assert any("first month fee" in label for label in labels)
    # The book ships with the membership at no charge, so its line carries a
    # word rather than a figure and every priced line still adds up to the total.
    assert ("SpeakEdge Book x 1", "Included") in doc["lines"]
    assert sum(a for _, a in doc["lines"] if isinstance(a, int)) == order["amount"]


async def test_wrong_phone_cannot_fetch_a_receipt(client):
    headers = await _admin_headers(client)
    book = await _make_book(client, headers)
    await client.get("/api/v1/payments/plans")
    order = (await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office",
        "accept_terms": True, "product_id": book["id"], "plan": "Silver", "months": 12,
    })).json()["data"]

    r = await client.get(f"/api/v1/books/receipt/{order['order_number']}",
                         params={"phone": "9998887777"})
    assert r.status_code == 404


async def test_monthly_receipt_prints_student_id_and_no_delivery(client, rendered):
    student = await _student_headers(client)
    await client.get("/api/v1/payments/plans")

    payment = Payment(student_id=STUDENT, kind="monthly", plan="Silver", amount=34900,
                      due_month="2026-08", status=PaymentStatus.paid,
                      razorpay_order_id="order_test_monthly", razorpay_payment_id="pay_test_m1")
    await payment.insert()

    r = await client.get(f"/api/v1/payments/receipt/{payment.id}", headers=student)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")

    doc = rendered[-1]
    assert doc["student_id"] == STUDENT
    assert doc["delivery"] is None          # nothing ships on a monthly fee
    assert doc["payment_status"] == "Paid"
    assert doc["transaction_id"] == "pay_test_m1"
    assert doc["transaction_type"] == "Monthly Teacher-led Class Payment"
    assert doc["note_title"] == "Payment Confirmed"
    assert doc["lines"] == [("Silver monthly Teacher-led Class fee - Aug 2026", 34900)]
    assert doc["total_paise"] == 34900


async def test_member_subscription_receipt_covers_its_book_order(client, rendered):
    """A member's order shipped a book, so the receipt is the fuller order
    document — order number, delivery address and all — not a thinner second
    one describing the same money."""
    headers = await _admin_headers(client)
    await _make_book(client, headers)
    await client.get("/api/v1/payments/plans")
    student = await _student_headers(client)

    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True, "delivery_type": "home",
        "billing": {"name": "Asha Rao", "phone": "9990001111",
                    "address_line1": "1 Test Road", "city": "Kolkata", "pin_code": "700001"},
    })).json()["data"]
    await client.post("/api/v1/payments/verify", headers=student, json={
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_s1",
        "razorpay_signature": "test",
    })

    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    r = await client.get(f"/api/v1/payments/receipt/{payment.id}", headers=student)
    assert r.status_code == 200, r.text

    doc = rendered[-1]
    assert doc["receipt_no"].startswith("SPK-ORD-")
    assert doc["student_id"] == STUDENT
    assert doc["delivery"].startswith("Home delivery")
    assert doc["payment_status"] == "Paid"
    assert sum(a for _, a in doc["lines"] if isinstance(a, int)) == order["amount"]


async def test_receipt_is_scoped_to_the_caller(client):
    """A payment id must not be usable to read someone else's receipt."""
    other = Payment(student_id="SPK-26-SOMEONE", kind="monthly", plan="Silver",
                    amount=34900, status=PaymentStatus.paid)
    await other.insert()
    student = await _student_headers(client)

    r = await client.get(f"/api/v1/payments/receipt/{other.id}", headers=student)
    assert r.status_code == 404
