"""Server-side membership gating for learning content (videos + PDFs).

Extracted from modules/video/router.py so every module that serves
membership-restricted material runs the same authorization path. Access is
always decided here on the server — the frontend never filters content itself.
"""
from app.db.models import Subscription, SubscriptionPlan, Video

ACCESS_LEVELS = {"public", "member", "subscriber", "admin"}
CONTENT_KINDS = {"video", "pdf"}

# Plan tiers in ascending order; a higher tier inherits lower-tier content.
PLAN_TIER: list[str] = [p.value for p in SubscriptionPlan]


def _plan_rank(plan: str) -> int | None:
    try:
        return PLAN_TIER.index(plan)
    except ValueError:
        return None


def plan_visible_to_student(student_plan: str | None, content_plan: str) -> bool:
    """Exact match, or a higher tier inheriting lower-tier tagged content."""
    if not student_plan:
        return False
    if student_plan == content_plan:
        return True
    sr, vr = _plan_rank(student_plan), _plan_rank(content_plan)
    if sr is None or vr is None:
        return student_plan == content_plan
    return sr >= vr


def visible_to_student(v: Video, student_id: str, plan: str | None, has_sub: bool) -> bool:
    """General (empty plans) → all students. Tagged plans → matching subscription
    (tier-aware). student_ids overrides everything. Legacy access=subscriber
    still requires an active subscription."""
    if v.student_ids:
        return student_id in v.student_ids
    if v.plans:
        return any(plan_visible_to_student(plan, vp) for vp in v.plans)
    if v.access == "admin":
        return False
    if v.access == "subscriber" and not has_sub:
        return False
    return True


async def student_plan(student_id: str) -> tuple[str | None, bool]:
    """(active plan key, has an active subscription) for one student."""
    sub = await Subscription.find_one(
        Subscription.student_id == student_id, Subscription.is_active == True  # noqa: E712
    )
    return (sub.plan if sub else None, sub is not None)
