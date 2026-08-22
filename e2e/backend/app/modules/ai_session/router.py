"""AI conversation API — Stages 1 (Lexical Integration), 2 (Guided Learning)
and 3 (Conversation Fluency & Assessment).

Every endpoint is student-scoped: a session can only be read or driven by the
student who owns it. Admins get a read-only transcript view for support.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.envelope import ok
from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.rbac import CurrentUser, require_admin, require_student
from app.db.models import AISession
from app.modules.ai_session import service as svc
from app.modules.membership import service as membership_service
from app.modules.prompt_library import service as prompts
from app.shared import ai_client

router = APIRouter(prefix="/ai-session", tags=["ai-session"])


async def _own_session(session_id: str, student_id: str) -> AISession:
    session = await AISession.get(session_id)
    if not session or session.is_archived:
        raise NotFoundError("Practice session not found")
    if session.student_id != student_id:
        raise ForbiddenError("This practice session belongs to another student")
    return session


async def _dump_with_lesson(session: AISession) -> dict:
    lesson = await prompts.get_lesson(session.audience, session.week, session.day)
    return svc.dump(session, lesson)


@router.get("/config")
async def config(_user: CurrentUser = Depends(require_student)):
    """What the client needs to render the modes and warn about a stub backend."""
    return ok({
        "stages": [{"stage": s, "label": svc.STAGE_LABEL[s]} for s in sorted(svc.STAGES)],
        "score_keys": svc.SCORE_KEYS,
        "score_labels": svc.SCORE_LABEL,
        "provider": ai_client.provider_name(),
        "is_stub": ai_client.is_stub(),
    })


class StartBody(BaseModel):
    week: int = Field(ge=1)
    day: int = Field(ge=1)
    stage: int = Field(ge=1, le=3)


@router.post("/start")
async def start(body: StartBody, user: CurrentUser = Depends(require_student)):
    """Begin a stage for one day. Resumes an existing active session instead of
    creating a duplicate, so a page reload is safe."""
    student = await membership_service.get_student(user.subject)
    session = await svc.start_session(student, body.week, body.day, body.stage)
    return ok(await _dump_with_lesson(session))


@router.get("/active")
async def active(week: int = Query(..., ge=1), day: int = Query(..., ge=1),
                 stage: int = Query(..., ge=1, le=3),
                 user: CurrentUser = Depends(require_student)):
    """The student's in-progress session for this day+stage, if any."""
    session = await AISession.find_one(
        AISession.student_id == user.subject,
        AISession.week == week, AISession.day == day, AISession.stage == stage,
        AISession.status == "active",
        AISession.is_archived == False,  # noqa: E712
    )
    return ok(await _dump_with_lesson(session) if session else None)


class ReplyBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/{session_id}/reply")
async def reply(session_id: str, body: ReplyBody,
                user: CurrentUser = Depends(require_student)):
    """One student turn. While the session is awaiting a repetition this call
    consumes the repetition and only then continues the conversation."""
    session = await _own_session(session_id, user.subject)
    student = await membership_service.get_student(user.subject)
    session = await svc.reply(session, student, body.text)
    return ok(await _dump_with_lesson(session))


@router.post("/{session_id}/better")
async def better(session_id: str, user: CurrentUser = Depends(require_student)):
    """Student asks for a better version of their last response (Stages 1–2)."""
    session = await _own_session(session_id, user.subject)
    student = await membership_service.get_student(user.subject)
    session = await svc.request_better(session, student)
    return ok(await _dump_with_lesson(session))


class ExplainBody(BaseModel):
    language: str | None = None  # defaults to the student's preferred language


@router.post("/{session_id}/explain")
async def explain(session_id: str, body: ExplainBody | None = None,
                  user: CurrentUser = Depends(require_student)):
    """Explain the last correction in the student's preferred language."""
    session = await _own_session(session_id, user.subject)
    student = await membership_service.get_student(user.subject)
    session = await svc.request_explanation(
        session, student, (body.language if body else None))
    return ok(await _dump_with_lesson(session))


@router.post("/{session_id}/restart")
async def restart(session_id: str, user: CurrentUser = Depends(require_student)):
    """Abandon this run and start the same stage over from step one."""
    session = await _own_session(session_id, user.subject)
    student = await membership_service.get_student(user.subject)
    fresh = await svc.restart(session, student)
    return ok(await _dump_with_lesson(fresh), "Practice session restarted")


@router.get("/history")
async def history(limit: int = Query(30, ge=1, le=100),
                  user: CurrentUser = Depends(require_student)):
    """The student's past sessions, newest first — drives the progress view."""
    sessions = await AISession.find(
        AISession.student_id == user.subject,
        AISession.is_archived == False,  # noqa: E712
    ).sort(-AISession.created_at).limit(limit).to_list()
    return ok([{
        "id": str(s.id), "week": s.week, "day": s.day, "stage": s.stage,
        "stage_label": svc.STAGE_LABEL.get(s.stage, ""),
        "status": s.status,
        "sequence_index": s.sequence_index, "sequence_total": s.sequence_total,
        "assessment": s.assessment,
        "created_at": s.created_at.isoformat(),
        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
    } for s in sessions])


@router.get("/{session_id}")
async def get_session(session_id: str, user: CurrentUser = Depends(require_student)):
    session = await _own_session(session_id, user.subject)
    return ok(await _dump_with_lesson(session))


@router.get("/admin/student/{student_id}")
async def admin_student_sessions(student_id: str,
                                 _admin: CurrentUser = Depends(require_admin)):
    """Read-only transcript list for support/QA."""
    sessions = await AISession.find(
        AISession.student_id == student_id,
        AISession.is_archived == False,  # noqa: E712
    ).sort(-AISession.created_at).limit(100).to_list()
    return ok([svc.dump(s) for s in sessions])
