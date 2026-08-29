"""Weekly teacher-led enrolment — a student fixes a class once, not every week.

A course is a ``BatchSeries``: a fixed weekday and time that repeats weekly,
materialised by admin as one dated ``Batch`` per class date. The student picks
that course **once** — one request, one admin decision — and the approval
carries for :data:`SESSIONS_PER_CYCLE` consecutive classes, which is what one
monthly fee buys. Paying the next monthly fee tops the enrolment back up to a
full cycle of upcoming classes, so nothing is ever requested week after week.

Storage stays per-session (``Batch.student_ids`` / ``Batch.pending_ids``):
everything downstream — attendance, meeting links, remuneration, analytics —
already works on a dated batch and must not learn about the series. This module
is only the "one decision, applied across the cycle" layer on top of it.
"""
from datetime import datetime, timedelta, timezone

from app.db.models import Batch

IST = timezone(timedelta(hours=5, minutes=30))  # product is India-only

#: Classes one monthly fee buys. An approval covers this many consecutive
#: sessions, and each monthly payment restores the enrolment to this many
#: upcoming ones.
SESSIONS_PER_CYCLE = 4


def _today() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


def session_date(batch: Batch) -> str:
    """The one class date a series child carries. Unscheduled rows sort last."""
    return batch.date or (min(batch.class_dates) if batch.class_dates else "9999-99-99")


def upcoming(rows: list[Batch]) -> list[Batch]:
    """Today's and future sessions, earliest first."""
    today = _today()
    return [b for b in sorted(rows, key=session_date) if session_date(b) >= today]


async def sessions(series_id: str) -> list[Batch]:
    """Every live session of a course, earliest first."""
    rows = await Batch.find(Batch.series_id == series_id,
                            Batch.is_archived == False).to_list()  # noqa: E712
    return sorted(rows, key=session_date)


def series_status(rows: list[Batch], student_id: str) -> str:
    """The student's standing in the course as a whole, not in one sitting."""
    if any(student_id in b.student_ids for b in rows):
        return "member"
    if any(student_id in b.pending_ids for b in rows):
        return "pending"
    return "none"


async def request(series_id: str, student_id: str) -> list[Batch]:
    """Queue the student for a whole cycle at once — the single weekly request."""
    touched = []
    for b in upcoming(await sessions(series_id))[:SESSIONS_PER_CYCLE]:
        if student_id in b.student_ids or student_id in b.pending_ids:
            continue
        b.pending_ids.append(student_id)
        b.touch()
        await b.save()
        touched.append(b)
    return touched


async def withdraw(series_id: str, student_id: str) -> list[Batch]:
    """Pull the pending request back off every session it was filed against."""
    touched = []
    for b in await sessions(series_id):
        if student_id in b.pending_ids:
            b.pending_ids.remove(student_id)
            b.touch()
            await b.save()
            touched.append(b)
    return touched


async def decide(series_id: str, student_id: str, *, approve: bool) -> list[Batch]:
    """Apply the admin's one decision to every session the request covers."""
    touched = []
    for b in await sessions(series_id):
        if student_id not in b.pending_ids:
            continue
        b.pending_ids.remove(student_id)
        if approve and student_id not in b.student_ids:
            b.student_ids.append(student_id)
        b.touch()
        await b.save()
        touched.append(b)
    return touched


async def top_up(series_id: str, student_id: str) -> list[Batch]:
    """Seat the student in upcoming sittings until they hold a full cycle.

    The unit of enrolment is the cycle one monthly fee buys, never a single
    sitting — so this is what an admin adding somebody to a course does, and
    what a settled monthly payment does. Additive and idempotent: a student
    already holding a full cycle of upcoming classes gains nothing, so a re-run
    or a duplicate webhook cannot over-enrol them.
    """
    rows = upcoming(await sessions(series_id))
    held = sum(1 for b in rows if student_id in b.student_ids)
    touched = []
    for b in rows:
        if held >= SESSIONS_PER_CYCLE:
            break
        if student_id in b.student_ids:
            continue
        b.student_ids.append(student_id)
        if student_id in b.pending_ids:
            b.pending_ids.remove(student_id)
        b.touch()
        await b.save()
        held += 1
        touched.append(b)
    return touched


async def remove(series_id: str, student_id: str) -> list[Batch]:
    """Take the student off the course from here on.

    Only upcoming sittings are touched: a past one is attendance history and
    must keep the roster it was taught with.
    """
    touched = []
    for b in upcoming(await sessions(series_id)):
        if student_id not in b.student_ids and student_id not in b.pending_ids:
            continue
        if student_id in b.student_ids:
            b.student_ids.remove(student_id)
        if student_id in b.pending_ids:
            b.pending_ids.remove(student_id)
        b.touch()
        await b.save()
        touched.append(b)
    return touched


def enrolled_dates(rows: list[Batch], student_id: str) -> list[str]:
    """The upcoming class dates this student holds a seat for in the course."""
    return [session_date(b) for b in upcoming(rows) if student_id in b.student_ids]


async def extend(student_id: str) -> dict[str, int]:
    """Top every course the student holds a seat in back up to a full cycle.

    Called when a monthly fee settles: the classes it buys are the next
    :data:`SESSIONS_PER_CYCLE` upcoming sessions of each course they are already
    enrolled in — no fresh request, no second approval.

    Returns ``{series_id: sessions_added}`` for the ones that grew.
    """
    joined = await Batch.find({"is_archived": False, "student_ids": student_id,
                               "series_id": {"$ne": None}}).to_list()
    added: dict[str, int] = {}
    for series_id in {b.series_id for b in joined if b.series_id}:
        n = len(await top_up(series_id, student_id))
        if n:
            added[series_id] = n
    return added
