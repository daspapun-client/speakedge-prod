/**
 * Examiner Dashboard home — the assigned exams queue.
 *
 * Everything here is scoped server-side to slots assigned to the signed-in
 * examiner: they see their own workload and can report only on their own
 * bookings. Searching students and browsing submitted reports live on their
 * own pages in the examiner sidebar.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarClock, CheckCircle2, ClipboardList, Clock, Users, Video } from 'lucide-react';
import {
  Column, DataTable, PageHeader, StatCard, StatusBadge, StudentAvatar,
  TableFilter, fmtDate,
} from '@/features/admin/_shared';
import { api, unwrap } from '@/lib/api';
import { badgeClass } from '@/features/admin/_shared';
import { JoinMeeting, fmtSlot, slotWindow, type AssignedBooking, type ExamSlot } from '@/features/exams/shared';
import { ReportModal } from './ReportModal';

interface Summary {
  assigned_slots: number;
  upcoming_slots: number;
  students_booked: number;
  pending_reports: number;
  reports_submitted: number;
  next_slot?: string | null;
}

const STATUS_OPTIONS = [
  { value: 'booked', label: 'Awaiting report' },
  { value: '', label: 'All bookings' },
  { value: 'completed', label: 'Reported' },
  { value: 'cancelled', label: 'Cancelled' },
];

/**
 * One assigned slot with the room it is conducted in. The examiner pastes their
 * own Google Meet link here; every student holding a seat on that slot is
 * notified and sees it on their Exams page.
 */
function SlotMeetingRow({ slot, onSaved }: { slot: ExamSlot; onSaved: () => void }) {
  const [url, setUrl] = useState(slot.meeting_url ?? '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => unwrap(api.post(`/exams/${slot.id}/meeting-link`, {
      meeting_url: url.trim() || null,
    })),
    onSuccess: () => { setError(''); setSaved(true); onSaved(); },
    onError: (e: Error) => { setSaved(false); setError(e.message); },
  });

  const changed = url.trim() !== (slot.meeting_url ?? '');

  return (
    <div className="border-t border-slate-100 px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-800">{slot.title}</div>
          <div className="text-xs text-slate-500">
            {fmtSlot(slot.scheduled_at) ?? 'Not scheduled'} · {slotWindow(slot.scheduled_at, slot.duration_minutes)}
          </div>
        </div>
        <span className="text-xs text-slate-400">
          {slot.seats_taken} of {slot.capacity} seat{slot.capacity === 1 ? '' : 's'} booked
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input min-w-[16rem] flex-1 py-1.5 text-sm"
          placeholder="https://meet.google.com/…"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setSaved(false); }}
        />
        <button
          className="btn-primary shrink-0 py-1.5 text-xs"
          disabled={save.isPending || !changed}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : slot.meeting_url ? 'Update link' : 'Save link'}
        </button>
        <JoinMeeting url={slot.meeting_url} className="btn-ghost inline-flex shrink-0 items-center gap-1.5 py-1.5 text-xs" />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {saved && !error && <p className="mt-1 text-xs text-emerald-600">Students holding a seat have been notified.</p>}
      {!slot.meeting_url && !error && (
        <p className="mt-1 text-xs text-slate-400">
          No link yet — students booked into this slot are waiting for it.
        </p>
      )}
    </div>
  );
}

export function ExaminerHome() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<AssignedBooking | null>(null);
  const [status, setStatus] = useState('booked');

  const summary = useQuery({
    queryKey: ['examiner-summary'],
    queryFn: () => unwrap<Summary>(api.get('/exams/examiner/summary')),
  });
  const bookings = useQuery({
    queryKey: ['examiner-assigned', status],
    queryFn: () => unwrap<AssignedBooking[]>(
      api.get('/exams/examiner/assigned', { params: { status: status || undefined } })),
  });
  const slots = useQuery({
    queryKey: ['examiner-slots'],
    queryFn: () => unwrap<ExamSlot[]>(api.get('/exams/examiner/slots', { params: { upcoming: true } })),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['examiner-slots'] });
    qc.invalidateQueries({ queryKey: ['examiner-assigned'] });
    qc.invalidateQueries({ queryKey: ['examiner-summary'] });
    qc.invalidateQueries({ queryKey: ['examiner-reports'] });
    qc.invalidateQueries({ queryKey: ['examiner-students'] });
  };

  const columns: Column<AssignedBooking>[] = [
    {
      key: 'student',
      header: 'Student',
      sort: (b) => b.student_name ?? b.student_id,
      cell: (b) => (
        <div className="group flex items-center gap-2">
          <StudentAvatar photoUrl={b.student_photo_url} gender={b.student_gender} name={b.student_name ?? b.student_id} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-800">{b.student_name ?? '—'}</div>
            <div className="font-mono text-xs text-slate-400">{b.student_id}</div>
          </div>
        </div>
      ),
    },
    { key: 'exam_title', header: 'Exam', sort: (b) => b.exam_title ?? '', cell: (b) => b.exam_title ?? '—' },
    {
      key: 'kind',
      header: 'Type',
      sort: (b) => b.kind ?? '',
      cell: (b) => (b.kind ? <span className={`badge ${badgeClass(b.kind)}`}>{b.kind}</span> : '—'),
    },
    {
      key: 'scheduled_at',
      header: 'Exam date & slot',
      sort: (b) => b.scheduled_at ?? '',
      cell: (b) => (
        <div>
          <div className="font-medium text-slate-700">{fmtSlot(b.scheduled_at) ?? 'Not scheduled'}</div>
          <div className="text-xs text-slate-400">{slotWindow(b.scheduled_at, b.duration_minutes)}</div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', sort: (b) => b.status, cell: (b) => <StatusBadge status={b.status} /> },
    { key: 'created_at', header: 'Booked', sort: (b) => b.created_at, cell: (b) => <span className="text-slate-500">{fmtDate(b.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (b) => (
        b.reported ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <CheckCircle2 size={14} /> Submitted
          </span>
        ) : b.status === 'cancelled' ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <button className="btn-primary py-1 text-xs" onClick={() => setSelected(b)}>Submit report</button>
        )
      ),
    },
  ];

  const s = summary.data;
  const next = slots.data?.find((slot) => slot.scheduled_at);

  return (
    <div>
      <PageHeader
        title="Examiner Dashboard"
        description="Your assigned exam slots, the students booked into them and the reports still to submit."
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Assigned slots" value={s?.assigned_slots ?? '—'} hint={`${s?.upcoming_slots ?? 0} upcoming`} icon={CalendarClock} accent="brand" />
        <StatCard label="Students booked" value={s?.students_booked ?? '—'} icon={Users} accent="sky" />
        <StatCard label="Reports pending" value={s?.pending_reports ?? '—'} hint="Awaiting your submission" icon={ClipboardList} accent="amber" />
        <StatCard label="Reports submitted" value={s?.reports_submitted ?? '—'} icon={CheckCircle2} accent="emerald" />
      </div>

      {next && (
        <div className="card mt-4 border-brand/20 bg-brand/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-brand/10 p-2 text-brand"><Clock size={18} /></span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Next slot</p>
                <p className="font-semibold text-slate-800">{next.title}</p>
                <p className="text-sm text-slate-600">
                  {fmtSlot(next.scheduled_at)} · {slotWindow(next.scheduled_at, next.duration_minutes)}
                </p>
              </div>
            </div>
            <span className="text-sm text-slate-500">
              {next.seats_taken} of {next.capacity} seat{next.capacity === 1 ? '' : 's'} booked
            </span>
          </div>
        </div>
      )}

      {!!slots.data?.length && (
        <section className="card mt-4 p-0">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <span className="rounded-lg bg-brand/10 p-1.5 text-brand"><Video size={16} /></span>
            <div>
              <h2 className="font-semibold text-slate-800">Meeting links</h2>
              <p className="text-xs text-slate-500">
                The room each exam is conducted in. Students booked into the slot are
                notified as soon as you save it.
              </p>
            </div>
          </div>
          {slots.data.slice(0, 10).map((slot) => (
            <SlotMeetingRow key={slot.id} slot={slot} onSaved={refresh} />
          ))}
        </section>
      )}

      <DataTable
        rows={bookings.data}
        columns={columns}
        loading={bookings.isLoading}
        rowKey={(b) => b.id}
        searchText={(b) => `${b.student_id} ${b.student_name ?? ''} ${b.exam_title ?? ''}`}
        searchPlaceholder="Search student / exam"
        initialSort={{ key: 'scheduled_at', dir: 'asc' }}
        emptyLabel="No exam bookings on your assigned slots."
        filters={<TableFilter value={status} onChange={setStatus} options={STATUS_OPTIONS} />}
      />

      {selected && (
        <ReportModal booking={selected} onClose={() => setSelected(null)} onDone={refresh} />
      )}
    </div>
  );
}
