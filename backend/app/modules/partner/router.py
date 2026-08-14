"""Sujyoti EdTech Partner Network (Module 4): 4 partner types, application ->
admin review (pending/under_review/approved/rejected/on_hold) -> Partner ID +
dashboard -> lead management -> sales/admission reporting (pending admin
approval) -> franchisee microsite -> public directory."""
import secrets

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr

from app.core.envelope import ok
from app.core.exceptions import ForbiddenError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_role
from app.core.security import Role
from app.db.models import Partner, PartnerLead, PartnerReport, PartnerType
from app.shared.audit import log_activity

router = APIRouter(prefix="/partner", tags=["partner"])

require_partner = require_role(Role.partner)

LEAD_STATUSES = {"new", "contacted", "demo_registered", "admission_pending", "converted", "lost"}
PARTNER_STATUSES = {"pending", "under_review", "approved", "rejected", "on_hold", "suspended"}
REPORT_TYPES = {"book_sale", "course_admission", "membership_sale", "student_registration"}


def _partner_id() -> str:
    return "PTR-26-" + secrets.token_hex(3).upper()


async def _own_partner(user: CurrentUser) -> Partner:
    p = await Partner.find_one(Partner.username == user.subject)
    if not p:
        raise NotFoundError("No partner profile linked to this account")
    return p


async def _partner_for(user: CurrentUser, partner_id: str) -> Partner:
    """Partners may only act on their own record; admins on any."""
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    if not user.is_admin and p.username != user.subject:
        raise ForbiddenError("Not your partner account")
    return p


# --------------------------------------------------------------------------
# Part B — Become a Partner form (kept intentionally simple per spec)
# --------------------------------------------------------------------------
class PartnerApplication(BaseModel):
    partner_type: PartnerType
    name: str  # Full Name / Contact Person Name
    org: str | None = None  # optional for Individual & Franchisee applicants
    phone: str
    whatsapp: str
    email: EmailStr | None = None
    state: str
    district: str
    area: str
    # SpeakEdge | Sujyoti Language School | Sujyoti Publications | Franchisee | All
    interested_in: list[str] = []
    consent_contact: bool = False


@router.post("/apply")
async def apply(body: PartnerApplication):
    if not body.consent_contact:
        raise ValidationAppError("Please agree to be contacted by the Sujyoti EdTech team")
    p = Partner(**body.model_dump())
    await p.insert()
    return ok({"id": str(p.id), "status": p.status},
              "Thank you. Your partnership application has been received. "
              "Our team will contact you shortly.")


# --------------------------------------------------------------------------
# Part C / F — Admin approval workflow & directory management
# --------------------------------------------------------------------------
@router.get("/applications")
async def list_applications(
    admin: CurrentUser = Depends(require_admin),
    status: str | None = None,
    partner_type: PartnerType | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    if partner_type:
        query["partner_type"] = partner_type.value
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}},
                        {"org": {"$regex": q, "$options": "i"}},
                        {"phone": {"$regex": q, "$options": "i"}}]
    total = await Partner.find(query).count()
    items = (
        await Partner.find(query).sort(-Partner.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    return ok({"items": [p.model_dump(mode="json") for p in items], "total": total,
               "page": page, "page_size": page_size})


class StatusBody(BaseModel):
    status: str  # pending | under_review | approved | rejected | on_hold | suspended
    remarks: str | None = None
    products_allowed: list[str] | None = None
    username: str | None = None  # link a partner login for dashboard access
    public_visible: bool | None = None


@router.post("/{partner_id}/status")
async def set_status(partner_id: str, body: StatusBody,
                     admin: CurrentUser = Depends(require_admin)):
    if body.status not in PARTNER_STATUSES:
        raise ValidationAppError(f"status must be one of {sorted(PARTNER_STATUSES)}")
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    p.status = body.status
    if body.remarks is not None:
        p.remarks = body.remarks
    if body.products_allowed is not None:
        p.products_allowed = body.products_allowed
    if body.username is not None:
        p.username = body.username
    if body.public_visible is not None:
        p.public_visible = body.public_visible
    if body.status == "approved":
        if not p.partner_id:
            p.partner_id = _partner_id()
        # Franchisee microsite only for Complete Sujyoti Franchisee Partners.
        if p.partner_type == PartnerType.franchisee and not p.microsite_slug:
            p.microsite_slug = (p.org or p.name).lower().replace(" ", "-")[:40]
    p.touch()
    await p.save()
    await log_activity(admin.subject, "partner.status", role=admin.role.value,
                       target_id=partner_id, meta={"status": body.status})
    return ok(p.model_dump(mode="json"))


# --------------------------------------------------------------------------
# Part A — public directory & franchisee microsite
# --------------------------------------------------------------------------
@router.get("/directory")
async def directory(
    partner_type: PartnerType | None = None,
    state: str | None = None,
    district: str | None = None,
):
    query: dict = {"status": "approved", "public_visible": True, "is_archived": False}
    if partner_type:
        query["partner_type"] = partner_type.value
    if state:
        query["state"] = state
    if district:
        query["district"] = district
    partners = await Partner.find(query).to_list()
    # Public directory shows contact details per spec (name/type/address/mobile).
    return ok([
        p.model_dump(mode="json", exclude={"username", "remarks", "consent_contact"})
        for p in partners
    ])


@router.get("/microsite/{slug}")
async def microsite(slug: str):
    p = await Partner.find_one(Partner.microsite_slug == slug, Partner.status == "approved")
    if not p:
        raise NotFoundError("Microsite not found")
    return ok(p.model_dump(mode="json", exclude={"username", "remarks", "consent_contact"}))


# --------------------------------------------------------------------------
# Part D — Partner dashboard: summary, leads, sales reporting
# --------------------------------------------------------------------------
@router.get("/dashboard")
async def dashboard(user: CurrentUser = Depends(require_partner)):
    p = await _own_partner(user)
    pid = str(p.id)
    leads_total = await PartnerLead.find(PartnerLead.partner_id == pid).count()
    leads_converted = await PartnerLead.find(
        PartnerLead.partner_id == pid, PartnerLead.status == "converted"
    ).count()
    reports = await PartnerReport.find(PartnerReport.partner_id == pid).to_list()
    approved = [r for r in reports if r.status == "approved"]
    return ok({
        "id": pid,  # Mongo document id — used by the partner dashboard for lead/report calls
        "partner_id": p.partner_id, "name": p.name,
        "partner_type": p.partner_type.value, "status": p.status,
        "products_allowed": p.products_allowed,
        "performance": {
            "total_leads": leads_total,
            "converted_leads": leads_converted,
            "total_book_sales": sum(r.quantity for r in approved if r.report_type == "book_sale"),
            "total_admissions": sum(r.quantity for r in approved if r.report_type == "course_admission"),
            "total_membership_sales": sum(r.quantity for r in approved if r.report_type == "membership_sale"),
            "pending_approval_reports": sum(1 for r in reports if r.status == "pending"),
        },
    })


class LeadBody(BaseModel):
    name: str
    phone: str
    interest: str | None = None  # product / service interest
    notes: str | None = None


@router.post("/{partner_id}/leads")
async def add_lead(partner_id: str, body: LeadBody, user: CurrentUser = Depends(require_partner)):
    await _partner_for(user, partner_id)
    lead = PartnerLead(partner_id=partner_id, **body.model_dump())
    await lead.insert()
    return ok(lead.model_dump(mode="json"))


class LeadUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    interest: str | None = None
    status: str | None = None  # new | contacted | demo_registered | admission_pending | converted | lost
    notes: str | None = None


@router.patch("/leads/{lead_id}")
async def update_lead(lead_id: str, body: LeadUpdate, user: CurrentUser = Depends(require_partner)):
    lead = await PartnerLead.get(lead_id)
    if not lead:
        raise NotFoundError("Lead not found")
    await _partner_for(user, lead.partner_id)
    if body.status and body.status not in LEAD_STATUSES:
        raise ValidationAppError(f"status must be one of {sorted(LEAD_STATUSES)}")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(lead, k, v)
    lead.touch()
    await lead.save()
    return ok(lead.model_dump(mode="json"))


@router.get("/{partner_id}/leads")
async def list_leads(partner_id: str, user: CurrentUser = Depends(require_partner),
                     status: str | None = None):
    await _partner_for(user, partner_id)
    query: dict = {"partner_id": partner_id, "is_archived": False}
    if status:
        query["status"] = status
    leads = await PartnerLead.find(query).sort(-PartnerLead.created_at).to_list()
    return ok([lead.model_dump(mode="json") for lead in leads])


class ReportBody(BaseModel):
    report_type: str  # book_sale | course_admission | membership_sale | student_registration
    product: str | None = None
    quantity: int = 1
    amount: int | None = None  # paise
    remarks: str | None = None


@router.post("/{partner_id}/reports")
async def submit_report(partner_id: str, body: ReportBody,
                        user: CurrentUser = Depends(require_partner)):
    """Sales/admission reporting — stays Pending Admin Approval until approved."""
    await _partner_for(user, partner_id)
    if body.report_type not in REPORT_TYPES:
        raise ValidationAppError(f"report_type must be one of {sorted(REPORT_TYPES)}")
    report = PartnerReport(partner_id=partner_id, **body.model_dump())
    await report.insert()
    return ok(report.model_dump(mode="json"), "Report submitted. Pending admin approval.")


@router.get("/{partner_id}/reports")
async def list_reports(partner_id: str, user: CurrentUser = Depends(require_partner),
                       status: str | None = None):
    await _partner_for(user, partner_id)
    query: dict = {"partner_id": partner_id, "is_archived": False}
    if status:
        query["status"] = status
    items = await PartnerReport.find(query).sort(-PartnerReport.created_at).to_list()
    return ok([r.model_dump(mode="json") for r in items])


class ReportReview(BaseModel):
    action: str = "approve"  # approve | reject


@router.post("/reports/{report_id}/review")
async def review_report(report_id: str, body: ReportReview,
                        admin: CurrentUser = Depends(require_admin)):
    """Only after approval does data become final and visible in reports."""
    report = await PartnerReport.get(report_id)
    if not report:
        raise NotFoundError("Report not found")
    report.status = "approved" if body.action == "approve" else "rejected"
    report.reviewed_by = admin.subject
    report.touch()
    await report.save()
    await log_activity(admin.subject, "partner.report_review", role=admin.role.value,
                       target_id=report_id, meta={"action": body.action})
    return ok(report.model_dump(mode="json"))


@router.get("/admin/reports")
async def admin_reports(admin: CurrentUser = Depends(require_admin), status: str | None = None):
    """All partner sales/admission reports with partner context (admin review queue)."""
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    reports = await PartnerReport.find(query).sort(-PartnerReport.created_at).limit(300).to_list()
    oids = [PydanticObjectId(r.partner_id) for r in reports if PydanticObjectId.is_valid(r.partner_id)]
    names = {str(p.id): p.name
             for p in await Partner.find({"_id": {"$in": oids}}).to_list()} if oids else {}
    rows = []
    for r in reports:
        data = r.model_dump(mode="json")
        data["partner_name"] = names.get(r.partner_id)
        rows.append(data)
    return ok(rows)


class PartnerAdminPatch(BaseModel):
    name: str | None = None
    org: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    email: EmailStr | None = None
    state: str | None = None
    district: str | None = None
    area: str | None = None
    partner_type: PartnerType | None = None
    public_visible: bool | None = None
    products_allowed: list[str] | None = None


@router.patch("/{partner_id}")
async def admin_edit_partner(partner_id: str, body: PartnerAdminPatch,
                             admin: CurrentUser = Depends(require_admin)):
    """Directory management: edit partner details / location / visibility."""
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    data = body.model_dump(exclude_none=True)
    if "partner_type" in data:
        data["partner_type"] = body.partner_type
    for k, v in data.items():
        setattr(p, k, v)
    p.touch()
    await p.save()
    await log_activity(admin.subject, "partner.edit", role=admin.role.value,
                       target_id=partner_id, meta={"fields": list(data.keys())})
    return ok(p.model_dump(mode="json"))
