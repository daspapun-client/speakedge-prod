import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { EmailLink, PhoneLink } from '@/features/admin/_shared';
import { api, unwrap } from '@/lib/api';

interface Microsite {
  partner_id?: string | null;
  partner_type: string;
  name: string;
  org?: string | null;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  state?: string | null;
  district?: string | null;
  area?: string | null;
  products_allowed: string[];
}

export function PartnerMicrositePage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['partner-microsite', slug],
    queryFn: () => unwrap<Microsite>(api.get(`/partner/microsite/${encodeURIComponent(slug)}`)),
    retry: false,
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error || !data)
    return (
      <div className="card mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold">Microsite not found</h1>
        <Link to="/partners" className="mt-3 inline-block text-brand">Back to directory</Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl bg-brand p-8 text-white">
        <div className="text-xs uppercase tracking-widest text-white/70">{data.partner_type}</div>
        <h1 className="mt-2 text-3xl font-extrabold">{data.org || data.name}</h1>
        {data.partner_id && <div className="mt-1 font-mono text-sm text-white/70">{data.partner_id}</div>}
      </div>

      <div className="card mt-6">
        <h2 className="font-bold">Contact</h2>
        <div className="mt-2 space-y-1 text-sm text-slate-600">
          <div>Contact person: {data.name}</div>
          <div>📞 <PhoneLink phone={data.phone} /></div>
          {data.whatsapp && <div>WhatsApp: <PhoneLink phone={data.whatsapp} /></div>}
          {data.email && <div>✉️ <EmailLink email={data.email} /></div>}
          <div>{[data.area, data.district, data.state].filter(Boolean).join(', ')}</div>
        </div>
      </div>

      {!!data.products_allowed.length && (
        <div className="card mt-4">
          <h2 className="font-bold">Products &amp; services</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.products_allowed.map((p) => (
              <span key={p} className="rounded-full bg-brand/10 px-3 py-1 text-sm text-brand">{p}</span>
            ))}
          </div>
        </div>
      )}
      <Link to="/partners" className="mt-6 inline-block text-sm text-brand">← Back to directory</Link>
    </div>
  );
}
