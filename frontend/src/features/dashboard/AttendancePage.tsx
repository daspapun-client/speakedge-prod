import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarCheck, CalendarClock, CalendarX, CheckCircle2, Clock, Loader2, XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatCard } from '@/features/admin/_shared';
import { parseApiDate } from '@/lib/datetime';

/* Attendance confirmation. A request arrives 24h before class; if it is not
 * answered within 18h the seat is released automatically. */

interface Confirmation {
  id: string;
  source: 'batch' | 'community';
  class_title: string;
  class_date: string;
  class_time?: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'expired';
  deadline_at: string;
  hours_remaining: number;
  is_expired: boolean;
  can_respond: boolean;
}
interface Payload {
  pending_count: number;
  deadline_hours: number;
  notice_hours: number;
  items: Confirmation[];
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Awaiting your response', cls: 'bg-amber-100 text-amber-700' },
  confirmed: { label: 'Attending', cls: 'bg-green-100 text-green-700' },
  declined: { label: 'Not attending', cls: 'bg-slate-100 text-slate-600' },
  expired: { label: 'Cancelled — no response', cls: 'bg-red-100 text-red-700' },
};

function classWhen(c: Confirmation) {
  const date = parseApiDate(`${c.class_date}T00:00:00`);
  const day = Number.isNaN(date.getTime())
    ? c.class_date
    : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return c.class_time ? `${day} · ${c.class_time}` : day;
}

export function AttendancePage() {
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const data = useQuery({
    queryKey: ['my-attendance'],
    queryFn: () => unwrap<Payload>(api.get('/dashboard/attendance')),
  });

  const respond = useMutation({
    mutationFn: ({ id, attending }: { id: string; attending: boolean }) =>
      unwrap(api.post(`/dashboard/attendance/${id}`, { attending })),
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['my-attendance'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const items = data.data?.items ?? [];
  const pending = items.filter((c) => c.can_respond);
  const past = items.filter((c) => !c.can_respond);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attendance"
        description={
          data.data
            ? `You'll be asked ${data.data.notice_hours} hours before each class. Confirm within ${data.data.deadline_hours} hours or your seat is released automatically.`
            : 'Confirm your attendance for upcoming classes.'
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Awaiting your response" value={pending.length} icon={Clock} accent="amber" />
        <StatCard label="Confirmed" value={items.filter((c) => c.status === 'confirmed').length} icon={CalendarCheck} accent="emerald" />
        <StatCard label="Seats released" value={items.filter((c) => c.status === 'expired').length} icon={CalendarX} accent="rose" />
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>}

      {data.isLoading ? (
        <div className="card py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" /></div>
      ) : data.isError ? (
        <div className="card py-10 text-center text-sm text-red-600">{(data.error as Error).message}</div>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-bold text-slate-700">Needs your answer</h2>
            {pending.length === 0 ? (
              <div className="card py-10 text-center">
                <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">Nothing to confirm right now.</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  We'll notify you {data.data?.notice_hours ?? 24} hours before your next class.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pending.map((c) => (
                  <div key={c.id} className="card border-l-4 border-l-amber-400">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-slate-800">{c.class_title}</p>
                        <p className="mt-0.5 text-sm text-slate-500">{classWhen(c)}</p>
                        <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                          <Clock size={12} />
                          {c.hours_remaining >= 1
                            ? `${Math.floor(c.hours_remaining)} hour${Math.floor(c.hours_remaining) === 1 ? '' : 's'} left to respond`
                            : 'Less than an hour left to respond'}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          className="btn-primary inline-flex items-center gap-1.5 text-sm"
                          disabled={respond.isPending}
                          onClick={() => respond.mutate({ id: c.id, attending: true })}
                        >
                          <CheckCircle2 size={15} /> I'll attend
                        </button>
                        <button
                          className="btn-ghost inline-flex items-center gap-1.5 text-sm"
                          disabled={respond.isPending}
                          onClick={() => {
                            if (window.confirm('Release your seat for this class?')) {
                              respond.mutate({ id: c.id, attending: false });
                            }
                          }}
                        >
                          <XCircle size={15} /> Can't make it
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-bold text-slate-700">History</h2>
            {past.length === 0 ? (
              <div className="card py-8 text-center text-sm text-slate-400">No attendance history yet.</div>
            ) : (
              <div className="card divide-y divide-slate-100 p-0">
                {past.map((c) => {
                  const meta = STATUS_META[c.status] ?? STATUS_META.declined;
                  return (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-800">{c.class_title}</p>
                        <p className="text-xs text-slate-400">
                          {classWhen(c)} · {c.source === 'batch' ? 'Teacher-led' : 'Community'}
                        </p>
                      </div>
                      <span className={`badge shrink-0 ${meta.cls}`}>{meta.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
