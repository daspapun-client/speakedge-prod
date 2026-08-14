import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CheckCircle2, GraduationCap, PlayCircle, Plus, Trash2, Video } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import {
  Column, DataTable, Modal, PageHeader, StatCard, StatusBadge, StudentAvatar,
  TableFilter, TeacherOption, TeacherSelect, fmtDate,
} from './_shared';

interface RosterRow {
  student_id: string;
  full_name?: string | null;
  photo_url?: string | null;
  gender?: string | null;
  orientation_status: string;
}

interface Session {
  id: string;
  title: string;
  mode: 'live' | 'recorded';
  scheduled_at?: string | null;
  duration_min: number;
  teacher_id?: string | null;
  teacher_name?: string | null;
  meeting_url?: string | null;
  recording_url?: string | null;
  agenda?: string[];
  status: string;
  student_count: number;
  completed_count: number;
  roster?: RosterRow[];
}

interface StudentLite {
  student_id: string;
  full_name: string;
  photo_url?: string | null;
  gender?: string | null;
  membership_status: string;
}

// ISO <-> <input type="datetime-local"> value (local time).
function isoToLocal(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StudentPicker({ selected, onToggle }: { selected: string[]; onToggle: (id: string) => void }) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['admin-students-lite'],
    queryFn: () => unwrap<{ items: StudentLite[] }>(api.get('/admin/students', { params: { page_size: 500 } })),
  });
  const students = data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? students.filter((s) => `${s.full_name} ${s.student_id}`.toLowerCase().includes(needle))
      : students;
    return base.slice(0, 60);
  }, [students, q]);

  return (
    <div>
      <input
        className="input"
        placeholder="Search students to enrol…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1">
        {filtered.map((s) => {
          const on = selected.includes(s.student_id);
          return (
            <button
              key={s.student_id}
              type="button"
              onClick={() => onToggle(s.student_id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition ${on ? 'bg-brand/10 text-brand' : 'hover:bg-slate-50'}`}
            >
              <StudentAvatar photoUrl={s.photo_url} gender={s.gender} name={s.full_name} size="h-7 w-7" iconSize={14} />
              <span className="min-w-0 flex-1 truncate">
                {s.full_name} <span className="font-mono text-xs text-slate-400">{s.student_id}</span>
              </span>
              {on && <CheckCircle2 size={16} className="shrink-0" />}
            </button>
          );
        })}
        {!filtered.length && <p className="px-2 py-3 text-center text-xs text-slate-400">No students found.</p>}
      </div>
      <p className="mt-1 text-xs text-slate-400">{selected.length} enrolled</p>
    </div>
  );
}

function SessionModal({ session, teachers, onClose, onDone }:
  { session: Session | null; teachers: TeacherOption[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const editing = !!session;
  const [form, setForm] = useState({
    title: session?.title ?? '',
    mode: session?.mode ?? 'live',
    scheduled_at: isoToLocal(session?.scheduled_at),
    duration_min: String(session?.duration_min ?? 45),
    teacher_id: session?.teacher_id ?? '',
    meeting_url: session?.meeting_url ?? '',
    recording_url: session?.recording_url ?? '',
    agenda: (session?.agenda ?? []).join('\n'),
  });
  const [studentIds, setStudentIds] = useState<string[]>(session?.roster?.map((r) => r.student_id) ?? []);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (id: string) => setStudentIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title.trim(),
        mode: form.mode,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        duration_min: Number(form.duration_min) || 45,
        teacher_id: form.teacher_id || null,
        meeting_url: form.meeting_url.trim() || null,
        recording_url: form.recording_url.trim() || null,
        agenda: form.agenda.split('\n').map((l) => l.trim()).filter(Boolean),
        student_ids: studentIds,
      };
      return editing
        ? unwrap(api.patch(`/orientation/batches/${session!.id}`, body))
        : unwrap(api.post('/orientation/batches', body));
    },
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['orientation-batches'] }); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  const complete = useMutation({
    mutationFn: (ids: string[]) => unwrap(api.post(`/orientation/batches/${session!.id}/complete`, { student_ids: ids })),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['orientation-batches'] }); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{editing ? 'Edit orientation session' : 'New orientation session'}</h2>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Session title</label><input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div>
          <label className="label">Mode</label>
          <select className="input" value={form.mode} onChange={(e) => set('mode', e.target.value)}>
            <option value="live">Live session</option>
            <option value="recorded">Recorded (self-paced)</option>
          </select>
        </div>
        <div><label className="label">Duration (min)</label><input className="input" type="number" min="1" value={form.duration_min} onChange={(e) => set('duration_min', e.target.value)} /></div>
        {form.mode === 'live' ? (
          <>
            <div><label className="label">Scheduled date &amp; time</label><input className="input" type="datetime-local" value={form.scheduled_at} onChange={(e) => set('scheduled_at', e.target.value)} /></div>
            <div><label className="label">Meeting link</label><input className="input" placeholder="https://meet.google.com/…" value={form.meeting_url} onChange={(e) => set('meeting_url', e.target.value)} /></div>
          </>
        ) : (
          <div className="sm:col-span-2"><label className="label">Recording / video link</label><input className="input" placeholder="https://…" value={form.recording_url} onChange={(e) => set('recording_url', e.target.value)} /></div>
        )}
        <div className="sm:col-span-2">
          <label className="label">Teacher</label>
          <TeacherSelect value={form.teacher_id} onChange={(id) => set('teacher_id', id)} teachers={teachers} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Agenda (one line per item, optional)</label>
          <textarea className="input" rows={3} value={form.agenda} onChange={(e) => set('agenda', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Enrol students</label>
          <StudentPicker selected={studentIds} onToggle={toggle} />
        </div>
      </div>

      {editing && !!session!.roster?.length && (
        <div className="mt-5 rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Roster &amp; completion</h3>
            <button
              className="btn-ghost py-1 text-xs"
              disabled={complete.isPending}
              onClick={() => complete.mutate([])}
            >
              Mark all complete
            </button>
          </div>
          <ul className="mt-2 divide-y divide-slate-100">
            {session!.roster!.map((r) => (
              <li key={r.student_id} className="flex items-center gap-2 py-2 text-sm">
                <StudentAvatar photoUrl={r.photo_url} gender={r.gender} name={r.full_name ?? r.student_id} size="h-7 w-7" iconSize={14} />
                <span className="min-w-0 flex-1 truncate">{r.full_name ?? r.student_id}</span>
                <StatusBadge status={r.orientation_status} />
                {r.orientation_status !== 'completed' && (
                  <button className="btn-ghost py-1 text-xs" disabled={complete.isPending} onClick={() => complete.mutate([r.student_id])}>
                    Complete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!form.title.trim() || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Save changes' : 'Create session'}
        </button>
      </div>
    </Modal>
  );
}

interface TutorialVideo {
  id: string;
  title: string;
  url: string;
  description?: string | null;
}

// Orientation tutorials are ordinary Video-library records tagged category="orientation",
// managed here so they surface on the student orientation page.
function TutorialVideosManager() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: '', url: '', description: '' });
  const [error, setError] = useState('');
  const key = ['orientation-tutorials-admin'];

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => unwrap<TutorialVideo[]>(api.get('/videos/', { params: { category: 'orientation' } })),
  });
  const videos = data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: () => unwrap(api.post('/videos/', {
      title: form.title.trim(),
      url: form.url.trim(),
      source: 'youtube',
      category: 'orientation',
      access: 'member',
      description: form.description.trim() || null,
    })),
    onSuccess: () => { setError(''); setForm({ title: '', url: '', description: '' }); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/videos/${id}`)),
    onSuccess: refresh,
  });

  return (
    <div className="card mt-6">
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-brand/10 p-2 text-brand"><PlayCircle size={18} /></span>
        <div>
          <h2 className="font-bold text-slate-800">Orientation tutorials</h2>
          <p className="text-sm text-slate-500">YouTube tutorials shown to students on their orientation page.</p>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <input className="input" placeholder="Video title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
        <input className="input" placeholder="YouTube URL (https://youtube.com/watch?v=…)" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
        <input className="input sm:col-span-2" placeholder="Short description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      </div>
      <div className="mt-2 flex justify-end">
        <button className="btn-primary" disabled={!form.title.trim() || !form.url.trim() || add.isPending} onClick={() => add.mutate()}>
          <Plus size={16} /> Add tutorial
        </button>
      </div>

      <ul className="mt-4 divide-y divide-slate-100">
        {videos.map((v) => (
          <li key={v.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600"><PlayCircle size={15} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-slate-800">{v.title}</p>
              <a href={v.url} target="_blank" rel="noreferrer" className="truncate text-xs text-brand underline">{v.url}</a>
            </div>
            <button className="btn-ghost py-1 text-xs text-red-600" disabled={remove.isPending} onClick={() => remove.mutate(v.id)}>
              <Trash2 size={14} /> Remove
            </button>
          </li>
        ))}
        {!videos.length && <li className="py-3 text-center text-sm text-slate-400">No tutorial videos yet.</li>}
      </ul>
    </div>
  );
}

export function AdminOrientation() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['orientation-batches', status],
    queryFn: () => unwrap<Session[]>(api.get('/orientation/batches', { params: { status: status || undefined } })),
  });
  const teachers = useQuery({
    queryKey: ['orientation-teachers'],
    queryFn: () => unwrap<{ items: TeacherOption[] }>(api.get('/teacher/applications', { params: { status: 'approved', page_size: 200 } })),
  });
  // Detail (with roster) for the edit modal.
  const detail = useQuery({
    queryKey: ['orientation-batch', editId],
    queryFn: () => unwrap<Session>(api.get(`/orientation/batches/${editId}`)),
    enabled: !!editId,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['orientation-batches'] });
    if (editId) qc.invalidateQueries({ queryKey: ['orientation-batch', editId] });
  };

  const sessions = data ?? [];
  const totalEnrolled = sessions.reduce((n, s) => n + s.student_count, 0);
  const totalCompleted = sessions.reduce((n, s) => n + s.completed_count, 0);

  const columns: Column<Session>[] = [
    {
      key: 'title', header: 'Session', sort: (s) => s.title,
      cell: (s) => (
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${s.mode === 'live' ? 'bg-brand/10 text-brand' : 'bg-violet-100 text-violet-600'}`}>
            {s.mode === 'live' ? <Video size={15} /> : <PlayCircle size={15} />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-800">{s.title}</p>
            <p className="text-xs capitalize text-slate-400">{s.mode}</p>
          </div>
        </div>
      ),
    },
    { key: 'scheduled_at', header: 'Scheduled', sort: (s) => s.scheduled_at ?? '', cell: (s) => <span className="text-slate-500">{s.mode === 'live' ? fmtDate(s.scheduled_at) : '—'}</span> },
    { key: 'teacher_name', header: 'Teacher', sort: (s) => s.teacher_name ?? '', cell: (s) => s.teacher_name || '—' },
    {
      key: 'progress', header: 'Completed', align: 'center',
      cell: (s) => <span className="text-sm font-medium text-slate-700">{s.completed_count}/{s.student_count}</span>,
    },
    { key: 'status', header: 'Status', sort: (s) => s.status, cell: (s) => <StatusBadge status={s.status} /> },
    {
      key: 'actions', header: '', width: '1%',
      cell: (s) => <button className="btn-ghost py-1 text-xs" onClick={() => setEditId(s.id)}>Manage</button>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Orientation"
        description="Schedule new-student orientation sessions, enrol students and mark completion."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>New session</button>}
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Sessions" value={sessions.length} icon={GraduationCap} />
        <StatCard label="Enrolled students" value={totalEnrolled} icon={Video} accent="violet" />
        <StatCard label="Completed" value={totalCompleted} icon={CheckCircle2} accent="emerald" />
      </div>

      <DataTable
        rows={sessions}
        columns={columns}
        loading={isLoading}
        rowKey={(s) => s.id}
        searchText={(s) => `${s.title} ${s.teacher_name ?? ''}`}
        searchPlaceholder="Search sessions"
        emptyLabel="No orientation sessions yet."
        filters={
          <TableFilter
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'All' },
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        }
      />

      <TutorialVideosManager />

      {creating && (
        <SessionModal session={null} teachers={teachers.data?.items ?? []} onClose={() => setCreating(false)} onDone={refresh} />
      )}
      {editId && detail.data && (
        <SessionModal session={detail.data} teachers={teachers.data?.items ?? []} onClose={() => setEditId(null)} onDone={refresh} />
      )}
    </div>
  );
}
