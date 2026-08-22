"""One-off cleanup: void attendance submitted for classes that had not happened yet.

Until the slot-ended guard was added to ``POST /teacher/attendance``, attendance
could be submitted (and approved) for a future class date. Every downstream effect
then fired early: teacher remuneration was credited, student review requests were
raised, and the batch showed as "Past"/"Completed" for both the teacher and the
students — locking the meet link and batch chat for a class still to come.

For each live attendance row dated in the future (IST):
  * the attendance is marked ``rejected`` — the same state an admin rejection
    produces, so it drops out of ``attendance_submitted_dates`` and the batch
    returns to Upcoming, while the row stays visible in the admin history
  * remuneration and review requests created from it are deleted (neither is
    filtered by ``is_archived``, so archiving would leave them in earnings/reviews)
  * the class date is removed from ``Batch.cost_credited_dates`` so the scheduler
    can credit it normally once the date actually passes

Idempotent — rejected rows are skipped. Usage:
    python -m app.db.fix_future_attendance --dry-run     # report only
    python -m app.db.fix_future_attendance               # apply
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone

from app.db.models import Attendance, Batch, Remuneration, TeacherReview
from app.db.mongo import close_db, init_db
from app.shared.audit import log_activity

IST = timezone(timedelta(hours=5, minutes=30))  # matches the teacher router


async def fix(dry: bool) -> None:
    await init_db()
    tag = "[dry-run] " if dry else ""
    today = datetime.now(IST).strftime("%Y-%m-%d")

    rows = await Attendance.find({
        "is_archived": False,
        "status": {"$in": ["pending", "approved"]},
        "date": {"$gt": today},
    }).to_list()
    print(f"{tag}today (IST) is {today}: {len(rows)} attendance row(s) dated in the future")

    voided = rem_deleted = rev_deleted = 0
    rem_paise = 0
    for att in rows:
        att_id = str(att.id)
        batch = await Batch.get(att.batch_id)
        rems = await Remuneration.find(Remuneration.attendance_id == att_id).to_list()
        revs = await TeacherReview.find(TeacherReview.attendance_id == att_id).to_list()
        print(
            f"{tag}  {att.date} {att.status} attendance={att_id} "
            f"batch={att.batch_id} ({batch.title if batch else 'missing batch'}) "
            f"present={len(att.present_ids)} absent={len(att.absent_ids)} "
            f"-> remuneration={len(rems)} ({sum(r.amount for r in rems) / 100:g} INR) reviews={len(revs)}"
        )

        voided += 1
        rem_deleted += len(rems)
        rev_deleted += len(revs)
        rem_paise += sum(r.amount for r in rems)
        if dry:
            continue

        for r in rems:
            await r.delete()
        for r in revs:
            await r.delete()
        att.status = "rejected"
        att.approved = False
        att.reviewed_by = "cleanup"
        await att.save()
        if batch and att.date in (batch.cost_credited_dates or []):
            batch.cost_credited_dates = [d for d in batch.cost_credited_dates if d != att.date]
            await batch.save()
        await log_activity(
            "cleanup", "attendance.void", role="super_admin",
            target_type="batch", target_id=att.batch_id,
            meta={"attendance_id": att_id, "date": att.date,
                  "reason": "submitted before the class took place",
                  "remuneration_deleted": len(rems), "reviews_deleted": len(revs)},
        )

    print(f"{tag}attendance voided: {voided}")
    print(f"{tag}remuneration deleted: {rem_deleted} ({rem_paise / 100:g} INR)")
    print(f"{tag}review requests deleted: {rev_deleted}")
    await close_db()


if __name__ == "__main__":
    asyncio.run(fix(dry="--dry-run" in sys.argv))
