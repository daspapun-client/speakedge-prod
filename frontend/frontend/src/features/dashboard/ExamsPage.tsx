import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import {
  GraduationCap, ScrollText, CalendarClock, Award, ArrowRight, Clock,
  Loader2, AlertCircle, CheckCircle2, Sparkles, Download, FileText, Video, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { PageHeader, badgeClass } from '@/features/admin/_shared';
import {
  ExaminerContact, JoinMeeting, fmtSlotTime, kindMeta, slotWindow,
  type Eligibility, type ExamBooking, type ExamSlot,
} from '@/features/exams/shared';

function SummaryTile({ label, value, icon: Icon, hint }: { label: string; value: number | string; icon: LucideIcon; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-extrabold text-brand">{value}</div>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function StatTile({ kind, allowed, used, remaining }: { kind: string; allowed: number; used: number; remaining: number }) {
  const { icon: Icon, label, hint } = kindMeta(kind);
  const pct = allowed > 0 ? Math.min(100, Math.round((used / allowed) * 100)) : 0;
  const exhausted = remaining <= 0;
  // allowed === 0 is not "used up" — this tier never included the test.
  const included = allowed > 0;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 flex items-baseline gap-2">
            {included ? (
              <>
                <span className="text-2xl font-extrabold text-brand">{remaining}</span>
                <span className="text-sm text-slate-500">of {allowed} remaining</span>
              </>
            ) : (
              <span className="text-base font-bold text-slate-500">Not in your membership</span>
            )}
          </div>
          {included ? (
            <p className="mt-1 text-xs text-slate-400">{used} used · {hint}</p>
          ) : (
            <Link to="/plans" className="mt-1 inline-block text-xs font-semibold text-brand hover:underline">
              Upgrade your membership →
            </Link>
          )}
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${exhausted ? 'bg-amber-400' : 'bg-brand'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

type ExamsTab = 'slots' | 'bookings';

const EXAMS_TABS: { key: ExamsTab; label: string; icon: LucideIcon; description: string }[] = [
  {
    key: 'bookings',
    label: 'My booked exams',
    icon: CalendarClock,
    description: 'Your slot details and, once the examiner submits, your result',
  },
  {
    key: 'slots',
    label: 'Available exam slots',
    icon: ScrollText,
    description: 'Pick a date and time — the examiner assigned to that slot is shown on every card',
  },
];

function EmptyBlock({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
        <Icon size={22} />
      </div>
      <p className="mt-3 font-semibold text-slate-700">{title}</p>
      <div className="mt-1 text-sm text-slate-500">{children}</div>
    </div>
  );
}

/** Calendar tile shared by booked and bookable slot cards. */
function DateTile({ iso, tone = 'upcoming' }: { iso?: string | null; tone?: 'muted' | 'done' | 'upcoming' }) {
  const d = iso ? new Date(iso) : null;
  const ok = Boolean(d && !Number.isNaN(d.getTime()));
  const bg = tone === 'muted' ? 'bg-slate-50' : tone === 'done' ? 'bg-emerald-50' : 'bg-brand/5';
  return (
    <div className={`flex w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-2.5 ${bg}`}>
      {ok && d ? (
        <>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {d.toLocaleDateString('en-IN', { weekday: 'short' })}
          </span>
          <span className={`text-2xl font-extrabold leading-none tabular-nums ${tone === 'muted' ? 'text-slate-400' : 'text-slate-800'}`}>
            {d.toLocaleDateString('en-IN', { day: 'numeric' })}
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {d.toLocaleDateString('en-IN', { month: 'short' })}
          </span>
        </>
      ) : (
        <span className="text-xs font-medium text-slate-400">TBA</span>
      )}
    </div>
  );
}

/**
 * A bookable slot: date tile, window, examiner, seats — then a real CTA
 * or a status well (booked / full / ineligible), never a disabled ghost button.
 */
function SlotCard({ slot, canBook, included, alreadyBooked, booking, onBook }: {
  slot: ExamSlot; canBook: boolean; included: boolean; alreadyBooked: boolean;
  booking: boolean; onBook: () => void;
}) {
  const meta = kindMeta(slot.kind);
  const full = slot.seats_left <= 0;
  const slotRange = slotWindow(slot.scheduled_at, slot.duration_minutes);
  const bookable = canBook && !alreadyBooked && !full;
  const showKind = Boolean(slot.kind && slot.title !== slot.kind);

  return (
    <article className={`relative flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition ${
      alreadyBooked ? 'border-emerald-200/80' : 'border-slate-200 hover:border-brand/30 hover:shadow-md'
    }`}>
      <div className={`absolute inset-y-0 left-0 w-1 ${meta.accent}`} />
      <div className="flex flex-1 flex-col gap-4 p-4 pl-5">
        <div className="flex items-start gap-4">
          <DateTile iso={slot.scheduled_at} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-bold text-slate-800">{slot.title}</h3>
                {showKind && <p className="text-xs font-medium text-slate-400">{slot.kind}</p>}
              </div>
              <span className={`badge shrink-0 ${full ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {full ? 'Full' : `${slot.seats_left} seat${slot.seats_left === 1 ? '' : 's'}`}
              </span>
            </div>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-slate-500">
              <Clock size={13} className="shrink-0 text-slate-400" />
              {slotRange}
            </p>
            <div className="mt-2">
              <ExaminerContact examiner={slot} compact />
            </div>
          </div>
        </div>

        {alreadyBooked ? (
          <div className="mt-auto flex items-center justify-center gap-2 rounded-xl bg-emerald-50 py-2.5 text-sm font-semibold text-emerald-700">
            <CheckCircle2 size={16} /> Slot booked
          </div>
        ) : full ? (
          <div className="mt-auto rounded-xl bg-amber-50 py-2.5 text-center text-sm font-semibold text-amber-700">
            Slot full
          </div>
        ) : bookable ? (
          <button type="button" className="btn-primary mt-auto w-full" disabled={booking} onClick={onBook}>
            {booking ? (
              <><Loader2 size={16} className="animate-spin" /> Booking…</>
            ) : slot.scheduled_at ? (
              'Book this slot'
            ) : (
              'Book test'
            )}
          </button>
        ) : (
          <div className="mt-auto rounded-xl bg-slate-50 py-2.5 text-center text-sm font-medium text-slate-500">
            {included ? 'No eligibility remaining' : 'Not in your membership'}
          </div>
        )}
      </div>
    </article>
  );
}

/** Ticket-style booking: date tile, details, then result or join action. */
function BookingCard({ booking }: { booking: ExamBooking }) {
  const meta = kindMeta(booking.kind);
  const result = booking.result;
  const cancelled = booking.status === 'cancelled';
  const completed = booking.status === 'completed';
  const upcoming = !cancelled && !completed;
  const time = fmtSlotTime(booking.scheduled_at);
  const mins = booking.duration_minutes;
  const resultLabel = result
    ? (result.type === 'cefr_report' ? (result.level ? `CEFR ${result.level}` : 'CEFR report') : result.grade)
    : null;
  const certCta = 'btn-gold shrink-0 px-4 py-2 text-sm shadow-[0_2px_10px_rgba(244,180,0,0.4)]';
  // Both results have a page of their own that renders the real document —
  // preferred over the stored PDF, which is only the fallback for older rows.
  const resultAction = result?.id ? (
    result.type === 'certificate' ? (
      <Link to={`/dashboard/certificate/${result.id}`} className={certCta}>
        <Award size={15} /> View certificate
      </Link>
    ) : (
      <Link to={`/dashboard/report/${result.id}`} className="btn-primary shrink-0 px-4 py-2 text-sm">
        <FileText size={15} /> View result card
      </Link>
    )
  ) : result?.url ? (
    <a
      href={result.url}
      target="_blank"
      rel="noreferrer"
      className={result.type === 'cefr_report' ? 'btn-primary shrink-0 py-1.5 text-xs' : certCta}
    >
      {result.type === 'cefr_report' ? <Download size={14} /> : <Award size={15} />}
      {result.type === 'cefr_report' ? 'Report' : 'View certificate'}
    </a>
  ) : upcoming ? (
    booking.meeting_url
      ? <JoinMeeting url={booking.meeting_url} />
      : (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <Video size={13} className="shrink-0" /> Meeting link pending
        </span>
      )
  ) : null;

  return (
    <article className={`relative overflow-hidden rounded-xl border bg-white shadow-sm transition ${
      cancelled ? 'border-slate-200 opacity-70' : 'border-slate-200 hover:border-brand/30 hover:shadow-md'
    }`}>
      <div className={`absolute inset-y-0 left-0 w-1 ${cancelled ? 'bg-slate-300' : meta.accent}`} />
      <div className="flex items-start gap-4 p-4 pl-5">
        <DateTile iso={booking.scheduled_at} tone={cancelled ? 'muted' : completed ? 'done' : 'upcoming'} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-bold text-slate-800">{booking.exam_title ?? booking.exam_id}</h3>
              {booking.kind && <p className="text-xs font-medium text-slate-400">{booking.kind}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={13} className="shrink-0 text-slate-400" />
                  {time ? `${time}${mins ? ` · ${mins} min` : ''}` : 'Date to be announced'}
                </span>
                <ExaminerContact examiner={booking} compact />
              </div>
            </div>
            <span className={`badge shrink-0 capitalize ${badgeClass(booking.status)}`}>{booking.status}</span>
          </div>

          {(resultLabel || resultAction) && (resultLabel ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-brand-gold/[0.08] p-3.5 ring-1 ring-inset ring-brand-gold/25">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-gold/20 text-brand-gold">
                  <Award size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {result?.type === 'cefr_report' ? 'CEFR level' : 'Grade'}
                  </p>
                  <p className="text-base font-extrabold leading-tight text-slate-800">{resultLabel}</p>
                  {result?.remarks && (
                    <p className="mt-0.5 truncate text-sm text-slate-500">{result.remarks}</p>
                  )}
                </div>
              </div>
              {resultAction}
            </div>
          ) : (
            <div className="mt-3 flex justify-end rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              {resultAction}
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function ExamsSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-56 rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
      </div>
      <div className="h-24 rounded-xl bg-slate-200" />
      <div className="h-48 rounded-xl bg-slate-200" />
      <div className="h-40 rounded-xl bg-slate-200" />
    </div>
  );
}

export function ExamsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<ExamsTab>('bookings');
  const [kindFilter, setKindFilter] = useState<string>('');

  const { data: elig, isLoading: loadingElig } = useQuery({
    queryKey: ['eligibility'],
    queryFn: () => unwrap<Eligibility>(api.get('/exams/eligibility')),
  });
  const { data: slots, isLoading: loadingExams } = useQuery({
    queryKey: ['exams', 'upcoming'],
    queryFn: () => unwrap<ExamSlot[]>(api.get('/exams/', { params: { upcoming: true } })),
  });
  const { data: bookings, isLoading: loadingBookings } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => unwrap<ExamBooking[]>(api.get('/exams/my-bookings')),
  });

  const book = useMutation({
    mutationFn: (examId: string) => unwrap(api.post(`/exams/${examId}/book`, {})),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
      qc.invalidateQueries({ queryKey: ['eligibility'] });
      qc.invalidateQueries({ queryKey: ['exams', 'upcoming'] });
      setTab('bookings');
    },
  });

  const remaining = (kind: string) => elig?.[kind]?.remaining ?? 0;
  /** Slots already on the student's booking list — shown as booked, not bookable. */
  const bookedExamIds = useMemo(
    () => new Set((bookings ?? []).filter((b) => b.status !== 'cancelled').map((b) => b.exam_id)),
    [bookings],
  );

  const visibleSlots = useMemo(
    () => (slots ?? []).filter((s) => !kindFilter || s.kind === kindFilter),
    [slots, kindFilter],
  );

  const stats = useMemo(() => {
    const totalRemaining = Object.values(elig ?? {}).reduce((sum, e) => sum + e.remaining, 0);
    const bookingList = bookings ?? [];
    return {
      available: slots?.length ?? 0,
      bookings: bookingList.length,
      completed: bookingList.filter((b) => b.status === 'completed').length,
      remaining: totalRemaining,
    };
  }, [elig, slots, bookings]);

  if (loadingElig || loadingExams || loadingBookings) return <ExamsSkeleton />;

  const hasResults = bookings?.some((b) => b.result);
  const kinds = Object.keys(elig ?? {});
  const activeTab = EXAMS_TABS.find((t) => t.key === tab)!;
  const tabCounts: Record<ExamsTab, number> = {
    slots: visibleSlots.length,
    bookings: bookings?.length ?? 0,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exams & Certification"
        description="Book a CEFR or Speaking test slot from the dates your admin has published"
        actions={
          <Link to="/dashboard/reports" className="btn-ghost inline-flex items-center gap-2">
            <Award size={16} />
            Certificates & reports
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Available slots" value={stats.available} icon={ScrollText} hint="Open for booking" />
        <SummaryTile label="My bookings" value={stats.bookings} icon={CalendarClock} hint={stats.bookings ? 'Scheduled & completed' : 'None yet'} />
        <SummaryTile label="Completed" value={stats.completed} icon={CheckCircle2} hint={stats.completed ? 'View reports & certs' : 'Finish a test first'} />
      </div>

      {stats.remaining > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-5 text-white sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90">
                  <Sparkles size={14} /> Plan eligibility
                </p>
                <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">
                  {stats.remaining} test slot{stats.remaining === 1 ? '' : 's'} available
                </h2>
                <p className="mt-1 text-sm text-white/80">
                  Each slot lists its examiner and WhatsApp number — reach out any time before your test
                </p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <GraduationCap size={28} />
              </div>
            </div>
          </div>
        </div>
      )}

      {kinds.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(elig ?? {}).map(([kind, e]) => (
            <StatTile key={kind} kind={kind} allowed={e.allowed} used={e.used} remaining={e.remaining} />
          ))}
        </div>
      )}

      <section className="card">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Exam views">
          {EXAMS_TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`inline-flex items-center justify-center gap-2 rounded-lg px-2 py-2.5 text-xs font-semibold transition sm:px-3 sm:text-sm ${
                  active ? 'bg-white text-brand shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
                onClick={() => setTab(key)}
              >
                <Icon size={15} className="hidden shrink-0 sm:block" />
                <span className="truncate">{label}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${
                  active ? 'bg-brand/10 text-brand' : 'bg-white/70 text-slate-500'
                }`}>
                  {tabCounts[key]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-slate-500">{activeTab.description}</p>

        <div className="mt-4">
          {tab === 'slots' ? (
            <>
              {book.isError && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <AlertCircle size={18} className="mt-0.5 shrink-0" />
                  {(book.error as Error).message}
                </div>
              )}

              {kinds.length > 1 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`btn-ghost py-1 text-xs ${kindFilter === '' ? 'bg-slate-100' : ''}`}
                    onClick={() => setKindFilter('')}
                  >
                    All tests
                  </button>
                  {kinds.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`btn-ghost py-1 text-xs ${kindFilter === k ? 'bg-slate-100' : ''}`}
                      onClick={() => setKindFilter(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}

              {!visibleSlots.length ? (
                <EmptyBlock icon={ScrollText} title="No exam slots available">
                  Check back soon — new dates and times are published by the admin team.
                </EmptyBlock>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {visibleSlots.map((slot) => (
                    <SlotCard
                      key={slot.id}
                      slot={slot}
                      canBook={remaining(slot.kind) > 0}
                      included={(elig?.[slot.kind]?.allowed ?? 0) > 0}
                      alreadyBooked={bookedExamIds.has(slot.id)}
                      booking={book.isPending && book.variables === slot.id}
                      onBook={() => book.mutate(slot.id)}
                    />
                  ))}
                </div>
              )}
            </>
          ) : !bookings?.length ? (
            <EmptyBlock icon={CalendarClock} title="No bookings yet">
              <button
                type="button"
                className="font-semibold text-brand hover:text-brand-light"
                onClick={() => setTab('slots')}
              >
                Book a slot
              </button>
              {' '}to get started. Results appear here and in{' '}
              <Link to="/dashboard/reports" className="font-semibold text-brand hover:text-brand-light">
                Reports & Downloads
              </Link>
              .
            </EmptyBlock>
          ) : (
            <div className="space-y-3">
              {bookings.map((b) => <BookingCard key={b.id} booking={b} />)}
            </div>
          )}
        </div>
      </section>

      {hasResults && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-brand/5 px-6 py-5 sm:px-8">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-brand/10 p-2.5 text-brand"><FileText size={20} /></div>
              <div>
                <p className="font-semibold text-slate-800">All your results in one place</p>
                <p className="mt-1 text-sm text-slate-500">
                  Every CEFR report card and speaking certificate stays available on your reports page.
                </p>
              </div>
            </div>
            <Link to="/dashboard/reports" className="btn-primary inline-flex shrink-0 items-center gap-2">
              View downloads <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
