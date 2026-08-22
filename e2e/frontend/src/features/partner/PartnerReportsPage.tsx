/**
 * Partner -> Sales / Admission Reporting + Partner Activities.
 *
 * Submitting a sale files it as *pending admin approval*; nothing counts until
 * an admin verifies it. The Activities tab is the same numbers broken down
 * product-wise, monthly and yearly, each downloadable as Excel, CSV or PDF.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Plus } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import {
  Column, DataTable, Modal, PageHeader, StatCard, StatusBadge, TableFilter,
  fmtDate, rupees,
} from '@/features/admin/_shared';
import {
  EXPORT_FORMATS, REPORT_TYPES, REPORT_TYPE_LABELS, downloadPartnerReport, periodLabel,
  usePartnerDashboard, usePartnerPerformance, type ExportFormat, type PartnerReport,
  type PeriodRow,
} from './shared';

function SubmitModal({ partnerId, products, onClose, onDone }: {
  partnerId: string; products: string[]; onClose: () => void; onDone: () => void;
}) {
  const [form, setForm] = useState({
    report_type: 'book_sale',
    product: products[0] ?? '',
    quantity: 1,
    amount: '',
    occurred_on: new Date().toISOString().slice(0, 10),
    remarks: '',
  });
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      if (form.quantity < 1) throw new Error('Quantity must be at least 1');
      return unwrap(api.post(`/partner/${partnerId}/reports`, {
        report_type: form.report_type,
        product: form.product || null,
        quantity: form.quantity,
        // Rupees in the form, paise on the wire — matching every other money field.
        amount: form.amount ? Math.round(Number(form.amount) * 100) : null,
        occurred_on: form.occurred_on || null,
        remarks: form.remarks.trim() || null,
      }));
    },
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Report a sale / admission</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Submitted reports stay pending until an admin approves them.
          </p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">What are you reporting?</label>
          <select className="input" value={form.report_type}
            onChange={(e) => setForm({ ...form, report_type: e.target.value })}>
            {REPORT_TYPES.map((t) => <option key={t} value={t}>{REPORT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Product / service</label>
          {products.length ? (
            <select className="input" value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })}>
              <option value="">Not specified</option>
              {products.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          ) : (
            <input className="input" value={form.product}
              onChange={(e) => setForm({ ...form, product: e.target.value })} />
          )}
        </div>
        <div>
          <label className="label">Quantity</label>
          <input className="input" type="number" min={1} value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) || 1 })} />
        </div>
        <div>
          <label className="label">Amount (₹, optional)</label>
          <input className="input" type="number" min={0} step="0.01" value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Date of sale</label>
          <input className="input" type="date" value={form.occurred_on}
            onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} />
          <p className="mt-1 text-xs text-slate-400">
            Monthly and yearly reports are grouped by this date.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">Remarks</label>
          <textarea className="input" rows={2} value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
        </div>
      </div>

      <button className="btn-primary mt-4 w-full" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? <><Loader2 size={16} className="animate-spin" /> Submitting…</> : 'Submit for approval'}
      </button>
    </Modal>
  );
}

/** Monthly / yearly performance table with its own download row. */
function PeriodTable({ title, rows, dataset, year }: {
  title: string; rows: PeriodRow[]; dataset: 'monthly' | 'yearly'; year?: string;
}) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const download = async (fmt: ExportFormat) => {
    setBusy(fmt);
    try {
      await downloadPartnerReport(dataset, fmt, year);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-slate-800">{title}</h3>
        <div className="flex gap-1">
          {EXPORT_FORMATS.map((f) => (
            <button key={f} className="btn-ghost py-1 text-xs uppercase" disabled={busy === f}
              onClick={() => download(f)}>
              {busy === f ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {f}
            </button>
          ))}
        </div>
      </div>
      {!rows.length ? (
        <p className="mt-3 text-sm text-slate-500">No approved activity yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2">Period</th>
                <th className="pb-2 text-right">Books</th>
                <th className="pb-2 text-right">Admissions</th>
                <th className="pb-2 text-right">Memberships</th>
                <th className="pb-2 text-right">Registrations</th>
                <th className="pb-2 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.period} className="border-t border-slate-100">
                  <td className="py-2 font-medium text-slate-700">{periodLabel(r.period)}</td>
                  <td className="py-2 text-right">{r.book_sale}</td>
                  <td className="py-2 text-right">{r.course_admission}</td>
                  <td className="py-2 text-right">{r.membership_sale}</td>
                  <td className="py-2 text-right">{r.student_registration}</td>
                  <td className="py-2 text-right text-slate-500">{rupees(r.revenue_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PartnerReportsPage() {
  const qc = useQueryClient();
  const { data: dash } = usePartnerDashboard();
  const partnerId = dash?.id;
  const [tab, setTab] = useState<'submitted' | 'activities'>('submitted');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [year, setYear] = useState('');

  const reports = useQuery({
    enabled: !!partnerId,
    queryKey: ['partner-reports', partnerId, status],
    queryFn: () => unwrap<PartnerReport[]>(
      api.get(`/partner/${partnerId}/reports`, { params: { status: status || undefined } })),
  });
  const performance = usePartnerPerformance(year);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['partner-reports'] });
    qc.invalidateQueries({ queryKey: ['partner-performance'] });
    qc.invalidateQueries({ queryKey: ['partner-dashboard'] });
  };

  const columns: Column<PartnerReport>[] = [
    {
      key: 'occurred_on',
      header: 'Date',
      sort: (r) => r.occurred_on ?? r.created_at,
      cell: (r) => <span className="text-slate-600">{r.occurred_on ?? fmtDate(r.created_at)}</span>,
    },
    {
      key: 'report_type',
      header: 'Type',
      sort: (r) => r.report_type,
      cell: (r) => REPORT_TYPE_LABELS[r.report_type] ?? r.report_type,
    },
    { key: 'product', header: 'Product', sort: (r) => r.product ?? '', cell: (r) => r.product || '—' },
    { key: 'quantity', header: 'Qty', align: 'right', sort: (r) => r.quantity },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      sort: (r) => r.amount ?? 0,
      cell: (r) => <span className="text-slate-500">{r.amount ? rupees(r.amount) : '—'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sort: (r) => r.status,
      cell: (r) => (
        <div>
          <StatusBadge status={r.status} />
          {r.review_remarks && <div className="mt-0.5 text-xs text-slate-400">{r.review_remarks}</div>}
        </div>
      ),
    },
  ];

  const perf = performance.data;
  const years = [...new Set((perf?.yearly ?? []).map((y) => y.period))].sort().reverse();

  return (
    <div>
      <PageHeader
        title="Sales & Admission Reporting"
        description="Report book sales, course admissions, memberships and registrations — each verified by admin before it counts."
        actions={
          <button className="btn-primary inline-flex items-center gap-1.5" disabled={!partnerId}
            onClick={() => setSubmitting(true)}>
            <Plus size={16} /> Report a sale
          </button>
        }
      />

      <div className="mt-4 flex gap-2">
        {(['submitted', 'activities'] as const).map((t) => (
          <button key={t} className={`btn-ghost py-1 text-xs ${tab === t ? 'bg-slate-100' : ''}`}
            onClick={() => setTab(t)}>
            {t === 'submitted' ? 'My reports' : 'Activities & downloads'}
          </button>
        ))}
      </div>

      {tab === 'submitted' && (
        <DataTable
          rows={reports.data}
          columns={columns}
          loading={reports.isLoading}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.product ?? ''} ${r.report_type} ${r.remarks ?? ''}`}
          searchPlaceholder="Search reports"
          initialSort={{ key: 'occurred_on', dir: 'desc' }}
          emptyLabel="No reports submitted yet."
          filters={
            <TableFilter
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: 'All' },
                { value: 'pending', label: 'Pending approval' },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
              ]}
            />
          }
        />
      )}

      {tab === 'activities' && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total leads" value={perf?.totals.total_leads ?? '—'} accent="brand" />
            <StatCard label="Total admissions" value={perf?.totals.total_admissions ?? '—'} accent="emerald" />
            <StatCard label="Total book orders" value={perf?.totals.total_book_orders ?? '—'} accent="sky" />
            <StatCard label="Pending approval" value={perf?.totals.pending_approval_reports ?? '—'} accent="amber" />
          </div>

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-slate-800">Product-wise performance</h3>
              <div className="flex gap-1">
                {EXPORT_FORMATS.map((f) => (
                  <button key={f} className="btn-ghost py-1 text-xs uppercase"
                    onClick={() => downloadPartnerReport('product', f)}>
                    <Download size={13} /> {f}
                  </button>
                ))}
              </div>
            </div>
            {!perf?.by_product.length ? (
              <p className="mt-3 text-sm text-slate-500">No approved sales yet.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="pb-2">Product</th>
                    <th className="pb-2 text-right">Quantity</th>
                    <th className="pb-2 text-right">Reports</th>
                    <th className="pb-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.by_product.map((p) => (
                    <tr key={p.product} className="border-t border-slate-100">
                      <td className="py-2 text-slate-700">{p.product}</td>
                      <td className="py-2 text-right font-semibold">{p.quantity}</td>
                      <td className="py-2 text-right text-slate-500">{p.reports}</td>
                      <td className="py-2 text-right text-slate-500">{rupees(p.revenue_paise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {years.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Monthly report for</span>
              <select className="input max-w-[10rem] py-1 text-sm" value={year}
                onChange={(e) => setYear(e.target.value)}>
                <option value="">All years</option>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          )}

          <PeriodTable title="Monthly performance" rows={perf?.monthly ?? []} dataset="monthly" year={year} />
          <PeriodTable title="Yearly performance" rows={perf?.yearly ?? []} dataset="yearly" />

          <div className="card">
            <h3 className="flex items-center gap-2 font-bold text-slate-800">
              <FileSpreadsheet size={17} className="text-brand" /> Download raw data
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Your full lead list and every sales report you have filed.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(['leads', 'sales'] as const).map((ds) => (
                <div key={ds} className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1">
                  <span className="px-2 text-xs font-medium capitalize text-slate-600">{ds}</span>
                  {EXPORT_FORMATS.map((f) => (
                    <button key={f} className="btn-ghost py-1 text-xs uppercase"
                      onClick={() => downloadPartnerReport(ds, f)}>
                      {f}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {submitting && partnerId && (
        <SubmitModal
          partnerId={partnerId}
          products={dash?.products_allowed ?? []}
          onClose={() => setSubmitting(false)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
