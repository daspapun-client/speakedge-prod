"""Three-stage AI conversation engine.

Stage 1 — Lexical Integration
    Injects the day's target collocations for the student's accent. After every
    student turn: analyse → correct → produce one improved native-like response
    → ask the student to repeat it → **block until they do**.

Stage 2 — Guided Learning
    Same correction/repetition loop, but never re-suggests the target
    expressions (already practised in Stage 1). Adds student controls: request a
    better response, explain a correction in their language, restart.

Stage 3 — Conversation Fluency & Assessment
    No corrections and no suggestions during the conversation. Scores out of 10
    for Fluency, Grammar, Vocabulary, Pronunciation, Native Expressions and
    Overall Communication — produced only once every configured sequence step
    has been completed.

The state machine lives here; the model call is delegated to
shared/ai_client.py so the engine is provider-independent.
"""
from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.db.base import utcnow
from app.db.models import AISession, PromptAudience, Student
from app.modules.prompt_library import service as prompts
from app.shared import ai_client
from app.shared.ai_client import AIRequest

STAGES = {1, 2, 3}
STAGE_LABEL = {
    1: "Lexical Integration",
    2: "Guided Learning",
    3: "Conversation Fluency & Assessment",
}
SCORE_KEYS = ["fluency", "grammar", "vocabulary", "pronunciation",
              "native_expressions", "overall_communication"]
SCORE_LABEL = {
    "fluency": "Fluency",
    "grammar": "Grammar",
    "vocabulary": "Vocabulary",
    "pronunciation": "Pronunciation",
    "native_expressions": "Native Expressions",
    "overall_communication": "Overall Communication",
}


# Owned by the prompt library (students pick a stage; the accent-specific slot
# is derived from their profile). Re-exported so existing callers keep working.
slot_for_stage = prompts.slot_for_stage


def _msg(role: str, text: str, kind: str = "text", **extra) -> dict:
    return {"role": role, "text": text, "kind": kind,
            "created_at": utcnow().isoformat(), **extra}


async def _resolve_lesson(student: Student, week: int, day: int):
    """Load the day's lesson, validating everything a session depends on."""
    aud: PromptAudience = student.audience
    prompts.validate_coords(aud.value, week, day)
    lesson = await prompts.get_lesson(aud, week, day)
    if not lesson or not lesson.published:
        raise NotFoundError(
            f"Week {week} · Day {day} is not available yet. Please check back soon.")
    if not lesson.conversation_sequence:
        raise ValidationAppError(
            "This lesson has no conversation sequence configured yet. "
            "Please contact support — an administrator needs to complete it.")
    return lesson


async def start_session(student: Student, week: int, day: int, stage: int) -> AISession:
    """Begin (or resume) a session. An active session for the same day+stage is
    returned as-is so a page reload never loses the conversation."""
    if stage not in STAGES:
        raise ValidationAppError("stage must be 1, 2 or 3")
    lesson = await _resolve_lesson(student, week, day)

    existing = await AISession.find_one(
        AISession.student_id == student.student_id,
        AISession.week == week,
        AISession.day == day,
        AISession.stage == stage,
        AISession.status == "active",
        AISession.is_archived == False,  # noqa: E712
    )
    if existing:
        return existing

    accent = prompts.accent_key(student.preferred_english)
    cefr = prompts.validate_cefr(student.cefr_level)
    language = student.preferred_language or settings.DEFAULT_LANGUAGE
    sequence = lesson.conversation_sequence

    session = AISession(
        student_id=student.student_id,
        audience=student.audience,
        week=week, day=day, stage=stage,
        accent=accent, cefr_level=cefr, language=language,
        sequence_total=len(sequence),
    )

    # Opening turn — the first step of the configured sequence.
    system_prompt = (await _render(student, week, day, stage, accent))["body"]
    reply = await ai_client.generate(AIRequest(
        system_prompt=system_prompt, history=[], student_text="",
        stage=stage, cefr_level=cefr, accent=accent, language=language,
        sequence_step=sequence[0],
        target_expressions=_stage_expressions(lesson, accent, stage),
        intent="open",
    ))
    session.messages = [_msg("tutor", reply.text, "question")]
    await session.insert()
    return session


async def _render(student: Student, week: int, day: int, stage: int, accent: str) -> dict:
    return await prompts.render_for_student(
        student, week, day, slot_for_stage(stage, accent))


def _stage_expressions(lesson, accent: str, stage: int) -> list[str]:
    """Stage 1 injects target collocations; Stages 2 and 3 must not (the spec
    is explicit that they were already practised)."""
    if stage != 1:
        return []
    return prompts.lesson_expressions(lesson, accent)


def _guard_active(session: AISession) -> None:
    if session.status != "active":
        raise ConflictError(
            "This practice session has already finished. Start a new one to continue.")
    if len(session.messages) >= settings.AI_MAX_TURNS * 2:
        raise ConflictError(
            "This session has reached its length limit. Please start a new session.")


async def reply(session: AISession, student: Student, text: str) -> AISession:
    """Handle one student turn, honouring the repetition gate."""
    _guard_active(session)
    text = (text or "").strip()
    if not text:
        raise ValidationAppError("Please say or type something first")

    lesson = await _resolve_lesson(student, session.week, session.day)
    sequence = lesson.conversation_sequence
    # A lesson edited mid-session must not strand the student past the end.
    session.sequence_total = len(sequence)
    session.messages.append(_msg("student", text))

    # --- Stages 1 & 2: the mandatory repetition gate ------------------------
    if session.awaiting_repetition:
        session.awaiting_repetition = False
        session.pending_model_answer = None
        session.messages.append(_msg(
            "tutor", "Well done — that sounded much more natural. Let's continue.",
            "repetition_accepted"))
        return await _advance(session, student, lesson, sequence)

    system_prompt = (await _render(student, session.week, session.day,
                                   session.stage, session.accent))["body"]
    step = sequence[min(session.sequence_index, len(sequence) - 1)]
    ai = await ai_client.generate(AIRequest(
        system_prompt=system_prompt,
        history=session.messages[-10:], student_text=text,
        stage=session.stage, cefr_level=session.cefr_level,
        accent=session.accent, language=session.language,
        sequence_step=step,
        target_expressions=_stage_expressions(lesson, session.accent, session.stage),
        intent="reply",
    ))

    if session.stage == 3:
        # Fluency mode never interrupts — just move the conversation forward.
        session.messages.append(_msg("tutor", ai.text, "question"))
        return await _advance(session, student, lesson, sequence, emit_question=False)

    session.messages.append(_msg("tutor", ai.text, "correction",
                                 correction=ai.correction))
    if ai.model_answer:
        session.awaiting_repetition = True
        session.pending_model_answer = ai.model_answer
        session.messages.append(_msg(
            "tutor",
            f'Please repeat this: "{ai.model_answer}"',
            "repeat_request", model_answer=ai.model_answer))
        session.touch()
        await session.save()
        return session
    return await _advance(session, student, lesson, sequence)


async def _advance(session: AISession, student: Student, lesson,
                   sequence: list[str], emit_question: bool = True) -> AISession:
    """Move to the next sequence step, or finish the session."""
    session.sequence_index += 1
    if session.sequence_index >= len(sequence):
        return await _complete(session, student)

    if emit_question:
        system_prompt = (await _render(student, session.week, session.day,
                                       session.stage, session.accent))["body"]
        ai = await ai_client.generate(AIRequest(
            system_prompt=system_prompt, history=session.messages[-10:],
            student_text="", stage=session.stage, cefr_level=session.cefr_level,
            accent=session.accent, language=session.language,
            sequence_step=sequence[session.sequence_index],
            target_expressions=_stage_expressions(lesson, session.accent, session.stage),
            intent="open",
        ))
        session.messages.append(_msg("tutor", ai.text, "question"))
    session.touch()
    await session.save()
    return session


async def _complete(session: AISession, student: Student) -> AISession:
    """Finish the session. Stage 3 additionally produces the assessment — and
    only here, i.e. strictly after every configured sequence is done."""
    if session.stage == 3:
        system_prompt = (await _render(student, session.week, session.day,
                                       session.stage, session.accent))["body"]
        ai = await ai_client.generate(AIRequest(
            system_prompt=system_prompt, history=session.messages,
            student_text="", stage=3, cefr_level=session.cefr_level,
            accent=session.accent, language=session.language,
            sequence_step=None, target_expressions=[], intent="assess",
        ))
        scores = ai.scores or {}
        session.assessment = {
            "scores": {k: scores.get(k, 0) for k in SCORE_KEYS},
            "labels": SCORE_LABEL,
            "max_score": 10,
            "generated_at": utcnow().isoformat(),
        }
        session.messages.append(_msg("tutor", ai.text, "assessment"))
    else:
        session.messages.append(_msg(
            "tutor",
            "That's the end of today's practice — great work. "
            "You can move on to the next mode whenever you're ready.",
            "completed"))
    session.status = "completed"
    session.completed_at = utcnow()
    session.touch()
    await session.save()
    return session


async def request_better(session: AISession, student: Student) -> AISession:
    """Stage 2 control: ask for a stronger version of the last answer."""
    _guard_active(session)
    if session.stage == 3:
        raise ConflictError(
            "Suggestions are not available during a fluency assessment.")
    last_student = next(
        (m for m in reversed(session.messages) if m.get("role") == "student"), None)
    if not last_student:
        raise ConflictError("Say something first, then I can suggest a better version.")
    system_prompt = (await _render(student, session.week, session.day,
                                   session.stage, session.accent))["body"]
    ai = await ai_client.generate(AIRequest(
        system_prompt=system_prompt, history=session.messages[-10:],
        student_text=last_student["text"], stage=session.stage,
        cefr_level=session.cefr_level, accent=session.accent,
        language=session.language, sequence_step=None,
        target_expressions=[], intent="better",
    ))
    session.messages.append(_msg("tutor", ai.text, "better"))
    if ai.model_answer:
        session.awaiting_repetition = True
        session.pending_model_answer = ai.model_answer
        session.messages.append(_msg(
            "tutor", f'Please repeat this: "{ai.model_answer}"',
            "repeat_request", model_answer=ai.model_answer))
    session.touch()
    await session.save()
    return session


async def request_explanation(session: AISession, student: Student,
                              language: str | None = None) -> AISession:
    """Stage 2 control: explain the last correction in the student's language."""
    _guard_active(session)
    if session.stage == 3:
        raise ConflictError(
            "Explanations are not available during a fluency assessment.")
    last_correction = next(
        (m for m in reversed(session.messages)
         if m.get("kind") in ("correction", "repeat_request", "better")), None)
    if not last_correction:
        raise ConflictError("There is no correction to explain yet.")
    lang = language or session.language or settings.DEFAULT_LANGUAGE
    system_prompt = (await _render(student, session.week, session.day,
                                   session.stage, session.accent))["body"]
    ai = await ai_client.generate(AIRequest(
        system_prompt=system_prompt, history=session.messages[-10:],
        student_text=last_correction.get("text", ""), stage=session.stage,
        cefr_level=session.cefr_level, accent=session.accent, language=lang,
        sequence_step=None, target_expressions=[], intent="explain",
    ))
    session.messages.append(_msg("tutor", ai.text, "explanation", language=lang))
    session.touch()
    await session.save()
    return session


async def restart(session: AISession, student: Student) -> AISession:
    """Abandon the current run and open a fresh session for the same day+stage."""
    if session.status == "active":
        session.status = "abandoned"
        session.touch()
        await session.save()
    return await start_session(student, session.week, session.day, session.stage)


def dump(session: AISession, lesson=None) -> dict:
    """Session payload for the UI — progress, gate state and assessment."""
    data = session.model_dump(mode="json")
    data["stage_label"] = STAGE_LABEL.get(session.stage, "")
    data["progress"] = {
        "step": min(session.sequence_index + 1, max(session.sequence_total, 1)),
        "total": session.sequence_total,
        "percent": (
            round(100 * session.sequence_index / session.sequence_total)
            if session.sequence_total else 0
        ),
    }
    data["can_request_better"] = session.status == "active" and session.stage in (1, 2)
    data["can_request_explanation"] = session.status == "active" and session.stage in (1, 2)
    if lesson is not None:
        data["day_topic"] = lesson.day_topic
        data["title"] = lesson.title
        data["context"] = lesson.context
        data["sequence_step"] = (
            lesson.conversation_sequence[session.sequence_index]
            if session.sequence_index < len(lesson.conversation_sequence) else None
        )
    return data
