"""Per-student access locks.

Independent of membership status and subscription: a student can be fully paid
and Active yet still be barred by an admin from teacher-led classes, from the
community, or from both (Admin → Users → Access). The account otherwise keeps
working — dashboard, prompt library, AI practice and payments are unaffected.

Enforcement lives here so both the guard dependencies and any direct service
call share one message and one rule.
"""
from fastapi import Depends

from app.core.exceptions import ForbiddenError
from app.core.rbac import CurrentUser, require_student
from app.db.models import Student

TEACHER_LOCK_MESSAGE = (
    "Your access to teacher-led classes is currently on hold. "
    "Please contact SpeakEdge support for help."
)
COMMUNITY_LOCK_MESSAGE = (
    "Your access to the SpeakEdge community is currently on hold. "
    "Please contact SpeakEdge support for help."
)


def _message(base: str, student: Student) -> str:
    return f"{base} Reason: {student.access_lock_reason}" if student.access_lock_reason else base


async def _load(student_id: str) -> Student | None:
    return await Student.find_one(Student.student_id == student_id)


async def ensure_teacher_class_access(student_id: str) -> None:
    student = await _load(student_id)
    if student and student.teacher_class_locked:
        raise ForbiddenError(_message(TEACHER_LOCK_MESSAGE, student))


async def ensure_community_access(student_id: str) -> None:
    student = await _load(student_id)
    if student and student.community_locked:
        raise ForbiddenError(_message(COMMUNITY_LOCK_MESSAGE, student))


async def require_unlocked_teacher_student(
    user: CurrentUser = Depends(require_student),
) -> CurrentUser:
    """``require_student`` plus the teacher-led class lock."""
    await ensure_teacher_class_access(user.subject)
    return user


async def require_unlocked_community_student(
    user: CurrentUser = Depends(require_student),
) -> CurrentUser:
    """``require_student`` plus the community lock."""
    await ensure_community_access(user.subject)
    return user
