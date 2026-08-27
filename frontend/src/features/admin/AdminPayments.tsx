import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, Paginator, StatusBadge, TableFilter, AdminStudentLink, downloadExport, fmtDate, rupees } from './_shared';

interface Payment {
  id?: string;
  student_id: string;
  student_name?: string | null;
  student_photo_url?: string | null;
  student_gender?: string | null;
  kind: string;
  plan?: string | null;
  /** What a kind="general" payment was for — it prints on the receipt. */
  purpose?: string | null;
  amount: number;
  status: string;
  payment_mode?: string | null;
  razorpay_order_id?: string | null;
  invoice_no?: string | null;
  refund_status?: string | null;
  created_at: string;
}

/**
 * Record a payment that fits none of the other categories. The purpose admin
 * picks (or types) is what the receipt prints as its description, so it is the
 * one required field beyond the student and the amount.
 */
function GeneralPaymentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState('');
  const { data: purposes = [] } = useQuery({
    queryKey: ['general-purposes'],
    queryFn: () => unwrap<string[]>(api.get('/payments/admin/general/purposes')),
  });
  const [purpose, setPurpose] = useState('');
  const [custom, setCustom] = useState('');

  const save = useMutation({
    mutationFn: (form: HTMLFormElement) => {
      const f = new FormData(form);
      const chosen = (purpose === 'Other' ? custom : purpose).trim();
      if (!chosen) throw new Error('Choose or enter what this payment is for');
      const rupeeAmount = Number(f.get('amount'));
      if (!rupeeAmount || rupeeAmount <= 0) throw new Error('Enter a valid amount');
      return unwrap(api.post('/payments/admin/general', {
        student_id: (f.get('student_id') as string).trim(),
        // The API speaks paise; admin types rupees.
        amount: Math.round(rupeeAmount * 100),
        purpose: chosen,
        payment_mode: f.get('payment_mode') as string,
        transaction_ref: (f.get('transaction_ref') as string) || undefined,
        remarks: (f.get('remarks') as string) || undefined,
      }));
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-bold">Record a payment</h2>
      <p className="mt-1 text-sm text-slate-500">
        For miscellaneous payments already collected. It is recorded as settled and the
        student can download the receipt from their dashboard.
      </p>
      <form
        className="mt-4 grid gap-3"
        onSubmit={(e) => { e.preventDefault(); setError(''); save.mutate(e.currentTarget); }}
      >
        <div>
          <label className="label">Student ID *</label>
          <input name="student_id" className="input" placeholder="SPK-26-XXXXXX" required />
        </div>
        <div>
          <label className="label">What is this payment for? *</label>
          <select
            className="input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            required
          >
            <option value="">Select a purpose…</option>
            {purposes.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {purpose === 'Other' && (
          <div>
            <label className="label">Describe the payment *</label>
            <input
              className="input"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Appears on the receipt exactly as typed"
              required
            />
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Amount (₹) *</label>
            <input name="amount" type="number" min="1" step="0.01" className="input" required />
          </div>
          <div>
            <label className="label">Payment mode</label>
            <select name="payment_mode" className="input" defaultValue="manual">
              {['manual', 'cash', 'upi_manual', 'bank_transfer'].map((m) => (
                <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Transaction reference</label>
          <input name="transaction_ref" className="input" placeholder="UPI / receipt number" />
        </div>
        <div>
          <label className="label">Remarks</label>
          <input name="remarks" className="input" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const STATUSES = ['', 'created', 'paid', 'failed', 'manually_approved', 'refunded', 'partially_refunded', 'cancelled'];
const REFUND_STATUSES = ['Refund Requested', 'Refund Under Review', 'Refund Approved', 'Refund Rejected', 'Refunded', 'Partially Refunded'];

export function AdminPayments() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [studentId, setStudentId] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const pageSize = 25;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-payments', status, studentId, page],
    queryFn: () =>
      unwrap<{ items: Payment[]; total: number }>(
        api.get('/payments/admin/all', {
          params: { status: status || undefined, student_id: studentId || undefined, page, page_size: pageSize },
        }),
      ),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-payments'] });

  const approve = useMutation({
    mutationFn: (p: Payment) => {
      if (!p.razorpay_order_id) throw new Error('This payment has no order id to approve');
      const ref = window.prompt('Transaction reference (optional)?') || undefined;
      return unwrap(api.post('/payments/manual-approve', {
        order_id: p.razorpay_order_id, payment_mode: 'manual', transaction_ref: ref,
      }));
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const setRefund = useMutation({
    mutationFn: (p: Payment) => {
      if (!p.razorpay_order_id) throw new Error('This payment has no order id');
      const rs = window.prompt(`Set refund status to one of:\n${REFUND_STATUSES.join(', ')}`, 'Refund Requested');
      if (!rs || !REFUND_STATUSES.includes(rs)) throw new Error('Invalid refund status');
      return unwrap(api.post(`/payments/${p.razorpay_order_id}/refund-status`, { refund_status: rs }));
    },
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const columns: Column<Payment>[] = [
    { key: 'created_at', header: 'Date', sort: (p) => p.created_at, cell: (p) => <span className="text-slate-500">{fmtDate(p.created_at)}</span> },
    { key: 'student_id', header: 'Student', sort: (p) => p.student_id, cell: (p) => (
      <AdminStudentLink
        studentId={p.student_id}
        name={p.student_name}
        photoUrl={p.student_photo_url}
        gender={p.student_gender}
      />
    ) },
    { key: 'kind', header: 'Kind / Plan', sort: (p) => p.kind, cell: (p) => <>{p.kind}{p.plan ? ` · ${p.plan}` : ''}{p.purpose ? ` · ${p.purpose}` : ''}</> },
    { key: 'amount', header: 'Amount', align: 'right', sort: (p) => p.amount, cell: (p) => <span className="font-semibold">{rupees(p.amount)}</span> },
    { key: 'status', header: 'Status', sort: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
    { key: 'refund_status', header: 'Refund', cell: (p) => (p.refund_status ? <StatusBadge status={p.refund_status} /> : '—') },
    {
      key: 'actions',
      header: 'Actions',
      cell: (p) => (
        <div className="flex flex-wrap gap-1">
          {(p.status === 'created' || p.status === 'failed') && (
            <button className="btn-ghost py-1 text-xs" onClick={() => approve.mutate(p)}>Approve</button>
          )}
          <button className="btn-ghost py-1 text-xs" onClick={() => setRefund.mutate(p)}>Refund</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Payment Management"
        description="Razorpay tracking, manual approval, refunds and reconciliation."
        actions={
          <div className="flex gap-2">
            <button className="btn-primary" onClick={() => setRecording(true)}>
              Record a payment
            </button>
            <button
              className="btn-ghost"
              onClick={() => downloadExport('/analytics/payments/export', { status: status || undefined, format: 'csv' }, 'payments.csv')}
            >
              Export CSV
            </button>
            <button
              className="btn-ghost"
              onClick={() => downloadExport('/analytics/payments/export', { status: status || undefined, format: 'xlsx' }, 'payments.xlsx')}
            >
              Export Excel
            </button>
          </div>
        }
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {recording && (
        <GeneralPaymentModal onClose={() => setRecording(false)} onSaved={refresh} />
      )}

      <DataTable
        rows={data?.items}
        columns={columns}
        loading={isLoading}
        rowKey={(p, i) => p.id ?? String(i)}
        emptyLabel="No payments found."
        filters={
          <>
            <TableFilter
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={STATUSES.map((s) => ({ value: s, label: s || 'All statuses' }))}
            />
            <input
              className="input max-w-xs"
              placeholder="Filter by Student ID"
              value={studentId}
              onChange={(e) => { setStudentId(e.target.value); setPage(1); }}
            />
          </>
        }
        externalPaginator={<Paginator page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} />}
      />
    </div>
  );
}
