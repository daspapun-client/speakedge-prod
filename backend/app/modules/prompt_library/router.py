"""Prompt Library API.

Admin: browse the Audience → Week → Day → Slot hierarchy, read a rendered
prompt, edit an individual prompt, copy a prompt from another day, and manage
the five shared slot templates.

Student: read-only access to the day's prompts, already rendered with their own
CEFR level and preferred English.
"""
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.core.envelope import ok
from app.core.exceptions import ConflictError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, require_admin, require_student
from app.db.models import CEFR_LEVELS, EnglishStyle, PromptAudience, PromptLesson, PromptTemplate
from app.modules.membership import service as membership_service
from app.modules.prompt_library import service as svc
from app.shared.audit import log_activity

router = APIRouter(prefix="/prompt-library", tags=["prompt-library"])


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------
@router.get("/structure")
async def structure(_admin: CurrentUser = Depends(require_admin)):
    """The library's shape — drives the admin navigator without hard-coding
    48/6/5 in the frontend."""
    return ok({
        "audiences": [a.value for a in PromptAudience],
        "weeks": svc.weeks(),
        "days_per_week": svc.days_per_week(),
        "slots": svc.SLOTS,
        "default_day_topics": svc.DEFAULT_DAY_TOPICS,
        "accents": svc.ACCENTS,
        "cefr_levels": CEFR_LEVELS,
        "english_styles": [e.value for e in EnglishStyle],
    })


@router.get("/weeks")
async def list_weeks(audience: str = "adults", _admin: CurrentUser = Depends(require_admin)):
    """Per-week completion overview: how many of the week's days are configured."""
    aud = svc.validate_coords(audience, 1, 1)
    lessons = await PromptLesson.find(
        PromptLesson.audience == aud,
        PromptLesson.is_archived == False,  # noqa: E712
    ).to_list()
    by_week: dict[int, list[PromptLesson]] = {}
    for lsn in lessons:
        by_week.setdefault(lsn.week, []).append(lsn)
    rows = []
    for week in range(1, svc.weeks() + 1):
        wk = by_week.get(week, [])
        configured = sum(1 for lsn in wk if lsn.conversation_sequence)
        rows.append({
            "week": week,
            "days_total": svc.days_per_week(),
            "days_created": len(wk),
            "days_configured": configured,
        })
    return ok(rows)


@router.get("/days")
async def list_days(audience: str = "adults", week: int = Query(1, ge=1),
                    _admin: CurrentUser = Depends(require_admin)):
    """The six days of one week with their configuration state."""
    aud = svc.validate_coords(audience, week, 1)
    lessons = {
        lsn.day: lsn for lsn in await PromptLesson.find(
            PromptLesson.audience == aud,
            PromptLesson.week == week,
            PromptLesson.is_archived == False,  # noqa: E712
        ).to_list()
    }
    rows = []
    for day in range(1, svc.days_per_week() + 1):
        lsn = lessons.get(day)
        rows.append({
            "day": day,
            "day_topic": lsn.day_topic if lsn else svc.default_day_topic(day),
            "title": lsn.title if lsn else "",
            "exists": lsn is not None,
            "configured": bool(lsn and lsn.conversation_sequence),
            "published": lsn.published if lsn else False,
            "sequence_steps": len(lsn.conversation_sequence) if lsn else 0,
            "overridden_slots": sorted((lsn.overrides or {}).keys()) if lsn else [],
            "id": str(lsn.id) if lsn else None,
        })
    return ok(rows)


# ---------------------------------------------------------------------------
# Lessons (the per-day content)
# ---------------------------------------------------------------------------
@router.get("/lesson")
async def get_lesson(audience: str = "adults", week: int = Query(1, ge=1),
                     day: int = Query(1, ge=1),
                     _admin: CurrentUser = Depends(require_admin)):
    aud = svc.validate_coords(audience, week, day)
    lesson = await svc.get_or_create_lesson(aud, week, day)
    return ok(svc.lesson_dump(lesson))


class LessonUpdate(BaseModel):
    day_topic: str | None = None
    title: str | None = None
    context: str | None = None
    conversation_sequence: list[str] | None = None
    target_expressions: dict[str, list[str]] | None = None
    published: bool | None = None


@router.put("/lesson")
async def update_lesson(body: LessonUpdate, audience: str = "adults",
                        week: int = Query(1, ge=1), day: int = Query(1, ge=1),
                        admin: CurrentUser = Depends(require_admin)):
    aud = svc.validate_coords(audience, week, day)
    lesson = await svc.get_or_create_lesson(aud, week, day)
    changes = body.model_dump(exclude_none=True)
    if "target_expressions" in changes:
        unknown = [k for k in changes["target_expressions"] if k not in svc.ACCENTS]
        if unknown:
            raise ValidationAppError(
                f"target_expressions keys must be in {svc.ACCENTS} (got {unknown})")
    for k, v in changes.items():
        setattr(lesson, k, v)
    lesson.touch()
    await lesson.save()
    await log_activity(admin.subject, "prompt_library.lesson_update", role=admin.role.value,
                       target_type="prompt_lesson", target_id=str(lesson.id),
                       meta={"audience": aud.value, "week": week, "day": day,
                             "fields": sorted(changes)})
    return ok(svc.lesson_dump(lesson), "Lesson saved")


# ---------------------------------------------------------------------------
# Individual prompts
# ---------------------------------------------------------------------------
@router.get("/prompt")
async def read_prompt(audience: str = "adults", week: int = Query(1, ge=1),
                      day: int = Query(1, ge=1), slot: str = "lexical_international",
                      cefr_level: str = "B1", preferred_english: str | None = None,
                      _admin: CurrentUser = Depends(require_admin)):
    """Rendered prompt for the admin viewer/editor. ``cefr_level`` and
    ``preferred_english`` are a *preview* of what a student with those settings
    would receive — they are never stored on the prompt."""
    aud = svc.validate_coords(audience, week, day)
    english = svc.validate_english(preferred_english)
    rendered = await svc.render_prompt(
        aud, week, day, slot,
        cefr_level=svc.validate_cefr(cefr_level), english=english,
        create_missing=True,
    )
    lesson = await svc.get_or_create_lesson(aud, week, day)
    # The raw (un-substituted) text so the editor edits the template, not the
    # rendered output — placeholders must survive an edit.
    if rendered["source"] == "override":
        raw = (lesson.overrides or {}).get(slot, "")
    else:
        raw = (await svc.get_template(aud, slot)).body
    rendered["raw"] = raw
    return ok(rendered)


class PromptOverride(BaseModel):
    body: str = Field(min_length=1)


@router.put("/prompt")
async def edit_prompt(body: PromptOverride, audience: str = "adults",
                      week: int = Query(1, ge=1), day: int = Query(1, ge=1),
                      slot: str = "lexical_international",
                      admin: CurrentUser = Depends(require_admin)):
    """Save a hand-written body for one prompt. Stored as an override on the
    lesson so the shared template — and every other day — is untouched."""
    aud = svc.validate_coords(audience, week, day)
    if slot not in svc.SLOT_BY_KEY:
        raise ValidationAppError(f"slot must be one of {svc.SLOT_KEYS}")
    lesson = await svc.get_or_create_lesson(aud, week, day)
    overrides = dict(lesson.overrides or {})
    overrides[slot] = body.body
    lesson.overrides = overrides
    lesson.touch()
    await lesson.save()
    await log_activity(admin.subject, "prompt_library.prompt_edit", role=admin.role.value,
                       target_type="prompt_lesson", target_id=str(lesson.id),
                       meta={"audience": aud.value, "week": week, "day": day, "slot": slot})
    return ok(svc.lesson_dump(lesson), "Prompt updated")


@router.delete("/prompt")
async def reset_prompt(audience: str = "adults", week: int = Query(1, ge=1),
                       day: int = Query(1, ge=1), slot: str = "lexical_international",
                       admin: CurrentUser = Depends(require_admin)):
    """Drop the override so this prompt renders from the shared template again."""
    aud = svc.validate_coords(audience, week, day)
    lesson = await svc.get_lesson(aud, week, day)
    if not lesson or slot not in (lesson.overrides or {}):
        raise NotFoundError("This prompt has no custom version to reset")
    overrides = dict(lesson.overrides)
    overrides.pop(slot)
    lesson.overrides = overrides
    lesson.touch()
    await lesson.save()
    await log_activity(admin.subject, "prompt_library.prompt_reset", role=admin.role.value,
                       target_type="prompt_lesson", target_id=str(lesson.id),
                       meta={"audience": aud.value, "week": week, "day": day, "slot": slot})
    return ok(svc.lesson_dump(lesson), "Prompt reset to the shared template")


class PromptCopy(BaseModel):
    """Copy one prompt (and optionally the whole lesson) onto another day."""
    from_audience: str = "adults"
    from_week: int = Field(ge=1)
    from_day: int = Field(ge=1)
    to_audience: str = "adults"
    to_week: int = Field(ge=1)
    to_day: int = Field(ge=1)
    slot: str | None = None       # None = copy every slot override
    include_lesson: bool = False  # also copy topic/context/sequence/expressions
    overwrite: bool = False


@router.post("/prompt/copy")
async def copy_prompt(body: PromptCopy, admin: CurrentUser = Depends(require_admin)):
    src_aud = svc.validate_coords(body.from_audience, body.from_week, body.from_day)
    dst_aud = svc.validate_coords(body.to_audience, body.to_week, body.to_day)
    if (src_aud, body.from_week, body.from_day) == (dst_aud, body.to_week, body.to_day):
        raise ValidationAppError("Source and destination are the same day")
    if body.slot and body.slot not in svc.SLOT_BY_KEY:
        raise ValidationAppError(f"slot must be one of {svc.SLOT_KEYS}")

    src = await svc.get_lesson(src_aud, body.from_week, body.from_day)
    if not src:
        raise NotFoundError("Source day has no prompt content to copy")
    dst = await svc.get_or_create_lesson(dst_aud, body.to_week, body.to_day)

    slots = [body.slot] if body.slot else svc.SLOT_KEYS
    overrides = dict(dst.overrides or {})
    copied: list[str] = []
    for slot in slots:
        value = (src.overrides or {}).get(slot)
        if value is None:
            continue
        if slot in overrides and not body.overwrite:
            raise ConflictError(
                f"Destination already has a custom '{slot}' prompt. "
                "Re-send with overwrite=true to replace it.")
        overrides[slot] = value
        copied.append(slot)
    dst.overrides = overrides

    if body.include_lesson:
        dst.day_topic = src.day_topic
        dst.title = src.title
        dst.context = src.context
        dst.conversation_sequence = list(src.conversation_sequence)
        dst.target_expressions = {k: list(v) for k, v in (src.target_expressions or {}).items()}

    if not copied and not body.include_lesson:
        raise ValidationAppError("Nothing to copy — the source day has no custom prompts")

    dst.touch()
    await dst.save()
    await log_activity(admin.subject, "prompt_library.prompt_copy", role=admin.role.value,
                       target_type="prompt_lesson", target_id=str(dst.id),
                       meta={"from": [src_aud.value, body.from_week, body.from_day],
                             "to": [dst_aud.value, body.to_week, body.to_day],
                             "slots": copied, "include_lesson": body.include_lesson})
    return ok(svc.lesson_dump(dst), f"Copied {len(copied)} prompt(s)")


# ---------------------------------------------------------------------------
# Shared slot templates
# ---------------------------------------------------------------------------
@router.get("/templates")
async def list_templates(audience: str = "adults",
                         _admin: CurrentUser = Depends(require_admin)):
    aud = svc.validate_coords(audience, 1, 1)
    await svc.ensure_templates(aud)
    tpls = await PromptTemplate.find(
        PromptTemplate.audience == aud,
        PromptTemplate.is_archived == False,  # noqa: E712
    ).to_list()
    order = {k: i for i, k in enumerate(svc.SLOT_KEYS)}
    tpls.sort(key=lambda t: order.get(t.slot, 99))
    return ok([t.model_dump(mode="json") for t in tpls])


class TemplateUpdate(BaseModel):
    body: str | None = Field(default=None, min_length=1)
    label: str | None = None
    enabled: bool | None = None


@router.put("/templates/{template_id}")
async def update_template(template_id: str, body: TemplateUpdate,
                          admin: CurrentUser = Depends(require_admin)):
    """Editing a template changes every day that has not been overridden —
    this is how one edit propagates across all 48 weeks."""
    tpl = await PromptTemplate.get(template_id)
    if not tpl or tpl.is_archived:
        raise NotFoundError("Prompt template not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(tpl, k, v)
    tpl.touch()
    await tpl.save()
    await log_activity(admin.subject, "prompt_library.template_update", role=admin.role.value,
                       target_type="prompt_template", target_id=template_id,
                       meta={"slot": tpl.slot, "audience": tpl.audience.value})
    return ok(tpl.model_dump(mode="json"), "Template saved")


# ---------------------------------------------------------------------------
# Student-facing (read-only, rendered with their own profile parameters)
# ---------------------------------------------------------------------------
@router.get("/me/day")
async def my_day(week: int | None = None, day: int | None = None,
                 cefr_level: str | None = None, preferred_english: str | None = None,
                 user: CurrentUser = Depends(require_student)):
    """The prompts for one day of the student's own journey, rendered with
    their CEFR level and preferred English. Defaults to where they are now.

    ``cefr_level`` / ``preferred_english`` are an optional preview — see
    ``my_prompt`` below."""
    student = await membership_service.get_student(user.subject)
    week = week or student.learning_week or 1
    day = day or student.learning_day or 1
    aud = svc.validate_coords(student.audience.value, week, day)
    lesson = await svc.get_lesson(aud, week, day)
    if not lesson or not lesson.published:
        raise NotFoundError(
            f"Week {week} · Day {day} is not available yet. Please check back soon.")

    english = svc.validate_english(
        preferred_english if preferred_english is not None else student.preferred_english)
    accent = svc.accent_key(english)
    cefr = svc.validate_cefr(cefr_level if cefr_level is not None else student.cefr_level)
    # Students see three modes, not five slots: the Lexical slot is picked by
    # their preferred English automatically.
    modes = []
    for stage, slot in ((1, f"lexical_{accent}"), (2, "learning"), (3, "assessment")):
        try:
            rendered = await svc.render_for_student(
                student, week, day, slot, cefr_level=cefr, english=english)
        except NotFoundError:
            continue
        modes.append({
            "stage": stage, "slot": slot, "label": rendered["label"],
            "accent": rendered["accent"],
        })
    return ok({
        "week": week, "day": day,
        "weeks_total": svc.weeks(), "days_total": svc.days_per_week(),
        "day_topic": lesson.day_topic, "title": lesson.title, "context": lesson.context,
        "conversation_sequence": lesson.conversation_sequence,
        "sequence_steps": len(lesson.conversation_sequence),
        "cefr_level": cefr,
        "preferred_english": english.value,
        "audience": aud.value,
        "modes": modes,
        "current_week": student.learning_week,
        "current_day": student.learning_day,
    })


@router.get("/me/prompt")
async def my_prompt(week: int = Query(..., ge=1), day: int = Query(..., ge=1),
                    stage: int = Query(..., ge=1, le=3),
                    cefr_level: str | None = None, preferred_english: str | None = None,
                    user: CurrentUser = Depends(require_student)):
    """Read-only view of the prompt behind one mode, rendered with this
    student's own CEFR level and preferred English.

    ``cefr_level`` and ``preferred_english`` let the student re-render the same
    prompt as another level or accent would receive it — the Prompt Library page
    exposes them as dropdowns. They are a *preview only*: nothing is written to
    the profile, and an AI session still runs on the stored values. Unknown
    values fall back (B1 / International) rather than erroring.

    Students can view but never edit — editing lives on the admin routes above,
    which are guarded by ``require_admin``. ``raw`` + ``params`` are included so
    the UI can highlight dynamic values; students never receive an edit path."""
    student = await membership_service.get_student(user.subject)
    aud = svc.validate_coords(student.audience.value, week, day)
    lesson = await svc.get_lesson(aud, week, day)
    if not lesson or not lesson.published:
        raise NotFoundError(
            f"Week {week} · Day {day} is not available yet. Please check back soon.")

    english = svc.validate_english(
        preferred_english if preferred_english is not None else student.preferred_english)
    slot = svc.slot_for_stage(stage, svc.accent_key(english))
    rendered = await svc.render_for_student(
        student, week, day, slot, cefr_level=cefr_level, english=english)
    if rendered["source"] == "override":
        raw = (lesson.overrides or {}).get(slot, "")
    else:
        raw = (await svc.get_template(aud, slot)).body
    return ok({
        "week": week, "day": day, "stage": stage,
        "slot": rendered["slot"], "label": rendered["label"],
        "accent": rendered["accent"],
        "body": rendered["body"],
        "raw": raw,
        "params": rendered["params"],
        "cefr_level": rendered["params"]["cefr_level"],
        "preferred_english": rendered["params"]["preferred_english"],
        "day_topic": lesson.day_topic,
        "title": lesson.title,
        "editable": False,
    })


@router.get("/me/overview")
async def my_overview(user: CurrentUser = Depends(require_student)):
    """Week/day grid for the student's Learning page — which days are live."""
    student = await membership_service.get_student(user.subject)
    lessons = await PromptLesson.find(
        PromptLesson.audience == student.audience,
        PromptLesson.published == True,  # noqa: E712
        PromptLesson.is_archived == False,  # noqa: E712
    ).to_list()
    available: dict[int, list[dict]] = {}
    for lsn in lessons:
        if not lsn.conversation_sequence:
            continue  # unconfigured days are not offered to students
        available.setdefault(lsn.week, []).append(
            {"day": lsn.day, "day_topic": lsn.day_topic, "title": lsn.title})
    for days in available.values():
        days.sort(key=lambda d: d["day"])
    return ok({
        "weeks_total": svc.weeks(),
        "days_total": svc.days_per_week(),
        "current_week": student.learning_week,
        "current_day": student.learning_day,
        "cefr_level": svc.validate_cefr(student.cefr_level),
        "preferred_english": svc.validate_english(student.preferred_english).value,
        "audience": student.audience.value,
        # The dropdown options for the Prompt Library's preview controls —
        # /structure is admin-only, so students get the allowlists here.
        "cefr_levels": CEFR_LEVELS,
        "english_styles": [e.value for e in EnglishStyle],
        "available": [{"week": w, "days": d} for w, d in sorted(available.items())],
    })
