"""Rate-limit dependency backed by the cache (Redis or in-memory)."""
from fastapi import Depends, Request

from app.core.cache import cache
from app.core.exceptions import RateLimitError
from app.core.rbac import CurrentUser, get_current_user


def _client_id(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(scope: str, per_minute: int):
    """Fixed-window limiter keyed by client IP + scope."""

    async def _dep(request: Request):
        key = f"rl:{scope}:{_client_id(request)}"
        count = await cache.incr_window(key, window=60)
        if count > per_minute:
            raise RateLimitError(f"Too many requests. Limit {per_minute}/min for {scope}.")

    return _dep
