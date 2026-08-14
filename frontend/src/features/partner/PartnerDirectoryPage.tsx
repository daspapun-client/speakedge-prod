import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake } from 'lucide-react';
import { PhoneLink } from '@/features/admin/_shared';
import { api, unwrap } from '@/lib/api';

interface DirectoryPartner {
  id: string;
  partner_id?: string | null;
  partner_type: string;
  name: string;
  org?: string | null;
  phone: string;
  whatsapp?: string | null;
  state?: string | null;
  district?: string | null;
  area?: string | null;
  microsite_slug?: string | null;
}

const TYPES = [
  '',
  'Individual Partner',
  'Educational Institute Partner',
  'Book Store / Shop Partner',
  'Complete Sujyoti Franchisee Partner',
];

export function PartnerDirectoryPage() {
  const [type, setType] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['partner-directory', type],
    queryFn: () => unwrap<DirectoryPartner[]>(api.get('/partner/directory', { params: { partner_type: type || undefined } })),
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Partner Directory</h1>
          <p className="mt-2 text-slate-600">Approved partners of the Sujyoti EdTech network.</p>
        </div>
        <Link to="/apply/partner" className="btn-gold">Become a partner</Link>
      </div>

      <div className="mt-4">
        <select className="input max-w-xs" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t || 'All partner types'}</option>)}
        </select>
      </div>

      {isLoading ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : !data?.length ? (
        <p className="mt-6 text-slate-500">No partners listed yet.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <div key={p.id} className="card">
              <div className="flex items-center gap-2 text-brand"><Handshake size={18} /><span className="text-xs font-semibold uppercase tracking-wide">{p.partner_type}</span></div>
              <div className="mt-2 font-bold">{p.org || p.name}</div>
              {p.org && <div className="text-sm text-slate-500">{p.name}</div>}
              <div className="mt-1 text-sm text-slate-500">{[p.area, p.district, p.state].filter(Boolean).join(', ') || '—'}</div>
              <div className="mt-2 text-sm">📞 <PhoneLink phone={p.phone} /></div>
              {p.microsite_slug && (
                <Link to={`/partners/${p.microsite_slug}`} className="mt-3 inline-block text-sm font-semibold text-brand">
                  Visit microsite →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
