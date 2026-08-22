import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Gift } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import type { Offer } from '@/features/dashboard/OfferCard';
import { OfferPromoBanner } from '@/features/dashboard/OfferPromoBanner';

export function DashboardOffersSection({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['offers'],
    queryFn: () => unwrap<Offer[]>(api.get('/dashboard/offers')),
    enabled,
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
  if (!enabled || isLoading || !offers.length) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm sm:rounded-3xl sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-gold to-amber-400 text-slate-900">
              <Gift size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-extrabold tracking-tight text-slate-900 sm:text-base">
                Exclusive offers
              </h2>
              <p className="truncate text-[11px] text-slate-500 sm:text-xs">
                {offers.length} deal{offers.length === 1 ? '' : 's'} · member-only
              </p>
            </div>
          </div>
          <Link
            to="/dashboard/offers"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-semibold text-brand transition hover:bg-brand/5 active:scale-95 sm:text-xs"
          >
            All <ArrowRight size={13} />
          </Link>
        </div>

        {respond.isError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {(respond.error as Error).message}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-3">
          {offers.map((offer) => (
            <OfferPromoBanner
              key={offer.id}
              offer={offer}
              responding={respond.isPending && respond.variables?.id === offer.id}
              onInterested={() => respond.mutate({ id: offer.id, response: 'interested' })}
            />
          ))}
        </div>
      </section>
    );
  }
