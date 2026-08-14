"""Razorpay payments: create order, verify signature server-side, activate
subscription + generate invoice, handle webhooks/manual/refund, book orders.
Idempotent on order id so a repeated verify cannot double-activate.

Plan catalogue is DB-backed (PlanConfig) so Admin owns pricing/benefits
(Module 11). Nothing is hard-coded: the SpeakEdge spec values below are only
seeded for plan keys missing from the DB; the admin edits everything after.

Pricing: checkout charges the plan's **one-time admission/membership fee**
(`offer_price` or `amount`). `monthly_fee` is quoted on the plan card and
collected separately — there is no recurring engine, so it is never folded into
the upfront charge. `PlanConfig.prices` stays as an optional per-term override
(month → paise) the admin may set; when empty the admission fee is charged."""
import hashlib
import hmac
import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.db.base import utcnow
from app.db.models import (
    BookOrder,
    Payment,
    PaymentStatus,
    PlanConfig,
    RefundStatus,
    Student,
    Subscription,
    SubscriptionPlan,
)
from app.modules.notification import service as notif
from app.shared import email_service, pdf_service

# Spec defaults (paise). New keys are inserted; existing rows are refreshed once
# per PLAN_SPEC_VERSION bump (see seed_plan_configs) so a live catalogue picks up
# a spec revision. amount = one-time admission/membership fee (charged upfront);
# monthly = quoted per-month fee; teacher = teacher-led classes per week; conv =
# conversation teams; community/support = years of access.
_MEMBERSHIP_DURATIONS = [3, 6, 12]
PLAN_SPEC_VERSION = 2
PLAN_DEFAULTS = {
    SubscriptionPlan.tribe: {
        "label": "Tribe", "amount": 69900, "monthly": 0,
        "teacher": 0, "conv": 0, "cefr": 0, "speaking": 0, "community": 1, "support": 0,
    },
    SubscriptionPlan.basic: {
        "label": "Basic", "amount": 149900, "monthly": 0,
        "teacher": 0, "conv": 2, "cefr": 1, "speaking": 1, "community": 1, "support": 0,
    },
    SubscriptionPlan.silver: {
        "label": "Silver", "amount": 199900, "monthly": 34900,
        "teacher": 1, "conv": 2, "cefr": 2, "speaking": 2, "community": 2, "support": 2,
    },
    SubscriptionPlan.silver_pro: {
        "label": "Silver Pro", "amount": 199900, "monthly": 69900,
        "teacher": 2, "conv": 2, "cefr": 2, "speaking": 2, "community": 2, "support": 2,
    },
    SubscriptionPlan.gold: {
        "label": "Gold", "amount": 249900, "monthly": 29900,
        "teacher": 1, "conv": 2, "cefr": 3, "speaking": 3, "community": 3, "support": 3,
    },
    SubscriptionPlan.gold_pro: {
        "label": "Gold Pro", "amount": 249900, "monthly": 59900,
        "teacher": 2, "conv": 2, "cefr": 3, "speaking": 3, "community": 3, "support": 3,
    },
    SubscriptionPlan.diamond: {
        "label": "Diamond", "amount": 299900, "monthly": 24900,
        "teacher": 1, "conv": 2, "cefr": 4, "speaking": 4, "community": 5, "support": 5,
    },
    SubscriptionPlan.diamond_pro: {
        "label": "Diamond Pro", "amount": 299900, "monthly": 49900,
        "teacher": 2, "conv": 2, "cefr": 4, "speaking": 4, "community": 5, "support": 5,
    },
    # Separate A1–A2 offering: ₹1999, ₹1499 for members. 12 classes, 3 months.
    # Sold under the Book section, not on the membership plans page.
    SubscriptionPlan.basic_english: {
        "label": "Basic English Course", "amount": 199900, "offer": 149900,
        "monthly": 0, "teacher": 1, "conv": 0, "cefr": 0, "speaking": 0,
        "community": 0, "support": 0, "total_classes": 12, "durations": [3],
    },
}

try:
    import razorpay  # type: ignore
except Exception:  # pragma: no cover
    razorpay = None


def keys_configured() -> bool:
    """True once real Razorpay credentials are set. The placeholder default
    (rzp_test_xxxxxxxx) keeps the offline/demo path alive for local dev + tests."""
    key = settings.RAZORPAY_KEY_ID or ""
    return key.startswith("rzp_") and "xxxx" not in key


def _client():
    if razorpay is None or not keys_configured():
        return None
    return razorpay.Client(auth=(settings.RAZORPAY_KEY_ID, settings.RAZORPAY_KEY_SECRET))


def _spec_fields(meta: dict) -> dict:
    """The catalogue values the spec owns — everything else is the admin's."""
    return {
        "label": meta["label"], "amount": meta["amount"],
        "offer_price": meta.get("offer"), "monthly_fee": meta["monthly"],
        # Term overrides are opt-in; empty means "charge the admission fee".
        "prices": {},
        "classes_per_week": meta["teacher"], "conversation_per_week": meta["conv"],
        "community_years": meta["community"], "support_years": meta["support"],
        "total_classes": meta.get("total_classes", 0),
        "cefr_tests": meta["cefr"], "speaking_tests": meta["speaking"],
        "spec_version": PLAN_SPEC_VERSION,
    }


async def seed_plan_configs() -> None:
    """Seed spec defaults per plan key: missing keys are inserted, and rows left
    behind by an older PLAN_SPEC_VERSION have their spec-owned fields refreshed
    once so a live catalogue follows a spec revision. Admin edits made after
    that stick until the next version bump. (Admin-deleted default keys may
    reappear — acceptable for a catalogue overhaul.)"""
    existing = {c.plan: c for c in await PlanConfig.find({}).to_list()}
    for plan, meta in PLAN_DEFAULTS.items():
        fields = _spec_fields(meta)
        cfg = existing.get(plan.value)
        if cfg is not None:
            if cfg.spec_version >= PLAN_SPEC_VERSION:
                continue
            for key, value in fields.items():
                setattr(cfg, key, value)
            cfg.touch()
            await cfg.save()
            continue
        durations = meta.get("durations", _MEMBERSHIP_DURATIONS)
        await PlanConfig(
            plan=plan.value, duration_days=_months_to_days(max(durations)),
            durations=durations, enabled=True, **fields,
        ).insert()


def _months_to_days(months: int) -> int:
    """3M/6M validity in 30-day months; treat 12M as a calendar year."""
    return 365 if months >= 12 else months * 30


def _normalize_months(cfg: PlanConfig, months: int | None) -> int:
    """Clamp the requested duration to one the plan actually offers."""
    allowed = cfg.durations or _MEMBERSHIP_DURATIONS
    if months in allowed:
        return months
    return allowed[0]


def _admission_for(cfg: PlanConfig) -> int:
    """The one-time admission / membership fee (paise)."""
    return cfg.offer_price if cfg.offer_price is not None else cfg.amount


def _price_for(cfg: PlanConfig, months: int) -> int:
    """Charged upfront (paise): the one-time admission fee. Monthly fees are
    collected separately, so they are never added in here. An admin-set price
    override for this term still wins."""
    return (cfg.prices or {}).get(str(months)) or _admission_for(cfg)


async def get_plan_config(plan: str) -> PlanConfig:
    await seed_plan_configs()
    cfg = await PlanConfig.find_one(PlanConfig.plan == plan)
    if not cfg:
        raise NotFoundError("Plan not configured")
    return cfg


async def list_plan_configs(include_disabled: bool = False) -> list[PlanConfig]:
    await seed_plan_configs()
    query = {} if include_disabled else {"enabled": True}
    return await PlanConfig.find(query).to_list()


async def _create_gateway_order(amount: int, notes: dict) -> str:
    receipt = f"rcpt_{uuid.uuid4().hex[:12]}"
    client = _client()
    if client is not None:
        # Never fall back to a test order when real keys are configured: an
        # order_test_* id is treated as pre-paid downstream, so a swallowed
        # gateway error would hand out free subscriptions.
        try:
            order = client.order.create({
                "amount": amount, "currency": "INR", "receipt": receipt, "notes": notes,
            })
        except Exception as exc:  # pragma: no cover - network failure path
            raise ValidationAppError(
                "Could not reach the payment gateway. Please try again."
            ) from exc
        return order["id"]
    # Test/offline fallback so the flow is demoable without live keys.
    return f"order_test_{uuid.uuid4().hex[:14]}"


async def create_order(student_id: str, plan: str | None, kind: str = "subscription",
                       amount: int | None = None, months: int | None = None,
                       due_month: str | None = None,
                       terms_accepted: bool = False) -> dict:
    if kind == "subscription":
        if not plan:
            raise ValidationAppError("Invalid subscription plan")
        cfg = await get_plan_config(plan)
        if not cfg.enabled:
            raise ValidationAppError("This plan is not currently available")
        months = _normalize_months(cfg, months)
        amount = _price_for(cfg, months)
    if not amount or amount <= 0:
        raise ValidationAppError("Invalid amount")

    order_id = await _create_gateway_order(
        amount, {"student_id": student_id, "plan": plan or "", "kind": kind, "months": months or ""}
    )
    payment = Payment(
        student_id=student_id, kind=kind, plan=plan or None, months=months,
        due_month=due_month, amount=amount, status=PaymentStatus.created,
        payment_mode="razorpay", razorpay_order_id=order_id,
        terms_accepted_at=utcnow() if terms_accepted else None,
        terms_version=settings.TERMS_VERSION if terms_accepted else None,
    )
    await payment.insert()
    return {
        "order_id": order_id, "amount": amount, "currency": "INR",
        "key_id": settings.RAZORPAY_KEY_ID, "payment_ref": str(payment.id),
    }


def _verify_signature(order_id: str, payment_id: str, signature: str) -> bool:
    msg = f"{order_id}|{payment_id}".encode()
    expected = hmac.new(settings.RAZORPAY_KEY_SECRET.encode(), msg, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def verify_and_activate(order_id: str, payment_id: str, signature: str,
                              trusted: bool = False) -> Payment:
    """Confirm a payment and fulfil it.

    `trusted=True` is for callers that have already authenticated the message
    another way — the webhook, whose body HMAC is checked against
    RAZORPAY_WEBHOOK_SECRET before we get here and which carries no per-order
    signature. Otherwise the order signature is required, except for offline
    demo orders issued while no real keys are configured."""
    payment = await Payment.find_one(Payment.razorpay_order_id == order_id)
    if not payment:
        raise NotFoundError("Order not found")
    if payment.status in (PaymentStatus.paid, PaymentStatus.manually_approved):
        return payment  # idempotent: already activated

    offline_order = order_id.startswith("order_test_") and not keys_configured()
    if not (trusted or offline_order):
        if not _verify_signature(order_id, payment_id, signature):
            payment.status = PaymentStatus.failed
            payment.failure_reason = "signature_verification_failed"
            await payment.save()
            raise ValidationAppError("Payment signature verification failed")

    payment.razorpay_payment_id = payment_id
    payment.razorpay_signature = signature
    payment.status = PaymentStatus.paid
    await _fulfil(payment)
    return payment


async def _fulfil(payment: Payment) -> None:
    student = await Student.find_one(Student.student_id == payment.student_id)
    name = student.full_name if student else payment.student_id

    book_order = None
    if payment.kind == "book":
        book_order = await BookOrder.find_one(BookOrder.payment_id == str(payment.id))
        if book_order:
            name = book_order.buyer_name

    # Invoice
    invoice_no = f"SPK-INV-{datetime.utcnow():%Y%m}-{uuid.uuid4().hex[:6].upper()}"
    item = f"{payment.kind.title()} {payment.plan or ''}".strip()
    if payment.kind == "monthly":
        when = payment.due_month or ""
        if when:
            when = f" — {datetime.strptime(when, '%Y-%m'):%b %Y}"
        item = f"{payment.plan or 'Membership'} monthly fee{when}"
    if payment.kind == "book":
        membership = f"{payment.plan.replace('_', ' ').title()} Membership" if payment.plan \
            else "Lifetime Membership"
        item = f"SpeakEdge Book + {membership}" + (
            " (Home Delivery)" if book_order and book_order.delivery_type == "home" else " (Office Collection)"
        )
    payment.invoice_no = invoice_no
    payment.invoice_url = pdf_service.generate_invoice(
        invoice_no, name, payment.student_id, item, payment.amount
    )

    # Activate subscription with plan-tier exam eligibility (Module 10)
    if payment.kind == "subscription" and payment.plan:
        cfg = await get_plan_config(payment.plan)
        now = datetime.now(timezone.utc)
        days = _months_to_days(payment.months) if payment.months else cfg.duration_days
        # Deactivate prior active subs
        await Subscription.find(
            Subscription.student_id == payment.student_id, Subscription.is_active == True  # noqa: E712
        ).update({"$set": {"is_active": False}})
        sub = Subscription(
            student_id=payment.student_id, plan=payment.plan, started_at=now,
            expires_at=now + timedelta(days=days), is_active=True, months=payment.months,
            cefr_tests=cfg.cefr_tests, speaking_tests=cfg.speaking_tests,
            payment_id=str(payment.id),
        )
        await sub.insert()

    await payment.save()

    # Book order fulfilment: confirm, reserve inventory + activation code, notify.
    if payment.kind == "book":
        from app.modules.book import service as book_service  # avoids import cycle
        await book_service.on_book_order_paid(payment)

    await notif.notify(payment.student_id, "Payment received",
                       f"Your payment succeeded. Invoice {invoice_no} is available.", kind="payment")
    email_to = student.email if student else (book_order.email if book_order else None)
    if email_to:
        email_service.payment_email(email_to, name, invoice_no)


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    expected = hmac.new(settings.RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def manual_approve(order_id: str, approver: str, *, payment_mode: str | None = None,
                         transaction_ref: str | None = None, remarks: str | None = None) -> Payment:
    """Admin approval for payments received outside Razorpay (Module 11)."""
    payment = await Payment.find_one(Payment.razorpay_order_id == order_id)
    if not payment:
        raise NotFoundError("Order not found")
    payment.status = PaymentStatus.manually_approved
    payment.payment_mode = payment_mode or payment.payment_mode or "manual"
    payment.transaction_ref = transaction_ref
    payment.remarks = remarks
    await _fulfil(payment)
    return payment


async def set_refund_status(order_id: str, refund_status: RefundStatus,
                            refund_id: str | None = None) -> Payment:
    """Admin-managed refund lifecycle: Requested -> Under Review -> Approved/
    Rejected -> Refunded / Partially Refunded (Module 11)."""
    payment = await Payment.find_one(Payment.razorpay_order_id == order_id)
    if not payment:
        raise NotFoundError("Order not found")
    payment.refund_status = refund_status
    if refund_id:
        payment.refund_id = refund_id
    if refund_status == RefundStatus.refunded:
        payment.status = PaymentStatus.refunded
    elif refund_status == RefundStatus.partially_refunded:
        payment.status = PaymentStatus.partially_refunded
    payment.touch()
    await payment.save()
    return payment
