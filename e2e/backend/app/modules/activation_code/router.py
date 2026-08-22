from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel

from app.core.envelope import ok
from app.core.rbac import CurrentUser, require_admin
from app.db.models import ActivationCode, CodeStatus, PromptAudience
from app.modules.activation_code import service
from app.modules.membership import service as membership_service
from app.modules.membership.router import validated_registration
from app.shared.audit import log_activity
from app.shared.students import load_students_map, student_avatar_fields

router = APIRouter(prefix="/activation-codes", tags=["activation-codes"])


class GenerateRequest(BaseModel):
    count: int = 100
    # Which course these codes enrol into. Kids and Adults are separate courses
    # and the code is what decides — the student never picks.
    audience: PromptAudience = PromptAudience.adults


class StatusRequest(BaseModel):
    code: str
    status: CodeStatus
    reason: str | None = None


class AudienceRequest(BaseModel):
    code: str
    audience: PromptAudience


@router.post("/generate")
async def generate(body: GenerateRequest, admin: CurrentUser = Depends(require_admin)):
    result = await service.generate_batch(body.count, admin.subject, body.audience)
    await log_activity(admin.subject, "activation.generate", role=admin.role.value,
                       meta={"batch_id": result["batch_id"], "generated": result["generated"],
                             "audience": body.audience.value})
    return ok(result, f"Generated {result['generated']} {body.audience.value} codes")


@router.post("/audience")
async def set_audience(body: AudienceRequest, admin: CurrentUser = Depends(require_admin)):
    """Re-point an unused code at the other course."""
    ac = await service.set_audience(body.code, body.audience)
    await log_activity(admin.subject, "activation.audience", role=admin.role.value,
                       target_id=body.code, meta={"audience": body.audience.value})
    return ok(ac.model_dump(mode="json"), f"Code moved to the {body.audience.value} course")


@router.get("/")
async def list_codes(
    admin: CurrentUser = Depends(require_admin),
    status: CodeStatus | None = None,
    audience: PromptAudience | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
):
    query = {"is_archived": False}
    if status:
        query["status"] = status.value
    if audience:
        query["audience"] = audience.value
    if q:
        query["code"] = {"$regex": q, "$options": "i"}
    total = await ActivationCode.find(query).count()
    items = (
        await ActivationCode.find(query)
        .sort(-ActivationCode.created_at)
        .skip((page - 1) * page_size)
        .limit(page_size)
        .to_list()
    )
    smap = await load_students_map(c.activated_student_id for c in items if c.activated_student_id)
    rows = []
    for c in items:
        row = c.model_dump(mode="json")
        if c.activated_student_id:
            row.update(student_avatar_fields(smap.get(c.activated_student_id), "activated_student"))
        rows.append(row)
    return ok({
        "items": rows,
        "total": total, "page": page, "page_size": page_size,
    })


@router.post("/status")
async def set_status(body: StatusRequest, admin: CurrentUser = Depends(require_admin)):
    ac = await service.set_status(body.code, body.status, body.reason)
    await log_activity(admin.subject, "activation.status", role=admin.role.value,
                       target_id=body.code, meta={"status": body.status.value})
    return ok(ac.model_dump(mode="json"))


@router.get("/stats")
async def stats(admin: CurrentUser = Depends(require_admin)):
    """Admin dashboard statistics: totals per status + activation percentage."""
    total = await ActivationCode.find(ActivationCode.is_archived == False).count()  # noqa: E712
    unused = await ActivationCode.find(ActivationCode.status == CodeStatus.unused).count()
    activated = await ActivationCode.find(ActivationCode.status == CodeStatus.activated).count()
    blocked = await ActivationCode.find(ActivationCode.status == CodeStatus.blocked).count()
    return ok({
        "total_generated": total,
        "unused": unused,
        "activated": activated,
        "blocked": blocked,
        "activation_percentage": round(activated / total * 100, 2) if total else 0,
    })


class BulkDeleteRequest(BaseModel):
    codes: list[str]
    reason: str | None = None


@router.post("/manual-activate")
async def manual_activate(
    admin: CurrentUser = Depends(require_admin),
    code: str = Form(...),
    full_name: str = Form(...),
    dob: str = Form(...),
    gender: str = Form(...),
    phone: str = Form(...),
    whatsapp: str = Form(...),
    address: str = Form(...),
    state: str = Form(...),
    district: str = Form(...),
    pin_code: str = Form(...),
    password: str = Form(..., min_length=6),
    education_level: str = Form(...),
    email: str | None = Form(None),
    cefr_level: str | None = Form(None),
    about_me: str | None = Form(None),
    consent_community_rules: bool = Form(False),
    consent_terms: bool = Form(False),
    consent_safety_policy: bool = Form(False),
    consent_non_refund: bool = Form(False),
    consent_process: bool = Form(False),
    guardian_name: str | None = Form(None),
    guardian_relationship: str | None = Form(None),
    guardian_phone: str | None = Form(None),
    guardian_email: str | None = Form(None),
    consent_guardian: bool = Form(False),
    reason: str | None = Form(None),
    id_proof_type: str = Form(...),
    photo: UploadFile = File(...),
    id_proof: UploadFile = File(...),
    education_proof: UploadFile = File(...),
):
    """Admin manual enrollment: same workflow as public activation (Module 7/8)."""
    fields = await validated_registration(
        dob=dob, cefr_level=cefr_level, about_me=about_me,
        id_proof_type=id_proof_type, education_level=education_level,
        photo=photo, id_proof=id_proof, education_proof=education_proof,
        guardian_name=guardian_name, guardian_relationship=guardian_relationship,
        guardian_phone=guardian_phone, guardian_email=guardian_email,
        consent_guardian=consent_guardian,
    )

    student = await membership_service.activate_membership(
        code, full_name=full_name, password=password, gender=gender,
        email=email, phone=phone, whatsapp=whatsapp, address=address,
        state=state, district=district, pin_code=pin_code,
        consent_community_rules=consent_community_rules, consent_terms=consent_terms,
        consent_safety_policy=consent_safety_policy, consent_non_refund=consent_non_refund,
        consent_process=consent_process,
        **fields,
    )
    await log_activity(
        admin.subject, "activation.manual_activate", role=admin.role.value,
        target_type="student", target_id=student.student_id,
        meta={"code": code, "reason": reason},
    )
    return ok(
        {"student_id": student.student_id, "membership_status": student.membership_status.value},
        "Student enrolled — pending verification",
    )


@router.delete("/{code}")
async def delete_code(code: str, admin: CurrentUser = Depends(require_admin)):
    """Archive unused/blocked codes (60-day retention, restorable from Archive)."""
    ac = await service.delete_code(code, admin.subject)
    await log_activity(admin.subject, "activation.delete", role=admin.role.value, target_id=code)
    return ok(ac.model_dump(mode="json"), "Code archived")


@router.post("/bulk-delete")
async def bulk_delete(body: BulkDeleteRequest, admin: CurrentUser = Depends(require_admin)):
    result = await service.bulk_delete(body.codes, admin.subject, body.reason)
    if result["deleted"]:
        await log_activity(
            admin.subject, "activation.bulk_delete", role=admin.role.value,
            meta={"deleted": result["deleted"], "skipped": len(result["skipped"])},
        )
    return ok(result, f"Deleted {result['deleted']} code(s)")


@router.get("/export")
async def export_codes(admin: CurrentUser = Depends(require_admin),
                       batch_id: str | None = None, format: str = "csv"):
    """Activation codes as CSV (default) or XLSX."""
    from app.modules.analytics.router import _export_response

    query = {"is_archived": False}
    if batch_id:
        query["batch_id"] = batch_id
    codes = await ActivationCode.find(query).sort(-ActivationCode.created_at).to_list()
    rows = ([c.code, c.audience.value, c.status.value, c.batch_id,
             c.created_at.isoformat(), c.activated_student_id or ""] for c in codes)
    return _export_response("activation_codes",
                            ["code", "course", "status", "batch_id", "created_at",
                             "activated_student_id"], rows, format)
