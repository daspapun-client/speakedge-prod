"""New-Student Orientation (Module: Orientation).

One router serving three audiences (guarded per-endpoint, like the teacher module):
- Student: view/advance their orientation walkthrough and self-complete.
- Admin: create/schedule orientation batches, enrol students, mark completion.
- Teacher: view assigned sessions and mark their students complete.
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.envelope import ok
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_role, require_student
from app.core.security import Role
from app.db.models import OrientationBatch, Student, Teacher
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
        "scheduled_at": batch.scheduled_at.isoformat() if batch.scheduled_at else None,
        "duration_min": batch.duration_min,
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
        when = batch.scheduled_at.strftime("%d %b %Y, %H:%M UTC")
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
