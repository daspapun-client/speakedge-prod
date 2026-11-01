"""One-off cleanup: remove teacher pay credited for classes that were never taken.

The scheduler job ``credit_completed_batches`` used to credit
``Batch.teacher_cost_paise`` the moment a class date passed — with no check that
attendance was ever submitted. A teacher who was merely *assigned* a batch
therefore showed earnings (and Admin -> Teacher Payouts showed an amount to pay)
for classes nobody held. Those rows are recognisable: a dated ``Remuneration``
with no ``attendance_id``.

For each such row:
  * if the teacher has an approved, held attendance on that date that has no pay
    of its own yet, the row is real money for a real class — it is **linked** to
    that attendance and kept
  * otherwise it is a phantom. A ``pending`` one is deleted; one already marked
    ``paid``/``received`` is only reported — money has moved, so a person decides

``Batch.cost_credited_dates`` is then reset to the dates that really have an
approved, held attendance (or a row already paid, which stays credited), so a
class is credited normally once it is taken.

Idempotent. Usage:
    python -m app.db.fix_phantom_remuneration --dry-run     # report only
    python -m app.db.fix_phantom_remuneration               # apply
"""
import asyncio
import sys

from app.db.models import Attendance, Batch, Remuneration, Teacher
from app.db.mongo import close_db, init_db
from app.shared.audit import log_activity


async def fix(dry: bool) -> None:
    await init_db()
    tag = "[dry-run] " if dry else ""

    held = [a for a in await Attendance.find(
        {"status": "approved", "is_archived": False}).to_list() if a.class_held]
    all_rems = await Remuneration.find().to_list()
    paid_for = {r.attendance_id for r in all_rems if r.attendance_id}
    # Held classes still waiting for pay, by (teacher, date).
    unpaid: dict[tuple[str | None, str], list[Attendance]] = {}
    for a in held:
        if str(a.id) not in paid_for:
            unpaid.setdefault((a.teacher_id, a.date), []).append(a)

    tnames = {str(t.id): t.name for t in await Teacher.find().to_list()}
    orphans = [r for r in all_rems if not r.attendance_id and len(r.period or "") == 10]
    print(f"{tag}{len(orphans)} dated remuneration row(s) with no attendance behind them")

    linked = deleted = settled = 0
    deleted_paise = settled_paise = 0
    settled_dates: set[tuple[str | None, str]] = set()
    for r in sorted(orphans, key=lambda x: (x.teacher_id, x.period)):
        who = f"{tnames.get(r.teacher_id, r.teacher_id)} {r.period} {r.amount / 100:g} INR {r.status}"
        match = unpaid.get((r.teacher_id, r.period))
        if match:
            att = match.pop(0)
            linked += 1
            print(f"{tag}  keep    {who} -> attendance {att.id}")
            if not dry:
                r.attendance_id = str(att.id)
                await r.save()
        elif r.status == "pending":
            deleted += 1
            deleted_paise += r.amount
            print(f"{tag}  delete  {who} (no class taken)")
            if not dry:
                await r.delete()
                await log_activity(
                    "cleanup", "remuneration.void", role="super_admin",
                    target_type="teacher", target_id=r.teacher_id,
                    meta={"period": r.period, "amount_paise": r.amount,
                          "reason": "credited without any attendance"},
                )
        else:
            settled += 1
            settled_paise += r.amount
            settled_dates.add((r.teacher_id, r.period))
            print(f"{tag}  REVIEW  {who} (no class taken, but already {r.status} — left alone)")

    held_dates: dict[str, set[str]] = {}
    for a in held:
        held_dates.setdefault(a.batch_id, set()).add(a.date)
    reset = 0
    for b in await Batch.find({"cost_credited_dates": {"$ne": []}}).to_list():
        # A date whose row was already paid stays credited, or attendance filed
        # for it later would pay the same class twice.
        keep = sorted(d for d in b.cost_credited_dates
                      if d in held_dates.get(str(b.id), set())
                      or (b.teacher_id, d) in settled_dates)
        if keep != sorted(b.cost_credited_dates):
            reset += 1
            if not dry:
                b.cost_credited_dates = keep
                await b.save()

    print(f"{tag}linked to a real class: {linked}")
    print(f"{tag}phantom rows deleted: {deleted} ({deleted_paise / 100:g} INR)")
    print(f"{tag}phantom rows already paid, need a decision: {settled} ({settled_paise / 100:g} INR)")
    print(f"{tag}batches with credited dates reset: {reset}")
    await close_db()


if __name__ == "__main__":
    asyncio.run(fix(dry="--dry-run" in sys.argv))
