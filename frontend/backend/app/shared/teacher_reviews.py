"""Teacher review requests created when class attendance is submitted."""
from app.db.models import Attendance, Teacher, TeacherReview


async def ensure_review_requests(att: Attendance, teacher: Teacher | None) -> None:
    """One review request per present student per attendance record."""
    att_id = str(att.id)
    for sid in att.present_ids:
        if await TeacherReview.find_one(
            TeacherReview.attendance_id == att_id,
            TeacherReview.student_id == sid,
        ):
            continue
        await TeacherReview(
            student_id=sid, teacher_id=att.teacher_id or "",
            teacher_name=teacher.name if teacher else None,
            batch_id=att.batch_id, attendance_id=att_id,
            class_date=att.date, class_time=att.class_time,
        ).insert()


async def sync_reviews_for_student(student_id: str) -> None:
    """Backfill review requests for attendance already on file."""
    for att in await Attendance.find(
        {"present_ids": student_id, "status": {"$in": ["pending", "approved"]}}
    ).to_list():
        teacher = await Teacher.get(att.teacher_id) if att.teacher_id else None
        await ensure_review_requests(att, teacher)
