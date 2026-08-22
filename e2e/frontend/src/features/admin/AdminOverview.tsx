import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  Download,
  GraduationCap,
  Handshake,
  IndianRupee,
  KeyRound,
  ShieldCheck,
  Ticket,
  Users,
  UsersRound,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, PageHeader, StatCard, downloadExport, fmtDate, rupees } from './_shared';
import { BarChart, BarList, ChartCard, DonutChart, LineChart, CHART_COLORS } from './charts';

/** Month-over-month percent change from a trend series, or null if not derivable. */
function pctDelta(values?: number[]): number | null {
  if (!values || values.length < 2) return null;
  const last = values[values.length - 1];
  const prev = values[values.length - 2];
  if (!prev) return null;
  return Math.round(((last - prev) / prev) * 100);
}

interface Activity {
  actor?: string;
  action?: string;
  target_id?: string;
  created_at?: string;
}

interface Overview {
  students: number;
  active_memberships: number;
  pending_verifications: number;
  activation_codes: { total: number; unused: number };
  community_members: number;
  teachers: number;
  partners: number;
  examiners: number;
  book_orders: number;
  revenue_paise: number;
  recent_activities: Activity[];
}

interface Bar {
  label: string;
  value: number;
  hint?: string;
}

interface Dashboard {
  months: string[];
  trends: { new_students: number[]; new_leads: number[]; revenue_paise: number[] };
  distributions: { membership: Bar[]; cefr_level: Bar[]; lead_source: Bar[]; payment_kind: Bar[] };
  leaderboards: { top_teachers: Bar[]; top_partners: Bar[] };
}

const PRESETS = [
  { label: '3M', months: 3 },
  { label: '6M', months: 6 },
  { label: '12M', months: 12 },
];

const EXPORTS = [
  { label: 'Students', path: '/analytics/students/export', base: 'students' },
  { label: 'Payments', path: '/analytics/payments/export', base: 'payments' },
  { label: 'Leads', path: '/analytics/leads/export', base: 'leads' },
  { label: 'Book Orders', path: '/analytics/book-orders/export', base: 'book_orders' },
];

const activityColumns: Column<Activity>[] = [
  { key: 'created_at', header: 'When', sort: (a) => a.created_at ?? '', cell: (a) => <span className="text-slate-500">{fmtDate(a.created_at)}</span> },
  { key: 'actor', header: 'Actor', sort: (a) => a.actor ?? '', cell: (a) => <span className="font-mono text-xs">{a.actor || '—'}</span> },
  { key: 'action', header: 'Action', sort: (a) => a.action ?? '', cell: (a) => a.action || '—' },
  { key: 'target_id', header: 'Target', cell: (a) => <span className="font-mono text-xs">{a.target_id || '—'}</span> },
];

export function AdminOverview() {
  // Draft controls; `applied` is what actually drives the chart query (on Generate).
  const [months, setMonths] = useState(6);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<{ months?: number; date_from?: string; date_to?: string }>({ months: 6 });

  const { data, isLoading } = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => unwrap<Overview>(api.get('/admin/overview')),
  });
  const { data: dash } = useQuery({
    queryKey: ['admin-dashboard', applied],
    queryFn: () => unwrap<Dashboard>(api.get('/analytics/dashboard', { params: applied })),
  });

  const usePreset = (m: number) => {
    setCustom(false);
    setMonths(m);
    setApplied({ months: m });
  };
  const generate = () => setApplied({ date_from: from || undefined, date_to: to || undefined });
  const exportXlsx = (path: string, base: string) =>
    downloadExport(
      path,
      { format: 'xlsx', date_from: applied.date_from, date_to: applied.date_to },
      `${base}.xlsx`,
    );

  const rangeLabel = applied.date_from || applied.date_to
    ? `${applied.date_from || '…'} → ${applied.date_to || 'today'}`
    : `last ${dash?.months.length ?? months} months`;

  return (
    <div>
      <PageHeader title="Dashboard Overview" description="Instant business health, trends & daily operations." />

      <div className="card mt-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="label">Timeline</div>
            <div className="mt-1 inline-flex rounded-xl bg-slate-100/90 p-1">
              {PRESETS.map((p) => (
                <button
                  key={p.months}
                  type="button"
                  onClick={() => usePreset(p.months)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    !custom && months === p.months
                      ? 'bg-white text-brand shadow-sm ring-1 ring-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustom(true)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  custom ? 'bg-white text-brand shadow-sm ring-1 ring-slate-200/80' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Custom range
              </button>
            </div>
          </div>

          {custom && (
            <>
              <div>
                <label className="label">From</label>
                <input className="input" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">To</label>
                <input className="input" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
              <button type="button" className="btn-primary" onClick={generate}>
                Generate
              </button>
            </>
          )}

          <div className="ml-auto">
            <div className="label flex items-center gap-1">
              <Download className="h-3.5 w-3.5" /> Export to Excel
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              {EXPORTS.map((x) => (
                <button key={x.base} type="button" className="btn-ghost text-xs" onClick={() => exportXlsx(x.path, x.base)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Charts &amp; exports reflect <span className="font-medium text-slate-500">{rangeLabel}</span>. KPI tiles show current totals.
        </p>
      </div>

      {isLoading || !data ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total Students"
              value={data.students}
              icon={Users}
              accent="brand"
              to="/admin/students"
              delta={pctDelta(dash?.trends.new_students)}
              hint="Month-over-month"
            />
            <StatCard
              label="Active Memberships"
              value={data.active_memberships}
              icon={ShieldCheck}
              accent="emerald"
              to="/admin/students"
            />
            <StatCard
              label="Sales / Revenue"
              value={rupees(data.revenue_paise)}
              icon={IndianRupee}
              accent="amber"
              to="/admin/payments"
              delta={pctDelta(dash?.trends.revenue_paise)}
              hint="Month-over-month"
            />
            <StatCard
              label="Pending Verifications"
              value={data.pending_verifications}
              icon={ShieldCheck}
              accent={data.pending_verifications > 0 ? 'rose' : 'slate'}
              to="/admin/verification"
              hint={data.pending_verifications > 0 ? 'Needs review' : 'All clear'}
            />
            <StatCard
              label="Activation Codes"
              value={data.activation_codes.total}
              icon={KeyRound}
              accent="violet"
              to="/admin/codes"
              hint={`${data.activation_codes.unused} unused`}
            />
            <StatCard
              label="Community Class Members"
              value={data.community_members}
              icon={UsersRound}
              accent="sky"
              to="/admin/community"
            />
            <StatCard label="Total Teachers" value={data.teachers} icon={GraduationCap} accent="violet" to="/admin/teachers" />
            <StatCard label="Total Partners" value={data.partners} icon={Handshake} accent="rose" to="/admin/partners" />
            <StatCard label="Total Examiners" value={data.examiners} icon={ShieldCheck} accent="sky" />
            <StatCard label="Book Orders" value={data.book_orders} icon={BookOpen} accent="amber" to="/admin/books" />
            <StatCard
              label="Unused Codes"
              value={data.activation_codes.unused}
              icon={Ticket}
              accent="slate"
              to="/admin/codes"
              hint={`of ${data.activation_codes.total} total`}
            />
          </div>

          {dash && (
            <>
              <h2 className="mt-10 text-lg font-bold">Trends</h2>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <ChartCard title="Acquisition" hint="New students vs. new leads per month">
                  <LineChart
                    labels={dash.months}
                    series={[
                      { name: 'New Students', color: CHART_COLORS[0], values: dash.trends.new_students },
                      { name: 'New Leads', color: CHART_COLORS[1], values: dash.trends.new_leads },
                    ]}
                  />
                </ChartCard>
                <ChartCard title="Revenue" hint="Collected per month">
                  <BarChart labels={dash.months} values={dash.trends.revenue_paise} color={CHART_COLORS[2]} format={(n) => rupees(n)} />
                </ChartCard>
              </div>

              <h2 className="mt-10 text-lg font-bold">Breakdowns</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ChartCard title="Membership Status">
                  <DonutChart items={dash.distributions.membership} />
                </ChartCard>
                <ChartCard title="CEFR Levels">
                  <DonutChart items={dash.distributions.cefr_level} empty="No levels assigned." />
                </ChartCard>
                <ChartCard title="Lead Sources">
                  <DonutChart items={dash.distributions.lead_source} empty="No leads yet." />
                </ChartCard>
                <ChartCard title="Revenue by Type">
                  <DonutChart items={dash.distributions.payment_kind} format={(n) => rupees(n)} empty="No payments yet." />
                </ChartCard>
              </div>

              <h2 className="mt-10 text-lg font-bold">Leaderboards</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <ChartCard title="Top Teachers" hint="By average student rating">
                  <BarList items={dash.leaderboards.top_teachers} format={(n) => `${n.toFixed(1)}★`} color="#8B5CF6" empty="No reviews yet." />
                </ChartCard>
                <ChartCard title="Top Partners" hint="By approved sales">
                  <BarList items={dash.leaderboards.top_partners} format={(n) => rupees(n)} color="#EC4899" empty="No approved sales yet." />
                </ChartCard>
              </div>
            </>
          )}

          <h2 className="mt-10 text-lg font-bold">Recent Activities</h2>
          <DataTable
            rows={data.recent_activities}
            columns={activityColumns}
            rowKey={(_, i) => String(i)}
            searchText={(a) => `${a.actor ?? ''} ${a.action ?? ''} ${a.target_id ?? ''}`}
            searchPlaceholder="Search activity"
            emptyLabel="No recent activity."
          />
        </>
      )}
    </div>
  );
}
