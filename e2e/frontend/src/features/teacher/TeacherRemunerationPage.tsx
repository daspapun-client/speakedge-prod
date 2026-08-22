import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import {
  Column,
  DataTable,
  PageHeader,
  StatusBadge,
  monthLabel,
  rupees,
} from '@/features/admin/_shared';

interface Remuneration {
  id: string;
  period: string;
  amount: number;
  status: string;
  received_confirmed_at?: string | null;
  created_at: string;
}

interface MonthRow {
  month: string;
  classes: number;
  total_paise: number;
  pending_paise: number;
  paid_paise: number;
  received_paise: number;
}

function byMonth(items: Remuneration[]): MonthRow[] {
  const map = new Map<string, MonthRow>();
  for (const r of items) {
    const month = (r.period || '').slice(0, 7);
    const row = map.get(month) ?? {
      month, classes: 0, total_paise: 0, pending_paise: 0, paid_paise: 0, received_paise: 0,
    };
    row.classes += 1;
    row.total_paise += r.amount;
    if (r.status === 'pending') row.pending_paise += r.amount;
    if (r.status === 'paid') row.paid_paise += r.amount;
    if (r.status === 'received') row.received_paise += r.amount;
    map.set(month, row);
  }
  return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

export function TeacherRemunerationPage() {
  const qc = useQueryClient();
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['teacher-remuneration'],
    queryFn: () => unwrap<Remuneration[]>(api.get('/teacher/my-remuneration')),
  });

  const invalidate = () => {
    setError('');
    qc.invalidateQueries({ queryKey: ['teacher-remuneration'] });
    qc.invalidateQueries({ queryKey: ['teacher-dashboard'] });
  };

  const confirmOne = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/teacher/remuneration/${id}/confirm-received`)),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const confirmMonth = useMutation({
    mutationFn: (month: string) => unwrap(api.post('/teacher/my-payouts/confirm-month', { month })),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const months = byMonth(data ?? []);
  const classesOf = (month: string) =>
    (data ?? [])
      .filter((r) => (r.period || '').startsWith(month))
      .sort((a, b) => b.period.localeCompare(a.period));

  const columns: Column<MonthRow>[] = [
    {
      key: 'month',
      header: 'Month',
      sort: (m) => m.month,
      cell: (m) => <span className="font-semibold">{monthLabel(m.month)}</span>,
    },
    {
      key: 'classes',
      header: 'Classes taken',
      align: 'right',
      sort: (m) => m.classes,
      cell: (m) => <span className="font-semibold">{m.classes}</span>,
    },
    {
      key: 'total_paise',
      header: 'Total earned',
      align: 'right',
      sort: (m) => m.total_paise,
      cell: (m) => <span className="font-semibold">{rupees(m.total_paise)}</span>,
    },
    {
      key: 'pending_paise',
      header: 'Yet to be paid',
      align: 'right',
      sort: (m) => m.pending_paise,
      cell: (m) => (
        <span className={m.pending_paise ? 'font-bold text-amber-600' : 'text-slate-400'}>
          {rupees(m.pending_paise)}
        </span>
      ),
    },
    {
      key: 'paid_paise',
      header: 'Awaiting your confirmation',
      align: 'right',
      sort: (m) => m.paid_paise,
      cell: (m) => (
        <span className={m.paid_paise ? 'font-bold text-sky-600' : 'text-slate-400'}>
          {rupees(m.paid_paise)}
        </span>
      ),
    },
    {
      key: 'received_paise',
      header: 'Confirmed',
      align: 'right',
      sort: (m) => m.received_paise,
      cell: (m) => <span className="text-emerald-600">{rupees(m.received_paise)}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (m) => (
        <div className="flex justify-end gap-2 whitespace-nowrap">
          <button
            type="button"
            className="btn-ghost py-1 text-xs"
            onClick={() => setOpenMonth(openMonth === m.month ? null : m.month)}
          >
            {openMonth === m.month ? 'Hide classes' : 'View classes'}
          </button>
          {m.paid_paise > 0 && (
            <button
              type="button"
              className="btn-gold py-1 text-xs"
              disabled={confirmMonth.isPending}
              onClick={() => {
                if (window.confirm(`Confirm you received ${rupees(m.paid_paise)} for ${monthLabel(m.month)}?`)) {
                  confirmMonth.mutate(m.month);
                }
              }}
            >
              Accept payment
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Earnings"
        description="Month-wise remuneration for the classes you took. Accept a payment once the admin has cleared it."
      />

      {error && <div className="mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</div>}

      <DataTable
        rows={months}
        columns={columns}
        loading={isLoading}
        rowKey={(m) => m.month}
        searchText={(m) => `${m.month} ${monthLabel(m.month)}`}
        searchPlaceholder="Search month"
        initialSort={{ key: 'month', dir: 'desc' }}
        emptyLabel="No remuneration yet."
        isRowExpanded={(m) => openMonth === m.month}
        renderAfterRow={(m) => (openMonth === m.month ? (
          <div className="pt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-1 pr-3 font-semibold">Class date</th>
                  <th className="py-1 pr-3 text-right font-semibold">Amount</th>
                  <th className="py-1 pr-3 font-semibold">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {classesOf(m.month).map((r) => (
                  <tr key={r.id} className="border-t border-slate-200/70">
                    <td className="py-1.5 pr-3">{r.period}</td>
                    <td className="py-1.5 pr-3 text-right font-semibold">{rupees(r.amount)}</td>
                    <td className="py-1.5 pr-3"><StatusBadge status={r.status} /></td>
                    <td className="py-1.5 text-right">
                      {r.status === 'paid' && (
                        <button
                          type="button"
                          className="btn-gold py-1 text-xs"
                          disabled={confirmOne.isPending}
                          onClick={() => confirmOne.mutate(r.id)}
                        >
                          Accept
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
