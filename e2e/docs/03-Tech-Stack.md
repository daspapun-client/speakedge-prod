# SpeakEdge — Technology Stack Document

**Frontend:** React + TypeScript · **Backend:** Python · **Database:** MongoDB
**Scale:** ~500 users · **Date:** 2026-06-30

---

## 1. Stack at a Glance

| Layer | Technology | Why |
|---|---|---|
| Frontend framework | **React 18 + TypeScript** | Required; type-safe, huge ecosystem, PWA-ready |
| Build tool | **Vite** | Fast dev/HMR, first-class TS, easy PWA plugin |
| Backend framework | **Python 3.12 + FastAPI** | Required Python; async, REST/OpenAPI native, API-first for Flutter |
| ASGI server | **Uvicorn** (workers via **Gunicorn**) | Production-grade async serving |
| Database | **MongoDB 7** | Document model fits evolving, doc-centric data |
| ODM/driver | **Beanie** (on **Motor**) | Async ODM with Pydantic models |
| Reverse proxy | **Nginx** | TLS, static serving, `/api` proxy |
| Containerisation | **Docker** + Compose | Reproducible deploys across 3 servers |

---

## 2. Frontend Stack (React + TypeScript)

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict mode) | Type safety across UI + API DTOs |
| Framework | React 18 | Function components + hooks |
| Bundler/dev | Vite | + `vite-plugin-pwa` for manifest/service worker |
| Routing | React Router v6 | Public / Student / Admin / Examiner / Teacher / Partner route groups |
| Server state | **TanStack Query (React Query)** | Caching, refetch, mutation states for all API calls |
| Client state | **Zustand** (light) | Auth/session/UI state; avoids Redux boilerplate |
| Forms | **React Hook Form** + **Zod** | Activation/registration/payment forms with validation |
| HTTP client | **Axios** | Interceptors for JWT + refresh + error envelope |
| Styling | **Tailwind CSS** | Design tokens for brand colours (`#00529B`, `#2F80ED`, gold `#F4B400`, bg `#F8FAFC`) |
| UI components | **shadcn/ui** + **Radix UI** | Accessible primitives, fast to build premium UI |
| Icons | **lucide-react** | Consistent icon set |
| Charts (Admin) | **Recharts** | Analytics dashboards, counters, funnels |
| Animations | **Framer Motion** | Scroll/hover animations the homepage spec asks for |
| Tables | **TanStack Table** | Admin lists with search/filter/sort/export |
| Dates | **date-fns** | Subscription/exam/orientation date handling |
| Payments | **Razorpay Checkout JS** | Client-side checkout, server verifies |
| PWA | `vite-plugin-pwa` (Workbox) | Installable, offline page, splash, persistent login |
| i18n (future) | **react-i18next** | Reserved for later |
| Testing | **Vitest** + **React Testing Library** + **Playwright** (E2E) | Unit + integration + golden-path E2E |
| Quality | **ESLint** + **Prettier** | Enforced in CI |

**Frontend app structure (feature-based):**
```
src/
  app/            # router, providers, layouts (Public/Student/Admin)
  features/
    auth/  activation/  membership/  dashboard/  admin/
    payments/  community/  teacher/  partner/  exams/  notifications/
  components/      # shared UI (shadcn-based)
  lib/             # api client, query hooks, zod schemas, utils
  styles/          # tailwind config, design tokens
  pwa/             # manifest, service worker config
```

---

## 3. Backend Stack (Python / FastAPI)

| Concern | Choice | Notes |
|---|---|---|
| Language | Python 3.12 | Type hints throughout |
| Framework | **FastAPI** | Async REST, auto OpenAPI/Swagger, dependency injection |
| Server | **Uvicorn** + **Gunicorn** | `gunicorn -k uvicorn.workers.UvicornWorker` |
| Validation | **Pydantic v2** | Request/response DTOs, settings |
| DB driver/ODM | **Motor** + **Beanie** | Async Mongo with Pydantic-based documents |
| Auth | **python-jose** (JWT) + **passlib[bcrypt]** | Access/refresh tokens, password hashing |
| Payments | **razorpay** (Python SDK) | Orders, signature verify, webhooks |
| PDF generation | **WeasyPrint** (HTML→PDF) or **ReportLab** | Invoices, CEFR report cards, certificates |
| Image processing | **Pillow** | Compress profile photos / ID proofs to size limits |
| File storage | **boto3** (S3-compatible) / local disk | Uploads, PDFs, self-hosted videos |
| Email | **fastapi-mail** / SMTP | Registration, approval, invoice, password reset |
| Scheduling | **APScheduler** | Orientation reminders, scheduled notifications, 60-day purge |
| Background jobs (future) | **Celery + Redis** or **RQ** | When PDF/email/video volume grows |
| Excel/CSV export | **openpyxl** / **pandas** | Activation codes, reports exports |
| Rate limiting | **slowapi** | Protect auth/payment endpoints |
| Config | **pydantic-settings** + `.env` | 12-factor configuration |
| Testing | **pytest** + **pytest-asyncio** + **httpx** | API + service tests; **mongomock-motor** for unit |
| Quality | **Ruff** (lint+format) + **mypy** | Enforced in CI |
| Migrations | Beanie init + lightweight scripts | Mongo is schema-flexible; index/seed scripts versioned |

**Backend project structure (modular monolith):**
```
app/
  main.py                 # FastAPI app, router registration, middleware
  core/                   # config, security(JWT), rbac, audit, exceptions
  db/                     # Mongo client, Beanie init, indexes
  shared/                 # file_service, pdf_service, email_service, scheduler
  modules/
    auth/        activation_code/   membership/    student_dashboard/
    admin/       payments/          subscription/  community/
    teacher/     partner/           orientation/   exams/
    video/       notification/      analytics/     leads/
        ├── router.py     # endpoints + role guards
        ├── schemas.py    # Pydantic DTOs
        ├── service.py    # business logic
        ├── repository.py # Mongo access (soft-delete aware)
        └── models.py     # Beanie documents (AuditedDocument)
  tests/
```

---

## 4. Database & Storage

| Item | Choice | Notes |
|---|---|---|
| Primary DB | **MongoDB 7** (single instance for MVP) | Replica set recommended for HA (see Infra doc) |
| ODM | Beanie (Pydantic documents) | Unified models with API schemas |
| Object storage | **S3-compatible** (Cloudflare R2 / Backblaze B2 / Wasabi) or local disk | Photos, ID proofs, PDFs, videos; CDN-able later |
| Cache/queue (future) | **Redis** | Sessions, rate-limit, Celery broker when needed |

---

## 5. External / Third-Party Services

| Service | Use |
|---|---|
| **Razorpay** | Payments: UPI, cards, net-banking, wallets; webhooks |
| **SMTP / Email provider** (e.g., SES, Brevo) | Transactional email |
| **YouTube (embed)** | Externally hosted videos (Video Preservation module) |
| **WhatsApp** (future) | Reminders/notifications; export-data path exists now |
| **Push notifications** (future) | For Flutter app |

---

## 6. DevOps & Tooling

| Concern | Choice |
|---|---|
| Version control | Git + GitHub |
| CI/CD | **GitHub Actions** (lint → test → build → docker → deploy) |
| Containers | Docker + Docker Compose (local & deploy) |
| Reverse proxy / TLS | Nginx + Let's Encrypt (Certbot) |
| Process mgmt | systemd / Docker restart policies |
| Monitoring | **Sentry** (errors) · **Uptime Kuma** / Healthchecks (uptime) · Prometheus + Grafana (optional) |
| Logging | Structured JSON logs (loguru/standard logging) → file/rotated; ship to a log store if needed |
| Secrets | `.env` on server / cloud secret manager |
| API docs | FastAPI auto Swagger `/docs` + ReDoc (shared with Flutter team) |

---

## 7. Why These Choices (rationale)

- **FastAPI over Django/Flask:** native async + automatic OpenAPI makes the **API-first, Flutter-ready** mandate trivial; Pydantic gives end-to-end typing that pairs naturally with TypeScript DTOs.
- **MongoDB over SQL:** the spec is document-centric and rapidly evolving (profiles, nested community/team data, varied report shapes); flexible schema speeds the 7-day spine and later modules. Strong indexes cover the search/filter needs.
- **Beanie + Pydantic + TS + Zod:** one validation philosophy across the whole stack → fewer integration bugs.
- **Vite + Tailwind + shadcn:** fastest path to the premium, animated, mobile-first UI the homepage spec demands, plus painless PWA.
- **Modular monolith:** right-sized for 500 users; clean module seams allow extraction to services only if scale ever requires it.

---

## 8. Version Baseline (pin in repos)

| Component | Version (target) |
|---|---|
| Node.js | 20 LTS |
| React | 18.x |
| TypeScript | 5.x |
| Vite | 5.x |
| Python | 3.12 |
| FastAPI | 0.11x (latest stable) |
| Pydantic | 2.x |
| MongoDB | 7.x |
| Beanie / Motor | latest stable |
| Razorpay SDK | latest stable |

> Exact patch versions are locked via `package-lock.json` / `poetry.lock` (or `requirements.txt` with hashes) in the repos.
