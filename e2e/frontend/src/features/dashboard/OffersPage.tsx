import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Gift, Sparkles, Tag, ArrowRight, AlertCircle,
  type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';
import { OfferCard, type Offer } from '@/features/dashboard/OfferCard';

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

export function OffersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['offers'],
    queryFn: () => unwrap<Offer[]>(api.get('/dashboard/offers')),
  });

  const respond = useMutation({
    mutationFn: ({ id, response }: { id: string; response: 'interested' | 'not_interested' }) =>
      unwrap<{ next?: string; plan?: string; amount?: number | null }>(
        api.post(`/dashboard/offers/${id}/respond`, { response }),
      ),
    onSuccess: async (res, vars) => {
      qc.invalidateQueries({ queryKey: ['offers'] });
      if (res?.next === 'payment' && res.plan && res.amount) {
        navigate(
          `/checkout/membership?plan=${encodeURIComponent(res.plan)}&offer=${encodeURIComponent(vars.id)}`,
        );
      }
    },
  });

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
    </div>
  );
}
