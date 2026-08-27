import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BookOpen, Check, X } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { MEMBERSHIP_INCLUDES, SPEAKEDGE_BOOK_INCLUDED, planBenefits } from '@/lib/membership';

/**
 * Choose Your Membership. Cards are priced transparently — the monthly fee (when
 * there is one) leads, with the one-time admission fee stated below it. Nothing
 * here is duration-based: checkout charges the admission fee only.
 */

interface Plan {
  plan: string;
  label: string;
  amount: number; // paise — one-time admission / membership fee
  offer_price: number | null; // paise — discounted admission
  monthly_fee: number; // paise — quoted per month, billed separately
  classes_per_week: number; // teacher-led classes / week
  conversation_per_week: number; // conversation teams
  community_years: number;
  support_years: number; // student relation support
  cefr_tests: number;
  speaking_tests: number;
}

// Display order. Pro tiers live in their own section below the main memberships;
// anything not listed here (e.g. the Basic English Course, sold under Books) is
// not part of this page.
const MAIN_ORDER = ['Tribe', 'Basic', 'Silver', 'Gold', 'Diamond'];
const PRO_ORDER = ['Silver Pro', 'Gold Pro', 'Diamond Pro'];

// The membership term is not a customer choice any more; validity is annual.
const MEMBERSHIP_MONTHS = 12;

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;
const admissionOf = (p: Plan) => (p.offer_price != null ? p.offer_price : p.amount);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Tribe has no admission step — it is a flat membership fee.
const feeLabel = (p: Plan) =>
  p.plan === 'Tribe' ? 'One-Time Membership Fee' : 'One-Time Admission Fee';

const conversationText = (p: Plan) =>
  p.conversation_per_week > 0
    ? `${p.conversation_per_week} Conversation Teams + Unlimited Individual Speaking Partners`
    : 'Unlimited Individual Speaking Partners';

// The benefit list itself lives in lib/membership.ts — /plans, the checkout
// summary and the dashboard panel all render the same one.

export function PlansPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => unwrap<Plan[]>(api.get('/payments/plans')),
  });

  const [main, pro] = useMemo(() => {
    const pick = (keys: string[]) =>
      keys.map((k) => plans.find((p) => p.plan === k)).filter((p): p is Plan => !!p);
    return [pick(MAIN_ORDER), pick(PRO_ORDER)];
  }, [plans]);

  // Step 1 of the journey. Both routes land on a checkout page that captures
  // the buyer's details and carries the terms block: new joiners on the bundled
  // one (membership + SpeakEdge Book), signed-in members on the membership-only
  // one, which subscribes them and returns them to their dashboard.
  function subscribe(p: Plan) {
    const path = isAuthenticated() ? '/checkout/membership' : '/checkout';
    navigate(`${path}?plan=${encodeURIComponent(p.plan)}&months=${MEMBERSHIP_MONTHS}`);
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold">Choose Your Membership</h1>
      <p className="mt-2 text-slate-600">
        Every membership includes the SpeakEdge Book. Pay the one-time membership or admission fee
        to join — tiers with a monthly fee add teacher-led classes, assessments and longer community
        access.
      </p>

      {isLoading ? (
        <p className="mt-8 text-slate-500">Loading plans…</p>
      ) : (
        <>
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {main.map((p) => (
              <PlanCard key={p.plan} plan={p} onSubscribe={() => subscribe(p)} />
            ))}
          </div>

          {pro.length > 0 && (
            <section className="mt-14">
              <h2 className="text-2xl font-extrabold">More Teacher-Led Learning</h2>
              <p className="mt-2 max-w-2xl text-slate-600">
                Choose a Pro Membership for 2 Teacher-led Classes per Week with the additional
                benefits of the respective membership level.
              </p>
              <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {pro.map((p) => (
                  <PlanCard key={p.plan} plan={p} onSubscribe={() => subscribe(p)} />
                ))}
              </div>
            </section>
          )}

          <div className="mt-12 flex gap-3 rounded-2xl border border-brand/20 bg-brand/5 p-5">
            <ArrowUpRight size={20} className="mt-0.5 shrink-0 text-brand" />
            <div>
              <h3 className="font-bold text-brand">Upgrade Anytime</h3>
              <p className="mt-1 text-sm text-slate-700">
                Learners can upgrade to a higher SpeakEdge Membership. The eligible fee paid for the
                previous membership will be adjusted against the Admission Fee of the upgraded
                membership, as applicable. For Tribe and Basic, the applicable previous
                Membership/Admission Fee should also be considered for adjustment.
              </p>
            </div>
          </div>

          <h2 className="mt-12 text-xl font-bold">Full comparison</h2>
          <div className="card mt-4 overflow-x-auto p-0">
            <ComparisonTable plans={[...main, ...pro]} />
          </div>
        </>
      )}

    </div>
  );
}

function PlanCard({ plan, onSubscribe }: { plan: Plan; onSubscribe: () => void }) {
  const monthly = plan.monthly_fee > 0;
  return (
    <div className="card flex flex-col">
      <h3 className="text-lg font-bold uppercase tracking-wide text-brand">
        {plan.label || plan.plan}
      </h3>

      {/* Monthly fee leads when there is one; the one-time fee stays visible
          below it with secondary emphasis. The two are never added together. */}
      <div className="mt-3">
        {monthly ? (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-extrabold text-slate-900">{rupees(plan.monthly_fee)}</span>
              <span className="text-sm font-semibold text-slate-500">/month</span>
            </div>
            <div className="mt-1 text-sm text-slate-600">
              <span className="font-semibold text-slate-700">{rupees(admissionOf(plan))}</span>{' '}
              {feeLabel(plan)}
            </div>
          </>
        ) : (
          <>
            <div className="text-3xl font-extrabold text-slate-900">{rupees(admissionOf(plan))}</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">{feeLabel(plan)}</div>
            <div className="text-sm text-slate-500">No Monthly Fee</div>
          </>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-brand-gold/10 px-3 py-2 text-sm font-semibold text-brand">
        <BookOpen size={16} className="shrink-0" /> {SPEAKEDGE_BOOK_INCLUDED}
      </div>

      <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600">
        {planBenefits(plan).map((b) => (
          <li key={b} className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-brand" /> {b}
          </li>
        ))}
      </ul>

      <button className="btn-primary mt-5" onClick={onSubscribe}>
        Subscribe →
      </button>
    </div>
  );
}

function ComparisonTable({ plans }: { plans: Plan[] }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-slate-200 text-left text-slate-500">
        <tr>
          <th className="p-3">Benefit</th>
          {plans.map((p) => (
            <th key={p.plan} className="whitespace-nowrap p-3 text-center">{p.label || p.plan}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        <Row
          label="Monthly fee"
          cells={plans.map((p) => (p.monthly_fee > 0 ? `${rupees(p.monthly_fee)}/month` : 'No monthly fee'))}
        />
        <Row label="One-time membership / admission fee" cells={plans.map((p) => rupees(admissionOf(p)))} />
        <BoolRow label="SpeakEdge Book included" cells={plans.map(() => true)} />
        <Row label="Speaking community access" cells={plans.map((p) => plural(p.community_years, 'year'))} />
        <Row
          label="Conversation teams"
          cells={plans.map((p) => (p.conversation_per_week > 0 ? String(p.conversation_per_week) : '—'))}
        />
        <Row label="Individual speaking partners" cells={plans.map(() => 'Unlimited')} />
        <Row
          label="Teacher-led classes / week"
          cells={plans.map((p) => (p.classes_per_week > 0 ? String(p.classes_per_week) : '—'))}
        />
        <BoolRow label="AI-guided learning (SpeakEdge Book)" cells={plans.map((p) => p.classes_per_week === 0)} />
        <Row label="CEFR tests" cells={plans.map((p) => (p.cefr_tests > 0 ? String(p.cefr_tests) : '—'))} />
        <Row label="Speaking tests" cells={plans.map((p) => (p.speaking_tests > 0 ? String(p.speaking_tests) : '—'))} />
        <Row
          label="Student relation support"
          cells={plans.map((p) => (p.support_years > 0 ? plural(p.support_years, 'year') : '—'))}
        />
        {MEMBERSHIP_INCLUDES.map((label) => (
          <BoolRow key={label} label={label} cells={plans.map(() => true)} />
        ))}
      </tbody>
    </table>
  );
}

function Row({ label, cells }: { label: string; cells: string[] }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="p-3 font-medium text-slate-700">{label}</td>
      {cells.map((c, i) => (
        <td key={i} className="whitespace-nowrap p-3 text-center">{c}</td>
      ))}
    </tr>
  );
}

function BoolRow({ label, cells }: { label: string; cells: boolean[] }) {
  return (
    <tr className="border-b border-slate-100">
      <td className="p-3 font-medium text-slate-700">{label}</td>
      {cells.map((on, i) => (
        <td key={i} className="p-3 text-center">
          {on ? <Check size={16} className="mx-auto text-brand" /> : <X size={16} className="mx-auto text-slate-300" />}
        </td>
      ))}
    </tr>
  );
}
