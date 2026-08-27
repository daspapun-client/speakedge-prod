import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Check, ShoppingBag, Truck } from 'lucide-react';
import { planBenefits } from '@/lib/membership';

interface PlanSummary {
  plan: string;
  label: string;
  monthly_fee: number;
  classes_per_week: number;
  conversation_per_week: number;
  community_years: number;
  support_years: number;
  cefr_tests: number;
  speaking_tests: number;
}

interface BookSummary {
  name: string;
  version: string;
  language: string;
  description?: string | null;
  cover_image_url?: string | null;
  sell_price: number;
  gst_rate?: number;
}

export interface OrderSummaryProps {
  plan: PlanSummary;
  planPrice: number;
  months?: number;
  book?: BookSummary | null;
  delivery?: 'home' | 'office';
  /** Paise charged for home delivery; ignored for office pickup. */
  deliveryCharge?: number;
  /** Paise for the first monthly fee when the buyer pays it upfront (else 0). */
  firstMonth?: number;
  /** Set when this is a tier upgrade: the membership being left, the full
   *  admission fee, and the credit for what they already hold. `planPrice` is
   *  already net of the credit. No book ships on an upgrade. */
  upgrade?: { previousLabel: string; admission: number; adjustment: number } | null;
  /** Set when the buyer arrived on a new-student offer link or a dashboard
   *  exclusive offer: the regular fee `planPrice` is discounted from, and
   *  when the price lapses (omitted when the offer has no end date). */
  offer?: { listPrice: number; expiresAt?: string | null } | null;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
// Offers are quoted to the buyer in their own timezone — the API sends an
// explicit UTC instant, so this is a plain local format, never a manual shift.
const offerDeadline = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
const feeLabel = (p: PlanSummary) =>
  p.plan === 'Tribe' ? 'One-time membership fee' : 'One-time admission fee';

export function OrderSummary({
  plan,
  planPrice,
  months,
  book,
  delivery = 'home',
  deliveryCharge = 0,
  firstMonth = 0,
  upgrade = null,
  offer = null,
}: OrderSummaryProps) {
  // Every line the buyer is actually charged for, so the figure here is the
  // figure the gateway opens with — no "added at payment" surprises. The
  // SpeakEdge Book is covered by the membership fee and is never charged on
  // top of it (so no book line and no GST); delivery is a real cost and stays.
  const shipping = book && delivery === 'home' ? deliveryCharge : 0;
  const total = planPrice + firstMonth + shipping;

  return (
    <aside className="self-start overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-100 lg:sticky lg:top-24">
      <div className="border-b border-slate-100 bg-gradient-to-br from-brand/8 via-white to-brand-gold/5 px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand shadow-sm">
            <ShoppingBag size={18} />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">Order summary</h2>
            <p className="text-xs text-slate-500">Secure checkout · SpeakEdge</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <div className="rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50/80 to-white p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className="inline-flex rounded-full bg-brand/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
                Membership
              </span>
              <h3 className="mt-2 text-xl font-extrabold tracking-tight text-slate-900">{plan.label}</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                {upgrade ? `Upgrade from ${upgrade.previousLabel}` : feeLabel(plan)}
              </p>
            </div>
            <span className="shrink-0 text-right">
              {offer && (
                <span className="block text-sm font-medium tabular-nums text-slate-400 line-through">
                  {rupees(offer.listPrice)}
                </span>
              )}
              <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">
                {rupees(planPrice)}
              </span>
            </span>
          </div>

          {offer && (
            <p className="mt-3 rounded-lg bg-brand-gold/15 px-3 py-2 text-xs leading-relaxed text-brand">
              Special offer price — you save{' '}
              <span className="font-semibold">{rupees(offer.listPrice - planPrice)}</span> on the
              regular fee
              {offer.expiresAt ? (
                <>
                  . This price is held until{' '}
                  <span className="font-semibold">{offerDeadline(offer.expiresAt)}</span>, after
                  which the regular fee applies
                </>
              ) : null}
              .
            </p>
          )}

          {upgrade && (
            <p className="mt-3 rounded-lg bg-brand/5 px-3 py-2 text-xs leading-relaxed text-brand">
              The <span className="font-semibold">{rupees(upgrade.adjustment)}</span> you paid for
              your {upgrade.previousLabel} membership is adjusted against this admission fee, so you
              pay only the difference. No second SpeakEdge Book is issued on an upgrade.
            </p>
          )}

          {plan.monthly_fee > 0 && !upgrade && (
            <p
              className={`mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed ${
                firstMonth > 0 ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
              }`}
            >
              {firstMonth > 0 ? (
                <>
                  Your <span className="font-semibold">first month ({rupees(firstMonth)})</span> is
                  included in this order. The next monthly fee falls due two months after your class
                  start date.
                </>
              ) : (
                <>
                  Plus <span className="font-semibold">{rupees(plan.monthly_fee)}/month</span>, billed
                  separately{months ? ' from your class start date' : ''} — not included in this order.
                </>
              )}
            </p>
          )}

          <ul className="mt-4 space-y-2">
            {planBenefits(plan).map((b) => (
              <li key={b} className="flex gap-2.5 text-sm leading-snug text-slate-600">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10">
                  <Check size={12} className="text-brand" strokeWidth={3} />
                </span>
                {b}
              </li>
            ))}
          </ul>

          <Link
            to="/plans"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand transition hover:text-brand-light"
          >
            <ArrowLeft size={14} />
            Change plan
          </Link>
        </div>

        {book && (
          <div className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
            <div className="flex h-24 w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200/60">
              {book.cover_image_url ? (
                <img src={book.cover_image_url} alt={book.name} className="h-full w-full object-cover" />
              ) : (
                <BookOpen size={26} className="text-slate-300" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Included</span>
                  <p className="font-semibold leading-snug text-slate-900">{book.name}</p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  Free
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {book.version} · {book.language}
              </p>
              {book.description && (
                <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{book.description}</p>
              )}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl bg-slate-900 text-white">
          <div className="space-y-2 px-4 py-3 text-sm text-slate-300">
            {upgrade ? (
              <>
                <div className="flex justify-between gap-3">
                  <span>Applicable admission fee</span>
                  <span className="tabular-nums">{rupees(upgrade.admission)}</span>
                </div>
                <div className="flex justify-between gap-3 text-emerald-300">
                  <span>Eligible previous fee adjustment</span>
                  <span className="tabular-nums">−{rupees(upgrade.adjustment)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between gap-3">
                <span>Membership</span>
                <span className="tabular-nums">{rupees(planPrice)}</span>
              </div>
            )}
            {firstMonth > 0 && (
              <div className="flex justify-between gap-3">
                <span>First month fee</span>
                <span className="tabular-nums">{rupees(firstMonth)}</span>
              </div>
            )}
            {book && (
              <>
                <div className="flex justify-between gap-3">
                  <span>SpeakEdge Book</span>
                  <span className="text-emerald-300">Included</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Truck size={14} className="text-slate-400" />
                    Delivery
                  </span>
                  <span className={delivery === 'home' ? 'tabular-nums' : 'text-slate-400'}>
                    {delivery === 'home' ? rupees(shipping) : 'Free pickup'}
                  </span>
                </div>
              </>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-white/10 bg-white/5 px-4 py-3.5">
            <span className="font-semibold">
              {upgrade ? 'Amount payable for upgrade' : 'Total payable'}
            </span>
            <span className="text-xl font-bold tabular-nums tracking-tight">{rupees(total)}</span>
          </div>
          {months != null && (
            <p className="border-t border-white/10 px-4 py-2.5 text-xs text-slate-400">
              Membership validity: {months} months from payment.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
