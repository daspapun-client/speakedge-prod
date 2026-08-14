from fastapi import APIRouter, Depends, Request

from app.core.config import settings
from app.core.envelope import ok
from app.core.rbac import CurrentUser, get_current_user
from app.core.ratelimit import rate_limit
from app.db.models import User
from app.modules.auth import service
from app.modules.auth.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    MeOut,
    RefreshRequest,
)
from app.shared.audit import log_activity

router = APIRouter(prefix="/auth", tags=["auth"])

_auth_limit = rate_limit("auth", settings.RATE_LIMIT_AUTH_PER_MIN)


@router.post("/login", dependencies=[Depends(_auth_limit)])
async def login(body: LoginRequest, request: Request):
    tokens = await service.authenticate(body.username, body.password)
    await log_activity(tokens.subject, "auth.login", role=tokens.role, ip=request.client.host if request.client else None)
    return ok(tokens.model_dump(), "Logged in")


@router.post("/refresh", dependencies=[Depends(_auth_limit)])
async def refresh(body: RefreshRequest):
    tokens = await service.refresh(body.refresh_token)
    return ok(tokens.model_dump())


@router.post("/logout")
async def logout(user: CurrentUser = Depends(get_current_user)):
    # Stateless JWT: client discards tokens. Audit the event.
    await log_activity(user.subject, "auth.logout", role=user.role.value)
    return ok(message="Logged out")


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, user: CurrentUser = Depends(get_current_user)):
    await service.change_password(user.subject, body.old_password, body.new_password)
    await log_activity(user.subject, "auth.change_password", role=user.role.value)
    return ok(message="Password changed")


@router.get("/me", response_model=None)
async def me(user: CurrentUser = Depends(get_current_user)):
    db_user = await User.find_one(
        {"$or": [{"username": user.subject}, {"student_id": user.subject}]}
    )
    out = MeOut(
        subject=user.subject,
        role=user.role.value,
        full_name=db_user.full_name if db_user else None,
        email=db_user.email if db_user else None,
        student_id=db_user.student_id if db_user else None,
    )
    return ok(out.model_dump())
