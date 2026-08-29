"""Two checkout options added for Silver -> Diamond Pro and for members.

1. Tiers with a monthly fee may collect the first month together with the
   admission fee; the derived due schedule then starts at month 2.
2. A signed-in member's membership order can ship the SpeakEdge Book, with the
   same home-delivery charge a new joiner pays — without consuming an
   activation code, because their Subscription is created by the payment.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.core.config import settings
from app.core.security import Role, hash_password
from app.db.models import (
    ActivationCode,
    BookOrder,
    BookProduct,
    CodeStatus,
    Payment,
    PlanConfig,
    Subscription,
    User,
)
from app.modules.payments import monthly
from app.shared import pdf_service

pytestmark = pytest.mark.asyncio

STUDENT = "SPK-26-FIRST1"


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------
def _span(started: datetime, expires: datetime, first_month_included: bool):
    """due_dates() only reads these three fields — no Beanie init needed."""
    return SimpleNamespace(started_at=started, expires_at=expires,
                           first_month_included=first_month_included)


async def test_prepaid_first_month_shifts_the_schedule():
    start = datetime(2026, 1, 10, tzinfo=timezone.utc)
    expires = datetime(2026, 6, 10, tzinfo=timezone.utc)

    normal = [d.date().isoformat() for d in monthly.due_dates(_span(start, expires, False))]
    prepaid = [d.date().isoformat() for d in monthly.due_dates(_span(start, expires, True))]

    assert normal[0] == "2026-02-10"
    # Month 1 was paid with the admission fee, so the schedule starts a month
    # later — and it is the whole month that is dropped, not shifted onto later
    # dates, so every remaining due date is unchanged.
    assert prepaid == normal[1:]


# ---------------------------------------------------------------------------
# Guest bundle (/books/checkout)
# ---------------------------------------------------------------------------
async def _admin_headers(client):
    await User(
        username="admin@speakedge.in", email="admin@speakedge.in",
        password_hash=hash_password("Admin@12345"), role=Role.super_admin,
    ).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _make_speakedge_book(client, headers, *, price=69900, stock=10):
    r = await client.post("/api/v1/books/admin/products", headers=headers, json={
        "name": "SpeakEdge Book", "sku": "SPK-BOOK-FM", "price": price, "stock": stock,
        "is_speakedge_book": True,
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def _silver(client) -> PlanConfig:
    await client.get("/api/v1/payments/plans")  # seeds the catalogue
    cfg = await PlanConfig.find_one(PlanConfig.plan == "Silver")
    assert cfg.monthly_fee > 0, "Silver must have a monthly fee for this test"
    return cfg


async def test_guest_bundle_can_add_the_first_month(client):
    headers = await _admin_headers(client)
    book = await _make_speakedge_book(client, headers)
    cfg = await _silver(client)
    admission = cfg.offer_price if cfg.offer_price is not None else cfg.amount

    body = {
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office",
        "accept_terms": True, "product_id": book["id"], "plan": "Silver", "months": 12,
    }
    plain = (await client.post("/api/v1/books/checkout", json=body)).json()["data"]
    withfm = (await client.post("/api/v1/books/checkout",
                                json={**body, "include_first_month": True})).json()["data"]

    assert plain["first_month_amount"] == 0
    assert withfm["first_month_amount"] == cfg.monthly_fee
    assert withfm["plan_amount"] == plain["plan_amount"] == admission
    assert withfm["amount"] - plain["amount"] == cfg.monthly_fee


async def test_activation_carries_the_prepaid_first_month(client):
    """The guest paid month 1 long before their account existed; the code is
    what carries that fact across to the Subscription."""
    headers = await _admin_headers(client)
    book = await _make_speakedge_book(client, headers)
    await _silver(client)
    await client.post("/api/v1/activation-codes/generate", headers=headers,
                      json={"count": 1, "audience": "adults"})

    order = (await client.post("/api/v1/books/checkout", json={
        "buyer_name": "Asha Rao", "phone": "9990001111", "delivery_type": "office",
        "accept_terms": True, "product_id": book["id"], "plan": "Silver", "months": 12,
        "include_first_month": True,
    })).json()["data"]
    r = await client.post("/api/v1/books/verify-payment", json={
        "order_number": order["order_number"], "phone": "9990001111",
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_1",
        "razorpay_signature": "test",
    })
    assert r.status_code == 200, r.text
    code = r.json()["data"]["activation_code"]

    ac = await ActivationCode.find_one(ActivationCode.code == code)
    assert ac.first_month_included is True

    from app.modules.membership import service as membership_service

    await membership_service._start_paid_subscription(ac, STUDENT)
    sub = await Subscription.find_one(Subscription.student_id == STUDENT)
    assert sub.first_month_included is True


# ---------------------------------------------------------------------------
# Member checkout (/payments/order)
# ---------------------------------------------------------------------------
async def _student_headers(client):
    await User(username=STUDENT, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=STUDENT).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": STUDENT, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


BILLING = {
    "name": "Asha Rao", "phone": "9990001111", "address_line1": "1 Test Road",
    "city": "Kolkata", "state": "West Bengal", "pin_code": "700001",
}


async def test_member_order_ships_the_book_free_and_charges_delivery(client):
    headers = await _admin_headers(client)
    await _make_speakedge_book(client, headers)
    cfg = await _silver(client)
    admission = cfg.offer_price if cfg.offer_price is not None else cfg.amount
    student = await _student_headers(client)

    r = await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True,
        "include_first_month": True, "delivery_type": "home", "billing": BILLING,
    })
    assert r.status_code == 200, r.text
    data = r.json()["data"]

    assert data["plan_amount"] == admission
    assert data["first_month_amount"] == cfg.monthly_fee
    # The membership fee covers the book: it ships, but is never charged on top.
    assert data["book_amount"] == 0
    assert data["gst_amount"] == 0
    assert data["delivery_charge"] == settings.BOOK_DELIVERY_CHARGE_PAISE
    assert data["amount"] == admission + cfg.monthly_fee + data["delivery_charge"]


async def test_office_pickup_is_free_and_home_delivery_needs_an_address(client):
    headers = await _admin_headers(client)
    await _make_speakedge_book(client, headers)
    await _silver(client)
    student = await _student_headers(client)

    pickup = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True,
        "delivery_type": "office", "billing": BILLING,
    })).json()["data"]
    assert pickup["delivery_charge"] == 0
    assert pickup["book_amount"] == 0

    # Nowhere to send it: refused rather than shipped into the void.
    r = await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True,
        "delivery_type": "home", "billing": {"name": "Asha Rao", "phone": "9990001111"},
    })
    assert r.status_code == 422, r.text
    assert "PIN code" in r.json()["message"]


async def test_member_order_ships_the_book_without_burning_a_code(client):
    """Paying creates the Subscription directly, so an activation code here
    would be a second free membership."""
    headers = await _admin_headers(client)
    book = await _make_speakedge_book(client, headers)
    await _silver(client)
    await client.post("/api/v1/activation-codes/generate", headers=headers,
                      json={"count": 2, "audience": "adults"})
    student = await _student_headers(client)

    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True,
        "include_first_month": True, "delivery_type": "home", "billing": BILLING,
    })).json()["data"]

    # The copy is held from checkout, before any money moves.
    product = await BookProduct.get(book["id"])
    assert product.reserved == 1

    r = await client.post("/api/v1/payments/verify", headers=student, json={
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_2",
        "razorpay_signature": "test",
    })
    assert r.status_code == 200, r.text

    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    book_order = await BookOrder.find_one(BookOrder.payment_id == str(payment.id))
    assert book_order is not None
    assert book_order.student_id == STUDENT
    assert book_order.delivery_type == "home"
    assert book_order.activation_code is None
    assert await ActivationCode.find(ActivationCode.status == CodeStatus.reserved).count() == 0

    # The subscription exists and knows month 1 is already settled.
    sub = await Subscription.find_one(Subscription.student_id == STUDENT,
                                      Subscription.is_active == True)  # noqa: E712
    assert sub.first_month_included is True


async def test_prepaid_first_month_is_not_billed_again(client):
    cfg = await _silver(client)
    student = await _student_headers(client)

    # A subscription that started 28 days ago: month 1 would be due in ~2 days.
    started = datetime.now(timezone.utc) - timedelta(days=28)
    await Subscription(
        student_id=STUDENT, plan="Silver", started_at=started,
        expires_at=started + timedelta(days=365), is_active=True,
        first_month_included=True,
    ).insert()

    due = (await client.get("/api/v1/payments/monthly-due", headers=student)).json()["data"]
    # Month 1 is paid, and month 2 is still ~32 days out, so nothing is owed yet.
    assert due is not None
    assert due["amount"] == cfg.monthly_fee
    assert due["days_until"] > monthly.REMINDER_DAYS
    assert due["reminder_active"] is False


async def test_book_out_of_stock_falls_back_to_membership_only(client):
    """An inventory problem must never block someone paying for a membership."""
    headers = await _admin_headers(client)
    await _make_speakedge_book(client, headers, stock=0)
    cfg = await _silver(client)
    admission = cfg.offer_price if cfg.offer_price is not None else cfg.amount
    student = await _student_headers(client)

    data = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True,
        "delivery_type": "home", "billing": BILLING,
    })).json()["data"]

    assert data["book_amount"] == 0
    assert data["delivery_charge"] == 0
    assert data["amount"] == admission


async def test_the_free_book_is_still_named_on_the_invoice(client, monkeypatch):
    """A ₹0 book is still a book: the order carries the product, the invoice
    line names it, and the delivery choice is on both. Everything asking
    "did a copy ship?" reads the product, never the price."""
    items: list[str] = []
    real = pdf_service.generate_invoice
    monkeypatch.setattr(pdf_service, "generate_invoice",
                        lambda no, name, sid, item, amount, **kw: (
                            items.append(item) or real(no, name, sid, item, amount, **kw)))

    headers = await _admin_headers(client)
    book = await _make_speakedge_book(client, headers)
    await _silver(client)
    student = await _student_headers(client)

    order = (await client.post("/api/v1/payments/order", headers=student, json={
        "plan": "Silver", "months": 12, "accept_terms": True,
        "delivery_type": "home", "billing": BILLING,
    })).json()["data"]
    await client.post("/api/v1/payments/verify", headers=student, json={
        "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_test_inv",
        "razorpay_signature": "test",
    })

    payment = await Payment.find_one(Payment.razorpay_order_id == order["order_id"])
    book_order = await BookOrder.find_one(BookOrder.payment_id == str(payment.id))
    assert book_order.product_id == book["id"]
    assert (book_order.book_amount, book_order.gst_amount) == (0, 0)
    assert book_order.delivery_charge == settings.BOOK_DELIVERY_CHARGE_PAISE
    assert book_order.amount == payment.amount

    assert items and "SpeakEdge Book" in items[-1] and "Home Delivery" in items[-1]
    # No GST was charged, so the invoice must not print a tax breakup.
    assert payment.taxable_amount is None and payment.total_tax is None
