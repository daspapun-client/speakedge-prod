"""Activation code generation. Code becomes the permanent Student ID.
Format: SPK-26-XXXXXX (6 unambiguous alnum chars). DB unique index +
collision-retry guarantee uniqueness under bulk generation."""
import secrets
import uuid

from pymongo.errors import DuplicateKeyError

from app.db.models import ActivationCode, CodeStatus, PromptAudience

# Exclude ambiguous chars (0/O, 1/I/L)
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz"
_PREFIX = "SPK-26-"


def _random_code() -> str:
    return _PREFIX + "".join(secrets.choice(_ALPHABET) for _ in range(6))


async def generate_batch(
    count: int,
    created_by: str,
    audience: PromptAudience = PromptAudience.adults,
) -> dict:
    """Generate a batch of codes for one course. Kids and Adults are separate
    courses, so a batch is issued for exactly one of them."""
    if count not in (1, 100, 500, 1000, 5000) and not (1 <= count <= 5000):
        count = max(1, min(count, 5000))
    batch_id = uuid.uuid4().hex[:12]
    created: list[str] = []
    attempts = 0
    max_attempts = count * 5
    while len(created) < count and attempts < max_attempts:
        attempts += 1
        code = _random_code()
        try:
            await ActivationCode(code=code, status=CodeStatus.unused,
                                 batch_id=batch_id, audience=audience).insert()
            created.append(code)
        except DuplicateKeyError:
            continue  # collision: retry with a new code
    return {"batch_id": batch_id, "requested": count, "generated": len(created),
            "audience": audience.value, "codes": created}


async def set_audience(code: str, audience: PromptAudience) -> ActivationCode:
    """Move an unused code to the other course. Refused once it is activated —
    at that point the student's course is fixed and only an admin edit on the
    student record can change it."""
    from app.core.exceptions import ConflictError, NotFoundError

    ac = await ActivationCode.find_one(ActivationCode.code == code.strip())
    if not ac:
        raise NotFoundError("Activation code not found")
    if ac.status == CodeStatus.activated:
        raise ConflictError(
            "This code has already been activated — change the course on the student instead")
    ac.audience = audience
    await ac.save()
    return ac


async def get_valid_unused(code: str) -> ActivationCode:
    from app.core.exceptions import ConflictError, NotFoundError

    ac = await ActivationCode.find_one(ActivationCode.code == code.strip())
    if not ac:
        raise NotFoundError("Activation code not found")
    if ac.status == CodeStatus.blocked:
        raise ConflictError("This activation code is blocked")
    if ac.status == CodeStatus.activated:
        raise ConflictError("This activation code has already been used")
    # "reserved" = allocated to a paid book order awaiting delivery; the buyer
    # activates it once they receive the book, so it is valid for activation.
    return ac


async def mark_activated(ac: ActivationCode, student_id: str) -> None:
    from app.db.base import utcnow

    ac.status = CodeStatus.activated
    ac.activated_at = utcnow()
    ac.activated_student_id = student_id
    await ac.save()


async def set_status(code: str, status: CodeStatus, reason: str | None = None) -> ActivationCode:
    from app.core.exceptions import NotFoundError

    ac = await ActivationCode.find_one(ActivationCode.code == code.strip())
    if not ac:
        raise NotFoundError("Activation code not found")
    ac.status = status
    ac.blocked_reason = reason if status == CodeStatus.blocked else None
    await ac.save()
    return ac


_DELETABLE = {CodeStatus.unused, CodeStatus.blocked}


async def delete_code(code: str, actor: str, reason: str | None = None) -> ActivationCode:
    from app.core.exceptions import ConflictError, NotFoundError

    ac = await ActivationCode.find_one(
        ActivationCode.code == code.strip(), ActivationCode.is_archived == False  # noqa: E712
    )
    if not ac:
        raise NotFoundError("Activation code not found")
    if ac.status not in _DELETABLE:
        raise ConflictError("Only unused or blocked codes can be deleted")
    ac.archive(actor, reason or "deleted by admin")
    await ac.save()
    return ac


async def bulk_delete(codes: list[str], actor: str, reason: str | None = None) -> dict:
    from app.core.exceptions import AppError

    deleted: list[str] = []
    skipped: list[dict] = []
    for code in codes:
        try:
            await delete_code(code, actor, reason)
            deleted.append(code.strip())
        except AppError as exc:
            skipped.append({"code": code.strip(), "reason": exc.message})
    return {"deleted": len(deleted), "codes": deleted, "skipped": skipped}
