/**
 * Public Partner Directory. Filters are driven by `/partner/directory/filters`
 * — only values that actually have approved, visible partners — so a filter
 * can never lead to an empty page.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake, MapPin, MessageCircle, Phone, Search } from 'lucide-react';
import { PhoneLink } from '@/features/admin/_shared';
import { api, unwrap } from '@/lib/api';
import { whatsappHref } from '@/features/exams/shared';

interface DirectoryPartner {
  id: string;
  partner_id?: string | null;
  partner_type: string;
  name: string;
  org?: string | null;
  about?: string | null;
  phone: string;
  whatsapp?: string | null;
  address?: string | null;
  state?: string | null;
  district?: string | null;
  area?: string | null;
  products: string[];
  logo_url?: string | null;
  microsite_slug?: string | null;
  microsite_published?: boolean;
}

interface Filters {
  states: string[];
  districts: string[];
  products: string[];
  partner_types: string[];
}

export function PartnerDirectoryPage() {
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [product, setProduct] = useState('');
  const [q, setQ] = useState('');

  const filters = useQuery({
    queryKey: ['partner-directory-filters'],
    queryFn: () => unwrap<Filters>(api.get('/partner/directory/filters')),
  });
  const { data, isLoading } = useQuery({
    queryKey: ['partner-directory', type, state, district, product, q],
    queryFn: () => unwrap<DirectoryPartner[]>(api.get('/partner/directory', {
      params: {
        partner_type: type || undefined,
        state: state || undefined,
        district: district || undefined,
        product: product || undefined,
        q: q || undefined,
      },
    })),
  });

  const f = filters.data;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Partner Directory</h1>
          <p className="mt-2 text-slate-600">Approved partners of the Sujyoti EdTech network.</p>
        </div>
        <Link to="/apply/partner" className="btn-gold">Become a partner</Link>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative lg:col-span-2">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search by name or area" value={q}
            onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All partner types</option>
          {(f?.partner_types ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input" value={state} onChange={(e) => { setState(e.target.value); setDistrict(''); }}>
          <option value="">All states</option>
          {(f?.states ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={district} onChange={(e) => setDistrict(e.target.value)}>
          <option value="">All districts</option>
          {(f?.districts ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {!!f?.products.length && (
          <select className="input lg:col-span-2" value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All products &amp; services</option>
            {f.products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>

      {isLoading ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : !data?.length ? (
        <p className="mt-6 text-slate-500">No partners match these filters.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => {
            const wa = whatsappHref(p.whatsapp);
            return (
              <div key={p.id} className="card flex flex-col">
                <div className="flex items-start gap-3">
                  {p.logo_url ? (
                    <img src={p.logo_url} alt="" className="h-11 w-11 shrink-0 rounded-lg bg-slate-50 object-contain p-1" />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
                      <Handshake size={20} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand">{p.partner_type}</div>
                    <div className="mt-0.5 font-bold text-slate-800">{p.org || p.name}</div>
                    {p.org && <div className="text-sm text-slate-500">{p.name}</div>}
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 text-sm text-slate-500">
                  <div className="flex items-start gap-1.5">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    <span>{p.address || [p.area, p.district, p.state].filter(Boolean).join(', ') || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Phone size={14} className="shrink-0 text-slate-400" />
                    <PhoneLink phone={p.phone} />
                  </div>
                  {wa && (
                    <a href={wa} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-emerald-600 hover:underline">
                      <MessageCircle size={14} className="shrink-0" /> {p.whatsapp}
                    </a>
                  )}
                </div>

                {!!p.products.length && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {p.products.map((s) => (
                      <span key={s} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{s}</span>
                    ))}
                  </div>
                )}

                {p.microsite_slug && p.microsite_published && (
                  <Link to={`/franchisee/${p.microsite_slug}`}
                    className="mt-auto pt-3 text-sm font-semibold text-brand hover:text-brand-light">
                    Visit centre page →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
