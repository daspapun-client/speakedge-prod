import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import {
  GraduationCap, Mic, ScrollText, CalendarClock, Award, ArrowRight,
  Loader2, AlertCircle, CheckCircle2, Sparkles, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatusBadge, badgeClass, fmtDay } from '@/features/admin/_shared';

interface Eligibility {
  [kind: string]: { allowed: number; used: number; remaining: number };
}
interface Exam {
  id: string;
  kind: string;
  title: string;
  scheduled_at?: string | null;
}
interface Booking {
  id: string;
  exam_id: string;
  status: string;
  created_at: string;
  exam_title?: string | null;
  kind?: string | null;
  scheduled_at?: string | null;
}

/** "Sat, 12 Sep 2026 · 10:00 AM" — the slot as the learner sees it. */
function fmtSlot(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

const KIND_META: Record<string, { icon: LucideIcon; label: string; hint: string; accent: string }> = {
  CEFR: {
    icon: GraduationCap,
    label: 'CEFR tests',
    hint: 'Assess your English level (A1–C2)',
    accent: 'bg-emerald-500',
  },
  Speaking: {
    icon: Mic,
    label: 'Speaking tests',
    hint: 'Earn a SpeakEdge certificate',
    accent: 'bg-brand-gold',
  },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? {
    icon: ScrollText,
    label: `${kind} tests`,
    hint: 'Included in your plan',
    accent: 'bg-brand/70',
  };
}

function StatTile({
  kind,
  allowed,
  used,
  remaining,
}: {
  kind: string;
  allowed: number;
  used: number;
  remaining: number;
}) {
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

function Section({
  title,
  icon: Icon,
  description,
  count,
  children,
}: {
  title: string;
  icon: LucideIcon;
  description?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-brand/10 p-2 text-brand">
            <Icon size={18} />
          </span>
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

function EmptyBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
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

function ExamCard({
  exam,
  canBook,
  alreadyBooked,
  booking,
  onBook,
}: {
  exam: Exam;
  canBook: boolean;
  alreadyBooked: boolean;
  booking: boolean;
  onBook: () => void;
}) {
  const meta = kindMeta(exam.kind);
  const Icon = meta.icon;
  const slot = fmtSlot(exam.scheduled_at);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-brand hover:shadow-md">
      <div className={`h-1 ${meta.accent}`} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand transition group-hover:bg-brand group-hover:text-white">
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 group-hover:text-brand">{exam.title}</h3>
            <span className={`badge mt-2 ${badgeClass(exam.kind)}`}>{exam.kind}</span>
            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <CalendarClock size={14} className="shrink-0 text-brand" />
              {slot ?? 'Date to be announced'}
            </p>
            <p className="mt-1 text-sm text-slate-500">{meta.hint}</p>
          </div>
        </div>
        <div className="mt-auto border-t border-slate-100 pt-4">
          <button
            type="button"
            className={`w-full ${canBook && !alreadyBooked ? 'btn-primary' : 'btn-ghost cursor-not-allowed opacity-70'}`}
            disabled={!canBook || alreadyBooked || booking}
            onClick={onBook}
          >
            {booking ? (
              <><Loader2 size={16} className="animate-spin" /> Booking…</>
            ) : alreadyBooked ? (
              <><CheckCircle2 size={16} /> Slot booked</>
            ) : canBook ? (
              slot ? 'Book this slot' : 'Book test'
            ) : (
              'No eligibility remaining'
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function BookingRow({
  title,
  kind,
  slot,
  booked,
  status,
}: {
  title: string;
  kind?: string;
  slot?: string | null;
  booked: string;
  status: string;
}) {
  const meta = kind ? kindMeta(kind) : null;
  const Icon = meta?.icon ?? ScrollText;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-brand/30 hover:bg-white sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="shrink-0 rounded-lg bg-brand/10 p-2 text-brand">
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-800">{title}</div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-700">
            <CalendarClock size={14} className="shrink-0 text-brand" />
            {slot ?? 'Date to be announced'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {kind && <span className={`badge ${badgeClass(kind)}`}>{kind}</span>}
            <span>Booked {booked}</span>
          </div>
        </div>
      </div>
      <StatusBadge status={status} />
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
  const { data: elig, isLoading: loadingElig } = useQuery({
    queryKey: ['eligibility'],
    queryFn: () => unwrap<Eligibility>(api.get('/exams/eligibility')),
  });
  const { data: exams, isLoading: loadingExams } = useQuery({
    queryKey: ['exams', 'upcoming'],
    queryFn: () => unwrap<Exam[]>(api.get('/exams/', { params: { upcoming: true } })),
  });
  const { data: bookings, isLoading: loadingBookings } = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => unwrap<Booking[]>(api.get('/exams/my-bookings')),
  });

  const book = useMutation({
    mutationFn: (examId: string) => unwrap(api.post(`/exams/${examId}/book`, {})),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-bookings'] });
      qc.invalidateQueries({ queryKey: ['eligibility'] });
    },
  });

  const remaining = (kind: string) => elig?.[kind]?.remaining ?? 0;
  /** Slots already on the student's booking list — shown as booked, not bookable. */
  const bookedExamIds = useMemo(
    () => new Set((bookings ?? []).filter((b) => b.status !== 'cancelled').map((b) => b.exam_id)),
    [bookings],
  );

  const stats = useMemo(() => {
    const totalRemaining = Object.values(elig ?? {}).reduce((sum, e) => sum + e.remaining, 0);
    const bookingList = bookings ?? [];
    return {
      available: exams?.length ?? 0,
      bookings: bookingList.length,
      completed: bookingList.filter((b) => b.status === 'completed').length,
      remaining: totalRemaining,
    };
  }, [elig, exams, bookings]);

  const isLoading = loadingElig || loadingExams || loadingBookings;
  if (isLoading) return <ExamsSkeleton />;

  const hasCompleted = bookings?.some((b) => b.status === 'completed');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exams & Certification"
        description="Book CEFR assessments and speaking tests included with your subscription"
        actions={
          <Link to="/dashboard/reports" className="btn-ghost inline-flex items-center gap-2">
            <Award size={16} />
            Certificates & reports
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Available tests" value={stats.available} icon={ScrollText} hint="Open for booking" />
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
                <p className="mt-1 text-sm text-white/80">Book below — an examiner is assigned after booking</p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <GraduationCap size={28} />
              </div>
            </div>
          </div>
        </div>
      )}

      {elig && Object.keys(elig).length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Object.entries(elig).map(([kind, e]) => (
            <StatTile key={kind} kind={kind} allowed={e.allowed} used={e.used} remaining={e.remaining} />
          ))}
        </div>
      )}

      <Section
        title="Available exam slots"
        icon={ScrollText}
        description="Pick a date and time to book a CEFR or Speaking test from your entitlement"
        count={exams?.length}
      >
        {book.isError && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            {(book.error as Error).message}
          </div>
        )}

        {!exams?.length ? (
          <EmptyBlock icon={ScrollText} title="No exam slots available">
            Check back soon — new exam slots are added by the admin team.
          </EmptyBlock>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {exams.map((ex) => (
              <ExamCard
                key={ex.id}
                exam={ex}
                canBook={remaining(ex.kind) > 0}
                alreadyBooked={bookedExamIds.has(ex.id)}
                booking={book.isPending && book.variables === ex.id}
                onBook={() => book.mutate(ex.id)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="My bookings"
        icon={CalendarClock}
        description="Your booked exam slots — scheduled, in progress and completed"
        count={bookings?.length}
      >
        {!bookings?.length ? (
          <EmptyBlock icon={CalendarClock} title="No bookings yet">
            Book a slot above to get started. Results appear in{' '}
            <Link to="/dashboard/reports" className="font-semibold text-brand hover:text-brand-light">
              Reports & Downloads
            </Link>
            .
          </EmptyBlock>
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => (
              <BookingRow
                key={b.id}
                title={b.exam_title ?? b.exam_id}
                kind={b.kind ?? undefined}
                slot={fmtSlot(b.scheduled_at)}
                booked={fmtDay(b.created_at)}
                status={b.status}
              />
            ))}
          </div>
        )}
      </Section>

      {hasCompleted && (
        <div className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-brand/5 px-6 py-5 sm:px-8">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-brand/10 p-2.5 text-brand">
                <Award size={20} />
              </div>
              <div>
                <p className="font-semibold text-slate-800">Completed an exam?</p>
                <p className="mt-1 text-sm text-slate-500">
                  Download your CEFR report card or speaking certificate from your reports page.
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
