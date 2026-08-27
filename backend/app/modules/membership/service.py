"""Membership activation workflow: validate code -> create Student (id = code)
+ dashboard + community profile + login user, set Pending Verification.
Admin approve/reject drives status to Active/Rejected. All five spec consent
agreements are mandatory (Community Rules, T&C, Safety Policy, Non-Refund,
SpeakEdge Process)."""
import uuid
from datetime import timedelta

from app.core.exceptions import ConflictError, NotFoundError
from app.core.security import Role
from app.db.base import utcnow
from app.db.models import (
    BookOrder,
    CEFRStatus,
    CommunityProfile,
    MembershipStatus,
    Payment,
    PromptAudience,
    Student,
    Subscription,
    User,
)
from app.modules.activation_code import service as code_service
from app.modules.auth import service as auth_service
from app.modules.notification import service as notif
from app.shared import email_service


async def activate_membership(
    code: str,
    *,
    full_name: str,
    password: str,
    age: int | None = None,
    gender: str | None = None,
    email: str | None = None,
    phone: str | None = None,
    whatsapp: str | None = None,
    dob: str | None = None,
    address: str | None = None,
    state: str | None = None,
    district: str | None = None,
    pin_code: str | None = None,
    cefr_level: str | None = None,
    about_me: str | None = None,
    photo_url: str | None = None,
    id_proof_url: str | None = None,
    id_proof_type: str | None = None,
    education_level: str | None = None,
    education_proof_url: str | None = None,
    audience: PromptAudience | None = None,
    guardian_name: str | None = None,
    guardian_relationship: str | None = None,
    guardian_phone: str | None = None,
    guardian_email: str | None = None,
    consent_guardian: bool = False,
    consent_community_rules: bool = False,
    consent_terms: bool = False,
    consent_safety_policy: bool = False,
    consent_non_refund: bool = False,
    consent_process: bool = False,
) -> Student:
    ac = await code_service.get_valid_unused(code)
    if not all([consent_community_rules, consent_terms, consent_safety_policy,
                consent_non_refund, consent_process]):
        raise ConflictError(
            "You must agree to the Terms & Conditions, Privacy Policy, Speaking Community Rules, "
            "Community Safety Policy, applicable Cancellation & Refund Policy and the membership "
            "verification process"
        )

    student_id = ac.code  # code becomes the permanent Student ID

    if await Student.find_one(Student.student_id == student_id):
        raise ConflictError("A student already exists for this code")

    student = Student(
        student_id=student_id,
        full_name=full_name,
        age=age,
        gender=gender,
        email=email,
        phone=phone,
        whatsapp=whatsapp,
        dob=dob,
        address=address,
        state=state,
        district=district,
        pin_code=pin_code,
        about_me=about_me,
        photo_url=photo_url,
        id_proof_url=id_proof_url,
        id_proof_type=id_proof_type,
        education_level=education_level,
        education_proof_url=education_proof_url,
        guardian_name=guardian_name,
        guardian_relationship=guardian_relationship,
        guardian_phone=guardian_phone,
        guardian_email=guardian_email,
        consent_guardian=consent_guardian,
        referral_code=f"SPKREF-{uuid.uuid4().hex[:6].upper()}",
        # Kids and Adults are separate courses, allocated from the learner's age
        # (router.section_for_age). The code's own audience is what was sold and
        # is only the fallback; after activation only an admin can move someone.
        audience=audience or ac.audience,
        membership_status=MembershipStatus.pending,
        cefr_status=CEFRStatus.self_declared,
        cefr_level=cefr_level,
        consent_community_rules=consent_community_rules,
        consent_terms=consent_terms,
        consent_safety_policy=consent_safety_policy,
        consent_non_refund=consent_non_refund,
        consent_process=consent_process,
    )
    await student.insert()

    # Auto-create community profile (Self-Declared – Not Verified) and login user.
    await CommunityProfile(
        student_id=student_id,
        display_name=full_name,
        first_name=full_name.split()[0] if full_name.split() else full_name,
        age=age,
        gender=gender,
        photo_url=photo_url,
        bio=about_me,
        cefr_status=CEFRStatus.self_declared,
        cefr_level=cefr_level,
    ).insert()

    await auth_service.create_user(
        username=student_id, password=password, role=Role.student,
        full_name=full_name, email=email, student_id=student_id,
    )

    await code_service.mark_activated(ac, student_id)
    await _start_paid_subscription(ac, student_id)

    if email:
        email_service.welcome_email(email, full_name, student_id)
    return student


async def _start_paid_subscription(ac, student_id: str) -> None:
    """Membership bought alongside the book is stamped on the activation code
    (see book.service._reserve_activation_code). Activation is where it becomes
    a live Subscription — the buyer paid at checkout, long before this account
    existed. No-op for codes sold without a plan."""
    if not getattr(ac, "plan", None):
        return
    from app.modules.payments import service as pay  # avoids an import cycle

    cfg = await pay.get_plan_config(ac.plan)
    months = ac.plan_months or (cfg.durations[0] if cfg.durations else 12)
    now = utcnow()

    # The order was placed as a guest ("guest:<phone>"), which is the only
    # identity that existed at payment time. Now that the account exists, hand
    # the order and its payment over to it — otherwise the buyer can never see
    # the invoice for their own membership (payment reads are student-scoped).
    payment_id = None
    order = await BookOrder.find_one(BookOrder.activation_code == ac.code)
    if order:
        if not order.student_id or order.student_id.startswith("guest:"):
            order.student_id = student_id
            await order.save()
        payment = await Payment.get(order.payment_id) if order.payment_id else None
        if payment:
            payment_id = str(payment.id)
            if payment.student_id.startswith("guest:"):
                payment.student_id = student_id
                await payment.save()

    await Subscription(
        student_id=student_id, plan=ac.plan, started_at=now,
        expires_at=now + timedelta(days=pay._months_to_days(months)),
        is_active=True, months=months,
        first_month_included=getattr(ac, "first_month_included", False),
        cefr_tests=cfg.cefr_tests, speaking_tests=cfg.speaking_tests,
        payment_id=payment_id,
    ).insert()


async def get_student(student_id: str) -> Student:
    student = await Student.find_one(Student.student_id == student_id)
    if not student:
        raise NotFoundError("Student not found")
    return student


async def approve(student_id: str, approver: str, plan: str | None = None) -> Student:
    cfg = None
    if plan:
        from app.modules.payments import service as pay  # avoids an import cycle
        cfg = await pay.get_plan_config(plan)
    student = await get_student(student_id)
    if student.membership_status != MembershipStatus.active:
        student.membership_status = MembershipStatus.active
        student.verified_at = utcnow()
        student.verified_by = approver
        student.reject_reason = None
        await student.save()
        label = cfg.label if cfg else "SpeakEdge"
        await notif.notify(
            student_id, "Membership Approved",
            f"Congratulations! Your {label} membership is now Active.", kind="approval")
        if student.email:
            email_service.approval_email(student.email, student.full_name)
    if plan:
        await _assign_plan(student_id, plan)
    return student


async def _assign_plan(student_id: str, plan: str) -> None:
    """Start (or switch to) the plan admin picked at approval.

    Same plan already active is left alone so an online purchase is not
    restarted. A different plan, or none, goes through switch_plan."""
    from app.modules.payments import service as pay

    existing = await Subscription.find_one(
        Subscription.student_id == student_id, Subscription.is_active == True  # noqa: E712
    )
    if existing and existing.plan == plan:
        return
    await pay.switch_plan(student_id, plan, carry=existing)


async def reject(student_id: str, approver: str, reason: str) -> Student:
    student = await get_student(student_id)
    student.membership_status = MembershipStatus.rejected
    student.reject_reason = reason
    student.verified_by = approver
    await student.save()
    await notif.notify(student_id, "Membership Verification Update",
                       f"Your activation was rejected: {reason}. "
                       "Please correct your information and resubmit.", kind="warning")
    return student


async def resubmit(student_id: str, updates: dict) -> Student:
    student = await get_student(student_id)
    if student.membership_status != MembershipStatus.rejected:
        raise ConflictError("Only rejected memberships can be resubmitted")
    for k, v in updates.items():
        if v is not None and hasattr(student, k):
            setattr(student, k, v)
    student.membership_status = MembershipStatus.pending
    student.reject_reason = None
    student.touch()
    await student.save()
    return student


_PROFILE_SYNC_FIELDS = {
    "full_name": ("display_name", lambda v: v),
    "age": ("age", lambda v: v),
    "gender": ("gender", lambda v: v),
    "photo_url": ("photo_url", lambda v: v),
    "about_me": ("bio", lambda v: v),
    "cefr_level": ("cefr_level", lambda v: v),
    "cefr_status": ("cefr_status", lambda v: v),
}


async def admin_update_student(student_id: str, data: dict, actor: str) -> Student:  # noqa: ARG001
    student = await get_student(student_id)
    if not data:
        raise ConflictError("No changes provided")

    if "membership_status" in data:
        status = data["membership_status"]
        if status == MembershipStatus.active:
            student.verified_at = utcnow()
            student.verified_by = actor
            student.reject_reason = None
        elif status == MembershipStatus.rejected and not data.get("reject_reason") and not student.reject_reason:
            raise ConflictError("A reject reason is required when setting status to Rejected")
        elif status == MembershipStatus.pending:
            student.reject_reason = None

    for key, value in data.items():
        if hasattr(student, key):
            setattr(student, key, value)

    student.touch()
    await student.save()

    profile = await CommunityProfile.find_one(CommunityProfile.student_id == student_id)
    if profile:
        if "full_name" in data:
            profile.display_name = data["full_name"]
            profile.first_name = data["full_name"].split()[0] if data["full_name"].split() else data["full_name"]
        for student_field, (profile_field, transform) in _PROFILE_SYNC_FIELDS.items():
            if student_field in data and student_field != "full_name":
                setattr(profile, profile_field, transform(data[student_field]))
        profile.touch()
        await profile.save()

    user = await User.find_one(User.student_id == student_id)
    if user and "full_name" in data:
        user.full_name = data["full_name"]
        if "email" in data:
            user.email = data["email"]
        user.touch()
        await user.save()

    return student
