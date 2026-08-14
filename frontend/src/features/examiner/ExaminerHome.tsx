import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, StatusBadge, fmtDate } from '@/features/admin/_shared';

interface Booking {
  id: string;
  exam_id: string;
  student_id: string;
  status: string;
  created_at: string;
}

interface Exam {
  id: string;
  title: string;
  kind: string; // CEFR | Speaking
}

const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function ReportModal({ booking, exam, onClose, onDone }: { booking: Booking; exam?: Exam; onClose: () => void; onDone: () => void }) {
  const kind = exam?.kind ?? 'CEFR';
  const [level, setLevel] = useState('B1');
  const [grade, setGrade] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      unwrap<Record<string, unknown>>(api.post('/exams/report', {
        exam_booking_id: booking.id,
        student_id: booking.student_id,
        level: kind === 'CEFR' ? level : null,
        grade: kind === 'CEFR' ? null : grade,
        remarks: remarks || null,
      })),
    onSuccess: () => { setError(''); onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Submit {kind} Report</h2>
          <p className="font-mono text-xs text-slate-400">{booking.student_id} · {exam?.title ?? booking.exam_id}</p>
        </div>
        <button className="btn-ghost py-1 text-xs" onClick={onClose}>Close</button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-4 space-y-4">
        {kind === 'CEFR' ? (
          <div>
            <label className="label">CEFR level</label>
            <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
              {CEFR.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label className="label">Grade / result</label>
            <input className="input" value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="e.g. Distinction" />
          </div>
        )}
        <div>
          <label className="label">Remarks (optional)</label>
          <textarea className="input" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={submit.isPending || (kind !== 'CEFR' && !grade)} onClick={() => submit.mutate()}>
          Publish report
        </button>
      </div>
    </Modal>
  );
}

export function ExaminerHome() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Booking | null>(null);

  const { data: bookings, isLoading } = useQuery({
    queryKey: ['examiner-assigned'],
    queryFn: () => unwrap<Booking[]>(api.get('/exams/examiner/assigned')),
  });
  const { data: exams } = useQuery({
    queryKey: ['exams'],
    queryFn: () => unwrap<Exam[]>(api.get('/exams/')),
  });

  const examOf = (id: string) => exams?.find((e) => e.id === id);

  const columns: Column<Booking>[] = [
    { key: 'student_id', header: 'Student', sort: (b) => b.student_id, cell: (b) => <span className="font-mono text-xs">{b.student_id}</span> },
    { key: 'exam', header: 'Exam', sort: (b) => examOf(b.exam_id)?.title ?? b.exam_id, cell: (b) => examOf(b.exam_id)?.title ?? b.exam_id },
    { key: 'type', header: 'Type', sort: (b) => examOf(b.exam_id)?.kind ?? '', cell: (b) => examOf(b.exam_id)?.kind ?? '—' },
    { key: 'status', header: 'Status', sort: (b) => b.status, cell: (b) => <StatusBadge status={b.status} /> },
    { key: 'created_at', header: 'Booked', sort: (b) => b.created_at, cell: (b) => <span className="text-slate-500">{fmtDate(b.created_at)}</span> },
    { key: 'actions', header: '', width: '1%', cell: (b) => <button className="btn-primary py-1 text-xs" onClick={() => setSelected(b)}>Submit report</button> },
  ];

  return (
    <div>
      <PageHeader title="Examiner Dashboard" description="Exam bookings awaiting a report or certificate." />

      <DataTable
        rows={bookings}
        columns={columns}
        loading={isLoading}
        rowKey={(b) => b.id}
        searchText={(b) => `${b.student_id} ${examOf(b.exam_id)?.title ?? b.exam_id}`}
        searchPlaceholder="Search student / exam"
        initialSort={{ key: 'created_at', dir: 'desc' }}
        emptyLabel="No pending exam bookings."
      />

      {selected && (
        <ReportModal
          booking={selected}
          exam={examOf(selected.exam_id)}
          onClose={() => setSelected(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ['examiner-assigned'] })}
        />
      )}
    </div>
  );
}
