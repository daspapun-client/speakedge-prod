import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import {
  GraduationCap, ScrollText, CalendarClock, Award, ArrowRight, Clock, Users,
  Loader2, AlertCircle, CheckCircle2, Sparkles, Download, FileText, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatusBadge, badgeClass, fmtDay } from '@/features/admin/_shared';
import {
  ExaminerContact, fmtSlot, kindMeta, slotWindow,
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

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-brand">{remaining}</span>
            <span className="text-sm text-slate-500">of {allowed} remaining</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{used} used · {hint}</p>
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

function Section({ title, icon: Icon, description, count, children }: {
  title: string; icon: LucideIcon; description?: string; count?: number; children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-brand/10 p-2 text-brand"><Icon size={18} /></span>
          <div>
            <h2 className="font-bold text-slate-800">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        {count != null && (
          <span className="text-sm text-slate-400">{count} item{count === 1 ? '' : 's'}</span>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

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

/** One line of the slot card — icon + label + value, kept aligned across cards. */
function SlotField({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon size={14} className="mt-0.5 shrink-0 text-brand" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A bookable slot, showing everything the spec promises: exam name, date,
 * slot window, examiner name and the examiner's WhatsApp number.
 */
function SlotCard({ slot, canBook, alreadyBooked, booking, onBook }: {
  slot: ExamSlot; canBook: boolean; alreadyBooked: boolean; booking: boolean; onBook: () => void;
}) {
  const meta = kindMeta(slot.kind);
  const Icon = meta.icon;
  const date = fmtSlot(slot.scheduled_at);
  const full = slot.seats_left <= 0;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-brand hover:shadow-md">
      <div className={`h-1 ${meta.accent}`} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand transition group-hover:bg-brand group-hover:text-white">
            <Icon size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-slate-800 group-hover:text-brand">{slot.title}</h3>
            <span className={`badge mt-2 ${badgeClass(slot.kind)}`}>{slot.kind}</span>
          </div>
        </div>

        <div className="mt-4 space-y-2.5">
          <SlotField icon={CalendarClock}>
            <span className="font-semibold text-slate-700">{date ?? 'Date to be announced'}</span>
          </SlotField>
          <SlotField icon={Clock}>
            <span className="text-slate-600">{slotWindow(slot.scheduled_at, slot.duration_minutes)}</span>
          </SlotField>
          <SlotField icon={Users}>
            <span className={full ? 'text-amber-600' : 'text-slate-600'}>
              {full ? 'Slot full' : `${slot.seats_left} seat${slot.seats_left === 1 ? '' : 's'} left`}
            </span>
          </SlotField>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <ExaminerContact examiner={slot} />
          </div>
        </div>

        <div className="mt-auto border-t border-slate-100 pt-4">
          <button
            type="button"
            className={`w-full ${canBook && !alreadyBooked && !full ? 'btn-primary' : 'btn-ghost cursor-not-allowed opacity-70'}`}
            disabled={!canBook || alreadyBooked || full || booking}
            onClick={onBook}
          >
            {booking ? (
              <><Loader2 size={16} className="animate-spin" /> Booking…</>
            ) : alreadyBooked ? (
              <><CheckCircle2 size={16} /> Slot booked</>
            ) : full ? (
              'Slot full'
            ) : canBook ? (
              date ? 'Book this slot' : 'Book test'
            ) : (
              'No eligibility remaining'
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

/**
 * A booked slot. Carries the same detail as the booking card plus the result
 * once the examiner has submitted it — the report card / certificate the
 * student downloads straight from here.
 */
function BookingCard({ booking }: { booking: ExamBooking }) {
  const meta = kindMeta(booking.kind);
  const Icon = meta.icon;
  const result = booking.result;

  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-brand/30 hover:bg-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="shrink-0 rounded-lg bg-brand/10 p-2 text-brand"><Icon size={16} /></div>
          <div className="min-w-0 space-y-2">
            <div>
              <div className="font-semibold text-slate-800">{booking.exam_title ?? booking.exam_id}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                {booking.kind && <span className={`badge ${badgeClass(booking.kind)}`}>{booking.kind}</span>}
                <span>Booked {fmtDay(booking.created_at)}</span>
              </div>
            </div>
            <SlotField icon={CalendarClock}>
              <span className="font-semibold text-slate-700">{fmtSlot(booking.scheduled_at) ?? 'Date to be announced'}</span>
            </SlotField>
            <SlotField icon={Clock}>
              <span className="text-slate-600">{slotWindow(booking.scheduled_at, booking.duration_minutes)}</span>
            </SlotField>
            <ExaminerContact examiner={booking} compact />
          </div>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      {result && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
                <Award size={14} className="shrink-0" />
                {result.type === 'cefr_report' ? `CEFR Level ${result.level}` : `Result: ${result.grade}`}
              </p>
              {result.remarks && <p className="mt-1 text-sm text-emerald-900/80">{result.remarks}</p>}
              {result.verification_code && (
                <p className="mt-1 font-mono text-xs text-emerald-700/70">{result.verification_code}</p>
              )}
            </div>
            {result.url && (
              <a href={result.url} target="_blank" rel="noreferrer" className="btn-primary inline-flex shrink-0 items-center gap-2 py-1.5 text-xs">
                <Download size={14} />
                {result.type === 'cefr_report' ? 'Report card' : 'Certificate'}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
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

      <Section
        title="Available exam slots"
        icon={ScrollText}
        description="Pick a date and time — the examiner assigned to that slot is shown on every card"
        count={visibleSlots.length}
      >
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
                alreadyBooked={bookedExamIds.has(slot.id)}
                booking={book.isPending && book.variables === slot.id}
                onBook={() => book.mutate(slot.id)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="My booked exams"
        icon={CalendarClock}
        description="Your slot details and, once the examiner submits, your result"
        count={bookings?.length}
      >
        {!bookings?.length ? (
          <EmptyBlock icon={CalendarClock} title="No bookings yet">
            Book a slot above to get started. Results appear here and in{' '}
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
      </Section>

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
