"""Notification & Notice System (Module 14): dashboard notifications (direct,
broadcast and group), announcement banners with schedule windows, scheduled
notifications with cancel, per-user read tracking, admin history/search."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.envelope import ok
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, get_current_user, require_admin
from app.db.models import Banner, Notification, PushSubscription
from app.modules.notification import service
from app.shared import push_service
from app.shared.audit import log_activity

router = APIRouter(prefix="/notifications", tags=["notifications"])


class CreateNotification(BaseModel):
    # student_id / username, "*" for everyone, or a group:
    # "students" | "teachers" | "partners" | "examiners"
    recipient: str
    title: str
    body: str
    kind: str = "info"
    scheduled_for: datetime | None = None


@router.post("/")
async def create(body: CreateNotification, admin: CurrentUser = Depends(require_admin)):
    n = await service.notify(body.recipient, body.title, body.body, body.kind, body.scheduled_for)
    await log_activity(admin.subject, "notification.create", role=admin.role.value,
                       target_id=body.recipient)
    return ok(n.model_dump(mode="json"))


@router.get("/my")
async def my_notifications(user: CurrentUser = Depends(get_current_user)):
    """Notification history for the logged-in user (any role)."""
    keys = service.recipients_for(user.subject, user.role)
    items = await Notification.find(
        {"recipient": {"$in": keys}, "is_archived": False, "sent": True}
    ).sort(-Notification.created_at).limit(100).to_list()
    out = []
    for n in items:
        data = n.model_dump(mode="json")
        data["is_read"] = n.is_read if n.recipient == user.subject else (user.subject in n.read_by)
        data.pop("read_by", None)
        out.append(data)
    return ok(out)


# --------------------------------------------------------------------------
# Web Push subscriptions (browser notifications)
# --------------------------------------------------------------------------
class PushSubscribeBody(BaseModel):
    endpoint: str
    keys: dict  # { p256dh, auth }


@router.get("/push/vapid-public")
async def push_vapid_public():
    key = push_service.public_key()
    if not key:
        raise ValidationAppError("Push notifications are not configured on this server")
    return ok({"public_key": key})


@router.post("/push/subscribe")
async def push_subscribe(body: PushSubscribeBody, user: CurrentUser = Depends(get_current_user)):
    if not push_service.configured():
        raise ValidationAppError("Push notifications are not configured on this server")
    p256dh = body.keys.get("p256dh")
    auth = body.keys.get("auth")
    if not body.endpoint or not p256dh or not auth:
        raise ValidationAppError("Invalid push subscription")
    existing = await PushSubscription.find_one(PushSubscription.endpoint == body.endpoint)
    if existing:
        existing.user_id = user.subject
        existing.p256dh = p256dh
        existing.auth = auth
        if existing.is_archived:
            existing.restore()
        existing.touch()
        await existing.save()
    else:
        await PushSubscription(
            user_id=user.subject, endpoint=body.endpoint, p256dh=p256dh, auth=auth,
        ).insert()
    return ok(message="Push subscription saved")


@router.delete("/push/subscribe")
async def push_unsubscribe(body: PushSubscribeBody, user: CurrentUser = Depends(get_current_user)):
    sub = await PushSubscription.find_one(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.user_id == user.subject,
        PushSubscription.is_archived == False,  # noqa: E712
    )
    if sub:
        sub.archive(user.subject, "user unsubscribed")
        await sub.save()
    return ok(message="Unsubscribed")


@router.post("/read-all")
async def mark_all_read(user: CurrentUser = Depends(get_current_user)):
    """Mark every notification visible to this user as read (source of truth for
    the nav-bar unread badge)."""
    base = {"is_archived": False, "sent": True}
    # Direct notifications addressed to this user.
    await Notification.find(
        {**base, "recipient": user.subject, "is_read": False}
    ).update({"$set": {"is_read": True}})
    # Broadcast/group notifications: per-user read tracking.
    group_keys = [k for k in service.recipients_for(user.subject, user.role) if k != user.subject]
    await Notification.find(
        {**base, "recipient": {"$in": group_keys}, "read_by": {"$ne": user.subject}}
    ).update({"$addToSet": {"read_by": user.subject}})
    return ok(message="All marked read")


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, user: CurrentUser = Depends(get_current_user)):
    n = await Notification.get(notification_id)
    if not n:
        raise NotFoundError("Notification not found")
    if n.recipient == user.subject:
        n.is_read = True
    elif user.subject not in n.read_by:
        n.read_by.append(user.subject)  # broadcast/group: per-user read tracking
    n.touch()
    await n.save()
    return ok(message="Marked read")


@router.get("/admin/history")
async def admin_history(
    admin: CurrentUser = Depends(require_admin),
    recipient: str | None = None,
    kind: str | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    query: dict = {"is_archived": False}
    if recipient:
        query["recipient"] = recipient
    if kind:
        query["kind"] = kind
    if q:
        query["title"] = {"$regex": q, "$options": "i"}
    total = await Notification.find(query).count()
    items = (
        await Notification.find(query).sort(-Notification.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    return ok({"items": [n.model_dump(mode="json") for n in items], "total": total,
               "page": page, "page_size": page_size})


@router.get("/admin/stats")
async def admin_stats(admin: CurrentUser = Depends(require_admin)):
    """Notification statistics for the admin dashboard (Module 14)."""
    base = {"is_archived": False}
    total = await Notification.find(base).count()
    sent = await Notification.find({**base, "sent": True}).count()
    scheduled = await Notification.find({**base, "sent": False}).count()
    direct_read = await Notification.find({**base, "sent": True, "is_read": True}).count()
    by_kind: dict[str, int] = {}
    for kind in ("info", "success", "warning", "payment", "approval", "promo", "exam", "community"):
        c = await Notification.find({**base, "kind": kind}).count()
        if c:
            by_kind[kind] = c
    return ok({"total": total, "sent": sent, "scheduled": scheduled,
               "direct_read": direct_read,
               "read_rate": round(direct_read / sent * 100, 1) if sent else 0,
               "by_kind": by_kind})


@router.delete("/{notification_id}")
async def cancel_or_archive(notification_id: str, admin: CurrentUser = Depends(require_admin)):
    """Cancel a scheduled notification or archive a sent one."""
    n = await Notification.get(notification_id)
    if not n:
        raise NotFoundError("Notification not found")
    n.archive(admin.subject, "cancelled/archived by admin")
    await n.save()
    return ok(message="Notification archived")


# --------------------------------------------------------------------------
# Announcement banners (public website + dashboards)
# --------------------------------------------------------------------------
class BannerBody(BaseModel):
    title: str
    message: str | None = None
    image_url: str | None = None
    cta_text: str | None = None
    cta_link: str | None = None
    audience: str = "public"  # public | students | teachers | partners
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    active: bool = True
    kind: str = "announcement"  # announcement | promo


@router.post("/banners")
async def create_banner(body: BannerBody, admin: CurrentUser = Depends(require_admin)):
    b = Banner(**body.model_dump())
    await b.insert()
    await log_activity(admin.subject, "banner.create", role=admin.role.value, target_id=str(b.id))
    return ok(b.model_dump(mode="json"))


@router.patch("/banners/{banner_id}")
async def update_banner(banner_id: str, body: BannerBody,
                        admin: CurrentUser = Depends(require_admin)):
    b = await Banner.get(banner_id)
    if not b:
        raise NotFoundError("Banner not found")
    for k, v in body.model_dump().items():
        setattr(b, k, v)
    b.touch()
    await b.save()
    return ok(b.model_dump(mode="json"))


@router.delete("/banners/{banner_id}")
async def delete_banner(banner_id: str, admin: CurrentUser = Depends(require_admin)):
    b = await Banner.get(banner_id)
    if not b:
        raise NotFoundError("Banner not found")
    b.archive(admin.subject, "banner deleted")
    await b.save()
    return ok(message="Banner archived")


@router.get("/banners")
async def banners(audience: str | None = None):
    """Active banners within their display window (public endpoint)."""
    now = datetime.now(timezone.utc)
    query: dict = {"active": True, "is_archived": False}
    if audience:
        query["audience"] = {"$in": [audience, "public"]}
    items = await Banner.find(query).to_list()

    def _utc(dt: datetime | None) -> datetime | None:
        # Mongo returns naive UTC datetimes; normalise before comparing.
        if dt is not None and dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    visible = [
        b for b in items
        if (_utc(b.starts_at) is None or _utc(b.starts_at) <= now)
        and (_utc(b.ends_at) is None or _utc(b.ends_at) >= now)
    ]
    return ok([b.model_dump(mode="json") for b in visible])
