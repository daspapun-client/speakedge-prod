"""Exam management end to end (Module 11).

Admin builds the examiner list, then the slot list day- and time-wise, then
assigns; the student books a slot that already carries the examiner's name and
WhatsApp number; the assigned examiner — and only them — files the report,
which lands as a downloadable report card / certificate plus the admin view of
Exam Date / Student ID / Examiner Name / Level-or-Grade / Remarks.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.security import Role, hash_password
from app.db.models import (
    CEFRStatus,
    Certificate,
    CommunityProfile,
    Student,
    Subscription,
    User,
)
from app.shared import file_service

pytestmark = pytest.mark.asyncio

STUDENT = "SPK-26-EXAM01"
STUDENT2 = "SPK-26-EXAM02"


async def _admin(client) -> dict:
    await User(username="admin@speakedge.in", email="admin@speakedge.in",
               password_hash=hash_password("Admin@12345"), role=Role.super_admin,
               full_name="Super Admin").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _student(client, student_id: str = STUDENT, name: str = "Asha Rao") -> dict:
    await Student(student_id=student_id, full_name=name, phone="9990001111").insert()
    await User(username=student_id, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=student_id).insert()
    # Exam eligibility comes from the membership tier, so the fixture needs one.
    now = datetime.now(timezone.utc)
    await Subscription(student_id=student_id, plan="Gold", started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True,
                       cefr_tests=5, speaking_tests=5).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": student_id, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _login(client, username: str, password: str) -> dict:
    r = await client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


def _future(days: int = 7) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).date().isoformat()


async def _add_examiner(client, ah: dict, username: str, name: str, whatsapp: str) -> None:
    r = await client.post("/api/v1/exams/admin/examiners", headers=ah, json={
        "username": username, "password": "Examiner@123",
        "full_name": name, "whatsapp": whatsapp,
    })
    assert r.status_code == 200, r.text


async def test_admin_builds_examiner_and_slot_lists(client):
    """Examiner list -> slot list (day x time) -> assignment, in one pass."""
    ah = await _admin(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")

    examiners = (await client.get("/api/v1/exams/admin/examiners", headers=ah)).json()["data"]
    assert [e["full_name"] for e in examiners] == ["Rina Sen"]
    assert examiners[0]["whatsapp"] == "9876543210"
    assert examiners[0]["assigned_slots"] == 0

    # Two days x three start times = six 20-minute slots, examiner assigned.
    r = await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment",
        "dates": [_future(7), _future(8)],
        "times": ["10:00", "10:20", "10:40"],
        "duration_minutes": 20, "capacity": 1, "examiner_id": "ex1@speakedge.in",
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["created"] == 6

    # Re-running the same grid creates nothing new.
    again = await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment",
        "dates": [_future(7)], "times": ["10:00"],
        "duration_minutes": 20, "capacity": 1,
    })
    assert again.json()["data"] == {"created": 0, "skipped": 1, "slots": []}

    examiners = (await client.get("/api/v1/exams/admin/examiners", headers=ah)).json()["data"]
    assert examiners[0]["assigned_slots"] == 6


async def test_student_slot_card_carries_examiner_contact(client):
    """The booking card shows exam name, date, slot length, examiner + WhatsApp."""
    ah = await _admin(client)
    sh = await _student(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "dates": [_future()], "times": ["10:00"],
        "duration_minutes": 20, "capacity": 1, "examiner_id": "ex1@speakedge.in",
    })

    slots = (await client.get("/api/v1/exams/", headers=sh,
                              params={"upcoming": True})).json()["data"]
    assert len(slots) == 1
    slot = slots[0]
    assert slot["title"] == "CEFR Assessment"
    assert slot["kind"] == "CEFR"
    assert slot["duration_minutes"] == 20
    assert slot["examiner_name"] == "Rina Sen"
    assert slot["examiner_whatsapp"] == "9876543210"
    assert slot["seats_left"] == 1 and slot["seats_taken"] == 0
    assert slot["ends_at"] and slot["scheduled_at"]

    # Booking it, the same detail comes back on the booking itself.
    booked = await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)
    assert booked.status_code == 200, booked.text
    mine = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"]
    assert mine[0]["examiner_name"] == "Rina Sen"
    assert mine[0]["examiner_whatsapp"] == "9876543210"
    assert mine[0]["duration_minutes"] == 20
    assert mine[0]["result"] is None


async def test_slot_list_never_leaks_examiner_contact_publicly(client):
    """Slots carry the examiner's WhatsApp number, so the list needs a session."""
    ah = await _admin(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "dates": [_future()], "times": ["10:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    assert (await client.get("/api/v1/exams/")).status_code == 401


async def test_slot_capacity_is_enforced(client):
    """A 1:1 slot cannot be double-booked — the second student is refused."""
    ah = await _admin(client)
    sh1 = await _student(client)
    sh2 = await _student(client, STUDENT2, "Bimal Roy")
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "dates": [_future()], "times": ["10:00"],
        "capacity": 1, "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh1)).json()["data"][0]

    assert (await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh1)).status_code == 200
    second = await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh2)
    assert second.status_code == 409
    assert "full" in second.json()["error"]["message"].lower()

    # And it drops out of the bookable list rather than teasing the learner.
    bookable = (await client.get("/api/v1/exams/", headers=sh2,
                                 params={"upcoming": True, "bookable": True})).json()["data"]
    assert bookable == []


async def test_examiner_sees_only_their_own_assignments(client):
    ah = await _admin(client)
    sh = await _student(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await _add_examiner(client, ah, "ex2@speakedge.in", "Dev Ghosh", "9876500000")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "dates": [_future()], "times": ["10:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)

    eh1 = await _login(client, "ex1@speakedge.in", "Examiner@123")
    eh2 = await _login(client, "ex2@speakedge.in", "Examiner@123")

    assigned = (await client.get("/api/v1/exams/examiner/assigned", headers=eh1)).json()["data"]
    assert len(assigned) == 1
    assert assigned[0]["student_id"] == STUDENT
    assert assigned[0]["student_name"] == "Asha Rao"
    assert assigned[0]["reported"] is False
    assert (await client.get("/api/v1/exams/examiner/assigned", headers=eh2)).json()["data"] == []

    summary = (await client.get("/api/v1/exams/examiner/summary", headers=eh1)).json()["data"]
    assert summary["assigned_slots"] == 1 and summary["pending_reports"] == 1

    # Student search is scoped the same way.
    found = (await client.get("/api/v1/exams/examiner/students", headers=eh1,
                              params={"q": "Asha"})).json()["data"]
    assert [s["student_id"] for s in found] == [STUDENT]
    assert (await client.get("/api/v1/exams/examiner/students", headers=eh2)).json()["data"] == []

    # An unassigned examiner cannot file a report on someone else's booking.
    denied = await client.post("/api/v1/exams/report", headers=eh2, json={
        "exam_booking_id": assigned[0]["id"], "student_id": STUDENT, "level": "B2",
    })
    assert denied.status_code == 403


async def test_cefr_report_flow(client):
    """CEFR report -> report card, Verified profile, and the admin view."""
    ah = await _admin(client)
    sh = await _student(client)
    await CommunityProfile(student_id=STUDENT, display_name="Asha").insert()
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "dates": [_future()], "times": ["10:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)

    eh = await _login(client, "ex1@speakedge.in", "Examiner@123")
    booking = (await client.get("/api/v1/exams/examiner/assigned", headers=eh)).json()["data"][0]
    r = await client.post("/api/v1/exams/report", headers=eh, json={
        "exam_booking_id": booking["id"], "student_id": STUDENT, "level": "B2",
        "scores": {"listening": 8, "speaking": 7}, "remarks": "Confident, minor grammar slips.",
    })
    assert r.status_code == 200, r.text
    assert r.json()["data"]["level"] == "B2"

    # Community profile + student row flip to Verified.
    assert (await Student.find_one(Student.student_id == STUDENT)).cefr_status == CEFRStatus.verified
    cp = await CommunityProfile.find_one(CommunityProfile.student_id == STUDENT)
    assert cp.cefr_status == CEFRStatus.verified and cp.cefr_level == "B2"

    # Admin view: exam date, student, examiner name, level, remarks.
    row = (await client.get("/api/v1/exams/admin/results", headers=ah)).json()["data"]["cefr_reports"][0]
    assert row["student_id"] == STUDENT
    assert row["student_name"] == "Asha Rao"
    assert row["examiner_name"] == "Rina Sen"
    assert row["level"] == "B2"
    assert row["remarks"] == "Confident, minor grammar slips."
    assert row["exam_date"] and row["exam_title"] == "CEFR Assessment"

    # The student gets the downloadable report card on the booking itself.
    mine = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"][0]
    assert mine["status"] == "completed"
    assert mine["result"]["type"] == "cefr_report" and mine["result"]["level"] == "B2"
    assert mine["result"]["url"] and mine["result"]["remarks"]

    # ...and the in-app result card it opens, with everything printed on it.
    card = (await client.get(f"/api/v1/exams/report/{mine['result']['id']}",
                             headers=sh)).json()["data"]
    assert card["student_name"] == "Asha Rao" and card["student_id"] == STUDENT
    assert card["cefr_level"] == "B2" and card["exam_date"] and card["issue_date"]
    assert card["report_no"] == row["verification_code"]
    assert card["examiner_name"] == "Rina Sen"

    # Publicly verifiable, and never submitted twice.
    verify = (await client.get(f"/api/v1/exams/verify/{row['verification_code']}")).json()["data"]
    assert verify["valid"] and verify["examiner_name"] == "Rina Sen"
    dupe = await client.post("/api/v1/exams/report", headers=eh, json={
        "exam_booking_id": booking["id"], "student_id": STUDENT, "level": "C1",
    })
    assert dupe.status_code == 409


async def test_speaking_result_flow(client):
    """Speaking result -> auto-generated certificate carrying the grade."""
    ah = await _admin(client)
    sh = await _student(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "Speaking", "title": "Speaking Test", "dates": [_future()], "times": ["11:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)

    eh = await _login(client, "ex1@speakedge.in", "Examiner@123")
    booking = (await client.get("/api/v1/exams/examiner/assigned", headers=eh)).json()["data"][0]

    # A speaking result needs a grade, not a CEFR level.
    missing = await client.post("/api/v1/exams/report", headers=eh, json={
        "exam_booking_id": booking["id"], "student_id": STUDENT,
    })
    assert missing.status_code == 422

    r = await client.post("/api/v1/exams/report", headers=eh, json={
        "exam_booking_id": booking["id"], "student_id": STUDENT,
        "grade": "Distinction", "remarks": "Excellent fluency.",
    })
    assert r.status_code == 200, r.text

    row = (await client.get("/api/v1/exams/admin/results", headers=ah)).json()["data"]["certificates"][0]
    assert row["grade"] == "Distinction"
    assert row["examiner_name"] == "Rina Sen"
    assert row["exam_date"] and row["remarks"] == "Excellent fluency."

    mine = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"][0]
    assert mine["result"]["type"] == "certificate" and mine["result"]["grade"] == "Distinction"
    assert mine["result"]["url"]

    submitted = (await client.get("/api/v1/exams/examiner/reports", headers=eh)).json()["data"]
    assert len(submitted["certificates"]) == 1 and submitted["cefr_reports"] == []


async def test_certificate_pdf_survives_missing_media_file(client):
    """The PDF copy is regenerated on demand when the /media file is gone."""
    ah = await _admin(client)
    sh = await _student(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "Speaking", "title": "Speaking Test", "dates": [_future()], "times": ["11:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)
    eh = await _login(client, "ex1@speakedge.in", "Examiner@123")
    booking = (await client.get("/api/v1/exams/examiner/assigned", headers=eh)).json()["data"][0]
    await client.post("/api/v1/exams/report", headers=eh, json={
        "exam_booking_id": booking["id"], "student_id": STUDENT,
        "grade": "Distinction", "cefr_level": "B2",
    })

    cert = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"][0]["result"]
    cert_id = cert["id"]
    disk = Path(file_service.media_root()) / cert["url"].removeprefix("/media/")
    assert disk.is_file()
    disk.unlink()

    r = await client.get(f"/api/v1/exams/certificate/{cert_id}/pdf", headers=sh)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")

    other = await _student(client, STUDENT2, "Bimal Roy")
    assert (await client.get(f"/api/v1/exams/certificate/{cert_id}/pdf",
                             headers=other)).status_code == 404


async def test_cefr_report_pdf_survives_missing_media_file(client):
    """The report PDF is regenerated on demand when the /media file is gone."""
    ah = await _admin(client)
    sh = await _student(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Test", "dates": [_future()], "times": ["10:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)
    eh = await _login(client, "ex1@speakedge.in", "Examiner@123")
    booking = (await client.get("/api/v1/exams/examiner/assigned", headers=eh)).json()["data"][0]
    await client.post("/api/v1/exams/report", headers=eh, json={
        "exam_booking_id": booking["id"], "student_id": STUDENT, "level": "B2",
    })

    report = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"][0]["result"]
    report_id = report["id"]
    disk = Path(file_service.media_root()) / report["url"].removeprefix("/media/")
    assert disk.is_file()
    disk.unlink()

    r = await client.get(f"/api/v1/exams/report/{report_id}/pdf", headers=sh)
    assert r.status_code == 200, r.text
    assert r.content.startswith(b"%PDF")


async def test_public_verification_needs_no_account(client):
    """Anyone — an institute, an employer — checks a certificate by its code
    with no login, and sees the candidate details printed on the document."""
    ah = await _admin(client)
    sh = await _student(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "Speaking", "title": "Speaking Test", "dates": [_future()], "times": ["11:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)
    eh = await _login(client, "ex1@speakedge.in", "Examiner@123")
    booking = (await client.get("/api/v1/exams/examiner/assigned", headers=eh)).json()["data"][0]
    await client.post("/api/v1/exams/report", headers=eh, json={
        "exam_booking_id": booking["id"], "student_id": STUDENT,
        "grade": "Distinction", "cefr_level": "B2", "remarks": "Excellent fluency.",
    })
    code = (await client.get("/api/v1/exams/admin/results",
                             headers=ah)).json()["data"]["certificates"][0]["verification_code"]

    # No Authorization header at all — this is the whole point of the page.
    data = (await client.get(f"/api/v1/exams/verify/{code}")).json()["data"]
    assert data["valid"] and data["type"] == "certificate"
    assert data["student_name"] == "Asha Rao" and data["student_id"] == STUDENT
    assert data["grade"] == "Distinction" and data["cefr_level"] == "B2"
    assert data["examiner_name"] == "Rina Sen" and data["issued_at"]

    # Codes are printed in caps; typed in any case they still resolve.
    assert (await client.get(f"/api/v1/exams/verify/{code.lower()}")).json()["data"]["valid"]

    # A withdrawn certificate says so rather than verifying.
    cert = await Certificate.find_one(Certificate.verification_code == code)
    cert.archive("admin@speakedge.in", "issued in error")
    await cert.save()
    withdrawn = (await client.get(f"/api/v1/exams/verify/{code}")).json()["data"]
    assert withdrawn["valid"] is False and withdrawn["withdrawn"] is True

    unknown = (await client.get("/api/v1/exams/verify/CERT-NOTAREALCODE")).json()["data"]
    assert unknown["valid"] is False and not unknown.get("withdrawn")


async def test_meeting_link_reaches_only_the_people_sitting_the_exam(client):
    """The exam is conducted on a meeting link — admin or the assigned examiner
    sets it, and it reaches the students holding a seat, nobody else."""
    ah = await _admin(client)
    sh = await _student(client)
    sh2 = await _student(client, STUDENT2, "Bimal Roy")
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await _add_examiner(client, ah, "ex2@speakedge.in", "Dev Ghosh", "9876500000")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "dates": [_future()], "times": ["10:00"],
        "capacity": 1, "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    assert slot.get("meeting_url") is None
    assert (await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)).status_code == 200

    eh1 = await _login(client, "ex1@speakedge.in", "Examiner@123")
    eh2 = await _login(client, "ex2@speakedge.in", "Examiner@123")

    # Only the examiner conducting it (or admin) may set the room.
    denied = await client.post(f"/api/v1/exams/{slot['id']}/meeting-link", headers=eh2,
                               json={"meeting_url": "https://meet.google.com/abc-defg-hij"})
    assert denied.status_code == 403
    denied = await client.post(f"/api/v1/exams/{slot['id']}/meeting-link", headers=sh,
                               json={"meeting_url": "https://meet.google.com/abc-defg-hij"})
    assert denied.status_code == 403
    bad = await client.post(f"/api/v1/exams/{slot['id']}/meeting-link", headers=eh1,
                            json={"meeting_url": "meet.google.com/abc-defg-hij"})
    assert bad.status_code == 422

    r = await client.post(f"/api/v1/exams/{slot['id']}/meeting-link", headers=eh1,
                          json={"meeting_url": "https://meet.google.com/abc-defg-hij"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["meeting_url"] == "https://meet.google.com/abc-defg-hij"

    # The student who booked gets it; the slot picker never publishes it.
    mine = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"]
    assert mine[0]["meeting_url"] == "https://meet.google.com/abc-defg-hij"
    picker = (await client.get("/api/v1/exams/", headers=sh2)).json()["data"]
    assert "meeting_url" not in picker[0]

    # The examiner sees it on their own slot list and their booking queue.
    slots = (await client.get("/api/v1/exams/examiner/slots", headers=eh1)).json()["data"]
    assert slots[0]["meeting_url"] == "https://meet.google.com/abc-defg-hij"
    assigned = (await client.get("/api/v1/exams/examiner/assigned", headers=eh1)).json()["data"]
    assert assigned[0]["meeting_url"] == "https://meet.google.com/abc-defg-hij"

    # And it is notified to the seat holder, not to the whole student base.
    notes = (await client.get("/api/v1/notifications/my", headers=sh)).json()["data"]
    assert any("joining link" in (n["body"] or "").lower() for n in notes)
    notes2 = (await client.get("/api/v1/notifications/my", headers=sh2)).json()["data"]
    assert not any("joining link" in (n["body"] or "").lower() for n in notes2)

    # Clearing it takes it off the booking again.
    cleared = await client.post(f"/api/v1/exams/{slot['id']}/meeting-link", headers=ah,
                                json={"meeting_url": ""})
    assert cleared.status_code == 200
    mine = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"]
    assert mine[0]["meeting_url"] is None


async def test_weekly_slot_meeting_link_reaches_booked_dates(client):
    """A weekly slot carries its own room onto every date it generates —
    including the ones students already hold a seat on."""
    ah = await _admin(client)
    sh = await _student(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    r = await client.post("/api/v1/exams/admin/slot-rules", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "day_of_week": "Sunday",
        "time_of_day": "11:00", "examiner_id": "ex1@speakedge.in",
        "meeting_url": "https://meet.google.com/aaa-bbbb-ccc",
    })
    assert r.status_code == 200, r.text
    rule_id = r.json()["data"]["id"]

    slot = (await client.get("/api/v1/exams/", headers=sh,
                             params={"upcoming": True})).json()["data"][0]
    assert (await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)).status_code == 200
    mine = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"]
    assert mine[0]["meeting_url"] == "https://meet.google.com/aaa-bbbb-ccc"

    # Moving the room reaches the booked date too, not just the free ones.
    r = await client.patch(f"/api/v1/exams/admin/slot-rules/{rule_id}", headers=ah,
                           json={"meeting_url": "https://meet.google.com/zzz-yyyy-xxx"})
    assert r.status_code == 200, r.text
    mine = (await client.get("/api/v1/exams/my-bookings", headers=sh)).json()["data"]
    assert mine[0]["meeting_url"] == "https://meet.google.com/zzz-yyyy-xxx"


async def test_booked_slot_cannot_be_deleted(client):
    ah = await _admin(client)
    sh = await _student(client)
    await _add_examiner(client, ah, "ex1@speakedge.in", "Rina Sen", "9876543210")
    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "dates": [_future()], "times": ["10:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]

    # Free while empty...
    assert (await client.delete(f"/api/v1/exams/{slot['id']}", headers=ah)).status_code == 200

    await client.post("/api/v1/exams/slots/bulk", headers=ah, json={
        "kind": "CEFR", "title": "CEFR Assessment", "dates": [_future(9)], "times": ["10:00"],
        "examiner_id": "ex1@speakedge.in",
    })
    slot = (await client.get("/api/v1/exams/", headers=sh)).json()["data"][0]
    await client.post(f"/api/v1/exams/{slot['id']}/book", headers=sh)
    # ...refused once a learner holds a seat.
    assert (await client.delete(f"/api/v1/exams/{slot['id']}", headers=ah)).status_code == 409
