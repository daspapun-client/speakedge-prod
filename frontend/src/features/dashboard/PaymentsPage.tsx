import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  CreditCard, Download, Receipt, Sparkles, ArrowRight,
  CheckCircle2, FileText, type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatusBadge, fmtDay, rupees } from '@/features/admin/_shared';

interface Payment {
  id: string;
  invoice_no?: string | null;
  invoice_url?: string | null;
  kind: string;
  plan?: string | null;
  amount: number;
  status: string;
  created_at: string;
}

const KIND_LABEL: Record<string, string> = {
  subscription: 'Subscription',
  book: 'Book purchase',
  exam: 'Exam fee',
};

function kindLabel(kind: string) {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, ' ');
}

function itemTitle(p: Payment) {
  const base = kindLabel(p.kind);
  return p.plan ? `${base} · ${p.plan}` : base;
}

function isPaid(status: string) {
  return ['paid', 'manually_approved'].includes(status.toLowerCase());
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

function PaymentsSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-56 rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
      </div>
      <div className="h-24 rounded-xl bg-slate-200" />
      <div className="space-y-3">
        {[1, 2].map((i) => <div key={i} className="h-24 rounded-xl bg-slate-200" />)}
      </div>
    </div>
  );
}

function PaymentRow({ payment: p }: { payment: Payment }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-brand/30 hover:bg-white sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div className="shrink-0 rounded-lg bg-brand/10 p-2 text-brand">
          <CreditCard size={16} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-800">{itemTitle(p)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>{fmtDay(p.created_at)}</span>
            <span className="font-semibold text-brand">{rupees(p.amount)}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <StatusBadge status={p.status} />
        {p.invoice_url ? (
          <a
            href={p.invoice_url}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost py-1.5 text-xs"
          >
            <Download size={14} /> {p.invoice_no ?? 'Invoice'}
          </a>
        ) : (
          <span className="text-xs text-slate-400">No invoice</span>
        )}
      </div>
    </div>
  );
}

export function PaymentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: () => unwrap<Payment[]>(api.get('/dashboard/payments')),
  });

  const payments = data ?? [];
  const stats = useMemo(() => {
    const paid = payments.filter((p) => isPaid(p.status));
    const totalSpent = paid.reduce((sum, p) => sum + p.amount, 0);
    const invoices = payments.filter((p) => p.invoice_url).length;
    return {
      total: payments.length,
      paid: paid.length,
      totalSpent,
      invoices,
    };
  }, [payments]);

  if (isLoading) return <PaymentsSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment History"
        description="Track subscriptions, purchases, and download your invoices"
        actions={
          <Link to="/dashboard/reports" className="btn-ghost inline-flex items-center gap-2">
            <FileText size={16} /> Reports & downloads
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Transactions" value={stats.total} icon={Receipt} hint={stats.total ? 'All time' : 'None yet'} />
        <StatTile label="Successful" value={stats.paid} icon={CheckCircle2} hint={stats.paid ? 'Completed payments' : 'No payments'} />
        <StatTile
          label="Total paid"
          value={stats.totalSpent ? rupees(stats.totalSpent) : '₹0'}
          icon={CreditCard}
          hint={stats.invoices ? `${stats.invoices} invoice${stats.invoices === 1 ? '' : 's'} available` : 'Invoices after payment'}
        />
      </div>

      {stats.total > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-5 text-white sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90">
                  <Sparkles size={14} /> Payment summary
                </p>
                <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">
                  {stats.paid} successful payment{stats.paid === 1 ? '' : 's'}
                </h2>
                <p className="mt-1 text-sm text-white/80">
                  {stats.invoices
                    ? 'Download invoices from each transaction or visit Reports & Downloads'
                    : 'Invoices are generated after successful payments'}
                </p>
              </div>
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Receipt size={28} />
              </div>
            </div>
          </div>
        </div>
      )}

      {!payments.length ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
            <CreditCard size={32} />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-800">No payments yet</h2>
          <p className="mt-2 text-sm text-slate-500">
            Subscription and purchase receipts will appear here after you complete a payment.
          </p>
          <Link to="/dashboard/subscription" className="btn-primary mt-5 inline-flex items-center gap-2">
            View subscription <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <section className="card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-start gap-3">
              <span className="rounded-lg bg-brand/10 p-2 text-brand">
                <Receipt size={18} />
              </span>
              <div>
                <h2 className="font-bold text-slate-800">All transactions</h2>
                <p className="mt-0.5 text-sm text-slate-500">Newest payments shown first</p>
              </div>
            </div>
            <span className="text-sm text-slate-400">{payments.length} record{payments.length === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-4 space-y-3">
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
