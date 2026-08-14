#!/usr/bin/env bash
# Production launcher (Linux). Gunicorn manages Uvicorn workers for concurrency.
# Rule of thumb: workers = (2 * CPU) + 1. For ~1000 concurrent users start at 4-8
# workers on a 2-4 vCPU box and scale horizontally behind Nginx.
set -euo pipefail
WORKERS="${WORKERS:-4}"
exec gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  -w "${WORKERS}" \
  -b 0.0.0.0:8000 \
  --timeout 60 \
  --graceful-timeout 30 \
  --max-requests 2000 \
  --max-requests-jitter 200 \
  --access-logfile - \
  --error-logfile -
