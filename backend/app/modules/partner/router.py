"""Sujyoti EdTech Partner Network (Module 4 / CR Parts A–F).

    partnership enquiry -> admin review -> approval (Partner ID + login)
      -> partner dashboard -> lead & sales reporting -> admin verification
      -> final reports & public visibility

The initial application stays deliberately tiny (Part B); everything detailed
is collected after approval, from the dashboard. Three rules run through the
whole module:

* **Approval gates the numbers.** A partner-submitted report is ``pending``
  until an admin approves it, and only approved rows reach any total, report
  or export (``service`` is the single place that decides this).
* **Partners only ever touch their own record** — ``_partner_for`` enforces it
  on every write, admins pass through.
* **Product/service access is per partner.** Leads and sales reports are
  validated against that partner's ``products_allowed``.

Part E adds the franchisee microsite: an admin-managed one-page site at
``/franchisee/<slug>`` whose enquiry form files straight into that
franchisee's own lead list.
"""
import re
import secrets

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from pydantic import BaseModel, EmailStr

from app.core.config import settings
from app.core.envelope import ok
from app.core.exceptions import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    ValidationAppError,
)
from app.core.ratelimit import rate_limit
from app.core.rbac import CurrentUser, require_admin, require_partner
from app.core.security import Role
from app.db.base import utcnow
from app.db.models import Partner, PartnerLead, PartnerReport, PartnerType, User
from app.modules.auth import service as auth_service
from app.modules.notification import service as notif
from app.modules.partner import service as perf
from app.shared import file_service
from app.shared.audit import log_activity
from app.shared.exports import EXPORT_FORMATS, export_response

router = APIRouter(prefix="/partner", tags=["partner"])

LEAD_STATUSES = set(perf.LEAD_STATUSES)
PARTNER_STATUSES = {"pending", "under_review", "approved", "rejected", "on_hold", "suspended"}
REPORT_TYPES = set(perf.REPORT_TYPES)
# Statuses that may act on the partner dashboard at all.
ACTIVE_STATUSES = {"approved"}

# The franchisee enquiry form is public and unauthenticated, so it gets the
# same per-IP ceiling as the other public write (login).
_enquiry_limit = rate_limit("partner_enquiry", settings.RATE_LIMIT_AUTH_PER_MIN)

# Fields never exposed on a public payload (directory card or microsite).
_PRIVATE_FIELDS = {"username", "remarks", "consent_contact", "interested_in", "products_allowed"}


def _partner_id() -> str:
    return "PTR-26-" + secrets.token_hex(3).upper()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:40] or secrets.token_hex(4)


async def _unique_slug(base: str, exclude_id: str | None = None) -> str:
    """A franchisee slug is a public URL, so it has to be unique."""
    slug = _slugify(base)
    candidate, n = slug, 1
    while True:
        clash = await Partner.find_one(Partner.microsite_slug == candidate)
        if not clash or str(clash.id) == exclude_id:
            return candidate
        n += 1
        candidate = f"{slug}-{n}"


async def _ensure_partner_login(p: Partner) -> dict | None:
    """Give an approved partner an account they can actually sign in with.

    Approval used to only stamp `username` on the Partner row, so the partner
    dashboard was unreachable — nothing ever created the matching User. The
    generated password is returned once, for the admin to hand over; it is
    never stored in the clear and never logged.
    """
    p.username = p.username or p.partner_id
    if await User.find_one(User.username == p.username):
        return None
    password = secrets.token_urlsafe(9)
    await auth_service.create_user(
        p.username, password, Role.partner, full_name=p.name, email=p.email,
    )
    return {"username": p.username, "password": password}


async def _own_partner(user: CurrentUser) -> Partner:
    p = await Partner.find_one(Partner.username == user.subject)
    if not p:
        raise NotFoundError("No partner profile linked to this account")
    return p


async def _active_partner(user: CurrentUser) -> Partner:
    """Own partner record, refused while the account is not approved.

    A suspended or deactivated partner keeps their login (so they can see why)
    but must not be able to file new leads or sales.
    """
    p = await _own_partner(user)
    if p.status not in ACTIVE_STATUSES:
        raise ForbiddenError(
            f"Your partner account is {p.status.replace('_', ' ')}. "
            "Please contact the Sujyoti EdTech team."
        )
    return p


async def _partner_for(user: CurrentUser, partner_id: str) -> Partner:
    """Partners may only act on their own record; admins on any."""
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    if not user.is_admin:
        if p.username != user.subject:
            raise ForbiddenError("Not your partner account")
        if p.status not in ACTIVE_STATUSES:
            raise ForbiddenError(f"Your partner account is {p.status.replace('_', ' ')}.")
    return p


def _check_product(p: Partner, product: str | None) -> None:
    """Product-wise access control: a partner may only sell what admin allowed."""
    if product and p.products_allowed and product not in p.products_allowed:
        raise ValidationAppError(
            f"'{product}' is not in your allowed products/services: "
            + ", ".join(p.products_allowed)
        )


def _public_products(p: Partner) -> list[str]:
    """Products shown publicly — the opt-in subset, else everything allowed."""
    return p.public_products or p.products_allowed


def _public_partner(p: Partner) -> dict:
    data = p.model_dump(mode="json", exclude=_PRIVATE_FIELDS)
    data["products"] = _public_products(p)
    return data


def _profile(p: Partner) -> dict:
    """Dashboard Home: identity + approval state + allowed products + profile."""
    return {
        "id": str(p.id),  # Mongo document id — used for the partner's lead/report calls
        "partner_id": p.partner_id,
        "name": p.name,
        "org": p.org,
        "partner_type": p.partner_type.value,
        "status": p.status,
        "products_allowed": p.products_allowed,
        "interested_in": p.interested_in,
        "remarks": p.remarks,
        "profile": {
            "phone": p.phone, "whatsapp": p.whatsapp, "email": p.email,
            "address": p.address, "area": p.area, "district": p.district,
            "state": p.state, "about": p.about,
        },
        "public_visible": p.public_visible,
        "microsite_slug": p.microsite_slug,
        "microsite_published": p.microsite_published,
        "microsite_url": f"/franchisee/{p.microsite_slug}" if p.microsite_slug else None,
        "joined_at": p.created_at.isoformat(),
    }


# ==========================================================================
# Part B — Become a Partner form (kept intentionally simple per spec)
# ==========================================================================
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
    await notif.notify("admins", "New Partner Application",
                       f"{p.name} ({p.partner_type.value}) applied from "
                       f"{', '.join(filter(None, [p.district, p.state]))}.",
                       kind="partner", push_url="/admin/partners")
    return ok({"id": str(p.id), "status": p.status},
              "Thank you. Your partnership application has been received. "
              "Our team will contact you shortly.")


# ==========================================================================
# Part A / E — public directory & franchisee microsite
# ==========================================================================
@router.get("/directory")
async def directory(
    partner_type: PartnerType | None = None,
    state: str | None = None,
    district: str | None = None,
    product: str | None = None,
    q: str | None = None,
):
    query: dict = {"status": "approved", "public_visible": True, "is_archived": False}
    if partner_type:
        query["partner_type"] = partner_type.value
    if state:
        query["state"] = state
    if district:
        query["district"] = district
    partners = await Partner.find(query).to_list()
    rows = [_public_partner(p) for p in partners]
    if product:
        rows = [r for r in rows if product in r["products"]]
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in
                f"{r.get('name') or ''} {r.get('org') or ''} {r.get('area') or ''} "
                f"{r.get('district') or ''}".lower()]
    rows.sort(key=lambda r: (r.get("state") or "", r.get("district") or "", r["name"]))
    return ok(rows)


@router.get("/directory/filters")
async def directory_filters():
    """The state / district / product values that actually have partners, so
    the public filter UI never offers an empty result."""
    partners = await Partner.find({"status": "approved", "public_visible": True,
                                   "is_archived": False}).to_list()
    products: set[str] = set()
    for p in partners:
        products.update(_public_products(p))
    return ok({
        "states": sorted({p.state for p in partners if p.state}),
        "districts": sorted({p.district for p in partners if p.district}),
        "products": sorted(products),
        "partner_types": [t.value for t in PartnerType],
    })


@router.get("/microsite/{slug}")
async def microsite(slug: str):
    """The franchisee one-page site. Unpublished pages 404 for the public."""
    p = await Partner.find_one(Partner.microsite_slug == slug, Partner.status == "approved")
    if not p or not p.microsite_published or p.is_archived:
        raise NotFoundError("Microsite not found")
    return ok(_public_partner(p))


class EnquiryBody(BaseModel):
    name: str
    phone: str
    email: EmailStr | None = None
    interest: str | None = None  # course / product they asked about
    message: str | None = None
    location: str | None = None


@router.post("/microsite/{slug}/enquiry", dependencies=[Depends(_enquiry_limit)])
async def microsite_enquiry(slug: str, body: EnquiryBody, request: Request):
    """The franchisee page's enquiry form — files straight into that
    franchisee's lead list, which is what "link leads to franchisee dashboard"
    means in practice."""
    p = await Partner.find_one(Partner.microsite_slug == slug, Partner.status == "approved")
    if not p or not p.microsite_published or p.is_archived:
        raise NotFoundError("Microsite not found")
    if not body.name.strip() or not body.phone.strip():
        raise ValidationAppError("Name and phone number are required")

    lead = PartnerLead(
        partner_id=str(p.id), name=body.name.strip(), phone=body.phone.strip(),
        email=body.email, interest=body.interest, notes=body.message,
        location=body.location, source="microsite",
        history=[{"at": utcnow().isoformat(), "by": "website",
                  "from": None, "to": "new", "note": "Enquiry from franchisee page"}],
    )
    await lead.insert()
    if p.username:
        await notif.notify(p.username, "New Enquiry",
                           f"{lead.name} enquired through your franchisee page.",
                           kind="partner", push_url="/partner/leads")
    return ok({"id": str(lead.id)},
              "Thank you. The centre will contact you shortly.")


# ==========================================================================
# Part D — Partner dashboard
# ==========================================================================
@router.get("/dashboard")
async def dashboard(user: CurrentUser = Depends(require_partner)):
    """Dashboard Home + Performance Summary in one call."""
    p = await _own_partner(user)
    data = await perf.performance_for(str(p.id))
    return ok({
        **_profile(p),
        "performance": data["totals"],
        "by_product": data["by_product"],
        "by_type": data["by_type"],
        # Last six months, newest first — the Monthly Performance strip.
        "monthly": data["monthly"][-6:][::-1],
    })


@router.get("/me/performance")
async def my_performance(user: CurrentUser = Depends(require_partner),
                         year: str | None = None):
    """Partner Activities: totals, product-wise, monthly and yearly."""
    p = await _own_partner(user)
    return ok(await perf.performance_for(str(p.id), year))


class ProfilePatch(BaseModel):
    """What a partner may edit about themselves. Partner ID, type, status and
    allowed products stay admin-owned."""
    name: str | None = None
    org: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    area: str | None = None
    district: str | None = None
    state: str | None = None
    about: str | None = None


@router.patch("/me/profile")
async def update_my_profile(body: ProfilePatch, user: CurrentUser = Depends(require_partner)):
    p = await _active_partner(user)
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(p, k, v)
    p.touch()
    await p.save()
    await log_activity(user.subject, "partner.profile_update", role=user.role.value,
                       target_type="partner", target_id=str(p.id),
                       meta={"fields": sorted(data.keys())})
    return ok(_profile(p))


# --- Lead management ------------------------------------------------------
def _lead_row(lead: PartnerLead) -> dict:
    data = lead.model_dump(mode="json")
    data["status_label"] = perf.LEAD_STATUS_LABELS.get(lead.status, lead.status)
    return data


@router.get("/leads/{lead_id}")
async def lead_detail(lead_id: str, user: CurrentUser = Depends(require_partner)):
    """One lead with its full status history."""
    lead = await PartnerLead.get(lead_id)
    if not lead:
        raise NotFoundError("Lead not found")
    await _partner_for(user, lead.partner_id)
    return ok(_lead_row(lead))


class LeadUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    interest: str | None = None
    # new | contacted | demo_registered | admission_pending | converted | lost
    status: str | None = None
    notes: str | None = None
    location: str | None = None
    note: str | None = None  # free-text entry attached to this update's history row


@router.patch("/leads/{lead_id}")
async def update_lead(lead_id: str, body: LeadUpdate,
                      user: CurrentUser = Depends(require_partner)):
    lead = await PartnerLead.get(lead_id)
    if not lead:
        raise NotFoundError("Lead not found")
    partner = await _partner_for(user, lead.partner_id)
    data = body.model_dump(exclude_unset=True)
    note = data.pop("note", None)
    if data.get("status") and data["status"] not in LEAD_STATUSES:
        raise ValidationAppError(f"status must be one of {sorted(LEAD_STATUSES)}")
    if "interest" in data:
        _check_product(partner, data["interest"])

    previous = lead.status
    for k, v in data.items():
        setattr(lead, k, v)
    # Every status move is recorded; a plain edit with a note is recorded too.
    if (data.get("status") and data["status"] != previous) or note:
        lead.history.append({
            "at": utcnow().isoformat(), "by": user.subject,
            "from": previous, "to": lead.status, "note": note,
        })
    lead.touch()
    await lead.save()
    return ok(_lead_row(lead))


class LeadBody(BaseModel):
    name: str
    phone: str
    email: EmailStr | None = None
    interest: str | None = None  # product / service interest
    notes: str | None = None
    location: str | None = None


@router.post("/{partner_id}/leads")
async def add_lead(partner_id: str, body: LeadBody,
                   user: CurrentUser = Depends(require_partner)):
    partner = await _partner_for(user, partner_id)
    _check_product(partner, body.interest)
    lead = PartnerLead(
        partner_id=partner_id, source="partner",
        history=[{"at": utcnow().isoformat(), "by": user.subject,
                  "from": None, "to": "new", "note": "Lead added"}],
        **body.model_dump(),
    )
    await lead.insert()
    return ok(_lead_row(lead))


@router.get("/{partner_id}/leads")
async def list_leads(partner_id: str, user: CurrentUser = Depends(require_partner),
                     status: str | None = None, q: str | None = None):
    await _partner_for(user, partner_id)
    query: dict = {"partner_id": partner_id, "is_archived": False}
    if status:
        query["status"] = status
    leads = await PartnerLead.find(query).sort(-PartnerLead.created_at).to_list()
    rows = [_lead_row(lead) for lead in leads]
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in
                f"{r['name']} {r['phone']} {r.get('interest') or ''}".lower()]
    return ok(rows)


# --- Sales / admission reporting -----------------------------------------
class ReportBody(BaseModel):
    report_type: str  # book_sale | course_admission | membership_sale | student_registration
    product: str | None = None
    quantity: int = 1
    amount: int | None = None  # paise
    remarks: str | None = None
    occurred_on: str | None = None  # "YYYY-MM-DD" — when the sale happened


@router.post("/{partner_id}/reports")
async def submit_report(partner_id: str, body: ReportBody,
                        user: CurrentUser = Depends(require_partner)):
    """Sales/admission reporting — stays Pending Admin Approval until approved."""
    partner = await _partner_for(user, partner_id)
    if body.report_type not in REPORT_TYPES:
        raise ValidationAppError(f"report_type must be one of {sorted(REPORT_TYPES)}")
    if body.quantity < 1:
        raise ValidationAppError("Quantity must be at least 1")
    _check_product(partner, body.product)
    report = PartnerReport(partner_id=partner_id, **body.model_dump())
    await report.insert()
    await notif.notify("admins", "Partner Report Submitted",
                       f"{partner.name} submitted a "
                       f"{perf.REPORT_TYPE_LABELS.get(body.report_type, body.report_type)} "
                       "report for approval.", kind="partner", push_url="/admin/partners")
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


# ==========================================================================
# Reports & exports (partner side) — Excel / CSV / PDF
# ==========================================================================
DATASETS = ("leads", "sales", "monthly", "yearly", "product")


def _dataset_rows(dataset: str, data: dict, leads: list[PartnerLead],
                  reports: list[PartnerReport]) -> tuple[list[str], list[list]]:
    """(header, rows) for one export dataset."""
    if dataset == "leads":
        return (["name", "phone", "email", "interest", "status", "source",
                 "location", "notes", "created_at"],
                [[lead.name, lead.phone, lead.email or "", lead.interest or "",
                  perf.LEAD_STATUS_LABELS.get(lead.status, lead.status), lead.source,
                  lead.location or "", lead.notes or "", lead.created_at.isoformat()]
                 for lead in leads])
    if dataset == "sales":
        return (["date", "report_type", "product", "quantity", "amount_paise",
                 "status", "remarks"],
                [[r.occurred_on or r.created_at.date().isoformat(),
                  perf.REPORT_TYPE_LABELS.get(r.report_type, r.report_type),
                  r.product or "", r.quantity, r.amount or 0, r.status, r.remarks or ""]
                 for r in reports])
    if dataset == "product":
        return (["product", "quantity", "revenue_paise", "reports"],
                [[r["product"], r["quantity"], r["revenue_paise"], r["reports"]]
                 for r in data["by_product"]])
    key = "monthly" if dataset == "monthly" else "yearly"
    return (["period", "book_sales", "course_admissions", "membership_sales",
             "student_registrations", "total_quantity", "revenue_paise"],
            [[r["period"], r["book_sale"], r["course_admission"], r["membership_sale"],
              r["student_registration"], r["quantity"], r["revenue_paise"]]
             for r in data[key]])


async def _export(partner: Partner, dataset: str, fmt: str, year: str | None):
    if dataset not in DATASETS:
        raise ValidationAppError(f"dataset must be one of {sorted(DATASETS)}")
    if fmt not in EXPORT_FORMATS:
        raise ValidationAppError(f"format must be one of {sorted(EXPORT_FORMATS)}")
    pid = str(partner.id)
    data = await perf.performance_for(pid, year)
    leads = await PartnerLead.find(PartnerLead.partner_id == pid,
                                   PartnerLead.is_archived == False).to_list()  # noqa: E712
    reports = await PartnerReport.find(PartnerReport.partner_id == pid,
                                       PartnerReport.is_archived == False).to_list()  # noqa: E712
    header, rows = _dataset_rows(dataset, data, leads, reports)
    label = partner.partner_id or partner.name
    return export_response(f"partner_{dataset}_{label}", header, rows, fmt,
                           title=f"{partner.name} — {dataset.title()} Report")


@router.get("/me/export")
async def export_my_reports(user: CurrentUser = Depends(require_partner),
                            dataset: str = "monthly", format: str = "csv",
                            year: str | None = None):
    """Download Report (Excel / CSV / PDF) from the partner dashboard."""
    return await _export(await _own_partner(user), dataset, format, year)


# ==========================================================================
# Part C / F — admin: applications, approval, directory & reports
# ==========================================================================
@router.get("/applications")
async def list_applications(
    admin: CurrentUser = Depends(require_admin),
    status: str | None = None,
    partner_type: PartnerType | None = None,
    q: str | None = None,
    state: str | None = None,
    district: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    if partner_type:
        query["partner_type"] = partner_type.value
    if state:
        query["state"] = state
    if district:
        query["district"] = district
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}},
                        {"org": {"$regex": q, "$options": "i"}},
                        {"phone": {"$regex": q, "$options": "i"}},
                        {"partner_id": {"$regex": q, "$options": "i"}}]
    total = await Partner.find(query).count()
    items = (
        await Partner.find(query).sort(-Partner.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    # Lead / report counts so the list doubles as the performance overview.
    ids = [str(p.id) for p in items]
    leads = await PartnerLead.find({"partner_id": {"$in": ids}, "is_archived": False}).to_list()
    reports = await PartnerReport.find({"partner_id": {"$in": ids},
                                        "is_archived": False}).to_list()
    rows = []
    for p in items:
        pid = str(p.id)
        mine = [r for r in reports if r.partner_id == pid]
        data = p.model_dump(mode="json")
        data["total_leads"] = sum(1 for lead in leads if lead.partner_id == pid)
        data["pending_reports"] = sum(1 for r in mine if r.status == "pending")
        data["approved_reports"] = sum(1 for r in mine if r.status == "approved")
        rows.append(data)
    return ok({"items": rows, "total": total, "page": page, "page_size": page_size})


class AdminPartnerBody(BaseModel):
    """Admin-created directory entry — a partner onboarded outside the form."""
    partner_type: PartnerType = PartnerType.individual
    name: str
    org: str | None = None
    phone: str
    whatsapp: str | None = None
    email: EmailStr | None = None
    state: str | None = None
    district: str | None = None
    area: str | None = None
    address: str | None = None
    products_allowed: list[str] = []
    public_visible: bool = True
    approve: bool = True  # directory entries are usually live immediately


@router.post("/admin/create")
async def admin_create_partner(body: AdminPartnerBody,
                               admin: CurrentUser = Depends(require_admin)):
    data = body.model_dump()
    approve = data.pop("approve")
    p = Partner(**data, consent_contact=True)
    credentials = None
    if approve:
        p.status = "approved"
        p.partner_id = _partner_id()
        if p.partner_type == PartnerType.franchisee:
            p.microsite_slug = await _unique_slug(p.org or p.name)
        credentials = await _ensure_partner_login(p)
    await p.insert()
    await log_activity(admin.subject, "partner.create", role=admin.role.value,
                       target_type="partner", target_id=str(p.id))
    out = p.model_dump(mode="json")
    if credentials:
        out["credentials"] = credentials
    return ok(out, "Partner added")


@router.get("/admin/leads")
async def admin_leads(admin: CurrentUser = Depends(require_admin),
                      status: str | None = None, partner_id: str | None = None,
                      source: str | None = None):
    """Every partner lead with its partner resolved (Partner Leads export view)."""
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    if partner_id:
        query["partner_id"] = partner_id
    if source:
        query["source"] = source
    leads = await PartnerLead.find(query).sort(-PartnerLead.created_at).limit(500).to_list()
    names = await _partner_names(lead.partner_id for lead in leads)
    rows = []
    for lead in leads:
        data = _lead_row(lead)
        data["partner_name"] = names.get(lead.partner_id)
        rows.append(data)
    return ok(rows)


async def _partner_names(partner_ids) -> dict[str, str]:
    oids = [PydanticObjectId(pid) for pid in {p for p in partner_ids}
            if PydanticObjectId.is_valid(pid)]
    if not oids:
        return {}
    return {str(p.id): p.name for p in await Partner.find({"_id": {"$in": oids}}).to_list()}


@router.get("/admin/reports")
async def admin_reports(admin: CurrentUser = Depends(require_admin),
                        status: str | None = None, partner_id: str | None = None,
                        report_type: str | None = None):
    """All partner sales/admission reports with partner context (review queue)."""
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    if partner_id:
        query["partner_id"] = partner_id
    if report_type:
        query["report_type"] = report_type
    reports = await PartnerReport.find(query).sort(-PartnerReport.created_at).limit(500).to_list()
    names = await _partner_names(r.partner_id for r in reports)
    rows = []
    for r in reports:
        data = r.model_dump(mode="json")
        data["partner_name"] = names.get(r.partner_id)
        data["label"] = perf.REPORT_TYPE_LABELS.get(r.report_type, r.report_type)
        rows.append(data)
    return ok(rows)


@router.get("/admin/overview")
async def admin_overview(admin: CurrentUser = Depends(require_admin),
                         year: str | None = None):
    """Network-wide performance — the "generate overall reports" view."""
    partners = await Partner.find(Partner.is_archived == False).to_list()  # noqa: E712
    leads = await PartnerLead.find(PartnerLead.is_archived == False).to_list()  # noqa: E712
    reports = await PartnerReport.find(PartnerReport.is_archived == False).to_list()  # noqa: E712
    by_status: dict[str, int] = {}
    for p in partners:
        by_status[p.status] = by_status.get(p.status, 0) + 1
    return ok({
        "partners": {
            "total": len(partners),
            "by_status": by_status,
            "by_type": {t.value: sum(1 for p in partners if p.partner_type == t)
                        for t in PartnerType},
            "microsites_published": sum(1 for p in partners if p.microsite_published),
            "publicly_visible": sum(1 for p in partners
                                    if p.public_visible and p.status == "approved"),
        },
        "totals": perf.totals(reports, leads),
        "by_product": perf.by_product(reports),
        "by_type": perf.by_type(reports),
        "monthly": perf.monthly(reports, year),
        "yearly": perf.yearly(reports),
    })


ADMIN_DATASETS = ("partners", "leads", "sales", "admissions", "product", "monthly", "yearly")


@router.get("/admin/export/{dataset}")
async def admin_export(dataset: str, admin: CurrentUser = Depends(require_admin),
                       format: str = "csv", status: str | None = None,
                       year: str | None = None):
    """Partner list / leads / sales / admissions / product-wise / monthly /
    yearly, as Excel, CSV or PDF."""
    if dataset not in ADMIN_DATASETS:
        raise ValidationAppError(f"dataset must be one of {sorted(ADMIN_DATASETS)}")
    if format not in EXPORT_FORMATS:
        raise ValidationAppError(f"format must be one of {sorted(EXPORT_FORMATS)}")

    if dataset == "partners":
        query: dict = {"is_archived": False}
        if status:
            query["status"] = status
        partners = await Partner.find(query).sort(-Partner.created_at).to_list()
        header = ["partner_id", "name", "org", "partner_type", "status", "phone",
                  "whatsapp", "email", "area", "district", "state",
                  "products_allowed", "public_visible", "microsite_slug", "applied_at"]
        rows = [[p.partner_id or "", p.name, p.org or "", p.partner_type.value, p.status,
                 p.phone, p.whatsapp or "", p.email or "", p.area or "", p.district or "",
                 p.state or "", ", ".join(p.products_allowed), p.public_visible,
                 p.microsite_slug or "", p.created_at.isoformat()] for p in partners]
        return export_response("partner_list", header, rows, format, title="Partner List")

    names = {}
    if dataset == "leads":
        leads = await PartnerLead.find(PartnerLead.is_archived == False).to_list()  # noqa: E712
        if status:
            leads = [lead for lead in leads if lead.status == status]
        names = await _partner_names(lead.partner_id for lead in leads)
        header = ["partner", "name", "phone", "email", "interest", "status",
                  "source", "location", "created_at"]
        rows = [[names.get(lead.partner_id, lead.partner_id), lead.name, lead.phone,
                 lead.email or "", lead.interest or "",
                 perf.LEAD_STATUS_LABELS.get(lead.status, lead.status), lead.source,
                 lead.location or "", lead.created_at.isoformat()] for lead in leads]
        return export_response("partner_leads", header, rows, format, title="Partner Leads")

    reports = await PartnerReport.find(PartnerReport.is_archived == False).to_list()  # noqa: E712
    if dataset == "admissions":
        reports = [r for r in reports if r.report_type == "course_admission"]
    if status:
        reports = [r for r in reports if r.status == status]

    if dataset in ("sales", "admissions"):
        names = await _partner_names(r.partner_id for r in reports)
        header = ["partner", "date", "report_type", "product", "quantity",
                  "amount_paise", "status", "reviewed_by", "remarks"]
        rows = [[names.get(r.partner_id, r.partner_id),
                 r.occurred_on or r.created_at.date().isoformat(),
                 perf.REPORT_TYPE_LABELS.get(r.report_type, r.report_type), r.product or "",
                 r.quantity, r.amount or 0, r.status, r.reviewed_by or "", r.remarks or ""]
                for r in reports]
        title = "Partner Admissions" if dataset == "admissions" else "Partner Sales"
        return export_response(f"partner_{dataset}", header, rows, format, title=title)

    if dataset == "product":
        header = ["product", "quantity", "revenue_paise", "reports"]
        rows = [[r["product"], r["quantity"], r["revenue_paise"], r["reports"]]
                for r in perf.by_product(reports)]
        return export_response("partner_product_wise", header, rows, format,
                               title="Product-wise Report")

    data = perf.monthly(reports, year) if dataset == "monthly" else perf.yearly(reports)
    header = ["period", "book_sales", "course_admissions", "membership_sales",
              "student_registrations", "total_quantity", "revenue_paise"]
    rows = [[r["period"], r["book_sale"], r["course_admission"], r["membership_sale"],
             r["student_registration"], r["quantity"], r["revenue_paise"]] for r in data]
    return export_response(f"partner_{dataset}", header, rows, format,
                           title=f"Partner {dataset.title()} Report")


class ReportReview(BaseModel):
    action: str = "approve"  # approve | reject
    remarks: str | None = None


@router.post("/reports/{report_id}/review")
async def review_report(report_id: str, body: ReportReview,
                        admin: CurrentUser = Depends(require_admin)):
    """Only after approval does data become final and visible in reports."""
    report = await PartnerReport.get(report_id)
    if not report:
        raise NotFoundError("Report not found")
    report.status = "approved" if body.action == "approve" else "rejected"
    report.reviewed_by = admin.subject
    report.reviewed_at = utcnow()
    report.review_remarks = body.remarks
    report.touch()
    await report.save()
    partner = await Partner.get(report.partner_id)
    if partner and partner.username:
        await notif.notify(
            partner.username, f"Report {report.status.title()}",
            f"Your {perf.REPORT_TYPE_LABELS.get(report.report_type, report.report_type)} "
            f"report was {report.status}."
            + (f" Remarks: {body.remarks}" if body.remarks else ""),
            kind="partner", push_url="/partner/reports")
    await log_activity(admin.subject, "partner.report_review", role=admin.role.value,
                       target_type="partner_report", target_id=report_id,
                       meta={"action": body.action})
    return ok(report.model_dump(mode="json"))


class StatusBody(BaseModel):
    status: str  # pending | under_review | approved | rejected | on_hold | suspended
    remarks: str | None = None
    products_allowed: list[str] | None = None
    username: str | None = None  # link a partner login for dashboard access
    public_visible: bool | None = None
    partner_id: str | None = None  # override the generated Partner ID
    partner_type: PartnerType | None = None


@router.post("/{partner_id}/status")
async def set_status(partner_id: str, body: StatusBody,
                     admin: CurrentUser = Depends(require_admin)):
    if body.status not in PARTNER_STATUSES:
        raise ValidationAppError(f"status must be one of {sorted(PARTNER_STATUSES)}")
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    was = p.status
    p.status = body.status
    if body.remarks is not None:
        p.remarks = body.remarks
    if body.products_allowed is not None:
        p.products_allowed = body.products_allowed
    if body.username is not None:
        p.username = body.username
    if body.public_visible is not None:
        p.public_visible = body.public_visible
    if body.partner_type is not None:
        p.partner_type = body.partner_type
    if body.partner_id:
        clash = await Partner.find_one(Partner.partner_id == body.partner_id)
        if clash and str(clash.id) != partner_id:
            raise ConflictError("That Partner ID is already assigned")
        p.partner_id = body.partner_id

    credentials = None
    if body.status == "approved":
        if not p.partner_id:
            p.partner_id = _partner_id()
        # Franchisee microsite only for Complete Sujyoti Franchisee Partners.
        if p.partner_type == PartnerType.franchisee and not p.microsite_slug:
            p.microsite_slug = await _unique_slug(p.org or p.name, exclude_id=partner_id)
        credentials = await _ensure_partner_login(p)
    p.touch()
    await p.save()

    if p.username and body.status != was:
        await notif.notify(p.username, "Partner Status Updated",
                           f"Your partnership status is now {body.status.replace('_', ' ')}."
                           + (f" Remarks: {p.remarks}" if p.remarks else ""),
                           kind="partner", push_url="/partner")
    await log_activity(admin.subject, "partner.status", role=admin.role.value,
                       target_type="partner", target_id=partner_id,
                       meta={"status": body.status})
    data = p.model_dump(mode="json")
    if credentials:
        data["credentials"] = credentials
    return ok(data)


@router.get("/{partner_id}/performance")
async def partner_performance(partner_id: str, admin: CurrentUser = Depends(require_admin),
                              year: str | None = None):
    """Admin's view of one partner's performance."""
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    return ok({**_profile(p), **await perf.performance_for(partner_id, year)})


@router.get("/{partner_id}/export")
async def admin_export_partner(partner_id: str, admin: CurrentUser = Depends(require_admin),
                               dataset: str = "monthly", format: str = "csv",
                               year: str | None = None):
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    return await _export(p, dataset, format, year)


# --- Part E: franchisee microsite management -----------------------------
class MicrositePatch(BaseModel):
    slug: str | None = None
    about: str | None = None
    address: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    email: EmailStr | None = None
    map_embed_url: str | None = None
    public_products: list[str] | None = None
    published: bool | None = None


@router.patch("/{partner_id}/microsite")
async def update_microsite(partner_id: str, body: MicrositePatch,
                           admin: CurrentUser = Depends(require_admin)):
    """Create / edit / publish / unpublish a franchisee page."""
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    if p.partner_type != PartnerType.franchisee:
        raise ValidationAppError(
            "Microsites are only available for Complete Sujyoti Franchisee Partners")
    data = body.model_dump(exclude_unset=True)
    slug, published = data.pop("slug", None), data.pop("published", None)
    for k, v in data.items():
        setattr(p, k, v)
    if slug is not None:
        p.microsite_slug = await _unique_slug(slug, exclude_id=partner_id)
    if published is not None:
        if published and p.status != "approved":
            raise ValidationAppError("Approve the partner before publishing their page")
        if published and not p.microsite_slug:
            p.microsite_slug = await _unique_slug(p.org or p.name, exclude_id=partner_id)
        p.microsite_published = published
    p.touch()
    await p.save()
    await log_activity(admin.subject, "partner.microsite", role=admin.role.value,
                       target_type="partner", target_id=partner_id,
                       meta={"published": p.microsite_published, "slug": p.microsite_slug})
    return ok(p.model_dump(mode="json"))


@router.post("/{partner_id}/microsite/photos")
async def add_microsite_photo(partner_id: str, file: UploadFile = File(...),
                              logo: bool = False,
                              admin: CurrentUser = Depends(require_admin)):
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    url = file_service.save_partner_photo(await file.read())
    if logo:
        p.logo_url = url
    else:
        p.gallery.append(url)
    p.touch()
    await p.save()
    return ok({"url": url, "gallery": p.gallery, "logo_url": p.logo_url})


@router.delete("/{partner_id}/microsite/photos")
async def remove_microsite_photo(partner_id: str, url: str,
                                 admin: CurrentUser = Depends(require_admin)):
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    if p.logo_url == url:
        p.logo_url = None
    p.gallery = [g for g in p.gallery if g != url]
    p.touch()
    await p.save()
    return ok({"gallery": p.gallery, "logo_url": p.logo_url})


class PartnerAdminPatch(BaseModel):
    name: str | None = None
    org: str | None = None
    phone: str | None = None
    whatsapp: str | None = None
    email: EmailStr | None = None
    state: str | None = None
    district: str | None = None
    area: str | None = None
    address: str | None = None
    about: str | None = None
    partner_type: PartnerType | None = None
    public_visible: bool | None = None
    products_allowed: list[str] | None = None
    public_products: list[str] | None = None


@router.patch("/{partner_id}")
async def admin_edit_partner(partner_id: str, body: PartnerAdminPatch,
                             admin: CurrentUser = Depends(require_admin)):
    """Directory management: edit partner details / location / visibility."""
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(p, k, v)
    p.touch()
    await p.save()
    await log_activity(admin.subject, "partner.edit", role=admin.role.value,
                       target_type="partner", target_id=partner_id,
                       meta={"fields": sorted(data.keys())})
    return ok(p.model_dump(mode="json"))


@router.delete("/{partner_id}")
async def delete_partner(partner_id: str, reason: str | None = None,
                         admin: CurrentUser = Depends(require_admin)):
    """Archive-first delete — the row is recoverable from Admin -> Archive."""
    p = await Partner.get(partner_id)
    if not p:
        raise NotFoundError("Partner not found")
    p.archive(admin.subject, reason)
    p.public_visible = False
    p.microsite_published = False
    await p.save()
    await log_activity(admin.subject, "partner.delete", role=admin.role.value,
                       target_type="partner", target_id=partner_id,
                       meta={"reason": reason})
    return ok({"id": partner_id}, "Partner archived")
