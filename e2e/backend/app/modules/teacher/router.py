"""Teacher System (Module 5): application -> admin certification (Teacher ID)
-> admin-managed batches & student assignment -> attendance (Present/Absent
ticks, pending admin verification) -> remuneration -> payment confirmation
-> auto review requests -> ratings."""
import calendar
import json
import secrets
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Query, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, EmailStr

from app.core.envelope import ok
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.cache import cache
from app.core.rbac import (
    CurrentUser, get_current_user, require_admin, require_role, require_teacher,
)
from app.shared.access import require_unlocked_teacher_student
from app.core.security import Role, decode_token
from app.db.base import utcnow
from app.db.models import (
    ActivityLog,
    Attendance,
    Batch,
    BatchMessage,
    BatchSeries,
    CommunityProfile,
    PlanConfig,
    Remuneration,
    Student,
    Subscription,
    Teacher,
    TeacherReview,
    User,
)
from app.modules.auth.service import create_user
from app.modules.notification import service as notif
from app.shared import file_service
from app.shared.audit import log_activity
from app.shared.teacher_reviews import ensure_review_requests
from app.shared.realtime import hub
from app.shared.students import load_students_map

router = APIRouter(prefix="/teacher", tags=["teacher"])

require_batch_manager = require_role(Role.admin, Role.teacher)  # + ownership via _assert_manages

IST = timezone(timedelta(hours=5, minutes=30))  # ponytail: product is India-only; fixed offset


def _class_today(batch: Batch) -> bool:
    """True when today (IST) is a scheduled class day for this batch."""
    today = datetime.now(IST).strftime("%Y-%m-%d")
    weekday = datetime.now(IST).strftime("%A").lower()
    if batch.class_dates:
        return today in batch.class_dates
    if batch.date:
        return batch.date == today
    if batch.day_of_week:
        return batch.day_of_week.strip().lower() == weekday
    return False


def _batch_slot_end(batch: Batch) -> str | None:
    if batch.slot_end:
        return batch.slot_end
    if batch.class_time and "–" in batch.class_time:
        return batch.class_time.split("–")[-1].strip()
    return None


def _slot_ended_for_date(batch: Batch, date: str) -> bool:
    """True when the class slot for `date` (YYYY-MM-DD, IST calendar) has ended."""
    today = datetime.now(IST).strftime("%Y-%m-%d")
    if date > today:
        return False
    if date < today:
        return True
    end = _batch_slot_end(batch)
    if not end:
        return False
    return datetime.now(IST).strftime("%H:%M") > end


def _meeting_active(batch: Batch) -> bool:
    """The Google Meet link is live inside the batch's slot window, or when the
    teacher force-activates it outside the schedule."""
    if not batch.meeting_url:
        return False
    if batch.meeting_forced:
        return True
    if not (batch.slot_start and batch.slot_end):
        return False
    if not _class_today(batch):
        return False
    return batch.slot_start <= datetime.now(IST).strftime("%H:%M") <= batch.slot_end  # zero-padded compares fine


async def _assert_manages(batch: Batch, user: CurrentUser) -> None:
    """Admin manages any batch; a teacher manages only batches assigned to them."""
    if user.role in (Role.admin, Role.super_admin):
        return
    t = await Teacher.find_one(Teacher.username == user.subject)
    if not t or batch.teacher_id != str(t.id):
        raise ForbiddenError("This batch is not assigned to you")

CEFR_CHOICES = {"A1", "A2", "B1", "B2", "C1", "C2", "Not Tested", None}


def _teacher_id() -> str:
    return "TCH-26-" + secrets.token_hex(3).upper()


async def _own_teacher(user: CurrentUser) -> Teacher:
    """Resolve the Teacher record for the logged-in teacher user."""
    t = await Teacher.find_one(Teacher.username == user.subject)
    if not t:
        raise NotFoundError("No teacher profile linked to this account")
    return t


async def _notify_batch(batch: Batch, title: str, body: str, kind: str = "info", *,
                        student_ids: list[str] | None = None,
                        include_students: bool = True) -> None:
    """Fan a batch event out to the ``admins`` group, the batch's teacher and
    (unless suppressed) its students, so every party sees it in notifications."""
    recipients: list[str | None] = ["admins"]
    if batch.teacher_id:
        t = await Teacher.get(batch.teacher_id)
        if t and t.username:
            recipients.append(t.username)
    if include_students:
        recipients += list(student_ids if student_ids is not None else batch.student_ids)
    await notif.notify_all(recipients, title, body, kind)


async def _log_batch(user: CurrentUser, action: str, batch_id: str, **meta) -> None:
    """Append a batch-scoped entry to the activity log so the admin can review
    every admin/teacher/student action on a single batch (target_type=batch)."""
    await log_activity(user.subject, action, role=user.role.value,
                       target_type="batch", target_id=batch_id, meta=meta)


async def _log_series(user: CurrentUser, action: str, series_id: str, **meta) -> None:
    """Series-scoped activity entry (course-level create/rename/delete)."""
    await log_activity(user.subject, action, role=user.role.value,
                       target_type="batch_series", target_id=series_id, meta=meta)


# --------------------------------------------------------------------------
# Part A — Apply for Teachership (public, no approval workflow required)
# --------------------------------------------------------------------------
class TeacherApplication(BaseModel):
    name: str
    phone: str
    whatsapp: str
    email: EmailStr
    city: str
    qualification: str
    cefr_level: str  # A1..C2 | Not Tested
    experience: str | None = None  # teaching experience (optional)
    username: str  # desired dashboard login
    password: str
    bio: str | None = None


@router.post("/apply")
async def apply(body: TeacherApplication):
    if body.cefr_level not in CEFR_CHOICES:
        raise ValidationAppError("CEFR level must be A1–C2 or 'Not Tested'")
    username = body.username.strip()
    if len(username) < 3:
        raise ValidationAppError("Username must be at least 3 characters")
    if len(body.password) < 6:
        raise ValidationAppError("Password must be at least 6 characters")
    if await User.find_one(User.username == username):
        raise ConflictError("That username is already taken. Please choose another.")

    profile = body.model_dump(exclude={"username", "password"})
    t = Teacher(**profile, username=username)
    await t.insert()
    # The applicant picks their own credentials, but the login stays inactive
    # until an admin certifies them (see the approve endpoint).
    await create_user(username, body.password, Role.teacher,
                      is_active=False, full_name=body.name, email=body.email)
    return ok({"id": str(t.id), "status": t.status},
              "Thank you. Your teachership application has been received. "
              "Our team will contact you within 72 hours.")


@router.get("/applications")
async def list_applications(
    admin: CurrentUser = Depends(require_admin),
    status: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}},
                        {"phone": {"$regex": q, "$options": "i"}}]
    total = await Teacher.find(query).count()
    items = (
        await Teacher.find(query).sort(-Teacher.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    usernames = [t.username for t in items if t.username]
    login_active: dict[str, bool] = {}
    if usernames:
        for u in await User.find({"username": {"$in": usernames}}).to_list():
            login_active[u.username] = u.is_active
    rows = []
    for t in items:
        d = t.model_dump(mode="json")
        if t.username:
            d["login_is_active"] = login_active.get(t.username)
        rows.append(d)
    return ok({"items": rows, "total": total, "page": page, "page_size": page_size})


# --------------------------------------------------------------------------
# Part B — Certified Teacher Directory (public: photo, name, ID, badge only)
# --------------------------------------------------------------------------
@router.get("/directory")
async def directory():
    teachers = await Teacher.find(
        Teacher.status == "approved",
        Teacher.public_visible == True,  # noqa: E712
        Teacher.is_archived == False,  # noqa: E712
    ).to_list()
    return ok([
        {
            "teacher_id": t.teacher_id, "name": t.name, "photo_url": t.photo_url,
            "badge": "Certified Teacher – Sujyoti Language School & SpeakEdge",
        }
        for t in teachers
    ])


class ApproveBody(BaseModel):
    username: str | None = None  # link an existing teacher login (User.username)
    public_visible: bool = True


@router.post("/{teacher_id}/approve")
async def approve(teacher_id: str, body: ApproveBody | None = None,
                  admin: CurrentUser = Depends(require_admin)):
    t = await Teacher.get(teacher_id)
    if not t:
        raise NotFoundError("Teacher not found")
    t.status = "approved"
    t.certified = True
    if not t.teacher_id:
        t.teacher_id = _teacher_id()
    if body:
        t.username = body.username or t.username
        t.public_visible = body.public_visible
    await t.save()
    # Activate the linked login so the teacher can reach their dashboard.
    if t.username:
        u = await User.find_one(User.username == t.username)
        if u and not u.is_active:
            u.is_active = True
            await u.save()
    await log_activity(admin.subject, "teacher.approve", role=admin.role.value,
                       target_id=teacher_id, meta={"teacher_id": t.teacher_id})
    await notif.notify_all(
        [t.username, "admins"], "Teacher Certified",
        f"{t.name} has been certified as a SpeakEdge teacher (ID {t.teacher_id}).",
        "success")
    return ok(t.model_dump(mode="json"))


class TeacherUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    email: EmailStr | None = None
    city: str | None = None
    qualification: str | None = None
    cefr_level: str | None = None
    experience: str | None = None
    photo_url: str | None = None
    public_visible: bool | None = None
    username: str | None = None
    bio: str | None = None


@router.patch("/{teacher_id}")
async def admin_update(teacher_id: str, body: TeacherUpdate,
                       admin: CurrentUser = Depends(require_admin)):
    """Admin can edit all teacher information incl. qualification and CEFR level."""
    t = await Teacher.get(teacher_id)
    if not t:
        raise NotFoundError("Teacher not found")
    fields = body.model_dump(exclude_none=True)
    for k, v in fields.items():
        setattr(t, k, v)
    t.touch()
    await t.save()
    await log_activity(admin.subject, "teacher.update", role=admin.role.value,
                       target_id=teacher_id, meta={"fields": list(fields.keys())})
    await notif.notify_all(
        [t.username, "admins"], "Teacher Profile Updated",
        f"{t.name}'s teacher profile was updated by an admin.", "info")
    return ok(t.model_dump(mode="json"))


@router.get("/{teacher_id}/profile")
async def admin_teacher_profile(teacher_id: str, admin: CurrentUser = Depends(require_admin)):
    """Consolidated teacher view for admins: profile, approval/login status, every
    assigned batch, conducted classes (attendance), remuneration/payments and
    student ratings — everything about one teacher on a single page."""
    t = await Teacher.get(teacher_id)
    if not t:
        raise NotFoundError("Teacher not found")
    tid = str(t.id)

    login = None
    if t.username:
        u = await User.find_one(User.username == t.username)
        if u:
            login = {"username": u.username, "is_active": u.is_active,
                     "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None}

    batches = await Batch.find(Batch.teacher_id == tid,
                               Batch.is_archived == False).sort(-Batch.created_at).to_list()  # noqa: E712

    attendance = await Attendance.find(Attendance.teacher_id == tid,
                                       Attendance.is_archived == False).sort(-Attendance.date).to_list()  # noqa: E712
    att_dates: dict[str, list[str]] = {}
    pending_att: dict[str, int] = {}
    for a in attendance:
        att_dates.setdefault(a.batch_id, []).append(a.date)
        if a.status == "pending":
            pending_att[a.batch_id] = pending_att.get(a.batch_id, 0) + 1

    batch_ids = [str(b.id) for b in batches]
    reviews_by_batch: dict[str, list[TeacherReview]] = {}
    if batch_ids:
        for r in await TeacherReview.find({"batch_id": {"$in": batch_ids}}).to_list():
            if r.batch_id:
                reviews_by_batch.setdefault(r.batch_id, []).append(r)

    batch_rows = []
    for b in batches:
        revs = reviews_by_batch.get(str(b.id), [])
        submitted = [r for r in revs if r.status == "submitted"]
        ratings = [r.rating for r in submitted if r.rating]
        batch_rows.append({
            "id": str(b.id), "title": b.title,
            "day_of_week": b.day_of_week, "date": b.date, "class_dates": b.class_dates,
            "class_time": b.class_time,
            "slot_start": b.slot_start, "slot_end": b.slot_end,
            "schedule": b.schedule, "student_count": len(b.student_ids),
            "pending_count": len(b.pending_ids), "created_at": b.created_at.isoformat(),
            "attendance_submitted_dates": sorted(set(att_dates.get(str(b.id), []))),
            "classes_pending": pending_att.get(str(b.id), 0),
            "meeting_active": _meeting_active(b),
            "meeting_url": b.meeting_url,
            "meeting_forced": b.meeting_forced,
            "feedback_submitted": len(submitted),
            "feedback_pending": sum(1 for r in revs if r.status == "pending"),
            "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        })

    btitles = {str(b.id): b.title for b in batches}
    rem_by_att = {
        r.attendance_id: r
        for r in await Remuneration.find(
            {"attendance_id": {"$in": [str(a.id) for a in attendance]}}
        ).to_list()
        if r.attendance_id
    }
    classes = []
    for a in attendance:
        r = rem_by_att.get(str(a.id))
        classes.append({
            "id": str(a.id), "batch_id": a.batch_id,
            "batch_title": btitles.get(a.batch_id) or "—",
            "date": a.date, "class_time": a.class_time,
            "present_count": len(a.present_ids), "absent_count": len(a.absent_ids),
            "status": a.status,
            "batch_status": "completed",
            "remuneration_id": str(r.id) if r else None,
            "remuneration_paise": r.amount if r else 0,
            "remuneration_status": r.status if r else None,
        })
    classes_conducted = sum(1 for a in attendance if a.status == "approved")
    classes_pending = sum(1 for a in attendance if a.status == "pending")

    rem_items = await Remuneration.find(Remuneration.teacher_id == tid).sort(
        -Remuneration.created_at).to_list()
    payments = [{
        "id": str(r.id), "period": r.period, "amount": r.amount,
        "status": r.status, "created_at": r.created_at.isoformat(),
    } for r in rem_items]
    pending_paise = sum(r.amount for r in rem_items if r.status == "pending")
    paid_paise = sum(r.amount for r in rem_items if r.status == "paid")
    received_paise = sum(r.amount for r in rem_items if r.status == "received")

    reviews = await TeacherReview.find(
        TeacherReview.teacher_id == tid, TeacherReview.status == "submitted"
    ).sort(-TeacherReview.class_date, -TeacherReview.created_at).to_list()
    ratings = [r.rating for r in reviews if r.rating]
    review_smap = await load_students_map([r.student_id for r in reviews])

    return ok({
        "teacher": t.model_dump(mode="json"),
        "login": login,
        "batches": batch_rows,
        "classes": classes,
        "payments": payments,
        "reviews": [
            {
                "rating": r.rating, "feedback": r.feedback, "class_date": r.class_date,
                "student_id": r.student_id,
                "student_name": (s.full_name if (s := review_smap.get(r.student_id)) else r.student_id),
                "batch_title": btitles.get(r.batch_id or "") if r.batch_id else None,
            }
            for r in reviews
        ],
        "stats": {
            "batch_count": len(batch_rows),
            "classes_conducted": classes_conducted,
            "classes_pending": classes_pending,
            "students_taught": len({sid for b in batches for sid in b.student_ids}),
            "pending_paise": pending_paise,
            "paid_paise": paid_paise,
            "received_paise": received_paise,
            "total_paise": pending_paise + paid_paise + received_paise,
            "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "review_count": len(reviews),
        },
    })


@router.get("/{teacher_id}/activity")
async def teacher_activity(teacher_id: str, admin: CurrentUser = Depends(require_admin),
                           page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    """Audit trail for one teacher: profile actions, their batches, and actions they performed."""
    t = await Teacher.get(teacher_id)
    if not t:
        raise NotFoundError("Teacher not found")
    tid = str(t.id)
    batches = await Batch.find(Batch.teacher_id == tid).to_list()
    batch_ids = [str(b.id) for b in batches]
    btitles = {str(b.id): b.title for b in batches}

    or_clauses: list[dict] = [{"target_id": tid}]
    if batch_ids:
        or_clauses.append({"target_type": "batch", "target_id": {"$in": batch_ids}})
    if t.username:
        or_clauses.append({"actor": t.username})
    query = {"$or": or_clauses}

    total = await ActivityLog.find(query).count()
    logs = (await ActivityLog.find(query).sort(-ActivityLog.created_at)
            .skip((page - 1) * page_size).limit(page_size).to_list())

    ids: set[str] = set()
    for log in logs:
        ids.update(log.meta.get("student_ids") or [])
        if log.meta.get("student_id"):
            ids.add(log.meta["student_id"])
    smap = await load_students_map(list(ids)) if ids else {}
    names = {sid: (s.full_name or sid) for sid, s in smap.items()}

    return ok({
        "teacher_name": t.name,
        "batch_titles": btitles,
        "student_names": names,
        "items": [log.model_dump(mode="json") for log in logs],
        "total": total, "page": page, "page_size": page_size,
    })


class ProfileUpdate(BaseModel):
    phone: str | None = None
    whatsapp: str | None = None
    email: EmailStr | None = None


@router.get("/my-profile")
async def get_my_profile(user: CurrentUser = Depends(require_teacher)):
    """Editable teacher profile fields (Part D)."""
    t = await _own_teacher(user)
    return ok({
        "teacher_id": t.teacher_id,
        "name": t.name,
        "phone": t.phone,
        "whatsapp": t.whatsapp,
        "email": t.email,
        "photo_url": t.photo_url,
    })


@router.put("/my-profile")
async def update_my_profile(body: ProfileUpdate, user: CurrentUser = Depends(require_teacher)):
    """Teachers may update contact details only (Part D). Photo via POST /my-profile/photo."""
    t = await _own_teacher(user)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(t, k, v)
    t.touch()
    await t.save()
    return ok(t.model_dump(mode="json"), "Profile updated")


@router.post("/my-profile/photo")
async def update_my_profile_photo(photo: UploadFile = File(...),
                                  user: CurrentUser = Depends(require_teacher)):
    if photo.content_type not in file_service.ALLOWED_IMAGE_TYPES:
        raise ValidationAppError("Profile photo must be JPEG/PNG/WebP")
    photo_url = file_service.save_photo(await photo.read())
    t = await _own_teacher(user)
    t.photo_url = photo_url
    t.touch()
    await t.save()
    return ok({"photo_url": photo_url}, "Profile photo updated")


# --------------------------------------------------------------------------
# Part C — Teacher Dashboard: batches, attendance, earnings
# --------------------------------------------------------------------------
def _last_n_month_keys(n: int = 6) -> list[str]:
    now = datetime.utcnow()
    y, m = now.year, now.month
    keys: list[str] = []
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(keys))


@router.get("/dashboard")
async def dashboard(user: CurrentUser = Depends(require_teacher)):
    t = await _own_teacher(user)
    tid = str(t.id)
    batches = await Batch.find(Batch.teacher_id == tid,
                               Batch.is_archived == False).to_list()  # noqa: E712
    all_att = await Attendance.find(Attendance.teacher_id == tid).to_list()
    pending_att = sum(1 for a in all_att if a.status == "pending")
    reviews = await TeacherReview.find(
        TeacherReview.teacher_id == tid, TeacherReview.status == "submitted"
    ).to_list()
    ratings = [r.rating for r in reviews if r.rating]
    month = f"{datetime.utcnow():%Y-%m}"
    pending_amount = 0
    month_amount = 0
    received_amount = 0
    month_keys = _last_n_month_keys(6)
    earnings_by_month = {k: 0 for k in month_keys}
    for r in await Remuneration.find(Remuneration.teacher_id == tid).to_list():
        if r.status == "pending":
            pending_amount += r.amount
        if r.status == "received":
            received_amount += r.amount
        if r.period.startswith(month):
            month_amount += r.amount
        mk = r.period[:7]
        if mk in earnings_by_month:
            earnings_by_month[mk] += r.amount

    student_ids: set[str] = set()
    pending_join = 0
    for b in batches:
        student_ids.update(b.student_ids)
        pending_join += len(b.pending_ids)

    approved_att = [a for a in all_att if a.status == "approved"]
    present_total = sum(len(a.present_ids) for a in approved_att)
    absent_total = sum(len(a.absent_ids) for a in approved_att)
    marked = present_total + absent_total
    rating_breakdown = {str(i): 0 for i in range(1, 6)}
    for r in reviews:
        if r.rating:
            rating_breakdown[str(r.rating)] += 1
    recent = sorted(reviews, key=lambda r: r.created_at or datetime.min, reverse=True)[:3]
    recent_smap = await load_students_map([r.student_id for r in recent])
    btitles = {str(b.id): b.title for b in batches}

    return ok({
        "teacher_id": t.teacher_id, "name": t.name, "photo_url": t.photo_url,
        "batches": [b.model_dump(mode="json") for b in batches],
        "pending_attendance_approvals": pending_att,
        "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "review_count": len(reviews),
        "earnings": {
            "pending_paise": pending_amount,
            "this_month_paise": month_amount,
            "total_received_paise": received_amount,
        },
        "analytics": {
            "total_students": len(student_ids),
            "pending_join_requests": pending_join,
            "classes_approved": len(approved_att),
            "classes_this_month": sum(1 for a in approved_att if a.date.startswith(month)),
            "attendance_rate": round(present_total / marked * 100, 1) if marked else None,
            "attendance": {
                "approved": len(approved_att),
                "pending": sum(1 for a in all_att if a.status == "pending"),
                "rejected": sum(1 for a in all_att if a.status == "rejected"),
            },
            "earnings_trend": {
                "months": month_keys,
                "amounts_paise": [earnings_by_month[k] for k in month_keys],
            },
            "rating_breakdown": rating_breakdown,
            "recent_reviews": [
                {
                    "id": str(r.id),
                    "rating": r.rating,
                    "feedback": r.feedback,
                    "class_date": r.class_date,
                    "class_time": r.class_time,
                    "student_id": r.student_id,
                    "student_name": (s.full_name if (s := recent_smap.get(r.student_id)) else r.student_id),
                    "batch_title": btitles.get(r.batch_id or "") if r.batch_id else None,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                }
                for r in recent
            ],
        },
    })


class BatchBody(BaseModel):
    teacher_id: str  # Teacher document id
    title: str  # course name
    frequency: str  # daily | weekly | monthly — how often a class recurs in the range
    start_date: str  # "YYYY-MM-DD"
    end_date: str    # "YYYY-MM-DD"
    class_time: str | None = None
    slot_start: str | None = None  # "HH:MM"
    slot_end: str | None = None    # "HH:MM"
    schedule: str | None = None
    meeting_url: str | None = None
    teacher_cost_paise: int = 0  # per class, auto-credited once each date passes
    student_ids: list[str] = []


def _class_dates(frequency: str, start: str, end: str) -> list[str]:
    """Every class date (inclusive) from start to end at the given cadence.
    monthly keeps the day-of-month, clamped to the month's length."""
    try:
        d, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError:
        raise ValidationAppError("start_date and end_date must be YYYY-MM-DD")
    if last < d:
        raise ValidationAppError("end_date must be on or after start_date")
    if frequency not in ("daily", "weekly", "monthly"):
        raise ValidationAppError("frequency must be daily, weekly or monthly")
    dates: list[str] = []
    anchor, n = d, 0  # monthly counts months off the anchor so end-of-month days don't drift
    while d <= last:
        dates.append(d.isoformat())
        if len(dates) >= 366:  # ponytail: guard runaway ranges; raise cap if a real need appears
            break
        if frequency == "daily":
            d += timedelta(days=1)
        elif frequency == "weekly":
            d += timedelta(weeks=1)
        else:
            n += 1
            m = (anchor.month - 1 + n) % 12 + 1
            y = anchor.year + (anchor.month - 1 + n) // 12
            d = anchor.replace(year=y, month=m, day=min(anchor.day, calendar.monthrange(y, m)[1]))
    return dates


@router.post("/batches")
async def create_batch(body: BatchBody, admin: CurrentUser = Depends(require_admin)):
    """Admin creates a course (parent BatchSeries) plus one independent sub-batch
    per class date in the range at the chosen cadence. Each sub-batch owns its
    teacher, roster, meeting link, cost and analytics; the parent only groups them
    and holds the schedule window."""
    dates = _class_dates(body.frequency, body.start_date, body.end_date)
    series = BatchSeries(title=body.title, frequency=body.frequency,
                         start_date=body.start_date, end_date=body.end_date,
                         schedule=body.schedule)
    await series.insert()
    # Seed each sub-batch with the form values as its initial, independent state.
    common = body.model_dump(exclude={"frequency", "start_date", "end_date"})
    sub_ids: list[str] = []
    for d in dates:
        sub = Batch(**common, series_id=str(series.id),
                    class_dates=[], date=d, day_of_week=None)
        await sub.insert()
        sub_ids.append(str(sub.id))
    await _log_series(admin, "series.create", str(series.id),
                      title=series.title, teacher_id=body.teacher_id,
                      frequency=body.frequency, class_dates=dates,
                      sub_batch_ids=sub_ids)
    recipients: list[str | None] = ["admins", *body.student_ids]
    if body.teacher_id:
        t = await Teacher.get(body.teacher_id)
        if t and t.username:
            recipients.append(t.username)
    await notif.notify_all(
        recipients, "New Batch Created",
        f"\"{body.title}\" was scheduled with {len(dates)} class(es) "
        f"({body.start_date} → {body.end_date}, {body.frequency}).", "info")
    return ok({"series": series.model_dump(mode="json"),
               "sub_batch_ids": sub_ids, "count": len(sub_ids)})


class BatchUpdate(BaseModel):
    teacher_id: str | None = None  # replace the assigned teacher
    title: str | None = None
    day_of_week: str | None = None
    date: str | None = None
    class_time: str | None = None
    slot_start: str | None = None
    slot_end: str | None = None
    schedule: str | None = None
    meeting_url: str | None = None
    teacher_cost_paise: int | None = None


@router.patch("/batches/{batch_id}")
async def update_batch(batch_id: str, body: BatchUpdate,
                       admin: CurrentUser = Depends(require_admin)):
    """Admin edits a batch — including replacing the teacher or setting the meet link."""
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    fields = body.model_dump(exclude_none=True)
    if "date" in fields:
        batch.day_of_week = None
    for k, v in fields.items():
        setattr(batch, k, v)
    batch.touch()
    await batch.save()
    await _log_batch(admin, "batch.update", batch_id, fields=list(fields.keys()))
    await _notify_batch(batch, "Batch Updated",
                        f"Batch \"{batch.title}\" was updated.", "info")
    return ok(batch.model_dump(mode="json"))


@router.delete("/batches/{batch_id}")
async def delete_batch(batch_id: str, admin: CurrentUser = Depends(require_admin)):
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    batch.archive(admin.subject, "batch deleted")
    await batch.save()
    await _log_batch(admin, "batch.delete", batch_id, title=batch.title)
    await _notify_batch(batch, "Batch Cancelled",
                        f"Batch \"{batch.title}\" has been cancelled.", "warning")
    return ok(message="Batch archived")


class BulkDeleteBatches(BaseModel):
    batch_ids: list[str]


@router.post("/admin/batches/bulk-delete")
async def bulk_delete_batches(body: BulkDeleteBatches, admin: CurrentUser = Depends(require_admin)):
    deleted: list[str] = []
    skipped: list[dict] = []
    for bid in dict.fromkeys(body.batch_ids):
        batch = await Batch.get(bid)
        if not batch or batch.is_archived:
            skipped.append({"batch_id": bid, "reason": "not found"})
            continue
        batch.archive(admin.subject, "batch deleted")
        await batch.save()
        await _log_batch(admin, "batch.delete", bid, title=batch.title)
        await _notify_batch(batch, "Batch Cancelled",
                            f"Batch \"{batch.title}\" has been cancelled.", "warning")
        deleted.append(bid)
    return ok({"deleted": len(deleted), "batch_ids": deleted, "skipped": skipped},
              f"Deleted {len(deleted)} batch(es)")


class SeriesUpdate(BaseModel):
    title: str | None = None
    schedule: str | None = None


@router.patch("/series/{series_id}")
async def update_series(series_id: str, body: SeriesUpdate,
                        admin: CurrentUser = Depends(require_admin)):
    """Rename a course / edit its schedule note. Title changes cascade to the
    child sub-batches for display (their other fields stay independent)."""
    series = await BatchSeries.get(series_id)
    if not series or series.is_archived:
        raise NotFoundError("Batch series not found")
    fields = body.model_dump(exclude_none=True)
    for k, v in fields.items():
        setattr(series, k, v)
    series.touch()
    await series.save()
    if "title" in fields:
        async for sub in Batch.find(Batch.series_id == series_id,
                                    Batch.is_archived == False):  # noqa: E712
            sub.title = fields["title"]
            sub.touch()
            await sub.save()
    await _log_series(admin, "series.update", series_id, fields=list(fields.keys()))
    return ok(series.model_dump(mode="json"), "Course updated")


@router.delete("/series/{series_id}")
async def delete_series(series_id: str, admin: CurrentUser = Depends(require_admin)):
    """Archive a whole course: the parent series and every child sub-batch."""
    series = await BatchSeries.get(series_id)
    if not series or series.is_archived:
        raise NotFoundError("Batch series not found")
    count = 0
    async for sub in Batch.find(Batch.series_id == series_id,
                                Batch.is_archived == False):  # noqa: E712
        sub.archive(admin.subject, "course deleted")
        await sub.save()
        await _notify_batch(sub, "Batch Cancelled",
                            f"Batch \"{sub.title}\" has been cancelled.", "warning")
        count += 1
    series.archive(admin.subject, "course deleted")
    await series.save()
    await _log_series(admin, "series.delete", series_id, title=series.title,
                      sub_batches=count)
    return ok({"archived_sub_batches": count}, "Course archived")


class MeetingLink(BaseModel):
    meeting_url: str | None = None


@router.post("/batches/{batch_id}/meeting-link")
async def set_meeting_link(batch_id: str, body: MeetingLink,
                           user: CurrentUser = Depends(require_batch_manager)):
    """Admin or the assigned teacher adds/updates the Google Meet link."""
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    await _assert_manages(batch, user)
    batch.meeting_url = body.meeting_url or None
    if not batch.meeting_url:
        batch.meeting_forced = False
    batch.touch()
    await batch.save()
    await _log_batch(user, "batch.meeting_link", batch_id,
                     set=bool(batch.meeting_url))
    if batch.meeting_url:
        await _notify_batch(batch, "Meeting Link Ready",
                            f"The meeting link for \"{batch.title}\" is now set.", "info")
    return ok(batch.model_dump(mode="json"), "Meeting link updated")


class MeetingForceBody(BaseModel):
    forced: bool


@router.post("/batches/{batch_id}/meeting-force")
async def set_meeting_force(batch_id: str, body: MeetingForceBody,
                            user: CurrentUser = Depends(require_batch_manager)):
    """Teacher (or admin) force-activates the meet link outside the scheduled slot."""
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    await _assert_manages(batch, user)
    if body.forced and not batch.meeting_url:
        raise ValidationAppError("Set a meeting link before going live.")
    batch.meeting_forced = body.forced
    batch.touch()
    await batch.save()
    await _log_batch(user, "batch.meeting_live" if body.forced else "batch.meeting_end", batch_id)
    if body.forced:
        await _notify_batch(
            batch, "Class Is Live",
            f"\"{batch.title}\" is live now — open Batches to join the session.",
            "info", include_students=True,
        )
    data = batch.model_dump(mode="json")
    data["meeting_active"] = _meeting_active(batch)
    return ok(data, "Session is live" if body.forced else "Live session ended")


class AssignStudents(BaseModel):
    student_ids: list[str]


@router.post("/batches/{batch_id}/students")
async def assign_students(batch_id: str, body: AssignStudents,
                          admin: CurrentUser = Depends(require_admin)):
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    added: list[str] = []
    for sid in body.student_ids:
        if sid not in batch.student_ids:
            batch.student_ids.append(sid)
            added.append(sid)
        if sid in batch.pending_ids:
            batch.pending_ids.remove(sid)
    batch.touch()
    await batch.save()
    if added:
        await _log_batch(admin, "batch.students_add", batch_id,
                         student_ids=added, count=len(added))
        await notif.notify_all(added, "Added to Batch",
                               f"You have been added to the batch \"{batch.title}\".",
                               "approval")
        await _notify_batch(batch, "Batch Roster Updated",
                            f"{len(added)} student(s) were added to \"{batch.title}\".",
                            "info", include_students=False)
    return ok(batch.model_dump(mode="json"))


# --------------------------------------------------------------------------
# Batch join requests: student requests → admin/teacher approves
# --------------------------------------------------------------------------
class MemberRef(BaseModel):
    student_id: str


@router.post("/batches/{batch_id}/remove-student")
async def remove_student(batch_id: str, body: MemberRef,
                         admin: CurrentUser = Depends(require_admin)):
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    removed = body.student_id in batch.student_ids
    if removed:
        batch.student_ids.remove(body.student_id)
    batch.touch()
    await batch.save()
    if removed:
        await _log_batch(admin, "batch.student_remove", batch_id, student_id=body.student_id)
        await notif.notify(body.student_id, "Removed from Batch",
                           f"You have been removed from the batch \"{batch.title}\".",
                           kind="warning")
        await _notify_batch(batch, "Batch Roster Updated",
                            f"A student was removed from \"{batch.title}\".",
                            "info", include_students=False)
    return ok(batch.model_dump(mode="json"))


async def _batch_allowance(student_id: str) -> tuple[int, int]:
    """(batches_used, batch_limit) for a student. The limit is the active
    subscription plan's classes_per_week; used counts the batches the student
    is already a member of plus any pending join requests. A limit of 0 means
    there is no active subscription (batches are subscription-gated)."""
    sub = await Subscription.find_one(
        Subscription.student_id == student_id, Subscription.is_active == True  # noqa: E712
    )
    expires = sub.expires_at if sub else None
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if not sub or expires is None or expires <= utcnow():
        return 0, 0
    plan = await PlanConfig.find_one(PlanConfig.plan == sub.plan)
    limit = plan.classes_per_week if plan and plan.classes_per_week > 0 else 1
    # A course counts once even if the student joined several of its sessions:
    # count distinct series (sub-batches without a series fall back to their id).
    joined = await Batch.find({
        "is_archived": False,
        "$or": [{"student_ids": student_id}, {"pending_ids": student_id}],
    }).to_list()
    used = len({b.series_id or str(b.id) for b in joined})
    return used, limit


@router.post("/batches/{batch_id}/request-join")
async def request_join(batch_id: str, user: CurrentUser = Depends(require_unlocked_teacher_student)):
    batch = await Batch.get(batch_id)
    if not batch or batch.is_archived:
        raise NotFoundError("Batch not found")
    if user.subject in batch.student_ids:
        raise ConflictError("You are already a member of this batch")
    if user.subject in batch.pending_ids:
        raise ConflictError("Your join request is already pending")

    # A student may join only as many batches as their subscription plan grants.
    used, limit = await _batch_allowance(user.subject)
    if limit == 0:
        raise ForbiddenError("An active subscription is required to join batches.")
    if used >= limit:
        raise ConflictError(
            f"Your plan allows joining up to {limit} batch(es). "
            "Leave a batch before joining another."
        )

    batch.pending_ids.append(user.subject)
    batch.touch()
    await batch.save()
    await _log_batch(user, "batch.join_request", batch_id, student_id=user.subject)
    return ok(message="Join request sent. You'll be notified once it's approved.")


@router.post("/batches/{batch_id}/withdraw-join")
async def withdraw_join(batch_id: str, user: CurrentUser = Depends(require_unlocked_teacher_student)):
    batch = await Batch.get(batch_id)
    if not batch or batch.is_archived:
        raise NotFoundError("Batch not found")
    if user.subject not in batch.pending_ids:
        raise NotFoundError("No pending join request to withdraw")
    batch.pending_ids.remove(user.subject)
    batch.touch()
    await batch.save()
    await _log_batch(user, "batch.join_withdraw", batch_id, student_id=user.subject)
    await _notify_batch(batch, "Join Request Withdrawn",
                        f"A student withdrew their request to join \"{batch.title}\".",
                        "info", include_students=False)
    return ok(message="Join request withdrawn.")


@router.post("/batches/{batch_id}/approve-join")
async def approve_join(batch_id: str, body: MemberRef,
                       user: CurrentUser = Depends(require_batch_manager)):
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    await _assert_manages(batch, user)
    if body.student_id not in batch.pending_ids:
        raise NotFoundError("No such pending request")
    batch.pending_ids.remove(body.student_id)
    if body.student_id not in batch.student_ids:
        batch.student_ids.append(body.student_id)
    batch.touch()
    await batch.save()
    await _log_batch(user, "batch.join_approve", batch_id, student_id=body.student_id)
    await notif.notify(body.student_id, "Batch Join Approved",
                       f"You've been added to the batch \"{batch.title}\".", kind="approval")
    await _notify_batch(batch, "Batch Join Approved",
                        f"A student was approved to join \"{batch.title}\".",
                        "approval", include_students=False)
    return ok(batch.model_dump(mode="json"), "Student approved")


@router.post("/batches/{batch_id}/reject-join")
async def reject_join(batch_id: str, body: MemberRef,
                      user: CurrentUser = Depends(require_batch_manager)):
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    await _assert_manages(batch, user)
    if body.student_id in batch.pending_ids:
        batch.pending_ids.remove(body.student_id)
        batch.touch()
        await batch.save()
        await _log_batch(user, "batch.join_reject", batch_id, student_id=body.student_id)
        await notif.notify(body.student_id, "Batch Join Declined",
                           f"Your request to join \"{batch.title}\" was declined.",
                           kind="warning")
        await _notify_batch(batch, "Batch Join Declined",
                            f"A join request for \"{batch.title}\" was declined.",
                            "info", include_students=False)
    return ok(batch.model_dump(mode="json"), "Request declined")


@router.get("/browse-batches")
async def browse_batches(user: CurrentUser = Depends(require_unlocked_teacher_student)):
    """Student view: every batch with the student's membership status. The meet
    link is exposed only to members and only while the slot is live."""
    batches = await Batch.find(Batch.is_archived == False).sort(-Batch.created_at).to_list()  # noqa: E712
    batch_ids = [str(b.id) for b in batches]
    att_dates: dict[str, list[str]] = {}
    if batch_ids:
        for att in await Attendance.find(
            {"batch_id": {"$in": batch_ids}, "status": {"$in": ["pending", "approved"]}}
        ).to_list():
            att_dates.setdefault(att.batch_id, []).append(att.date)
    tmap = {str(t.id): t for t in await Teacher.find().to_list()}
    series_ids = {b.series_id for b in batches if b.series_id}
    stitles: dict[str, str] = {}
    for sid in series_ids:
        s = await BatchSeries.get(sid)
        if s and not s.is_archived:
            stitles[sid] = s.title
    rows = []
    for b in batches:
        member = user.subject in b.student_ids
        active = _meeting_active(b)
        teacher = tmap.get(b.teacher_id)
        rows.append({
            "id": str(b.id), "title": b.title,
            "series_id": b.series_id,
            "series_title": stitles.get(b.series_id) if b.series_id else None,
            "teacher_name": teacher.name if teacher else None,
            "teacher_photo_url": teacher.photo_url if teacher else None,
            "day_of_week": b.day_of_week, "date": b.date, "class_dates": b.class_dates,
            "class_time": b.class_time,
            "slot_start": b.slot_start, "slot_end": b.slot_end, "schedule": b.schedule,
            "status": "member" if member else ("pending" if user.subject in b.pending_ids else "none"),
            "meeting_active": active,
            "meeting_url": b.meeting_url if (member and active) else None,
            "member_count": len(b.student_ids),
            "attendance_submitted_dates": sorted(set(att_dates.get(str(b.id), []))),
        })
    used, limit = await _batch_allowance(user.subject)
    return ok({"batches": rows, "batches_used": used, "batch_limit": limit})


@router.get("/batches/{batch_id}/detail")
async def batch_detail(batch_id: str, user: CurrentUser = Depends(require_unlocked_teacher_student)):
    """Student view of a single batch: teacher profile (always) and the member
    roster (enrolled classmates only, mirroring member-only team messages)."""
    b = await Batch.get(batch_id)
    if not b or b.is_archived:
        raise NotFoundError("Batch not found")

    teacher = await Teacher.get(b.teacher_id) if b.teacher_id else None
    teacher_data = None
    if teacher:
        teacher_data = {
            "name": teacher.name, "photo_url": teacher.photo_url,
            "cefr_level": teacher.cefr_level, "qualification": teacher.qualification,
            "city": teacher.city, "bio": teacher.bio, "certified": teacher.certified,
        }

    is_member = user.subject in b.student_ids
    members: list[dict] = []
    if is_member and b.student_ids:
        profiles = {
            p.student_id: p for p in await CommunityProfile.find(
                {"student_id": {"$in": b.student_ids}, "is_archived": False}
            ).to_list()
        }
        students = {
            s.student_id: s for s in await Student.find(
                {"student_id": {"$in": b.student_ids}}
            ).to_list()
        }
        for sid in b.student_ids:
            p, s = profiles.get(sid), students.get(sid)
            members.append({
                "student_id": sid,
                "display_name": (p.display_name if p else None) or (s.full_name if s else sid),
                "photo_url": (p.photo_url if p else None) or (s.photo_url if s else None),
                "cefr_level": (p.cefr_level if p else None) or (s.cefr_level if s else None),
                "age": (p.age if p else None) or (s.age if s else None),
                "gender": (p.gender if p else None) or (s.gender if s else None),
                "bio": p.bio if p else None,
            })

    return ok({
        "teacher": teacher_data, "members": members,
        "member_count": len(b.student_ids), "is_member": is_member,
    })


async def _batches_for_teacher(t: Teacher) -> list[dict]:
    """Batch list with per-student profile details (spec: My Batches). Shared by
    the teacher dashboard (my-batches) and the admin "act as teacher" view."""
    batches = await Batch.find(Batch.teacher_id == str(t.id),
                               Batch.is_archived == False).to_list()  # noqa: E712
    batch_ids = [str(b.id) for b in batches]
    att_dates: dict[str, list[str]] = {}
    if batch_ids:
        for att in await Attendance.find(
            {"batch_id": {"$in": batch_ids}, "status": {"$in": ["pending", "approved"]}}
        ).to_list():
            att_dates.setdefault(att.batch_id, []).append(att.date)
    stitles: dict[str, str] = {}
    for sid in {b.series_id for b in batches if b.series_id}:
        s = await BatchSeries.get(sid)
        if s and not s.is_archived:
            stitles[sid] = s.title
    out = []
    for b in batches:
        smap = await load_students_map(b.student_ids)
        students = []
        for sid in b.student_ids:
            s = smap.get(sid)
            students.append({
                "student_id": sid,
                "name": s.full_name if s else sid,
                "phone": s.phone if s else None,
                "whatsapp": s.whatsapp if s else None,
                "email": s.email if s else None,
                "age": s.age if s else None,
                "gender": s.gender if s else None,
                "photo_url": s.photo_url if s else None,
            })
        data = b.model_dump(mode="json")
        data["students"] = students
        data["series_title"] = stitles.get(b.series_id) if b.series_id else None
        data["pending"] = await _resolve_names(b.pending_ids)
        data["meeting_active"] = _meeting_active(b)
        data["meeting_forced"] = b.meeting_forced
        data["attendance_submitted_dates"] = sorted(set(att_dates.get(str(b.id), [])))
        out.append(data)
    return out


@router.get("/my-batches")
async def my_batches(user: CurrentUser = Depends(require_teacher)):
    """Batch list with per-student profile details (spec: My Batches)."""
    t = await _own_teacher(user)
    return ok(await _batches_for_teacher(t))


@router.get("/{teacher_id}/batches-manage")
async def admin_teacher_batches(teacher_id: str, admin: CurrentUser = Depends(require_admin)):
    """Admin view of a teacher's batches in the exact shape the teacher sees, so
    the admin can run every teacher batch action (meet link, go live, join
    requests, attendance, chat) for this teacher from the teacher profile page."""
    t = await Teacher.get(teacher_id)
    if not t:
        raise NotFoundError("Teacher not found")
    return ok(await _batches_for_teacher(t))


# --------------------------------------------------------------------------
# Batch chat — teacher + enrolled students (mirrors community team chat)
# --------------------------------------------------------------------------
BATCH_ROOM = "batch:{}"
MSG_RATE_LIMIT = 30
MSG_RATE_WINDOW = 10


def _batch_room(batch_id: str) -> str:
    return BATCH_ROOM.format(batch_id)


async def _batch_teacher_username(batch: Batch) -> str | None:
    if not batch.teacher_id:
        return None
    t = await Teacher.get(batch.teacher_id)
    return t.username if t else None


async def _can_access_batch(batch: Batch, user: CurrentUser) -> bool:
    if user.role in (Role.admin, Role.super_admin):
        return True
    if user.role == Role.student and user.subject in batch.student_ids:
        return True
    if user.role == Role.teacher:
        t = await Teacher.find_one(Teacher.username == user.subject)
        return bool(t and batch.teacher_id == str(t.id))
    return False


async def _accessible_batch(batch_id: str, user: CurrentUser) -> Batch:
    batch = await Batch.get(batch_id)
    if not batch or batch.is_archived:
        raise NotFoundError("Batch not found")
    if not await _can_access_batch(batch, user):
        raise NotFoundError("Batch not found or you are not a member")
    return batch


async def _batch_sender_name(batch: Batch, user: CurrentUser) -> str:
    if user.role == Role.teacher:
        t = await Teacher.find_one(Teacher.username == user.subject)
        return t.name if t else user.subject
    profile = await CommunityProfile.find_one(
        CommunityProfile.student_id == user.subject, CommunityProfile.is_archived == False  # noqa: E712
    )
    if profile and profile.display_name:
        return profile.display_name
    smap = await load_students_map([user.subject])
    s = smap.get(user.subject)
    return s.full_name if s else user.subject


async def _notify_unseen_batch_chat(batch: Batch, sender_id: str, sender_name: str, text: str) -> None:
    """Notify offline batch participants (teacher + students, except sender)."""
    room = _batch_room(str(batch.id))
    online = set(await hub.roster(room))
    preview = text if len(text) <= 100 else text[:100] + "…"
    title = f"New message in {batch.title}"
    batch_id = str(batch.id)
    recipients: list[str] = []
    teacher_username = await _batch_teacher_username(batch)
    if teacher_username:
        recipients.append(teacher_username)
    recipients.extend(batch.student_ids)
    for member_id in recipients:
        if member_id == sender_id or member_id in online:
            continue
        body = f"{sender_name}: {preview}\n\nView chat: batch/{batch_id}"
        push_url = (
            f"/teacher/batches#batch-{batch_id}"
            if member_id == teacher_username
            else f"/dashboard/batches#batch-{batch_id}"
        )
        await notif.notify(member_id, title, body, kind="batch", push_url=push_url)


async def _dispatch_batch_message(batch: Batch, sender_id: str, sender_name: str, text: str) -> BatchMessage:
    batch_id = str(batch.id)
    msg = BatchMessage(
        batch_id=batch_id, sender_id=sender_id, sender_name=sender_name, text=text[:2000],
    )
    await msg.insert()
    payload = msg.model_dump(mode="json")
    await hub.publish(_batch_room(batch_id), {"type": "message", "message": payload})
    await _notify_unseen_batch_chat(batch, sender_id, sender_name, text)
    return msg


class BatchMessageBody(BaseModel):
    text: str


@router.get("/batches/{batch_id}/messages")
async def batch_messages(batch_id: str, user: CurrentUser = Depends(get_current_user)):
    batch = await _accessible_batch(batch_id, user)
    msgs = (
        await BatchMessage.find(BatchMessage.batch_id == batch_id, BatchMessage.is_archived == False)  # noqa: E712
        .sort(BatchMessage.created_at).to_list()
    )
    return ok({"batch": batch.model_dump(mode="json"), "messages": [m.model_dump(mode="json") for m in msgs]})


@router.post("/batches/{batch_id}/messages")
async def send_batch_message(batch_id: str, body: BatchMessageBody, user: CurrentUser = Depends(get_current_user)):
    batch = await _accessible_batch(batch_id, user)
    text = body.text.strip()
    if not text:
        raise ConflictError("Message cannot be empty")
    name = await _batch_sender_name(batch, user)
    msg = await _dispatch_batch_message(batch, user.subject, name, text)
    return ok(msg.model_dump(mode="json"))


@router.websocket("/ws/batches/{batch_id}")
async def batch_chat_ws(ws: WebSocket, batch_id: str, token: str = Query(...)):
    try:
        payload = decode_token(token, expected_type="access")
        actor_id = payload["sub"]
        role = Role(payload["role"])
    except Exception:
        await ws.close(code=4401)
        return

    batch = await Batch.get(batch_id)
    user = CurrentUser(subject=actor_id, role=role, claims=payload)
    if not batch or batch.is_archived or not await _can_access_batch(batch, user):
        await ws.close(code=4403)
        return

    room = _batch_room(batch_id)
    await ws.accept()
    name = await _batch_sender_name(batch, user)
    await hub.join(room, ws, actor_id)
    try:
        await hub.send_to(ws, {"type": "presence", "online": await hub.roster(room)})
        await hub.broadcast_presence(room)

        while True:
            raw = await ws.receive_text()
            try:
                frame = json.loads(raw)
            except Exception:
                continue
            kind = frame.get("type")

            if kind == "message":
                text = (frame.get("text") or "").strip()
                if not text:
                    continue
                batch = await Batch.get(batch_id)
                if not batch or batch.is_archived or not await _can_access_batch(batch, user):
                    break
                if await cache.incr_window(f"wsmsg:{actor_id}", MSG_RATE_WINDOW) > MSG_RATE_LIMIT:
                    await hub.send_to(ws, {"type": "error", "message": "You're sending messages too fast."})
                    continue
                await _dispatch_batch_message(batch, actor_id, name, text)

            elif kind == "typing":
                await hub.publish(room, {
                    "type": "typing", "student_id": actor_id,
                    "display_name": name, "is_typing": bool(frame.get("is_typing")),
                })

            elif kind == "ping":
                await hub.heartbeat(room, actor_id)
                await hub.send_to(ws, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(room, ws, actor_id)
        await hub.broadcast_presence(room)


async def _resolve_names(student_ids: list[str]) -> list[dict]:
    if not student_ids:
        return []
    smap = await load_students_map(student_ids)
    out = []
    for sid in student_ids:
        s = smap.get(sid)
        out.append({
            "student_id": sid,
            "name": s.full_name if s else sid,
            "photo_url": s.photo_url if s else None,
            "gender": s.gender if s else None,
        })
    return out


class AttendanceBody(BaseModel):
    batch_id: str
    date: str
    class_time: str | None = None
    present_ids: list[str] = []
    absent_ids: list[str] = []
    class_held: bool = True


@router.post("/attendance")
async def submit_attendance(body: AttendanceBody, user: CurrentUser = Depends(require_batch_manager)):
    """Assigned teacher (or an admin acting for them) submits class attendance."""
    batch = await Batch.get(body.batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    await _assert_manages(batch, user)  # teacher must own the batch; admin allowed
    teacher = await Teacher.get(batch.teacher_id) if batch.teacher_id else None
    if await Attendance.find_one(
        {"batch_id": body.batch_id, "date": body.date, "status": {"$in": ["pending", "approved"]}}
    ):
        raise ConflictError(f"Attendance for {body.date} was already submitted for this batch")
    if not _slot_ended_for_date(batch, body.date):
        raise ValidationAppError(
            f"The class slot on {body.date} has not ended yet — attendance can only be submitted after the class"
        )
    if body.class_held:
        if not body.present_ids and not body.absent_ids:
            raise ValidationAppError("Mark students present/absent, or report that the class did not happen")
    else:
        body.present_ids = []
        body.absent_ids = []
    att = Attendance(**body.model_dump(), teacher_id=batch.teacher_id)
    await att.insert()
    await ensure_review_requests(att, teacher)
    await _log_batch(user, "attendance.submit", body.batch_id, date=body.date,
                     attendance_id=str(att.id), present=len(body.present_ids),
                     absent=len(body.absent_ids), class_held=body.class_held)
    if body.class_held:
        await _notify_batch(
            batch, "Attendance Submitted",
            f"Attendance for \"{batch.title}\" on {body.date} was submitted "
            "and is pending admin verification.", "info",
            student_ids=body.present_ids + body.absent_ids)
        msg = "Attendance submitted. Status: Pending Admin Verification."
    else:
        await notif.notify_all(
            [teacher.username if teacher else None, "admins"],
            "Class Not Held",
            f"\"{batch.title}\" on {body.date} was marked as not held by the teacher.",
            "warning",
        )
        msg = "Class marked as not held — pending admin verification."
    return ok(att.model_dump(mode="json"), msg)


class AttendanceReview(BaseModel):
    action: str = "approve"  # approve | reject
    remuneration_paise: int = 0  # per-class remuneration credited on approval


@router.post("/attendance/{attendance_id}/review")
async def review_attendance(attendance_id: str, body: AttendanceReview,
                            admin: CurrentUser = Depends(require_admin)):
    """Admin verification. Approval automatically updates teacher remuneration
    and triggers a review form for every present student (7-day window)."""
    att = await Attendance.get(attendance_id)
    if not att:
        raise NotFoundError("Attendance not found")
    if att.status != "pending":
        raise ConflictError("Attendance already reviewed")

    if body.action == "reject":
        att.status = "rejected"
        att.approved = False
        att.reviewed_by = admin.subject
        await att.save()
        await _log_batch(admin, "attendance.reject", att.batch_id,
                         date=att.date, attendance_id=attendance_id)
        t = await Teacher.get(att.teacher_id) if att.teacher_id else None
        await notif.notify_all(
            [t.username if t else None, "admins"], "Attendance Rejected",
            f"Attendance for {att.date} was rejected.", "warning")
        return ok(att.model_dump(mode="json"), "Attendance rejected")

    att.status = "approved"
    att.approved = True
    att.reviewed_by = admin.subject
    await att.save()

    teacher = await Teacher.get(att.teacher_id) if att.teacher_id else None

    # Remuneration for that class appears in the Teacher Dashboard.
    if body.remuneration_paise > 0 and att.teacher_id:
        await Remuneration(
            teacher_id=att.teacher_id, period=att.date,
            attendance_id=attendance_id, amount=body.remuneration_paise,
        ).insert()

    await ensure_review_requests(att, teacher)

    await notif.notify_all(
        [teacher.username if teacher else None, "admins"], "Attendance Approved",
        f"Attendance for {att.date} was approved.", "success")
    # Let the present students know their class attendance is confirmed.
    await notif.notify_all(
        att.present_ids, "Attendance Confirmed",
        f"Your attendance for the class on {att.date} was confirmed.", "success")
    await _log_batch(admin, "attendance.approve", att.batch_id, date=att.date,
                     attendance_id=attendance_id, remuneration_paise=body.remuneration_paise)
    return ok(att.model_dump(mode="json"), "Attendance approved")


class CreditRemuneration(BaseModel):
    amount_paise: int


@router.post("/attendance/{attendance_id}/credit-remuneration")
async def credit_remuneration(attendance_id: str, body: CreditRemuneration,
                              admin: CurrentUser = Depends(require_admin)):
    """Credit remuneration for an already-approved class (e.g. approval had no amount)."""
    att = await Attendance.get(attendance_id)
    if not att or att.is_archived:
        raise NotFoundError("Attendance not found")
    if att.status != "approved":
        raise ConflictError("Attendance must be approved before crediting pay")
    if body.amount_paise <= 0:
        raise ValidationAppError("amount_paise must be positive")
    existing = await Remuneration.find_one(Remuneration.attendance_id == attendance_id)
    if existing:
        raise ConflictError("Remuneration already credited for this class")
    r = await Remuneration(
        teacher_id=att.teacher_id, period=att.date,
        attendance_id=attendance_id, amount=body.amount_paise,
    ).insert()
    await _log_batch(admin, "remuneration.credit", att.batch_id,
                     date=att.date, attendance_id=attendance_id,
                     remuneration_paise=body.amount_paise)
    return ok(r.model_dump(mode="json"), "Remuneration credited")


# --------------------------------------------------------------------------
# Remuneration & payment confirmation workflow
# --------------------------------------------------------------------------
@router.get("/my-remuneration")
async def my_remuneration(user: CurrentUser = Depends(require_teacher)):
    t = await _own_teacher(user)
    items = await Remuneration.find(Remuneration.teacher_id == str(t.id)).sort(
        -Remuneration.created_at
    ).to_list()
    return ok([r.model_dump(mode="json") for r in items])


@router.post("/remuneration/{remuneration_id}/mark-paid")
async def mark_paid(remuneration_id: str, admin: CurrentUser = Depends(require_admin)):
    r = await Remuneration.get(remuneration_id)
    if not r:
        raise NotFoundError("Remuneration not found")
    r.status = "paid"
    r.paid_by = admin.subject
    r.touch()
    await r.save()
    t = await Teacher.get(r.teacher_id)
    await notif.notify_all(
        [t.username if t else None, "admins"], "Payment Processed",
        f"A payment of ₹{r.amount / 100:,.0f} has been processed. Please confirm receipt.",
        "payment")
    return ok(r.model_dump(mode="json"), "Marked paid — awaiting teacher confirmation")


@router.post("/remuneration/{remuneration_id}/confirm-received")
async def confirm_received(remuneration_id: str,
                           user: CurrentUser = Depends(require_role(Role.admin, Role.teacher))):
    """Teacher confirms a payment was received — or an admin confirms for them."""
    r = await Remuneration.get(remuneration_id)
    if not r:
        raise NotFoundError("Remuneration not found")
    if user.role == Role.teacher:
        t = await _own_teacher(user)
        if r.teacher_id != str(t.id):
            raise NotFoundError("Remuneration not found")
    else:
        t = await Teacher.get(r.teacher_id)
    if r.status != "paid":
        raise ConflictError("Payment has not been marked as paid yet")
    r.status = "received"
    r.received_confirmed_at = utcnow()
    r.touch()
    await r.save()
    await notif.notify_all(
        ["admins", t.username if t else None], "Payment Receipt Confirmed",
        f"{t.name if t else 'The teacher'} confirmed receipt of a "
        f"₹{r.amount / 100:,.0f} payment.", "payment")
    return ok(r.model_dump(mode="json"), "Payment receipt confirmed")


# --------------------------------------------------------------------------
# Admin management listings (companions to the create/review/mark-paid actions)
# --------------------------------------------------------------------------
def _teacher_lookup(tmap: dict, teacher_id: str | None):
    if not teacher_id:
        return None
    return tmap.get(str(teacher_id))


def _session_of(b: Batch, row: dict, tmap: dict) -> dict:
    """Enriched per-session descriptor for the admin course view (one per child
    sub-batch), so the frontend can render the schedule without extra fetches."""
    teacher = _teacher_lookup(tmap, b.teacher_id)
    return {
        "id": str(b.id), "batch_id": str(b.id), "date": b.date,
        "teacher_id": b.teacher_id,
        "teacher_name": teacher.name if teacher else row.get("teacher_name"),
        "teacher_photo_url": (teacher.photo_url if teacher else None) or row.get("teacher_photo_url"),
        "slot_start": b.slot_start, "slot_end": b.slot_end,
        "class_time": b.class_time,
        "member_count": len(b.student_ids),
        "meeting_active": row.get("meeting_active"),
        "meeting_url": b.meeting_url,
        "attendance_done": (b.date or "") in (row.get("attendance_submitted_dates") or []),
    }


def _series_row(series: BatchSeries | None, children: list[tuple[Batch, dict]], tmap: dict) -> dict:
    """Collapse a course's child sub-batches into one admin list row. Each child
    stays independent (own teacher/roster/meet); the row only aggregates for the
    course overview and carries real per-session `class_sessions`/`linked_batch_ids`."""
    children = sorted(children, key=lambda cr: (cr[0].date or "9999-99-99", cr[1].get("created_at") or ""))
    primary_batch, primary = children[0]
    sessions = [_session_of(b, row, tmap) for b, row in children]
    dates = sorted({b.date for b, _ in children if b.date})
    members_by_id: dict[str, dict] = {}
    pending_by_id: dict[str, dict] = {}
    attendance_dates: list[str] = []
    ratings: list[float] = []
    feedback_submitted = feedback_pending = 0
    for _b, row in children:
        for m in row.get("members") or []:
            members_by_id[m["student_id"]] = m
        for p in row.get("pending") or []:
            pending_by_id[p["student_id"]] = p
        attendance_dates.extend(row.get("attendance_submitted_dates") or [])
        feedback_submitted += row.get("feedback_submitted") or 0
        feedback_pending += row.get("feedback_pending") or 0
        if row.get("average_rating") is not None:
            ratings.append(row["average_rating"])
    return {
        **primary,
        "id": str(series.id) if series else primary["id"],
        "series_id": str(series.id) if series else None,
        "title": series.title if series else primary["title"],
        "schedule": series.schedule if series else primary.get("schedule"),
        "date": None,
        "class_dates": dates,
        "linked_batch_ids": [str(b.id) for b, _ in children],
        "class_sessions": sorted(sessions, key=lambda s: s["date"] or ""),
        "teacher_count": len({b.teacher_id for b, _ in children if b.teacher_id}),
        "members": list(members_by_id.values()),
        "pending": list(pending_by_id.values()),
        "meeting_active": any(row.get("meeting_active") for _b, row in children),
        "attendance_submitted_dates": sorted(set(attendance_dates)),
        "feedback_submitted": feedback_submitted,
        "feedback_pending": feedback_pending,
        "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
    }


@router.get("/admin/batches")
async def admin_list_batches(admin: CurrentUser = Depends(require_admin),
                             teacher_id: str | None = None):
    """Admin course list: one row per BatchSeries, aggregating its child
    sub-batches. When filtered by teacher, only courses that teacher runs at least
    one session of are returned."""
    query: dict = {"is_archived": False}
    if teacher_id:
        query["teacher_id"] = teacher_id
    batches = await Batch.find(query).sort(-Batch.created_at).to_list()
    tmap = {str(t.id): t for t in await Teacher.find().to_list()}
    batch_ids = [str(b.id) for b in batches]
    att_dates: dict[str, list[str]] = {}
    reviews_by_batch: dict[str, list[TeacherReview]] = {}
    if batch_ids:
        for att in await Attendance.find(
            {"batch_id": {"$in": batch_ids}, "status": {"$in": ["pending", "approved"]}}
        ).to_list():
            att_dates.setdefault(att.batch_id, []).append(att.date)
        for r in await TeacherReview.find({"batch_id": {"$in": batch_ids}}).to_list():
            if r.batch_id:
                reviews_by_batch.setdefault(r.batch_id, []).append(r)

    per_child: list[tuple[Batch, dict]] = []
    for b in batches:
        data = b.model_dump(mode="json")
        teacher = _teacher_lookup(tmap, b.teacher_id)
        data["teacher_name"] = teacher.name if teacher else None
        data["teacher_photo_url"] = teacher.photo_url if teacher else None
        data["members"] = await _resolve_names(b.student_ids)
        data["pending"] = await _resolve_names(b.pending_ids)
        data["meeting_active"] = _meeting_active(b)
        data["attendance_submitted_dates"] = sorted(set(att_dates.get(str(b.id), [])))
        revs = reviews_by_batch.get(str(b.id), [])
        submitted = [r for r in revs if r.status == "submitted"]
        ratings = [r.rating for r in submitted if r.rating]
        data["feedback_submitted"] = len(submitted)
        data["feedback_pending"] = sum(1 for r in revs if r.status == "pending")
        data["average_rating"] = round(sum(ratings) / len(ratings), 2) if ratings else None
        per_child.append((b, data))

    series_ids = {b.series_id for b, _ in per_child if b.series_id}
    smap: dict[str, BatchSeries] = {}
    for sid in series_ids:
        s = await BatchSeries.get(sid)
        if s and not s.is_archived:
            smap[sid] = s

    grouped: dict[str, list[tuple[Batch, dict]]] = {}
    loose: list[tuple[Batch, dict]] = []
    for b, data in per_child:
        if b.series_id and b.series_id in smap:
            grouped.setdefault(b.series_id, []).append((b, data))
        else:
            loose.append((b, data))  # defensive: pre-migration / orphaned batches

    out = [_series_row(smap[sid], children, tmap) for sid, children in grouped.items()]
    out += [_series_row(None, [child], tmap) for child in loose]
    out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return ok(out)


@router.get("/admin/batches/{batch_id}/profile")
async def admin_batch_profile(batch_id: str, admin: CurrentUser = Depends(require_admin)):
    """Consolidated batch view for admins: roster, schedule, meeting status,
    conducted classes (attendance), remuneration and student feedback."""
    b = await Batch.get(batch_id)
    if not b or b.is_archived:
        raise NotFoundError("Batch not found")

    teacher = await Teacher.get(b.teacher_id) if b.teacher_id else None
    all_ids = list(dict.fromkeys(b.student_ids + b.pending_ids))
    smap = await load_students_map(all_ids)

    def _student_row(sid: str) -> dict:
        s = smap.get(sid)
        return {
            "student_id": sid,
            "name": s.full_name if s else sid,
            "phone": s.phone if s else None,
            "whatsapp": s.whatsapp if s else None,
            "email": s.email if s else None,
            "age": s.age if s else None,
            "gender": s.gender if s else None,
            "photo_url": s.photo_url if s else None,
        }

    members = [_student_row(sid) for sid in b.student_ids]
    pending = [_student_row(sid) for sid in b.pending_ids]

    attendance = await Attendance.find(
        Attendance.batch_id == batch_id, Attendance.is_archived == False  # noqa: E712
    ).sort(-Attendance.date).to_list()
    rem_by_att = {
        r.attendance_id: r
        for r in await Remuneration.find(
            {"attendance_id": {"$in": [str(a.id) for a in attendance]}}
        ).to_list()
        if r.attendance_id
    }
    classes = []
    for a in attendance:
        r = rem_by_att.get(str(a.id))
        present = [_student_row(sid) for sid in a.present_ids]
        absent = [_student_row(sid) for sid in a.absent_ids]
        classes.append({
            "id": str(a.id), "date": a.date, "class_time": a.class_time,
            "present_count": len(a.present_ids), "absent_count": len(a.absent_ids),
            "present": present, "absent": absent,
            "status": a.status, "reviewed_by": a.reviewed_by,
            "remuneration_id": str(r.id) if r else None,
            "remuneration_paise": r.amount if r else 0,
            "remuneration_status": r.status if r else None,
        })

    reviews = await TeacherReview.find(TeacherReview.batch_id == batch_id).sort(
        -TeacherReview.class_date, -TeacherReview.created_at
    ).to_list()
    submitted = [r for r in reviews if r.status == "submitted"]
    ratings = [r.rating for r in submitted if r.rating]

    batch_data = b.model_dump(mode="json")
    batch_data["meeting_active"] = _meeting_active(b)
    batch_data["teacher_name"] = teacher.name if teacher else None
    batch_data["attendance_submitted_dates"] = sorted({a.date for a in attendance})

    return ok({
        "batch": batch_data,
        "teacher": teacher.model_dump(mode="json") if teacher else None,
        "members": members,
        "pending": pending,
        "classes": classes,
        "reviews": [
            {
                "id": str(r.id),
                "rating": r.rating, "feedback": r.feedback,
                "status": r.status, "class_date": r.class_date,
                "class_time": r.class_time,
                "student_id": r.student_id,
                "student_name": (s.full_name if (s := smap.get(r.student_id)) else r.student_id),
            }
            for r in reviews
        ],
        "stats": {
            "member_count": len(b.student_ids),
            "pending_count": len(b.pending_ids),
            "classes_total": len(attendance),
            "classes_conducted": sum(1 for a in attendance if a.status == "approved"),
            "classes_pending": sum(1 for a in attendance if a.status == "pending"),
            "feedback_submitted": len(submitted),
            "feedback_pending": sum(1 for r in reviews if r.status == "pending"),
            "feedback_skipped": sum(1 for r in reviews if r.status == "skipped"),
            "feedback_missed": sum(1 for r in reviews if r.status == "missed"),
            "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        },
    })


@router.get("/admin/batches/{batch_id}/feedback")
async def admin_batch_feedback(batch_id: str, admin: CurrentUser = Depends(require_admin)):
    batch = await Batch.get(batch_id)
    if not batch or batch.is_archived:
        raise NotFoundError("Batch not found")
    teacher = await Teacher.get(batch.teacher_id) if batch.teacher_id else None
    reviews = await TeacherReview.find(TeacherReview.batch_id == batch_id).sort(
        -TeacherReview.class_date, -TeacherReview.created_at
    ).to_list()
    smap = await load_students_map([r.student_id for r in reviews])
    sessions: dict[str, dict] = {}
    for r in reviews:
        key = r.attendance_id or f"{r.class_date or 'unknown'}"
        session = sessions.setdefault(key, {
            "attendance_id": r.attendance_id,
            "class_date": r.class_date,
            "class_time": r.class_time,
            "items": [],
        })
        if r.class_time and not session["class_time"]:
            session["class_time"] = r.class_time
        s = smap.get(r.student_id)
        session["items"].append({
            "id": str(r.id),
            "student_id": r.student_id,
            "student_name": s.full_name if s else r.student_id,
            "attended": r.attended,
            "rating": r.rating,
            "feedback": r.feedback,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    session_rows = []
    for session in sessions.values():
        submitted = [x for x in session["items"] if x["status"] == "submitted"]
        ratings = [x["rating"] for x in submitted if x["rating"]]
        session_rows.append({
            **session,
            "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
            "submitted_count": len(submitted),
            "pending_count": sum(1 for x in session["items"] if x["status"] == "pending"),
            "skipped_count": sum(1 for x in session["items"] if x["status"] == "skipped"),
            "missed_count": sum(1 for x in session["items"] if x["status"] == "missed"),
        })
    session_rows.sort(key=lambda s: s["class_date"] or "", reverse=True)
    all_submitted = [r for r in reviews if r.status == "submitted"]
    all_ratings = [r.rating for r in all_submitted if r.rating]
    return ok({
        "batch_id": batch_id,
        "batch_title": batch.title,
        "teacher_name": teacher.name if teacher else None,
        "average_rating": round(sum(all_ratings) / len(all_ratings), 2) if all_ratings else None,
        "submitted_count": len(all_submitted),
        "pending_count": sum(1 for r in reviews if r.status == "pending"),
        "skipped_count": sum(1 for r in reviews if r.status == "skipped"),
        "missed_count": sum(1 for r in reviews if r.status == "missed"),
        "sessions": session_rows,
    })


@router.get("/admin/batches/{batch_id}/activity")
async def batch_activity(batch_id: str, admin: CurrentUser = Depends(require_admin),
                         page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    """Full activity log for a single batch — every admin/teacher/student action
    (create, edits, roster changes, join requests, meeting link, attendance)."""
    batch = await Batch.get(batch_id)
    if not batch:
        raise NotFoundError("Batch not found")
    query = {"target_type": "batch", "target_id": batch_id}
    total = await ActivityLog.find(query).count()
    logs = (await ActivityLog.find(query).sort(-ActivityLog.created_at)
            .skip((page - 1) * page_size).limit(page_size).to_list())
    # Resolve student ids referenced in the log to readable names.
    ids: set[str] = set()
    for log in logs:
        ids.update(log.meta.get("student_ids") or [])
        if log.meta.get("student_id"):
            ids.add(log.meta["student_id"])
    smap = await load_students_map(list(ids)) if ids else {}
    names = {sid: (s.full_name or sid) for sid, s in smap.items()}
    return ok({
        "batch_title": batch.title,
        "student_names": names,
        "items": [log.model_dump(mode="json") for log in logs],
        "total": total, "page": page, "page_size": page_size,
    })


@router.get("/admin/attendance")
async def admin_list_attendance(admin: CurrentUser = Depends(require_admin),
                                status: str | None = "pending"):
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    items = await Attendance.find(query).sort(-Attendance.created_at).to_list()
    tnames = {str(t.id): t.name for t in await Teacher.find().to_list()}
    btitles = {str(b.id): b.title for b in await Batch.find().to_list()}
    rows = []
    att_ids = [str(a.id) for a in items]
    reviews_by_att: dict[str, list[TeacherReview]] = {}
    if att_ids:
        for r in await TeacherReview.find({"attendance_id": {"$in": att_ids}}).to_list():
            if r.attendance_id:
                reviews_by_att.setdefault(r.attendance_id, []).append(r)
    for a in items:
        data = a.model_dump(mode="json")
        data["teacher_name"] = tnames.get(a.teacher_id or "")
        data["batch_title"] = btitles.get(a.batch_id)
        data["present_count"] = len(a.present_ids)
        data["absent_count"] = len(a.absent_ids)
        revs = reviews_by_att.get(str(a.id), [])
        submitted = [r for r in revs if r.status == "submitted"]
        ratings = [r.rating for r in submitted if r.rating]
        data["feedback_submitted"] = len(submitted)
        data["feedback_pending"] = sum(1 for r in revs if r.status == "pending")
        data["average_rating"] = round(sum(ratings) / len(ratings), 2) if ratings else None
        rows.append(data)
    return ok(rows)


@router.get("/admin/attendance/{attendance_id}/feedback")
async def admin_attendance_feedback(attendance_id: str,
                                    admin: CurrentUser = Depends(require_admin)):
    att = await Attendance.get(attendance_id)
    if not att or att.is_archived:
        raise NotFoundError("Attendance not found")
    batch = await Batch.get(att.batch_id)
    teacher = await Teacher.get(att.teacher_id) if att.teacher_id else None
    reviews = await TeacherReview.find(TeacherReview.attendance_id == attendance_id).to_list()
    smap = await load_students_map([r.student_id for r in reviews])
    items = []
    for r in reviews:
        s = smap.get(r.student_id)
        items.append({
            "id": str(r.id),
            "student_id": r.student_id,
            "student_name": s.full_name if s else r.student_id,
            "attended": r.attended,
            "rating": r.rating,
            "feedback": r.feedback,
            "status": r.status,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    submitted = [x for x in items if x["status"] == "submitted"]
    ratings = [x["rating"] for x in submitted if x["rating"]]
    return ok({
        "attendance_id": attendance_id,
        "teacher_name": teacher.name if teacher else None,
        "batch_title": batch.title if batch else None,
        "date": att.date,
        "class_time": att.class_time,
        "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "submitted_count": len(submitted),
        "pending_count": sum(1 for x in items if x["status"] == "pending"),
        "skipped_count": sum(1 for x in items if x["status"] == "skipped"),
        "missed_count": sum(1 for x in items if x["status"] == "missed"),
        "items": items,
    })


@router.get("/admin/remuneration")
async def admin_list_remuneration(admin: CurrentUser = Depends(require_admin),
                                  status: str | None = None):
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    items = await Remuneration.find(query).sort(-Remuneration.created_at).to_list()
    names = {str(t.id): t.name for t in await Teacher.find().to_list()}
    rows = []
    for r in items:
        data = r.model_dump(mode="json")
        data["teacher_name"] = names.get(r.teacher_id)
        rows.append(data)
    return ok(rows)


# --------------------------------------------------------------------------
# Teacher-wise Class Report — every conducted class (attendance) with the
# students who attended, the batch as description, and its remuneration, so
# admins can pay teachers per batch conducted. Filter by teacher / date range.
# --------------------------------------------------------------------------
async def _class_report_rows(teacher_id: str | None, status: str | None,
                             date_from: str | None, date_to: str | None) -> list[dict]:
    query: dict = {"is_archived": False}
    if status and status != "all":
        query["status"] = status
    if teacher_id:
        query["teacher_id"] = teacher_id
    if date_from or date_to:  # Attendance.date is "YYYY-MM-DD" — ISO strings compare lexically.
        rng: dict = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        query["date"] = rng
    items = await Attendance.find(query).sort(+Attendance.teacher_id, -Attendance.date).to_list()
    tnames = {str(t.id): t.name for t in await Teacher.find().to_list()}
    tcodes = {str(t.id): t.teacher_id for t in await Teacher.find().to_list()}
    batches = await Batch.find(Batch.is_archived == False).to_list()  # noqa: E712
    btitles = {str(b.id): b.title for b in batches}
    rem = {
        r.attendance_id: r
        for r in await Remuneration.find({"attendance_id": {"$in": [str(a.id) for a in items]}}).to_list()
        if r.attendance_id
    }
    rows = []
    for a in items:
        if a.batch_id not in btitles:
            continue
        r = rem.get(str(a.id))
        rows.append({
            "id": str(a.id),
            "batch_id": a.batch_id,
            "teacher_id": a.teacher_id,
            "teacher_name": tnames.get(a.teacher_id or ""),
            "teacher_code": tcodes.get(a.teacher_id or ""),
            "batch_title": btitles.get(a.batch_id),  # course name = description
            "date": a.date,
            "class_time": a.class_time,
            "present_count": len(a.present_ids),
            "absent_count": len(a.absent_ids),
            "status": a.status,
            "remuneration_id": str(r.id) if r else None,
            "remuneration_paise": r.amount if r else 0,
            "remuneration_status": r.status if r else None,
        })
    return rows


@router.get("/admin/class-report")
async def admin_class_report(admin: CurrentUser = Depends(require_admin),
                             teacher_id: str | None = None, status: str | None = "approved",
                             date_from: str | None = None, date_to: str | None = None):
    """Teacher-wise report of conducted classes with attendance & remuneration.
    Defaults to approved classes (the payable ones). Includes per-teacher totals."""
    rows = await _class_report_rows(teacher_id, status, date_from, date_to)
    summary: dict[str, dict] = {}
    for row in rows:
        s = summary.setdefault(row["teacher_id"] or "", {
            "teacher_id": row["teacher_id"], "teacher_name": row["teacher_name"],
            "teacher_code": row["teacher_code"], "classes": 0,
            "students_attended": 0, "total_remuneration_paise": 0,
        })
        s["classes"] += 1
        s["students_attended"] += row["present_count"]
        s["total_remuneration_paise"] += row["remuneration_paise"]
    return ok({"rows": rows, "summary": list(summary.values())})


@router.get("/admin/class-report/export")
async def export_class_report(admin: CurrentUser = Depends(require_admin),
                              teacher_id: str | None = None, status: str | None = "approved",
                              date_from: str | None = None, date_to: str | None = None,
                              format: str = "csv"):
    from app.modules.analytics.router import _export_response
    rows = await _class_report_rows(teacher_id, status, date_from, date_to)
    out = ([r["teacher_code"] or "", r["teacher_name"] or "", r["batch_title"] or "",
            r["date"], r["class_time"] or "", r["present_count"], r["absent_count"],
            r["status"], r["remuneration_paise"], r["remuneration_status"] or ""]
           for r in rows)
    return _export_response("teacher_class_report",
                            ["teacher_id", "teacher_name", "batch", "date", "class_time",
                             "students_present", "students_absent", "attendance_status",
                             "remuneration_paise", "remuneration_status"], out, format)


# --------------------------------------------------------------------------
# Month-wise teacher payouts — how much each teacher must be paid for the
# classes taken in a month. Aggregates Remuneration (credited per class date,
# either on attendance approval or by the scheduler for completed batches).
# --------------------------------------------------------------------------
async def _payout_month_data(month: str | None) -> dict:
    """Per-teacher payout summary + the underlying class rows for one month."""
    all_items = await Remuneration.find(Remuneration.is_archived == False).to_list()  # noqa: E712
    months = sorted({r.period[:7] for r in all_items if r.period}, reverse=True)
    month = month or (months[0] if months else datetime.now(IST).strftime("%Y-%m"))
    items = [r for r in all_items if (r.period or "")[:7] == month]

    tmap = {str(t.id): t for t in await Teacher.find().to_list()}
    batches = await Batch.find(Batch.is_archived == False).to_list()  # noqa: E712
    btitles = {str(b.id): b.title for b in batches}
    # Scheduler-credited entries carry no attendance_id — recover the batch from
    # the teacher + class date instead.
    by_date = {(b.teacher_id, d): b.title
               for b in batches for d in (b.class_dates or ([b.date] if b.date else []))}
    att_map = {
        str(a.id): a
        for a in await Attendance.find(
            {"date": {"$gte": f"{month}-01", "$lte": f"{month}-31"}}).to_list()
    }

    rows: list[dict] = []
    summary: dict[str, dict] = {}
    for r in sorted(items, key=lambda x: (x.period or ""), reverse=True):
        t = tmap.get(r.teacher_id)
        a = att_map.get(r.attendance_id or "")
        rows.append({
            "id": str(r.id),
            "teacher_id": r.teacher_id,
            "teacher_name": t.name if t else None,
            "teacher_code": t.teacher_id if t else None,
            "date": r.period,
            "batch_title": (btitles.get(a.batch_id) if a else None)
                           or by_date.get((r.teacher_id, r.period or "")),
            "present_count": len(a.present_ids) if a else None,
            "amount": r.amount,
            "status": r.status,
        })
        s = summary.setdefault(r.teacher_id, {
            "teacher_id": r.teacher_id,
            "teacher_name": t.name if t else None,
            "teacher_code": t.teacher_id if t else None,
            "classes": 0, "total_paise": 0,
            "pending_paise": 0, "paid_paise": 0, "received_paise": 0,
        })
        s["classes"] += 1
        s["total_paise"] += r.amount
        s[f"{r.status}_paise"] = s.get(f"{r.status}_paise", 0) + r.amount

    teachers = sorted(summary.values(), key=lambda s: -s["total_paise"])
    return {
        "month": month,
        "months": months,
        "teachers": teachers,
        "rows": rows,
        "totals": {
            "classes": sum(s["classes"] for s in teachers),
            "teachers": len(teachers),
            "total_paise": sum(s["total_paise"] for s in teachers),
            "pending_paise": sum(s["pending_paise"] for s in teachers),
            "paid_paise": sum(s["paid_paise"] for s in teachers),
            "received_paise": sum(s["received_paise"] for s in teachers),
        },
    }


@router.get("/admin/monthly-payouts")
async def admin_monthly_payouts(admin: CurrentUser = Depends(require_admin),
                                month: str | None = None):
    """Month-wise teacher payout sheet: per teacher, the classes taken that
    month and the amount payable (pending / paid / confirmed). `month` is
    "YYYY-MM"; defaults to the latest month with credited remuneration."""
    return ok(await _payout_month_data(month))


@router.get("/admin/monthly-payouts/export")
async def export_monthly_payouts(admin: CurrentUser = Depends(require_admin),
                                 month: str | None = None, format: str = "csv"):
    from app.modules.analytics.router import _export_response
    data = await _payout_month_data(month)
    out = ([s["teacher_code"] or "", s["teacher_name"] or "", data["month"], s["classes"],
            s["total_paise"], s["pending_paise"], s["paid_paise"], s["received_paise"]]
           for s in data["teachers"])
    return _export_response(f"teacher_payouts_{data['month']}",
                            ["teacher_id", "teacher_name", "month", "classes",
                             "total_paise", "pending_paise", "paid_paise",
                             "received_paise"], out, format)


class PayoutMarkPaid(BaseModel):
    month: str
    teacher_id: str


@router.post("/admin/monthly-payouts/mark-paid")
async def mark_month_paid(body: PayoutMarkPaid, admin: CurrentUser = Depends(require_admin)):
    """Mark every pending class payment of one teacher for one month as paid."""
    items = [
        r for r in await Remuneration.find(
            Remuneration.teacher_id == body.teacher_id,
            Remuneration.status == "pending",
            Remuneration.is_archived == False,  # noqa: E712
        ).to_list()
        if (r.period or "")[:7] == body.month
    ]
    if not items:
        raise NotFoundError("No pending payments for this teacher in that month")
    total = 0
    for r in items:
        r.status = "paid"
        r.paid_by = admin.subject
        r.touch()
        await r.save()
        total += r.amount
    t = await Teacher.get(body.teacher_id)
    await notif.notify_all(
        [t.username if t else None, "admins"], "Payment Processed",
        f"A payment of ₹{total / 100:,.0f} for {len(items)} class(es) in "
        f"{body.month} has been processed. Please confirm receipt.", "payment")
    await log_activity(admin.subject, "remuneration.month_mark_paid", role=admin.role.value,
                       target_type="teacher", target_id=body.teacher_id,
                       meta={"month": body.month, "classes": len(items), "amount_paise": total})
    return ok({"marked": len(items), "amount_paise": total},
              f"{len(items)} class payment(s) marked paid")


class PayoutConfirmMonth(BaseModel):
    month: str


@router.post("/my-payouts/confirm-month")
async def confirm_month_received(body: PayoutConfirmMonth,
                                 user: CurrentUser = Depends(require_teacher)):
    """Teacher accepts every payout marked paid for them in one month."""
    t = await _own_teacher(user)
    items = [
        r for r in await Remuneration.find(
            Remuneration.teacher_id == str(t.id),
            Remuneration.status == "paid",
            Remuneration.is_archived == False,  # noqa: E712
        ).to_list()
        if (r.period or "")[:7] == body.month
    ]
    if not items:
        raise NotFoundError("No payments awaiting your confirmation in that month")
    total = 0
    for r in items:
        r.status = "received"
        r.received_confirmed_at = utcnow()
        r.touch()
        await r.save()
        total += r.amount
    await notif.notify_all(
        ["admins", t.username], "Payment Receipt Confirmed",
        f"{t.name} confirmed receipt of ₹{total / 100:,.0f} for {len(items)} "
        f"class(es) in {body.month}.", "payment")
    await log_activity(user.subject, "remuneration.month_confirm_received",
                       role=user.role.value, target_type="teacher", target_id=str(t.id),
                       meta={"month": body.month, "classes": len(items),
                             "amount_paise": total})
    return ok({"confirmed": len(items), "amount_paise": total},
              f"{len(items)} class payment(s) confirmed")


@router.get("/my-reviews")
async def my_reviews(user: CurrentUser = Depends(require_teacher)):
    """Average rating, number of reviews and student feedback."""
    t = await _own_teacher(user)
    reviews = await TeacherReview.find(
        TeacherReview.teacher_id == str(t.id), TeacherReview.status == "submitted"
    ).sort(-TeacherReview.class_date, -TeacherReview.created_at).to_list()
    ratings = [r.rating for r in reviews if r.rating]
    smap = await load_students_map([r.student_id for r in reviews])
    btitles = {str(b.id): b.title for b in await Batch.find().to_list()}
    return ok({
        "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
        "review_count": len(reviews),
        "feedback": [
            {
                "id": str(r.id),
                "rating": r.rating,
                "feedback": r.feedback,
                "class_date": r.class_date,
                "class_time": r.class_time,
                "student_id": r.student_id,
                "student_name": (s.full_name if (s := smap.get(r.student_id)) else r.student_id),
                "batch_title": btitles.get(r.batch_id or "") if r.batch_id else None,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in reviews
        ],
    })
