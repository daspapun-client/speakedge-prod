/**
 * Part E — the franchisee one-page microsite at /franchisee/<slug>.
 *
 * Everything on it is admin-managed content on the Partner record, and the
 * enquiry form posts straight into that franchisee's own lead list.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowRight, BookOpen, CheckCircle2, Loader2, Mail, MapPin, MessageCircle, Phone,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { EmailLink, PhoneLink } from '@/features/admin/_shared';
import { whatsappHref } from '@/features/exams/shared';

interface Microsite {
  partner_id?: string | null;
  partner_type: string;
  name: string;
  org?: string | null;
  about?: string | null;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  state?: string | null;
  district?: string | null;
  area?: string | null;
  products: string[];
  gallery: string[];
  logo_url?: string | null;
  map_embed_url?: string | null;
}

function EnquiryForm({ slug, products }: { slug: string; products: string[] }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', interest: '', message: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const send = useMutation({
    mutationFn: () => {
      if (!form.name.trim() || !form.phone.trim()) throw new Error('Please enter your name and phone number');
      return unwrap(api.post(`/partner/microsite/${encodeURIComponent(slug)}/enquiry`, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        interest: form.interest || null,
        message: form.message.trim() || null,
      }));
    },
    onError: (e: Error) => setError(e.message),
    onSuccess: () => setError(''),
  });

  if (send.isSuccess) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-8 text-center">
        <CheckCircle2 size={32} className="mx-auto text-emerald-500" />
        <p className="mt-2 font-semibold text-emerald-800">Thank you!</p>
        <p className="mt-1 text-sm text-emerald-900/80">The centre will contact you shortly.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Your name</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="label">Email (optional)</label>
        <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
      </div>
      {!!products.length && (
        <div>
          <label className="label">Interested in</label>
          <select className="input" value={form.interest} onChange={(e) => set('interest', e.target.value)}>
            <option value="">Select a course / product</option>
            {products.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      )}
      <div>
        <label className="label">Message (optional)</label>
        <textarea className="input" rows={3} value={form.message} onChange={(e) => set('message', e.target.value)} />
      </div>
      <button className="btn-primary w-full" disabled={send.isPending} onClick={() => send.mutate()}>
        {send.isPending ? <><Loader2 size={16} className="animate-spin" /> Sending…</> : 'Send enquiry'}
      </button>
      <p className="text-xs text-slate-400">
        By sending this enquiry you agree to be contacted by this centre about your request.
      </p>
    </div>
  );
}

export function PartnerMicrositePage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['partner-microsite', slug],
    queryFn: () => unwrap<Microsite>(api.get(`/partner/microsite/${encodeURIComponent(slug)}`)),
    retry: false,
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error || !data) {
    return (
      <div className="card mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-slate-500">
          This franchisee page is not available or has not been published yet.
        </p>
        <Link to="/partners" className="mt-3 inline-block text-brand">Back to partner directory</Link>
      </div>
    );
  }

  const wa = whatsappHref(data.whatsapp);
  const location = [data.area, data.district, data.state].filter(Boolean).join(', ');

  return (
    <div className="mx-auto max-w-4xl">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-brand to-brand-light text-white">
        <div className="flex flex-wrap items-center gap-5 p-8">
          {data.logo_url && (
            <img src={data.logo_url} alt="" className="h-20 w-20 shrink-0 rounded-xl bg-white object-contain p-1.5" />
          )}
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-widest text-white/70">{data.partner_type}</div>
            <h1 className="mt-1 text-3xl font-extrabold">{data.org || data.name}</h1>
            {location && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-white/85">
                <MapPin size={14} /> {location}
              </p>
            )}
            {data.partner_id && <div className="mt-1 font-mono text-xs text-white/60">{data.partner_id}</div>}
          </div>
        </div>
        {/* CTA buttons */}
        <div className="flex flex-wrap gap-2 border-t border-white/15 px-8 py-4">
          <a href={`tel:${data.phone}`} className="btn-gold inline-flex items-center gap-1.5">
            <Phone size={16} /> Contact centre
          </a>
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25">
              <MessageCircle size={16} /> WhatsApp
            </a>
          )}
          <a href="#enquiry" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25">
            Book a demo <ArrowRight size={15} />
          </a>
          <Link to="/plans" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25">
            <BookOpen size={16} /> View courses
          </Link>
        </div>
      </div>

      {data.about && (
        <section className="card mt-6">
          <h2 className="font-bold text-slate-800">About us</h2>
          <p className="mt-2 whitespace-pre-line text-slate-600">{data.about}</p>
        </section>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section className="card">
          <h2 className="font-bold text-slate-800">Contact</h2>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            <div>Contact person: <span className="font-medium text-slate-700">{data.name}</span></div>
            <div className="flex items-center gap-2"><Phone size={14} className="text-brand" /><PhoneLink phone={data.phone} /></div>
            {data.whatsapp && (
              <div className="flex items-center gap-2">
                <MessageCircle size={14} className="text-emerald-500" />
                {wa ? <a href={wa} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline">{data.whatsapp}</a> : data.whatsapp}
              </div>
            )}
            {data.email && <div className="flex items-center gap-2"><Mail size={14} className="text-brand" /><EmailLink email={data.email} /></div>}
            {(data.address || location) && (
              <div className="flex items-start gap-2">
                <MapPin size={14} className="mt-0.5 shrink-0 text-brand" />
                <span>{data.address || location}</span>
              </div>
            )}
          </div>
        </section>

        {!!data.products.length && (
          <section className="card">
            <h2 className="font-bold text-slate-800">Courses &amp; products offered</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.products.map((p) => (
                <span key={p} className="rounded-full bg-brand/10 px-3 py-1 text-sm text-brand">{p}</span>
              ))}
            </div>
          </section>
        )}
      </div>

      {!!data.gallery.length && (
        <section className="card mt-6">
          <h2 className="font-bold text-slate-800">Gallery</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {data.gallery.map((url) => (
              <img key={url} src={url} alt="" loading="lazy"
                className="h-40 w-full rounded-xl object-cover" />
            ))}
          </div>
        </section>
      )}

      {data.map_embed_url && (
        <section className="card mt-6">
          <h2 className="font-bold text-slate-800">Find us</h2>
          <div className="mt-3 overflow-hidden rounded-xl">
            <iframe
              title="Location map"
              src={data.map_embed_url}
              className="h-72 w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </section>
      )}

      <section id="enquiry" className="card mt-6 scroll-mt-24">
        <h2 className="font-bold text-slate-800">Enquire / book a demo</h2>
        <p className="mt-1 text-sm text-slate-500">
          Send your details and the centre will get in touch.
        </p>
        <div className="mt-4">
          <EnquiryForm slug={slug} products={data.products} />
        </div>
      </section>

      <Link to="/partners" className="mt-6 inline-block text-sm text-brand">← Back to partner directory</Link>
    </div>
  );
}
