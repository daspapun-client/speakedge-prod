/**
 * Admin -> Exams & Certification.
 *
 * Mirrors the three things the spec says admin needs, in order:
 *   1. Examiners     — the authorised examiner list, with the WhatsApp number
 *                      published to students on every slot they are assigned.
 *   2. Weekly slots  — a weekday + a start time ("Sunday – 11:00 AM") that
 *                      repeats every week until it is changed or removed.
 *   3. Exam dates    — the bookable dates those weekly slots produce, plus any
 *                      one-off sitting added by hand; an examiner can be
 *                      re-assigned or a single date cancelled here.
 * Bookings and the two result views (CEFR / Speaking) follow.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CalendarPlus, CalendarSync, CheckCircle2, GraduationCap, Mic, Pencil, Plus, Repeat, Trash2,
  UserCog, XCircle,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import {
  AdminStudentLink, Column, DataTable, Modal, PageHeader, Paginator, RowAction,
  RowActionDivider, RowActions, StatusBadge, TableFilter, badgeClass, fmtDate,
} from './_shared';
import {
  DEFAULT_SLOT_MINUTES, EXAM_KINDS, ExaminerContact, WEEKDAYS, fmtSlot, slotWindow,
  weeklySlotLabel, type ExamSlot, type ExamSlotRule, type ExaminerRow,
} from '@/features/exams/shared';

interface Booking {
  id: string;
  student_id: string;
  student_name?: string | null;
  student_photo_url?: string | null;
  student_gender?: string | null;
  exam_title?: string | null;
  kind?: string | null;
  scheduled_at?: string | null;
  duration_minutes?: number | null;
  examiner_id?: string | null;
  examiner_name?: string | null;
  examiner_whatsapp?: string | null;
  status: string;
  created_at: string;
}

interface ResultRow {
  id: string;
  student_id: string;
  student_name?: string | null;
  student_photo_url?: string | null;
  student_gender?: string | null;
  exam_title?: string | null;
  exam_date?: string | null;
  examiner_name?: string | null;
  remarks?: string | null;
  level?: string;
  grade?: string | null;
  title?: string;
  verification_code: string;
  report_url?: string | null;
  certificate_url?: string | null;
  created_at: string;
}

type Tab = 'examiners' | 'weekly' | 'slots' | 'bookings' | 'cefr' | 'speaking';

const TABS: { key: Tab; label: string }[] = [
  { key: 'examiners', label: 'Examiners' },
  { key: 'weekly', label: 'Weekly slots' },
  { key: 'slots', label: 'Exam dates' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'cefr', label: 'CEFR results' },
  { key: 'speaking', label: 'Speaking results' },
];

/** `datetime-local` value <-> ISO instant. */
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);
const toLocal = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ------------------------------------------------------------------ *
 *  1. Examiner list                                                    *
 * ------------------------------------------------------------------ */
function ExaminerModal({ examiner, onClose, onDone }: {
  examiner: ExaminerRow | null; // null = add a new examiner
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    username: examiner?.username ?? '',
    full_name: examiner?.full_name ?? '',
    email: examiner?.email ?? '',
    phone: examiner?.phone ?? '',
    whatsapp: examiner?.whatsapp ?? '',
    password: '',
    is_active: examiner?.is_active ?? true,
  });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      if (!form.full_name.trim()) throw new Error('Examiner name is required');
      if (!examiner) {
        if (!form.username.trim()) throw new Error('Username / login email is required');
        if (form.password.length < 8) throw new Error('Password must be at least 8 characters');
        return unwrap(api.post('/exams/admin/examiners', {
          username: form.username.trim(),
          password: form.password,
          full_name: form.full_name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          whatsapp: form.whatsapp.trim() || null,
        }));
      }
      return unwrap(api.patch(`/exams/admin/examiners/${encodeURIComponent(examiner.username)}`, {
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        is_active: form.is_active,
        ...(form.password ? { password: form.password } : {}),
      }));
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{examiner ? 'Edit examiner' : 'Add examiner'}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            The name and WhatsApp number are shown to students on every slot this examiner is assigned to.
          </p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 space-y-3">
        <div>
          <label className="label">Username / login email</label>
          <input
            className="input"
            value={form.username}
            disabled={!!examiner}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="examiner@speakedge.in"
          />
        </div>
        <div>
          <label className="label">Full name (shown to students)</label>
          <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">WhatsApp number (published)</label>
            <input className="input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="9876543210" />
          </div>
          <div>
            <label className="label">Phone (internal)</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">{examiner ? 'New password (leave blank to keep)' : 'Password'}</label>
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        {examiner && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
            Active — deactivated examiners cannot be assigned to new slots
          </label>
        )}
        <button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          {examiner ? 'Save examiner' : 'Add examiner'}
        </button>
      </div>
    </Modal>
  );
}

function ExaminersTab({ examiners, loading, refresh }: {
  examiners?: ExaminerRow[]; loading: boolean; refresh: () => void;
}) {
  const [editing, setEditing] = useState<ExaminerRow | null>(null);
  const [adding, setAdding] = useState(false);

  const columns: Column<ExaminerRow>[] = [
    {
      key: 'full_name',
      header: 'Examiner',
      sort: (e) => e.full_name ?? e.username,
      cell: (e) => (
        <div className="min-w-0">
          <div className="font-semibold text-slate-800">{e.full_name || e.username}</div>
          <div className="font-mono text-xs text-slate-400">{e.username}</div>
        </div>
      ),
    },
    {
      key: 'whatsapp',
      header: 'Published contact',
      cell: (e) => (
        <ExaminerContact
          examiner={{ examiner_name: e.full_name || e.username, examiner_whatsapp: e.whatsapp, examiner_phone: e.phone }}
        />
      ),
    },
    { key: 'assigned_slots', header: 'Slots', sort: (e) => e.assigned_slots, cell: (e) => `${e.assigned_slots} (${e.upcoming_slots} upcoming)` },
    { key: 'students_booked', header: 'Students', sort: (e) => e.students_booked },
    { key: 'reports_submitted', header: 'Reports', sort: (e) => e.reports_submitted },
    {
      key: 'is_active',
      header: 'Status',
      sort: (e) => String(e.is_active),
      cell: (e) => <StatusBadge status={e.is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (e) => (
        <RowActions>
          <RowAction icon={Pencil} label="Edit examiner" onClick={() => setEditing(e)} />
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <DataTable
        rows={examiners}
        columns={columns}
        loading={loading}
        rowKey={(e) => e.username}
        searchText={(e) => `${e.full_name ?? ''} ${e.username} ${e.whatsapp ?? ''}`}
        searchPlaceholder="Search examiners"
        emptyLabel="No examiners yet — add one to start assigning exam slots."
        toolbarRight={
          <button className="btn-primary inline-flex items-center gap-1.5 py-1.5 text-xs" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add examiner
          </button>
        }
      />
      {(adding || editing) && (
        <ExaminerModal
          examiner={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onDone={refresh}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  2. Weekly exam slots — weekday + time, repeating                    *
 * ------------------------------------------------------------------ */
/** `WEEKDAYS` is lowercase on the wire; the picker shows it title-cased. */
const dayLabel = (day: string) => day.charAt(0).toUpperCase() + day.slice(1);

function WeeklySlotModal({ rule, examiners, onClose, onDone }: {
  rule: ExamSlotRule | null; // null = add a new weekly slot
  examiners: ExaminerRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    kind: rule?.kind ?? 'CEFR',
    title: rule?.title ?? '',
    day_of_week: rule?.day_of_week ?? 'sunday',
    time_of_day: rule?.time_of_day ?? '11:00',
    duration_minutes: rule?.duration_minutes ?? DEFAULT_SLOT_MINUTES,
    capacity: rule?.capacity ?? 1,
    examiner_id: rule?.examiner_id ?? '',
  });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      if (!form.title.trim()) throw new Error('Exam name is required');
      if (!form.time_of_day) throw new Error('Start time is required');
      const body = { ...form, title: form.title.trim(), examiner_id: form.examiner_id || null };
      return rule
        ? unwrap(api.patch(`/exams/admin/slot-rules/${rule.id}`, body))
        : unwrap(api.post('/exams/admin/slot-rules', body));
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{rule ? 'Edit weekly slot' : 'Add a weekly slot'}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Repeats every week on the same day and time until you change or remove it.
          </p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Exam type</label>
            <select className="input" value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {EXAM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Exam name</label>
            <input className="input" value={form.title} placeholder="CEFR Assessment"
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="label">Repeats on</label>
            <select className="input" value={form.day_of_week}
              onChange={(e) => setForm({ ...form, day_of_week: e.target.value })}>
              {WEEKDAYS.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Start time (IST)</label>
            <input className="input" type="time" value={form.time_of_day}
              onChange={(e) => setForm({ ...form, time_of_day: e.target.value })} />
          </div>
          <div>
            <label className="label">Slot length (minutes)</label>
            <input className="input" type="number" min={5} step={5} value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) || DEFAULT_SLOT_MINUTES })} />
          </div>
          <div>
            <label className="label">Seats</label>
            <input className="input" type="number" min={1} value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) || 1 })} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Examiner</label>
            <select className="input" value={form.examiner_id}
              onChange={(e) => setForm({ ...form, examiner_id: e.target.value })}>
              <option value="">Unassigned</option>
              {examiners.filter((e) => e.is_active || e.username === rule?.examiner_id).map((e) => (
                <option key={e.username} value={e.username}>{e.full_name || e.username}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">
            {weeklySlotLabel(form.day_of_week, form.time_of_day)}
          </span>{' '}
          — every week, {form.duration_minutes} min, {form.capacity} seat{form.capacity === 1 ? '' : 's'}.
          {rule && ' Dates a student has already booked keep their original time.'}
        </p>

        <button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>
          {rule ? 'Save weekly slot' : 'Add weekly slot'}
        </button>
      </div>
    </Modal>
  );
}

function WeeklySlotsTab({ examiners, refresh }: { examiners: ExaminerRow[]; refresh: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState<ExamSlotRule | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const rules = useQuery({
    queryKey: ['admin-exam-slot-rules', kind],
    queryFn: () => unwrap<ExamSlotRule[]>(api.get('/exams/admin/slot-rules', {
      params: { kind: kind || undefined },
    })),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-exam-slot-rules'] });
    qc.invalidateQueries({ queryKey: ['admin-exam-slots'] });
    refresh();
  };

  const remove = useMutation({
    mutationFn: async (rule: ExamSlotRule) => {
      const r = await api.delete(`/exams/admin/slot-rules/${rule.id}`);
      return r.data?.message as string | undefined;
    },
    onSuccess: (message) => { setError(''); setNote(message ?? ''); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const columns: Column<ExamSlotRule>[] = [
    {
      key: 'slot',
      header: 'Weekly slot',
      sort: (r) => `${WEEKDAYS.indexOf(r.day_of_week as typeof WEEKDAYS[number])}${r.time_of_day}`,
      cell: (r) => (
        <div>
          <div className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
            <Repeat size={14} className="shrink-0 text-brand" /> {r.label}
          </div>
          <div className="text-xs text-slate-400">Every week · {r.duration_minutes} min</div>
        </div>
      ),
    },
    { key: 'title', header: 'Exam name', sort: (r) => r.title },
    {
      key: 'kind',
      header: 'Type',
      sort: (r) => r.kind,
      cell: (r) => <span className={`badge ${badgeClass(r.kind)}`}>{r.kind}</span>,
    },
    { key: 'examiner', header: 'Examiner', sort: (r) => r.examiner_name ?? '', cell: (r) => <ExaminerContact examiner={r} /> },
    {
      key: 'seats',
      header: 'Seats',
      sort: (r) => r.capacity,
      cell: (r) => <span className="text-slate-600">{r.capacity}</span>,
    },
    {
      key: 'upcoming',
      header: 'Open dates',
      sort: (r) => r.upcoming_slots,
      cell: (r) => (
        <div>
          <div className="text-slate-600">{r.upcoming_slots} upcoming</div>
          <div className="text-xs text-slate-400">
            {r.next_slot ? `Next: ${fmtSlot(r.next_slot)}` : 'None scheduled'}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (r) => (
        <RowActions>
          <RowAction icon={Pencil} label="Edit weekly slot" onClick={() => setEditing(r)} />
          <RowActionDivider />
          <RowAction icon={Trash2} label="Remove weekly slot" variant="danger"
            onClick={() => remove.mutate(r)} />
        </RowActions>
      ),
    },
  ];

  return (
    <>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {note && <p className="mt-3 text-sm text-emerald-700">{note}</p>}
      <DataTable
        rows={rules.data}
        columns={columns}
        loading={rules.isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.label} ${r.title} ${r.kind} ${r.examiner_name ?? ''}`}
        searchPlaceholder="Search weekly slots"
        initialSort={{ key: 'slot', dir: 'asc' }}
        emptyLabel="No weekly slots yet. Add one and it repeats every week."
        filters={
          <TableFilter
            value={kind}
            onChange={setKind}
            options={[{ value: '', label: 'All types' }, ...EXAM_KINDS.map((k) => ({ value: k, label: k }))]}
          />
        }
        toolbarRight={
          <button className="btn-primary inline-flex items-center gap-1.5 py-1.5 text-xs" onClick={() => setAdding(true)}>
            <CalendarSync size={14} /> Add weekly slot
          </button>
        }
      />
      {(adding || editing) && (
        <WeeklySlotModal
          rule={editing}
          examiners={examiners}
          onClose={() => { setAdding(false); setEditing(null); }}
          onDone={() => { setNote(''); invalidate(); }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  3. Exam dates — what the weekly slots produced, plus one-off sittings *
 * ------------------------------------------------------------------ */
function BulkSlotModal({ examiners, onClose, onDone }: {
  examiners: ExaminerRow[]; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState({
    kind: 'CEFR',
    title: '',
    duration_minutes: DEFAULT_SLOT_MINUTES,
    capacity: 1,
    examiner_id: '',
  });
  const [dates, setDates] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [dateDraft, setDateDraft] = useState('');
  const [timeDraft, setTimeDraft] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState('');

  const addDate = () => {
    if (dateDraft && !dates.includes(dateDraft)) setDates([...dates, dateDraft].sort());
    setDateDraft('');
  };
  const addTime = () => {
    if (timeDraft && !times.includes(timeDraft)) setTimes([...times, timeDraft].sort());
    setTimeDraft('');
  };

  /** Fill a whole day from a start time, stepping by the slot length. */
  const fillDay = (start: string, count: number) => {
    if (!start) return;
    const [h, m] = start.split(':').map(Number);
    const next = new Set(times);
    for (let i = 0; i < count; i += 1) {
      const total = h * 60 + m + i * form.duration_minutes;
      if (total >= 24 * 60) break;
      next.add(`${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`);
    }
    setTimes([...next].sort());
  };

  const create = useMutation({
    mutationFn: () => {
      if (!form.title.trim()) throw new Error('Exam title is required');
      if (!dates.length) throw new Error('Add at least one date');
      if (!times.length) throw new Error('Add at least one start time');
      return unwrap<{ created: number; skipped: number }>(api.post('/exams/slots/bulk', {
        ...form,
        title: form.title.trim(),
        examiner_id: form.examiner_id || null,
        dates,
        times,
      }));
    },
    onSuccess: (data) => {
      setError('');
      setResult(`${data.created} slot(s) created${data.skipped ? `, ${data.skipped} already existed` : ''}.`);
      setDates([]);
      setTimes([]);
      onDone();
    },
    onError: (e: Error) => setError(e.message),
  });

  const total = dates.length * times.length;

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Add one-off exam dates</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            For an extra sitting outside the weekly rhythm — one bookable date per
            day × time. Regular slots belong on the Weekly slots tab.
          </p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {result && <p className="mt-3 text-sm text-emerald-600">{result}</p>}

      <div className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Exam type</label>
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {EXAM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Exam name</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. CEFR Assessment – September" />
          </div>
          <div>
            <label className="label">Slot length (minutes)</label>
            <input className="input" type="number" min={5} step={5} value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) || DEFAULT_SLOT_MINUTES })} />
          </div>
          <div>
            <label className="label">Seats per slot</label>
            <input className="input" type="number" min={1} value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) || 1 })} />
          </div>
        </div>

        <div>
          <label className="label">Examiner (assigned to every slot created)</label>
          <select className="input" value={form.examiner_id} onChange={(e) => setForm({ ...form, examiner_id: e.target.value })}>
            <option value="">Assign later</option>
            {examiners.filter((e) => e.is_active).map((e) => (
              <option key={e.username} value={e.username}>{e.full_name || e.username}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Dates</label>
            <div className="mt-1 flex gap-2">
              <input className="input" type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} />
              <button type="button" className="btn-ghost shrink-0 px-3" onClick={addDate}><Plus size={16} /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {dates.map((d) => (
                <button key={d} type="button" className="badge bg-brand/10 text-brand hover:bg-red-100 hover:text-red-600"
                  onClick={() => setDates(dates.filter((x) => x !== d))}>
                  {d} ×
                </button>
              ))}
              {!dates.length && <span className="text-xs text-slate-400">No dates added yet</span>}
            </div>
          </div>

          <div>
            <label className="label">Start times</label>
            <div className="mt-1 flex gap-2">
              <input className="input" type="time" value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} />
              <button type="button" className="btn-ghost shrink-0 px-3" onClick={addTime}><Plus size={16} /></button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button type="button" className="btn-ghost py-1 text-xs" onClick={() => fillDay(timeDraft || '10:00', 6)}>
                +6 back-to-back
              </button>
              <button type="button" className="btn-ghost py-1 text-xs" onClick={() => fillDay(timeDraft || '10:00', 12)}>
                +12 back-to-back
              </button>
              {!!times.length && (
                <button type="button" className="btn-ghost py-1 text-xs text-red-600" onClick={() => setTimes([])}>Clear</button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {times.map((t) => (
                <button key={t} type="button" className="badge bg-brand/10 text-brand hover:bg-red-100 hover:text-red-600"
                  onClick={() => setTimes(times.filter((x) => x !== t))}>
                  {t} ×
                </button>
              ))}
              {!times.length && <span className="text-xs text-slate-400">No times added yet</span>}
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {total > 0
            ? `${dates.length} date(s) × ${times.length} time(s) = ${total} slot(s), ${form.duration_minutes} min each.`
            : 'Add dates and times to see how many slots will be created.'}
        </div>

        <button className="btn-primary w-full" disabled={create.isPending || !total} onClick={() => create.mutate()}>
          Create {total || ''} slot{total === 1 ? '' : 's'}
        </button>
      </div>
    </Modal>
  );
}

function SlotModal({ slot, examiners, onClose, onDone }: {
  slot: ExamSlot; examiners: ExaminerRow[]; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState({
    title: slot.title,
    kind: slot.kind,
    scheduled_at: toLocal(slot.scheduled_at),
    duration_minutes: slot.duration_minutes,
    capacity: slot.capacity,
    examiner_id: slot.examiner_id ?? '',
  });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error('Exam title is required');
      await unwrap(api.patch(`/exams/${slot.id}`, {
        title: form.title.trim(),
        kind: form.kind,
        scheduled_at: toIso(form.scheduled_at),
        duration_minutes: form.duration_minutes,
        capacity: form.capacity,
      }));
      // Assignment is its own action: it notifies the examiner and everyone
      // already holding a seat on the slot.
      if ((slot.examiner_id ?? '') !== form.examiner_id) {
        await unwrap(api.post(`/exams/${slot.id}/assign`, { examiner_id: form.examiner_id || null }));
      }
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Edit exam date</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {slot.seats_taken} of {slot.capacity} seat{slot.capacity === 1 ? '' : 's'} booked
            {slot.rule_id && ' · this one date only — the weekly slot is unchanged'}
          </p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Exam type</label>
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {EXAM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Exam name</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label className="label">Date &amp; start time</label>
            <input className="input" type="datetime-local" value={form.scheduled_at}
              onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </div>
          <div>
            <label className="label">Slot length (minutes)</label>
            <input className="input" type="number" min={5} step={5} value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) || DEFAULT_SLOT_MINUTES })} />
          </div>
          <div>
            <label className="label">Seats</label>
            <input className="input" type="number" min={1} value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) || 1 })} />
          </div>
          <div>
            <label className="label">Examiner</label>
            <select className="input" value={form.examiner_id} onChange={(e) => setForm({ ...form, examiner_id: e.target.value })}>
              <option value="">Unassigned</option>
              {examiners.filter((e) => e.is_active || e.username === slot.examiner_id).map((e) => (
                <option key={e.username} value={e.username}>{e.full_name || e.username}</option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn-primary w-full" disabled={save.isPending} onClick={() => save.mutate()}>Save slot</button>
      </div>
    </Modal>
  );
}

function SlotsTab({ examiners, refresh }: { examiners: ExaminerRow[]; refresh: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState('');
  const [editing, setEditing] = useState<ExamSlot | null>(null);
  const [bulk, setBulk] = useState(false);
  const [error, setError] = useState('');

  const slots = useQuery({
    queryKey: ['admin-exam-slots', kind],
    queryFn: () => unwrap<ExamSlot[]>(api.get('/exams/', { params: { kind: kind || undefined } })),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-exam-slots'] });
    refresh();
  };

  const remove = useMutation({
    mutationFn: (slot: ExamSlot) => unwrap(api.delete(`/exams/${slot.id}`)),
    onSuccess: () => { setError(''); invalidate(); },
    onError: (e: Error) => setError(e.message),
  });

  const columns: Column<ExamSlot>[] = [
    {
      key: 'scheduled_at',
      header: 'Date & slot',
      sort: (s) => s.scheduled_at ?? '',
      cell: (s) => (
        <div>
          <div className="font-semibold text-slate-800">{fmtSlot(s.scheduled_at) ?? 'No date set'}</div>
          <div className="text-xs text-slate-400">{slotWindow(s.scheduled_at, s.duration_minutes)}</div>
          {s.rule_id && (
            <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand">
              <Repeat size={11} className="shrink-0" /> from a weekly slot
            </div>
          )}
        </div>
      ),
    },
    { key: 'title', header: 'Exam name', sort: (s) => s.title },
    { key: 'kind', header: 'Type', sort: (s) => s.kind, cell: (s) => <span className={`badge ${badgeClass(s.kind)}`}>{s.kind}</span> },
    { key: 'examiner', header: 'Examiner', sort: (s) => s.examiner_name ?? '', cell: (s) => <ExaminerContact examiner={s} /> },
    {
      key: 'seats',
      header: 'Seats',
      sort: (s) => s.seats_taken,
      cell: (s) => (
        <span className={s.seats_left <= 0 ? 'font-medium text-amber-600' : 'text-slate-600'}>
          {s.seats_taken} / {s.capacity}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (s) => (
        <RowActions>
          <RowAction icon={Pencil} label="Edit slot / assign examiner" onClick={() => setEditing(s)} />
          {s.seats_taken === 0 && (
            <>
              <RowActionDivider />
              <RowAction icon={Trash2} label="Delete slot" variant="danger" onClick={() => remove.mutate(s)} />
            </>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <DataTable
        rows={slots.data}
        columns={columns}
        loading={slots.isLoading}
        rowKey={(s) => s.id}
        searchText={(s) => `${s.title} ${s.kind} ${s.examiner_name ?? ''}`}
        searchPlaceholder="Search exam slots"
        initialSort={{ key: 'scheduled_at', dir: 'asc' }}
        emptyLabel="No exam dates yet — add a weekly slot and they appear here."
        filters={
          <TableFilter
            value={kind}
            onChange={setKind}
            options={[{ value: '', label: 'All types' }, ...EXAM_KINDS.map((k) => ({ value: k, label: k }))]}
          />
        }
        toolbarRight={
          <button className="btn-ghost inline-flex items-center gap-1.5 py-1.5 text-xs" onClick={() => setBulk(true)}>
            <CalendarPlus size={14} /> Add one-off dates
          </button>
        }
      />
      {bulk && <BulkSlotModal examiners={examiners} onClose={() => setBulk(false)} onDone={invalidate} />}
      {editing && (
        <SlotModal slot={editing} examiners={examiners} onClose={() => setEditing(null)} onDone={invalidate} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 *  Page                                                                *
 * ------------------------------------------------------------------ */
export function AdminExams() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('slots');
  const [bkStatus, setBkStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const examiners = useQuery({
    queryKey: ['admin-examiners'],
    queryFn: () => unwrap<ExaminerRow[]>(api.get('/exams/admin/examiners')),
  });
  const bookings = useQuery({
    queryKey: ['admin-exam-bookings', bkStatus, page],
    queryFn: () => unwrap<{ items: Booking[]; total: number }>(
      api.get('/exams/admin/bookings', { params: { status: bkStatus || undefined, page, page_size: pageSize } })),
    enabled: tab === 'bookings',
  });
  const results = useQuery({
    queryKey: ['admin-exam-results'],
    queryFn: () => unwrap<{ cefr_reports: ResultRow[]; certificates: ResultRow[] }>(
      api.get('/exams/admin/results')),
    enabled: tab === 'cefr' || tab === 'speaking',
  });

  const refreshExaminers = () => qc.invalidateQueries({ queryKey: ['admin-examiners'] });

  const bookingColumns: Column<Booking>[] = [
    {
      key: 'scheduled_at',
      header: 'Exam date & slot',
      sort: (b) => b.scheduled_at ?? '',
      cell: (b) => (
        <div>
          <div className="font-medium text-slate-700">{fmtSlot(b.scheduled_at) ?? 'No date set'}</div>
          <div className="text-xs text-slate-400">{slotWindow(b.scheduled_at, b.duration_minutes)}</div>
        </div>
      ),
    },
    {
      key: 'student',
      header: 'Student',
      sort: (b) => b.student_name ?? b.student_id,
      cell: (b) => (
        <AdminStudentLink studentId={b.student_id} name={b.student_name} photoUrl={b.student_photo_url} gender={b.student_gender} />
      ),
    },
    { key: 'exam_title', header: 'Exam', sort: (b) => b.exam_title ?? '', cell: (b) => b.exam_title || '—' },
    { key: 'kind', header: 'Type', sort: (b) => b.kind ?? '', cell: (b) => (b.kind ? <span className={`badge ${badgeClass(b.kind)}`}>{b.kind}</span> : '—') },
    { key: 'examiner', header: 'Examiner', sort: (b) => b.examiner_name ?? '', cell: (b) => <ExaminerContact examiner={b} /> },
    { key: 'status', header: 'Status', sort: (b) => b.status, cell: (b) => <StatusBadge status={b.status} /> },
    { key: 'created_at', header: 'Booked', sort: (b) => b.created_at, cell: (b) => <span className="text-slate-500">{fmtDate(b.created_at)}</span> },
  ];

  const studentColumn: Column<ResultRow> = {
    key: 'student',
    header: 'Student ID',
    sort: (r) => r.student_name ?? r.student_id,
    cell: (r) => (
      <AdminStudentLink studentId={r.student_id} name={r.student_name} photoUrl={r.student_photo_url} gender={r.student_gender} />
    ),
  };
  const examDateColumn: Column<ResultRow> = {
    key: 'exam_date',
    header: 'Exam date',
    sort: (r) => r.exam_date ?? r.created_at,
    cell: (r) => (
      <div>
        <div className="text-slate-700">{fmtDate(r.exam_date ?? r.created_at)}</div>
        {r.exam_title && <div className="text-xs text-slate-400">{r.exam_title}</div>}
      </div>
    ),
  };
  const examinerColumn: Column<ResultRow> = {
    key: 'examiner_name',
    header: 'Examiner name',
    sort: (r) => r.examiner_name ?? '',
    cell: (r) => <span className="text-slate-700">{r.examiner_name || '—'}</span>,
  };
  const remarksColumn: Column<ResultRow> = {
    key: 'remarks',
    header: 'Remarks',
    cell: (r) => <span className="text-slate-600">{r.remarks || '—'}</span>,
  };

  const cefrColumns: Column<ResultRow>[] = [
    examDateColumn,
    studentColumn,
    examinerColumn,
    { key: 'level', header: 'CEFR level', sort: (r) => r.level ?? '', cell: (r) => <span className="font-semibold text-brand">{r.level}</span> },
    remarksColumn,
    { key: 'verification_code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.verification_code}</span> },
    { key: 'pdf', header: 'PDF', width: '1%', cell: (r) => (r.report_url ? <a className="text-brand underline" href={r.report_url} target="_blank" rel="noreferrer">Open</a> : '—') },
  ];

  const certColumns: Column<ResultRow>[] = [
    examDateColumn,
    studentColumn,
    examinerColumn,
    { key: 'grade', header: 'Grade / result', sort: (r) => r.grade ?? '', cell: (r) => <span className="font-semibold text-brand">{r.grade || r.title || '—'}</span> },
    remarksColumn,
    { key: 'verification_code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.verification_code}</span> },
    { key: 'pdf', header: 'PDF', width: '1%', cell: (r) => (r.certificate_url ? <a className="text-brand underline" href={r.certificate_url} target="_blank" rel="noreferrer">Open</a> : '—') },
  ];

  const stats = examiners.data ?? [];
  const active = stats.filter((e) => e.is_active).length;

  return (
    <div>
      <PageHeader
        title="Exams & Certification"
        description="Examiner list, exam slot list (day & time wise), examiner assignment, bookings and published results."
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`btn-ghost py-1 text-xs ${tab === t.key ? 'bg-slate-100' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        {!!stats.length && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500">
            {active ? <CheckCircle2 size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-amber-500" />}
            {active} active examiner{active === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {tab === 'examiners' && (
        <ExaminersTab examiners={examiners.data} loading={examiners.isLoading} refresh={refreshExaminers} />
      )}

      {(tab === 'weekly' || tab === 'slots') && (
        stats.length === 0 && !examiners.isLoading ? (
          <div className="card mt-4 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
              <UserCog size={22} />
            </div>
            <p className="mt-3 font-semibold text-slate-700">Add an examiner first</p>
            <p className="mt-1 text-sm text-slate-500">
              Slots publish the assigned examiner’s name and WhatsApp number to students.
            </p>
            <button className="btn-primary mt-4" onClick={() => setTab('examiners')}>Go to examiners</button>
          </div>
        ) : tab === 'weekly' ? (
          <WeeklySlotsTab examiners={stats} refresh={refreshExaminers} />
        ) : (
          <SlotsTab examiners={stats} refresh={refreshExaminers} />
        )
      )}

      {tab === 'bookings' && (
        <DataTable
          rows={bookings.data?.items}
          columns={bookingColumns}
          loading={bookings.isLoading}
          rowKey={(b) => b.id}
          emptyLabel="No bookings."
          filters={
            <TableFilter
              value={bkStatus}
              onChange={(v) => { setBkStatus(v); setPage(1); }}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'booked', label: 'Booked' },
                { value: 'completed', label: 'Completed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          }
          externalPaginator={<Paginator page={page} pageSize={pageSize} total={bookings.data?.total ?? 0} onPage={setPage} />}
        />
      )}

      {tab === 'cefr' && (
        <section className="mt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <GraduationCap size={16} className="text-brand" /> CEFR Test Reports
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Exam date, student, examiner, level and remarks — the student receives the report card and a Verified
            community profile as soon as the examiner submits.
          </p>
          <DataTable
            rows={results.data?.cefr_reports}
            columns={cefrColumns}
            loading={results.isLoading}
            rowKey={(r) => r.id}
            searchText={(r) => `${r.student_id} ${r.student_name ?? ''} ${r.examiner_name ?? ''} ${r.level ?? ''} ${r.verification_code}`}
            searchPlaceholder="Search CEFR reports"
            initialSort={{ key: 'exam_date', dir: 'desc' }}
            emptyLabel="No CEFR reports yet."
          />
        </section>
      )}

      {tab === 'speaking' && (
        <section className="mt-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Mic size={16} className="text-brand-gold" /> Speaking Test Results
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Exam date, student, examiner and grade — the certificate is generated automatically and stored in the
            student dashboard.
          </p>
          <DataTable
            rows={results.data?.certificates}
            columns={certColumns}
            loading={results.isLoading}
            rowKey={(r) => r.id}
            searchText={(r) => `${r.student_id} ${r.student_name ?? ''} ${r.examiner_name ?? ''} ${r.grade ?? ''} ${r.verification_code}`}
            searchPlaceholder="Search speaking results"
            initialSort={{ key: 'exam_date', dir: 'desc' }}
            emptyLabel="No speaking test results yet."
          />
        </section>
      )}
    </div>
  );
}
