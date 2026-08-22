"""Attendance confirmation workflow (shared by teacher-led Batch classes and
community SpeakingTeam classes).

    24h before class  →  attendance notification + ClassConfirmation(pending)
    18h after that    →  still pending?  →  that student's seat is cancelled
                                           and they are notified once

Both scheduler jobs are idempotent:

* Notifications dedup on ``Batch.confirm_notified_dates`` (teacher-led) and on
  the existence of a ClassConfirmation row for (source, class_ref, class_date,
  student_id) — the unique tuple. A date can therefore fire only once.
* Cancellation dedups on ``status != "pending"`` plus the ``cancel_notified``
  flag, so a re-run never cancels twice or re-notifies.

Cancellation scope is *the individual student's seat*: the class still runs for
everyone who confirmed. The teacher and admins are informed, never surprised.
"""
import logging
from datetime import datetime, timedelta, timezone

from app.core.config import settings
from app.db.base import utcnow
from app.db.models import Batch, ClassConfirmation, SpeakingTeam, Teacher
from app.modules.notification import service as notif
from app.shared.audit import log_activity

log = logging.getLogger("speakedge.attendance")

IST = timezone(timedelta(hours=5, minutes=30))
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

# How wide a window each scheduler pass considers. The job runs every 15 min;
# a 2h window means a transient outage cannot silently skip a class.
NOTICE_WINDOW = timedelta(hours=2)


def notice_delta() -> timedelta:
    return timedelta(hours=settings.ATTENDANCE_NOTICE_HOURS)


def deadline_delta() -> timedelta:
    return timedelta(hours=settings.ATTENDANCE_DEADLINE_HOURS)


def _class_datetime(date_str: str, time_str: str | None) -> datetime | None:
    """IST-aware datetime for a class occurrence. ``time_str`` may be HH:MM or
    a display range like "7:00 PM – 8:00 PM"; only HH:MM is parsed."""
    try:
        y, mo, d = (int(x) for x in date_str.split("-"))
    except (ValueError, AttributeError):
        return None
    hh, mm = 0, 0
    if time_str:
        try:
            hh, mm = (int(x) for x in time_str.split(":")[:2])
        except (ValueError, TypeError):
            hh, mm = 0, 0
    if not (0 <= hh < 24 and 0 <= mm < 60):
        hh, mm = 0, 0
    return datetime(y, mo, d, hh, mm, tzinfo=IST)


def _batch_dates(b: Batch) -> list[str]:
    if b.class_dates:
        return list(b.class_dates)
    return [b.date] if b.date else []


def _next_community_date(team: SpeakingTeam, ref: datetime) -> str | None:
    """Next weekly occurrence of a community class, as YYYY-MM-DD (IST)."""
    if not team.class_day or not team.class_time:
        return None
    day = team.class_day.strip().lower()
    if day not in WEEKDAYS:
        return None
    try:
        hh, mm = (int(x) for x in team.class_time.split(":"))
    except (ValueError, TypeError):
        return None
    days_ahead = (WEEKDAYS.index(day) - ref.weekday()) % 7
    cand = (ref + timedelta(days=days_ahead)).replace(
        hour=hh, minute=mm, second=0, microsecond=0)
    if cand < ref:
        cand += timedelta(days=7)
    return cand.date().isoformat()


async def _existing(source: str, class_ref: str, class_date: str,
                    student_id: str) -> ClassConfirmation | None:
    return await ClassConfirmation.find_one(
        ClassConfirmation.source == source,
        ClassConfirmation.class_ref == class_ref,
        ClassConfirmation.class_date == class_date,
        ClassConfirmation.student_id == student_id,
        ClassConfirmation.is_archived == False,  # noqa: E712
    )


async def request_confirmations(source: str, class_ref: str, class_title: str,
                                class_date: str, class_time: str | None,
                                student_ids: list[str]) -> list[ClassConfirmation]:
    """Create pending confirmations + notify. Students who already have a row
    for this occurrence are skipped, so calling twice is harmless."""
    created: list[ClassConfirmation] = []
    now = utcnow()
    deadline = now + deadline_delta()
    for sid in student_ids:
        if not sid or await _existing(source, class_ref, class_date, sid):
            continue
        rec = ClassConfirmation(
            source=source, class_ref=class_ref, class_title=class_title,
            class_date=class_date, class_time=class_time, student_id=sid,
            notified_at=now, deadline_at=deadline,
        )
        await rec.insert()
        created.append(rec)

    if created:
        when = f"{class_date}{f' at {class_time}' if class_time else ''}"
        hours = settings.ATTENDANCE_DEADLINE_HOURS
        await notif.notify_all(
            [r.student_id for r in created],
            "Confirm your attendance",
            f'Your class "{class_title}" is scheduled for {when}. '
            f"Please confirm your attendance within {hours} hours — "
            "if we don't hear from you, your seat will be released automatically.",
            "warning",
            push_url="/dashboard/attendance",
        )
    return created


async def respond(rec: ClassConfirmation, attending: bool) -> ClassConfirmation:
    """Record a student's answer. Callers must handle the already-answered and
    past-deadline cases — see the router for the typed errors."""
    rec.status = "confirmed" if attending else "declined"
    rec.responded_at = utcnow()
    rec.touch()
    await rec.save()
    return rec


async def _safe_get(model, doc_id: str | None):
    """Beanie raises on a malformed id instead of returning None. A stored
    class_ref/teacher_id can outlive its document (or be a legacy value), and a
    dangling reference must never break the cancellation sweep."""
    if not doc_id:
        return None
    try:
        return await model.get(doc_id)
    except Exception:
        return None


async def _teacher_username(batch: Batch) -> str | None:
    t = await _safe_get(Teacher, batch.teacher_id)
    return t.username if t else None


async def cancel_seat(rec: ClassConfirmation, reason: str = "no attendance response") -> bool:
    """Expire one pending confirmation: release the seat, notify once, audit.

    Returns True only when this call performed the cancellation, so a repeated
    run is a no-op and can never send a duplicate notification."""
    if rec.status != "pending" or rec.cancel_notified:
        return False
    rec.status = "expired"
    rec.responded_at = utcnow()
    rec.cancel_notified = True
    rec.touch()
    await rec.save()

    when = f"{rec.class_date}{f' at {rec.class_time}' if rec.class_time else ''}"
    recipients: list[str | None] = [rec.student_id, "admins"]
    if rec.source == "batch":
        batch = await _safe_get(Batch, rec.class_ref)
        if batch:
            recipients.append(await _teacher_username(batch))
    await notif.notify_all(
        recipients,
        "Class cancelled — attendance not confirmed",
        f'Your seat in "{rec.class_title}" on {when} has been cancelled because '
        f"attendance was not confirmed within {settings.ATTENDANCE_DEADLINE_HOURS} hours "
        "of the reminder. Please contact support if you still want to attend.",
        "warning",
        push_url="/dashboard/attendance",
    )
    await log_activity(
        "system", "attendance.auto_cancel", role="system",
        target_type="class_confirmation", target_id=str(rec.id),
        meta={"source": rec.source, "class_ref": rec.class_ref,
              "class_date": rec.class_date, "student_id": rec.student_id,
              "reason": reason},
    )
    return True


# ---------------------------------------------------------------------------
# Scheduler entry points
# ---------------------------------------------------------------------------
async def send_attendance_confirmation_requests() -> None:
    """24h before each upcoming class, ask every enrolled student to confirm."""
    now_ist = datetime.now(IST)
    target_from = now_ist + notice_delta()
    target_to = target_from + NOTICE_WINDOW
    total = 0

    # --- Teacher-led batches -------------------------------------------------
    batches = await Batch.find(Batch.is_archived == False).to_list()  # noqa: E712
    for b in batches:
        if not b.student_ids:
            continue
        already = set(b.confirm_notified_dates or [])
        fired: list[str] = []
        for date_str in _batch_dates(b):
            if date_str in already:
                continue
            start = _class_datetime(date_str, b.slot_start)
            if start is None or not (target_from <= start < target_to):
                continue
            created = await request_confirmations(
                "batch", str(b.id), b.title, date_str,
                b.class_time or b.slot_start, b.student_ids)
            fired.append(date_str)
            total += len(created)
        if fired:
            # Dedup guard is written even when zero rows were created (every
            # student already had one) so the date never re-fires.
            b.confirm_notified_dates = sorted(already | set(fired))
            b.touch()
            await b.save()

    # --- Community classes ---------------------------------------------------
    teams = await SpeakingTeam.find(
        SpeakingTeam.is_archived == False,  # noqa: E712
    ).to_list()
    for team in teams:
        if team.is_suspended or not team.member_ids:
            continue
        date_str = _next_community_date(team, now_ist)
        if not date_str:
            continue
        start = _class_datetime(date_str, team.class_time)
        if start is None or not (target_from <= start < target_to):
            continue
        # Dedup here is the ClassConfirmation row itself — community classes
        # have no per-date field on the team document.
        created = await request_confirmations(
            "community", str(team.id), team.name, date_str,
            team.class_time, team.member_ids)
        total += len(created)

    if total:
        log.info("Sent %s attendance confirmation requests", total)


async def expire_unconfirmed_attendance() -> None:
    """Release seats whose 18h confirmation deadline has passed."""
    now = datetime.now(timezone.utc)
    due = await ClassConfirmation.find(
        ClassConfirmation.status == "pending",
        ClassConfirmation.deadline_at <= now,
        ClassConfirmation.is_archived == False,  # noqa: E712
    ).to_list()
    cancelled = 0
    for rec in due:
        # A class that has already happened is left alone — cancelling a past
        # seat would be noise, and the post-class flow owns that record.
        start = _class_datetime(rec.class_date, rec.class_time)
        if start is not None and start.astimezone(timezone.utc) <= now:
            rec.status = "expired"
            rec.touch()
            await rec.save()
            continue
        if await cancel_seat(rec):
            cancelled += 1
    if cancelled:
        log.info("Auto-cancelled %s unconfirmed class seats", cancelled)
