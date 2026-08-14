# SpeakEdge — The Complete English Communication Ecosystem

API-first **modular monolith**: **React + TypeScript (Vite/PWA)** ⇄ **Python 3 / FastAPI** ⇄ **MongoDB**, with Redis-optional caching/rate-limiting. Built from the design docs in [`docs/`](docs/) and the 240-page `SpeakEdge Section.pdf`.

> **What's in this build.** The full **Identity Spine is implemented and tested end-to-end** (auth → activation codes → membership + 72h verification → student dashboard → admin → Razorpay payments → invoices → notifications). All **16 domain modules exist as real, extendable endpoints** (community, teacher, partner, orientation, exams/certification, video, analytics, leads, subscription) so nothing from the spec is structurally missing. Deferred module depth is listed in [`docs/01-7-Day-Project-Plan.md`](docs/01-7-Day-Project-Plan.md) §6.

---

## Scale & concurrency (target: 1000 concurrent users)

The stack is designed to handle 1000 concurrent users, not just 500:

| Concern | How it scales |
|---|---|
| **Stateless auth** | JWT access + refresh — no server session, so any worker/instance can serve any request. |
| **Async I/O** | FastAPI + Motor/Beanie async all the way down; a few workers handle thousands of in-flight requests. |
| **Workers** | Gunicorn + Uvicorn workers (`run_prod.sh`, `WORKERS` env). Add workers/instances horizontally behind Nginx. |
| **Cache + rate-limit** | Redis when `REDIS_URL` is set (shared across workers); transparent in-memory fallback for local dev. |
| **DB pooling** | Motor client `maxPoolSize=100`; indexes on every hot query path (see `app/db/models.py`). |
| **Media offload** | Uploads/PDFs go to disk locally, S3/R2 in prod (`STORAGE_BACKEND=s3`) — never the DB. |

---

## Prerequisites (local, no Docker)

- **Python 3.12+** (tested on 3.13)
- **Node.js 20 LTS**
- **MongoDB** — the one external dependency. Either:
  - Install **MongoDB Community Server** (Windows) and run it on `mongodb://localhost:27017`, **or**
  - Use a free **MongoDB Atlas** cluster and set `MONGO_URI` in `backend/.env`.
- **Redis** — *optional*. Leave `REDIS_URL` blank to use the in-memory fallback.

---

## Run it

### 1) Backend (FastAPI)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env          # adjust MONGO_URI if using Atlas
python -m app.db.seed           # creates super-admin + demo activation codes
.\run_dev.ps1                   # http://localhost:8000  (Swagger at /docs)
```

Seeded logins (change in production):
- **Super Admin** — `admin@speakedge.in` / `Admin@12345`
- **Examiner** — `examiner@speakedge.in` / `Examiner@123`
- The seed prints **5 demo activation codes** — use one on the Activate page.

### 2) Frontend (React + Vite)

```powershell
cd frontend
npm install
npm run dev                     # http://localhost:5173  (proxies /api -> :8000)
```

Then: open `http://localhost:5173` → **Activate** with a seeded code → check status → log in as admin → **Verification Queue** → Approve → log in as the student → **Subscribe** (test-mode payment) → download invoice.

### Production backend (Linux)

```bash
WORKERS=4 ./run_prod.sh         # gunicorn + uvicorn workers
```
Front it with Nginx (TLS, static React build, `/api` proxy) per [`docs/04-Infrastructure.md`](docs/04-Infrastructure.md).

---

## Verify it works

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```

`tests/test_golden_path.py` runs the **entire spine end-to-end against an in-memory Mongo** (no real DB needed): seed → generate code → activate → single-use enforcement → pending → approve → student login → dashboard → create order → verify signature → invoice → subscription + exam eligibility. `tests/test_smoke.py` asserts all 16 module routers are registered.

```
frontend> npm run build        # type-checks + builds the PWA
```

---

## Project layout

```
speakedge/
├─ docs/                     # architecture, tech-stack, infra, 7-day plan
├─ backend/
│  ├─ app/
│  │  ├─ core/               # config, security(JWT), rbac, exceptions, cache, ratelimit, envelope
│  │  ├─ db/                 # mongo client, audited base model, all documents, indexes, seed
│  │  ├─ shared/             # file/image compression, pdf, email, scheduler, audit
│  │  ├─ modules/            # 16 domain modules (router/schemas/service/…)
│  │  └─ main.py             # app wiring, middleware, router registration
│  ├─ tests/                 # smoke + golden-path (in-memory Mongo)
│  ├─ requirements.txt · .env.example · run_dev.ps1 · run_prod.sh
└─ frontend/
   └─ src/{app,features,lib,styles}  # layouts + public/auth/membership/dashboard/admin/payments
```

## API

Every capability is a REST endpoint under `/api/v1` returning a uniform envelope
`{ success, data, message, error }`. Full interactive docs at **`/docs`** (Swagger) and **`/redoc`** — share these with the future Flutter team (API-first mandate).

## Cross-cutting guarantees (wired from day one)

- **Activation Code = permanent Student ID** (`SPK-26-XXXXXX`), DB-unique + collision-retry.
- **Archive-first soft delete** on every collection (60-day retention, background purge job).
- **RBAC** (`super_admin/admin/examiner/teacher/partner/student`) guarding every route.
- **Audit log** on auth, activation, payments, approvals, archive/restore, exam submission.
- **Server-side image compression** (Pillow) enforcing photo ≤500 KB / ID ≤1 MB.
- **PDF** invoices, CEFR report cards, certificates (ReportLab) with public verification codes.
- **Razorpay** order → server-side signature verify → idempotent activation → invoice; webhook + manual-approval + refund paths.
- **PWA**: installable, offline page, persistent login, service worker.

## Not yet deep (scaffolded, ready to extend)

Per the plan's realistic roadmap, these modules have working endpoints/models but not full UI/business depth yet: Partner microsites & reporting, Teacher remuneration workflows, Community teams/safety-card UI, Orientation reminders UI, Exam examiner dashboard UI, Video admin UI, Analytics report variety, GST invoicing edge cases. See `docs/01-7-Day-Project-Plan.md` §6.
