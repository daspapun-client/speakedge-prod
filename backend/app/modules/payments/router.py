from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel

from app.core.config import settings
from app.core.envelope import ok
from app.core.exceptions import NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_student
from app.core.ratelimit import rate_limit
from app.db.models import (
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
    plan: str | None = None  # PlanConfig key
    kind: str = "subscription"
    amount: int | None = None  # for exam kinds
    months: int | None = None  # chosen subscription duration (3 / 6 / 12)
    accept_terms: bool = False


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
    result = await service.create_order(user.subject, body.plan, body.kind, body.amount,
                                        body.months, terms_accepted=True)
    await log_activity(user.subject, "payment.order", role=user.role.value,
                       meta={"order_id": result["order_id"], "amount": result["amount"]})
    return ok(result)


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


@router.post("/webhook")
async def webhook(request: Request, x_razorpay_signature: str = Header(default="")):
    raw = await request.body()
    if not service.verify_webhook_signature(raw, x_razorpay_signature):
        raise ValidationAppError("Invalid webhook signature")
    # Reconciliation: mark paid on payment.captured event (idempotent in service).
    import json
    event = json.loads(raw or b"{}")
    try:
        entity = event["payload"]["payment"]["entity"]
        order_id = entity.get("order_id")
        if order_id and event.get("event") == "payment.captured":
            # The webhook body HMAC is already verified above, so the per-order
            # signature (which Razorpay does not send here) is not required.
            await service.verify_and_activate(order_id, entity.get("id", ""), "", trusted=True)
    except (KeyError, TypeError):
        pass
    return ok(message="ok")


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


@router.post("/{order_id}/refund-status")
async def refund_status(order_id: str, body: RefundStatusBody,
                        admin: CurrentUser = Depends(require_admin)):
    payment = await service.set_refund_status(order_id, body.refund_status, body.refund_id)
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
