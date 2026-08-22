import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarCheck, Coins, HandCoins, Users } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import {
  Column,
  DataTable,
  PageHeader,
  StatCard,
  StatusBadge,
  downloadExport,
  monthLabel,
  rupees,
} from './_shared';

interface PayoutTeacher {
  teacher_id: string;
  teacher_name?: string | null;
  teacher_code?: string | null;
  classes: number;
  total_paise: number;
  pending_paise: number;
  paid_paise: number;
  received_paise: number;
}

interface PayoutRow {
  id: string;
  teacher_id: string;
  teacher_name?: string | null;
  teacher_code?: string | null;
  date: string;
  batch_title?: string | null;
  present_count?: number | null;
  amount: number;
  status: string;
}

interface PayoutData {
  month: string;
  months: string[];
  teachers: PayoutTeacher[];
  rows: PayoutRow[];
  totals: {
    classes: number;
    teachers: number;
    total_paise: number;
    pending_paise: number;
    paid_paise: number;
    received_paise: number;
  };
}

/** Recent months (this month backwards) merged with months that have data. */
function monthOptions(months: string[]): string[] {
  const recent: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    recent.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return [...new Set([...recent, ...months])].sort().reverse();
}

export function AdminTeacherPayouts() {
  const qc = useQueryClient();
  const [month, setMonth] = useState('');
  const [openTeacher, setOpenTeacher] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-teacher-payouts', month],
    queryFn: () =>
      unwrap<PayoutData>(api.get('/teacher/admin/monthly-payouts', {
        params: { month: month || undefined },
      })),
  });

  const activeMonth = data?.month ?? month;

  const markMonthPaid = useMutation({
    mutationFn: (t: PayoutTeacher) =>
      unwrap(api.post('/teacher/admin/monthly-payouts/mark-paid', {
        month: activeMonth, teacher_id: t.teacher_id,
      })),
    onSuccess: () => {
      setError('');
      qc.invalidateQueries({ queryKey: ['admin-teacher-payouts'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const markOnePaid = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/mark-paid`)),
    onSuccess: () => {
      setError('');
      qc.invalidateQueries({ queryKey: ['admin-teacher-payouts'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const columns: Column<PayoutTeacher>[] = [
    {
      key: 'teacher_name',
      header: 'Teacher',
      sort: (t) => t.teacher_name ?? '',
      cell: (t) => (
        <>
          <div className="font-semibold">{t.teacher_name || '—'}</div>
          <div className="font-mono text-xs text-slate-400">{t.teacher_code || ''}</div>
        </>
      ),
    },
    {
      key: 'classes',
      header: 'Classes taken',
      align: 'right',
      sort: (t) => t.classes,
      cell: (t) => <span className="font-semibold">{t.classes}</span>,
    },
    {
      key: 'total_paise',
      header: 'Total earned',
      align: 'right',
      sort: (t) => t.total_paise,
      cell: (t) => <span className="font-semibold">{rupees(t.total_paise)}</span>,
    },
    {
      key: 'pending_paise',
      header: 'To be paid',
      align: 'right',
      sort: (t) => t.pending_paise,
      cell: (t) => (
        <span className={t.pending_paise ? 'font-bold text-amber-600' : 'text-slate-400'}>
          {rupees(t.pending_paise)}
        </span>
      ),
    },
    {
      key: 'paid_paise',
      header: 'Paid (awaiting confirm)',
      align: 'right',
      sort: (t) => t.paid_paise,
      cell: (t) => <span className="text-slate-500">{rupees(t.paid_paise)}</span>,
    },
    {
      key: 'received_paise',
      header: 'Confirmed',
      align: 'right',
      sort: (t) => t.received_paise,
      cell: (t) => <span className="text-emerald-600">{rupees(t.received_paise)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (t) => (
        <div className="flex justify-end gap-2 whitespace-nowrap">
          <button
            type="button"
            className="btn-ghost py-1 text-xs"
            onClick={() => setOpenTeacher(openTeacher === t.teacher_id ? null : t.teacher_id)}
          >
            {openTeacher === t.teacher_id ? 'Hide classes' : 'View classes'}
          </button>
          {t.pending_paise > 0 ? (
            <button
              type="button"
              className="btn-gold py-1 text-xs"
              disabled={markMonthPaid.isPending}
              onClick={() => {
                if (window.confirm(`Clear ${rupees(t.pending_paise)} to ${t.teacher_name || 'this teacher'} for ${monthLabel(activeMonth)}? The teacher then has to accept it.`)) {
                  markMonthPaid.mutate(t);
                }
              }}
            >
              Clear payment
            </button>
          ) : (
            <span className="text-xs text-slate-400">
              {t.paid_paise > 0 ? 'Awaiting teacher' : 'Settled'}
            </span>
          )}
        </div>
      ),
    },
  ];

  const classesOf = (teacherId: string) => (data?.rows ?? []).filter((r) => r.teacher_id === teacherId);

  return (
    <div>
      <PageHeader
        title="Teacher Payouts"
        description="Month-wise amount payable to each teacher, based on the batch classes taken."
      />

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Payable this month" value={rupees(data?.totals.pending_paise ?? 0)} icon={HandCoins} accent="amber" hint="Not yet marked paid" />
        <StatCard label="Total earned" value={rupees(data?.totals.total_paise ?? 0)} icon={Coins} hint={monthLabel(activeMonth || '')} />
        <StatCard label="Classes taken" value={data?.totals.classes ?? 0} icon={CalendarCheck} accent="sky" />
        <StatCard label="Teachers" value={data?.totals.teachers ?? 0} icon={Users} accent="violet" hint="With credited classes" />
      </div>

      <DataTable
        rows={data?.teachers}
        columns={columns}
        loading={isLoading}
        rowKey={(t) => t.teacher_id}
        searchText={(t) => `${t.teacher_name ?? ''} ${t.teacher_code ?? ''}`}
        searchPlaceholder="Search teacher"
        initialSort={{ key: 'pending_paise', dir: 'desc' }}
        emptyLabel="No class payments credited for this month."
        filters={
          <div>
            <label className="label">Month</label>
            <select className="input" value={activeMonth} onChange={(e) => { setMonth(e.target.value); setOpenTeacher(null); }}>
              {monthOptions(data?.months ?? []).map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </div>
        }
        toolbarRight={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => downloadExport('/teacher/admin/monthly-payouts/export', { month: activeMonth, format: 'csv' }, `teacher_payouts_${activeMonth}.csv`)}>Export CSV</button>
            <button className="btn-ghost" onClick={() => downloadExport('/teacher/admin/monthly-payouts/export', { month: activeMonth, format: 'xlsx' }, `teacher_payouts_${activeMonth}.xlsx`)}>Export XLSX</button>
          </div>
        }
        isRowExpanded={(t) => openTeacher === t.teacher_id}
        renderAfterRow={(t) => (openTeacher === t.teacher_id ? (
          <div className="pt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-3 font-semibold">Class date</th>
                  <th className="py-1 pr-3 font-semibold">Batch</th>
                  <th className="py-1 pr-3 text-right font-semibold">Attended</th>
                  <th className="py-1 pr-3 text-right font-semibold">Amount</th>
                  <th className="py-1 pr-3 font-semibold">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {classesOf(t.teacher_id).map((r) => (
                  <tr key={r.id} className="border-t border-slate-200/70">
                    <td className="py-1.5 pr-3">{r.date}</td>
                    <td className="py-1.5 pr-3">{r.batch_title || '—'}</td>
                    <td className="py-1.5 pr-3 text-right text-slate-500">{r.present_count ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{rupees(r.amount)}</td>
                    <td className="py-1.5 pr-3"><StatusBadge status={r.status} /></td>
                    <td className="py-1.5 text-right">
                      {r.status === 'pending' && (
                        <button
                          type="button"
                          className="btn-gold py-1 text-xs"
                          disabled={markOnePaid.isPending}
                          onClick={() => markOnePaid.mutate(r.id)}
                        >
                          Mark paid
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null)}
      />
    </div>
  );
}
