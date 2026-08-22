import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Eye, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { fmtHm12, parseApiDate, parseSlotRange } from '@/lib/datetime';
import { Column, DataTable, PageHeader, StatCard, RowAction, RowActions, StatusBadge, rupees } from './_shared';

type PayTab = 'pending' | 'paid';

interface ClassRow {
  id: string;
  batch_id: string;
  teacher_name?: string | null;
  batch_title?: string | null;
  date: string;
  class_time?: string | null;
  present_count: number;
  absent_count: number;
  status: string;
  remuneration_id?: string | null;
  remuneration_paise: number;
  remuneration_status?: string | null;
}

function fmtClassDay(d: string) {
  return parseApiDate(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function isPaid(row: ClassRow) {
  return row.remuneration_status === 'paid' || row.remuneration_status === 'received';
}

function submittedRows(rows: ClassRow[]) {
  return rows.filter(
    (r) => (r.status === 'pending' || r.status === 'approved') && r.batch_id && r.batch_title?.trim(),
  );
}

export function AdminCompletedBatches() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<PayTab>('pending');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-completed-batches'],
    queryFn: () => unwrap<{ rows: ClassRow[] }>(api.get('/teacher/admin/class-report', { params: { status: 'all' } })),
  });

  const all = useMemo(() => submittedRows(data?.rows ?? []), [data]);
  const pendingRows = useMemo(() => all.filter((r) => !isPaid(r)), [all]);
  const paidRows = useMemo(() => all.filter(isPaid), [all]);
  const rows = tab === 'pending' ? pendingRows : paidRows;

  const markPaid = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/mark-paid`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-completed-batches'] }),
  });

  const columns: Column<ClassRow>[] = [
    {
      key: 'title',
      header: 'Class',
      sort: (r) => `${r.batch_title ?? ''}${r.date}`,
      cell: (r) => (
        <div>
          <Link to={`/admin/batches/${r.batch_id}`} className="font-semibold text-brand hover:underline">{r.batch_title || '—'}</Link>
          <p className="mt-0.5 text-[11px] text-slate-400">{fmtClassDay(r.date)}</p>
        </div>
      ),
    },
    {
      key: 'teacher',
      header: 'Teacher',
      sort: (r) => r.teacher_name ?? '',
      cell: (r) => r.teacher_name ? <span className="font-medium text-slate-800">{r.teacher_name}</span> : <span className="text-slate-400">—</span>,
    },
    {
      key: 'time',
      header: 'Slot',
      sort: (r) => r.class_time ?? '',
      cell: (r) => {
        const slot = parseSlotRange(r.class_time);
        if (!slot) return <span className="text-slate-400">—</span>;
        return (
          <div className="inline-flex items-center gap-2.5 rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/80 px-3 py-2 shadow-sm">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100/80 text-amber-700">
              <Clock size={15} />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700/80">Class time · IST</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">
                {fmtHm12(slot.start)}
                <span className="mx-1 font-normal text-slate-300">–</span>
                {fmtHm12(slot.end)}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      key: 'members',
      header: 'Present',
      align: 'right',
      sort: (r) => r.present_count,
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-1.5 font-semibold tabular-nums text-slate-800">
          <Users size={14} className="text-slate-400" />{r.present_count}
        </span>
      ),
    },
    {
      key: 'attendance',
      header: 'Attendance',
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 badge bg-green-100 text-green-700">
          <CheckCircle2 size={12} /> {r.status === 'approved' ? 'Approved' : 'Submitted'}
        </span>
      ),
    },
    {
      key: 'pay',
      header: 'Pay',
      align: 'right',
      sort: (r) => r.remuneration_paise,
      cell: (r) => <span className="font-semibold">{r.remuneration_paise ? rupees(r.remuneration_paise) : '—'}</span>,
    },
    {
      key: 'pay_status',
      header: 'Pay status',
      cell: (r) => (r.remuneration_status ? <StatusBadge status={r.remuneration_status} /> : <span className="badge bg-amber-100 text-amber-700">Awaiting pay</span>),
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (r) => (
        <div className="flex items-center gap-2">
          <RowActions>
            <RowAction icon={Eye} label="View class" variant="primary" to={`/admin/batches/${r.batch_id}`} />
          </RowActions>
          {tab === 'pending' && r.remuneration_id && r.remuneration_status === 'pending' && (
            <button type="button" className="btn-gold py-1 text-xs" disabled={markPaid.isPending} onClick={() => markPaid.mutate(r.remuneration_id!)}>
              Mark paid
            </button>
          )}
        </div>
      ),
    },
  ];

  const TABS: { key: PayTab; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending payment', count: pendingRows.length },
    { key: 'paid', label: 'Paid', count: paidRows.length },
  ];

  return (
    <div>
      <PageHeader
        title="Completed batches"
        description="Classes with submitted attendance — track teacher pay pending vs paid."
      />

      {!isLoading && all.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <StatCard label="Classes completed" value={all.length} hint="Attendance submitted" icon={CheckCircle2} />
          <StatCard label="Pending payment" value={pendingRows.length} hint="Not yet marked paid" />
          <StatCard label="Paid" value={paidRows.length} hint="Marked paid or confirmed" />
        </div>
      )}

      <div className="mt-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium ${tab === t.key ? 'border-b-2 border-brand text-brand' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        loading={isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.batch_title ?? ''} ${r.teacher_name ?? ''} ${r.date}`}
        searchPlaceholder="Search course, teacher or date…"
        initialSort={{ key: 'title', dir: 'desc' }}
        pageSize={20}
        emptyLabel={tab === 'pending'
          ? 'No classes awaiting payment.'
          : 'No paid classes yet.'}
      />
    </div>
  );
}
