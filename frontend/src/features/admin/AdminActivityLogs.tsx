import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, PageHeader, Paginator, fmtDate } from './_shared';

interface Log {
  id: string;
  actor?: string | null;
  role?: string | null;
  action?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  ip?: string | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
}

export function AdminActivityLogs() {
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-activity-logs', actor, action, page],
    queryFn: () =>
      unwrap<{ items: Log[]; total: number }>(
        api.get('/admin/activity-logs', { params: { actor: actor || undefined, action: action || undefined, page, page_size: pageSize } }),
      ),
  });

  const columns: Column<Log>[] = [
    { key: 'created_at', header: 'When', sort: (l) => l.created_at, cell: (l) => <span className="whitespace-nowrap text-slate-500">{fmtDate(l.created_at)}</span> },
    { key: 'actor', header: 'Actor', sort: (l) => l.actor ?? '', cell: (l) => <span className="font-mono text-xs">{l.actor || '—'}</span> },
    { key: 'role', header: 'Role', sort: (l) => l.role ?? '', cell: (l) => <span className="text-slate-500">{l.role || '—'}</span> },
    { key: 'action', header: 'Action', sort: (l) => l.action ?? '', cell: (l) => <span className="font-semibold">{l.action || '—'}</span> },
    { key: 'target', header: 'Target', cell: (l) => <span className="font-mono text-xs">{l.target_type ? `${l.target_type}:` : ''}{l.target_id || '—'}</span> },
    { key: 'details', header: 'Details', cell: (l) => <span className="text-xs text-slate-400">{l.meta && Object.keys(l.meta).length ? JSON.stringify(l.meta) : '—'}</span> },
  ];

  return (
    <div>
      <PageHeader title="Activity Logs / Audit Trail" description="Every administrative operation, for compliance & accountability." />
      <DataTable
        rows={data?.items}
        columns={columns}
        loading={isLoading}
        rowKey={(l) => l.id}
        emptyLabel="No activity logged."
        filters={
          <>
            <input className="input max-w-xs" placeholder="Filter by actor" value={actor} onChange={(e) => { setActor(e.target.value); setPage(1); }} />
            <input className="input max-w-xs" placeholder="Filter by action (e.g. user.block)" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          </>
        }
        externalPaginator={<Paginator page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />}
      />
    </div>
  );
}
