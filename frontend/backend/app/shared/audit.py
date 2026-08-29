"""Audit-log helper used by sensitive actions across modules."""
from typing import Optional

from app.db.models import ActivityLog


async def log_activity(
    actor: str,
    action: str,
    *,
    role: Optional[str] = None,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    ip: Optional[str] = None,
    meta: Optional[dict] = None,
) -> None:
    await ActivityLog(
        actor=actor,
        role=role,
        action=action,
        target_type=target_type,
        target_id=target_id,
        ip=ip,
        meta=meta or {},
    ).insert()
