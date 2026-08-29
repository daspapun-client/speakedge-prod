import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, KeyRound, ShieldCheck } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { ApprovePlanModal, Column, DataTable, EmailLink, Modal, StatCard, StatusBadge, StudentAvatar, PhoneLink, fmtDate, rupees, approveMembership } from './_shared';

interface StudentDetail {
  student_id: string;
  full_name: string;
  age?: number | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  dob?: string | null;
  gender?: string | null;
  address?: string | null;
  state?: string | null;
  district?: string | null;
  pin_code?: string | null;
  about_me?: string | null;
  photo_url?: string | null;
  id_proof_url?: string | null;
  id_proof_type?: string | null;
  education_level?: string | null;
  education_proof_url?: string | null;
  guardian_name?: string | null;
  guardian_relationship?: string | null;
  guardian_phone?: string | null;
  guardian_email?: string | null;
  consent_guardian?: boolean;
  referral_code?: string | null;
  /** Kids/Adults section — allocated from age at activation, admin-changeable only. */
  audience?: string;
  teacher_class_locked?: boolean;
  community_locked?: boolean;
  access_lock_reason?: string | null;
  membership_status: string;
  cefr_status: string;
  cefr_level?: string | null;
  reject_reason?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  created_at: string;
  is_archived?: boolean;
  consent_community_rules?: boolean;
  consent_terms?: boolean;
  consent_safety_policy?: boolean;
  consent_non_refund?: boolean;
  consent_process?: boolean;
}

interface CommunityProfile {
  display_name: string;
  bio?: string | null;
  interests?: string[];
  looking_for_partner?: boolean;
  is_suspended?: boolean;
  cefr_level?: string | null;
  cefr_status?: string;
}

interface Subscription {
  id: string;
  plan: string;
  started_at: string;
  expires_at: string;
  is_active: boolean;
  cefr_tests?: number;
  speaking_tests?: number;
}

interface Payment {
  id: string;
  kind: string;
  plan?: string | null;
  amount: number;
  status: string;
  payment_mode?: string | null;
  created_at: string;
}

interface BookOrder {
  id: string;
  order_number: string;
  status: string;
  amount: number;
  courier_name?: string | null;
  tracking_number?: string | null;
  created_at: string;
}

interface ExamBooking {
  id: string;
  exam_id: string;
  status: string;
  created_at: string;
}

interface CEFRReport {
  id: string;
  level: string;
  verification_code: string;
  report_url?: string | null;
}

interface Certificate {
  id: string;
  title: string;
  verification_code: string;
  certificate_url?: string | null;
  issued_at: string;
}

interface SafetyCard {
  id: string;
  card_type: string;
  reason: string;
  issued_by: string;
  created_at: string;
}

interface CommunityReport {
  id: string;
  reporter_student_id: string;
  reason: string;
  status: string;
  created_at: string;
}

interface Team {
  id: string;
  name: string;
  owner_student_id: string;
  member_ids: string[];
}

interface ActivityEntry {
  id: string;
  actor: string;
  action: string;
  created_at: string;
}

interface VideoView {
  id: string;
  video_id: string;
  title: string;
  category?: string | null;
  watched_at?: string | null;
  last_position_s?: number | null;
  completed?: boolean | null;
  view_count?: number;
}

interface VideoSummary {
  videos_watched: number;
  completed: number;
  total_views: number;
}

interface ProfileData {
  student: StudentDetail;
  login: { username?: string | null; is_active?: boolean | null; last_login_at?: string | null };
  community?: CommunityProfile | null;
  friends_count: number;
  teams: Team[];
  active_subscription?: Subscription | null;
  subscriptions: Subscription[];
  payments: Payment[];
  total_paid_paise: number;
  book_orders: BookOrder[];
  exam_bookings: ExamBooking[];
  cefr_reports: CEFRReport[];
  certificates: Certificate[];
  safety_cards: SafetyCard[];
  reports_against: CommunityReport[];
  activity: ActivityEntry[];
  video_views: VideoView[];
  video_summary: VideoSummary;
}

function membershipBadgeClass(status: string) {
  if (status === 'Active') return 'bg-green-100 text-green-700';
  if (status === 'Rejected') return 'bg-red-100 text-red-700';
  if (status === 'Suspended') return 'bg-slate-200 text-slate-700';
  return 'bg-amber-100 text-amber-700';
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value ?? '—'}</dd>
    </div>
  );
}

function ConsentPill({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <span className={`badge ${ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {ok ? '✓' : '✕'} {label}
    </span>
  );
}

interface ClassStart {
  class_start_date: string | null;
  suggested_class_start_date: string | null;
  effective_anchor: string;
  started_at: string;
  due_dates: string[];
}

const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

/**
 * Course type, the two access locks, and the date the monthly fee is counted
 * from. All three are admin-only decisions that the student cannot change.
 */
function CourseAndAccessSection({ student, onChanged }: { student: StudentDetail; onChanged: () => void }) {
  const [reason, setReason] = useState(student.access_lock_reason ?? '');
  const [classStart, setClassStart] = useState<string>('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const { data: billing } = useQuery({
    queryKey: ['admin-class-start', student.student_id],
    queryFn: () => unwrap<ClassStart>(api.get(`/payments/admin/class-start/${student.student_id}`)),
    // 404s for a student with no active subscription — that is a normal state.
    retry: false,
  });

  useEffect(() => {
    setClassStart(dateInput(billing?.class_start_date));
  }, [billing?.class_start_date]);

  const setAccess = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      unwrap<StudentDetail>(api.post(`/admin/students/${student.student_id}/access`, body)),
    onSuccess: (_d, body) => {
      setErr('');
      setMsg(
        (body.teacher_class_locked ?? student.teacher_class_locked) ||
        (body.community_locked ?? student.community_locked)
          ? 'Access updated.'
          : 'All access restored.',
      );
      onChanged();
    },
    onError: (e: Error) => { setMsg(''); setErr(e.message); },
  });

  const setCourse = useMutation({
    mutationFn: (audience: string) =>
      unwrap(api.patch(`/admin/students/${student.student_id}`, { audience })),
    onSuccess: () => { setErr(''); setMsg('Course updated.'); onChanged(); },
    onError: (e: Error) => { setMsg(''); setErr(e.message); },
  });

  const saveClassStart = useMutation({
    mutationFn: () =>
      unwrap(api.post(`/payments/admin/class-start/${student.student_id}`, {
        class_start_date: classStart || null,
      })),
    onSuccess: () => { setErr(''); setMsg('Class start date saved.'); onChanged(); },
    onError: (e: Error) => { setMsg(''); setErr(e.message); },
  });

  const locked = student.teacher_class_locked || student.community_locked;

  return (
    <Section title="Course & access">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Course</h3>
          <p className="mt-1 text-sm text-slate-500">
            Kids and Adults are separate courses with separate prompt libraries. It is set by the
            activation code and the student cannot change it.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <select
              className="input max-w-[12rem]"
              value={student.audience ?? 'adults'}
              onChange={(e) => setCourse.mutate(e.target.value)}
              disabled={setCourse.isPending}
            >
              <option value="adults">Adults</option>
              <option value="kids">Kids</option>
            </select>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Access locks</h3>
          <p className="mt-1 text-sm text-slate-500">
            The account stays usable — only the locked area is blocked.
          </p>
          <div className="mt-3 space-y-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-brand"
                checked={!!student.teacher_class_locked}
                disabled={setAccess.isPending}
                onChange={(e) =>
                  setAccess.mutate({ teacher_class_locked: e.target.checked, reason: reason.trim() || undefined })
                }
              />
              Lock teacher-led classes
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-brand"
                checked={!!student.community_locked}
                disabled={setAccess.isPending}
                onChange={(e) =>
                  setAccess.mutate({ community_locked: e.target.checked, reason: reason.trim() || undefined })
                }
              />
              Lock community access
            </label>
            <input
              className="input"
              placeholder="Reason (shown to the student)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => locked && setAccess.mutate({
                teacher_class_locked: !!student.teacher_class_locked,
                community_locked: !!student.community_locked,
                reason: reason.trim() || undefined,
              })}
            />
          </div>
        </div>

        <div className="lg:col-span-2 border-t border-slate-100 pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Monthly fee — class start date
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            The monthly fee is counted from the student&apos;s first teacher-led scheduled class. The
            first month falls due one calendar month after this date. Leave it empty to fall back to
            the subscription start date.
          </p>
          {!billing ? (
            <p className="mt-3 text-sm text-slate-500">No active subscription — nothing to bill yet.</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="label">Class start date</label>
                  <input
                    type="date"
                    className="input"
                    value={classStart}
                    onChange={(e) => setClassStart(e.target.value)}
                  />
                </div>
                {billing.suggested_class_start_date && (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setClassStart(dateInput(billing.suggested_class_start_date))}
                  >
                    Use first scheduled class ({fmtDate(billing.suggested_class_start_date)})
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => saveClassStart.mutate()}
                  disabled={saveClassStart.isPending}
                >
                  {saveClassStart.isPending ? 'Saving…' : 'Save'}
                </button>
              </div>
              <p className="mt-3 text-sm text-slate-500">
                Counting from <span className="font-semibold">{fmtDate(billing.effective_anchor)}</span>
                {billing.class_start_date ? ' (class start date)' : ' (subscription start — no class date set)'}.
                {billing.due_dates.length > 0 && (
                  <> Next due dates: {billing.due_dates.slice(0, 3).map((d) => fmtDate(d)).join(', ')}
                    {billing.due_dates.length > 3 ? '…' : ''}</>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      {msg && <p className="mt-4 text-sm text-green-600">{msg}</p>}
      {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
    </Section>
  );
}

function fmtDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function ResetPasswordModal({
  studentId,
  studentName,
  onClose,
  onDone,
}: {
  studentId: string;
  studentName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const act = useMutation({
    mutationFn: () => {
      if (pw.length < 6) throw new Error('Password must be at least 6 characters');
      if (pw !== confirm) throw new Error('Passwords do not match');
      return unwrap(api.post('/admin/users/reset-password', { username: studentId, new_password: pw }));
    },
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Reset password</h2>
        <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      <p className="mt-2 text-sm text-slate-500">Set a new login password for {studentName}. Share it with them directly — it is not emailed.</p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => { e.preventDefault(); act.mutate(); }}
      >
        <div>
          <label className="label" htmlFor="reset-pw">New password</label>
          <input id="reset-pw" className="input" type="password" autoComplete="new-password" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="reset-pw-confirm">Confirm password</label>
          <input id="reset-pw-confirm" className="input" type="password" autoComplete="new-password" minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={act.isPending}>
            {act.isPending ? 'Saving…' : 'Update password'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminStudentProfile() {
  const { studentId = '' } = useParams();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/admin/students');
  };
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [pwOk, setPwOk] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const [choosingPlan, setChoosingPlan] = useState(false);
  const [resettingPw, setResettingPw] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-student-profile', studentId],
    queryFn: () => unwrap<ProfileData>(api.get(`/admin/students/${studentId}/profile`)),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-student-profile', studentId] });
    qc.invalidateQueries({ queryKey: ['admin-students'] });
    qc.invalidateQueries({ queryKey: ['verification-queue'] });
  };

  const approve = useMutation({
    mutationFn: (plan: string) => approveMembership(studentId, plan),
    onSuccess: () => { setError(''); setChoosingPlan(false); invalidate(); refetch(); },
    onError: (e: Error) => setError(e.message),
  });

  const archive = useMutation({
    mutationFn: () =>
      unwrap(api.post(`/admin/students/${studentId}/archive`, null, { params: { reason: archiveReason.trim() } })),
    onSuccess: () => { setError(''); setArchiveReason(''); invalidate(); refetch(); },
    onError: (e: Error) => setError(e.message),
  });

  const blockLogin = useMutation({
    mutationFn: ({ active }: { active: boolean }) =>
      unwrap(api.post(`/admin/users/${studentId}/${active ? 'unblock' : 'block'}`, active ? undefined : { reason: 'Blocked by admin' })),
    onSuccess: () => { setError(''); invalidate(); refetch(); },
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => { setError(''); setPwOk(''); }, [studentId]);

  if (isLoading || !data) {
    return (
      <div className="card">
        <p className="text-slate-500">{isLoading ? 'Loading profile…' : 'Student not found.'}</p>
        <button type="button" onClick={goBack} className="btn-ghost mt-4 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>
    );
  }

  const s = data.student;
  const c = data.community;
  const canApprove = s.membership_status === 'Pending Verification';

  const paymentCols: Column<Payment>[] = [
    { key: 'created_at', header: 'Date', sort: (p) => p.created_at, cell: (p) => fmtDate(p.created_at) },
    { key: 'kind', header: 'Type', cell: (p) => <span className="capitalize">{p.kind}</span> },
    { key: 'plan', header: 'Plan', cell: (p) => p.plan ?? '—' },
    { key: 'amount', header: 'Amount', align: 'right', sort: (p) => p.amount, cell: (p) => rupees(p.amount) },
    { key: 'payment_mode', header: 'Mode', cell: (p) => p.payment_mode ?? '—' },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
  ];

  const orderCols: Column<BookOrder>[] = [
    { key: 'order_number', header: 'Order #', cell: (o) => <span className="font-mono text-xs">{o.order_number}</span> },
    { key: 'created_at', header: 'Date', sort: (o) => o.created_at, cell: (o) => fmtDate(o.created_at) },
    { key: 'amount', header: 'Amount', align: 'right', sort: (o) => o.amount, cell: (o) => rupees(o.amount) },
    { key: 'tracking_number', header: 'Tracking', cell: (o) => o.tracking_number ?? '—' },
    { key: 'status', header: 'Status', cell: (o) => <StatusBadge status={o.status} /> },
  ];

  const subCols: Column<Subscription>[] = [
    { key: 'plan', header: 'Plan', cell: (x) => <span className="font-semibold">{x.plan}</span> },
    { key: 'started_at', header: 'Started', sort: (x) => x.started_at, cell: (x) => fmtDate(x.started_at) },
    { key: 'expires_at', header: 'Expires', sort: (x) => x.expires_at, cell: (x) => fmtDate(x.expires_at) },
    { key: 'is_active', header: 'Active', cell: (x) => <StatusBadge status={x.is_active ? 'Active' : 'Expired'} /> },
  ];

  const videoCols: Column<VideoView>[] = [
    { key: 'title', header: 'Video', sort: (v) => v.title, cell: (v) => <span className="font-semibold">{v.title}</span> },
    { key: 'category', header: 'Category', sort: (v) => v.category ?? '', cell: (v) => v.category ?? '—' },
    {
      key: 'watched_at',
      header: 'Last watched',
      sort: (v) => v.watched_at ?? '',
      cell: (v) => <span className="text-slate-500">{v.watched_at ? fmtDate(v.watched_at) : '—'}</span>,
    },
    {
      key: 'status',
      header: 'Viewing status',
      cell: (v) => (
        <div>
          <StatusBadge status={v.completed ? 'Completed' : v.last_position_s ? 'In progress' : 'Started'} />
          {!v.completed && v.last_position_s && v.last_position_s > 0 ? (
            <span className="mt-0.5 block text-xs text-slate-500">Stopped at {fmtDuration(v.last_position_s)}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'view_count',
      header: 'Views',
      align: 'right',
      sort: (v) => v.view_count ?? 1,
      cell: (v) => v.view_count ?? 1,
    },
  ];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {/* Header */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <StudentAvatar
              photoUrl={s.photo_url}
              gender={s.gender}
              name={s.full_name}
              size="h-20 w-20"
              iconSize={32}
            />
            <div>
              <h1 className="text-2xl font-extrabold">{s.full_name}</h1>
              <p className="font-mono text-sm text-slate-500">{s.student_id}</p>
              <p className="text-xs text-slate-400">Joined {fmtDate(s.created_at)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`badge ${membershipBadgeClass(s.membership_status)}`}>{s.membership_status}</span>
                <span className="badge bg-slate-100 text-slate-600">{s.cefr_status}</span>
                {s.cefr_level && <span className="badge bg-slate-100 text-slate-600">Level {s.cefr_level}</span>}
                {s.is_archived && <span className="badge bg-purple-100 text-purple-700">Archived</span>}
                {data.login.is_active === false && <span className="badge bg-red-100 text-red-700">Login blocked</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canApprove && (
              <button
                className="btn-primary"
                disabled={approve.isPending}
                onClick={() => { setError(''); setChoosingPlan(true); }}
              >
                Approve membership
              </button>
            )}
            {data.login.is_active != null && (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => { setError(''); setPwOk(''); setResettingPw(true); }}
                >
                  <KeyRound className="mr-1 inline h-4 w-4" />
                  Reset password
                </button>
                {data.login.is_active === false ? (
                  <button
                    type="button"
                    className="btn-ghost text-green-700"
                    disabled={blockLogin.isPending}
                    onClick={() => {
                      if (window.confirm(`Unblock ${s.full_name}? They will be able to log in again.`)) {
                        blockLogin.mutate({ active: true });
                      }
                    }}
                  >
                    <ShieldCheck className="mr-1 inline h-4 w-4" />
                    Unblock login
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost text-red-600"
                    disabled={blockLogin.isPending}
                    onClick={() => {
                      if (window.confirm(`Block ${s.full_name}? They will not be able to log in.`)) {
                        blockLogin.mutate({ active: false });
                      }
                    }}
                  >
                    <Ban className="mr-1 inline h-4 w-4" />
                    Block login
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        {pwOk && <p className="mt-3 text-sm text-green-600">{pwOk}</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* Stat row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total paid" value={rupees(data.total_paid_paise)} hint={`${data.payments.length} payment(s)`} />
        <StatCard label="Subscription" value={data.active_subscription?.plan ?? 'None'}
          hint={data.active_subscription ? `Expires ${fmtDate(data.active_subscription.expires_at)}` : undefined} />
        <StatCard label="Friends" value={data.friends_count} hint={`${data.teams.length} team(s)`} />
        <StatCard label="Certificates" value={data.certificates.length} hint={`${data.exam_bookings.length} exam booking(s)`} />
      </div>

      {/* Personal + Community */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Personal details">
          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Email" value={<EmailLink email={s.email} />} />
            <DetailRow label="Phone" value={<PhoneLink phone={s.phone} />} />
            <DetailRow label="WhatsApp" value={<PhoneLink phone={s.whatsapp} />} />
            <DetailRow label="Date of birth" value={s.dob} />
            <DetailRow label="Age (derived)" value={s.age} />
            <DetailRow label="Gender" value={s.gender} />
            <DetailRow label="Academic background" value={s.education_level} />
            <DetailRow label="Referral code" value={s.referral_code} />
            <DetailRow label="Login username" value={data.login.username} />
            <DetailRow label="Login active" value={data.login.is_active == null ? '—' : data.login.is_active ? 'Yes' : 'No'} />
            <DetailRow label="Last login" value={data.login.last_login_at ? fmtDate(data.login.last_login_at) : '—'} />
            <DetailRow label="Verified" value={
              s.verified_at ? `${fmtDate(s.verified_at)}${s.verified_by ? ` by ${s.verified_by}` : ''}` : '—'
            } />
          </dl>
          <div className="mt-4">
            <DetailRow label="Address" value={
              [s.address, s.district, s.state, s.pin_code].filter(Boolean).join(', ') || '—'
            } />
          </div>
          {s.about_me && <div className="mt-4"><DetailRow label="About" value={s.about_me} /></div>}
          {s.reject_reason && (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">Reject reason: {s.reject_reason}</p>
          )}
          {/* Verification documents — admin-only, never exposed to members. */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <DetailRow
              label="Identity proof (private)"
              value={
                <span>
                  {s.id_proof_type ?? '—'}
                  {s.id_proof_url && (
                    <a href={s.id_proof_url} target="_blank" rel="noreferrer" className="ml-2 text-brand underline">
                      View document
                    </a>
                  )}
                </span>
              }
            />
            <DetailRow
              label="Academic proof (private)"
              value={
                s.education_proof_url ? (
                  <a href={s.education_proof_url} target="_blank" rel="noreferrer" className="text-brand underline">
                    View document
                  </a>
                ) : '—'
              }
            />
          </div>
          {s.guardian_name && (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Parent / legal guardian
              </h3>
              <dl className="mt-2 grid gap-3 sm:grid-cols-2">
                <DetailRow label="Name" value={s.guardian_name} />
                <DetailRow label="Relationship" value={s.guardian_relationship} />
                <DetailRow label="Mobile" value={<PhoneLink phone={s.guardian_phone} />} />
                <DetailRow label="Email" value={<EmailLink email={s.guardian_email} />} />
              </dl>
            </div>
          )}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Consents</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              <ConsentPill label="Community rules" ok={s.consent_community_rules} />
              <ConsentPill label="Terms" ok={s.consent_terms} />
              <ConsentPill label="Safety" ok={s.consent_safety_policy} />
              <ConsentPill label="Non-refund" ok={s.consent_non_refund} />
              <ConsentPill label="Process" ok={s.consent_process} />
              {s.guardian_name && <ConsentPill label="Guardian" ok={s.consent_guardian} />}
            </div>
          </div>
        </Section>

        <Section title="Community profile">
          {c ? (
            <>
              <dl className="grid gap-4 sm:grid-cols-2">
                <DetailRow label="Display name" value={c.display_name} />
                <DetailRow label="CEFR" value={`${c.cefr_status ?? '—'}${c.cefr_level ? ` · ${c.cefr_level}` : ''}`} />
                <DetailRow label="Looking for partner" value={c.looking_for_partner ? 'Yes' : 'No'} />
                <DetailRow label="Suspended" value={c.is_suspended ? 'Yes' : 'No'} />
              </dl>
              {c.bio && <div className="mt-4"><DetailRow label="Bio" value={c.bio} /></div>}
              <div className="mt-4">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Interests</dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  {c.interests?.length
                    ? c.interests.map((i) => <span key={i} className="badge bg-slate-100 text-slate-600">{i}</span>)
                    : <span className="text-sm text-slate-500">—</span>}
                </dd>
              </div>
              {data.teams.length > 0 && (
                <div className="mt-4">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Speaking teams</dt>
                  <dd className="mt-1 space-y-1">
                    {data.teams.map((t) => (
                      <div key={t.id} className="text-sm text-slate-700">
                        {t.name}
                        <span className="ml-2 text-xs text-slate-400">
                          {t.owner_student_id === s.student_id ? 'Owner' : 'Member'} · {t.member_ids.length} members
                        </span>
                      </div>
                    ))}
                  </dd>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">No community profile.</p>
          )}
        </Section>
      </div>

      {/* Course, access locks and the monthly-billing anchor */}
      <CourseAndAccessSection student={s} onChanged={() => { invalidate(); refetch(); }} />

      {/* Subscriptions */}
      <Section title="Subscriptions">
        <DataTable rows={data.subscriptions} columns={subCols} rowKey={(x) => x.id}
          emptyLabel="No subscriptions." initialSort={{ key: 'started_at', dir: 'desc' }} pageSize={5} />
      </Section>

      {/* Payments */}
      <Section title="Payments">
        <DataTable rows={data.payments} columns={paymentCols} rowKey={(p) => p.id}
          emptyLabel="No payments." initialSort={{ key: 'created_at', dir: 'desc' }} pageSize={5} />
      </Section>

      {/* Book orders */}
      <Section title="Book orders">
        <DataTable rows={data.book_orders} columns={orderCols} rowKey={(o) => o.id}
          emptyLabel="No book orders." initialSort={{ key: 'created_at', dir: 'desc' }} pageSize={5} />
      </Section>

      {/* Video viewing */}
      <Section
        title="Video viewing"
        action={
          data.video_summary.videos_watched > 0 ? (
            <span className="text-xs text-slate-500">
              {data.video_summary.videos_watched} video{data.video_summary.videos_watched === 1 ? '' : 's'} ·{' '}
              {data.video_summary.completed} completed · {data.video_summary.total_views} view
              {data.video_summary.total_views === 1 ? '' : 's'}
            </span>
          ) : undefined
        }
      >
        <DataTable
          rows={data.video_views}
          columns={videoCols}
          rowKey={(v) => v.id}
          emptyLabel="No videos watched yet."
          initialSort={{ key: 'watched_at', dir: 'desc' }}
          pageSize={5}
          searchText={(v) => [v.title, v.category].filter(Boolean).join(' ')}
          searchPlaceholder="Search videos"
        />
      </Section>

      {/* Exams & certificates */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Exams & CEFR reports">
          {data.exam_bookings.length === 0 && data.cefr_reports.length === 0 ? (
            <p className="text-sm text-slate-500">No exam activity.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.exam_bookings.map((e) => (
                <div key={e.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span>Booking · {fmtDate(e.created_at)}</span>
                  <StatusBadge status={e.status} />
                </div>
              ))}
              {data.cefr_reports.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span>CEFR {r.level} · <span className="font-mono text-xs">{r.verification_code}</span></span>
                  {r.report_url && <a href={r.report_url} target="_blank" rel="noreferrer" className="text-brand underline">Report</a>}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Certificates">
          {data.certificates.length === 0 ? (
            <p className="text-sm text-slate-500">No certificates.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {data.certificates.map((cert) => (
                <div key={cert.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                  <span>{cert.title} · <span className="font-mono text-xs">{cert.verification_code}</span></span>
                  {cert.certificate_url && <a href={cert.certificate_url} target="_blank" rel="noreferrer" className="text-brand underline">View</a>}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Safety & reports */}
      {(data.safety_cards.length > 0 || data.reports_against.length > 0) && (
        <Section title="Safety & moderation">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Safety cards</h3>
              <div className="mt-2 space-y-2 text-sm">
                {data.safety_cards.length ? data.safety_cards.map((card) => (
                  <div key={card.id} className="rounded-lg bg-red-50 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold capitalize">{card.card_type.replace('_', ' ')}</span>
                      <span className="text-xs text-slate-400">{fmtDate(card.created_at)}</span>
                    </div>
                    <p className="text-slate-600">{card.reason}</p>
                  </div>
                )) : <p className="text-slate-500">None.</p>}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reports against</h3>
              <div className="mt-2 space-y-2 text-sm">
                {data.reports_against.length ? data.reports_against.map((r) => (
                  <div key={r.id} className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-slate-400">{fmtDate(r.created_at)}</span>
                    </div>
                    <p className="text-slate-600">{r.reason}</p>
                  </div>
                )) : <p className="text-slate-500">None.</p>}
              </div>
            </div>
          </div>
        </Section>
      )}

      {/* Activity */}
      <Section title="Recent activity">
        {data.activity.length === 0 ? (
          <p className="text-sm text-slate-500">No activity logged.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.activity.map((a) => (
              <li key={a.id} className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span><span className="font-mono text-xs text-slate-500">{a.action}</span> by {a.actor}</span>
                <span className="text-xs text-slate-400">{fmtDate(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Archive */}
      {!s.is_archived && (
        <Section title="Archive student">
          <p className="text-xs text-slate-500">Soft-deletes the record with a 60-day retention period.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[16rem] flex-1">
              <label className="label">Reason</label>
              <input className="input" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)}
                placeholder="Why is this student being archived?" />
            </div>
            <button
              className="btn-ghost border-red-200 text-red-600 hover:bg-red-50"
              disabled={archive.isPending || !archiveReason.trim()}
              onClick={() => {
                if (!window.confirm(`Archive ${s.full_name}?`)) return;
                setError('');
                archive.mutate();
              }}
            >
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </button>
          </div>
        </Section>
      )}
      {choosingPlan && (
        <ApprovePlanModal
          studentName={s.full_name}
          suggestedPlan={data.active_subscription?.plan}
          busy={approve.isPending}
          error={error}
          onClose={() => setChoosingPlan(false)}
          onConfirm={(plan) => approve.mutate(plan)}
        />
      )}
      {resettingPw && (
        <ResetPasswordModal
          studentId={studentId}
          studentName={s.full_name}
          onClose={() => setResettingPw(false)}
          onDone={() => setPwOk('Password updated.')}
        />
      )}
    </div>
  );
}
