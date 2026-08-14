"""Prompt Library: rendering with student parameters, per-prompt overrides,
copy, and the validation/edge cases the spec calls out."""
import pytest

from app.core.security import Role, create_access_token
from app.db.models import EnglishStyle, MembershipStatus, PromptAudience, Student
from app.modules.prompt_library import service as svc


def _auth(role: Role, subject: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token(subject, role.value)}"}


ADMIN = _auth(Role.admin, "admin@test")


async def _configure_day(client, week=1, day=1, audience="adults"):
    """Give a day a sequence + target expressions so it is student-ready."""
    r = await client.put(
        "/api/v1/prompt-library/lesson",
        headers=ADMIN,
        params={"audience": audience, "week": week, "day": day},
        json={
            "title": "Ordering at a cafe",
            "context": "You are at a busy coffee shop.",
            "conversation_sequence": [
                "Greet the barista and ask what they recommend.",
                "Order your drink and ask about the size options.",
                "Pay and thank the barista.",
            ],
            "target_expressions": {
                "british": ["I'd fancy a flat white", "That's spot on"],
                "american": ["I'll go with a latte", "Sounds great"],
                "international": ["I would like a coffee", "That sounds good"],
            },
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]


@pytest.mark.asyncio
async def test_structure_is_configurable_not_hardcoded(client):
    r = await client.get("/api/v1/prompt-library/structure", headers=ADMIN)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["weeks"] == 48
    assert data["days_per_week"] == 6
    assert len(data["slots"]) == 5
    assert data["audiences"] == ["adults", "kids"]
    # Day topics match the spec's default structure.
    assert data["default_day_topics"]["4"] == "IELTS Speaking"
    assert data["default_day_topics"]["6"] == "Job Interview"


@pytest.mark.asyncio
async def test_render_injects_student_parameters(client):
    await _configure_day(client)
    r = await client.get(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 1, "day": 1, "slot": "lexical_british",
                "cefr_level": "C1", "preferred_english": "British English"},
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["source"] == "template"
    assert data["stage"] == 1
    # Dynamic parameters are substituted — no manual prompt editing needed.
    assert "C1" in data["body"]
    assert "British English" in data["body"]
    assert "I'd fancy a flat white" in data["body"]
    assert "{{cefr_level}}" not in data["body"]
    # The editor gets the raw template so placeholders survive an edit.
    assert "{{cefr_level}}" in data["raw"]


@pytest.mark.asyncio
async def test_accent_slots_pick_their_own_expressions(client):
    await _configure_day(client)
    american = (await client.get(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 1, "day": 1, "slot": "lexical_american"},
    )).json()["data"]
    assert "I'll go with a latte" in american["body"]
    assert "I'd fancy a flat white" not in american["body"]


@pytest.mark.asyncio
async def test_stage_2_and_3_never_inject_expressions(client):
    """Spec: Guided Learning must not re-suggest the Stage 1 collocations."""
    await _configure_day(client)
    for slot in ("learning", "assessment"):
        body = (await client.get(
            "/api/v1/prompt-library/prompt", headers=ADMIN,
            params={"week": 1, "day": 1, "slot": slot},
        )).json()["data"]["body"]
        assert "Do NOT" in body or "not suggest" in body.lower() or "do not" in body.lower()
    learning = (await client.get(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 1, "day": 1, "slot": "learning"},
    )).json()["data"]["body"]
    assert "Target collocations and expressions for this lesson" not in learning


@pytest.mark.asyncio
async def test_edit_copy_and_reset_a_single_prompt(client):
    await _configure_day(client, week=1, day=1)

    # Edit one prompt — stored as an override, template untouched.
    r = await client.put(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 1, "day": 1, "slot": "lexical_british"},
        json={"body": "CUSTOM PROMPT for {{cefr_level}} / {{preferred_english}}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["overridden_slots"] == ["lexical_british"]

    got = (await client.get(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 1, "day": 1, "slot": "lexical_british", "cefr_level": "A2"},
    )).json()["data"]
    assert got["source"] == "override"
    assert got["body"].startswith("CUSTOM PROMPT for A2")

    # A sibling slot still renders from the shared template.
    other = (await client.get(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 1, "day": 1, "slot": "lexical_american"},
    )).json()["data"]
    assert other["source"] == "template"

    # Copy that prompt to another day.
    r = await client.post("/api/v1/prompt-library/prompt/copy", headers=ADMIN, json={
        "from_week": 1, "from_day": 1, "to_week": 2, "to_day": 1,
        "slot": "lexical_british",
    })
    assert r.status_code == 200, r.text
    copied = (await client.get(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 2, "day": 1, "slot": "lexical_british"},
    )).json()["data"]
    assert copied["source"] == "override"

    # Copying again without overwrite is a conflict, not a silent clobber.
    r = await client.post("/api/v1/prompt-library/prompt/copy", headers=ADMIN, json={
        "from_week": 1, "from_day": 1, "to_week": 2, "to_day": 1,
        "slot": "lexical_british",
    })
    assert r.status_code == 409

    # Reset drops the override and returns to the shared template.
    r = await client.delete(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 1, "day": 1, "slot": "lexical_british"},
    )
    assert r.status_code == 200
    back = (await client.get(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 1, "day": 1, "slot": "lexical_british"},
    )).json()["data"]
    assert back["source"] == "template"


@pytest.mark.asyncio
async def test_validation_edge_cases(client):
    # Week/day out of range.
    r = await client.get("/api/v1/prompt-library/prompt", headers=ADMIN,
                         params={"week": 99, "day": 1, "slot": "learning"})
    assert r.status_code == 422
    r = await client.get("/api/v1/prompt-library/prompt", headers=ADMIN,
                         params={"week": 1, "day": 9, "slot": "learning"})
    assert r.status_code == 422
    # Unknown slot.
    r = await client.get("/api/v1/prompt-library/prompt", headers=ADMIN,
                         params={"week": 1, "day": 1, "slot": "nonsense"})
    assert r.status_code == 422
    # Unknown audience.
    r = await client.get("/api/v1/prompt-library/prompt", headers=ADMIN,
                         params={"audience": "aliens", "week": 1, "day": 1,
                                 "slot": "learning"})
    assert r.status_code == 422
    # Bad accent key in target_expressions.
    r = await client.put("/api/v1/prompt-library/lesson", headers=ADMIN,
                         params={"week": 3, "day": 1},
                         json={"target_expressions": {"klingon": ["x"]}})
    assert r.status_code == 422


def test_invalid_student_parameters_fall_back_safely():
    """An unset/garbage CEFR level or English style must not break a session."""
    assert svc.validate_cefr(None) == "B1"
    assert svc.validate_cefr("Z9") == "B1"
    assert svc.validate_cefr("c2") == "C2"
    assert svc.validate_english(None) is EnglishStyle.international
    assert svc.validate_english("Klingon") is EnglishStyle.international
    assert svc.validate_english("British English") is EnglishStyle.british
    assert svc.accent_key(EnglishStyle.american) == "american"


@pytest.mark.asyncio
async def test_missing_target_expressions_renders_without_crashing(client):
    await client.put("/api/v1/prompt-library/lesson", headers=ADMIN,
                     params={"week": 5, "day": 2},
                     json={"conversation_sequence": ["Say hello."]})
    body = (await client.get(
        "/api/v1/prompt-library/prompt", headers=ADMIN,
        params={"week": 5, "day": 2, "slot": "lexical_british"},
    )).json()["data"]["body"]
    assert "no target expressions configured" in body


@pytest.mark.asyncio
async def test_student_sees_their_own_parameters(client):
    sid = "SPK-26-PL001"
    await Student(student_id=sid, full_name="Prompt Learner",
                  membership_status=MembershipStatus.active,
                  cefr_level="B2", preferred_english=EnglishStyle.american,
                  audience=PromptAudience.adults).insert()
    await _configure_day(client, week=1, day=1)

    student = _auth(Role.student, sid)
    data = (await client.get("/api/v1/prompt-library/me/day",
                             headers=student, params={"week": 1, "day": 1})).json()["data"]
    assert data["cefr_level"] == "B2"
    assert data["preferred_english"] == "American English"
    # Students see three modes; the lexical slot is chosen by their accent.
    assert [m["stage"] for m in data["modes"]] == [1, 2, 3]
    assert data["modes"][0]["slot"] == "lexical_american"

    # An unconfigured day is not offered.
    r = await client.get("/api/v1/prompt-library/me/day",
                         headers=student, params={"week": 40, "day": 3})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_student_can_view_prompt_read_only(client):
    """Students may read the prompt behind each mode, rendered with their own
    parameters — but every write route stays admin-only."""
    sid = "SPK-26-PL003"
    await Student(student_id=sid, full_name="Curious Learner",
                  membership_status=MembershipStatus.active,
                  cefr_level="C1", preferred_english=EnglishStyle.british).insert()
    await _configure_day(client, week=1, day=1)
    student = _auth(Role.student, sid)

    r = await client.get("/api/v1/prompt-library/me/prompt", headers=student,
                         params={"week": 1, "day": 1, "stage": 1})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    # Stage 1 resolves to the student's own accent without them choosing it.
    assert data["slot"] == "lexical_british"
    assert data["editable"] is False
    # Rendered with their profile — placeholders already substituted.
    assert "C1" in data["body"]
    assert "British English" in data["body"]
    assert "{{cefr_level}}" not in data["body"]
    # The raw template is never exposed to students.
    assert "raw" not in data

    for stage, slot in ((2, "learning"), (3, "assessment")):
        got = (await client.get("/api/v1/prompt-library/me/prompt", headers=student,
                                params={"week": 1, "day": 1, "stage": stage})).json()["data"]
        assert got["slot"] == slot

    # Out-of-range stage and unpublished/missing days are rejected.
    assert (await client.get("/api/v1/prompt-library/me/prompt", headers=student,
                             params={"week": 1, "day": 1, "stage": 9})).status_code == 422
    assert (await client.get("/api/v1/prompt-library/me/prompt", headers=student,
                             params={"week": 44, "day": 1, "stage": 1})).status_code == 404

    await client.put("/api/v1/prompt-library/lesson", headers=ADMIN,
                     params={"week": 1, "day": 1}, json={"published": False})
    assert (await client.get("/api/v1/prompt-library/me/prompt", headers=student,
                             params={"week": 1, "day": 1, "stage": 1})).status_code == 404


@pytest.mark.asyncio
async def test_student_cannot_edit_prompts(client):
    sid = "SPK-26-PL002"
    await Student(student_id=sid, full_name="Nosy Learner",
                  membership_status=MembershipStatus.active).insert()
    student = _auth(Role.student, sid)
    r = await client.put("/api/v1/prompt-library/prompt", headers=student,
                         params={"week": 1, "day": 1, "slot": "learning"},
                         json={"body": "hacked"})
    assert r.status_code == 403
    # Every other mutating route is admin-only too.
    assert (await client.delete("/api/v1/prompt-library/prompt", headers=student,
                                params={"week": 1, "day": 1, "slot": "learning"})).status_code == 403
    assert (await client.put("/api/v1/prompt-library/lesson", headers=student,
                             params={"week": 1, "day": 1}, json={"title": "x"})).status_code == 403
    assert (await client.post("/api/v1/prompt-library/prompt/copy", headers=student, json={
        "from_week": 1, "from_day": 1, "to_week": 2, "to_day": 1,
    })).status_code == 403
    assert (await client.get("/api/v1/prompt-library/templates",
                             headers=student)).status_code == 403
