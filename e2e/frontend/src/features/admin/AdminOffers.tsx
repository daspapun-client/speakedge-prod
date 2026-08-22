import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, StatusBadge, fmtDate, rupees } from './_shared';

interface Offer {
  id: string;
  title: string;
  body: string;
  image_url?: string | null;
  offer_type: string;
  plan?: string | null;
  amount?: number | null;
  target_student_ids: string[];
  active: boolean;
  created_at: string;
}

const OFFER_TYPES = ['subscription_upgrade', 'discount', 'limited_time', 'festival'];

interface PlanOption { plan: string; label: string }

/** The live plan catalogue. Hardcoding it here drifted from PlanConfig — the
 *  old list still offered retired tiers and stored display labels where the
 *  rest of the app expects the plan key, so an offer never matched a plan. */
function usePlanOptions() {
  return useQuery({
    queryKey: ['plan-options'],
    queryFn: () => unwrap<PlanOption[]>(api.get('/payments/plans', { params: { all: true } })),
    staleTime: 5 * 60 * 1000,
  });
}

function OfferModal({ offer, onClose, onDone }: { offer: Offer | null; onClose: () => void; onDone: () => void }) {
  const editing = !!offer;
  const plans = usePlanOptions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    title: offer?.title ?? '',
    body: offer?.body ?? '',
    image_url: offer?.image_url ?? '',
    offer_type: offer?.offer_type ?? 'subscription_upgrade',
    plan: offer?.plan ?? '',
    amount: offer?.amount != null ? String(offer.amount / 100) : '',
    target_student_ids: offer?.target_student_ids.join(', ') ?? '',
    active: offer?.active ?? true,
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const uploadBanner = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return unwrap<{ url: string }>(api.post('/admin/offers/upload-image', fd));
    },
    onSuccess: (res) => {
      setError('');
      set('image_url', res.url);
      if (fileRef.current) fileRef.current.value = '';
    },
    onError: (e: Error) => setError(e.message),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title,
        body: form.body,
        image_url: form.image_url || null,
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
        <div className="sm:col-span-2">
          <label className="label">Promotional banner image</label>
          {form.image_url ? (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <img src={form.image_url} alt="" className="aspect-[21/9] w-full object-cover" />
              <div className="flex gap-2 border-t border-slate-100 bg-slate-50 p-2">
                <button type="button" className="btn-ghost py-1 text-xs" onClick={() => fileRef.current?.click()}>
                  Replace
                </button>
                <button type="button" className="btn-ghost py-1 text-xs text-red-600" onClick={() => set('image_url', '')}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500 transition hover:border-brand/40 hover:bg-brand/5 hover:text-brand"
              disabled={uploadBanner.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {uploadBanner.isPending ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
              {uploadBanner.isPending ? 'Uploading…' : 'Upload banner image (wide, 21:9 recommended)'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadBanner.mutate(file);
            }}
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select className="input" value={form.offer_type} onChange={(e) => set('offer_type', e.target.value)}>
            {OFFER_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Plan</label>
          <select className="input" value={form.plan} onChange={(e) => set('plan', e.target.value)}>
            <option value="">None</option>
            {(plans.data ?? []).map((p) => <option key={p.plan} value={p.plan}>{p.label}</option>)}
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
  const plans = usePlanOptions();
  const planLabel = (key?: string | null) =>
    (key && plans.data?.find((p) => p.plan === key)?.label) || key || '—';

  const { data, isLoading } = useQuery({
    queryKey: ['admin-offers'],
    queryFn: () => unwrap<Offer[]>(api.get('/admin/offers')),
  });

  const toggle = useMutation({
    mutationFn: (o: Offer) => unwrap(api.patch(`/admin/offers/${o.id}`, {
      title: o.title, body: o.body, image_url: o.image_url, offer_type: o.offer_type, plan: o.plan, amount: o.amount,
      target_student_ids: o.target_student_ids, active: !o.active,
    })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-offers'] }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-offers'] });

  const columns: Column<Offer>[] = [
    { key: 'title', header: 'Title', sort: (o) => o.title, cell: (o) => <span className="font-semibold">{o.title}</span> },
    { key: 'offer_type', header: 'Type', sort: (o) => o.offer_type, cell: (o) => <span className="capitalize">{o.offer_type.replace(/_/g, ' ')}</span> },
    { key: 'plan', header: 'Plan', sort: (o) => o.plan ?? '', cell: (o) => planLabel(o.plan) },
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
        description="Targeted offers shown as promotional banners in the student dashboard."
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
