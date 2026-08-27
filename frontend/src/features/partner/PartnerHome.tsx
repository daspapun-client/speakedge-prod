/**
 * Partner Dashboard Home — identity, approval state, allowed products and the
 * Performance Summary. Everything counted here is admin-approved; what is
 * still awaiting approval is called out separately so the partner can chase it.
 */
import { Link } from 'react-router-dom';
import {
  BadgeCheck, BookOpen, Globe, GraduationCap, IdCard, Megaphone, Package,
  TrendingUp, Users, Wallet,
} from 'lucide-react';
import { PageHeader, StatCard, StatusBadge, rupees } from '@/features/admin/_shared';
import {
  LEAD_STATUSES, LEAD_STATUS_LABELS, periodLabel, usePartnerDashboard,
} from './shared';

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-700">{value || '—'}</dd>
    </div>
  );
}

export function PartnerHome() {
  const { data, isLoading } = usePartnerDashboard();

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 w-64 rounded bg-slate-200" />
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
        </div>
      </div>
    );
  }
  if (!data) return <p className="text-slate-500">No partner profile linked to this account.</p>;

  const perf = data.performance;
  const pending = data.status !== 'approved';

  return (
    <div>
      <PageHeader
        title={`Welcome, ${data.org || data.name}`}
        description={data.partner_id ? `${data.partner_type} · ${data.partner_id}` : data.partner_type}
        actions={<StatusBadge status={data.status} />}
      />

      {pending && (
        <div className="card mt-4 border-amber-200 bg-amber-50">
          <p className="font-semibold text-amber-800">
            Your partner account is {data.status.replace('_', ' ')}.
          </p>
          <p className="mt-1 text-sm text-amber-900/80">
            {data.remarks
              || 'Lead and sales reporting unlock once the Sujyoti EdTech team approves your account.'}
          </p>
        </div>
      )}

      {/* Dashboard Home: partner identity at a glance. */}
      <div className="card mt-4">
        <h2 className="flex items-center gap-2 font-bold text-slate-800">
          <IdCard size={18} className="text-brand" /> Partner details
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Partner name" value={data.org || data.name} />
          <Field label="Partner ID" value={data.partner_id || 'Pending approval'} />
          <Field label="Partner type" value={data.partner_type} />
          <Field label="Contact person" value={data.name} />
          <Field label="Phone" value={data.profile.phone} />
          <Field label="WhatsApp" value={data.profile.whatsapp} />
          <Field label="Email" value={data.profile.email} />
          <Field
            label="Location"
            value={[data.profile.area, data.profile.district, data.profile.state].filter(Boolean).join(', ')}
          />
        </dl>
      </div>

      <h2 className="mt-6 flex items-center gap-2 font-bold text-slate-800">
        <TrendingUp size={18} className="text-brand" /> Performance summary
      </h2>
      <p className="text-sm text-slate-500">Approved activity only — pending reports are listed separately.</p>

      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total leads" value={perf.total_leads} hint={`${perf.converted_leads} converted`} icon={Megaphone} accent="brand" to="/partner/leads" />
        <StatCard label="Total admissions" value={perf.total_admissions} icon={GraduationCap} accent="emerald" />
        <StatCard label="Total book sales" value={perf.total_book_sales} icon={BookOpen} accent="sky" />
        <StatCard label="Membership sales" value={perf.total_membership_sales} icon={BadgeCheck} accent="violet" />
        <StatCard label="Student registrations" value={perf.total_student_registrations} icon={Users} accent="slate" />
        <StatCard label="Revenue generated" value={rupees(perf.revenue_paise)} hint="From approved reports" icon={Wallet} accent="emerald" />
        <StatCard label="Pending approvals" value={perf.pending_approval_reports} hint="Awaiting admin review" icon={Package} accent="amber" to="/partner/reports" />
        <StatCard label="Approved reports" value={perf.approved_reports} icon={BadgeCheck} accent="brand" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="font-bold text-slate-800">Leads by status</h3>
          <div className="mt-3 space-y-2">
            {LEAD_STATUSES.map((s) => {
              const count = perf.leads_by_status?.[s] ?? 0;
              const pct = perf.total_leads ? Math.round((count / perf.total_leads) * 100) : 0;
              return (
                <div key={s}>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-600">{LEAD_STATUS_LABELS[s]}</span>
                    <span className="font-semibold text-slate-700">{count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h3 className="font-bold text-slate-800">Product-wise sales</h3>
          {!data.by_product.length ? (
            <p className="mt-3 text-sm text-slate-500">
              No approved sales yet. Submit a sales report and it appears here once admin approves it.
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2">Product</th>
                  <th className="pb-2 text-right">Qty</th>
                  <th className="pb-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.by_product.map((p) => (
                  <tr key={p.product} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">{p.product}</td>
                    <td className="py-2 text-right font-semibold text-slate-700">{p.quantity}</td>
                    <td className="py-2 text-right text-slate-500">{rupees(p.revenue_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {!!data.monthly.length && (
        <div className="card mt-4">
          <h3 className="font-bold text-slate-800">Monthly performance</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {data.monthly.map((m) => (
              <div key={m.period} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {periodLabel(m.period)}
                </div>
                <div className="mt-1 text-xl font-extrabold text-brand">{m.quantity}</div>
                <div className="text-xs text-slate-500">{rupees(m.revenue_paise)}</div>
              </div>
            ))}
          </div>
          <Link to="/partner/reports" className="mt-3 inline-block text-sm font-semibold text-brand hover:text-brand-light">
            Full activity & reports →
          </Link>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/partner/leads" className="btn-primary">Manage leads</Link>
        <Link to="/partner/reports" className="btn-ghost">Report a sale</Link>
        {data.microsite_url && data.microsite_published && (
          <a href={data.microsite_url} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-1.5">
            <Globe size={16} /> View my franchisee page
          </a>
        )}
      </div>

      {!!data.products_allowed.length && (
        <div className="card mt-6">
          <h2 className="font-bold">Allowed products &amp; services</h2>
          <p className="mt-1 text-sm text-slate-500">
            Leads and sales reports can only be filed against these.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.products_allowed.map((p) => (
              <span key={p} className="rounded-full bg-brand/10 px-3 py-1 text-sm text-brand">{p}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
