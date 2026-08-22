import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { OrderSummary } from '@/features/checkout/OrderSummary';
import { api, unwrap } from '@/lib/api';
import { startSubscriptionCheckout } from '@/features/payments/checkout';
import { TermsAgreement } from '@/components/TermsAgreement';
import { FirstMonthChoice } from '@/features/checkout/FirstMonthChoice';

/**
 * Membership checkout for a signed-in member (Subscribe on /plans, renewals).
 * Same shape as the book checkout — order summary on the left, contact and
 * address on the right — and the SpeakEdge Book ships with the membership here
 * too, so the address doubles as the delivery address. Paying creates the
 * Subscription server-side and the member lands on their dashboard.
 *
 * The book is dropped (and no delivery charged) whenever none is configured or
 * it is out of stock, so an inventory problem never blocks a membership. Guests
 * take the bundled route instead (/checkout), which is the same purchase made
 * before an account exists.
 */

interface Plan {
  plan: string;
  label: string;
  amount: number;
  offer_price: number | null;
  monthly_fee: number;
  durations: number[];
  prices: Record<string, number>;
  classes_per_week: number;
  conversation_per_week: number;
  community_years: number;
  support_years: number;
  cefr_tests: number;
  speaking_tests: number;
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
  /** Paise charged for home delivery (server-owned). */
  delivery_charge: number;
}

interface UpgradeQuote {
  is_upgrade: boolean;
  previous_plan: string | null;
  previous_label: string | null;
  admission: number;
  adjustment: number;
  payable: number;
  /** How far ahead the upgraded membership may be scheduled (server-owned). */
  activation_days: number;
  /** Set when checkout was opened from a dashboard exclusive offer. */
  offer_id?: string | null;
  list_price?: number | null;
  offer_expires_at?: string | null;
}

interface Profile {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
  pin_code?: string | null;
}

const MEMBERSHIP_MONTHS = 12;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
// The upfront charge is the one-time admission fee; a monthly fee is billed
// separately and is never rolled into this order.
const priceFor = (p: Plan, months: number) =>
  p.prices?.[String(months)] || (p.offer_price ?? p.amount);

export function MembershipCheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const planKey = params.get('plan') ?? '';
  const offerId = params.get('offer') ?? '';
  const requested = Number(params.get('months')) || MEMBERSHIP_MONTHS;

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => unwrap<Plan[]>(api.get('/payments/plans')),
  });
  // Prefill from the member's profile; a non-student session simply gets none.
  // The form is uncontrolled, so it must not render before this settles.
  const { data: profile, isPending: profilePending } = useQuery({
    queryKey: ['dashboard-profile'],
    queryFn: () => unwrap<Profile>(api.get('/dashboard/profile')),
    retry: false,
  });
  // Optional: no SpeakEdge Book configured -> membership-only checkout.
  const { data: available, isPending: bookPending } = useQuery({
    queryKey: ['speakedge-book'],
    queryFn: () => unwrap<Book>(api.get('/books/speakedge')),
    retry: false,
  });
  // Moving up a tier credits the membership already held, and issues no second
  // book — so the price, the copy and the whole delivery block change. A
  // dashboard exclusive offer replaces the payable with the admin-set amount.
  const { data: quote, isPending: quotePending, isError: quoteError, error: quoteErr } = useQuery({
    queryKey: ['upgrade-quote', planKey, offerId],
    queryFn: () =>
      unwrap<UpgradeQuote>(api.get('/payments/upgrade-quote', {
        params: { plan: planKey, ...(offerId ? { offer: offerId } : {}) },
      })),
    enabled: !!planKey,
    retry: false,
  });
  const upgrading = !!quote?.is_upgrade;
  const offered = !!quote?.offer_id;
  const outOfStock = !upgrading && !offered && !!available && available.available <= 0;
  const book = upgrading || offered || outOfStock ? undefined : available;

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [delivery, setDelivery] = useState<'home' | 'office'>('home');
  // Tiers with a monthly fee collect the first month upfront by default.
  const [firstMonth, setFirstMonth] = useState(true);
  // Upgrades only: when the new tier takes over. Blank = as soon as paid.
  const [activateOn, setActivateOn] = useState('');

  const plan = plans.find((p) => p.plan === planKey);
  const months = plan?.durations?.includes(requested) ? requested : plan?.durations?.[0] ?? requested;

  // Straight to the dashboard once the membership is live, as promised on the
  // confirmation card.
  useEffect(() => {
    if (!paid) return;
    const t = setTimeout(() => navigate('/dashboard'), 2500);
    return () => clearTimeout(t);
  }, [paid, navigate]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    const f = new FormData(e.currentTarget);
    const get = (k: string) => (f.get(k) as string)?.trim() || undefined;
    try {
      const res = await startSubscriptionCheckout({
        plan: planKey,
        months,
        accept_terms: acceptTerms,
        include_first_month: firstMonth,
        // Upgrades may start later; everything else starts on payment.
        activate_on: upgrading && activateOn ? activateOn : undefined,
        // Omitted when there is nothing to ship: the backend then charges no
        // book price and no delivery, and keeps the address as billing only.
        delivery_type: book ? delivery : undefined,
        offer: offerId || undefined,
        billing: {
          name: f.get('name') as string,
          phone: f.get('phone') as string,
          alt_phone: get('alt_phone'),
          email: get('email'),
          address_line1: get('address_line1'),
          address_line2: get('address_line2'),
          landmark: get('landmark'),
          city: get('city'),
          district: get('district'),
          state: get('state'),
          pin_code: get('pin_code'),
        },
      });
      if (res.paid) {
        // The subscription and invoice were created during verification.
        qc.invalidateQueries();
        setPaid(true);
        window.scrollTo({ top: 0 });
      } else {
        setNotice('Payment was cancelled — nothing was charged. You can pay again below.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (paid) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="card text-center">
          <CheckCircle2 size={44} className="mx-auto text-green-600" />
          <h1 className="mt-3 text-2xl font-extrabold text-brand">Payment Confirmed</h1>
          <p className="mt-2 text-slate-600">
            {upgrading && activateOn && activateOn !== isoDay(new Date()) ? (
              <>
                Your {plan?.label ?? planKey} membership starts on{' '}
                {new Date(activateOn).toLocaleDateString('en-IN', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
                . Until then your {quote?.previous_label} membership and its benefits continue
                as they are. The invoice is in your dashboard under Payments.
              </>
            ) : (
              <>
                Your {plan?.label ?? planKey} membership is active. The invoice is in your
                dashboard under Payments.
              </>
            )}
          </p>
          <p className="mt-4 text-sm text-slate-500">Taking you to your dashboard…</p>
          <Link to="/dashboard" className="btn-primary mt-4 inline-block">
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading || profilePending || bookPending || quotePending)
    return <p className="text-slate-500">Loading checkout…</p>;

  if (offerId && quoteError) {
    return (
      <div className="card mx-auto max-w-lg text-center">
        <h1 className="text-xl font-bold">This offer is no longer available</h1>
        <p className="mt-2 text-slate-600">
          {(quoteErr as Error)?.message || 'The special price has expired or does not apply to this membership.'}
        </p>
        <Link to="/plans" className="btn-primary mt-4 inline-block">Choose Your Membership</Link>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="card mx-auto max-w-lg text-center">
        <h1 className="text-xl font-bold">Choose your membership first</h1>
        <p className="mt-2 text-slate-600">
          Pick a plan and we&apos;ll bring you straight back here to complete the payment.
        </p>
        <Link to="/plans" className="btn-primary mt-4 inline-block">Choose Your Membership</Link>
      </div>
    );
  }

  // Server-priced: upgrade quote nets the credit; a live member offer replaces
  // that payable with the admin-set amount so the page matches what is charged.
  const planPrice = quote ? quote.payable : priceFor(plan, months);
  const liveOffer = offered && quote?.list_price
    ? { listPrice: quote.list_price, expiresAt: quote.offer_expires_at }
    : null;
  // The upgrade may start today or any day inside the window the server allows.
  const minActivation = isoDay(new Date());
  const maxActivation = isoDay(
    new Date(Date.now() + (quote?.activation_days ?? 30) * 86_400_000),
  );

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Checkout</h1>
      <p className="mt-2 text-slate-600">
        {offered
          ? `Confirm your details to take this exclusive ${plan.label} offer.`
          : upgrading
            ? `Confirm your details to upgrade from ${quote!.previous_label} to ${plan.label}. You pay only the difference between the standard prices of the two memberships.`
            : book
              ? `Confirm your details to start your ${plan.label} membership — your SpeakEdge Book is included in this order.`
              : `Confirm your details and pay the one-time fee to start your ${plan.label} membership.`}
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
          months={months}
          book={book}
          delivery={delivery}
          deliveryCharge={book?.delivery_charge ?? 0}
          firstMonth={!upgrading && !offered && firstMonth ? plan.monthly_fee : 0}
          upgrade={
            upgrading && !offered
              ? {
                  previousLabel: quote!.previous_label ?? 'your previous membership',
                  admission: quote!.admission,
                  adjustment: quote!.adjustment,
                }
              : null
          }
          offer={liveOffer}
        />

        {/* Buyer + billing address */}
        <form onSubmit={onSubmit} className="card grid gap-3 self-start">
          <h2 className="text-lg font-bold">Your details</h2>
          <div>
            <label className="label">Full name *</label>
            <input name="name" className="input" defaultValue={profile?.full_name ?? ''} required />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Phone *</label>
              <input name="phone" className="input" defaultValue={profile?.phone ?? ''} required />
            </div>
            <div>
              <label className="label">Alt. phone</label>
              <input name="alt_phone" className="input" />
            </div>
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" defaultValue={profile?.email ?? ''} />
          </div>

          {/* With a book in the order the address is where it ships; without
              one there is nothing to deliver, so it is a billing record. */}
          {book ? (
            <div className="mt-2">
              <label className="label">Delivery</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="delivery_type"
                    checked={delivery === 'home'}
                    onChange={() => setDelivery('home')}
                  />
                  Home delivery ({rupees(book.delivery_charge)})
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="delivery_type"
                    checked={delivery === 'office'}
                    onChange={() => setDelivery('office')}
                  />
                  Office pickup (free)
                </label>
              </div>
            </div>
          ) : null}

          <h2 className="mt-2 text-lg font-bold">
            {book && delivery === 'home' ? 'Delivery address' : 'Billing address'}
          </h2>
          <div>
            <label className="label">Address line 1 *</label>
            <input name="address_line1" className="input" defaultValue={profile?.address ?? ''} required />
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
              <input name="district" className="input" defaultValue={profile?.district ?? ''} />
            </div>
            <div>
              <label className="label">State</label>
              <input name="state" className="input" defaultValue={profile?.state ?? ''} />
            </div>
          </div>
          <div>
            <label className="label">PIN code *</label>
            <input name="pin_code" className="input" defaultValue={profile?.pin_code ?? ''} required />
          </div>

          <FirstMonthChoice
            monthlyFee={upgrading || offered ? 0 : plan.monthly_fee}
            admission={planPrice}
            value={firstMonth}
            onChange={setFirstMonth}
          />

          {upgrading && (
            <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-900">Important Upgrade Notice</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Your existing {quote!.previous_label} membership and its benefits remain active
                until the activation date you select. From that date your existing membership is
                deactivated and replaced by the upgraded membership. Any benefits or entitlements
                already used under your existing membership will be deducted from the corresponding
                benefits available under the upgraded membership.
              </p>
              <label className="label mt-3">Activation date</label>
              <input
                type="date"
                className="input"
                value={activateOn}
                min={minActivation}
                max={maxActivation}
                onChange={(e) => setActivateOn(e.target.value)}
              />
              <p className="mt-1 text-xs text-amber-800">
                Any date within {quote!.activation_days} days of payment. Leave it as today to
                upgrade straight away.
              </p>
            </div>
          )}

          <TermsAgreement checked={acceptTerms} onChange={setAcceptTerms} />

          {notice && <p className="text-sm text-amber-600">{notice}</p>}
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
            You&apos;ll pay securely via Razorpay. Your membership starts as soon as the payment is
            confirmed{book ? ', and your SpeakEdge Book is dispatched from there' : ''}.
          </p>
        </form>
      </div>
    </div>
  );
}
