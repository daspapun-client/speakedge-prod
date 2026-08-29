"""Realtime hub for community chat — WebSocket fan-out that stays correct across
multiple Gunicorn workers / instances.

- No REDIS_URL: in-process fan-out + in-memory presence (single-worker dev).
- REDIS_URL set: every event is PUBLISHed to Redis and delivered by one pattern
  subscriber per process, so a message sent on worker A reaches sockets on worker
  B. Presence lives in a Redis sorted set scored by last-seen time, so a crashed
  worker's members expire (via TTL) instead of ghosting forever.

Ephemeral signals (typing, presence) never touch MongoDB — the WebSocket endpoint
persists only chat messages and read pointers. This module is pure transport.
"""
import asyncio
import json
import logging
from collections import Counter, defaultdict
from time import time

from fastapi import WebSocket

from app.core.config import settings

try:  # optional dependency, same as core/cache.py
    from redis import asyncio as aioredis  # type: ignore
except Exception:  # pragma: no cover
    aioredis = None

log = logging.getLogger("speakedge.realtime")

PRESENCE_TTL = 60  # seconds; a member not seen within this window drops offline
_CHANNEL = "rt:community:{}"      # pub/sub channel per room
_PRESENCE = "rt:presence:{}"      # sorted set of online members per room


class RealtimeHub:
    def __init__(self) -> None:
        self._rooms: dict[str, set[WebSocket]] = defaultdict(set)
        # in-memory presence (only used when Redis is absent): room -> {student_id: local conns}
        self._presence: dict[str, Counter] = defaultdict(Counter)
        self._redis = None
        self._sub = None
        self._task: asyncio.Task | None = None

    # ---- lifecycle (called from the app lifespan) ----
    async def start(self) -> None:
        if settings.REDIS_URL and aioredis is not None:
            try:
                self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
                await self._redis.ping()
                self._sub = self._redis.pubsub()
                await self._sub.psubscribe(_CHANNEL.format("*"))
                self._task = asyncio.create_task(self._listen())
                log.info("Realtime hub: Redis pub/sub (multi-worker safe)")
                return
            except Exception as e:  # pragma: no cover - falls back to memory
                log.warning("Realtime hub: Redis unavailable (%s); single-worker mode", e)
                self._redis = None
        log.info("Realtime hub: in-memory (single-worker)")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
        if self._sub:
            await self._sub.aclose()
        if self._redis:
            await self._redis.aclose()

    async def _listen(self) -> None:
        """Deliver every Redis-published event to this process's local sockets."""
        assert self._sub is not None
        async for msg in self._sub.listen():
            if msg.get("type") != "pmessage":
                continue
            try:
                room = msg["channel"].split(":")[-1]
                event = json.loads(msg["data"])
            except Exception:  # pragma: no cover
                continue
            await self._deliver_local(room, event)

    # ---- fan-out ----
    async def publish(self, room: str, event: dict) -> None:
        """Send an event to every socket in the room, on every instance.
        With Redis, we publish only (the subscriber — including our own process —
        does the local delivery), which avoids double-delivering to our sockets."""
        if self._redis:
            await self._redis.publish(_CHANNEL.format(room), json.dumps(event))
        else:
            await self._deliver_local(room, event)

    async def _deliver_local(self, room: str, event: dict) -> None:
        dead = []
        for ws in tuple(self._rooms.get(room, ())):
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._rooms[room].discard(ws)

    async def send_to(self, ws: WebSocket, event: dict) -> None:
        try:
            await ws.send_json(event)
        except Exception:  # pragma: no cover
            pass

    # ---- presence ----
    async def join(self, room: str, ws: WebSocket, student_id: str) -> None:
        self._rooms[room].add(ws)
        if self._redis:
            await self._redis.zadd(_PRESENCE.format(room), {student_id: time()})
        else:
            self._presence[room][student_id] += 1

    async def leave(self, room: str, ws: WebSocket, student_id: str) -> None:
        self._rooms[room].discard(ws)
        if not self._rooms[room]:
            self._rooms.pop(room, None)
        if self._redis:
            # ponytail: optimistic remove. A user on two tabs across two workers may
            # flicker offline here, but their heartbeat re-adds them within PRESENCE_TTL.
            await self._redis.zrem(_PRESENCE.format(room), student_id)
        else:
            c = self._presence[room]
            c[student_id] -= 1
            if c[student_id] <= 0:
                c.pop(student_id, None)
                if not c:
                    self._presence.pop(room, None)

    async def heartbeat(self, room: str, student_id: str) -> None:
        if self._redis:
            await self._redis.zadd(_PRESENCE.format(room), {student_id: time()})

    async def roster(self, room: str) -> list[str]:
        if self._redis:
            key = _PRESENCE.format(room)
            await self._redis.zremrangebyscore(key, "-inf", time() - PRESENCE_TTL)
            return await self._redis.zrange(key, 0, -1)
        return list(self._presence.get(room, ()))

    async def broadcast_presence(self, room: str) -> None:
        await self.publish(room, {"type": "presence", "online": await self.roster(room)})


hub = RealtimeHub()
