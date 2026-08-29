"""The remaining receipt transaction types: Membership Upgrade, a resumed
monthly Teacher-led Class payment, a plain Sujyoti Publications book, and a
General Payment.

The rule under test throughout is "only information relevant to that
transaction should appear" — an upgrade carries no book or delivery, a plain
book carries no membership or Student ID, and a general payment carries none of
it. Asserted on the values handed to the renderer rather than by parsing the
PDF back, so the tests describe the document, not ReportLab.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, hash_password
from app.db.models import BookOrder, Payment, PaymentStatus, Student, Subscription, User
from app.shared import pdf_service

pytestmark = pytest.mark.asyncio

STUDENT = "SPK-26-RCPT02"


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


async def _student_headers(client):
    await Student(student_id=STUDENT, full_name="Asha Rao", phone="9990001111").insert()
    await User(username=STUDENT, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=STUDENT).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": STUDENT, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _subscribe(plan: str) -> Subscription:
    """An active membership for the member to upgrade away from."""
    now = datetime.now(timezone.utc)
    sub = Subscription(student_id=STUDENT, plan=plan, started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True)
    await sub.insert()
    return sub


async def _make_speakedge_book(client, headers):
    r = await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "SpeakEdge Book", "sku": "SPK-BOOK-RT", "price": 69900, "stock": 10,
        "is_speakedge_book": True,
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _plans(client) -> dict:
    return {p["plan"]: p for p in (await client.get("/api/v1/payments/plans")).json()["data"]}


# ---------------------------------------------------------------------------
# Membership upgrade
# ---------------------------------------------------------------------------
async def test_upgrade_credits_the_previous_admission_fee(client):
    """Silver -> Gold charges the difference, not the full Gold admission fee."""
    student = await _student_headers(client)
    plans = await _plans(client)
    silver, gold = plans["Silver"]["amount"], plans["Gold"]["amount"]
    await _subscribe("Silver")

    quote = (await client.get("/api/v1/payments/upgrade-quote",
                              params={"plan": "Gold"}, headers=student)).json()["data"]
    assert quote["is_upgrade"] is True
    assert quote["previous_label"] == "Silver"
    assert quote["admission"] == gold
    assert quote["adjustment"] == silver
    assert quote["payable"] == gold - silver

    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Gold", "months": 12, "accept_terms": True,
    })).json()["data"]
    assert order["amount"] == gold - silver
    assert order["is_upgrade"] is True


async def test_renewing_the_same_plan_is_not_an_upgrade(client):
    """Otherwise a renewal would credit itself down to nothing."""
    student = await _student_headers(client)
    plans = await _plans(client)
    await _subscribe("Silver")

    quote = (await client.get("/api/v1/payments/upgrade-quote",
                              params={"plan": "Silver"}, headers=student)).json()["data"]
    assert quote["is_upgrade"] is False
    assert quote["adjustment"] == 0
    assert quote["payable"] == plans["Silver"]["amount"]

    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True,
    })).json()["data"]
    assert order["amount"] == plans["Silver"]["amount"]


async def test_moving_to_a_cheaper_tier_gets_no_credit(client):
    """A credit larger than the fee would make the order free."""
    student = await _student_headers(client)
    plans = await _plans(client)
    await _subscribe("Diamond")

    quote = (await client.get("/api/v1/payments/upgrade-quote",
                              params={"plan": "Basic"}, headers=student)).json()["data"]
    assert quote["is_upgrade"] is False
    assert quote["payable"] == plans["Basic"]["amount"]


async def test_upgrade_ships_no_book_and_skips_the_first_month(client, rendered):
    """No second SpeakEdge Book is provided with an upgrade, so no book, no
    delivery and no first-month line appear anywhere on it — even when the
    client asks for both."""
    headers = await _admin_headers(client)
    await _make_speakedge_book(client, headers)
    student = await _student_headers(client)
    await _plans(client)
    await _subscribe("Silver")

    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Gold", "months": 12, "accept_terms": True,
        "delivery_type": "home", "include_first_month": True,
        "billing": {"name": "Asha Rao", "phone": "9990001111",
                    "address_line1": "1 Test Road", "city": "Kolkata", "pin_code": "700001"},
    })).json()["data"]
    assert order["book_amount"] == 0
    assert order["delivery_charge"] == 0
    assert order["first_month_amount"] == 0

    await client.post("/api/v1/payments/verify", headers=student, json={
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_up",
        "razorpay_signature": "test",
    })
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert await BookOrder.find_one(BookOrder.payment_id == str(payment.id)) is None

    r = await client.get(f"/api/v1/payments/receipt/{payment.id}", headers=student)
    assert r.status_code == 200, r.text

    doc = rendered[-1]
    assert doc["transaction_type"] == "Membership Upgrade"
    assert doc["status"] == "Membership Upgrade Successful"
    assert doc["note_title"] == "Membership Upgraded"
    assert "upgraded to Gold" in doc["note_body"]
    assert doc["delivery"] is None
    assert dict(doc["extra_meta"]) == {
        "Previous Membership": "Silver", "Upgraded Membership": "Gold",
    }
    # The adjustment is shown, not folded away: fee, credit, then what was paid.
    labels = [label for label, _ in doc["lines"]]
    assert labels == ["Applicable Admission Fee", "Eligible Previous Fee Adjustment"]
    assert doc["lines"][1][1] < 0
    assert sum(amount for _, amount in doc["lines"]) == doc["total_paise"]
    assert doc["total_label"] == "Amount Paid for Upgrade"


# ---------------------------------------------------------------------------
# Monthly restart / plain book / general payment
# ---------------------------------------------------------------------------
async def test_a_lapsed_month_reads_as_resumed(client, rendered):
    student = await _student_headers(client)
    await _plans(client)
    # Settled in September a fee that fell due in July: access had lapsed.
    payment = Payment(student_id=STUDENT, kind="monthly", plan="Silver", amount=34900,
                      due_month="2026-07", status=PaymentStatus.paid,
                      paid_at=datetime(2026, 9, 2, tzinfo=timezone.utc))
    await payment.insert()

    r = await client.get(f"/api/v1/payments/receipt/{payment.id}", headers=student)
    assert r.status_code == 200, r.text
    assert rendered[-1]["note_title"] == "Teacher-led Classes Resumed"


async def test_a_month_paid_within_its_month_reads_as_continuing(client, rendered):
    student = await _student_headers(client)
    await _plans(client)
    payment = Payment(student_id=STUDENT, kind="monthly", plan="Silver", amount=34900,
                      due_month="2026-07", status=PaymentStatus.paid,
                      paid_at=datetime(2026, 7, 12, tzinfo=timezone.utc))
    await payment.insert()

    await client.get(f"/api/v1/payments/receipt/{payment.id}", headers=student)
    assert rendered[-1]["note_title"] == "Payment Confirmed"


async def test_plain_book_receipt_shows_no_membership_information(client, rendered):
    """A Sujyoti Publications book with no membership: name, quantity and
    delivery, but no membership, Student ID or activation information."""
    headers = await _admin_headers(client)
    product = (await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "Grammar Essentials", "sku": "SJP-GE-1", "price": 15000, "stock": 5,
    })).json()["data"]

    order = (await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "home",
        "address_line1": "1 Test Road", "city": "Kolkata", "pin_code": "700001",
        "accept_terms": True, "product_id": product["id"],
    })).json()["data"]

    r = await client.get(f"/api/v1/books/receipt/{order['order_number']}",
                         params={"phone": "9990001111"})
    assert r.status_code == 200, r.text

    doc = rendered[-1]
    assert doc["transaction_type"] == "Book Purchase"
    assert doc["note_title"] == "Order Confirmed"
    assert doc["student_id"] is None
    assert not doc.get("extra_meta")
    labels = [label for label, _ in doc["lines"]]
    assert "Grammar Essentials x 1" in labels
    assert not any("Membership" in label for label in labels)
    assert doc["delivery"].startswith("Home delivery")


async def test_general_payment_prints_the_purpose_admin_chose(client, rendered):
    headers = await _admin_headers(client)
    student = await _student_headers(client)

    suggestions = (await client.get("/api/v1/payments/admin/general/purposes",
                                    headers=headers)).json()["data"]
    assert "Study material" in suggestions

    r = await client.post("/api/v1/payments/admin/general", headers=headers, json={
        "student_id": STUDENT, "amount": 25000, "purpose": "Workshop / event fee",
        "transaction_ref": "UPI-4411",
    })
    assert r.status_code == 200, r.text
    payment_id = r.json()["data"]["id"]

    r = await client.get(f"/api/v1/payments/receipt/{payment_id}", headers=student)
    assert r.status_code == 200, r.text

    doc = rendered[-1]
    assert doc["transaction_type"] == "General Payment"
    assert doc["note_title"] == "Payment Confirmed"
    assert doc["lines"] == [("Workshop / event fee", 25000)]
    assert "Workshop / event fee" in doc["note_body"]
    assert "250.00" in doc["note_body"]
    # Nothing membership-, book- or class-related applies to it.
    assert doc["delivery"] is None
    assert not doc.get("extra_meta")
    assert doc["transaction_id"] == "UPI-4411"


async def test_general_payment_needs_a_purpose(client):
    headers = await _admin_headers(client)
    r = await client.post("/api/v1/payments/admin/general", headers=headers, json={
        "student_id": STUDENT, "amount": 25000, "purpose": "   ",
    })
    assert r.status_code == 422, r.text


# ---------------------------------------------------------------------------
# Membership renewal (a membership payment with nothing to ship)
# ---------------------------------------------------------------------------
async def test_renewal_without_a_book_carries_no_delivery_line(client, rendered):
    """Renewing without asking for a copy of the book ships nothing, so the
    receipt is the membership alone — admission fee, the first month if it was
    taken, and no book, GST or delivery row."""
    headers = await _admin_headers(client)
    await _make_speakedge_book(client, headers)   # configured, but not ordered
    student = await _student_headers(client)
    plans = await _plans(client)
    await _subscribe("Silver")

    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True, "include_first_month": True,
    })).json()["data"]
    await client.post("/api/v1/payments/verify", headers=student, json={
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_rn",
        "razorpay_signature": "test",
    })
    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    assert await BookOrder.find_one(BookOrder.payment_id == str(payment.id)) is None

    r = await client.get(f"/api/v1/payments/receipt/{payment.id}", headers=student)
    assert r.status_code == 200, r.text

    doc = rendered[-1]
    assert doc["transaction_type"] == "Membership Renewal"
    assert doc["status"] == "Membership Active"
    assert doc["note_title"] == "Membership Confirmed"
    assert doc["student_id"] == STUDENT
    assert doc["delivery"] is None
    labels = [label for label, _ in doc["lines"]]
    assert labels == ["Silver Membership (one-time admission fee)", "Silver first month fee"]
    assert doc["lines"][0][1] == plans["Silver"]["amount"]
    assert doc["lines"][1][1] == plans["Silver"]["monthly_fee"]
    assert sum(a for _, a in doc["lines"]) == doc["total_paise"] == order["amount"]
