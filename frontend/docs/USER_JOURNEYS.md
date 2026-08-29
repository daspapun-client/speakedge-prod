# SpeakEdge — User Journeys

This document describes the end-to-end journeys for every kind of user of the
SpeakEdge platform. It is derived from the backend module routers
(`backend/app/modules/*`) and the frontend routes (`frontend/src/app/App.tsx`),
and is intended as a shared reference for product, engineering and QA.

## Roles at a glance

The system defines six authenticated roles plus an anonymous visitor.
Roles come from `Role` in [security.py](../backend/app/core/security.py) and are
enforced by the guards in [rbac.py](../backend/app/core/rbac.py).

| Role | Who they are | Primary surface |
| --- | --- | --- |
| **Anonymous visitor** | Prospects, buyers, people verifying a certificate | Public site (`/`, `/plans`, `/demo`, `/verify`, book shop) |
| **Student / Member** | A person who activated a membership | Student dashboard (`/dashboard/*`) |
| **Teacher** | A certified teacher running batches | Teacher dashboard |
| **Partner** | One of four Sujyoti EdTech partner types | Partner dashboard |
| **Examiner** | Conducts CEFR & Speaking tests, files reports | Examiner dashboard |
| **Admin** | Operations staff who run every workflow | Admin panel (`/admin/*`) |
| **Super Admin** | Admin + archive restore / purge privileges | Admin panel |

> `super_admin` is implicitly allowed everywhere `admin` is allowed
> (see `require_role`), and additionally guards destructive restore/purge actions.

---

## 1. Anonymous visitor

The visitor can accomplish a lot without ever logging in.

### 1.1 Discover & book a free demo
1. Land on the **Home** page (`/`) — sees the speaking-community carousel and
   public stats (`GET /community/public/stats`, `/community/public/members`).
2. Browse **Plans** (`/plans`) — subscription tiers and pricing
   (`GET /payments/plans`).
3. Register for a **Free Demo** (`/demo`) — submits name/phone/interest
   (`POST /leads/demo`). A lead is created with status `demo_booked`; the team
   follows up. Admins later track the lead through
   `demo_booked → ... → converted`.

### 1.2 Buy a book (no account required)
1. Browse the **book catalogue** (`GET /books`, `GET /books/product/{id}`).
2. **Checkout** as a guest (`POST /books/checkout`) choosing home delivery or
   office pickup. An order + Razorpay order are created.
3. Pay to confirm. Each fulfilled book carries an **activation code** used later
   to become a member.
4. **Track the order** by order number (`GET /books/track/{order_number}`).
   Providing the phone reveals buyer/address details, the activation code, and
   the office-pickup OTP/QR.

### 1.3 Verify a certificate or CEFR report
- Enter a verification code on `/verify` (`GET /exams/verify/{code}`) to confirm
  a **Certificate** or **CEFR Report** is genuine — no login required.

### 1.4 Browse public directories
- **Certified Teacher Directory** (`GET /teacher/directory`) — photo, name, ID,
  badge only.
- **Partner Directory** and **Franchisee microsites**
  (`GET /partner/directory`, `GET /partner/microsite/{slug}`).
- **Public videos** (`GET /videos` while logged out returns `public` videos only).

### 1.5 Apply to join the ecosystem
- **Apply as a Teacher** (`POST /teacher/apply`).
- **Apply as a Partner** (`POST /partner/apply`) — one of four partner types.

---

## 2. Student / Member

The core journey: from an activation code to an active, verified, subscribed
member of the speaking community.

### 2.1 Activate membership
1. Obtain an **activation code** (bundled with a purchased book, or issued by an
   admin/partner).
2. Complete the **Student Registration Form** on `/activate`
   (`POST /membership/activate`): personal details, address, self-declared CEFR
   level, photo + ID proof uploads, and **five mandatory consents**.
3. Submission creates the student in **Pending** status.
   *"Verification may take up to 72 hours."*

### 2.2 Verification outcome
- **Approved** by an admin (`POST /membership/{id}/approve`) → member gains full
  dashboard access; a community profile is created.
- **Rejected** with a reason (`POST /membership/{id}/reject`) → the student sees
  the reason on `/status/{studentId}` (`GET /membership/status/{id}`) and can
  **resubmit** corrected info (`POST /membership/resubmit`), returning to Pending.

### 2.3 Log in & land on the dashboard
- Log in (`POST /auth/login`) → JWT access/refresh tokens.
- **Dashboard home** (`GET /dashboard/`): membership status, CEFR status/level,
  active subscription, unread notifications, referral code, WhatsApp support
  banner.

### 2.4 Orientation (one live session, ever)
1. View available **slots** (`GET /orientation/slots`).
2. **Book** a slot (`POST /orientation/slots/{id}/book`).
3. **Reschedule** before completion if needed (`POST /orientation/reschedule/{newSlotId}`).
4. Host/teacher marks **Present / Absent / Completed**.
   - Once **Completed**, live orientation is **locked forever**; orientation
     videos remain available on demand.
   - **Absent** students may rebook.

### 2.5 Buy / upgrade a subscription
1. Review plans (`GET /payments/plans`).
2. Create a Razorpay **order** (`POST /payments/order`).
3. **Verify** payment (`POST /payments/verify`) → subscription activated, invoice
   generated. (Reconciliation also happens via `POST /payments/webhook`; admins
   can `manual-approve` offline payments.)
4. View current subscription and history (`GET /subscription/current`, `/history`).

### 2.6 Exams & certification
- Every member gets **1 CEFR + 1 Speaking** complimentary test; Gold raises this
  to 2+2 and Diamond to 3+3 via the active subscription.
- Check **eligibility** (`GET /exams/eligibility`), then **book** an exam
  (`POST /exams/{id}/book`). Booking is blocked when quota is exhausted, with an
  upgrade prompt.
- After the exam, the examiner files a report:
  - **CEFR test** → CEFR Report Card PDF; the student's CEFR status flips
    **Self-Declared → Verified** on both the student record and community profile.
  - **Speaking test** → auto-generated **Certificate PDF**.
- Access results via `GET /exams/my-bookings`, `/my-reports`, `/my-certificates`.

### 2.7 Speaking Community (Layer 3, members only)
- Browse the member **directory** with filters (`GET /community/directory`).
- Edit own community profile (bio, interests, "looking for partner").
- **Friend requests** — send/accept/decline/block.
- **Speaking Teams** — create up to 2, join up to 8 members, leave (ownership
  transfers to the oldest member; empty teams archive).
- **Report & Block** misbehaving members (`POST /community/report`) → admin review.
- Admins may issue **safety cards** (yellow → red → suspension/termination); a
  suspension hides the member from public/community listings.

### 2.8 Classes, attendance & reviews
- Assigned by an admin to a **batch** under a teacher.
- After the teacher submits attendance and an admin approves it, present students
  receive an **auto review pop-up** (`GET /dashboard/pending-reviews`) shown once
  a day for a **7-day window**.
- Submit a 1–5 rating + feedback, or skip (`POST /dashboard/reviews/{id}`).

### 2.9 Videos, offers, downloads, referrals
- **Videos** — access-filtered by `public / member / subscriber` level; watch
  history and resume position are tracked (`/videos`, `/videos/{id}/watch`).
- **Exclusive offer pop-ups** (`GET /dashboard/offers`) — respond
  *interested* (redirect to payment) or *not interested* (never shown again).
- **Download Centre** (`GET /dashboard/downloads`) — certificates, report cards,
  invoices in one place.
- **Referral** code + history (`GET /dashboard/referral`; benefits "coming soon").
- **Profile** management and **notifications** (`/dashboard/profile`,
  `/dashboard/notifications`).

---

## 3. Teacher

Journey: application → certification → running batches → getting paid.
(See [teacher/router.py](../backend/app/modules/teacher/router.py).)

1. **Apply** publicly (`POST /teacher/apply`) with qualification & CEFR level.
   *"Our team will contact you within 72 hours."*
2. **Admin certifies** the teacher (`POST /teacher/{id}/approve`) → a **Teacher ID**
   is issued, a login is linked, and the teacher may appear in the public directory.
3. **Teacher dashboard** (`GET /teacher/dashboard`): batches, pending attendance
   approvals, average rating, and earnings (pending / this month / total received).
4. **Batches** are created and populated by admins; teacher views **My Batches**
   with each student's subscription expiry (`GET /teacher/my-batches`).
5. **Submit attendance** per class (`POST /teacher/attendance`) → status
   **Pending Admin Verification**.
6. **Admin verifies** attendance:
   - Approval credits **remuneration** and triggers **student review requests**.
   - Rejection notifies the teacher.
7. **Remuneration workflow**: admin marks a payment **paid**
   (`.../mark-paid`) → teacher **confirms receipt**
   (`.../confirm-received`).
8. **Reviews** — view average rating and student feedback (`GET /teacher/my-reviews`).
9. **Profile** — teachers may update contact details and photo only
   (`PUT /teacher/my-profile`); qualification/CEFR are admin-controlled.
10. May also **host orientation** slots and mark attendance (shares the `host` guard).

---

## 4. Partner (Sujyoti EdTech Partner Network)

Four partner types apply, get approved, and report sales/admissions.
(See [partner/router.py](../backend/app/modules/partner/router.py).)

1. **Apply** (`POST /partner/apply`) choosing a partner type and products of
   interest; must consent to contact.
2. **Admin review** moves the application through
   `pending → under_review → approved / rejected / on_hold / suspended`
   (`POST /partner/{id}/status`). On approval a **Partner ID** is issued, allowed
   products are set, and **Franchisee** partners get a public **microsite** slug.
3. **Partner dashboard** (`GET /partner/dashboard`): performance summary — leads,
   conversions, book sales, admissions, membership sales, pending reports.
4. **Lead management** — add leads, update status through
   `new → contacted → demo_registered → admission_pending → converted / lost`
   (`/partner/{id}/leads`).
5. **Sales / admission reporting** (`POST /partner/{id}/reports`) — each report
   stays **Pending Admin Approval** until reviewed
   (`POST /partner/reports/{id}/review`); only approved data counts in metrics.
6. Approved partners appear in the **public directory** (and microsite for
   franchisees). Partners may only act on their own records.

---

## 5. Examiner

Focused journey around exam reporting.
(See [exams/router.py](../backend/app/modules/exams/router.py).)

1. View the **assigned queue** — bookings awaiting a report
   (`GET /exams/examiner/assigned`).
2. **Submit a report** (`POST /exams/report`):
   - **CEFR** → requires a level (A1–C2); generates the CEFR Report Card,
     verifies the student's CEFR status, and notifies them.
   - **Speaking** → requires a grade; generates the Certificate PDF.
3. The booking is marked **completed** and the action is audit-logged.

---

## 6. Admin / Super Admin

Admins operate every back-office workflow. Frontend surfaces live under
`/admin/*` ([AdminLayout](../frontend/src/app/layouts/AdminLayout.tsx)); the API
is spread across modules. Key journeys:

- **Overview dashboard** (`/admin`) — platform KPIs and analytics.
- **Activation codes** (`/admin/codes`) — generate batches, list/search, block,
  manually assign, export CSV, and view activation stats
  (`/activation-codes/*`).
- **Membership verification** (`/admin/verification`) — approve/reject pending
  students with reasons.
- **Students** (`/admin/students`) — manage member records.
- **Book shop** (`/admin/books`) — products & inventory (restock/adjust with an
  audit log), order dashboard, status & shipment tracking transitions,
  **office-pickup OTP/QR verification**, cancellations/refunds, and reports.
- **Teachers** — certify, edit, create batches, assign students, verify
  attendance, and run the remuneration payout workflow.
- **Partners** — review applications, set status/products, review sales reports.
- **Exams** — create CEFR/Speaking exams.
- **Payments** — view all payments (incl. failed), manual-approve offline
  payments, set refund status, edit plan configs.
- **Orientation** — create/update/delete slots, view bookings, mark attendance.
- **Community safety** — review reports, issue safety cards, suspend members.
- **Videos** — manage categories and videos with access levels; archive-first
  delete (restorable ~60 days) and restore.
- **Leads** — track demo leads to conversion.
- **Notifications & offers** — broadcast notifications and target exclusive offers.
- **Super Admin only** — restore/purge archived records.

---

## Cross-cutting notes

- **Auth**: stateless JWT (`/auth/login`, `/refresh`, `/logout`,
  `/change-password`, `/me`). Rate-limited on auth, activation, and payment endpoints.
- **Audit logging**: sensitive actions are recorded via `log_activity` (approvals,
  code generation, payments, safety cards, etc.).
- **Notifications**: event-driven (exam ready, attendance approved, payment
  processed, orientation reminders) delivered to the dashboard.
- **Archive-first deletes**: most destructive operations archive records
  (restorable) rather than hard-deleting; purge is a Super Admin action.
- **Money** is stored in **paise** throughout.

---

*Generated from the current backend routers and frontend routes. Update this
document when module workflows or role guards change.*
