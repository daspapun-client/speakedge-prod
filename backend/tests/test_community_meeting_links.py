"""Meeting rooms for the community side of the product.

Two things here are conducted on a video link, exactly as a teacher-led batch
is: a **community class** (``SpeakingTeam.meeting_url``, set by admin or by the
member who owns and runs the class) and a member's own **1:1 practice room** for
speaking partners (``CommunityProfile.meeting_url``).

The interesting part is not that the field stores a string — it is who gets to
read it. The class list is shown to every member so they can ask to join, so it
must not hand a non-member the room its members are speaking in; a practice room
is shared with friends and with nobody else.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.security import Role, hash_password
from app.db.models import (
    CommunityProfile,
    FriendRequest,
    SpeakingTeam,
    Student,
    Subscription,
    User,
)

pytestmark = pytest.mark.asyncio

MEET = "https://meet.google.com/abc-defg-hij"
OTHER_MEET = "https://meet.google.com/zzz-yyyy-xxx"


async def _member(client, student_id: str, name: str = "Asha", plan: str = "Gold") -> dict:
    await Student(student_id=student_id, full_name=name, phone="9990001111").insert()
    await User(username=student_id, password_hash=hash_password("Student@123"),
               role=Role.student, student_id=student_id).insert()
    await CommunityProfile(student_id=student_id, display_name=name).insert()
    now = datetime.now(timezone.utc)
    await Subscription(student_id=student_id, plan=plan, started_at=now,
                       expires_at=now + timedelta(days=365), is_active=True).insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": student_id, "password": "Student@123"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _admin_headers(client) -> dict:
    await User(username="admin@speakedge.in", email="admin@speakedge.in",
               password_hash=hash_password("Admin@12345"), role=Role.super_admin,
               full_name="Super Admin").insert()
    r = await client.post("/api/v1/auth/login",
                          json={"username": "admin@speakedge.in", "password": "Admin@12345"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['access_token']}"}


async def _class(owner: str, *members: str) -> str:
    team = SpeakingTeam(name="Morning Club", description="Practice together",
                        max_members=4, owner_student_id=owner,
                        member_ids=[owner, *members])
    await team.insert()
    return str(team.id)


async def _befriend(a: str, b: str) -> None:
    await FriendRequest(from_student_id=a, to_student_id=b, status="accepted").insert()


# ---------------------------------------------------------------------------
# Community class meeting link
# ---------------------------------------------------------------------------
async def test_owner_sets_class_link_and_members_get_it(client):
    owner = await _member(client, "SPK-26-OWNER", "Owner")
    team_id = await _class("SPK-26-OWNER", "SPK-26-MEMBER")
    member = await _member(client, "SPK-26-MEMBER", "Member")

    r = await client.post(f"/api/v1/community/teams/{team_id}/meeting-link",
                          json={"meeting_url": MEET}, headers=owner)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["meeting_url"] == MEET

    # A member of the class sees the room in the class list...
    rows = (await client.get("/api/v1/community/teams", headers=member)).json()["data"]
    row = next(t for t in rows if t["id"] == team_id)
    assert row["meeting_url"] == MEET
    # ...and on the class page.
    page = await client.get(f"/api/v1/community/teams/{team_id}/messages", headers=member)
    assert page.json()["data"]["team"]["meeting_url"] == MEET


async def test_class_link_is_withheld_from_non_members(client):
    owner = await _member(client, "SPK-26-OWNER", "Owner")
    team_id = await _class("SPK-26-OWNER")
    await client.post(f"/api/v1/community/teams/{team_id}/meeting-link",
                      json={"meeting_url": MEET}, headers=owner)

    outsider = await _member(client, "SPK-26-OUTSIDE", "Outsider")
    rows = (await client.get("/api/v1/community/teams", headers=outsider)).json()["data"]
    row = next(t for t in rows if t["id"] == team_id)
    # The class stays listed — that is how they ask to join — but not its room.
    assert row["name"] == "Morning Club"
    assert row.get("meeting_url") is None
    # The roster preview is open to any student, so it must withhold it too.
    roster = await client.get(f"/api/v1/community/teams/{team_id}/members", headers=outsider)
    assert roster.json()["data"]["team"].get("meeting_url") is None


async def test_only_owner_or_admin_may_set_the_class_link(client):
    await _member(client, "SPK-26-OWNER", "Owner")
    team_id = await _class("SPK-26-OWNER", "SPK-26-MEMBER")
    member = await _member(client, "SPK-26-MEMBER", "Member")

    r = await client.post(f"/api/v1/community/teams/{team_id}/meeting-link",
                          json={"meeting_url": OTHER_MEET}, headers=member)
    assert r.status_code == 403, r.text
    assert (await SpeakingTeam.get(team_id)).meeting_url is None


async def test_admin_manages_the_class_link(client):
    admin = await _admin_headers(client)
    await _member(client, "SPK-26-OWNER", "Owner")
    team_id = await _class("SPK-26-OWNER")

    r = await client.post(f"/api/v1/community/teams/{team_id}/meeting-link",
                          json={"meeting_url": MEET}, headers=admin)
    assert r.status_code == 200, r.text
    rows = (await client.get("/api/v1/community/admin/teams", headers=admin)).json()["data"]
    assert next(t for t in rows if t["id"] == team_id)["meeting_url"] == MEET

    # Blank clears it rather than storing "".
    r = await client.post(f"/api/v1/community/teams/{team_id}/meeting-link",
                          json={"meeting_url": "  "}, headers=admin)
    assert r.status_code == 200, r.text
    assert (await SpeakingTeam.get(team_id)).meeting_url is None


async def test_class_link_must_be_a_url(client):
    owner = await _member(client, "SPK-26-OWNER", "Owner")
    team_id = await _class("SPK-26-OWNER")
    r = await client.post(f"/api/v1/community/teams/{team_id}/meeting-link",
                          json={"meeting_url": "meet.google.com/abc"}, headers=owner)
    assert r.status_code == 422, r.text
    assert (await SpeakingTeam.get(team_id)).meeting_url is None


# ---------------------------------------------------------------------------
# Individual members — the 1:1 practice room
# ---------------------------------------------------------------------------
async def test_practice_room_reaches_friends_only(client):
    me = await _member(client, "SPK-26-ME", "Me")
    await _member(client, "SPK-26-FRIEND", "Friend")
    stranger = await _member(client, "SPK-26-STRANGER", "Stranger")
    await _befriend("SPK-26-ME", "SPK-26-FRIEND")

    r = await client.put("/api/v1/community/my-profile",
                         json={"meeting_url": MEET}, headers=me)
    assert r.status_code == 200, r.text

    login = await client.post("/api/v1/auth/login",
                              json={"username": "SPK-26-FRIEND", "password": "Student@123"})
    fh = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    seen = await client.get("/api/v1/community/members/SPK-26-ME", headers=fh)
    assert seen.json()["data"]["meeting_url"] == MEET
    # A stranger gets the profile but never the room.
    blind = await client.get("/api/v1/community/members/SPK-26-ME", headers=stranger)
    assert blind.status_code == 200, blind.text
    assert blind.json()["data"]["meeting_url"] is None
    # Nor does the members directory carry it for anybody.
    directory = (await client.get("/api/v1/community/directory", headers=stranger)).json()["data"]
    assert all("meeting_url" not in item for item in directory["items"])


async def test_practice_rooms_ride_along_on_the_dm_thread(client):
    me = await _member(client, "SPK-26-ME", "Me")
    friend_headers = await _member(client, "SPK-26-FRIEND", "Friend")
    await _befriend("SPK-26-ME", "SPK-26-FRIEND")

    await client.put("/api/v1/community/my-profile", json={"meeting_url": MEET}, headers=me)
    await client.put("/api/v1/community/my-profile",
                     json={"meeting_url": OTHER_MEET}, headers=friend_headers)

    thread = (await client.get("/api/v1/community/dm/SPK-26-FRIEND", headers=me)).json()["data"]
    assert thread["friend"]["meeting_url"] == OTHER_MEET
    assert thread["my_meeting_url"] == MEET


async def test_friends_list_carries_each_friend_room(client):
    """The friends list is where a 1:1 session actually starts, so each row
    carries that friend's room — every row there is an accepted friend."""
    me = await _member(client, "SPK-26-ME", "Me")
    friend_headers = await _member(client, "SPK-26-FRIEND", "Friend")
    await _member(client, "SPK-26-QUIET", "Quiet")
    await _befriend("SPK-26-ME", "SPK-26-FRIEND")
    await _befriend("SPK-26-QUIET", "SPK-26-ME")

    await client.put("/api/v1/community/my-profile",
                     json={"meeting_url": OTHER_MEET}, headers=friend_headers)

    rows = (await client.get("/api/v1/community/friends", headers=me)).json()["data"]
    by_id = {r["student_id"]: r for r in rows}
    assert by_id["SPK-26-FRIEND"]["meeting_url"] == OTHER_MEET
    # A friend who has not set one reads as no room, not as a missing key.
    assert by_id["SPK-26-QUIET"]["meeting_url"] is None


async def test_practice_room_is_cleared_by_a_blank_value(client):
    me = await _member(client, "SPK-26-ME", "Me")
    await client.put("/api/v1/community/my-profile", json={"meeting_url": MEET}, headers=me)
    await client.put("/api/v1/community/my-profile", json={"meeting_url": ""}, headers=me)
    cp = await CommunityProfile.find_one(CommunityProfile.student_id == "SPK-26-ME")
    assert cp.meeting_url is None

    # ...and a non-URL is refused rather than stored.
    bad = await client.put("/api/v1/community/my-profile",
                           json={"meeting_url": "join my meet"}, headers=me)
    assert bad.status_code == 422, bad.text


async def test_omitting_the_room_leaves_it_alone(client):
    """Every field on this endpoint is optional — saving a bio must not wipe the
    room, which is what a blanket overwrite of all model fields would do."""
    me = await _member(client, "SPK-26-ME", "Me")
    await client.put("/api/v1/community/my-profile", json={"meeting_url": MEET}, headers=me)
    await client.put("/api/v1/community/my-profile", json={"bio": "Hello!"}, headers=me)
    cp = await CommunityProfile.find_one(CommunityProfile.student_id == "SPK-26-ME")
    assert cp.bio == "Hello!"
    assert cp.meeting_url == MEET
