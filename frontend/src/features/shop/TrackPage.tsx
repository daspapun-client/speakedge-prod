import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { resumeBookPayment } from '@/features/shop/bookCheckout';

interface StatusEvent {
  status: string;
  at?: string;
  note?: string | null;
}

interface Tracking {
  order_number: string;
  status: string;
  delivery_type: string;
  courier_name?: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  status_history?: StatusEvent[];
  // Revealed only when the phone matches the order.
  buyer_name?: string;
  amount?: number;
  activation_code?: string;
  pickup_otp?: string | null;
  pickup_qr?: string | null;
  /** Order exists but was never paid for — offer to finish the payment. */
  can_resume?: boolean;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export function TrackPage() {
  const [params] = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(params.get('order') ?? '');
  const [phone, setPhone] = useState('');
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paidCode, setPaidCode] = useState<string | null>(null);

  async function load() {
    const res = await unwrap<Tracking>(
      api.get(`/books/track/${encodeURIComponent(orderNumber.trim())}`, {
        params: phone ? { phone: phone.trim() } : {},
      }),
    );
    setData(res);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setData(null);
    setPaidCode(null);
    setLoading(true);
    try {
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /** Finish an order the buyer abandoned at the gateway. */
  async function onPayNow() {
    setError('');
    setPaying(true);
    try {
      const res = await resumeBookPayment(orderNumber.trim(), phone.trim());
      if (res.paid) {
        setPaidCode(res.activation_code ?? null);
        await load();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-extrabold">Track your order</h1>
      <p className="mt-2 text-slate-600">
        Enter your order number. Add the phone used at checkout to reveal your activation code and
        pickup OTP — and to finish paying if you left the payment incomplete.
      </p>

      <form onSubmit={onSubmit} className="card mt-6 space-y-4">
        <div>
          <label className="label">Order number *</label>
          <input className="input" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} required />
        </div>
        <div>
          <label className="label">Phone (optional)</label>
          <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? 'Looking up…' : 'Track order'}
        </button>
      </form>

      {data && (
        <div className="card mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono font-semibold">{data.order_number}</span>
            <span className="badge bg-brand/10 text-brand">{data.status}</span>
          </div>
          <div className="text-sm text-slate-500">Delivery: {data.delivery_type}</div>

          {/* The receipt is phone-checked server-side, so it is only offered
              once the buyer has proved the order is theirs. */}
          {data.buyer_name && (
            <a
              href={`/api/v1/books/receipt/${encodeURIComponent(data.order_number)}?phone=${encodeURIComponent(phone.trim())}`}
              className="btn-ghost inline-flex items-center gap-2"
            >
              <Download size={16} /> Download PDF Receipt
            </a>
          )}

          {data.can_resume && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                This order has not been paid for yet. Your details and{' '}
                {data.amount != null ? rupees(data.amount) : 'the total'} are saved — finish the
                payment to confirm it.
              </p>
              <button className="btn-primary mt-3 w-full" onClick={onPayNow} disabled={paying}>
                {paying ? 'Opening payment…' : 'Pay now'}
              </button>
            </div>
          )}

          {paidCode && (
            <div className="rounded-lg bg-brand-gold/10 p-3 text-sm">
              <div className="font-semibold text-brand">Payment confirmed</div>
              <p className="mt-1 text-slate-600">
                Your activation code is below — use it to create your account.
              </p>
              <Link
                to={`/activate?code=${encodeURIComponent(paidCode)}`}
                className="btn-primary mt-3 inline-block"
              >
                Activate my membership
              </Link>
            </div>
          )}

          {data.tracking_number && (
            <div className="text-sm">
              Courier: {data.courier_name} · {data.tracking_number}
              {data.tracking_url && (
                <> · <a href={data.tracking_url} className="text-brand" target="_blank" rel="noreferrer">Track parcel</a></>
              )}
            </div>
          )}

          {data.activation_code && (
            <div className="rounded-lg bg-brand-gold/10 p-3 text-sm">
              <div className="font-semibold text-brand">Your Activation Code</div>
              <div className="font-mono text-lg">{data.activation_code}</div>
              {data.amount != null && <div className="mt-1 text-slate-500">Paid: {rupees(data.amount)}</div>}
              <Link
                to={`/activate?code=${encodeURIComponent(data.activation_code)}`}
                className="btn-primary mt-3 inline-block"
              >
                Activate my membership
              </Link>
            </div>
          )}

          {data.pickup_otp && (
            <div className="rounded-lg bg-slate-100 p-3 text-sm">
              <div className="font-semibold">Office pickup OTP</div>
              <div className="font-mono text-lg">{data.pickup_otp}</div>
              <div className="text-slate-500">Show this at the office to collect your book.</div>
            </div>
          )}

          {!!data.status_history?.length && (
            <ol className="mt-2 space-y-1 border-t border-slate-200 pt-3 text-sm text-slate-600">
              {data.status_history.map((s, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span>{s.status}{s.note ? ` — ${s.note}` : ''}</span>
                  {s.at && <span className="text-xs text-slate-400">{new Date(s.at).toLocaleString()}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
