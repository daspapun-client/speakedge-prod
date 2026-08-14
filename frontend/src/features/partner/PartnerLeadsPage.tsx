import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, PhoneLink, StatusBadge, TableFilter, fmtDate } from '@/features/admin/_shared';
import { usePartnerDashboard } from './PartnerHome';

interface Lead {
  id: string;
  name: string;
  phone: string;
  interest?: string | null;
  status: string;
  notes?: string | null;
  created_at: string;
}

const LEAD_STATUSES = ['new', 'contacted', 'demo_registered', 'admission_pending', 'converted', 'lost'];

function AddLeadModal({ partnerId, onClose, onDone }: { partnerId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', interest: '', notes: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => unwrap(api.post(`/partner/${partnerId}/leads`, {
      name: form.name, phone: form.phone, interest: form.interest || null, notes: form.notes || null,
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Add lead</h2>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3">
        <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        <div><label className="label">Interest</label><input className="input" value={form.interest} onChange={(e) => set('interest', e.target.value)} /></div>
        <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
        <button className="btn-primary" disabled={!form.name || !form.phone || save.isPending} onClick={() => save.mutate()}>Add lead</button>
      </div>
    </Modal>
  );
}

export function PartnerLeadsPage() {
  const qc = useQueryClient();
  const { data: dash } = usePartnerDashboard();
  const partnerId = dash?.id;
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    enabled: !!partnerId,
    queryKey: ['partner-leads', partnerId, status],
    queryFn: () => unwrap<Lead[]>(api.get(`/partner/${partnerId}/leads`, { params: { status: status || undefined } })),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) => unwrap(api.patch(`/partner/leads/${id}`, { status: next })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['partner-leads'] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['partner-leads'] });

  const columns: Column<Lead>[] = [
    { key: 'name', header: 'Name', sort: (l) => l.name, cell: (l) => <span className="font-semibold">{l.name}</span> },
    { key: 'phone', header: 'Phone', sort: (l) => l.phone, cell: (l) => <PhoneLink phone={l.phone} /> },
    { key: 'interest', header: 'Interest', sort: (l) => l.interest ?? '', cell: (l) => <span className="text-slate-500">{l.interest || '—'}</span> },
    { key: 'status', header: 'Status', sort: (l) => l.status, cell: (l) => <StatusBadge status={l.status} /> },
    { key: 'created_at', header: 'Added', sort: (l) => l.created_at, cell: (l) => <span className="text-slate-500">{fmtDate(l.created_at)}</span> },
    {
      key: 'update',
      header: 'Update',
      cell: (l) => (
        <select
          className="input py-1 text-xs"
          value={l.status}
          disabled={updateStatus.isPending}
          onChange={(e) => updateStatus.mutate({ id: l.id, next: e.target.value })}
        >
          {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="My Leads"
        description="Capture and track prospective students."
        actions={<button className="btn-primary" disabled={!partnerId} onClick={() => setAdding(true)}>Add lead</button>}
      />

      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(l) => l.id}
        searchText={(l) => `${l.name} ${l.phone} ${l.interest ?? ''}`}
        searchPlaceholder="Search leads"
        initialSort={{ key: 'created_at', dir: 'desc' }}
        emptyLabel="No leads yet."
        filters={
          <TableFilter
            value={status}
            onChange={setStatus}
            options={[{ value: '', label: 'All statuses' }, ...LEAD_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        }
      />

      {adding && partnerId && <AddLeadModal partnerId={partnerId} onClose={() => setAdding(false)} onDone={refresh} />}
    </div>
  );
}
