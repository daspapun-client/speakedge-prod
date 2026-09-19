"""New-Student Orientation module.

The orientation is a one-time onboarding session a logged-in student completes
before diving into the learning journey. Admins schedule orientation batches
(live or recorded) and assign a teacher; the teacher/admin marks students
complete (or students self-complete a recorded session). Completion flips
``Student.orientation_status`` to ``completed`` and unlocks the dashboard prompt.

Sessions are scheduled **weekly** — admin sets a weekday and a start time
("Sunday \u2013 11:00 AM") and it repeats every week until changed or removed. The
recurrence machinery is ``app/shared/weekly.py``; this module only says what an
orientation occurrence is built from and what makes one untouchable: a student
having joined it, or the session already being over.

There is no reading walkthrough: the student books a session and attends it."""
from datetime import datetime

from app.db.base import utcnow
from app.db.models import OrientationBatch, OrientationSlotRule, Student, Teacher
from app.modules.notification import service as notif
from app.shared import weekly
from app.shared.weekly import (  # re-exported: the module's one schedule vocabulary
    IST,
    WEEKDAYS,
    label,
    occurrences,
    parse_day,
    parse_time,
    to_ist,
    to_naive_utc,
    to_utc,
)

SLOT_HORIZON_WEEKS = weekly.DEFAULT_HORIZON_WEEKS


def _iso(dt: datetime | None) -> str | None:
    """A session time on the wire is an explicit UTC instant — a naive string
    would be read as browser-local and land 5.5 hours out."""
    dt = to_utc(dt)
    return dt.isoformat() if dt else None


async def get_student_view(student: Student) -> dict:
    """Everything the student orientation page needs: status, the session they
    booked (if any) and the sessions still open to book."""
    batch_info = None
    if student.orientation_batch_id:
        batch = await OrientationBatch.get(student.orientation_batch_id)
        if batch and not batch.is_archived and batch.status != "cancelled":
            teacher_name = None
            if batch.teacher_id:
                t = await Teacher.get(batch.teacher_id)
                teacher_name = t.name if t else None
            batch_info = {
                "id": str(batch.id),
                "title": batch.title,
                "mode": batch.mode,
                "scheduled_at": _iso(batch.scheduled_at),
                "duration_min": batch.duration_min,
                "meeting_url": batch.meeting_url,
                "recording_url": batch.recording_url,
                "agenda": batch.agenda,
                "teacher_name": teacher_name,
                "status": batch.status,
            }
    # Only a recorded (self-paced) session is finished by the student: there is
    # nothing else for them to complete on their own, and a live session is
    # marked complete by the teacher who ran it.
    self_complete = batch_info is not None and batch_info["mode"] == "recorded"
    return {
        "status": student.orientation_status,
        "completed_at": (
            student.orientation_completed_at.isoformat()
            if student.orientation_completed_at else None
        ),
        "batch": batch_info,
        "can_self_complete": self_complete,
        # Classes the student may self-join (only when they haven't joined one yet).
        "open_batches": await open_batches_for(student),
    }


def has_started(batch: OrientationBatch) -> bool:
    """A dated session that has already begun. Undated (recorded/self-paced)
    sessions never expire — there is no start time to pass."""
    when = to_naive_utc(batch.scheduled_at)
    return bool(when and when < weekly.now_naive_utc())


async def open_batches_for(student: Student) -> list[dict]:
    """Scheduled orientation classes a student may self-join. Empty once they've
    already joined a class or completed orientation — they may only join one.

    Sessions that have already started are dropped: weekly slots keep producing
    dated sessions and a past one lingers until the purge grace period is up."""
    if student.orientation_batch_id or student.orientation_status == "completed":
        return []
    batches = await OrientationBatch.find(
        OrientationBatch.status == "scheduled",
        OrientationBatch.is_archived == False,  # noqa: E712
    ).sort(OrientationBatch.scheduled_at).to_list()
    out = []
    for b in batches:
        if has_started(b):
            continue
        teacher_name = None
        if b.teacher_id:
            t = await Teacher.get(b.teacher_id)
            teacher_name = t.name if t else None
        out.append({
            "id": str(b.id),
            "title": b.title,
            "mode": b.mode,
            "scheduled_at": _iso(b.scheduled_at),
            "duration_min": b.duration_min,
            "teacher_name": teacher_name,
            "agenda": b.agenda,
        })
    return out


async def maybe_close_batch(batch_id: str | None) -> None:
    """Mark a scheduled session completed once every enrolled student is done."""
    if not batch_id:
        return
    batch = await OrientationBatch.get(batch_id)
    if not batch or batch.is_archived or batch.status != "scheduled" or not batch.student_ids:
        return
    roster = await roster_for(batch)
    if all(r["orientation_status"] == "completed" for r in roster):
        batch.status = "completed"
        batch.touch()
        await batch.save()


async def mark_completed(student: Student, by: str) -> bool:
    """Flip a student to completed (idempotent). Returns True if this call
    changed the state, so callers can avoid duplicate notifications."""
    if student.orientation_status == "completed":
        return False
    student.orientation_status = "completed"
    student.orientation_completed_at = utcnow()
    student.orientation_completed_by = by
    student.touch()
    await student.save()
    await notif.notify(
        student.student_id,
        "Orientation complete 🎉",
        "You've completed your SpeakEdge orientation — your learning journey starts now!",
        "success",
        push_url="/dashboard",
    )
    await maybe_close_batch(student.orientation_batch_id)
    return True


async def roster_for(batch: OrientationBatch) -> list[dict]:
    """Enrolled students with their orientation status for admin/teacher views."""
    from app.shared.students import load_students_map

    students = await load_students_map(batch.student_ids)
    rows = []
    for sid in batch.student_ids:
        s = students.get(sid)
        rows.append({
            "student_id": sid,
            "full_name": s.full_name if s else None,
            "photo_url": s.photo_url if s else None,
            "gender": s.gender if s else None,
            "orientation_status": s.orientation_status if s else "pending",
            "in_this_batch": bool(s and s.orientation_batch_id == str(batch.id)),
        })
    return rows



# ---------------------------------------------------------------------------
# Weekly sessions — a weekday + a time, repeating
# ---------------------------------------------------------------------------
async def joined_batch_ids(batches) -> set[str]:
    """Sessions that must never be moved or withdrawn under their students:
    anyone has joined, or the session is no longer merely scheduled."""
    return {str(b.id) for b in batches
            if b.student_ids or b.status != "scheduled"}


def _build(rule: OrientationSlotRule, when: datetime) -> OrientationBatch:
    return OrientationBatch(
        title=rule.title, mode="live", scheduled_at=when,
        duration_min=rule.duration_min, teacher_id=rule.teacher_id,
        meeting_url=rule.meeting_url, agenda=list(rule.agenda),
        rule_id=str(rule.id),
    )


schedule = weekly.WeeklySchedule(
    OrientationBatch, build=_build, in_use=joined_batch_ids,
    purge_reason="Weekly orientation slot expired with nobody enrolled",
)

generate = schedule.generate
rebuild = schedule.rebuild
drop_future = schedule.drop_future
purge_past = schedule.purge_past


async def sync_all() -> dict:
    """Scheduler pass over every live weekly orientation slot."""
    rules = await OrientationSlotRule.find(
        OrientationSlotRule.is_archived == False).to_list()  # noqa: E712
    return await schedule.sync(rules)
