"""Test fixtures: run the whole app against an in-memory MongoDB
(mongomock_motor) so the golden path can be exercised without a real DB."""
import mongomock_motor
import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from beanie import init_beanie
from httpx import ASGITransport, AsyncClient

import app.db.mongo as mongo_mod
from app.db.models import ALL_DOCUMENTS


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """The in-memory cache backing the rate limiter is process-local, so
    counters leak between tests and a login-heavy suite can 429 an unrelated
    one. Every test starts from a clean window."""
    from app.core.cache import cache

    cache._mem._counters.clear()
    cache._mem._store.clear()
    yield


@pytest.fixture(autouse=True)
def _local_storage(monkeypatch):
    """Keep uploads on disk even when .env points STORAGE_BACKEND at a real
    bucket — same reasoning as the Razorpay stub below: the suite must never
    reach the network, and a test upload must not litter the live bucket."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "local")
    yield


@pytest_asyncio.fixture
async def client(monkeypatch):
    # Patch init_db to use an in-memory Mongo client + Beanie.
    async def fake_init_db():
        c = mongomock_motor.AsyncMongoMockClient()
        mongo_mod._client = c
        await init_beanie(database=c["speakedge_test"], document_models=ALL_DOCUMENTS)

    async def fake_ping():
        return True

    monkeypatch.setattr(mongo_mod, "init_db", fake_init_db)
    monkeypatch.setattr(mongo_mod, "ping", fake_ping)
    monkeypatch.setattr(mongo_mod, "close_db", lambda: _noop())

    # Keep payments offline even when .env carries real Razorpay keys: orders
    # stay order_test_* and verify skips the signature check.
    import app.modules.payments.service as pay
    monkeypatch.setattr(pay, "keys_configured", lambda: False)

    # Avoid starting the real scheduler during tests.
    import app.shared.scheduler as sched
    monkeypatch.setattr(sched, "start_scheduler", lambda: None)
    monkeypatch.setattr(sched, "shutdown_scheduler", lambda: None)

    # Import app AFTER patching so lifespan uses the fakes.
    import importlib
    import app.main as main_mod
    importlib.reload(main_mod)

    async with LifespanManager(main_mod.app):
        transport = ASGITransport(app=main_mod.app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


async def _noop():
    return None
