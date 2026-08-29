/**
 * Examiner -> Submitted Reports. A read-only record of everything this
 * examiner has published: CEFR report cards on one side, Speaking test
 * certificates on the other, each with the exam date, level/grade and remarks
 * that admin sees in its own result view.
 */
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, Mic } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, PageHeader, StudentAvatar, fmtDate } from '@/features/admin/_shared';

interface ResultRow {
  id: string;
  student_id: string;
  student_name?: string | null;
  student_photo_url?: string | null;
  student_gender?: string | null;
  exam_title?: string | null;
  exam_date?: string | null;
  level?: string;
  grade?: string | null;
  title?: string;
  remarks?: string | null;
  verification_code: string;
  report_url?: string | null;
  certificate_url?: string | null;
  created_at: string;
}

const studentColumn: Column<ResultRow> = {
  key: 'student',
  header: 'Student',
  sort: (r) => r.student_name ?? r.student_id,
  cell: (r) => (
    <div className="group flex items-center gap-2">
      <StudentAvatar photoUrl={r.student_photo_url} gender={r.student_gender} name={r.student_name ?? r.student_id} />
      <div className="min-w-0">
        <div className="truncate font-semibold text-slate-800">{r.student_name ?? '—'}</div>
        <div className="font-mono text-xs text-slate-400">{r.student_id}</div>
      </div>
    </div>
  ),
};

const examDateColumn: Column<ResultRow> = {
  key: 'exam_date',
  header: 'Exam date',
  sort: (r) => r.exam_date ?? r.created_at,
  cell: (r) => <span className="text-slate-600">{fmtDate(r.exam_date ?? r.created_at)}</span>,
};

const remarksColumn: Column<ResultRow> = {
  key: 'remarks',
  header: 'Remarks',
  cell: (r) => <span className="text-slate-600">{r.remarks || '—'}</span>,
};

function pdfColumn(field: 'report_url' | 'certificate_url'): Column<ResultRow> {
  return {
    key: 'pdf',
    header: 'PDF',
    width: '1%',
    cell: (r) => (r[field]
      ? <a className="text-brand underline" href={r[field] as string} target="_blank" rel="noreferrer">Open</a>
      : '—'),
  };
}

export function ExaminerReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['examiner-reports'],
    queryFn: () => unwrap<{ cefr_reports: ResultRow[]; certificates: ResultRow[] }>(
      api.get('/exams/examiner/reports')),
  });

  const cefrColumns: Column<ResultRow>[] = [
    examDateColumn,
    studentColumn,
    { key: 'level', header: 'CEFR level', sort: (r) => r.level ?? '', cell: (r) => <span className="font-semibold text-brand">{r.level}</span> },
    remarksColumn,
    { key: 'verification_code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.verification_code}</span> },
    pdfColumn('report_url'),
  ];

  const certColumns: Column<ResultRow>[] = [
    examDateColumn,
    studentColumn,
    { key: 'grade', header: 'Grade / result', sort: (r) => r.grade ?? '', cell: (r) => <span className="font-semibold text-brand">{r.grade || r.title || '—'}</span> },
    remarksColumn,
    { key: 'verification_code', header: 'Code', cell: (r) => <span className="font-mono text-xs">{r.verification_code}</span> },
    pdfColumn('certificate_url'),
  ];

  return (
    <div>
      <PageHeader
        title="Submitted Reports"
        description="Every CEFR report card and Speaking test certificate you have published."
      />

      <section className="mt-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <GraduationCap size={16} className="text-brand" /> CEFR Test Reports
        </h2>
        <DataTable
          rows={data?.cefr_reports}
          columns={cefrColumns}
          loading={isLoading}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.student_id} ${r.student_name ?? ''} ${r.level ?? ''} ${r.verification_code}`}
          searchPlaceholder="Search CEFR reports"
          initialSort={{ key: 'exam_date', dir: 'desc' }}
          emptyLabel="No CEFR reports submitted yet."
        />
      </section>

      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Mic size={16} className="text-brand-gold" /> Speaking Test Results
        </h2>
        <DataTable
          rows={data?.certificates}
          columns={certColumns}
          loading={isLoading}
          rowKey={(r) => r.id}
          searchText={(r) => `${r.student_id} ${r.student_name ?? ''} ${r.grade ?? ''} ${r.verification_code}`}
          searchPlaceholder="Search speaking results"
          initialSort={{ key: 'exam_date', dir: 'desc' }}
          emptyLabel="No speaking test results submitted yet."
        />
      </section>
    </div>
  );
}
