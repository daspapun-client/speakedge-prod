"""MongoDB connection + Beanie initialisation with pooled async client."""
from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings
from app.db.models import ALL_DOCUMENTS

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    assert _client is not None, "Mongo client not initialised. Call init_db() first."
    return _client


async def init_db() -> None:
    """Create the pooled client and register all Beanie documents (also builds indexes)."""
    global _client
    # maxPoolSize governs concurrency headroom; tuned for ~1000 concurrent users
    # across a handful of workers. Motor multiplexes many requests over the pool.
    _client = AsyncIOMotorClient(
        settings.MONGO_URI,
        maxPoolSize=100,
        minPoolSize=5,
        serverSelectionTimeoutMS=5000,
        retryWrites=True,
    )
    await init_beanie(database=_client[settings.MONGO_DB], document_models=ALL_DOCUMENTS)


async def ping() -> bool:
    try:
        await get_client().admin.command("ping")
        return True
    except Exception:
        return False


async def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
