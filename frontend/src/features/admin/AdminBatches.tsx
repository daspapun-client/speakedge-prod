import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Clock, Layers, Pencil, Radio, Trash2, UserPlus, Users, Video, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { isInSlot, isSlotEnded, isSlotUpcoming, nowHmIST, parseApiDate, todayIsoIST } from '@/lib/datetime';
import { Column, DataTable, Modal, PageHeader, StatCard, StudentAvatar, TeacherOption, TeacherSelect, RowAction, RowActions } from './_shared';
import { BatchScheduleCalendar } from '@/features/batch/shared';
import { batchMeta, batchTime, adminBatchDetailsPath, type AdminListBatch, type BatchSession } from './batchSchedulePanel';

interface Batch extends AdminListBatch {
  schedule?: string | null;
  meeting_url?: string | null;
  teacher_cost_paise?: number | null;
  pending?: { student_id: string; name: string }[];
  feedback_submitted?: number;
  feedback_pending?: number;
  average_rating?: number | null;
}

function fmtShortDate(d: string) {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// -- Create / rename modal ---------------------------------------------------
function BatchModal({ batch, teachers, onClose, onDone }:
  { batch: Batch | null; teachers: TeacherOption[]; onClose: () => void; onDone: () => void }) {
  const editing = !!batch;  // editing a course only renames it; per-session edits live on the session page
  const [form, setForm] = useState({
    teacher_id: '',
    title: batch?.title ?? '',
    frequency: 'weekly',
    start_date: '',
    end_date: '',
    slot_start: '',
    slot_end: '',
    schedule: batch?.schedule ?? '',
    meeting_url: '',
    teacher_cost: '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      if (editing) {
        return unwrap(api.patch(`/teacher/series/${batch!.id}`, {
          title: form.title,
          schedule: form.schedule || null,
        }));
      }
      return unwrap(api.post('/teacher/batches', {
        teacher_id: form.teacher_id,
        title: form.title,
        class_time: form.slot_start && form.slot_end ? `${form.slot_start}–${form.slot_end}` : null,
        slot_start: form.slot_start || null,
        slot_end: form.slot_end || null,
        schedule: form.schedule || null,
        meeting_url: form.meeting_url || null,
        teacher_cost_paise: Math.round(Number(form.teacher_cost || 0) * 100),
        frequency: form.frequency,
        start_date: form.start_date,
        end_date: form.end_date,
      }));
    },
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  const valid = editing
    ? !!form.title
    : !!form.title && !!form.teacher_id && !!form.frequency && !!form.start_date && !!form.end_date;

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{editing ? 'Rename course' : 'New course'}</h2>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3">
        <div><label className="label">Course / batch name</label><input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>

        {editing ? (
          <>
            <div><label className="label">Schedule note (optional)</label><input className="input" value={form.schedule} onChange={(e) => set('schedule', e.target.value)} /></div>
            <p className="text-xs text-slate-400">
              Renaming updates every class in this course. To change a class’s teacher,
              students, meet link, date or pay, open the class from the course’s schedule.
            </p>
          </>
        ) : (
          <>
            <div>
              <label className="label">Teacher</label>
              <TeacherSelect value={form.teacher_id} onChange={(id) => set('teacher_id', id)} teachers={teachers} />
            </div>
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
            <p className="text-xs text-slate-400">
              One independent class (sub-batch) is created for each date between start and end at
              the chosen frequency. Each class can then be managed on its own — teacher, students,
              meet link and pay. The meet link is live only during the slot on each date.
            </p>
            <div>
              <label className="label">Teacher cost per class (₹)</label>
              <input className="input" type="number" min="0" placeholder="0" value={form.teacher_cost} onChange={(e) => set('teacher_cost', e.target.value)} />
              <p className="mt-1 text-xs text-slate-400">Auto-credited to the teacher once each class date has passed.</p>
            </div>
            <div><label className="label">Schedule note (optional)</label><input className="input" value={form.schedule} onChange={(e) => set('schedule', e.target.value)} /></div>
            <div><label className="label">Google Meet link (optional)</label><input className="input" placeholder="https://meet.google.com/…" value={form.meeting_url} onChange={(e) => set('meeting_url', e.target.value)} /></div>
          </>
        )}

        <button className="btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Save' : 'Create course'}
        </button>
      </div>
    </Modal>
  );
}

// -- Today's classes (flattened per-session across every course) -------------
interface TodaySession extends BatchSession {
  courseTitle: string;
  courseId: string;
}

function fmtClassDay(d: string) {
  return parseApiDate(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function todaySessionRank(s: TodaySession) {
  if (s.meeting_active) return 0;
  const now = nowHmIST();
  const start = s.slot_start ?? '';
  const end = s.slot_end ?? '';
  if (start && end && isInSlot(now, start, end)) return 1;
  if (start && isSlotUpcoming(now, start)) return 2;
  if (s.attendance_done) return 4;
  return 3;
}

function todaySessions(rows: Batch[]): TodaySession[] {
  const today = todayIsoIST();
  const out: TodaySession[] = [];
  for (const b of rows) {
    const attDates = new Set((b.attendance_submitted_dates ?? []).map((d) => d.slice(0, 10)));
    for (const s of batchMeta(b).sessions) {
      const date = s.date?.slice(0, 10);
      if (date !== today) continue;
      out.push({
        ...s,
        courseTitle: b.title,
        courseId: b.id,
        attendance_done: attDates.has(date),
      });
    }
  }
  return out.sort((a, z) => {
    const dr = todaySessionRank(a) - todaySessionRank(z);
    if (dr !== 0) return dr;
    return (a.slot_start ?? '99:99').localeCompare(z.slot_start ?? '99:99');
  });
}

function sessionTime(s: BatchSession) {
  if (s.slot_start && s.slot_end) return `${s.slot_start}–${s.slot_end}`;
  return s.class_time ?? null;
}

export function AdminBatches() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editBatch, setEditBatch] = useState<Batch | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-batches'],
    queryFn: () => unwrap<Batch[]>(api.get('/teacher/admin/batches')),
  });
  const { data: teacherData } = useQuery({
    queryKey: ['approved-teachers'],
    queryFn: () => unwrap<{ items: TeacherOption[] }>(api.get('/teacher/applications', { params: { status: 'approved', page_size: 200 } })),
  });
  const teachers = teacherData?.items ?? [];

  const stats = useMemo(() => {
    const rows = data ?? [];
    let classesTotal = 0;
    let classesDone = 0;
    for (const b of rows) {
      const m = batchMeta(b);
      classesTotal += m.total;
      classesDone += m.done;
    }
    return {
      courses: rows.length,
      live: rows.filter((b) => b.meeting_active).length,
      pendingRequests: rows.reduce((n, b) => n + (b.pending?.length ?? 0), 0),
      members: rows.reduce((n, b) => n + b.members.length, 0),
      classesTotal,
      classesDone,
    };
  }, [data]);

  const today = useMemo(() => todaySessions(data ?? []), [data]);
  const todayLabel = useMemo(
    () => new Intl.DateTimeFormat(undefined, {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Kolkata',
    }).format(new Date()),
    [],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-batches'] });
  const delSeries = (b: Batch) =>
    b.series_id ? unwrap(api.delete(`/teacher/series/${b.id}`)) : unwrap(api.delete(`/teacher/batches/${b.id}`));

  const del = useMutation({
    mutationFn: (b: Batch) => delSeries(b),
    onSuccess: (_d, b) => {
      setSelected((cur) => { const next = new Set(cur); next.delete(b.id); return next; });
      refresh();
    },
  });

  const bulkDel = useMutation({
    mutationFn: (rows: Batch[]) => Promise.all(rows.map(delSeries)),
    onSuccess: () => { setSelected(new Set()); refresh(); },
  });

  const rowsById = useMemo(() => new Map((data ?? []).map((b) => [b.id, b])), [data]);
  const allSelected = (data?.length ?? 0) > 0 && (data ?? []).every((b) => selected.has(b.id));
  const toggleOne = (id: string) =>
    setSelected((cur) => { const next = new Set(cur); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set((data ?? []).map((b) => b.id)));

  const confirmBulkDelete = () => {
    const rows = [...selected].map((id) => rowsById.get(id)).filter(Boolean) as Batch[];
    if (!rows.length) return;
    if (!window.confirm(`Delete ${rows.length} course(es) and all their classes? They can be restored from Archive for 60 days.`)) return;
    bulkDel.mutate(rows);
  };

  const todayColumns: Column<TodaySession>[] = [
    {
      key: 'title',
      header: 'Class',
      cell: (s) => (
        <div>
          <Link to={`/admin/batches/${s.batch_id}`} className="font-semibold text-brand hover:underline">{s.courseTitle}</Link>
          <p className="mt-0.5 text-[11px] text-slate-400">{fmtClassDay(s.date)}</p>
        </div>
      ),
    },
    {
      key: 'teacher',
      header: 'Teacher',
      cell: (s) => s.teacher_name ? (
        <div className="flex items-center gap-2">
          <StudentAvatar photoUrl={s.teacher_photo_url} name={s.teacher_name} size="h-8 w-8" iconSize={16} />
          <span className="font-medium text-slate-800">{s.teacher_name}</span>
        </div>
      ) : <span className="text-slate-400">—</span>,
    },
    {
      key: 'time',
      header: 'Slot',
      cell: (s) => {
        const t = sessionTime(s);
        if (!t) return <span className="text-slate-400">—</span>;
        return (
          <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2">
            <Clock size={14} className="text-amber-600" />
            <span className="text-sm font-bold tabular-nums text-slate-900">{t}</span>
          </div>
        );
      },
    },
    {
      key: 'members',
      header: 'Members',
      align: 'right',
      cell: (s) => (
        <span className="inline-flex items-center justify-end gap-1.5 font-semibold tabular-nums text-slate-800">
          <Users size={14} className="text-slate-400" />{s.member_count ?? 0}
        </span>
      ),
    },
    {
      key: 'meet',
      header: 'Meet',
      cell: (s) => {
        if (!s.meeting_url) return <span className="text-slate-300">—</span>;
        if (s.meeting_active) {
          return <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700"><Radio size={12} className="animate-pulse" /> Live</span>;
        }
        const now = nowHmIST();
        const start = s.slot_start ?? '';
        const end = s.slot_end ?? '';
        if (end && isSlotEnded(now, end)) {
          return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500"><Video size={12} /> Closed</span>;
        }
        if (start && end && isInSlot(now, start, end)) {
          return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"><Video size={12} /> Ready</span>;
        }
        if (start && isSlotUpcoming(now, start)) {
          return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500"><Video size={12} /> Opens {start}</span>;
        }
        return <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600"><Video size={12} /> Ready</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (s) => {
        if (s.meeting_active) return <span className="badge bg-green-100 text-green-700">In session</span>;
        if (s.attendance_done) return <span className="badge bg-green-100 text-green-700">Attendance done</span>;
        const now = nowHmIST();
        const start = s.slot_start ?? '';
        const end = s.slot_end ?? '';
        if (end && isSlotEnded(now, end)) {
          return <span className="badge bg-rose-100 text-rose-800">Needs attendance</span>;
        }
        if (start && end && isInSlot(now, start, end)) {
          return <span className="badge bg-sky-100 text-sky-800">In progress</span>;
        }
        if (start && isSlotUpcoming(now, start)) {
          return <span className="badge bg-amber-100 text-amber-800">Starts {start}</span>;
        }
        return <span className="badge bg-amber-100 text-amber-800">Scheduled</span>;
      },
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (s) => (
        <RowActions>
          <RowAction icon={Eye} label="Manage class" variant="primary" to={`/admin/batches/${s.batch_id}`} />
        </RowActions>
      ),
    },
  ];

  const columns: Column<Batch>[] = [
    {
      key: 'select',
      header: (
        <input type="checkbox" className="accent-brand" checked={allSelected}
          disabled={!(data?.length)} onChange={toggleAll} aria-label="Select all courses" />
      ),
      width: '1%',
      className: 'w-10',
      cell: (b) => (
        <input type="checkbox" className="accent-brand" checked={selected.has(b.id)}
          onChange={() => toggleOne(b.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${b.title}`} />
      ),
    },
    {
      key: 'title',
      header: 'Course',
      sort: (b) => b.title,
      cell: (b) => {
        const meta = batchMeta(b);
        return (
          <div className="min-w-[10rem]">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={adminBatchDetailsPath(b)} className="font-semibold text-brand hover:underline">{b.title}</Link>
              <span className="badge bg-brand/10 text-brand">{meta.total} class{meta.total === 1 ? '' : 'es'}</span>
              {(b.pending?.length ?? 0) > 0 && <span className="badge bg-amber-100 text-amber-800">{b.pending!.length} requests</span>}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">{meta.done} of {meta.total} classes completed</p>
            <Link to={adminBatchDetailsPath(b)} className="mt-1 inline-block text-[11px] font-medium text-brand hover:underline" onClick={(e) => e.stopPropagation()}>
              View class schedule
            </Link>
          </div>
        );
      },
    },
    {
      key: 'teacher',
      header: 'Teacher',
      cell: (b) => {
        if ((b.teacher_count ?? 0) > 1) return <span className="badge bg-slate-100 text-slate-600">{b.teacher_count} teachers</span>;
        return b.teacher_name ? (
          <div className="flex items-center gap-2.5">
            <StudentAvatar photoUrl={b.teacher_photo_url} name={b.teacher_name} size="h-9 w-9" iconSize={18} />
            <Link to={`/admin/teachers/${b.teacher_id}`} className="font-medium text-brand hover:underline">{b.teacher_name}</Link>
          </div>
        ) : <span className="text-slate-400">—</span>;
      },
    },
    {
      key: 'schedule',
      header: 'Schedule',
      sort: (b) => batchMeta(b).first ?? 'z',
      cell: (b) => {
        const meta = batchMeta(b);
        const time = batchTime(b);
        return (
          <div className="min-w-[11rem] space-y-2">
            {meta.isLive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-semibold text-green-700">
                <Radio size={12} className="animate-pulse" /> Live now
              </span>
            ) : meta.next ? (
              <BatchScheduleCalendar dateIso={meta.next.date} timeLabel={time} eyebrow="Next class" />
            ) : (
              <span className="badge bg-slate-100 text-slate-600">Course complete</span>
            )}
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <Layers size={12} />
              {meta.first && meta.last ? `${fmtShortDate(meta.first)} – ${fmtShortDate(meta.last)}` : '—'}
            </div>
          </div>
        );
      },
    },
    {
      key: 'members',
      header: 'Members',
      align: 'right',
      sort: (b) => b.members.length,
      cell: (b) => (
        <span className="inline-flex items-center justify-end gap-1.5 tabular-nums">
          <Users size={14} className="text-slate-400" />
          <span className={b.members.length ? 'font-semibold text-slate-800' : 'text-slate-400'}>{b.members.length}</span>
        </span>
      ),
    },
    {
      key: 'feedback',
      header: 'Feedback',
      cell: (b) =>
        b.feedback_submitted || b.feedback_pending ? (
          <div className="text-right text-xs">
            <p className="font-semibold text-slate-700">{b.feedback_submitted ?? 0} submitted</p>
            {b.average_rating != null && <p className="text-brand-gold">{b.average_rating}★ avg</p>}
            {(b.feedback_pending ?? 0) > 0 && <p className="text-slate-400">{b.feedback_pending} pending</p>}
          </div>
        ) : <span className="text-slate-300">—</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (b) => (
        <RowActions>
          <RowAction icon={Eye} label="View classes" variant="primary" to={adminBatchDetailsPath(b)} />
          <RowAction icon={Pencil} label="Rename course" onClick={() => setEditBatch(b)} />
          <RowAction icon={Trash2} label="Delete course" variant="danger" disabled={del.isPending}
            onClick={() => {
              const n = batchMeta(b).total;
              if (window.confirm(`Delete "${b.title}" and all ${n} class(es)? It can be restored from Archive for 60 days.`)) del.mutate(b);
            }} />
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Batches"
        description="Create a course, generate its classes, assign teachers and members per class, and track every class date."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>New course</button>}
      />

      {!isLoading && (data?.length ?? 0) > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Courses" value={stats.courses} hint={`${stats.classesTotal} total classes`} />
          <StatCard label="Classes completed" value={`${stats.classesDone}/${stats.classesTotal}`} hint="Attendance submitted" />
          <StatCard label="Live now" value={stats.live} hint="Meet links active" />
          <StatCard label="Join requests" value={stats.pendingRequests} hint={`${stats.members} enrolled members`} icon={UserPlus} />
        </div>
      )}

      <section className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">Today&apos;s classes</h2>
            <p className="mt-0.5 text-sm text-slate-500">{todayLabel} · {today.length} class{today.length === 1 ? '' : 'es'}</p>
          </div>
          {today.some((s) => s.meeting_active) && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
              <Radio size={12} className="animate-pulse" />
              {today.filter((s) => s.meeting_active).length} live now
            </span>
          )}
        </div>
        <DataTable
          rows={today}
          columns={todayColumns}
          loading={isLoading}
          rowKey={(s) => `today-${s.batch_id}`}
          pageSize={20}
          emptyLabel="No classes scheduled for today."
        />
      </section>

      <section>
        <div className="mt-6 mb-1">
          <h2 className="text-lg font-extrabold text-slate-900">All courses</h2>
          <p className="mt-0.5 text-sm text-slate-500">Every course, its class schedule and members</p>
        </div>
        <DataTable
          rows={data}
          columns={columns}
          loading={isLoading}
          rowKey={(b) => b.id}
          searchText={(b) => `${b.title} ${b.teacher_name ?? ''}`}
          searchPlaceholder="Search course or teacher…"
          initialSort={{ key: 'schedule', dir: 'asc' }}
          pageSize={15}
          emptyLabel="No courses yet."
          filters={selected.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-600">{selected.size} selected</span>
              <button type="button" className="btn-ghost py-1.5 text-xs text-red-600 hover:bg-red-50"
                disabled={bulkDel.isPending} onClick={confirmBulkDelete}>
                {bulkDel.isPending ? 'Deleting…' : 'Delete selected'}
              </button>
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : undefined}
        />
      </section>

      {creating && <BatchModal batch={null} teachers={teachers} onClose={() => setCreating(false)} onDone={refresh} />}
      {editBatch && <BatchModal batch={editBatch} teachers={teachers} onClose={() => setEditBatch(null)} onDone={refresh} />}
    </div>
  );
}
