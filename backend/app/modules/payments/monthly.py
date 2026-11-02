"""Monthly fee due dates.

There is no recurring-billing engine: `PlanConfig.monthly_fee` is quoted on the
plan card and collected separately. This module derives *when* each monthly fee
falls due so the student can be reminded and pay on time.

Rule: the admission/membership fee is charged upfront at checkout, so the first
monthly fee falls due one calendar month after the student's *first teacher-led
class*, and every month after that until the subscription expires. A month
counts as settled once a paid ``Payment(kind="monthly", due_month="YYYY-MM")``
exists.

Buyers may also pay that first monthly fee at checkout, alongside the admission
fee. ``Subscription.first_month_included`` records that, and the derived
schedule then starts at month 2 — there is no monthly Payment row to match
against, because the money came in on the admission order.

The anchor is ``Subscription.billing_start_at`` — the class start date, set by
an admin (auto-suggested from the first batch the student is enrolled in).
Until it is set the schedule falls back to ``started_at``, so a subscription
that predates this field keeps its old dates.

**A fee is only owed for a month the student actually attended.** Holding a
membership, or a seat on a batch, is not enough: month *n* covers the cycle
that ends on its due date, and it is owed only when an approved, held
``Attendance`` marks the student present inside that cycle (``owed_due_dates``).
With no attendance at all nothing is due, and without an admin class start date
the cycle counts from the first class attended. It is derived live, so existing
members are re-read under this rule — no data to migrate.
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


def _cycles(sub: Subscription, anchor: datetime) -> list[tuple[datetime, datetime]]:
    """(cycle start, due date) for every monthly cycle, oldest first.

    A buyer who paid their first monthly fee together with the admission fee has
    month 1 settled already, so the schedule starts at month 2 for them."""
    expires = _aware(sub.expires_at)
    first = 2 if getattr(sub, "first_month_included", False) else 1
    out: list[tuple[datetime, datetime]] = []
    for n in range(first, _MAX_DUES + 1):
        due = _add_months(anchor, n)
        if due > expires:
            break
        out.append((_add_months(anchor, n - 1), due))
    return out


def due_dates(sub: Subscription) -> list[datetime]:
    """The monthly cycle's calendar — every due date, attended or not. What is
    actually owed is ``owed_due_dates``; this is only the cycle boundaries."""
    return [due for _, due in _cycles(sub, billing_anchor(sub))]


def owed_due_dates(sub: Subscription, attended: list[datetime]) -> list[datetime]:
    """The due dates the student owes: one per cycle in which they attended a
    class. Counted from the admin's class start date, else from the first class
    attended; no attendance means nothing is owed."""
    if not attended:
        return []
    anchor = _aware(sub.billing_start_at) if getattr(sub, "billing_start_at", None) else attended[0]
    # Attendance is a date, so cycles are too — a class on the start day counts.
    anchor = anchor.replace(hour=0, minute=0, second=0, microsecond=0)
    return [due for start, due in _cycles(sub, anchor)
            if any(start <= a < due for a in attended)]


async def attended_dates(student_id: str) -> list[datetime]:
    """Dates the student was marked present in a teacher-led class that was
    held and approved by admin, oldest first."""
    from app.db.models import Attendance

    rows = await Attendance.find(
        {"present_ids": student_id, "status": "approved", "is_archived": False}).to_list()
    out: set[datetime] = set()
    for a in rows:
        if not a.class_held:
            continue
        try:
            out.add(datetime.strptime(a.date, "%Y-%m-%d").replace(tzinfo=timezone.utc))
        except ValueError:
            continue
    return sorted(out)


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

    attended = await attended_dates(student_id)
    dues = owed_due_dates(sub, attended)
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
            # What the schedule is counted from, and whether it is the admin's
            # class start date or the first class attended.
            "billing_start_at": (_aware(sub.billing_start_at) if sub.billing_start_at
                                 else attended[0]).isoformat(),
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


async def class_block(student_id: str) -> dict | None:
    """The overdue monthly fee that keeps this student out of a new teacher-led
    class, or None when they may join.

    A fee is only *overdue* once its due date has passed — one that is merely
    coming up does not block. A member who never attended a class owes nothing,
    so their first request always goes through."""
    due = await next_due(student_id)
    return due if due and due["overdue"] else None


def due_message(due: dict) -> str:
    """How an unpaid monthly fee reads to the student who owes it."""
    when = datetime.fromisoformat(due["due_date"]).strftime("%d %b %Y")
    return (f"Your monthly fee of ₹{due['amount'] / 100:,.0f} was due on {when}. "
            "Please pay it before joining a class.")
