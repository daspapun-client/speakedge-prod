import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';

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
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export function TrackPage() {
  const [params] = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(params.get('order') ?? '');
  const [phone, setPhone] = useState('');
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setData(null);
    setLoading(true);
    try {
      const res = await unwrap<Tracking>(
        api.get(`/books/track/${encodeURIComponent(orderNumber.trim())}`, {
          params: phone ? { phone: phone.trim() } : {},
        }),
      );
      setData(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-extrabold">Track your order</h1>
      <p className="mt-2 text-slate-600">
        Enter your order number. Add the phone used at checkout to reveal your activation code and pickup OTP.
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
