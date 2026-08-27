"""Weekly exam slots (Module 11).

Admin sets a slot as **weekday + time** — "Sunday – 11:00 AM" — and it repeats
every week on that day and time until the admin changes or removes it. That
recurring rule is an ``ExamSlotRule``; the bookable rows students actually see
are ordinary ``Exam`` documents generated from it over a rolling horizon.

The recurrence machinery itself lives in ``app/shared/weekly.py`` — this module
only says what an exam occurrence is built from and what makes one untouchable:
a live seat on it. Editing or removing a rule therefore re-cuts only its future
*unbooked* dates. A slot somebody already booked is left exactly where it is,
and admin can still move or cancel that one date on its own from the slot list.
"""
from datetime import datetime

from app.db.models import Exam, ExamBooking, ExamSlotRule
from app.shared import weekly
from app.shared.weekly import (  # re-exported: the exam module's one vocabulary
    IST,
    WEEKDAYS,
    label,
    occurrences,
    parse_day,
    parse_time,
    to_ist,
    to_naive_utc,
    to_utc,
)

__all__ = [
    "IST", "WEEKDAYS", "SLOT_HORIZON_WEEKS", "label", "occurrences", "parse_day",
    "parse_time", "to_ist", "to_naive_utc", "to_utc", "booked_slot_ids", "generate",
    "rebuild", "drop_future", "purge_past", "sync_all",
]

SLOT_HORIZON_WEEKS = weekly.DEFAULT_HORIZON_WEEKS


async def booked_slot_ids(exams) -> set[str]:
    """Slots somebody is holding a live seat on — never re-cut under them."""
    exam_ids = [str(e.id) for e in exams]
    if not exam_ids:
        return set()
    rows = await ExamBooking.find({
        "exam_id": {"$in": exam_ids}, "status": {"$ne": "cancelled"},
    }).to_list()
    return {b.exam_id for b in rows}


def _build(rule: ExamSlotRule, when: datetime) -> Exam:
    return Exam(
        kind=rule.kind, title=rule.title, scheduled_at=when,
        duration_minutes=rule.duration_minutes, capacity=rule.capacity,
        examiner_id=rule.examiner_id, meeting_url=rule.meeting_url,
        rule_id=str(rule.id),
    )


schedule = weekly.WeeklySchedule(
    Exam, build=_build, in_use=booked_slot_ids,
    purge_reason="Weekly exam slot expired unbooked",
)

generate = schedule.generate
rebuild = schedule.rebuild
drop_future = schedule.drop_future
purge_past = schedule.purge_past


async def sync_all() -> dict:
    """Scheduler pass over every live weekly exam slot."""
    rules = await ExamSlotRule.find(ExamSlotRule.is_archived == False).to_list()  # noqa: E712
    return await schedule.sync(rules)
