import { useQuery } from '@tanstack/react-query';
import { Star, User } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatCard } from '@/features/admin/_shared';
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

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5 text-brand-gold">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={16}
          className={n <= rating ? 'fill-brand-gold' : 'fill-transparent opacity-30'}
        />
      ))}
    </span>
  );
}

function reviewMeta(f: Feedback) {
  return [
    f.batch_title,
    f.class_date ? fmtClassDate(f.class_date) : null,
    f.class_time,
  ].filter(Boolean).join(' · ');
}

export function TeacherReviewsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-reviews'],
    queryFn: () => unwrap<Reviews>(api.get('/teacher/my-reviews')),
  });

  return (
    <div>
      <PageHeader title="Student Reviews" description="Ratings and feedback from your students." />

      {isLoading ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <StatCard label="Average rating" value={data?.average_rating != null ? `${data.average_rating} ★` : '—'} />
            <StatCard label="Total reviews" value={data?.review_count ?? 0} />
          </div>

          <div className="mt-6 space-y-3">
            {!data?.feedback.length ? (
              <p className="text-slate-500">No feedback yet.</p>
            ) : (
              data.feedback.map((f) => (
                <div key={f.id} className="card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                        <User size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {f.student_name || f.student_id || 'Student'}
                        </p>
                        {reviewMeta(f) && (
                          <p className="mt-0.5 text-xs text-slate-400">{reviewMeta(f)}</p>
                        )}
                      </div>
                    </div>
                    {f.rating != null ? (
                      <Stars rating={f.rating} />
                    ) : (
                      <span className="text-xs text-slate-400">No rating</span>
                    )}
                  </div>
                  {f.feedback ? (
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">&ldquo;{f.feedback}&rdquo;</p>
                  ) : (
                    <p className="mt-3 text-sm italic text-slate-400">No written feedback.</p>
                  )}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
