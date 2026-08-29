from fastapi import APIRouter, Depends, Header, Query, Request, Response
from pydantic import BaseModel, EmailStr

from app.core.config import settings
from app.core.envelope import ok
from app.core.exceptions import NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_student
from app.core.ratelimit import rate_limit
from app.db.models import (
    AdmissionOffer,
    BillingDetails,
    Payment,
    PaymentStatus,
    PlanConfig,
    RefundStatus,
    Subscription,
)
from app.modules.payments import monthly, service
from app.shared.audit import log_activity
from app.shared.students import load_students_map, student_avatar_fields

router = APIRouter(prefix="/payments", tags=["payments"])
_limit = rate_limit("payment", settings.RATE_LIMIT_PAYMENT_PER_MIN)


# Every paid route must carry an explicit Terms & Conditions acceptance; the
# checkout page shows the policies and cannot submit until this is ticked.
TERMS_REQUIRED = (
    "Please read and accept the Terms & Conditions, Privacy Policy and "
    "Cancellation & Refund Policy before making a payment."
)


class OrderRequest(BaseModel):
    """Subscription orders only, and the price is always resolved server-side
    from PlanConfig — the client never names an amount or a payment kind. The
    monthly fee has its own endpoint, book orders go through /books/checkout."""

    plan: str | None = None  # PlanConfig key
    months: int | None = None  # chosen subscription duration (3 / 6 / 12)
    accept_terms: bool = False
    # Pay the plan's first monthly fee alongside the admission fee (tiers with
    # a monthly fee only — it is ignored on Tribe/Basic, which have none).
    include_first_month: bool = False
    # Ship the SpeakEdge Book with this membership: "home" (delivery charged)
    # or "office" (free pickup). Omitted = membership only, nothing to ship.
    delivery_type: str | None = None
    # Billing contact + address from the membership checkout page. Optional so
    # the one-click paths (offer acceptance) still work; it never affects price.
    billing: BillingDetails | None = None
    # Upgrades only: the date the upgraded membership takes over ("YYYY-MM-DD",
    # within 30 days of paying). Omitted = as soon as the payment lands.
    activate_on: str | None = None
    # Dashboard exclusive offer (`Offer.id`). When live and targeted at this
    # member, its amount is the payable — the client never sends a price.
    offer: str | None = None


class VerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


def _plan_view(c: PlanConfig) -> dict:
    return {
        "plan": c.plan, "label": c.label, "amount": c.amount, "offer_price": c.offer_price,
        "monthly_fee": c.monthly_fee, "prices": c.prices,
        "duration_days": c.duration_days, "durations": c.durations,
        "classes_per_week": c.classes_per_week, "conversation_per_week": c.conversation_per_week,
        "community_years": c.community_years, "support_years": c.support_years,
        "total_classes": c.total_classes,
        "cefr_tests": c.cefr_tests, "speaking_tests": c.speaking_tests, "enabled": c.enabled,
    }


@router.get("/plans")
async def plans(all: bool = False):
    """Public purchase catalogue (enabled only). ?all=true (admin) includes disabled."""
    cfgs = await service.list_plan_configs(include_disabled=all)
    return ok([_plan_view(c) for c in cfgs])


class PlanCreate(BaseModel):
    plan: str  # unique key
    label: str
    amount: int = 0
    offer_price: int | None = None
    monthly_fee: int = 0
    prices: dict[str, int] = {}
    duration_days: int = 365
    durations: list[int] = [3, 6, 12]
    classes_per_week: int = 1
    conversation_per_week: int = 0
    community_years: int = 1
    support_years: int = 0
    total_classes: int = 0
    cefr_tests: int = 1
    speaking_tests: int = 1
    enabled: bool = True


@router.post("/plans")
async def create_plan(body: PlanCreate, admin: CurrentUser = Depends(require_admin)):
    if await PlanConfig.find_one(PlanConfig.plan == body.plan):
        raise ValidationAppError("A plan with this key already exists")
    cfg = PlanConfig(**body.model_dump())
    await cfg.insert()
    await log_activity(admin.subject, "payment.plan_create", role=admin.role.value,
                       target_id=body.plan)
    return ok(_plan_view(cfg), "Plan created")


class PlanUpdate(BaseModel):
    label: str | None = None
    amount: int | None = None
    offer_price: int | None = None
    monthly_fee: int | None = None
    prices: dict[str, int] | None = None
    duration_days: int | None = None
    durations: list[int] | None = None
    classes_per_week: int | None = None
    conversation_per_week: int | None = None
    community_years: int | None = None
    support_years: int | None = None
    total_classes: int | None = None
    cefr_tests: int | None = None
    speaking_tests: int | None = None
    enabled: bool | None = None


@router.put("/plans/{plan}")
async def update_plan(plan: str, body: PlanUpdate,
                      admin: CurrentUser = Depends(require_admin)):
    """Admin edits plan details, price, duration, classes and exam benefits."""
    cfg = await service.get_plan_config(plan)
    # exclude_unset (not exclude_none) so an explicit offer_price=null clears the offer.
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(cfg, k, v)
    cfg.touch()
    await cfg.save()
    await log_activity(admin.subject, "payment.plan_update", role=admin.role.value,
                       target_id=plan, meta=changes)
    return ok(_plan_view(cfg), "Plan updated")


@router.delete("/plans/{plan}")
async def delete_plan(plan: str, admin: CurrentUser = Depends(require_admin)):
    """Hard delete — plans are config, not audited records, so the key is reusable.
    ponytail: no archive; existing Subscriptions keep their plan string regardless."""
    cfg = await service.get_plan_config(plan)
    await cfg.delete()
    await log_activity(admin.subject, "payment.plan_delete", role=admin.role.value,
                       target_id=plan)
    return ok(message="Plan deleted")


@router.post("/order", dependencies=[Depends(_limit)])
async def create_order(body: OrderRequest, user: CurrentUser = Depends(require_student)):
    if not body.accept_terms:
        raise ValidationAppError(TERMS_REQUIRED)
    result = await service.create_order(user.subject, body.plan, "subscription",
                                        months=body.months, terms_accepted=True,
                                        billing=body.billing,
                                        include_first_month=body.include_first_month,
                                        delivery_type=body.delivery_type,
                                        activate_on=body.activate_on,
                                        offer_id=body.offer)
    await log_activity(user.subject, "payment.order", role=user.role.value,
                       meta={"order_id": result["order_id"], "amount": result["amount"]})
    return ok(result)


@router.get("/upgrade-quote")
async def upgrade_quote(plan: str, months: int | None = None,
                        offer: str | None = None,
                        user: CurrentUser = Depends(require_student)):
    """What this member would pay to move to `plan`, and the credit for the
    membership they already hold. Drives the checkout page — an upgrade shows
    the adjustment, an activation-date choice and no SpeakEdge Book, since no
    second copy is provided.

    `offer` is a dashboard exclusive-offer id: when it is live for this member
    the payable is the offer amount, not the catalogue difference."""
    cfg = await service.get_plan_config(plan)
    months = service._normalize_months(cfg, months)
    quote = await service.upgrade_quote(user.subject, cfg,
                                        service._price_for(cfg, months))
    if offer:
        quote = await service.apply_member_offer(quote, offer, user.subject, plan)
    return ok(quote)


@router.get("/plan-change")
async def plan_change(user: CurrentUser = Depends(require_student)):
    """The membership change already scheduled for this member (a paid upgrade
    waiting for its activation date, or a requested downgrade) and the downgrade
    they may ask for — Pro tiers only."""
    return ok(await service.plan_change_state(user.subject))


@router.post("/downgrade")
async def request_downgrade(user: CurrentUser = Depends(require_student)):
    """Move a Pro membership down to its standard tier from the next monthly
    payment cycle. Free, and the Pro benefits run to the end of the cycle
    already paid for."""
    state = await service.request_downgrade(user.subject)
    await log_activity(user.subject, "membership.downgrade", role=user.role.value,
                       meta={"to": state["pending"]["plan"] if state["pending"] else state["plan"]})
    return ok(state, "Downgrade scheduled")


@router.delete("/plan-change")
async def cancel_plan_change(user: CurrentUser = Depends(require_student)):
    """Call off a scheduled downgrade before it takes effect."""
    state = await service.cancel_plan_change(user.subject)
    await log_activity(user.subject, "membership.downgrade_cancelled", role=user.role.value)
    return ok(state, "Membership change cancelled")


class GeneralPaymentBody(BaseModel):
    student_id: str
    amount: int          # paise
    purpose: str         # selected from the suggestions, or typed
    payment_mode: str = "manual"
    transaction_ref: str | None = None
    remarks: str | None = None


@router.get("/admin/general/purposes")
async def general_purposes(_admin: CurrentUser = Depends(require_admin)):
    """Suggested payment purposes; admin may also type their own."""
    return ok(service.GENERAL_PAYMENT_PURPOSES)


@router.post("/admin/general")
async def record_general(body: GeneralPaymentBody,
                         admin: CurrentUser = Depends(require_admin)):
    """Record a miscellaneous payment already collected, with the purpose that
    will appear on its receipt."""
    payment = await service.record_general_payment(
        body.student_id, body.amount, body.purpose, payment_mode=body.payment_mode,
        transaction_ref=body.transaction_ref, remarks=body.remarks,
    )
    await log_activity(admin.subject, "payment.general", role=admin.role.value,
                       target_type="student", target_id=body.student_id,
                       meta={"amount": body.amount, "purpose": payment.purpose})
    return ok({"id": str(payment.id), "purpose": payment.purpose,
               "amount": payment.amount, "invoice_no": payment.invoice_no},
              "Payment recorded")


# --------------------------------------------------------------------------
# New-student offers (temporary discounted admission on a shareable link)
# --------------------------------------------------------------------------
class AdmissionOfferBody(BaseModel):
    plan: str            # PlanConfig key
    price: int           # paise — the discounted admission fee
    valid_hours: int     # 24 | 48 | 72
    student_name: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    note: str | None = None


def _offer_view(o: AdmissionOffer, label: str | None = None) -> dict:
    return {
        "id": str(o.id), "token": o.token, "plan": o.plan, "label": label or o.plan,
        "price": o.price, "list_price": o.list_price,
        "valid_hours": o.valid_hours, "expires_at": o.expires_at.isoformat(),
        "live": service.offer_live(o), "revoked": o.is_archived,
        "student_name": o.student_name, "phone": o.phone, "email": o.email,
        "note": o.note, "uses": o.uses, "order_numbers": o.order_numbers,
        "used_at": o.used_at.isoformat() if o.used_at else None,
        "created_by": o.created_by, "created_at": o.created_at.isoformat(),
    }


@router.get("/admin/admission-offers")
async def list_admission_offers(_admin: CurrentUser = Depends(require_admin)):
    """Every offer link ever minted, expired ones included — they are the record
    of what was promised to whom."""
    offers = await AdmissionOffer.find_all().sort(-AdmissionOffer.created_at).to_list()
    labels = {c.plan: c.label for c in await service.list_plan_configs(include_disabled=True)}
    return ok({
        "offers": [_offer_view(o, labels.get(o.plan)) for o in offers],
        "valid_hours": list(service.OFFER_VALID_HOURS),
    })


@router.post("/admin/admission-offers")
async def create_admission_offer(body: AdmissionOfferBody,
                                 admin: CurrentUser = Depends(require_admin)):
    """Mint a discounted-admission payment link for a prospect who has not
    joined yet. Admin sends the link on; it prices the guest checkout until it
    expires."""
    offer = await service.create_admission_offer(
        plan=body.plan, price=body.price, valid_hours=body.valid_hours,
        created_by=admin.subject, student_name=body.student_name,
        phone=body.phone, email=body.email, note=body.note,
    )
    await log_activity(admin.subject, "payment.offer_link_create", role=admin.role.value,
                       target_type="admission_offer", target_id=str(offer.id),
                       meta={"plan": offer.plan, "price": offer.price,
                             "valid_hours": offer.valid_hours})
    cfg_label = (await service.get_plan_config(offer.plan)).label
    return ok(_offer_view(offer, cfg_label), "Offer link created")


@router.delete("/admin/admission-offers/{offer_id}")
async def revoke_admission_offer(offer_id: str, admin: CurrentUser = Depends(require_admin)):
    """Withdraw a link before it expires — it stops resolving immediately."""
    offer = await AdmissionOffer.get(offer_id)
    if not offer:
        raise NotFoundError("Offer not found")
    offer.archive(admin.subject, "Offer link revoked")
    await offer.save()
    await log_activity(admin.subject, "payment.offer_link_revoke", role=admin.role.value,
                       target_type="admission_offer", target_id=offer_id)
    return ok(message="Offer link revoked")


@router.get("/admission-offers/{token}")
async def admission_offer(token: str):
    """Public: what a payment link is worth right now. 404 once it has expired
    or been revoked, which is the frontend's cue to send the visitor to the
    regular Membership Plans page."""
    offer = await service.resolve_admission_offer(token)
    cfg = await service.get_plan_config(offer.plan)
    return ok({
        "token": offer.token, "plan": offer.plan, "label": cfg.label,
        "price": offer.price, "list_price": offer.list_price,
        "expires_at": offer.expires_at.isoformat(),
    })


@router.get("/receipt/{payment_id}")
async def payment_receipt(payment_id: str, user: CurrentUser = Depends(require_student)):
    """Payment / Order Receipt for one of the caller's own payments. Scoped to
    the student so a payment id cannot be used to read someone else's."""
    payment = await Payment.get(payment_id)
    if not payment or payment.student_id != user.subject:
        raise NotFoundError("Payment not found")
    pdf = await service.build_payment_receipt(payment)
    name = payment.invoice_no or payment.razorpay_order_id or payment_id
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'},
    )


@router.get("/invoice/{payment_id}")
async def payment_invoice(payment_id: str, user: CurrentUser = Depends(require_student)):
    """Tax invoice for one of the caller's own payments. Regenerated from the
    payment record so a missing /media file after a redeploy is not a 404."""
    payment = await Payment.get(payment_id)
    if not payment or payment.student_id != user.subject:
        raise NotFoundError("Payment not found")
    pdf = await service.build_invoice_pdf(payment)
    name = payment.invoice_no or payment_id
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'},
    )


@router.get("/monthly-due")
async def monthly_due(user: CurrentUser = Depends(require_student)):
    """Next unpaid monthly fee for the student, or null when nothing is owed.

    Drives the payment reminder pop-up: it stays returned (and `overdue` flips
    true) until a matching `kind="monthly"` payment is confirmed."""
    return ok(await monthly.next_due(user.subject))


@router.post("/monthly-order", dependencies=[Depends(_limit)])
async def create_monthly_order(user: CurrentUser = Depends(require_student)):
    """Start a gateway order for the student's next monthly fee."""
    due = await monthly.next_due(user.subject)
    if not due:
        raise ValidationAppError("No monthly fee is currently due")
    # A monthly fee is a continuation of a membership whose Terms were accepted
    # at purchase, so the pop-up states the terms inline rather than asking for
    # a fresh tick each month. The acceptance is still stamped on the payment.
    result = await service.create_order(
        user.subject, due["plan"], kind="monthly", amount=due["amount"],
        due_month=due["due_month"], terms_accepted=True,
    )
    await log_activity(user.subject, "payment.monthly_order", role=user.role.value,
                       meta={"order_id": result["order_id"], "due_month": due["due_month"]})
    return ok({**result, "due_month": due["due_month"], "due_date": due["due_date"]})


class ClassStartBody(BaseModel):
    # "YYYY-MM-DD". Null clears it and falls the schedule back to the
    # subscription start date.
    class_start_date: str | None = None


@router.get("/admin/class-start/{student_id}")
async def get_class_start(student_id: str, _admin: CurrentUser = Depends(require_admin)):
    """The student's monthly-billing anchor plus the date we'd suggest for it —
    their earliest scheduled teacher-led class."""
    sub = await Subscription.find_one(
        Subscription.student_id == student_id,
        Subscription.is_active == True,  # noqa: E712
    )
    if not sub:
        raise NotFoundError("No active subscription for this student")
    suggested = await monthly.suggest_class_start(student_id)
    return ok({
        "student_id": student_id,
        "subscription_id": str(sub.id),
        "plan": sub.plan,
        "started_at": sub.started_at.isoformat(),
        "expires_at": sub.expires_at.isoformat(),
        "class_start_date": sub.billing_start_at.isoformat() if sub.billing_start_at else None,
        "suggested_class_start_date": suggested.isoformat() if suggested else None,
        "effective_anchor": monthly.billing_anchor(sub).isoformat(),
        "due_dates": [d.isoformat() for d in monthly.due_dates(sub)],
    })


@router.post("/admin/class-start/{student_id}")
async def set_class_start(student_id: str, body: ClassStartBody,
                          admin: CurrentUser = Depends(require_admin)):
    """Set the date the student's monthly fee is counted from — their first
    teacher-led scheduled class. Month 1 then falls due one calendar month
    after this date, and monthly from there."""
    sub = await Subscription.find_one(
        Subscription.student_id == student_id,
        Subscription.is_active == True,  # noqa: E712
    )
    if not sub:
        raise NotFoundError("No active subscription for this student")

    sub.billing_start_at = monthly.parse_class_start(body.class_start_date)
    if sub.billing_start_at and sub.billing_start_at > monthly.as_utc(sub.expires_at):
        raise ValidationAppError("The class start date is after the subscription expires")
    # Past reminders were keyed to the old schedule; re-arm them so the student
    # is reminded against the new due months.
    sub.monthly_reminders_sent = []
    sub.touch()
    await sub.save()

    await log_activity(admin.subject, "payment.class_start", role=admin.role.value,
                       target_type="student", target_id=student_id,
                       meta={"class_start_date": body.class_start_date})
    return ok(
        {"class_start_date": sub.billing_start_at.isoformat() if sub.billing_start_at else None,
         "due_dates": [d.isoformat() for d in monthly.due_dates(sub)]},
        "Class start date saved — monthly fees are counted from this date"
        if sub.billing_start_at else
        "Class start date cleared — monthly fees fall back to the subscription start date",
    )


@router.post("/verify", dependencies=[Depends(_limit)])
async def verify(body: VerifyRequest, user: CurrentUser = Depends(require_student)):
    # Scope to the caller's own order. Without this any student could push
    # another student's order through verification, or park it in `failed` by
    # submitting a bad signature for it.
    own = await Payment.find_one(Payment.razorpay_order_id == body.razorpay_order_id)
    if not own or own.student_id != user.subject:
        raise NotFoundError("Order not found")
    payment = await service.verify_and_activate(
        body.razorpay_order_id, body.razorpay_payment_id, body.razorpay_signature
    )
    await log_activity(user.subject, "payment.verify", role=user.role.value,
                       target_id=payment.razorpay_order_id, meta={"status": payment.status.value})
    return ok({
        "status": payment.status.value,
        "invoice_no": payment.invoice_no,
        "invoice_url": payment.invoice_url,
    }, "Payment verified")


# Events that mean "the money is in". Guest book orders have no session, so this
# hook is their backstop reconciler — subscribe to both in the Razorpay dashboard.
_PAID_EVENTS = {"payment.captured", "order.paid"}
# A payment the buyer started and the gateway rejected. Without this the attempt
# would sit at `created` forever and the admin payments list would under-report
# failures. Subscribe to these too.
_FAILED_EVENTS = {"payment.failed"}
# Refunds issued from the Razorpay dashboard rather than from our admin screens,
# so the record still matches the money.
_REFUND_EVENTS = {"refund.created", "refund.processed"}


@router.post("/webhook")
async def webhook(request: Request, x_razorpay_signature: str = Header(default="")):
    raw = await request.body()
    if not service.verify_webhook_signature(raw, x_razorpay_signature):
        raise ValidationAppError("Invalid webhook signature")
    import json
    event = json.loads(raw or b"{}")
    kind = event.get("event")
    payload = event.get("payload") or {}
    entity = (payload.get("payment") or {}).get("entity") or {}

    if kind in _PAID_EVENTS:
        # payment.captured carries the order id on the payment; order.paid also
        # carries the order entity itself.
        order_id = entity.get("order_id") or \
            ((payload.get("order") or {}).get("entity") or {}).get("id")
        if order_id:
            # The webhook body HMAC is already verified above, so the per-order
            # signature (which Razorpay does not send here) is not required.
            # Idempotent in the service: a repeat event cannot double-activate.
            await service.verify_and_activate(order_id, entity.get("id", ""), "", trusted=True)
        return ok(message="ok")

    if kind in _FAILED_EVENTS:
        await service.record_failure(
            entity.get("order_id"), entity.get("id"),
            (entity.get("error_description") or entity.get("error_code")
             or "declined by the gateway"),
        )
        return ok(message="ok")

    if kind in _REFUND_EVENTS:
        refund = (payload.get("refund") or {}).get("entity") or {}
        await service.record_refund(
            refund.get("payment_id"), refund.get("id"), refund.get("amount"),
        )
        return ok(message="ok")

    return ok(message="ignored")


class ManualApproveBody(BaseModel):
    order_id: str
    payment_mode: str | None = None  # cash | bank_transfer | upi_manual ...
    transaction_ref: str | None = None
    remarks: str | None = None


@router.post("/manual-approve")
async def manual_approve(body: ManualApproveBody, admin: CurrentUser = Depends(require_admin)):
    payment = await service.manual_approve(
        body.order_id, admin.subject, payment_mode=body.payment_mode,
        transaction_ref=body.transaction_ref, remarks=body.remarks,
    )
    await log_activity(admin.subject, "payment.manual_approve", role=admin.role.value,
                       target_id=body.order_id)
    return ok({"status": payment.status.value})


class RefundStatusBody(BaseModel):
    refund_status: RefundStatus
    refund_id: str | None = None
    # Required only for a partial refund (paise). The terminal statuses actually
    # send the money back through Razorpay.
    amount: int | None = None


@router.post("/{order_id}/refund-status")
async def refund_status(order_id: str, body: RefundStatusBody,
                        admin: CurrentUser = Depends(require_admin)):
    payment = await service.set_refund_status(order_id, body.refund_status,
                                              body.refund_id, body.amount)
    await log_activity(admin.subject, "payment.refund_status", role=admin.role.value,
                       target_id=order_id, meta={"refund_status": body.refund_status.value})
    return ok({"status": payment.status.value,
               "refund_status": payment.refund_status.value if payment.refund_status else None})


@router.get("/admin/all")
async def admin_payments(
    admin: CurrentUser = Depends(require_admin),
    status: PaymentStatus | None = None,
    student_id: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    """Full payment records incl. failed attempts, with search and filters."""
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status.value
    if student_id:
        query["student_id"] = student_id
    total = await Payment.find(query).count()
    items = (
        await Payment.find(query).sort(-Payment.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    smap = await load_students_map(p.student_id for p in items)
    rows = []
    for p in items:
        row = p.model_dump(mode="json")
        row.update(student_avatar_fields(smap.get(p.student_id), "student"))
        rows.append(row)
    return ok({"items": rows, "total": total,
               "page": page, "page_size": page_size})


@router.get("/{order_id}")
async def get_payment(order_id: str, user: CurrentUser = Depends(require_student)):
    payment = await Payment.find_one(Payment.razorpay_order_id == order_id)
    if not payment or payment.student_id != user.subject:
        raise NotFoundError("Payment not found")
    return ok(payment.model_dump(mode="json"))
