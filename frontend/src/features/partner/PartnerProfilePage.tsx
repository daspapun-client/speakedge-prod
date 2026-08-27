/**
 * Partner -> Profile. Contact and address details are the partner's to keep
 * current; Partner ID, type, status and allowed products stay admin-owned and
 * are shown read-only.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Globe, Lock } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatusBadge, fmtDay } from '@/features/admin/_shared';
import { usePartnerDashboard } from './shared';

function ReadOnlyRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-700">{value || '—'}</span>
    </div>
  );
}

export function PartnerProfilePage() {
  const qc = useQueryClient();
  const { data, isLoading } = usePartnerDashboard();
  const [form, setForm] = useState({
    name: '', org: '', phone: '', whatsapp: '', email: '',
    address: '', area: '', district: '', state: '', about: '',
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Seed the form once the dashboard payload lands.
  useEffect(() => {
    if (!data) return;
    setForm({
      name: data.name ?? '', org: data.org ?? '',
      phone: data.profile.phone ?? '', whatsapp: data.profile.whatsapp ?? '',
      email: data.profile.email ?? '', address: data.profile.address ?? '',
      area: data.profile.area ?? '', district: data.profile.district ?? '',
      state: data.profile.state ?? '', about: data.profile.about ?? '',
    });
  }, [data]);

  const save = useMutation({
    mutationFn: () => unwrap(api.patch('/partner/me/profile', {
      ...form,
      org: form.org || null,
      email: form.email || null,
      whatsapp: form.whatsapp || null,
    })),
    onSuccess: () => {
      setError('');
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['partner-dashboard'] });
    },
    onError: (e: Error) => { setSaved(false); setError(e.message); },
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (!data) return <p className="text-slate-500">No partner profile linked to this account.</p>;

  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };
  const locked = data.status !== 'approved';

  return (
    <div>
      <PageHeader
        title="My Profile"
        description="Keep your contact details current — they appear in the public partner directory."
        actions={<StatusBadge status={data.status} />}
      />

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="font-bold text-slate-800">Contact &amp; address</h2>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          {saved && <p className="mt-2 text-sm text-emerald-600">Profile saved.</p>}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Organisation / centre name</label>
              <input className="input" value={form.org} onChange={(e) => set('org', e.target.value)} />
            </div>
            <div>
              <label className="label">Contact person</label>
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>
            <div>
              <label className="label">WhatsApp</label>
              <input className="input" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} />
            </div>
            <div>
              <label className="label">Area</label>
              <input className="input" value={form.area} onChange={(e) => set('area', e.target.value)} />
            </div>
            <div>
              <label className="label">District</label>
              <input className="input" value={form.district} onChange={(e) => set('district', e.target.value)} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" value={form.state} onChange={(e) => set('state', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">About</label>
              <textarea className="input" rows={3} value={form.about} onChange={(e) => set('about', e.target.value)}
                placeholder="A short description shown on your directory card and franchisee page" />
            </div>
          </div>

          <button className="btn-primary mt-4" disabled={save.isPending || locked} onClick={() => save.mutate()}>
            Save profile
          </button>
          {locked && (
            <p className="mt-2 text-xs text-amber-600">
              Editing unlocks once your partner account is approved.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="card">
            <h2 className="flex items-center gap-2 font-bold text-slate-800">
              <Lock size={16} className="text-slate-400" /> Managed by admin
            </h2>
            <div className="mt-3 text-sm">
              <ReadOnlyRow label="Partner ID" value={data.partner_id || 'Pending approval'} />
              <ReadOnlyRow label="Partner type" value={data.partner_type} />
              <ReadOnlyRow label="Status" value={data.status.replace('_', ' ')} />
              <ReadOnlyRow label="Products allowed" value={data.products_allowed.join(', ')} />
              <ReadOnlyRow label="Public directory" value={data.public_visible ? 'Visible' : 'Hidden'} />
              <ReadOnlyRow label="Partner since" value={fmtDay(data.joined_at)} />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              To change any of these, contact the Sujyoti EdTech team.
            </p>
          </div>

          {data.microsite_slug && (
            <div className="card">
              <h2 className="flex items-center gap-2 font-bold text-slate-800">
                <Globe size={16} className="text-brand" /> Franchisee page
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                {data.microsite_published
                  ? 'Your page is live. Enquiries from it land in your leads automatically.'
                  : 'Your page is created but not published yet.'}
              </p>
              <a
                href={data.microsite_url ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block break-all text-sm font-semibold text-brand hover:text-brand-light"
              >
                {data.microsite_url}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
