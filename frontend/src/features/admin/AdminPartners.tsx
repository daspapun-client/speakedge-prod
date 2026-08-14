import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, EmailLink, Modal, PageHeader, Paginator, PhoneLink, StatusBadge, TableFilter, fmtDate } from './_shared';

interface Partner {
  id: string;
  partner_id?: string | null;
  partner_type: string;
  name: string;
  org?: string | null;
  phone: string;
  email?: string | null;
  state?: string | null;
  district?: string | null;
  area?: string | null;
  status: string;
  public_visible?: boolean;
  products_allowed?: string[];
  remarks?: string | null;
  created_at: string;
}

interface Report {
  id: string;
  partner_id: string;
  partner_name?: string | null;
  report_type: string;
  product?: string | null;
  quantity: number;
  amount?: number | null;
  status: string;
  created_at: string;
}

const STATUSES = ['pending', 'under_review', 'approved', 'rejected', 'on_hold', 'suspended'];

function PartnerModal({ partner, onClose, onDone }: { partner: Partner; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('');
  const [remarks, setRemarks] = useState(partner.remarks ?? '');
  const [products, setProducts] = useState((partner.products_allowed ?? []).join(', '));
  const [visible, setVisible] = useState(!!partner.public_visible);
  const [username, setUsername] = useState('');

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      unwrap(api.post(`/partner/${partner.id}/status`, {
        status,
        remarks,
        public_visible: visible,
        username: username || undefined,
        products_allowed: products.split(',').map((s) => s.trim()).filter(Boolean),
      })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{partner.name}</h2>
          <p className="text-sm text-slate-500">{partner.org || partner.partner_type}</p>
          <p className="font-mono text-xs text-slate-400">{partner.partner_id || 'No Partner ID yet'}</p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-400">Type</dt><dd>{partner.partner_type}</dd></div>
        <div><dt className="text-slate-400">Phone</dt><dd><PhoneLink phone={partner.phone} /></dd></div>
        <div><dt className="text-slate-400">Email</dt><dd><EmailLink email={partner.email} /></dd></div>
        <div><dt className="text-slate-400">Location</dt><dd>{[partner.area, partner.district, partner.state].filter(Boolean).join(', ') || '—'}</dd></div>
      </dl>
      <div className="mt-4 grid gap-3">
        <div>
          <label className="label">Products / services allowed (comma separated)</label>
          <input className="input" value={products} onChange={(e) => setProducts(e.target.value)} />
        </div>
        <div>
          <label className="label">Link partner login (username)</label>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Optional dashboard account" />
        </div>
        <div>
          <label className="label">Remarks</label>
          <input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> Visible in public directory
        </label>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={`btn-ghost py-1 text-xs ${s === 'approved' ? 'text-green-700' : s === 'rejected' || s === 'suspended' ? 'text-red-600' : ''}`}
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate(s)}
          >
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function AdminPartners() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'applications' | 'reports'>('applications');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Partner | null>(null);
  const pageSize = 25;

  const apps = useQuery({
    queryKey: ['admin-partners', status, q, page],
    queryFn: () =>
      unwrap<{ items: Partner[]; total: number }>(
        api.get('/partner/applications', { params: { status: status || undefined, q: q || undefined, page, page_size: pageSize } }),
      ),
    enabled: tab === 'applications',
  });

  const reports = useQuery({
    queryKey: ['admin-partner-reports'],
    queryFn: () => unwrap<Report[]>(api.get('/partner/admin/reports')),
    enabled: tab === 'reports',
  });

  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      unwrap(api.post(`/partner/reports/${id}/review`, { action })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partner-reports'] }),
  });

  const appColumns: Column<Partner>[] = [
    {
      key: 'name',
      header: 'Partner',
      sort: (p) => p.name,
      cell: (p) => (
        <><div className="font-semibold">{p.name}</div><div className="text-xs text-slate-400">{p.org || '—'}</div></>
      ),
    },
    { key: 'partner_type', header: 'Type', sort: (p) => p.partner_type, cell: (p) => <span className="text-slate-500">{p.partner_type}</span> },
    { key: 'location', header: 'Location', sort: (p) => [p.district, p.state].filter(Boolean).join(', '), cell: (p) => <span className="text-slate-500">{[p.district, p.state].filter(Boolean).join(', ') || '—'}</span> },
    { key: 'status', header: 'Status', sort: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
    { key: 'created_at', header: 'Applied', sort: (p) => p.created_at, cell: (p) => <span className="text-slate-500">{fmtDate(p.created_at)}</span> },
    { key: 'actions', header: '', width: '1%', cell: (p) => <button className="btn-ghost py-1 text-xs" onClick={() => setSelected(p)}>Manage</button> },
  ];

  const reportColumns: Column<Report>[] = [
    { key: 'partner', header: 'Partner', sort: (r) => r.partner_name || r.partner_id, cell: (r) => <span className="font-semibold">{r.partner_name || r.partner_id}</span> },
    { key: 'report_type', header: 'Type', sort: (r) => r.report_type, cell: (r) => <span className="text-slate-500">{r.report_type}</span> },
    { key: 'product', header: 'Product', sort: (r) => r.product ?? '', cell: (r) => r.product || '—' },
    { key: 'quantity', header: 'Qty', align: 'right', sort: (r) => r.quantity },
    { key: 'status', header: 'Status', sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      cell: (r) =>
        r.status === 'pending' ? (
          <div className="flex gap-1">
            <button className="btn-ghost py-1 text-xs text-green-700" onClick={() => review.mutate({ id: r.id, action: 'approve' })}>Approve</button>
            <button className="btn-ghost py-1 text-xs text-red-600" onClick={() => review.mutate({ id: r.id, action: 'reject' })}>Reject</button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader title="Partner Management" description="Applications, approvals, directory & sales reports." />
      <div className="mt-4 flex gap-2">
        <button className={`btn-ghost py-1 text-xs ${tab === 'applications' ? 'bg-slate-100' : ''}`} onClick={() => setTab('applications')}>Applications</button>
        <button className={`btn-ghost py-1 text-xs ${tab === 'reports' ? 'bg-slate-100' : ''}`} onClick={() => setTab('reports')}>Sales Reports</button>
      </div>

      {tab === 'applications' ? (
        <DataTable
          rows={apps.data?.items}
          columns={appColumns}
          loading={apps.isLoading}
          rowKey={(p) => p.id}
          emptyLabel="No partner applications found."
          filters={
            <>
              <TableFilter
                value={status}
                onChange={(v) => { setStatus(v); setPage(1); }}
                options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))]}
              />
              <input className="input max-w-sm" placeholder="Search name / org / phone" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </>
          }
          externalPaginator={<Paginator page={page} pageSize={pageSize} total={apps.data?.total ?? 0} onPage={setPage} />}
        />
      ) : (
        <DataTable
          rows={reports.data}
          columns={reportColumns}
          loading={reports.isLoading}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.partner_name ?? ''} ${r.partner_id} ${r.product ?? ''}`}
          searchPlaceholder="Search partner / product"
          emptyLabel="No reports."
        />
      )}

      {selected && (
        <PartnerModal partner={selected} onClose={() => setSelected(null)} onDone={() => apps.refetch()} />
      )}
    </div>
  );
}
