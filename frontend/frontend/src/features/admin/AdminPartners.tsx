/**
 * Admin -> Partner Management (CR Part F).
 *
 *   Applications  — review, approve/reject, assign Partner ID / type / products
 *   Directory     — add, edit, hide, archive, control public + product visibility
 *   Microsites    — create, edit, photos, publish/unpublish franchisee pages
 *   Reports       — approve partner-submitted sales before they count
 *   Overview      — network performance + Excel/CSV/PDF exports
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  Building2, Download, ExternalLink, Eye, EyeOff, Globe, ImagePlus,
  Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import {
  Column, DataTable, EmailLink, Modal, PageHeader, Paginator, PhoneLink, RowAction,
  RowActionDivider, RowActions, StatCard, StatusBadge, TableFilter, downloadExport,
  fmtDate, rupees,
} from './_shared';
import {
  EXPORT_FORMATS, FRANCHISEE_TYPE, PARTNER_STATUSES, PARTNER_TYPES, REPORT_TYPE_LABELS,
  periodLabel, type ExportFormat, type PartnerLead, type PartnerReport, type Performance,
} from '@/features/partner/shared';

interface Partner {
  id: string;
  partner_id?: string | null;
  partner_type: string;
  name: string;
  org?: string | null;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  about?: string | null;
  state?: string | null;
  district?: string | null;
  area?: string | null;
  status: string;
  public_visible?: boolean;
  products_allowed?: string[];
  public_products?: string[];
  remarks?: string | null;
  microsite_slug?: string | null;
  microsite_published?: boolean;
  map_embed_url?: string | null;
  logo_url?: string | null;
  gallery?: string[];
  total_leads?: number;
  pending_reports?: number;
  approved_reports?: number;
  created_at: string;
}

type Tab = 'applications' | 'microsites' | 'reports' | 'leads' | 'overview';

const TABS: { key: Tab; label: string }[] = [
  { key: 'applications', label: 'Partners & applications' },
  { key: 'microsites', label: 'Franchisee microsites' },
  { key: 'reports', label: 'Sales reports' },
  { key: 'leads', label: 'Partner leads' },
  { key: 'overview', label: 'Overview & exports' },
];

const csvList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/* ------------------------------------------------------------------ *
 *  Approve / edit a partner                                            *
 * ------------------------------------------------------------------ */
function PartnerModal({ partner, onClose, onDone }: {
  partner: Partner; onClose: () => void; onDone: () => void;
}) {
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'review' | 'details' | 'performance'>('review');
  const [form, setForm] = useState({
    remarks: partner.remarks ?? '',
    products: (partner.products_allowed ?? []).join(', '),
    publicProducts: (partner.public_products ?? []).join(', '),
    visible: !!partner.public_visible,
    username: '',
    partnerId: partner.partner_id ?? '',
    partnerType: partner.partner_type,
  });
  const [details, setDetails] = useState({
    name: partner.name, org: partner.org ?? '', phone: partner.phone,
    whatsapp: partner.whatsapp ?? '', email: partner.email ?? '',
    address: partner.address ?? '', area: partner.area ?? '',
    district: partner.district ?? '', state: partner.state ?? '',
    about: partner.about ?? '',
  });
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);

  const performance = useQuery({
    enabled: tab === 'performance',
    queryKey: ['admin-partner-performance', partner.id],
    queryFn: () => unwrap<Performance>(api.get(`/partner/${partner.id}/performance`)),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) =>
      unwrap<{ credentials?: { username: string; password: string } }>(
        api.post(`/partner/${partner.id}/status`, {
          status,
          remarks: form.remarks,
          public_visible: form.visible,
          username: form.username || undefined,
          partner_id: form.partnerId || undefined,
          partner_type: form.partnerType,
          products_allowed: csvList(form.products),
        })),
    // A first-time approval mints the partner's dashboard login. The password is
    // shown once and never retrievable again, so keep the modal open for it.
    onSuccess: (d) => {
      setError('');
      onDone();
      if (d?.credentials) setCredentials(d.credentials);
      else onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const saveDetails = useMutation({
    mutationFn: () => unwrap(api.patch(`/partner/${partner.id}`, {
      ...details,
      org: details.org || null,
      email: details.email || null,
      public_products: csvList(form.publicProducts),
      public_visible: form.visible,
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  const set = (k: keyof typeof details, v: string) => setDetails((d) => ({ ...d, [k]: v }));

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">{partner.org || partner.name}</h2>
          <p className="text-sm text-slate-500">{partner.partner_type}</p>
          <p className="font-mono text-xs text-slate-400">{partner.partner_id || 'No Partner ID yet'}</p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {credentials && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-semibold text-green-800">Partner dashboard login created</p>
          <p className="mt-1 text-green-900">
            Username <span className="font-mono font-semibold">{credentials.username}</span> · Password{' '}
            <span className="font-mono font-semibold">{credentials.password}</span>
          </p>
          <p className="mt-1 text-xs text-green-700">
            Copy this now — the password is not shown again. Share it with the partner and ask them to change it after signing in.
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {(['review', 'details', 'performance'] as const).map((t) => (
          <button key={t} className={`btn-ghost py-1 text-xs capitalize ${tab === t ? 'bg-slate-100' : ''}`}
            onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'review' && (
        <>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-400">Contact person</dt><dd>{partner.name}</dd></div>
            <div><dt className="text-slate-400">Phone</dt><dd><PhoneLink phone={partner.phone} /></dd></div>
            <div><dt className="text-slate-400">Email</dt><dd><EmailLink email={partner.email} /></dd></div>
            <div><dt className="text-slate-400">Location</dt><dd>{[partner.area, partner.district, partner.state].filter(Boolean).join(', ') || '—'}</dd></div>
            <div><dt className="text-slate-400">Applied</dt><dd>{fmtDate(partner.created_at)}</dd></div>
            <div><dt className="text-slate-400">Leads / approved reports</dt><dd>{partner.total_leads ?? 0} / {partner.approved_reports ?? 0}</dd></div>
          </dl>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Partner ID</label>
              <input className="input" value={form.partnerId} placeholder="Auto-assigned on approval"
                onChange={(e) => setForm({ ...form, partnerId: e.target.value })} />
            </div>
            <div>
              <label className="label">Partner type</label>
              <select className="input" value={form.partnerType}
                onChange={(e) => setForm({ ...form, partnerType: e.target.value })}>
                {PARTNER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Products / services allowed (comma separated)</label>
              <input className="input" value={form.products}
                onChange={(e) => setForm({ ...form, products: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Link partner login (username)</label>
              <input className="input" value={form.username} placeholder="Optional — generated on approval"
                onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Remarks (shown to the partner)</label>
              <input className="input" value={form.remarks}
                onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.visible}
                onChange={(e) => setForm({ ...form, visible: e.target.checked })} />
              Visible in public directory
            </label>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {PARTNER_STATUSES.map((s) => (
              <button
                key={s}
                className={`btn-ghost py-1 text-xs ${s === 'approved' ? 'text-green-700' : s === 'rejected' || s === 'suspended' ? 'text-red-600' : ''} ${partner.status === s ? 'bg-slate-100' : ''}`}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate(s)}
              >
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'details' && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div><label className="label">Organisation</label><input className="input" value={details.org} onChange={(e) => set('org', e.target.value)} /></div>
            <div><label className="label">Contact person</label><input className="input" value={details.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label className="label">Phone</label><input className="input" value={details.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div><label className="label">WhatsApp</label><input className="input" value={details.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">Email</label><input className="input" type="email" value={details.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">Address</label><input className="input" value={details.address} onChange={(e) => set('address', e.target.value)} /></div>
            <div><label className="label">Area</label><input className="input" value={details.area} onChange={(e) => set('area', e.target.value)} /></div>
            <div><label className="label">District</label><input className="input" value={details.district} onChange={(e) => set('district', e.target.value)} /></div>
            <div><label className="label">State</label><input className="input" value={details.state} onChange={(e) => set('state', e.target.value)} /></div>
            <div className="sm:col-span-2"><label className="label">About</label><textarea className="input" rows={3} value={details.about} onChange={(e) => set('about', e.target.value)} /></div>
            <div className="sm:col-span-2">
              <label className="label">Products shown publicly (comma separated)</label>
              <input className="input" value={form.publicProducts} placeholder="Blank = all allowed products"
                onChange={(e) => setForm({ ...form, publicProducts: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.visible}
                onChange={(e) => setForm({ ...form, visible: e.target.checked })} />
              Visible in public directory
            </label>
          </div>
          <button className="btn-primary mt-4 w-full" disabled={saveDetails.isPending} onClick={() => saveDetails.mutate()}>
            Save partner details
          </button>
        </>
      )}

      {tab === 'performance' && (
        <div className="mt-4 space-y-4">
          {performance.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !performance.data ? (
            <p className="text-sm text-slate-500">No performance data.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Leads" value={performance.data.totals.total_leads} />
                <StatCard label="Admissions" value={performance.data.totals.total_admissions} />
                <StatCard label="Book sales" value={performance.data.totals.total_book_sales} />
                <StatCard label="Revenue" value={rupees(performance.data.totals.revenue_paise)} />
              </div>
              {!!performance.data.by_product.length && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                      <th className="pb-2">Product</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.data.by_product.map((p) => (
                      <tr key={p.product} className="border-t border-slate-100">
                        <td className="py-2">{p.product}</td>
                        <td className="py-2 text-right font-semibold">{p.quantity}</td>
                        <td className="py-2 text-right text-slate-500">{rupees(p.revenue_paise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="flex flex-wrap gap-1">
                {EXPORT_FORMATS.map((f) => (
                  <button key={f} className="btn-ghost py-1 text-xs uppercase"
                    onClick={() => downloadExport(`/partner/${partner.id}/export`,
                      { dataset: 'monthly', format: f }, `partner_monthly.${f}`)}>
                    <Download size={13} /> {f}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 *  Add a partner straight to the directory                             *
 * ------------------------------------------------------------------ */
function AddPartnerModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    partner_type: 'Individual Partner', name: '', org: '', phone: '', whatsapp: '',
    email: '', state: '', district: '', area: '', address: '', products: '',
    public_visible: true, approve: true,
  });
  const [error, setError] = useState('');
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => {
      if (!form.name.trim() || !form.phone.trim()) throw new Error('Name and phone are required');
      return unwrap<{ credentials?: { username: string; password: string } }>(
        api.post('/partner/admin/create', {
          partner_type: form.partner_type,
          name: form.name.trim(),
          org: form.org.trim() || null,
          phone: form.phone.trim(),
          whatsapp: form.whatsapp.trim() || null,
          email: form.email.trim() || null,
          state: form.state.trim() || null,
          district: form.district.trim() || null,
          area: form.area.trim() || null,
          address: form.address.trim() || null,
          products_allowed: csvList(form.products),
          public_visible: form.public_visible,
          approve: form.approve,
        }));
    },
    onSuccess: (d) => {
      setError('');
      onDone();
      if (d?.credentials) setCredentials(d.credentials);
      else onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Add partner</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            For partners onboarded outside the public application form.
          </p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {credentials && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-semibold text-green-800">Dashboard login created</p>
          <p className="mt-1 font-mono text-green-900">{credentials.username} · {credentials.password}</p>
          <p className="mt-1 text-xs text-green-700">Copy this now — the password is not shown again.</p>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Partner type</label>
          <select className="input" value={form.partner_type} onChange={(e) => set('partner_type', e.target.value)}>
            {PARTNER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div><label className="label">Organisation</label><input className="input" value={form.org} onChange={(e) => set('org', e.target.value)} /></div>
        <div><label className="label">Contact person</label><input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        <div><label className="label">WhatsApp</label><input className="input" value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => set('address', e.target.value)} /></div>
        <div><label className="label">Area</label><input className="input" value={form.area} onChange={(e) => set('area', e.target.value)} /></div>
        <div><label className="label">District</label><input className="input" value={form.district} onChange={(e) => set('district', e.target.value)} /></div>
        <div><label className="label">State</label><input className="input" value={form.state} onChange={(e) => set('state', e.target.value)} /></div>
        <div className="sm:col-span-2">
          <label className="label">Products / services allowed (comma separated)</label>
          <input className="input" value={form.products} onChange={(e) => set('products', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.public_visible} onChange={(e) => set('public_visible', e.target.checked)} />
          Show in public directory
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.approve} onChange={(e) => set('approve', e.target.checked)} />
          Approve immediately (creates a dashboard login)
        </label>
      </div>

      <button className="btn-primary mt-4 w-full" disabled={save.isPending} onClick={() => save.mutate()}>
        Add partner
      </button>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 *  Franchisee microsite editor                                         *
 * ------------------------------------------------------------------ */
function MicrositeModal({ partner, onClose, onDone }: {
  partner: Partner; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState({
    slug: partner.microsite_slug ?? '',
    about: partner.about ?? '',
    address: partner.address ?? '',
    phone: partner.phone ?? '',
    whatsapp: partner.whatsapp ?? '',
    email: partner.email ?? '',
    map_embed_url: partner.map_embed_url ?? '',
    public_products: (partner.public_products ?? []).join(', '),
  });
  const [gallery, setGallery] = useState<string[]>(partner.gallery ?? []);
  const [logo, setLogo] = useState<string | null>(partner.logo_url ?? null);
  const [published, setPublished] = useState(!!partner.microsite_published);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: () => unwrap<Partner>(api.patch(`/partner/${partner.id}/microsite`, {
      slug: form.slug || null,
      about: form.about || null,
      address: form.address || null,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
      email: form.email || null,
      map_embed_url: form.map_embed_url || null,
      public_products: csvList(form.public_products),
      published,
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  const upload = useMutation({
    mutationFn: async ({ file, isLogo }: { file: File; isLogo: boolean }) => {
      const fd = new FormData();
      fd.append('file', file);
      return unwrap<{ gallery: string[]; logo_url?: string | null }>(
        api.post(`/partner/${partner.id}/microsite/photos?logo=${isLogo}`, fd));
    },
    onSuccess: (d) => { setGallery(d.gallery); setLogo(d.logo_url ?? null); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  const removePhoto = useMutation({
    mutationFn: (url: string) => unwrap<{ gallery: string[]; logo_url?: string | null }>(
      api.delete(`/partner/${partner.id}/microsite/photos`, { params: { url } })),
    onSuccess: (d) => { setGallery(d.gallery); setLogo(d.logo_url ?? null); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Franchisee page — {partner.org || partner.name}</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {form.slug ? `sujyotiedtech.com/franchisee/${form.slug}` : 'A URL is generated when you save'}
          </p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Page URL slug</label>
          <input className="input" value={form.slug} placeholder="madhyamgram"
            onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">About the franchisee</label>
          <textarea className="input" rows={4} value={form.about}
            onChange={(e) => setForm({ ...form, about: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Address</label>
          <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </div>
        <div><label className="label">Contact number</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div><label className="label">WhatsApp number</label><input className="input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
        <div className="sm:col-span-2">
          <label className="label">Courses / products offered (comma separated)</label>
          <input className="input" value={form.public_products}
            placeholder="Blank = all allowed products"
            onChange={(e) => setForm({ ...form, public_products: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Google Map embed URL</label>
          <input className="input" value={form.map_embed_url}
            placeholder="https://www.google.com/maps/embed?pb=…"
            onChange={(e) => setForm({ ...form, map_embed_url: e.target.value })} />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="label mb-0">Photos &amp; logo</label>
          <div className="flex gap-1">
            <button className="btn-ghost py-1 text-xs" onClick={() => logoRef.current?.click()}>
              <ImagePlus size={13} /> Logo
            </button>
            <button className="btn-ghost py-1 text-xs" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={13} /> Add photo
            </button>
          </div>
        </div>
        <input ref={logoRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ file: f, isLogo: true }); e.target.value = ''; }} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ file: f, isLogo: false }); e.target.value = ''; }} />

        <div className="mt-2 flex flex-wrap gap-2">
          {logo && (
            <div className="relative">
              <img src={logo} alt="Logo" className="h-20 w-20 rounded-lg border border-slate-200 object-contain p-1" />
              <span className="absolute left-1 top-1 rounded bg-brand px-1 text-[10px] font-semibold text-white">LOGO</span>
              <button className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-0.5 text-white"
                onClick={() => removePhoto.mutate(logo)} aria-label="Remove logo">
                <X size={12} />
              </button>
            </div>
          )}
          {gallery.map((url) => (
            <div key={url} className="relative">
              <img src={url} alt="" className="h-20 w-28 rounded-lg object-cover" />
              <button className="absolute -right-1.5 -top-1.5 rounded-full bg-red-500 p-0.5 text-white"
                onClick={() => removePhoto.mutate(url)} aria-label="Remove photo">
                <X size={12} />
              </button>
            </div>
          ))}
          {!gallery.length && !logo && (
            <p className="text-sm text-slate-400">No photos yet.</p>
          )}
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
        Publish this page — unpublished pages (and their enquiry form) are not reachable
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-primary flex-1" disabled={save.isPending} onClick={() => save.mutate()}>
          Save page
        </button>
        {partner.microsite_slug && partner.microsite_published && (
          <a href={`/franchisee/${partner.microsite_slug}`} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-1.5">
            <ExternalLink size={15} /> Preview
          </a>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 *  Overview + exports                                                  *
 * ------------------------------------------------------------------ */
const ADMIN_DATASETS = [
  { key: 'partners', label: 'Partner list' },
  { key: 'leads', label: 'Partner leads' },
  { key: 'sales', label: 'Partner sales' },
  { key: 'admissions', label: 'Partner admissions' },
  { key: 'product', label: 'Product-wise report' },
  { key: 'monthly', label: 'Monthly report' },
  { key: 'yearly', label: 'Yearly report' },
];

interface Overview {
  partners: {
    total: number;
    by_status: Record<string, number>;
    by_type: Record<string, number>;
    microsites_published: number;
    publicly_visible: number;
  };
  totals: Performance['totals'];
  by_product: Performance['by_product'];
  monthly: Performance['monthly'];
  yearly: Performance['yearly'];
}

function OverviewTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-partner-overview'],
    queryFn: () => unwrap<Overview>(api.get('/partner/admin/overview')),
  });

  const download = (dataset: string, format: ExportFormat) =>
    downloadExport(`/partner/admin/export/${dataset}`, { format },
      `partner_${dataset}.${format}`);

  if (isLoading) return <p className="mt-4 text-slate-500">Loading…</p>;
  if (!data) return null;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total partners" value={data.partners.total} hint={`${data.partners.publicly_visible} in directory`} icon={Building2} accent="brand" />
        <StatCard label="Total leads" value={data.totals.total_leads} hint={`${data.totals.converted_leads} converted`} accent="sky" />
        <StatCard label="Total admissions" value={data.totals.total_admissions} accent="emerald" />
        <StatCard label="Network revenue" value={rupees(data.totals.revenue_paise)} hint="Approved reports" accent="violet" />
        <StatCard label="Pending approvals" value={data.totals.pending_approval_reports} accent="amber" />
        <StatCard label="Book sales" value={data.totals.total_book_sales} accent="slate" />
        <StatCard label="Membership sales" value={data.totals.total_membership_sales} accent="slate" />
        <StatCard label="Live microsites" value={data.partners.microsites_published} icon={Globe} accent="emerald" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="font-bold text-slate-800">Partners by type</h3>
          <div className="mt-3 space-y-2 text-sm">
            {Object.entries(data.partners.by_type).map(([t, n]) => (
              <div key={t} className="flex justify-between border-b border-slate-100 pb-1.5 last:border-b-0">
                <span className="text-slate-600">{t}</span>
                <span className="font-semibold text-slate-700">{n}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="font-bold text-slate-800">Product-wise performance</h3>
          {!data.by_product.length ? (
            <p className="mt-3 text-sm text-slate-500">No approved sales yet.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2">Product</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.by_product.map((p) => (
                  <tr key={p.product} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">{p.product}</td>
                    <td className="py-2 text-right font-semibold">{p.quantity}</td>
                    <td className="py-2 text-right text-slate-500">{rupees(p.revenue_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {!!data.monthly.length && (
        <div className="card">
          <h3 className="font-bold text-slate-800">Monthly performance</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2">Period</th><th className="pb-2 text-right">Books</th>
                  <th className="pb-2 text-right">Admissions</th><th className="pb-2 text-right">Memberships</th>
                  <th className="pb-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {[...data.monthly].reverse().map((m) => (
                  <tr key={m.period} className="border-t border-slate-100">
                    <td className="py-2 font-medium text-slate-700">{periodLabel(m.period)}</td>
                    <td className="py-2 text-right">{m.book_sale}</td>
                    <td className="py-2 text-right">{m.course_admission}</td>
                    <td className="py-2 text-right">{m.membership_sale}</td>
                    <td className="py-2 text-right text-slate-500">{rupees(m.revenue_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="flex items-center gap-2 font-bold text-slate-800">
          <Download size={17} className="text-brand" /> Data export
        </h3>
        <p className="mt-1 text-sm text-slate-500">Excel, CSV or PDF for every dataset.</p>
        <div className="mt-3 space-y-2">
          {ADMIN_DATASETS.map((d) => (
            <div key={d.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-sm font-medium text-slate-700">{d.label}</span>
              <div className="flex gap-1">
                {EXPORT_FORMATS.map((f) => (
                  <button key={f} className="btn-ghost py-1 text-xs uppercase" onClick={() => download(d.key, f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Page                                                                *
 * ------------------------------------------------------------------ */
export function AdminPartners() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('applications');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Partner | null>(null);
  const [micrositeFor, setMicrositeFor] = useState<Partner | null>(null);
  const [adding, setAdding] = useState(false);
  const [reportStatus, setReportStatus] = useState('pending');
  const [error, setError] = useState('');
  const pageSize = 25;

  const apps = useQuery({
    queryKey: ['admin-partners', status, q, page],
    queryFn: () => unwrap<{ items: Partner[]; total: number }>(
      api.get('/partner/applications', {
        params: { status: status || undefined, q: q || undefined, page, page_size: pageSize },
      })),
    enabled: tab === 'applications' || tab === 'microsites',
  });

  const reports = useQuery({
    queryKey: ['admin-partner-reports', reportStatus],
    queryFn: () => unwrap<PartnerReport[]>(
      api.get('/partner/admin/reports', { params: { status: reportStatus || undefined } })),
    enabled: tab === 'reports',
  });

  const leads = useQuery({
    queryKey: ['admin-partner-leads'],
    queryFn: () => unwrap<PartnerLead[]>(api.get('/partner/admin/leads')),
    enabled: tab === 'leads',
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-partners'] });
    qc.invalidateQueries({ queryKey: ['admin-partner-overview'] });
  };

  const review = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      unwrap(api.post(`/partner/reports/${id}/review`, { action })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-partner-reports'] });
      qc.invalidateQueries({ queryKey: ['admin-partner-overview'] });
    },
  });

  const toggleVisible = useMutation({
    mutationFn: (p: Partner) => unwrap(api.patch(`/partner/${p.id}`, { public_visible: !p.public_visible })),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  const archive = useMutation({
    mutationFn: (p: Partner) => unwrap(api.delete(`/partner/${p.id}`)),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const appColumns: Column<Partner>[] = [
    {
      key: 'name',
      header: 'Partner',
      sort: (p) => p.org || p.name,
      cell: (p) => (
        <div className="min-w-0">
          <div className="font-semibold text-slate-800">{p.org || p.name}</div>
          <div className="text-xs text-slate-400">
            {p.partner_id ? <span className="font-mono">{p.partner_id}</span> : p.name}
          </div>
        </div>
      ),
    },
    { key: 'partner_type', header: 'Type', sort: (p) => p.partner_type, cell: (p) => <span className="text-slate-500">{p.partner_type}</span> },
    {
      key: 'location',
      header: 'Location',
      sort: (p) => [p.district, p.state].filter(Boolean).join(', '),
      cell: (p) => <span className="text-slate-500">{[p.area, p.district, p.state].filter(Boolean).join(', ') || '—'}</span>,
    },
    {
      key: 'activity',
      header: 'Leads / reports',
      sort: (p) => p.total_leads ?? 0,
      cell: (p) => (
        <span className="text-slate-600">
          {p.total_leads ?? 0} / {p.approved_reports ?? 0}
          {!!p.pending_reports && <span className="ml-1 text-amber-600">({p.pending_reports} pending)</span>}
        </span>
      ),
    },
    { key: 'status', header: 'Status', sort: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
    {
      key: 'visible',
      header: 'Directory',
      sort: (p) => String(p.public_visible),
      cell: (p) => (
        <span className={p.public_visible ? 'text-emerald-600' : 'text-slate-400'}>
          {p.public_visible ? 'Visible' : 'Hidden'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (p) => (
        <RowActions>
          <RowAction icon={Pencil} label="Manage" onClick={() => setSelected(p)} />
          <RowAction
            icon={p.public_visible ? EyeOff : Eye}
            label={p.public_visible ? 'Hide from directory' : 'Show in directory'}
            onClick={() => toggleVisible.mutate(p)}
          />
          {p.partner_type === FRANCHISEE_TYPE && (
            <RowAction icon={Globe} label="Franchisee page" onClick={() => setMicrositeFor(p)} />
          )}
          <RowActionDivider />
          <RowAction icon={Trash2} label="Archive partner" variant="danger" onClick={() => archive.mutate(p)} />
        </RowActions>
      ),
    },
  ];

  const micrositeColumns: Column<Partner>[] = [
    {
      key: 'name',
      header: 'Franchisee',
      sort: (p) => p.org || p.name,
      cell: (p) => (
        <div>
          <div className="font-semibold text-slate-800">{p.org || p.name}</div>
          <div className="text-xs text-slate-400">{[p.area, p.district].filter(Boolean).join(', ')}</div>
        </div>
      ),
    },
    {
      key: 'slug',
      header: 'Page URL',
      sort: (p) => p.microsite_slug ?? '',
      cell: (p) => (p.microsite_slug
        ? <span className="font-mono text-xs text-slate-600">/franchisee/{p.microsite_slug}</span>
        : <span className="text-slate-400">Not created</span>),
    },
    {
      key: 'published',
      header: 'State',
      sort: (p) => String(p.microsite_published),
      cell: (p) => <StatusBadge status={p.microsite_published ? 'published' : 'draft'} />,
    },
    { key: 'photos', header: 'Photos', cell: (p) => `${p.gallery?.length ?? 0}` },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (p) => (
        <RowActions>
          <RowAction icon={Pencil} label="Edit page" onClick={() => setMicrositeFor(p)} />
          {p.microsite_slug && p.microsite_published && (
            <RowAction icon={ExternalLink} label="Open page" to={`/franchisee/${p.microsite_slug}`} />
          )}
        </RowActions>
      ),
    },
  ];

  const reportColumns: Column<PartnerReport>[] = [
    {
      key: 'occurred_on',
      header: 'Date',
      sort: (r) => r.occurred_on ?? r.created_at,
      cell: (r) => <span className="text-slate-600">{r.occurred_on ?? fmtDate(r.created_at)}</span>,
    },
    { key: 'partner', header: 'Partner', sort: (r) => r.partner_name || r.partner_id, cell: (r) => <span className="font-semibold">{r.partner_name || r.partner_id}</span> },
    { key: 'report_type', header: 'Type', sort: (r) => r.report_type, cell: (r) => <span className="text-slate-500">{REPORT_TYPE_LABELS[r.report_type] ?? r.report_type}</span> },
    { key: 'product', header: 'Product', sort: (r) => r.product ?? '', cell: (r) => r.product || '—' },
    { key: 'quantity', header: 'Qty', align: 'right', sort: (r) => r.quantity },
    { key: 'amount', header: 'Amount', align: 'right', sort: (r) => r.amount ?? 0, cell: (r) => <span className="text-slate-500">{r.amount ? rupees(r.amount) : '—'}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'actions',
      header: '',
      cell: (r) => (r.status === 'pending' ? (
        <div className="flex gap-1">
          <button className="btn-ghost py-1 text-xs text-green-700" onClick={() => review.mutate({ id: r.id, action: 'approve' })}>Approve</button>
          <button className="btn-ghost py-1 text-xs text-red-600" onClick={() => review.mutate({ id: r.id, action: 'reject' })}>Reject</button>
        </div>
      ) : (
        <span className="text-xs text-slate-400">{r.reviewed_by ? `by ${r.reviewed_by}` : ''}</span>
      )),
    },
  ];

  const leadColumns: Column<PartnerLead>[] = [
    { key: 'created_at', header: 'Added', sort: (l) => l.created_at, cell: (l) => <span className="text-slate-500">{fmtDate(l.created_at)}</span> },
    { key: 'partner_name', header: 'Partner', sort: (l) => l.partner_name ?? '', cell: (l) => <span className="font-semibold">{l.partner_name || l.partner_id}</span> },
    { key: 'name', header: 'Lead', sort: (l) => l.name },
    { key: 'phone', header: 'Phone', cell: (l) => <PhoneLink phone={l.phone} /> },
    { key: 'interest', header: 'Interest', sort: (l) => l.interest ?? '', cell: (l) => l.interest || '—' },
    { key: 'source', header: 'Source', sort: (l) => l.source, cell: (l) => <span className="text-slate-500">{l.source === 'microsite' ? 'Franchisee page' : 'Partner'}</span> },
    { key: 'status', header: 'Status', sort: (l) => l.status, cell: (l) => <StatusBadge status={l.status} /> },
  ];

  const franchisees = (apps.data?.items ?? []).filter((p) => p.partner_type === FRANCHISEE_TYPE);

  return (
    <div>
      <PageHeader
        title="Partner Management"
        description="Applications, approvals, directory, franchisee microsites, report verification and exports."
        actions={
          <button className="btn-primary inline-flex items-center gap-1.5" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add partner
          </button>
        }
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} className={`btn-ghost py-1 text-xs ${tab === t.key ? 'bg-slate-100' : ''}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {tab === 'applications' && (
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
                options={[{ value: '', label: 'All statuses' },
                  ...PARTNER_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))]}
              />
              <input className="input max-w-sm" placeholder="Search name / org / phone / Partner ID"
                value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </>
          }
          externalPaginator={<Paginator page={page} pageSize={pageSize} total={apps.data?.total ?? 0} onPage={setPage} />}
        />
      )}

      {tab === 'microsites' && (
        <>
          <p className="mt-4 text-sm text-slate-500">
            One-page sites for Complete Sujyoti Franchisee Partners. Enquiries from a published page
            land in that franchisee's lead list automatically.
          </p>
          <DataTable
            rows={franchisees}
            columns={micrositeColumns}
            loading={apps.isLoading}
            rowKey={(p) => p.id}
            searchText={(p) => `${p.org ?? ''} ${p.name} ${p.microsite_slug ?? ''}`}
            searchPlaceholder="Search franchisees"
            emptyLabel="No franchisee partners yet."
          />
        </>
      )}

      {tab === 'reports' && (
        <DataTable
          rows={reports.data}
          columns={reportColumns}
          loading={reports.isLoading}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.partner_name ?? ''} ${r.product ?? ''} ${r.report_type}`}
          searchPlaceholder="Search partner / product"
          initialSort={{ key: 'occurred_on', dir: 'desc' }}
          emptyLabel="No reports."
          filters={
            <TableFilter
              value={reportStatus}
              onChange={setReportStatus}
              options={[
                { value: 'pending', label: 'Pending approval' },
                { value: '', label: 'All' },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
          }
        />
      )}

      {tab === 'leads' && (
        <DataTable
          rows={leads.data}
          columns={leadColumns}
          loading={leads.isLoading}
          rowKey={(l) => l.id}
          searchText={(l) => `${l.name} ${l.phone} ${l.partner_name ?? ''} ${l.interest ?? ''}`}
          searchPlaceholder="Search leads"
          initialSort={{ key: 'created_at', dir: 'desc' }}
          emptyLabel="No partner leads yet."
          toolbarRight={
            <div className="flex gap-1">
              {EXPORT_FORMATS.map((f) => (
                <button key={f} className="btn-ghost py-1 text-xs uppercase"
                  onClick={() => downloadExport('/partner/admin/export/leads', { format: f }, `partner_leads.${f}`)}>
                  <Download size={13} /> {f}
                </button>
              ))}
            </div>
          }
        />
      )}

      {tab === 'overview' && <OverviewTab />}

      {selected && <PartnerModal partner={selected} onClose={() => setSelected(null)} onDone={refresh} />}
      {micrositeFor && <MicrositeModal partner={micrositeFor} onClose={() => setMicrositeFor(null)} onDone={refresh} />}
      {adding && <AddPartnerModal onClose={() => setAdding(false)} onDone={refresh} />}
    </div>
  );
}
