import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, BookOpen, Building2, CheckCircle2, Download, Home, Languages, Package,
  ShoppingBag, Truck,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { TermsAgreement } from '@/components/TermsAgreement';
import { bookCheckout, type CheckoutResult } from '@/features/shop/bookCheckout';
import bookCoverUrl from '@/asset/speakedge-book-cover.png';
import iconUrl from '@/asset/logo-icon.png';

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

const versionLabel = (v: string) =>
  v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function ProductBookFallback({
  name,
  version,
  language,
  speakedge,
}: {
  name: string;
  version: string;
  language: string;
  speakedge: boolean;
}) {
  return (
    <div className="book-3d book-3d-gallery" aria-hidden>
      <div className="book-3d-ambient" />
      <div className="book-3d-glow" />
      <div className="book-3d-scene">
        <div className="book-3d-cover">
          {speakedge ? (
            <img src={bookCoverUrl} alt="" draggable={false} />
          ) : (
            <div className="relative flex h-full w-full flex-col bg-[#071a36]">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgba(56,189,248,0.45)_1px,transparent_1px)] [background-size:16px_16px]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_45%_at_50%_-8%,rgba(47,128,237,0.45),transparent_58%)]"
              />
              <div className="relative flex h-full flex-col px-5 py-6 sm:px-6 sm:py-7">
                <img
                  src={iconUrl}
                  alt=""
                  className="h-9 w-9 rounded-lg bg-white p-0.5 shadow-sm ring-1 ring-white/20 sm:h-11 sm:w-11"
                />
                <p className="mt-7 text-[9px] font-semibold uppercase tracking-[0.22em] text-brand-gold sm:mt-9 sm:text-[10px]">
                  {versionLabel(version)}
                </p>
                <p className="mt-1.5 line-clamp-4 text-[1.15rem] font-extrabold leading-snug tracking-tight text-white sm:text-2xl">
                  {name}
                </p>
                <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-sky-200/70 sm:text-[11px]">
                  {language}
                </p>
                <div className="mt-auto">
                  <div className="mb-3 h-px w-10 bg-gradient-to-r from-brand-gold to-transparent" />
                  <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55 sm:text-[10px]">
                    Sujyoti Publications
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="book-3d-cover-shine" />
        </div>
        <div className="book-3d-cover-lip" />
        <div className="book-3d-spine">
          <span>{name}</span>
        </div>
        <div className="book-3d-pages" />
        <div className="book-3d-fore" />
        <div className="book-3d-top" />
        <div className="book-3d-bottom" />
        <div className="book-3d-back" />
      </div>
      <div className="book-3d-platform" />
      <div className="book-3d-shadow" />
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="animate-pulse space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-10 lg:space-y-0">
      <div className="space-y-5">
        <div className="h-4 w-28 rounded-full bg-slate-200" />
        <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white">
          <div className="aspect-[4/5] max-h-[520px] bg-gradient-to-br from-slate-100 via-white to-brand/5 sm:aspect-auto sm:min-h-80" />
        </div>
        <div className="space-y-3 rounded-3xl border border-slate-100 bg-white p-5">
          <div className="h-3 w-24 rounded-full bg-slate-200" />
          <div className="h-8 w-3/4 rounded-lg bg-slate-200" />
          <div className="h-10 w-40 rounded-lg bg-slate-200" />
        </div>
      </div>
      <div className="h-96 rounded-3xl bg-slate-200" />
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
  // Kept for the receipt link on the confirmation screen — the buyer is a guest,
  // so the phone is what proves the order is theirs.
  const [phone, setPhone] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const allImages = useMemo(
    () =>
      [...new Set([p?.cover_image_url, ...(p?.gallery ?? [])].filter(Boolean) as string[])].filter(
        (url) => !broken.has(url),
      ),
    [p?.cover_image_url, p?.gallery, broken],
  );

  useEffect(() => {
    setActiveImage(0);
    setBroken(new Set());
  }, [id]);

  const markBroken = (url: string) =>
    setBroken((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));

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
      setPhone(f.get('phone') as string);
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

  if (result) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="card overflow-hidden p-0 text-center">
          <div className="bg-gradient-to-b from-brand/10 to-white px-6 pb-2 pt-8">
            <CheckCircle2 size={48} className="mx-auto text-green-600" />
            <h1 className="mt-4 text-2xl font-extrabold text-slate-900">
              {result.paid ? 'Payment confirmed' : 'Order placed'}
            </h1>
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
              {result.paid
                ? delivery === 'office'
                  ? 'Your order is confirmed. Track it below for your pickup OTP.'
                  : 'Your order is confirmed. Track it below for dispatch and courier updates.'
                : 'Your order was saved but is not paid for yet. Finish the payment from the tracking page below to confirm it.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to={`/track?order=${result.order_number}`} className="btn-primary inline-flex">
                Track this order
              </Link>
              <a
                href={`/api/v1/books/receipt/${encodeURIComponent(result.order_number)}?phone=${encodeURIComponent(phone)}`}
                className="btn-ghost inline-flex items-center gap-2"
              >
                <Download size={16} /> Download PDF Receipt
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const outOfStock = p.available <= 0;
  const onSale = p.offer_price != null && p.offer_price < p.price;
  const discountPct = onSale ? Math.round((1 - p.sell_price / p.price) * 100) : 0;
  const shownIndex = allImages.length ? Math.min(activeImage, allImages.length - 1) : 0;
  const shownImage = allImages[shownIndex];
  const description = p.description?.trim();

  return (
    <div className="pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Link
        to="/shop"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-brand"
      >
        <ArrowLeft size={16} />
        Back to shop
      </Link>

      <div className="mt-4 lg:mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-10 xl:gap-14">
        <section className="min-w-0 space-y-5 sm:space-y-6">
          {/* Gallery */}
          <div className="group/gallery overflow-hidden rounded-3xl border border-slate-200/60 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)] ring-1 ring-slate-100/80">
            <div className="relative isolate overflow-visible">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_-10%,rgba(47,128,237,0.12),transparent_55%)]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(244,180,0,0.08),transparent_45%)]"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.4] [background-image:radial-gradient(rgba(148,163,184,0.35)_1px,transparent_1px)] [background-size:20px_20px]"
              />

              <div className="relative flex min-h-[300px] items-center justify-center px-8 py-12 sm:min-h-[420px] sm:px-12 sm:py-14">
                <div className="relative w-full max-w-sm sm:max-w-md">
                  {shownImage ? (
                    <>
                      <div
                        aria-hidden
                        className="absolute -inset-x-8 bottom-2 h-10 rounded-[100%] bg-slate-900/[0.08] blur-2xl transition duration-700 group-hover/gallery:bg-slate-900/[0.12]"
                      />
                      <img
                        src={shownImage}
                        alt={p.name}
                        className={`relative z-10 mx-auto max-h-[min(520px,68vh)] w-full object-contain drop-shadow-[0_24px_48px_rgba(15,23,42,0.18)] transition duration-700 ease-out group-hover/gallery:scale-[1.02] ${
                          outOfStock ? 'opacity-50 grayscale-[25%]' : ''
                        }`}
                        onError={() => markBroken(shownImage)}
                      />
                    </>
                  ) : (
                    <ProductBookFallback
                      name={p.name}
                      version={p.version}
                      language={p.language}
                      speakedge={p.is_speakedge_book}
                    />
                  )}
                </div>

                <div className="absolute left-5 top-5 z-20 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-700 shadow-[0_2px_12px_rgba(15,23,42,0.08)] backdrop-blur-md">
                    <Languages size={12} className="shrink-0 text-brand/70" strokeWidth={2.25} />
                    {p.language}
                  </span>
                  {onSale && (
                    <span className="inline-flex items-center rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 px-3 py-1.5 text-[11px] font-bold tabular-nums tracking-tight text-white shadow-[0_4px_14px_rgba(16,185,129,0.35)]">
                      −{discountPct}% off
                    </span>
                  )}
                </div>

                {allImages.length > 1 && (
                  <span className="absolute bottom-5 right-5 z-20 rounded-full border border-white/20 bg-slate-900/55 px-3 py-1 text-[11px] font-medium tabular-nums text-white backdrop-blur-md">
                    {shownIndex + 1} / {allImages.length}
                  </span>
                )}

                {outOfStock && (
                  <span className="absolute inset-x-5 bottom-5 z-20 rounded-2xl border border-white/10 bg-slate-900/75 py-3 text-center text-xs font-semibold tracking-wide text-white backdrop-blur-md">
                    Out of stock
                  </span>
                )}
              </div>
            </div>

            {allImages.length > 1 && (
              <div className="flex snap-x snap-mandatory gap-2.5 overflow-x-auto border-t border-slate-100/80 bg-slate-50/90 px-4 py-3.5 sm:px-5">
                {allImages.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    aria-label={`View image ${i + 1}`}
                    aria-pressed={i === shownIndex}
                    className={`snap-start shrink-0 overflow-hidden rounded-xl border-2 bg-white p-1 transition duration-200 ${
                      i === shownIndex
                        ? 'border-brand shadow-[0_4px_12px_rgba(47,128,237,0.2)] ring-2 ring-brand/20'
                        : 'border-transparent opacity-70 hover:border-slate-300 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={url}
                      alt=""
                      className="h-16 w-14 object-contain sm:h-[4.5rem] sm:w-[4rem]"
                      onError={() => markBroken(url)}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Product info */}
          <div className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand">
                {versionLabel(p.version)}
              </span>
              {!outOfStock && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  In stock
                </span>
              )}
              <span className="ml-auto font-mono text-[11px] font-medium uppercase tracking-wider text-slate-400">
                {p.sku}
              </span>
            </div>

            <h1 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-3xl">
              {p.name}
            </h1>

            <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-slate-100 pb-5">
              <span className="text-3xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-4xl">
                {rupees(p.sell_price)}
              </span>
              {p.gst_rate > 0 && (
                <span className="pb-1 text-base font-medium text-slate-500 sm:text-lg">
                  + {p.gst_rate}% GST
                </span>
              )}
              {onSale && (
                <>
                  <span className="pb-1 text-lg tabular-nums text-slate-400 line-through">
                    {rupees(p.price)}
                  </span>
                  <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    Save {rupees(p.price - p.sell_price)}
                  </span>
                </>
              )}
            </div>

            {description ? (
              <div className="mt-5">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <BookOpen size={16} />
                  </div>
                  <h2 className="text-sm font-semibold text-slate-900">About this book</h2>
                </div>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-600">
                  {description}
                </p>
              </div>
            ) : (
              <p className="mt-5 text-sm leading-relaxed text-slate-500">
                A curated title from Sujyoti Publications — order below for home delivery or free office pickup.
              </p>
            )}
          </div>

          {/* Mobile order summary strip */}
          <div className="flex items-center gap-3 rounded-2xl border border-brand/15 bg-gradient-to-r from-brand/5 to-white p-4 shadow-sm lg:hidden">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <ShoppingBag size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">Ready to order?</p>
              <p className="text-xs text-slate-500">Complete checkout on the right.</p>
            </div>
            <span className="shrink-0 text-lg font-bold tabular-nums text-brand">{rupees(p.sell_price)}</span>
          </div>
        </section>

        {/* Checkout — the SpeakEdge Book is only ever sold with a membership,
            so it gets a route to the plans page instead of a payment form. */}
        <aside className="mt-8 lg:mt-0">
          {p.is_speakedge_book ? (
            <div className="card space-y-4 border-slate-200/80 p-4 shadow-md sm:p-6 lg:sticky lg:top-24">
              <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-gold/20 text-brand">
                  <BookOpen size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Included with membership</h2>
                  <p className="text-xs text-slate-500">Not sold separately</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-slate-600">
                The SpeakEdge Book comes with your SpeakEdge membership. Choose a membership plan
                and your copy is arranged at checkout — home delivery or free office pickup.
              </p>
              <Link to="/plans" className="btn-primary min-h-[48px] w-full text-base shadow-sm">
                View membership plans
              </Link>
            </div>
          ) : (
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
              {submitting ? 'Opening payment…' : outOfStock ? 'Out of stock' : `Pay now · ${rupees(p.sell_price)}`}
            </button>
          </form>
          )}
        </aside>
      </div>
    </div>
  );
}
