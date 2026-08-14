import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, StatusBadge, fmtDate, rupees } from '@/features/admin/_shared';
import { usePartnerDashboard } from './PartnerHome';

interface Report {
  id: string;
  report_type: string;
  product?: string | null;
  quantity: number;
  amount?: number | null;
  remarks?: string | null;
  status: string;
  created_at: string;
}

const REPORT_TYPES = ['book_sale', 'course_admission', 'membership_sale', 'student_registration'];

function SubmitReportModal({ partnerId, onClose, onDone }: { partnerId: string; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ report_type: 'book_sale', product: '', quantity: '1', amount: '', remarks: '' });
  const [error, setError] = useState('');
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => unwrap(api.post(`/partner/${partnerId}/reports`, {
      report_type: form.report_type,
      product: form.product || null,
      quantity: Number(form.quantity) || 1,
      amount: form.amount ? Math.round(Number(form.amount) * 100) : null,
      remarks: form.remarks || null,
    })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">Submit report</h2>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-3">
        <div>
          <label className="label">Report type</label>
          <select className="input" value={form.report_type} onChange={(e) => set('report_type', e.target.value)}>
            {REPORT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div><label className="label">Product / course</label><input className="input" value={form.product} onChange={(e) => set('product', e.target.value)} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label">Quantity</label><input className="input" type="number" min={1} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} /></div>
          <div><label className="label">Amount (₹, optional)</label><input className="input" type="number" min={0} value={form.amount} onChange={(e) => set('amount', e.target.value)} /></div>
        </div>
        <div><label className="label">Remarks</label><textarea className="input" rows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
        <p className="text-xs text-slate-400">Reports stay Pending Admin Approval until an admin approves them.</p>
        <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>Submit</button>
      </div>
    </Modal>
  );
}

export function PartnerReportsPage() {
  const qc = useQueryClient();
  const { data: dash } = usePartnerDashboard();
  const partnerId = dash?.id;
  const [adding, setAdding] = useState(false);

  const { data, isLoading } = useQuery({
    enabled: !!partnerId,
    queryKey: ['partner-reports', partnerId],
    queryFn: () => unwrap<Report[]>(api.get(`/partner/${partnerId}/reports`)),
  });

  const columns: Column<Report>[] = [
    { key: 'report_type', header: 'Type', sort: (r) => r.report_type, cell: (r) => <span className="capitalize">{r.report_type.replace(/_/g, ' ')}</span> },
    { key: 'product', header: 'Product', sort: (r) => r.product ?? '', cell: (r) => <span className="text-slate-500">{r.product || '—'}</span> },
    { key: 'quantity', header: 'Qty', align: 'right', sort: (r) => r.quantity },
    { key: 'amount', header: 'Amount', align: 'right', sort: (r) => r.amount ?? -1, cell: (r) => rupees(r.amount) },
    { key: 'status', header: 'Status', sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'created_at', header: 'Submitted', sort: (r) => r.created_at, cell: (r) => <span className="text-slate-500">{fmtDate(r.created_at)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Sales & Admission Reports"
        description="Report your sales, admissions and registrations."
        actions={<button className="btn-primary" disabled={!partnerId} onClick={() => setAdding(true)}>Submit report</button>}
      />

      <DataTable
        rows={data}
        columns={columns}
        loading={isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.report_type} ${r.product ?? ''}`}
        searchPlaceholder="Search reports"
        initialSort={{ key: 'created_at', dir: 'desc' }}
        emptyLabel="No reports yet."
      />

      {adding && partnerId && <SubmitReportModal partnerId={partnerId} onClose={() => setAdding(false)} onDone={() => qc.invalidateQueries({ queryKey: ['partner-reports'] })} />}
    </div>
  );
}
