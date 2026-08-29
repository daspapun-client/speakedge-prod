import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Loader2, Wallet } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { startMonthlyCheckout } from '@/features/payments/checkout';

interface MonthlyDue {
  plan: string;
  plan_label: string;
  due_month: string;
  due_date: string;
  amount: number; // paise
  days_until: number;
  overdue: boolean;
  reminder_active: boolean;
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });

function dueHint(due: MonthlyDue) {
  if (due.overdue) {
    const late = Math.abs(due.days_until);
    return `Overdue by ${late} day${late === 1 ? '' : 's'}`;
  }
  if (due.days_until === 0) return 'Due today';
  return `Due in ${due.days_until} day${due.days_until === 1 ? '' : 's'}`;
}

/**
 * Monthly fee reminder. Appears 3 days before the due date and stays until the
 * payment is confirmed — the backend keeps returning the due month until a
 * matching payment lands, at which point this renders nothing.
 *
 * "Remind me later" collapses the modal to a persistent bar for the current
 * browser session only, so the reminder never disappears while money is owed.
 */
export function MonthlyDuePopup() {
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(
    () => sessionStorage.getItem('monthly-due-collapsed') === '1',
  );

  const { data: due } = useQuery({
    queryKey: ['monthly-due'],
    queryFn: () => unwrap<MonthlyDue | null>(api.get('/payments/monthly-due')),
  });

  const pay = useMutation({
    mutationFn: () => startMonthlyCheckout(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['monthly-due'] });
      qc.invalidateQueries({ queryKey: ['my-payments'] });
    },
  });

  if (!due || !due.reminder_active) return null;

  const collapse = () => {
    sessionStorage.setItem('monthly-due-collapsed', '1');
    setCollapsed(true);
  };

  const payBtn = (
    <button type="button" className="btn-primary" disabled={pay.isPending} onClick={() => pay.mutate()}>
      {pay.isPending ? <><Loader2 size={16} className="animate-spin" /> Opening…</> : <><Wallet size={16} /> Pay Now</>}
    </button>
  );

  if (collapsed) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-amber-200 bg-amber-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3">
          <p className="flex min-w-0 items-center gap-2 text-sm text-amber-900">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              <span className="font-bold">{rupees(due.amount)}</span> monthly fee ·{' '}
              {fmtDue(due.due_date)} · {dueHint(due)}
            </span>
          </p>
          {payBtn}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-md">
        <div className="flex items-start gap-3">
          <span className={`shrink-0 rounded-xl p-2.5 ${due.overdue ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'}`}>
            <AlertTriangle size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {due.overdue ? 'Monthly payment overdue' : 'Monthly payment due'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Your {due.plan_label} monthly fee is coming up. Pay now to keep your classes running
              without interruption.
            </p>
          </div>
        </div>

        <dl className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="inline-flex items-center gap-2 text-sm text-slate-500">
              <CalendarClock size={15} /> Due Date
            </dt>
            <dd className="text-right text-sm font-semibold text-slate-900">
              {fmtDue(due.due_date)}
              <span className={`ml-2 text-xs font-bold ${due.overdue ? 'text-red-600' : 'text-amber-600'}`}>
                {dueHint(due)}
              </span>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <dt className="inline-flex items-center gap-2 text-sm text-slate-500">
              <Wallet size={15} /> Amount Due
            </dt>
            <dd className="text-lg font-extrabold text-brand">{rupees(due.amount)}</dd>
          </div>
        </dl>

        {pay.isError && <p className="mt-3 text-sm text-red-600">{(pay.error as Error).message}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={collapse}>
            Remind me later
          </button>
          {payBtn}
        </div>
      </div>
    </div>
  );
}
