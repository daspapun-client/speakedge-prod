"""Public site configuration — Google Business Profile + social media links.

The real profile URLs are not known until SpeakEdge is live, so they are stored
in the database instead of the frontend bundle: admin fills them in from
Admin -> Site Links and the footer picks them up with no code change and no
deploy. ``GET /site/links`` is deliberately public (the footer renders for
anonymous visitors) and returns only the links that actually have a URL, so an
empty placeholder row is never rendered as a broken link.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.envelope import ok
from app.core.exceptions import ValidationAppError
from app.core.rbac import CurrentUser, require_admin
from app.db.models import SiteLinkEntry, SiteLinks
from app.shared.audit import log_activity

router = APIRouter(prefix="/site", tags=["site"])

# The rows admin starts with. Keys match the footer's icon map; admin may add
# further rows with any key (they render with a generic globe icon).
DEFAULT_LINKS: list[tuple[str, str]] = [
    ("gmb", "Google Business Profile"),
    ("facebook", "Facebook"),
    ("instagram", "Instagram"),
    ("youtube", "YouTube"),
    ("linkedin", "LinkedIn"),
    ("x", "X (Twitter)"),
]


async def get_site_links() -> SiteLinks:
    """The singleton, seeded with the default (blank) rows on first read."""
    doc = await SiteLinks.find_one(SiteLinks.is_archived == False)  # noqa: E712
    if doc is None:
        doc = SiteLinks(links=[SiteLinkEntry(key=k, label=lbl) for k, lbl in DEFAULT_LINKS])
        await doc.insert()
    return doc


class LinkIn(BaseModel):
    key: str
    label: str
    url: str = ""


class LinksUpdate(BaseModel):
    links: list[LinkIn]


def _clean(links: list[LinkIn]) -> list[SiteLinkEntry]:
    out: list[SiteLinkEntry] = []
    seen: set[str] = set()
    for item in links:
        key = item.key.strip().lower()
        label = item.label.strip()
        url = item.url.strip()
        if not key or not label:
            raise ValidationAppError("Every link needs a key and a label")
        if key in seen:
            raise ValidationAppError(f"Duplicate link key: {key}")
        if url and not url.startswith(("http://", "https://")):
            raise ValidationAppError(f"{label}: the URL must start with http:// or https://")
        seen.add(key)
        out.append(SiteLinkEntry(key=key, label=label, url=url))
    return out


@router.get("/links")
async def public_links():
    """Public: only the profiles that have a URL configured."""
    doc = await get_site_links()
    return ok({"links": [l.model_dump() for l in doc.links if l.url]})


@router.get("/admin/links")
async def admin_links(admin: CurrentUser = Depends(require_admin)):
    """Admin editor: every row, including the ones still blank."""
    doc = await get_site_links()
    return ok({"links": [l.model_dump() for l in doc.links]})


@router.put("/admin/links")
async def update_links(body: LinksUpdate, admin: CurrentUser = Depends(require_admin)):
    doc = await get_site_links()
    doc.links = _clean(body.links)
    await doc.save()
    await log_activity(
        admin.subject, "site.links_update", role=admin.role.value,
        target_type="site_links", target_id=str(doc.id),
        meta={"configured": [l.key for l in doc.links if l.url]},
    )
    return ok({"links": [l.model_dump() for l in doc.links]}, "Links saved")
