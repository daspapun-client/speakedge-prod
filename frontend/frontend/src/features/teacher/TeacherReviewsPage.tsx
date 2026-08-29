import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clock, Layers, MessageSquare, Star, type LucideIcon } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';
import { fmtClassDate } from '@/features/batch/shared';

interface Feedback {
  id: string;
  rating?: number | null;
  feedback?: string | null;
  class_date?: string | null;
  class_time?: string | null;
  student_id?: string | null;
  student_name?: string | null;
  batch_title?: string | null;
  created_at?: string | null;
}

interface Reviews {
  average_rating?: number | null;
  review_count: number;
  feedback: Feedback[];
}

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex shrink-0 gap-0.5 text-brand-gold" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= rating ? 'fill-brand-gold' : 'fill-transparent opacity-25'}
        />
      ))}
    </span>
  );
}

function Chip({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
      <Icon size={12} className="shrink-0 text-slate-400" />
      {children}
    </span>
  );
}

function initial(name?: string | null) {
  return (name?.trim()?.[0] || 'S').toUpperCase();
}

export function TeacherReviewsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-reviews'],
    queryFn: () => unwrap<Reviews>(api.get('/teacher/my-reviews')),
  });
  const [star, setStar] = useState<number | null>(null);

  const feedback = data?.feedback ?? [];
  const counts = useMemo(
    () => [5, 4, 3, 2, 1].map((n) => ({ n, count: feedback.filter((f) => f.rating === n).length })),
    [feedback],
  );
  const max = Math.max(1, ...counts.map((c) => c.count));
  const shown = star == null ? feedback : feedback.filter((f) => f.rating === star);
  const avg = data?.average_rating;
  const total = data?.review_count ?? 0;

  return (
    <div>
      <PageHeader
        title="Student Reviews"
        description="Ratings and written feedback from your classes."
      />

      {isLoading ? (
        <div className="mt-6 animate-pulse space-y-4">
          <div className="h-36 rounded-2xl bg-slate-200" />
          <div className="h-28 rounded-2xl bg-slate-200" />
          <div className="h-28 rounded-2xl bg-slate-200" />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
            <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-6">
              <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-center sm:text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gold/15 text-brand-gold sm:h-14 sm:w-14">
                  <Star size={26} className="fill-brand-gold" />
                </span>
                <div>
                  <p className="text-4xl font-extrabold leading-none tabular-nums tracking-tight text-slate-900">
                    {avg != null ? avg.toFixed(1) : '—'}
                  </p>
                  <div className="mt-1.5 flex sm:justify-center">
                    <Stars rating={Math.round(avg ?? 0)} size={15} />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {total} review{total === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              <div className="min-w-0 flex-1 space-y-1.5">
                {counts.map(({ n, count }) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setStar((s) => (s === n ? null : n))}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left transition ${
                      star === n ? 'bg-brand-gold/10' : 'hover:bg-slate-50'
                    }`}
                    aria-pressed={star === n}
                    aria-label={`Filter ${n}-star reviews`}
                  >
                    <span className="inline-flex w-8 items-center gap-1 text-[12px] font-semibold tabular-nums text-slate-600">
                      {n}
                      <Star size={10} className="fill-brand-gold text-brand-gold" />
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-gold"
                        style={{ width: `${(count / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-6 text-right text-[12px] tabular-nums text-slate-400">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!feedback.length ? (
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
                <MessageSquare size={22} />
              </span>
              <p className="mt-3 font-semibold text-slate-700">No feedback yet</p>
              <p className="mt-1 max-w-sm text-sm text-slate-500">
                Reviews appear here after students rate a class.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center">
              <p className="font-semibold text-slate-700">No {star}-star reviews</p>
              <button type="button" className="btn-ghost mt-4 text-sm" onClick={() => setStar(null)}>
                Show all reviews
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {shown.map((f) => {
                const name = f.student_name || f.student_id || 'Student';
                return (
                  <li
                    key={f.id}
                    className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md sm:p-5"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-sm font-bold text-brand">
                        {initial(name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{name}</p>
                            {f.student_id && f.student_name && (
                              <p className="font-mono text-[11px] text-slate-400">{f.student_id}</p>
                            )}
                          </div>
                          {f.rating != null ? (
                            <Stars rating={f.rating} />
                          ) : (
                            <span className="text-xs text-slate-400">No rating</span>
                          )}
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {f.batch_title && <Chip icon={Layers}>{f.batch_title}</Chip>}
                          {f.class_date && <Chip icon={CalendarDays}>{fmtClassDate(f.class_date)}</Chip>}
                          {f.class_time && <Chip icon={Clock}>{f.class_time}</Chip>}
                        </div>
                      </div>
                    </div>
                    {f.feedback ? (
                      <blockquote className="mt-3.5 border-l-2 border-brand-gold/50 pl-3.5 text-sm leading-relaxed text-slate-600">
                        {f.feedback}
                      </blockquote>
                    ) : (
                      <p className="mt-3.5 text-sm italic text-slate-400">No written comment.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
