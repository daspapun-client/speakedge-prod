"""Batch-load Student rows for admin list enrichment (avatars, display names)."""
from __future__ import annotations

from collections.abc import Iterable

from app.db.models import Student


async def load_students_map(student_ids: Iterable[str]) -> dict[str, Student]:
    unique = list({sid for sid in student_ids if sid})
    if not unique:
        return {}
    rows = await Student.find({"student_id": {"$in": unique}}).to_list()
    return {s.student_id: s for s in rows}


def student_avatar_fields(student: Student | None, prefix: str) -> dict:
    """photo_url / gender / name keyed with a prefix, e.g. requester_photo_url."""
    if not student:
        return {
            f"{prefix}_photo_url": None,
            f"{prefix}_gender": None,
            f"{prefix}_name": None,
        }
    return {
        f"{prefix}_photo_url": student.photo_url,
        f"{prefix}_gender": student.gender,
        f"{prefix}_name": student.full_name,
    }
