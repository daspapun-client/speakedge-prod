# SpeakEdge — Project Architecture Document

**Product:** SpeakEdge (Sujyoti EdTech Pvt. Ltd.)
**Scale:** ~500 users · low concurrency
**Style:** API-first **modular monolith** — React/TS SPA+PWA ⇄ Python/FastAPI ⇄ MongoDB
**Date:** 2026-06-30

---

## 1. Architectural Goals (from the design doc)

1. **One identity for life** — the book's **Activation Code becomes the permanent Student ID** linking membership, dashboard, community, payments, exams, certificates, reports, and the future mobile app.
2. **API-first** — every capability is a REST endpoint so the same backend serves Website, PWA, and a future **Flutter** app with no restructuring.
3. **Role-based** — Super Admin, Admin, Examiner, Teacher, Partner, Student.
4. **Archive-first data lifecycle** — soft-delete → 60-day retention → restore → permanent delete (Super Admin only).
5. **Simple to operate at 500 users** — one backend, one frontend, one MongoDB (see Infra doc), with a clean path to scale later.

> **Why a modular monolith, not microservices:** For ~500 users, microservices add operational cost with no benefit. A single FastAPI app split into clear internal modules gives fast development, simple deploys, and easy refactor-to-services later if scale demands it.

---

## 2. High-Level System Diagram

```
                         ┌──────────────────────────────────────────┐
                         │              Clients                      │
                         │  Browser SPA · Installed PWA · (future)   │
                         │            Flutter Mobile App             │
                         └───────────────┬──────────────────────────┘
                                         │ HTTPS (REST /api/v1, JWT)
                                         ▼
                         ┌──────────────────────────────────────────┐
   Static assets ◄───────│        Nginx (reverse proxy / TLS)        │
   (React build)         └───────────────┬──────────────────────────┘
                                         │ proxy /api → backend
                                         ▼
            ┌────────────────────────────────────────────────────────────┐
            │         FastAPI Backend (modular monolith, Uvicorn)         │
            │                                                            │
            │  API Layer (routers)  →  Service Layer  →  Repository Layer │
            │                                                            │
            │  Cross-cutting: Auth/JWT · RBAC · Audit log · Soft-delete  │
            │                 · Validation (Pydantic) · File/Image svc   │
            │                 · PDF svc · Email svc · Scheduler          │
            │                                                            │
            │  Domain Modules:                                           │
            │   Auth · ActivationCode · Membership · StudentDashboard    │
            │   Admin · Payments(Razorpay) · Community · Teacher         │
            │   Partner · Orientation · Exams/Certification · Video      │
            │   Notification · Analytics · Leads/Demo                    │
            └───────┬───────────────┬───────────────┬───────────────────┘
                    │               │               │
                    ▼               ▼               ▼
            ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐
            │   MongoDB    │  │ Object Store │  │ External Services      │
            │ (primary DB) │  │ (uploads,    │  │ Razorpay · SMTP/Email  │
            │              │  │  PDFs,videos)│  │ (future: WhatsApp,     │
            └──────────────┘  └──────────────┘  │  push, YouTube embed)  │
                                                └────────────────────────┘
```

---

## 3. Layered Backend Architecture

Each domain module follows the same internal layering — keeps it testable and Flutter-ready.

| Layer | Responsibility | Example |
|---|---|---|
| **Router (API)** | HTTP shape, auth/role guard, request/response schemas | `POST /api/v1/membership/activate` |
| **Schema (DTO)** | Pydantic v2 request/response validation | `ActivationRequest`, `StudentOut` |
| **Service** | Business rules, workflows, orchestration | "validate code → create student → pending" |
| **Repository** | DB access (Motor/Beanie), queries, soft-delete | `students.find_by_code()` |
| **Model** | MongoDB document model + base audited fields | `Student(AuditedDocument)` |

**Cross-cutting services** (shared by all modules): `AuthService`, `RBAC dependency`, `AuditLogService`, `FileStorageService` (+ Pillow compression), `PdfService` (invoices, CEFR report cards, certificates), `EmailService`, `Scheduler` (reminders/scheduled notifications).

---

## 4. Domain Modules (mapped to the 16 PDF modules)

| # | Module | Core responsibility | Key links |
|---|---|---|---|
| 1 | **Public Website** | Marketing (15 sections), SEO, CTAs | → Book Purchase, Activation, Demo |
| 2 | **Auth & Identity** | Login, JWT, refresh, password, RBAC | All modules |
| 3 | **Activation Code** | Bulk gen, single-use, **code = Student ID** | Membership, Student |
| 4 | **Membership Activation** | Registration, uploads, 72-h verification | Student, Community, Admin |
| 5 | **Student Dashboard** | Learner's control centre | Membership, Payments, Exams, Community |
| 6 | **Admin Panel** | Central control, approvals, RBAC, archive | All modules |
| 7 | **Payments (Razorpay)** | Orders, verify, invoices, refunds, manual | Subscription, Exam eligibility |
| 8 | **Subscription** | Plans (Tribe→Diamond), expiry, eligibility | Teacher batches, Exams |
| 9 | **Speaking Community (SSC)** | Profiles, partners, teams, safety cards | Student ID, CEFR status |
| 10 | **Teacher System** | Directory, batches, attendance→remuneration, reviews | Subscription, Admin |
| 11 | **Partner System** | Application→approval→dashboard→leads/sales→microsites | Admin, Leads |
| 12 | **Orientation Booking** | One-time live slot + permanent videos | Student, Notifications |
| 13 | **Exams & Certification** | CEFR/Speaking booking, Examiner dashboard, auto report cards & certificates, public verification | Student, Community verify |
| 14 | **Video Preservation** | YouTube + self-hosted, categories, access control, watch history | Student, Admin |
| 15 | **Notification & Notice** | Dashboard/banner/email/scheduled, read state | All dashboards |
| 16 | **Analytics & Reports** | Sales/lead/membership/payment/community/teacher/partner/exam reports + export | All modules |

(Plus **Free Demo & Lead Management** feeding partner/demo conversion reporting.)

---

## 5. The Identity Spine (most important design decision)

```
Book printed ──► Admin bulk-generates Activation Code  (SPK-26-Z62AbH)
                                  │ status: unused
                                  ▼
        Student buys book ──► enters code on /activate-membership
                                  │ validate (exists, unused, not blocked)
                                  ▼
        Code status: PENDING VERIFICATION  ── code value becomes Student ID
                                  │ auto-create:
                                  ├─ Student identity (id = SPK-26-Z62AbH)
                                  ├─ Student Dashboard (limited access)
                                  └─ Community Profile (Self-Declared)
                                  │ admin approves within 72h
                                  ▼
        Status: ACTIVE ──► everything keyed by Student ID for life:
        Membership · Dashboard · Community · Payments · Exams ·
        CEFR Reports · Certificates · Reviews · Future Flutter app
```

- **Uniqueness** enforced by a MongoDB unique index on the code + collision-retry on generation.
- **CEFR status** flips `Self-Declared → Verified` automatically when the examiner submits a report (event-driven update on the same Student ID).

---

## 6. Data Architecture (MongoDB)

Document database fits the doc-centric, evolving schema. Key collections (all extend the audited base):

`students`, `activation_codes`, `users`(auth/roles), `memberships`, `subscriptions`, `payments`, `invoices`, `community_profiles`, `speaking_teams`, `friend_requests`, `teachers`, `batches`, `attendance`, `remuneration`, `partners`, `partner_leads`, `franchisee_sites`, `orientation_slots`, `orientation_bookings`, `exams`, `exam_bookings`, `cefr_reports`, `certificates`, `examiners`, `videos`, `watch_history`, `notifications`, `banners`, `offers`, `leads`(demo), `activity_logs`, `archive`(soft-deleted records), `reports_cache`.

**Base audited document (every collection):**
```jsonc
{
  "_id": "...",
  "created_at": "...", "updated_at": "...",
  "is_archived": false,
  "archived_at": null, "archived_by": null,
  "delete_reason": null, "auto_delete_at": null  // archived_at + 60 days
}
```

**Indexing strategy:** unique index on `activation_codes.code` and `students.student_id`; compound indexes for admin search/filter (status + date), community filters (cefr_level, gender, age), payments (`student_id` + status), notifications (`recipient` + read). Text index where free-text search is needed.

---

## 7. Key Cross-Cutting Concerns

### 7.1 Authentication & Authorization
- **JWT** access (short-lived) + refresh (long-lived) → supports **persistent login** for PWA/mobile.
- Token claims include `student_id`/`user_id` and `role`. FastAPI dependency `require_role(...)` guards routers.
- Passwords hashed with **bcrypt**; admin can reset.

### 7.2 Data Lifecycle (Archive-First) — global policy
```
Delete request → Move to Archive (status, date, by, reason, auto_delete_at = +60d)
              → Super Admin can Restore
              → Permanent delete allowed only after 60 days (Super Admin)
```
No hard delete from any UI. Background job purges records past `auto_delete_at`.

### 7.3 File & Media Handling
- Uploads (profile photo ≤500 KB, ID proof ≤1 MB) compressed server-side (Pillow); reject if still over limit.
- Stored in **object storage** with access-controlled URLs (ID proofs are sensitive).
- **Self-hosted videos** and large media also in object storage; YouTube videos are embed links (metadata only in DB).

### 7.4 PDF Generation
Server-side templates for **invoices**, **CEFR report cards**, and **certificates**; stored and downloadable from the dashboard; certificates/reports carry a **verification code** for public verify endpoints.

### 7.5 Payments (Razorpay)
- Create order → client checkout → server verifies `payment_id`/`order_id`/`signature` → activate subscription + set expiry + add exam eligibility → generate invoice.
- **Webhook** for reconciliation; **manual approval** path for offline payments; failed-payment records retained; refund status tracked.

### 7.6 Notifications
- In-app (per dashboard) with read/unread; email on key events; banners; **scheduled** notifications via the scheduler. Designed so WhatsApp/push can be added later without restructuring.

### 7.7 Audit Logging
Every sensitive action (auth, activation, payment, approval, archive/restore, exam submission) writes to `activity_logs` with actor, action, target IDs, timestamp.

---

## 8. Request Lifecycle (example: subscription purchase)

```
Student clicks "Pay Now"
  → FE calls POST /api/v1/payments/order  (auth: student)
  → Service creates Razorpay order, returns order_id
  → FE opens Razorpay Checkout → user pays
  → FE calls POST /api/v1/payments/verify {payment_id, order_id, signature}
  → Service verifies signature server-side
       ├─ activate subscription (start/expiry, exam eligibility)
       ├─ generate invoice PDF
       ├─ write payment + audit log
       └─ create dashboard + admin notifications
  → Razorpay webhook later confirms/reconciles
  → FE polls/refetches dashboard → updated state
```

---

## 9. Environments & Deployment Topology

| Environment | Purpose |
|---|---|
| **Local** | Docker Compose: backend + frontend + Mongo + mailhog |
| **Staging** | Mirror of prod on the same 3-server topology; Razorpay test keys |
| **Production** | 1 Frontend server (Nginx + static) · 1 Backend server (FastAPI/Gunicorn-Uvicorn) · 1 MongoDB server (see Infra doc) |

CI/CD: GitHub Actions → lint/test/build → Docker images → deploy to staging → manual promote to prod.

---

## 10. Scalability & Evolution Path

At 500 users this topology is comfortably over-provisioned. When growth demands it:
1. Add Gunicorn workers / vertical bump (cheapest first win).
2. Add a **MongoDB replica set** (HA + read scaling) — already recommended.
3. Introduce **Redis** for caching/sessions/rate-limit and a **task queue** (Celery/RQ) for PDF/email/video jobs.
4. Put static behind a **CDN**; move media fully to S3-compatible storage.
5. Only if truly needed, extract the heaviest modules (Community, Video) into separate services — the module boundaries above make this a clean cut.

---

## 11. Security Architecture (summary)

- HTTPS everywhere; HSTS; secure cookies / token storage best practice.
- RBAC on every endpoint; principle of least privilege (Examiner sees only assessment data, etc.).
- Input validation via Pydantic; file type/size whitelist; antivirus scan recommended for uploads at scale.
- Secrets in environment/secret manager, never in code.
- Rate limiting on auth and payment endpoints; CORS locked to known origins.
- Sensitive documents (ID proofs) access-controlled and soft-deletable per retention policy.
- Full audit trail for compliance.
