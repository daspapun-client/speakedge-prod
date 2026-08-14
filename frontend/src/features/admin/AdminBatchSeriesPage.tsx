import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Layers } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import {
  BatchClassesPanel,
  batchMeta,
  batchTime,
  findAdminListBatchByPrimaryId,
  isParentBatch,
  type AdminListBatch,
} from './batchSchedulePanel';

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

      <BatchClassesPanel batch={batch} layout="page" />
    </div>
  );
}
