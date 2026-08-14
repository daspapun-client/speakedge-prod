"""Video Preservation System (Module 13) + membership-gated learning content:
YouTube embeds, website-uploaded videos and PDF study material, admin-managed
categories, access control (public / member / subscriber / admin) and per-plan
membership mapping, watch history. Public videos are visible without login.

Content type is carried by ``Video.kind`` (video | pdf) so both share one
admin CRUD surface and one server-side authorization path
(shared/content_access.py)."""
from fastapi import APIRouter, Depends, File, Query, UploadFile
from pydantic import BaseModel

from app.core.envelope import ok
from app.core.exceptions import ForbiddenError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, get_optional_user, require_admin, require_student
from app.db.base import utcnow
from app.db.models import PlanConfig, Video, VideoCategory, WatchHistory
from app.shared import file_service
from app.shared.audit import log_activity
from app.shared.content_access import (
    ACCESS_LEVELS,
    CONTENT_KINDS,
    student_plan as _student_plan,
    visible_to_student as _visible_to_student,
)

router = APIRouter(prefix="/videos", tags=["videos"])


async def _validate_plans(plans: list[str]) -> None:
    """Reject a membership mapping that points at a plan that doesn't exist."""
    if not plans:
        return
    known = {p.plan for p in await PlanConfig.find_all().to_list()}
    if not known:
        return  # fresh DB with no catalogue yet — nothing to validate against
    unknown = [p for p in plans if p not in known]
    if unknown:
        raise ValidationAppError(f"Unknown membership plan(s): {', '.join(unknown)}")


def _validate_kind(kind: str, source: str, url: str) -> None:
    if kind not in CONTENT_KINDS:
        raise ValidationAppError(f"kind must be one of {sorted(CONTENT_KINDS)}")
    if not (url or "").strip():
        raise ValidationAppError("A content URL is required")
    if kind == "pdf" and source == "youtube":
        raise ValidationAppError("PDF content cannot use the YouTube source")


class VideoBody(BaseModel):
    title: str
    kind: str = "video"  # video | pdf
    category: str = "general"
    source: str = "youtube"  # youtube | uploaded | pdf
    url: str
    access: str = "member"  # public | member | subscriber | admin
    plans: list[str] = []  # PlanConfig keys; empty = visible to all students
    student_ids: list[str] = []  # specific students; non-empty overrides access/plans
    description: str | None = None
    display_order: int = 0


@router.post("/")
async def create_video(body: VideoBody, admin: CurrentUser = Depends(require_admin)):
    if body.access not in ACCESS_LEVELS:
        raise ValidationAppError(f"access must be one of {sorted(ACCESS_LEVELS)}")
    _validate_kind(body.kind, body.source, body.url)
    await _validate_plans(body.plans)
    v = Video(**body.model_dump())
    await v.insert()
    await log_activity(admin.subject, "content.create", role=admin.role.value,
                       target_type="content", target_id=str(v.id),
                       meta={"kind": v.kind, "title": v.title, "plans": v.plans})
    return ok(v.model_dump(mode="json"))


@router.post("/upload")
async def upload_video(
    file: UploadFile = File(...),
    admin: CurrentUser = Depends(require_admin),
):
    """Website-uploaded video file (Type 2). Returns the stored URL to use in
    the create/update payload with source='uploaded'."""
    url = file_service.save_video(await file.read(), file.content_type or "")
    await log_activity(admin.subject, "video.upload", role=admin.role.value, meta={"url": url})
    return ok({"url": url}, "Video uploaded")


@router.post("/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    admin: CurrentUser = Depends(require_admin),
):
    """PDF study material. Returns the stored URL to use in the create/update
    payload with kind='pdf' and source='uploaded'."""
    url = file_service.save_pdf(await file.read(), file.content_type or "")
    await log_activity(admin.subject, "content.upload_pdf", role=admin.role.value, meta={"url": url})
    return ok({"url": url}, "PDF uploaded")


class VideoUpdate(BaseModel):
    title: str | None = None
    kind: str | None = None
    category: str | None = None
    source: str | None = None
    url: str | None = None
    access: str | None = None
    plans: list[str] | None = None
    student_ids: list[str] | None = None
    description: str | None = None
    display_order: int | None = None


@router.patch("/{video_id}")
async def update_video(video_id: str, body: VideoUpdate,
                       admin: CurrentUser = Depends(require_admin)):
    v = await Video.get(video_id)
    if not v:
        raise NotFoundError("Content not found")
    if body.access and body.access not in ACCESS_LEVELS:
        raise ValidationAppError(f"access must be one of {sorted(ACCESS_LEVELS)}")
    changes = body.model_dump(exclude_none=True)
    # Validate the *resulting* document, not just the supplied fields.
    _validate_kind(changes.get("kind", v.kind), changes.get("source", v.source),
                   changes.get("url", v.url))
    if body.plans is not None:
        await _validate_plans(body.plans)
    for k, val in changes.items():
        setattr(v, k, val)
    v.touch()
    await v.save()
    await log_activity(admin.subject, "content.update", role=admin.role.value,
                       target_type="content", target_id=video_id,
                       meta={"fields": sorted(changes)})
    return ok(v.model_dump(mode="json"))


@router.delete("/{video_id}")
async def archive_video(video_id: str, admin: CurrentUser = Depends(require_admin)):
    """Archive-first delete (restorable for 60 days). Archived content
    disappears from every student listing but existing WatchHistory rows are
    kept, so a restore brings the item back with its statistics intact."""
    v = await Video.get(video_id)
    if not v:
        raise NotFoundError("Content not found")
    if v.is_archived:
        return ok(message="Content already archived")
    v.archive(admin.subject, "content deleted")
    await v.save()
    await log_activity(admin.subject, "content.archive", role=admin.role.value,
                       target_type="content", target_id=video_id,
                       meta={"kind": v.kind, "title": v.title})
    return ok(message="Content archived")


@router.post("/{video_id}/restore")
async def restore_video(video_id: str, admin: CurrentUser = Depends(require_admin)):
    v = await Video.get(video_id)
    if not v:
        raise NotFoundError("Video not found")
    v.restore()
    await v.save()
    return ok(v.model_dump(mode="json"), "Video restored")


@router.get("/")
async def list_videos(category: str | None = None,
                      kind: str | None = Query(None, pattern="^(video|pdf)$"),
                      user: CurrentUser | None = Depends(get_optional_user)):
    """Access-filtered listing. Anonymous visitors see public videos only."""
    query: dict = {"is_archived": False}
    if category:
        query["category"] = category
    if kind:
        query["kind"] = kind
    videos = await Video.find(query).sort(
        [("display_order", 1), ("created_at", -1)]
    ).to_list()

    if user is None:
        visible = [v for v in videos if v.access == "public" and not v.plans and not v.student_ids]
    elif user.is_admin:
        visible = videos
    else:
        plan, has_sub = await _student_plan(user.subject)
        visible = [v for v in videos if _visible_to_student(v, user.subject, plan, has_sub)]
    return ok([v.model_dump(mode="json") for v in visible])


@router.get("/library")
async def student_video_library(kind: str | None = Query(None, pattern="^(video|pdf)$"),
                                user: CurrentUser = Depends(require_student)):
    """Authenticated student catalogue — always plan-filtered (never anonymous fallback)."""
    query: dict = {"is_archived": False}
    if kind:
        query["kind"] = kind
    videos = await Video.find(query).sort(
        [("display_order", 1), ("created_at", -1)]
    ).to_list()
    plan, has_sub = await _student_plan(user.subject)
    visible = [v for v in videos if _visible_to_student(v, user.subject, plan, has_sub)]
    return ok([v.model_dump(mode="json") for v in visible])


@router.get("/{video_id}/open")
async def open_content(video_id: str, user: CurrentUser = Depends(require_student)):
    """Server-side authorization check before a student opens a single item.

    The URL is only returned when the student's membership actually grants
    access — a student who guesses an id, or whose plan changed, or whose
    content was archived, gets a typed error rather than the file."""
    v = await Video.get(video_id)
    if not v or v.is_archived:
        raise NotFoundError("This content is no longer available")
    plan, has_sub = await _student_plan(user.subject)
    if not _visible_to_student(v, user.subject, plan, has_sub):
        raise ForbiddenError("Your membership does not include this content")
    return ok(v.model_dump(mode="json"))


# --- Categories (admin-managed, ordered) ---
class CategoryBody(BaseModel):
    name: str
    display_order: int = 0


@router.post("/categories", dependencies=[Depends(require_admin)])
async def create_category(body: CategoryBody):
    cat = VideoCategory(**body.model_dump())
    await cat.insert()
    return ok(cat.model_dump(mode="json"))


@router.get("/categories")
async def list_categories():
    cats = await VideoCategory.find(VideoCategory.is_archived == False).sort(  # noqa: E712
        VideoCategory.display_order
    ).to_list()
    return ok([c.model_dump(mode="json") for c in cats])


@router.delete("/categories/{category_id}")
async def delete_category(category_id: str, admin: CurrentUser = Depends(require_admin)):
    cat = await VideoCategory.get(category_id)
    if not cat:
        raise NotFoundError("Category not found")
    cat.archive(admin.subject, "category deleted")
    await cat.save()
    return ok(message="Category archived")


class WatchBody(BaseModel):
    last_position_s: int | None = None
    completed: bool | None = None
    session_start: bool = False


@router.post("/{video_id}/watch")
async def record_watch(video_id: str, body: WatchBody | None = None,
                       user: CurrentUser = Depends(require_student)):
    v = await Video.get(video_id)
    if not v or v.is_archived:
        raise NotFoundError("Video not found")
    plan, has_sub = await _student_plan(user.subject)
    if not _visible_to_student(v, user.subject, plan, has_sub):
        raise ForbiddenError("You do not have access to this video")
    body = body or WatchBody()
    existing = await WatchHistory.find_one(
        WatchHistory.student_id == user.subject,
        WatchHistory.video_id == video_id,
    )
    if existing:
        if body.session_start:
            existing.view_count += 1
        if body.last_position_s is not None:
            prev = existing.last_position_s or 0
            existing.last_position_s = max(prev, body.last_position_s)
        if body.completed:
            existing.completed = True
        existing.watched_at = utcnow()
        existing.touch()
        await existing.save()
        return ok(existing.model_dump(mode="json"))
    rec = WatchHistory(
        student_id=user.subject,
        video_id=video_id,
        last_position_s=body.last_position_s,
        completed=body.completed or False,
    )
    await rec.insert()
    return ok(rec.model_dump(mode="json"))


@router.get("/history")
async def watch_history(user: CurrentUser = Depends(require_student)):
    items = await WatchHistory.find(WatchHistory.student_id == user.subject).sort(
        -WatchHistory.watched_at
    ).limit(100).to_list()
    return ok([w.model_dump(mode="json") for w in items])


@router.get("/admin/list")
async def admin_list_videos(kind: str | None = Query(None, pattern="^(video|pdf)$"),
                            _admin: CurrentUser = Depends(require_admin)):
    """All active content for the admin console — no plan/access filtering."""
    query: dict = {"is_archived": False}
    if kind:
        query["kind"] = kind
    videos = await Video.find(query).sort(
        [("display_order", 1), ("created_at", -1)]
    ).to_list()
    return ok([v.model_dump(mode="json") for v in videos])


@router.get("/admin/stats")
async def admin_watch_stats(admin: CurrentUser = Depends(require_admin)):
    """Per-video watch statistics (views + unique viewers) for the admin console."""
    pipeline = [
        {"$group": {"_id": "$video_id", "views": {"$sum": {"$ifNull": ["$view_count", 1]}},
                    "viewers": {"$addToSet": "$student_id"},
                    "completions": {"$sum": {"$cond": [{"$eq": ["$completed", True]}, 1, 0]}}}},
    ]
    agg = await WatchHistory.aggregate(pipeline).to_list()
    stats = {a["_id"]: {"views": a["views"], "unique_viewers": len(a["viewers"]),
                        "completions": a["completions"]} for a in agg}
    videos = await Video.find(Video.is_archived == False).to_list()  # noqa: E712
    rows = []
    for v in videos:
        s = stats.get(str(v.id), {"views": 0, "unique_viewers": 0, "completions": 0})
        rows.append({"video_id": str(v.id), "title": v.title, "category": v.category,
                     "kind": v.kind, "access": v.access, **s})
    rows.sort(key=lambda r: r["views"], reverse=True)
    return ok(rows)
