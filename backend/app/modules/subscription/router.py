"""Subscription read endpoints. Purchase/activation lives in payments module
(create_order -> verify -> _fulfil activates the subscription)."""
from fastapi import APIRouter, Depends

from app.core.envelope import ok
from app.core.rbac import CurrentUser, require_student
from app.db.models import Subscription
from app.modules.payments import service as payment_service

router = APIRouter(prefix="/subscription", tags=["subscription"])


@router.get("/current")
async def current(user: CurrentUser = Depends(require_student)):
    # payments.service owns "which membership is in force": it applies a paid
    # upgrade whose activation date has arrived instead of reporting the tier
    # the student has already moved off.
    sub = await payment_service.active_subscription(user.subject)
    return ok(sub.model_dump(mode="json") if sub else None)


@router.get("/history")
async def history(user: CurrentUser = Depends(require_student)):
    subs = await Subscription.find(Subscription.student_id == user.subject).sort(-Subscription.created_at).to_list()
    return ok([s.model_dump(mode="json") for s in subs])
