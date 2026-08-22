"""Admin-only destructive operations."""
from app.core.exceptions import NotFoundError
from app.db.models import (
    ActivationCode,
    ActivityLog,
    Attendance,
    Batch,
    BookOrder,
    CEFRReport,
    Certificate,
    CodeStatus,
    CommunityProfile,
    CommunityReport,
    ExamBooking,
    FriendRequest,
    Notification,
    Offer,
    OfferResponse,
    Payment,
    PushSubscription,
    SafetyCard,
    SpeakingTeam,
    Student,
    Subscription,
    Teacher,
    TeacherReview,
    TeamJoinRequest,
    TeamMessage,
    TeamRead,
    User,
    Video,
    WatchHistory,
)


async def purge_student(student_id: str) -> None:
    """Permanently delete a student and all DB rows that reference them."""
    sid = student_id.strip()
    student = await Student.find_one(Student.student_id == sid)
    if not student:
        raise NotFoundError("Student not found")

    # Communities owned by this student (and their chat data).
    owned = await SpeakingTeam.find(SpeakingTeam.owner_student_id == sid).to_list()
    owned_team_ids = [str(t.id) for t in owned]
    if owned_team_ids:
        await TeamMessage.find({"team_id": {"$in": owned_team_ids}}).delete()
        await TeamRead.find({"team_id": {"$in": owned_team_ids}}).delete()
        await TeamJoinRequest.find({"team_id": {"$in": owned_team_ids}}).delete()
        await SpeakingTeam.find({"_id": {"$in": [t.id for t in owned]}}).delete()

    # Membership in other communities + their chat footprint.
    await SpeakingTeam.find({"member_ids": sid}).update_many({"$pull": {"member_ids": sid}})
    await TeamMessage.find(TeamMessage.sender_student_id == sid).delete()
    await TeamRead.find(TeamRead.student_id == sid).delete()
    await TeamJoinRequest.find(TeamJoinRequest.requester_student_id == sid).delete()

    await FriendRequest.find(
        {"$or": [{"from_student_id": sid}, {"to_student_id": sid}]}
    ).delete()
    await CommunityProfile.find(CommunityProfile.student_id == sid).delete()
    await SafetyCard.find(SafetyCard.student_id == sid).delete()
    await CommunityReport.find(
        {"$or": [{"reporter_student_id": sid}, {"against_student_id": sid}]}
    ).delete()

    await Payment.find(Payment.student_id == sid).delete()
    await Subscription.find(Subscription.student_id == sid).delete()
    await BookOrder.find(BookOrder.student_id == sid).delete()
    await ExamBooking.find(ExamBooking.student_id == sid).delete()
    await CEFRReport.find(CEFRReport.student_id == sid).delete()
    await Certificate.find(Certificate.student_id == sid).delete()
    await WatchHistory.find(WatchHistory.student_id == sid).delete()
    await OfferResponse.find(OfferResponse.student_id == sid).delete()
    await TeacherReview.find(TeacherReview.student_id == sid).delete()

    await _batch_pull(sid)
    await Attendance.find(
        {"$or": [{"present_ids": sid}, {"absent_ids": sid}]}
    ).update_many({"$pull": {"present_ids": sid, "absent_ids": sid}})
    await Video.find({"student_ids": sid}).update_many({"$pull": {"student_ids": sid}})
    await Offer.find({"target_student_ids": sid}).update_many(
        {"$pull": {"target_student_ids": sid}}
    )

    await Notification.find(Notification.recipient == sid).delete()
    await Notification.find({"read_by": sid}).update_many({"$pull": {"read_by": sid}})
    await ActivityLog.find(
        {"$or": [{"target_id": sid}, {"actor": sid}]}
    ).delete()

    # Linked teacher profile (student who became a teacher).
    for teacher in await Teacher.find(Teacher.student_id == sid).to_list():
        if teacher.username:
            await User.find(User.username == teacher.username).delete()
        await teacher.delete()

    # Login identity + push subscriptions.
    for user in await User.find(
        {"$or": [{"student_id": sid}, {"username": sid}]}
    ).to_list():
        await PushSubscription.find(PushSubscription.user_id == str(user.id)).delete()
        await user.delete()

    # Free the activation code so it can be reused.
    ac = await ActivationCode.find_one(ActivationCode.code == sid)
    if ac and ac.activated_student_id == sid:
        ac.status = CodeStatus.unused
        ac.activated_at = None
        ac.activated_student_id = None
        await ac.save()

    await student.delete()


async def _batch_pull(sid: str) -> None:
    await Batch.find(
        {"$or": [{"student_ids": sid}, {"pending_ids": sid}]}
    ).update_many({"$pull": {"student_ids": sid, "pending_ids": sid}})
