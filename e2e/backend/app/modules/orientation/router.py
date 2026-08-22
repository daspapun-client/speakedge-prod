"""New-Student Orientation (Module: Orientation).

One router serving three audiences (guarded per-endpoint, like the teacher module):
- Student: view/advance their orientation walkthrough and self-complete.
- Admin: set the weekly session slots, enrol students, mark completion.
- Teacher: view assigned sessions and mark their students complete.

Sessions are scheduled weekly — a weekday + a start time that repeats until
admin changes or removes it (``/slot-rules``). The dated sessions students join
are generated from those rules; ``POST /batches`` remains for one-off sittings
and for recorded/self-paced sessions, which have no start time to repeat.
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.envelope import ok
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_role, require_student
from app.core.security import Role
from app.db.base import utcnow
from app.db.models import OrientationBatch, OrientationSlotRule, Student, Teacher
from app.modules.membership import service as membership_service
from app.modules.notification import service as notif
from app.modules.orientation import service
from app.shared.audit import log_activity

router = APIRouter(prefix="/orientation", tags=["orientation"])

require_orientation_manager = require_role(Role.admin, Role.teacher)


# --------------------------------------------------------------------------
# Student
# --------------------------------------------------------------------------
@router.get("/me")
async def my_orientation(user: CurrentUser = Depends(require_student)):
    student = await membership_service.get_student(user.subject)
    return ok(await service.get_student_view(student))


class ProgressBody(BaseModel):
    step: int


@router.post("/me/progress")
async def save_progress(body: ProgressBody, user: CurrentUser = Depends(require_student)):
    student = await membership_service.get_student(user.subject)
    if student.orientation_status == "completed":
        return ok(await service.get_student_view(student))
    student.orientation_step = max(student.orientation_step, max(0, body.step))
    if student.orientation_status == "pending":
        student.orientation_status = "in_progress"
    student.touch()
    await student.save()
    return ok(await service.get_student_view(student))


class JoinBody(BaseModel):
    batch_id: str


@router.post("/me/join")
async def join_orientation(body: JoinBody, user: CurrentUser = Depends(require_student)):
    """Student self-enrols into a scheduled orientation class. A student may only
    ever be in one class, so joining is blocked once they've joined or completed."""
    student = await membership_service.get_student(user.subject)
    if student.orientation_status == "completed":
        raise ForbiddenError("You have already completed your orientation.")
    if student.orientation_batch_id:
        raise ConflictError("You have already joined an orientation class — you can only join one.")
    batch = await OrientationBatch.get(body.batch_id)
    if not batch or batch.is_archived or batch.status != "scheduled":
        raise NotFoundError("Orientation class not found or not open for joining")
    if service.has_started(batch):
        raise ConflictError("That orientation class has already started — pick a later one.")
    if student.student_id not in batch.student_ids:
        batch.student_ids.append(student.student_id)
        batch.touch()
        await batch.save()
    student.orientation_batch_id = str(batch.id)
    if student.orientation_status == "pending":
        student.orientation_status = "in_progress"
    student.touch()
    await student.save()
    return ok(await service.get_student_view(student), "You've joined the orientation class")


class CompleteBody(BaseModel):
    rules_accepted: bool = False


@router.post("/me/complete")
async def complete_my_orientation(body: CompleteBody, user: CurrentUser = Depends(require_student)):
    student = await membership_service.get_student(user.subject)
    view = await service.get_student_view(student)
    if student.orientation_status == "completed":
        return ok(view, "Orientation already completed")
    if not view["can_self_complete"]:
        raise ForbiddenError(
            "Your orientation is completed by your teacher during the live session.")
    if not body.rules_accepted:
        raise ValidationAppError("Please accept the rules & guidelines to complete orientation")
    await service.mark_completed(student, "self")
    return ok(await service.get_student_view(student), "Orientation completed")


# --------------------------------------------------------------------------
# Shared admin/teacher helpers
# --------------------------------------------------------------------------
def _iso(dt: datetime | None) -> str | None:
    """A session time on the wire is an explicit UTC instant — a naive string
    would be read as browser-local and land 5.5 hours out."""
    dt = service.to_utc(dt)
    return dt.isoformat() if dt else None


async def _batch_summary(batch: OrientationBatch) -> dict:
    teacher_name = None
    if batch.teacher_id:
        t = await Teacher.get(batch.teacher_id)
        teacher_name = t.name if t else None
    roster = await service.roster_for(batch)
    completed = sum(1 for r in roster if r["orientation_status"] == "completed")
    return {
        "id": str(batch.id),
        "title": batch.title,
        "mode": batch.mode,
        "scheduled_at": _iso(batch.scheduled_at),
        "duration_min": batch.duration_min,
        "rule_id": batch.rule_id,
        "teacher_id": batch.teacher_id,
        "teacher_name": teacher_name,
        "meeting_url": batch.meeting_url,
        "recording_url": batch.recording_url,
        "agenda": batch.agenda,
        "status": batch.status,
        "student_count": len(batch.student_ids),
        "completed_count": completed,
        "created_at": batch.created_at.isoformat() if batch.created_at else None,
    }


async def _sync_enrollment(batch: OrientationBatch, previous_ids: list[str]) -> None:
    """Point enrolled students at this batch; unlink students removed from it."""
    added = set(batch.student_ids) - set(previous_ids)
    removed = set(previous_ids) - set(batch.student_ids)
    if added:
        for s in await Student.find({"student_id": {"$in": list(added)}}).to_list():
            if s.orientation_status != "completed":
                s.orientation_batch_id = str(batch.id)
                s.touch()
                await s.save()
    if removed:
        for s in await Student.find({"student_id": {"$in": list(removed)}}).to_list():
            if s.orientation_batch_id == str(batch.id):
                s.orientation_batch_id = None
                s.touch()
                await s.save()


async def _complete_students(batch: OrientationBatch, student_ids: list[str], actor: str) -> int:
    """Mark the given enrolled students complete; auto-close the batch when all
    enrolled students are done. Returns how many were newly completed."""
    targets = [sid for sid in student_ids if sid in batch.student_ids] or batch.student_ids
    changed = 0
    for s in await Student.find({"student_id": {"$in": targets}}).to_list():
        if await service.mark_completed(s, actor):
            changed += 1
    roster = await service.roster_for(batch)
    if batch.student_ids and all(r["orientation_status"] == "completed" for r in roster):
        batch.status = "completed"
        batch.touch()
        await batch.save()
    return changed


# --------------------------------------------------------------------------
# Admin — weekly session slots (day of week + time, repeating)
# --------------------------------------------------------------------------
# Admin sets a weekday and a start time; the slot repeats every week on that day
# and time until it is changed or removed. Editing or removing one only re-cuts
# its future sessions that nobody has joined yet — a session students are already
# enrolled in keeps its date, and is moved or cancelled on its own.
class SlotRuleBody(BaseModel):
    title: str
    day_of_week: str  # weekday name, e.g. "Sunday"
    time_of_day: str  # "HH:MM" 24h, IST
    duration_min: int = 45
    teacher_id: str | None = None
    meeting_url: str | None = None
    agenda: list[str] = []


class SlotRulePatch(BaseModel):
    title: str | None = None
    day_of_week: str | None = None
    time_of_day: str | None = None
    duration_min: int | None = None
    teacher_id: str | None = None
    meeting_url: str | None = None
    agenda: list[str] | None = None


async def _check_teacher(teacher_id: str | None) -> Teacher | None:
    if not teacher_id:
        return None
    teacher = await Teacher.get(teacher_id)
    if not teacher or teacher.is_archived:
        raise NotFoundError("Teacher not found")
    return teacher


async def _teacher_map(ids) -> dict[str, Teacher]:
    """{teacher_id: Teacher} — ids are strings, so this resolves one at a time."""
    out: dict[str, Teacher] = {}
    for tid in ids:
        teacher = await Teacher.get(tid)
        if teacher:
            out[tid] = teacher
    return out


def _rule_row(rule: OrientationSlotRule, teachers: dict[str, Teacher],
              generated: dict[str, list[OrientationBatch]]) -> dict:
    """A weekly slot as admin manages it, with the sessions it has produced."""
    now = service.to_naive_utc(utcnow())
    sessions = generated.get(str(rule.id), [])
    upcoming = sorted(
        (b for b in sessions if (service.to_naive_utc(b.scheduled_at) or now) >= now),
        key=lambda b: service.to_naive_utc(b.scheduled_at),
    )
    teacher = teachers.get(rule.teacher_id or "")
    return {
        "id": str(rule.id),
        "title": rule.title,
        "day_of_week": rule.day_of_week,
        "time_of_day": rule.time_of_day,
        "duration_min": rule.duration_min,
        "teacher_id": rule.teacher_id,
        "teacher_name": teacher.name if teacher else None,
        "meeting_url": rule.meeting_url,
        "agenda": rule.agenda,
        "label": service.label(rule.day_of_week, rule.time_of_day),
        "upcoming_sessions": len(upcoming),
        "next_session": _iso(upcoming[0].scheduled_at) if upcoming else None,
        "enrolled_upcoming": sum(len(b.student_ids) for b in upcoming),
        "created_at": _iso(rule.created_at),
    }


async def _rule_response(rule: OrientationSlotRule) -> dict:
    """One rule with its teacher and generated sessions resolved."""
    sessions = await OrientationBatch.find(
        {"rule_id": str(rule.id), "is_archived": False}).to_list()
    return _rule_row(rule, await _teacher_map({rule.teacher_id} - {None}),
                     {str(rule.id): sessions})


@router.get("/slot-rules")
async def list_slot_rules(user: CurrentUser = Depends(require_admin)):
    """The weekly session list — one row per recurring day and time."""
    rules = await OrientationSlotRule.find(
        OrientationSlotRule.is_archived == False).to_list()  # noqa: E712
    rules.sort(key=lambda r: (service.WEEKDAYS.index(r.day_of_week), r.time_of_day))
    teachers = await _teacher_map({r.teacher_id for r in rules if r.teacher_id})
    generated: dict[str, list[OrientationBatch]] = {}
    for batch in await OrientationBatch.find({"rule_id": {"$in": [str(r.id) for r in rules]},
                                              "is_archived": False}).to_list():
        generated.setdefault(batch.rule_id, []).append(batch)
    return ok([_rule_row(r, teachers, generated) for r in rules])


@router.post("/slot-rules")
async def create_slot_rule(body: SlotRuleBody, user: CurrentUser = Depends(require_admin)):
    """Add a weekly orientation slot. It starts producing sessions immediately
    and keeps repeating on that day and time until changed or removed."""
    if not body.title.strip():
        raise ValidationAppError("Title is required")
    if body.duration_min < 1:
        raise ValidationAppError("Session length must be at least 1 minute")
    day = service.parse_day(body.day_of_week)
    time_of_day = service.parse_time(body.time_of_day)
    await _check_teacher(body.teacher_id)
    if await OrientationSlotRule.find_one({"day_of_week": day, "time_of_day": time_of_day,
                                           "is_archived": False}):
        raise ConflictError(
            f"An orientation session already runs on {service.label(day, time_of_day)}")

    rule = OrientationSlotRule(
        title=body.title.strip(), day_of_week=day, time_of_day=time_of_day,
        duration_min=body.duration_min, teacher_id=body.teacher_id or None,
        meeting_url=body.meeting_url or None, agenda=body.agenda,
    )
    await rule.insert()
    created = await service.generate(rule)
    await log_activity(user.subject, "orientation.slot_rule_create", role=user.role.value,
                       target_type="orientation_slot_rule", target_id=str(rule.id),
                       meta={"slot": service.label(day, time_of_day)})
    return ok({**(await _rule_response(rule)), "created_sessions": created},
              f"Weekly orientation added — {service.label(day, time_of_day)}, "
              f"{created} session(s) open to join")


@router.patch("/slot-rules/{rule_id}")
async def update_slot_rule(rule_id: str, body: SlotRulePatch,
                           user: CurrentUser = Depends(require_admin)):
    """Change a weekly slot and re-cut the sessions it has already produced.

    Only sessions nobody has joined are rebuilt — a session students are
    enrolled in keeps its date and is rescheduled on its own if it has to move."""
    rule = await OrientationSlotRule.get(rule_id)
    if not rule or rule.is_archived:
        raise NotFoundError("Weekly orientation slot not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("title") is not None:
        data["title"] = data["title"].strip()
        if not data["title"]:
            raise ValidationAppError("Title is required")
    if data.get("duration_min") is not None and data["duration_min"] < 1:
        raise ValidationAppError("Session length must be at least 1 minute")
    if data.get("day_of_week"):
        data["day_of_week"] = service.parse_day(data["day_of_week"])
    if data.get("time_of_day"):
        data["time_of_day"] = service.parse_time(data["time_of_day"])
    if "teacher_id" in data:
        await _check_teacher(data["teacher_id"])

    day = data.get("day_of_week", rule.day_of_week)
    time_of_day = data.get("time_of_day", rule.time_of_day)
    clash = await OrientationSlotRule.find_one({"day_of_week": day, "time_of_day": time_of_day,
                                                "is_archived": False})
    if clash and str(clash.id) != rule_id:
        raise ConflictError(
            f"An orientation session already runs on {service.label(day, time_of_day)}")

    for k, v in data.items():
        setattr(rule, k, v)
    rule.touch()
    await rule.save()
    created, dropped, kept = await service.rebuild(rule)
    await log_activity(user.subject, "orientation.slot_rule_update", role=user.role.value,
                       target_type="orientation_slot_rule", target_id=rule_id,
                       meta={"fields": sorted(data.keys()), "rebuilt": created, "kept": kept})
    return ok({**(await _rule_response(rule)), "created_sessions": created,
               "removed_sessions": dropped, "enrolled_sessions_kept": kept},
              f"Weekly orientation updated — {created} upcoming session(s) rebuilt"
              + (f", {kept} with students enrolled left unchanged" if kept else ""))


@router.delete("/slot-rules/{rule_id}")
async def delete_slot_rule(rule_id: str, reason: str | None = None,
                           user: CurrentUser = Depends(require_admin)):
    """Stop a weekly slot repeating and withdraw the sessions nobody joined."""
    rule = await OrientationSlotRule.get(rule_id)
    if not rule or rule.is_archived:
        raise NotFoundError("Weekly orientation slot not found")
    dropped, kept = await service.drop_future(
        rule, user.subject, reason or "Weekly orientation slot removed")
    rule.archive(user.subject, reason)
    await rule.save()
    await log_activity(user.subject, "orientation.slot_rule_delete", role=user.role.value,
                       target_type="orientation_slot_rule", target_id=rule_id,
                       meta={"removed": dropped, "kept": kept})
    return ok({"id": rule_id, "removed_sessions": dropped, "enrolled_sessions_kept": kept},
              f"Weekly orientation removed — {dropped} upcoming session(s) withdrawn"
              + (f", {kept} with students enrolled left standing" if kept else ""))


# --------------------------------------------------------------------------
# Admin
# --------------------------------------------------------------------------
class BatchBody(BaseModel):
    title: str
    mode: str = "live"  # live | recorded
    scheduled_at: datetime | None = None
    duration_min: int = 45
    teacher_id: str | None = None
    meeting_url: str | None = None
    recording_url: str | None = None
    agenda: list[str] = []
    student_ids: list[str] = []


class BatchUpdate(BaseModel):
    title: str | None = None
    mode: str | None = None
    scheduled_at: datetime | None = None
    duration_min: int | None = None
    teacher_id: str | None = None
    meeting_url: str | None = None
    recording_url: str | None = None
    agenda: list[str] | None = None
    student_ids: list[str] | None = None
    status: str | None = None


@router.get("/batches")
async def list_batches(status: str | None = None, user: CurrentUser = Depends(require_admin)):
    query = {"is_archived": False}
    if status:
        query["status"] = status
    batches = await OrientationBatch.find(query).sort(-OrientationBatch.created_at).to_list()
    return ok([await _batch_summary(b) for b in batches])


@router.post("/batches")
async def create_batch(body: BatchBody, user: CurrentUser = Depends(require_admin)):
    if not body.title.strip():
        raise ValidationAppError("Title is required")
    if body.mode not in ("live", "recorded"):
        raise ValidationAppError("mode must be 'live' or 'recorded'")
    batch = OrientationBatch(
        title=body.title.strip(), mode=body.mode, scheduled_at=body.scheduled_at,
        duration_min=body.duration_min, teacher_id=body.teacher_id or None,
        meeting_url=body.meeting_url or None, recording_url=body.recording_url or None,
        agenda=body.agenda, student_ids=body.student_ids,
    )
    await batch.insert()
    await _sync_enrollment(batch, [])
    await log_activity(user.subject, "orientation.batch_create", role=user.role.value,
                       target_type="orientation_batch", target_id=str(batch.id),
                       meta={"title": batch.title})
    return ok(await _batch_summary(batch), "Orientation session created")


@router.get("/batches/{batch_id}")
async def batch_detail(batch_id: str, user: CurrentUser = Depends(require_admin)):
    batch = await OrientationBatch.get(batch_id)
    if not batch or batch.is_archived:
        raise NotFoundError("Orientation session not found")
    summary = await _batch_summary(batch)
    summary["roster"] = await service.roster_for(batch)
    return ok(summary)


@router.patch("/batches/{batch_id}")
async def update_batch(batch_id: str, body: BatchUpdate, user: CurrentUser = Depends(require_admin)):
    batch = await OrientationBatch.get(batch_id)
    if not batch or batch.is_archived:
        raise NotFoundError("Orientation session not found")
    previous_ids = list(batch.student_ids)
    data = body.model_dump(exclude_unset=True)
    reschedule = "scheduled_at" in data and data["scheduled_at"] != batch.scheduled_at
    for k, v in data.items():
        setattr(batch, k, v)
    batch.touch()
    await batch.save()
    if "student_ids" in data:
        await _sync_enrollment(batch, previous_ids)
    if reschedule and batch.scheduled_at and batch.student_ids:
        when = f"{service.to_ist(batch.scheduled_at):%d %b %Y, %I:%M %p}"
        await notif.notify_all(
            list(batch.student_ids), "Orientation rescheduled",
            f'Your orientation "{batch.title}" is now scheduled for {when}.',
            "info", push_url="/dashboard/orientation")
    await log_activity(user.subject, "orientation.batch_update", role=user.role.value,
                       target_type="orientation_batch", target_id=str(batch.id))
    return ok(await _batch_summary(batch), "Orientation session updated")


class CompleteStudents(BaseModel):
    student_ids: list[str] = []  # empty = all enrolled


@router.post("/batches/{batch_id}/complete")
async def admin_complete(batch_id: str, body: CompleteStudents,
                         user: CurrentUser = Depends(require_admin)):
    batch = await OrientationBatch.get(batch_id)
    if not batch or batch.is_archived:
        raise NotFoundError("Orientation session not found")
    changed = await _complete_students(batch, body.student_ids, user.subject)
    await log_activity(user.subject, "orientation.complete", role=user.role.value,
                       target_type="orientation_batch", target_id=str(batch.id),
                       meta={"completed": changed})
    return ok(await _batch_summary(batch), f"Marked {changed} student(s) complete")


# --------------------------------------------------------------------------
# Teacher
# --------------------------------------------------------------------------
async def _own_teacher(user: CurrentUser) -> Teacher:
    t = await Teacher.find_one(Teacher.username == user.subject)
    if not t:
        raise NotFoundError("No teacher profile linked to this account")
    return t


@router.get("/teacher/batches")
async def teacher_batches(user: CurrentUser = Depends(require_role(Role.teacher))):
    t = await _own_teacher(user)
    batches = await OrientationBatch.find(
        OrientationBatch.teacher_id == str(t.id),
        OrientationBatch.is_archived == False,  # noqa: E712
    ).sort(-OrientationBatch.created_at).to_list()
    out = []
    for b in batches:
        summary = await _batch_summary(b)
        summary["roster"] = await service.roster_for(b)
        out.append(summary)
    return ok(out)


@router.post("/teacher/batches/{batch_id}/complete")
async def teacher_complete(batch_id: str, body: CompleteStudents,
                           user: CurrentUser = Depends(require_role(Role.teacher))):
    batch = await OrientationBatch.get(batch_id)
    if not batch or batch.is_archived:
        raise NotFoundError("Orientation session not found")
    t = await _own_teacher(user)
    if batch.teacher_id != str(t.id):
        raise ForbiddenError("This orientation session is not assigned to you")
    changed = await _complete_students(batch, body.student_ids, user.subject)
    await log_activity(user.subject, "orientation.complete", role=user.role.value,
                       target_type="orientation_batch", target_id=str(batch.id),
                       meta={"completed": changed})
    summary = await _batch_summary(batch)
    summary["roster"] = await service.roster_for(batch)
    return ok(summary, f"Marked {changed} student(s) complete")
