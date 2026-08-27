import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Download, PhoneCall } from 'lucide-react';
import { OrderSummary } from '@/features/checkout/OrderSummary';
import { api, unwrap } from '@/lib/api';
import { bookCheckout, type CheckoutResult } from '@/features/shop/bookCheckout';
import { TermsAgreement } from '@/components/TermsAgreement';
import { FirstMonthChoice } from '@/features/checkout/FirstMonthChoice';

/**
 * Step 3 of the membership journey: Selected Membership + SpeakEdge Book ->
 * Checkout -> Place Order -> Razorpay. Both entry routes (Choose Your
 * Membership, and Book Shop -> SpeakEdge Book) land here with ?plan=.
 * The book itself is resolved server-side, so the caller never carries its id.
 * Membership is not sold by term: `months` only sets subscription validity.
 *
 * When no SpeakEdge Book is configured (or it is out of stock) this becomes a
 * membership-only checkout rather than a dead end — the backend then charges no
 * book price or delivery, and the address is kept as the billing record.
 *
 * `?offer=` is a new-student offer link (see OfferLinkPage): while it is live
 * the admission fee is charged at the offer price instead. The token is only
 * passed on once the server has confirmed the offer, so a lapsed link simply
 * falls back to the regular price rather than failing the order.
 */

interface Plan {
  plan: string;
  label: string;
  durations: number[];
  prices: Record<string, number>;
  amount: number;
  offer_price: number | null;
  monthly_fee: number;
  classes_per_week: number;
  conversation_per_week: number;
  community_years: number;
  support_years: number;
  cefr_tests: number;
  speaking_tests: number;
}

interface Offer {
  token: string;
  plan: string;
  label: string;
  price: number;      // paise — discounted admission fee
  list_price: number; // paise — the regular fee it discounts from
  expires_at: string; // UTC instant the link lapses
}

interface Book {
  id: string;
  name: string;
  version: string;
  language: string;
  description?: string | null;
  cover_image_url?: string | null;
  sell_price: number;
  gst_rate?: number;
  available: number;
  /** Paise charged for home delivery (server-owned, shown in the summary). */
  delivery_charge: number;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
// Joining charges the one-time admission fee only — any monthly fee is billed
// separately, so it is never rolled into this order.
const priceFor = (p: Plan, months: number) =>
  p.prices?.[String(months)] || (p.offer_price ?? p.amount);

export function CheckoutPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const offerToken = params.get('offer') ?? '';
  const requested = Number(params.get('months')) || 12;

  // An expired or unknown token 404s; the checkout then just runs at the
  // regular price rather than stranding a buyer who is ready to pay.
  const { data: offer, isPending: offerPending } = useQuery({
    queryKey: ['admission-offer', offerToken],
    queryFn: () => unwrap<Offer>(api.get(`/payments/admission-offers/${offerToken}`)),
    enabled: !!offerToken,
    retry: false,
  });
  const planKey = params.get('plan') || offer?.plan || '';

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => unwrap<Plan[]>(api.get('/payments/plans')),
  });
  // Optional: no SpeakEdge Book configured -> membership-only checkout.
  const { data: available, isPending: bookPending } = useQuery({
    queryKey: ['speakedge-book'],
    queryFn: () => unwrap<Book>(api.get('/books/speakedge')),
    retry: false,
  });
  // An inventory problem must not stop someone joining: when the book is out of
  // stock the order becomes membership-only and the book is sent on separately.
  const outOfStock = !!available && available.available <= 0;
  const book = outOfStock ? undefined : available;

  const [delivery, setDelivery] = useState<'home' | 'office'>('home');
  // Tiers with a monthly fee collect the first month upfront by default; the
  // learner can switch to admission-only in FirstMonthChoice.
  const [firstMonth, setFirstMonth] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [phone, setPhone] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  const plan = plans.find((p) => p.plan === planKey);
  const months = plan?.durations?.includes(requested) ? requested : plan?.durations?.[0] ?? requested;
  // The offer only applies to the plan it was created for.
  const liveOffer = offer && offer.plan === planKey ? offer : null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const get = (k: string) => (f.get(k) as string) || undefined;
    try {
      const res = await bookCheckout({
        product_id: book?.id,
        plan: planKey,
        months,
        buyer_name: f.get('buyer_name') as string,
        phone: f.get('phone') as string,
        email: get('email'),
        // Nothing to deliver on a membership-only order.
        delivery_type: book ? delivery : 'office',
        alt_phone: get('alt_phone'),
        address_line1: get('address_line1'),
        address_line2: get('address_line2'),
        landmark: get('landmark'),
        city: get('city'),
        district: get('district'),
        state: get('state'),
        pin_code: get('pin_code'),
        delivery_instructions: get('delivery_instructions'),
        include_first_month: firstMonth,
        offer: liveOffer?.token,
        accept_terms: acceptTerms,
      });
      setPhone(f.get('phone') as string);
      setResult(res);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
      // The offer may have lapsed between opening the page and paying, which is
      // what the server just refused on. Re-check it so the summary drops to the
      // regular price instead of still quoting one the order cannot be placed at.
      if (offerToken) qc.invalidateQueries({ queryKey: ['admission-offer', offerToken] });
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Step 4: Order Confirmation ----------------------------------------
  if (result) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card text-center">
          <CheckCircle2 size={44} className="mx-auto text-green-600" />
          <h1 className="mt-3 text-2xl font-extrabold text-brand">
            {result.paid ? 'Payment Confirmed' : 'Order Placed Successfully'}
          </h1>
          <p className="mt-2 text-slate-600">
            Your order number is <span className="font-mono font-bold">{result.order_number}</span>.
          </p>

          <div className="mt-5 space-y-1 text-left text-sm text-slate-600">
            {result.plan_amount > 0 && (
              <div className="flex justify-between">
                <span>{plan?.label ?? result.plan} Membership (one-time admission fee)</span>
                <span>{rupees(result.plan_amount)}</span>
              </div>
            )}
            {result.first_month_amount > 0 && (
              <div className="flex justify-between">
                <span>{plan?.label ?? result.plan} first month fee</span>
                <span>{rupees(result.first_month_amount)}</span>
              </div>
            )}
            {book && (
              <>
                <div className="flex justify-between">
                  <span>SpeakEdge Book</span><span className="text-emerald-600">Included</span>
                </div>
                <div className="flex justify-between">
                  <span>Delivery</span>
                  <span>{result.delivery_charge ? rupees(result.delivery_charge) : 'Free (pickup)'}</span>
                </div>
              </>
            )}
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-base font-bold text-slate-900">
              <span>{result.paid ? 'Total paid' : 'Total due'}</span><span>{rupees(result.amount)}</span>
            </div>
          </div>

          {/* The code is the buyer's next step, so it goes here rather than
              making them look it up on the tracking page. */}
          {result.activation_code && (
            <div className="mt-5 rounded-xl border border-brand-gold/40 bg-brand-gold/10 p-4 text-left">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand">
                Your activation code
              </div>
              <div className="mt-1 font-mono text-xl font-bold text-slate-900">
                {result.activation_code}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {book
                  ? 'This code is also printed inside your SpeakEdge Book. Use it to create your account whenever you are ready.'
                  : 'Use this code to create your account and complete your registration.'}
              </p>
              <Link
                to={`/activate?code=${encodeURIComponent(result.activation_code)}`}
                className="btn-primary mt-3 inline-block"
              >
                Activate my membership
              </Link>
            </div>
          )}

          <a
            href={`/api/v1/books/receipt/${encodeURIComponent(result.order_number)}?phone=${encodeURIComponent(phone)}`}
            className="btn-ghost mt-5 inline-flex items-center gap-2"
          >
            <Download size={16} /> Download PDF Receipt
          </a>

          <div className="mt-5 flex gap-3 rounded-xl border border-brand/20 bg-brand/5 p-4 text-left">
            <PhoneCall size={18} className="mt-0.5 shrink-0 text-brand" />
            <p className="text-sm text-slate-700">
              Our executive will contact you by phone at the number provided
              <strong> within 48 hours</strong> to guide you through the next step.
            </p>
          </div>

          <Link to={`/track?order=${result.order_number}`} className="btn-ghost mt-4 inline-block">
            Track this order
          </Link>
        </div>
      </div>
    );
  }

  if (plansLoading || bookPending || (!!offerToken && offerPending))
    return <p className="text-slate-500">Loading checkout…</p>;

  if (!plan) {
    return (
      <div className="card mx-auto max-w-lg text-center">
        <h1 className="text-xl font-bold">Choose your membership first</h1>
        <p className="mt-2 text-slate-600">
          Membership is Step 1 of the SpeakEdge journey. Pick a plan and we&apos;ll bring you
          straight back here with your SpeakEdge Book.
        </p>
        <Link to="/plans" className="btn-primary mt-4 inline-block">Choose Your Membership</Link>
      </div>
    );
  }

  const planPrice = liveOffer ? liveOffer.price : priceFor(plan, months);

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Checkout</h1>
      <p className="mt-2 text-slate-600">
        {book
          ? 'Your SpeakEdge Book is included with your membership — one order, one payment.'
          : `Pay the one-time fee to join — your ${plan.label} membership starts once the payment is confirmed.`}
      </p>

      {outOfStock && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          The SpeakEdge Book is temporarily out of stock, so it is not part of this order and
          nothing is being delivered. Our team will arrange your copy and contact you
          about it within 48 hours.
        </p>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <OrderSummary
          plan={plan}
          planPrice={planPrice}
          book={book}
          delivery={delivery}
          deliveryCharge={book?.delivery_charge ?? 0}
          firstMonth={firstMonth ? plan.monthly_fee : 0}
          offer={liveOffer && { listPrice: liveOffer.list_price, expiresAt: liveOffer.expires_at }}
        />

        {/* Buyer + delivery */}
        <form onSubmit={onSubmit} className="card grid gap-3 self-start">
          <h2 className="text-lg font-bold">Your details</h2>
          <div>
            <label className="label">Full name *</label>
            <input name="buyer_name" className="input" required />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Phone *</label>
              <input name="phone" className="input" required />
            </div>
            <div>
              <label className="label">Alt. phone</label>
              <input name="alt_phone" className="input" />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" />
          </div>
          <p className="-mt-1 text-xs text-slate-400">
            Our executive calls this number within 48 hours of your order.
          </p>

          {/* Nothing ships on a membership-only order, so the address is
              collected as the billing address instead. */}
          {book ? (
            <div>
              <label className="label">Delivery</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" name="delivery_type" checked={delivery === 'home'} onChange={() => setDelivery('home')} />
                  Home delivery
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="delivery_type" checked={delivery === 'office'} onChange={() => setDelivery('office')} />
                  Office pickup
                </label>
              </div>
            </div>
          ) : (
            <h2 className="mt-2 text-lg font-bold">Billing address</h2>
          )}

          {(!book || delivery === 'home') && (
            <div className="grid gap-3">
              <div>
                <label className="label">Address line 1 *</label>
                <input name="address_line1" className="input" required />
              </div>
              <div>
                <label className="label">Address line 2</label>
                <input name="address_line2" className="input" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="label">Landmark</label>
                  <input name="landmark" className="input" />
                </div>
                <div>
                  <label className="label">City</label>
                  <input name="city" className="input" />
                </div>
                <div>
                  <label className="label">District</label>
                  <input name="district" className="input" />
                </div>
                <div>
                  <label className="label">State</label>
                  <input name="state" className="input" />
                </div>
              </div>
              <div>
                <label className="label">PIN code *</label>
                <input name="pin_code" className="input" required />
              </div>
              {book && (
                <div>
                  <label className="label">Delivery instructions</label>
                  <input name="delivery_instructions" className="input" />
                </div>
              )}
            </div>
          )}

          <FirstMonthChoice
            monthlyFee={plan.monthly_fee}
            admission={planPrice}
            value={firstMonth}
            onChange={setFirstMonth}
          />

          <TermsAgreement checked={acceptTerms} onChange={setAcceptTerms} />

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary" disabled={submitting || !acceptTerms}>
            {submitting ? 'Opening payment…' : 'Pay now'}
          </button>
          {!acceptTerms && (
            <p className="-mt-2 text-xs text-slate-500">
              Please accept the Terms &amp; Conditions to continue.
            </p>
          )}
          <p className="text-xs text-slate-400">
            You&apos;ll pay securely via Razorpay. After payment you can download your receipt
            {book ? ', and' : ' and see your activation code on the order page;'} your membership is
            activated once our executive completes your onboarding.
          </p>
        </form>
      </div>
    </div>
  );
}
