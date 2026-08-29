import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Layers } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { scheduleDateParts } from '@/features/batch/shared';
import { AdminStudentLink } from './_shared';
import {
  BatchClassesPanel,
  batchMeta,
  batchTime,
  findAdminListBatchByPrimaryId,
  isParentBatch,
  type AdminListBatch,
  type BatchSession,
} from './batchSchedulePanel';

/** Join requests are filed against a child sub-batch, but admins navigate by
 *  course — so decide them here, from the one page they actually open. */
function JoinRequestsPanel({ sessions }: { sessions: BatchSession[] }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ batchId, studentId, decision }: { batchId: string; studentId: string; decision: 'approve' | 'reject' }) =>
      unwrap(api.post(`/teacher/batches/${batchId}/${decision}-join`, { student_id: studentId })),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['admin-batches'] });
    },
    onError: (e: any) => setError(e?.response?.data?.message ?? 'Could not update the request.'),
  });

  // One request now covers a whole cycle of sittings, so the same student is
  // pending on several sessions. Decide it once, from the earliest — the
  // backend applies that decision across every session it was filed against.
  const byStudent = new Map<string, { session: BatchSession; student: NonNullable<BatchSession['pending']>[number]; dates: string[] }>();
  for (const s of [...sessions].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
    for (const p of s.pending ?? []) {
      const row = byStudent.get(p.student_id);
      if (row) row.dates.push(s.date);
      else byStudent.set(p.student_id, { session: s, student: p, dates: [s.date] });
    }
  }
  const rows = [...byStudent.values()];
  if (!rows.length) return null;

  return (
    <div className="card">
      <h2 className="text-lg font-bold text-slate-900">Pending join requests ({rows.length})</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Only an admin can approve a teacher-led class request. One decision covers the whole cycle the
        student asked for — they do not request again each week.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 space-y-2">
        {rows.map(({ session, student, dates }) => (
          <div
            key={`${session.batch_id}:${student.student_id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50/40 px-3 py-2"
          >
            <div className="min-w-0">
              <AdminStudentLink studentId={student.student_id} name={student.name} photoUrl={student.photo_url} gender={student.gender} />
              <p className="mt-0.5 text-[11px] text-slate-500">
                {dates.length > 1
                  ? `${dates.length} consecutive classes from ${scheduleDateParts(dates[0])?.fullLabel ?? dates[0]}`
                  : `Class on ${scheduleDateParts(session.date)?.fullLabel ?? session.date}`}
              </p>
            </div>
            <span className="flex flex-wrap items-center gap-2">
              <Link to={`/admin/batches/${session.batch_id}`} className="text-xs text-brand hover:underline">Open class</Link>
              <button
                type="button"
                className="btn-ghost py-1 text-xs text-green-600"
                disabled={act.isPending}
                onClick={() => act.mutate({ batchId: session.batch_id, studentId: student.student_id, decision: 'approve' })}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn-ghost py-1 text-xs text-red-600"
                disabled={act.isPending}
                onClick={() => act.mutate({ batchId: session.batch_id, studentId: student.student_id, decision: 'reject' })}
              >
                Reject
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminBatchSeriesPage() {
  const { batchId = '' } = useParams();
  const navigate = useNavigate();

  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/admin/batches');
  };

  const { data: listBatches, isLoading } = useQuery({
    queryKey: ['admin-batches'],
    queryFn: () => unwrap<AdminListBatch[]>(api.get('/teacher/admin/batches')),
    refetchOnMount: 'always',
  });

  const batch = findAdminListBatchByPrimaryId(listBatches ?? [], batchId);
  const meta = batch ? batchMeta(batch) : null;
  const time = batch ? batchTime(batch) : null;

  if (isLoading) {
    return (
      <div className="card">
        <p className="text-slate-500">Loading batch series…</p>
      </div>
    );
  }

  if (!batch || !meta || !isParentBatch(batch)) {
    return (
      <div className="card space-y-4">
        <p className="text-slate-500">Batch series not found.</p>
        <button type="button" onClick={goBack} className="btn-ghost inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to batches
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button type="button" onClick={goBack} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back to batches
      </button>

      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand">Batch series</p>
            <h1 className="mt-1 text-2xl font-extrabold text-slate-900">{batch.title}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {meta.total} classes
              {time ? ` · ${time}` : ''}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Select a class below to manage members, attendance, meeting link, and pay.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand">
            <Layers size={14} />
            Parent batch
          </span>
        </div>
      </div>

      <JoinRequestsPanel sessions={meta.sessions} />

      <BatchClassesPanel batch={batch} layout="page" />
    </div>
  );
}
