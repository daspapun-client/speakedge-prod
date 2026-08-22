# SpeakEdge — Infrastructure Document

**Topology:** 1 MongoDB server · 1 Backend server · 1 Frontend server
**Scale target:** ~500 total users (peak ~50–100 concurrent)
**Date:** 2026-06-30

---

## 1. Topology Overview

Three dedicated servers as requested, plus managed external dependencies (object storage, Razorpay, email). This is comfortably sized for 500 users and keeps each tier independently restartable/scalable.

```
                       Internet (HTTPS)
                              │
                              ▼
        ┌──────────────────────────────────────────────┐
        │   FRONTEND SERVER  (Public entry point)        │
        │   Nginx:                                        │
        │    • TLS termination (Let's Encrypt)            │
        │    • Serves React build (static, gzip/brotli)   │
        │    • Reverse-proxy  /api  → Backend             │
        │    • Security headers, rate-limit (edge)        │
        └───────────────┬────────────────────────────────┘
                        │  /api/v1  (private network)
                        ▼
        ┌──────────────────────────────────────────────┐
        │   BACKEND SERVER  (FastAPI)                     │
        │    • Gunicorn + Uvicorn workers                 │
        │    • Business logic (16 modules)                │
        │    • APScheduler (reminders, 60-day purge)      │
        │    • Talks to Mongo, Object Store, Razorpay,    │
        │      SMTP                                        │
        └───────┬───────────────────────┬────────────────┘
                │ (private network)      │ HTTPS (egress)
                ▼                        ▼
   ┌──────────────────────┐   ┌──────────────────────────────┐
   │  DATABASE SERVER     │   │  External / Managed services │
   │  MongoDB 7           │   │  • Object Storage (S3/R2)    │
   │  • Auth enabled      │   │  • Razorpay                  │
   │  • Bound to private  │   │  • SMTP / Email              │
   │    network only      │   └──────────────────────────────┘
   │  • Daily backups     │
   └──────────────────────┘
```

**Networking principle:** Only the Frontend server is exposed to the public internet (ports 80/443). Backend and MongoDB listen only on the **private network**; MongoDB is **never** publicly reachable.

---

## 2. Server Specifications (recommended for ~500 users)

| Server | Role | vCPU | RAM | Disk | Notes |
|---|---|---|---|---|---|
| **Frontend** | Nginx + static React + proxy | 2 | 2–4 GB | 20–40 GB SSD | Cheap; can also host CDN origin |
| **Backend** | FastAPI (Gunicorn/Uvicorn) | 2–4 | 4–8 GB | 40 GB SSD | 4 Uvicorn workers comfortable |
| **Database** | MongoDB 7 | 2–4 | 4–8 GB | 80–100 GB SSD | Size disk for media-less data; media goes to object storage |

These are starting points; at 500 users actual load is light. Scale vertically first if needed (cheapest win).

> **Media note:** Profile photos, ID proofs, PDFs (invoices/report cards/certificates), and self-hosted videos should live in **object storage**, not on the DB or app disks. This keeps the three servers small and durable. Videos especially must not sit on the backend disk.

---

## 3. Component Deployment Detail

### 3.1 Frontend Server
- **Nginx** serves the static Vite build (`/var/www/speakedge`), gzip/brotli, long-cache hashed assets, no-cache `index.html`.
- Reverse-proxies `location /api/ { proxy_pass http://backend-private-ip:8000; }`.
- TLS via **Let's Encrypt** (Certbot auto-renew). HTTP→HTTPS redirect, HSTS.
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
- Serves the **PWA** manifest + service worker correctly (proper MIME, `Service-Worker-Allowed`).

### 3.2 Backend Server
- **Gunicorn** managing **Uvicorn** workers:
  `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 4 -b 127.0.0.1:8000`
- Run under **systemd** (or Docker with `restart: always`).
- **APScheduler** in-process for: orientation reminders (24h / 1h before), scheduled notifications, **60-day archive purge**, payment reconciliation sweep.
- Connects to MongoDB over private network with auth; to object storage + Razorpay + SMTP over egress HTTPS.
- Health endpoint `/health` (liveness) and `/health/ready` (DB reachable).

### 3.3 Database Server
- **MongoDB 7**, authentication **enabled**, bound to private interface only (`bindIp` = private IP + localhost).
- Dedicated DB user with least-privilege role for the app.
- **WiredTiger** cache sized to ~50% RAM.
- Indexes created on deploy (unique `activation_codes.code`, `students.student_id`; compound search/filter indexes per Architecture doc).
- **Daily automated backups** (`mongodump`) to object storage, retained 14–30 days; periodic **restore drills**.

---

## 4. Single-Server-per-Tier: HA Trade-off & Recommendation

As requested, the baseline is **one** of each. Be aware:

- **Single MongoDB = single point of failure.** If it goes down, the platform is down; if its disk is lost without backup, data is lost.
- **Mitigations baked in:** daily off-server backups, monitoring/alerting, documented restore runbook.
- **Strong recommendation (low extra cost):** add a **MongoDB replica set** (1 primary + 1 secondary + 1 arbiter) for automatic failover and zero-downtime maintenance. This is the single highest-value reliability upgrade and is the natural next step once live. (Kept as a recommendation; the as-requested design remains a single Mongo node.)

---

## 5. Containerisation & Deploy

- Each tier shipped as a **Docker image**; orchestrated with **Docker Compose** per server (or a small Swarm/Nomad later).
- **CI/CD (GitHub Actions):** on merge to `main` → lint/test/build → build & push images → deploy to **staging** (same topology) → manual promote to **production**.
- **Zero-/low-downtime:** start new backend container, health-check, switch Nginx upstream, drain old. Frontend deploy is atomic static swap.
- **Config via environment** (12-factor); secrets injected at deploy, never committed.

**Recommended environments:**
| Env | Servers | Payments |
|---|---|---|
| Local | Docker Compose (all-in-one + Mailhog) | Razorpay test |
| Staging | 3 small servers mirroring prod | Razorpay test |
| Production | 3 servers as specced above | Razorpay live |

---

## 6. Networking, DNS & TLS

- **DNS:** `speakedge.<domain>` → Frontend public IP; `api.speakedge.<domain>` optional (can also proxy under `/api`).
- **Private network/VPC** between the 3 servers; firewall (security groups/ufw):
  - Frontend: allow 80/443 from world; 22 from admin IPs.
  - Backend: allow 8000 only from Frontend private IP; 22 from admin IPs.
  - Database: allow 27017 only from Backend private IP; 22 from admin IPs.
- **TLS** on the public edge (and optionally backend↔internal if crossing untrusted networks).
- **CORS** locked to the known frontend origin(s).

---

## 7. Storage & Media Strategy

| Data | Location | Why |
|---|---|---|
| Application data (students, codes, payments, etc.) | MongoDB | Transactional/queryable |
| Profile photos, ID proofs | Object storage (private bucket, signed URLs) | Sensitive; offload from app/DB |
| Generated PDFs (invoices, report cards, certificates) | Object storage | Durable, downloadable, verifiable |
| Self-hosted videos | Object storage (+ CDN later) | Large; must not touch app/DB disk |
| YouTube videos | External (embed link only) | Only metadata stored in DB |
| Backups | Object storage (separate bucket/region) | Off-server durability |

ID proofs and certificates are access-controlled (signed, expiring URLs) and follow the **60-day archive** lifecycle on deletion.

---

## 8. Backups & Disaster Recovery

- **MongoDB:** daily `mongodump` → object storage; 14–30 day retention; monthly restore test. (With replica set: also enables point-in-time safety.)
- **Object storage:** enable versioning + lifecycle rules; separate backup bucket.
- **Config/secrets:** stored in secret manager + encrypted backup.
- **RPO/RTO targets (single-node baseline):** RPO ≤ 24h (daily backup); RTO a few hours (rebuild + restore). Replica set improves RPO→near-zero and RTO→minutes.
- **Runbook:** documented restore steps, server rebuild from image + env, DNS failover.

---

## 9. Monitoring, Logging & Alerting

| Concern | Tool |
|---|---|
| Error tracking | **Sentry** (backend + frontend) |
| Uptime checks | **Uptime Kuma** / Healthchecks.io on `/health` |
| Metrics (optional) | Prometheus + Grafana (CPU, RAM, Mongo ops, request latency) |
| Logs | Structured JSON, rotated; central store optional (Loki/ELK) |
| DB monitoring | Mongo metrics (connections, slow queries, disk) |
| Alerts | Email/WhatsApp/Telegram on downtime, error spikes, disk >80%, backup failure |

Plus **audit/activity logs** stored in-app (per design doc) for security and compliance.

---

## 10. Security Hardening (infra layer)

- SSH key-only auth; no root login; non-default admin users; fail2ban.
- Firewall least-privilege (see §6); MongoDB never public.
- OS auto security updates; regular patching window.
- TLS 1.2+ only; strong ciphers; HSTS.
- Rate limiting on auth/payment endpoints (app) + edge limits (Nginx).
- Secrets never in images/repo; rotated periodically.
- Razorpay **webhook signature** verification; idempotent payment handling.
- Encrypted backups; private buckets; signed URLs for sensitive media.
- Periodic dependency scanning (Dependabot) and security review of changes.

---

## 11. Capacity & Scaling Notes (for 500 users)

- Expected steady load is light; the bottleneck during events (live class/orientation windows) is short read bursts on dashboard/community — well within 4 backend workers + indexed Mongo.
- **Scale order when needed:** (1) add backend workers / bump RAM → (2) MongoDB replica set → (3) add Redis cache + task queue for PDF/email/video jobs → (4) CDN for static + media → (5) extract heavy modules only if proven necessary.
- Storage grows mainly with **media** (ID proofs, videos) — handled by object storage, so the three servers stay small.

---

## 12. Cost-Shape Summary (indicative)

| Item | Tier |
|---|---|
| 3 small/medium VPS instances | Low monthly |
| Object storage (S3/R2/B2) | Pay-per-GB (cheap; egress-friendly on R2/B2) |
| Email provider | Free/low tier at this volume |
| Razorpay | Per-transaction fees |
| Domain + TLS | Domain cost; TLS free (Let's Encrypt) |
| Monitoring (Sentry/Uptime) | Free/low tiers sufficient |

A single small cloud project (DigitalOcean / Hetzner / AWS Lightsail / Linode) hosting the three servers + an S3-compatible bucket comfortably runs SpeakEdge for 500 users at modest monthly cost.
