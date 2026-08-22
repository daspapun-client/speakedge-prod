import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, PageHeader, Paginator, TableFilter, AdminStudentLink, fmtDate } from './_shared';

const MODULES = [
  'students', 'teachers', 'partners', 'payments', 'leads',
  'notifications', 'videos', 'community_profiles', 'activation_codes', 'book_orders',
];

interface Record {
  id: string;
  archived_at?: string | null;
  archived_by?: string | null;
  auto_delete_at?: string | null;
  delete_reason?: string | null;
  [k: string]: unknown;
}

function label(r: Record): string {
  return (r.full_name || r.title || r.name || r.student_id || r.code || r.order_number || r.recipient || r.id) as string;
}

export function AdminArchive() {
  const qc = useQueryClient();
  const [module, setModule] = useState('students');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-archive', module, page],
    queryFn: () => unwrap<{ items: Record[]; total: number }>(api.get(`/admin/archive/${module}`, { params: { page, page_size: pageSize } })),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-archive'] });

  const restore = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/admin/archive/${module}/${id}/restore`)),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const purge = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/admin/archive/${module}/${id}`)),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const columns: Column<Record>[] = [
    {
      key: 'record',
      header: 'Record',
      sort: (r) => label(r),
      cell: (r) =>
        module === 'students' && r.student_id ? (
          <AdminStudentLink
            studentId={r.student_id as string}
            name={r.full_name as string | undefined}
            photoUrl={r.photo_url as string | undefined}
            gender={r.gender as string | undefined}
          />
        ) : (
          <span className="font-semibold">{label(r)}</span>
        ),
    },
    { key: 'archived_at', header: 'Archived', sort: (r) => r.archived_at ?? '', cell: (r) => <span className="text-slate-500">{fmtDate(r.archived_at)}</span> },
    { key: 'archived_by', header: 'By', sort: (r) => r.archived_by ?? '', cell: (r) => <span className="font-mono text-xs">{r.archived_by || '—'}</span> },
    { key: 'delete_reason', header: 'Reason', cell: (r) => <span className="text-slate-500">{(r.delete_reason as string) || '—'}</span> },
    { key: 'auto_delete_at', header: 'Auto-delete', sort: (r) => r.auto_delete_at ?? '', cell: (r) => <span className="text-slate-500">{fmtDate(r.auto_delete_at)}</span> },
    {
      key: 'actions',
      header: '',
      cell: (r) => {
        const purgeable = r.auto_delete_at ? new Date(r.auto_delete_at) <= new Date() : false;
        return (
          <div className="flex gap-1">
            <button className="btn-ghost py-1 text-xs" onClick={() => restore.mutate(r.id)}>Restore</button>
            <button
              className="btn-ghost py-1 text-xs text-red-600 disabled:opacity-40"
              disabled={!purgeable}
              title={purgeable ? 'Permanently delete' : 'Allowed only after the 60-day retention period'}
              onClick={() => { if (window.confirm('Permanently delete this record? This cannot be undone.')) purge.mutate(r.id); }}
            >
              Delete
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader title="Archive & Restore" description="Soft-deleted records with 60-day retention. Permanent delete is Super Admin only." />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <DataTable
        rows={data?.items}
        columns={columns}
        loading={isLoading}
        rowKey={(r) => r.id}
        emptyLabel="No archived records."
        filters={
          <TableFilter
            value={module}
            onChange={(v) => { setModule(v); setPage(1); }}
            options={MODULES.map((m) => ({ value: m, label: m.replace('_', ' ') }))}
          />
        }
        externalPaginator={<Paginator page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />}
      />
    </div>
  );
}
