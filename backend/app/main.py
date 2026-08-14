"""SpeakEdge FastAPI application — API-first modular monolith.

Registers every domain module router under /api/v1, wires cross-cutting
middleware (CORS, request id), starts the scheduler, and connects Mongo +
cache on startup. Designed to run behind Gunicorn+Uvicorn workers for
horizontal concurrency (see run scripts)."""
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.cache import cache
from app.core.config import settings
from app.core.envelope import ok
from app.core.exceptions import register_exception_handlers
from app.db.mongo import close_db, init_db, ping
from app.shared import file_service
from app.shared.realtime import hub
from app.shared.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("speakedge")

# --- Routers ---
from app.modules.auth.router import router as auth_router
from app.modules.activation_code.router import router as activation_router
from app.modules.membership.router import router as membership_router
from app.modules.student_dashboard.router import router as dashboard_router
from app.modules.admin.router import router as admin_router
from app.modules.payments.router import router as payments_router
from app.modules.book.router import router as book_router
from app.modules.subscription.router import router as subscription_router
from app.modules.notification.router import router as notification_router
from app.modules.community.router import router as community_router
from app.modules.teacher.router import router as teacher_router
from app.modules.orientation.router import router as orientation_router
from app.modules.partner.router import router as partner_router
from app.modules.exams.router import router as exams_router
from app.modules.video.router import router as video_router
from app.modules.leads.router import router as leads_router
from app.modules.analytics.router import router as analytics_router
from app.modules.prompt_library.router import router as prompt_library_router
from app.modules.ai_session.router import router as ai_session_router
from app.modules.instructions.router import router as instructions_router

MODULE_ROUTERS = [
    auth_router, activation_router, membership_router, dashboard_router,
    admin_router, payments_router, book_router, subscription_router,
    notification_router, community_router, teacher_router, partner_router,
    exams_router, video_router, leads_router, analytics_router,
    orientation_router, prompt_library_router, ai_session_router,
    instructions_router,
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await cache.connect()
    log.info("Cache backend: %s", cache.backend)
    await hub.start()  # community-chat realtime fan-out (Redis pub/sub if configured)
    # Only one process should own scheduled jobs; safe for single-instance dev.
    start_scheduler()
    yield
    shutdown_scheduler()
    await hub.stop()
    await cache.close()
    await close_db()


app = FastAPI(
    title="SpeakEdge API",
    version="1.0.0",
    description="The Complete English Communication Ecosystem — API-first backend.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)


@app.middleware("http")
async def add_request_context(request: Request, call_next):
    request_id = uuid.uuid4().hex[:12]
    start = time.time()
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Process-Time-ms"] = f"{(time.time() - start) * 1000:.1f}"
    return response


# Serve uploaded media locally (S3/R2 signed URLs replace this in prod).
media_dir = Path(file_service.media_root())
media_dir.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(media_dir)), name="media")

# Register all module routers under the versioned prefix.
for r in MODULE_ROUTERS:
    app.include_router(r, prefix=settings.API_V1_PREFIX)


@app.get("/health")
async def health():
    return ok({"status": "alive", "app": settings.APP_NAME, "env": settings.ENV})


@app.get("/health/ready")
async def ready():
    db_ok = await ping()
    return ok({"db": db_ok, "cache": cache.backend})


# --- Optional single-service frontend serving ---
# When a built SPA is present (set FRONTEND_DIST, default ./frontend_dist as
# produced by the Docker build), FastAPI serves it from the same origin. This is
# what the React app expects: it calls the API via relative /api/v1 and /media,
# so no CORS or separate host is needed. If no build is present, "/" returns the
# API JSON banner and the app runs API-only.
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", "frontend_dist")).resolve()
_RESERVED_PREFIXES = ("api/", "media/", "docs", "redoc", "openapi.json", "health")


def _safe_dist_file(rel: str) -> Path | None:
    """Resolve rel under FRONTEND_DIST, guarding against path traversal."""
    candidate = (FRONTEND_DIST / rel).resolve()
    if FRONTEND_DIST in candidate.parents and candidate.is_file():
        return candidate
    return None


if FRONTEND_DIST.is_dir() and (FRONTEND_DIST / "index.html").is_file():
    _index = FRONTEND_DIST / "index.html"

    @app.get("/")
    async def spa_root():
        return FileResponse(_index)

    # Serve real static files (assets, sw.js, manifest, icons); otherwise fall
    # back to index.html so client-side routing (react-router) works on reload.
    @app.get("/{full_path:path}")
    async def spa_catch_all(full_path: str):
        if full_path.startswith(_RESERVED_PREFIXES):
            raise HTTPException(status_code=404, detail="Not found")
        found = _safe_dist_file(full_path)
        return FileResponse(found) if found else FileResponse(_index)

    log.info("Serving frontend from %s", FRONTEND_DIST)
else:
    @app.get("/")
    async def root():
        return ok({"name": "SpeakEdge API", "docs": "/docs", "version": "1.0.0"})
