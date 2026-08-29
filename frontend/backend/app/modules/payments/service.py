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
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.db.base import utcnow
from app.db.models import (
    AdmissionOffer,
    BillingDetails,
    BookOrder,
    Offer,
    Payment,
    PaymentStatus,
    PlanConfig,
    RefundStatus,
    Student,
    Subscription,
    SubscriptionPlan,
)
from app.modules.notification import service as notif
from app.modules.payments import monthly
from app.shared import batch_enrolment
from app.shared import email_service, pdf_service

# Spec defaults (paise). New keys are inserted; existing rows are refreshed once
# per PLAN_SPEC_VERSION bump (see seed_plan_configs) so a live catalogue picks up
# a spec revision. amount = one-time admission/membership fee (charged upfront);
# monthly = quoted per-month fee; teacher = teacher-led classes per week; conv =
# conversation teams; community/support = years of access.
_MEMBERSHIP_DURATIONS = [3, 6, 12]

# A membership upgrade takes over on a date the learner picks, up to this many
# days after paying; until then the membership they hold runs untouched (spec).
UPGRADE_ACTIVATION_DAYS = 30

# The only downgrades offered: a Pro tier back to its standard tier, which
# differs only in the number of teacher-led classes per week (spec). A
# downgrade is free and takes effect from the next monthly payment cycle.
DOWNGRADE_PATHS = {
    SubscriptionPlan.silver_pro.value: SubscriptionPlan.silver.value,
    SubscriptionPlan.gold_pro.value: SubscriptionPlan.gold.value,
    SubscriptionPlan.diamond_pro.value: SubscriptionPlan.diamond.value,
}
PLAN_SPEC_VERSION = 4
PLAN_DEFAULTS = {
    # Tribe is the entry tier: the speaking community and an individual
    # speaking partner, one Speaking Test, and **no** community classes
    # ("conv": 0) and no CEFR test. Basic is the first tier with either.
    SubscriptionPlan.tribe: {
        "label": "Tribe", "amount": 79900, "monthly": 0,
        "teacher": 0, "conv": 0, "cefr": 0, "speaking": 1, "community": 1, "support": 0,
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
    """The live gateway client, or None when we are in offline/demo mode.

    Raises when real keys are configured but the SDK is missing: silently
    falling back to an `order_test_*` id would hand the buyer a checkout whose
    payment we can never verify (and which downstream treats as pre-paid)."""
    if not keys_configured():
        return None
    if razorpay is None:  # pragma: no cover - depends on the install
        raise ValidationAppError(
            "Payment gateway is unavailable (razorpay SDK is not installed)."
        )
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


def first_month_fee(cfg: PlanConfig, include: bool) -> int:
    """The first monthly fee (paise) when the buyer chose to pay it upfront.

    Offered on the tiers that have a monthly fee at all (Silver -> Diamond Pro);
    zero everywhere else, so a plan without one can never be over-charged."""
    return cfg.monthly_fee if include and cfg.monthly_fee > 0 else 0


async def active_subscription(student_id: str) -> Subscription | None:
    """The membership in force for this student, right now.

    A plan change parked on it is applied here the moment it comes due, so the
    student never reads a stale plan. The scheduler (`apply_due_plan_changes`)
    still sweeps in the background for everyone who is not looking, but it runs
    hourly and only while the process is up: without this, a member who paid to
    upgrade could open their dashboard on the activation date and still be shown
    the tier they left."""
    sub = await Subscription.find_one(
        Subscription.student_id == student_id,
        Subscription.is_active == True,  # noqa: E712
    )
    if sub and _change_is_due(sub):
        return await apply_plan_change(sub)
    return sub


def _change_is_due(sub: Subscription) -> bool:
    return bool(sub.pending_plan and sub.pending_plan_at
                and monthly.as_utc(sub.pending_plan_at) <= datetime.now(timezone.utc))


async def _refuse_stacked_upgrade(student_id: str) -> None:
    """Block a second membership order while a paid upgrade is still waiting for
    its activation date.

    The credit on an upgrade comes from the membership *in force*, which is
    still the tier being left until that date — so a second purchase would be
    priced against the old tier, and only the last one would ever be applied.
    A member who thought their upgrade had failed could pay for it twice."""
    sub = await active_subscription(student_id)
    if not (sub and sub.pending_plan and sub.pending_payment_id):
        return
    cfg = await PlanConfig.find_one(PlanConfig.plan == sub.pending_plan)
    when = monthly.as_utc(sub.pending_plan_at) if sub.pending_plan_at else None
    label = cfg.label if cfg else sub.pending_plan
    starts = f" and starts on {when:%d %b %Y}" if when else ""
    raise ConflictError(
        f"Your upgrade to {label} is already paid for{starts}. "
        "Please contact support if you need to change it."
    )


async def upgrade_quote(student_id: str, cfg: PlanConfig, base_price: int) -> dict:
    """What a member pays to move up a tier, and the credit they get for the
    membership they already hold.

    The upgrade price is always **standard price of the new tier − standard
    price of the tier held** (spec). "Standard" is the catalogue `amount`: a
    discount the learner once received — an admission-offer link, a promotional
    `offer_price` — must not change what the upgrade costs, in either direction.

    It is only an upgrade when the new tier costs more; renewing the same plan,
    or moving to a cheaper one, is charged normally and gets no credit
    (otherwise a renewal would cost zero)."""
    flat = {"is_upgrade": False, "previous_plan": None, "previous_label": None,
            "admission": base_price, "adjustment": 0, "payable": base_price,
            "activation_days": UPGRADE_ACTIVATION_DAYS}
    sub_ = await active_subscription(student_id)
    if not sub_ or sub_.plan == cfg.plan:
        return flat
    previous = await PlanConfig.find_one(PlanConfig.plan == sub_.plan)
    if not previous:
        return flat
    credit, admission = previous.amount, cfg.amount
    if credit <= 0 or credit >= admission:
        return flat
    return {"is_upgrade": True, "previous_plan": previous.plan,
            "previous_label": previous.label, "admission": admission,
            "adjustment": credit, "payable": admission - credit,
            "activation_days": UPGRADE_ACTIVATION_DAYS}


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def resolve_member_offer(offer_id: str, student_id: str, plan: str) -> Offer:
    """A live dashboard offer this member may pay at, for `plan`.

    The amount on the offer is the payable — not a catalogue discount to net
    against an upgrade credit. Wrong plan, lapsed, or not targeted here is a
    hard refuse so checkout cannot silently fall back to the standard fee."""
    offer = await Offer.get(offer_id)
    if not offer or not offer.active or offer.is_archived:
        raise ValidationAppError("This offer is no longer available")
    if offer.plan != plan:
        raise ValidationAppError("This offer does not apply to the selected membership")
    if not offer.amount or offer.amount <= 0:
        raise ValidationAppError("This offer has no price")
    if offer.target_student_ids and student_id not in offer.target_student_ids:
        raise ValidationAppError("This offer is not available to you")
    now = utcnow()
    starts, ends = _as_utc(offer.starts_at), _as_utc(offer.ends_at)
    if starts and starts > now:
        raise ValidationAppError("This offer is not yet available")
    if ends and ends < now:
        raise ValidationAppError("This offer has expired")
    return offer


async def apply_member_offer(quote: dict, offer_id: str, student_id: str,
                             plan: str) -> dict:
    """Replace the quote's payable with the dashboard offer amount."""
    offer = await resolve_member_offer(offer_id, student_id, plan)
    ends = _as_utc(offer.ends_at)
    return {
        **quote,
        "admission": offer.amount,
        "adjustment": 0,
        "payable": offer.amount,
        "offer_id": str(offer.id),
        "list_price": quote["payable"],
        "offer_expires_at": ends.isoformat() if ends else None,
    }


def parse_activation_date(value: str | None) -> datetime | None:
    """The date the learner chose for an upgraded membership to take over
    ("YYYY-MM-DD"). Today — or nothing at all — means as soon as the payment
    lands; anything beyond the 30-day window is refused."""
    if not value:
        return None
    try:
        when = datetime.strptime(value.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise ValidationAppError("Activation date must be in YYYY-MM-DD format")
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    if when < today or when > today + timedelta(days=UPGRADE_ACTIVATION_DAYS):
        raise ValidationAppError(
            f"Choose an activation date within {UPGRADE_ACTIVATION_DAYS} days from today."
        )
    return when


# ---------------------------------------------------------------------------
# Plan changes: upgrade (paid, starts on a date the learner picks) and
# downgrade (free, starts at the next monthly cycle). Both land in switch_plan,
# so a membership is never swapped over in two different ways.
# ---------------------------------------------------------------------------
async def switch_plan(student_id: str, plan: str, *, months: int | None = None,
                      payment_id: str | None = None,
                      first_month_included: bool = False,
                      carry: Subscription | None = None) -> Subscription:
    """Put `plan` in force for this student, replacing whatever is active.

    On a plan change (`carry` = the membership being left) the entitlements are
    **not restarted**: the new tier's time-based benefits are counted from the
    original membership start, so a Basic member six months in who upgrades to
    Diamond has 5 years of community access from that first start - 4 years 6
    months of it still ahead - not 5 fresh years. Counted entitlements (CEFR /
    Speaking tests) carry across for free: eligibility is the new tier's total
    and every test already taken is deducted from it (`exams._eligibility`
    counts every booking the student ever made). The monthly-fee cycle carries
    too, so a change never re-anchors billing or re-sends a reminder.

    A renewal passes no `carry` and so starts a fresh window, as before."""
    cfg = await get_plan_config(plan)
    now = datetime.now(timezone.utc)
    days = _months_to_days(months) if months else cfg.duration_days
    started = monthly.as_utc(carry.benefits_start_at or carry.started_at) if carry else now
    await Subscription.find(
        Subscription.student_id == student_id, Subscription.is_active == True  # noqa: E712
    ).update({"$set": {"is_active": False}})
    sub = Subscription(
        student_id=student_id, plan=plan, started_at=now,
        # Never land the expiry in the past: an upgrade bought at the very end
        # of a membership year still leaves the new tier active today.
        expires_at=max(started + timedelta(days=days), now),
        benefits_start_at=started, is_active=True, months=months,
        billing_start_at=carry.billing_start_at if carry else None,
        first_month_included=carry.first_month_included if carry else first_month_included,
        monthly_reminders_sent=list(carry.monthly_reminders_sent) if carry else [],
        cefr_tests=cfg.cefr_tests, speaking_tests=cfg.speaking_tests,
        payment_id=payment_id,
    )
    await sub.insert()
    return sub


async def apply_plan_change(sub: Subscription) -> Subscription:
    """Switch a membership over to the change parked on it, and tell the
    student. The duration comes from the upgrade payment when there was one; a
    downgrade keeps the term already bought."""
    months = sub.months
    if sub.pending_payment_id:
        payment = await Payment.get(sub.pending_payment_id)
        if payment:
            months = payment.months or months
    new = await switch_plan(sub.student_id, sub.pending_plan, months=months,
                            payment_id=sub.pending_payment_id, carry=sub)
    # switch_plan has already deactivated this row in the DB; clear the parked
    # change so the replaced record can never be picked up a second time.
    sub.pending_plan = sub.pending_plan_at = sub.pending_payment_id = None
    sub.is_active = False
    await sub.save()
    cfg = await PlanConfig.find_one(PlanConfig.plan == new.plan)
    await notif.notify(
        sub.student_id, "Membership updated",
        f"Your {cfg.label if cfg else new.plan} membership is now active. Benefits "
        "already used under your previous membership have been carried over.",
        kind="membership",
    )
    return new


async def apply_due_plan_changes() -> int:
    """Scheduled upgrades and downgrades that have come due (scheduler job).
    Idempotent: applying one replaces the subscription row it was parked on."""
    subs = await Subscription.find({
        "is_active": True, "pending_plan": {"$ne": None},
    }).to_list()
    applied = 0
    for sub in subs:
        if not _change_is_due(sub):
            continue
        await apply_plan_change(sub)
        applied += 1
    return applied


async def _downgrade_target(plan: str) -> PlanConfig | None:
    key = DOWNGRADE_PATHS.get(plan)
    return await PlanConfig.find_one(PlanConfig.plan == key) if key else None


def _next_cycle_date(sub: Subscription) -> datetime:
    """When a downgrade takes effect: the learner's next monthly payment cycle.
    The Pro benefits already paid for run to the end of the cycle they are in
    (spec). A membership with no cycle left changes over at once."""
    now = datetime.now(timezone.utc)
    for due in monthly.due_dates(sub):
        if due > now:
            return due
    return now


async def plan_change_state(student_id: str) -> dict:
    """The membership change scheduled for this member, and the one they may
    ask for. Drives the Subscription page."""
    sub = await active_subscription(student_id)
    if not sub:
        return {"plan": None, "plan_label": None, "pending": None, "downgrade": None}
    current = await PlanConfig.find_one(PlanConfig.plan == sub.plan)

    pending = None
    if sub.pending_plan:
        cfg = await PlanConfig.find_one(PlanConfig.plan == sub.pending_plan)
        pending = {
            "plan": sub.pending_plan,
            "label": cfg.label if cfg else sub.pending_plan,
            "effective_at": monthly.as_utc(sub.pending_plan_at).isoformat()
            if sub.pending_plan_at else None,
            "kind": "upgrade" if sub.pending_payment_id else "downgrade",
            # Only a change nobody has paid for can be called off.
            "cancellable": sub.pending_payment_id is None,
        }

    target = await _downgrade_target(sub.plan) if not sub.pending_plan else None
    downgrade = None
    if target:
        downgrade = {
            "plan": target.plan, "label": target.label,
            "monthly_fee": target.monthly_fee,
            "classes_per_week": target.classes_per_week,
            "effective_at": _next_cycle_date(sub).isoformat(),
        }
    return {"plan": sub.plan, "plan_label": current.label if current else sub.plan,
            "pending": pending, "downgrade": downgrade}


async def request_downgrade(student_id: str) -> dict:
    """Schedule the Pro -> standard downgrade for the next monthly cycle. No
    money changes hands and no activation date is chosen: the Pro benefits run
    to the end of the cycle already paid for, then the standard tier takes over
    with everything consumed so far carried across."""
    sub = await active_subscription(student_id)
    if not sub:
        raise ValidationAppError("You do not have an active membership.")
    if sub.pending_plan:
        raise ConflictError("A membership change is already scheduled.")
    target = await _downgrade_target(sub.plan)
    if not target:
        raise ValidationAppError(
            "Only Silver Pro, Gold Pro and Diamond Pro memberships can be downgraded."
        )
    when = _next_cycle_date(sub)
    sub.pending_plan, sub.pending_plan_at, sub.pending_payment_id = target.plan, when, None
    await sub.save()
    if when <= datetime.now(timezone.utc):
        # Nothing left of the current cycle to run out - switch over now rather
        # than report a change that has not happened.
        await apply_plan_change(sub)
    return await plan_change_state(student_id)


async def cancel_plan_change(student_id: str) -> dict:
    """Call off a scheduled downgrade. A paid upgrade is not cancellable here -
    that is a refund, which admin handles."""
    sub = await active_subscription(student_id)
    if not sub or not sub.pending_plan:
        raise NotFoundError("No membership change is scheduled.")
    if sub.pending_payment_id:
        raise ConflictError(
            "This upgrade has already been paid for. Please contact support to change it."
        )
    sub.pending_plan = sub.pending_plan_at = None
    await sub.save()
    return await plan_change_state(student_id)


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
                # Auto-capture: without it an account set to manual capture leaves
                # the payment authorised, `payment.captured` never fires and the
                # order is never fulfilled.
                "payment_capture": 1,
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
                       terms_accepted: bool = False,
                       billing: BillingDetails | None = None,
                       include_first_month: bool = False,
                       delivery_type: str | None = None,
                       activate_on: str | None = None,
                       offer_id: str | None = None) -> dict:
    """Start a gateway order. The price is always resolved here, never sent by
    the client.

    A subscription order may carry two optional extras:
    `include_first_month` adds the plan's first monthly fee to the upfront
    charge, and `delivery_type` ("home"/"office") ships the SpeakEdge Book with
    the membership — the same bundle a new joiner buys, for a member paying from
    inside the app.

    An upgrade may also carry `activate_on` ("YYYY-MM-DD", within 30 days): the
    membership already held runs untouched until that date, and the upgraded one
    takes over from it."""
    plan_amount = first_month_amount = 0
    quote = None
    activate_at = None
    # Only a subscription order can be an upgrade; the rest carry no credit.
    upgrade = {"is_upgrade": False, "previous_plan": None, "previous_label": None,
               "admission": 0, "adjustment": 0, "payable": 0}
    if kind == "subscription":
        if not plan:
            raise ValidationAppError("Invalid subscription plan")
        cfg = await get_plan_config(plan)
        if not cfg.enabled:
            raise ValidationAppError("This plan is not currently available")
        months = _normalize_months(cfg, months)
        await _refuse_stacked_upgrade(student_id)
        upgrade = await upgrade_quote(student_id, cfg, _price_for(cfg, months))
        if offer_id:
            # Dashboard exclusive offer: the admin-set amount is the payable.
            # Do not mix it with the catalogue upgrade credit — the receipt
            # would no longer add up, and the student would not pay ₹500.
            upgrade = await apply_member_offer(upgrade, offer_id, student_id, plan)
        plan_amount = upgrade["payable"]
        # An upgrade is membership only: no second SpeakEdge Book is provided,
        # and the first monthly fee is not collected on it, so the receipt shows
        # nothing but the fee adjustment. A priced member offer is the same —
        # the amount on the offer is the whole charge.
        if upgrade["is_upgrade"] or offer_id:
            include_first_month = False
            delivery_type = None
            activate_at = parse_activation_date(activate_on) if upgrade["is_upgrade"] else None
        first_month_amount = first_month_fee(cfg, include_first_month)
        amount = plan_amount + first_month_amount
        quote = await _book_quote(delivery_type, billing)
        if quote:
            amount += quote["book_amount"] + quote["gst_amount"] + quote["delivery_charge"]
    if kind == "subscription" and upgrade["is_upgrade"] and amount <= 0:
        raise ValidationAppError(
            "The membership you already hold covers this tier's admission fee — "
            "there is nothing to pay. Please contact support to change your plan."
        )
    if not amount or amount <= 0:
        raise ValidationAppError("Invalid amount")

    from app.modules.book import service as book_service  # avoids an import cycle

    # Hold the copy before the gateway order exists, exactly as the guest
    # checkout does: two buyers must not both be able to pay for the last one.
    if quote:
        await book_service.adjust_inventory(
            str(quote["product"].id), "reserve", 1, actor="system",
            reason="membership checkout started",
        )
    try:
        order_id = await _create_gateway_order(
            amount,
            {"student_id": student_id, "plan": plan or "", "kind": kind, "months": months or ""},
        )
    except Exception:
        # No order will ever exist to release this hold, so give the copy back.
        if quote:
            await book_service.adjust_inventory(
                str(quote["product"].id), "release", 1, actor="system",
                reason="gateway order failed",
            )
        raise

    payment = Payment(
        student_id=student_id, kind=kind, plan=plan or None, months=months,
        due_month=due_month, amount=amount, status=PaymentStatus.created,
        first_month_included=first_month_amount > 0,
        first_month_amount=first_month_amount,
        previous_plan=upgrade["previous_plan"], upgrade_adjustment=upgrade["adjustment"],
        upgrade_activate_on=activate_at,
        payment_mode="razorpay", razorpay_order_id=order_id,
        terms_accepted_at=utcnow() if terms_accepted else None,
        terms_version=settings.TERMS_VERSION if terms_accepted else None,
        billing=billing,
    )
    await payment.insert()
    if quote:
        await book_service.create_membership_shipment(
            payment=payment, quote=quote, billing=billing, student_id=student_id,
            plan=plan, months=months, plan_amount=plan_amount,
            first_month_amount=first_month_amount,
        )
    if billing:
        await _save_billing_to_profile(student_id, billing)
    return {
        "order_id": order_id, "amount": amount, "currency": "INR",
        "key_id": settings.RAZORPAY_KEY_ID, "payment_ref": str(payment.id),
        "plan_amount": plan_amount, "first_month_amount": first_month_amount,
        "is_upgrade": upgrade["is_upgrade"], "previous_plan": upgrade["previous_label"],
        "upgrade_adjustment": upgrade["adjustment"], "admission": upgrade["admission"],
        "activate_on": activate_at.isoformat() if activate_at else None,
        "book_amount": quote["book_amount"] if quote else 0,
        "gst_amount": quote["gst_amount"] if quote else 0,
        "delivery_charge": quote["delivery_charge"] if quote else 0,
    }


async def _book_quote(delivery_type: str | None, billing: BillingDetails | None) -> dict | None:
    """Price the SpeakEdge Book onto a member's subscription order, or None when
    there is nothing to ship.

    An unconfigured or out-of-stock book falls back to membership-only rather
    than failing the order — the same rule the guest checkout follows, so an
    inventory problem never blocks someone paying for a membership."""
    if delivery_type not in ("home", "office"):
        return None
    if delivery_type == "home" and not (billing and billing.address_line1 and billing.pin_code):
        raise ValidationAppError(
            "Home delivery requires at least address line 1 and a PIN code"
        )
    from app.modules.book import service as book_service  # avoids an import cycle

    product = await book_service.get_speakedge_book()
    if not product or product.available <= 0:
        return None
    # The membership fee covers the SpeakEdge Book: the copy ships with the
    # plan and is never charged for on top of it, so there is no book line and
    # no GST on one. Delivery is a real cost and is still charged for home
    # delivery.
    return {
        "product": product,
        "delivery_type": delivery_type,
        "book_amount": 0,
        "gst_amount": 0,
        "delivery_charge": (settings.BOOK_DELIVERY_CHARGE_PAISE
                            if delivery_type == "home" else 0),
    }


async def _save_billing_to_profile(student_id: str, billing: BillingDetails) -> None:
    """Keep the profile in step with what the buyer typed at checkout. The form
    is prefilled from the profile, so anything different here is a correction —
    empty fields are left alone rather than blanking good data."""
    student = await Student.find_one(Student.student_id == student_id)
    if not student:
        return
    address = ", ".join(
        p for p in (billing.address_line1, billing.address_line2, billing.landmark,
                    billing.city) if p
    )
    for field, value in (("phone", billing.phone), ("email", billing.email),
                         ("address", address), ("state", billing.state),
                         ("district", billing.district), ("pin_code", billing.pin_code)):
        if value:
            setattr(student, field, value)
    student.touch()
    await student.save()


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

    claimed = await _claim_for_fulfilment(payment, PaymentStatus.paid, {
        "razorpay_payment_id": payment_id, "razorpay_signature": signature,
    })
    if not claimed:
        # Another caller is already fulfilling this order. Razorpay sends both
        # payment.captured and order.paid while the browser posts /verify, so
        # this is the normal concurrent case, not an error.
        return await Payment.get(payment.id) or payment
    await _fulfil(claimed)
    return claimed


async def _claim_for_fulfilment(payment: Payment, status: PaymentStatus,
                                extra: dict | None = None) -> Payment | None:
    """Atomically move a payment into a paid state, exactly once.

    Fulfilment creates a Subscription, an invoice and an activation-code
    reservation, so it must not run twice for one order. Read-check-write is not
    enough here: /verify and two webhook events arrive at the same instant. The
    conditional update is the lock — the loser gets None and does nothing."""
    fields = {"status": status.value, "paid_at": utcnow(), **(extra or {})}
    res = await Payment.find(
        Payment.id == payment.id,
        {"status": {"$nin": [PaymentStatus.paid.value, PaymentStatus.manually_approved.value]}},
    ).update({"$set": fields})
    if not getattr(res, "modified_count", 0):
        return None
    return await Payment.get(payment.id)


def _invoice_item(payment: Payment, book_order: BookOrder | None) -> str:
    """Description line printed on the tax invoice — shared by fulfilment (which
    snapshots a copy to disk) and the on-demand download."""
    item = f"{payment.kind.title()} {payment.plan or ''}".strip()
    if payment.kind == "monthly":
        when = payment.due_month or ""
        if when:
            when = f" — {datetime.strptime(when, '%Y-%m'):%b %Y}"
        item = f"{payment.plan or 'Membership'} monthly fee{when}"
    if payment.kind == "general":
        item = payment.purpose or "General payment"
    if payment.kind == "book":
        membership = f"{payment.plan.replace('_', ' ').title()} Membership" if payment.plan \
            else "SpeakEdge Membership"
        if not (book_order and book_order.product_id):
            item = membership  # membership-only order: no book ships
        else:
            item = f"SpeakEdge Book + {membership}" + (
                " (Home Delivery)" if book_order and book_order.delivery_type == "home"
                else " (Office Collection)"
            )
    if payment.kind == "subscription" and book_order:
        item += " + SpeakEdge Book" + (
            " (Home Delivery)" if book_order.delivery_type == "home"
            else " (Office Collection)"
        )
    if payment.first_month_amount:
        item += " + first month fee"
    return item


def _customer_ref(payment: Payment, book_order: BookOrder | None) -> str:
    """What to print as the customer reference on the invoice. A guest order is
    keyed `guest:<phone>` internally; that is plumbing, not something to show a
    paying customer, so it prints as their phone number."""
    if payment.student_id.startswith("guest:"):
        return book_order.phone if book_order else payment.student_id.split(":", 1)[1]
    return payment.student_id


def _apply_gst(payment: Payment, book_order: BookOrder | None) -> None:
    """Record the tax split on the payment so the invoice can show a breakup.

    Only book orders carry GST today (plan fees are quoted tax-inclusive and
    charge none), and only once a seller GSTIN is configured — printing a tax
    breakup without one would be a false tax invoice."""
    if not (settings.SELLER_GSTIN and book_order and book_order.gst_amount):
        return
    tax = book_order.gst_amount
    payment.gst_number = settings.SELLER_GSTIN
    payment.taxable_amount = payment.amount - tax
    payment.total_tax = tax
    # Same state as the seller is an intra-state supply (CGST+SGST); anywhere
    # else is inter-state (IGST).
    if (book_order.state or "").strip().lower() == settings.SELLER_STATE.strip().lower():
        payment.cgst = tax // 2
        payment.sgst = tax - payment.cgst
        payment.igst = None
    else:
        payment.igst = tax
        payment.cgst = payment.sgst = None
    payment.gst_invoice_no = payment.invoice_no


async def _fulfil(payment: Payment) -> None:
    student = await Student.find_one(Student.student_id == payment.student_id)
    name = student.full_name if student else payment.student_id

    # A book order rides on a guest's bundle (kind="book") and, now that a
    # member can have the book shipped with a renewal, on a subscription too.
    book_order = await BookOrder.find_one(BookOrder.payment_id == str(payment.id))
    if book_order and payment.kind == "book":
        name = book_order.buyer_name

    # Invoice
    invoice_no = f"SPK-INV-{datetime.utcnow():%Y%m}-{uuid.uuid4().hex[:6].upper()}"
    item = _invoice_item(payment, book_order)
    payment.invoice_no = invoice_no
    _apply_gst(payment, book_order)
    payment.invoice_url = pdf_service.generate_invoice(
        invoice_no, name, _customer_ref(payment, book_order), item, payment.amount,
        taxable_amount=payment.taxable_amount, cgst=payment.cgst, sgst=payment.sgst,
        igst=payment.igst, gstin=payment.gst_number,
    )

    # Activate subscription with plan-tier exam eligibility (Module 10)
    if payment.kind == "subscription" and payment.plan:
        await _apply_subscription_payment(payment)

    await payment.save()

    # A monthly fee buys the next cycle of teacher-led classes. The student
    # already chose their weekly slot and had it approved, so the seat simply
    # rolls forward — no fresh request, no second approval.
    if payment.kind == "monthly":
        added = await batch_enrolment.extend(payment.student_id)
        if added:
            total = sum(added.values())
            await notif.notify(
                payment.student_id, "Classes scheduled",
                f"Your next {total} teacher-led class(es) are confirmed on your "
                "usual weekly slot.", kind="info")

    # Book order fulfilment: confirm, reserve inventory + activation code, notify.
    if book_order:
        from app.modules.book import service as book_service  # avoids import cycle
        await book_service.on_book_order_paid(payment)

    # A guest has no account to read an in-app notification yet — they are told
    # by SMS/WhatsApp from the book order instead.
    if not payment.student_id.startswith("guest:"):
        await notif.notify(payment.student_id, "Payment received",
                           f"Your payment succeeded. Invoice {invoice_no} is available.",
                           kind="payment")
    email_to = student.email if student else (book_order.email if book_order else None)
    if email_to:
        email_service.payment_email(email_to, name, invoice_no)


async def _apply_subscription_payment(payment: Payment) -> None:
    """Put the paid membership in force — or, for an upgrade the learner asked
    to start later, park it on the membership they already hold.

    Until the chosen activation date that membership and its benefits run
    untouched, exactly as the pre-payment notice promises; the scheduler switches
    it over on the day (`apply_due_plan_changes`)."""
    current = await active_subscription(payment.student_id)
    # `previous_plan` is stamped only on an upgrade, so it is the marker for one.
    upgrading = bool(payment.previous_plan) and current is not None
    starts = payment.upgrade_activate_on
    if upgrading and starts and monthly.as_utc(starts) > datetime.now(timezone.utc):
        current.pending_plan = payment.plan
        current.pending_plan_at = monthly.as_utc(starts)
        current.pending_payment_id = str(payment.id)
        await current.save()
        cfg = await PlanConfig.find_one(PlanConfig.plan == payment.plan)
        await notif.notify(
            payment.student_id, "Upgrade scheduled",
            f"Your {cfg.label if cfg else payment.plan} membership starts on "
            f"{monthly.as_utc(starts):%d %b %Y}. Until then your current membership "
            "and its benefits continue as they are.",
            kind="membership",
        )
        return
    await switch_plan(payment.student_id, payment.plan, months=payment.months,
                      payment_id=str(payment.id),
                      first_month_included=payment.first_month_included,
                      carry=current if upgrading else None)


def _rupees(paise: int) -> str:
    return f"Rs.{paise / 100:,.2f}"


async def build_payment_receipt(payment: Payment) -> bytes:
    """Payment / Order Receipt for a payment made from inside the app —
    membership upgrade, renewal, monthly Teacher-led Class fee, or a general
    payment recorded by admin.

    An order that shipped something already has the fuller record — order
    number, delivery address, status timeline — so that one is rendered
    instead of a second, thinner document describing the same money."""
    from app.modules.book import service as book_service  # avoids an import cycle

    book_order = await BookOrder.find_one(BookOrder.payment_id == str(payment.id))
    if book_order:
        return await book_service.build_receipt(book_order)

    try:
        label = (await get_plan_config(payment.plan)).label if payment.plan else "Membership"
    except NotFoundError:
        label = payment.plan or "Membership"

    paid = payment.status in (PaymentStatus.paid, PaymentStatus.manually_approved)
    lines: list[tuple[str, int]] = []
    extra_meta: list[tuple[str, str]] = []
    total_label = "Total Paid"
    fields: dict = {}

    if payment.kind == "general":
        # Purpose is whatever admin selected or typed; nothing else applies.
        purpose = payment.purpose or "General payment"
        lines.append((purpose, payment.amount))
        status, kind = "Payment Successful", "general"
        fields = {"amount": _rupees(payment.amount), "purpose": purpose}

    elif payment.kind == "monthly":
        when = ""
        if payment.due_month:
            when = f" - {datetime.strptime(payment.due_month, '%Y-%m'):%b %Y}"
        lines.append((f"{label} monthly Teacher-led Class fee{when}", payment.amount))
        status = "Payment Successful"
        # Settling a month that fell due in an earlier month means access had
        # lapsed, so the learner is resuming rather than continuing.
        kind = "monthly_class"
        when_paid = payment.paid_at or payment.created_at or utcnow()
        if payment.due_month and payment.due_month < f"{when_paid:%Y-%m}":
            kind = "monthly_class_restart"

    elif payment.upgrade_adjustment:
        previous = payment.previous_plan or "previous membership"
        try:
            previous = (await get_plan_config(payment.previous_plan)).label
        except (NotFoundError, TypeError):
            pass
        extra_meta = [("Previous Membership", previous), ("Upgraded Membership", label)]
        # The full admission fee, then the credit, then what was actually paid —
        # the adjustment has to be visible, not folded into a single figure.
        lines = [
            ("Applicable Admission Fee", payment.amount + payment.upgrade_adjustment),
            ("Eligible Previous Fee Adjustment", -payment.upgrade_adjustment),
        ]
        total_label = "Amount Paid for Upgrade"
        status, kind = "Membership Upgrade Successful", "membership_upgrade"
        fields = {"plan": label}

    else:
        lines.append((f"{label} Membership (one-time admission fee)",
                      payment.amount - payment.first_month_amount))
        if payment.first_month_amount:
            lines.append((f"{label} first month fee", payment.first_month_amount))
        status, kind = "Membership Active", "membership_renewal"

    student = await Student.find_one(Student.student_id == payment.student_id)
    billing = payment.billing
    title, body = pdf_service.receipt_note(kind, **fields)
    return pdf_service.payment_receipt_bytes(
        receipt_no=payment.invoice_no or payment.razorpay_order_id or str(payment.id),
        transaction_type=pdf_service.RECEIPT_TYPES[kind],
        date=payment.paid_at or payment.created_at or utcnow(),
        status=status if paid else payment.status.value,
        customer_name=(billing.name if billing and billing.name
                       else (student.full_name if student else payment.student_id)),
        student_id=payment.student_id,
        mobile=(billing.phone if billing and billing.phone
                else (student.phone if student else "")) or "-",
        extra_meta=extra_meta,
        # Nothing physical moves on an upgrade, a renewal without a book, a
        # monthly fee or a general payment.
        delivery=None,
        lines=lines, total_paise=payment.amount, total_label=total_label,
        payment_status="Paid" if paid else payment.status.value,
        transaction_id=(payment.razorpay_payment_id or payment.transaction_ref
                        or payment.razorpay_order_id),
        note_title=title, note_body=body,
    )


async def build_invoice_pdf(payment: Payment) -> bytes:
    """Tax invoice for a fulfilled payment, rendered on demand.

    Fulfilment still writes a copy under /media, but that file is gone after a
    container restart unless a volume is mounted — so this rebuilds from the
    Payment (+ its BookOrder) rather than reading the disk."""
    if not payment.invoice_no:
        raise NotFoundError("Invoice not found")
    student = await Student.find_one(Student.student_id == payment.student_id)
    book_order = await BookOrder.find_one(BookOrder.payment_id == str(payment.id))
    name = student.full_name if student else payment.student_id
    if book_order and payment.kind == "book":
        name = book_order.buyer_name
    return pdf_service.invoice_bytes(
        payment.invoice_no, name, _customer_ref(payment, book_order),
        _invoice_item(payment, book_order), payment.amount,
        taxable_amount=payment.taxable_amount, cgst=payment.cgst,
        sgst=payment.sgst, igst=payment.igst, gstin=payment.gst_number,
    )


# The value shipped in .env.example / the Settings default. Signing with it is
# not a secret anybody has to guess, so it must never authenticate a webhook.
_PLACEHOLDER_WEBHOOK_SECRET = "webhook_secret"


def webhook_configured() -> bool:
    """True once a real webhook secret is set in the environment."""
    secret = settings.RAZORPAY_WEBHOOK_SECRET or ""
    return bool(secret) and secret != _PLACEHOLDER_WEBHOOK_SECRET


def verify_webhook_signature(body: bytes, signature: str) -> bool:
    """Webhooks are trusted callers — `verify_and_activate(trusted=True)` skips
    the per-order signature on their say-so — so an unset/placeholder secret
    must fail closed rather than let anyone forge a captured payment."""
    if not (signature and webhook_configured()):
        return False
    expected = hmac.new(settings.RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


# Suggestions for the admin's "payment purpose" picker. Free text is accepted
# too — this is a shortlist, not an allowlist, because the whole point of a
# general payment is that it does not fit the other categories.
GENERAL_PAYMENT_PURPOSES = [
    "Study material",
    "Workshop / event fee",
    "Certificate re-issue",
    "Replacement SpeakEdge Book",
    "Exam re-attempt fee",
    "Late fee",
    "Other",
]


async def record_general_payment(student_id: str, amount: int, purpose: str, *,
                                 payment_mode: str = "manual",
                                 transaction_ref: str | None = None,
                                 remarks: str | None = None) -> Payment:
    """Record a miscellaneous payment already collected (admin, Module 11).

    It fits none of the other categories, so the purpose admin selects or types
    is what the receipt prints as the description. Settled on creation — the
    money arrived outside the gateway — which generates the invoice."""
    purpose = (purpose or "").strip()
    if not purpose:
        raise ValidationAppError("A payment purpose is required")
    if amount <= 0:
        raise ValidationAppError("Invalid amount")
    payment = Payment(
        student_id=student_id, kind="general", purpose=purpose, amount=amount,
        status=PaymentStatus.manually_approved, paid_at=utcnow(),
        payment_mode=payment_mode, transaction_ref=transaction_ref, remarks=remarks,
    )
    await payment.insert()
    await _fulfil(payment)
    return payment


async def manual_approve(order_id: str, approver: str, *, payment_mode: str | None = None,
                         transaction_ref: str | None = None, remarks: str | None = None) -> Payment:
    """Admin approval for payments received outside Razorpay (Module 11)."""
    payment = await Payment.find_one(Payment.razorpay_order_id == order_id)
    if not payment:
        raise NotFoundError("Order not found")
    if payment.status in (PaymentStatus.paid, PaymentStatus.manually_approved):
        return payment  # already fulfilled
    claimed = await _claim_for_fulfilment(payment, PaymentStatus.manually_approved, {
        "payment_mode": payment_mode or payment.payment_mode or "manual",
        "transaction_ref": transaction_ref, "remarks": remarks,
    })
    if not claimed:
        return await Payment.get(payment.id) or payment
    await _fulfil(claimed)
    return claimed


# --------------------------------------------------------------------------
# Refunds
# --------------------------------------------------------------------------
async def refund_payment(payment: Payment, *, amount: int | None = None,
                         reason: str | None = None) -> Payment:
    """Send the money back through Razorpay, then record it.

    The gateway call comes first: marking a record `refunded` without it would
    tell the customer (and the books) that they were paid back when they were
    not. Payments taken outside the gateway — manual approval, offline demo
    orders — have nothing to call, so they are recorded as settled by hand."""
    if payment.status in (PaymentStatus.refunded, PaymentStatus.partially_refunded):
        return payment  # idempotent

    partial = amount is not None and amount < payment.amount
    client = _client()
    if client is not None and payment.razorpay_payment_id and \
            payment.payment_mode == "razorpay":
        try:
            refund = client.payment.refund(payment.razorpay_payment_id, {
                "amount": amount or payment.amount,
                "speed": "normal",
                "notes": {"reason": reason or "cancelled by SpeakEdge"},
            })
        except Exception as exc:  # pragma: no cover - network failure path
            raise ValidationAppError(
                f"The gateway refused the refund: {exc}. Nothing was recorded — "
                "retry, or refund from the Razorpay dashboard and mark it manually."
            ) from exc
        payment.refund_id = refund.get("id")
    else:
        payment.remarks = " ".join(filter(None, [
            payment.remarks, "[refund settled outside the gateway]",
        ]))

    payment.refund_status = RefundStatus.partially_refunded if partial \
        else RefundStatus.refunded
    payment.status = PaymentStatus.partially_refunded if partial \
        else PaymentStatus.refunded
    payment.touch()
    await payment.save()
    return payment


async def record_failure(order_id: str | None, payment_id: str | None,
                         reason: str) -> Payment | None:
    """Mark a gateway-rejected attempt as failed (webhook). Never touches a
    payment that has already succeeded — a buyer often fails once, then pays."""
    if not order_id:
        return None
    payment = await Payment.find_one(Payment.razorpay_order_id == order_id)
    if not payment or payment.status in (PaymentStatus.paid, PaymentStatus.manually_approved,
                                         PaymentStatus.refunded,
                                         PaymentStatus.partially_refunded):
        return payment
    payment.status = PaymentStatus.failed
    payment.failure_reason = reason
    if payment_id:
        payment.razorpay_payment_id = payment_id
    payment.touch()
    await payment.save()
    return payment


async def record_refund(razorpay_payment_id: str | None, refund_id: str | None,
                        amount: int | None) -> Payment | None:
    """Reconcile a refund issued from the Razorpay dashboard (webhook), so the
    record matches the money even when the refund did not start here."""
    if not razorpay_payment_id:
        return None
    payment = await Payment.find_one(Payment.razorpay_payment_id == razorpay_payment_id)
    if not payment:
        return None
    partial = amount is not None and amount < payment.amount
    payment.refund_id = refund_id or payment.refund_id
    payment.refund_status = RefundStatus.partially_refunded if partial \
        else RefundStatus.refunded
    payment.status = PaymentStatus.partially_refunded if partial else PaymentStatus.refunded
    payment.touch()
    await payment.save()
    return payment


async def set_refund_status(order_id: str, refund_status: RefundStatus,
                            refund_id: str | None = None,
                            amount: int | None = None) -> Payment:
    """Admin-managed refund lifecycle: Requested -> Under Review -> Approved/
    Rejected -> Refunded / Partially Refunded (Module 11).

    The two terminal states actually move money — they call the gateway via
    `refund_payment` rather than only flipping the record."""
    payment = await Payment.find_one(Payment.razorpay_order_id == order_id)
    if not payment:
        raise NotFoundError("Order not found")

    if refund_status in (RefundStatus.refunded, RefundStatus.partially_refunded):
        if refund_status == RefundStatus.partially_refunded and not amount:
            raise ValidationAppError("A partial refund needs the amount to refund (paise)")
        payment = await refund_payment(payment, amount=amount)
        if refund_id:  # admin's own reference wins over the gateway's
            payment.refund_id = refund_id
            await payment.save()
        return payment

    payment.refund_status = refund_status
    if refund_id:
        payment.refund_id = refund_id
    payment.touch()
    await payment.save()
    return payment


# --------------------------------------------------------------------------
# New-student offers: a temporary discounted admission fee on a shareable link
# --------------------------------------------------------------------------
# The only validity windows admin may choose. A link is a promise made over
# WhatsApp/email, so it is deliberately short and never open-ended.
OFFER_VALID_HOURS = (24, 48, 72)


def offer_live(offer: AdmissionOffer, at: datetime | None = None) -> bool:
    """An offer is honoured only while it is neither revoked nor expired."""
    expires = offer.expires_at
    if expires.tzinfo is None:  # Mongo hands naive datetimes back
        expires = expires.replace(tzinfo=timezone.utc)
    return not offer.is_archived and expires > (at or utcnow())


async def create_admission_offer(*, plan: str, price: int, valid_hours: int,
                                 created_by: str, student_name: str | None = None,
                                 phone: str | None = None, email: str | None = None,
                                 note: str | None = None) -> AdmissionOffer:
    """Mint a discounted-admission payment link for a prospect.

    The price is checked against the live catalogue: an "offer" at or above the
    regular admission fee is a mistake, not a discount."""
    if valid_hours not in OFFER_VALID_HOURS:
        raise ValidationAppError(
            "Link validity must be one of "
            + ", ".join(f"{h} hours" for h in OFFER_VALID_HOURS)
        )
    cfg = await get_plan_config(plan)
    if not cfg.enabled:
        raise ValidationAppError("This plan is not currently available")
    list_price = _admission_for(cfg)
    if price <= 0:
        raise ValidationAppError("Offer price must be greater than zero")
    if price >= list_price:
        raise ValidationAppError(
            f"The offer price must be below the regular admission fee "
            f"(₹{list_price / 100:,.0f})"
        )
    offer = AdmissionOffer(
        token=secrets.token_urlsafe(9),
        plan=cfg.plan, price=price, list_price=list_price,
        valid_hours=valid_hours,
        expires_at=utcnow() + timedelta(hours=valid_hours),
        student_name=student_name, phone=phone, email=email, note=note,
        created_by=created_by,
    )
    await offer.insert()
    return offer


async def resolve_admission_offer(token: str) -> AdmissionOffer:
    """The live offer behind a link. Expired, revoked and unknown tokens are all
    a 404 — the caller sends the visitor to the regular plans page either way,
    and nothing about a lapsed offer is worth disclosing."""
    offer = await AdmissionOffer.find_one(AdmissionOffer.token == token)
    if not offer or not offer_live(offer):
        raise NotFoundError("This offer link is no longer available")
    return offer


async def offer_admission_price(token: str, plan: str) -> int:
    """The admission fee a live offer link buys `plan` at.

    Raises rather than quietly falling back to the catalogue price: the buyer
    came in on an offer, so charging them more without saying so is the one
    outcome that must not happen silently."""
    offer = await AdmissionOffer.find_one(AdmissionOffer.token == token)
    if not offer or offer.plan != plan:
        raise ValidationAppError("This offer does not apply to the selected membership")
    if not offer_live(offer):
        raise ValidationAppError(
            "This offer has expired. Please choose your membership again at the regular price."
        )
    return offer.price


async def record_offer_use(token: str, order_number: str) -> None:
    """Count a paid purchase against the link so admin can see it converted."""
    offer = await AdmissionOffer.find_one(AdmissionOffer.token == token)
    if not offer or order_number in offer.order_numbers:
        return
    offer.uses += 1
    offer.used_at = utcnow()
    offer.order_numbers.append(order_number)
    offer.touch()
    await offer.save()
