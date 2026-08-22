import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Eye, Pencil, ShieldCheck, Star } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { AdminStudentLink, Column, DataTable, Modal, PageHeader, Paginator, PhoneLink, RowAction, RowActionDivider, RowActions, StatCard, StatusBadge, StudentAvatar, TableFilter, TeacherSelect, downloadExport, fmtDate, rupees } from './_shared';

interface Teacher {
  id: string;
  teacher_id?: string | null;
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  qualification?: string | null;
  cefr_level?: string | null;
  experience?: string | null;
  status: string;
  photo_url?: string | null;
  public_visible?: boolean;
  username?: string | null;
  login_is_active?: boolean | null;
  created_at: string;
}

const STATUSES = ['', 'pending', 'approved', 'rejected'];
type Tab = 'applications' | 'batches' | 'attendance' | 'remuneration' | 'report';

// ---------------------------------------------------------------------------
// Applications tab (existing behaviour)
// ---------------------------------------------------------------------------
function TeacherModal({ teacher, onClose, onDone }: { teacher: Teacher; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: teacher.name,
    phone: teacher.phone,
    email: teacher.email ?? '',
    city: teacher.city ?? '',
    qualification: teacher.qualification ?? '',
    cefr_level: teacher.cefr_level ?? '',
    experience: teacher.experience ?? '',
    username: teacher.username ?? '',
    public_visible: teacher.public_visible ?? true,
  });

  const save = useMutation({
    mutationFn: () => unwrap(api.patch(`/teacher/${teacher.id}`, {
      name: form.name, phone: form.phone, email: form.email || null, city: form.city || null,
      qualification: form.qualification || null, cefr_level: form.cefr_level || null,
      experience: form.experience || null,
      username: form.username || null, public_visible: form.public_visible,
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  const approve = useMutation({
    mutationFn: () => unwrap(api.post(`/teacher/${teacher.id}/approve`, {
      username: form.username || undefined, public_visible: form.public_visible,
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{teacher.name}</h2>
          <p className="font-mono text-xs text-slate-400">{teacher.teacher_id || 'No Teacher ID yet'}</p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
        <div><label className="label">City</label><input className="input" value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
        <div><label className="label">Qualification</label><input className="input" value={form.qualification} onChange={(e) => set('qualification', e.target.value)} /></div>
        <div><label className="label">CEFR level</label><input className="input" value={form.cefr_level} onChange={(e) => set('cefr_level', e.target.value)} /></div>
        <div><label className="label">Login username (dashboard)</label><input className="input" value={form.username} onChange={(e) => set('username', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Teaching experience</label><textarea className="input" rows={3} value={form.experience} onChange={(e) => set('experience', e.target.value)} /></div>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.public_visible} onChange={(e) => set('public_visible', e.target.checked)} /> Public directory visible
        </label>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
        {teacher.status !== 'approved' && (
          <button className="btn-gold" disabled={approve.isPending} onClick={() => approve.mutate()}>Approve & Certify</button>
        )}
      </div>
    </Modal>
  );
}

function ApplicationsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Teacher | null>(null);
  const pageSize = 25;

  const blockLogin = useMutation({
    mutationFn: ({ username, active }: { username: string; active: boolean }) =>
      unwrap(api.post(`/admin/users/${username}/${active ? 'unblock' : 'block'}`, active ? undefined : { reason: 'Blocked by admin' })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-teachers'] }),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-teachers', status, q, page],
    queryFn: () =>
      unwrap<{ items: Teacher[]; total: number }>(
        api.get('/teacher/applications', { params: { status: status || undefined, q: q || undefined, page, page_size: pageSize } }),
      ),
  });

  const columns: Column<Teacher>[] = [
    {
      key: 'name',
      header: 'Teacher',
      sort: (t) => t.name,
      cell: (t) => (
        <div className="flex items-center gap-2.5">
          <StudentAvatar photoUrl={t.photo_url} name={t.name} size="h-10 w-10" iconSize={20} />
          <div className="min-w-0">
            <Link to={`/admin/teachers/${t.id}`} className="font-semibold text-brand hover:underline">{t.name}</Link>
            <div className="text-xs text-slate-400">{t.city || '—'} · <PhoneLink phone={t.phone} className="text-xs" /></div>
          </div>
        </div>
      ),
    },
    { key: 'qualification', header: 'Qualification', sort: (t) => t.qualification ?? '', cell: (t) => <span className="text-slate-500">{t.qualification || '—'}</span> },
    { key: 'cefr_level', header: 'CEFR', sort: (t) => t.cefr_level ?? '', cell: (t) => t.cefr_level || '—' },
    { key: 'status', header: 'Status', sort: (t) => t.status, cell: (t) => <StatusBadge status={t.status} /> },
    {
      key: 'login',
      header: 'Login',
      sort: (t) => (t.login_is_active ? 1 : 0),
      cell: (t) => {
        if (t.status !== 'approved' || !t.username) return <span className="text-slate-400">—</span>;
        return t.login_is_active
          ? <span className="badge bg-green-100 text-green-700">Active</span>
          : <span className="badge bg-red-100 text-red-700">Blocked</span>;
      },
    },
    { key: 'created_at', header: 'Applied', sort: (t) => t.created_at, cell: (t) => <span className="text-slate-500">{fmtDate(t.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (t) => {
        const canBlock = t.status === 'approved' && t.username;
        const blocked = canBlock && t.login_is_active === false;
        return (
          <RowActions>
            <RowAction icon={Eye} label="View profile" variant="primary" to={`/admin/teachers/${t.id}`} />
            <RowActionDivider />
            <RowAction icon={Pencil} label="Manage application" onClick={() => setSelected(t)} />
            {canBlock && (
              <>
                <RowActionDivider />
                {blocked ? (
                  <RowAction
                    icon={ShieldCheck}
                    label="Unblock login"
                    variant="success"
                    disabled={blockLogin.isPending}
                    onClick={() => {
                      if (window.confirm(`Unblock ${t.name}? They will be able to log in again.`)) {
                        blockLogin.mutate({ username: t.username!, active: true });
                      }
                    }}
                  />
                ) : (
                  <RowAction
                    icon={Ban}
                    label="Block login"
                    variant="danger"
                    disabled={blockLogin.isPending}
                    onClick={() => {
                      if (window.confirm(`Block ${t.name}? They will not be able to log in.`)) {
                        blockLogin.mutate({ username: t.username!, active: false });
                      }
                    }}
                  />
                )}
              </>
            )}
          </RowActions>
        );
      },
    },
  ];

  return (
    <div>
      <DataTable
        rows={data?.items}
        columns={columns}
        loading={isLoading}
        rowKey={(t) => t.id}
        emptyLabel="No teacher applications found."
        filters={
          <>
            <TableFilter
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={STATUSES.map((s) => ({ value: s, label: s || 'All statuses' }))}
            />
            <input className="input max-w-sm" placeholder="Search name / phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </>
        }
        externalPaginator={<Paginator page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />}
      />
      {selected && <TeacherModal teacher={selected} onClose={() => setSelected(null)} onDone={() => refetch()} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Batches tab
// ---------------------------------------------------------------------------
interface Batch {
  id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_photo_url?: string | null;
  title: string;
  date?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  class_time?: string | null;
  schedule?: string | null;
  student_ids: string[];
}

function useApprovedTeachers() {
  return useQuery({
    queryKey: ['approved-teachers'],
    queryFn: () => unwrap<{ items: Teacher[] }>(api.get('/teacher/applications', { params: { status: 'approved', page_size: 200 } })),
  });
}

function CreateBatchModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: teachers } = useApprovedTeachers();
  const [form, setForm] = useState({ teacher_id: '', title: '', frequency: 'weekly', start_date: '', end_date: '', slot_start: '', slot_end: '', schedule: '', teacher_cost: '', student_ids: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => unwrap(api.post('/teacher/batches', {
      teacher_id: form.teacher_id,
      title: form.title,
      frequency: form.frequency,
      start_date: form.start_date,
      end_date: form.end_date,
      class_time: form.slot_start && form.slot_end ? `${form.slot_start}–${form.slot_end}` : null,
      slot_start: form.slot_start || null,
      slot_end: form.slot_end || null,
      schedule: form.schedule || null,
      teacher_cost_paise: Math.round(Number(form.teacher_cost || 0) * 100),
      student_ids: form.student_ids.split(',').map((s) => s.trim()).filter(Boolean),
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">New batch</h2>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3">
        <div>
          <label className="label">Teacher</label>
          <TeacherSelect value={form.teacher_id} onChange={(id) => set('teacher_id', id)} teachers={teachers?.items ?? []} />
        </div>
        <div><label className="label">Course / title</label><input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Frequency</label>
            <select className="input" value={form.frequency} onChange={(e) => set('frequency', e.target.value)}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div><label className="label">Start date</label><input className="input" type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
          <div><label className="label">End date</label><input className="input" type="date" value={form.end_date} onChange={(e) => set('end_date', e.target.value)} /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Start time</label><input className="input" type="time" value={form.slot_start} onChange={(e) => set('slot_start', e.target.value)} /></div>
          <div><label className="label">End time</label><input className="input" type="time" value={form.slot_end} onChange={(e) => set('slot_end', e.target.value)} /></div>
        </div>
        <div>
          <label className="label">Teacher cost per class (₹)</label>
          <input className="input" type="number" min="0" placeholder="0" value={form.teacher_cost} onChange={(e) => set('teacher_cost', e.target.value)} />
          <p className="mt-1 text-xs text-slate-400">Auto-credited to the teacher's payments once each class date has passed.</p>
        </div>
        <div><label className="label">Schedule notes</label><input className="input" value={form.schedule} onChange={(e) => set('schedule', e.target.value)} /></div>
        <div>
          <label className="label">Student IDs (comma-separated)</label>
          <input className="input" value={form.student_ids} onChange={(e) => set('student_ids', e.target.value)} placeholder="SPK-26-XXXX, SPK-26-YYYY" />
        </div>
        <button className="btn-primary" disabled={!form.teacher_id || !form.title || !form.start_date || !form.end_date || save.isPending} onClick={() => save.mutate()}>Create batches</button>
      </div>
    </Modal>
  );
}

function AssignStudentsModal({ batch, onClose, onDone }: { batch: Batch; onClose: () => void; onDone: () => void }) {
  const [ids, setIds] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => unwrap(api.post(`/teacher/batches/${batch.id}/students`, {
      student_ids: ids.split(',').map((s) => s.trim()).filter(Boolean),
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Assign students · {batch.title}</h2>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3">
        <p className="text-xs text-slate-400">Currently {batch.student_ids.length} students. New IDs are appended.</p>
        <input className="input" value={ids} onChange={(e) => setIds(e.target.value)} placeholder="SPK-26-XXXX, SPK-26-YYYY" />
        <button className="btn-primary" disabled={!ids.trim() || save.isPending} onClick={() => save.mutate()}>Assign</button>
      </div>
    </Modal>
  );
}

function BatchesTab() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<Batch | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-batches'],
    queryFn: () => unwrap<Batch[]>(api.get('/teacher/admin/batches')),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-batches'] });

  const columns: Column<Batch>[] = [
    { key: 'title', header: 'Batch', sort: (b) => b.title, cell: (b) => <span className="font-semibold">{b.title}</span> },
    { key: 'teacher_name', header: 'Teacher', sort: (b) => b.teacher_name ?? '', cell: (b) => (
      b.teacher_name ? (
        <div className="flex items-center gap-2.5">
          <StudentAvatar photoUrl={b.teacher_photo_url} name={b.teacher_name} size="h-9 w-9" iconSize={18} />
          <Link to={`/admin/teachers/${b.teacher_id}`} className="font-semibold text-brand hover:underline">{b.teacher_name}</Link>
        </div>
      ) : '—'
    ) },
    { key: 'schedule', header: 'Schedule', cell: (b) => <span className="text-slate-500">{[b.date, b.slot_start && b.slot_end ? `${b.slot_start}–${b.slot_end}` : b.class_time, b.schedule].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'students', header: 'Students', align: 'right', sort: (b) => b.student_ids.length, cell: (b) => b.student_ids.length },
    { key: 'actions', header: '', width: '1%', cell: (b) => <button className="btn-ghost py-1 text-xs" onClick={() => setAssigning(b)}>Assign students</button> },
  ];

  return (
    <div>
      <div className="mt-4 flex justify-end">
        <button className="btn-primary" onClick={() => setCreating(true)}>New batch</button>
      </div>
      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(b) => b.id}
        searchText={(b) => `${b.title} ${b.teacher_name ?? ''}`}
        searchPlaceholder="Search batch / teacher"
        emptyLabel="No batches yet."
      />
      {creating && <CreateBatchModal onClose={() => setCreating(false)} onDone={refresh} />}
      {assigning && <AssignStudentsModal batch={assigning} onClose={() => setAssigning(null)} onDone={refresh} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attendance approvals tab
// ---------------------------------------------------------------------------
interface AttendanceRow {
  id: string;
  teacher_name?: string | null;
  batch_title?: string | null;
  date: string;
  class_time?: string | null;
  present_count: number;
  absent_count: number;
  status: string;
  feedback_submitted?: number;
  feedback_pending?: number;
  average_rating?: number | null;
}

interface AttendanceFeedback {
  attendance_id: string;
  teacher_name?: string | null;
  batch_title?: string | null;
  date: string;
  class_time?: string | null;
  average_rating?: number | null;
  submitted_count: number;
  pending_count: number;
  skipped_count: number;
  missed_count?: number;
  items: {
    id: string;
    student_id: string;
    student_name: string;
    attended?: boolean | null;
    rating?: number | null;
    feedback?: string | null;
    status: string;
    created_at?: string | null;
  }[];
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-brand-gold">
      {Array.from({ length: 5 }).map((_, n) => (
        <Star key={n} size={14} fill={n < rating ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

function AttendanceFeedbackModal({ attendanceId, onClose }: { attendanceId: string; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-attendance-feedback', attendanceId],
    queryFn: () => unwrap<AttendanceFeedback>(api.get(`/teacher/admin/attendance/${attendanceId}/feedback`)),
  });

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Student feedback</h2>
          {data && (
            <p className="mt-1 text-sm text-slate-500">
              {data.teacher_name} · {data.batch_title} · {data.date}
              {data.class_time ? ` · ${data.class_time}` : ''}
            </p>
          )}
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>

      {isLoading ? (
        <p className="mt-6 text-slate-500">Loading feedback…</p>
      ) : isError ? (
        <p className="mt-6 text-sm text-red-600">{(error as Error).message}</p>
      ) : !data ? null : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Average rating" value={data.average_rating != null ? `${data.average_rating} ★` : '—'} />
            <StatCard label="Submitted" value={data.submitted_count} hint={`${data.pending_count} pending · ${data.missed_count ?? 0} missed · ${data.skipped_count} skipped`} />
            <StatCard label="Total requests" value={data.items.length} />
          </div>

          <div className="mt-4 space-y-2">
            {!data.items.length ? (
              <p className="text-sm text-slate-500">No review requests for this class yet.</p>
            ) : (
              data.items.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <AdminStudentLink studentId={item.student_id} name={item.student_name} />
                    <StatusBadge status={item.status} />
                  </div>
                  {item.status === 'submitted' && item.rating ? (
                    <div className="mt-2 flex items-center gap-2">
                      <StarRating rating={item.rating} />
                      <span className="text-xs text-slate-500">{item.rating}/5</span>
                    </div>
                  ) : item.status === 'missed' ? (
                    <p className="mt-2 text-sm font-medium text-amber-800">Student reported they did not attend</p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">
                      {item.status === 'pending' ? 'Waiting for student response' : 'Student skipped'}
                    </p>
                  )}
                  {item.feedback && <p className="mt-2 text-sm text-slate-600">{item.feedback}</p>}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function ReviewAttendanceModal({ row, onClose, onDone }: { row: AttendanceRow; onClose: () => void; onDone: () => void }) {
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
        <h2 className="text-lg font-bold">Review attendance</h2>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3 text-sm">
        <div>{row.teacher_name} · {row.batch_title} · {row.date}{row.class_time ? ` · ${row.class_time}` : ''}</div>
        <div className="text-slate-500">Present {row.present_count} · Absent {row.absent_count}</div>
        <div>
          <label className="label">Remuneration on approval (₹, optional)</label>
          <input className="input" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <p className="text-xs text-slate-400">Approving credits remuneration and sends a review request to every present student.</p>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={act.isPending} onClick={() => act.mutate('approve')}>Approve</button>
          <button className="btn-ghost text-red-600" disabled={act.isPending} onClick={() => act.mutate('reject')}>Reject</button>
        </div>
      </div>
    </Modal>
  );
}

function AttendanceTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [selected, setSelected] = useState<AttendanceRow | null>(null);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-attendance', status],
    queryFn: () => unwrap<AttendanceRow[]>(api.get('/teacher/admin/attendance', { params: { status: status || undefined } })),
  });
  const columns: Column<AttendanceRow>[] = [
    { key: 'teacher_name', header: 'Teacher', sort: (a) => a.teacher_name ?? '', cell: (a) => a.teacher_name || '—' },
    { key: 'batch_title', header: 'Batch', sort: (a) => a.batch_title ?? '', cell: (a) => a.batch_title || '—' },
    { key: 'date', header: 'Date', sort: (a) => a.date, cell: (a) => <>{a.date}{a.class_time ? ` · ${a.class_time}` : ''}</> },
    { key: 'present', header: 'Present/Absent', align: 'right', cell: (a) => <>{a.present_count} / {a.absent_count}</> },
    {
      key: 'feedback',
      header: 'Feedback',
      cell: (a) => (
        a.feedback_submitted || a.feedback_pending ? (
          <span className="text-slate-600">
            {a.feedback_submitted ?? 0} submitted
            {a.average_rating != null ? ` · ${a.average_rating}★` : ''}
            {(a.feedback_pending ?? 0) > 0 ? <span className="text-slate-400"> · {a.feedback_pending} pending</span> : null}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )
      ),
    },
    { key: 'status', header: 'Status', sort: (a) => a.status, cell: (a) => <StatusBadge status={a.status} /> },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (a) => (
        <div className="flex gap-1">
          {a.status === 'pending' && (
            <button className="btn-ghost py-1 text-xs" onClick={() => setSelected(a)}>Review</button>
          )}
          <button className="btn-ghost py-1 text-xs" onClick={() => setFeedbackId(a.id)}>Feedbacks</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(a) => a.id}
        searchText={(a) => `${a.teacher_name ?? ''} ${a.batch_title ?? ''}`}
        searchPlaceholder="Search teacher / batch"
        emptyLabel="No attendance records."
        filters={
          <TableFilter
            value={status}
            onChange={setStatus}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: '', label: 'All' },
            ]}
          />
        }
      />
      {selected && <ReviewAttendanceModal row={selected} onClose={() => setSelected(null)} onDone={() => qc.invalidateQueries({ queryKey: ['admin-attendance'] })} />}
      {feedbackId && <AttendanceFeedbackModal attendanceId={feedbackId} onClose={() => setFeedbackId(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Remuneration tab
// ---------------------------------------------------------------------------
interface RemunerationRow {
  id: string;
  teacher_name?: string | null;
  period: string;
  amount: number;
  status: string;
  created_at: string;
}

function RemunerationTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['admin-remuneration', status],
    queryFn: () => unwrap<RemunerationRow[]>(api.get('/teacher/admin/remuneration', { params: { status: status || undefined } })),
  });
  const markPaid = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/mark-paid`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-remuneration'] }),
  });
  const columns: Column<RemunerationRow>[] = [
    { key: 'teacher_name', header: 'Teacher', sort: (r) => r.teacher_name ?? '', cell: (r) => r.teacher_name || '—' },
    { key: 'period', header: 'Period', sort: (r) => r.period },
    { key: 'amount', header: 'Amount', align: 'right', sort: (r) => r.amount, cell: (r) => <span className="font-semibold">{rupees(r.amount)}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'created_at', header: 'Created', sort: (r) => r.created_at, cell: (r) => <span className="text-slate-500">{fmtDate(r.created_at)}</span> },
    { key: 'actions', header: '', width: '1%', cell: (r) => (r.status === 'pending' ? <button className="btn-gold py-1 text-xs" disabled={markPaid.isPending} onClick={() => markPaid.mutate(r.id)}>Mark paid</button> : null) },
  ];

  return (
    <div>
      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.teacher_name ?? ''} ${r.period}`}
        searchPlaceholder="Search teacher / period"
        emptyLabel="No remuneration records."
        filters={
          <TableFilter
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'paid', label: 'Paid' },
              { value: 'received', label: 'Received' },
            ]}
          />
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Class Report tab — teacher-wise conducted classes for per-batch payment
// ---------------------------------------------------------------------------
interface ClassReportRow {
  id: string;
  teacher_name?: string | null;
  teacher_code?: string | null;
  batch_title?: string | null;
  date: string;
  class_time?: string | null;
  present_count: number;
  absent_count: number;
  status: string;
  remuneration_id?: string | null;
  remuneration_paise: number;
  remuneration_status?: string | null;
}
interface TeacherSummary {
  teacher_id: string;
  teacher_name?: string | null;
  teacher_code?: string | null;
  classes: number;
  students_attended: number;
  total_remuneration_paise: number;
}

function ClassReportTab() {
  const qc = useQueryClient();
  const { data: teachers } = useApprovedTeachers();
  const [teacherId, setTeacherId] = useState('');
  const [status, setStatus] = useState('approved');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = {
    teacher_id: teacherId || undefined,
    status: status || undefined,
    date_from: from || undefined,
    date_to: to || undefined,
  };
  const { data, isLoading } = useQuery({
    queryKey: ['admin-class-report', teacherId, status, from, to],
    queryFn: () => unwrap<{ rows: ClassReportRow[]; summary: TeacherSummary[] }>(
      api.get('/teacher/admin/class-report', { params }),
    ),
  });
  const markPaid = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/mark-paid`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-class-report'] }),
  });

  const columns: Column<ClassReportRow>[] = [
    { key: 'teacher_name', header: 'Teacher', sort: (r) => r.teacher_name ?? '', cell: (r) => <><div className="font-semibold">{r.teacher_name || '—'}</div><div className="font-mono text-xs text-slate-400">{r.teacher_code || ''}</div></> },
    { key: 'batch_title', header: 'Batch / description', sort: (r) => r.batch_title ?? '', cell: (r) => r.batch_title || '—' },
    { key: 'date', header: 'Date & time', sort: (r) => r.date, cell: (r) => <>{r.date}{r.class_time ? ` · ${r.class_time}` : ''}</> },
    { key: 'present', header: 'Attended', align: 'right', sort: (r) => r.present_count, cell: (r) => <span className="font-semibold">{r.present_count}</span> },
    { key: 'absent', header: 'Absent', align: 'right', sort: (r) => r.absent_count, cell: (r) => <span className="text-slate-500">{r.absent_count}</span> },
    { key: 'status', header: 'Attendance', sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'remuneration', header: 'Pay', align: 'right', sort: (r) => r.remuneration_paise, cell: (r) => <span className="font-semibold">{r.remuneration_paise ? rupees(r.remuneration_paise) : '—'}</span> },
    { key: 'remuneration_status', header: 'Pay status', cell: (r) => (r.remuneration_status ? <StatusBadge status={r.remuneration_status} /> : <span className="text-slate-400">—</span>) },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (r) => (r.remuneration_id && r.remuneration_status === 'pending'
        ? <button type="button" className="btn-gold py-1 text-xs" disabled={markPaid.isPending} onClick={() => markPaid.mutate(r.remuneration_id!)}>Mark paid</button>
        : null),
    },
  ];

  return (
    <div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {data?.summary.map((s) => (
          <StatCard
            key={s.teacher_id}
            label={s.teacher_name || 'Unknown'}
            value={rupees(s.total_remuneration_paise)}
            hint={`${s.classes} classes · ${s.students_attended} attendances`}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Teacher</label>
          <select className="input" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">All teachers</option>
            {teachers?.items.map((t) => <option key={t.id} value={t.id}>{t.name} {t.teacher_id ? `(${t.teacher_id})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Attendance status</label>
          <TableFilter
            value={status}
            onChange={setStatus}
            options={[
              { value: 'approved', label: 'Approved' },
              { value: 'pending', label: 'Pending' },
              { value: 'rejected', label: 'Rejected' },
              { value: '', label: 'All' },
            ]}
          />
        </div>
        <div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="ml-auto flex gap-2">
          <button className="btn-ghost" onClick={() => downloadExport('/teacher/admin/class-report/export', { ...params, format: 'csv' }, 'teacher_class_report.csv')}>Export CSV</button>
          <button className="btn-ghost" onClick={() => downloadExport('/teacher/admin/class-report/export', { ...params, format: 'xlsx' }, 'teacher_class_report.xlsx')}>Export XLSX</button>
        </div>
      </div>
      <DataTable
        rows={data?.rows}
        columns={columns}
        loading={isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.teacher_name ?? ''} ${r.batch_title ?? ''} ${r.date}`}
        searchPlaceholder="Search teacher / batch / date"
        emptyLabel="No conducted classes for this filter."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AdminTeachers() {
  const [tab, setTab] = useState<Tab>('applications');
  const TABS: { key: Tab; label: string }[] = [
    { key: 'applications', label: 'Applications' },
    { key: 'batches', label: 'Batches' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'remuneration', label: 'Remuneration' },
    { key: 'report', label: 'Class Report' },
  ];
  return (
    <div>
      <PageHeader title="Teacher Management" description="Applications, certification, batches, attendance & remuneration." />
      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${tab === t.key ? 'border-b-2 border-brand text-brand' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'applications' && <ApplicationsTab />}
      {tab === 'batches' && <BatchesTab />}
      {tab === 'attendance' && <AttendanceTab />}
      {tab === 'remuneration' && <RemunerationTab />}
      {tab === 'report' && <ClassReportTab />}
    </div>
  );
}
