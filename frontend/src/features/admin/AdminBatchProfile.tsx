import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Star, UserMinus, UserPlus, Video } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { batchTimeLabel } from '@/features/batch/shared';
import { findAdminListBatchByPrimaryId, findParentBatchForChild, isParentBatch, type AdminListBatch } from './batchSchedulePanel';
import {
  AdminStudentLink,
  Column,
  DataTable,
  EmailLink,
  Modal,
  Paginator,
  PhoneLink,
  StatCard,
  StatusBadge,
  TeacherOption,
  TeacherSelect,
  fmtDate,
  rupees,
} from './_shared';

interface NamedStudent {
  student_id: string;
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  age?: number | null;
  gender?: string | null;
  photo_url?: string | null;
}

interface Batch {
  id: string;
  title: string;
  teacher_id: string;
  teacher_name?: string | null;
  day_of_week?: string | null;
  date?: string | null;
  class_dates?: string[];
  class_time?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  schedule?: string | null;
  meeting_url?: string | null;
  meeting_forced?: boolean;
  meeting_active?: boolean;
  reminded_on?: string | null;
  teacher_cost_paise?: number;
  created_at: string;
  updated_at?: string | null;
  attendance_submitted_dates?: string[];
}

function defaultPayRupees(row: ClassRow, teacherCostPaise?: number | null): string {
  if (row.remuneration_paise > 0) return String(row.remuneration_paise / 100);
  if (teacherCostPaise && teacherCostPaise > 0) return String(teacherCostPaise / 100);
  return '';
}

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
  photo_url?: string | null;
  certified?: boolean;
}

interface ClassRow {
  id: string;
  date: string;
  class_time?: string | null;
  present_count: number;
  absent_count: number;
  present: NamedStudent[];
  absent: NamedStudent[];
  status: string;
  reviewed_by?: string | null;
  remuneration_id?: string | null;
  remuneration_paise: number;
  remuneration_status?: string | null;
}

interface ReviewRow {
  id: string;
  rating?: number | null;
  feedback?: string | null;
  status: string;
  class_date?: string | null;
  class_time?: string | null;
  student_id: string;
  student_name: string;
}

interface LogEntry {
  id: string;
  actor: string;
  role?: string | null;
  action: string;
  created_at: string;
  meta: Record<string, unknown>;
}

interface ProfileData {
  batch: Batch;
  teacher: Teacher | null;
  members: NamedStudent[];
  pending: NamedStudent[];
  classes: ClassRow[];
  reviews: ReviewRow[];
  stats: {
    member_count: number;
    pending_count: number;
    classes_total: number;
    classes_conducted: number;
    classes_pending: number;
    feedback_submitted: number;
    feedback_pending: number;
    feedback_skipped: number;
    average_rating?: number | null;
  };
}

const ACTION_LABELS: Record<string, string> = {
  'batch.create': 'created the batch',
  'batch.update': 'edited batch details',
  'batch.delete': 'deleted the batch',
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
};

function logDetail(e: LogEntry, names: Record<string, string>): string {
  const m = e.meta || {};
  const name = (id: unknown) => (typeof id === 'string' ? names[id] || id : '');
  switch (e.action) {
    case 'batch.update':
      return Array.isArray(m.fields) && m.fields.length ? `(${(m.fields as string[]).join(', ')})` : '';
    case 'batch.students_add':
      return `(${Array.isArray(m.student_ids) ? (m.student_ids as string[]).map(name).join(', ') : m.count})`;
    case 'batch.student_remove':
    case 'batch.join_request':
    case 'batch.join_approve':
    case 'batch.join_reject':
      return name(m.student_id) ? `— ${name(m.student_id)}` : '';
    case 'attendance.submit':
      return `for ${m.date} · ${m.present} present, ${m.absent} absent`;
    case 'attendance.approve':
      return `for ${m.date}${m.remuneration_paise ? ` · ₹${Number(m.remuneration_paise) / 100}` : ''}`;
    case 'attendance.reject':
      return `for ${m.date}`;
    default:
      return '';
  }
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

function scheduleLabel(b: Batch) {
  const time = batchTimeLabel(b);
  if (b.class_dates?.length) {
    const dates = [...b.class_dates].sort();
    const range = dates.length > 1
      ? `${dates[0]} – ${dates[dates.length - 1]} · ${dates.length} classes`
      : dates[0];
    return time ? `${range} · ${time}` : range;
  }
  if (b.date) return `${b.date}${time ? ` · ${time}` : ''}`;
  const parts = [b.day_of_week, time].filter(Boolean);
  return parts.length ? parts.join(' · ') : b.schedule || '—';
}

function BatchActivityLog({ batchId }: { batchId: string }) {
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const { data, isLoading } = useQuery({
    queryKey: ['batch-activity', batchId, page],
    queryFn: () => unwrap<{ items: LogEntry[]; total: number; student_names: Record<string, string> }>(
      api.get(`/teacher/admin/batches/${batchId}/activity`, { params: { page, page_size: pageSize } })),
  });
  const names = data?.student_names ?? {};

  return (
    <Section title="Activity log">
      <p className="-mt-2 text-xs text-slate-500">
        Every admin, teacher and student action on this batch, most recent first.
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
              <span className="text-slate-400">{logDetail(e, names)}</span>
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

function ReviewClassModal({
  row,
  defaultPayPaise,
  onClose,
  onDone,
}: {
  row: ClassRow;
  defaultPayPaise?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(() => defaultPayRupees(row, defaultPayPaise));
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
        <div>{row.date}{row.class_time ? ` · ${row.class_time}` : ''}</div>
        <div className="text-slate-500">Present {row.present_count} · Absent {row.absent_count}</div>
        <div>
          <label className="label">Pay on approval (₹)</label>
          <input className="input" type="number" min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
        </div>
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
  defaultPayPaise,
  onClose,
  onDone,
}: {
  row: ClassRow;
  defaultPayPaise?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(() => defaultPayRupees(row, defaultPayPaise));
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
        <div>{row.date}{row.class_time ? ` · ${row.class_time}` : ''}</div>
        <div>
          <label className="label">Amount (₹)</label>
          <input className="input" type="number" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" disabled={act.isPending || !amount || Number(amount) <= 0} onClick={() => act.mutate()}>Credit pay</button>
      </div>
    </Modal>
  );
}

function MeetingLinkPanel({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const [url, setUrl] = useState(batch.meeting_url ?? '');
  const [error, setError] = useState('');

  useEffect(() => {
    setUrl(batch.meeting_url ?? '');
  }, [batch.meeting_url]);

  const save = useMutation({
    mutationFn: (link?: string | null) =>
      unwrap(api.post(`/teacher/batches/${batch.id}/meeting-link`, {
        meeting_url: link !== undefined ? (link || null) : (url.trim() || null),
      })),
    onSuccess: (_d, link) => {
      setError('');
      if (link === null || link === '') setUrl('');
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });
  const force = useMutation({
    mutationFn: (forced: boolean) => unwrap(api.post(`/teacher/batches/${batch.id}/meeting-force`, { forced })),
    onSuccess: () => { setError(''); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  const hasUrl = Boolean(url.trim() || batch.meeting_url);
  const live = batch.meeting_active;
  const forced = batch.meeting_forced;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="rounded-lg bg-brand/10 p-2 text-brand">
          <Video size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-800">Google Meet link</p>
            {live && (
              <span className="badge animate-pulse bg-green-100 text-green-700">
                Live now{forced ? ' · forced' : ''}
              </span>
            )}
            {!live && batch.meeting_url && (
              <span className="badge bg-slate-100 text-slate-600">Link saved</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            Students can join only during the scheduled slot, unless you force the session live.
          </p>
          <input
            className="input mt-3 bg-white"
            placeholder="https://meet.google.com/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary text-xs" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? 'Saving…' : batch.meeting_url ? 'Update link' : 'Save link'}
        </button>
        {url.trim() && batch.meeting_url && url.trim() !== batch.meeting_url && (
          <button type="button" className="btn-ghost text-xs" onClick={() => setUrl(batch.meeting_url ?? '')}>
            Reset
          </button>
        )}
        {!url.trim() && batch.meeting_url && (
          <button
            type="button"
            className="btn-ghost text-xs text-red-600"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            Remove link
          </button>
        )}
        {live && batch.meeting_url && (
          <a className="btn-gold text-xs" href={batch.meeting_url} target="_blank" rel="noreferrer">
            Join meeting
          </a>
        )}
        {forced ? (
          <button type="button" className="btn-ghost text-xs text-red-600" disabled={force.isPending} onClick={() => force.mutate(false)}>
            End live session
          </button>
        ) : (
          !live && (
            <button
              type="button"
              className="btn-gold text-xs"
              disabled={force.isPending || !hasUrl}
              title={hasUrl ? undefined : 'Save a meet link first'}
              onClick={() => force.mutate(true)}
            >
              Go live now
            </button>
          )
        )}
      </div>
    </div>
  );
}

function StudentPicker({ batchId, exclude, onDone }: { batchId: string; exclude: Set<string>; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<{ student_id: string; name: string }[]>([]);
  const { data } = useQuery({
    queryKey: ['student-search', q],
    queryFn: () => unwrap<{ items: { student_id: string; full_name: string }[] }>(
      api.get('/admin/students', { params: { q, page_size: 20 } })),
    enabled: !!q,
  });
  const chosen = new Set(selected.map((s) => s.student_id));
  const results = (data?.items ?? []).filter((s) => !exclude.has(s.student_id) && !chosen.has(s.student_id));
  const add = useMutation({
    mutationFn: () => unwrap(api.post(`/teacher/batches/${batchId}/students`, { student_ids: selected.map((s) => s.student_id) })),
    onSuccess: () => { setSelected([]); setQ(''); onDone(); },
  });

  return (
    <div className="rounded-xl border border-dashed border-brand/25 bg-brand/[0.03] p-4">
      <p className="text-sm font-semibold text-slate-800">Add students</p>
      <p className="mt-0.5 text-xs text-slate-500">Search by name or student ID, then add to this batch.</p>
      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {selected.map((s) => (
            <span key={s.student_id} className="badge cursor-pointer bg-brand/10 text-brand"
              onClick={() => setSelected((cur) => cur.filter((x) => x.student_id !== s.student_id))}>
              {s.name} ✕
            </span>
          ))}
        </div>
      )}
      <input className="input mt-3" placeholder="Search by name or ID…" value={q} onChange={(e) => setQ(e.target.value)} />
      {q && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          {!results.length && <p className="p-2 text-sm text-slate-400">No matches.</p>}
          {results.map((s) => (
            <button key={s.student_id} type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => setSelected((cur) => [...cur, { student_id: s.student_id, name: s.full_name }])}>
              <span>{s.full_name}</span>
              <span className="font-mono text-xs text-slate-400">{s.student_id}</span>
            </button>
          ))}
        </div>
      )}
      <button className="btn-primary mt-3" disabled={!selected.length || add.isPending} onClick={() => add.mutate()}>
        <UserPlus size={14} className="mr-1 inline" />
        Add {selected.length || ''} student{selected.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}

export function AdminBatchProfile() {
  const { batchId = '' } = useParams();
  const navigate = useNavigate();
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/admin/batches');
  };

  const qc = useQueryClient();
  const [reviewClass, setReviewClass] = useState<ClassRow | null>(null);
  const [creditClass, setCreditClass] = useState<ClassRow | null>(null);
  const [expandedClass, setExpandedClass] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState('');
  const [rosterError, setRosterError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-batch-profile', batchId],
    queryFn: () => unwrap<ProfileData>(api.get(`/teacher/admin/batches/${batchId}/profile`)),
  });

  const { data: listBatches } = useQuery({
    queryKey: ['admin-batches'],
    queryFn: () => unwrap<AdminListBatch[]>(api.get('/teacher/admin/batches')),
  });
  const parentRow = findAdminListBatchByPrimaryId(listBatches ?? [], batchId);
  const parentSeries = findParentBatchForChild(listBatches ?? [], batchId);

  const { data: teacherData } = useQuery({
    queryKey: ['approved-teachers'],
    queryFn: () => unwrap<{ items: TeacherOption[] }>(
      api.get('/teacher/applications', { params: { status: 'approved', page_size: 200 } })),
  });
  const teachers = teacherData?.items ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-batch-profile', batchId] });
    qc.invalidateQueries({ queryKey: ['admin-batches'] });
  };

  const refreshLists = () =>
    Promise.all([
      qc.refetchQueries({ queryKey: ['admin-batch-profile', batchId] }),
      qc.refetchQueries({ queryKey: ['admin-batches'] }),
    ]);

  const rosterAct = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setRosterError(''); invalidate(); },
    onError: (e: Error) => setRosterError(e.message),
  });
  const runRoster = (fn: () => Promise<unknown>) => rosterAct.mutate(fn);

  const saveTeacher = useMutation({
    mutationFn: (id: string) => unwrap(api.patch(`/teacher/batches/${batchId}`, { teacher_id: id })),
    onSuccess: async () => {
      setRosterError('');
      await refreshLists();
    },
    onError: (e: Error) => setRosterError(e.message),
  });

  useEffect(() => {
    if (data?.batch.teacher_id) setTeacherId(data.batch.teacher_id);
  }, [data?.batch.teacher_id]);

  useEffect(() => {
    if (parentRow && isParentBatch(parentRow)) {
      navigate(`/admin/batches/${batchId}/series`, { replace: true });
    }
  }, [parentRow, batchId, navigate]);

  const confirmReceived = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/confirm-received`)),
    onSuccess: invalidate,
  });
  const markPaid = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/mark-paid`)),
    onSuccess: invalidate,
  });

  if (parentRow && isParentBatch(parentRow)) {
    return (
      <div className="card">
        <p className="text-slate-500">Opening batch series…</p>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="card">
        <p className="text-slate-500">{isLoading ? 'Loading batch…' : 'Batch not found.'}</p>
        <button type="button" onClick={goBack} className="btn-ghost mt-4 inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>
    );
  }

  const b = data.batch;
  const s = data.stats;
  const teacher = data.teacher;

  const memberCols: Column<NamedStudent>[] = [
    {
      key: 'name',
      header: 'Student',
      sort: (m) => m.name,
      cell: (m) => <AdminStudentLink studentId={m.student_id} name={m.name} photoUrl={m.photo_url} gender={m.gender} />,
    },
    { key: 'phone', header: 'Phone', cell: (m) => <PhoneLink phone={m.phone} className="text-sm" /> },
    { key: 'email', header: 'Email', cell: (m) => <EmailLink email={m.email} /> },
    { key: 'age', header: 'Age', align: 'right', sort: (m) => m.age ?? 0, cell: (m) => m.age ?? '—' },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (m) => (
        <button
          type="button"
          className="btn-ghost py-1 text-xs text-red-600 hover:bg-red-50"
          disabled={rosterAct.isPending}
          onClick={() => {
            if (!window.confirm(`Remove ${m.name} from this batch?`)) return;
            runRoster(() => unwrap(api.post(`/teacher/batches/${batchId}/remove-student`, { student_id: m.student_id })));
          }}
        >
          <UserMinus size={14} className="inline" /> Remove
        </button>
      ),
    },
  ];

  const classCols: Column<ClassRow>[] = [
    {
      key: 'date',
      header: 'Date & time',
      sort: (c) => c.date,
      cell: (c) => (
        <button type="button" className="text-left hover:text-brand" onClick={() => setExpandedClass(expandedClass === c.id ? null : c.id)}>
          {c.date}{c.class_time ? ` · ${c.class_time}` : ''}
        </button>
      ),
    },
    { key: 'present_count', header: 'Present', align: 'right', sort: (c) => c.present_count, cell: (c) => <span className="font-semibold">{c.present_count}</span> },
    { key: 'absent_count', header: 'Absent', align: 'right', sort: (c) => c.absent_count, cell: (c) => <span className="text-slate-500">{c.absent_count}</span> },
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

  const expanded = data.classes.find((c) => c.id === expandedClass);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={goBack} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back to batches
        </button>
        {parentSeries && (
          <Link
            to={`/admin/batches/${parentSeries.id}/series`}
            className="text-sm font-medium text-brand hover:underline"
          >
            ← {parentSeries.title} series
          </Link>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold">{b.title}</h1>
            <p className="mt-1 text-sm text-slate-600">{scheduleLabel(b)}</p>
            <p className="text-xs text-slate-400">Created {fmtDate(b.created_at)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {b.meeting_active && <span className="badge bg-green-100 text-green-700">Live now</span>}
              {b.meeting_forced && <span className="badge bg-amber-100 text-amber-700">Forced live</span>}
              {b.date && <span className="badge bg-slate-100 text-slate-600">{b.date}</span>}
              {(b.attendance_submitted_dates?.length ?? 0) > 0 && (
                <span className="badge bg-brand/10 text-brand">{b.attendance_submitted_dates!.length} class(es) logged</span>
              )}
            </div>
          </div>
          {teacher && (
            <Link to={`/admin/teachers/${teacher.id}`} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 hover:border-brand/30">
              {teacher.photo_url ? (
                <img src={teacher.photo_url} alt={teacher.name} className="h-12 w-12 rounded-full object-cover" />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 font-bold text-brand">
                  {teacher.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-xs text-slate-400">Teacher</p>
                <p className="font-semibold text-brand">{teacher.name}</p>
                {teacher.teacher_id && <p className="font-mono text-xs text-slate-400">{teacher.teacher_id}</p>}
              </div>
            </Link>
          )}
        </div>
      </div>

      {rosterError && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{rosterError}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Members" value={s.member_count} hint={s.pending_count > 0 ? `${s.pending_count} join request(s)` : undefined} />
        <StatCard label="Classes" value={s.classes_total} hint={`${s.classes_conducted} approved · ${s.classes_pending} pending review`} />
        <StatCard label="Feedback" value={s.feedback_submitted} hint={`${s.feedback_pending} pending · ${s.feedback_skipped} skipped`} />
        <StatCard label="Average rating" value={s.average_rating != null ? `${s.average_rating} ★` : '—'} />
      </div>

      <Section title="Batch details">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DetailRow label="Schedule" value={scheduleLabel(b)} />
          <DetailRow label="Class date" value={b.date ?? b.day_of_week} />
          <DetailRow label="Class time" value={batchTimeLabel(b)} />
          <DetailRow label="Schedule note" value={b.schedule} />
          <DetailRow label="Last reminder sent" value={b.reminded_on || '—'} />
          <DetailRow label="Last updated" value={b.updated_at ? fmtDate(b.updated_at) : '—'} />
        </dl>
      </Section>

      <Section title="Google Meet">
        <MeetingLinkPanel batch={b} onDone={invalidate} />
      </Section>

      {(teacher || teachers.length > 0) && (
        <Section
          title="Teacher"
          action={teacher ? <Link to={`/admin/teachers/${teacher.id}`} className="text-xs text-brand hover:underline">Full teacher profile</Link> : undefined}
        >
          {teacher && (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <DetailRow label="Name" value={teacher.name} />
              <DetailRow label="Teacher ID" value={teacher.teacher_id} />
              <DetailRow label="Email" value={<EmailLink email={teacher.email} />} />
              <DetailRow label="Phone" value={<PhoneLink phone={teacher.phone} />} />
              <DetailRow label="WhatsApp" value={<PhoneLink phone={teacher.whatsapp} />} />
              <DetailRow label="City" value={teacher.city} />
              <DetailRow label="Qualification" value={teacher.qualification} />
              <DetailRow label="CEFR level" value={teacher.cefr_level} />
              <DetailRow label="Certified" value={teacher.certified ? 'Yes' : 'No'} />
            </dl>
          )}
          <div className={`rounded-xl border border-slate-200 bg-slate-50/60 p-4 ${teacher ? 'mt-5' : ''}`}>
            <p className="text-sm font-semibold text-slate-800">{teacher ? 'Change teacher' : 'Assign teacher'}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {teacher ? 'Replace the teacher assigned to this batch.' : 'No teacher is assigned yet.'}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="min-w-[14rem] flex-1">
                <label className="label">Teacher</label>
                <TeacherSelect value={teacherId} onChange={setTeacherId} teachers={teachers} />
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={!teacherId || teacherId === b.teacher_id || saveTeacher.isPending}
                onClick={() => saveTeacher.mutate(teacherId)}
              >
                {saveTeacher.isPending ? 'Saving…' : teacher ? 'Update teacher' : 'Assign teacher'}
              </button>
            </div>
          </div>
        </Section>
      )}

      {data.pending.length > 0 && (
        <Section title={`Pending join requests (${data.pending.length})`}>
          <div className="space-y-2">
            {data.pending.map((p) => (
              <div key={p.student_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50/40 px-3 py-2">
                <AdminStudentLink studentId={p.student_id} name={p.name} photoUrl={p.photo_url} gender={p.gender} />
                <span className="flex flex-wrap items-center gap-2">
                  <Link to={`/admin/students/${p.student_id}`} className="text-xs text-brand hover:underline">View student</Link>
                  <button type="button" className="btn-ghost py-1 text-xs text-green-600" disabled={rosterAct.isPending}
                    onClick={() => runRoster(() => unwrap(api.post(`/teacher/batches/${batchId}/approve-join`, { student_id: p.student_id })))}>
                    Approve
                  </button>
                  <button type="button" className="btn-ghost py-1 text-xs text-red-600" disabled={rosterAct.isPending}
                    onClick={() => runRoster(() => unwrap(api.post(`/teacher/batches/${batchId}/reject-join`, { student_id: p.student_id })))}>
                    Reject
                  </button>
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Members (${data.members.length})`}>
        <DataTable
          rows={data.members}
          columns={memberCols}
          rowKey={(m) => m.student_id}
          emptyLabel="No students enrolled yet."
          initialSort={{ key: 'name', dir: 'asc' }}
          pageSize={10}
        />
        <div className="mt-4">
          <StudentPicker
            batchId={batchId}
            exclude={new Set([...data.members.map((m) => m.student_id), ...data.pending.map((p) => p.student_id)])}
            onDone={invalidate}
          />
        </div>
      </Section>

      <Section title="Classes conducted (attendance)">
        <p className="-mt-2 mb-3 text-xs text-slate-500">
          Click a date to see who was present or absent. Review pending classes and manage pay from here.
        </p>
        <DataTable
          rows={data.classes}
          columns={classCols}
          rowKey={(c) => c.id}
          emptyLabel="No classes conducted yet."
          initialSort={{ key: 'date', dir: 'desc' }}
          pageSize={10}
        />
        {expanded && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-green-100 bg-green-50/40 p-3">
              <p className="text-xs font-semibold uppercase text-green-700">Present ({expanded.present.length})</p>
              <div className="mt-2 space-y-1">
                {expanded.present.map((s) => (
                  <AdminStudentLink key={s.student_id} studentId={s.student_id} name={s.name} photoUrl={s.photo_url} gender={s.gender} className="py-0.5" />
                ))}
                {!expanded.present.length && <p className="text-sm text-slate-400">None</p>}
              </div>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50/40 p-3">
              <p className="text-xs font-semibold uppercase text-red-700">Absent ({expanded.absent.length})</p>
              <div className="mt-2 space-y-1">
                {expanded.absent.map((s) => (
                  <AdminStudentLink key={s.student_id} studentId={s.student_id} name={s.name} photoUrl={s.photo_url} gender={s.gender} className="py-0.5" />
                ))}
                {!expanded.absent.length && <p className="text-sm text-slate-400">None</p>}
              </div>
            </div>
          </div>
        )}
      </Section>
      {reviewClass && (
        <ReviewClassModal
          key={reviewClass.id}
          row={reviewClass}
          defaultPayPaise={data?.batch.teacher_cost_paise}
          onClose={() => setReviewClass(null)}
          onDone={invalidate}
        />
      )}
      {creditClass && (
        <CreditPayModal
          key={creditClass.id}
          row={creditClass}
          defaultPayPaise={data?.batch.teacher_cost_paise}
          onClose={() => setCreditClass(null)}
          onDone={invalidate}
        />
      )}

      <Section title="Student feedback">
        {data.reviews.length === 0 ? (
          <p className="text-sm text-slate-500">No student feedback yet.</p>
        ) : (
          <div className="space-y-2">
            {data.reviews.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AdminStudentLink studentId={r.student_id} name={r.student_name} />
                  <div className="flex items-center gap-3">
                    <StatusBadge status={r.status} />
                    {r.rating ? <Stars rating={r.rating} /> : null}
                    <span className="text-xs text-slate-400">
                      {[r.class_date, r.class_time].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </div>
                {r.feedback ? (
                  <p className="mt-2 text-sm text-slate-600">{r.feedback}</p>
                ) : r.status === 'submitted' ? (
                  <p className="mt-2 text-xs italic text-slate-400">Rated without written feedback.</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      <BatchActivityLog batchId={batchId} />
    </div>
  );
}
