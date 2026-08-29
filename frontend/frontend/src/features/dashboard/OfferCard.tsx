import {
  Gift, Sparkles, Tag, Clock, Loader2,
  type LucideIcon,
} from 'lucide-react';
import { badgeClass, fmtDay, rupees } from '@/features/admin/_shared';

export interface Offer {
  id: string;
  title: string;
  body?: string | null;
  image_url?: string | null;
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

export function OfferCard({
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
