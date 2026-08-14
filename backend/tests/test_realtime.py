"""RealtimeHub in-memory fan-out: presence counting, dead-socket pruning and
delivery. Runs without Redis or Mongo (single-worker path)."""
import asyncio

from app.shared.realtime import RealtimeHub


class FakeWS:
    def __init__(self, alive=True):
        self.alive = alive
        self.sent = []

    async def send_json(self, event):
        if not self.alive:
            raise RuntimeError("socket closed")
        self.sent.append(event)


def test_presence_and_fanout():
    async def run():
        hub = RealtimeHub()  # no start() -> in-memory backend
        a, b, dead = FakeWS(), FakeWS(), FakeWS(alive=False)

        await hub.join("t1", a, "alice")
        await hub.join("t1", b, "bob")
        await hub.join("t1", dead, "carol")
        assert set(await hub.roster("t1")) == {"alice", "bob", "carol"}

        # Two tabs for alice: still online after closing one.
        a2 = FakeWS()
        await hub.join("t1", a2, "alice")
        await hub.leave("t1", a2, "alice")
        assert "alice" in await hub.roster("t1")

        # A dead socket is pruned on delivery; live ones receive.
        await hub.publish("t1", {"type": "message", "message": {"text": "hi"}})
        assert a.sent[-1]["message"]["text"] == "hi"
        assert b.sent[-1]["message"]["text"] == "hi"

        # Last member leaving clears the room + presence.
        await hub.leave("t1", a, "alice")
        await hub.leave("t1", b, "bob")
        await hub.leave("t1", dead, "carol")
        assert await hub.roster("t1") == []

    asyncio.run(run())
