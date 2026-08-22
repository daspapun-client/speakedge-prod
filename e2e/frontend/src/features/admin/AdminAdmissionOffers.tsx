import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Check, Copy, Mail, MessageCircle, Ticket } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, StatusBadge, fmtDate, rupees } from './_shared';

/**
 * New Student Offer — a temporary discounted admission fee for someone who has
 * not taken admission yet.
 *
 * Admin picks the plan, the offer price and how long the link lives (24/48/72
 * hours); the server mints a unique link that prices the guest checkout while
 * it is valid and stops resolving the moment it lapses. Sending it is a manual
 * act, so each row carries copy / WhatsApp / email shortcuts rather than firing
 * a message off on its own.
 *
 * Not to be confused with Offers (`/admin/offers`), which is the dashboard
 * pop-up aimed at students who already have an account.
 */

interface AdmissionOffer {
  id: string;
  token: string;
  plan: string;
  label: string;
  price: number;
  list_price: number;
  valid_hours: number;
  expires_at: string;
  live: boolean;
  revoked: boolean;
  student_name: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  uses: number;
  order_numbers: string[];
  used_at: string | null;
  created_by: string | null;
  created_at: string;
}

interface OfferList {
  offers: AdmissionOffer[];
  valid_hours: number[];
}

interface PlanOption {
  plan: string;
  label: string;
  amount: number;
  offer_price: number | null;
  enabled: boolean;
}

const admissionFee = (p: PlanOption) => p.offer_price ?? p.amount;
/** The link is built against whatever host admin is on, so it is right in dev,
 *  on staging and in production without a configured base URL. */
const offerUrl = (o: AdmissionOffer) => `${window.location.origin}/offer/${o.token}`;

const shareText = (o: AdmissionOffer) =>
  `Your special SpeakEdge joining offer: ${o.label} membership at ` +
  `${rupees(o.price)} (regular ${rupees(o.list_price)}). ` +
  `This price is valid for ${o.valid_hours} hours — join here: ${offerUrl(o)}`;

function status(o: AdmissionOffer): string {
  if (o.revoked) return 'Revoked';
  if (!o.live) return 'Expired';
  return o.uses > 0 ? 'Used' : 'Active';
}

/** Copy-to-clipboard that reports back, so admin knows the link is on their
 *  clipboard before they switch to WhatsApp. */
function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost px-2 py-1 text-xs"
      title={url}
      onClick={async () => {
        await navigator.clipboard.writeText(url);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
      {done ? 'Copied' : 'Copy link'}
    </button>
  );
}

function CreateOfferModal({ onClose, onDone, validHours }: {
  onClose: () => void;
  onDone: () => void;
  validHours: number[];
}) {
  const plans = useQuery({
    queryKey: ['plan-options'],
    queryFn: () => unwrap<PlanOption[]>(api.get('/payments/plans', { params: { all: true } })),
    staleTime: 5 * 60 * 1000,
  });
  const [form, setForm] = useState({
    plan: '', price: '', valid_hours: String(validHours[0] ?? 24),
    student_name: '', phone: '', email: '', note: '',
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const selected = plans.data?.find((p) => p.plan === form.plan);

  const create = useMutation({
    mutationFn: () => {
      if (!form.plan) throw new Error('Choose the membership plan this offer is for');
      const price = Math.round(Number(form.price) * 100);
      if (!price || price <= 0) throw new Error('Enter the offer price in rupees');
      return unwrap(api.post('/payments/admin/admission-offers', {
        plan: form.plan,
        price,
        valid_hours: Number(form.valid_hours),
        student_name: form.student_name || null,
        phone: form.phone || null,
        email: form.email || null,
        note: form.note || null,
      }));
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-bold">New student offer</h2>
      <p className="mt-1 text-sm text-slate-500">
        Creates a payment link the student can use to join at a reduced admission fee. The link
        stops working when it expires, and anyone opening it after that lands on the regular
        Membership Plans page.
      </p>

      <div className="mt-4 grid gap-3">
        <div>
          <label className="label">Membership plan *</label>
          <select className="input" value={form.plan} onChange={(e) => set('plan', e.target.value)}>
            <option value="">Select a plan…</option>
            {(plans.data ?? []).filter((p) => p.enabled).map((p) => (
              <option key={p.plan} value={p.plan}>
                {p.label} — {rupees(admissionFee(p))}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Offer price (₹) *</label>
            <input
              className="input"
              type="number"
              min={1}
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
            />
            {selected && (
              <p className="mt-1 text-xs text-slate-400">
                Regular admission fee {rupees(admissionFee(selected))} — the offer must be lower.
              </p>
            )}
          </div>
          <div>
            <label className="label">Link validity *</label>
            <select
              className="input"
              value={form.valid_hours}
              onChange={(e) => set('valid_hours', e.target.value)}
            >
              {validHours.map((h) => (
                <option key={h} value={h}>{h} hours</option>
              ))}
            </select>
          </div>
        </div>

        <h3 className="mt-2 text-sm font-semibold text-slate-700">
          Who it is for <span className="font-normal text-slate-400">(optional — your record)</span>
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Student name</label>
            <input
              className="input"
              value={form.student_name}
              onChange={(e) => set('student_name', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>
        <div>
          <label className="label">Note</label>
          <input className="input" value={form.note} onChange={(e) => set('note', e.target.value)} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create link'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function AdminAdmissionOffers() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const offers = useQuery({
    queryKey: ['admission-offers'],
    queryFn: () => unwrap<OfferList>(api.get('/payments/admin/admission-offers')),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admission-offers'] });

  const revoke = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/payments/admin/admission-offers/${id}`)),
    onSuccess: refresh,
  });

  const columns: Column<AdmissionOffer>[] = [
    {
      key: 'plan',
      header: 'Offer',
      sort: (o) => o.label,
      cell: (o) => (
        <>
          <div className="font-semibold">{o.label}</div>
          <div className="text-xs text-slate-400">
            <span className="line-through">{rupees(o.list_price)}</span> → {rupees(o.price)}
          </div>
        </>
      ),
    },
    {
      key: 'student_name',
      header: 'For',
      sort: (o) => o.student_name ?? '',
      cell: (o) => (
        <>
          <div>{o.student_name || '—'}</div>
          <div className="text-xs text-slate-400">{o.phone || o.email || ''}</div>
        </>
      ),
    },
    {
      key: 'expires_at',
      header: 'Valid until',
      sort: (o) => o.expires_at,
      cell: (o) => (
        <>
          <div>{fmtDate(o.expires_at)}</div>
          <div className="text-xs text-slate-400">{o.valid_hours}h link</div>
        </>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sort: (o) => status(o),
      cell: (o) => (
        <>
          <StatusBadge status={status(o)} />
          {o.uses > 0 && (
            <div className="mt-1 text-xs text-slate-400">{o.order_numbers.join(', ')}</div>
          )}
        </>
      ),
    },
    {
      key: 'actions',
      header: 'Send / manage',
      width: '1%',
      cell: (o) => (
        <div className="flex flex-wrap items-center gap-1">
          <CopyLink url={offerUrl(o)} />
          {o.phone && (
            <a
              className="btn-ghost px-2 py-1 text-xs"
              href={`https://wa.me/${o.phone.replace(/\D/g, '')}?text=${encodeURIComponent(shareText(o))}`}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle size={14} /> WhatsApp
            </a>
          )}
          {o.email && (
            <a
              className="btn-ghost px-2 py-1 text-xs"
              href={`mailto:${o.email}?subject=${encodeURIComponent('Your SpeakEdge joining offer')}&body=${encodeURIComponent(shareText(o))}`}
            >
              <Mail size={14} /> Email
            </a>
          )}
          {o.live && (
            <button
              className="btn-ghost px-2 py-1 text-xs text-red-600"
              onClick={() => revoke.mutate(o.id)}
            >
              Revoke
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Student Offers"
        description="Time-limited discounted admission links for prospects who have not joined yet."
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Ticket size={16} /> Create offer link
          </button>
        }
      />

      <DataTable
        rows={offers.data?.offers}
        columns={columns}
        rowKey={(o) => o.id}
        loading={offers.isPending}
        searchText={(o) => `${o.label} ${o.student_name ?? ''} ${o.phone ?? ''} ${o.email ?? ''}`}
        searchPlaceholder="Search by plan, name or contact…"
        initialSort={{ key: 'expires_at', dir: 'desc' }}
        emptyLabel="No offer links yet."
      />

      {creating && (
        <CreateOfferModal
          onClose={() => setCreating(false)}
          onDone={refresh}
          validHours={offers.data?.valid_hours ?? [24, 48, 72]}
        />
      )}
    </div>
  );
}
