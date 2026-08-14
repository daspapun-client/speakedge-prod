# syntax=docker/dockerfile:1

# ---------- Stage 1: build the React / Vite PWA ----------
FROM node:20-slim AS frontend
WORKDIR /frontend
# Install deps first for better layer caching.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # -> /frontend/dist

# ---------- Stage 2: Python API that also serves the built SPA ----------
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app

# Python deps (Pillow/bcrypt/reportlab ship manylinux wheels — no build tools needed).
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

# Backend source.
COPY backend/ ./

# Built SPA from stage 1 — FastAPI serves this at "/" (see main.py FRONTEND_DIST).
COPY --from=frontend /frontend/dist ./frontend_dist

ENV FRONTEND_DIST=/app/frontend_dist \
    ENV=production \
    STORAGE_BACKEND=local \
    UPLOAD_DIR=/app/storage/uploads \
    WORKERS=1

EXPOSE 8000
# Railway injects $PORT; default 8000 for plain `docker run`.
# WORKERS defaults to 1 so the in-process APScheduler owns jobs on a single
# leader — raise it only after moving scheduled jobs to a dedicated worker
# (see DEPLOY.md "Scaling & the scheduler").
CMD ["sh", "-c", "gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w ${WORKERS:-1} -b 0.0.0.0:${PORT:-8000} --timeout 60 --graceful-timeout 30 --max-requests 2000 --max-requests-jitter 200 --access-logfile - --error-logfile -"]
