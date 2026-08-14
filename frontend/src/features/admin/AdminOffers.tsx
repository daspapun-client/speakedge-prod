import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, StatusBadge, fmtDate, rupees } from './_shared';

interface Offer {
  id: string;
  title: string;
  body: string;
  offer_type: string;
  plan?: string | null;
  amount?: number | null;
  target_student_ids: string[];
  active: boolean;
  created_at: string;
}

const OFFER_TYPES = ['subscription_upgrade', 'discount', 'limited_time', 'festival'];
const PLANS = ['', 'Tribe', 'Tribe Pro', 'Silver', 'Gold', 'Gold Crash Course', 'Diamond', 'Diamond Crash Course'];

function OfferModal({ offer, onClose, onDone }: { offer: Offer | null; onClose: () => void; onDone: () => void }) {
  const editing = !!offer;
  const [form, setForm] = useState({
    title: offer?.title ?? '',
    body: offer?.body ?? '',
    offer_type: offer?.offer_type ?? 'subscription_upgrade',
    plan: offer?.plan ?? '',
    amount: offer?.amount != null ? String(offer.amount / 100) : '',
    target_student_ids: offer?.target_student_ids.join(', ') ?? '',
    active: offer?.active ?? true,
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title,
        body: form.body,
        offer_type: form.offer_type,
        plan: form.plan || null,
        amount: form.amount ? Math.round(Number(form.amount) * 100) : null,
        target_student_ids: form.target_student_ids.split(',').map((s) => s.trim()).filter(Boolean),
        active: form.active,
      };
      return editing
        ? unwrap(api.patch(`/admin/offers/${offer!.id}`, payload))
        : unwrap(api.post('/admin/offers', payload));
    },
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{editing ? 'Edit offer' : 'New offer'}</h2>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Title</label><input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Body</label><textarea className="input" rows={3} value={form.body} onChange={(e) => set('body', e.target.value)} /></div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.offer_type} onChange={(e) => set('offer_type', e.target.value)}>
            {OFFER_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Plan</label>
          <select className="input" value={form.plan} onChange={(e) => set('plan', e.target.value)}>
            {PLANS.map((p) => <option key={p} value={p}>{p || 'None'}</option>)}
          </select>
        </div>
        <div><label className="label">Offer price (₹)</label><input className="input" type="number" min={0} value={form.amount} onChange={(e) => set('amount', e.target.value)} /></div>
        <div className="sm:col-span-2">
          <label className="label">Target student IDs (comma-separated, blank = all)</label>
          <input className="input" value={form.target_student_ids} onChange={(e) => set('target_student_ids', e.target.value)} placeholder="SPK-26-XXXX, SPK-26-YYYY" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active
        </label>
      </div>
      <div className="mt-5">
        <button className="btn-primary" disabled={!form.title || !form.body || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Save' : 'Create offer'}
        </button>
      </div>
    </Modal>
  );
}

export function AdminOffers() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Offer | null>(null);
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-offers'],
    queryFn: () => unwrap<Offer[]>(api.get('/admin/offers')),
  });

  const toggle = useMutation({
    mutationFn: (o: Offer) => unwrap(api.patch(`/admin/offers/${o.id}`, {
      title: o.title, body: o.body, offer_type: o.offer_type, plan: o.plan, amount: o.amount,
      target_student_ids: o.target_student_ids, active: !o.active,
    })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-offers'] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-offers'] });

  const columns: Column<Offer>[] = [
    { key: 'title', header: 'Title', sort: (o) => o.title, cell: (o) => <span className="font-semibold">{o.title}</span> },
    { key: 'offer_type', header: 'Type', sort: (o) => o.offer_type, cell: (o) => <span className="capitalize">{o.offer_type.replace(/_/g, ' ')}</span> },
    { key: 'plan', header: 'Plan', sort: (o) => o.plan ?? '', cell: (o) => o.plan || '—' },
    { key: 'amount', header: 'Price', align: 'right', sort: (o) => o.amount ?? -1, cell: (o) => rupees(o.amount) },
    { key: 'audience', header: 'Audience', sort: (o) => o.target_student_ids.length, cell: (o) => <span className="text-slate-500">{o.target_student_ids.length ? `${o.target_student_ids.length} students` : 'All'}</span> },
    { key: 'active', header: 'Status', sort: (o) => (o.active ? 1 : 0), cell: (o) => <StatusBadge status={o.active ? 'active' : 'inactive'} /> },
    { key: 'created_at', header: 'Created', sort: (o) => o.created_at, cell: (o) => <span className="text-slate-500">{fmtDate(o.created_at)}</span> },
    {
      key: 'actions',
      header: '',
      cell: (o) => (
        <div className="flex gap-1">
          <button className="btn-ghost py-1 text-xs" onClick={() => setEditing(o)}>Edit</button>
          <button className="btn-ghost py-1 text-xs" disabled={toggle.isPending} onClick={() => toggle.mutate(o)}>
            {o.active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Exclusive Offers"
        description="Targeted offers shown as login pop-ups in the student dashboard."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}>New offer</button>}
      />

      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(o) => o.id}
        searchText={(o) => `${o.title} ${o.offer_type} ${o.plan ?? ''}`}
        searchPlaceholder="Search offers"
        initialSort={{ key: 'created_at', dir: 'desc' }}
        emptyLabel="No offers yet."
      />

      {creating && <OfferModal offer={null} onClose={() => setCreating(false)} onDone={refresh} />}
      {editing && <OfferModal offer={editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </div>
  );
}
