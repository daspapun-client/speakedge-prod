import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Calendar, CheckCircle2, Clock, GraduationCap, Loader2, Star, XCircle } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { StudentAvatar } from '@/features/admin/_shared';
import { scheduleDateParts } from '@/features/batch/shared';

interface PendingReview {
  id: string;
  teacher_id?: string | null;
  teacher_name?: string | null;
  teacher_photo_url?: string | null;
  teacher_qualification?: string | null;
  teacher_cefr_level?: string | null;
  batch_id?: string | null;
  batch_title?: string | null;
  batch_name?: string | null;
  class_date?: string | null;
  class_time?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  day_of_week?: string | null;
}

function sessionTimeLabel(review: PendingReview) {
  if (review.class_time) return review.class_time;
  if (review.slot_start && review.slot_end) return `${review.slot_start}–${review.slot_end}`;
  return null;
}

/**
 * Auto review pop-up (Module 10): mandatory when there is a pending teacher
 * review inside the 7-day window. Student confirms attendance first; rating
 * only if they attended; missed classes are flagged to admin automatically.
 */
export function ReviewPopup() {
  const qc = useQueryClient();
  const [attended, setAttended] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [hoverStar, setHoverStar] = useState(0);

  const { data } = useQuery({
    queryKey: ['pending-reviews'],
    queryFn: () => unwrap<PendingReview[]>(api.get('/dashboard/pending-reviews')),
  });

  const submit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      unwrap(api.post(`/dashboard/reviews/${id}`, body)),
    onSuccess: () => {
      setAttended(null);
      setRating(0);
      setFeedback('');
      setHoverStar(0);
      qc.invalidateQueries({ queryKey: ['pending-reviews'] });
      qc.invalidateQueries({ queryKey: ['admin-attendance-feedback'] });
    },
  });

  const review = data?.[0];
  if (!review) return null;

  const batchTitle = review.batch_title || review.batch_name;
  const dateParts = review.class_date ? scheduleDateParts(review.class_date) : null;
  const timeLabel = sessionTimeLabel(review);
  const teacherMeta = [
    review.teacher_qualification,
    review.teacher_cefr_level ? `CEFR ${review.teacher_cefr_level}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const canSubmit = attended === true && rating > 0;
  const activeStar = hoverStar || rating;

  const reportMissed = () => {
    submit.mutate({ id: review.id, body: { attended: false } });
  };

  const choiceCard = (selected: boolean, tone: 'yes' | 'no') => {
    const base =
      'group relative flex flex-col items-center gap-2 rounded-2xl border-2 px-4 py-4 text-center transition-all duration-200 disabled:opacity-60';
    if (selected && tone === 'yes') {
      return `${base} border-brand bg-brand/5 shadow-[0_8px_24px_rgba(47,128,237,0.12)] ring-2 ring-brand/15`;
    }
    if (selected && tone === 'no') {
      return `${base} border-amber-400 bg-amber-50 shadow-[0_8px_24px_rgba(245,158,11,0.12)] ring-2 ring-amber-200/80`;
    }
    return `${base} border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-sm`;
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/60 bg-white shadow-2xl shadow-slate-900/10">
        <div className="bg-gradient-to-br from-brand via-brand to-brand-light px-6 py-5 text-white">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/15 backdrop-blur-sm">
              <Calendar size={20} strokeWidth={2.25} />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Did you attend your class?</h2>
              <p className="mt-0.5 text-sm text-white/75">Answer to unlock SpeakEdge</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          <div className="overflow-hidden rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand">Class session</p>
              <h3 className="mt-0.5 font-semibold tracking-tight text-slate-900">
                {batchTitle || 'Your enrolled batch'}
              </h3>
            </div>

            <div className="flex items-start gap-3 px-4 py-3">
              {dateParts ? (
                <div className="flex w-14 shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-sm ring-1 ring-slate-200/80">
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
              ) : review.day_of_week ? (
                <div className="flex w-14 shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-sm ring-1 ring-slate-200/80">
                  <div className="bg-brand px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                    Weekly
                  </div>
                  <div className="flex flex-1 items-center justify-center px-1 py-2">
                    <Calendar size={20} className="text-brand" strokeWidth={2} />
                  </div>
                </div>
              ) : null}
              <div className="min-w-0 flex-1 pt-0.5">
                {dateParts && (
                  <p className="text-sm font-semibold text-slate-900">{dateParts.fullLabel}</p>
                )}
                {!dateParts && review.day_of_week && (
                  <p className="text-sm font-semibold text-slate-900">{review.day_of_week}</p>
                )}
                {timeLabel && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600">
                    <Clock size={14} className="shrink-0 text-brand" />
                    <span className="tabular-nums">{timeLabel.replace('–', ' – ')}</span>
                  </p>
                )}
                {review.batch_id && (
                  <p
                    className="mt-1 truncate font-mono text-[11px] text-slate-400"
                    title={`Batch ID: ${review.batch_id}`}
                  >
                    Batch ID: {review.batch_id}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5 border-t border-slate-100 px-4 py-3">
              <StudentAvatar
                photoUrl={review.teacher_photo_url}
                name={review.teacher_name || 'Your teacher'}
                size="h-10 w-10"
                iconSize={18}
              />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Instructor</p>
                <div className="mt-0.5 flex items-center gap-1">
                  <p className="truncate font-semibold text-slate-900">
                    {review.teacher_name || 'Your teacher'}
                  </p>
                </div>
                {teacherMeta ? (
                  <p className="truncate text-xs text-slate-500">{teacherMeta}</p>
                ) : (
                  <p className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <GraduationCap size={12} className="text-slate-400" />
                    Your class teacher
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              className={choiceCard(attended === true, 'yes')}
              onClick={() => setAttended(true)}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                  attended === true ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-brand/10 group-hover:text-brand'
                }`}
              >
                <CheckCircle2 size={20} strokeWidth={2.25} />
              </span>
              <span className={`text-sm font-semibold ${attended === true ? 'text-brand' : 'text-slate-700'}`}>
                Yes, I attended
              </span>
            </button>

            <button
              type="button"
              className={choiceCard(attended === false, 'no')}
              disabled={submit.isPending}
              onClick={() => {
                setAttended(false);
                setRating(0);
                reportMissed();
              }}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
                  attended === false ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500 group-hover:bg-amber-50 group-hover:text-amber-600'
                }`}
              >
                {submit.isPending && attended === false ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <XCircle size={20} strokeWidth={2.25} />
                )}
              </span>
              <span className={`text-sm font-semibold ${attended === false ? 'text-amber-700' : 'text-slate-700'}`}>
                No, I missed it
              </span>
            </button>
          </div>

          {attended === true && (
            <div className="mt-5 border-t border-slate-100 pt-5 transition-all duration-300">
              <div className="rounded-xl border border-brand/10 bg-brand/[0.03] p-4">
                <p className="text-sm font-semibold text-slate-800">How was your class?</p>
                <p className="mt-0.5 text-xs text-slate-500">Tap a star to rate your experience</p>

                <div className="mt-3 flex justify-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="rounded-lg p-1 transition-transform hover:scale-110 active:scale-95"
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHoverStar(n)}
                      onMouseLeave={() => setHoverStar(0)}
                      aria-label={`${n} star`}
                    >
                      <Star
                        size={32}
                        className={`transition-colors ${
                          n <= activeStar ? 'fill-brand-gold text-brand-gold drop-shadow-sm' : 'text-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>

                <textarea
                  className="input mt-4 resize-none"
                  rows={3}
                  placeholder="Share optional feedback for your teacher…"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              </div>

              {submit.isError && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {(submit.error as Error).message}
                </p>
              )}

              <button
                type="button"
                className="btn-primary mt-4 w-full py-3"
                disabled={!canSubmit || submit.isPending}
                onClick={() => submit.mutate({ id: review.id, body: { attended: true, rating, feedback } })}
              >
                {submit.isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    Submitting…
                  </span>
                ) : (
                  'Submit review'
                )}
              </button>
            </div>
          )}

          {submit.isError && attended !== true && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {(submit.error as Error).message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
