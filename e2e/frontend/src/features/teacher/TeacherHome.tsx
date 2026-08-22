import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Layers,
  Star,
  User,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { type ReactNode } from 'react';
import { api, unwrap } from '@/lib/api';
import { rupees, fmtDay } from '@/features/admin/_shared';
import {
  BarChart,
  BarList,
  ChartCard,
  CHART_COLORS,
  DonutChart,
  TrendCard,
} from '@/features/admin/charts';
import { batchClassDateIso, batchTimeLabel, fmtClassDate } from '@/features/batch/shared';

interface Batch {
  id: string;
  title: string;
  date?: string | null;
  day_of_week?: string | null;
  class_time?: string | null;
  student_ids: string[];
  pending_ids?: string[];
}

interface Dashboard {
  teacher_id?: string | null;
  name: string;
  photo_url?: string | null;
  batches: Batch[];
  pending_attendance_approvals: number;
  average_rating?: number | null;
  review_count: number;
  earnings: { pending_paise: number; this_month_paise: number; total_received_paise: number };
  analytics: {
    total_students: number;
    pending_join_requests: number;
    classes_approved: number;
    classes_this_month: number;
    attendance_rate?: number | null;
    attendance: { approved: number; pending: number; rejected: number };
    earnings_trend: { months: string[]; amounts_paise: number[] };
    rating_breakdown: Record<string, number>;
    recent_reviews: {
      id: string;
      rating?: number | null;
      feedback?: string | null;
      class_date?: string | null;
      class_time?: string | null;
      student_id?: string | null;
      student_name?: string | null;
      batch_title?: string | null;
      created_at?: string | null;
    }[];
  };
}

function StatTile({
  label,
  icon: Icon,
  children,
  hint,
  to,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
  hint?: string;
  to?: string;
}) {
  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-2">{children}</div>
        {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
      </div>
      <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
        <Icon size={20} />
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="card block transition hover:border-brand hover:shadow-md">
        {inner}
      </Link>
    );
  }
  return <div className="card">{inner}</div>;
}

function OverviewRow({
  icon: Icon,
  label,
  value,
  sub,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  sub?: string;
  to?: string;
}) {
  const row = (
    <>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <div className="mt-0.5">{value}</div>
        {sub && <p className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</p>}
      </div>
      {to && <ChevronRight size={15} className="shrink-0 text-slate-300" aria-hidden />}
    </>
  );

  const cls = 'flex items-center gap-2.5 px-3 py-2 transition active:bg-slate-50';
  if (to) {
    return (
      <Link to={to} className={cls}>
        {row}
      </Link>
    );
  }
  return <div className={cls}>{row}</div>;
}

function MetaChip({ children, to }: { children: ReactNode; to?: string }) {
  const cls =
    'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm';
  if (to) {
    return (
      <Link to={to} className={`${cls} transition active:scale-95 hover:border-brand/30 hover:text-brand`}>
        {children}
      </Link>
    );
  }
  return <span className={cls}>{children}</span>;
}

const QUICK_LINKS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/teacher/batches', label: 'Batches', icon: CalendarClock },
  { to: '/teacher/remuneration', label: 'Earnings', icon: Wallet },
  { to: '/teacher/reviews', label: 'Reviews', icon: Star },
  { to: '/teacher/profile', label: 'Profile', icon: User },
];

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-4 sm:space-y-6">
      <div className="h-40 rounded-none bg-slate-200 sm:rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-xl bg-slate-200" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-56 rounded-xl bg-slate-200" />
        <div className="h-56 rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5 text-brand-gold">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          className={n <= rating ? 'fill-brand-gold' : 'fill-transparent opacity-30'}
        />
      ))}
    </span>
  );
}

function reviewMeta(r: Dashboard['analytics']['recent_reviews'][number]) {
  const dateLabel = r.class_date
    ? fmtClassDate(r.class_date)
    : r.created_at
      ? fmtDay(r.created_at)
      : null;
  return [r.batch_title, dateLabel, r.class_time].filter(Boolean).join(' · ');
}

export function TeacherHome() {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-dashboard'],
    queryFn: () => unwrap<Dashboard>(api.get('/teacher/dashboard')),
  });

  if (isLoading) return <DashboardSkeleton />;
  if (!data) return <p className="text-slate-500">No teacher profile linked to this account.</p>;

  const a = data.analytics;
  const firstName = data.name.split(/\s+/)[0] ?? data.name;
  const ratingItems = [5, 4, 3, 2, 1].map((n) => ({
    label: `${n} ★`,
    value: a.rating_breakdown[String(n)] ?? 0,
  }));
  const attendanceItems = [
    { label: 'Approved', value: a.attendance.approved },
    { label: 'Pending review', value: a.attendance.pending },
    { label: 'Rejected', value: a.attendance.rejected },
  ];

  const sortedBatches = [...data.batches].sort((x, y) => {
    const dx = batchClassDateIso(x) ?? '9999-99-99';
    const dy = batchClassDateIso(y) ?? '9999-99-99';
    return dx.localeCompare(dy);
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Hero */}
      <div className="-mx-3 overflow-hidden rounded-none border-0 bg-white shadow-none sm:mx-0 sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-sm">
        <div className="relative bg-gradient-to-br from-brand via-brand to-brand-light px-4 pb-5 pt-5 text-white sm:px-8 sm:py-6">
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10 blur-2xl"
            aria-hidden
          />
          <div className="relative flex items-start gap-3.5 sm:gap-5">
            {data.photo_url ? (
              <img
                src={data.photo_url}
                alt=""
                className="h-14 w-14 shrink-0 rounded-2xl border-2 border-white/30 object-cover shadow-lg sm:h-20 sm:w-20 sm:rounded-full sm:border-4"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-white/30 bg-white/20 text-xl font-bold shadow-lg sm:h-20 sm:w-20 sm:rounded-full sm:border-4 sm:text-2xl">
                {data.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-xs font-medium text-white/75 sm:text-sm sm:text-white/80">Teacher dashboard</p>
              <h1 className="mt-0.5 text-xl font-extrabold leading-tight sm:text-3xl">Hi, {firstName}</h1>
              <p className="mt-1 truncate font-mono text-[11px] text-white/65 sm:text-sm sm:text-white/70">
                {data.teacher_id ? data.teacher_id : 'Certification pending'}
              </p>
              {data.average_rating != null && (
                <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold sm:hidden">
                  <Star size={13} className="fill-brand-gold text-brand-gold" />
                  {data.average_rating} · {data.review_count} reviews
                </div>
              )}
            </div>
            {data.average_rating != null && (
              <div className="hidden shrink-0 flex-col items-end sm:flex">
                <div className="flex items-center gap-1 text-2xl font-extrabold">
                  {data.average_rating}
                  <Star size={22} className="fill-brand-gold text-brand-gold" />
                </div>
                <p className="text-xs text-white/70">{data.review_count} reviews</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-100 bg-slate-50/80 px-3 py-3 sm:px-8 sm:py-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <MetaChip>
              <Layers size={13} className="text-brand" />
              {data.batches.length} active batch{data.batches.length === 1 ? '' : 'es'}
            </MetaChip>
            <MetaChip>
              <Users size={13} className="text-brand" />
              {a.total_students} student{a.total_students === 1 ? '' : 's'}
            </MetaChip>
            {a.pending_join_requests > 0 && (
              <MetaChip to="/teacher/batches">
                <UserPlus size={13} className="text-brand" />
                {a.pending_join_requests} join request{a.pending_join_requests === 1 ? '' : 's'}
              </MetaChip>
            )}
            {data.pending_attendance_approvals > 0 && (
              <MetaChip to="/teacher/batches">
                <ClipboardCheck size={13} className="text-amber-600" />
                {data.pending_attendance_approvals} attendance pending
              </MetaChip>
            )}
          </div>
        </div>
      </div>

      {data.pending_attendance_approvals > 0 && (
        <div className="card flex flex-col gap-3 border-amber-200 bg-amber-50/80 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <p className="font-bold text-amber-900">Attendance awaiting verification</p>
            <p className="mt-0.5 text-sm text-amber-800">
              {data.pending_attendance_approvals} submission{data.pending_attendance_approvals === 1 ? '' : 's'} pending admin approval.
            </p>
          </div>
          <Link to="/teacher/batches" className="btn-primary inline-flex shrink-0 items-center gap-2 py-2 text-sm">
            View batches <ArrowRight size={16} />
          </Link>
        </div>
      )}

      {/* Key metrics */}
      <section>
        <h2 className="mb-2 hidden text-base font-bold text-slate-800 sm:mb-3 sm:block">Overview</h2>

        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:hidden">
          <OverviewRow
            icon={Layers}
            label="Active batches"
            value={<span className="text-sm font-bold text-slate-900">{data.batches.length}</span>}
            sub={`${a.total_students} enrolled students`}
            to="/teacher/batches"
          />
          <OverviewRow
            icon={ClipboardCheck}
            label="Classes taught"
            value={<span className="text-sm font-bold text-slate-900">{a.classes_approved}</span>}
            sub={
              a.attendance_rate != null
                ? `${a.attendance_rate}% attendance rate · ${a.classes_this_month} this month`
                : `${a.classes_this_month} this month`
            }
          />
          <OverviewRow
            icon={Wallet}
            label="This month"
            value={<span className="text-sm font-bold text-brand">{rupees(data.earnings.this_month_paise)}</span>}
            sub={`${rupees(data.earnings.pending_paise)} pending payout`}
            to="/teacher/remuneration"
          />
          <OverviewRow
            icon={Star}
            label="Rating"
            value={
              data.average_rating != null ? (
                <span className="text-sm font-bold text-slate-900">{data.average_rating} ★</span>
              ) : (
                <span className="text-sm font-medium text-slate-500">No reviews yet</span>
              )
            }
            sub={data.review_count ? `${data.review_count} reviews` : undefined}
            to="/teacher/reviews"
          />
        </div>

        <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Active batches" icon={Layers} to="/teacher/batches" hint={`${a.total_students} enrolled students`}>
            <p className="text-3xl font-extrabold text-brand">{data.batches.length}</p>
          </StatTile>
          <StatTile
            label="Classes taught"
            icon={ClipboardCheck}
            hint={
              a.attendance_rate != null
                ? `${a.attendance_rate}% attendance rate · ${a.classes_this_month} this month`
                : `${a.classes_this_month} this month`
            }
          >
            <p className="text-3xl font-extrabold text-brand">{a.classes_approved}</p>
          </StatTile>
          <StatTile label="This month" icon={Wallet} to="/teacher/remuneration" hint={`${rupees(data.earnings.pending_paise)} pending`}>
            <p className="text-3xl font-extrabold text-brand">{rupees(data.earnings.this_month_paise)}</p>
          </StatTile>
          <StatTile label="Total received" icon={Wallet} to="/teacher/remuneration" hint={`${data.review_count} student reviews`}>
            <p className="text-3xl font-extrabold text-brand">{rupees(data.earnings.total_received_paise)}</p>
          </StatTile>
        </div>
      </section>

      {/* Analytics charts */}
      <section>
        <h2 className="mb-2 text-base font-bold text-slate-800 sm:mb-3">Analytics</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <TrendCard
            title="Monthly earnings"
            values={a.earnings_trend.amounts_paise}
            labels={a.earnings_trend.months}
            color={CHART_COLORS[2]}
            format={(n) => rupees(n)}
          />
          <ChartCard title="Earnings by month" hint="Remuneration credited per period">
            <BarChart
              labels={a.earnings_trend.months}
              values={a.earnings_trend.amounts_paise}
              color={CHART_COLORS[0]}
              format={(n) => rupees(n)}
            />
          </ChartCard>
          <ChartCard title="Attendance submissions" hint="By verification status">
            <BarList items={attendanceItems} empty="No attendance submitted yet." />
          </ChartCard>
          <ChartCard title="Rating distribution" hint={`${data.review_count} total reviews`}>
            {data.review_count > 0 ? (
              <DonutChart items={ratingItems.filter((i) => i.value > 0)} format={(n) => `${n}`} />
            ) : (
              <BarList items={ratingItems} empty="No reviews yet — ratings appear after students submit feedback." />
            )}
          </ChartCard>
        </div>
      </section>

      {/* Quick access */}
      <section className="card p-4 sm:p-5">
        <div>
          <h2 className="text-base font-bold text-slate-900 sm:text-lg">Quick access</h2>
          <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">Jump to your most-used sections</p>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-2 sm:gap-3">
          {QUICK_LINKS.map((q) => (
            <Link
              key={q.to}
              to={q.to}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50/50 py-3 text-center transition hover:border-brand/30 hover:bg-brand/5 active:scale-95 sm:gap-2.5 sm:py-5"
            >
              <div className="rounded-xl bg-brand/10 p-2.5 text-brand sm:p-3">
                <q.icon size={20} className="sm:hidden" />
                <q.icon size={22} className="hidden sm:block" />
              </div>
              <span className="text-[10px] font-semibold leading-tight text-slate-700 sm:text-xs">{q.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent reviews */}
      {a.recent_reviews.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 sm:text-lg">Recent reviews</h2>
              <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">Latest student feedback</p>
            </div>
            <Link to="/teacher/reviews" className="text-sm font-semibold text-brand hover:underline">
              View all
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            {a.recent_reviews.map((r) => (
              <li key={r.id} className="card p-4">
                <p className="truncate font-medium text-sm text-slate-900">
                  {r.student_name || r.student_id || 'Student'}
                </p>
                <div className="mt-1.5">
                  {r.rating != null ? (
                    <Stars rating={r.rating} />
                  ) : (
                    <span className="text-xs text-slate-400">No rating</span>
                  )}
                </div>
                {reviewMeta(r) && (
                  <p className="mt-1 text-xs text-slate-400">{reviewMeta(r)}</p>
                )}
                {r.feedback ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-snug text-slate-600">&ldquo;{r.feedback}&rdquo;</p>
                ) : (
                  <p className="mt-2 text-sm italic text-slate-400">No written feedback.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Batches */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">My batches</h2>
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">Upcoming and active classes</p>
          </div>
          <Link to="/teacher/batches" className="text-sm font-semibold text-brand hover:underline">
            Manage
          </Link>
        </div>
        {!sortedBatches.length ? (
          <div className="card py-10 text-center">
            <CalendarClock size={32} className="mx-auto text-slate-300" />
            <p className="mt-3 font-medium text-slate-600">No batches assigned yet</p>
            <p className="mt-1 text-sm text-slate-400">The admin assigns your batches.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {sortedBatches.map((b) => {
              const classDate = batchClassDateIso(b);
              const time = batchTimeLabel(b);
              const pending = b.pending_ids?.length ?? 0;
              return (
                <Link
                  key={b.id}
                  to="/teacher/batches"
                  className="card group block transition hover:border-brand/40 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 group-hover:text-brand">{b.title}</div>
                      <div className="mt-1 text-sm text-slate-500">
                        {classDate ? fmtClassDate(classDate) : b.day_of_week ?? 'Schedule TBD'}
                        {time ? ` · ${time}` : ''}
                      </div>
                    </div>
                    <ChevronRight size={18} className="shrink-0 text-slate-300 transition group-hover:text-brand" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="badge bg-brand/10 text-brand">
                      <Users size={12} className="mr-1 inline" />
                      {b.student_ids.length} student{b.student_ids.length === 1 ? '' : 's'}
                    </span>
                    {pending > 0 && (
                      <span className="badge bg-amber-100 text-amber-700">
                        <UserPlus size={12} className="mr-1 inline" />
                        {pending} pending
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
