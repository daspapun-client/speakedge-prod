import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownRight, CalendarClock } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { fmtDay } from '@/features/admin/_shared';

/**
 * Membership changes that are scheduled rather than immediate:
 *
 * - an **upgrade** the member has paid for and asked to start on a later date —
 *   until then the membership they hold runs untouched;
 * - a **downgrade** from a Pro tier to its standard tier, which is free and
 *   takes effect from the next monthly payment cycle.
 *
 * Everything (eligibility, the effective date, whether it can still be called
 * off) comes from `GET /payments/plan-change`; this panel renders nothing when
 * there is neither a scheduled change nor a downgrade on offer.
 */

interface Pending {
  plan: string;
  label: string;
  effective_at: string | null;
  kind: 'upgrade' | 'downgrade';
  cancellable: boolean;
}

interface DowngradeOffer {
  plan: string;
  label: string;
  monthly_fee: number;
  classes_per_week: number;
  effective_at: string;
}

interface PlanChange {
  plan: string | null;
  plan_label: string | null;
  pending: Pending | null;
  downgrade: DowngradeOffer | null;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

export function PlanChangePanel() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { data } = useQuery({
    queryKey: ['plan-change'],
    queryFn: () => unwrap<PlanChange>(api.get('/payments/plan-change')),
    retry: false,
  });

  const change = useMutation({
    mutationFn: (action: 'request' | 'cancel') =>
      action === 'request'
        ? unwrap(api.post('/payments/downgrade', {}))
        : unwrap(api.delete('/payments/plan-change')),
    onSuccess: () => {
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ['plan-change'] });
      qc.invalidateQueries({ queryKey: ['sub-current'] });
    },
  });

  if (!data || (!data.pending && !data.downgrade)) return null;

  if (data.pending) {
    const { pending } = data;
    return (
      <div className="card border-brand/20 bg-brand/5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <CalendarClock size={20} className="mt-0.5 shrink-0 text-brand" />
            <div>
              <p className="font-semibold text-slate-800">
                {pending.kind === 'upgrade' ? 'Upgrade scheduled' : 'Downgrade scheduled'} —{' '}
                {pending.label} from {fmtDay(pending.effective_at)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Your {data.plan_label} membership and its benefits continue until then. From that
                date the {pending.label} membership takes over, with the benefits you have already
                used deducted from it.
              </p>
              {!pending.cancellable && (
                <p className="mt-1 text-xs text-slate-400">
                  This upgrade has been paid for — contact support if you need to change it.
                </p>
              )}
            </div>
          </div>
          {pending.cancellable && (
            <button
              className="btn-ghost"
              disabled={change.isPending}
              onClick={() => change.mutate('cancel')}
            >
              Cancel this change
            </button>
          )}
        </div>
        {change.isError && (
          <p className="mt-2 text-sm text-red-600">{(change.error as Error).message}</p>
        )}
      </div>
    );
  }

  const offer = data.downgrade!;
  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex gap-3">
          <ArrowDownRight size={20} className="mt-0.5 shrink-0 text-slate-400" />
          <div>
            <p className="font-semibold text-slate-800">Move to {offer.label}</p>
            <p className="mt-1 text-sm text-slate-500">
              {offer.label} includes {offer.classes_per_week} teacher-led class per week at{' '}
              {rupees(offer.monthly_fee)}/month. Your {data.plan_label} benefits continue until the
              end of the cycle you have paid for — the change takes effect from{' '}
              {fmtDay(offer.effective_at)}.
            </p>
          </div>
        </div>
        {confirming ? (
          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={change.isPending}
              onClick={() => change.mutate('request')}
            >
              {change.isPending ? 'Scheduling…' : 'Confirm downgrade'}
            </button>
            <button className="btn-ghost" onClick={() => setConfirming(false)}>
              Keep {data.plan_label}
            </button>
          </div>
        ) : (
          <button className="btn-ghost" onClick={() => setConfirming(true)}>
            Downgrade
          </button>
        )}
      </div>
      {change.isError && (
        <p className="mt-2 text-sm text-red-600">{(change.error as Error).message}</p>
      )}
    </div>
  );
}
