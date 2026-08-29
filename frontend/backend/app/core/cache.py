"""Cache + rate-limit backend. Uses Redis when REDIS_URL is set & reachable,
otherwise transparently falls back to an in-process store so the app runs
locally with no Redis installed. Redis is the path that scales to 1000 users
across multiple Gunicorn workers/instances."""
import asyncio
import time
from typing import Optional

from app.core.config import settings

try:  # optional dependency
    from redis import asyncio as aioredis  # type: ignore
except Exception:  # pragma: no cover
    aioredis = None


class _InMemory:
    """Process-local fallback (fine for single-worker local dev)."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, str]] = {}
        self._counters: dict[str, tuple[int, float]] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> Optional[str]:
        item = self._store.get(key)
        if not item:
            return None
        exp, val = item
        if exp and exp < time.time():
            self._store.pop(key, None)
            return None
        return val

    async def set(self, key: str, value: str, ttl: int = 0) -> None:
        exp = time.time() + ttl if ttl else 0
        self._store[key] = (exp, value)

    async def delete(self, key: str) -> None:
        self._store.pop(key, None)

    async def incr_window(self, key: str, window: int) -> int:
        async with self._lock:
            now = time.time()
            count, exp = self._counters.get(key, (0, now + window))
            if exp < now:
                count, exp = 0, now + window
            count += 1
            self._counters[key] = (count, exp)
            return count


class Cache:
    def __init__(self) -> None:
        self._redis = None
        self._mem = _InMemory()
        self.backend = "memory"

    async def connect(self) -> None:
        if settings.REDIS_URL and aioredis is not None:
            try:
                self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
                await self._redis.ping()
                self.backend = "redis"
            except Exception:
                self._redis = None
                self.backend = "memory"

    async def close(self) -> None:
        if self._redis:
            await self._redis.aclose()

    async def get(self, key: str) -> Optional[str]:
        if self._redis:
            return await self._redis.get(key)
        return await self._mem.get(key)

    async def set(self, key: str, value: str, ttl: int = 0) -> None:
        if self._redis:
            await self._redis.set(key, value, ex=ttl or None)
        else:
            await self._mem.set(key, value, ttl)

    async def delete(self, key: str) -> None:
        if self._redis:
            await self._redis.delete(key)
        else:
            await self._mem.delete(key)

    async def incr_window(self, key: str, window: int) -> int:
        """Increment a fixed-window counter, return the new count."""
        if self._redis:
            count = await self._redis.incr(key)
            if count == 1:
                await self._redis.expire(key, window)
            return count
        return await self._mem.incr_window(key, window)


cache = Cache()
