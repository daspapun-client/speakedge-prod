import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, GraduationCap, PlayCircle, Video } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatusBadge, StudentAvatar, fmtDate } from '@/features/admin/_shared';

interface RosterRow {
  student_id: string;
  full_name?: string | null;
  photo_url?: string | null;
  gender?: string | null;
  orientation_status: string;
}

interface Session {
  id: string;
  title: string;
  mode: 'live' | 'recorded';
  scheduled_at?: string | null;
  duration_min: number;
  meeting_url?: string | null;
  status: string;
  student_count: number;
  completed_count: number;
  roster?: RosterRow[];
}

function SessionCard({ session }: { session: Session }) {
  const qc = useQueryClient();
  const complete = useMutation({
    mutationFn: (ids: string[]) => unwrap(api.post(`/orientation/teacher/batches/${session.id}/complete`, { student_ids: ids })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teacher-orientation'] }),
  });
  const pending = (session.roster ?? []).some((r) => r.orientation_status !== 'completed');

  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${session.mode === 'live' ? 'bg-brand/10 text-brand' : 'bg-violet-100 text-violet-600'}`}>
            {session.mode === 'live' ? <Video size={18} /> : <PlayCircle size={18} />}
          </span>
          <div>
            <p className="font-bold text-slate-900">{session.title}</p>
            <p className="text-xs text-slate-500">
              {session.mode === 'live' && session.scheduled_at ? `${fmtDate(session.scheduled_at)} · ` : ''}
              {session.duration_min} min · {session.completed_count}/{session.student_count} complete
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={session.status} />
          {session.mode === 'live' && session.meeting_url && (
            <a href={session.meeting_url} target="_blank" rel="noreferrer" className="btn-primary py-1.5 text-xs">Join</a>
          )}
        </div>
      </div>

      {session.roster?.length ? (
        <>
          <div className="mt-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Students</h3>
            {pending && (
              <button className="btn-ghost py-1 text-xs" disabled={complete.isPending} onClick={() => complete.mutate([])}>
                Mark all complete
              </button>
            )}
          </div>
          <ul className="mt-2 divide-y divide-slate-100">
            {session.roster.map((r) => (
              <li key={r.student_id} className="flex items-center gap-2 py-2 text-sm">
                <StudentAvatar photoUrl={r.photo_url} gender={r.gender} name={r.full_name ?? r.student_id} size="h-7 w-7" iconSize={14} />
                <span className="min-w-0 flex-1 truncate">{r.full_name ?? r.student_id}</span>
                <StatusBadge status={r.orientation_status} />
                {r.orientation_status !== 'completed' && (
                  <button className="btn-ghost py-1 text-xs" disabled={complete.isPending} onClick={() => complete.mutate([r.student_id])}>
                    <CheckCircle2 size={14} /> Complete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-400">No students enrolled yet.</p>
      )}
    </div>
  );
}

export function TeacherOrientationPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['teacher-orientation'],
    queryFn: () => unwrap<Session[]>(api.get('/orientation/teacher/batches')),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Orientation" description="Conduct your assigned new-student orientation sessions and mark students complete." />
      {isLoading ? (
        <div className="animate-pulse space-y-4"><div className="h-40 rounded-xl bg-slate-200" /></div>
      ) : data?.length ? (
        <div className="space-y-4">
          {data.map((s) => <SessionCard key={s.id} session={s} />)}
        </div>
      ) : (
        <div className="card flex flex-col items-center py-10 text-center">
          <div className="rounded-2xl bg-slate-100 p-3 text-slate-400"><GraduationCap size={28} /></div>
          <p className="mt-3 text-sm text-slate-500">No orientation sessions assigned to you yet.</p>
        </div>
      )}
    </div>
  );
}
