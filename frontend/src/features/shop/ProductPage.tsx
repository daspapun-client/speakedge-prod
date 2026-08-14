import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Building2, CheckCircle2, Home, Package, ShoppingBag, Truck,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { TermsAgreement } from '@/components/TermsAgreement';
import { bookCheckout, type CheckoutResult } from '@/features/shop/bookCheckout';

interface Product {
  id: string;
  name: string;
  sku: string;
  version: string;
  language: string;
  description?: string | null;
  cover_image_url?: string | null;
  gallery?: string[];
  price: number;
  offer_price?: number | null;
  sell_price: number;
  gst_rate: number;
  available: number;
  is_speakedge_book: boolean;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

function ProductSkeleton() {
  return (
    <div className="animate-pulse space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-10 lg:space-y-0">
      <div className="space-y-4">
        <div className="h-4 w-28 rounded bg-slate-200" />
        <div className="aspect-[4/5] max-h-[480px] rounded-2xl bg-slate-200 sm:aspect-auto sm:min-h-80" />
        <div className="h-8 w-3/4 rounded bg-slate-200" />
        <div className="h-5 w-1/3 rounded bg-slate-200" />
      </div>
      <div className="h-96 rounded-2xl bg-slate-200" />
    </div>
  );
}

function DeliveryToggle({
  value,
  onChange,
}: {
  value: 'home' | 'office';
  onChange: (v: 'home' | 'office') => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
      <button
        type="button"
        onClick={() => onChange('home')}
        className={`flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
          value === 'home'
            ? 'bg-white text-brand shadow-sm ring-1 ring-slate-200/80'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <Truck size={16} className="shrink-0" />
        <span>Home delivery</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('office')}
        className={`flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
          value === 'office'
            ? 'bg-white text-brand shadow-sm ring-1 ring-slate-200/80'
            : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        <Building2 size={16} className="shrink-0" />
        <span>Office pickup</span>
      </button>
    </div>
  );
}

export function ProductPage() {
  const { id = '' } = useParams();
  const { data: p, isLoading } = useQuery({
    queryKey: ['book', id],
    queryFn: () => unwrap<Product>(api.get(`/books/product/${id}`)),
  });

  const [delivery, setDelivery] = useState<'home' | 'office'>('home');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const allImages = useMemo(
    () => [...new Set([p?.cover_image_url, ...(p?.gallery ?? [])].filter(Boolean) as string[])],
    [p?.cover_image_url, p?.gallery],
  );

  useEffect(() => setActiveImage(0), [id]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const get = (k: string) => (f.get(k) as string) || undefined;
    try {
      const res = await bookCheckout({
        product_id: id,
        buyer_name: f.get('buyer_name') as string,
        phone: f.get('phone') as string,
        email: get('email'),
        delivery_type: delivery,
        alt_phone: get('alt_phone'),
        address_line1: get('address_line1'),
        address_line2: get('address_line2'),
        landmark: get('landmark'),
        city: get('city'),
        district: get('district'),
        state: get('state'),
        pin_code: get('pin_code'),
        delivery_instructions: get('delivery_instructions'),
        accept_terms: acceptTerms,
      });
      setResult(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) return <ProductSkeleton />;

  if (!p) {
    return (
      <div className="card mx-auto max-w-md text-center">
        <Package size={40} className="mx-auto text-slate-300" />
        <p className="mt-3 font-medium text-slate-700">Product not found</p>
        <Link to="/shop" className="btn-primary mt-4 inline-flex">Back to shop</Link>
      </div>
    );
  }

  // The SpeakEdge Book is only sold with a membership — Step 1 comes first.
  if (p.is_speakedge_book && !result) return <Navigate to="/plans" replace />;

  if (result) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card overflow-hidden p-0 text-center">
          <div className="bg-gradient-to-b from-brand/10 to-white px-6 pb-2 pt-8">
            <CheckCircle2 size={48} className="mx-auto text-green-600" />
            <h1 className="mt-4 text-2xl font-extrabold text-slate-900">Order placed</h1>
            <p className="mt-2 text-slate-600">
              Order <span className="font-mono font-bold text-brand">{result.order_number}</span>
            </p>
          </div>
          <div className="space-y-2 px-6 py-5 text-left text-sm text-slate-600">
            <div className="flex justify-between gap-4"><span>Book</span><span className="font-medium text-slate-900">{rupees(result.book_amount)}</span></div>
            {result.gst_amount > 0 && (
              <div className="flex justify-between gap-4"><span>GST</span><span className="font-medium text-slate-900">{rupees(result.gst_amount)}</span></div>
            )}
            <div className="flex justify-between gap-4">
              <span>Delivery</span>
              <span className="font-medium text-slate-900">{result.delivery_charge ? rupees(result.delivery_charge) : 'Free (pickup)'}</span>
            </div>
            <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-base font-bold text-slate-900">
              <span>Total</span><span>{rupees(result.amount)}</span>
            </div>
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-6 py-5">
            <p className="text-sm text-slate-500">
              Complete payment to confirm. Your activation code appears on the tracking page once payment is verified.
            </p>
            <Link to={`/track?order=${result.order_number}`} className="btn-primary mt-4 inline-flex w-full sm:w-auto">
              Track this order
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const outOfStock = p.available <= 0;
  const onSale = p.offer_price != null && p.offer_price < p.price;
  const discountPct = onSale ? Math.round((1 - p.sell_price / p.price) * 100) : 0;
  const shownImage = allImages[activeImage] ?? allImages[0];

  return (
    <div className="pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Breadcrumb */}
      <Link
        to="/shop"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-brand"
      >
        <ArrowLeft size={16} />
        Back to shop
      </Link>

      <div className="mt-4 lg:mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-10 xl:gap-14">
        {/* Product details */}
        <section className="min-w-0">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white shadow-sm">
            <div className="flex min-h-[280px] items-center justify-center p-4 sm:min-h-[360px] sm:p-6">
              {shownImage ? (
                <img
                  src={shownImage}
                  alt={p.name}
                  className="max-h-[min(520px,70vh)] w-full object-contain"
                />
              ) : (
                <BookOpen size={72} className="text-slate-300" />
              )}
            </div>
            {allImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto border-t border-slate-100 bg-white px-4 py-3 sm:px-6">
                {allImages.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    aria-label={`View image ${i + 1}`}
                    aria-pressed={i === activeImage}
                    className={`shrink-0 overflow-hidden rounded-lg border-2 bg-slate-50 p-1 transition ${
                      i === activeImage ? 'border-brand ring-2 ring-brand/20' : 'border-transparent hover:border-slate-300'
                    }`}
                  >
                    <img src={url} alt="" className="h-16 w-14 object-contain sm:h-20 sm:w-16" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 sm:mt-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="badge bg-brand/10 text-brand">{p.version.replace(/_/g, ' ')}</span>
              <span className="badge bg-slate-100 text-slate-600">{p.language}</span>
              {outOfStock ? (
                <span className="badge bg-red-100 text-red-700">Out of stock</span>
              ) : (
                <span className="badge bg-emerald-100 text-emerald-700">In stock</span>
              )}
            </div>

            <h1 className="mt-3 text-2xl font-extrabold leading-tight text-slate-900 sm:text-3xl">{p.name}</h1>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-400">SKU {p.sku}</p>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <span className="text-3xl font-extrabold text-slate-900 sm:text-4xl">{rupees(p.sell_price)}</span>
              {onSale && (
                <>
                  <span className="pb-1 text-lg text-slate-400 line-through">{rupees(p.price)}</span>
                  <span className="badge mb-1 bg-brand-gold/20 text-slate-800">{discountPct}% off</span>
                </>
              )}
            </div>
            {p.gst_rate > 0 && (
              <p className="mt-1 text-xs text-slate-500">Inclusive of {p.gst_rate}% GST where applicable</p>
            )}

            {p.description && (
              <div className="mt-5 rounded-xl border border-slate-100 bg-white p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-slate-900">About this book</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.description}</p>
              </div>
            )}

            {/* Mobile order summary strip — desktop checkout is in the sidebar */}
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:hidden">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                <ShoppingBag size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">Ready to order?</p>
                <p className="text-xs text-slate-500">Fill in your details below to place the order.</p>
              </div>
              <span className="shrink-0 text-lg font-bold text-brand">{rupees(p.sell_price)}</span>
            </div>
          </div>
        </section>

        {/* Checkout */}
        <aside className="mt-8 lg:mt-0">
          <form
            onSubmit={onSubmit}
            className="card space-y-5 border-slate-200/80 p-4 shadow-md sm:p-6 lg:sticky lg:top-24"
          >
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand">
                <Home size={18} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Checkout</h2>
                <p className="text-xs text-slate-500">Secure order · Sujyoti Publications</p>
              </div>
            </div>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Contact</legend>
              <div>
                <label className="label">Full name *</label>
                <input name="buyer_name" className="input min-h-[44px]" autoComplete="name" required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Phone *</label>
                  <input name="phone" type="tel" className="input min-h-[44px]" autoComplete="tel" inputMode="tel" required />
                </div>
                <div>
                  <label className="label">Alt. phone</label>
                  <input name="alt_phone" type="tel" className="input min-h-[44px]" inputMode="tel" />
                </div>
              </div>
              <div>
                <label className="label">Email</label>
                <input name="email" type="email" className="input min-h-[44px]" autoComplete="email" />
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Delivery</legend>
              <DeliveryToggle value={delivery} onChange={setDelivery} />
              <p className="text-xs leading-relaxed text-slate-500">
                {delivery === 'home'
                  ? 'Home delivery — a delivery charge is added at confirmation.'
                  : 'Office pickup is free. Collect with the OTP after payment.'}
              </p>
            </fieldset>

            {delivery === 'home' && (
              <fieldset className="space-y-3">
                <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Address</legend>
                <div>
                  <label className="label">Address line 1 *</label>
                  <input name="address_line1" className="input min-h-[44px]" autoComplete="address-line1" required />
                </div>
                <div>
                  <label className="label">Address line 2</label>
                  <input name="address_line2" className="input min-h-[44px]" autoComplete="address-line2" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Landmark</label>
                    <input name="landmark" className="input min-h-[44px]" />
                  </div>
                  <div>
                    <label className="label">City</label>
                    <input name="city" className="input min-h-[44px]" autoComplete="address-level2" />
                  </div>
                  <div>
                    <label className="label">District</label>
                    <input name="district" className="input min-h-[44px]" />
                  </div>
                  <div>
                    <label className="label">State</label>
                    <input name="state" className="input min-h-[44px]" autoComplete="address-level1" />
                  </div>
                </div>
                <div>
                  <label className="label">PIN code *</label>
                  <input name="pin_code" className="input min-h-[44px]" autoComplete="postal-code" inputMode="numeric" required />
                </div>
                <div>
                  <label className="label">Delivery instructions</label>
                  <input name="delivery_instructions" className="input min-h-[44px]" placeholder="Optional notes for the courier" />
                </div>
              </fieldset>
            )}

            <div className="rounded-xl bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-slate-600">Book price</span>
                <span className="font-bold text-slate-900">{rupees(p.sell_price)}</span>
              </div>
              {delivery === 'home' && (
                <p className="mt-1 text-xs text-slate-500">+ delivery charge at confirmation</p>
              )}
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}

            <TermsAgreement checked={acceptTerms} onChange={setAcceptTerms} />

            <button
              type="submit"
              className="btn-primary min-h-[48px] w-full text-base shadow-sm"
              disabled={submitting || outOfStock || !acceptTerms}
            >
              {submitting ? 'Placing order…' : outOfStock ? 'Out of stock' : `Place order · ${rupees(p.sell_price)}`}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
