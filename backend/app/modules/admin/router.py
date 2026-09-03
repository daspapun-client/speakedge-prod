"""Complete Admin Panel (Module 9): dashboard overview, user management,
verification queue, archive & restore (Super Admin), staff/roles, exclusive
offers, activity logs."""
import asyncio
from datetime import datetime, timezone

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel, Field

from app.core.envelope import ok
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_super_admin
from app.core.security import MIN_PASSWORD_LENGTH, Role, hash_password
from app.db.models import (
    ActivationCode,
    ActivityLog,
    Attendance,
    BookOrder,
    CEFRReport,
    CEFRStatus,
    Certificate,
    ClassConfirmation,
    CodeStatus,
    CommunityProfile,
    CommunityReport,
    ExamBooking,
    FriendRequest,
    Lead,
    MembershipStatus,
    Notification,
    Offer,
    OrderStatus,
    Partner,
    PartnerReport,
    Payment,
    PaymentStatus,
    PromptAudience,
    RefundStatus,
    Remuneration,
    SafetyCard,
    SpeakingTeam,
    Student,
    Subscription,
    Teacher,
    TeamJoinRequest,
    User,
    Video,
    WatchHistory,
)
from app.modules.admin import service as admin_service
from app.modules.auth import service as auth_service
from app.modules.membership import service as membership_service
from app.shared.audit import log_activity
from app.shared import file_service
from app.shared.students import load_students_map, student_avatar_fields

router = APIRouter(prefix="/admin", tags=["admin"])

# Archive dashboard: module name -> (model, id field used in URLs)
ARCHIVE_MODULES = {
    "students": Student,
    "teachers": Teacher,
    "partners": Partner,
    "payments": Payment,
    "leads": Lead,
    "notifications": Notification,
    "videos": Video,
    "community_profiles": CommunityProfile,
    "activation_codes": ActivationCode,
    "book_orders": BookOrder,
}


@router.get("/overview")
async def overview(admin: CurrentUser = Depends(require_admin)):
    students = await Student.find(Student.is_archived == False).count()  # noqa: E712
    active = await Student.find(
        Student.membership_status == MembershipStatus.active, Student.is_archived == False  # noqa: E712
    ).count()
    pending = await Student.find(
        Student.membership_status == MembershipStatus.pending, Student.is_archived == False  # noqa: E712
    ).count()
    codes_total = await ActivationCode.find(ActivationCode.is_archived == False).count()  # noqa: E712
    codes_unused = await ActivationCode.find(ActivationCode.status == CodeStatus.unused).count()
    revenue = await Payment.find(
        {"status": {"$in": [PaymentStatus.paid.value, PaymentStatus.manually_approved.value]}}
    ).sum(Payment.amount) or 0
    community = await CommunityProfile.find(CommunityProfile.is_archived == False).count()  # noqa: E712
    teachers = await Teacher.find(Teacher.status == "approved").count()
    partners = await Partner.find(Partner.status == "approved").count()
    examiners = await User.find(User.role == Role.examiner, User.is_active == True).count()  # noqa: E712
    book_orders = await BookOrder.find(BookOrder.is_archived == False).count()  # noqa: E712
    recent = await ActivityLog.find().sort(-ActivityLog.created_at).limit(10).to_list()
    return ok({
        "students": students,
        "active_memberships": active,
        "pending_verifications": pending,
        "activation_codes": {"total": codes_total, "unused": codes_unused},
        "community_members": community,
        "teachers": teachers,
        "partners": partners,
        "examiners": examiners,
        "book_orders": book_orders,
        "revenue_paise": int(revenue),
        "recent_activities": [a.model_dump(mode="json") for a in recent],
    })


_INBOX_POOL = 8
_REFUND_ACTION = {RefundStatus.requested.value, RefundStatus.under_review.value}


def _iso_utc(dt: datetime | None) -> str | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _inbox_item(kind: str, record_id: str, title: str, summary: str, href: str,
                created_at: datetime | None) -> dict:
    return {
        "id": f"{kind}:{record_id}",
        "kind": kind,
        "title": title,
        "summary": summary,
        "href": href,
        "created_at": _iso_utc(created_at),
    }


@router.get("/action-inbox")
async def action_inbox(admin: CurrentUser = Depends(require_admin)):
    """Newest actionable admin queue items (verification, payments, partners, etc.)."""
    not_archived = {"is_archived": False}

    (
        verifications,
        payments,
        refunds,
        teachers,
        partners,
        partner_reports,
        community_reports,
        join_requests,
        attendances,
        remunerations,
        book_orders,
        leads,
    ) = await asyncio.gather(
        Student.find(
            Student.membership_status == MembershipStatus.pending, Student.is_archived == False  # noqa: E712
        ).sort(-Student.created_at).limit(_INBOX_POOL).to_list(),
        Payment.find({**not_archived, "status": PaymentStatus.created.value})
        .sort(-Payment.created_at).limit(_INBOX_POOL).to_list(),
        Payment.find({
            **not_archived,
            "refund_status": {"$in": list(_REFUND_ACTION)},
        }).sort(-Payment.created_at).limit(_INBOX_POOL).to_list(),
        Teacher.find({**not_archived, "status": {"$in": ["applied", "pending"]}})
        .sort(-Teacher.created_at).limit(_INBOX_POOL).to_list(),
        Partner.find({**not_archived, "status": {"$in": ["pending", "under_review"]}})
        .sort(-Partner.created_at).limit(_INBOX_POOL).to_list(),
        PartnerReport.find({**not_archived, "status": "pending"})
        .sort(-PartnerReport.created_at).limit(_INBOX_POOL).to_list(),
        CommunityReport.find({**not_archived, "status": "open"})
        .sort(-CommunityReport.created_at).limit(_INBOX_POOL).to_list(),
        TeamJoinRequest.find({**not_archived, "status": "pending"})
        .sort(-TeamJoinRequest.created_at).limit(_INBOX_POOL).to_list(),
        Attendance.find({"status": "pending"}).sort(-Attendance.created_at).limit(_INBOX_POOL).to_list(),
        Remuneration.find({"status": "pending"}).sort(-Remuneration.created_at).limit(_INBOX_POOL).to_list(),
        BookOrder.find({**not_archived, "status": OrderStatus.activation_pending.value})
        .sort(-BookOrder.created_at).limit(_INBOX_POOL).to_list(),
        Lead.find({**not_archived, "status": "new"}).sort(-Lead.created_at).limit(_INBOX_POOL).to_list(),
    )

    items: list[dict] = []
    for s in verifications:
        items.append(_inbox_item(
            "verification", str(s.id), "Membership verification",
            f"{s.full_name} ({s.student_id})", "/admin/verification", s.created_at,
        ))
    for p in payments:
        items.append(_inbox_item(
            "payment", str(p.id), "Payment awaiting approval",
            f"{p.student_id} · ₹{p.amount / 100:,.0f}", "/admin/payments", p.created_at,
        ))
    for p in refunds:
        label = p.refund_status.value if p.refund_status else "Refund"
        items.append(_inbox_item(
            "refund", str(p.id), label,
            f"{p.student_id} · ₹{p.amount / 100:,.0f}", "/admin/payments", p.created_at,
        ))
    for t in teachers:
        items.append(_inbox_item(
            "teacher", str(t.id), "Teacher application",
            t.name, "/admin/teachers", t.created_at,
        ))
    for p in partners:
        items.append(_inbox_item(
            "partner", str(p.id), "Partner application",
            p.name, "/admin/partners", p.created_at,
        ))
    for r in partner_reports:
        items.append(_inbox_item(
            "partner_report", str(r.id), "Partner report approval",
            f"{r.partner_id} · {r.report_type}", "/admin/partners", r.created_at,
        ))
    for r in community_reports:
        items.append(_inbox_item(
            "community_report", str(r.id), "Community report",
            f"{r.reporter_student_id} → {r.against_student_id}", "/admin/community", r.created_at,
        ))
    for j in join_requests:
        items.append(_inbox_item(
            "team_join", str(j.id), "Team join request",
            f"{j.requester_name} ({j.requester_student_id})", "/admin/community", j.created_at,
        ))
    for a in attendances:
        items.append(_inbox_item(
            "attendance", str(a.id), "Attendance verification",
            f"Batch {a.batch_id} · {a.date}", "/admin/teachers", a.created_at,
        ))
    for r in remunerations:
        items.append(_inbox_item(
            "remuneration", str(r.id), "Teacher remuneration",
            f"₹{r.amount / 100:,.0f} · {r.period}", "/admin/teachers", r.created_at,
        ))
    for o in book_orders:
        items.append(_inbox_item(
            "book_order", str(o.id), "Book order — activate membership",
            f"{o.order_number} · {o.buyer_name}", "/admin/books", o.created_at,
        ))
    for lead in leads:
        items.append(_inbox_item(
            "lead", str(lead.id), "New lead",
            f"{lead.name} · {lead.phone}", "/admin/leads", lead.created_at,
        ))

    items.sort(key=lambda x: x["created_at"] or "", reverse=True)
    has_more = len(items) > 15
    visible = items[:15]
    return ok({"items": visible, "has_more": has_more})


@router.get("/students")
async def list_students(
    admin: CurrentUser = Depends(require_admin),
    status: MembershipStatus | None = None,
    q: str | None = None,
    include_archived: bool = False,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=500),
):
    query: dict = {} if include_archived else {"is_archived": False}
    if status:
        query["membership_status"] = status.value
    if q:
        query["$or"] = [
            {"full_name": {"$regex": q, "$options": "i"}},
            {"student_id": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]
    total = await Student.find(query).count()
    items = (
        await Student.find(query).sort(-Student.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )

    # Attach a lightweight subscription summary (active + past) per student so the
    # merged Users/Memberships list can show it without an extra call per row.
    student_ids = [s.student_id for s in items]
    subs = (
        await Subscription.find({"student_id": {"$in": student_ids}})
        .sort(-Subscription.started_at).to_list()
        if student_ids else []
    )
    subs_by_student: dict[str, list[Subscription]] = {}
    for sub in subs:
        subs_by_student.setdefault(sub.student_id, []).append(sub)

    login_active: dict[str, bool] = {}
    if student_ids:
        for u in await User.find({"student_id": {"$in": student_ids}}).to_list():
            if u.student_id:
                login_active[u.student_id] = u.is_active

    def _sub_summary(sid: str) -> dict:
        slist = subs_by_student.get(sid, [])
        active = next((s for s in slist if s.is_active), None)
        return {
            "active": {
                "plan": active.plan,
                "started_at": active.started_at.isoformat(),
                "expires_at": active.expires_at.isoformat(),
            } if active else None,
            "total": len(slist),
            "past": len(slist) - (1 if active else 0),
        }

    return ok({
        "items": [
            # Verification documents are pulled only on the single-student views.
            {**s.model_dump(mode="json", exclude={"id_proof_url", "education_proof_url"}),
             "subscription": _sub_summary(s.student_id),
             **({"login_is_active": login_active[s.student_id]} if s.student_id in login_active else {})}
            for s in items
        ],
        "total": total, "page": page, "page_size": page_size,
    })


@router.get("/students/{student_id}")
async def get_student(student_id: str, admin: CurrentUser = Depends(require_admin)):
    student = await membership_service.get_student(student_id)
    return ok(student.model_dump(mode="json"))


@router.get("/students/{student_id}/profile")
async def student_profile(student_id: str, admin: CurrentUser = Depends(require_admin)):
    """Full 360° student profile: personal + community + all related records
    (subscriptions, payments, book orders, exams, certificates, safety, teams,
    friends and recent activity) in a single call for the profile page."""
    student = await membership_service.get_student(student_id)
    community = await CommunityProfile.find_one(CommunityProfile.student_id == student_id)
    user = await User.find_one(User.student_id == student_id)

    subscriptions = (
        await Subscription.find(Subscription.student_id == student_id)
        .sort(-Subscription.started_at).to_list()
    )
    payments = (
        await Payment.find(Payment.student_id == student_id, Payment.is_archived == False)  # noqa: E712
        .sort(-Payment.created_at).to_list()
    )
    orders = (
        await BookOrder.find(BookOrder.student_id == student_id, BookOrder.is_archived == False)  # noqa: E712
        .sort(-BookOrder.created_at).to_list()
    )
    exam_bookings = (
        await ExamBooking.find(ExamBooking.student_id == student_id)
        .sort(-ExamBooking.created_at).to_list()
    )
    cefr_reports = await CEFRReport.find(CEFRReport.student_id == student_id).to_list()
    certificates = (
        await Certificate.find(Certificate.student_id == student_id)
        .sort(-Certificate.issued_at).to_list()
    )
    safety_cards = (
        await SafetyCard.find(SafetyCard.student_id == student_id)
        .sort(-SafetyCard.created_at).to_list()
    )
    reports_against = (
        await CommunityReport.find(CommunityReport.against_student_id == student_id).to_list()
    )
    teams = await SpeakingTeam.find(
        {"$or": [{"owner_student_id": student_id}, {"member_ids": student_id}]}
    ).to_list()
    friends = await FriendRequest.find(
        FriendRequest.status == "accepted",
        {"$or": [{"from_student_id": student_id}, {"to_student_id": student_id}]},
    ).count()
    activity = (
        await ActivityLog.find(ActivityLog.target_id == student_id)
        .sort(-ActivityLog.created_at).limit(25).to_list()
    )
    watch_history = (
        await WatchHistory.find(WatchHistory.student_id == student_id)
        .sort(-WatchHistory.watched_at).to_list()
    )
    videos_by_id: dict[str, Video] = {}
    if watch_history:
        try:
            video_ids = list({w.video_id for w in watch_history})
            videos = await Video.find({"_id": {"$in": [PydanticObjectId(v) for v in video_ids]}}).to_list()
            videos_by_id = {str(v.id): v for v in videos}
        except Exception:
            pass

    paid = {PaymentStatus.paid.value, PaymentStatus.manually_approved.value}
    total_paid = sum(p.amount for p in payments if p.status.value in paid)
    active_sub = next((s for s in subscriptions if s.is_active), None)

    return ok({
        "student": student.model_dump(mode="json"),
        "login": {
            "username": user.username if user else None,
            "is_active": user.is_active if user else None,
            "last_login_at": user.last_login_at.isoformat() if user and user.last_login_at else None,
        },
        "community": community.model_dump(mode="json") if community else None,
        "friends_count": friends,
        "teams": [t.model_dump(mode="json") for t in teams],
        "active_subscription": active_sub.model_dump(mode="json") if active_sub else None,
        "subscriptions": [s.model_dump(mode="json") for s in subscriptions],
        "payments": [p.model_dump(mode="json") for p in payments],
        "total_paid_paise": int(total_paid),
        "book_orders": [o.model_dump(mode="json") for o in orders],
        "exam_bookings": [e.model_dump(mode="json") for e in exam_bookings],
        "cefr_reports": [r.model_dump(mode="json") for r in cefr_reports],
        "certificates": [c.model_dump(mode="json") for c in certificates],
        "safety_cards": [c.model_dump(mode="json") for c in safety_cards],
        "reports_against": [r.model_dump(mode="json") for r in reports_against],
        "activity": [a.model_dump(mode="json") for a in activity],
        "video_views": [
            {
                **w.model_dump(mode="json"),
                "title": videos_by_id[w.video_id].title if w.video_id in videos_by_id else "Unknown video",
                "category": videos_by_id[w.video_id].category if w.video_id in videos_by_id else None,
            }
            for w in watch_history
        ],
        "video_summary": {
            "videos_watched": len(watch_history),
            "completed": sum(1 for w in watch_history if w.completed),
            "total_views": sum(w.view_count or 1 for w in watch_history),
        },
    })


class StudentUpdate(BaseModel):
    full_name: str | None = None
    age: int | None = None
    email: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    dob: str | None = None
    gender: str | None = None
    address: str | None = None
    state: str | None = None
    district: str | None = None
    pin_code: str | None = None
    about_me: str | None = None
    education_level: str | None = None
    guardian_name: str | None = None
    guardian_relationship: str | None = None
    guardian_phone: str | None = None
    guardian_email: str | None = None
    membership_status: MembershipStatus | None = None
    cefr_status: CEFRStatus | None = None
    cefr_level: str | None = None
    reject_reason: str | None = None
    # Course type (Kids/Adults). Admin-only — the student cannot change it.
    audience: PromptAudience | None = None
    # Access locks; see Student.teacher_class_locked / community_locked.
    teacher_class_locked: bool | None = None
    community_locked: bool | None = None
    access_lock_reason: str | None = None


@router.patch("/students/{student_id}")
async def update_student(student_id: str, body: StudentUpdate,
                         admin: CurrentUser = Depends(require_admin)):
    data = body.model_dump(exclude_none=True)
    if "membership_status" in data:
        data["membership_status"] = body.membership_status
    if "cefr_status" in data:
        data["cefr_status"] = body.cefr_status
    if "audience" in data:
        data["audience"] = body.audience
    student = await membership_service.admin_update_student(student_id, data, admin.subject)
    await log_activity(admin.subject, "student.update", role=admin.role.value,
                       target_id=student_id, meta={"fields": list(data.keys())})
    return ok(student.model_dump(mode="json"))


class AccessLockBody(BaseModel):
    """Omit a flag to leave it as-is."""
    teacher_class_locked: bool | None = None
    community_locked: bool | None = None
    reason: str | None = None


@router.post("/students/{student_id}/access")
async def set_student_access(student_id: str, body: AccessLockBody,
                             admin: CurrentUser = Depends(require_admin)):
    """Lock or unlock a student's access to teacher-led classes and/or the
    community. The account stays usable otherwise — this is not a suspension."""
    student = await Student.find_one(Student.student_id == student_id)
    if not student:
        raise NotFoundError("Student not found")
    if body.teacher_class_locked is None and body.community_locked is None:
        raise ValidationAppError("Specify at least one of teacher_class_locked / community_locked")

    if body.teacher_class_locked is not None:
        student.teacher_class_locked = body.teacher_class_locked
    if body.community_locked is not None:
        student.community_locked = body.community_locked
    # The reason only makes sense while something is locked.
    student.access_lock_reason = (
        body.reason if (student.teacher_class_locked or student.community_locked) else None
    )
    student.touch()
    await student.save()

    locked = [name for name, on in (("teacher-led classes", student.teacher_class_locked),
                                    ("community", student.community_locked)) if on]
    await log_activity(
        admin.subject, "student.access", role=admin.role.value,
        target_type="student", target_id=student_id,
        meta={"teacher_class_locked": student.teacher_class_locked,
              "community_locked": student.community_locked, "reason": body.reason},
    )
    return ok(
        student.model_dump(mode="json"),
        f"Access locked: {', '.join(locked)}" if locked else "All access restored",
    )


@router.get("/verification-queue")
async def verification_queue(admin: CurrentUser = Depends(require_admin)):
    items = await Student.find(
        Student.membership_status == MembershipStatus.pending, Student.is_archived == False  # noqa: E712
    ).sort(Student.created_at).to_list()
    ids = [s.student_id for s in items]
    codes = await ActivationCode.find({"code": {"$in": ids}}).to_list() if ids else []
    by_code = {c.code: c.plan for c in codes if c.plan}
    subs = (
        await Subscription.find({"student_id": {"$in": ids}, "is_active": True}).to_list()
        if ids else []
    )
    by_sub = {s.student_id: s.plan for s in subs}
    rows = []
    for s in items:
        row = s.model_dump(mode="json")
        row["plan"] = by_sub.get(s.student_id) or by_code.get(s.student_id)
        rows.append(row)
    return ok(rows)


@router.delete("/students/{student_id}")
async def delete_student(student_id: str, admin: CurrentUser = Depends(require_admin)):
    """Permanently delete a student and cascade-remove all related records."""
    await admin_service.purge_student(student_id)
    await log_activity(
        admin.subject, "student.delete", role=admin.role.value, target_id=student_id,
    )
    return ok(message="Student and all related data permanently deleted")


@router.post("/students/{student_id}/archive")
async def archive_student(student_id: str, reason: str, admin: CurrentUser = Depends(require_admin)):
    student = await Student.find_one(Student.student_id == student_id)
    if not student:
        raise NotFoundError("Student not found")
    student.archive(admin.subject, reason)
    await student.save()
    await log_activity(admin.subject, "student.archive", role=admin.role.value,
                       target_id=student_id, meta={"reason": reason})
    return ok(message="Archived (60-day retention)")


@router.post("/students/{student_id}/restore")
async def restore_student(student_id: str, admin: CurrentUser = Depends(require_super_admin)):
    """Restore is a Super Admin-only action (Global Data Deletion & Recovery Policy)."""
    student = await Student.find_one(Student.student_id == student_id)
    if not student:
        raise NotFoundError("Student not found")
    student.restore()
    await student.save()
    await log_activity(admin.subject, "student.restore", role=admin.role.value, target_id=student_id)
    return ok(message="Restored")


# --------------------------------------------------------------------------
# Centralized Archive & Restore dashboard (Super Admin)
# --------------------------------------------------------------------------
@router.get("/archive/{module}")
async def archived_records(
    module: str,
    admin: CurrentUser = Depends(require_super_admin),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    model = ARCHIVE_MODULES.get(module)
    if model is None:
        raise ValidationAppError(f"module must be one of {sorted(ARCHIVE_MODULES)}")
    query = {"is_archived": True}
    total = await model.find(query).count()
    items = (
        await model.find(query).sort(-model.archived_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    return ok({"items": [i.model_dump(mode="json") for i in items], "total": total,
               "page": page, "page_size": page_size})


@router.post("/archive/{module}/{record_id}/restore")
async def restore_record(module: str, record_id: str,
                         admin: CurrentUser = Depends(require_super_admin)):
    model = ARCHIVE_MODULES.get(module)
    if model is None:
        raise ValidationAppError(f"module must be one of {sorted(ARCHIVE_MODULES)}")
    record = await model.get(record_id)
    if not record or not record.is_archived:
        raise NotFoundError("Archived record not found")
    record.restore()
    await record.save()
    await log_activity(admin.subject, "archive.restore", role=admin.role.value,
                       target_type=module, target_id=record_id)
    return ok(message="Restored")


@router.delete("/archive/{module}/{record_id}")
async def permanent_delete(module: str, record_id: str,
                           admin: CurrentUser = Depends(require_super_admin)):
    """Permanent deletion is allowed only after the 60-day retention period."""
    model = ARCHIVE_MODULES.get(module)
    if model is None:
        raise ValidationAppError(f"module must be one of {sorted(ARCHIVE_MODULES)}")
    record = await model.get(record_id)
    if not record or not record.is_archived:
        raise NotFoundError("Archived record not found")
    now = datetime.now(timezone.utc)
    auto_delete_at = record.auto_delete_at
    if auto_delete_at and auto_delete_at.tzinfo is None:
        auto_delete_at = auto_delete_at.replace(tzinfo=timezone.utc)
    if auto_delete_at is None or auto_delete_at > now:
        raise ConflictError("Permanent deletion is allowed only after the 60-day retention period")
    await record.delete()
    await log_activity(admin.subject, "archive.permanent_delete", role=admin.role.value,
                       target_type=module, target_id=record_id)
    return ok(message="Permanently deleted")


# --------------------------------------------------------------------------
# Users / staff / passwords
# --------------------------------------------------------------------------
class PasswordReset(BaseModel):
    username: str
    # Enforced on the wire, not just in the browser. This endpoint used to
    # accept any string (even ""), so a mistyped or truncated password locked
    # the account out silently — which is exactly how a super admin lost
    # admin@speakedge.in. MIN_PASSWORD_LENGTH matches /auth/reset-password.
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


@router.post("/users/reset-password")
async def reset_password(body: PasswordReset, admin: CurrentUser = Depends(require_admin)):
    user = await User.find_one(
        {"$or": [{"username": body.username}, {"student_id": body.username}]}
    )
    if not user:
        raise NotFoundError("User not found")
    user.password_hash = hash_password(body.new_password)
    await user.save()
    await log_activity(admin.subject, "user.reset_password", role=admin.role.value, target_id=body.username)
    return ok(message="Password reset")


class CreateStaff(BaseModel):
    username: str
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)
    role: Role
    full_name: str | None = None
    email: str | None = None


@router.post("/users/staff")
async def create_staff(body: CreateStaff, admin: CurrentUser = Depends(require_admin)):
    user = await auth_service.create_user(
        body.username, body.password, body.role, full_name=body.full_name, email=body.email
    )
    await log_activity(admin.subject, "user.create_staff", role=admin.role.value,
                       target_id=body.username, meta={"role": body.role.value})
    return ok({"id": str(user.id), "username": user.username, "role": user.role.value})


@router.get("/users/staff")
async def list_staff(admin: CurrentUser = Depends(require_admin), role: Role | None = None,
                     q: str | None = None):
    """Staff / non-student accounts for the Roles & Permissions screen."""
    query: dict = {} if role else {"role": {"$ne": Role.student.value}}
    if role:
        query["role"] = role.value
    if q:
        query["$or"] = [
            {"username": {"$regex": q, "$options": "i"}},
            {"full_name": {"$regex": q, "$options": "i"}},
            {"email": {"$regex": q, "$options": "i"}},
        ]
    users = await User.find(query).sort(-User.created_at).limit(200).to_list()
    return ok([{
        "id": str(u.id), "username": u.username, "full_name": u.full_name,
        "email": u.email, "role": u.role.value, "is_active": u.is_active,
        "student_id": u.student_id, "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    } for u in users])


class BlockUser(BaseModel):
    reason: str | None = None


@router.post("/users/{username}/block")
async def block_user(username: str, body: BlockUser | None = None,
                     admin: CurrentUser = Depends(require_admin)):
    """Disable a login (User.is_active=False). Login already rejects inactive users."""
    user = await User.find_one({"$or": [{"username": username}, {"student_id": username}]})
    if not user:
        raise NotFoundError("User not found")
    if user.role == Role.super_admin:
        raise ConflictError("A Super Admin account cannot be blocked")
    user.is_active = False
    user.touch()
    await user.save()
    await log_activity(admin.subject, "user.block", role=admin.role.value,
                       target_id=username, meta={"reason": body.reason if body else None})
    return ok(message="User blocked")


@router.post("/users/{username}/unblock")
async def unblock_user(username: str, admin: CurrentUser = Depends(require_admin)):
    user = await User.find_one({"$or": [{"username": username}, {"student_id": username}]})
    if not user:
        raise NotFoundError("User not found")
    user.is_active = True
    user.touch()
    await user.save()
    await log_activity(admin.subject, "user.unblock", role=admin.role.value, target_id=username)
    return ok(message="User unblocked")


# --------------------------------------------------------------------------
# Exclusive Offer System (Module 10: admin sends targeted offers)
# --------------------------------------------------------------------------
class OfferBody(BaseModel):
    title: str
    body: str
    image_url: str | None = None
    offer_type: str = "subscription_upgrade"
    plan: str | None = None
    amount: int | None = None  # paise
    target_student_ids: list[str] = []  # empty = all students
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    active: bool = True


@router.post("/offers/upload-image")
async def upload_offer_image(
    file: UploadFile = File(...),
    admin: CurrentUser = Depends(require_admin),
):
    if file.content_type not in file_service.ALLOWED_IMAGE_TYPES:
        raise ValidationAppError("Banner image must be JPEG, PNG, or WebP")
    url = file_service.save_offer_banner(await file.read())
    await log_activity(admin.subject, "offer.banner_upload", role=admin.role.value)
    return ok({"url": url})


@router.post("/offers")
async def create_offer(body: OfferBody, admin: CurrentUser = Depends(require_admin)):
    offer = Offer(**body.model_dump())
    await offer.insert()
    await log_activity(admin.subject, "offer.create", role=admin.role.value, target_id=str(offer.id))
    return ok(offer.model_dump(mode="json"))


@router.get("/offers")
async def list_offers(admin: CurrentUser = Depends(require_admin), include_expired: bool = True):
    """Expired offers remain visible to Admin for reporting."""
    offers = await Offer.find(Offer.is_archived == False).sort(-Offer.created_at).to_list()  # noqa: E712
    return ok([o.model_dump(mode="json") for o in offers])


@router.patch("/offers/{offer_id}")
async def update_offer(offer_id: str, body: OfferBody, admin: CurrentUser = Depends(require_admin)):
    offer = await Offer.get(offer_id)
    if not offer:
        raise NotFoundError("Offer not found")
    for k, v in body.model_dump().items():
        setattr(offer, k, v)
    offer.touch()
    await offer.save()
    return ok(offer.model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Attendance confirmations (24h notice → 18h deadline → seat auto-cancelled)
# ---------------------------------------------------------------------------
@router.get("/attendance-confirmations")
async def attendance_confirmations(
    _admin: CurrentUser = Depends(require_admin),
    status: str | None = Query(None, pattern="^(pending|confirmed|declined|expired)$"),
    source: str | None = Query(None, pattern="^(batch|community)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Monitoring view for the attendance workflow — who was asked, who
    answered, and whose seat was auto-cancelled."""
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    if source:
        query["source"] = source
    total = await ClassConfirmation.find(query).count()
    recs = (
        await ClassConfirmation.find(query).sort(-ClassConfirmation.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    smap = await load_students_map([r.student_id for r in recs])
    rows = []
    for r in recs:
        row = {
            "id": str(r.id), "source": r.source, "class_ref": r.class_ref,
            "class_title": r.class_title, "class_date": r.class_date,
            "class_time": r.class_time, "student_id": r.student_id,
            "status": r.status,
            "notified_at": r.notified_at.isoformat(),
            "deadline_at": r.deadline_at.isoformat(),
            "responded_at": r.responded_at.isoformat() if r.responded_at else None,
            "cancel_notified": r.cancel_notified,
        }
        row.update(student_avatar_fields(smap.get(r.student_id), "student"))
        rows.append(row)
    counts: dict[str, int] = {}
    for state in ("pending", "confirmed", "declined", "expired"):
        counts[state] = await ClassConfirmation.find(
            {"is_archived": False, "status": state}).count()
    return ok({
        "items": rows, "total": total, "page": page, "page_size": page_size,
        "counts": counts,
    })


@router.get("/activity-logs")
async def activity_logs(
    admin: CurrentUser = Depends(require_admin),
    actor: str | None = None,
    action: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    query: dict = {}
    if actor:
        query["actor"] = actor
    if action:
        query["action"] = action
    total = await ActivityLog.find(query).count()
    items = (
        await ActivityLog.find(query).sort(-ActivityLog.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    return ok({
        "items": [a.model_dump(mode="json") for a in items],
        "total": total, "page": page, "page_size": page_size,
    })
