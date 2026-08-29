"""End-to-end orientation flow: admin schedules a self-paced session and enrols a
student; the student walks the steps and self-completes, unlocking the dashboard."""
import pytest

from app.core.security import Role, create_access_token
from app.db.models import MembershipStatus, Student, Teacher


def _auth(role: Role, subject: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token(subject, role.value)}"}


@pytest.mark.asyncio
async def test_orientation_self_complete(client):
    sid = "SPK-26-TEST01"
    await Student(student_id=sid, full_name="Test Learner",
                  membership_status=MembershipStatus.active).insert()

    admin = _auth(Role.admin, "admin@test")
    student = _auth(Role.student, sid)

    # Admin creates a recorded (self-paced) session and enrols the student.
    r = await client.post("/api/v1/orientation/batches", headers=admin, json={
        "title": "July Orientation", "mode": "recorded",
        "recording_url": "https://example.com/vid", "student_ids": [sid],
    })
    assert r.status_code == 200, r.text
    batch_id = r.json()["data"]["id"]

    # Enrolment linked the student to the batch.
    me = (await client.get("/api/v1/orientation/me", headers=student)).json()["data"]
    assert me["status"] == "pending"
    assert me["batch"]["id"] == batch_id
    assert me["can_self_complete"] is True
    assert me["total_steps"] == len(me["steps"]) > 0

    # Advancing progress flips status to in_progress.
    r = await client.post("/api/v1/orientation/me/progress", headers=student, json={"step": 3})
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "in_progress"

    # Completing requires accepting the rules.
    r = await client.post("/api/v1/orientation/me/complete", headers=student, json={"rules_accepted": False})
    assert r.status_code == 422

    r = await client.post("/api/v1/orientation/me/complete", headers=student, json={"rules_accepted": True})
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "completed"

    # Batch auto-closes once every enrolled student is done.
    detail = (await client.get(f"/api/v1/orientation/batches/{batch_id}", headers=admin)).json()["data"]
    assert detail["status"] == "completed"
    assert detail["completed_count"] == 1


@pytest.mark.asyncio
async def test_live_session_blocks_self_complete(client):
    sid = "SPK-26-TEST02"
    await Student(student_id=sid, full_name="Live Learner",
                  membership_status=MembershipStatus.active).insert()
    admin = _auth(Role.admin, "admin@test")
    student = _auth(Role.student, sid)

    r = await client.post("/api/v1/orientation/batches", headers=admin, json={
        "title": "Live Orientation", "mode": "live", "student_ids": [sid],
    })
    batch_id = r.json()["data"]["id"]

    me = (await client.get("/api/v1/orientation/me", headers=student)).json()["data"]
    assert me["can_self_complete"] is False

    # Student cannot self-complete a live session.
    r = await client.post("/api/v1/orientation/me/complete", headers=student, json={"rules_accepted": True})
    assert r.status_code == 403

    # Admin marks the student complete instead.
    r = await client.post(f"/api/v1/orientation/batches/{batch_id}/complete", headers=admin, json={"student_ids": [sid]})
    assert r.status_code == 200
    me = (await client.get("/api/v1/orientation/me", headers=student)).json()["data"]
    assert me["status"] == "completed"


@pytest.mark.asyncio
async def test_teacher_shares_join_link(client):
    """The assigned teacher publishes the meeting link themselves; the enrolled
    student reads it off their own orientation page."""
    sid = "SPK-26-TEST03"
    await Student(student_id=sid, full_name="Link Learner",
                  membership_status=MembershipStatus.active).insert()
    mine = await Teacher(name="Assigned", email="t1@test.com", phone="9000000001",
                         status="approved", username="teacher1").insert()
    other = await Teacher(name="Other", email="t2@test.com", phone="9000000002",
                          status="approved", username="teacher2").insert()

    admin = _auth(Role.admin, "admin@test")
    student = _auth(Role.student, sid)
    teacher = _auth(Role.teacher, "teacher1")

    r = await client.post("/api/v1/orientation/batches", headers=admin, json={
        "title": "Live Orientation", "mode": "live",
        "teacher_id": str(mine.id), "student_ids": [sid],
    })
    batch_id = r.json()["data"]["id"]

    # A bare link is rejected — students need a clickable URL.
    r = await client.post(f"/api/v1/orientation/teacher/batches/{batch_id}/meeting-link",
                          headers=teacher, json={"meeting_url": "meet.google.com/abc"})
    assert r.status_code == 422

    r = await client.post(f"/api/v1/orientation/teacher/batches/{batch_id}/meeting-link",
                          headers=teacher, json={"meeting_url": "https://meet.google.com/abc"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["meeting_url"] == "https://meet.google.com/abc"

    me = (await client.get("/api/v1/orientation/me", headers=student)).json()["data"]
    assert me["batch"]["meeting_url"] == "https://meet.google.com/abc"

    # Another teacher cannot touch a session that isn't theirs.
    assert other.id
    r = await client.post(f"/api/v1/orientation/teacher/batches/{batch_id}/meeting-link",
                          headers=_auth(Role.teacher, "teacher2"),
                          json={"meeting_url": "https://evil.example/abc"})
    assert r.status_code == 403

    # Clearing it removes the link.
    r = await client.post(f"/api/v1/orientation/teacher/batches/{batch_id}/meeting-link",
                          headers=teacher, json={"meeting_url": ""})
    assert r.status_code == 200
    assert r.json()["data"]["meeting_url"] is None
