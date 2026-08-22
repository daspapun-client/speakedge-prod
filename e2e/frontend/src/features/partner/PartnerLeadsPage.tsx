/**
 * Partner -> Lead Management: add, edit, move through the status ladder and
 * read the lead's history. The product/service interest is picked from the
 * partner's own allowed products, which is what the backend validates against.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Globe, History, Plus, UserPlus } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import {
  Column, DataTable, Modal, PageHeader, PhoneLink, RowAction, RowActions,
  StatusBadge, TableFilter, fmtDate,
} from '@/features/admin/_shared';
import {
  LEAD_STATUSES, LEAD_STATUS_LABELS, usePartnerDashboard, type PartnerLead,
} from './shared';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] })),
];

function LeadModal({ partnerId, lead, products, onClose, onDone }: {
  partnerId: string;
  lead: PartnerLead | null; // null = add
  products: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: lead?.name ?? '',
    phone: lead?.phone ?? '',
    email: lead?.email ?? '',
    interest: lead?.interest ?? '',
    location: lead?.location ?? '',
    notes: lead?.notes ?? '',
    status: lead?.status ?? 'new',
    note: '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      if (!form.name.trim() || !form.phone.trim()) throw new Error('Name and phone are required');
      const body = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        interest: form.interest || null,
        location: form.location.trim() || null,
        notes: form.notes.trim() || null,
      };
      return lead
        ? unwrap(api.patch(`/partner/leads/${lead.id}`, {
          ...body, status: form.status, note: form.note.trim() || null,
        }))
        : unwrap(api.post(`/partner/${partnerId}/leads`, body));
    },
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{lead ? 'Edit lead' : 'Add new lead'}</h2>
          {lead && (
            <p className="mt-0.5 text-sm text-slate-500">
              Added {fmtDate(lead.created_at)} · {lead.source === 'microsite' ? 'from your franchisee page' : 'added by you'}
            </p>
          )}
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
        <div>
          <label className="label">Location</label>
          <input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Product / service interest</label>
          {products.length ? (
            <select className="input" value={form.interest} onChange={(e) => set('interest', e.target.value)}>
              <option value="">Not specified</option>
              {products.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <input className="input" value={form.interest} onChange={(e) => set('interest', e.target.value)} />
          )}
        </div>
        {lead && (
          <>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">History note (optional)</label>
              <input
                className="input"
                value={form.note}
                onChange={(e) => set('note', e.target.value)}
                placeholder="Why the status changed"
              />
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>

      {!!lead?.history?.length && (
        <div className="mt-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <History size={15} className="text-brand" /> Lead history
          </h3>
          <ol className="mt-2 space-y-2 border-l-2 border-slate-100 pl-4">
            {lead.history.map((h, i) => (
              <li key={i} className="relative text-sm">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand" />
                <span className="font-medium text-slate-700">
                  {h.from ? `${LEAD_STATUS_LABELS[h.from] ?? h.from} → ` : ''}
                  {LEAD_STATUS_LABELS[h.to ?? ''] ?? h.to}
                </span>
                <span className="ml-2 text-xs text-slate-400">{fmtDate(h.at)} · {h.by}</span>
                {h.note && <p className="text-xs text-slate-500">{h.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <button className="btn-primary mt-5 w-full" disabled={save.isPending} onClick={() => save.mutate()}>
        {lead ? 'Save lead' : 'Add lead'}
      </button>
    </Modal>
  );
}

export function PartnerLeadsPage() {
  const qc = useQueryClient();
  const { data: dash } = usePartnerDashboard();
  const partnerId = dash?.id;
  const [editing, setEditing] = useState<PartnerLead | null>(null);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    enabled: !!partnerId,
    queryKey: ['partner-leads', partnerId, status],
    queryFn: () => unwrap<PartnerLead[]>(
      api.get(`/partner/${partnerId}/leads`, { params: { status: status || undefined } })),
  });

  const quickStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      unwrap(api.patch(`/partner/leads/${id}`, { status: next })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-leads'] });
      qc.invalidateQueries({ queryKey: ['partner-dashboard'] });
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['partner-leads'] });
    qc.invalidateQueries({ queryKey: ['partner-dashboard'] });
  };

  const columns: Column<PartnerLead>[] = [
    {
      key: 'name',
      header: 'Name',
      sort: (l) => l.name,
      cell: (l) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
            {l.name}
            {l.source === 'microsite' && (
              <Globe size={13} className="shrink-0 text-emerald-500" aria-label="From franchisee page" />
            )}
          </div>
          {l.location && <div className="text-xs text-slate-400">{l.location}</div>}
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', sort: (l) => l.phone, cell: (l) => <PhoneLink phone={l.phone} /> },
    { key: 'interest', header: 'Interest', sort: (l) => l.interest ?? '', cell: (l) => <span className="text-slate-500">{l.interest || '—'}</span> },
    { key: 'status', header: 'Status', sort: (l) => l.status, cell: (l) => <StatusBadge status={l.status} /> },
    { key: 'created_at', header: 'Added', sort: (l) => l.created_at, cell: (l) => <span className="text-slate-500">{fmtDate(l.created_at)}</span> },
    {
      key: 'update',
      header: 'Move to',
      cell: (l) => (
        <select
          className="input py-1 text-xs"
          value={l.status}
          disabled={quickStatus.isPending}
          onChange={(e) => quickStatus.mutate({ id: l.id, next: e.target.value })}
        >
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>)}
        </select>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (l) => (
        <RowActions>
          <RowAction icon={History} label="Edit & history" onClick={() => setEditing(l)} />
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Leads"
        description="Capture prospects, track them through to admission, and keep a record of every step."
        actions={
          <button className="btn-primary inline-flex items-center gap-1.5" disabled={!partnerId} onClick={() => setAdding(true)}>
            <Plus size={16} /> Add lead
          </button>
        }
      />

      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(l) => l.id}
        searchText={(l) => `${l.name} ${l.phone} ${l.interest ?? ''} ${l.location ?? ''}`}
        searchPlaceholder="Search leads"
        initialSort={{ key: 'created_at', dir: 'desc' }}
        emptyLabel="No leads yet."
        filters={<TableFilter value={status} onChange={setStatus} options={STATUS_OPTIONS} />}
      />

      {!data?.length && !isLoading && (
        <div className="card mt-4 py-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
            <UserPlus size={22} />
          </div>
          <p className="mt-3 font-semibold text-slate-700">Add your first lead</p>
          <p className="mt-1 text-sm text-slate-500">
            Enquiries from your franchisee page arrive here automatically too.
          </p>
        </div>
      )}

      {(adding || editing) && partnerId && (
        <LeadModal
          partnerId={partnerId}
          lead={editing}
          products={dash?.products_allowed ?? []}
          onClose={() => { setAdding(false); setEditing(null); }}
          onDone={refresh}
        />
      )}
    </div>
  );
}
