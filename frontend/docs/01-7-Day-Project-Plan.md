# SpeakEdge — 7-Day Project Plan

**Product:** SpeakEdge — The Complete English Communication Ecosystem
**Owner:** Sujyoti EdTech Pvt. Ltd.
**Scale target:** ~500 users (low concurrency, ~50–100 peak)
**Stack:** React + TypeScript (frontend) · Python/FastAPI (backend) · MongoDB
**Date:** 2026-06-30

---

## 1. Important Reality Check (read first)

The source design document (`SpeakEdge Section.pdf`, 240 pages) describes a **very large ecosystem**: 16 backend modules, a 15-section marketing website, Partner network, Teacher system, Speaking Community, CEFR exams, certificates, subscriptions, analytics and PWA. Building **all of it** to production quality is a **multi-month program (roughly 12–16 weeks for a small team)**, not 7 days.

A 7-day window cannot deliver every module. Therefore this plan delivers the **"core spine" MVP** — the part of Stage 1 that everything else depends on:

> **One Book → One Activation Code → One Student ID → One Dashboard → One Membership**

Everything in SpeakEdge hangs off this spine (Activation Code = permanent Student ID mapping membership, dashboard, community, payments, exams, certificates). If the spine is right, the remaining modules are additive.

**What ships in 7 days (Sprint 1 / "Core Platform Foundation"):**
1. Public website (Hero + key sections, navigation, footer) — marketing shell
2. Authentication + JWT sessions (website + PWA-ready)
3. Activation Code system (bulk generate, single-use, becomes Student ID)
4. Membership Activation + 72-hour verification workflow + file uploads (photo/ID) with compression
5. Student Dashboard (core: profile, membership info, notifications, community profile)
6. Admin Panel (core: dashboard overview, user/membership management, activation management, approvals, role-based access)
7. Razorpay subscription/book-purchase payment flow (verify + invoice) — happy path
8. PWA shell (installable, persistent login, offline page) + REST API-first design for future Flutter app

**Explicitly deferred to later sprints (post Day 7):** Partner system, Teacher batches/attendance/remuneration, Speaking Community teams & safety cards, CEFR/Speaking exam + examiner dashboard + certificate generation, Orientation booking, Video preservation, full Notification scheduling, Analytics & Reports, Free Demo lead funnel. These are scoped in §6 (Roadmap Beyond Day 7).

---

## 2. Assumptions

- **Team:** 4–5 people — 2 Backend (Python/FastAPI), 2 Frontend (React/TS), 1 shared Full-stack/DevOps (also QA). Adjust day cards if smaller.
- Design/branding (colours `#00529B`, `#2F80ED`, gold `#F4B400`, copy) is taken from the PDF; no separate design phase.
- Razorpay test keys, domain, and a single VPS/cloud project are available on Day 1.
- "Done" = merged to `main`, deployed to staging, smoke-tested, demoable.
- Data-deletion policy is **soft-delete/archive from Day 1** (60-day retention) — baked into the base model, not retrofitted.

---

## 3. Cross-cutting principles wired in from Day 1

| Principle | How it's enforced |
|---|---|
| API-first (Flutter-ready) | All features are REST endpoints under `/api/v1`; frontend consumes only APIs. |
| Activation Code = Student ID | Single `students` identity keyed by code `SPK-26-XXXXXX`; all records reference it. |
| Soft-delete everywhere | Base document fields: `is_archived`, `archived_at`, `archived_by`, `delete_reason`, `auto_delete_at`. No hard delete from UI. |
| Role-based access | JWT carries role (`super_admin`, `admin`, `examiner`, `teacher`, `partner`, `student`); FastAPI dependency guards. |
| Activity logs | Middleware writes audit entries for auth, payments, activation, approvals, archive/restore. |
| Mobile-first / PWA | Responsive Tailwind; manifest + service worker added Day 6. |

---

## 4. Day-by-Day Plan

### Day 1 — Foundations & Skeleton
**Goal:** Repos, CI, infra skeleton, auth contracts agreed.
- **DevOps:** Provision the 3 servers (Mongo / Backend / Frontend), Docker + Nginx reverse proxy, staging domain + TLS, GitHub repo + CI (lint/test/build). Set up `.env` management and secrets.
- **Backend:** FastAPI project scaffold, MongoDB connection (Motor/Beanie), Pydantic settings, base `AuditedDocument` model (soft-delete fields), error handler, `/health`. JWT auth utilities (hash with bcrypt, access/refresh tokens). Role enum + `require_role()` dependency.
- **Frontend:** Vite + React + TS scaffold, Tailwind, React Router, TanStack Query, Axios API client with auth interceptor, layout shells (Public, Student, Admin), design tokens (colours/typography).
- **Shared:** Lock the OpenAPI contract for Auth + Activation; agree on response envelope and error shape.
- **Deliverable:** Both apps build & deploy to staging; `/health` green; login UI calls a stub.

### Day 2 — Identity Core: Activation Codes + Auth
**Goal:** The spine exists end-to-end.
- **Backend:** Activation Code module — secure random generator (`SPK-26-` + PAN-style alnum), DB-level uniqueness, bulk generation (100/500/1000/5000), status (`unused/activated/blocked`), Excel/CSV export. Auth endpoints: login, refresh, logout, change/reset password. Admin search/filter for codes.
- **Frontend:** Login/Register pages, auth state + persistent session, protected routes, Admin "Activation Codes" screen (generate, list, export, status badges).
- **Deliverable:** Admin can generate & export codes; users can log in; codes are single-use enforced at DB level.

### Day 3 — Membership Activation + 72-Hour Verification
**Goal:** A real student can activate and exist in the system.
- **Backend:** `/activate-membership` — validate code (exists, unused, not blocked) → create `student` (Student ID = code), set `Pending Verification`, create dashboard + community profile records. File upload service: profile photo + ID proof with **server-side image compression** (Pillow) and size limits (photo 500 KB / ID 1 MB) + reject-if-too-large message. Consent flags persisted. Admin approve/reject (with reason) → status `Active`.
- **Frontend:** Public **Membership Activation** form (all required fields, uploads with client preview, consent checkboxes, password creation), "Verification Pending (up to 72h)" status screen, resubmit-on-reject flow.
- **Deliverable:** Activation → Pending → Admin Approve → Active works; uploads stored & compressed.

### Day 4 — Student Dashboard (Core) + Community Profile
**Goal:** Activated student has a usable home.
- **Backend:** Dashboard aggregate endpoint (name, Student ID, membership status, CEFR status, notifications), profile read/update, community profile (auto `Self-Declared – Not Verified`), payment-history & notification list stubs.
- **Frontend:** Student Dashboard home, Profile Management (edit info, change password, update photo/About-Me), Membership Information panel, Community Profile view, **fixed WhatsApp support banner** (clickable `8240861168`), notifications list.
- **Deliverable:** Student logs in post-approval and sees a working, mobile-friendly dashboard.

### Day 5 — Admin Panel (Core) + Payments (Razorpay)
**Goal:** Operate the platform and take money.
- **Backend:** Admin dashboard overview counters (students, active memberships, codes, pending verifications), User & Membership management (search/filter/archive/restore, password reset, verification queue), role & permission guards. **Razorpay**: create order, verify signature (payment id/order id/signature), activate subscription/book order, **invoice generation (PDF)**, payment status states, manual-approval entry, failed-payment record. Webhook endpoint stub.
- **Frontend:** Admin layout + dashboard overview, User Management, Membership/Activation approval queue. Public **Book Purchase** + **Subscription Plans** pages with Razorpay Checkout; Student "Payment History" with invoice download.
- **Deliverable:** Admin approves members & manages users; a student can pay via Razorpay (test) and get an invoice.

### Day 6 — Public Website + PWA + Notifications
**Goal:** Public-facing product + app-like experience.
- **Frontend:** Marketing site — Top announcement bar, Header nav, **Hero (Section 1)**, NRP method, Become-a-Member/pricing, Book-unlocks-ecosystem, Footer; wire CTAs to Book Purchase / Activation / Demo routes. **PWA**: manifest, service worker (vite-plugin-pwa), install prompt (Android), iPhone install guide, splash, offline page, persistent login.
- **Backend:** Basic notification module (dashboard notifications create/list, read/unread), email on key events (registration, approval, payment, invoice) via SMTP.
- **Deliverable:** Installable PWA; public site live; users receive dashboard + email notifications.

### Day 7 — Hardening, QA, Docs, Launch
**Goal:** Stable, secure, demoable release.
- **All:** End-to-end test of the golden path (generate code → buy book → activate → verify → dashboard → subscribe → invoice). Fix P0/P1 bugs. Security pass (JWT expiry, password hashing, file-type/size validation, rate-limit auth, CORS, secrets). Seed data + admin user. Backups configured. Activity-log spot check. Final deploy to staging→prod. Write release notes + handover.
- **Deliverable:** Signed-off MVP spine in production for ~500 users; runbook + this doc set handed over.

---

## 5. Milestones & Acceptance

| Milestone | Day | Acceptance criteria |
|---|---|---|
| M1 Infra & skeleton up | 1 | Both apps deploy to staging; health checks green |
| M2 Identity spine | 2 | Codes generated/exported; auth works; single-use enforced |
| M3 Activation live | 3 | Pending→Active flow; compressed uploads stored |
| M4 Student dashboard | 4 | Approved student sees working dashboard |
| M5 Admin + payments | 5 | Admin operations + Razorpay test payment + invoice |
| M6 Public site + PWA | 6 | Installable PWA; site live; notifications fire |
| M7 Production launch | 7 | Golden path passes; security & backups done |

---

## 6. Roadmap Beyond Day 7 (the rest of the PDF)

Suggested 2-week sprints, in dependency order (mirrors the PDF's Phase ordering):

- **Sprint 2:** Free Demo & Lead Management · Notification scheduling/banners · Orientation Slot Booking · Video Preservation.
- **Sprint 3:** Teacher System (directory, batches, attendance→approval→remuneration, reviews) · Subscription edge cases (refunds, manual approvals UI).
- **Sprint 4:** Partner System (application → approval → dashboard → leads/sales reporting → franchisee microsites → public directory).
- **Sprint 5:** Speaking Community (teams, friend requests, safety cards, grievance tickets) · full member directory & search.
- **Sprint 6:** Assessment & Certification (CEFR + Speaking exam booking, Examiner dashboard, auto report cards & certificates within 24h, public verification by code).
- **Sprint 7:** Analytics & Reports (all report types, exports, funnels) · GST-ready invoicing · hardening, load test, Flutter API finalisation.

---

## 7. Top Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Scope mistaken as "whole platform in 7 days" | Missed expectations | This plan delivers the spine only; §6 sets the realistic roadmap. Confirm with stakeholders Day 0. |
| Razorpay verification/webhook edge cases | Payment integrity | Verify signature server-side; idempotent activation; reconcile via webhook. |
| File uploads (ID proofs) — storage & privacy | Cost/compliance | Compress server-side; store in object storage; access-controlled URLs; soft-delete. |
| Single MongoDB = single point of failure | Downtime/data loss | Daily backups Day 1; recommend a replica for HA (see Infra doc). |
| Activation Code uniqueness under bulk gen | Duplicate IDs | Unique index + retry-on-collision; generate in transactions/batches. |
| Team smaller than assumed | Slip | Cut Day 6 public-site polish first; keep spine (Days 1–5) intact. |
