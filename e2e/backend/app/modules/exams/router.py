"""Exams & Certification (Module 11).

Admin builds the machinery in three steps — **examiner list** -> **slot list**
(day- and time-wise) -> **examiner assignment** — and each slot then carries
everything the learner is promised on the booking card: exam name, date, slot
length, examiner name and the examiner's WhatsApp number.

    slot published -> student books -> exam conducted
                                          |
                      examiner submits report / result
                                          |
        CEFR: report card PDF + community profile flips Verified
    Speaking: auto-generated certificate stored in the student dashboard

Both outcomes record Exam Date / Student ID / Examiner Name / Level-or-Grade /
Remarks, which is exactly the admin result view. Examiners only ever see —
and can only ever report on — bookings for slots assigned to them.
Public verification by report/certificate code needs no auth."""
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr

from app.core.envelope import ok
from app.core.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationAppError,
)
from app.core.rbac import (
    CurrentUser,
    get_current_user,
    require_admin,
    require_examiner,
    require_student,
)
from app.core.security import Role, hash_password
from app.db.base import utcnow
from app.db.models import (
    CEFRReport,
    CEFRStatus,
    Certificate,
    CommunityProfile,
    Exam,
    ExamBooking,
    ExamSlotRule,
    Student,
    Subscription,
    User,
)
from app.modules.auth import service as auth_service
from app.modules.exams import service as slots
from app.modules.notification import service as notif
from app.shared import pdf_service
from app.shared.audit import log_activity
from app.shared.students import load_students_map, student_avatar_fields

router = APIRouter(prefix="/exams", tags=["exams"])

# Complimentary entitlement included with every membership (Section 6).
BASE_ELIGIBILITY = {"CEFR": 1, "Speaking": 1}
EXAM_KINDS = ("CEFR", "Speaking")
CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
# The four CEFR sub-skills an examiner scores on the report card.
CEFR_SKILLS = ("listening", "reading", "speaking", "writing")
DEFAULT_SLOT_MINUTES = 20  # spec: "Exam slot (20 minutes - as allotted from admin)"


def _check_kind(kind: str) -> str:
    if kind not in EXAM_KINDS:
        raise ValidationAppError("kind must be 'CEFR' or 'Speaking'")
    return kind


def _naive(dt: datetime | None) -> datetime | None:
    """Mongo hands datetimes back naive-UTC; compare like with like."""
    return slots.to_naive_utc(dt)


def _iso(dt: datetime | None) -> str | None:
    """A slot time on the wire is always an explicit UTC instant — a naive
    string would be read as browser-local and land 5.5 hours out."""
    dt = slots.to_utc(dt)
    return dt.isoformat() if dt else None


def _when(dt: datetime | None) -> str:
    """" on 13 Sep 2026, 11:00 AM" in IST — the clock the learner reads."""
    ist = slots.to_ist(dt)
    return f" on {ist:%d %b %Y, %I:%M %p}" if ist else ""


def _exam_json(exam: Exam) -> dict:
    data = exam.model_dump(mode="json")
    data["scheduled_at"] = _iso(exam.scheduled_at)
    return data


# --------------------------------------------------------------------------
# Examiner directory — the list admin assigns from, and the contact details
# published to students on every slot the examiner is assigned to.
# --------------------------------------------------------------------------
async def _examiner_map(usernames=None) -> dict[str, User]:
    """{username: User} for the given examiners — every examiner when None."""
    query: dict = {"role": Role.examiner.value}
    if usernames is not None:
        unique = sorted({u for u in usernames if u})
        if not unique:
            return {}
        query["username"] = {"$in": unique}
    return {u.username: u for u in await User.find(query).to_list()}


def _examiner_fields(examiner: User | None) -> dict:
    """Examiner identity as the student and admin see it — name + WhatsApp are
    filled in automatically from the assignment, never typed by the learner."""
    return {
        "examiner_name": examiner.full_name or examiner.username if examiner else None,
        "examiner_whatsapp": examiner.whatsapp if examiner else None,
        "examiner_phone": examiner.phone if examiner else None,
    }


# --------------------------------------------------------------------------
# Slot serialisation
# --------------------------------------------------------------------------
async def _seats_taken(exam_ids: list[str]) -> dict[str, int]:
    """Live booking count per slot, so a 20-minute 1:1 slot can only go once."""
    if not exam_ids:
        return {}
    rows = await ExamBooking.find({
        "exam_id": {"$in": exam_ids}, "status": {"$ne": "cancelled"},
    }).to_list()
    counts: dict[str, int] = {}
    for b in rows:
        counts[b.exam_id] = counts.get(b.exam_id, 0) + 1
    return counts


def _slot_row(exam: Exam, examiners: dict[str, User], taken: int) -> dict:
    """One bookable slot exactly as the spec lists it."""
    data = _exam_json(exam)
    data.update(_examiner_fields(examiners.get(exam.examiner_id or "")))
    data["seats_taken"] = taken
    data["seats_left"] = max(0, exam.capacity - taken)
    data["ends_at"] = _iso(
        exam.scheduled_at + timedelta(minutes=exam.duration_minutes)
        if exam.scheduled_at else None
    )
    return data


def _sort_slots(exams: list[Exam]) -> list[Exam]:
    """Scheduled slots first, soonest first; undated exams last by title."""
    dated = sorted((e for e in exams if e.scheduled_at), key=lambda e: _naive(e.scheduled_at))
    undated = sorted((e for e in exams if not e.scheduled_at), key=lambda e: e.title)
    return dated + undated


async def _slot_rows(exams: list[Exam]) -> list[dict]:
    exams = _sort_slots(exams)
    examiners = await _examiner_map(e.examiner_id for e in exams)
    taken = await _seats_taken([str(e.id) for e in exams])
    return [_slot_row(e, examiners, taken.get(str(e.id), 0)) for e in exams]


async def _eligibility(student_id: str) -> dict:
    """Return {kind: {allowed, used, remaining}} for the student."""
    allowed = dict(BASE_ELIGIBILITY)
    sub = await Subscription.find_one(
        Subscription.student_id == student_id, Subscription.is_active == True  # noqa: E712
    )
    if sub:
        allowed["CEFR"] = max(allowed["CEFR"], sub.cefr_tests)
        allowed["Speaking"] = max(allowed["Speaking"], sub.speaking_tests)

    result = {}
    for kind, limit in allowed.items():
        exams = await Exam.find(Exam.kind == kind).to_list()
        exam_ids = [str(e.id) for e in exams]
        used = await ExamBooking.find({
            "student_id": student_id,
            "exam_id": {"$in": exam_ids},
            "status": {"$ne": "cancelled"},
        }).count()
        result[kind] = {"allowed": limit, "used": used, "remaining": max(0, limit - used)}
    return result


# ==========================================================================
# Admin — 1. Examiner list
# ==========================================================================
class ExaminerBody(BaseModel):
    username: str
    password: str
    full_name: str
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None


@router.get("/admin/examiners")
async def list_examiners(admin: CurrentUser = Depends(require_admin),
                         include_inactive: bool = True):
    """The examiner list admin assigns slots from, each with its workload."""
    query: dict = {"role": Role.examiner.value}
    if not include_inactive:
        query["is_active"] = True
    examiners = await User.find(query).to_list()
    slots = await Exam.find(Exam.is_archived == False).to_list()  # noqa: E712
    taken = await _seats_taken([str(e.id) for e in slots])
    now = utcnow().replace(tzinfo=None)

    rows = []
    for u in examiners:
        mine = [e for e in slots if e.examiner_id == u.username]
        upcoming = [e for e in mine if e.scheduled_at and _naive(e.scheduled_at) >= now]
        rows.append({
            "id": str(u.id), "username": u.username, "full_name": u.full_name,
            "email": u.email, "phone": u.phone, "whatsapp": u.whatsapp,
            "is_active": u.is_active, "created_at": u.created_at.isoformat(),
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "assigned_slots": len(mine),
            "upcoming_slots": len(upcoming),
            "students_booked": sum(taken.get(str(e.id), 0) for e in mine),
            "reports_submitted": (
                await CEFRReport.find(CEFRReport.examiner_id == u.username).count()
                + await Certificate.find(Certificate.examiner_id == u.username).count()
            ),
        })
    rows.sort(key=lambda r: (r["full_name"] or r["username"]).lower())
    return ok(rows)


@router.post("/admin/examiners")
async def create_examiner(body: ExaminerBody, admin: CurrentUser = Depends(require_admin)):
    """Add an authorised examiner (login + published contact details)."""
    if await User.find_one(User.username == body.username):
        raise ConflictError("That username is already taken")
    if len(body.password) < 8:
        raise ValidationAppError("Password must be at least 8 characters")
    user = await auth_service.create_user(
        body.username, body.password, Role.examiner,
        full_name=body.full_name, email=body.email,
        phone=body.phone, whatsapp=body.whatsapp,
    )
    await log_activity(admin.subject, "examiner.create", role=admin.role.value,
                       target_type="user", target_id=body.username)
    return ok({"id": str(user.id), "username": user.username}, "Examiner added")


class ExaminerPatch(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None
    is_active: bool | None = None
    password: str | None = None


@router.patch("/admin/examiners/{username}")
async def update_examiner(username: str, body: ExaminerPatch,
                          admin: CurrentUser = Depends(require_admin)):
    user = await User.find_one(User.username == username, User.role == Role.examiner)
    if not user:
        raise NotFoundError("Examiner not found")
    data = body.model_dump(exclude_unset=True)
    password = data.pop("password", None)
    for k, v in data.items():
        setattr(user, k, v)
    if password:
        if len(password) < 8:
            raise ValidationAppError("Password must be at least 8 characters")
        user.password_hash = hash_password(password)
    user.touch()
    await user.save()
    await log_activity(admin.subject, "examiner.update", role=admin.role.value,
                       target_type="user", target_id=username,
                       meta={"fields": sorted(data.keys())})
    return ok({"username": user.username, "full_name": user.full_name,
               "whatsapp": user.whatsapp, "is_active": user.is_active})


# ==========================================================================
# Admin — 2. Weekly exam slots (day of week + time, repeating)
# ==========================================================================
# A slot is set as a weekday and a start time — "Sunday – 11:00 AM" — and it
# repeats every week on that day and time until admin edits or removes it.
# ``exams/service.py`` materialises the rule into ordinary bookable Exam rows
# over a rolling horizon, so nothing downstream has to know about recurrence.
class SlotRuleBody(BaseModel):
    kind: str = "CEFR"  # CEFR | Speaking
    title: str
    day_of_week: str  # weekday name, e.g. "Sunday"
    time_of_day: str  # "HH:MM" 24h, IST
    duration_minutes: int = DEFAULT_SLOT_MINUTES
    capacity: int = 1
    examiner_id: str | None = None


class SlotRulePatch(BaseModel):
    kind: str | None = None
    title: str | None = None
    day_of_week: str | None = None
    time_of_day: str | None = None
    duration_minutes: int | None = None
    capacity: int | None = None
    examiner_id: str | None = None


async def _check_examiner(username: str | None) -> User | None:
    if not username:
        return None
    examiner = await User.find_one(User.username == username, User.role == Role.examiner)
    if not examiner:
        raise NotFoundError("Examiner not found")
    if not examiner.is_active:
        raise ValidationAppError("That examiner account is deactivated")
    return examiner


def _check_shape(duration_minutes: int | None, capacity: int | None) -> None:
    if duration_minutes is not None and duration_minutes < 1:
        raise ValidationAppError("Slot length must be at least 1 minute")
    if capacity is not None and capacity < 1:
        raise ValidationAppError("Capacity must be at least 1")


def _rule_row(rule: ExamSlotRule, examiners: dict[str, User],
              generated: dict[str, list[Exam]]) -> dict:
    """A weekly slot as admin manages it, with the upcoming dates it produces."""
    data = rule.model_dump(mode="json")
    data.update(_examiner_fields(examiners.get(rule.examiner_id or "")))
    now = utcnow().replace(tzinfo=None)
    upcoming = sorted(
        (e for e in generated.get(str(rule.id), [])
         if _naive(e.scheduled_at) and _naive(e.scheduled_at) >= now),
        key=lambda e: _naive(e.scheduled_at),
    )
    data["label"] = slots.label(rule.day_of_week, rule.time_of_day)
    data["upcoming_slots"] = len(upcoming)
    data["next_slot"] = _iso(upcoming[0].scheduled_at) if upcoming else None
    return data


@router.get("/admin/slot-rules")
async def list_slot_rules(admin: CurrentUser = Depends(require_admin),
                          kind: str | None = None):
    """The weekly slot list — one row per recurring day and time."""
    query: dict = {"is_archived": False}
    if kind:
        query["kind"] = _check_kind(kind)
    rules = await ExamSlotRule.find(query).to_list()
    rules.sort(key=lambda r: (slots.WEEKDAYS.index(r.day_of_week), r.time_of_day, r.kind))
    examiners = await _examiner_map(r.examiner_id for r in rules)
    generated: dict[str, list[Exam]] = {}
    for exam in await Exam.find({"rule_id": {"$in": [str(r.id) for r in rules]},
                                 "is_archived": False}).to_list():
        generated.setdefault(exam.rule_id, []).append(exam)
    return ok([_rule_row(r, examiners, generated) for r in rules])


@router.post("/admin/slot-rules")
async def create_slot_rule(body: SlotRuleBody, admin: CurrentUser = Depends(require_admin)):
    """Add a weekly slot. It starts producing bookable dates immediately and
    keeps repeating on that day and time until it is changed or removed."""
    _check_kind(body.kind)
    _check_shape(body.duration_minutes, body.capacity)
    if not body.title.strip():
        raise ValidationAppError("Exam name is required")
    day = slots.parse_day(body.day_of_week)
    time_of_day = slots.parse_time(body.time_of_day)
    examiner = await _check_examiner(body.examiner_id)
    if await ExamSlotRule.find_one({"kind": body.kind, "day_of_week": day,
                                    "time_of_day": time_of_day, "is_archived": False}):
        raise ConflictError(f"A {body.kind} slot already runs on {slots.label(day, time_of_day)}")

    rule = ExamSlotRule(**{**body.model_dump(), "title": body.title.strip(),
                           "day_of_week": day, "time_of_day": time_of_day})
    await rule.insert()
    created = await slots.generate(rule)
    if examiner:
        await notif.notify(examiner.username, "Weekly Exam Slot Assigned",
                           f"You have been assigned the weekly {rule.kind} slot "
                           f"'{rule.title}' — {slots.label(day, time_of_day)}.",
                           kind="exam", push_url="/examiner")
    await log_activity(admin.subject, "exam.slot_rule_create", role=admin.role.value,
                       target_type="exam_slot_rule", target_id=str(rule.id),
                       meta={"kind": rule.kind, "slot": slots.label(day, time_of_day)})
    return ok({**rule.model_dump(mode="json"), "created_slots": created},
              f"Weekly slot added — {slots.label(day, time_of_day)}, "
              f"{created} date(s) open for booking")


@router.patch("/admin/slot-rules/{rule_id}")
async def update_slot_rule(rule_id: str, body: SlotRulePatch,
                           admin: CurrentUser = Depends(require_admin)):
    """Change a weekly slot and re-cut the dates it has already produced.

    Only *unbooked* future dates are rebuilt — a slot a student already holds a
    seat on stays exactly where it is, and can be moved or cancelled on its own
    from the slot list."""
    rule = await ExamSlotRule.get(rule_id)
    if not rule or rule.is_archived:
        raise NotFoundError("Weekly slot not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("kind"):
        _check_kind(data["kind"])
    _check_shape(data.get("duration_minutes"), data.get("capacity"))
    if data.get("title") is not None:
        data["title"] = data["title"].strip()
        if not data["title"]:
            raise ValidationAppError("Exam name is required")
    if data.get("day_of_week"):
        data["day_of_week"] = slots.parse_day(data["day_of_week"])
    if data.get("time_of_day"):
        data["time_of_day"] = slots.parse_time(data["time_of_day"])
    if "examiner_id" in data:
        await _check_examiner(data["examiner_id"])

    kind = data.get("kind", rule.kind)
    day = data.get("day_of_week", rule.day_of_week)
    time_of_day = data.get("time_of_day", rule.time_of_day)
    clash = await ExamSlotRule.find_one({"kind": kind, "day_of_week": day,
                                         "time_of_day": time_of_day, "is_archived": False})
    if clash and str(clash.id) != rule_id:
        raise ConflictError(f"A {kind} slot already runs on {slots.label(day, time_of_day)}")

    for k, v in data.items():
        setattr(rule, k, v)
    rule.touch()
    await rule.save()
    created, dropped, kept = await slots.rebuild(rule)
    await log_activity(admin.subject, "exam.slot_rule_update", role=admin.role.value,
                       target_type="exam_slot_rule", target_id=rule_id,
                       meta={"fields": sorted(data.keys()), "rebuilt": created, "kept": kept})
    return ok({**rule.model_dump(mode="json"), "created_slots": created,
               "removed_slots": dropped, "booked_slots_kept": kept},
              f"Weekly slot updated — {created} upcoming date(s) rebuilt"
              + (f", {kept} already booked left unchanged" if kept else ""))


@router.delete("/admin/slot-rules/{rule_id}")
async def delete_slot_rule(rule_id: str, reason: str | None = None,
                           admin: CurrentUser = Depends(require_admin)):
    """Stop a weekly slot repeating and withdraw the dates nobody booked."""
    rule = await ExamSlotRule.get(rule_id)
    if not rule or rule.is_archived:
        raise NotFoundError("Weekly slot not found")
    dropped, kept = await slots.drop_future(rule, admin.subject, reason or "Weekly slot removed")
    rule.archive(admin.subject, reason)
    await rule.save()
    await log_activity(admin.subject, "exam.slot_rule_delete", role=admin.role.value,
                       target_type="exam_slot_rule", target_id=rule_id,
                       meta={"removed": dropped, "kept": kept})
    return ok({"id": rule_id, "removed_slots": dropped, "booked_slots_kept": kept},
              f"Weekly slot removed — {dropped} upcoming date(s) withdrawn"
              + (f", {kept} already booked left standing" if kept else ""))


# ==========================================================================
# Admin — 2b. One-off dated slots
# ==========================================================================
# The generated occurrences above are ordinary Exam rows, so a single extra
# sitting outside the weekly rhythm is still just a dated slot.
class ExamBody(BaseModel):
    kind: str = "CEFR"  # CEFR | Speaking
    title: str
    scheduled_at: datetime | None = None  # the bookable date/time slot
    duration_minutes: int = DEFAULT_SLOT_MINUTES
    capacity: int = 1
    examiner_id: str | None = None


@router.post("/")
async def create_exam(body: ExamBody, admin: CurrentUser = Depends(require_admin)):
    _check_kind(body.kind)
    exam = Exam(**body.model_dump())
    await exam.insert()
    await log_activity(admin.subject, "exam.slot_create", role=admin.role.value,
                       target_type="exam", target_id=str(exam.id),
                       meta={"kind": exam.kind, "scheduled_at": str(exam.scheduled_at)})
    return ok(_exam_json(exam))


class BulkSlotBody(BaseModel):
    """A day x time grid — the slot list as admin actually plans it."""
    kind: str = "CEFR"
    title: str
    dates: list[str]  # ["2026-09-12", ...]
    times: list[str]  # ["10:00", "10:20", ...]
    duration_minutes: int = DEFAULT_SLOT_MINUTES
    capacity: int = 1
    examiner_id: str | None = None


@router.post("/slots/bulk")
async def create_slots_bulk(body: BulkSlotBody, admin: CurrentUser = Depends(require_admin)):
    """Create one slot per (date x time) pair, skipping ones already there."""
    _check_kind(body.kind)
    if not body.dates or not body.times:
        raise ValidationAppError("Pick at least one date and one time")
    if body.duration_minutes < 1:
        raise ValidationAppError("Slot length must be at least 1 minute")
    if body.capacity < 1:
        raise ValidationAppError("Capacity must be at least 1")

    existing = {
        (e.kind, _naive(e.scheduled_at))
        for e in await Exam.find(Exam.is_archived == False).to_list()  # noqa: E712
        if e.scheduled_at
    }
    created, skipped = [], 0
    for date_str in body.dates:
        for time_str in body.times:
            try:
                when = datetime.fromisoformat(f"{date_str}T{time_str}").replace(tzinfo=slots.IST)
            except ValueError:
                raise ValidationAppError(f"Invalid slot date/time: {date_str} {time_str}")
            if (body.kind, _naive(when)) in existing:
                skipped += 1
                continue
            existing.add((body.kind, _naive(when)))
            exam = Exam(
                kind=body.kind, title=body.title, scheduled_at=when,
                duration_minutes=body.duration_minutes, capacity=body.capacity,
                examiner_id=body.examiner_id,
            )
            await exam.insert()
            created.append(exam)

    await log_activity(admin.subject, "exam.slots_bulk", role=admin.role.value,
                       meta={"created": len(created), "skipped": skipped, "kind": body.kind})
    return ok({"created": len(created), "skipped": skipped,
               "slots": [_exam_json(e) for e in created]},
              f"{len(created)} slot(s) created"
              + (f", {skipped} already existed" if skipped else ""))


@router.get("/")
async def list_exams(user: CurrentUser = Depends(get_current_user),
                     upcoming: bool = False, kind: str | None = None,
                     examiner_id: str | None = None, bookable: bool = False):
    """Exam slots with their examiner + seat counts resolved.

    ``upcoming=true`` (student slot picker) drops slots whose date/time has
    passed; ``bookable=true`` additionally drops slots with no seat left.

    Signed-in only, and not because slots are secret: each row carries the
    assigned examiner's name and WhatsApp number, which are published to the
    learners booking them — not to anonymous visitors."""
    query: dict = {"is_archived": False}
    if kind:
        query["kind"] = _check_kind(kind)
    if examiner_id:
        query["examiner_id"] = examiner_id
    exams = await Exam.find(query).to_list()
    if upcoming:
        now = utcnow().replace(tzinfo=None)
        exams = [e for e in exams if not e.scheduled_at or _naive(e.scheduled_at) >= now]
    rows = await _slot_rows(exams)
    if bookable:
        rows = [r for r in rows if r["seats_left"] > 0]
    return ok(rows)


class ExamPatch(BaseModel):
    title: str | None = None
    kind: str | None = None
    scheduled_at: datetime | None = None
    duration_minutes: int | None = None
    capacity: int | None = None
    examiner_id: str | None = None


@router.patch("/{exam_id}")
async def update_exam(exam_id: str, body: ExamPatch,
                      admin: CurrentUser = Depends(require_admin)):
    exam = await Exam.get(exam_id)
    if not exam:
        raise NotFoundError("Exam not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("kind"):
        _check_kind(data["kind"])
    if "capacity" in data and data["capacity"] is not None:
        taken = (await _seats_taken([exam_id])).get(exam_id, 0)
        if data["capacity"] < taken:
            raise ConflictError(f"{taken} student(s) already booked this slot")
    for k, v in data.items():
        setattr(exam, k, v)
    exam.touch()
    await exam.save()
    await _notify_slot_change(exam, "updated")
    await log_activity(admin.subject, "exam.slot_update", role=admin.role.value,
                       target_type="exam", target_id=exam_id,
                       meta={"fields": sorted(data.keys())})
    return ok(_exam_json(exam))


@router.delete("/{exam_id}")
async def delete_exam(exam_id: str, reason: str | None = None,
                      admin: CurrentUser = Depends(require_admin)):
    """Archive a slot. Refused while students hold a seat on it."""
    exam = await Exam.get(exam_id)
    if not exam:
        raise NotFoundError("Exam not found")
    if (await _seats_taken([exam_id])).get(exam_id, 0):
        raise ConflictError("Students have booked this slot — cancel their bookings first")
    exam.archive(admin.subject, reason)
    await exam.save()
    await log_activity(admin.subject, "exam.slot_delete", role=admin.role.value,
                       target_type="exam", target_id=exam_id)
    return ok({"id": exam_id}, "Exam slot archived")


# ==========================================================================
# Admin — 3. Examiner assignment (per exam slot)
# ==========================================================================
async def _notify_slot_change(exam: Exam, what: str) -> None:
    """Tell everyone holding a seat when their slot's details move."""
    seats = await ExamBooking.find({
        "exam_id": str(exam.id), "status": {"$ne": "cancelled"},
    }).to_list()
    if not seats:
        return
    when = _when(exam.scheduled_at)
    await notif.notify_all(
        [b.student_id for b in seats], f"Exam Slot {what.title()}",
        f"Your {exam.kind} test '{exam.title}'{when} has been {what}. "
        "Open Exams & Certification for the latest details.",
        kind="exam", push_url="/dashboard/exams",
    )


class AssignBody(BaseModel):
    examiner_id: str | None = None  # null clears the assignment
    scheduled_at: datetime | None = None


@router.post("/{exam_id}/assign")
async def assign_examiner(exam_id: str, body: AssignBody,
                          admin: CurrentUser = Depends(require_admin)):
    """Assign an examiner (and optionally re-schedule) an exam slot.

    The examiner's name and WhatsApp number are published to every student
    holding that slot as soon as this lands — they are never entered by hand."""
    exam = await Exam.get(exam_id)
    if not exam:
        raise NotFoundError("Exam not found")
    await _check_examiner(body.examiner_id)
    exam.examiner_id = body.examiner_id
    if body.scheduled_at:
        exam.scheduled_at = body.scheduled_at
    exam.touch()
    await exam.save()

    if body.examiner_id:
        when = _when(exam.scheduled_at)
        await notif.notify(body.examiner_id, "Exam Slot Assigned",
                           f"You have been assigned the {exam.kind} test "
                           f"'{exam.title}'{when}.", kind="exam", push_url="/examiner")
        await _notify_slot_change(exam, "updated")
    await log_activity(admin.subject, "exam.assign", role=admin.role.value,
                       target_type="exam", target_id=exam_id,
                       meta={"examiner_id": body.examiner_id})
    return ok(_exam_json(exam))


# ==========================================================================
# Admin — bookings & published results
# ==========================================================================
@router.get("/admin/bookings")
async def admin_bookings(admin: CurrentUser = Depends(require_admin),
                         status: str | None = None, kind: str | None = None,
                         examiner_id: str | None = None,
                         page: int = Query(1, ge=1),
                         page_size: int = Query(50, ge=1, le=200)):
    """All exam bookings with slot + examiner + student context."""
    exams = {str(e.id): e for e in await Exam.find().to_list()}
    query: dict = {}
    if kind or examiner_id:
        exam_ids = [eid for eid, e in exams.items()
                    if (not kind or e.kind == kind)
                    and (not examiner_id or e.examiner_id == examiner_id)]
        query["exam_id"] = {"$in": exam_ids}
    if status:
        query["status"] = status
    total = await ExamBooking.find(query).count()
    items = (await ExamBooking.find(query).sort(-ExamBooking.created_at)
             .skip((page - 1) * page_size).limit(page_size).to_list())
    students = await load_students_map(b.student_id for b in items)
    examiners = await _examiner_map(e.examiner_id for e in exams.values())
    rows = []
    for b in items:
        exam = exams.get(b.exam_id)
        data = b.model_dump(mode="json")
        data["exam_title"] = exam.title if exam else None
        data["kind"] = exam.kind if exam else None
        data["scheduled_at"] = _iso(exam.scheduled_at) if exam else None
        data["duration_minutes"] = exam.duration_minutes if exam else None
        data["examiner_id"] = exam.examiner_id if exam else None
        data.update(_examiner_fields(examiners.get(exam.examiner_id or "") if exam else None))
        data.update(student_avatar_fields(students.get(b.student_id), "student"))
        rows.append(data)
    return ok({"items": rows, "total": total, "page": page, "page_size": page_size})


@router.get("/admin/results")
async def admin_results(admin: CurrentUser = Depends(require_admin),
                        q: str | None = None, limit: int = Query(200, ge=1, le=1000)):
    """Published results.

    CEFR rows carry Exam Date / Student ID / Examiner Name / CEFR Level /
    Remarks; Speaking rows carry Exam Date / Student ID / Examiner Name /
    Grade — the two admin views the spec asks for."""
    reports = await CEFRReport.find().sort(-CEFRReport.created_at).limit(limit).to_list()
    certs = await Certificate.find().sort(-Certificate.created_at).limit(limit).to_list()
    smap = await load_students_map([r.student_id for r in reports] + [c.student_id for c in certs])

    def _row(doc):
        row = doc.model_dump(mode="json")
        row.update(student_avatar_fields(smap.get(doc.student_id), "student"))
        return row

    cefr_rows = [_row(r) for r in reports]
    cert_rows = [_row(c) for c in certs]
    if q:
        needle = q.lower()

        def _match(row: dict) -> bool:
            return any(needle in str(row.get(f) or "").lower() for f in
                       ("student_id", "student_name", "examiner_name", "verification_code",
                        "level", "grade", "exam_title"))

        cefr_rows = [r for r in cefr_rows if _match(r)]
        cert_rows = [c for c in cert_rows if _match(c)]
    return ok({"cefr_reports": cefr_rows, "certificates": cert_rows})


# ==========================================================================
# Student — slot booking & results
# ==========================================================================
@router.get("/eligibility")
async def eligibility(user: CurrentUser = Depends(require_student)):
    """Remaining test eligibility per exam type (Module 10)."""
    return ok(await _eligibility(user.subject))


@router.get("/my-bookings")
async def my_bookings(user: CurrentUser = Depends(require_student)):
    """Booked slots with the full slot card — exam name, date, slot length,
    examiner name and WhatsApp — plus the result once it is published."""
    items = await ExamBooking.find(ExamBooking.student_id == user.subject).sort(
        -ExamBooking.created_at
    ).to_list()
    exams = {str(e.id): e for e in await Exam.find().to_list()}
    examiners = await _examiner_map(e.examiner_id for e in exams.values())
    booking_ids = [str(b.id) for b in items]
    reports = {r.exam_booking_id: r for r in
               await CEFRReport.find({"exam_booking_id": {"$in": booking_ids}}).to_list()}
    certs = {c.exam_booking_id: c for c in
             await Certificate.find({"exam_booking_id": {"$in": booking_ids}}).to_list()}
    out = []
    for b in items:
        exam = exams.get(b.exam_id)
        report = reports.get(str(b.id))
        cert = certs.get(str(b.id))
        out.append({
            **b.model_dump(mode="json"),
            "exam_title": exam.title if exam else None,
            "kind": exam.kind if exam else None,
            "scheduled_at": _iso(exam.scheduled_at) if exam else None,
            "duration_minutes": exam.duration_minutes if exam else None,
            **_examiner_fields(examiners.get(exam.examiner_id or "") if exam else None),
            "result": ({"type": "cefr_report", "level": report.level,
                        "remarks": report.remarks, "scores": report.scores,
                        "url": report.report_url,
                        "verification_code": report.verification_code}
                       if report else
                       {"type": "certificate", "grade": cert.grade, "remarks": cert.remarks,
                        "url": cert.certificate_url, "title": cert.title,
                        "verification_code": cert.verification_code}
                       if cert else None),
        })
    return ok(out)


@router.get("/my-certificates")
async def my_certificates(user: CurrentUser = Depends(require_student)):
    certs = await Certificate.find(Certificate.student_id == user.subject).to_list()
    return ok([c.model_dump(mode="json") for c in certs])


@router.get("/my-reports")
async def my_reports(user: CurrentUser = Depends(require_student)):
    reports = await CEFRReport.find(CEFRReport.student_id == user.subject).to_list()
    return ok([r.model_dump(mode="json") for r in reports])


@router.post("/{exam_id}/book")
async def book(exam_id: str, user: CurrentUser = Depends(require_student)):
    exam = await Exam.get(exam_id)
    if not exam or exam.is_archived:
        raise NotFoundError("Exam not found")
    if exam.scheduled_at and _naive(exam.scheduled_at) < utcnow().replace(tzinfo=None):
        raise ConflictError("That slot has already passed. Please pick an upcoming slot.")
    existing = await ExamBooking.find_one({
        "student_id": user.subject, "exam_id": exam_id, "status": {"$ne": "cancelled"},
    })
    if existing:
        raise ConflictError("You have already booked this slot.")
    if (await _seats_taken([exam_id])).get(exam_id, 0) >= exam.capacity:
        raise ConflictError("That slot is now full. Please pick another one.")
    quota = (await _eligibility(user.subject)).get(exam.kind, {"remaining": 0})
    if quota["remaining"] <= 0:
        raise ConflictError(
            f"No remaining {exam.kind} test eligibility. "
            "Upgrade your subscription plan for additional tests."
        )
    booking = ExamBooking(exam_id=exam_id, student_id=user.subject)
    await booking.insert()

    examiners = await _examiner_map([exam.examiner_id])
    examiner = examiners.get(exam.examiner_id or "")
    when = _when(exam.scheduled_at)
    who = f" Examiner: {examiner.full_name or examiner.username}." if examiner else ""
    await notif.notify(user.subject, "Exam Booking Confirmed",
                       f"Your {exam.kind} test '{exam.title}'{when} "
                       f"({exam.duration_minutes} min) has been booked.{who}",
                       kind="exam", push_url="/dashboard/exams")
    if exam.examiner_id:
        student = await Student.find_one(Student.student_id == user.subject)
        await notif.notify(exam.examiner_id, "New Exam Booking",
                           f"{student.full_name if student else user.subject} "
                           f"({user.subject}) booked your {exam.kind} slot{when}.",
                           kind="exam", push_url="/examiner")
    return ok(booking.model_dump(mode="json"), "Exam booked")


# ==========================================================================
# Examiner dashboard
# ==========================================================================
async def _my_slots(examiner_id: str) -> dict[str, Exam]:
    return {str(e.id): e for e in await Exam.find(Exam.examiner_id == examiner_id).to_list()}


async def _assigned_bookings(examiner: CurrentUser, status: str | None = None,
                             q: str | None = None) -> tuple[list[dict], dict[str, Exam]]:
    """Bookings on slots assigned to *this* examiner, student details resolved."""
    slots = await _my_slots(examiner.subject)
    if not slots:
        return [], slots
    query: dict = {"exam_id": {"$in": list(slots)}}
    if status:
        query["status"] = status
    bookings = await ExamBooking.find(query).to_list()
    students = await load_students_map(b.student_id for b in bookings)
    booking_ids = [str(b.id) for b in bookings]
    reported = {r.exam_booking_id for r in
                await CEFRReport.find({"exam_booking_id": {"$in": booking_ids}}).to_list()}
    reported |= {c.exam_booking_id for c in
                 await Certificate.find({"exam_booking_id": {"$in": booking_ids}}).to_list()}

    rows = []
    for b in bookings:
        exam = slots[b.exam_id]
        student = students.get(b.student_id)
        rows.append({
            **b.model_dump(mode="json"),
            "exam_title": exam.title, "kind": exam.kind,
            "scheduled_at": _iso(exam.scheduled_at),
            "duration_minutes": exam.duration_minutes,
            "student_name": student.full_name if student else None,
            "student_photo_url": student.photo_url if student else None,
            "student_gender": student.gender if student else None,
            "student_cefr_level": student.cefr_level if student else None,
            "student_audience": student.audience.value if student else None,
            "reported": str(b.id) in reported,
        })
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in f"{r['student_id']} {r.get('student_name') or ''} "
                                             f"{r['exam_title']}".lower()]
    rows.sort(key=lambda r: (r["scheduled_at"] or "", r["created_at"]))
    return rows, slots


@router.get("/examiner/summary")
async def examiner_summary(examiner: CurrentUser = Depends(require_examiner)):
    """Dashboard tiles: slots assigned, students booked, reports outstanding."""
    rows, slots = await _assigned_bookings(examiner)
    now = utcnow().replace(tzinfo=None)
    upcoming = [e for e in slots.values()
                if e.scheduled_at and _naive(e.scheduled_at) >= now]
    live = [r for r in rows if r["status"] != "cancelled"]
    reports = await CEFRReport.find(CEFRReport.examiner_id == examiner.subject).count()
    certs = await Certificate.find(Certificate.examiner_id == examiner.subject).count()
    return ok({
        "assigned_slots": len(slots),
        "upcoming_slots": len(upcoming),
        "students_booked": len(live),
        "pending_reports": sum(1 for r in live if not r["reported"]),
        "reports_submitted": reports + certs,
        "next_slot": min(
            (_iso(e.scheduled_at) for e in upcoming if e.scheduled_at), default=None
        ),
    })


@router.get("/examiner/slots")
async def examiner_slots(examiner: CurrentUser = Depends(require_examiner),
                         upcoming: bool = False):
    """The examiner's own assigned exam slots."""
    exams = await Exam.find(Exam.examiner_id == examiner.subject,
                            Exam.is_archived == False).to_list()  # noqa: E712
    if upcoming:
        now = utcnow().replace(tzinfo=None)
        exams = [e for e in exams if not e.scheduled_at or _naive(e.scheduled_at) >= now]
    return ok(await _slot_rows(exams))


@router.get("/examiner/assigned")
async def examiner_assigned(examiner: CurrentUser = Depends(require_examiner),
                            status: str | None = "booked", q: str | None = None):
    """Assigned exams awaiting a report (``status=``/``q=`` to widen or search)."""
    rows, _ = await _assigned_bookings(examiner, status=status or None, q=q)
    return ok(rows)


@router.get("/examiner/students")
async def examiner_students(examiner: CurrentUser = Depends(require_examiner),
                            q: str | None = None):
    """Search the students this examiner has been assigned, with their history.

    Scoped to the examiner's own bookings on purpose — an examiner has no
    business enumerating the whole student base."""
    rows, _ = await _assigned_bookings(examiner, q=q)
    by_student: dict[str, dict] = {}
    for r in rows:
        entry = by_student.setdefault(r["student_id"], {
            "student_id": r["student_id"], "student_name": r["student_name"],
            "student_photo_url": r["student_photo_url"], "student_gender": r["student_gender"],
            "cefr_level": r["student_cefr_level"], "audience": r["student_audience"],
            "bookings": [], "completed": 0, "pending": 0,
        })
        entry["bookings"].append({
            "id": r["id"], "exam_title": r["exam_title"], "kind": r["kind"],
            "scheduled_at": r["scheduled_at"], "duration_minutes": r["duration_minutes"],
            "status": r["status"], "reported": r["reported"],
        })
        entry["completed" if r["reported"] else "pending"] += 1

    ids = list(by_student)
    for r in await CEFRReport.find({"student_id": {"$in": ids},
                                    "examiner_id": examiner.subject}).to_list():
        by_student[r.student_id].setdefault("results", []).append(
            {"type": "cefr_report", "level": r.level, "remarks": r.remarks,
             "url": r.report_url, "created_at": r.created_at.isoformat()})
    for c in await Certificate.find({"student_id": {"$in": ids},
                                     "examiner_id": examiner.subject}).to_list():
        by_student[c.student_id].setdefault("results", []).append(
            {"type": "certificate", "grade": c.grade, "remarks": c.remarks,
             "url": c.certificate_url, "created_at": c.created_at.isoformat()})
    return ok(sorted(by_student.values(), key=lambda s: (s["student_name"] or s["student_id"])))


@router.get("/examiner/reports")
async def examiner_reports(examiner: CurrentUser = Depends(require_examiner)):
    """Everything this examiner has already submitted."""
    reports = await CEFRReport.find(CEFRReport.examiner_id == examiner.subject).sort(
        -CEFRReport.created_at).to_list()
    certs = await Certificate.find(Certificate.examiner_id == examiner.subject).sort(
        -Certificate.created_at).to_list()
    smap = await load_students_map([r.student_id for r in reports] + [c.student_id for c in certs])

    def _row(doc):
        row = doc.model_dump(mode="json")
        row.update(student_avatar_fields(smap.get(doc.student_id), "student"))
        return row

    return ok({"cefr_reports": [_row(r) for r in reports],
               "certificates": [_row(c) for c in certs]})


class ReportBody(BaseModel):
    exam_booking_id: str
    student_id: str
    level: str | None = None  # A1..C2 (CEFR test)
    grade: str | None = None  # Speaking test grade/result
    scores: dict = {}
    remarks: str | None = None


@router.post("/report")
async def submit_report(body: ReportBody, examiner: CurrentUser = Depends(require_examiner)):
    """Submit the exam report. CEFR -> report card + Verified community status;
    Speaking -> auto-generated certificate. Both land in the student's
    dashboard immediately (the spec's 24-hour promise) and are recorded with
    the exam date, examiner name and remarks for the admin views."""
    booking = await ExamBooking.get(body.exam_booking_id)
    if not booking:
        raise NotFoundError("Exam booking not found")
    if booking.student_id != body.student_id:
        raise ValidationAppError("That booking belongs to a different student")
    if booking.status == "cancelled":
        raise ConflictError("That booking was cancelled")

    exam = await Exam.get(booking.exam_id)
    if not exam:
        raise NotFoundError("Exam slot not found")
    if exam.examiner_id != examiner.subject:
        raise ForbiddenError("That exam is not assigned to you")
    if (await CEFRReport.find_one(CEFRReport.exam_booking_id == body.exam_booking_id)
            or await Certificate.find_one(Certificate.exam_booking_id == body.exam_booking_id)):
        raise ConflictError("A result has already been submitted for this booking")

    account = await User.find_one(User.username == examiner.subject)
    examiner_name = (account.full_name if account and account.full_name else examiner.subject)
    student = await Student.find_one(Student.student_id == body.student_id)
    name = student.full_name if student else body.student_id
    shared = {
        "student_id": body.student_id, "exam_booking_id": body.exam_booking_id,
        "exam_id": str(exam.id), "exam_title": exam.title, "exam_date": exam.scheduled_at,
        "examiner_id": examiner.subject, "examiner_name": examiner_name,
        "remarks": body.remarks,
    }

    if exam.kind == "CEFR":
        if body.level not in CEFR_LEVELS:
            raise ValidationAppError("CEFR level must be one of A1, A2, B1, B2, C1, C2")
        vcode = "CEFR-" + uuid.uuid4().hex[:10].upper()
        report = CEFRReport(level=body.level, scores=body.scores,
                            verification_code=vcode, **shared)
        report.report_url = pdf_service.generate_cefr_report(
            name, body.student_id, body.level, body.scores, vcode
        )
        await report.insert()

        # Event-driven CEFR status flip on the same Student ID.
        if student:
            student.cefr_status = CEFRStatus.verified
            student.cefr_level = body.level
            await student.save()
        cp = await CommunityProfile.find_one(CommunityProfile.student_id == body.student_id)
        if cp:
            cp.cefr_status = CEFRStatus.verified
            cp.cefr_level = body.level
            await cp.save()

        await notif.notify(body.student_id, "CEFR Report Card Ready",
                           f"Your CEFR level is {body.level}. Your report card is available "
                           "in your dashboard and your community profile is now Verified.",
                           kind="exam", push_url="/dashboard/reports")
        payload = {"report_verification_code": vcode, "report_url": report.report_url,
                   "level": body.level}
    else:  # Speaking test -> certificate
        if not (body.grade or "").strip():
            raise ValidationAppError("grade/result is required for a Speaking test report")
        ccode = "CERT-" + uuid.uuid4().hex[:10].upper()
        cert = Certificate(
            title=f"Speaking Test Certificate – {body.grade}", grade=body.grade,
            verification_code=ccode, issued_at=utcnow(), **shared,
        )
        cert.certificate_url = pdf_service.generate_certificate(
            cert.title, name, body.student_id, ccode
        )
        await cert.insert()
        await notif.notify(body.student_id, "Speaking Test Certificate Ready",
                           f"Your Speaking test result is {body.grade}. Your certificate has "
                           "been generated and stored in your dashboard.",
                           kind="exam", push_url="/dashboard/reports")
        payload = {"certificate_verification_code": ccode,
                   "certificate_url": cert.certificate_url, "grade": body.grade}

    booking.status = "completed"
    booking.touch()
    await booking.save()

    await log_activity(examiner.subject, "exam.report", role=examiner.role.value,
                       target_type="student", target_id=body.student_id,
                       meta={"kind": exam.kind, **payload})
    return ok(payload, "Report submitted")


# --- Public verification (no auth) ---
@router.get("/verify/{code}")
async def public_verify(code: str):
    cert = await Certificate.find_one(Certificate.verification_code == code)
    if cert:
        return ok({"type": "certificate", "valid": True, "title": cert.title,
                   "grade": cert.grade, "student_id": cert.student_id,
                   "examiner_name": cert.examiner_name,
                   "exam_date": cert.exam_date.isoformat() if cert.exam_date else None,
                   "issued_at": cert.issued_at.isoformat()})
    report = await CEFRReport.find_one(CEFRReport.verification_code == code)
    if report:
        return ok({"type": "cefr_report", "valid": True, "level": report.level,
                   "student_id": report.student_id, "examiner_name": report.examiner_name,
                   "exam_date": report.exam_date.isoformat() if report.exam_date else None})
    return ok({"valid": False}, "No record found for this verification code")
