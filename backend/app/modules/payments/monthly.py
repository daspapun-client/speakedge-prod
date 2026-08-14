"""Monthly fee due dates.

There is no recurring-billing engine: `PlanConfig.monthly_fee` is quoted on the
plan card and collected separately. This module derives *when* each monthly fee
falls due so the student can be reminded and pay on time.

Rule: the admission/membership fee is charged upfront at checkout, so the first
monthly fee falls due one calendar month after the student's *first teacher-led
class*, and every month after that until the subscription expires. A month
counts as settled once a paid ``Payment(kind="monthly", due_month="YYYY-MM")``
exists.

The anchor is ``Subscription.billing_start_at`` — the class start date, set by
an admin (auto-suggested from the first batch the student is enrolled in).
Until it is set the schedule falls back to ``started_at``, so a subscription
that predates this field keeps its old dates.
"""
from datetime import datetime, timedelta, timezone

from app.db.models import PaymentStatus, PlanConfig, Payment, Subscription

# Show the payment reminder this many days before the due date (spec).
REMINDER_DAYS = 3

PAID_STATUSES = [PaymentStatus.paid.value, PaymentStatus.manually_approved.value]

# Cap the derived schedule — a subscription is at most a year, this is a guard
# against a bad expires_at producing an unbounded loop.
_MAX_DUES = 36


def _add_months(start: datetime, n: int) -> datetime:
    """start + n calendar months, clamping the day to the target month's length."""
    month_index = start.month - 1 + n
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    # Step back from the 1st of the following month to find the last valid day.
    next_month = datetime(year + (month == 12), (month % 12) + 1, 1, tzinfo=timezone.utc)
    last_day = (next_month - timedelta(days=1)).day
    return start.replace(year=year, month=month, day=min(start.day, last_day))


def _aware(dt: datetime) -> datetime:
    """Mongo hands back naive datetimes; treat them as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


#: Public alias of `_aware` for callers outside this module.
as_utc = _aware


def billing_anchor(sub: Subscription) -> datetime:
    """The date the monthly cycle counts from: the first teacher-led class if an
    admin has set one, otherwise the subscription start. ``getattr`` keeps
    subscriptions stored before this field existed working."""
    return _aware(getattr(sub, "billing_start_at", None) or sub.started_at)


def due_dates(sub: Subscription) -> list[datetime]:
    """Every monthly-fee due date for this subscription, oldest first."""
    started, expires = billing_anchor(sub), _aware(sub.expires_at)
    out: list[datetime] = []
    for n in range(1, _MAX_DUES + 1):
        due = _add_months(started, n)
        if due > expires:
            break
        out.append(due)
    return out


def month_key(dt: datetime) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


def parse_class_start(value: str | None) -> datetime | None:
    """Parse the admin's "YYYY-MM-DD" class start date into a UTC datetime."""
    from app.core.exceptions import ValidationAppError

    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise ValidationAppError("Class start date must be in YYYY-MM-DD format")


async def suggest_class_start(student_id: str) -> datetime | None:
    """The student's earliest scheduled teacher-led class date, as a suggestion
    for the billing anchor. Looks at every batch they are enrolled in and takes
    the earliest of its class dates (``class_dates``, or the legacy ``date``)."""
    from app.db.models import Batch

    batches = await Batch.find({"student_ids": student_id, "is_archived": False}).to_list()
    dates = sorted(
        d for b in batches for d in (b.class_dates or ([b.date] if b.date else [])) if d
    )
    if not dates:
        return None
    try:
        return datetime.strptime(dates[0], "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


async def next_due(student_id: str) -> dict | None:
    """The student's next unsettled monthly fee, or None if nothing is owed.

    Overdue months are returned too (with a negative ``days_until``) so the
    reminder keeps showing until the payment actually lands.
    """
    sub = await Subscription.find_one(
        Subscription.student_id == student_id,
        Subscription.is_active == True,  # noqa: E712
    )
    if not sub:
        return None
    cfg = await PlanConfig.find_one(PlanConfig.plan == sub.plan)
    if not cfg or cfg.monthly_fee <= 0:
        return None

    dues = due_dates(sub)
    if not dues:
        return None

    paid = {
        p.due_month
        for p in await Payment.find({
            "student_id": student_id,
            "kind": "monthly",
            "status": {"$in": PAID_STATUSES},
        }).to_list()
        if p.due_month
    }

    now = datetime.now(timezone.utc)
    for due in dues:
        key = month_key(due)
        if key in paid:
            continue
        days_until = (due.date() - now.date()).days
        return {
            "subscription_id": str(sub.id),
            "plan": sub.plan,
            "plan_label": cfg.label,
            # What the schedule is counted from, and whether it is the real
            # class start date or the fallback.
            "billing_start_at": billing_anchor(sub).isoformat(),
            "class_start_set": sub.billing_start_at is not None,
            "due_month": key,
            "due_date": due.isoformat(),
            "amount": cfg.monthly_fee,          # paise
            "days_until": days_until,
            "overdue": days_until < 0,
            # The pop-up/notification window: from 3 days out until it is paid.
            "reminder_active": days_until <= REMINDER_DAYS,
        }
    return None
