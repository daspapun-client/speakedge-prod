import { test, expect, APIRequestContext } from '@playwright/test';
import { ApiClient, client } from './helpers/api';
import { SEED, membershipForm, uid, idOf } from './helpers/data';

/**
 * SpeakEdge — end-to-end HAPPY-PATH journey across all 16 domain modules.
 *
 * Runs serially: each module builds on state produced by the previous one
 * (activation code -> student -> subscription -> teacher/partner/exam data ...),
 * mirroring the real user lifecycle. Requires a seeded, running backend
 * (see playwright.config.ts).
 */
test.describe.serial('16-module happy-path journey', () => {
  // --- Shared state across the journey -------------------------------------
  let adminToken: string;
  let examinerToken: string;
  let studentToken: string;
  let teacherToken: string;
  let partnerToken: string;

  let codes: string[] = [];
  let studentId: string;
  const studentPassword = 'Student@123';

  let teacherDocId: string;
  const teacherLogin = { username: `teacher_${uid()}@e2e.in`, password: 'Teacher@123' };

  let partnerDocId: string;
  const partnerLogin = { username: `partner_${uid()}@e2e.in`, password: 'Partner@123' };

  let productId: string;
  let orderNumber: string;
  let examId: string;
  let examBookingId: string;
  let cefrCode: string;
  let videoId: string;

  const admin = (request: APIRequestContext) => client(request, adminToken);
  const student = (request: APIRequestContext) => client(request, studentToken);

  test.beforeAll(async ({ request }) => {
    adminToken = await new ApiClient(request).login(SEED.admin.username, SEED.admin.password);
    examinerToken = await new ApiClient(request).login(
      SEED.examiner.username,
      SEED.examiner.password,
    );
    expect(adminToken).toBeTruthy();
    expect(examinerToken).toBeTruthy();
  });

  // ── Module 1 — Activation Codes ─────────────────────────────────────────
  test('M01 Activation Codes: admin generates a batch, stats reflect it', async ({ request }) => {
    const a = admin(request);
    const gen = await a.post<{ codes: string[]; batch_id: string; generated: number }>(
      '/activation-codes/generate',
      { data: { count: 5 } },
    );
    expect(gen.generated).toBe(5);
    expect(gen.codes.length).toBe(5);
    codes = gen.codes;

    const stats = await a.get<{ total_generated: number; unused: number }>('/activation-codes/stats');
    expect(stats.total_generated).toBeGreaterThanOrEqual(5);
    expect(stats.unused).toBeGreaterThanOrEqual(5);

    const list = await a.get<{ items: unknown[]; total: number }>('/activation-codes/', {
      params: { page: 1, page_size: 5 },
    });
    expect(list.total).toBeGreaterThanOrEqual(5);
  });

  // ── Module 2 — Membership & 72h Verification ────────────────────────────
  test('M02 Membership: activate with a code, admin approves, student logs in', async ({
    request,
  }) => {
    const code = codes[0];
    const anon = new ApiClient(request);

    const activated = await anon.post<{ student_id: string; membership_status: string }>(
      '/membership/activate',
      { multipart: membershipForm(code, studentPassword) },
    );
    studentId = activated.student_id;
    expect(studentId).toBe(code); // the code becomes the permanent Student ID
    expect(activated.membership_status).toBe('Pending Verification');

    // Admin approves out of the verification queue.
    const approved = await admin(request).post<{ membership_status: string }>(
      `/membership/${studentId}/approve`,
    );
    expect(approved.membership_status).toBe('Active');

    const status = await anon.get<{ membership_status: string }>(`/membership/status/${studentId}`);
    expect(status.membership_status).toBe('Active');

    // Student can now log in (username = Student ID).
    studentToken = await new ApiClient(request).login(studentId, studentPassword);
    expect(studentToken).toBeTruthy();
  });

  // ── Module 3 — Payments (Razorpay, test-mode) ───────────────────────────
  test('M03 Payments: list plans, create order, verify, activates subscription', async ({
    request,
  }) => {
    const s = student(request);
    const plans = await s.get<Array<{ plan: string; amount: number }>>('/payments/plans');
    expect(plans.length).toBeGreaterThan(0);

    const order = await s.post<{ order_id: string; amount: number }>('/payments/order', {
      data: { plan: 'Tribe', kind: 'subscription' },
    });
    expect(order.order_id).toBeTruthy();

    // Test orders (order_test_*) skip signature checks and fulfil immediately.
    const verified = await s.post<{ status: string; invoice_no: string }>('/payments/verify', {
      data: {
        razorpay_order_id: order.order_id,
        razorpay_payment_id: `pay_test_${uid()}`,
        razorpay_signature: 'test_signature',
      },
    });
    expect(verified.status).toBe('paid');
    expect(verified.invoice_no).toBeTruthy();

    const detail = await s.get<{ status: string }>(`/payments/${order.order_id}`);
    expect(detail.status).toBe('paid');

    const all = await admin(request).get<{ total: number }>('/payments/admin/all');
    expect(all.total).toBeGreaterThanOrEqual(1);
  });

  // ── Module 4 — Subscription ─────────────────────────────────────────────
  test('M04 Subscription: current subscription is active after payment', async ({ request }) => {
    const s = student(request);
    const current = await s.get<{ plan: string; is_active: boolean } | null>('/subscription/current');
    expect(current).not.toBeNull();
    expect(current!.is_active).toBe(true);

    const history = await s.get<unknown[]>('/subscription/history');
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  // ── Module 5 — Student Dashboard ────────────────────────────────────────
  test('M05 Student Dashboard: home, profile, and all panels load', async ({ request }) => {
    const s = student(request);

    const home = await s.get<{ student_id: string; subscription: unknown }>('/dashboard/');
    expect(home.student_id).toBe(studentId);
    expect(home.subscription).not.toBeNull();

    const updated = await s.put<{ phone: string }>('/dashboard/profile', {
      data: { phone: '9811111111', about_me: 'Updated by e2e.' },
    });
    expect(updated.phone).toBe('9811111111');

    await s.get('/dashboard/membership');
    await s.get('/dashboard/community-profile');
    await s.get('/dashboard/payments');
    await s.get('/dashboard/notifications');
    await s.get('/dashboard/downloads');
    await s.get('/dashboard/referral');
    await s.get('/dashboard/offers');
    await s.get('/dashboard/pending-reviews');
  });

  // ── Module 6 — Notifications & Notices ──────────────────────────────────
  test('M06 Notifications: admin sends direct + banner, student reads it', async ({ request }) => {
    const a = admin(request);
    await a.post('/notifications/', {
      data: { recipient: studentId, title: 'Welcome!', body: 'Your journey begins.', kind: 'info' },
    });
    await a.post('/notifications/banners', {
      data: { title: 'E2E Banner', message: 'Hello world', audience: 'students', active: true },
    });

    const banners = await new ApiClient(request).get<unknown[]>('/notifications/banners', {
      params: { audience: 'students' },
    });
    expect(Array.isArray(banners)).toBe(true);

    const mine = await student(request).get<any[]>('/notifications/my');
    expect(mine.length).toBeGreaterThanOrEqual(1);
    await student(request).post(`/notifications/${idOf(mine[0])}/read`);
  });

  // ── Module 7 — Speaking Community ───────────────────────────────────────
  test('M07 Community: public stats + member directory, profile, team', async ({ request }) => {
    const anon = new ApiClient(request);
    const stats = await anon.get<{ total_members: number }>('/community/public/stats');
    expect(stats.total_members).toBeGreaterThanOrEqual(1);
    await anon.get('/community/public/members');

    const s = student(request);
    await s.get('/community/directory');
    await s.put('/community/my-profile', {
      data: { bio: 'E2E speaker', looking_for_partner: true, interests: ['debate'] },
    });
    const team = await s.post('/community/teams', { data: { name: `Team ${uid()}` } });
    expect(idOf(team)).toBeTruthy();
    await s.get('/community/teams');

    await admin(request).get('/community/reports');
  });

  // ── Module 8 — Book Shop & Order Management ─────────────────────────────
  test('M08 Book Shop: admin creates product, public checkout + tracking', async ({ request }) => {
    const a = admin(request);
    const product = await a.post('/books/admin/products', {
      data: {
        name: `SpeakEdge Book ${uid()}`,
        sku: `SKU-${uid()}`,
        version: 'International English',
        price: 99900,
        stock: 25,
        visible: true,
        status: 'active',
      },
    });
    productId = idOf(product);

    const anon = new ApiClient(request);
    const catalogue = await anon.get<unknown[]>('/books');
    expect(catalogue.length).toBeGreaterThanOrEqual(1);
    await anon.get(`/books/product/${productId}`);

    const checkout = await anon.post<{ order_number: string; amount: number }>('/books/checkout', {
      data: {
        buyer_name: 'E2E Buyer',
        phone: '9822222222',
        delivery_type: 'office',
        product_id: productId,
      },
    });
    orderNumber = checkout.order_number;
    expect(orderNumber).toBeTruthy();

    const tracked = await anon.get<{ status: string }>(`/books/track/${orderNumber}`, {
      params: { phone: '9822222222' },
    });
    expect(tracked.status).toBeTruthy();

    const orders = await a.get<{ total: number }>('/books/admin/orders');
    expect(orders.total).toBeGreaterThanOrEqual(1);
    await a.get('/books/admin/reports');
    await a.post(`/books/admin/products/${productId}/inventory`, {
      data: { kind: 'restock', qty: 5, reason: 'e2e restock' },
    });
  });

  // ── Module 9 — Teacher System ───────────────────────────────────────────
  test('M09 Teacher: apply, admin certifies + links login, teacher dashboard', async ({
    request,
  }) => {
    const anon = new ApiClient(request);
    const applied = await anon.post('/teacher/apply', {
      data: {
        name: 'E2E Teacher',
        phone: '9833333333',
        whatsapp: '9833333333',
        email: `t_${uid()}@e2e.in`,
        city: 'Kolkata',
        qualification: 'MA English',
        cefr_level: 'C1',
      },
    });
    teacherDocId = idOf(applied);

    const a = admin(request);
    // Create a teacher login, then approve + link it.
    await a.post('/admin/users/staff', {
      data: { ...teacherLogin, role: 'teacher', full_name: 'E2E Teacher' },
    });
    const approved = await a.post<{ teacher_id: string; status: string }>(
      `/teacher/${teacherDocId}/approve`,
      { data: { username: teacherLogin.username, public_visible: true } },
    );
    expect(approved.status).toBe('approved');
    expect(approved.teacher_id).toBeTruthy();

    // Admin assigns a batch to the teacher.
    await a.post('/teacher/batches', {
      data: { teacher_id: teacherDocId, title: 'Spoken English A1', student_ids: [studentId] },
    });

    teacherToken = await new ApiClient(request).login(teacherLogin.username, teacherLogin.password);
    const t = client(request, teacherToken);
    const dash = await t.get<{ teacher_id: string; batches: unknown[] }>('/teacher/dashboard');
    expect(dash.batches.length).toBeGreaterThanOrEqual(1);
    await t.get('/teacher/my-batches');

    const dir = await anon.get<unknown[]>('/teacher/directory');
    expect(dir.length).toBeGreaterThanOrEqual(1);
  });

  // ── Module 10 — Partner Network ─────────────────────────────────────────
  test('M10 Partner: apply, admin approves + links login, dashboard + leads', async ({
    request,
  }) => {
    const anon = new ApiClient(request);
    const applied = await anon.post('/partner/apply', {
      data: {
        partner_type: 'Individual Partner',
        name: 'E2E Partner',
        phone: '9844444444',
        whatsapp: '9844444444',
        email: `p_${uid()}@e2e.in`,
        state: 'West Bengal',
        district: 'Kolkata',
        area: 'Salt Lake',
        interested_in: ['SpeakEdge'],
        consent_contact: true,
      },
    });
    partnerDocId = idOf(applied);

    const a = admin(request);
    await a.post('/admin/users/staff', {
      data: { ...partnerLogin, role: 'partner', full_name: 'E2E Partner' },
    });
    const approved = await a.post<{ status: string; partner_id: string }>(
      `/partner/${partnerDocId}/status`,
      { data: { status: 'approved', username: partnerLogin.username, public_visible: true } },
    );
    expect(approved.status).toBe('approved');

    partnerToken = await new ApiClient(request).login(partnerLogin.username, partnerLogin.password);
    const p = client(request, partnerToken);
    const dash = await p.get<{ partner_id: string }>('/partner/dashboard');
    expect(dash.partner_id).toBeTruthy();

    const lead = await p.post(`/partner/${partnerDocId}/leads`, {
      data: { name: 'Prospect', phone: '9855555555', interest: 'Books' },
    });
    expect(idOf(lead)).toBeTruthy();
    await p.get(`/partner/${partnerDocId}/leads`);
    await p.post(`/partner/${partnerDocId}/reports`, {
      data: { report_type: 'book_sale', quantity: 2, product: 'SpeakEdge Book' },
    });

    const dir = await anon.get<unknown[]>('/partner/directory');
    expect(dir.length).toBeGreaterThanOrEqual(1);
  });

  // ── Module 12 — Exams & Certification ───────────────────────────────────
  test('M12 Exams: admin creates exam, student books, examiner reports, verify', async ({
    request,
  }) => {
    const a = admin(request);
    const exam = await a.post('/exams/', { data: { kind: 'CEFR', title: 'CEFR Assessment' } });
    examId = idOf(exam);
    await new ApiClient(request).get('/exams/'); // public list

    const s = student(request);
    const elig = await s.get<Record<string, { remaining: number }>>('/exams/eligibility');
    expect(elig.CEFR.remaining).toBeGreaterThanOrEqual(1);

    const booking = await s.post(`/exams/${examId}/book`);
    examBookingId = idOf(booking);

    // Examiner submits the CEFR report -> flips community profile to Verified.
    const ex = client(request, examinerToken);
    const report = await ex.post<{ report_verification_code: string; level: string }>('/exams/report', {
      data: { exam_booking_id: examBookingId, student_id: studentId, level: 'B2' },
    });
    cefrCode = report.report_verification_code;
    expect(report.level).toBe('B2');

    const reports = await s.get<unknown[]>('/exams/my-reports');
    expect(reports.length).toBeGreaterThanOrEqual(1);
    await s.get('/exams/my-certificates');

    const verified = await new ApiClient(request).get<{ valid: boolean; level?: string }>(
      `/exams/verify/${cefrCode}`,
    );
    expect(verified.valid).toBe(true);
  });

  // ── Module 13 — Video Preservation ──────────────────────────────────────
  test('M13 Videos: admin publishes video + category, student watches', async ({ request }) => {
    const a = admin(request);
    const video = await a.post('/videos/', {
      data: {
        title: `E2E Lesson ${uid()}`,
        url: 'https://youtu.be/dQw4w9WgXcQ',
        source: 'youtube',
        access: 'public',
        category: 'general',
      },
    });
    videoId = idOf(video);
    await a.post('/videos/categories', { data: { name: `Cat ${uid()}`, display_order: 1 } });
    await a.get('/videos/categories');

    const s = student(request);
    const list = await s.get<unknown[]>('/videos/');
    expect(list.length).toBeGreaterThanOrEqual(1);
    await s.post(`/videos/${videoId}/watch`, { data: { last_position_s: 12, completed: false } });
    const history = await s.get<unknown[]>('/videos/history');
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  // ── Module 14 — Leads / Free Demo ───────────────────────────────────────
  test('M14 Leads: public books a demo, admin lists + updates it', async ({ request }) => {
    const anon = new ApiClient(request);
    const created = await anon.post<{ id: string }>('/leads/demo', {
      data: { name: 'E2E Lead', phone: '9866666666', interest: 'Spoken English', source: 'website' },
    });
    const leadId = idOf(created);

    const a = admin(request);
    const list = await a.get<{ total: number }>('/leads/', { params: { page: 1, page_size: 25 } });
    expect(list.total).toBeGreaterThanOrEqual(1);
    const updated = await a.patch<{ status: string }>(`/leads/${leadId}`, {
      data: { status: 'contacted', feedback: 'Called, interested.' },
    });
    expect(updated.status).toBe('contacted');
  });

  // ── Module 15 — Analytics & Reports ─────────────────────────────────────
  test('M15 Analytics: summary aggregates + CSV export', async ({ request }) => {
    const a = admin(request);
    const summary = await a.get<{ memberships: { total: number }; payments: { count: number } }>(
      '/analytics/summary',
    );
    expect(summary.memberships.total).toBeGreaterThanOrEqual(1);
    expect(summary.payments.count).toBeGreaterThanOrEqual(1);

    // Exports are raw CSV streams, not envelopes.
    const csv = await a.raw('get', '/analytics/students/export');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    expect(await csv.text()).toContain('student_id');
  });

  // ── Module 16 — Admin Panel ─────────────────────────────────────────────
  test('M16 Admin Panel: overview, students, verification queue, offers, logs', async ({
    request,
  }) => {
    const a = admin(request);
    const overview = await a.get<{ students: number; revenue_paise: number }>('/admin/overview');
    expect(overview.students).toBeGreaterThanOrEqual(1);

    const students = await a.get<{ total: number }>('/admin/students', {
      params: { page: 1, page_size: 25 },
    });
    expect(students.total).toBeGreaterThanOrEqual(1);

    await a.get('/admin/verification-queue');

    const offer = await a.post('/admin/offers', {
      data: {
        title: 'E2E Upgrade Offer',
        body: 'Upgrade to Gold and save.',
        offer_type: 'subscription_upgrade',
        plan: 'Gold',
        amount: 299000,
        active: true,
      },
    });
    expect(idOf(offer)).toBeTruthy();
    await a.get('/admin/offers');

    const logs = await a.get<{ total: number }>('/admin/activity-logs', {
      params: { page: 1, page_size: 50 },
    });
    expect(logs.total).toBeGreaterThanOrEqual(1);
  });
});
