import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, PageHeader, Paginator, StatusBadge, TableFilter, AdminStudentLink, downloadExport, fmtDate, rupees } from './_shared';

interface Payment {
  id?: string;
  student_id: string;
  student_name?: string | null;
  student_photo_url?: string | null;
  student_gender?: string | null;
  kind: string;
  plan?: string | null;
  amount: number;
  status: string;
  payment_mode?: string | null;
  razorpay_order_id?: string | null;
  invoice_no?: string | null;
  refund_status?: string | null;
  created_at: string;
}

const STATUSES = ['', 'created', 'paid', 'failed', 'manually_approved', 'refunded', 'partially_refunded', 'cancelled'];
const REFUND_STATUSES = ['Refund Requested', 'Refund Under Review', 'Refund Approved', 'Refund Rejected', 'Refunded', 'Partially Refunded'];

export function AdminPayments() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [studentId, setStudentId] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
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
    { key: 'kind', header: 'Kind / Plan', sort: (p) => p.kind, cell: (p) => <>{p.kind}{p.plan ? ` · ${p.plan}` : ''}</> },
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
          <button
            className="btn-ghost"
            onClick={() => downloadExport('/analytics/payments/export', { status: status || undefined }, 'payments.csv')}
          >
            Export CSV
          </button>
        }
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

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
