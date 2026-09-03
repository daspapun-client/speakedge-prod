from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel

from app.core.config import settings
from app.core.envelope import ok
from app.core.exceptions import ConflictError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_student
from app.core.ratelimit import rate_limit
from app.core.security import MIN_PASSWORD_LENGTH
from app.db.base import utcnow
from app.db.models import ActivationCode, PromptAudience, Subscription
from app.modules.membership import service
from app.shared import file_service
from app.shared.audit import log_activity

router = APIRouter(prefix="/membership", tags=["membership"])

_limit = rate_limit("activation", settings.RATE_LIMIT_AUTH_PER_MIN)

# Self-declared CEFR *speaking* level. `None` means "prefer not to say".
CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "Not Sure"]
CEFR_CHOICES = {*CEFR_LEVELS, None}

# Accepted government / institutional photo identity documents. Required for
# identity and membership verification; the upload stays private (see
# Student.id_proof_url) and is never shown to other members.
ID_PROOF_TYPES = [
    "Masked Aadhaar",
    "Voter ID",
    "PAN Card",
    "Driving Licence",
    "Passport",
    "School/College Photo ID",
    "Other Government-issued Photo ID",
]

# Academic / educational background. Spans the whole eligible age range, so the
# school classes come first and the higher qualifications after.
ACADEMIC_LEVELS = [
    "Class III–V",
    "Class VI–VIII",
    "Class IX–X",
    "Class XI–XII",
    "Diploma / ITI / Vocational",
    "Undergraduate (Pursuing)",
    "Graduate",
    "Postgraduate",
    "Doctorate",
    "Not Currently Studying",
    "Other",
]

GUARDIAN_RELATIONSHIPS = [
    "Father",
    "Mother",
    "Legal Guardian",
    "Grandparent",
    "Sibling (18 or above)",
    "Other",
]

# Section allocation and eligibility, all derived from the date of birth — age
# is never typed in by hand.
MIN_MEMBERSHIP_AGE = 8   # below this the learner cannot activate a membership
KIDS_MAX_AGE = 15        # inclusive upper bound of the Kids Section
MINOR_AGE = 18           # below this, parental/guardian consent is mandatory

# Dates of birth are Indian calendar dates: using UTC would age a learner up a
# day early for anyone whose birthday it is before 05:30 IST.
IST = timezone(timedelta(hours=5, minutes=30))


def today_ist() -> date:
    return datetime.now(IST).date()


def age_from_dob(dob: str) -> int:
    """Completed years as of today (IST). Raises on an unusable date."""
    try:
        born = date.fromisoformat((dob or "").strip())
    except ValueError:
        raise ValidationAppError("Date of birth must be a valid date (YYYY-MM-DD)")
    today = today_ist()
    if born > today:
        raise ValidationAppError("Date of birth cannot be in the future")
    age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    if age > 120:
        raise ValidationAppError("Please enter a valid date of birth")
    return age


def section_for_age(age: int) -> PromptAudience:
    """Kids and Adults are separate courses; the learner's age decides which.
    16–17 year-olds sit in the Adult Section but still go through the minor /
    parental consent process (see `_guardian_fields`)."""
    return PromptAudience.kids if age <= KIDS_MAX_AGE else PromptAudience.adults


def _guardian_fields(age: int, name, relationship, phone, email, consent) -> dict:
    """Parental consent block, mandatory for every learner under 18."""
    if age >= MINOR_AGE:
        return {}
    if not (name or "").strip() or not (phone or "").strip():
        raise ValidationAppError(
            "Learners under 18 must provide a parent/legal guardian name and mobile number")
    if relationship not in GUARDIAN_RELATIONSHIPS:
        raise ValidationAppError(
            f"Relationship to learner must be one of: {', '.join(GUARDIAN_RELATIONSHIPS)}")
    if not consent:
        raise ValidationAppError(
            "The parent/legal guardian must consent to the registration, verification, "
            "processing of personal data and the applicable SpeakEdge services and policies")
    return {
        "guardian_name": name.strip(),
        "guardian_relationship": relationship,
        "guardian_phone": phone.strip(),
        "guardian_email": (email or "").strip() or None,
        "consent_guardian": True,
    }


async def validated_registration(
    *,
    dob: str,
    cefr_level: str | None,
    about_me: str | None,
    id_proof_type: str,
    education_level: str,
    photo: UploadFile,
    id_proof: UploadFile,
    education_proof: UploadFile,
    guardian_name: str | None = None,
    guardian_relationship: str | None = None,
    guardian_phone: str | None = None,
    guardian_email: str | None = None,
    consent_guardian: bool = False,
) -> dict:
    """Validate the parts of the registration form that the public activation
    page and the admin manual-enrolment form share, store the uploads, and
    return the resulting `activate_membership` kwargs."""
    age = age_from_dob(dob)
    if age < MIN_MEMBERSHIP_AGE:
        raise ValidationAppError(
            f"Learners under {MIN_MEMBERSHIP_AGE} are not eligible for a SpeakEdge membership")

    if cefr_level not in CEFR_CHOICES:
        raise ValidationAppError("CEFR speaking level must be A1–C2 or 'Not Sure'")
    if about_me and len(about_me.split()) > 100:
        raise ValidationAppError("About Me must be within 100 words")
    if id_proof_type not in ID_PROOF_TYPES:
        raise ValidationAppError(
            f"ID proof type must be one of: {', '.join(ID_PROOF_TYPES)}")
    if education_level not in ACADEMIC_LEVELS:
        raise ValidationAppError(
            f"Academic / educational background must be one of: {', '.join(ACADEMIC_LEVELS)}")

    if photo.content_type not in file_service.ALLOWED_IMAGE_TYPES:
        raise ValidationAppError("Profile photo must be JPEG/PNG/WebP")
    if id_proof.content_type not in file_service.ALLOWED_ID_PROOF_TYPES:
        raise ValidationAppError("ID proof must be JPEG/PNG/WebP or PDF")
    if education_proof.content_type not in file_service.ALLOWED_ID_PROOF_TYPES:
        raise ValidationAppError(
            "Academic / educational proof must be JPEG/PNG/WebP or PDF")

    fields = {
        "dob": dob.strip(),
        "age": age,
        "audience": section_for_age(age),
        "cefr_level": cefr_level if cefr_level != "Not Sure" else None,
        "about_me": about_me,
        "id_proof_type": id_proof_type,
        "education_level": education_level,
        "photo_url": file_service.save_photo(await photo.read()),
        "id_proof_url": file_service.save_id_proof(
            await id_proof.read(), id_proof.content_type),
        "education_proof_url": file_service.save_education_proof(
            await education_proof.read(), education_proof.content_type),
    }
    fields.update(_guardian_fields(age, guardian_name, guardian_relationship,
                                   guardian_phone, guardian_email, consent_guardian))
    return fields


@router.post("/activate", dependencies=[Depends(_limit)])
async def activate(
    request: Request,
    # Required fields (Module 8 – Student Registration Form)
    code: str = Form(...),
    full_name: str = Form(...),
    dob: str = Form(...),             # Date of Birth — age & section are derived from it
    gender: str = Form(...),
    phone: str = Form(...),           # Mobile Number
    address: str = Form(...),         # Full Address
    state: str = Form(...),
    district: str = Form(...),
    pin_code: str = Form(...),
    password: str = Form(..., min_length=MIN_PASSWORD_LENGTH),
    # Academic / educational background + the document that evidences it
    education_level: str = Form(...),
    # Optional fields
    whatsapp: str | None = Form(None),  # WhatsApp Number (optional)
    email: str | None = Form(None),
    cefr_level: str | None = Form(None),  # Self-declared CEFR Speaking Level
    about_me: str | None = Form(None),    # optional, within 100 words
    # Consent & agreements — all five must be ticked
    consent_community_rules: bool = Form(False),
    consent_terms: bool = Form(False),
    consent_safety_policy: bool = Form(False),
    consent_non_refund: bool = Form(False),
    consent_process: bool = Form(False),
    # Parent / legal guardian — mandatory for learners under 18
    guardian_name: str | None = Form(None),
    guardian_relationship: str | None = Form(None),
    guardian_phone: str | None = Form(None),
    guardian_email: str | None = Form(None),
    consent_guardian: bool = Form(False),
    # Identity document: which one was uploaded. The file itself is required;
    # no document number is ever collected.
    id_proof_type: str = Form(...),
    # Uploads (photo required; the two proofs accept JPG/PNG/PDF)
    photo: UploadFile = File(...),
    id_proof: UploadFile = File(...),
    education_proof: UploadFile = File(...),
):
    fields = await validated_registration(
        dob=dob, cefr_level=cefr_level, about_me=about_me,
        id_proof_type=id_proof_type, education_level=education_level,
        photo=photo, id_proof=id_proof, education_proof=education_proof,
        guardian_name=guardian_name, guardian_relationship=guardian_relationship,
        guardian_phone=guardian_phone, guardian_email=guardian_email,
        consent_guardian=consent_guardian,
    )

    student = await service.activate_membership(
        code, full_name=full_name, password=password, gender=gender,
        email=email, phone=phone, whatsapp=whatsapp, address=address,
        state=state, district=district, pin_code=pin_code,
        consent_community_rules=consent_community_rules, consent_terms=consent_terms,
        consent_safety_policy=consent_safety_policy, consent_non_refund=consent_non_refund,
        consent_process=consent_process,
        **fields,
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
    """Every allowlist and age rule the registration form needs, so the form has
    no lists of its own to keep in sync. Passing a code also reports the course
    the code was *sold* for — the learner's actual section is allocated from
    their age at activation (`section_for_age`)."""
    data: dict = {
        "id_proof_types": ID_PROOF_TYPES,
        "academic_levels": ACADEMIC_LEVELS,
        "guardian_relationships": GUARDIAN_RELATIONSHIPS,
        "cefr_levels": CEFR_LEVELS,
        "min_age": MIN_MEMBERSHIP_AGE,
        "kids_max_age": KIDS_MAX_AGE,
        "minor_age": MINOR_AGE,
        "audience": None,
    }
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
    # Age and section are derived, so the learner corrects the date of birth.
    dob: str | None = None
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
    education_level: str | None = None
    guardian_name: str | None = None
    guardian_relationship: str | None = None
    guardian_phone: str | None = None
    guardian_email: str | None = None


@router.post("/resubmit")
async def resubmit(body: ResubmitBody, user: CurrentUser = Depends(require_student)):
    """Rejected students correct their information and resubmit (back to Pending)."""
    updates = body.model_dump(exclude_none=True)
    if "education_level" in updates and updates["education_level"] not in ACADEMIC_LEVELS:
        raise ValidationAppError("Unknown academic / educational background")
    if "dob" in updates:
        # A corrected date of birth re-runs eligibility and section allocation.
        age = age_from_dob(updates["dob"])
        if age < MIN_MEMBERSHIP_AGE:
            raise ValidationAppError(
                f"Learners under {MIN_MEMBERSHIP_AGE} are not eligible for a SpeakEdge membership")
        updates["age"] = age
        updates["audience"] = section_for_age(age)
    student = await service.resubmit(user.subject, updates)
    await log_activity(user.subject, "membership.resubmit", role="student",
                       target_type="student", target_id=user.subject)
    return ok({"membership_status": student.membership_status.value},
              "Resubmitted for verification")


# --- Admin verification queue actions ---
@router.post("/{student_id}/approve")
async def approve(student_id: str, admin: CurrentUser = Depends(require_admin),
                  plan: str | None = Query(None)):
    student = await service.approve(student_id, admin.subject, plan=plan)
    await log_activity(admin.subject, "membership.approve", role=admin.role.value,
                       target_type="student", target_id=student_id,
                       meta={"plan": plan} if plan else None)
    sub = await Subscription.find_one(
        Subscription.student_id == student_id, Subscription.is_active == True  # noqa: E712
    )
    return ok({"membership_status": student.membership_status.value,
               "plan": sub.plan if sub else None}, "Membership approved")


@router.post("/{student_id}/reject")
async def reject(student_id: str, reason: str, admin: CurrentUser = Depends(require_admin)):
    student = await service.reject(student_id, admin.subject, reason)
    await log_activity(admin.subject, "membership.reject", role=admin.role.value,
                       target_type="student", target_id=student_id, meta={"reason": reason})
    return ok({"membership_status": student.membership_status.value}, "Membership rejected")


@router.post("/{student_id}/renew")
async def renew(student_id: str, days: int = Query(365, ge=1, le=3650),
                admin: CurrentUser = Depends(require_admin)):
    """Renewal management: extend the student's active subscription — the
    renewable entity. Membership itself is not time-limited; the subscription
    attached to it is what expires and gets renewed."""
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
