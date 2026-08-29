import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, StatusBadge, rupees } from './_shared';

interface Plan {
  plan: string;
  label: string;
  amount: number; // paise — one-time admission fee (charged at checkout)
  offer_price: number | null; // paise; discounted admission (wins over amount)
  monthly_fee: number; // paise — quoted monthly fee, billed separately
  prices: Record<string, number>; // optional month → paise override
  duration_days: number;
  durations: number[]; // months offered
  classes_per_week: number; // teacher-led classes / week
  conversation_per_week: number; // conversation teams
  community_years: number;
  support_years: number; // student relation support
  total_classes: number;
  cefr_tests: number;
  speaking_tests: number;
  enabled: boolean;
}

const empty: Plan = {
  plan: '', label: '', amount: 0, offer_price: null, monthly_fee: 0, prices: {}, duration_days: 365,
  durations: [3, 6, 12], classes_per_week: 1, conversation_per_week: 0, community_years: 1,
  support_years: 0, total_classes: 0, cefr_tests: 1, speaking_tests: 1, enabled: true,
};
const ALL_DURATIONS = [3, 6, 12];
const durLabel = (m: number) => (m === 12 ? '1 year' : `${m} months`);
// prices for the plan's offered durations only (paise)
const termPrices = (p: Plan) => p.durations.map((m) => p.prices[String(m)]).filter((v): v is number => v != null);

export function AdminPlans() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Plan | null>(null); // Plan.plan === '' means "create"
  const [error, setError] = useState('');

  const plans = useQuery({
    queryKey: ['admin-plans'],
    queryFn: () => unwrap<Plan[]>(api.get('/payments/plans', { params: { all: true } })),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-plans'] });

  const save = useMutation({
    mutationFn: (p: Plan) => {
      if (!p.plan.trim() || !p.label.trim()) throw new Error('Key and label are required');
      const isNew = !plans.data?.some((x) => x.plan === p.plan);
      return isNew
        ? unwrap(api.post('/payments/plans', p))
        : unwrap(api.put(`/payments/plans/${encodeURIComponent(p.plan)}`, p));
    },
    onSuccess: () => { setEditing(null); setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const del = useMutation({
    mutationFn: (key: string) => unwrap(api.delete(`/payments/plans/${encodeURIComponent(key)}`)),
    onSuccess: refresh,
  });

  const isNew = editing !== null && !plans.data?.some((x) => x.plan === editing.plan);
  const num = (k: keyof Plan, v: string) => setEditing((e) => e && { ...e, [k]: Number(v) || 0 });

  const columns: Column<Plan>[] = [
    { key: 'label', header: 'Plan', sort: (p) => p.label, cell: (p) => <><div className="font-semibold">{p.label}</div><div className="text-xs text-slate-400">{p.plan}</div></> },
    {
      key: 'prices',
      header: 'Charged',
      align: 'right',
      sort: (p) => Math.min(...termPrices(p), Infinity),
      cell: (p) => {
        const vals = termPrices(p);
        if (!vals.length) return rupees(p.offer_price ?? p.amount);
        const lo = Math.min(...vals), hi = Math.max(...vals);
        return lo === hi ? rupees(lo) : `${rupees(lo)} – ${rupees(hi)}`;
      },
    },
    { key: 'monthly_fee', header: 'Monthly', align: 'right', sort: (p) => p.monthly_fee, cell: (p) => (p.monthly_fee > 0 ? rupees(p.monthly_fee) : '—') },
    { key: 'classes_per_week', header: 'Teacher/wk', align: 'right', sort: (p) => p.classes_per_week },
    { key: 'conversation_per_week', header: 'Conv teams', align: 'right', sort: (p) => p.conversation_per_week },
    { key: 'community_years', header: 'Community', align: 'right', sort: (p) => p.community_years, cell: (p) => `${p.community_years} yr` },
    { key: 'support_years', header: 'Support', align: 'right', sort: (p) => p.support_years, cell: (p) => (p.support_years > 0 ? `${p.support_years} yr` : '—') },
    { key: 'cefr', header: 'CEFR / Speaking', cell: (p) => `${p.cefr_tests} / ${p.speaking_tests}` },
    { key: 'enabled', header: 'Status', sort: (p) => (p.enabled ? 1 : 0), cell: (p) => <StatusBadge status={p.enabled ? 'active' : 'disabled'} /> },
    {
      key: 'actions',
      header: '',
      cell: (p) => (
        <div className="whitespace-nowrap">
          <button className="btn-ghost py-1 text-xs" onClick={() => { setError(''); setEditing({ ...p }); }}>Edit</button>
          <button className="btn-ghost py-1 text-xs text-red-600" onClick={() => { if (window.confirm(`Delete plan "${p.label}"?`)) del.mutate(p.plan); }}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Subscription Plans"
        description="Manage the plan catalogue — admission & monthly pricing, durations, teacher/conversation classes, community access and exam benefits."
        actions={<button className="btn-primary" onClick={() => { setError(''); setEditing({ ...empty }); }}>+ Add plan</button>}
      />

      <DataTable
        rows={plans.data}
        columns={columns}
        loading={plans.isLoading}
        rowKey={(p) => p.plan}
        searchText={(p) => `${p.label} ${p.plan}`}
        searchPlaceholder="Search plans"
        emptyLabel="No plans."
      />

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <h2 className="text-lg font-bold">{isNew ? 'Add plan' : `Edit ${editing.label}`}</h2>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="label">Plan key
              <input className="input" placeholder="e.g. platinum" value={editing.plan} disabled={!isNew}
                onChange={(e) => setEditing((s) => s && { ...s, plan: e.target.value })} />
            </label>
            <label className="label">Label
              <input className="input" value={editing.label} onChange={(e) => setEditing((s) => s && { ...s, label: e.target.value })} />
            </label>
            <label className="label">Admission / membership fee (₹) — charged at checkout
              <input className="input" type="number" value={editing.amount / 100}
                onChange={(e) => setEditing((s) => s && { ...s, amount: Math.round((Number(e.target.value) || 0) * 100) })} />
            </label>
            <label className="label">Monthly fee (₹) — quoted, billed separately; 0 = one-time
              <input className="input" type="number" value={editing.monthly_fee / 100}
                onChange={(e) => setEditing((s) => s && { ...s, monthly_fee: Math.round((Number(e.target.value) || 0) * 100) })} />
            </label>
            <div className="label sm:col-span-2">Durations offered (months)
              <div className="mt-1 flex gap-4">
                {ALL_DURATIONS.map((m) => (
                  <label key={m} className="flex items-center gap-1.5 text-sm font-normal text-slate-700">
                    <input type="checkbox" checked={editing.durations.includes(m)}
                      onChange={(e) => setEditing((s) => s && {
                        ...s,
                        durations: e.target.checked
                          ? [...s.durations, m].sort((a, b) => a - b)
                          : s.durations.filter((x) => x !== m),
                        // drop the price for a removed term
                        prices: e.target.checked
                          ? s.prices
                          : Object.fromEntries(Object.entries(s.prices).filter(([k]) => k !== String(m))),
                      })} />
                    {durLabel(m)}
                  </label>
                ))}
              </div>
            </div>
            <div className="label sm:col-span-2">Price per duration (₹) — optional override; blank charges the admission fee
              <div className="mt-1 grid gap-3 sm:grid-cols-3">
                {editing.durations.map((m) => (
                  <label key={m} className="text-xs font-medium text-slate-500">{durLabel(m)}
                    <input className="input mt-1" type="number"
                      value={editing.prices[String(m)] == null ? '' : editing.prices[String(m)] / 100}
                      onChange={(e) => setEditing((s) => s && {
                        ...s,
                        prices: { ...s.prices, [String(m)]: Math.round((Number(e.target.value) || 0) * 100) },
                      })} />
                  </label>
                ))}
              </div>
            </div>
            <label className="label">Teacher-led classes / week
              <input className="input" type="number" value={editing.classes_per_week} onChange={(e) => num('classes_per_week', e.target.value)} />
            </label>
            <label className="label">Conversation teams
              <input className="input" type="number" value={editing.conversation_per_week} onChange={(e) => num('conversation_per_week', e.target.value)} />
            </label>
            <label className="label">Community access (years)
              <input className="input" type="number" value={editing.community_years} onChange={(e) => num('community_years', e.target.value)} />
            </label>
            <label className="label">Student relation support (years)
              <input className="input" type="number" value={editing.support_years} onChange={(e) => num('support_years', e.target.value)} />
            </label>
            <label className="label">Total classes (optional)
              <input className="input" type="number" value={editing.total_classes} onChange={(e) => num('total_classes', e.target.value)} />
            </label>
            <label className="label">CEFR tests
              <input className="input" type="number" value={editing.cefr_tests} onChange={(e) => num('cefr_tests', e.target.value)} />
            </label>
            <label className="label">Speaking tests
              <input className="input" type="number" value={editing.speaking_tests} onChange={(e) => num('speaking_tests', e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing((s) => s && { ...s, enabled: e.target.checked })} />
              Enabled (available for purchase)
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" disabled={save.isPending} onClick={() => editing && save.mutate(editing)}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
