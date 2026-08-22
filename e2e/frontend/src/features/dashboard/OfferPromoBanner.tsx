import {
  Gift, Sparkles, Tag, Clock, Loader2, ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { rupees } from '@/features/admin/_shared';
import type { Offer } from '@/features/dashboard/OfferCard';

const TYPE_META: Record<string, { label: string; icon: LucideIcon; gradient: string }> = {
  subscription_upgrade: {
    label: 'Upgrade',
    icon: Sparkles,
    gradient: 'from-[#1e3a8a] via-brand to-violet-600',
  },
  discount: {
    label: 'Discount',
    icon: Tag,
    gradient: 'from-emerald-800 via-teal-600 to-cyan-500',
  },
  limited_time: {
    label: 'Limited time',
    icon: Clock,
    gradient: 'from-rose-700 via-orange-500 to-amber-400',
  },
  festival: {
    label: 'Festival deal',
    icon: Gift,
    gradient: 'from-amber-700 via-brand-gold to-yellow-400',
  },
};

function typeMeta(type?: string) {
  return TYPE_META[type ?? ''] ?? {
    label: type?.replace(/_/g, ' ') ?? 'Special offer',
    icon: Gift,
    gradient: 'from-slate-900 via-brand to-brand-light',
  };
}

export function OfferPromoBanner({
  offer,
  responding,
  onInterested,
}: {
  offer: Offer;
  responding: boolean;
  onInterested: () => void;
}) {
  const meta = typeMeta(offer.offer_type);
  const Icon = meta.icon;

  return (
    <article className="group relative isolate flex h-full min-h-[8.5rem] flex-col overflow-hidden rounded-xl border border-slate-200/70 bg-slate-900 shadow-sm transition duration-300 hover:-translate-y-0.5 hover:border-brand/25 hover:shadow-md hover:shadow-brand/10 sm:min-h-[9rem] sm:rounded-2xl">
      <div className="absolute inset-0">
        {offer.image_url ? (
          <>
            <img src={offer.image_url} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/55 to-slate-950/20" />
          </>
        ) : (
          <>
            <div className={`absolute inset-0 bg-gradient-to-br ${meta.gradient}`} />
            <div
              className="absolute inset-0 opacity-25"
              style={{
                backgroundImage: 'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.35) 0%, transparent 50%)',
              }}
              aria-hidden
            />
          </>
        )}
      </div>

      <div className="relative flex flex-1 flex-col justify-between gap-2 p-3 sm:p-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/90 backdrop-blur-sm sm:text-[10px]">
              <Icon size={10} />
              {meta.label}
            </span>
            {offer.plan && (
              <span className="truncate rounded-md bg-brand-gold px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-900 sm:text-[10px]">
                {offer.plan}
              </span>
            )}
          </div>
          <h3 className="mt-2 line-clamp-1 text-sm font-bold tracking-tight text-white sm:text-[0.9375rem]">{offer.title}</h3>
          {offer.body && (
            <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-white/70">{offer.body}</p>
          )}
        </div>

        <div className="flex items-end justify-between gap-2">
          {offer.amount != null ? (
            <span className="text-lg font-extrabold leading-none tracking-tight text-white sm:text-xl">{rupees(offer.amount)}</span>
          ) : (
            <span className="text-[11px] font-medium text-white/60">Exclusive deal</span>
          )}
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-900 shadow-sm transition hover:bg-brand-gold active:scale-95 sm:px-3 sm:py-1.5 sm:text-xs"
            disabled={responding}
            onClick={onInterested}
          >
            {responding ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <>
                Claim <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
