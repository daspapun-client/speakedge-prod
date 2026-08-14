import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatCard, StatusBadge } from '@/features/admin/_shared';

export interface PartnerDashboard {
  id: string;
  partner_id?: string | null;
  name: string;
  partner_type: string;
  status: string;
  products_allowed: string[];
  performance: {
    total_leads: number;
    converted_leads: number;
    total_book_sales: number;
    total_admissions: number;
    total_membership_sales: number;
    pending_approval_reports: number;
  };
}

export function usePartnerDashboard() {
  return useQuery({
    queryKey: ['partner-dashboard'],
    queryFn: () => unwrap<PartnerDashboard>(api.get('/partner/dashboard')),
  });
}

export function PartnerHome() {
  const { data, isLoading } = usePartnerDashboard();

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (!data) return <p className="text-slate-500">No partner profile linked to this account.</p>;

  const perf = data.performance;
  return (
    <div>
      <PageHeader
        title={`Welcome, ${data.name}`}
        description={data.partner_id ? `${data.partner_type} · ${data.partner_id}` : data.partner_type}
        actions={<StatusBadge status={data.status} />}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total leads" value={perf.total_leads} />
        <StatCard label="Converted leads" value={perf.converted_leads} />
        <StatCard label="Pending reports" value={perf.pending_approval_reports} hint="Awaiting admin approval" />
        <StatCard label="Book sales" value={perf.total_book_sales} hint="Approved" />
        <StatCard label="Course admissions" value={perf.total_admissions} hint="Approved" />
        <StatCard label="Membership sales" value={perf.total_membership_sales} hint="Approved" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link to="/partner/leads" className="btn-primary">Manage leads</Link>
        <Link to="/partner/reports" className="btn-ghost">Submit a report</Link>
      </div>

      {!!data.products_allowed.length && (
        <div className="card mt-6">
          <h2 className="font-bold">Products you can offer</h2>
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
