# Deploying SpeakEdge to Railway

This repo ships as a **single Railway service**: the Docker build compiles the
Vite/React PWA and hands the static bundle to FastAPI, which serves it at `/`
while the API stays on `/api/v1` and uploads on `/media`. The frontend calls the
API with **relative paths**, so one origin means **no CORS and no second host to
configure**.

Files that make this work:

| File | Purpose |
|---|---|
| [`Dockerfile`](Dockerfile) | Multi-stage build: Node builds the SPA → Python serves API + SPA. |
| [`railway.json`](railway.json) | Tells Railway to build from the Dockerfile; health check on `/health`. |
| [`.dockerignore`](.dockerignore) | Keeps `node_modules`, `.venv`, `.env`, and the PDF out of the build context. |
| [`backend/app/main.py`](backend/app/main.py) | Serves `frontend_dist/` with SPA fallback when present; API-only otherwise. |

---

## 1. Prerequisites

- A **MongoDB** the service can reach. Railway has a **MongoDB** template (add it
  to the project and use its connection string), or use **MongoDB Atlas**.
- *(Optional)* **Redis** — Railway has a Redis template. Leave `REDIS_URL` unset
  to use the in-memory fallback (fine for a single instance).

## 2. Create the service

```bash
# from the repo root, with the Railway CLI
railway login
railway init            # create/select a project
railway up              # builds the Dockerfile and deploys
```

Or in the dashboard: **New Project → Deploy from GitHub repo** → Railway detects
`railway.json` and builds the Dockerfile. Then **Settings → Networking → Generate
Domain** to get a public URL.

## 3. Environment variables

Set these under **Variables** (Railway injects `PORT` automatically — do **not**
set it yourself). Minimum for production:

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URI` | ✅ | e.g. `mongodb://…` from the Railway Mongo plugin or Atlas SRV string. |
| `MONGO_DB` | ✅ | e.g. `speakedge`. |
| `SECRET_KEY` | ✅ | Long random string. Generate: `python -c "import secrets;print(secrets.token_urlsafe(48))"`. |
| `ENV` | – | `production` (already set in the image). |
| `DEBUG` | – | `false` in production. |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | ✅ | Change from the defaults before seeding. |
| `REDIS_URL` | – | e.g. `redis://…`. Omit to use in-memory cache. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | for payments | Live/test keys. A real `rzp_…` key id turns off the offline demo fallback: orders go to the gateway and signatures are enforced. Also register the webhook in the Razorpay dashboard → `POST https://<host>/api/v1/payments/webhook`, event `payment.captured`, signed with `RAZORPAY_WEBHOOK_SECRET` — guest book/membership orders are reconciled only through it. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` / `SMTP_TLS` | for email | Your provider's SMTP. |
| `CORS_ORIGINS` | only if you split the frontend off | JSON array, e.g. `["https://app.speakedge.in"]`. Not needed for the single-service setup. |
| `WORKERS` | – | Defaults to `1`. See the scheduler note below before raising it. |

## 4. Seed the first admin (one-off)

After the first successful deploy, run the seeder once against the live DB:

```bash
railway run python -m app.db.seed
```

(or open a shell on the service and run the same command). This creates the
super-admin and demo activation codes.

## 5. Persistent uploads

Railway containers have an **ephemeral filesystem** — anything written to
`storage/uploads` is lost on redeploy. Choose one:

- **Attach a Volume** (Settings → Volumes) mounted at **`/app/storage`**. The
  image already points `UPLOAD_DIR=/app/storage/uploads` there.
- **Or use object storage**: set `STORAGE_BACKEND=s3` plus `S3_ENDPOINT`,
  `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` (works with S3 or
  Cloudflare R2). Recommended for anything more than a single box.

## Scaling & the scheduler

The app runs an in-process **APScheduler** (archive purge, reminders). Its
`lifespan` starts **once per worker/instance**, so running multiple workers or
replicas would run duplicate scheduled jobs. That's why `WORKERS=1` is the
default. To scale request throughput safely:

1. Keep one instance as the scheduler leader (or move jobs to a dedicated
   worker service), then
2. raise `WORKERS`, or add replicas, for the stateless request path.

For moderate traffic, a single instance with a few workers on the API path (once
the scheduler is isolated) is plenty; the stack is async top-to-bottom.

**Community chat (WebSocket) + multiple workers/replicas requires `REDIS_URL`.**
The realtime hub (`app/shared/realtime.py`) fans messages/typing/presence out via
Redis pub/sub so a socket on worker A reaches sockets on worker B. Without
`REDIS_URL` it falls back to in-process fan-out — correct only with a single
worker. So: `WORKERS=1` needs no Redis; `WORKERS>1` or multiple replicas **must**
set `REDIS_URL`. (Ephemeral typing/presence never hit Mongo; only messages and
read pointers persist.)

## Local smoke test of the production image

```bash
docker build -t speakedge .
docker run --rm -p 8000:8000 \
  -e MONGO_URI="mongodb://host.docker.internal:27017" \
  -e MONGO_DB=speakedge -e SECRET_KEY=dev-test \
  speakedge
# open http://localhost:8000  (SPA)  and  http://localhost:8000/docs (API)
```

---

## Alternative: two separate Railway services

If you'd rather scale the frontend and backend independently, split them — but
note the SPA currently uses **relative** `/api/v1` and `/media` paths, so a
separate static frontend would need either:

- a reverse proxy (Caddy/Nginx) on the frontend service that forwards `/api` and
  `/media` to the backend, **or**
- a code change to point the API client at an absolute `VITE_API_BASE` URL
  (in [`frontend/src/lib/api.ts`](frontend/src/lib/api.ts) and the few raw
  `axios` calls) and setting `CORS_ORIGINS` on the backend.

The single-service setup above avoids all of that, which is why it's the default.
