"""Multilingual instructions (fallback behaviour) and membership-gated
video/PDF learning content (server-side authorization)."""
import pytest

from app.core.security import Role, create_access_token
from app.db.base import utcnow
from app.db.models import (
    MembershipStatus, PlanConfig, Student, Subscription, Video,
)


def _auth(role: Role, subject: str) -> dict:
    return {"Authorization": f"Bearer {create_access_token(subject, role.value)}"}


ADMIN = _auth(Role.admin, "admin@test")


async def _student(sid: str, **kwargs) -> dict:
    await Student(student_id=sid, full_name=f"Learner {sid}",
                  membership_status=MembershipStatus.active, **kwargs).insert()
    return _auth(Role.student, sid)


# ---------------------------------------------------------------------------
# Instructions
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_instruction_shows_mother_tongue_then_falls_back(client):
    r = await client.post("/api/v1/instructions/admin", headers=ADMIN, json={
        "key": "house-rules",
        "translations": {
            "en": {"title": "House rules", "body": "Be kind."},
            "hi": {"title": "नियम", "body": "दयालु बनें।"},
        },
    })
    assert r.status_code == 200, r.text

    # Hindi student gets Hindi.
    hindi = await _student("SPK-26-IN001", preferred_language="hi")
    data = (await client.get("/api/v1/instructions/me", headers=hindi)).json()["data"]
    assert data["language"] == "hi"
    item = data["items"][0]
    assert item["title"] == "नियम"
    assert item["is_fallback"] is False

    # Tamil has no translation → falls back to English, and says so.
    tamil = await _student("SPK-26-IN002", preferred_language="ta")
    data = (await client.get("/api/v1/instructions/me", headers=tamil)).json()["data"]
    item = data["items"][0]
    assert item["language"] == "en"
    assert item["requested_language"] == "ta"
    assert item["is_fallback"] is True
    assert item["title"] == "House rules"


@pytest.mark.asyncio
async def test_translation_management(client):
    instr = (await client.post("/api/v1/instructions/admin", headers=ADMIN, json={
        "key": "payments-help",
        "translations": {"en": {"title": "Payments", "body": "How to pay."}},
    })).json()["data"]
    iid = instr["id"]

    # Add one language without disturbing the others.
    r = await client.put(f"/api/v1/instructions/admin/{iid}/translations/bn",
                         headers=ADMIN,
                         json={"title": "পেমেন্ট", "body": "কীভাবে পরিশোধ করবেন।"})
    assert r.status_code == 200
    assert set(r.json()["data"]["translations"]) == {"en", "bn"}

    # The fallback language cannot be removed out from under the article.
    r = await client.delete(f"/api/v1/instructions/admin/{iid}/translations/en",
                            headers=ADMIN)
    assert r.status_code == 409

    r = await client.delete(f"/api/v1/instructions/admin/{iid}/translations/bn",
                            headers=ADMIN)
    assert r.status_code == 200
    assert set(r.json()["data"]["translations"]) == {"en"}

    # Removing a language that isn't there is a 404, not a silent success.
    assert (await client.delete(f"/api/v1/instructions/admin/{iid}/translations/bn",
                                headers=ADMIN)).status_code == 404

    # Duplicate key is rejected.
    r = await client.post("/api/v1/instructions/admin", headers=ADMIN,
                          json={"key": "payments-help", "translations": {}})
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_unpublished_and_archived_instructions_are_hidden(client):
    instr = (await client.post("/api/v1/instructions/admin", headers=ADMIN, json={
        "key": "draft-note", "published": False,
        "translations": {"en": {"title": "Draft", "body": "Not ready."}},
    })).json()["data"]
    student = await _student("SPK-26-IN003")
    data = (await client.get("/api/v1/instructions/me", headers=student)).json()["data"]
    assert data["items"] == []

    await client.patch(f"/api/v1/instructions/admin/{instr['id']}",
                       headers=ADMIN, json={"published": True})
    data = (await client.get("/api/v1/instructions/me", headers=student)).json()["data"]
    assert len(data["items"]) == 1

    await client.delete(f"/api/v1/instructions/admin/{instr['id']}", headers=ADMIN)
    data = (await client.get("/api/v1/instructions/me", headers=student)).json()["data"]
    assert data["items"] == []


@pytest.mark.asyncio
async def test_profile_language_preference_round_trip(client):
    student = await _student("SPK-26-IN004")
    r = await client.put("/api/v1/dashboard/profile", headers=student, json={
        "preferred_language": "bn",
        "preferred_english": "British English",
        # Kids and Adults are separate courses fixed by the activation code —
        # a student sending this must not be able to switch themselves over.
        "audience": "kids",
    })
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["preferred_language"] == "bn"
    assert data["preferred_english"] == "British English"
    assert data["audience"] == "adults"

    # An unsupported language is rejected rather than silently stored.
    r = await client.put("/api/v1/dashboard/profile", headers=student,
                         json={"preferred_language": "klingon"})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_students_cannot_manage_instructions(client):
    student = await _student("SPK-26-IN005")
    r = await client.post("/api/v1/instructions/admin", headers=student,
                          json={"key": "sneaky", "translations": {}})
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# Learning content (videos + PDFs)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_pdf_content_is_membership_gated(client):
    await PlanConfig(plan="Gold", label="Gold", amount=0, duration_days=365).insert()
    await PlanConfig(plan="Tribe", label="Tribe", amount=0, duration_days=365).insert()

    r = await client.post("/api/v1/videos/", headers=ADMIN, json={
        "title": "Gold workbook", "kind": "pdf", "source": "uploaded",
        "url": "/media/documents/gold.pdf", "plans": ["Gold"],
    })
    assert r.status_code == 200, r.text
    pdf_id = r.json()["data"]["id"]
    assert r.json()["data"]["kind"] == "pdf"

    # Gold member sees it and can open it.
    gold = await _student("SPK-26-CN001")
    await Subscription(student_id="SPK-26-CN001", plan="Gold",
                       started_at=utcnow(), expires_at=utcnow()).insert()
    lib = (await client.get("/api/v1/videos/library", headers=gold,
                            params={"kind": "pdf"})).json()["data"]
    assert [v["id"] for v in lib] == [pdf_id]
    assert (await client.get(f"/api/v1/videos/{pdf_id}/open",
                             headers=gold)).status_code == 200

    # Lower tier is refused server-side, not just hidden in the UI.
    tribe = await _student("SPK-26-CN002")
    await Subscription(student_id="SPK-26-CN002", plan="Tribe",
                       started_at=utcnow(), expires_at=utcnow()).insert()
    lib = (await client.get("/api/v1/videos/library", headers=tribe)).json()["data"]
    assert lib == []
    r = await client.get(f"/api/v1/videos/{pdf_id}/open", headers=tribe)
    assert r.status_code == 403
    assert "membership" in r.json()["error"]["message"].lower()


@pytest.mark.asyncio
async def test_archived_content_is_unreachable_even_by_direct_id(client):
    v = Video(title="Old guide", kind="pdf", source="uploaded",
              url="/media/documents/old.pdf")
    await v.insert()
    student = await _student("SPK-26-CN003")
    assert (await client.get(f"/api/v1/videos/{v.id}/open",
                             headers=student)).status_code == 200

    await client.delete(f"/api/v1/videos/{v.id}", headers=ADMIN)
    r = await client.get(f"/api/v1/videos/{v.id}/open", headers=student)
    assert r.status_code == 404
    # Archiving twice is harmless.
    assert (await client.delete(f"/api/v1/videos/{v.id}",
                                headers=ADMIN)).status_code == 200


@pytest.mark.asyncio
async def test_content_validation(client):
    # Unknown kind.
    r = await client.post("/api/v1/videos/", headers=ADMIN, json={
        "title": "X", "kind": "audio", "url": "http://x"})
    assert r.status_code == 422
    # PDF cannot be a YouTube source.
    r = await client.post("/api/v1/videos/", headers=ADMIN, json={
        "title": "X", "kind": "pdf", "source": "youtube", "url": "http://x"})
    assert r.status_code == 422
    # Empty URL.
    r = await client.post("/api/v1/videos/", headers=ADMIN, json={
        "title": "X", "kind": "video", "url": "   "})
    assert r.status_code == 422
    # Membership mapping must reference a real plan.
    await PlanConfig(plan="Silver", label="Silver", amount=0, duration_days=365).insert()
    r = await client.post("/api/v1/videos/", headers=ADMIN, json={
        "title": "X", "kind": "video", "url": "http://x", "plans": ["Platinum"]})
    assert r.status_code == 422
    assert "Platinum" in r.json()["error"]["message"]


@pytest.mark.asyncio
async def test_legacy_videos_default_to_kind_video(client):
    """Backward compatibility: rows written before `kind` existed still work."""
    v = Video(title="Legacy clip", source="youtube", url="https://youtu.be/x")
    await v.insert()
    assert v.kind == "video"
    student = await _student("SPK-26-CN004")
    lib = (await client.get("/api/v1/videos/library", headers=student,
                            params={"kind": "video"})).json()["data"]
    assert [x["title"] for x in lib] == ["Legacy clip"]
