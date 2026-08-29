import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Award, CalendarDays, CheckCircle2, ClipboardCheck, Clock, Radio, Star, Users, Video } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { isSlotEnded, nowHmIST, todayIsoIST } from '@/lib/datetime';
import { BatchShareButton } from '@/features/batch/BatchShareButton';
import { BatchChatPanel } from '@/features/batch/BatchChatPanel';
import { MemberList, type MemberCard } from '@/features/dashboard/MemberList';

export interface BatchScheduleFields {
  date?: string | null;
  class_dates?: string[] | null;
  day_of_week?: string | null;
  class_time?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  schedule?: string | null;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function fmtClassDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function batchClassDateIso(batch: BatchScheduleFields): string | null {
  if (batch.class_dates?.length) {
    const today = todayIsoIST();
    const upcoming = [...batch.class_dates].sort().find((d) => d.slice(0, 10) >= today);
    return (upcoming ?? batch.class_dates[batch.class_dates.length - 1]).slice(0, 10);
  }
  if (batch.date) return batch.date.slice(0, 10);
  if (batch.day_of_week) {
    const target = WEEKDAYS.findIndex((d) => d.toLowerCase() === batch.day_of_week!.toLowerCase());
    if (target < 0) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const mo = Number(parts.find((p) => p.type === 'month')?.value);
    const day = Number(parts.find((p) => p.type === 'day')?.value);
    const base = new Date(y, mo - 1, day);
    let diff = target - base.getDay();
    if (diff < 0) diff += 7;
    base.setDate(base.getDate() + diff);
    return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
  }
  return null;
}

export function batchSlotEnd(batch: BatchScheduleFields): string | null {
  if (batch.slot_end) return batch.slot_end;
  const time = batchTimeLabel(batch);
  if (!time) return null;
  const end = time.split('–').pop()?.trim();
  return end || null;
}

/** True when the slot for `dateIso` (YYYY-MM-DD) has ended (IST). */
export function batchSlotEndedForDate(batch: BatchScheduleFields, dateIso: string): boolean {
  const day = dateIso.slice(0, 10);
  const today = todayIsoIST();
  if (day > today) return false;
  if (day < today) return true;
  const end = batchSlotEnd(batch);
  if (!end) return false;
  return isSlotEnded(nowHmIST(), end);
}

/** True when this batch's session date is today (IST) and the slot end time has passed. */
export function batchSessionSlotEnded(batch: BatchScheduleFields): boolean {
  const session = batch.date?.slice(0, 10) ?? batchSessionIso(batch);
  if (!session) return false;
  return batchSlotEndedForDate(batch, session);
}

export function batchTimeLabel(b: BatchScheduleFields): string | null {
  if (b.class_time) return b.class_time;
  if (b.slot_start && b.slot_end) return `${b.slot_start}–${b.slot_end}`;
  return null;
}

export { batchJoinShareText, batchJoinUrl } from '@/features/batch/joinLink';

export type BatchPeriod = 'today' | 'past' | 'upcoming';

export function batchSessionIso(
  batch: BatchScheduleFields & { attendance_submitted_dates?: string[] | null },
): string | null {
  if (batch.date) return batch.date.slice(0, 10);
  const today = todayIsoIST();
  if (batch.class_dates?.length) {
    const upcoming = [...batch.class_dates].sort().find((d) => d.slice(0, 10) >= today);
    return (upcoming ?? batch.class_dates[batch.class_dates.length - 1]).slice(0, 10);
  }
  return batchClassDateIso(batch);
}

export function batchPeriod(
  batch: BatchScheduleFields & { attendance_submitted_dates?: string[] | null },
): BatchPeriod {
  const today = todayIsoIST();
  const submitted = new Set((batch.attendance_submitted_dates ?? []).map((d) => d.slice(0, 10)));

  if (batch.date) {
    const session = batch.date.slice(0, 10);
    if (session > today) return 'upcoming';
    if (submitted.has(session)) return 'past';
    if (session < today) return 'past';
    if (batchSessionSlotEnded(batch)) return 'past';
    return 'today';
  }

  if (batch.class_dates?.length) {
    const dates = [...batch.class_dates].map((d) => d.slice(0, 10)).sort();
    if (dates.some((d) => d === today && !submitted.has(d) && !batchSessionSlotEnded(batch))) return 'today';
    if (dates.some((d) => d > today && !submitted.has(d))) return 'upcoming';
    return 'past';
  }

  const session = batchSessionIso(batch);
  if (!session) return 'upcoming';
  if (session > today) return 'upcoming';
  if (submitted.has(session)) return 'past';
  if (session < today) return 'past';
  if (batchSessionSlotEnded(batch)) return 'past';
  return 'today';
}

/** Expired session(s) with no attendance submitted yet — teacher must act. */
export function batchAttendanceSubmittedForSession(
  batch: BatchScheduleFields & { attendance_submitted_dates?: string[] | null },
): boolean {
  const submitted = new Set((batch.attendance_submitted_dates ?? []).map((d) => d.slice(0, 10)));
  if (batch.class_dates?.length) {
    const today = todayIsoIST();
    return !batch.class_dates.some((d) => {
      const date = d.slice(0, 10);
      return date < today && !submitted.has(date);
    });
  }
  const session = batch.date?.slice(0, 10) ?? batchSessionIso(batch);
  return session ? submitted.has(session) : false;
}

export function batchDefaultAttendanceDate(batch: BatchScheduleFields): string {
  return batch.date?.slice(0, 10) ?? batchSessionIso(batch) ?? todayIsoIST();
}

export function batchNeedsAttendance(
  batch: BatchScheduleFields & { attendance_submitted_dates?: string[] | null },
): boolean {
  if (batchAttendanceSubmittedForSession(batch)) return false;

  const today = todayIsoIST();
  const submitted = new Set((batch.attendance_submitted_dates ?? []).map((d) => d.slice(0, 10)));

  if (batch.class_dates?.length && !batch.date) {
    return batch.class_dates.some((d) => {
      const date = d.slice(0, 10);
      if (submitted.has(date)) return false;
      if (date < today) return true;
      if (date === today && batchSessionSlotEnded(batch)) return true;
      return false;
    });
  }

  const session = batch.date?.slice(0, 10) ?? batchSessionIso(batch);
  if (!session || submitted.has(session)) return false;
  if (session < today) return true;
  if (session === today && batchSessionSlotEnded(batch)) return true;
  return false;
}

export function scheduleDateParts(iso: string) {
  const clean = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const [y, m, day] = clean.split('-').map(Number);
  const date = new Date(y, m - 1, day);
  return {
    weekdayShort: date.toLocaleDateString(undefined, { weekday: 'short' }),
    weekday: date.toLocaleDateString(undefined, { weekday: 'long' }),
    month: date.toLocaleDateString(undefined, { month: 'short' }),
    day: date.getDate(),
    year: date.getFullYear(),
    fullLabel: fmtClassDate(clean),
  };
}

export function batchSessionDateParts(batch: BatchScheduleFields) {
  const iso = batch.date?.slice(0, 10) ?? batchSessionIso(batch) ?? batchClassDateIso(batch);
  if (!iso) return null;
  return scheduleDateParts(iso);
}

export function batchSessionTimeParts(batch: BatchScheduleFields) {
  const time = batchTimeLabel(batch);
  if (!time) return null;
  const [start, end] = time.split('–').map((s) => s.trim());
  return { start, end: end || null };
}

export function BatchScheduleCalendar({
  dateIso,
  timeLabel,
  eyebrow,
  nested = false,
  compact = false,
}: {
  dateIso: string;
  timeLabel?: string | null;
  eyebrow?: string;
  nested?: boolean;
  compact?: boolean;
}) {
  const date = scheduleDateParts(dateIso);
  if (!date) return <span className="text-slate-400">—</span>;

  const time = timeLabel
    ? (() => {
        const [start, end] = timeLabel.split('–').map((s) => s.trim());
        return { start, end: end || null };
      })()
    : null;

  const content = (
    <>
      <div
        className={`flex shrink-0 flex-col overflow-hidden rounded-md bg-white text-center shadow-sm ring-1 ring-slate-200/80 ${
          compact ? 'w-9' : 'w-11 rounded-lg'
        }`}
      >
        <div
          className={`bg-brand font-bold uppercase tracking-wider text-white ${
            compact ? 'px-0.5 py-px text-[8px]' : 'px-1 py-0.5 text-[9px]'
          }`}
        >
          {date.month}
        </div>
        <div className={compact ? 'px-0.5 py-1' : 'px-1 py-1.5'}>
          <span className={`font-bold leading-none text-slate-900 ${compact ? 'text-base' : 'text-lg'}`}>
            {date.day}
          </span>
          <p
            className={`font-semibold uppercase tracking-wide text-slate-400 ${
              compact ? 'mt-px text-[8px]' : 'mt-0.5 text-[9px]'
            }`}
          >
            {date.weekdayShort}
          </p>
        </div>
      </div>
      <div className={`min-w-0 flex-1 ${compact ? '' : 'pt-0.5'}`}>
        {eyebrow && !compact && (
          <p className="text-[9px] font-bold uppercase tracking-wider text-brand">{eyebrow}</p>
        )}
        {!compact && (
          <p className={`font-semibold tracking-tight text-slate-900 ${eyebrow ? 'mt-0.5 text-xs' : 'text-sm'}`}>
            {date.fullLabel}
          </p>
        )}
        {time && (
          <p
            className={`inline-flex items-center gap-1 font-medium text-slate-700 ${
              compact ? 'text-xs font-semibold tabular-nums' : 'mt-0.5 text-[11px] text-slate-600'
            }`}
          >
            {!compact && <Clock size={11} className="shrink-0 text-brand" />}
            <span className="tabular-nums">
              {time.end ? `${time.start} – ${time.end}` : time.start}
            </span>
          </p>
        )}
        {compact && !time && (
          <p className="text-xs font-semibold text-slate-800">{date.fullLabel}</p>
        )}
      </div>
    </>
  );

  if (nested) {
    return (
      <div className={`flex min-w-0 items-center ${compact ? 'gap-2' : 'flex-1 items-start gap-2'}`}>
        {content}
      </div>
    );
  }

  return (
    <div className="flex min-w-[10.5rem] items-start gap-2.5 rounded-xl border border-slate-200/80 bg-gradient-to-br from-slate-50 to-white px-2.5 py-2 shadow-sm ring-1 ring-slate-900/[0.02]">
      {content}
    </div>
  );
}

export function BatchScheduleHighlight({
  batch,
  batchId,
  reserveStatusSpace = true,
}: {
  batch: BatchScheduleFields;
  batchId?: string;
  reserveStatusSpace?: boolean;
}) {
  const date = batchSessionDateParts(batch);
  const time = batchSessionTimeParts(batch);
  const pad = reserveStatusSpace ? 'pr-32' : '';

  if (!date && !time) {
    return (
      <div className={`border-b border-slate-100 bg-slate-50 px-5 py-4 ${pad}`}>
        <p className="text-sm font-medium text-slate-500">Schedule to be announced</p>
        {batchId && (
          <p className="mt-1 truncate font-mono text-[11px] text-slate-400" title={`Batch ID: ${batchId}`}>
            Batch ID: {batchId}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 py-4">
      <div className={`flex items-start gap-4 ${pad}`}>
        {date && (
          <div className="flex w-14 shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-sm ring-1 ring-slate-200/80">
            <div className="bg-brand px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
              {date.month}
            </div>
            <div className="px-1 py-2">
              <span className="text-2xl font-bold leading-none text-slate-900">{date.day}</span>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{date.weekdayShort}</p>
            </div>
          </div>
        )}
        <div className="min-w-0 flex-1 pt-0.5">
          {date && (
            <p className="text-base font-semibold tracking-tight text-slate-900">
              {date.month} {date.day}, {date.year}
            </p>
          )}
          {time && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
              <Clock size={14} className="shrink-0 text-brand" />
              <span className="tabular-nums">
                {time.end ? `${time.start} – ${time.end}` : time.start}
              </span>
            </p>
          )}
          {batchId && (
            <p className="mt-1 truncate font-mono text-[11px] text-slate-400" title={`Batch ID: ${batchId}`}>
              Batch ID: {batchId}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function BatchScheduleStrip({ batch }: { batch: BatchScheduleFields }) {
  const time = batchTimeLabel(batch);
  const sortedDates = batch.class_dates?.length ? [...batch.class_dates].sort() : null;
  const classDateIso = batchClassDateIso(batch);
  const classDateLabel = sortedDates && sortedDates.length > 1
    ? `${fmtClassDate(sortedDates[0])} – ${fmtClassDate(sortedDates[sortedDates.length - 1])} · ${sortedDates.length} classes`
    : classDateIso ? fmtClassDate(classDateIso) : null;
  const hasSchedule = classDateLabel || batch.day_of_week || time || batch.schedule;
  if (!hasSchedule) {
    return (
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm text-slate-500">
        Schedule TBD
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-brand-gold/20 bg-gradient-to-r from-brand-gold/10 via-amber-50/80 to-brand-gold/5 px-5 py-3.5">
      {classDateLabel && (
        <div className="inline-flex items-center gap-2.5 rounded-xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-brand-gold/40">
          <span className="rounded-lg bg-brand-gold/15 p-1.5 text-brand-gold">
            <CalendarDays size={18} strokeWidth={2.25} />
          </span>
          <span className="text-base font-bold tracking-tight text-slate-900">{classDateLabel}</span>
        </div>
      )}
      {batch.day_of_week && !batch.date && (
        <div className="inline-flex items-center gap-2.5 rounded-xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-brand-gold/40">
          <span className="rounded-lg bg-brand-gold/15 p-1.5 text-brand-gold">
            <CalendarDays size={18} strokeWidth={2.25} />
          </span>
          <span className="text-base font-bold tracking-tight text-slate-900">{batch.day_of_week}</span>
        </div>
      )}
      {time && (
        <div className="inline-flex items-center gap-2.5 rounded-xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-brand-gold/40">
          <span className="rounded-lg bg-brand-gold/15 p-1.5 text-brand-gold">
            <Clock size={18} strokeWidth={2.25} />
          </span>
          <span className="text-base font-bold tabular-nums tracking-tight text-slate-900">{time}</span>
        </div>
      )}
      {batch.schedule && <p className="text-sm font-medium text-slate-600">{batch.schedule}</p>}
    </div>
  );
}

export interface StudentEnrolledBatch extends BatchScheduleFields {
  id: string;
  title: string;
  teacher_name?: string | null;
  meeting_active: boolean;
  meeting_url?: string | null;
  member_count?: number;
  attendance_submitted_dates?: string[];
}

export function batchLockedToday(dates?: string[]) {
  return (dates ?? []).map((d) => d.slice(0, 10)).includes(todayIsoIST());
}

export function batchSessionComplete(
  batch: BatchScheduleFields & { attendance_submitted_dates?: string[] | null },
): boolean {
  return batchAttendanceSubmittedForSession(batch) || batchSessionSlotEnded(batch);
}

interface BatchDetail {
  teacher?: {
    name: string;
    photo_url?: string | null;
    cefr_level?: string | null;
    qualification?: string | null;
    certified?: boolean;
  } | null;
  members: MemberCard[];
  member_count: number;
}

interface PendingReview {
  id: string;
  batch_id?: string | null;
  teacher_name?: string | null;
  class_date?: string | null;
}

function BatchClassReview({ batchId, teacherName }: { batchId: string; teacherName: string }) {
  const qc = useQueryClient();
  const [attended, setAttended] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [done, setDone] = useState(false);

  const { data: reviews } = useQuery({
    queryKey: ['pending-reviews'],
    queryFn: () => unwrap<PendingReview[]>(api.get('/dashboard/pending-reviews')),
  });
  const review = reviews?.find((r) => r.batch_id === batchId);

  const submit = useMutation({
    mutationFn: (body: { attended: boolean; rating?: number; feedback?: string }) =>
      unwrap(api.post(`/dashboard/reviews/${review!.id}`, body)),
    onSuccess: () => {
      setAttended(null);
      setRating(0);
      setFeedback('');
      setDone(true);
      qc.invalidateQueries({ queryKey: ['pending-reviews'] });
    },
  });

  if (done) {
    return (
      <div className="border-t border-green-200 bg-green-50 px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-green-800">
          <CheckCircle2 size={16} /> Thanks for your feedback!
        </p>
      </div>
    );
  }

  if (!review) return null;

  const pick = (on: boolean) =>
    `flex-1 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
      on ? 'border-brand bg-brand text-white shadow-sm' : 'border-slate-200 text-slate-600 hover:border-slate-300'
    }`;

  return (
    <div className="border-t border-amber-200 bg-amber-50/60 px-5 py-4">
      <p className="text-sm font-semibold text-slate-800">Did you attend this class?</p>
      <p className="mt-1 text-xs text-slate-600">
        Session with {review.teacher_name || teacherName}
        {review.class_date ? ` · ${review.class_date}` : ''}
      </p>

      <div className="mt-3 flex gap-2">
        <button type="button" className={pick(attended === true)} onClick={() => setAttended(true)}>
          Yes, I attended
        </button>
        <button
          type="button"
          className={pick(attended === false)}
          disabled={submit.isPending}
          onClick={() => {
            setAttended(false);
            setRating(0);
            submit.mutate({ attended: false });
          }}
        >
          No, I missed it
        </button>
      </div>

      {attended === true && (
        <>
          <p className="mt-3 text-xs font-medium text-slate-700">How was it?</p>
          <div className="mt-2 flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star`}>
                <Star size={24} className={n <= rating ? 'fill-brand-gold text-brand-gold' : 'text-slate-300'} />
              </button>
            ))}
          </div>
          <textarea
            className="input mt-3"
            rows={2}
            placeholder="Share your feedback (optional)"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </>
      )}

      {submit.isError && <p className="mt-2 text-sm text-red-600">{(submit.error as Error).message}</p>}

      {attended === true && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={submit.isPending || rating === 0}
            onClick={() => submit.mutate({ attended: true, rating, feedback: feedback || undefined })}
          >
            Submit review
          </button>
        </div>
      )}
    </div>
  );
}

function EnrolledStatusPill({ live, locked }: { live: boolean; locked: boolean }) {
  if (live && !locked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-600 ring-1 ring-red-500/20">
        <Radio size={11} className="animate-pulse" /> Live
      </span>
    );
  }
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 size={11} /> Completed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold text-brand ring-1 ring-brand/20">
      <CheckCircle2 size={11} /> Enrolled
    </span>
  );
}

function EnrolledBatchScheduleHeader({ batch, title }: { batch: StudentEnrolledBatch; title: string }) {
  const date = batchSessionDateParts(batch);
  const time = batchSessionTimeParts(batch);
  const sortedDates = batch.class_dates?.length ? [...batch.class_dates].sort() : null;
  const multiClass =
    sortedDates && sortedDates.length > 1
      ? `${fmtClassDate(sortedDates[0])} – ${fmtClassDate(sortedDates[sortedDates.length - 1])} · ${sortedDates.length} classes`
      : null;

  if (!date && !time && !batch.day_of_week && !batch.schedule) {
    return (
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-4 pr-28">
        <h3 className="font-semibold tracking-tight text-slate-900">{title}</h3>
        <p className="mt-1 text-sm font-medium text-slate-500">Schedule to be announced</p>
        <p className="mt-1 truncate font-mono text-[11px] text-slate-400" title={`Batch ID: ${batch.id}`}>Batch ID: {batch.id}</p>
      </div>
    );
  }

  return (
    <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 py-4">
      <div className="flex items-start gap-4 pr-28 sm:pr-36">
        {date ? (
          <div className="flex w-[4.25rem] shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-sm ring-1 ring-slate-200/80">
            <div className="bg-brand px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
              {date.month}
            </div>
            <div className="px-1 py-2">
              <span className="text-2xl font-bold leading-none text-slate-900">{date.day}</span>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {date.weekdayShort}
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
          <h3 className="font-semibold tracking-tight text-slate-900 group-hover:text-brand">{title}</h3>
          {date && (
            <p className="mt-1 text-sm font-medium text-slate-600">
              {date.month} {date.day}, {date.year}
            </p>
          )}
          {!date && batch.day_of_week && (
            <p className="mt-1 text-sm font-medium text-slate-600">{batch.day_of_week}</p>
          )}
          {time && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
              <Clock size={14} className="shrink-0 text-brand" />
              <span className="tabular-nums">
                {time.end ? `${time.start} – ${time.end}` : time.start}
              </span>
            </p>
          )}
          <p className="mt-1 truncate font-mono text-[11px] text-slate-400" title={`Batch ID: ${batch.id}`}>Batch ID: {batch.id}</p>
          {multiClass && <p className="mt-1 text-xs font-medium text-slate-500">{multiClass}</p>}
          {batch.schedule && <p className="mt-1 text-xs text-slate-500">{batch.schedule}</p>}
        </div>
      </div>
    </div>
  );
}

export function StudentEnrolledBatchCard({ batch }: { batch: StudentEnrolledBatch }) {
  const { data, isLoading } = useQuery({
    queryKey: ['batch-detail', batch.id],
    queryFn: () => unwrap<BatchDetail>(api.get(`/teacher/batches/${batch.id}/detail`)),
  });
  const teacher = data?.teacher;
  const teacherName = teacher?.name || batch.teacher_name || 'Teacher to be assigned';
  const memberCount = data?.member_count ?? batch.member_count ?? 0;
  const live = batch.meeting_active;
  const locked = batchSessionComplete(batch);
  const attendanceDone = batchAttendanceSubmittedForSession(batch);
  const sessionDate = batch.date?.slice(0, 10) ?? batchSessionIso(batch);
  const sessionDateLabel = sessionDate ? fmtClassDate(sessionDate) : todayIsoIST();

  return (
    <article
      id={`batch-${batch.id}`}
      className={`group scroll-mt-24 overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 ${
        locked
          ? 'border-slate-200/80 opacity-95'
          : live
            ? 'border-red-200/80 shadow-sm ring-1 ring-red-100 hover:shadow-md'
            : 'border-slate-200/80 hover:border-brand/30 hover:shadow-md'
      }`}
    >
      {locked && (
        <div className="shrink-0 border-b border-emerald-200/80 bg-emerald-50/80 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <ClipboardCheck size={15} />
            Class completed{sessionDate ? ` · ${sessionDateLabel}` : ''}
          </div>
          <p className="mt-0.5 text-xs text-emerald-700">
            {attendanceDone
              ? 'Attendance submitted — this batch is now read-only.'
              : 'Session ended — this batch is now read-only.'}
          </p>
        </div>
      )}

      <div className={locked ? 'pointer-events-none select-none opacity-60' : undefined}>
        <div className="flex min-h-0 flex-col lg:min-h-[32rem] lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative shrink-0">
              <EnrolledBatchScheduleHeader batch={batch} title={batch.title} />
              <div className="absolute right-4 top-4 flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1.5">
                  <BatchShareButton batchId={batch.id} title={batch.title} variant="overlay" />
                  <EnrolledStatusPill live={live && !locked} locked={locked} />
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/80 backdrop-blur-sm">
                  <Users size={11} />
                  {memberCount} {memberCount === 1 ? 'classmate' : 'classmates'}
                </span>
              </div>
            </div>

            <div className="flex flex-1 flex-col">
            <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Instructor</p>
                {isLoading ? (
                  <p className="mt-3 text-sm text-slate-400">Loading…</p>
                ) : (
                  <div className="mt-3 flex items-center gap-3">
                    {teacher?.photo_url ? (
                      <img
                        src={teacher.photo_url}
                        alt=""
                        className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow-sm"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-sm font-bold text-brand ring-2 ring-white shadow-sm">
                        {teacherName.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 font-semibold text-slate-900">
                        {teacherName}
                        {teacher?.certified && <Award size={14} className="text-brand-gold" />}
                      </div>
                      {(teacher?.qualification || teacher?.cefr_level) && (
                        <p className="mt-0.5 text-xs text-slate-500">
                          {[teacher.qualification, teacher.cefr_level ? `CEFR ${teacher.cefr_level}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Google Meet</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {live && !locked ? 'Session is live' : locked ? 'Class finished' : 'Opens at class time'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {live && !locked ? 'Join your instructor now' : 'Meet link activates during your slot'}
                    </p>
                  </div>
                  {live && batch.meeting_url && !locked ? (
                    <a className="btn-gold shrink-0 text-xs" href={batch.meeting_url} target="_blank" rel="noreferrer">
                      <Video size={14} /> Join
                    </a>
                  ) : (
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
                        locked ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-slate-600 ring-1 ring-slate-200'
                      }`}
                    >
                      <Video size={12} />
                      {locked ? 'Done' : 'Waiting'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-1 border-t border-slate-100 px-5 py-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Classmates</p>
                <span className="text-xs text-slate-400">{memberCount} enrolled</span>
              </div>
              {isLoading ? (
                <p className="text-sm text-slate-400">Loading roster…</p>
              ) : data?.members.length ? (
                <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
                  <MemberList members={data.members} />
                </div>
              ) : (
                <p className="text-sm text-slate-500">No classmates yet.</p>
              )}
            </div>
            </div>
          </div>

          <div className="flex min-h-[18rem] w-full shrink-0 flex-col border-t border-slate-200 lg:min-h-0 lg:w-80 xl:w-96 lg:border-l lg:border-t-0">
            <BatchChatPanel
              batchId={batch.id}
              disabled={locked}
              layout="sidebar"
              chatHint="With your teacher and classmates"
            />
          </div>
        </div>
      </div>

      {locked && <BatchClassReview batchId={batch.id} teacherName={teacherName} />}
    </article>
  );
}
