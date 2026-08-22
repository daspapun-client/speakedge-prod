import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CalendarX, Clock, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import {
  AdminStudentLink, Column, DataTable, PageHeader, Paginator, StatCard, StatusBadge,
  TableFilter, fmtDate,
} from './_shared';

/* Monitoring view for the attendance workflow:
 * 24h before class the student is asked to confirm; 18h later an unanswered
 * request auto-cancels that student's seat. */

interface Confirmation {
  id: string;
  source: 'batch' | 'community';
  class_ref: string;
  class_title: string;
  class_date: string;
  class_time?: string | null;
  student_id: string;
  student_name?: string | null;
  student_photo_url?: string | null;
  student_gender?: string | null;
  status: 'pending' | 'confirmed' | 'declined' | 'expired';
  notified_at: string;
  deadline_at: string;
  responded_at?: string | null;
  cancel_notified: boolean;
}
interface Page {
  items: Confirmation[];
  total: number;
  page: number;
  page_size: number;
  counts: Record<string, number>;
}

const PAGE_SIZE = 50;

export function AdminClassAttendance() {
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [page, setPage] = useState(1);

  const data = useQuery({
    queryKey: ['admin-attendance-confirmations', status, source, page],
    queryFn: () => unwrap<Page>(api.get('/admin/attendance-confirmations', {
      params: {
        status: status || undefined,
        source: source || undefined,
        page,
        page_size: PAGE_SIZE,
      },
    })),
  });

  const counts = data.data?.counts ?? {};

  const columns: Column<Confirmation>[] = [
    {
      key: 'student',
      header: 'Student',
      sort: (r) => r.student_name ?? r.student_id,
      cell: (r) => (
        <AdminStudentLink
          studentId={r.student_id}
          name={r.student_name}
          photoUrl={r.student_photo_url}
          gender={r.student_gender}
        />
      ),
    },
    {
      key: 'class',
      header: 'Class',
      sort: (r) => r.class_title,
      cell: (r) => (
        <div>
          <p className="font-medium text-slate-800">{r.class_title || '—'}</p>
          <p className="text-xs text-slate-400">
            {r.class_date}
            {r.class_time ? ` · ${r.class_time}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Type',
      sort: (r) => r.source,
      cell: (r) => (
        <span className="badge bg-slate-100 text-slate-600">
          {r.source === 'batch' ? 'Teacher-led' : 'Community'}
        </span>
      ),
    },
    { key: 'notified_at', header: 'Asked', sort: (r) => r.notified_at, cell: (r) => <span className="text-xs text-slate-500">{fmtDate(r.notified_at)}</span> },
    { key: 'deadline_at', header: 'Deadline', sort: (r) => r.deadline_at, cell: (r) => <span className="text-xs text-slate-500">{fmtDate(r.deadline_at)}</span> },
    {
      key: 'status',
      header: 'Status',
      sort: (r) => r.status,
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={r.status === 'expired' ? 'cancelled' : r.status} />
          {r.status === 'expired' && r.cancel_notified && (
            <span className="text-[10px] text-slate-400">Student notified</span>
          )}
          {r.responded_at && r.status !== 'expired' && (
            <span className="text-[10px] text-slate-400">{fmtDate(r.responded_at)}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Class Attendance"
        description="Students are asked to confirm 24 hours before class. Unanswered requests release the seat automatically 18 hours later."
      />

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <StatCard label="Awaiting response" value={counts.pending ?? '—'} icon={Clock} accent="amber" />
        <StatCard label="Confirmed" value={counts.confirmed ?? '—'} icon={UserCheck} accent="emerald" />
        <StatCard label="Declined" value={counts.declined ?? '—'} icon={CalendarX} accent="slate" />
        <StatCard label="Auto-cancelled" value={counts.expired ?? '—'} icon={CalendarCheck} accent="rose" hint="No response before the deadline" />
      </div>

      <DataTable
        rows={data.data?.items}
        columns={columns}
        loading={data.isLoading}
        rowKey={(r) => r.id}
        searchText={(r) => `${r.student_name ?? ''} ${r.student_id} ${r.class_title}`}
        searchPlaceholder="Search student or class"
        emptyLabel="No attendance requests yet."
        initialSort={{ key: 'deadline_at', dir: 'desc' }}
        filters={
          <>
            <TableFilter
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={[
                { value: '', label: 'All' },
                { value: 'pending', label: 'Pending' },
                { value: 'confirmed', label: 'Confirmed' },
                { value: 'declined', label: 'Declined' },
                { value: 'expired', label: 'Cancelled' },
              ]}
            />
            <TableFilter
              value={source}
              onChange={(v) => { setSource(v); setPage(1); }}
              options={[
                { value: '', label: 'All classes' },
                { value: 'batch', label: 'Teacher-led' },
                { value: 'community', label: 'Community' },
              ]}
            />
          </>
        }
        externalPaginator={
          <Paginator
            page={page}
            pageSize={PAGE_SIZE}
            total={data.data?.total ?? 0}
            onPage={setPage}
          />
        }
      />
    </div>
  );
}
