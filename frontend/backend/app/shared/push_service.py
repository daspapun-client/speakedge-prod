"""Web Push delivery — optional; skipped when VAPID keys are not configured."""
import json
import logging

from pywebpush import WebPushException, webpush

from app.core.config import settings
from app.db.models import PushSubscription

log = logging.getLogger("speakedge.push")


def configured() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def public_key() -> str | None:
    return settings.VAPID_PUBLIC_KEY or None


async def send_to_user(user_id: str, title: str, body: str, url: str | None = None) -> None:
    """Fire a Web Push to every active subscription for this user."""
    if not configured():
        return
    subs = await PushSubscription.find(
        PushSubscription.user_id == user_id,
        PushSubscription.is_archived == False,  # noqa: E712
    ).to_list()
    if not subs:
        return

    # Strip machine-readable footer from the visible push body.
    visible = body.split("\n\nView chat:")[0].strip()
    payload = json.dumps({"title": title, "body": visible, "url": url or "/dashboard/notifications"})

    dead: list[PushSubscription] = []
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CONTACT},
            )
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                dead.append(sub)
            else:
                log.warning("Push failed for %s: %s", user_id, e)
        except Exception as e:  # pragma: no cover
            log.warning("Push error for %s: %s", user_id, e)

    for sub in dead:
        sub.archive(user_id, "push subscription expired")
        await sub.save()
