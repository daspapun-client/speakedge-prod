"""Out-of-band password reset — the escape hatch when nobody can log in.

Every in-app way to set a password needs somebody already signed in: the admin
panel needs an admin, `/auth/change-password` needs the old password, and the
emailed reset link needs both a working mailbox on the account and SMTP wired
up. When the last admin's password is lost (or an account has no email), that
is a hard lockout with no way back in — `python -m app.db.seed` will not help,
because its super-admin block is `if not await User.find_one(...)` and so is a
no-op on an account that already exists.

This is the way back. It needs shell access to the server, which is the only
credential it checks.

Usage:
    python -m app.db.reset_password admin@speakedge.in 'New@Password1'
    python -m app.db.reset_password SPK-26-nWtaAw        # generates one, prints it
    python -m app.db.reset_password --list               # every admin account

Accepts a staff username, an email or a student id (the same three the login
form takes). The change is written to the activity log as actor `cli` so it
shows up in Admin -> Activity Logs like any other reset.
"""
import asyncio
import secrets
import sys

from app.core.security import MIN_PASSWORD_LENGTH, Role, hash_password
from app.db.models import User
from app.db.mongo import close_db, init_db
from app.shared.audit import log_activity


async def _find(handle: str) -> User | None:
    """Same resolution order as the login form, plus student id."""
    handle = handle.strip()
    return await User.find_one({"$or": [
        {"username": handle}, {"email": handle}, {"student_id": handle},
    ]})


async def list_admins() -> None:
    admins = await User.find({"role": {"$in": [Role.super_admin.value, Role.admin.value]}}).to_list()
    if not admins:
        print("No admin accounts exist. Run: python -m app.db.seed")
        return
    print(f"{'username':<32} {'role':<12} {'active':<7} {'archived':<9} last login")
    for u in admins:
        print(f"{u.username:<32} {u.role.value:<12} {str(u.is_active):<7} "
              f"{str(u.is_archived):<9} {u.last_login_at or '-'}")


async def reset(handle: str, password: str | None) -> int:
    user = await _find(handle)
    if not user:
        print(f"No user matches {handle!r} (tried username, email and student id).")
        print("Run with --list to see the admin accounts.")
        return 1

    generated = password is None
    if generated:
        # url-safe, ~16 chars: long enough that it never trips the floor and
        # never needs to be guessed at, since it is printed below.
        password = secrets.token_urlsafe(12)
    elif len(password) < MIN_PASSWORD_LENGTH:
        print(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
        return 1

    user.password_hash = hash_password(password)
    await user.save()
    await log_activity("cli", "user.reset_password", role="super_admin",
                       target_type="user", target_id=user.username,
                       meta={"via": "app.db.reset_password"})

    print(f"Password reset for {user.username} (role={user.role.value}, "
          f"active={user.is_active}, archived={user.is_archived})")
    if generated:
        print(f"New password: {password}")
    if not user.is_active:
        print("NOTE: the account is blocked — login stays 401 until it is unblocked.")
    if user.is_archived:
        print("NOTE: the account is archived — find_login_user skips it, so login stays 401.")
    return 0


async def main() -> int:
    args = [a for a in sys.argv[1:] if a]
    if not args or args[0] in {"-h", "--help"}:
        print(__doc__)
        return 0
    await init_db()
    try:
        if args[0] == "--list":
            await list_admins()
            return 0
        return await reset(args[0], args[1] if len(args) > 1 else None)
    finally:
        await close_db()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
