"""AI conversation engine — the three stages and their behavioural contracts.

The critical rules under test:
  Stage 1/2 — the conversation is BLOCKED until the student repeats the model
              answer, and only Stage 1 injects the target collocations.
  Stage 3   — no corrections mid-conversation, and the assessment appears only
              after every configured sequence step is done.
"""
import pytest

from app.core.security import Role, create_access_token
from app.db.models import EnglishStyle, MembershipStatus, Student


def _auth(role: Role, subject: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token(subject, role.value)}"}


ADMIN = _auth(Role.admin, "admin@test")
SEQUENCE = [
    "Greet the interviewer and introduce yourself.",
    "Describe your strongest skill with an example.",
]


async def _setup(client, sid: str, week=1, day=1, **student_kwargs) -> dict:
    kwargs = {"cefr_level": "B1", "preferred_english": EnglishStyle.british}
    kwargs.update(student_kwargs)
    await Student(student_id=sid, full_name="AI Learner",
                  membership_status=MembershipStatus.active, **kwargs).insert()
    r = await client.put(
        "/api/v1/prompt-library/lesson", headers=ADMIN,
        params={"week": week, "day": day},
        json={
            "title": "Job interview basics",
            "context": "A first-round interview for a junior role.",
            "conversation_sequence": SEQUENCE,
            "target_expressions": {"british": ["I'm keen on", "That's spot on"]},
        },
    )
    assert r.status_code == 200, r.text
    return _auth(Role.student, sid)


def _kinds(session: dict) -> list[str]:
    return [m["kind"] for m in session["messages"]]


@pytest.mark.asyncio
async def test_stage1_blocks_until_repetition(client):
    student = await _setup(client, "SPK-26-AI001")

    r = await client.post("/api/v1/ai-session/start", headers=student,
                          json={"week": 1, "day": 1, "stage": 1})
    assert r.status_code == 200, r.text
    s = r.json()["data"]
    sid = s["id"]
    assert s["stage_label"] == "Lexical Integration"
    assert s["sequence_total"] == 2
    assert s["sequence_index"] == 0
    # Stage 1 offers the day's target expressions in the opening turn.
    assert "I'm keen on" in s["messages"][0]["text"]

    # First answer → correction + a model answer to repeat.
    s = (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                           json={"text": "i am work as a teacher"})).json()["data"]
    assert s["awaiting_repetition"] is True
    assert s["pending_model_answer"]
    assert "repeat_request" in _kinds(s)
    # Crucially the conversation has NOT advanced.
    assert s["sequence_index"] == 0

    # The repetition consumes the gate and only then advances.
    s = (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                           json={"text": s["pending_model_answer"]})).json()["data"]
    assert s["awaiting_repetition"] is False
    assert s["pending_model_answer"] is None
    assert s["sequence_index"] == 1
    assert "repetition_accepted" in _kinds(s)

    # Second answer → gate again, then the session completes.
    s = (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                           json={"text": "my best skill are patience"})).json()["data"]
    assert s["awaiting_repetition"] is True
    s = (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                           json={"text": s["pending_model_answer"]})).json()["data"]
    assert s["status"] == "completed"
    # Stage 1 produces no assessment — that is Stage 3's job.
    assert s["assessment"] is None


@pytest.mark.asyncio
async def test_stage2_omits_target_expressions_and_supports_controls(client):
    student = await _setup(client, "SPK-26-AI002")
    s = (await client.post("/api/v1/ai-session/start", headers=student,
                           json={"week": 1, "day": 1, "stage": 2})).json()["data"]
    sid = s["id"]
    assert s["stage_label"] == "Guided Learning"
    # Spec: Stage 2 must not re-suggest the Stage 1 collocations.
    assert "I'm keen on" not in s["messages"][0]["text"]

    s = (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                           json={"text": "i have work here since two year"})).json()["data"]
    assert s["awaiting_repetition"] is True

    # Explain a correction in the student's language.
    s = (await client.post(f"/api/v1/ai-session/{sid}/explain", headers=student,
                           json={"language": "hi"})).json()["data"]
    assert "explanation" in _kinds(s)
    # The explanation must not have released the repetition gate.
    assert s["awaiting_repetition"] is True

    # Ask for a better response.
    s = (await client.post(f"/api/v1/ai-session/{sid}/better", headers=student)).json()["data"]
    assert "better" in _kinds(s)

    # Restart returns a fresh session at step zero.
    fresh = (await client.post(f"/api/v1/ai-session/{sid}/restart",
                               headers=student)).json()["data"]
    assert fresh["id"] != sid
    assert fresh["sequence_index"] == 0
    assert fresh["awaiting_repetition"] is False
    assert fresh["status"] == "active"
    # The old session is abandoned, not left dangling as active.
    old = (await client.get(f"/api/v1/ai-session/{sid}", headers=student)).json()["data"]
    assert old["status"] == "abandoned"


@pytest.mark.asyncio
async def test_stage3_no_interruptions_and_assessment_only_at_the_end(client):
    student = await _setup(client, "SPK-26-AI003")
    s = (await client.post("/api/v1/ai-session/start", headers=student,
                           json={"week": 1, "day": 1, "stage": 3})).json()["data"]
    sid = s["id"]
    assert s["stage_label"] == "Conversation Fluency & Assessment"

    # First turn: conversation flows, no correction, no repetition gate.
    s = (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                           json={"text": "hello i am very glad to be here"})).json()["data"]
    assert s["awaiting_repetition"] is False
    assert "correction" not in _kinds(s)
    assert "repeat_request" not in _kinds(s)
    # Not finished, so no assessment yet.
    assert s["assessment"] is None
    assert s["status"] == "active"
    assert s["sequence_index"] == 1

    # Corrections/suggestions are refused outright during a fluency assessment.
    assert (await client.post(f"/api/v1/ai-session/{sid}/better",
                              headers=student)).status_code == 409
    assert (await client.post(f"/api/v1/ai-session/{sid}/explain",
                              headers=student, json={})).status_code == 409

    # Final turn completes every sequence → assessment appears.
    s = (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                           json={"text": "my strongest skill is problem solving"})).json()["data"]
    assert s["status"] == "completed"
    assert s["assessment"] is not None
    scores = s["assessment"]["scores"]
    assert set(scores) == {"fluency", "grammar", "vocabulary", "pronunciation",
                           "native_expressions", "overall_communication"}
    assert all(0 <= v <= 10 for v in scores.values())
    assert s["assessment"]["max_score"] == 10


@pytest.mark.asyncio
async def test_session_edge_cases(client):
    student = await _setup(client, "SPK-26-AI004")

    # Missing / unconfigured lesson.
    r = await client.post("/api/v1/ai-session/start", headers=student,
                          json={"week": 30, "day": 2, "stage": 1})
    assert r.status_code == 404

    # A lesson with no conversation sequence is rejected with a clear message.
    await client.put("/api/v1/prompt-library/lesson", headers=ADMIN,
                     params={"week": 4, "day": 1}, json={"title": "Empty"})
    r = await client.post("/api/v1/ai-session/start", headers=student,
                          json={"week": 4, "day": 1, "stage": 1})
    assert r.status_code == 422
    assert "sequence" in r.json()["error"]["message"].lower()

    # Invalid stage.
    assert (await client.post("/api/v1/ai-session/start", headers=student,
                              json={"week": 1, "day": 1, "stage": 7})).status_code == 422

    s = (await client.post("/api/v1/ai-session/start", headers=student,
                           json={"week": 1, "day": 1, "stage": 1})).json()["data"]
    sid = s["id"]

    # Empty input is rejected.
    assert (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                              json={"text": "   "})).status_code == 422

    # Starting again resumes the same session rather than duplicating it.
    again = (await client.post("/api/v1/ai-session/start", headers=student,
                               json={"week": 1, "day": 1, "stage": 1})).json()["data"]
    assert again["id"] == sid

    # Another student cannot drive this session.
    await Student(student_id="SPK-26-AI005", full_name="Other",
                  membership_status=MembershipStatus.active).insert()
    other = _auth(Role.student, "SPK-26-AI005")
    assert (await client.post(f"/api/v1/ai-session/{sid}/reply", headers=other,
                              json={"text": "hi"})).status_code == 403

    # A completed session refuses further turns.
    for _ in range(6):
        r = await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                              json={"text": "some answer"})
        if r.status_code == 409:
            break
        if r.json()["data"]["status"] == "completed":
            r = await client.post(f"/api/v1/ai-session/{sid}/reply", headers=student,
                                  json={"text": "again"})
            assert r.status_code == 409
            break


@pytest.mark.asyncio
async def test_accent_follows_the_student_profile(client):
    """The lexical slot is picked from the profile — never hand-selected."""
    student = await _setup(client, "SPK-26-AI006",
                           preferred_english=EnglishStyle.american)
    s = (await client.post("/api/v1/ai-session/start", headers=student,
                           json={"week": 1, "day": 1, "stage": 1})).json()["data"]
    assert s["accent"] == "american"
    assert s["cefr_level"] == "B1"


@pytest.mark.asyncio
async def test_history_and_config(client):
    student = await _setup(client, "SPK-26-AI007")
    cfg = (await client.get("/api/v1/ai-session/config", headers=student)).json()["data"]
    assert cfg["is_stub"] is True
    assert len(cfg["stages"]) == 3

    await client.post("/api/v1/ai-session/start", headers=student,
                      json={"week": 1, "day": 1, "stage": 1})
    hist = (await client.get("/api/v1/ai-session/history", headers=student)).json()["data"]
    assert len(hist) == 1
    assert hist[0]["stage_label"] == "Lexical Integration"
