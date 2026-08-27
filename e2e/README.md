# SpeakEdge — Playwright E2E Suite

Two Playwright projects:

- **`api`** — end-to-end **happy-path** coverage for all **16 domain modules**,
  driven through the public HTTP API (`request` fixture). No browser needed.
- **`ui`** — real **browser automation** (Chromium) of the React app: public
  pages, admin login/navigation, and a verified-student login. Supports **headed**
  runs.

## What it covers

`tests/journey.spec.ts` runs one serial journey that mirrors the real user
lifecycle — each module reuses state from the previous one:

| # | Module | Happy path exercised |
|---|--------|----------------------|
| 1 | Activation Codes | admin generates a batch, stats + listing |
| 2 | Membership + 72h verification | activate with a code → admin approve → student login |
| 3 | Payments (Razorpay) | list plans → create order → verify (test-mode) |
| 4 | Subscription | active subscription after payment |
| 5 | Student Dashboard | home + profile + every panel |
| 6 | Notifications & Notices | admin direct message + banner, student reads |
| 7 | Speaking Community | public stats/members, profile, team |
| 8 | Book Shop & Orders | product → catalogue → checkout → tracking → reports |
| 9 | Teacher System | apply → certify + link login → dashboard + batch |
| 10 | Partner Network | apply → approve + link login → dashboard + leads + report |
| 11 | Orientation | slot → student books → host completes |
| 12 | Exams & Certification | exam → book → examiner report → public verify |
| 13 | Video Preservation | publish video + category → student watch history |
| 14 | Leads / Free Demo | public demo booking → admin update |
| 15 | Analytics & Reports | summary aggregates + CSV export |
| 16 | Admin Panel | overview, students, verification queue, offers, logs |

`tests/health.spec.ts` is an independent sanity check for the API + DB.

### UI automation (`tests-ui/`)

| Spec | What it drives in the browser |
|------|-------------------------------|
| `public.spec.ts` | home hero + nav, plans (live data), free-demo submit, verify-code, logged-out subscribe → login |
| `auth.spec.ts` | admin login → overview → sidebar nav → logout; verified-student login → dashboard |

The student-login test seeds an approved account through the API first
(`tests-ui/helpers/seed.ts`), then logs in via the UI.

## Prerequisites

A running, **seeded** backend with MongoDB:

```powershell
cd ..\backend
python -m app.db.seed        # super-admin + examiner + demo activation codes
.\run_dev.ps1                # http://localhost:8000
```

The tests are safe to re-run against a persistent DB — every record uses a
unique suffix so runs don't collide.

## Run

```powershell
cd e2e
npm install

# --- API only (needs a seeded backend) ---
npm run test:api

# --- UI (needs backend + frontend dev server running) ---
npm run install:browsers     # one-time: download Chromium
npm run test:ui              # headless
npm run test:ui:headed       # headed  (watch it drive the browser)

npm test                     # both projects
npm run report               # open the HTML report
```

From the repo root there are also one-click launchers:

```bat
test-e2e.bat                 REM API suite (all 16 modules)
test-ui.bat                  REM UI suite, headed
```

### Targets

| Env var | Default | Meaning |
|---------|---------|---------|
| `API_BASE_URL` | `http://127.0.0.1:8000` | where the API lives (api tests + UI seeding) |
| `WEB_BASE_URL` | `http://127.0.0.1:5173` | where the React app is served (UI tests) |
| `HEADED` | _(unset)_ | set to run the UI project headed |

The Vite dev server proxies `/api` to `http://localhost:8000`; override with
`VITE_API_PROXY` (e.g. `set VITE_API_PROXY=http://localhost:8010 && npm run dev`)
to point the frontend at a backend on another port.

```powershell
# example: everything on non-default ports
$env:API_BASE_URL="http://127.0.0.1:8010"; $env:WEB_BASE_URL="http://localhost:5180"; npm run test:ui:headed
```

## Notes

- **Test-mode payments:** with no live Razorpay keys the gateway returns
  `order_test_*` ids, and `verify` skips signature checks and fulfils the order —
  so the subscription/exam-eligibility flow is exercised without real money.
- **Seeded logins** live in `tests/helpers/data.ts` (`SEED`); teacher/partner
  logins are created on the fly via the admin staff endpoint.
- To have Playwright start the backend for you, uncomment the `webServer` block
  in `playwright.config.ts` (requires MongoDB running).
