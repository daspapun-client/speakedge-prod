import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatCard, downloadExport, rupees } from './_shared';

interface Summary {
  memberships: { total: number; active: number; pending: number };
  payments: { count: number; failed: number; revenue_paise: number };
  sales: { book_orders: number; book_revenue_paise: number; active_subscriptions: number };
  leads: { total: number; demo_booked: number; converted: number; conversion_rate: number };
  community: { total: number; verified: number; self_declared: number; teams: number; friend_requests: number };
  teachers: number;
  partners: { approved: number; approved_sales_reports: number };
}

const EXPORTS = [
  { key: 'students', label: 'Students / Memberships', path: '/analytics/students/export', base: 'students' },
  { key: 'payments', label: 'Payments', path: '/analytics/payments/export', base: 'payments' },
  { key: 'leads', label: 'Leads / Demo conversions', path: '/analytics/leads/export', base: 'leads' },
  { key: 'book-orders', label: 'Book orders / Sales', path: '/analytics/book-orders/export', base: 'book_orders' },
];

export function AdminReports() {
  const [fmt, setFmt] = useState<'csv' | 'xlsx'>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['analytics-summary'], queryFn: () => unwrap<Summary>(api.get('/analytics/summary')) });

  const dl = (path: string, base: string) =>
    downloadExport(path, { format: fmt, date_from: dateFrom || undefined, date_to: dateTo || undefined }, `${base}.${fmt}`);

  return (
    <div>
      <PageHeader title="Reports & Analytics" description="Platform-wide aggregates with CSV / Excel exports." />
      {isLoading || !data ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Members" value={data.memberships.total} hint={`${data.memberships.active} active · ${data.memberships.pending} pending`} />
          <StatCard label="Payment Revenue" value={rupees(data.payments.revenue_paise)} hint={`${data.payments.count} paid · ${data.payments.failed} failed`} />
          <StatCard label="Book Sales" value={rupees(data.sales.book_revenue_paise)} hint={`${data.sales.book_orders} orders`} />
          <StatCard label="Active Subscriptions" value={data.sales.active_subscriptions} />
          <StatCard label="Lead Conversion" value={`${data.leads.conversion_rate}%`} hint={`${data.leads.converted}/${data.leads.total} converted`} />
          <StatCard label="Community Class" value={data.community.total} hint={`${data.community.verified} verified · ${data.community.teams} teams`} />
          <StatCard label="Teachers" value={data.teachers} />
          <StatCard label="Partners" value={data.partners.approved} hint={`${data.partners.approved_sales_reports} approved reports`} />
        </div>
      )}

      <div className="card mt-8">
        <h2 className="text-sm font-semibold text-slate-700">Exports</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div><label className="label">Format</label>
            <select className="input max-w-[8rem]" value={fmt} onChange={(e) => setFmt(e.target.value as 'csv' | 'xlsx')}>
              <option value="csv">CSV</option>
              <option value="xlsx">Excel</option>
            </select>
          </div>
          <div><label className="label">From</label><input className="input" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
          <div><label className="label">To</label><input className="input" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {EXPORTS.map((x) => (
            <button key={x.key} className="btn-ghost" onClick={() => dl(x.path, x.base)}>{x.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
