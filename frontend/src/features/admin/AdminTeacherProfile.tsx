import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Ban, ShieldCheck, Star } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { batchTimeLabel } from '@/features/batch/shared';
import { AdminStudentLink, Column, DataTable, EmailLink, Modal, Paginator, PhoneLink, StatCard, StatusBadge, fmtDate, rupees } from './_shared';

interface Teacher {
  id: string;
  teacher_id?: string | null;
  name: string;
  email?: string | null;
  phone: string;
  whatsapp?: string | null;
  city?: string | null;
  qualification?: string | null;
  cefr_level?: string | null;
  experience?: string | null;
  photo_url?: string | null;
  status: string;
  certified?: boolean;
  public_visible?: boolean;
  bio?: string | null;
  username?: string | null;
  created_at: string;
}

interface BatchRow {
  id: string;
  title: string;
  day_of_week?: string | null;
  date?: string | null;
  class_time?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  schedule?: string | null;
  student_count: number;
  pending_count: number;
  created_at: string;
  attendance_submitted_dates?: string[];
  classes_pending?: number;
  meeting_active?: boolean;
  meeting_url?: string | null;
  meeting_forced?: boolean;
  feedback_submitted?: number;
  feedback_pending?: number;
  average_rating?: number | null;
}

interface ClassRow {
  id: string;
  batch_title: string;
  date: string;
  class_time?: string | null;
  present_count: number;
  absent_count: number;
  status: string;
  batch_status: string;
  remuneration_id?: string | null;
  remuneration_paise: number;
  remuneration_status?: string | null;
}

interface PaymentRow {
  id: string;
  period: string;
  amount: number;
  status: string;
  created_at: string;
}

interface ReviewRow {
  rating?: number | null;
  feedback?: string | null;
  class_date?: string | null;
  student_id: string;
  student_name?: string | null;
  batch_title?: string | null;
}

interface ActivityEntry {
  id: string;
  actor: string;
  role?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  meta?: Record<string, unknown>;
  created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  'teacher.approve': 'certified the teacher',
  'teacher.update': 'updated teacher profile',
  'batch.create': 'created a batch',
  'batch.update': 'edited batch details',
  'batch.delete': 'deleted a batch',
  'batch.meeting_link': 'updated the meeting link',
  'batch.meeting_live': 'started a live session',
  'batch.meeting_end': 'ended the live session',
  'batch.students_add': 'added students',
  'batch.student_remove': 'removed a student',
  'batch.join_request': 'requested to join',
  'batch.join_approve': 'approved a join request',
  'batch.join_reject': 'declined a join request',
  'attendance.submit': 'submitted attendance',
  'attendance.approve': 'approved attendance',
  'attendance.reject': 'rejected attendance',
  'remuneration.credit': 'credited class pay',
};

function activityDetail(
  e: ActivityEntry,
  names: Record<string, string>,
  batches: Record<string, string>,
): string {
  const m = e.meta || {};
  const name = (id: unknown) => (typeof id === 'string' ? names[id] || id : '');
  const batch = e.target_type === 'batch' && e.target_id ? batches[e.target_id] : '';
  const prefix = batch ? `${batch} · ` : '';
  switch (e.action) {
    case 'teacher.update':
      return Array.isArray(m.fields) && m.fields.length ? `(${(m.fields as string[]).join(', ')})` : '';
    case 'teacher.approve':
      return m.teacher_id ? `(${m.teacher_id})` : '';
    case 'batch.update':
      return prefix + (Array.isArray(m.fields) && m.fields.length ? `(${(m.fields as string[]).join(', ')})` : '');
    case 'batch.students_add':
      return prefix + `(${Array.isArray(m.student_ids) ? (m.student_ids as string[]).map(name).join(', ') : m.count})`;
    case 'batch.student_remove':
    case 'batch.join_request':
    case 'batch.join_approve':
    case 'batch.join_reject':
      return prefix + (name(m.student_id) ? name(m.student_id) : '');
    case 'attendance.submit':
      return prefix + `for ${m.date} · ${m.present} present, ${m.absent} absent`;
    case 'attendance.approve':
      return prefix + `for ${m.date}${m.remuneration_paise ? ` · ₹${Number(m.remuneration_paise) / 100}` : ''}`;
    case 'attendance.reject':
    case 'remuneration.credit':
      return prefix + `for ${m.date}${m.remuneration_paise ? ` · ₹${Number(m.remuneration_paise) / 100}` : ''}`;
    default:
      return prefix.replace(/ · $/, '');
  }
}

function TeacherActivityLog({ teacherId }: { teacherId: string }) {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, isLoading } = useQuery({
    queryKey: ['admin-teacher-activity', teacherId, page],
    queryFn: () => unwrap<{
      items: ActivityEntry[];
      total: number;
      batch_titles: Record<string, string>;
      student_names: Record<string, string>;
    }>(api.get(`/teacher/${teacherId}/activity`, { params: { page, page_size: pageSize } })),
  });
  const names = data?.student_names ?? {};
  const batches = data?.batch_titles ?? {};

  return (
    <Section title="Activity log">
      <p className="-mt-2 text-xs text-slate-500">
        Every admin, teacher and student action linked to this teacher or their batches, most recent first.
      </p>
      <div className="mt-4 space-y-2">
        {isLoading && <p className="text-sm text-slate-400">Loading activity…</p>}
        {!isLoading && !data?.items.length && <p className="text-sm text-slate-500">No activity logged yet.</p>}
        {data?.items.map((e) => (
          <div key={e.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/40 px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{e.actor}</span>
              {e.role && <span className="badge ml-1 bg-slate-100 text-slate-500">{e.role}</span>}
              <span className="ml-1 text-slate-600">{ACTION_LABELS[e.action] || e.action}</span>{' '}
              <span className="text-slate-400">{activityDetail(e, names, batches)}</span>
            </div>
            <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">{fmtDate(e.created_at)}</span>
          </div>
        ))}
      </div>
      {(data?.total ?? 0) > pageSize && (
        <div className="mt-4">
          <Paginator page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />
        </div>
      )}
    </Section>
  );
}

interface ProfileData {
  teacher: Teacher;
  login: { username?: string | null; is_active?: boolean | null; last_login_at?: string | null } | null;
  batches: BatchRow[];
  classes: ClassRow[];
  payments: PaymentRow[];
  reviews: ReviewRow[];
  stats: {
    batch_count: number;
    classes_conducted: number;
    classes_pending: number;
    students_taught: number;
    pending_paise: number;
    paid_paise: number;
    received_paise: number;
    total_paise: number;
    average_rating?: number | null;
    review_count: number;
  };
}

function statusBadgeClass(status: string) {
  if (status === 'approved') return 'bg-green-100 text-green-700';
  if (status === 'rejected') return 'bg-red-100 text-red-700';
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

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-brand-gold">
      {Array.from({ length: 5 }).map((_, n) => (
        <Star key={n} size={14} fill={n < rating ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

function ReviewClassModal({
  row,
  onClose,
  onDone,
}: {
  row: ClassRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const act = useMutation({
    mutationFn: (action: 'approve' | 'reject') => unwrap(api.post(`/teacher/attendance/${row.id}/review`, {
      action,
      remuneration_paise: action === 'approve' && amount ? Math.round(Number(amount) * 100) : 0,
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Review class attendance</h2>
        <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3 text-sm">
        <div>{row.batch_title} · {row.date}{row.class_time ? ` · ${row.class_time}` : ''}</div>
        <div className="text-slate-500">Present {row.present_count} · Absent {row.absent_count}</div>
        <div>
          <label className="label">Pay on approval (₹)</label>
          <input className="input" type="number" min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
        </div>
        <p className="text-xs text-slate-400">Approving credits pay and sends a review request to every present student.</p>
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={act.isPending} onClick={() => act.mutate('approve')}>Approve & credit pay</button>
          <button type="button" className="btn-ghost text-red-600" disabled={act.isPending} onClick={() => act.mutate('reject')}>Reject</button>
        </div>
      </div>
    </Modal>
  );
}

function CreditPayModal({
  row,
  onClose,
  onDone,
}: {
  row: ClassRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const act = useMutation({
    mutationFn: () => unwrap(api.post(`/teacher/attendance/${row.id}/credit-remuneration`, {
      amount_paise: Math.round(Number(amount) * 100),
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Credit class pay</h2>
        <button type="button" className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3 text-sm">
        <div>{row.batch_title} · {row.date}{row.class_time ? ` · ${row.class_time}` : ''}</div>
        <div>
          <label className="label">Amount (₹)</label>
          <input className="input" type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" disabled={act.isPending || !amount || Number(amount) <= 0} onClick={() => act.mutate()}>Credit pay</button>
      </div>
    </Modal>
  );
}

export function AdminTeacherProfile() {
  const { teacherId = '' } = useParams();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/admin/teachers');
  };

  const qc = useQueryClient();
  const [reviewClass, setReviewClass] = useState<ClassRow | null>(null);
  const [creditClass, setCreditClass] = useState<ClassRow | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-teacher-profile', teacherId],
    queryFn: () => unwrap<ProfileData>(api.get(`/teacher/${teacherId}/profile`)),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-teacher-profile', teacherId] });

  const confirmReceived = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/confirm-received`)),
    onSuccess: invalidate,
  });

  const markPaid = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/mark-paid`)),
    onSuccess: invalidate,
  });

  const blockLogin = useMutation({
    mutationFn: ({ username, active }: { username: string; active: boolean }) =>
      unwrap(api.post(`/admin/users/${username}/${active ? 'unblock' : 'block'}`, active ? undefined : { reason: 'Blocked by admin' })),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['admin-teachers'] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="card">
        <p className="text-slate-500">{isLoading ? 'Loading teacher…' : 'Teacher not found.'}</p>
        <button type="button" onClick={goBack} className="btn-ghost mt-4 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>
    );
  }

  const t = data.teacher;
  const s = data.stats;

  const batchCols: Column<BatchRow>[] = [
    { key: 'title', header: 'Batch', sort: (b) => b.title, cell: (b) => (
      <Link to={`/admin/batches/${b.id}`} className="font-semibold text-brand hover:underline">{b.title}</Link>
    ) },
    {
      key: 'type',
      header: 'Type',
      sort: (b) => (b.date ? 1 : 0),
      cell: (b) => (
        b.date
          ? <span className="badge bg-slate-100 text-slate-600">One-time</span>
          : b.day_of_week
            ? <span className="badge bg-brand/10 text-brand">Weekly</span>
            : <span className="text-slate-400">—</span>
      ),
    },
    {
      key: 'schedule',
      header: 'Schedule',
      sort: (b) => `${b.date ?? ''}${b.day_of_week ?? ''}${batchTimeLabel(b) ?? ''}`,
      cell: (b) => {
        const time = batchTimeLabel(b);
        const dayOrDate = b.date ? `${b.date} (once)` : b.day_of_week;
        const line = [dayOrDate, time].filter(Boolean).join(' · ');
        return (
          <div>
            <span className="text-slate-700">{line || '—'}</span>
            {b.schedule && <p className="mt-0.5 text-xs text-slate-400">{b.schedule}</p>}
          </div>
        );
      },
    },
    { key: 'student_count', header: 'Students', align: 'right', sort: (b) => b.student_count, cell: (b) => b.student_count },
    {
      key: 'pending_count',
      header: 'Join reqs',
      align: 'right',
      sort: (b) => b.pending_count,
      cell: (b) => (b.pending_count ? <span className="font-semibold text-amber-600">{b.pending_count}</span> : '—'),
    },
    {
      key: 'classes',
      header: 'Classes',
      align: 'right',
      sort: (b) => b.attendance_submitted_dates?.length ?? 0,
      cell: (b) => {
        const total = b.attendance_submitted_dates?.length ?? 0;
        const pending = b.classes_pending ?? 0;
        return (
          <div className="text-right">
            <span className="font-medium">{total}</span>
            {pending > 0 && <p className="text-xs text-amber-600">{pending} pending review</p>}
          </div>
        );
      },
    },
    {
      key: 'meet',
      header: 'Meet',
      sort: (b) => (b.meeting_active ? 2 : b.meeting_url ? 1 : 0),
      cell: (b) => {
        if (b.meeting_active) return <span className="badge bg-green-100 text-green-700">Live</span>;
        if (b.meeting_url) return <span className="text-slate-600">{b.meeting_forced ? 'Forced' : 'Set'}</span>;
        return <span className="text-slate-400">—</span>;
      },
    },
    {
      key: 'feedback',
      header: 'Feedback',
      cell: (b) => (
        b.feedback_submitted || b.feedback_pending ? (
          <span className="text-slate-600">
            {b.feedback_submitted ?? 0} submitted
            {b.average_rating != null ? ` · ${b.average_rating}★` : ''}
            {(b.feedback_pending ?? 0) > 0 ? <span className="text-slate-400"> · {b.feedback_pending} pending</span> : null}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sort: (b) => b.created_at,
      cell: (b) => <span className="text-slate-500">{fmtDate(b.created_at)}</span>,
    },
  ];

  const classCols: Column<ClassRow>[] = [
    { key: 'batch_title', header: 'Batch', sort: (c) => c.batch_title, cell: (c) => c.batch_title },
    { key: 'date', header: 'Date & time', sort: (c) => c.date, cell: (c) => <>{c.date}{c.class_time ? ` · ${c.class_time}` : ''}</> },
    { key: 'present_count', header: 'Present', align: 'right', sort: (c) => c.present_count, cell: (c) => <span className="font-semibold">{c.present_count}</span> },
    { key: 'absent_count', header: 'Absent', align: 'right', sort: (c) => c.absent_count, cell: (c) => <span className="text-slate-500">{c.absent_count}</span> },
    { key: 'batch_status', header: 'Status', sort: () => 0, cell: () => <span className="badge bg-green-100 text-green-700">Completed</span> },
    { key: 'status', header: 'Review', sort: (c) => c.status, cell: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'remuneration_paise',
      header: 'Pay',
      align: 'right',
      sort: (c) => c.remuneration_paise,
      cell: (c) => (c.remuneration_paise ? <span className="font-semibold">{rupees(c.remuneration_paise)}</span> : <span className="text-slate-400">—</span>),
    },
    {
      key: 'remuneration_status',
      header: 'Pay status',
      sort: (c) => c.remuneration_status ?? '',
      cell: (c) => (c.remuneration_status ? <StatusBadge status={c.remuneration_status} /> : <span className="text-slate-400">—</span>),
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (c) => {
        if (c.status === 'pending') {
          return <button type="button" className="btn-primary py-1 text-xs" onClick={() => setReviewClass(c)}>Review & pay</button>;
        }
        if (c.status === 'approved' && !c.remuneration_id) {
          return <button type="button" className="btn-gold py-1 text-xs" onClick={() => setCreditClass(c)}>Credit pay</button>;
        }
        if (c.remuneration_id && c.remuneration_status === 'pending') {
          return <button type="button" className="btn-gold py-1 text-xs" disabled={markPaid.isPending} onClick={() => markPaid.mutate(c.remuneration_id!)}>Mark paid</button>;
        }
        if (c.remuneration_id && c.remuneration_status === 'paid') {
          return <button type="button" className="btn-ghost py-1 text-xs" disabled={confirmReceived.isPending} onClick={() => confirmReceived.mutate(c.remuneration_id!)}>Confirm received</button>;
        }
        return null;
      },
    },
  ];

  const payCols: Column<PaymentRow>[] = [
    { key: 'period', header: 'Period', sort: (p) => p.period, cell: (p) => p.period },
    { key: 'amount', header: 'Amount', align: 'right', sort: (p) => p.amount, cell: (p) => <span className="font-semibold">{rupees(p.amount)}</span> },
    { key: 'status', header: 'Status', sort: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
    { key: 'created_at', header: 'Created', sort: (p) => p.created_at, cell: (p) => <span className="text-slate-500">{fmtDate(p.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (p) => (p.status === 'paid'
        ? <button type="button" className="btn-gold py-1 text-xs" disabled={confirmReceived.isPending} onClick={() => confirmReceived.mutate(p.id)}>Confirm received</button>
        : p.status === 'pending'
          ? <button type="button" className="btn-gold py-1 text-xs" disabled={markPaid.isPending} onClick={() => markPaid.mutate(p.id)}>Mark paid</button>
          : null),
    },
  ];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Back to teachers
      </button>

      {/* Header */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {t.photo_url ? (
              <img src={t.photo_url} alt={t.name} className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand/10 text-2xl font-bold text-brand">
                {t.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-extrabold">{t.name}</h1>
              <p className="font-mono text-sm text-slate-500">{t.teacher_id || 'No Teacher ID yet'}</p>
              <p className="text-xs text-slate-400">Applied {fmtDate(t.created_at)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`badge ${statusBadgeClass(t.status)}`}>{t.status}</span>
                {t.certified && <span className="badge bg-brand-gold/20 text-brand-gold">Certified</span>}
                {t.cefr_level && <span className="badge bg-slate-100 text-slate-600">CEFR {t.cefr_level}</span>}
                {t.public_visible && <span className="badge bg-slate-100 text-slate-600">In directory</span>}
                {data.login && data.login.is_active === false && <span className="badge bg-red-100 text-red-700">Login blocked</span>}
              </div>
            </div>
          </div>
          {t.status === 'approved' && data.login?.username && (
            <div className="flex flex-wrap gap-2">
              {data.login.is_active === false ? (
                <button
                  type="button"
                  className="btn-ghost text-green-700"
                  disabled={blockLogin.isPending}
                  onClick={() => {
                    if (window.confirm(`Unblock ${t.name}? They will be able to log in again.`)) {
                      blockLogin.mutate({ username: data.login!.username!, active: true });
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
                    if (window.confirm(`Block ${t.name}? They will not be able to log in.`)) {
                      blockLogin.mutate({ username: data.login!.username!, active: false });
                    }
                  }}
                >
                  <Ban className="mr-1 inline h-4 w-4" />
                  Block login
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Batches" value={s.batch_count} hint={`${s.students_taught} students taught`} />
        <StatCard label="Classes conducted" value={s.classes_conducted} hint={`${s.classes_pending} pending review`} />
        <StatCard label="Total remuneration" value={rupees(s.total_paise)} hint={`${rupees(s.pending_paise)} pending · ${rupees(s.received_paise)} received`} />
        <StatCard label="Average rating" value={s.average_rating != null ? `${s.average_rating} ★` : '—'} hint={`${s.review_count} review(s)`} />
      </div>

      {/* Profile details */}
      <Section title="Teacher details">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailRow label="Email" value={<EmailLink email={t.email} />} />
          <DetailRow label="Phone" value={<PhoneLink phone={t.phone} />} />
          <DetailRow label="WhatsApp" value={<PhoneLink phone={t.whatsapp} />} />
          <DetailRow label="City" value={t.city} />
          <DetailRow label="Qualification" value={t.qualification} />
          <DetailRow label="CEFR level" value={t.cefr_level} />
          <DetailRow label="Login username" value={data.login?.username ?? t.username} />
          <DetailRow label="Login active" value={data.login ? (data.login.is_active ? 'Yes' : 'No') : '—'} />
          <DetailRow label="Last login" value={data.login?.last_login_at ? fmtDate(data.login.last_login_at) : '—'} />
        </dl>
        {t.experience && <div className="mt-4"><DetailRow label="Teaching experience" value={t.experience} /></div>}
        {t.bio && <div className="mt-4"><DetailRow label="Bio" value={t.bio} /></div>}
      </Section>

      {/* Batches */}
      <Section
        title="Batches"
        action={<Link to="/admin/batches" className="text-xs text-brand hover:underline">Manage batches</Link>}
      >
        <DataTable
          rows={data.batches}
          columns={batchCols}
          rowKey={(b) => b.id}
          emptyLabel="No batches assigned."
          initialSort={{ key: 'title', dir: 'asc' }}
          pageSize={10}
        />
      </Section>

      {/* Classes conducted */}
      <Section title="Classes conducted (attendance)">
        <p className="-mt-2 mb-3 text-xs text-slate-500">
          Review pending classes, credit pay for approved classes, then mark paid once you transfer the amount.
        </p>
        <DataTable rows={data.classes} columns={classCols} rowKey={(c) => c.id}
          emptyLabel="No classes conducted yet." initialSort={{ key: 'date', dir: 'desc' }} pageSize={10} />
      </Section>
      {reviewClass && <ReviewClassModal row={reviewClass} onClose={() => setReviewClass(null)} onDone={invalidate} />}
      {creditClass && <CreditPayModal row={creditClass} onClose={() => setCreditClass(null)} onDone={invalidate} />}

      {/* Remuneration / payments */}
      <Section title="Remuneration & payments">
        <DataTable rows={data.payments} columns={payCols} rowKey={(p) => p.id}
          emptyLabel="No remuneration records." initialSort={{ key: 'created_at', dir: 'desc' }} pageSize={10} />
      </Section>

      {/* Student reviews — real feedback from the students who attended */}
      <Section
        title="Student feedback"
        action={data.reviews.length > 0 ? <span className="text-xs text-slate-500">{data.reviews.length} review(s)</span> : undefined}
      >
        {data.reviews.length === 0 ? (
          <p className="text-sm text-slate-500">No student reviews yet.</p>
        ) : (
          <div className="space-y-2">
            {data.reviews.map((r, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AdminStudentLink studentId={r.student_id} name={r.student_name || r.student_id} />
                  <div className="flex items-center gap-3">
                    {r.rating ? <Stars rating={r.rating} /> : <span className="text-xs text-slate-400">No rating</span>}
                    <span className="text-xs text-slate-400">
                      {[r.batch_title, r.class_date].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </div>
                {r.feedback
                  ? <p className="mt-2 text-sm text-slate-600">{r.feedback}</p>
                  : <p className="mt-2 text-xs italic text-slate-400">Rated without written feedback.</p>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <TeacherActivityLog teacherId={teacherId} />
    </div>
  );
}
