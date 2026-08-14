import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Gift, Sparkles, Tag, Clock, ArrowRight, Loader2, AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, badgeClass, fmtDay, rupees } from '@/features/admin/_shared';
import { startCheckout } from '@/features/payments/checkout';
import { TermsGateModal } from '@/components/TermsAgreement';

interface Offer {
  id: string;
  title: string;
  body?: string | null;
  offer_type?: string;
  plan?: string | null;
  amount?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
}

const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  subscription_upgrade: { label: 'Upgrade', icon: Sparkles },
  discount: { label: 'Discount', icon: Tag },
  limited_time: { label: 'Limited time', icon: Clock },
  festival: { label: 'Festival deal', icon: Gift },
};

function typeMeta(type?: string) {
  return TYPE_META[type ?? ''] ?? { label: type?.replace(/_/g, ' ') ?? 'Special offer', icon: Gift };
}

function StatTile({ label, value, icon: Icon, hint }: { label: string; value: number | string; icon: LucideIcon; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-extrabold text-brand">{value}</div>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function OffersSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-56 rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
      </div>
      <div className="h-24 rounded-xl bg-slate-200" />
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2].map((i) => <div key={i} className="h-56 rounded-xl bg-slate-200" />)}
      </div>
    </div>
  );
}

function OfferCard({
  offer,
  responding,
  onInterested,
  onDismiss,
}: {
  offer: Offer;
  responding: boolean;
  onInterested: () => void;
  onDismiss: () => void;
}) {
  const meta = typeMeta(offer.offer_type);
  const Icon = meta.icon;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-brand-gold/50 hover:shadow-md">
      <div className="h-1 bg-brand-gold" />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="rounded-xl bg-brand-gold/15 p-2.5 text-brand-gold transition group-hover:bg-brand-gold group-hover:text-slate-900">
            <Icon size={22} />
          </div>
          <span className={`badge shrink-0 ${badgeClass(meta.label)}`}>{meta.label}</span>
        </div>

        <h3 className="mt-4 font-bold text-slate-800 group-hover:text-brand">{offer.title}</h3>
        {offer.body && <p className="mt-2 text-sm leading-relaxed text-slate-600">{offer.body}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {offer.amount != null && (
            <span className="text-xl font-extrabold text-brand">{rupees(offer.amount)}</span>
          )}
          {offer.plan && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {offer.plan}
            </span>
          )}
        </div>

        {offer.ends_at && (
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-slate-400">
            <Clock size={12} /> Valid until {fmtDay(offer.ends_at)}
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            className="btn-gold flex-1 sm:flex-none"
            disabled={responding}
            onClick={onInterested}
          >
            {responding ? <><Loader2 size={16} className="animate-spin" /> Processing…</> : "I'm interested"}
          </button>
          <button
            type="button"
            className="btn-ghost flex-1 sm:flex-none"
            disabled={responding}
            onClick={onDismiss}
          >
            Not now
          </button>
        </div>
      </div>
    </article>
  );
}

export function OffersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['offers'],
    queryFn: () => unwrap<Offer[]>(api.get('/dashboard/offers')),
  });

  // Accepting a priced offer goes straight to the gateway, so the Terms are
  // gated by a dialog first — the payment is refused without acceptance.
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);

  const respond = useMutation({
    mutationFn: ({ id, response }: { id: string; response: 'interested' | 'not_interested' }) =>
      unwrap<{ next?: string; plan?: string }>(api.post(`/dashboard/offers/${id}/respond`, { response })),
    onSuccess: async (res) => {
      qc.invalidateQueries({ queryKey: ['offers'] });
      if (res?.next === 'payment' && res.plan) setPendingPlan(res.plan);
    },
  });

  async function confirmOfferPayment() {
    const plan = pendingPlan;
    setPendingPlan(null);
    if (plan) await startCheckout({ plan, accept_terms: true });
  }

  const offers = data ?? [];
  const stats = useMemo(() => ({
    total: offers.length,
    priced: offers.filter((o) => o.amount != null).length,
    upgrades: offers.filter((o) => o.offer_type === 'subscription_upgrade').length,
  }), [offers]);

  if (isLoading) return <OffersSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exclusive Offers"
        description="Personalised upgrades and member-only deals picked for you"
        actions={
          <Link to="/dashboard/subscription" className="btn-ghost inline-flex items-center gap-2">
            View subscription <ArrowRight size={16} />
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Active offers" value={stats.total} icon={Gift} hint={stats.total ? 'Available now' : 'None right now'} />
        <StatTile label="With pricing" value={stats.priced} icon={Tag} hint={stats.priced ? 'Ready to checkout' : '—'} />
        <StatTile label="Upgrades" value={stats.upgrades} icon={Sparkles} hint={stats.upgrades ? 'Plan upgrades' : 'No upgrades'} />
      </div>

      {stats.total > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="bg-gradient-to-r from-brand-gold to-amber-400 px-6 py-5 text-slate-900 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800/80">
                  <Sparkles size={14} /> Member exclusives
                </p>
                <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">
                  {stats.total} offer{stats.total === 1 ? '' : 's'} waiting for you
                </h2>
                <p className="mt-1 text-sm text-slate-800/70">
                  Tap &ldquo;I&apos;m interested&rdquo; to proceed to secure checkout
                </p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/40">
                <Gift size={28} />
              </div>
            </div>
          </div>
        </div>
      )}

      {respond.isError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          {(respond.error as Error).message}
        </div>
      )}

      {!offers.length ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Gift size={32} />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-800">No offers right now</h2>
          <p className="mt-2 text-sm text-slate-500">
            Exclusive deals appear here when available. Check your subscription page for standard plans.
          </p>
          <Link to="/dashboard/subscription" className="btn-primary mt-5 inline-flex items-center gap-2">
            View subscription <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <section className="card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-brand-gold/15 p-2 text-brand-gold">
                <Gift size={18} />
              </span>
              <div>
                <h2 className="font-bold text-slate-800">Your offers</h2>
                <p className="mt-0.5 text-sm text-slate-500">Respond once — dismissed offers won&apos;t show again</p>
              </div>
            </div>
            <span className="text-sm text-slate-400">{offers.length} offer{offers.length === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {offers.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                responding={respond.isPending}
                onInterested={() => respond.mutate({ id: o.id, response: 'interested' })}
                onDismiss={() => respond.mutate({ id: o.id, response: 'not_interested' })}
              />
            ))}
          </div>
        </section>
      )}

      <TermsGateModal
        open={!!pendingPlan}
        title={`Upgrade to ${pendingPlan ?? ''}`}
        onCancel={() => setPendingPlan(null)}
        onConfirm={confirmOfferPayment}
      />
    </div>
  );
}
