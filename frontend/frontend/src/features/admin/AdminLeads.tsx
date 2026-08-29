import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, EmailLink, Modal, PageHeader, Paginator, PhoneLink, StatusBadge, TableFilter, downloadExport, fmtDate } from './_shared';

interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  source: string;
  interest?: string | null;
  age?: number | null;
  demo_group?: string | null;
  education?: string | null;
  occupation?: string | null;
  demo_slot?: string | null;
  demo_date?: string | null;
  heard_from?: string | null;
  heard_from_detail?: string | null;
  consent_privacy?: boolean;
  status: string;
  feedback?: string | null;
  created_at: string;
}

const STATUSES = ['new', 'contacted', 'demo_booked', 'converted', 'lost'];

function LeadModal({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const [status, setStatus] = useState(lead.status);
  const [feedback, setFeedback] = useState(lead.feedback ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => unwrap(api.patch(`/leads/${lead.id}`, { status, feedback: feedback || null })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{lead.name}</h2>
          <p className="text-xs text-slate-400"><PhoneLink phone={lead.phone} className="text-xs" />{lead.email ? <> · <EmailLink email={lead.email} className="text-xs" /></> : ''}</p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3 text-sm">
        <div>
          <span className="text-slate-500">Age:</span> {lead.age ?? '—'}
          {lead.demo_group && (
            <span className={`badge ml-2 ${lead.demo_group === 'kids' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
              {lead.demo_group === 'kids' ? 'Kids group' : 'Adult group'}
            </span>
          )}
        </div>
        <div><span className="text-slate-500">Education:</span> {lead.education || '—'}</div>
        <div><span className="text-slate-500">Occupation:</span> {lead.occupation || '—'}</div>
        <div><span className="text-slate-500">Wants to improve:</span> {lead.interest || '—'}</div>
        <div>
          <span className="text-slate-500">Demo slot:</span> {lead.demo_slot || '—'}
          {lead.demo_date ? ` · ${fmtDate(lead.demo_date)}` : ''}
        </div>
        <div>
          <span className="text-slate-500">Knows us from:</span>{' '}
          {lead.heard_from || '—'}
          {lead.heard_from_detail ? ` — ${lead.heard_from_detail}` : ''}
        </div>
        <div><span className="text-slate-500">Source:</span> {lead.source}</div>
        <div>
          <span className="text-slate-500">Privacy consent:</span>{' '}
          {lead.consent_privacy ? 'Accepted' : 'Not recorded'}
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Feedback / notes</label>
          <textarea className="input" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>
      </div>
    </Modal>
  );
}

export function AdminLeads() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-leads', status, page],
    queryFn: () =>
      unwrap<{ items: Lead[]; total: number }>(
        api.get('/leads/', { params: { status: status || undefined, page, page_size: pageSize } }),
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/leads/${id}`)),
    onSuccess: (_d, id) => {
      setError('');
      setSelected((cur) => (cur?.id === id ? null : cur));
      setChecked((cur) => {
        const next = new Set(cur);
        next.delete(id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ['admin-leads'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const bulkRemove = useMutation({
    mutationFn: (ids: string[]) =>
      unwrap<{ deleted: number; skipped: string[] }>(api.post('/leads/bulk-delete', { ids })),
    onSuccess: (d) => {
      setError('');
      setChecked(new Set());
      qc.invalidateQueries({ queryKey: ['admin-leads'] });
      if (d.skipped.length) {
        window.alert(`Deleted ${d.deleted}. Skipped ${d.skipped.length} (not found or already deleted).`);
      }
    },
    onError: (e: Error) => setError(e.message),
  });

  // Selection only ever covers the rows on screen, so changing page or filter
  // clears it — otherwise "Delete selected" would hit leads you can't see.
  const rows = data?.items ?? [];
  const allChecked = rows.length > 0 && rows.every((l) => checked.has(l.id));
  const resetTo = (fn: () => void) => { fn(); setChecked(new Set()); };

  const toggleOne = (id: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setChecked((cur) => {
      const next = new Set(cur);
      rows.forEach((l) => (allChecked ? next.delete(l.id) : next.add(l.id)));
      return next;
    });

  const confirmBulkRemove = () => {
    const ids = [...checked];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} lead(s)? They move to the Archive and can be restored for 60 days.`)) return;
    bulkRemove.mutate(ids);
  };

  /** Exports every lead matching the current status filter (not just this page). */
  const exportLeads = (format: 'csv' | 'xlsx') =>
    downloadExport('/analytics/leads/export', { status: status || undefined, format }, `leads.${format}`)
      .then(() => setError(''))
      .catch((e: Error) => setError(e.message));

  const confirmRemove = (l: Lead) => {
    if (window.confirm(`Delete lead "${l.name}"? It moves to the Archive and can be restored for 60 days.`)) {
      remove.mutate(l.id);
    }
  };

  const columns: Column<Lead>[] = [
    {
      key: 'select',
      header: (
        <input
          type="checkbox"
          className="accent-brand"
          checked={allChecked}
          disabled={!rows.length}
          onChange={toggleAll}
          aria-label="Select all leads on this page"
        />
      ),
      width: '1%',
      className: 'w-10',
      cell: (l) => (
        <input
          type="checkbox"
          className="accent-brand"
          checked={checked.has(l.id)}
          onChange={() => toggleOne(l.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${l.name}`}
        />
      ),
    },
    { key: 'name', header: 'Name', sort: (l) => l.name, cell: (l) => <span className="font-semibold">{l.name}</span> },
    { key: 'phone', header: 'Phone', sort: (l) => l.phone, cell: (l) => <PhoneLink phone={l.phone} /> },
    { key: 'email', header: 'Email', sort: (l) => l.email ?? '', cell: (l) => <EmailLink email={l.email} /> },
    {
      key: 'demo_group',
      header: 'Group',
      sort: (l) => l.demo_group ?? '',
      cell: (l) => (l.demo_group ? (
        <span className={`badge ${l.demo_group === 'kids' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'}`}>
          {l.demo_group === 'kids' ? 'Kids' : 'Adult'}
          {l.age ? ` · ${l.age}` : ''}
        </span>
      ) : <span className="text-slate-400">—</span>),
    },
    { key: 'occupation', header: 'Occupation', sort: (l) => l.occupation ?? '', cell: (l) => <span className="text-slate-500">{l.occupation || '—'}</span> },
    {
      key: 'demo_slot',
      header: 'Demo slot',
      sort: (l) => `${l.demo_date ?? ''} ${l.demo_slot ?? ''}`,
      cell: (l) => (
        <span className="text-slate-500">
          {l.demo_slot || '—'}
          {l.demo_date && <span className="block text-xs text-slate-400">{fmtDate(l.demo_date)}</span>}
        </span>
      ),
    },
    { key: 'heard_from', header: 'Knows us from', sort: (l) => l.heard_from ?? '', cell: (l) => <span className="text-slate-500">{l.heard_from || '—'}</span> },
    { key: 'source', header: 'Source', sort: (l) => l.source, cell: (l) => <span className="text-slate-500">{l.source}</span> },
    { key: 'status', header: 'Status', sort: (l) => l.status, cell: (l) => <StatusBadge status={l.status} /> },
    { key: 'created_at', header: 'Created', sort: (l) => l.created_at, cell: (l) => <span className="text-slate-500">{fmtDate(l.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (l) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost py-1 text-xs" onClick={() => setSelected(l)}>Manage</button>
          <button
            type="button"
            className="btn-ghost inline-flex items-center gap-1.5 py-1 text-xs text-red-600"
            disabled={remove.isPending}
            onClick={() => confirmRemove(l)}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Leads & Demo Conversions"
        description="Free-demo and marketing leads."
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost inline-flex items-center gap-2" onClick={() => exportLeads('csv')}>
              <FileText size={16} /> Export CSV
            </button>
            <button className="btn-ghost inline-flex items-center gap-2" onClick={() => exportLeads('xlsx')}>
              <FileSpreadsheet size={16} /> Export Excel
            </button>
          </div>
        }
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <DataTable
        rows={data?.items}
        columns={columns}
        loading={isLoading}
        rowKey={(l) => l.id}
        emptyLabel="No leads found."
        filters={
          <TableFilter
            value={status}
            onChange={(v) => resetTo(() => { setStatus(v); setPage(1); })}
            options={[{ value: '', label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        }
        toolbarRight={
          checked.size > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600">{checked.size} selected</span>
              <button
                type="button"
                className="btn-ghost inline-flex items-center gap-1.5 py-1 text-xs text-red-600"
                disabled={bulkRemove.isPending}
                onClick={confirmBulkRemove}
              >
                <Trash2 size={14} /> {bulkRemove.isPending ? 'Deleting…' : 'Delete selected'}
              </button>
            </div>
          ) : undefined
        }
        externalPaginator={
          <Paginator page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={(p) => resetTo(() => setPage(p))} />
        }
      />

      {selected && <LeadModal lead={selected} onClose={() => setSelected(null)} onDone={() => qc.invalidateQueries({ queryKey: ['admin-leads'] })} />}
    </div>
  );
}
