from datetime import timedelta

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.core.envelope import ok
from app.core.exceptions import ConflictError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_student
from app.core.ratelimit import rate_limit
from app.db.base import utcnow
from app.db.models import ActivationCode, Subscription
from app.modules.membership import service
from app.shared import file_service
from app.shared.audit import log_activity

router = APIRouter(prefix="/membership", tags=["membership"])

_limit = rate_limit("activation", settings.RATE_LIMIT_AUTH_PER_MIN)

CEFR_CHOICES = {"A1", "A2", "B1", "B2", "C1", "C2", "Not Sure", None}

# Accepted government / institutional identity documents. The kids' options are
# last because the Kids course enrols minors who rarely hold the adult ones.
ID_PROOF_TYPES = [
    "Aadhaar Card",
    "PAN Card",
    "Passport",
    "Voter ID",
    "Driving Licence",
    "Ration Card",
    "School / College ID Card",
    "Birth Certificate",
]


@router.post("/activate", dependencies=[Depends(_limit)])
async def activate(
    request: Request,
    # Required fields (Module 8 – Student Registration Form)
    code: str = Form(...),
    full_name: str = Form(...),
    age: int = Form(...),
    gender: str = Form(...),
    phone: str = Form(...),           # Mobile Number
    address: str = Form(...),         # Full Address
    state: str = Form(...),
    district: str = Form(...),
    pin_code: str = Form(...),
    password: str = Form(..., min_length=6),
    # Optional fields
    whatsapp: str | None = Form(None),  # WhatsApp Number (optional)
    email: str | None = Form(None),
    dob: str | None = Form(None),
    cefr_level: str | None = Form(None),  # Self-declared
    about_me: str | None = Form(None),    # within 100 words
    # Consent & agreements — all five must be ticked
    consent_community_rules: bool = Form(False),
    consent_terms: bool = Form(False),
    consent_safety_policy: bool = Form(False),
    consent_non_refund: bool = Form(False),
    consent_process: bool = Form(False),
    # Identity document: which one was uploaded, and its number if the learner
    # supplies it. The file itself is still required.
    id_proof_type: str = Form(...),
    id_proof_number: str | None = Form(None),
    # Uploads (photo required; ID proof accepts JPG/PNG/PDF)
    photo: UploadFile = File(...),
    id_proof: UploadFile = File(...),
):
    if cefr_level not in CEFR_CHOICES:
        raise ValidationAppError("CEFR level must be A1–C2 or 'Not Sure'")
    if about_me and len(about_me.split()) > 100:
        raise ValidationAppError("About Me must be within 100 words")
    if id_proof_type not in ID_PROOF_TYPES:
        raise ValidationAppError(
            f"ID proof type must be one of: {', '.join(ID_PROOF_TYPES)}")

    if photo.content_type not in file_service.ALLOWED_IMAGE_TYPES:
        raise ValidationAppError("Profile photo must be JPEG/PNG/WebP")
    photo_url = file_service.save_photo(await photo.read())

    if id_proof.content_type not in file_service.ALLOWED_ID_PROOF_TYPES:
        raise ValidationAppError("ID proof must be JPEG/PNG/WebP or PDF")
    id_proof_url = file_service.save_id_proof(await id_proof.read(), id_proof.content_type)

    student = await service.activate_membership(
        code, full_name=full_name, password=password, age=age, gender=gender,
        email=email, phone=phone, whatsapp=whatsapp, dob=dob, address=address,
        state=state, district=district, pin_code=pin_code,
        cefr_level=cefr_level if cefr_level != "Not Sure" else None,
        about_me=about_me, photo_url=photo_url, id_proof_url=id_proof_url,
        id_proof_type=id_proof_type, id_proof_number=id_proof_number,
        consent_community_rules=consent_community_rules, consent_terms=consent_terms,
        consent_safety_policy=consent_safety_policy, consent_non_refund=consent_non_refund,
        consent_process=consent_process,
    )
    await log_activity(student.student_id, "membership.activate", role="student",
                       target_type="student", target_id=student.student_id,
                       ip=request.client.host if request.client else None)
    return ok(
        {"student_id": student.student_id, "membership_status": student.membership_status.value},
        "Your membership activation request has been submitted. "
        "Verification may take up to 72 hours.",
    )


@router.get("/form-options")
async def form_options(code: str | None = Query(None)):
    """Options the public activation form needs. Passing a code also reports the
    course (Kids/Adults) it was issued for, so the learner sees what they are
    enrolling into — the choice itself is the admin's, made at code generation."""
    data: dict = {"id_proof_types": ID_PROOF_TYPES, "audience": None}
    if code:
        ac = await ActivationCode.find_one(ActivationCode.code == code.strip())
        if ac:
            data["audience"] = ac.audience.value
    return ok(data)


@router.get("/status/{student_id}")
async def status(student_id: str):
    student = await service.get_student(student_id)
    return ok({
        "student_id": student.student_id,
        "membership_status": student.membership_status.value,
        "reject_reason": student.reject_reason,
    })


class ResubmitBody(BaseModel):
    full_name: str | None = None
    age: int | None = None
    gender: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    email: str | None = None
    address: str | None = None
    state: str | None = None
    district: str | None = None
    pin_code: str | None = None
    about_me: str | None = None
    cefr_level: str | None = None


@router.post("/resubmit")
async def resubmit(body: ResubmitBody, user: CurrentUser = Depends(require_student)):
    """Rejected students correct their information and resubmit (back to Pending)."""
    student = await service.resubmit(user.subject, body.model_dump(exclude_none=True))
    await log_activity(user.subject, "membership.resubmit", role="student",
                       target_type="student", target_id=user.subject)
    return ok({"membership_status": student.membership_status.value},
              "Resubmitted for verification")


# --- Admin verification queue actions ---
@router.post("/{student_id}/approve")
async def approve(student_id: str, admin: CurrentUser = Depends(require_admin)):
    student = await service.approve(student_id, admin.subject)
    await log_activity(admin.subject, "membership.approve", role=admin.role.value,
                       target_type="student", target_id=student_id)
    return ok({"membership_status": student.membership_status.value}, "Membership approved")


@router.post("/{student_id}/reject")
async def reject(student_id: str, reason: str, admin: CurrentUser = Depends(require_admin)):
    student = await service.reject(student_id, admin.subject, reason)
    await log_activity(admin.subject, "membership.reject", role=admin.role.value,
                       target_type="student", target_id=student_id, meta={"reason": reason})
    return ok({"membership_status": student.membership_status.value}, "Membership rejected")


@router.post("/{student_id}/renew")
async def renew(student_id: str, days: int = Query(365, ge=1, le=3650),
                admin: CurrentUser = Depends(require_admin)):
    """Renewal management: extend the student's active subscription (the renewable
    entity — the SpeakEdge membership itself is lifetime)."""
    await service.get_student(student_id)  # 404s if the student does not exist
    sub = await Subscription.find_one(
        Subscription.student_id == student_id, Subscription.is_active == True  # noqa: E712
    )
    if not sub:
        raise ConflictError("No active subscription to renew for this student")
    base = sub.expires_at
    if base.tzinfo is None:
        from datetime import timezone
        base = base.replace(tzinfo=timezone.utc)
    now = utcnow()
    sub.expires_at = (base if base > now else now) + timedelta(days=days)
    sub.touch()
    await sub.save()
    await log_activity(admin.subject, "membership.renew", role=admin.role.value,
                       target_type="subscription", target_id=student_id, meta={"days": days})
    return ok({"student_id": student_id, "plan": sub.plan,
               "expires_at": sub.expires_at.isoformat()}, "Subscription renewed")
