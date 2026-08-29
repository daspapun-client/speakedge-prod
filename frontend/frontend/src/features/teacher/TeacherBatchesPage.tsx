import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Radio,
  Search,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import {
  BatchScheduleHighlight,
  batchAttendanceSubmittedForSession,
  batchDefaultAttendanceDate,
  batchLockedToday,
  batchNeedsAttendance,
  batchPeriod,
  batchSessionDateParts,
  batchSessionIso,
  batchSessionTimeParts,
  batchSlotEndedForDate,
  batchTimeLabel,
  fmtClassDate,
  type BatchPeriod,
} from '@/features/batch/shared';
import { BatchChatPanel } from '@/features/batch/BatchChatPanel';
import { BatchShareButton } from '@/features/batch/BatchShareButton';
import { EmailLink, Modal, PageHeader, PhoneLink, StudentAvatar } from '@/features/admin/_shared';

interface BatchStudent {
  student_id: string;
  name: string;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  age?: number | null;
  gender?: string | null;
  photo_url?: string | null;
  /** Upcoming classes of this course the seat covers (empty for a loose batch). */
  session_dates?: string[];
}
interface Named { student_id: string; name: string; session_dates?: string[] }

interface Batch {
  id: string;
  title: string;
  series_id?: string | null;
  /** Upcoming sittings of the course this batch belongs to. */
  series_session_dates?: string[];
  /** Classes one monthly fee buys — the cycle a seat is sold in. */
  sessions_per_cycle?: number;
  date?: string | null;
  class_dates?: string[];
  day_of_week?: string | null;
  class_time?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  schedule?: string | null;
  meeting_url?: string | null;
  meeting_active: boolean;
  meeting_forced?: boolean;
  students: BatchStudent[];
  pending: Named[];
  attendance_submitted_dates?: string[];
}

/** "4 classes · Sep 3 – Sep 24" — a seat is sold by the cycle one monthly fee
 *  buys, so the teacher sees every class it covers, not just this sitting. */
function cycleLabel(dates?: string[]) {
  if (!dates || dates.length < 2) return null;
  const n = `${dates.length} classes`;
  return `${n} · ${fmtClassDate(dates[0])} – ${fmtClassDate(dates[dates.length - 1])}`;
}

function MeetingLink({ batch, onDone, disabled }: { batch: Batch; onDone: () => void; disabled?: boolean }) {
  const [url, setUrl] = useState(batch.meeting_url ?? '');
  const save = useMutation({
    mutationFn: () => unwrap(api.post(`/teacher/batches/${batch.id}/meeting-link`, { meeting_url: url || null })),
    onSuccess: onDone,
  });
  const force = useMutation({
    mutationFn: (forced: boolean) =>
      unwrap(api.post(`/teacher/batches/${batch.id}/meeting-force`, { forced })),
    onSuccess: onDone,
  });
  const hasUrl = Boolean(url.trim() || batch.meeting_url);
  const live = batch.meeting_active;
  const forced = batch.meeting_forced;

  return (
    <div className="border-b border-slate-100 px-5 py-5">
      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/15">
              <Video size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">Google Meet</p>
                {live && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold text-red-600 ring-1 ring-red-500/20">
                    <Radio size={10} className="animate-pulse" />
                    Live{forced ? '' : ' · scheduled'}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {live ? 'Students can join while the session is active.' : 'Save your link, then go live when class starts.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {live && batch.meeting_url && (
              <a className="btn-gold text-xs" href={batch.meeting_url} target="_blank" rel="noreferrer">
                Join meeting
              </a>
            )}
            {forced ? (
              <button
                className="btn-ghost shrink-0 text-xs text-red-600 hover:bg-red-50"
                disabled={disabled || force.isPending}
                onClick={() => force.mutate(false)}
              >
                End live session
              </button>
            ) : (
              !live && (
                <button
                  className="btn-gold shrink-0 text-xs"
                  disabled={disabled || force.isPending || !hasUrl}
                  title={hasUrl ? undefined : 'Save a meet link first'}
                  onClick={() => force.mutate(true)}
                >
                  Go live now
                </button>
              )
            )}
            <button className="btn-primary shrink-0 text-xs" disabled={disabled || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Save link'}
            </button>
          </div>
        </div>
        <input
          className="input mt-4 bg-white"
          placeholder="https://meet.google.com/…"
          value={url}
          disabled={disabled}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
    </div>
  );
}

function BatchAttendanceBar({
  batch,
  date,
  setDate,
  classTime,
  setClassTime,
  present,
  setPresent,
  message,
  error,
  onSubmit,
  onNoClass,
  isPending,
  noClassPending,
}: {
  batch: Batch;
  date: string;
  setDate: (v: string) => void;
  classTime: string;
  setClassTime: (v: string) => void;
  present: Record<string, boolean>;
  setPresent: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  message: string;
  error: string;
  onSubmit: () => void;
  onNoClass: () => void;
  isPending: boolean;
  noClassPending: boolean;
}) {
  const slotEnded = batchSlotEndedForDate(batch, date);

  if (!batch.students.length) {
    return (
      <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3.5">
          <p className="text-sm text-slate-600">
            {slotEnded
              ? 'No students enrolled — report if the class did not happen.'
              : 'No students enrolled yet.'}
          </p>
          {slotEnded && (
            <button
              type="button"
              className="btn-ghost shrink-0 text-xs text-amber-800 hover:bg-amber-50"
              disabled={noClassPending || isPending}
              onClick={onNoClass}
            >
              {noClassPending ? 'Saving…' : 'Class did not happen'}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-5">
      <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <ClipboardCheck size={16} />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Mark attendance</p>
              <p className="text-xs text-slate-500">Submit after class ends for admin verification.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label text-xs">Date</label>
              <input className="input py-1.5 text-sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">Class time</label>
              <input
                className="input py-1.5 text-sm"
                value={classTime}
                placeholder="e.g. 7:00 PM"
                onChange={(e) => setClassTime(e.target.value)}
              />
            </div>
            <button
              className="btn-primary shrink-0 text-xs"
              disabled={isPending || noClassPending || !slotEnded}
              title={slotEnded ? undefined : 'The class slot for this date has not ended yet'}
              onClick={onSubmit}
            >
              {isPending ? 'Submitting…' : 'Submit attendance'}
            </button>
            {slotEnded && (
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs text-amber-800 hover:bg-amber-50"
                disabled={isPending || noClassPending}
                onClick={onNoClass}
              >
                {noClassPending ? 'Saving…' : 'Class did not happen'}
              </button>
            )}
          </div>
        </div>
        {!slotEnded && (
          <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This class has not finished yet. Attendance opens once the slot on {date} ends.
          </p>
        )}
        {message && <p className="mb-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{message}</p>}
        {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost py-1 text-xs"
            onClick={() => setPresent(Object.fromEntries(batch.students.map((s) => [s.student_id, true])))}
          >
            All present
          </button>
          <button
            type="button"
            className="btn-ghost py-1 text-xs"
            onClick={() => setPresent(Object.fromEntries(batch.students.map((s) => [s.student_id, false])))}
          >
            All absent
          </button>
        </div>
      </div>
    </div>
  );
}

function TeacherBatchCard({
  batch,
  onRefresh,
  onAttendanceSubmitted,
  splitChat = false,
}: {
  batch: Batch;
  onRefresh: () => void;
  onAttendanceSubmitted?: (batchId: string, date: string) => void;
  splitChat?: boolean;
}) {
  const sessionDate = batchDefaultAttendanceDate(batch);
  const [date, setDate] = useState(sessionDate);
  const [classTime, setClassTime] = useState(batch.class_time ?? '');
  const [present, setPresent] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(batch.students.map((s) => [s.student_id, true])),
  );
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lockAfterSubmit, setLockAfterSubmit] = useState(false);

  const submittedDates = batch.attendance_submitted_dates ?? [];
  const sessionSubmitted = batchAttendanceSubmittedForSession(batch);
  const locked = sessionSubmitted || lockAfterSubmit;
  const attendanceDue = batchNeedsAttendance(batch);
  const prevSubmittedCount = useRef(submittedDates.length);

  useEffect(() => {
    setDate(batchDefaultAttendanceDate(batch));
    setClassTime(batch.class_time ?? '');
    setPresent(Object.fromEntries(batch.students.map((s) => [s.student_id, true])));
    setMessage('');
    setError('');
    setLockAfterSubmit(false);
  }, [batch.id]);

  useEffect(() => {
    if (sessionSubmitted) setLockAfterSubmit(false);
    prevSubmittedCount.current = submittedDates.length;
  }, [submittedDates, sessionSubmitted]);

  const submitAttendance = useMutation<unknown, Error, boolean>({
    mutationFn: (classHeld) => {
      const present_ids = classHeld
        ? Object.entries(present).filter(([, v]) => v).map(([k]) => k)
        : [];
      const absent_ids = classHeld
        ? Object.entries(present).filter(([, v]) => !v).map(([k]) => k)
        : [];
      return unwrap(
        api.post('/teacher/attendance', {
          batch_id: batch.id,
          date,
          class_time: classTime || null,
          present_ids,
          absent_ids,
          class_held: classHeld,
        }),
      );
    },
    onSuccess: (_d, classHeld) => {
      setError('');
      setMessage(
        classHeld
          ? 'Submitted — pending admin verification.'
          : 'Class marked as not held — pending admin verification.',
      );
      setLockAfterSubmit(true);
      onAttendanceSubmitted?.(batch.id, date);
      onRefresh();
    },
    onError: (e: Error) => {
      setMessage('');
      setError(e.message);
    },
  });

  const confirmNoClass = () => {
    if (!window.confirm(`Mark "${batch.title}" on ${date} as not held? This notifies admins for verification.`)) return;
    submitAttendance.mutate(false);
  };

  const dateParts = batchSessionDateParts(batch);
  const timeParts = batchSessionTimeParts(batch);
  const sortedDates = batch.class_dates?.length ? [...batch.class_dates].sort() : null;
  const multiClass =
    sortedDates && sortedDates.length > 1
      ? `${fmtClassDate(sortedDates[0])} – ${fmtClassDate(sortedDates[sortedDates.length - 1])} · ${sortedDates.length} classes`
      : null;
  const live = batch.meeting_active && !locked;
  const studentCount = batch.students.length;

  return (
    <article
      id={`batch-${batch.id}`}
      className={`scroll-mt-24 overflow-hidden bg-white ${
        splitChat
          ? 'flex h-full min-h-0 flex-col'
          : 'rounded-xl border border-slate-200 shadow-sm transition hover:border-slate-300 hover:shadow-md'
      }`}
    >
      <div className={splitChat ? 'flex min-h-0 flex-1 flex-col lg:flex-row' : undefined}>
        <div className={`min-w-0 ${splitChat ? 'flex-1 overflow-y-auto' : ''}`}>
          <div className="relative border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 py-5">
            <div className="flex items-start gap-4 pr-28 sm:pr-36">
              {dateParts ? (
                <div className="flex w-[4.25rem] shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-sm ring-1 ring-slate-200/80">
                  <div className="bg-brand px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                    {dateParts.month}
                  </div>
                  <div className="px-1 py-2">
                    <span className="text-2xl font-bold leading-none text-slate-900">{dateParts.day}</span>
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      {dateParts.weekdayShort}
                    </p>
                  </div>
                </div>
              ) : batch.day_of_week ? (
                <div className="flex w-[4.25rem] shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-sm ring-1 ring-slate-200/80">
                  <div className="bg-brand px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                    Weekly
                  </div>
                  <div className="flex flex-1 items-center justify-center px-1 py-2">
                    <CalendarDays size={22} className="text-brand" strokeWidth={2} />
                  </div>
                </div>
              ) : null}
              <div className="min-w-0 flex-1 pt-0.5">
                <h3 className="text-lg font-semibold tracking-tight text-slate-900">{batch.title}</h3>
                {dateParts && (
                  <p className="mt-1 text-sm font-medium text-slate-600">
                    {dateParts.month} {dateParts.day}, {dateParts.year}
                  </p>
                )}
                {!dateParts && batch.day_of_week && (
                  <p className="mt-1 text-sm font-medium text-slate-600">{batch.day_of_week}</p>
                )}
                {timeParts && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
                    <Clock size={14} className="shrink-0 text-brand" />
                    <span className="tabular-nums">
                      {timeParts.end ? `${timeParts.start} – ${timeParts.end}` : timeParts.start}
                    </span>
                  </p>
                )}
                {multiClass && <p className="mt-1 text-xs font-medium text-slate-500">{multiClass}</p>}
                {batch.schedule && <p className="mt-1 text-xs text-slate-500">{batch.schedule}</p>}
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  <Users size={13} className="text-slate-400" />
                  {studentCount} {studentCount === 1 ? 'student' : 'students'} enrolled
                </div>
              </div>
            </div>
            <div className="absolute right-4 top-4 flex flex-col items-end gap-1.5">
              {attendanceDue && !locked && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
                  <ClipboardCheck size={11} /> Submit attendance
                </span>
              )}
              {live && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-500/20">
                  <Radio size={11} className="animate-pulse" /> Live
                </span>
              )}
              {locked && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <CheckCircle2 size={11} /> Completed
                </span>
              )}
              {batch.pending.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                  <UserPlus size={11} /> {batch.pending.length} awaiting admin
                </span>
              )}
            </div>
          </div>

          {attendanceDue && !locked && (
            <div className="border-b border-amber-200/80 bg-amber-50/90 px-5 py-3.5">
              <p className="text-sm font-semibold text-amber-900">Action required</p>
              <p className="mt-0.5 text-xs text-amber-800">
                This class slot has ended. Submit attendance or mark the class as not held if it did not take place.
              </p>
            </div>
          )}

          {locked && (
            <div className="border-b border-emerald-200/80 bg-emerald-50/80 px-5 py-3.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                <ClipboardCheck size={16} />
                Class completed for {sessionDate}
              </div>
              <p className="mt-1 text-xs text-emerald-700">
                {message || 'Attendance submitted — pending admin verification.'}
              </p>
            </div>
          )}

          <div className={locked ? 'pointer-events-none opacity-60' : undefined}>
            <MeetingLink batch={batch} onDone={onRefresh} disabled={locked} />

            {batch.pending.length > 0 && (
              <div className="border-b border-slate-100 px-5 py-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Join requests</p>
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
                    {batch.pending.length} awaiting admin
                  </span>
                </div>
                <p className="mb-3 text-xs text-slate-500">
                  Join requests are reviewed by the admin. Approved students appear in your roster automatically.
                </p>
                <div className="space-y-2">
                  {batch.pending.map((p) => (
                    <div
                      key={p.student_id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{p.name}</p>
                        <p className="font-mono text-xs text-slate-400">{p.student_id}</p>
                        {cycleLabel(p.session_dates) && (
                          <p className="mt-0.5 text-[11px] font-medium text-amber-700">
                            Requested for {cycleLabel(p.session_dates)}
                          </p>
                        )}
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                        Pending admin approval
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-5 py-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Student roster</p>
                {studentCount > 0 && (
                  <span className="text-xs text-slate-400">{studentCount} enrolled</span>
                )}
              </div>

              {batch.series_id && (batch.series_session_dates?.length ?? 0) > 1 && (
                <p className="mb-3 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                  This is one class of a weekly course. A seat runs for{' '}
                  {batch.sessions_per_cycle ?? 4} classes — what one monthly fee buys — and the
                  next monthly payment extends it, so students do not request again each week.
                </p>
              )}

              {studentCount > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-slate-100 bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Student</th>
                          <th className="px-4 py-3">Phone</th>
                          <th className="px-4 py-3">WhatsApp</th>
                          <th className="px-4 py-3">Email</th>
                          <th className="px-4 py-3">Age</th>
                          <th className="px-4 py-3 text-center">Present</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batch.students.map((s) => (
                          <tr key={s.student_id} className="border-t border-slate-100 transition hover:bg-slate-50/60">
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-3">
                                <StudentAvatar
                                  photoUrl={s.photo_url}
                                  gender={s.gender}
                                  name={s.name}
                                  size="h-10 w-10"
                                  iconSize={16}
                                />
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-900">{s.name}</div>
                                  <div className="font-mono text-xs text-slate-400">{s.student_id}</div>
                                  {cycleLabel(s.session_dates) && (
                                    <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-brand">
                                      <CalendarDays size={11} className="shrink-0" />
                                      Enrolled for {cycleLabel(s.session_dates)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-slate-600">
                              <PhoneLink phone={s.phone} />
                            </td>
                            <td className="px-4 py-3.5 text-slate-600">
                              <PhoneLink phone={s.whatsapp} />
                            </td>
                            <td className="px-4 py-3.5 text-slate-600">
                              <EmailLink email={s.email} />
                            </td>
                            <td className="px-4 py-3.5 text-slate-600">
                              {s.age != null ? (
                                <span>
                                  {s.age}
                                  {s.gender ? <span className="text-slate-400"> · {s.gender}</span> : null}
                                </span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <label className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${
                                present[s.student_id] ?? true
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-red-50 text-red-700'
                              } ${locked ? '' : 'cursor-pointer'}`}>
                                <input
                                  type="checkbox"
                                  className="rounded border-slate-300"
                                  checked={present[s.student_id] ?? true}
                                  disabled={locked}
                                  onChange={(e) => setPresent((p) => ({ ...p, [s.student_id]: e.target.checked }))}
                                />
                                {present[s.student_id] ?? true ? 'Present' : 'Absent'}
                              </label>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                    <Users size={22} />
                  </span>
                  <p className="mt-3 font-semibold text-slate-700">No students enrolled</p>
                  <p className="mt-1 max-w-sm text-sm text-slate-500">
                    Assigned students and approved join requests will appear here.
                  </p>
                </div>
              )}
            </div>

            {!locked && (
              <BatchAttendanceBar
                batch={batch}
                date={date}
                setDate={setDate}
                classTime={classTime}
                setClassTime={setClassTime}
                present={present}
                setPresent={setPresent}
                message={message}
                error={error}
                onSubmit={() => submitAttendance.mutate(true)}
                onNoClass={confirmNoClass}
                isPending={submitAttendance.isPending && submitAttendance.variables !== false}
                noClassPending={submitAttendance.isPending && submitAttendance.variables === false}
              />
            )}

            {!splitChat && <BatchChatPanel batchId={batch.id} disabled={locked} />}
          </div>
        </div>

        {splitChat && (
          <div className="flex h-full min-h-0 w-full shrink-0 flex-col border-t border-slate-200 lg:w-96 lg:border-l lg:border-t-0">
            <BatchChatPanel batchId={batch.id} disabled={locked} layout="sidebar" />
          </div>
        )}
      </div>
    </article>
  );
}

function TeacherBatchListCard({ batch, onView }: { batch: Batch; onView: () => void }) {
  const sessionSubmitted = batchAttendanceSubmittedForSession(batch);
  const locked = sessionSubmitted || batchLockedToday(batch.attendance_submitted_dates);
  const live = batch.meeting_active && !locked;
  const studentCount = batch.students.length;
  const pendingCount = batch.pending.length;
  const attendanceDue = batchNeedsAttendance(batch);

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${
        attendanceDue ? 'border-amber-300/80 ring-1 ring-amber-200' : live ? 'border-red-200/80 ring-1 ring-red-100' : 'border-slate-200/80 hover:border-brand/30'
      }`}
    >
      <div className="relative">
        <BatchScheduleHighlight batch={batch} batchId={batch.id} />
        <div className="absolute right-4 top-4 flex flex-col items-end gap-1.5">
          {attendanceDue && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
              <ClipboardCheck size={11} /> Submit attendance
            </span>
          )}
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-500/20">
              <Radio size={11} className="animate-pulse" /> Live
            </span>
          )}
          {locked && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
              <CheckCircle2 size={11} /> Completed
            </span>
          )}
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">
              <UserPlus size={11} /> {pendingCount} awaiting admin
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h3 className="min-w-0 font-semibold tracking-tight text-slate-900 group-hover:text-brand">
            {batch.title}
          </h3>
          <BatchShareButton batchId={batch.id} title={batch.title} variant="overlay" />
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Students</p>
          <div className="mt-2 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Users size={16} />
            </span>
            <span className="font-medium text-slate-800">
              {studentCount} {studentCount === 1 ? 'student' : 'students'} enrolled
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onView}
          className="mt-4 flex w-full items-center justify-between rounded-xl border border-slate-100 px-3.5 py-2.5 text-sm transition hover:border-brand/20 hover:bg-brand/5"
        >
          <span className="inline-flex items-center gap-2 text-slate-600">
            <Users size={15} className="text-slate-400" />
            {studentCount} {studentCount === 1 ? 'student' : 'students'}
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-brand">
            View roster <ChevronRight size={15} />
          </span>
        </button>

        <button
          type="button"
          onClick={onView}
          className={`mt-4 w-full py-2.5 ${attendanceDue ? 'btn-gold' : 'btn-primary'}`}
        >
          {attendanceDue ? 'Submit attendance' : 'Manage batch'}
        </button>
      </div>
    </article>
  );
}

const BATCH_TABS: BatchPeriod[] = ['today', 'upcoming', 'past'];

const BATCH_TAB_LABEL: Record<BatchPeriod, string> = {
  today: "Today's batches",
  upcoming: 'Upcoming batches',
  past: 'Past batches',
};

const BATCH_TAB_EMPTY: Record<BatchPeriod, string> = {
  today: 'No batches scheduled for today.',
  upcoming: 'No upcoming batches.',
  past: 'No past batches.',
};

function sortBatchesBySession(batches: Batch[], dir: 'asc' | 'desc') {
  return [...batches].sort((a, b) => {
    const cmp = (batchSessionIso(a) ?? '').localeCompare(batchSessionIso(b) ?? '');
    return dir === 'asc' ? cmp : -cmp;
  });
}

function batchMatchesSearch(b: Batch, q: string) {
  const haystack = [
    b.title,
    b.id,
    b.day_of_week,
    b.schedule,
    b.class_time,
    b.slot_start,
    b.slot_end,
    b.date,
    ...(b.class_dates ?? []),
    batchSessionIso(b),
    batchTimeLabel(b),
    ...b.students.map((s) => s.name),
    ...b.students.map((s) => s.student_id),
    ...b.pending.map((p) => p.name),
    ...b.pending.map((p) => p.student_id),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

/**
 * The full teacher batch experience (meet link, go live, join requests,
 * attendance, chat) as a reusable list. Driven by any endpoint returning the
 * `/teacher/my-batches` shape — the teacher's own page uses it, and admins reuse
 * it on the teacher profile to run these actions for a specific teacher.
 */
export function TeacherBatchList({
  endpoint,
  queryKey,
  emptyLabel = 'No batches assigned yet.',
  search = '',
}: {
  endpoint: string;
  queryKey: unknown[];
  emptyLabel?: string;
  search?: string;
}) {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<BatchPeriod>('today');
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => unwrap<Batch[]>(api.get(endpoint)),
  });
  const refresh = () => qc.invalidateQueries({ queryKey });
  const patchAttendanceSubmitted = (batchId: string, submittedDate: string) => {
    qc.setQueryData<Batch[]>(queryKey, (old) =>
      old?.map((b) =>
        b.id === batchId
          ? {
              ...b,
              attendance_submitted_dates: [...new Set([...(b.attendance_submitted_dates ?? []), submittedDate])].sort(),
            }
          : b,
      ),
    );
  };
  const selected = data?.find((b) => b.id === selectedId) ?? null;

  const grouped = useMemo(() => {
    const buckets: Record<BatchPeriod, Batch[]> = { today: [], upcoming: [], past: [] };
    for (const b of data ?? []) buckets[batchPeriod(b)].push(b);
    return {
      today: sortBatchesBySession(buckets.today, 'asc'),
      upcoming: sortBatchesBySession(buckets.upcoming, 'asc'),
      past: sortBatchesBySession(buckets.past, 'desc'),
    };
  }, [data]);

  const tabCounts = useMemo(() => ({
    today: grouped.today.length,
    upcoming: grouped.upcoming.length,
    past: grouped.past.length,
  }), [grouped]);

  const attendanceDueCount = useMemo(
    () => grouped.past.filter((b) => batchNeedsAttendance(b)).length,
    [grouped.past],
  );

  const filtered = useMemo(() => {
    const tabbed = grouped[tab];
    const q = search.trim().toLowerCase();
    if (!q) return tabbed;
    return tabbed.filter((b) => batchMatchesSearch(b, q));
  }, [grouped, tab, search]);

  const searchActive = search.trim().length > 0;

  useEffect(() => {
    const hash = location.hash.slice(1);
    if (hash.startsWith('batch-') && data?.length) {
      const id = hash.slice('batch-'.length);
      if (data.some((b) => b.id === id)) setSelectedId(id);
    }
  }, [data]);

  const closeDetail = () => {
    setSelectedId(null);
    if (location.hash.startsWith('#batch-')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  };

  if (isLoading) return <p className="mt-6 text-slate-500">Loading…</p>;

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2">
        {BATCH_TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              tab === t
                ? 'bg-brand text-white shadow-sm'
                : 'border border-slate-200 bg-white text-slate-600 hover:border-brand/30 hover:bg-brand/5'
            }`}
          >
            <span>{BATCH_TAB_LABEL[t]} ({tabCounts[t]})</span>
            {t === 'past' && attendanceDueCount > 0 && (
              <span
                className={`inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  tab === t ? 'bg-amber-400 text-slate-900' : 'bg-amber-500 text-white'
                }`}
                title={`${attendanceDueCount} batch${attendanceDueCount === 1 ? '' : 'es'} need attendance`}
              >
                {attendanceDueCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {!filtered.length ? (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
          <p className="font-semibold text-slate-700">
            {!data?.length
              ? emptyLabel
              : searchActive
                ? 'No batches match your search'
                : BATCH_TAB_EMPTY[tab]}
          </p>
          {searchActive ? (
            <p className="mt-1 text-sm text-slate-500">Try a different keyword.</p>
          ) : tab !== 'upcoming' && tabCounts.upcoming > 0 ? (
            <button type="button" className="btn-ghost mt-4" onClick={() => setTab('upcoming')}>
              View upcoming batches
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <TeacherBatchListCard key={b.id} batch={b} onView={() => setSelectedId(b.id)} />
          ))}
        </div>
      )}

      {selected && (
        <Modal onClose={closeDetail} fullWidth>
          <div className="-m-5 flex h-full min-h-0 flex-col overflow-hidden">
            <TeacherBatchCard
              batch={selected}
              splitChat
              onRefresh={refresh}
              onAttendanceSubmitted={patchAttendanceSubmitted}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

export function TeacherBatchesPage() {
  const [search, setSearch] = useState('');

  return (
    <div>
      <PageHeader
        title="My Batches"
        description="Roster, meet link, and attendance per batch."
        actions={
          <div className="relative w-full min-w-[14rem] sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input w-full pl-9"
              placeholder="Search by title, date, or student…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        }
      />
      <TeacherBatchList endpoint="/teacher/my-batches" queryKey={['teacher-my-batches']} search={search} />
    </div>
  );
}
