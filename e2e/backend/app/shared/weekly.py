"""Weekly recurring slots — the one implementation of "repeats every week".

Admin sets a slot as a **weekday + a start time** — "Sunday – 11:00 AM" — and it
repeats every week on that day and time until it is changed or removed. That
recurring rule is a small document of its own; the rows the rest of the product
works on are ordinary dated occurrences generated from it over a rolling
horizon:

    rule (sunday 11:00)  ->  occurrence (13 Sep 11:00)   <- students land here
                             occurrence (20 Sep 11:00)
                             occurrence (27 Sep 11:00)   ... horizon_weeks

Keeping the occurrence a real dated document is what lets everything downstream
go on working unchanged — bookings, rosters, reminders and reports never need to
know a row came from a rule.

Two modules schedule this way (exam slots and orientation sessions) and the
rules below are easy to get subtly wrong, so they live here once:

- **An occurrence in use is never touched.** What "in use" means is the caller's
  business — a booked seat, an enrolled roster — but a rule edit only ever
  re-cuts the *free* future occurrences.
- **A cancelled occurrence stays cancelled.** Archived dates count as taken when
  generating, so a single sitting called off by hand does not reappear on the
  next scheduler pass.
- **A rebuild deletes rather than archives.** The free future rows are generated
  placeholders being replaced, and an archived row at the same time would block
  its own replacement.

An occurrence model must subclass ``AuditedDocument`` and carry ``scheduled_at``
(the dated instant) and ``rule_id`` (the rule it came from). A rule needs an
``id``, a ``day_of_week`` and a ``time_of_day``.
"""
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Protocol, Sequence

from app.core.exceptions import ValidationAppError

# Recurring schedules are IST — the product is India-only, and this matches the
# Batch / SpeakingTeam class-schedule convention.
IST = timezone(timedelta(hours=5, minutes=30))
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
# How far ahead rules are materialised. Long enough that there is always
# something to sign up for, short enough that an edit re-cuts only a handful.
DEFAULT_HORIZON_WEEKS = 8
# Generated occurrences nobody used are tidied away once this far past.
DEFAULT_GRACE_DAYS = 7


class WeeklyRule(Protocol):
    """The shape a recurring rule has to have: a weekday and a start time."""
    id: object
    day_of_week: str
    time_of_day: str


# ---------------------------------------------------------------------------
# Instants
# ---------------------------------------------------------------------------
def to_utc(dt: datetime | None) -> datetime | None:
    """Make the instant explicit — Mongo hands datetimes back naive-UTC."""
    if dt is None:
        return None
    return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def to_naive_utc(dt: datetime | None) -> datetime | None:
    """Naive-UTC, so an in-memory aware value compares with a stored one."""
    dt = to_utc(dt)
    return dt.replace(tzinfo=None) if dt else None


def to_ist(dt: datetime | None) -> datetime | None:
    """The wall clock a learner in India reads — what notifications must say."""
    dt = to_utc(dt)
    return dt.astimezone(IST) if dt else None


def now_naive_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Weekday + time
# ---------------------------------------------------------------------------
def parse_day(day: str) -> str:
    day = (day or "").strip().lower()
    if day not in WEEKDAYS:
        raise ValidationAppError("Slot day must be a weekday name, e.g. 'Sunday'")
    return day


def parse_time(time_str: str) -> str:
    """Validate an "HH:MM" 24h start time and normalise it to two digits."""
    try:
        hh, mm = (int(x) for x in (time_str or "").strip().split(":"))
        if not (0 <= hh < 24 and 0 <= mm < 60):
            raise ValueError
    except (ValueError, TypeError):
        raise ValidationAppError("Slot time must be in HH:MM format, e.g. '11:00'")
    return f"{hh:02d}:{mm:02d}"


def label(day: str, time_str: str) -> str:
    """"Sunday – 11:00 AM", the way the spec writes a weekly slot."""
    hh, mm = (int(x) for x in time_str.split(":"))
    suffix = "AM" if hh < 12 else "PM"
    return f"{day.capitalize()} – {hh % 12 or 12}:{mm:02d} {suffix}"


def rule_label(rule: WeeklyRule) -> str:
    return label(rule.day_of_week, rule.time_of_day)


def occurrences(rule: WeeklyRule, *, weeks: int = DEFAULT_HORIZON_WEEKS,
                now: datetime | None = None) -> list[datetime]:
    """Every occurrence of the weekly rule from now out to the horizon (UTC)."""
    now = to_ist(now) or datetime.now(IST)
    hh, mm = (int(x) for x in rule.time_of_day.split(":"))
    ahead = (WEEKDAYS.index(rule.day_of_week) - now.weekday()) % 7
    first = (now + timedelta(days=ahead)).replace(hour=hh, minute=mm, second=0, microsecond=0)
    if first < now:  # today's slot has already started — start from next week
        first += timedelta(days=7)
    return [(first + timedelta(weeks=i)).astimezone(timezone.utc) for i in range(weeks)]


# ---------------------------------------------------------------------------
# Rule -> dated occurrences
# ---------------------------------------------------------------------------
class WeeklySchedule:
    """Materialises weekly rules into dated occurrence documents.

    ``build(rule, when)`` returns an unsaved occurrence for that instant.
    ``in_use(occurrences)`` returns the ids that must never be moved or
    withdrawn — the seats somebody booked, the sessions somebody joined.
    """

    def __init__(self, doc_cls, *, build: Callable[[WeeklyRule, datetime], object],
                 in_use: Callable[[Sequence], Awaitable[set[str]]],
                 horizon_weeks: int = DEFAULT_HORIZON_WEEKS,
                 grace_days: int = DEFAULT_GRACE_DAYS,
                 purge_reason: str = "Weekly slot expired unused"):
        self.doc_cls = doc_cls
        self.build = build
        self.in_use = in_use
        self.horizon_weeks = horizon_weeks
        self.grace_days = grace_days
        self.purge_reason = purge_reason

    async def _of_rule(self, rule: WeeklyRule, *, include_archived: bool = False) -> list:
        query: dict = {"rule_id": str(rule.id)}
        if not include_archived:
            query["is_archived"] = False
        return await self.doc_cls.find(query).to_list()

    async def _free_future(self, rule: WeeklyRule) -> tuple[list, int]:
        """The rule's upcoming occurrences nobody is using, and how many are."""
        now = now_naive_utc()
        future = [d for d in await self._of_rule(rule)
                  if (to_naive_utc(d.scheduled_at) or now) >= now]
        used = await self.in_use(future)
        return [d for d in future if str(d.id) not in used], len(used)

    async def generate(self, rule: WeeklyRule) -> int:
        """Top the rule's occurrences up to the horizon. Idempotent.

        Archived dates count as taken: a single sitting cancelled by hand must
        stay cancelled, not reappear on the next pass."""
        existing = {to_naive_utc(d.scheduled_at)
                    for d in await self._of_rule(rule, include_archived=True)}
        created = 0
        for when in occurrences(rule, weeks=self.horizon_weeks):
            if to_naive_utc(when) in existing:
                continue
            await self.build(rule, when).insert()
            created += 1
        return created

    async def rebuild(self, rule: WeeklyRule) -> tuple[int, int, int]:
        """Re-cut the rule's free future occurrences from its current definition.

        These are deleted outright rather than archived: they are generated
        placeholders being replaced, and an archived row at the same time would
        block its own replacement.

        Returns ``(created, dropped, kept)`` — kept being the occurrences left
        standing because somebody is already using them."""
        free, kept = await self._free_future(rule)
        for doc in free:
            await doc.delete()
        return await self.generate(rule), len(free), kept

    async def drop_future(self, rule: WeeklyRule, by: str,
                          reason: str | None = None) -> tuple[int, int]:
        """Archive the rule's free future occurrences — the rule is being
        retired, so the withdrawal is worth a trace.

        Returns ``(dropped, kept)``."""
        free, kept = await self._free_future(rule)
        for doc in free:
            doc.archive(by, reason)
            await doc.save()
        return len(free), kept

    async def purge_past(self) -> int:
        """Archive generated occurrences that came and went unused."""
        cutoff = now_naive_utc() - timedelta(days=self.grace_days)
        stale = await self.doc_cls.find({
            "rule_id": {"$ne": None}, "is_archived": False,
            "scheduled_at": {"$lt": cutoff},
        }).to_list()
        used = await self.in_use(stale)
        purged = 0
        for doc in stale:
            if str(doc.id) in used:
                continue
            doc.archive("system", self.purge_reason)
            await doc.save()
            purged += 1
        return purged

    async def sync(self, rules: Sequence[WeeklyRule]) -> dict:
        """Scheduler pass: roll every rule's horizon forward, tidy up behind it."""
        created = sum([await self.generate(rule) for rule in rules])
        return {"rules": len(rules), "created": created, "purged": await self.purge_past()}
