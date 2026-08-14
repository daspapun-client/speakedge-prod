"""Exams & Certification.

- Booking enforces per-kind eligibility (Module 10): every member gets a
  complimentary 1 CEFR + 1 Speaking test; Gold raises the total to 2+2 and
  Diamond to 3+3 via the active subscription tier.
- CEFR test -> examiner report -> CEFR Report Card PDF + community profile
  flips Self-Declared -> Verified.
- Speaking test -> examiner result -> auto-generated Certificate PDF.
- Public verification by report/certificate code (no auth)."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.envelope import ok
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_examiner, require_student
from app.db.base import utcnow
from app.db.models import (
    CEFRReport,
    CEFRStatus,
    Certificate,
    CommunityProfile,
    Exam,
    ExamBooking,
    Student,
    Subscription,
)
from app.modules.notification import service as notif
from app.shared import pdf_service
from app.shared.audit import log_activity
from app.shared.students import load_students_map, student_avatar_fields

router = APIRouter(prefix="/exams", tags=["exams"])

# Complimentary entitlement included with the lifetime membership (Section 6).
BASE_ELIGIBILITY = {"CEFR": 1, "Speaking": 1}


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


class ExamBody(BaseModel):
    kind: str = "CEFR"  # CEFR | Speaking
    title: str
    scheduled_at: datetime | None = None  # the bookable date/time slot


@router.post("/", dependencies=[Depends(require_admin)])
async def create_exam(body: ExamBody):
    if body.kind not in ("CEFR", "Speaking"):
        raise ValidationAppError("kind must be 'CEFR' or 'Speaking'")
    exam = Exam(**body.model_dump())
    await exam.insert()
    return ok(exam.model_dump(mode="json"))


def _sort_slots(exams: list[Exam]) -> list[Exam]:
    """Scheduled slots first, soonest first; undated exams last by title."""
    dated = sorted((e for e in exams if e.scheduled_at),
                   key=lambda e: e.scheduled_at.replace(tzinfo=None))
    undated = sorted((e for e in exams if not e.scheduled_at), key=lambda e: e.title)
    return dated + undated


@router.get("/")
async def list_exams(upcoming: bool = False):
    """All exams. `upcoming=true` (student slot picker) drops slots whose
    scheduled date/time has already passed; undated exams are always kept."""
    exams = await Exam.find(Exam.is_archived == False).to_list()  # noqa: E712
    if upcoming:
        now = utcnow().replace(tzinfo=None)
        exams = [e for e in exams
                 if not e.scheduled_at or e.scheduled_at.replace(tzinfo=None) >= now]
    return ok([e.model_dump(mode="json") for e in _sort_slots(exams)])


# --------------------------------------------------------------------------
# Admin exam management: assignment, scheduling, bookings, published results
# --------------------------------------------------------------------------
class ExamPatch(BaseModel):
    title: str | None = None
    kind: str | None = None
    scheduled_at: datetime | None = None
    examiner_id: str | None = None


@router.patch("/{exam_id}", dependencies=[Depends(require_admin)])
async def update_exam(exam_id: str, body: ExamPatch):
    exam = await Exam.get(exam_id)
    if not exam:
        raise NotFoundError("Exam not found")
    data = body.model_dump(exclude_none=True)
    if "kind" in data and data["kind"] not in ("CEFR", "Speaking"):
        raise ValidationAppError("kind must be 'CEFR' or 'Speaking'")
    for k, v in data.items():
        setattr(exam, k, v)
    exam.touch()
    await exam.save()
    return ok(exam.model_dump(mode="json"))


class AssignBody(BaseModel):
    examiner_id: str
    scheduled_at: datetime | None = None


@router.post("/{exam_id}/assign")
async def assign_examiner(exam_id: str, body: AssignBody,
                          admin: CurrentUser = Depends(require_admin)):
    """Assign an examiner (and optionally schedule) an exam (Module 11)."""
    exam = await Exam.get(exam_id)
    if not exam:
        raise NotFoundError("Exam not found")
    exam.examiner_id = body.examiner_id
    if body.scheduled_at:
        exam.scheduled_at = body.scheduled_at
    exam.touch()
    await exam.save()
    await log_activity(admin.subject, "exam.assign", role=admin.role.value,
                       target_id=exam_id, meta={"examiner_id": body.examiner_id})
    return ok(exam.model_dump(mode="json"))


@router.get("/admin/bookings")
async def admin_bookings(admin: CurrentUser = Depends(require_admin),
                         status: str | None = None, kind: str | None = None,
                         page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    """All exam bookings with exam + student context (booking to certification)."""
    exams = {str(e.id): e for e in await Exam.find().to_list()}
    if kind:
        exam_ids = [eid for eid, e in exams.items() if e.kind == kind]
        query: dict = {"exam_id": {"$in": exam_ids}}
    else:
        query = {}
    if status:
        query["status"] = status
    total = await ExamBooking.find(query).count()
    items = (await ExamBooking.find(query).sort(-ExamBooking.created_at)
             .skip((page - 1) * page_size).limit(page_size).to_list())
    students = await load_students_map(b.student_id for b in items)
    rows = []
    for b in items:
        exam = exams.get(b.exam_id)
        student = students.get(b.student_id)
        data = b.model_dump(mode="json")
        data["exam_title"] = exam.title if exam else None
        data["kind"] = exam.kind if exam else None
        data["scheduled_at"] = exam.scheduled_at.isoformat() if exam and exam.scheduled_at else None
        data["examiner_id"] = exam.examiner_id if exam else None
        data["student_name"] = student.full_name if student else None
        data["student_photo_url"] = student.photo_url if student else None
        data["student_gender"] = student.gender if student else None
        rows.append(data)
    return ok({"items": rows, "total": total, "page": page, "page_size": page_size})


@router.get("/admin/results")
async def admin_results(admin: CurrentUser = Depends(require_admin)):
    """Published results: CEFR report cards + Speaking certificates."""
    reports = await CEFRReport.find().sort(-CEFRReport.created_at).limit(200).to_list()
    certs = await Certificate.find().sort(-Certificate.created_at).limit(200).to_list()
    smap = await load_students_map([r.student_id for r in reports] + [c.student_id for c in certs])
    cefr_rows = []
    for r in reports:
        row = r.model_dump(mode="json")
        row.update(student_avatar_fields(smap.get(r.student_id), "student"))
        cefr_rows.append(row)
    cert_rows = []
    for c in certs:
        row = c.model_dump(mode="json")
        row.update(student_avatar_fields(smap.get(c.student_id), "student"))
        cert_rows.append(row)
    return ok({
        "cefr_reports": cefr_rows,
        "certificates": cert_rows,
    })


@router.get("/eligibility")
async def eligibility(user: CurrentUser = Depends(require_student)):
    """Remaining test eligibility per exam type (Module 10)."""
    return ok(await _eligibility(user.subject))


@router.post("/{exam_id}/book")
async def book(exam_id: str, user: CurrentUser = Depends(require_student)):
    exam = await Exam.get(exam_id)
    if not exam:
        raise NotFoundError("Exam not found")
    if exam.scheduled_at and exam.scheduled_at.replace(tzinfo=None) < utcnow().replace(tzinfo=None):
        raise ConflictError("That slot has already passed. Please pick an upcoming slot.")
    existing = await ExamBooking.find_one({
        "student_id": user.subject, "exam_id": exam_id, "status": {"$ne": "cancelled"},
    })
    if existing:
        raise ConflictError("You have already booked this slot.")
    quota = (await _eligibility(user.subject)).get(exam.kind, {"remaining": 0})
    if quota["remaining"] <= 0:
        raise ConflictError(
            f"No remaining {exam.kind} test eligibility. "
            "Upgrade your subscription plan for additional tests."
        )
    booking = ExamBooking(exam_id=exam_id, student_id=user.subject)
    await booking.insert()
    when = f" on {exam.scheduled_at:%d %b %Y, %I:%M %p}" if exam.scheduled_at else ""
    await notif.notify(user.subject, "Exam Booking Confirmed",
                       f"Your {exam.kind} test '{exam.title}'{when} has been booked.", kind="exam")
    return ok(booking.model_dump(mode="json"), "Exam booked")


@router.get("/my-bookings")
async def my_bookings(user: CurrentUser = Depends(require_student)):
    """Bookings enriched with their slot, so past slots still render correctly."""
    items = await ExamBooking.find(ExamBooking.student_id == user.subject).sort(
        -ExamBooking.created_at
    ).to_list()
    exams = {str(e.id): e for e in await Exam.find().to_list()}
    out = []
    for b in items:
        exam = exams.get(b.exam_id)
        out.append({
            **b.model_dump(mode="json"),
            "exam_title": exam.title if exam else None,
            "kind": exam.kind if exam else None,
            "scheduled_at": exam.scheduled_at.isoformat() if exam and exam.scheduled_at else None,
        })
    return ok(out)


class ReportBody(BaseModel):
    exam_booking_id: str
    student_id: str
    level: str | None = None  # A1..C2 (CEFR test)
    grade: str | None = None  # Speaking test grade/result
    scores: dict = {}
    remarks: str | None = None


@router.post("/report")
async def submit_report(body: ReportBody, examiner: CurrentUser = Depends(require_examiner)):
    booking = await ExamBooking.get(body.exam_booking_id)
    if not booking:
        raise NotFoundError("Exam booking not found")
    exam = await Exam.get(booking.exam_id)
    kind = exam.kind if exam else "CEFR"

    student = await Student.find_one(Student.student_id == body.student_id)
    name = student.full_name if student else body.student_id
    payload: dict = {}

    if kind == "CEFR":
        if not body.level:
            raise ValidationAppError("CEFR level (A1..C2) is required for a CEFR test report")
        vcode = "CEFR-" + uuid.uuid4().hex[:10].upper()
        report = CEFRReport(
            student_id=body.student_id, exam_booking_id=body.exam_booking_id,
            level=body.level, scores=body.scores, verification_code=vcode,
            examiner_id=examiner.subject,
        )
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
                           kind="exam")
        payload = {"report_verification_code": vcode, "report_url": report.report_url,
                   "level": body.level}
    else:  # Speaking test -> certificate
        if not body.grade:
            raise ValidationAppError("grade/result is required for a Speaking test report")
        ccode = "CERT-" + uuid.uuid4().hex[:10].upper()
        cert = Certificate(
            student_id=body.student_id,
            title=f"Speaking Test Certificate – {body.grade}",
            verification_code=ccode, issued_at=utcnow(),
        )
        cert.certificate_url = pdf_service.generate_certificate(cert.title, name, body.student_id, ccode)
        await cert.insert()
        await notif.notify(body.student_id, "Speaking Test Certificate Ready",
                           "Your certificate has been generated and stored in your dashboard.",
                           kind="exam")
        payload = {"certificate_verification_code": ccode,
                   "certificate_url": cert.certificate_url, "grade": body.grade}

    booking.status = "completed"
    await booking.save()

    await log_activity(examiner.subject, "exam.report", role=examiner.role.value,
                       target_id=body.student_id, meta={"kind": kind, **payload})
    return ok(payload)


@router.get("/my-certificates")
async def my_certificates(user: CurrentUser = Depends(require_student)):
    certs = await Certificate.find(Certificate.student_id == user.subject).to_list()
    return ok([c.model_dump(mode="json") for c in certs])


@router.get("/my-reports")
async def my_reports(user: CurrentUser = Depends(require_student)):
    reports = await CEFRReport.find(CEFRReport.student_id == user.subject).to_list()
    return ok([r.model_dump(mode="json") for r in reports])


@router.get("/examiner/assigned")
async def examiner_assigned(examiner: CurrentUser = Depends(require_examiner)):
    """Examiner Dashboard: bookings awaiting a report."""
    pending = await ExamBooking.find(ExamBooking.status == "booked").sort(
        ExamBooking.created_at
    ).to_list()
    return ok([b.model_dump(mode="json") for b in pending])


# --- Public verification (no auth) ---
@router.get("/verify/{code}")
async def public_verify(code: str):
    cert = await Certificate.find_one(Certificate.verification_code == code)
    if cert:
        return ok({"type": "certificate", "valid": True, "title": cert.title,
                   "student_id": cert.student_id, "issued_at": cert.issued_at.isoformat()})
    report = await CEFRReport.find_one(CEFRReport.verification_code == code)
    if report:
        return ok({"type": "cefr_report", "valid": True, "level": report.level,
                   "student_id": report.student_id})
    return ok({"valid": False}, "No record found for this verification code")
