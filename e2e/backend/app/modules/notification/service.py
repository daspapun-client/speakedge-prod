from datetime import datetime
from typing import Optional

from app.core.security import Role
from app.db.models import Notification
from app.shared import push_service

# Group recipients an admin can target (Module 14: promotional notices to
# All Users / groups / teachers / partners). "admins" reaches every admin +
# super-admin so staff-facing events (teacher/batch activity) land in their bell.
GROUP_RECIPIENTS = {"*", "admins", "students", "teachers", "partners", "examiners"}

ROLE_GROUP = {
    Role.super_admin: "admins",
    Role.admin: "admins",
    Role.student: "students",
    Role.teacher: "teachers",
    Role.partner: "partners",
    Role.examiner: "examiners",
}


def recipients_for(subject: str, role: Role) -> list[str]:
    """All recipient keys whose notifications this user should see."""
    keys = [subject, "*"]
    group = ROLE_GROUP.get(role)
    if group:
        keys.append(group)
    return keys


async def notify(recipient: str, title: str, body: str, kind: str = "info",
                 scheduled_for: Optional[datetime] = None,
                 push_url: str | None = None) -> Notification:
    n = Notification(
        recipient=recipient, title=title, body=body, kind=kind,
        scheduled_for=scheduled_for, sent=scheduled_for is None,
    )
    await n.insert()
    if scheduled_for is None and recipient not in GROUP_RECIPIENTS:
        await push_service.send_to_user(recipient, title, body, push_url)
    return n


async def notify_all(recipients: list[str | None], title: str, body: str,
                     kind: str = "info", scheduled_for: Optional[datetime] = None,
                     push_url: str | None = None) -> list[Notification]:
    """Fan a single event out to several recipients at once (blanks and
    duplicates are skipped). Used to notify every party to an action —
    e.g. the student, the batch teacher and the ``admins`` group together."""
    seen: set[str] = set()
    out: list[Notification] = []
    for r in recipients:
        if not r or r in seen:
            continue
        seen.add(r)
        out.append(await notify(r, title, body, kind, scheduled_for, push_url))
    return out
