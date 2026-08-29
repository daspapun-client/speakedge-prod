import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Star } from 'lucide-react';
import { api, unwrap } from '@/lib/api';

interface Pending {
  id: string;
  team_name: string;
  session_date: string;
}

const fmtSession = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

/**
 * Mandatory post-class attendance + rating popup. Opens 24h after a class the
 * student RSVP'd to; hard-blocks the whole portal (no dismiss) until answered.
 * One record at a time — reappears until the queue is empty.
 */
export function ClassAttendancePopup() {
  const qc = useQueryClient();
  const [attended, setAttended] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);

  const { data } = useQuery({
    queryKey: ['pending-attendance'],
    queryFn: () => unwrap<Pending[]>(api.get('/community/attendance/pending')),
  });

  const submit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      unwrap(api.post(`/community/attendance/${id}/respond`, body)),
    onSuccess: () => {
      setAttended(null);
      setRating(0);
      qc.invalidateQueries({ queryKey: ['pending-attendance'] });
      qc.invalidateQueries({ queryKey: ['attendance-history'] });
      qc.invalidateQueries({ queryKey: ['admin-community-attendance'] });
    },
  });

  const rec = data?.[0];
  if (!rec) return null;

  const canSubmit = attended === false || (attended === true && rating > 0);
  const doSubmit = () => {
    if (!canSubmit) return;
    submit.mutate({ id: rec.id, body: attended ? { attended: true, rating } : { attended: false } });
  };

  const pick = (on: boolean) =>
    `flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${
      on ? 'border-brand bg-brand text-white shadow-sm' : 'border-slate-200 text-slate-600 hover:border-slate-300'
    }`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-md">
        <h2 className="text-lg font-bold text-slate-800">Did you attend your class?</h2>
        <p className="mt-1 text-sm text-slate-600">
          <span className="font-semibold text-slate-800">{rec.team_name}</span> · {fmtSession(rec.session_date)}
        </p>
        <p className="mt-1 text-xs text-slate-400">Please answer to continue using SpeakEdge.</p>

        <div className="mt-4 flex gap-2">
          <button type="button" className={pick(attended === true)} onClick={() => setAttended(true)}>
            Yes, I attended
          </button>
          <button type="button" className={pick(attended === false)} onClick={() => { setAttended(false); setRating(0); }}>
            No, I missed it
          </button>
        </div>

        {attended === true && (
          <div className="mt-4">
            <p className="text-sm font-medium text-slate-700">How was it?</p>
            <div className="mt-2 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} star`}>
                  <Star size={28} className={n <= rating ? 'fill-brand-gold text-brand-gold' : 'text-slate-300'} />
                </button>
              ))}
            </div>
          </div>
        )}

        {submit.isError && <p className="mt-3 text-sm text-red-600">{(submit.error as Error).message}</p>}

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-primary" disabled={!canSubmit || submit.isPending} onClick={doSubmit}>
            {submit.isPending ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
