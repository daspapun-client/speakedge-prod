import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, CheckCircle2, Download, PhoneCall } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { bookCheckout, type CheckoutResult } from '@/features/shop/bookCheckout';
import { TermsAgreement } from '@/components/TermsAgreement';

/**
 * Step 3 of the membership journey: Selected Membership + SpeakEdge Book ->
 * Checkout -> Place Order -> Razorpay. Both entry routes (Choose Your
 * Membership, and Book Shop -> SpeakEdge Book) land here with ?plan=.
 * The book itself is resolved server-side, so the caller never carries its id.
 * Membership is not sold by term: `months` only sets subscription validity.
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

interface Book {
  id: string;
  name: string;
  version: string;
  language: string;
  description?: string | null;
  cover_image_url?: string | null;
  sell_price: number;
  available: number;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
// Joining charges the one-time admission fee only — any monthly fee is billed
// separately, so it is never rolled into this order.
const priceFor = (p: Plan, months: number) =>
  p.prices?.[String(months)] || (p.offer_price ?? p.amount);

export function CheckoutPage() {
  const [params] = useSearchParams();
  const planKey = params.get('plan') ?? '';
  const requested = Number(params.get('months')) || 12;

  const { data: plans = [], isLoading: plansLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => unwrap<Plan[]>(api.get('/payments/plans')),
  });
  const { data: book, isLoading: bookLoading, error: bookError } = useQuery({
    queryKey: ['speakedge-book'],
    queryFn: () => unwrap<Book>(api.get('/books/speakedge')),
    retry: false,
  });

  const [delivery, setDelivery] = useState<'home' | 'office'>('home');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [phone, setPhone] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  const plan = plans.find((p) => p.plan === planKey);
  const months = plan?.durations?.includes(requested) ? requested : plan?.durations?.[0] ?? requested;

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
      setPhone(f.get('phone') as string);
      setResult(res);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
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
          <h1 className="mt-3 text-2xl font-extrabold text-brand">Order Placed Successfully</h1>
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
            <div className="flex justify-between"><span>SpeakEdge Book</span><span>{rupees(result.book_amount)}</span></div>
            {result.gst_amount > 0 && (
              <div className="flex justify-between"><span>GST</span><span>{rupees(result.gst_amount)}</span></div>
            )}
            <div className="flex justify-between">
              <span>Delivery</span>
              <span>{result.delivery_charge ? rupees(result.delivery_charge) : 'Free (pickup)'}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-base font-bold text-slate-900">
              <span>Total paid</span><span>{rupees(result.amount)}</span>
            </div>
          </div>

          <a
            href={`/api/v1/books/receipt/${encodeURIComponent(result.order_number)}?phone=${encodeURIComponent(phone)}`}
            className="btn-primary mt-5 inline-flex items-center gap-2"
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

  if (plansLoading || bookLoading) return <p className="text-slate-500">Loading checkout…</p>;

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

  if (!book) {
    return (
      <div className="card mx-auto max-w-lg text-center">
        <h1 className="text-xl font-bold">The SpeakEdge Book is unavailable</h1>
        <p className="mt-2 text-slate-600">
          {(bookError as Error | null)?.message ?? 'Please check back shortly.'}
        </p>
        <Link to="/plans" className="btn-ghost mt-4 inline-block">Back to membership plans</Link>
      </div>
    );
  }

  const planPrice = priceFor(plan, months);
  const outOfStock = book.available <= 0;

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Checkout</h1>
      <p className="mt-2 text-slate-600">
        Your membership and the SpeakEdge Book are purchased together in a single order.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        {/* Order summary */}
        <div className="card self-start">
          <h2 className="text-lg font-bold">Order summary</h2>

          <div className="mt-4 border-b border-slate-100 pb-4">
            <div className="flex justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">{plan.label} Membership</div>
                <div className="text-xs text-slate-500">One-time admission fee</div>
              </div>
              <div className="font-semibold">{rupees(planPrice)}</div>
            </div>
            {plan.monthly_fee > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Plus {rupees(plan.monthly_fee)}/month, billed separately — not part of this order.
              </p>
            )}
            <ul className="mt-3 space-y-1 text-xs text-slate-500">
              <li>
                {plan.classes_per_week > 0
                  ? `${plan.classes_per_week} teacher-led class${plan.classes_per_week === 1 ? '' : 'es'} / week`
                  : 'AI-guided learning based on the SpeakEdge Book'}
              </li>
              <li>
                {plan.conversation_per_week > 0
                  ? `${plan.conversation_per_week} conversation teams + unlimited individual speaking partners`
                  : 'Unlimited individual speaking partners'}
              </li>
              {plan.cefr_tests > 0 && (
                <li>{plan.cefr_tests} CEFR · {plan.speaking_tests} Speaking test{plan.speaking_tests === 1 ? '' : 's'}</li>
              )}
              <li>Community access for {plan.community_years} year{plan.community_years === 1 ? '' : 's'}</li>
              {plan.support_years > 0 && (
                <li>Student relation support for {plan.support_years} years</li>
              )}
            </ul>
            <Link to="/plans" className="mt-3 inline-block text-xs font-medium text-brand hover:underline">
              Change plan
            </Link>
          </div>

          <div className="mt-4 flex gap-3">
            <div className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100">
              {book.cover_image_url ? (
                <img src={book.cover_image_url} alt={book.name} className="h-full w-full rounded-lg object-cover" />
              ) : (
                <BookOpen size={24} className="text-slate-300" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex justify-between gap-3">
                <div className="font-semibold text-slate-900">{book.name}</div>
                <div className="font-semibold">{rupees(book.sell_price)}</div>
              </div>
              <div className="text-xs text-slate-500">{book.version} · {book.language}</div>
              {book.description && <p className="mt-1 line-clamp-3 text-xs text-slate-500">{book.description}</p>}
            </div>
          </div>

          <div className="mt-4 space-y-1 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <div className="flex justify-between"><span>Membership</span><span>{rupees(planPrice)}</span></div>
            <div className="flex justify-between"><span>SpeakEdge Book</span><span>{rupees(book.sell_price)}</span></div>
            <div className="flex justify-between">
              <span>Delivery</span>
              <span className="text-slate-400">{delivery === 'home' ? 'Added at payment' : 'Free (pickup)'}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Subtotal</span><span>{rupees(planPrice + book.sell_price)}</span>
            </div>
          </div>
        </div>

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

          {delivery === 'home' && (
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
              <div>
                <label className="label">Delivery instructions</label>
                <input name="delivery_instructions" className="input" />
              </div>
            </div>
          )}

          <TermsAgreement checked={acceptTerms} onChange={setAcceptTerms} />

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary" disabled={submitting || outOfStock || !acceptTerms}>
            {submitting ? 'Placing order…' : outOfStock ? 'Book out of stock' : 'Place Order'}
          </button>
          {!acceptTerms && (
            <p className="-mt-2 text-xs text-slate-500">
              Please accept the Terms &amp; Conditions to continue.
            </p>
          )}
          <p className="text-xs text-slate-400">
            You&apos;ll pay securely via Razorpay. After payment you can download your receipt, and
            your membership is activated once our executive completes your onboarding.
          </p>
        </form>
      </div>
    </div>
  );
}
