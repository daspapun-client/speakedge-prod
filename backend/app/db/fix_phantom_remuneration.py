"""Retrofit: withdraw teacher pay credited for classes that were never taken.

The scheduler job ``credit_completed_batches`` used to credit
``Batch.teacher_cost_paise`` the moment a class date passed — with no check that
attendance was ever submitted. A teacher who was merely *assigned* a batch
therefore showed earnings (and Admin -> Teacher Payouts showed an amount to pay)
for classes nobody held. Those rows are recognisable: a dated ``Remuneration``
with no ``attendance_id``. Every row credited since carries one.

For each such row:
  * if the teacher has an approved, held attendance on that date that has no pay
    of its own yet, the row is real money for a real class — it is **linked** to
    that attendance and kept
  * otherwise it is a phantom. A ``pending`` one is **archived** (restorable from
    Admin -> Archive, purged after the usual retention); one already marked
    ``paid``/``received`` is only reported — money has moved, so a person decides

``Batch.cost_credited_dates`` is then reset to the dates that really have an
approved, held attendance (or a row already paid, which stays credited), so a
class is credited normally once it is taken.

Idempotent, so the scheduler runs it on every boot (``void_phantom_remuneration``)
and existing data is corrected on deploy with no shell step. By hand:
    python -m app.db.fix_phantom_remuneration --dry-run     # report only
    python -m app.db.fix_phantom_remuneration               # apply
"""
import asyncio
import logging
import sys

from app.db.models import Attendance, Batch, Remuneration, Teacher
from app.shared.audit import log_activity

log = logging.getLogger("speakedge.retrofit")

REASON = "credited without any attendance"


async def void_phantom_remuneration(dry: bool = False) -> dict:
    tag = "[dry-run] " if dry else ""
    held = [a for a in await Attendance.find(
        {"status": "approved", "is_archived": False}).to_list() if a.class_held]
    all_rems = await Remuneration.find({"is_archived": False}).to_list()
    paid_for = {r.attendance_id for r in all_rems if r.attendance_id}
    # Held classes still waiting for pay, by (teacher, date).
    unpaid: dict[tuple[str | None, str], list[Attendance]] = {}
    for a in held:
        if str(a.id) not in paid_for:
            unpaid.setdefault((a.teacher_id, a.date), []).append(a)

    orphans = [r for r in all_rems if not r.attendance_id and len(r.period or "") == 10]
    tnames = {str(t.id): t.name for t in await Teacher.find().to_list()} if orphans else {}

    out = {"linked": 0, "voided": 0, "voided_paise": 0, "settled": 0, "settled_paise": 0,
           "batches_reset": 0}
    settled_dates: set[tuple[str | None, str]] = set()
    for r in sorted(orphans, key=lambda x: (x.teacher_id, x.period)):
        who = f"{tnames.get(r.teacher_id, r.teacher_id)} {r.period} {r.amount / 100:g} INR {r.status}"
        match = unpaid.get((r.teacher_id, r.period))
        if match:
            att = match.pop(0)
            out["linked"] += 1
            log.info("%skeep    %s -> attendance %s", tag, who, att.id)
            if not dry:
                r.attendance_id = str(att.id)
                await r.save()
        elif r.status == "pending":
            out["voided"] += 1
            out["voided_paise"] += r.amount
            log.info("%svoid    %s (no class taken)", tag, who)
            if not dry:
                r.archive("system", REASON)
                await r.save()
                await log_activity(
                    "system", "remuneration.void", role="super_admin",
                    target_type="teacher", target_id=r.teacher_id,
                    meta={"remuneration_id": str(r.id), "period": r.period,
                          "amount_paise": r.amount, "reason": REASON},
                )
        else:
            out["settled"] += 1
            out["settled_paise"] += r.amount
            settled_dates.add((r.teacher_id, r.period))
            log.warning("%sREVIEW  %s (no class taken, but already %s — left alone)",
                        tag, who, r.status)

    held_dates: dict[str, set[str]] = {}
    for a in held:
        held_dates.setdefault(a.batch_id, set()).add(a.date)
    for b in await Batch.find({"cost_credited_dates": {"$ne": []}}).to_list():
        # A date whose row was already paid stays credited, or attendance filed
        # for it later would pay the same class twice.
        keep = sorted(d for d in b.cost_credited_dates
                      if d in held_dates.get(str(b.id), set())
                      or (b.teacher_id, d) in settled_dates)
        if keep != sorted(b.cost_credited_dates):
            out["batches_reset"] += 1
            if not dry:
                b.cost_credited_dates = keep
                await b.save()
    return out


async def _main(dry: bool) -> None:
    from app.db.mongo import close_db, init_db

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    await init_db()
    out = await void_phantom_remuneration(dry)
    tag = "[dry-run] " if dry else ""
    print(f"{tag}linked to a real class: {out['linked']}")
    print(f"{tag}phantom rows archived: {out['voided']} ({out['voided_paise'] / 100:g} INR)")
    print(f"{tag}phantom rows already paid, need a decision: {out['settled']} "
          f"({out['settled_paise'] / 100:g} INR)")
    print(f"{tag}batches with credited dates reset: {out['batches_reset']}")
    await close_db()


if __name__ == "__main__":
    asyncio.run(_main(dry="--dry-run" in sys.argv))
