import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { AdminStudentLink, Column, DataTable, PageHeader, Paginator, StatusBadge, TableFilter, fmtDate } from './_shared';

interface Exam {
  id: string;
  kind: string;
  title: string;
  scheduled_at?: string | null;
  examiner_id?: string | null;
}
interface Booking {
  id: string;
  student_id: string;
  student_name?: string | null;
  student_photo_url?: string | null;
  student_gender?: string | null;
  exam_title?: string | null;
  kind?: string | null;
  examiner_id?: string | null;
  status: string;
  created_at: string;
}
interface Results {
  cefr_reports: { id: string; student_id: string; student_name?: string | null; student_photo_url?: string | null; student_gender?: string | null; level: string; verification_code: string; report_url?: string | null }[];
  certificates: { id: string; student_id: string; student_name?: string | null; student_photo_url?: string | null; student_gender?: string | null; title: string; verification_code: string; certificate_url?: string | null }[];
}

export function AdminExams() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'exams' | 'bookings' | 'results'>('exams');
  const [form, setForm] = useState({ kind: 'CEFR', title: '', scheduled_at: '' });
  const [error, setError] = useState('');
  const [bkStatus, setBkStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const exams = useQuery({
    queryKey: ['admin-exams'],
    queryFn: () => unwrap<Exam[]>(api.get('/exams')),
    enabled: tab === 'exams',
  });
  const bookings = useQuery({
    queryKey: ['admin-exam-bookings', bkStatus, page],
    queryFn: () => unwrap<{ items: Booking[]; total: number }>(
      api.get('/exams/admin/bookings', { params: { status: bkStatus || undefined, page, page_size: pageSize } })),
    enabled: tab === 'bookings',
  });
  const results = useQuery({
    queryKey: ['admin-exam-results'],
    queryFn: () => unwrap<Results>(api.get('/exams/admin/results')),
    enabled: tab === 'results',
  });

  const create = useMutation({
    mutationFn: () => {
      if (!form.title.trim()) throw new Error('Exam title is required');
      return unwrap(api.post('/exams/', {
        kind: form.kind,
        title: form.title,
        // datetime-local has no zone — send it as an absolute instant.
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      }));
    },
    onSuccess: () => { setError(''); setForm({ kind: 'CEFR', title: '', scheduled_at: '' }); qc.invalidateQueries({ queryKey: ['admin-exams'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const assign = useMutation({
    mutationFn: (exam: Exam) => {
      const examiner = window.prompt('Examiner ID / username to assign?', exam.examiner_id || '');
      if (!examiner) throw new Error('Examiner id required');
      const when = window.prompt('Scheduled date/time (ISO, optional e.g. 2026-08-01T10:00)', exam.scheduled_at || '') || undefined;
      return unwrap(api.post(`/exams/${exam.id}/assign`, { examiner_id: examiner, scheduled_at: when }));
    },
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['admin-exams'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const edit = useMutation({
    mutationFn: (exam: Exam) => {
      const title = window.prompt('Exam title', exam.title);
      if (title === null) throw new Error('cancelled');
      const kind = window.prompt('Kind (CEFR or Speaking)', exam.kind) || exam.kind;
      const when = window.prompt('Scheduled date/time (ISO, blank to keep/clear)', exam.scheduled_at || '');
      const payload: Record<string, string | null> = { title: title.trim() || exam.title, kind };
      if (when !== null && when.trim()) payload.scheduled_at = new Date(when).toISOString();
      return unwrap(api.patch(`/exams/${exam.id}`, payload));
    },
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['admin-exams'] }); },
    onError: (e: Error) => { if (e.message !== 'cancelled') setError(e.message); },
  });

  const examColumns: Column<Exam>[] = [
    { key: 'title', header: 'Title', sort: (e) => e.title, cell: (e) => <span className="font-semibold">{e.title}</span> },
    { key: 'kind', header: 'Kind', sort: (e) => e.kind },
    { key: 'examiner_id', header: 'Examiner', sort: (e) => e.examiner_id ?? '', cell: (e) => <span className="font-mono text-xs">{e.examiner_id || '—'}</span> },
    { key: 'scheduled_at', header: 'Scheduled', sort: (e) => e.scheduled_at ?? '', cell: (e) => <span className="text-slate-500">{fmtDate(e.scheduled_at)}</span> },
    {
      key: 'actions',
      header: '',
      cell: (e) => (
        <div className="flex gap-1">
          <button className="btn-ghost py-1 text-xs" onClick={() => edit.mutate(e)}>Edit</button>
          <button className="btn-ghost py-1 text-xs" onClick={() => assign.mutate(e)}>Assign examiner</button>
        </div>
      ),
    },
  ];

  const bookingColumns: Column<Booking>[] = [
    { key: 'created_at', header: 'Booked', sort: (b) => b.created_at, cell: (b) => <span className="text-slate-500">{fmtDate(b.created_at)}</span> },
    { key: 'student', header: 'Student', sort: (b) => b.student_name ?? b.student_id, cell: (b) => (
      <AdminStudentLink
        studentId={b.student_id}
        name={b.student_name}
        photoUrl={b.student_photo_url}
        gender={b.student_gender}
      />
    ) },
    { key: 'exam_title', header: 'Exam', sort: (b) => b.exam_title ?? '', cell: (b) => b.exam_title || '—' },
    { key: 'kind', header: 'Kind', sort: (b) => b.kind ?? '', cell: (b) => b.kind || '—' },
    { key: 'examiner_id', header: 'Examiner', sort: (b) => b.examiner_id ?? '', cell: (b) => <span className="font-mono text-xs">{b.examiner_id || '—'}</span> },
    { key: 'status', header: 'Status', sort: (b) => b.status, cell: (b) => <StatusBadge status={b.status} /> },
  ];

  const cefrColumns: Column<Results['cefr_reports'][number]>[] = [
    { key: 'student_id', header: 'Student', sort: (r) => r.student_id, cell: (r) => (
      <AdminStudentLink studentId={r.student_id} name={r.student_name} photoUrl={r.student_photo_url} gender={r.student_gender} />
    ) },
    { key: 'level', header: 'Level', sort: (r) => r.level, cell: (r) => `Level ${r.level}` },
    { key: 'verification_code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.verification_code}</span> },
    { key: 'pdf', header: 'PDF', cell: (r) => (r.report_url ? <a className="text-brand underline" href={r.report_url} target="_blank" rel="noreferrer">PDF</a> : '—') },
  ];

  const certColumns: Column<Results['certificates'][number]>[] = [
    { key: 'student_id', header: 'Student', sort: (c) => c.student_id, cell: (c) => (
      <AdminStudentLink studentId={c.student_id} name={c.student_name} photoUrl={c.student_photo_url} gender={c.student_gender} />
    ) },
    { key: 'title', header: 'Title', sort: (c) => c.title },
    { key: 'verification_code', header: 'Code', cell: (c) => <span className="font-mono text-xs">{c.verification_code}</span> },
    { key: 'pdf', header: 'PDF', cell: (c) => (c.certificate_url ? <a className="text-brand underline" href={c.certificate_url} target="_blank" rel="noreferrer">PDF</a> : '—') },
  ];

  return (
    <div>
      <PageHeader title="Exams & Certification" description="Booking, examiner assignment, results & certificates." />
      <div className="mt-4 flex gap-2">
        {(['exams', 'bookings', 'results'] as const).map((t) => (
          <button key={t} className={`btn-ghost py-1 text-xs ${tab === t ? 'bg-slate-100' : ''}`} onClick={() => setTab(t)}>
            {t === 'exams' ? 'Exams' : t === 'bookings' ? 'Bookings' : 'Results'}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {tab === 'exams' && (
        <>
          <div className="card mt-4">
            <h2 className="text-sm font-semibold text-slate-700">Create exam slot</h2>
            <p className="mt-1 text-xs text-slate-500">
              Set a date &amp; time to make this a bookable slot on the student Exams &amp;
              Certification page. Leave it blank to publish the test without a date.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <select className="input max-w-[10rem]" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="CEFR">CEFR</option>
                <option value="Speaking">Speaking</option>
              </select>
              <input className="input max-w-sm" placeholder="Exam title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <input
                className="input max-w-[15rem]"
                type="datetime-local"
                title="Slot date & time students can book"
                value={form.scheduled_at}
                onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
              />
              <button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>Create</button>
            </div>
          </div>
          <DataTable
            rows={exams.data}
            columns={examColumns}
            loading={exams.isLoading}
            rowKey={(e) => e.id}
            searchText={(e) => `${e.title} ${e.kind} ${e.examiner_id ?? ''}`}
            searchPlaceholder="Search exams"
            emptyLabel="No exams."
          />
        </>
      )}

      {tab === 'bookings' && (
        <DataTable
          rows={bookings.data?.items}
          columns={bookingColumns}
          loading={bookings.isLoading}
          rowKey={(b) => b.id}
          emptyLabel="No bookings."
          filters={
            <TableFilter
              value={bkStatus}
              onChange={(v) => { setBkStatus(v); setPage(1); }}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'booked', label: 'Booked' },
                { value: 'completed', label: 'Completed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          }
          externalPaginator={<Paginator page={page} pageSize={pageSize} total={bookings.data?.total ?? 0} onPage={setPage} />}
        />
      )}

      {tab === 'results' && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">CEFR Report Cards</h3>
            <DataTable
              rows={results.data?.cefr_reports}
              columns={cefrColumns}
              loading={results.isLoading}
              rowKey={(r) => r.id}
              searchText={(r) => `${r.student_id} ${r.verification_code}`}
              searchPlaceholder="Search reports"
              emptyLabel="None yet."
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Certificates</h3>
            <DataTable
              rows={results.data?.certificates}
              columns={certColumns}
              loading={results.isLoading}
              rowKey={(c) => c.id}
              searchText={(c) => `${c.student_id} ${c.title} ${c.verification_code}`}
              searchPlaceholder="Search certificates"
              emptyLabel="None yet."
            />
          </div>
        </div>
      )}
    </div>
  );
}
