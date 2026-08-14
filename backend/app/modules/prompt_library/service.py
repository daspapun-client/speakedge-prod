"""SpeakEdge Prompt Library.

Hierarchy: Audience (adults | kids) → Week (1..48) → Day (1..6) → 5 prompt slots.

Storage deliberately avoids materialising 2,880 near-identical prompts:

* ``PromptTemplate`` — one reusable instruction body per (audience, slot).
  ~10 documents. Carries ``{{placeholders}}`` filled at render time.
* ``PromptLesson`` — one document per (audience, week, day) holding only what
  varies: the topic, the conversation sequence and the target collocations per
  accent, plus ``overrides`` for individually hand-edited prompts.

Rendering resolves ``lesson.overrides[slot]`` first, then the shared template.
Student parameters (CEFR level, preferred English) are injected from the
profile — a prompt is never edited by hand to change them.
"""
from app.core.config import settings
from app.core.exceptions import NotFoundError, ValidationAppError
from app.db.models import (
    CEFR_LEVELS,
    ENGLISH_STYLE_KEY,
    EnglishStyle,
    PromptAudience,
    PromptLesson,
    PromptTemplate,
    Student,
)

# The five prompt slots per day (spec). Three accent-specific Lexical
# Integration variants, then Learning and Assessment which take the accent from
# the student's profile rather than having one slot each.
SLOTS: list[dict] = [
    {"key": "lexical_british", "label": "Lexical Integration – British", "stage": 1, "accent": "british"},
    {"key": "lexical_american", "label": "Lexical Integration – American", "stage": 1, "accent": "american"},
    {"key": "lexical_international", "label": "Lexical Integration – International", "stage": 1, "accent": "international"},
    {"key": "learning", "label": "Learning Mode – British/American/International", "stage": 2, "accent": None},
    {"key": "assessment", "label": "Assessment & Fluency Mode – British/American/International", "stage": 3, "accent": None},
]
SLOT_KEYS = [s["key"] for s in SLOTS]
SLOT_BY_KEY = {s["key"]: s for s in SLOTS}
STAGE_SLOTS = {1: "lexical", 2: "learning", 3: "assessment"}

# Default day structure (spec). Admin-editable per lesson via day_topic.
DEFAULT_DAY_TOPICS: dict[int, str] = {
    1: "Conversation",
    2: "Conversation",
    3: "Conversation",
    4: "IELTS Speaking",
    5: "GD / Debate / Storytelling / Public Speaking",
    6: "Job Interview",
}

ACCENTS = ["british", "american", "international"]


def weeks() -> int:
    return settings.PROMPT_WEEKS


def days_per_week() -> int:
    return settings.PROMPT_DAYS_PER_WEEK


def default_day_topic(day: int) -> str:
    """Falls back to Conversation for days beyond the 6-day default table."""
    return DEFAULT_DAY_TOPICS.get(day, "Conversation")


def validate_coords(audience: str, week: int, day: int) -> PromptAudience:
    try:
        aud = PromptAudience(audience)
    except ValueError:
        raise ValidationAppError(
            f"audience must be one of {[a.value for a in PromptAudience]}")
    if not 1 <= week <= weeks():
        raise ValidationAppError(f"week must be between 1 and {weeks()}")
    if not 1 <= day <= days_per_week():
        raise ValidationAppError(f"day must be between 1 and {days_per_week()}")
    return aud


def validate_cefr(level: str | None) -> str:
    """Invalid/unset CEFR falls back to B1 rather than failing a session —
    cefr_level is self-declared and may legitimately be blank."""
    if level and level.upper() in CEFR_LEVELS:
        return level.upper()
    return "B1"


def validate_english(style) -> EnglishStyle:
    if isinstance(style, EnglishStyle):
        return style
    try:
        return EnglishStyle(style)
    except (ValueError, TypeError):
        return EnglishStyle.international


def accent_key(style) -> str:
    return ENGLISH_STYLE_KEY[validate_english(style)]


def slot_for_stage(stage: int, accent: str) -> str:
    """Map a student-facing stage (1|2|3) to a prompt slot. Students choose a
    stage, never a slot — the lexical accent comes from their profile."""
    if stage not in (1, 2, 3):
        raise ValidationAppError("stage must be 1, 2 or 3")
    if stage == 1:
        return f"lexical_{accent}"
    return "learning" if stage == 2 else "assessment"


# ---------------------------------------------------------------------------
# Template bodies (seeded once, then fully admin-editable)
# ---------------------------------------------------------------------------
_COMMON_HEADER = """You are a patient, friendly and encouraging English tutor for SpeakEdge.

Student parameters (never ask the student for these — they come from the profile):
- CEFR Level: {{cefr_level}}
- Preferred English: {{preferred_english}}
- Audience: {{audience}}

Lesson: Week {{week}}, Day {{day}} — {{day_topic}}
Topic: {{title}}
Context: {{context}}

Conversation sequence — follow it exactly, in order:
{{sequence}}

Rules that always apply:
- Use vocabulary and structures appropriate to CEFR level {{cefr_level}}.
- Consistently use {{preferred_english}} spelling, vocabulary and idiom.
- Ask ONLY ONE question at a time. Never stack questions.
- Stay warm and encouraging; never make the student feel judged."""

_STAGE1_BODY = _COMMON_HEADER + """

STAGE 1 — LEXICAL INTEGRATION MODE

Target collocations and expressions for this lesson:
{{target_expressions}}

- Use the target expressions naturally in your own turns.
- Encourage the student to use them.
- If the student misses an opportunity to use one, naturally supply a response
  that contains the relevant expression so they hear it in context.

After EVERY student response, run this sequence without exception:
1. Analyse the response.
2. Correct grammar, vocabulary, pronunciation and unnatural expression issues.
3. Generate ONE improved, native-like version of what they said.
4. Ask the student to repeat that improved version.
5. WAIT. Do not continue the conversation until the student has repeated it.

Do not move to the next step of the conversation sequence until the repetition
is complete."""

_STAGE2_BODY = _COMMON_HEADER + """

STAGE 2 — GUIDED LEARNING MODE

Do NOT suggest or introduce the target collocations and expressions again —
the student already practised them in Stage 1. Keep the same conversation
context and sequence.

After every student response:
1. Identify the language mistakes.
2. Correct grammar, vocabulary, pronunciation and natural expression.
3. Generate ONE improved, native-like response appropriate to CEFR {{cefr_level}}.
4. Ask the student to repeat it.
5. WAIT for the repetition before continuing.

The student may also:
- Ask for a better response — provide a stronger alternative.
- Ask for an explanation of a correction in {{explain_language}} — explain it there.
- Restart the practice session — begin again from the first sequence step."""

_STAGE3_BODY = _COMMON_HEADER + """

STAGE 3 — CONVERSATION FLUENCY & ASSESSMENT MODE

During the conversation:
- Let the conversation flow naturally.
- Do NOT interrupt the student with corrections.
- Do NOT offer suggestions or improved responses.
- Keep to CEFR {{cefr_level}} vocabulary and {{preferred_english}}.
- Ask only one question at a time and follow the configured sequence.

ONLY after every step of the conversation sequence has been completed, produce
an assessment scoring the student out of 10 on each of:
Fluency, Grammar, Vocabulary, Pronunciation, Native Expressions,
Overall Communication.

Never produce the assessment before all sequences are complete."""

TEMPLATE_SEEDS: list[dict] = [
    {"slot": "lexical_british", "stage": 1, "label": "Lexical Integration – British", "body": _STAGE1_BODY},
    {"slot": "lexical_american", "stage": 1, "label": "Lexical Integration – American", "body": _STAGE1_BODY},
    {"slot": "lexical_international", "stage": 1, "label": "Lexical Integration – International", "body": _STAGE1_BODY},
    {"slot": "learning", "stage": 2, "label": "Learning Mode – British/American/International", "body": _STAGE2_BODY},
    {"slot": "assessment", "stage": 3, "label": "Assessment & Fluency Mode – British/American/International", "body": _STAGE3_BODY},
]


async def ensure_templates(audience: PromptAudience = PromptAudience.adults) -> list[PromptTemplate]:
    """Seed the five slot templates for an audience if they don't exist yet.
    Idempotent — existing (admin-edited) templates are never overwritten."""
    out: list[PromptTemplate] = []
    for seed in TEMPLATE_SEEDS:
        existing = await PromptTemplate.find_one(
            PromptTemplate.audience == audience,
            PromptTemplate.slot == seed["slot"],
            PromptTemplate.is_archived == False,  # noqa: E712
        )
        if existing:
            out.append(existing)
            continue
        tpl = PromptTemplate(audience=audience, **seed)
        await tpl.insert()
        out.append(tpl)
    return out


async def get_template(audience: PromptAudience, slot: str) -> PromptTemplate:
    tpl = await PromptTemplate.find_one(
        PromptTemplate.audience == audience,
        PromptTemplate.slot == slot,
        PromptTemplate.is_archived == False,  # noqa: E712
    )
    if tpl:
        return tpl
    await ensure_templates(audience)
    tpl = await PromptTemplate.find_one(
        PromptTemplate.audience == audience,
        PromptTemplate.slot == slot,
        PromptTemplate.is_archived == False,  # noqa: E712
    )
    if not tpl:
        raise NotFoundError(f"No prompt template configured for slot '{slot}'")
    return tpl


# ---------------------------------------------------------------------------
# Lessons
# ---------------------------------------------------------------------------
async def get_lesson(audience: PromptAudience, week: int, day: int) -> PromptLesson | None:
    return await PromptLesson.find_one(
        PromptLesson.audience == audience,
        PromptLesson.week == week,
        PromptLesson.day == day,
        PromptLesson.is_archived == False,  # noqa: E712
    )


async def get_or_create_lesson(audience: PromptAudience, week: int, day: int) -> PromptLesson:
    """Lessons are created lazily on first access so a fresh install does not
    bulk-insert 576 empty documents."""
    lesson = await get_lesson(audience, week, day)
    if lesson:
        return lesson
    lesson = PromptLesson(
        audience=audience, week=week, day=day,
        day_topic=default_day_topic(day),
        title=f"Week {week} · Day {day}",
        target_expressions={a: [] for a in ACCENTS},
    )
    await lesson.insert()
    return lesson


def lesson_expressions(lesson: PromptLesson, accent: str) -> list[str]:
    """Target expressions for an accent, falling back to International then to
    any accent that has content — a lesson configured for only one accent still
    works for every student."""
    exprs = lesson.target_expressions or {}
    for key in (accent, "international"):
        if exprs.get(key):
            return exprs[key]
    for value in exprs.values():
        if value:
            return value
    return []


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------
def _substitute(body: str, params: dict) -> str:
    for key, value in params.items():
        body = body.replace("{{" + key + "}}", str(value))
    return body


def build_params(lesson: PromptLesson, *, cefr_level: str, english: EnglishStyle,
                 accent: str, explain_language: str = "English") -> dict:
    sequence = lesson.conversation_sequence or []
    exprs = lesson_expressions(lesson, accent)
    return {
        "cefr_level": cefr_level,
        "preferred_english": english.value,
        "audience": lesson.audience.value,
        "week": lesson.week,
        "day": lesson.day,
        "day_topic": lesson.day_topic,
        "title": lesson.title or f"Week {lesson.week} · Day {lesson.day}",
        "context": lesson.context or "(no additional context configured)",
        "sequence": (
            "\n".join(f"{i}. {s}" for i, s in enumerate(sequence, 1))
            if sequence else "(no conversation sequence configured)"
        ),
        "target_expressions": (
            "\n".join(f"- {e}" for e in exprs) if exprs
            else "(no target expressions configured for this lesson)"
        ),
        "explain_language": explain_language,
    }


async def render_prompt(
    audience: PromptAudience, week: int, day: int, slot: str, *,
    cefr_level: str = "B1",
    english: EnglishStyle = EnglishStyle.international,
    explain_language: str = "English",
    create_missing: bool = False,
) -> dict:
    """Resolve one prompt to its final text.

    Precedence: the lesson's per-slot override (a hand-edited prompt) wins;
    otherwise the shared template body is rendered with this lesson's data and
    the student's parameters."""
    if slot not in SLOT_BY_KEY:
        raise ValidationAppError(f"slot must be one of {SLOT_KEYS}")
    lesson = await (get_or_create_lesson if create_missing else get_lesson)(audience, week, day)
    if not lesson:
        raise NotFoundError(
            f"No prompt configured for {audience.value} · Week {week} · Day {day}")

    slot_meta = SLOT_BY_KEY[slot]
    # Accent-specific slots pin their own accent; Learning/Assessment take the
    # student's preferred English.
    accent = slot_meta["accent"] or accent_key(english)
    params = build_params(lesson, cefr_level=cefr_level, english=english,
                          accent=accent, explain_language=explain_language)

    override = (lesson.overrides or {}).get(slot)
    if override:
        return {
            "slot": slot, "label": slot_meta["label"], "stage": slot_meta["stage"],
            "accent": accent, "source": "override",
            "body": _substitute(override, params), "params": params,
            "lesson_id": str(lesson.id),
        }
    tpl = await get_template(audience, slot)
    return {
        "slot": slot, "label": slot_meta["label"], "stage": slot_meta["stage"],
        "accent": accent, "source": "template",
        "body": _substitute(tpl.body, params), "params": params,
        "lesson_id": str(lesson.id),
    }


async def render_for_student(
    student: Student, week: int, day: int, slot: str, *,
    cefr_level: str | None = None,
    english: EnglishStyle | str | None = None,
) -> dict:
    """Render a prompt with the parameters taken from the student's profile.

    ``cefr_level`` / ``english`` override the profile for *this render only* —
    the library page lets a student try another level or accent and see the
    prompt change. Nothing is written back to the ``Student`` row, so an actual
    AI session (which passes neither) always runs on the real profile."""
    return await render_prompt(
        student.audience, week, day, slot,
        cefr_level=validate_cefr(cefr_level if cefr_level is not None else student.cefr_level),
        english=validate_english(english if english is not None else student.preferred_english),
        explain_language=student.preferred_language or settings.DEFAULT_LANGUAGE,
        create_missing=False,
    )


def lesson_dump(lesson: PromptLesson) -> dict:
    """Lesson payload plus which slots carry a hand-edited override."""
    data = lesson.model_dump(mode="json")
    data["overridden_slots"] = sorted((lesson.overrides or {}).keys())
    return data
