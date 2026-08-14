import { useQuery } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import {
  CreditCard, Calendar, BookOpen, GraduationCap, Mic, ArrowRight, Clock, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatusBadge, fmtDay } from '@/features/admin/_shared';

interface Sub {
  id?: string;
  plan: string;
  is_active: boolean;
  starts_at?: string | null;
  expires_at?: string | null;
  created_at?: string;
  cefr_tests?: number;
  speaking_tests?: number;
  payment_status?: string | null;
}

interface Plan {
  plan: string;
  label: string;
  classes_per_week: number;
  conversation_per_week: number;
  community_years: number;
  total_classes: number;
}

function StatTile({ label, icon: Icon, value, hint }: { label: string; icon: LucideIcon; value: ReactNode; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 text-xl font-extrabold text-brand">{value}</div>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function SubscriptionSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-48 rounded bg-slate-200" />
      <div className="h-36 rounded-xl bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
      </div>
      <div className="h-40 rounded-xl bg-slate-200" />
    </div>
  );
}

export function SubscriptionPage() {
  const { data: current, isLoading: loadingCurrent } = useQuery({
    queryKey: ['sub-current'],
    queryFn: () => unwrap<Sub | null>(api.get('/subscription/current')),
  });
  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['sub-history'],
    queryFn: () => unwrap<Sub[]>(api.get('/subscription/history')),
  });
  const { data: plans, isLoading: loadingPlans } = useQuery({
    queryKey: ['plans-all'],
    queryFn: () => unwrap<Plan[]>(api.get('/payments/plans', { params: { all: true } })),
  });

  const isLoading = loadingCurrent || loadingHistory || loadingPlans;

  const planOf = (key: string) => plans?.find((p) => p.plan === key);
  const labelOf = (key: string) => planOf(key)?.label ?? key;

  if (isLoading) return <SubscriptionSkeleton />;

  const cfg = current ? planOf(current.plan) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription"
        description="Manage your plan, view usage, and upgrade when ready"
        actions={
          current ? (
            <Link to="/plans" className="btn-gold">
              Compare plans
            </Link>
          ) : undefined
        }
      />

      {current ? (
        <>
          <div className="card overflow-hidden p-0">
            <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-6 text-white sm:px-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-white/80">Active plan</p>
                  <h2 className="text-2xl font-extrabold sm:text-3xl">{labelOf(current.plan)}</h2>
                  <p className="mt-2 font-mono text-sm text-white/70">{current.plan}</p>
                </div>
                <StatusBadge status="Active" />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-slate-100 px-6 py-4 text-sm text-slate-600 sm:px-8">
              <span className="inline-flex items-center gap-2">
                <Calendar size={16} className="text-slate-400" />
                <span className="text-slate-400">Start</span> {fmtDay(current.starts_at ?? current.created_at)}
              </span>
              <span className="inline-flex items-center gap-2">
                <Clock size={16} className="text-slate-400" />
                <span className="text-slate-400">Expires</span> {fmtDay(current.expires_at)}
              </span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {cfg && (
              <>
                <StatTile label="Teacher classes / week" icon={BookOpen} value={cfg.classes_per_week || '—'} />
                <StatTile label="Conversation / week" icon={CreditCard} value={cfg.conversation_per_week || '—'} hint="Conversation-team sessions" />
                <StatTile label="Community access" icon={Calendar} value={`${cfg.community_years} yr`} />
              </>
            )}
            <StatTile
              label="CEFR tests"
              icon={GraduationCap}
              value={current.cefr_tests ?? '—'}
              hint="Remaining this cycle"
            />
            <StatTile
              label="Speaking tests"
              icon={Mic}
              value={current.speaking_tests ?? '—'}
              hint="Remaining this cycle"
            />
          </div>

          <div className="card flex flex-wrap items-center justify-between gap-4 bg-brand/5 border-brand/20">
            <div>
              <p className="font-semibold text-slate-800">Need more classes or a longer plan?</p>
              <p className="mt-1 text-sm text-slate-500">Compare all plans and upgrade without losing your membership.</p>
            </div>
            <Link to="/plans" className="btn-primary inline-flex items-center gap-2">
              Upgrade plan <ArrowRight size={16} />
            </Link>
          </div>
        </>
      ) : (
        <div className="card overflow-hidden p-0 text-center">
          <div className="bg-gradient-to-r from-brand/10 to-brand-light/10 px-6 py-10 sm:px-8">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
              <CreditCard size={32} />
            </div>
            <h2 className="mt-4 text-xl font-extrabold text-slate-800">No active subscription</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Subscribe to unlock live batches, exams, and speaking practice sessions.
            </p>
            <Link to="/plans" className="btn-gold mt-6 inline-flex">Choose a plan</Link>
          </div>
        </div>
      )}

      <div>
        <PageHeader title="History" description="Past and current subscription records" />
        {!history?.length ? (
          <div className="card mt-4 py-10 text-center">
            <p className="text-sm text-slate-500">No past subscriptions yet.</p>
          </div>
        ) : (
          <div className="card mt-4 overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-4">Plan</th>
                  <th className="p-4">Start</th>
                  <th className="p-4">Expiry</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((s, i) => (
                  <tr key={s.id ?? i} className="transition hover:bg-slate-50/80">
                    <td className="p-4">
                      <div className="font-semibold text-slate-800">{labelOf(s.plan)}</div>
                      <div className="mt-0.5 font-mono text-xs text-slate-400">{s.plan}</div>
                    </td>
                    <td className="p-4 text-slate-600">{fmtDay(s.starts_at ?? s.created_at)}</td>
                    <td className="p-4 text-slate-600">{fmtDay(s.expires_at)}</td>
                    <td className="p-4">
                      <StatusBadge status={s.is_active ? 'Active' : 'Expired'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
