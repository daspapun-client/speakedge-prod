"""Student Dashboard (Module 10): home summary, profile, community profile,
payments/invoices, notifications, teacher review pop-ups (7-day window),
exclusive offer pop-ups, referral information, download centre."""
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.core.envelope import ok
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_student
from app.db.base import utcnow
from app.shared import attendance as attendance_service
from app.shared import file_service
from app.shared.teacher_reviews import sync_reviews_for_student
from app.db.models import (
    CEFRReport,
    Certificate,
    ClassConfirmation,
    CommunityProfile,
    EnglishStyle,
    Notification,
    Offer,
    OfferResponse,
    Payment,
    Batch,
    Teacher,
    TeacherReview,
)
from app.modules.membership import service as membership_service
from app.modules.notification import service as notif_service
from app.modules.payments import service as payment_service

router = APIRouter(prefix="/dashboard", tags=["student-dashboard"])

REVIEW_WINDOW_DAYS = 7


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    address: str | None = None
    state: str | None = None
    district: str | None = None
    pin_code: str | None = None
    about_me: str | None = None
    # Learning preferences — feed the AI prompt engine and instruction language.
    # `audience` is deliberately NOT here: Kids and Adults are separate courses,
    # fixed by the activation code the student enrolled with. Only an admin can
    # move a student between them.
    preferred_english: EnglishStyle | None = None
    preferred_language: str | None = None


@router.get("/")
async def home(user: CurrentUser = Depends(require_student)):
    sid = user.subject
    student = await membership_service.get_student(sid)
    # Resolved through payments.service so a paid upgrade whose activation date
    # has arrived is switched over here, rather than waiting for the scheduler.
    sub = await payment_service.active_subscription(sid)
    keys = notif_service.recipients_for(sid, user.role)
    broadcasts = await Notification.find(
        {"recipient": {"$in": [k for k in keys if k != sid]},
         "is_archived": False, "sent": True, "read_by": {"$ne": sid}}
    ).count()
    direct_unread = await Notification.find(
        {"recipient": sid, "is_read": False, "is_archived": False, "sent": True}
    ).count()
    return ok({
        "student_id": student.student_id,
        "full_name": student.full_name,
        "photo_url": student.photo_url,
        "membership_status": student.membership_status.value,
        "cefr_status": student.cefr_status.value,
        "cefr_level": student.cefr_level,
        "subscription": sub.model_dump(mode="json") if sub else None,
        "unread_notifications": direct_unread + broadcasts,
        "referral_code": student.referral_code,
        # Fixed support banner (spec): clickable WhatsApp support number.
        "whatsapp_support": settings.WHATSAPP_SUPPORT,
        "support_notice": (
            "Need help with your course? Please raise a support ticket on WhatsApp at "
            f"{settings.WHATSAPP_SUPPORT} and mention your Student ID. "
            "Our support team will get back to you within 48 hours."
        ),
    })


@router.get("/profile")
async def get_profile(user: CurrentUser = Depends(require_student)):
    student = await membership_service.get_student(user.subject)
    return ok(student.model_dump(mode="json", exclude={"id_proof_url"}))


@router.put("/profile")
async def update_profile(body: ProfileUpdate, user: CurrentUser = Depends(require_student)):
    from app.modules.instructions.router import LANGUAGE_CODES

    student = await membership_service.get_student(user.subject)
    changes = body.model_dump(exclude_none=True)
    lang = changes.get("preferred_language")
    if lang is not None and lang not in LANGUAGE_CODES:
        raise ValidationAppError(
            f"'{lang}' is not a supported language. Choose one of {sorted(LANGUAGE_CODES)}.")
    for k, v in changes.items():
        setattr(student, k, v)
    student.touch()
    await student.save()
    return ok(student.model_dump(mode="json", exclude={"id_proof_url"}), "Profile updated")


@router.post("/profile/photo")
async def update_photo(photo: UploadFile = File(...),
                       user: CurrentUser = Depends(require_student)):
    """Update the student's profile picture (Module 10 — Profile Management)."""
    if photo.content_type not in file_service.ALLOWED_IMAGE_TYPES:
        raise ValidationAppError("Profile photo must be JPEG/PNG/WebP")
    photo_url = file_service.save_photo(await photo.read())
    student = await membership_service.get_student(user.subject)
    student.photo_url = photo_url
    student.touch()
    await student.save()
    return ok({"photo_url": photo_url}, "Profile photo updated")


@router.get("/membership")
async def membership_info(user: CurrentUser = Depends(require_student)):
    student = await membership_service.get_student(user.subject)
    return ok({
        "student_id": student.student_id,
        "membership_status": student.membership_status.value,
        "activation_date": student.created_at.isoformat(),
        "verified_at": student.verified_at.isoformat() if student.verified_at else None,
        "cefr_status": student.cefr_status.value,
        "cefr_level": student.cefr_level,
    })


@router.get("/community-profile")
async def community_profile(user: CurrentUser = Depends(require_student)):
    cp = await CommunityProfile.find_one(CommunityProfile.student_id == user.subject)
    return ok(cp.model_dump(mode="json") if cp else None)


@router.get("/payments")
async def payment_history(user: CurrentUser = Depends(require_student)):
    payments = await Payment.find(
        Payment.student_id == user.subject, Payment.is_archived == False  # noqa: E712
    ).sort(-Payment.created_at).to_list()
    return ok([p.model_dump(mode="json") for p in payments])


@router.get("/notifications")
async def notifications(user: CurrentUser = Depends(require_student)):
    keys = notif_service.recipients_for(user.subject, user.role)
    items = await Notification.find(
        {"recipient": {"$in": keys}, "is_archived": False, "sent": True}
    ).sort(-Notification.created_at).limit(100).to_list()
    return ok([n.model_dump(mode="json", exclude={"read_by"}) for n in items])


@router.get("/downloads")
async def download_centre(user: CurrentUser = Depends(require_student)):
    """Download Centre: certificates, report cards and invoices in one place."""
    sid = user.subject
    certs = await Certificate.find(Certificate.student_id == sid).to_list()
    reports = await CEFRReport.find(CEFRReport.student_id == sid).to_list()
    invoices = await Payment.find(
        {"student_id": sid, "invoice_url": {"$ne": None}, "is_archived": False}
    ).to_list()
    return ok({
        # Exam date / examiner / grade / remarks travel with the download so the
        # learner sees the same record the examiner filed (Module 11).
        "certificates": [
            {"id": str(c.id), "title": c.title, "url": c.certificate_url,
             "code": c.verification_code, "grade": c.grade, "level": c.cefr_level,
             "remarks": c.remarks, "examiner_name": c.examiner_name,
             "exam_date": c.exam_date.isoformat() if c.exam_date else None}
            for c in certs
        ],
        "report_cards": [
            {"id": str(r.id), "level": r.level, "url": r.report_url,
             "code": r.verification_code,
             "remarks": r.remarks, "examiner_name": r.examiner_name,
             "exam_date": r.exam_date.isoformat() if r.exam_date else None}
            for r in reports
        ],
        "invoices": [
            {"invoice_no": p.invoice_no, "url": p.invoice_url, "amount": p.amount}
            for p in invoices
        ],
    })


@router.get("/referral")
async def referral(user: CurrentUser = Depends(require_student)):
    """Referral Information (spec: code + history; benefits marked Future)."""
    student = await membership_service.get_student(user.subject)
    return ok({
        "referral_code": student.referral_code,
        "referral_history": [],
        "referral_benefits": "Coming soon",
    })


# --------------------------------------------------------------------------
# Teacher review pop-ups: once a day for 7 days until submitted (Module 10)
# --------------------------------------------------------------------------
@router.get("/pending-reviews")
async def pending_reviews(user: CurrentUser = Depends(require_student)):
    await sync_reviews_for_student(user.subject)
    cutoff = utcnow() - timedelta(days=REVIEW_WINDOW_DAYS)
    items = await TeacherReview.find(
        TeacherReview.student_id == user.subject,
        TeacherReview.status == "pending",
    ).to_list()
    live = []
    teacher_cache: dict[str, Teacher | None] = {}
    batch_cache: dict[str, Batch | None] = {}
    for r in items:
        created = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
        if created >= cutoff:
            row = r.model_dump(mode="json")
            if r.teacher_id:
                if r.teacher_id not in teacher_cache:
                    teacher_cache[r.teacher_id] = await Teacher.get(r.teacher_id)
                teacher = teacher_cache[r.teacher_id]
                row["teacher_photo_url"] = teacher.photo_url if teacher else None
                row["teacher_qualification"] = teacher.qualification if teacher else None
                row["teacher_cefr_level"] = teacher.cefr_level if teacher else None
            if r.batch_id:
                if r.batch_id not in batch_cache:
                    batch_cache[r.batch_id] = await Batch.get(r.batch_id)
                batch = batch_cache[r.batch_id]
                if batch:
                    row["batch_title"] = batch.title
                    row["slot_start"] = batch.slot_start
                    row["slot_end"] = batch.slot_end
                    row["day_of_week"] = batch.day_of_week
            live.append(row)
    return ok(live)


class ReviewBody(BaseModel):
    attended: bool
    rating: int | None = None  # 1..5, required when attended
    feedback: str | None = None


@router.post("/reviews/{review_id}")
async def submit_review(review_id: str, body: ReviewBody,
                        user: CurrentUser = Depends(require_student)):
    review = await TeacherReview.get(review_id)
    if not review or review.student_id != user.subject:
        raise NotFoundError("Review request not found")
    if review.status != "pending":
        raise ConflictError("Review already answered")
    if body.attended:
        if not body.rating or not 1 <= body.rating <= 5:
            raise ValidationAppError("rating must be 1–5 when you attended")
        review.attended = True
        review.rating = body.rating
        review.feedback = body.feedback
        review.status = "submitted"
        message = "Review submitted"
    else:
        review.attended = False
        review.rating = None
        review.feedback = body.feedback or "Student reported they did not attend the class."
        review.status = "missed"
        message = "Reported to admin — you marked this class as missed"
    review.touch()
    await review.save()
    return ok(review.model_dump(mode="json"), message)


# --------------------------------------------------------------------------
# Attendance confirmation (24h notice → 18h deadline → seat auto-cancelled)
# --------------------------------------------------------------------------
def _confirmation_row(rec: ClassConfirmation) -> dict:
    deadline = rec.deadline_at if rec.deadline_at.tzinfo else rec.deadline_at.replace(
        tzinfo=timezone.utc)
    remaining = (deadline - utcnow()).total_seconds()
    return {
        "id": str(rec.id),
        "source": rec.source,
        "class_ref": rec.class_ref,
        "class_title": rec.class_title,
        "class_date": rec.class_date,
        "class_time": rec.class_time,
        "status": rec.status,
        "notified_at": rec.notified_at.isoformat(),
        "deadline_at": deadline.isoformat(),
        "responded_at": rec.responded_at.isoformat() if rec.responded_at else None,
        "hours_remaining": round(max(0.0, remaining) / 3600, 1),
        "is_expired": rec.status == "expired",
        "can_respond": rec.status == "pending" and remaining > 0,
    }


@router.get("/attendance")
async def my_attendance_confirmations(user: CurrentUser = Depends(require_student)):
    """Attendance requests for this student — pending ones first."""
    recs = await ClassConfirmation.find(
        ClassConfirmation.student_id == user.subject,
        ClassConfirmation.is_archived == False,  # noqa: E712
    ).sort(-ClassConfirmation.created_at).limit(100).to_list()
    rows = [_confirmation_row(r) for r in recs]
    rows.sort(key=lambda r: (r["status"] != "pending", r["class_date"]))
    return ok({
        "pending_count": sum(1 for r in rows if r["can_respond"]),
        "deadline_hours": settings.ATTENDANCE_DEADLINE_HOURS,
        "notice_hours": settings.ATTENDANCE_NOTICE_HOURS,
        "items": rows,
    })


class AttendanceConfirmBody(BaseModel):
    attending: bool = True


@router.post("/attendance/{confirmation_id}")
async def respond_attendance_confirmation(
    confirmation_id: str, body: AttendanceConfirmBody,
    user: CurrentUser = Depends(require_student),
):
    """Submit attendance for an upcoming class.

    Rejects the edge cases explicitly rather than silently succeeding: a second
    submission, a submission after the seat was already auto-cancelled, and a
    submission past the deadline all return typed conflicts."""
    rec = await ClassConfirmation.get(confirmation_id)
    if not rec or rec.is_archived or rec.student_id != user.subject:
        raise NotFoundError("Attendance request not found")
    if rec.status == "expired":
        raise ConflictError(
            "This class was already cancelled because attendance was not confirmed in time.")
    if rec.status != "pending":
        raise ConflictError("You have already responded to this attendance request.")
    deadline = rec.deadline_at if rec.deadline_at.tzinfo else rec.deadline_at.replace(
        tzinfo=timezone.utc)
    if utcnow() > deadline:
        raise ConflictError(
            "The attendance deadline for this class has passed.")
    rec = await attendance_service.respond(rec, body.attending)
    message = ("Attendance confirmed — see you in class!" if body.attending
               else "Thanks for letting us know. Your seat has been released.")
    return ok(_confirmation_row(rec), message)


# --------------------------------------------------------------------------
# Exclusive offer pop-ups (Module 10)
# --------------------------------------------------------------------------
@router.get("/offers")
async def my_offers(user: CurrentUser = Depends(require_student)):
    """Active, non-expired offers targeted at this student that were not
    permanently dismissed. Close (X) is session-only — handled client-side."""
    now = utcnow()
    offers = await Offer.find(Offer.active == True, Offer.is_archived == False).to_list()  # noqa: E712
    answered = {
        r.offer_id for r in await OfferResponse.find(
            OfferResponse.student_id == user.subject
        ).to_list()
    }

    def _utc(dt):
        if dt is not None and dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    visible = []
    for o in offers:
        if str(o.id) in answered:
            continue  # interested/not_interested — never show again
        if o.target_student_ids and user.subject not in o.target_student_ids:
            continue
        if _utc(o.starts_at) and _utc(o.starts_at) > now:
            continue
        if _utc(o.ends_at) and _utc(o.ends_at) < now:
            continue  # expired offers stop appearing automatically
        visible.append(o.model_dump(mode="json"))
    return ok(visible)


class OfferRespond(BaseModel):
    response: str  # interested | not_interested


@router.post("/offers/{offer_id}/respond")
async def respond_offer(offer_id: str, body: OfferRespond,
                        user: CurrentUser = Depends(require_student)):
    if body.response not in ("interested", "not_interested"):
        raise ValidationAppError("response must be 'interested' or 'not_interested'")
    offer = await Offer.get(offer_id)
    if not offer:
        raise NotFoundError("Offer not found")
    existing = await OfferResponse.find_one(
        OfferResponse.offer_id == offer_id, OfferResponse.student_id == user.subject
    )
    if existing:
        raise ConflictError("You have already responded to this offer")
    await OfferResponse(offer_id=offer_id, student_id=user.subject,
                        response=body.response).insert()
    if body.response == "interested":
        # Frontend redirects straight to the payment page for this offer.
        return ok({
            "next": "payment",
            "plan": offer.plan,
            "amount": offer.amount,
        }, "Redirecting to payment")
    return ok(message="Offer dismissed")
