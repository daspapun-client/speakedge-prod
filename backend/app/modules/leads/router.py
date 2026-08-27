"""Free Demo & Lead Management: capture, status tracking, feedback, conversion."""
from datetime import date, datetime, timedelta, timezone

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, EmailStr

from app.core.envelope import ok
from app.core.exceptions import NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin
from app.db.models import Lead, PromptAudience
from app.shared.audit import log_activity

router = APIRouter(prefix="/leads", tags=["leads"])

# Weekly free-demo slots (mirrors the Sujyoti Language School free demo).
# Kept server-side so the public form and the admin lead list agree on wording.
# The leading weekday name is load-bearing: it is what a preferred demo date is
# validated against, so keep each label starting with the day.
DEMO_SLOTS = [
    "Sunday 11:30 AM – 1:00 PM",
    "Wednesday 6:00 PM – 7:30 PM",
    "Friday 6:00 PM – 7:30 PM",
]

# How many upcoming dates the form offers per slot.
DEMO_DATE_CHOICES = 6

EDUCATION_OPTIONS = [
    "Class VIII or Below",
    "Class IX–X",
    "Class XI–XII",
    "Undergraduate",
    "Graduate",
    "Postgraduate",
    "Doctorate",
    "Other",
]

OCCUPATION_OPTIONS = [
    "Student",
    "Salaried Professional",
    "Business / Self-employed",
    "Homemaker",
    "Other",
    "Not Applicable",
]

HEARD_FROM_OPTIONS = [
    "Google",
    "Facebook",
    "Instagram",
    "YouTube",
    "AI Platform",
    "Family / Friend / Referral",
    "SpeakEdge Learner",
    "Sujyoti Language School Learner",
    "Other",
]

# Age boundary between the Kids and Adult demo groups (inclusive upper bound
# for Kids). The form only asks for age; the group is derived from it.
KIDS_MAX_AGE = 14

_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Demo dates are calendar dates in India, so "today" must be the Indian today —
# using UTC would offer a same-day slot to anyone booking before 05:30 IST.
IST = timezone(timedelta(hours=5, minutes=30))


def today_ist() -> date:
    return datetime.now(IST).date()


def demo_group_for_age(age: int) -> str:
    """Kids or Adults demo group. Mirrors PromptAudience so a converted lead
    lands on the matching course."""
    return (PromptAudience.kids if age <= KIDS_MAX_AGE else PromptAudience.adults).value


def _slot_weekday(slot: str) -> int:
    """Python weekday index (Mon=0) of the day a slot runs on."""
    return _WEEKDAYS.index(slot.split()[0])


def upcoming_dates(slot: str, count: int = DEMO_DATE_CHOICES,
                   today: date | None = None) -> list[str]:
    """The next `count` dates this slot runs. Never today — booking the same
    day is too late to arrange a seat."""
    today = today or today_ist()
    target = _slot_weekday(slot)
    ahead = (target - today.weekday()) % 7 or 7  # 0 would mean today; skip a week
    first = today + timedelta(days=ahead)
    return [(first + timedelta(weeks=i)).isoformat() for i in range(count)]


@router.get("/demo/options")
async def demo_options():
    """Every choice the public Free Demo form needs. Slots carry their own
    upcoming dates so the date picker can only ever offer a date that actually
    falls on the chosen slot."""
    return ok({
        "slots": [{"label": s, "weekday": s.split()[0], "dates": upcoming_dates(s)}
                  for s in DEMO_SLOTS],
        "education": EDUCATION_OPTIONS,
        "occupation": OCCUPATION_OPTIONS,
        "heard_from": HEARD_FROM_OPTIONS,
        "kids_max_age": KIDS_MAX_AGE,
    })


class DemoLead(BaseModel):
    name: str
    phone: str
    email: EmailStr | None = None
    age: int
    education: str
    occupation: str
    demo_slot: str
    demo_date: str          # "YYYY-MM-DD", must fall on the slot's weekday
    interest: str | None = None
    heard_from: str
    heard_from_detail: str | None = None
    consent_privacy: bool = False
    source: str = "website"


@router.post("/demo")
async def register_demo(body: DemoLead):
    if not body.consent_privacy:
        raise ValidationAppError(
            "Please accept the Privacy Policy and consent to being contacted "
            "about your Free Demo Class.")
    if not 3 <= body.age <= 100:
        raise ValidationAppError("Please enter a valid age")
    if body.education not in EDUCATION_OPTIONS:
        raise ValidationAppError("Unknown education / academic qualification")
    if body.occupation not in OCCUPATION_OPTIONS:
        raise ValidationAppError("Unknown occupation")
    if body.demo_slot not in DEMO_SLOTS:
        raise ValidationAppError("Unknown demo slot")
    if body.heard_from not in HEARD_FROM_OPTIONS:
        raise ValidationAppError("Unknown referral source")

    try:
        chosen = date.fromisoformat(body.demo_date)
    except ValueError:
        raise ValidationAppError("Preferred demo date must be in YYYY-MM-DD format")
    if chosen.weekday() != _slot_weekday(body.demo_slot):
        raise ValidationAppError(
            f"{body.demo_date} is not a {body.demo_slot.split()[0]} — "
            "pick a date that matches your chosen slot.")
    if chosen <= today_ist():
        raise ValidationAppError("Please choose an upcoming demo date")

    lead = Lead(**body.model_dump(), status="demo_booked",
                demo_group=demo_group_for_age(body.age))
    await lead.insert()
    return ok(
        {"id": str(lead.id), "demo_group": lead.demo_group},
        "Demo registered. Our team will contact you.",
    )


@router.get("/")
async def list_leads(
    admin: CurrentUser = Depends(require_admin),
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    total = await Lead.find(query).count()
    items = await Lead.find(query).sort(-Lead.created_at).skip((page - 1) * page_size).limit(page_size).to_list()
    return ok({"items": [lead.model_dump(mode="json") for lead in items], "total": total,
               "page": page, "page_size": page_size})


class LeadUpdate(BaseModel):
    status: str | None = None
    feedback: str | None = None


@router.patch("/{lead_id}")
async def update_lead(lead_id: str, body: LeadUpdate, admin: CurrentUser = Depends(require_admin)):
    lead = await Lead.get(lead_id)
    if not lead:
        raise NotFoundError("Lead not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(lead, k, v)
    lead.touch()
    await lead.save()
    return ok(lead.model_dump(mode="json"))


class BulkDeleteRequest(BaseModel):
    ids: list[str]
    reason: str | None = None


@router.post("/bulk-delete")
async def bulk_delete(body: BulkDeleteRequest, admin: CurrentUser = Depends(require_admin)):
    """Archive-first bulk delete, mirroring the per-lead one: everything stays
    restorable from the Archive page for 60 days. Ids that are unknown or
    already deleted are skipped rather than failing the whole batch."""
    wanted = list(dict.fromkeys(body.ids))
    oids = [PydanticObjectId(i) for i in wanted if PydanticObjectId.is_valid(i)]
    leads = await Lead.find({"_id": {"$in": oids}, "is_archived": False}).to_list()
    for lead in leads:
        lead.archive(admin.subject, body.reason or "bulk deleted by admin")
        await lead.save()
    deleted = [str(lead.id) for lead in leads]
    skipped = [i for i in wanted if i not in set(deleted)]
    if deleted:
        await log_activity(admin.subject, "lead.bulk_delete", role=admin.role.value,
                           target_type="lead",
                           meta={"deleted": len(deleted), "skipped": len(skipped)})
    return ok({"deleted": len(deleted), "ids": deleted, "skipped": skipped},
              f"Deleted {len(deleted)} lead(s)")


@router.delete("/{lead_id}")
async def delete_lead(lead_id: str, reason: str | None = None,
                      admin: CurrentUser = Depends(require_admin)):
    """Archive-first delete (restorable for 60 days from the Archive page)."""
    lead = await Lead.get(lead_id)
    if not lead:
        raise NotFoundError("Lead not found")
    if lead.is_archived:
        return ok(message="Lead already deleted")
    lead.archive(admin.subject, reason or "deleted by admin")
    await lead.save()
    await log_activity(admin.subject, "lead.archive", role=admin.role.value,
                       target_type="lead", target_id=lead_id,
                       meta={"name": lead.name, "status": lead.status})
    return ok(message="Lead deleted")
