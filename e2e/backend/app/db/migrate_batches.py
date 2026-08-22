"""One-time migration: move the old batch shapes onto the parent/sub-batch model.

Old data came in two shapes, both keyed on a single ``Batch`` document:
  * unified batch  — one Batch with a ``class_dates`` list of every session
  * legacy per-date — one Batch per class date, grouped only by name+teacher+slot

Target: a parent ``BatchSeries`` (course) + one independent ``Batch`` (sub-batch)
per class date, with ``series_id`` linking them. The sub-batch id is the batch id
for every student/teacher action and all analytics.

Idempotent — batches that already have ``series_id`` are skipped, so it is safe to
re-run. Usage:
    python -m app.db.migrate_batches --dry-run     # report only
    python -m app.db.migrate_batches               # apply
"""
import asyncio
import sys
from datetime import date

from app.db.models import (
    Attendance,
    Batch,
    BatchMessage,
    BatchSeries,
    TeacherReview,
)
from app.db.mongo import close_db, init_db

# Fields copied from a unified batch onto each generated sub-batch. The sub-batch
# owns them independently thereafter (no inheritance from the parent series).
_COPY_FIELDS = (
    "teacher_id", "title", "class_time", "slot_start", "slot_end",
    "schedule", "meeting_url", "teacher_cost_paise", "student_ids", "pending_ids",
)


def _infer_frequency(dates: list[str]) -> str:
    """Best-effort cadence label from the spacing of the first two dates."""
    if len(dates) < 2:
        return "custom"
    try:
        gap = (date.fromisoformat(dates[1]) - date.fromisoformat(dates[0])).days
    except ValueError:
        return "custom"
    if gap == 1:
        return "daily"
    if gap == 7:
        return "weekly"
    if 27 <= gap <= 31:
        return "monthly"
    return "custom"


def _group_key(b: Batch) -> str:
    """Legacy per-date rows group by name + teacher + slot (the old admin heuristic)."""
    return f"{b.title.strip().lower()}|{b.teacher_id}|{b.slot_start or ''}|{b.slot_end or ''}"


async def _repoint(model, old_id: str, date_to_child: dict[str, str],
                   fallback_child: str, date_attr: str, dry: bool) -> int:
    """Re-point a model's ``batch_id`` from the old unified batch to the child
    sub-batch that owns that date (fallback: earliest child)."""
    moved = 0
    for doc in await model.find(model.batch_id == old_id).to_list():
        d = getattr(doc, date_attr, None)
        target = date_to_child.get(d, fallback_child)
        if doc.batch_id == target:
            continue
        moved += 1
        if not dry:
            doc.batch_id = target
            await doc.save()
    return moved


async def migrate(dry: bool) -> None:
    await init_db()
    tag = "[dry-run] " if dry else ""
    batches = await Batch.find(
        Batch.is_archived == False,  # noqa: E712
        {"$or": [{"series_id": None}, {"series_id": {"$exists": False}}]},
    ).to_list()
    unified = [b for b in batches if b.class_dates]
    legacy = [b for b in batches if not b.class_dates]
    print(f"{tag}{len(batches)} un-migrated batches: {len(unified)} unified, {len(legacy)} legacy per-date")

    series_created = subs_created = att_moved = rev_moved = msg_moved = archived = 0

    # 1) Unified batch → its own series + one sub-batch per date.
    for b in unified:
        dates = sorted(set(b.class_dates))
        series = BatchSeries(
            title=b.title, frequency=_infer_frequency(dates),
            start_date=dates[0], end_date=dates[-1], schedule=b.schedule,
        )
        if not dry:
            await series.insert()
        series_created += 1
        date_to_child: dict[str, str] = {}
        child_ids: list[str] = []
        for d in dates:
            common = {f: getattr(b, f) for f in _COPY_FIELDS}
            child = Batch(**common, series_id=str(series.id) if not dry else "dry",
                          class_dates=[], date=d, day_of_week=None)
            if not dry:
                await child.insert()
            subs_created += 1
            cid = str(child.id) if not dry else f"dry-{d}"
            date_to_child[d] = cid
            child_ids.append(cid)
        fallback = child_ids[0]
        att_moved += await _repoint(Attendance, str(b.id), date_to_child, fallback, "date", dry)
        rev_moved += await _repoint(TeacherReview, str(b.id), date_to_child, fallback, "class_date", dry)
        # Old course chat has no per-date key → keep history on the first session.
        for m in await BatchMessage.find(BatchMessage.batch_id == str(b.id)).to_list():
            msg_moved += 1
            if not dry:
                m.batch_id = fallback
                await m.save()
        archived += 1
        if not dry:
            b.class_dates = []
            b.archive("migration", "split into parent/sub-batches")
            await b.save()

    # 2) Legacy per-date batches → one series per name+teacher+slot group, linked in place.
    groups: dict[str, list[Batch]] = {}
    for b in legacy:
        groups.setdefault(_group_key(b), []).append(b)
    for group in groups.values():
        dts = sorted({b.date for b in group if b.date}) or [""]
        series = BatchSeries(
            title=group[0].title, frequency="custom",
            start_date=dts[0], end_date=dts[-1], schedule=group[0].schedule,
        )
        if not dry:
            await series.insert()
        series_created += 1
        for b in group:
            subs_created += 1  # existing rows become sub-batches in place
            if not dry:
                b.series_id = str(series.id)
                b.touch()
                await b.save()

    print(f"{tag}series created: {series_created}")
    print(f"{tag}sub-batches (new + linked): {subs_created}")
    print(f"{tag}attendance re-pointed: {att_moved}, reviews: {rev_moved}, chat msgs: {msg_moved}")
    print(f"{tag}unified batches archived: {archived}")
    await close_db()


if __name__ == "__main__":
    asyncio.run(migrate(dry="--dry-run" in sys.argv))
