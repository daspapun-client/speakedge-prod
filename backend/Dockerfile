# syntax=docker/dockerfile:1
#
# SpeakEdge API — standalone backend image (FastAPI + Gunicorn/Uvicorn).
#
#   BUILD CONTEXT IS THE `backend/` FOLDER, not the repo root:
#     docker build -t speakedge-api ./backend
#
# This image serves the API only (/api/v1, /media, /health, /docs). The SPA is a
# separate image (see ../frontend/Dockerfile) whose Nginx proxies /api and /media
# here. For the single-container variant that bundles both, use the repo-root
# Dockerfile instead — see DEPLOY.md.

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Deps first so source edits don't invalidate the wheel layer.
# (Pillow/bcrypt/reportlab ship manylinux wheels — no compiler needed.)
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

ENV ENV=production \
    DEBUG=false \
    STORAGE_BACKEND=local \
    UPLOAD_DIR=/app/storage/uploads \
    PORT=8000 \
    WORKERS=1

# Non-root runtime. /app/storage is the only writable path the app needs and is
# the mount point for a persistent volume when STORAGE_BACKEND=local.
RUN useradd --create-home --uid 10001 app \
    && mkdir -p /app/storage/uploads \
    && chown -R app:app /app/storage
USER app
VOLUME ["/app/storage"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD sh -c 'python -c "import os,urllib.request;urllib.request.urlopen(\"http://127.0.0.1:\"+os.getenv(\"PORT\",\"8000\")+\"/health\",timeout=4)"' || exit 1

# WORKERS defaults to 1 because the in-process APScheduler (reminders, archive
# purge) starts once per worker — >1 worker runs duplicate jobs. Raise it only
# after isolating the scheduler, and set REDIS_URL so the community-chat
# WebSocket hub fans out across workers. See DEPLOY.md "Scaling & the scheduler".
CMD ["sh", "-c", "exec gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  -w ${WORKERS:-1} \
  -b 0.0.0.0:${PORT:-8000} \
  --timeout 60 \
  --graceful-timeout 30 \
  --max-requests 2000 \
  --max-requests-jitter 200 \
  --access-logfile - \
  --error-logfile -"]
