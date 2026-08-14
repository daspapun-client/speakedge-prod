"""APScheduler jobs: 60-day archive purge, scheduled-notification dispatch,
upcoming-class reminders, attendance confirmation + auto-cancellation.
Runs in-process on the backend."""
import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.db.base import AuditedDocument
from app.db.models import (
    ALL_DOCUMENTS, Attendance, Batch, Notification, OrientationBatch, Remuneration,
    Subscription, Teacher,
)
from app.modules.notification import service as notif
from app.modules.payments import monthly
from app.shared.attendance import (
    expire_unconfirmed_attendance,
    send_attendance_confirmation_requests,
)

log = logging.getLogger("speakedge.scheduler")
scheduler = AsyncIOScheduler(timezone="UTC")

IST = timezone(timedelta(hours=5, minutes=30))  # product is India-only; matches teacher router
REMINDER_WINDOW_MIN = 30  # remind students/teacher/admins up to 30 min before a class
ATTENDANCE_FOLLOWUP_WINDOW_MIN = 120  # nudge up to 2h after slot_end if still no attendance


def _batch_scheduled_today(b: Batch, today: str, weekday: str) -> bool:
    if b.class_dates:
        return today in b.class_dates
    if b.date:
        return b.date == today
    if b.day_of_week:
        return b.day_of_week.strip().lower() == weekday
    return False


def _slot_end_minutes(b: Batch) -> int | None:
    end = b.slot_end
    if not end and b.class_time and "–" in b.class_time:
        end = b.class_time.split("–")[-1].strip()
    if not end:
        return None
    try:
        eh, em = (int(x) for x in end.split(":"))
    except (ValueError, TypeError):
        return None
    return eh * 60 + em


async def purge_expired_archives() -> None:
    """Permanently delete records whose auto_delete_at has passed (Super Admin policy)."""
    now = datetime.now(timezone.utc)
    total = 0
    for model in ALL_DOCUMENTS:
        if issubclass(model, AuditedDocument):
            res = await model.find(
                model.is_archived == True,  # noqa: E712
                model.auto_delete_at < now,
            ).delete()
            total += getattr(res, "deleted_count", 0) or 0
    if total:
        log.info("Archive purge removed %s records", total)


async def dispatch_scheduled_notifications() -> None:
    now = datetime.now(timezone.utc)
    pending = await Notification.find(
        Notification.sent == False,  # noqa: E712
        Notification.scheduled_for <= now,
    ).to_list()
    for n in pending:
        n.sent = True
        await n.save()


async def send_class_reminders() -> None:
    """Notify students, the teacher and the admins group shortly before each
    class starts. Deduped per day via Batch.reminded_on so a class fires once."""
    now = datetime.now(IST)
    today = now.strftime("%Y-%m-%d")
    weekday = now.strftime("%A").lower()
    now_min = now.hour * 60 + now.minute
    batches = await Batch.find(Batch.is_archived == False).to_list()  # noqa: E712
    for b in batches:
        if not b.slot_start or b.reminded_on == today:
            continue
        if b.class_dates:
            if today not in b.class_dates:
                continue
        elif b.date:
            if b.date != today:
                continue
        elif b.day_of_week:
            if b.day_of_week.strip().lower() != weekday:
                continue
        else:
            continue
        try:
            sh, sm = (int(x) for x in b.slot_start.split(":"))
        except (ValueError, TypeError):
            continue
        delta = (sh * 60 + sm) - now_min
        if not 0 <= delta <= REMINDER_WINDOW_MIN:
            continue
        recipients: list[str | None] = ["admins", *b.student_ids]
        if b.teacher_id:
            t = await Teacher.get(b.teacher_id)
            if t and t.username:
                recipients.append(t.username)
        when = b.class_time or b.slot_start
        await notif.notify_all(
            recipients, "Class Reminder",
            f"Your class \"{b.title}\" starts at {when}.", "info")
        b.reminded_on = today
        await b.save()


async def send_attendance_reminders() -> None:
    """After a class slot ends, nudge the teacher and admins to submit attendance
    or mark the class as not held. Deduped per day via Batch.attendance_reminded_on."""
    now = datetime.now(IST)
    today = now.strftime("%Y-%m-%d")
    weekday = now.strftime("%A").lower()
    now_min = now.hour * 60 + now.minute
    batches = await Batch.find(Batch.is_archived == False).to_list()  # noqa: E712
    for b in batches:
        if b.attendance_reminded_on == today:
            continue
        if not _batch_scheduled_today(b, today, weekday):
            continue
        end_min = _slot_end_minutes(b)
        if end_min is None or now_min <= end_min:
            continue
        if now_min - end_min > ATTENDANCE_FOLLOWUP_WINDOW_MIN:
            continue
        if await Attendance.find_one(
            {"batch_id": str(b.id), "date": today, "status": {"$in": ["pending", "approved"]}}
        ):
            continue
        recipients: list[str | None] = ["admins"]
        teacher_username = None
        if b.teacher_id:
            t = await Teacher.get(b.teacher_id)
            if t and t.username:
                teacher_username = t.username
                recipients.append(t.username)
        when = b.class_time or (f"{b.slot_start}–{b.slot_end}" if b.slot_start and b.slot_end else today)
        await notif.notify_all(
            recipients,
            "Submit class attendance",
            f'The slot for "{b.title}" ({when}) has ended. Submit attendance or mark the class as not held if it did not take place.',
            "warning",
            push_url=f"/teacher/batches#batch-{b.id}" if teacher_username else f"/admin/batches/{b.id}",
        )
        b.attendance_reminded_on = today
        await b.save()


async def credit_completed_batches() -> None:
    """Once each class date has passed, credit teacher_cost_paise per class.
    Deduped via Batch.cost_credited_dates."""
    today = datetime.now(IST).strftime("%Y-%m-%d")
    batches = await Batch.find(
        Batch.is_archived == False,  # noqa: E712
        Batch.teacher_cost_paise > 0,
    ).to_list()
    for b in batches:
        if not b.teacher_id:
            continue
        dates = b.class_dates or ([b.date] if b.date else [])
        credited = set(b.cost_credited_dates or [])
        new_dates: list[str] = []
        for d in dates:
            if d >= today or d in credited:
                continue
            await Remuneration(
                teacher_id=b.teacher_id, period=d, amount=b.teacher_cost_paise,
            ).insert()
            credited.add(d)
            new_dates.append(d)
        if new_dates:
            b.cost_credited_dates = sorted(credited)
            await b.save()
            t = await Teacher.get(b.teacher_id)
            for d in new_dates:
                await notif.notify_all(
                    [t.username if t else None, "admins"], "Class Payment Credited",
                    f"₹{b.teacher_cost_paise / 100:g} credited for \"{b.title}\" ({d}).",
                    "success")


async def send_orientation_reminders() -> None:
    """Remind enrolled students and the assigned teacher shortly before a live
    orientation session starts. Deduped per day via OrientationBatch.reminded_on."""
    now = datetime.now(IST)
    today = now.strftime("%Y-%m-%d")
    batches = await OrientationBatch.find(
        OrientationBatch.is_archived == False,  # noqa: E712
        OrientationBatch.status == "scheduled",
    ).to_list()
    for b in batches:
        if not b.scheduled_at or b.reminded_on == today or not b.student_ids:
            continue
        start = b.scheduled_at if b.scheduled_at.tzinfo else b.scheduled_at.replace(tzinfo=timezone.utc)
        delta_min = (start.astimezone(IST) - now).total_seconds() / 60
        if not 0 <= delta_min <= REMINDER_WINDOW_MIN:
            continue
        when = start.astimezone(IST).strftime("%d %b, %I:%M %p")
        recipients: list[str | None] = list(b.student_ids)
        if b.teacher_id:
            t = await Teacher.get(b.teacher_id)
            if t and t.username:
                recipients.append(t.username)
        await notif.notify_all(
            recipients, "Orientation starting soon",
            f'Your orientation "{b.title}" begins at {when}.', "info",
            push_url="/dashboard/orientation")
        b.reminded_on = today
        await b.save()


async def send_subscription_expiry_reminders() -> None:
    """Nudge students 30 days before their Speaking Community access expires.
    Deduped via Subscription.expiry_reminded so each subscription fires once."""
    now = datetime.now(timezone.utc)
    window = now + timedelta(days=30)
    due = await Subscription.find(
        Subscription.is_active == True,  # noqa: E712
        Subscription.expiry_reminded == False,  # noqa: E712
        Subscription.expires_at <= window,
        Subscription.expires_at > now,
    ).to_list()
    for sub in due:
        await notif.notify(
            sub.student_id, "Speaking Community access expiring soon",
            f"Your Speaking Community access on the {sub.plan} plan expires on "
            f"{sub.expires_at:%d %b %Y}. Renew or upgrade your membership if you want to "
            "keep your classes, speaking partners and community access.",
            kind="subscription", push_url="/dashboard/subscription",
        )
        sub.expiry_reminded = True
        await sub.save()
    if due:
        log.info("Sent %s subscription expiry reminders", len(due))


async def send_monthly_payment_reminders() -> None:
    """Notify 3 days before each monthly fee falls due (and once it is overdue).

    The due schedule is derived from the subscription start day — see
    payments/monthly.py. Deduped per due month via
    Subscription.monthly_reminders_sent so one notification is raised per month;
    the dashboard pop-up is what keeps nagging until the payment lands.
    """
    subs = await Subscription.find(Subscription.is_active == True).to_list()  # noqa: E712
    sent = 0
    for sub in subs:
        due = await monthly.next_due(sub.student_id)
        if not due or not due["reminder_active"]:
            continue
        if due["due_month"] in sub.monthly_reminders_sent:
            continue
        amount = due["amount"] / 100
        when = datetime.fromisoformat(due["due_date"])
        await notif.notify(
            sub.student_id,
            "Monthly payment due" if not due["overdue"] else "Monthly payment overdue",
            f"Your {due['plan_label']} monthly fee of ₹{amount:,.0f} is due on "
            f"{when:%d %b %Y}. Pay now to keep your classes running without interruption.",
            kind="payment", push_url="/dashboard/payments",
        )
        sub.monthly_reminders_sent.append(due["due_month"])
        await sub.save()
        sent += 1
    if sent:
        log.info("Sent %s monthly payment reminders", sent)


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(purge_expired_archives, "interval", hours=6, id="purge", replace_existing=True)
    scheduler.add_job(dispatch_scheduled_notifications, "interval", minutes=1, id="notif", replace_existing=True)
    scheduler.add_job(send_class_reminders, "interval", minutes=5, id="class_reminders", replace_existing=True)
    scheduler.add_job(send_attendance_reminders, "interval", minutes=5, id="attendance_reminders", replace_existing=True)
    scheduler.add_job(credit_completed_batches, "interval", hours=1, id="batch_credit", replace_existing=True)
    scheduler.add_job(send_orientation_reminders, "interval", minutes=5, id="orientation_reminders", replace_existing=True)
    scheduler.add_job(send_subscription_expiry_reminders, "interval", hours=12, id="sub_expiry_reminders", replace_existing=True)
    scheduler.add_job(send_monthly_payment_reminders, "interval", hours=12,
                      id="monthly_payment_reminders", replace_existing=True)
    # Attendance workflow: ask 24h ahead, auto-cancel 18h after asking. Both
    # passes are idempotent, so a 15-min cadence cannot double-fire.
    scheduler.add_job(send_attendance_confirmation_requests, "interval", minutes=15,
                      id="attendance_confirm_requests", replace_existing=True)
    scheduler.add_job(expire_unconfirmed_attendance, "interval", minutes=15,
                      id="attendance_expiry", replace_existing=True)
    scheduler.start()
    log.info("Scheduler started")


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
