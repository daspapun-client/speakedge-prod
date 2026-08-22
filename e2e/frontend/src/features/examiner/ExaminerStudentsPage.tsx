/**
 * Examiner -> Search Students.
 *
 * Scoped to the students booked into this examiner's own slots: the examiner
 * can find anyone they are assessing, see that student's slot history and jump
 * straight into the report form. It is deliberately not a directory of the
 * whole student base.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Award, CalendarClock, Clock, Download, Search, UserRound } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader, StatusBadge, StudentAvatar, badgeClass, fmtDate } from '@/features/admin/_shared';
import { fmtSlot, slotWindow, type AssignedBooking } from '@/features/exams/shared';
import { ReportModal } from './ReportModal';

interface StudentBooking {
  id: string;
  exam_title: string;
  kind: string;
  scheduled_at?: string | null;
  duration_minutes: number;
  status: string;
  reported: boolean;
}

interface StudentResult {
  type: 'cefr_report' | 'certificate';
  level?: string | null;
  grade?: string | null;
  remarks?: string | null;
  url?: string | null;
  created_at: string;
}

interface ExaminerStudent {
  student_id: string;
  student_name?: string | null;
  student_photo_url?: string | null;
  student_gender?: string | null;
  cefr_level?: string | null;
  audience?: string | null;
  bookings: StudentBooking[];
  results?: StudentResult[];
  completed: number;
  pending: number;
}

function StudentCard({ student, onReport }: {
  student: ExaminerStudent;
  onReport: (booking: StudentBooking) => void;
}) {
  return (
    <article className="card">
      <div className="group flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <StudentAvatar
            photoUrl={student.student_photo_url}
            gender={student.student_gender}
            name={student.student_name ?? student.student_id}
            size="h-12 w-12"
            iconSize={22}
          />
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800">{student.student_name ?? student.student_id}</h3>
            <p className="font-mono text-xs text-slate-400">{student.student_id}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              {student.cefr_level && <span className="badge bg-emerald-100 text-emerald-700">CEFR {student.cefr_level}</span>}
              {student.audience && <span className="badge bg-slate-100 text-slate-600 capitalize">{student.audience}</span>}
            </div>
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>{student.pending} awaiting report</div>
          <div>{student.completed} completed</div>
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
        {student.bookings.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50/70 px-3 py-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-700">{b.exam_title}</span>
                <span className={`badge ${badgeClass(b.kind)}`}>{b.kind}</span>
                <StatusBadge status={b.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <CalendarClock size={12} className="text-brand" />
                  {fmtSlot(b.scheduled_at) ?? 'Not scheduled'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} className="text-brand" />
                  {slotWindow(b.scheduled_at, b.duration_minutes)}
                </span>
              </div>
            </div>
            {!b.reported && b.status !== 'cancelled' && (
              <button className="btn-primary py-1 text-xs" onClick={() => onReport(b)}>Submit report</button>
            )}
          </div>
        ))}
      </div>

      {!!student.results?.length && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          {student.results.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
                  <Award size={14} className="shrink-0" />
                  {r.type === 'cefr_report' ? `CEFR Level ${r.level}` : `Result: ${r.grade}`}
                </p>
                {r.remarks && <p className="mt-0.5 text-sm text-emerald-900/80">{r.remarks}</p>}
                <p className="mt-0.5 text-xs text-emerald-700/70">Submitted {fmtDate(r.created_at)}</p>
              </div>
              {r.url && (
                <a href={r.url} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-1.5 py-1 text-xs">
                  <Download size={13} /> PDF
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function ExaminerStudentsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<AssignedBooking | null>(null);

  const students = useQuery({
    queryKey: ['examiner-students'],
    queryFn: () => unwrap<ExaminerStudent[]>(api.get('/exams/examiner/students')),
  });

  const needle = q.trim().toLowerCase();
  const visible = (students.data ?? []).filter((s) =>
    !needle
    || s.student_id.toLowerCase().includes(needle)
    || (s.student_name ?? '').toLowerCase().includes(needle)
    || s.bookings.some((b) => b.exam_title.toLowerCase().includes(needle)));

  /** Bridge a student's booking row into the shape the report form expects. */
  const openReport = (student: ExaminerStudent, booking: StudentBooking) =>
    setSelected({
      id: booking.id,
      exam_id: '',
      student_id: student.student_id,
      status: booking.status,
      created_at: '',
      exam_title: booking.exam_title,
      kind: booking.kind,
      scheduled_at: booking.scheduled_at,
      duration_minutes: booking.duration_minutes,
      student_name: student.student_name,
      student_photo_url: student.student_photo_url,
      student_gender: student.student_gender,
      reported: booking.reported,
    });

  return (
    <div>
      <PageHeader
        title="Search Students"
        description="Every student booked into one of your exam slots, with their history and results."
      />

      <div className="card mt-4">
        <label className="label" htmlFor="examiner-student-search">Search by name, Student ID or exam</label>
        <div className="relative mt-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            id="examiner-student-search"
            className="input pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. SPK-26-A1B2C3 or Ananya"
          />
        </div>
      </div>

      {students.isLoading ? (
        <div className="mt-4 space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => <div key={i} className="h-40 rounded-xl bg-slate-200" />)}
        </div>
      ) : !visible.length ? (
        <div className="card mt-4 py-10 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
            <UserRound size={22} />
          </div>
          <p className="mt-3 font-semibold text-slate-700">
            {students.data?.length ? 'No student matches that search' : 'No students assigned yet'}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {students.data?.length
              ? 'Try a different name or Student ID.'
              : 'Students appear here once they book one of your assigned exam slots.'}
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {visible.map((s) => (
            <StudentCard key={s.student_id} student={s} onReport={(b) => openReport(s, b)} />
          ))}
        </div>
      )}

      {selected && (
        <ReportModal
          booking={selected}
          onClose={() => setSelected(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['examiner-students'] });
            qc.invalidateQueries({ queryKey: ['examiner-assigned'] });
            qc.invalidateQueries({ queryKey: ['examiner-summary'] });
            qc.invalidateQueries({ queryKey: ['examiner-reports'] });
          }}
        />
      )}
    </div>
  );
}
