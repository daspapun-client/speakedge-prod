"""SpeakEdge Speaking Community (Module 6) — three layers:
Layer 1/2: public stats + limited member carousel/directory (no auth).
Layer 3:  member dashboard — directory, friend requests, teams (max 8 members;
how many a student may be in comes from their plan's conversation teams, so a
Tribe member sees the classes but is asked to upgrade to join one), report &
block, admin safety cards."""
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.core.cache import cache
from app.core.envelope import ok
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from app.core.rbac import CurrentUser, get_current_user, require_admin
from app.core.security import Role, decode_token
from app.shared.access import require_unlocked_community_student
from app.db.base import utcnow
from app.db.models import (
    Block,
    CEFRStatus,
    ClassAttendance,
    CommunityProfile,
    CommunityReport,
    DirectMessage,
    FriendRequest,
    PlanConfig,
    SafetyCard,
    SpeakingTeam,
    Subscription,
    TeamJoinRequest,
    TeamMessage,
    TeamRead,
)
from app.modules.notification import service as notify_service
from app.shared import file_service
from app.shared.audit import log_activity
from app.shared.realtime import hub
from app.shared.students import load_students_map, student_avatar_fields

router = APIRouter(prefix="/community", tags=["community"])

# Class scheduling is recurring-weekly, in IST (product is India-only; matches
# the Batch reminder convention). RSVP must be placed >=24h before class start,
# and the post-class attendance popup opens 24h after it.
IST = timezone(timedelta(hours=5, minutes=30))
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
CLASS_LEAD = timedelta(hours=24)


def _parse_schedule(day: str, time_str: str) -> tuple[str | None, str | None]:
    """Validate a weekday name + HH:MM. Both blank => unscheduled (None, None)."""
    day = (day or "").strip().lower()
    time_str = (time_str or "").strip()
    if not day and not time_str:
        return None, None
    if day not in WEEKDAYS:
        raise ValidationAppError("Class day must be a weekday name")
    try:
        hh, mm = (int(x) for x in time_str.split(":"))
        if not (0 <= hh < 24 and 0 <= mm < 60):
            raise ValueError
    except (ValueError, TypeError):
        raise ValidationAppError("Class time must be in HH:MM format")
    return day, f"{hh:02d}:{mm:02d}"


def _session_after(day: str, time_str: str, ref: datetime) -> datetime:
    """Earliest weekly class occurrence (IST-aware) at or after `ref`."""
    hh, mm = (int(x) for x in time_str.split(":"))
    days_ahead = (WEEKDAYS.index(day) - ref.weekday()) % 7
    cand = (ref + timedelta(days=days_ahead)).replace(hour=hh, minute=mm, second=0, microsecond=0)
    if cand < ref:
        cand += timedelta(days=7)
    return cand


def _session_datetime(session_date: str, time_str: str) -> datetime:
    y, mo, d = (int(x) for x in session_date.split("-"))
    hh, mm = (int(x) for x in time_str.split(":"))
    return datetime(y, mo, d, hh, mm, tzinfo=IST)

# Limited public information only (never phone/email/address/socials).
PUBLIC_FIELDS = ("student_id", "first_name", "age", "gender", "photo_url",
                 "cefr_level", "cefr_status")

# Fields fellow members may see about each other. Deliberately excludes internal
# moderation/lifecycle fields (is_suspended, is_archived, archived_by,
# delete_reason, auto_delete_at, timestamps) — students only get community-safe info.
MEMBER_FIELDS = ("student_id", "display_name", "first_name", "age", "gender",
                 "photo_url", "cefr_level", "cefr_status", "bio", "interests",
                 "looking_for_partner")


async def _community_locked(student_id: str) -> bool:
    """WebSocket equivalent of the ``require_unlocked_community_student`` guard —
    sockets authenticate from a query-param token, so they cannot use it."""
    from app.db.models import Student

    student = await Student.find_one(Student.student_id == student_id)
    return bool(student and student.community_locked)


def _public_card(p: CommunityProfile) -> dict:
    data = p.model_dump(mode="json")
    return {k: data.get(k) for k in PUBLIC_FIELDS}


def _member_card(p: CommunityProfile) -> dict:
    data = p.model_dump(mode="json")
    return {k: data.get(k) for k in MEMBER_FIELDS}


# --------------------------------------------------------------------------
# Layers 1 & 2 — public (homepage Section 11 carousel + /speaking-community)
# --------------------------------------------------------------------------
@router.get("/public/stats")
async def public_stats():
    total = await CommunityProfile.find(CommunityProfile.is_archived == False).count()  # noqa: E712
    verified = await CommunityProfile.find(
        CommunityProfile.cefr_status == CEFRStatus.verified,
        CommunityProfile.is_archived == False,  # noqa: E712
    ).count()
    teams = await SpeakingTeam.find(SpeakingTeam.is_archived == False).count()  # noqa: E712
    return ok({
        "total_members": total,
        "verified_members": verified,
        "self_declared_members": total - verified,
        "speaking_teams": teams,
    })


@router.get("/public/members")
async def public_members(
    cefr_level: str | None = None,
    gender: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=60),
):
    """Auto-scrolling carousel / public directory. Limited fields only."""
    query: dict = {"is_archived": False, "is_suspended": False}
    if cefr_level:
        query["cefr_level"] = cefr_level
    if gender:
        query["gender"] = gender
    total = await CommunityProfile.find(query).count()
    items = (
        await CommunityProfile.find(query).sort(-CommunityProfile.created_at)
        .skip((page - 1) * page_size).limit(page_size).to_list()
    )
    return ok({"items": [_public_card(p) for p in items], "total": total,
               "page": page, "page_size": page_size})


# --------------------------------------------------------------------------
# Layer 3 — member dashboard
# --------------------------------------------------------------------------
@router.get("/directory")
async def directory(
    user: CurrentUser = Depends(require_unlocked_community_student),
    cefr_level: str | None = None,
    gender: str | None = None,
    looking_for_partner: bool | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
):
    query: dict = {"is_archived": False, "is_suspended": False}
    if cefr_level:
        query["cefr_level"] = cefr_level
    if gender:
        query["gender"] = gender
    if looking_for_partner is not None:
        query["looking_for_partner"] = looking_for_partner
    if q:
        query["display_name"] = {"$regex": q, "$options": "i"}
    total = await CommunityProfile.find(query).count()
    items = await CommunityProfile.find(query).skip((page - 1) * page_size).limit(page_size).to_list()
    return ok({"items": [_member_card(p) for p in items], "total": total,
               "page": page, "page_size": page_size})


@router.get("/members/{student_id}")
async def member_profile(student_id: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    """Community-safe profile any member may view about another member.
    Returns only MEMBER_FIELDS (never phone/email/address), plus the communities
    they belong to, their friend count, and the viewer's relationship to them."""
    cp = await CommunityProfile.find_one(
        CommunityProfile.student_id == student_id,
        CommunityProfile.is_archived == False,  # noqa: E712
    )
    if not cp or cp.is_suspended:
        raise NotFoundError("Member not found")
    # Hide the profile from anyone this member has blocked (Facebook-style).
    if student_id != user.subject and await _i_blocked(student_id, user.subject):
        raise NotFoundError("Member not found")

    teams = await SpeakingTeam.find(
        {"member_ids": student_id, "is_archived": False}
    ).to_list()
    friends = await FriendRequest.find(
        FriendRequest.status == "accepted",
        FriendRequest.is_archived == False,  # noqa: E712
        {"$or": [{"from_student_id": student_id}, {"to_student_id": student_id}]},
    ).count()

    relationship = "self" if student_id == user.subject else "none"
    if relationship == "none":
        if await _i_blocked(user.subject, student_id):
            relationship = "blocked"
        else:
            fr = await FriendRequest.find_one(
                FriendRequest.is_archived == False,  # noqa: E712
                {"$or": [
                    {"from_student_id": user.subject, "to_student_id": student_id},
                    {"from_student_id": student_id, "to_student_id": user.subject},
                ]}
            )
            if fr:
                if fr.status == "accepted":
                    relationship = "friends"
                elif fr.status == "pending":
                    relationship = "request_sent" if fr.from_student_id == user.subject else "request_received"

    return ok({
        **_member_card(cp),
        "friends_count": friends,
        "relationship": relationship,
        "can_message": relationship == "friends",
        "teams": [{"id": str(t.id), "name": t.name, "members": len(t.member_ids),
                   "is_owner": t.owner_student_id == student_id} for t in teams],
    })


class ProfileUpdate(BaseModel):
    bio: str | None = None
    interests: list[str] | None = None
    looking_for_partner: bool | None = None


@router.put("/my-profile")
async def update_my_profile(body: ProfileUpdate, user: CurrentUser = Depends(require_unlocked_community_student)):
    cp = await CommunityProfile.find_one(CommunityProfile.student_id == user.subject)
    if not cp:
        raise NotFoundError("Community profile not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(cp, k, v)
    cp.touch()
    await cp.save()
    return ok(cp.model_dump(mode="json"), "Profile updated")


# --------------------------------------------------------------------------
# Friends, blocking & 1:1 direct messaging (Facebook-style)
# --------------------------------------------------------------------------
def _conv_key(a: str, b: str) -> str:
    """Deterministic conversation key so both directions share one thread."""
    return "|".join(sorted((a, b)))


def _dm_room(a: str, b: str) -> str:
    return f"dm:{_conv_key(a, b)}"


async def _blocked_between(a: str, b: str) -> bool:
    """True if either party has blocked the other."""
    return await Block.find_one(
        Block.is_archived == False,  # noqa: E712
        {"$or": [
            {"blocker_student_id": a, "blocked_student_id": b},
            {"blocker_student_id": b, "blocked_student_id": a},
        ]},
    ) is not None


async def _i_blocked(me: str, other: str) -> bool:
    return await Block.find_one(
        Block.blocker_student_id == me,
        Block.blocked_student_id == other,
        Block.is_archived == False,  # noqa: E712
    ) is not None


async def _friendship(a: str, b: str) -> FriendRequest | None:
    return await FriendRequest.find_one(
        FriendRequest.status == "accepted",
        FriendRequest.is_archived == False,  # noqa: E712
        {"$or": [
            {"from_student_id": a, "to_student_id": b},
            {"from_student_id": b, "to_student_id": a},
        ]},
    )


async def _are_friends(a: str, b: str) -> bool:
    return await _friendship(a, b) is not None


class FriendRequestBody(BaseModel):
    to_student_id: str


@router.post("/friend-request")
async def send_request(body: FriendRequestBody, user: CurrentUser = Depends(require_unlocked_community_student)):
    target = body.to_student_id
    if target == user.subject:
        raise ConflictError("Cannot friend yourself")
    await _require_active_community_member(target)
    if await _blocked_between(user.subject, target):
        raise ForbiddenError("You can't send a friend request to this member.")

    # If they already sent me a pending request, accept it instead of duplicating.
    reverse = await FriendRequest.find_one(
        FriendRequest.from_student_id == target,
        FriendRequest.to_student_id == user.subject,
        FriendRequest.status == "pending",
        FriendRequest.is_archived == False,  # noqa: E712
    )
    if reverse:
        reverse.status = "accepted"
        reverse.touch()
        await reverse.save()
        me_name = await _name_of(user.subject)
        await notify_service.notify(
            target, "Friend request accepted",
            f"{me_name} accepted your friend request. You can now chat.",
            kind="community", push_url=f"/dashboard/community/chat/{user.subject}",
        )
        return ok(reverse.model_dump(mode="json"), "You are now friends")

    existing = await FriendRequest.find_one(
        FriendRequest.from_student_id == user.subject,
        FriendRequest.to_student_id == target,
        FriendRequest.is_archived == False,  # noqa: E712
    )
    if existing and existing.status == "accepted":
        raise ConflictError("You are already friends")
    if existing and existing.status == "pending":
        raise ConflictError("Request already sent")
    if existing:  # previously declined — re-open it
        existing.status = "pending"
        existing.touch()
        await existing.save()
        fr = existing
    else:
        fr = FriendRequest(from_student_id=user.subject, to_student_id=target)
        await fr.insert()

    sender_name = await _name_of(user.subject)
    await notify_service.notify(
        target, "New friend request",
        f"{sender_name} sent you a friend request.",
        kind="community", push_url="/dashboard/community/friends",
    )
    return ok(fr.model_dump(mode="json"), "Friend request sent")


@router.get("/friend-requests")
async def my_friend_requests(user: CurrentUser = Depends(require_unlocked_community_student)):
    incoming = await FriendRequest.find(
        FriendRequest.to_student_id == user.subject,
        FriendRequest.status == "pending",
        FriendRequest.is_archived == False,  # noqa: E712
    ).to_list()
    outgoing = await FriendRequest.find(
        FriendRequest.from_student_id == user.subject,
        FriendRequest.status == "pending",
        FriendRequest.is_archived == False,  # noqa: E712
    ).to_list()
    names = await load_students_map(
        [f.from_student_id for f in incoming] + [f.to_student_id for f in outgoing]
    )

    def _row(f: FriendRequest, other_id: str) -> dict:
        row = f.model_dump(mode="json")
        row.update(student_avatar_fields(names.get(other_id), "other"))
        row["other_student_id"] = other_id
        return row

    return ok({"incoming": [_row(f, f.from_student_id) for f in incoming],
               "outgoing": [_row(f, f.to_student_id) for f in outgoing]})


@router.post("/friend-request/{request_id}/withdraw")
async def withdraw_request(request_id: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    fr = await FriendRequest.get(request_id)
    if not fr or fr.is_archived or fr.from_student_id != user.subject or fr.status != "pending":
        raise NotFoundError("Request not found")
    fr.archive(user.subject, "withdrawn by sender")
    await fr.save()
    return ok(None, "Friend request withdrawn")


@router.post("/friend-request/{request_id}/{action}")
async def respond(request_id: str, action: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    if action not in ("accepted", "declined"):
        raise ConflictError("Invalid action")
    fr = await FriendRequest.get(request_id)
    if not fr or fr.is_archived or fr.to_student_id != user.subject or fr.status != "pending":
        raise NotFoundError("Request not found")
    fr.status = action
    fr.touch()
    await fr.save()

    me_name = await _name_of(user.subject)
    if action == "accepted":
        await notify_service.notify(
            fr.from_student_id, "Friend request accepted",
            f"{me_name} accepted your friend request. You can now chat.",
            kind="community", push_url=f"/dashboard/community/chat/{user.subject}",
        )
    else:
        await notify_service.notify(
            fr.from_student_id, "Friend request declined",
            f"{me_name} declined your friend request.",
            kind="community", push_url="/dashboard/community/friends",
        )
    return ok(fr.model_dump(mode="json"))


@router.get("/friends")
async def my_friends(user: CurrentUser = Depends(require_unlocked_community_student)):
    """Accepted friends with a chat preview + unread count for each."""
    accepted = await FriendRequest.find(
        FriendRequest.status == "accepted",
        FriendRequest.is_archived == False,  # noqa: E712
        {"$or": [{"from_student_id": user.subject}, {"to_student_id": user.subject}]},
    ).to_list()
    friend_ids = [
        f.to_student_id if f.from_student_id == user.subject else f.from_student_id
        for f in accepted
    ]
    profiles = await CommunityProfile.find(
        {"student_id": {"$in": friend_ids}, "is_archived": False}
    ).to_list()
    by_id = {p.student_id: _member_card(p) for p in profiles}

    rows = []
    for fid in friend_ids:
        card = by_id.get(fid, {"student_id": fid, "display_name": fid})
        key = _conv_key(user.subject, fid)
        last = (
            await DirectMessage.find(DirectMessage.conversation_key == key)
            .sort(-DirectMessage.created_at).limit(1).to_list()
        )
        unread = await DirectMessage.find(
            DirectMessage.to_student_id == user.subject,
            DirectMessage.from_student_id == fid,
            DirectMessage.is_read == False,  # noqa: E712
        ).count()
        card["unread_count"] = unread
        card["last_message"] = last[0].text if last else None
        card["last_message_at"] = last[0].created_at.isoformat() if last else None
        rows.append(card)

    rows.sort(key=lambda r: r.get("last_message_at") or "", reverse=True)
    return ok(rows)


class TargetBody(BaseModel):
    student_id: str


@router.post("/block")
async def block_member(body: TargetBody, user: CurrentUser = Depends(require_unlocked_community_student)):
    target = body.student_id
    if target == user.subject:
        raise ConflictError("Cannot block yourself")
    if not await _i_blocked(user.subject, target):
        await Block(blocker_student_id=user.subject, blocked_student_id=target).insert()
    # Break any existing friendship / pending requests both ways.
    async for fr in FriendRequest.find(
        {"$or": [
            {"from_student_id": user.subject, "to_student_id": target},
            {"from_student_id": target, "to_student_id": user.subject},
        ]}
    ):
        fr.archive(user.subject, "blocked")
        await fr.save()
    me_name = await _name_of(user.subject)
    await notify_service.notify(
        target, "You were blocked",
        f"{me_name} has blocked you. You can no longer message or friend them.",
        kind="community",
    )
    await log_activity(user.subject, "community.block", role=user.role.value, target_id=target)
    return ok({"student_id": target}, "Member blocked")


@router.post("/unblock")
async def unblock_member(body: TargetBody, user: CurrentUser = Depends(require_unlocked_community_student)):
    block = await Block.find_one(
        Block.blocker_student_id == user.subject,
        Block.blocked_student_id == body.student_id,
        Block.is_archived == False,  # noqa: E712
    )
    if block:
        block.archive(user.subject, "unblocked")
        await block.save()
    await log_activity(user.subject, "community.unblock", role=user.role.value, target_id=body.student_id)
    return ok({"student_id": body.student_id}, "Member unblocked")


@router.get("/blocked")
async def my_blocked(user: CurrentUser = Depends(require_unlocked_community_student)):
    blocks = await Block.find(
        Block.blocker_student_id == user.subject,
        Block.is_archived == False,  # noqa: E712
    ).to_list()
    ids = [b.blocked_student_id for b in blocks]
    profiles = await CommunityProfile.find({"student_id": {"$in": ids}}).to_list()
    by_id = {p.student_id: _member_card(p) for p in profiles}
    return ok([by_id.get(i, {"student_id": i, "display_name": i}) for i in ids])


@router.post("/friends/{student_id}/unfriend")
async def unfriend(student_id: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    fr = await _friendship(user.subject, student_id)
    if not fr:
        raise NotFoundError("You are not friends with this member")
    fr.archive(user.subject, "unfriended")
    await fr.save()
    return ok({"student_id": student_id}, "Removed from friends")


# ---- 1:1 direct message thread ----
def _dm_payload(m: DirectMessage) -> dict:
    """Shape a DM for the frontend."""
    return {
        "id": str(m.id),
        "sender_student_id": m.from_student_id,
        "to_student_id": m.to_student_id,
        "text": m.text,
        "is_read": m.is_read,
        "created_at": m.created_at.isoformat(),
        "reply_to_id": m.reply_to_id,
        "reply_to_sender_name": m.reply_to_sender_name,
        "reply_to_text": m.reply_to_text,
        "reactions": m.reactions or {},
    }


async def _guard_dm(me: str, other: str) -> None:
    if await _blocked_between(me, other):
        raise ForbiddenError("You can't message this member.")
    if not await _are_friends(me, other):
        raise ForbiddenError("You can only message your friends.")


async def _dm_reply_preview(conv_key: str, reply_to_id: str | None) -> tuple[str | None, str | None, str | None]:
    if not reply_to_id:
        return None, None, None
    parent = await DirectMessage.get(reply_to_id)
    if not parent or parent.conversation_key != conv_key or parent.is_archived:
        return None, None, None
    preview = parent.text if len(parent.text) <= 120 else parent.text[:120] + "…"
    return reply_to_id, await _name_of(parent.from_student_id), preview


async def _toggle_dm_reaction(msg: DirectMessage, student_id: str, emoji: str) -> DirectMessage:
    existing = next((e for e, ids in msg.reactions.items() if student_id in ids), None)
    if existing == emoji:
        msg.reactions[emoji] = [s for s in msg.reactions[emoji] if s != student_id]
        if not msg.reactions[emoji]:
            del msg.reactions[emoji]
    else:
        if existing:
            msg.reactions[existing] = [s for s in msg.reactions[existing] if s != student_id]
            if not msg.reactions[existing]:
                del msg.reactions[existing]
        msg.reactions.setdefault(emoji, []).append(student_id)
    msg.touch()
    await msg.save()
    return msg


async def _dispatch_dm(from_id: str, to_id: str, from_name: str, text: str, *, reply_to_id: str | None = None) -> DirectMessage:
    """Persist a DM, fan out to live sockets, notify the recipient if offline."""
    key = _conv_key(from_id, to_id)
    rid, rname, rtext = await _dm_reply_preview(key, reply_to_id)
    msg = DirectMessage(
        conversation_key=key, from_student_id=from_id, to_student_id=to_id, text=text[:2000],
        reply_to_id=rid, reply_to_sender_name=rname, reply_to_text=rtext,
    )
    await msg.insert()
    room = _dm_room(from_id, to_id)
    await hub.publish(room, {"type": "message", "message": _dm_payload(msg)})
    if to_id not in set(await hub.roster(room)):
        preview = text if len(text) <= 100 else text[:100] + "…"
        await notify_service.notify(
            to_id, f"New message from {from_name}", f"{from_name}: {preview}",
            kind="community", push_url=f"/dashboard/community/chat/{from_id}",
        )
    return msg


@router.get("/dm/{student_id}")
async def dm_thread(student_id: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    await _guard_dm(user.subject, student_id)
    key = _conv_key(user.subject, student_id)
    msgs = (
        await DirectMessage.find(DirectMessage.conversation_key == key)
        .sort(DirectMessage.created_at).to_list()
    )
    # Mark my incoming messages read now that I've opened the thread.
    await DirectMessage.find(
        DirectMessage.to_student_id == user.subject,
        DirectMessage.from_student_id == student_id,
        DirectMessage.is_read == False,  # noqa: E712
    ).update({"$set": {"is_read": True}})
    cp = await CommunityProfile.find_one(CommunityProfile.student_id == student_id)
    friend = _member_card(cp) if cp else {"student_id": student_id, "display_name": student_id}
    return ok({"friend": friend, "messages": [_dm_payload(m) for m in msgs]})


class MessageTextBody(BaseModel):
    text: str


@router.post("/dm/{student_id}")
async def send_dm(student_id: str, body: MessageTextBody, user: CurrentUser = Depends(require_unlocked_community_student)):
    await _guard_dm(user.subject, student_id)
    text = body.text.strip()
    if not text:
        raise ConflictError("Message cannot be empty")
    name = await _name_of(user.subject)
    msg = await _dispatch_dm(user.subject, student_id, name, text)
    return ok(_dm_payload(msg))


def _capacity(team: SpeakingTeam) -> int:
    return min(team.max_members, SpeakingTeam.MAX_MEMBERS)


async def _teams_joined(student_id: str) -> int:
    return await SpeakingTeam.find(
        {"member_ids": student_id, "is_archived": False}
    ).count()


async def _team_allowance(student_id: str) -> int:
    """How many community classes this student's membership includes.

    That is the tier's `conversation_per_week` (conversation teams), read live
    off the catalogue so an admin edit applies to memberships already sold, and
    capped by the platform maximum. Tribe includes **none**: the classes stay
    visible to a Tribe member, but every way of getting into one asks for an
    upgrade instead. A student with no membership on file keeps the old
    platform-wide limit rather than being locked out."""
    sub = await Subscription.find_one(
        Subscription.student_id == student_id,
        Subscription.is_active == True,  # noqa: E712
    )
    cfg = await PlanConfig.find_one(PlanConfig.plan == sub.plan) if sub else None
    if cfg is None:
        return SpeakingTeam.MAX_TEAMS_PER_OWNER
    return min(cfg.conversation_per_week, SpeakingTeam.MAX_TEAMS_PER_OWNER)


async def _check_team_quota(student_id: str, *, who: str | None = None) -> None:
    """Refuse when this student's membership has no community class left — or
    never included one. `who` names them when somebody else is being added."""
    allowed = await _team_allowance(student_id)
    if allowed <= 0:
        raise ConflictError(
            f"{who}'s membership does not include community classes."
            if who else
            "Community classes are not included in your membership. "
            "Upgrade your membership to join a community class."
        )
    if await _teams_joined(student_id) >= allowed:
        raise ConflictError(
            f"{who} is already in the maximum number of community classes"
            if who else
            f"You can be in at most {allowed} community class"
            f"{'' if allowed == 1 else 'es'} at a time"
        )


@router.get("/class-access")
async def class_access(user: CurrentUser = Depends(require_unlocked_community_student)):
    """What this member's plan allows for community classes — drives the
    "Upgrade to join" state on the cards instead of a failed join attempt."""
    allowed = await _team_allowance(user.subject)
    joined = await _teams_joined(user.subject)
    return ok({"allowed": allowed, "joined": joined,
               "included": allowed > 0, "can_join": joined < allowed})


async def _name_of(student_id: str) -> str:
    cp = await CommunityProfile.find_one(CommunityProfile.student_id == student_id)
    return (cp.display_name if cp else None) or student_id


async def _require_active_community_member(student_id: str) -> None:
    cp = await CommunityProfile.find_one(
        CommunityProfile.student_id == student_id,
        CommunityProfile.is_archived == False,  # noqa: E712
    )
    if not cp or cp.is_suspended:
        raise ValidationAppError(f"{student_id} is not an active community member")


async def _apply_team_members(team: SpeakingTeam, member_ids: list[str]) -> list[str]:
    """Replace roster; return student IDs newly added (for notifications)."""
    seen: set[str] = set()
    unique: list[str] = []
    for sid in member_ids:
        sid = (sid or "").strip()
        if sid and sid not in seen:
            seen.add(sid)
            unique.append(sid)
    prev = set(team.member_ids)
    for sid in unique:
        await _require_active_community_member(sid)
        if sid not in prev:
            await _check_team_quota(sid, who=await _name_of(sid))
    team.member_ids = unique
    return [sid for sid in unique if sid not in prev]


def _parse_team_fields(name: str, description: str, max_members: int, *, min_members: int) -> tuple[str, str, int]:
    name = name.strip()
    if not name:
        raise ValidationAppError("Community class name is required")
    description = description.strip()
    if not description:
        raise ValidationAppError("Description is required")
    if len(description) > 200:
        raise ValidationAppError("Description must be at most 200 characters")
    if max_members < min_members or max_members > SpeakingTeam.MAX_MEMBERS:
        raise ValidationAppError(f"Member limit must be between {min_members} and {SpeakingTeam.MAX_MEMBERS}")
    return name, description, max_members


async def _save_banner(banner: UploadFile | None) -> str | None:
    if not banner or not banner.filename:
        return None
    if banner.content_type not in file_service.ALLOWED_IMAGE_TYPES:
        raise ValidationAppError("Banner must be JPEG, PNG, or WebP")
    return file_service.save_book_cover(await banner.read())


@router.post("/teams")
async def create_team(
    name: str = Form(...),
    description: str = Form(""),
    max_members: int = Form(...),
    banner: UploadFile | None = File(None),
    user: CurrentUser = Depends(require_unlocked_community_student),
):
    await _check_team_quota(user.subject)
    name, description, max_members = _parse_team_fields(name, description, max_members, min_members=2)
    banner_url = await _save_banner(banner)
    team = SpeakingTeam(
        name=name,
        description=description,
        max_members=max_members,
        banner_url=banner_url,
        owner_student_id=user.subject,
        member_ids=[user.subject],
    )
    await team.insert()
    return ok(team.model_dump(mode="json"))


@router.put("/teams/{team_id}")
async def update_team(
    team_id: str,
    name: str = Form(...),
    description: str = Form(""),
    max_members: int = Form(...),
    banner: UploadFile | None = File(None),
    remove_banner: str = Form("false"),
    user: CurrentUser = Depends(require_unlocked_community_student),
):
    team = await _member_team(team_id, user.subject)
    name, description, max_members = _parse_team_fields(
        name, description, max_members, min_members=len(team.member_ids),
    )
    new_banner = await _save_banner(banner)
    if remove_banner.lower() == "true":
        team.banner_url = None
    elif new_banner:
        team.banner_url = new_banner
    team.name = name
    team.description = description
    team.max_members = max_members
    team.touch()
    await team.save()
    return ok(team.model_dump(mode="json"), "Community class updated")


@router.get("/teams")
async def list_teams(user: CurrentUser = Depends(require_unlocked_community_student)):
    teams = await SpeakingTeam.find(SpeakingTeam.is_archived == False).to_list()  # noqa: E712
    pending = await TeamJoinRequest.find(
        TeamJoinRequest.requester_student_id == user.subject,
        TeamJoinRequest.status == "pending",
    ).to_list()
    requested = {r.team_id for r in pending}
    return ok([{**t.model_dump(mode="json"), "requested": str(t.id) in requested} for t in teams])


@router.post("/teams/{team_id}/join")
async def request_join(team_id: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    """Request to join — the team owner must approve before you become a member."""
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Team not found")
    if user.subject in team.member_ids:
        raise ConflictError("You are already a member")
    if len(team.member_ids) >= _capacity(team):
        raise ConflictError(f"This community class is full ({_capacity(team)} members max)")
    await _check_team_quota(user.subject)
    existing = await TeamJoinRequest.find_one(
        TeamJoinRequest.team_id == team_id,
        TeamJoinRequest.requester_student_id == user.subject,
        TeamJoinRequest.status == "pending",
    )
    if existing:
        raise ConflictError("You already have a pending request for this community class")
    name = await _name_of(user.subject)
    req = TeamJoinRequest(team_id=team_id, requester_student_id=user.subject, requester_name=name)
    await req.insert()
    await notify_service.notify(
        team.owner_student_id, "New join request",
        f"{name} wants to join your community class “{team.name}”.", kind="approval",
    )
    return ok(req.model_dump(mode="json"), "Request sent — waiting for the owner's approval")


@router.get("/teams/join-requests")
async def my_join_requests(user: CurrentUser = Depends(require_unlocked_community_student)):
    """Pending requests for communities I own — the approval queue."""
    my_teams = await SpeakingTeam.find(
        SpeakingTeam.owner_student_id == user.subject,
        SpeakingTeam.is_archived == False,  # noqa: E712
    ).to_list()
    names = {str(t.id): t.name for t in my_teams}
    if not names:
        return ok([])
    reqs = await TeamJoinRequest.find(
        {"team_id": {"$in": list(names)}, "status": "pending", "is_archived": False}
    ).sort(TeamJoinRequest.created_at).to_list()
    smap = await load_students_map(r.requester_student_id for r in reqs)
    rows = []
    for r in reqs:
        row = {**r.model_dump(mode="json"), "team_name": names[r.team_id]}
        row.update(student_avatar_fields(smap.get(r.requester_student_id), "requester"))
        rows.append(row)
    return ok(rows)


async def _decide_join(req: TeamJoinRequest, team: SpeakingTeam, action: str) -> str:
    """Apply an approve/decline decision to a pending join request. Shared by the
    community-owner flow and the admin moderation flow."""
    if action == "approve":
        if req.requester_student_id not in team.member_ids:
            if len(team.member_ids) >= _capacity(team):
                raise ConflictError(f"This community class is full ({_capacity(team)} members max)")
            await _check_team_quota(req.requester_student_id, who="This student")
            team.member_ids.append(req.requester_student_id)
            team.touch()
            await team.save()
        req.status = "approved"
        msg = f"You were approved to join “{team.name}”."
    else:
        req.status = "declined"
        msg = f"Your request to join “{team.name}” was declined."
    req.touch()
    await req.save()
    await notify_service.notify(req.requester_student_id, "Community class request update", msg, kind="approval")
    return msg


@router.post("/teams/join-requests/{req_id}/{action}")
async def respond_join(req_id: str, action: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    if action not in ("approve", "decline"):
        raise ConflictError("Invalid action")
    req = await TeamJoinRequest.get(req_id)
    if not req or req.status != "pending":
        raise NotFoundError("Request not found")
    team = await SpeakingTeam.get(req.team_id)
    if not team or team.owner_student_id != user.subject:
        raise ForbiddenError("Only the community class owner can respond")
    msg = await _decide_join(req, team, action)
    return ok(req.model_dump(mode="json"), msg)


# --------------------------------------------------------------------------
# Admin — community join-request oversight (all communities, not just owned)
# --------------------------------------------------------------------------
@router.get("/admin/join-requests", dependencies=[Depends(require_admin)])
async def admin_join_requests(status: str | None = "pending"):
    """Every join request across all communities — the admin moderation queue."""
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    reqs = await TeamJoinRequest.find(query).sort(-TeamJoinRequest.created_at).to_list()
    teams = await SpeakingTeam.find(SpeakingTeam.is_archived == False).to_list()  # noqa: E712
    info = {str(t.id): {"team_name": t.name, "owner_student_id": t.owner_student_id} for t in teams}
    owner_ids = [info.get(r.team_id, {}).get("owner_student_id") for r in reqs]
    smap = await load_students_map([r.requester_student_id for r in reqs] + owner_ids)
    rows = []
    for r in reqs:
        extra = info.get(r.team_id, {"team_name": "—", "owner_student_id": None})
        owner_id = extra.get("owner_student_id")
        row = {**r.model_dump(mode="json"), **extra}
        row.update(student_avatar_fields(smap.get(r.requester_student_id), "requester"))
        row.update(student_avatar_fields(smap.get(owner_id) if owner_id else None, "owner"))
        rows.append(row)
    return ok(rows)


@router.post("/admin/join-requests/{req_id}/{action}")
async def admin_respond_join(req_id: str, action: str, admin: CurrentUser = Depends(require_admin)):
    if action not in ("approve", "decline"):
        raise ConflictError("Invalid action")
    req = await TeamJoinRequest.get(req_id)
    if not req or req.status != "pending":
        raise NotFoundError("Request not found")
    team = await SpeakingTeam.get(req.team_id)
    if not team or team.is_archived:
        raise NotFoundError("Community class not found")
    msg = await _decide_join(req, team, action)
    await log_activity(admin.subject, "community.join_request", role=admin.role.value,
                       target_id=req.requester_student_id,
                       meta={"team": team.name, "action": action})
    return ok(req.model_dump(mode="json"), msg)


async def _remove_member_from_team(
    team: SpeakingTeam, student_id: str, actor: str, *, by: str,
) -> None:
    """Drop a member; transfer ownership or archive when the owner leaves/is removed."""
    if student_id not in team.member_ids:
        raise NotFoundError("Member not found in this community class")
    team.member_ids.remove(student_id)
    if team.owner_student_id == student_id:
        if team.member_ids:
            team.owner_student_id = team.member_ids[0]
        else:
            team.archive(actor, "last member removed")
    team.touch()
    await team.save()
    if by == "admin":
        await notify_service.notify(
            student_id, "Community class update",
            f"You were removed from “{team.name}” by an administrator.", kind="community",
        )
    elif by == "owner":
        await notify_service.notify(
            student_id, "Community class update",
            f"You were removed from “{team.name}” by the community class owner.", kind="community",
        )


@router.post("/teams/{team_id}/leave")
async def leave_team(team_id: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    team = await SpeakingTeam.get(team_id)
    if not team or user.subject not in team.member_ids:
        raise NotFoundError("Team not found or you are not a member")
    await _remove_member_from_team(team, user.subject, user.subject, by="self")
    return ok(message="You have left the team")


@router.delete("/teams/{team_id}/members/{student_id}")
async def remove_team_member(
    team_id: str, student_id: str, user: CurrentUser = Depends(get_current_user),
):
    """Owner or admin — remove a member from a community (not yourself; use leave)."""
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Community class not found")
    is_owner = user.role.value == "student" and team.owner_student_id == user.subject
    if not user.is_admin and not is_owner:
        raise ForbiddenError("Only the community class owner or an admin can remove members")
    if student_id == user.subject:
        raise ConflictError("Use leave to remove yourself from a community class")
    by = "admin" if user.is_admin else "owner"
    await _remove_member_from_team(team, student_id, user.subject, by=by)
    await log_activity(
        user.subject, "community.remove_member", role=user.role.value,
        target_type="speaking_team", target_id=team_id,
        meta={"team_name": team.name, "removed": student_id, "by": by},
    )
    return ok(message=f"Member removed from {team.name}")


async def _delete_team(team: SpeakingTeam, actor: str, reason: str) -> None:
    """Archive a community and cancel its pending join requests."""
    team.archive(actor, reason)
    await team.save()
    pending = await TeamJoinRequest.find(
        TeamJoinRequest.team_id == str(team.id),
        TeamJoinRequest.status == "pending",
        TeamJoinRequest.is_archived == False,  # noqa: E712
    ).to_list()
    for req in pending:
        req.archive(actor, "community deleted")
        await req.save()


@router.delete("/teams/{team_id}")
async def delete_team(team_id: str, user: CurrentUser = Depends(get_current_user)):
    """Owner or admin — permanently removes a community (archive-first)."""
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Community class not found")
    is_owner = user.role.value == "student" and team.owner_student_id == user.subject
    if not is_owner and not user.is_admin:
        raise ForbiddenError("Only the community class owner or an admin can delete this community class")
    reason = "deleted by owner" if is_owner else "deleted by admin"
    await _delete_team(team, user.subject, reason)
    await log_activity(
        user.subject, "community.delete", role=user.role.value,
        target_type="speaking_team", target_id=team_id,
        meta={"team_name": team.name, "by": "owner" if is_owner else "admin"},
    )
    return ok(message="Community class deleted")


@router.post("/admin/teams")
async def admin_create_team(
    name: str = Form(...),
    description: str = Form(""),
    max_members: int = Form(...),
    owner_student_id: str = Form(""),
    class_day: str = Form(""),
    class_time: str = Form(""),
    banner: UploadFile | None = File(None),
    admin: CurrentUser = Depends(require_admin),
):
    """Create a community; optionally assign a student owner (bypasses owner team limits)."""
    owner = owner_student_id.strip()
    member_ids: list[str] = []
    if owner:
        cp = await CommunityProfile.find_one(
            CommunityProfile.student_id == owner,
            CommunityProfile.is_archived == False,  # noqa: E712
        )
        if not cp or cp.is_suspended:
            raise ValidationAppError("Owner must be an active community member")
        member_ids = [owner]
    name, description, max_members = _parse_team_fields(name, description, max_members, min_members=1)
    class_day, class_time = _parse_schedule(class_day, class_time)
    banner_url = await _save_banner(banner)
    team = SpeakingTeam(
        name=name,
        description=description,
        max_members=max_members,
        banner_url=banner_url,
        owner_student_id=owner,
        member_ids=member_ids,
        class_day=class_day,
        class_time=class_time,
    )
    await team.insert()
    if owner:
        await notify_service.notify(
            owner, "New community class",
            f"You were assigned as owner of “{team.name}”.", kind="community",
        )
    await log_activity(
        admin.subject, "community.create", role=admin.role.value,
        target_type="speaking_team", target_id=str(team.id),
        meta={"team_name": team.name, "owner": owner or None},
    )
    return ok(team.model_dump(mode="json"), "Community class created")


@router.put("/admin/teams/{team_id}")
async def admin_update_team(
    team_id: str,
    name: str = Form(...),
    description: str = Form(""),
    max_members: int = Form(...),
    owner_student_id: str = Form(""),
    class_day: str = Form(""),
    class_time: str = Form(""),
    member_student_ids: list[str] = Form(default=[]),
    banner: UploadFile | None = File(None),
    remove_banner: str = Form("false"),
    admin: CurrentUser = Depends(require_admin),
):
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Community class not found")
    owner = owner_student_id.strip()
    if owner:
        await _require_active_community_member(owner)
    roster = list(member_student_ids)
    if owner and owner not in roster:
        roster.append(owner)
    added = await _apply_team_members(team, roster)
    name, description, max_members = _parse_team_fields(
        name, description, max_members, min_members=max(len(team.member_ids), 1) if team.member_ids else 1,
    )
    if len(team.member_ids) > max_members:
        raise ValidationAppError(f"Member limit ({max_members}) is below current roster ({len(team.member_ids)})")
    team.class_day, team.class_time = _parse_schedule(class_day, class_time)
    new_banner = await _save_banner(banner)
    if remove_banner.lower() == "true":
        team.banner_url = None
    elif new_banner:
        team.banner_url = new_banner
    prev_owner = team.owner_student_id
    team.name = name
    team.description = description
    team.max_members = max_members
    team.owner_student_id = owner
    team.touch()
    await team.save()
    for sid in added:
        await notify_service.notify(
            sid, "Added to community class",
            f"You were added to “{team.name}”.", kind="community",
        )
    if owner and owner != prev_owner:
        await notify_service.notify(
            owner, "Community class updated",
            f"You were assigned as owner of “{team.name}”.", kind="community",
        )
    await log_activity(
        admin.subject, "community.update", role=admin.role.value,
        target_type="speaking_team", target_id=team_id,
        meta={"team_name": team.name, "owner": owner or None, "members_added": len(added)},
    )
    return ok(team.model_dump(mode="json"), "Community class updated")


@router.get("/admin/teams", dependencies=[Depends(require_admin)])
async def admin_list_teams():
    teams = await SpeakingTeam.find(SpeakingTeam.is_archived == False).sort(-SpeakingTeam.updated_at).to_list()  # noqa: E712
    smap = await load_students_map([t.owner_student_id for t in teams])
    rows = []
    for t in teams:
        row = t.model_dump(mode="json")
        row["member_count"] = len(t.member_ids)
        row.update(student_avatar_fields(smap.get(t.owner_student_id), "owner"))
        rows.append(row)
    return ok(rows)


@router.post("/admin/teams/{team_id}/suspend")
async def admin_suspend_team(team_id: str, admin: CurrentUser = Depends(require_admin)):
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Community class not found")
    team.is_suspended = True
    team.touch()
    await team.save()
    await hub.publish(team_id, {"type": "team_state", "is_suspended": True})
    await log_activity(
        admin.subject, "community.suspend", role=admin.role.value,
        target_type="speaking_team", target_id=team_id, meta={"team_name": team.name},
    )
    return ok(team.model_dump(mode="json"), "Community class suspended — chat disabled")


@router.post("/admin/teams/{team_id}/unsuspend")
async def admin_unsuspend_team(team_id: str, admin: CurrentUser = Depends(require_admin)):
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Community class not found")
    team.is_suspended = False
    team.touch()
    await team.save()
    await hub.publish(team_id, {"type": "team_state", "is_suspended": False})
    await log_activity(
        admin.subject, "community.unsuspend", role=admin.role.value,
        target_type="speaking_team", target_id=team_id, meta={"team_name": team.name},
    )
    return ok(team.model_dump(mode="json"), "Community class unsuspended — chat re-enabled")


# --------------------------------------------------------------------------
# Scheduled classes — weekly schedule, 24h-advance RSVP, mandatory post-class
# attendance + rating popup, admin per-class ratings.
# --------------------------------------------------------------------------
class ScheduleBody(BaseModel):
    class_day: str = ""
    class_time: str = ""


@router.post("/admin/teams/{team_id}/schedule")
async def admin_set_schedule(team_id: str, body: ScheduleBody, admin: CurrentUser = Depends(require_admin)):
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Community class not found")
    team.class_day, team.class_time = _parse_schedule(body.class_day, body.class_time)
    team.touch()
    await team.save()
    await log_activity(admin.subject, "community.schedule", role=admin.role.value,
                       target_type="speaking_team", target_id=team_id,
                       meta={"day": team.class_day, "time": team.class_time})
    return ok(team.model_dump(mode="json"), "Class schedule updated")


@router.post("/teams/{team_id}/rsvp")
async def rsvp_class(team_id: str, user: CurrentUser = Depends(require_unlocked_community_student)):
    """Confirm you'll attend the next class occurrence. Enforces the 24h-advance
    rule by booking the soonest occurrence that is at least 24h away."""
    team = await _member_team(team_id, user.subject)
    if not team.class_day or not team.class_time:
        raise ConflictError("This community class has no scheduled time yet")
    now = datetime.now(IST)
    session = _session_after(team.class_day, team.class_time, now)
    if session - now < CLASS_LEAD:
        session += timedelta(days=7)  # too close — 24h-advance rule books next week
    session_date = session.date().isoformat()
    existing = await ClassAttendance.find_one(
        ClassAttendance.team_id == team_id,
        ClassAttendance.session_date == session_date,
        ClassAttendance.student_id == user.subject,
        ClassAttendance.is_archived == False,  # noqa: E712
    )
    if existing:
        raise ConflictError("You've already confirmed attendance for this class")
    rec = ClassAttendance(team_id=team_id, session_date=session_date,
                          student_id=user.subject, student_name=await _name_of(user.subject))
    await rec.insert()
    return ok({"session_date": session_date},
              f"Confirmed — see you on {session.strftime('%a %d %b at %I:%M %p')}")


@router.get("/my-attendance")
async def my_attendance(user: CurrentUser = Depends(require_unlocked_community_student)):
    """The student's upcoming confirmed sessions — drives the 'Confirmed' state on class cards."""
    today = datetime.now(IST).date().isoformat()
    recs = await ClassAttendance.find(
        ClassAttendance.student_id == user.subject,
        ClassAttendance.session_date >= today,
        ClassAttendance.is_archived == False,  # noqa: E712
    ).to_list()
    return ok([{"team_id": r.team_id, "session_date": r.session_date} for r in recs])


@router.get("/attendance/pending")
async def pending_attendance(user: CurrentUser = Depends(require_unlocked_community_student)):
    """Confirmed sessions that ended >=24h ago and are still unanswered — the
    mandatory 'did you attend?' popup queue."""
    now = datetime.now(IST)
    recs = await ClassAttendance.find(
        ClassAttendance.student_id == user.subject,
        ClassAttendance.attended == None,  # noqa: E711
        ClassAttendance.is_archived == False,  # noqa: E712
    ).to_list()
    out = []
    for r in recs:
        team = await SpeakingTeam.get(r.team_id)
        if not team or not team.class_time or team.is_archived:
            continue
        if now - _session_datetime(r.session_date, team.class_time) >= CLASS_LEAD:
            out.append({"id": str(r.id), "team_name": team.name, "session_date": r.session_date})
    return ok(out)


class AttendanceResponse(BaseModel):
    attended: bool
    rating: int | None = None


@router.post("/attendance/{rec_id}/respond")
async def respond_attendance(rec_id: str, body: AttendanceResponse, user: CurrentUser = Depends(require_unlocked_community_student)):
    rec = await ClassAttendance.get(rec_id)
    if not rec or rec.student_id != user.subject or rec.is_archived:
        raise NotFoundError("Attendance record not found")
    if rec.attended is not None:
        raise ConflictError("You've already answered this")
    rec.attended = body.attended
    if body.attended:
        if body.rating is None or not (1 <= body.rating <= 5):
            raise ValidationAppError("Please rate the class from 1 to 5")
        rec.rating = body.rating
    rec.responded_at = utcnow()
    rec.touch()
    await rec.save()
    return ok(message="Thanks for your feedback")


@router.get("/attendance/history")
async def my_attendance_history(user: CurrentUser = Depends(require_unlocked_community_student)):
    """Post-class attendance answers submitted via the 24h popup."""
    recs = await ClassAttendance.find(
        ClassAttendance.student_id == user.subject,
        ClassAttendance.attended != None,  # noqa: E711
        ClassAttendance.is_archived == False,  # noqa: E712
    ).to_list()
    recs.sort(key=lambda r: r.session_date, reverse=True)
    names: dict[str, str] = {}
    for tid in {r.team_id for r in recs}:
        team = await SpeakingTeam.get(tid)
        if team:
            names[tid] = team.name
    items = [{
        "id": str(r.id),
        "team_id": r.team_id,
        "team_name": names.get(r.team_id, "—"),
        "session_date": r.session_date,
        "attended": r.attended,
        "rating": r.rating,
        "responded_at": r.responded_at.isoformat() if r.responded_at else None,
    } for r in recs]
    attended = sum(1 for r in recs if r.attended)
    ratings = [r.rating for r in recs if r.attended and r.rating]
    return ok({
        "attended_count": attended,
        "missed_count": len(recs) - attended,
        "avg_rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
        "items": items,
    })


@router.get("/admin/attendance", dependencies=[Depends(require_admin)])
async def admin_class_attendance(
    response: str | None = Query("all", pattern="^(all|submitted|pending)$"),
    team_id: str | None = None,
):
    """Student-wise community class attendance — RSVPs and post-class popup answers."""
    query: dict = {"is_archived": False}
    if team_id:
        query["team_id"] = team_id
    recs = await ClassAttendance.find(query).to_list()
    if response == "submitted":
        recs = [r for r in recs if r.attended is not None]
    elif response == "pending":
        recs = [r for r in recs if r.attended is None]
    recs.sort(key=lambda r: (r.session_date, r.responded_at or r.created_at), reverse=True)
    names: dict[str, str] = {}
    for tid in {r.team_id for r in recs}:
        team = await SpeakingTeam.get(tid)
        if team:
            names[tid] = team.name
    smap = await load_students_map([r.student_id for r in recs])
    rows = []
    for r in recs:
        row = {
            "id": str(r.id),
            "team_id": r.team_id,
            "team_name": names.get(r.team_id, "—"),
            "session_date": r.session_date,
            "student_id": r.student_id,
            "student_name": r.student_name,
            "attended": r.attended,
            "rating": r.rating,
            "responded_at": r.responded_at.isoformat() if r.responded_at else None,
            "response_status": (
                "attended" if r.attended is True else
                "missed" if r.attended is False else
                "awaiting"
            ),
        }
        row.update(student_avatar_fields(smap.get(r.student_id), "student"))
        rows.append(row)
    return ok(rows)


@router.get("/admin/teams/{team_id}/attendance", dependencies=[Depends(require_admin)])
async def admin_team_attendance(team_id: str):
    """Per-occurrence attendance + rating summary for one community class."""
    recs = await ClassAttendance.find(
        ClassAttendance.team_id == team_id,
        ClassAttendance.is_archived == False,  # noqa: E712
    ).to_list()
    by_date: dict[str, dict] = {}
    for r in recs:
        g = by_date.setdefault(r.session_date, {"session_date": r.session_date,
                                                "confirmed": 0, "attended": 0, "ratings": []})
        g["confirmed"] += 1
        if r.attended:
            g["attended"] += 1
            if r.rating:
                g["ratings"].append(r.rating)
    rows = []
    for g in by_date.values():
        ratings = g.pop("ratings")
        g["avg_rating"] = round(sum(ratings) / len(ratings), 1) if ratings else None
        g["rating_count"] = len(ratings)
        rows.append(g)
    rows.sort(key=lambda x: x["session_date"], reverse=True)
    return ok(rows)


async def _member_team(team_id: str, student_id: str) -> SpeakingTeam:
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived or student_id not in team.member_ids:
        raise NotFoundError("Team not found or you are not a member")
    return team


async def _accessible_team(team_id: str, user: CurrentUser) -> SpeakingTeam:
    """Members and admins may open any live community (admins for moderation)."""
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Team not found")
    if user.is_admin or user.subject in team.member_ids:
        return team
    raise NotFoundError("Team not found or you are not a member")


def _chat_display_name(user: CurrentUser, profile_name: str | None = None) -> str:
    if user.is_admin:
        return "Admin"
    return profile_name or user.subject


@router.get("/teams/{team_id}/messages")
async def team_messages(team_id: str, user: CurrentUser = Depends(get_current_user)):
    team = await _accessible_team(team_id, user)
    msgs = (
        await TeamMessage.find(TeamMessage.team_id == team_id, TeamMessage.is_archived == False)  # noqa: E712
        .sort(TeamMessage.created_at).to_list()
    )
    return ok({"team": team.model_dump(mode="json"),
               "messages": [m.model_dump(mode="json") for m in msgs]})


@router.get("/teams/{team_id}/members")
async def team_members(team_id: str, user: CurrentUser = Depends(get_current_user)):
    # Students may preview a roster; messages stay member/admin-only.
    if not user.is_admin and user.role != Role.student:
        raise ForbiddenError("Requires student or admin role")
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived:
        raise NotFoundError("Team not found")
    profiles = await CommunityProfile.find(
        {"student_id": {"$in": team.member_ids}, "is_archived": False}
    ).to_list()
    by_id = {p.student_id: _member_card(p) for p in profiles}
    # Keep every member even if their profile is missing; mark the owner.
    members = [by_id.get(sid, {"student_id": sid, "display_name": sid}) for sid in team.member_ids]
    for m in members:
        m["is_owner"] = m["student_id"] == team.owner_student_id
    return ok({"team": team.model_dump(mode="json"), "members": members})


class MessageBody(BaseModel):
    text: str
    reply_to_id: str | None = None


QUICK_REACTIONS = frozenset({"👍", "❤️", "😂", "😮", "😢", "🙏"})
CHAT_SUSPENDED_MSG = "This community class is suspended — chat is temporarily disabled."


def _ensure_chat_enabled(team: SpeakingTeam) -> None:
    if team.is_suspended:
        raise ForbiddenError(CHAT_SUSPENDED_MSG)


async def _notify_unseen_chat(team: SpeakingTeam, sender_id: str, sender_name: str, text: str) -> None:
    """Notify members who are not actively connected to the team chat."""
    team_id = str(team.id)
    online = set(await hub.roster(team_id))
    preview = text if len(text) <= 100 else text[:100] + "…"
    title = f"New message in {team.name}"
    for member_id in team.member_ids:
        if member_id == sender_id or member_id in online:
            continue
        body = f"{sender_name}: {preview}\n\nView chat: team/{team_id}"
        await notify_service.notify(
            member_id, title, body, kind="community",
            push_url=f"/dashboard/community/{team_id}",
        )


async def _reply_preview(team_id: str, reply_to_id: str | None) -> tuple[str | None, str | None, str | None]:
    if not reply_to_id:
        return None, None, None
    parent = await TeamMessage.get(reply_to_id)
    if not parent or parent.team_id != team_id or parent.is_archived:
        return None, None, None
    preview = parent.text if len(parent.text) <= 120 else parent.text[:120] + "…"
    return reply_to_id, parent.sender_name, preview


async def _dispatch_team_message(
    team: SpeakingTeam, sender_id: str, sender_name: str, text: str,
    *, reply_to_id: str | None = None,
) -> TeamMessage:
    """Persist a chat message, fan-out to live sockets, notify offline members."""
    team_id = str(team.id)
    rid, rname, rtext = await _reply_preview(team_id, reply_to_id)
    msg = TeamMessage(
        team_id=team_id, sender_student_id=sender_id,
        sender_name=sender_name, text=text[:2000],
        reply_to_id=rid, reply_to_sender_name=rname, reply_to_text=rtext,
    )
    await msg.insert()
    payload = msg.model_dump(mode="json")
    await hub.publish(team_id, {"type": "message", "message": payload})
    await _notify_unseen_chat(team, sender_id, sender_name, text)
    return msg


async def _toggle_reaction(msg: TeamMessage, student_id: str, emoji: str) -> TeamMessage:
    """One reaction per member — tap same emoji to remove, tap another to switch."""
    existing = next((e for e, ids in msg.reactions.items() if student_id in ids), None)
    if existing == emoji:
        msg.reactions[emoji] = [s for s in msg.reactions[emoji] if s != student_id]
        if not msg.reactions[emoji]:
            del msg.reactions[emoji]
    else:
        if existing:
            msg.reactions[existing] = [s for s in msg.reactions[existing] if s != student_id]
            if not msg.reactions[existing]:
                del msg.reactions[existing]
        msg.reactions.setdefault(emoji, []).append(student_id)
    msg.touch()
    await msg.save()
    return msg


@router.post("/teams/{team_id}/messages")
async def send_message(team_id: str, body: MessageBody, user: CurrentUser = Depends(get_current_user)):
    team = await _accessible_team(team_id, user)
    _ensure_chat_enabled(team)
    text = body.text.strip()
    if not text:
        raise ConflictError("Message cannot be empty")
    profile_name = None if user.is_admin else await _name_of(user.subject)
    name = _chat_display_name(user, profile_name)
    msg = await _dispatch_team_message(team, user.subject, name, text, reply_to_id=body.reply_to_id)
    return ok(msg.model_dump(mode="json"))


# --------------------------------------------------------------------------
# Live chat over WebSocket — messages + typing + presence + read receipts.
# Auth: browsers can't set headers on a WS, so the access token is passed as a
# query param (?token=) and validated on connect. Ephemeral signals (typing,
# presence) are fanned out in memory only; messages and read pointers persist.
# --------------------------------------------------------------------------
MSG_RATE_LIMIT = 30      # messages
MSG_RATE_WINDOW = 10     # per seconds


async def _mark_read(team_id: str, student_id: str, message_id: str) -> None:
    tr = await TeamRead.find_one(TeamRead.team_id == team_id, TeamRead.student_id == student_id)
    if tr:
        tr.last_read_message_id = message_id
        tr.updated_at = utcnow()
        await tr.save()
    else:
        await TeamRead(team_id=team_id, student_id=student_id, last_read_message_id=message_id).insert()


@router.websocket("/ws/teams/{team_id}")
async def team_chat_ws(ws: WebSocket, team_id: str, token: str = Query(...)):
    # 1. Authenticate from the query-param token (close, don't raise, on failure).
    try:
        payload = decode_token(token, expected_type="access")
        actor_id = payload["sub"]
        role = Role(payload["role"])
    except Exception:
        await ws.close(code=4401)  # unauthorized
        return
    is_admin = role in (Role.admin, Role.super_admin)
    # 2. Authorize: current member, or admin moderating any live team.
    team = await SpeakingTeam.get(team_id)
    if not team or team.is_archived or (actor_id not in team.member_ids and not is_admin):
        await ws.close(code=4403)  # forbidden
        return
    if not is_admin and await _community_locked(actor_id):
        await ws.close(code=4403)  # admin has locked this student out of the community
        return

    await ws.accept()
    name = "Admin" if is_admin else await _name_of(actor_id)
    await hub.join(team_id, ws, actor_id)
    try:
        # Initial snapshots for the joiner; history itself comes from the REST GET.
        await hub.send_to(ws, {"type": "presence", "online": await hub.roster(team_id)})
        reads = await TeamRead.find(TeamRead.team_id == team_id).to_list()
        await hub.send_to(ws, {"type": "reads",
                               "reads": {r.student_id: r.last_read_message_id for r in reads}})
        await hub.send_to(ws, {"type": "team_state", "is_suspended": team.is_suspended})
        await hub.broadcast_presence(team_id)  # tell others this member came online

        while True:
            raw = await ws.receive_text()
            try:
                frame = json.loads(raw)
            except json.JSONDecodeError:
                continue  # ignore a malformed frame, keep the connection alive
            kind = frame.get("type")

            if kind == "message":
                text = (frame.get("text") or "").strip()
                if not text:
                    continue
                team = await SpeakingTeam.get(team_id)
                if not team or team.is_archived:
                    break
                if team.is_suspended:
                    await hub.send_to(ws, {"type": "error", "message": CHAT_SUSPENDED_MSG})
                    continue
                if await cache.incr_window(f"wsmsg:{actor_id}", MSG_RATE_WINDOW) > MSG_RATE_LIMIT:
                    await hub.send_to(ws, {"type": "error", "message": "You're sending messages too fast."})
                    continue
                await _dispatch_team_message(
                    team, actor_id, name, text, reply_to_id=frame.get("reply_to_id"),
                )

            elif kind == "react":
                emoji = frame.get("emoji")
                mid = frame.get("message_id")
                if not mid or emoji not in QUICK_REACTIONS:
                    continue
                team = await SpeakingTeam.get(team_id)
                if not team or team.is_archived:
                    break
                if team.is_suspended:
                    await hub.send_to(ws, {"type": "error", "message": CHAT_SUSPENDED_MSG})
                    continue
                msg = await TeamMessage.get(mid)
                if not msg or msg.team_id != team_id or msg.is_archived:
                    continue
                msg = await _toggle_reaction(msg, actor_id, emoji)
                await hub.publish(team_id, {
                    "type": "reaction",
                    "message_id": str(msg.id),
                    "reactions": msg.reactions,
                })

            elif kind == "typing":
                await hub.publish(team_id, {"type": "typing", "student_id": actor_id,
                                            "display_name": name, "is_typing": bool(frame.get("is_typing"))})

            elif kind == "read":
                mid = frame.get("message_id")
                if mid:
                    await _mark_read(team_id, actor_id, mid)
                    await hub.publish(team_id, {"type": "read", "student_id": actor_id,
                                                "last_read_message_id": mid})

            elif kind == "ping":
                await hub.heartbeat(team_id, actor_id)
                await hub.send_to(ws, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(team_id, ws, actor_id)
        await hub.broadcast_presence(team_id)


@router.websocket("/ws/dm/{student_id}")
async def dm_ws(ws: WebSocket, student_id: str, token: str = Query(...)):
    """Live 1:1 chat between two friends: messages + typing + presence.
    Auth mirrors team_chat_ws (token as a query param, close on failure)."""
    try:
        payload = decode_token(token, expected_type="access")
        actor_id = payload["sub"]
    except Exception:
        await ws.close(code=4401)
        return
    # Only friends who haven't blocked each other may open the thread.
    if actor_id == student_id or await _blocked_between(actor_id, student_id) \
            or not await _are_friends(actor_id, student_id) \
            or await _community_locked(actor_id):
        await ws.close(code=4403)
        return

    room = _dm_room(actor_id, student_id)
    await ws.accept()
    name = await _name_of(actor_id)
    await hub.join(room, ws, actor_id)
    try:
        await hub.send_to(ws, {"type": "presence", "online": await hub.roster(room)})
        await hub.broadcast_presence(room)
        # Opening the socket means I'm reading — clear my unread from this friend.
        await DirectMessage.find(
            DirectMessage.to_student_id == actor_id,
            DirectMessage.from_student_id == student_id,
            DirectMessage.is_read == False,  # noqa: E712
        ).update({"$set": {"is_read": True}})

        while True:
            raw = await ws.receive_text()
            try:
                frame = json.loads(raw)
            except json.JSONDecodeError:
                continue
            kind = frame.get("type")

            if kind == "message":
                text = (frame.get("text") or "").strip()
                if not text:
                    continue
                if await _blocked_between(actor_id, student_id):
                    await hub.send_to(ws, {"type": "error", "message": "You can't message this member."})
                    continue
                if await cache.incr_window(f"wsdm:{actor_id}", MSG_RATE_WINDOW) > MSG_RATE_LIMIT:
                    await hub.send_to(ws, {"type": "error", "message": "You're sending messages too fast."})
                    continue
                await _dispatch_dm(actor_id, student_id, name, text, reply_to_id=frame.get("reply_to_id"))

            elif kind == "react":
                emoji = frame.get("emoji")
                mid = frame.get("message_id")
                if not mid or emoji not in QUICK_REACTIONS:
                    continue
                if await _blocked_between(actor_id, student_id):
                    continue
                key = _conv_key(actor_id, student_id)
                msg = await DirectMessage.get(mid)
                if not msg or msg.conversation_key != key or msg.is_archived:
                    continue
                msg = await _toggle_dm_reaction(msg, actor_id, emoji)
                await hub.publish(room, {
                    "type": "reaction",
                    "message_id": str(msg.id),
                    "reactions": msg.reactions,
                })

            elif kind == "typing":
                await hub.publish(room, {"type": "typing", "student_id": actor_id,
                                         "display_name": name, "is_typing": bool(frame.get("is_typing"))})

            elif kind == "ping":
                await hub.heartbeat(room, actor_id)
                await hub.send_to(ws, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        await hub.leave(room, ws, actor_id)
        await hub.broadcast_presence(room)


class ReportBody(BaseModel):
    against_student_id: str
    reason: str


@router.post("/report")
async def report_member(body: ReportBody, user: CurrentUser = Depends(require_unlocked_community_student)):
    """Report & Block system — creates a complaint for admin review."""
    report = CommunityReport(
        reporter_student_id=user.subject,
        against_student_id=body.against_student_id,
        reason=body.reason,
    )
    await report.insert()
    return ok({"id": str(report.id)}, "Report submitted. Our team will review it.")


@router.get("/reports", dependencies=[Depends(require_admin)])
async def list_reports(status: str | None = None):
    query: dict = {"is_archived": False}
    if status:
        query["status"] = status
    items = await CommunityReport.find(query).sort(-CommunityReport.created_at).to_list()
    smap = await load_students_map(
        [r.reporter_student_id for r in items] + [r.against_student_id for r in items]
    )
    rows = []
    for r in items:
        row = r.model_dump(mode="json")
        row.update(student_avatar_fields(smap.get(r.reporter_student_id), "reporter"))
        row.update(student_avatar_fields(smap.get(r.against_student_id), "against"))
        rows.append(row)
    return ok(rows)


class SafetyCardBody(BaseModel):
    student_id: str
    card_type: str  # yellow | deep_yellow | red | suspension | termination
    reason: str


@router.post("/safety-card")
async def issue_card(body: SafetyCardBody, admin: CurrentUser = Depends(require_admin)):
    card = SafetyCard(student_id=body.student_id, card_type=body.card_type,
                      reason=body.reason, issued_by=admin.subject)
    await card.insert()
    if body.card_type in ("suspension", "termination"):
        cp = await CommunityProfile.find_one(CommunityProfile.student_id == body.student_id)
        if cp:
            cp.is_suspended = True
            await cp.save()
    await log_activity(admin.subject, "community.safety_card", role=admin.role.value,
                       target_id=body.student_id, meta={"type": body.card_type})
    return ok(card.model_dump(mode="json"))
