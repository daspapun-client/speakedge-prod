"""Attendance workflow: 24h notice → 18h deadline → automatic seat cancellation.

Idempotency is the headline requirement — the notification job must never
double-notify and the expiry job must never double-cancel.
"""
from datetime import datetime, timedelta

import pytest

from app.core.security import Role, create_access_token
from app.db.base import utcnow
from app.db.models import (
    Batch, ClassConfirmation, MembershipStatus, Notification, SpeakingTeam, Student,
)
from app.shared import attendance as att


def _auth(role: Role, subject: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token(subject, role.value)}"}


ADMIN = _auth(Role.admin, "admin@test")


def _date_in(hours: float) -> tuple[str, str]:
    """(YYYY-MM-DD, HH:MM) in IST, `hours` from now."""
    target = datetime.now(att.IST) + timedelta(hours=hours)
    return target.date().isoformat(), target.strftime("%H:%M")


async def _student(sid: str) -> str:
    await Student(student_id=sid, full_name=f"Learner {sid}",
                  membership_status=MembershipStatus.active).insert()
    return sid


@pytest.mark.asyncio
async def test_batch_notice_is_sent_once_and_only_once(client):
    sid = await _student("SPK-26-AT001")
    date_str, time_str = _date_in(24.5)  # inside the 24h notice window
    batch = Batch(teacher_id="t1", title="Evening Conversation",
                  class_dates=[date_str], slot_start=time_str,
                  class_time=time_str, student_ids=[sid])
    await batch.insert()

    await att.send_attendance_confirmation_requests()
    recs = await ClassConfirmation.find(ClassConfirmation.student_id == sid).to_list()
    assert len(recs) == 1
    rec = recs[0]
    assert rec.status == "pending"
    assert rec.source == "batch"
    assert rec.class_title == "Evening Conversation"
    # Deadline is notification + 18h.
    assert 17.9 < (rec.deadline_at - rec.notified_at).total_seconds() / 3600 < 18.1

    notes = await Notification.find(Notification.recipient == sid).to_list()
    assert len(notes) == 1
    assert "Confirm your attendance" in notes[0].title

    # Re-running the job must not create a second request or a second notice.
    await att.send_attendance_confirmation_requests()
    await att.send_attendance_confirmation_requests()
    assert await ClassConfirmation.find(ClassConfirmation.student_id == sid).count() == 1
    assert await Notification.find(Notification.recipient == sid).count() == 1

    refreshed = await Batch.get(batch.id)
    assert refreshed.confirm_notified_dates == [date_str]


@pytest.mark.asyncio
async def test_community_class_notice(client):
    sid = await _student("SPK-26-AT002")
    target = datetime.now(att.IST) + timedelta(hours=24.5)
    team = SpeakingTeam(name="Morning Speakers", owner_student_id=sid,
                        member_ids=[sid],
                        class_day=att.WEEKDAYS[target.weekday()],
                        class_time=target.strftime("%H:%M"))
    await team.insert()

    await att.send_attendance_confirmation_requests()
    recs = await ClassConfirmation.find(ClassConfirmation.student_id == sid).to_list()
    assert len(recs) == 1
    assert recs[0].source == "community"
    assert recs[0].class_title == "Morning Speakers"

    # Community classes dedup on the confirmation row itself.
    await att.send_attendance_confirmation_requests()
    assert await ClassConfirmation.find(ClassConfirmation.student_id == sid).count() == 1


@pytest.mark.asyncio
async def test_student_confirms_attendance(client):
    sid = await _student("SPK-26-AT003")
    date_str, time_str = _date_in(24.5)
    await Batch(teacher_id="t1", title="Grammar Lab", class_dates=[date_str],
                slot_start=time_str, class_time=time_str, student_ids=[sid]).insert()
    await att.send_attendance_confirmation_requests()

    student = _auth(Role.student, sid)
    listing = (await client.get("/api/v1/dashboard/attendance",
                                headers=student)).json()["data"]
    assert listing["pending_count"] == 1
    assert listing["deadline_hours"] == 18
    assert listing["notice_hours"] == 24
    item = listing["items"][0]
    assert item["can_respond"] is True

    r = await client.post(f"/api/v1/dashboard/attendance/{item['id']}",
                          headers=student, json={"attending": True})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "confirmed"

    # Duplicate submission is rejected, not silently accepted.
    r = await client.post(f"/api/v1/dashboard/attendance/{item['id']}",
                          headers=student, json={"attending": True})
    assert r.status_code == 409

    # A confirmed seat survives the expiry sweep untouched.
    await att.expire_unconfirmed_attendance()
    rec = await ClassConfirmation.get(item["id"])
    assert rec.status == "confirmed"


@pytest.mark.asyncio
async def test_auto_cancel_after_deadline_is_idempotent(client):
    sid = await _student("SPK-26-AT004")
    date_str, time_str = _date_in(30)  # class still in the future
    rec = ClassConfirmation(
        source="batch", class_ref="b1", class_title="Speaking Practice",
        class_date=date_str, class_time=time_str, student_id=sid,
        notified_at=utcnow() - timedelta(hours=19),
        deadline_at=utcnow() - timedelta(hours=1),  # deadline already passed
    )
    await rec.insert()

    await att.expire_unconfirmed_attendance()
    rec = await ClassConfirmation.get(rec.id)
    assert rec.status == "expired"
    assert rec.cancel_notified is True

    notes = await Notification.find(Notification.recipient == sid).to_list()
    assert len(notes) == 1
    assert "cancelled" in notes[0].title.lower()

    # Repeated sweeps must not re-cancel or re-notify.
    await att.expire_unconfirmed_attendance()
    await att.expire_unconfirmed_attendance()
    assert await Notification.find(Notification.recipient == sid).count() == 1

    # Submitting attendance after cancellation is refused with a clear message.
    student = _auth(Role.student, sid)
    r = await client.post(f"/api/v1/dashboard/attendance/{rec.id}",
                          headers=student, json={"attending": True})
    assert r.status_code == 409
    assert "cancelled" in r.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_deadline_passed_rejects_late_confirmation(client):
    sid = await _student("SPK-26-AT005")
    date_str, time_str = _date_in(30)
    rec = ClassConfirmation(
        source="batch", class_ref="b1", class_title="Late Class",
        class_date=date_str, class_time=time_str, student_id=sid,
        notified_at=utcnow() - timedelta(hours=19),
        deadline_at=utcnow() - timedelta(minutes=5),
    )
    await rec.insert()
    student = _auth(Role.student, sid)
    r = await client.post(f"/api/v1/dashboard/attendance/{rec.id}",
                          headers=student, json={"attending": True})
    assert r.status_code == 409
    assert "deadline" in r.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_past_class_is_expired_without_a_cancellation_notice(client):
    """A class that already happened is closed out quietly — cancelling a seat
    in the past would only be noise."""
    sid = await _student("SPK-26-AT006")
    past = datetime.now(att.IST) - timedelta(hours=3)
    rec = ClassConfirmation(
        source="batch", class_ref="b1", class_title="Yesterday's Class",
        class_date=past.date().isoformat(), class_time=past.strftime("%H:%M"),
        student_id=sid,
        notified_at=utcnow() - timedelta(hours=25),
        deadline_at=utcnow() - timedelta(hours=7),
    )
    await rec.insert()
    await att.expire_unconfirmed_attendance()
    rec = await ClassConfirmation.get(rec.id)
    assert rec.status == "expired"
    assert rec.cancel_notified is False
    assert await Notification.find(Notification.recipient == sid).count() == 0


@pytest.mark.asyncio
async def test_class_outside_the_notice_window_is_not_touched(client):
    sid = await _student("SPK-26-AT007")
    far_date, far_time = _date_in(24 * 5)  # five days out
    await Batch(teacher_id="t1", title="Future Class", class_dates=[far_date],
                slot_start=far_time, student_ids=[sid]).insert()
    await att.send_attendance_confirmation_requests()
    assert await ClassConfirmation.find(ClassConfirmation.student_id == sid).count() == 0


@pytest.mark.asyncio
async def test_admin_can_monitor_confirmations(client):
    sid = await _student("SPK-26-AT008")
    date_str, time_str = _date_in(24.5)
    await Batch(teacher_id="t1", title="Monitored Class", class_dates=[date_str],
                slot_start=time_str, student_ids=[sid]).insert()
    await att.send_attendance_confirmation_requests()

    data = (await client.get("/api/v1/admin/attendance-confirmations",
                             headers=ADMIN)).json()["data"]
    assert data["total"] == 1
    assert data["counts"]["pending"] == 1
    assert data["items"][0]["student_name"] == f"Learner {sid}"

    filtered = (await client.get("/api/v1/admin/attendance-confirmations",
                                 headers=ADMIN,
                                 params={"status": "expired"})).json()["data"]
    assert filtered["total"] == 0


@pytest.mark.asyncio
async def test_student_cannot_answer_another_students_request(client):
    a = await _student("SPK-26-AT009")
    await _student("SPK-26-AT010")
    date_str, time_str = _date_in(24.5)
    rec = ClassConfirmation(source="batch", class_ref="b1", class_title="Class",
                            class_date=date_str, class_time=time_str, student_id=a,
                            deadline_at=utcnow() + timedelta(hours=18))
    await rec.insert()
    intruder = _auth(Role.student, "SPK-26-AT010")
    r = await client.post(f"/api/v1/dashboard/attendance/{rec.id}",
                          headers=intruder, json={"attending": True})
    assert r.status_code == 404
