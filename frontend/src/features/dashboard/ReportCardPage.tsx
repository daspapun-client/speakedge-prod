/**
 * A student's CEFR-aligned result card, rendered from the record the examiner
 * filed rather than from a stored image: the artwork is the fixed background
 * and the assessed values are positioned over it, so every result card reads
 * identically and stays in step with the data behind it.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle, ArrowLeft, CalendarClock, Download, FileText, Printer, UserRound,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';
import artwork from '@/asset/cefr-result-card.png';

interface ReportDetail {
  id: string;
  student_name?: string | null;
  student_id: string;
  exam_date?: string | null;
  issue_date?: string | null;
  cefr_level?: string | null;
  report_no: string;
  scores?: Record<string, number> | null;
  remarks?: string | null;
  exam_title?: string | null;
  examiner_name?: string | null;
  pdf_url?: string | null;
}

/** "25 Aug 2026" — the date as it is printed on the result card. */
function cardDate(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** One row of the details list under the result card. */
function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-800">{value || 'Not recorded'}</dd>
    </div>
  );
}

function ReportSheet({ report }: { report: ReportDetail }) {
  return (
    <div
      className="result-sheet min-w-[680px] shadow-lg"
      style={{ backgroundImage: `url(${artwork})` }}
    >
      <div className="cert-field rc-detail" style={{ top: '40.3%' }}>
        {report.student_name ?? report.student_id}
      </div>
      <div className="cert-field rc-detail" style={{ top: '47%' }}>{report.student_id}</div>
      <div className="cert-field rc-detail" style={{ top: '53.8%' }}>{cardDate(report.exam_date)}</div>
      <div className="cert-field rc-detail" style={{ top: '60.5%' }}>{cardDate(report.issue_date)}</div>

      <div className="cert-field rc-level">{report.cefr_level ?? ''}</div>
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-64 rounded bg-slate-200" />
      <div className="aspect-[3/2] rounded-xl bg-slate-200" />
      <div className="h-40 rounded-xl bg-slate-200" />
    </div>
  );
}

export function ReportCardPage() {
  const { id = '' } = useParams();
  const { data: report, isLoading, isError } = useQuery({
    queryKey: ['cefr-report', id],
    queryFn: () => unwrap<ReportDetail>(api.get(`/exams/report/${id}`)),
  });

  if (isLoading) return <ReportSkeleton />;

  if (isError || !report) {
    return (
      <div className="space-y-6">
        <PageHeader title="CEFR Result Card" />
        <div className="card flex items-start gap-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">This result card could not be opened.</p>
            <p className="mt-1 text-slate-500">
              It may have been withdrawn, or it belongs to another account.{' '}
              <Link to="/dashboard/reports" className="font-semibold text-brand hover:text-brand-light">
                Back to your downloads
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // The four sub-skills the examiner scored, where the report carries them.
  const scores = Object.entries(report.scores ?? {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="CEFR Level Assessment Result Card"
        description={`${report.exam_title ?? 'CEFR assessment'} · Report no. ${report.report_no}`}
        actions={
          <>
            <Link to="/dashboard/exams" className="btn-ghost inline-flex items-center gap-2">
              <ArrowLeft size={16} /> My exams
            </Link>
            {report.pdf_url && (
              <a href={report.pdf_url} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-2">
                <Download size={16} /> PDF copy
              </a>
            )}
            <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => window.print()}>
              <Printer size={16} /> Print / Save as PDF
            </button>
          </>
        }
      />

      <div className="overflow-x-auto rounded-xl">
        <ReportSheet report={report} />
      </div>

      <section className="card">
        <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
          <span className="rounded-lg bg-brand/10 p-2 text-brand"><FileText size={18} /></span>
          <div>
            <h2 className="font-bold text-slate-800">Result card details</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Exactly what your examiner filed — the same record anyone verifying this
              result card sees.
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Student name" value={report.student_name} />
          <Detail label="Student ID" value={report.student_id} />
          <Detail label="CEFR level achieved" value={report.cefr_level} />
          <Detail label="Date of exam" value={cardDate(report.exam_date)} />
          <Detail label="Date of issue" value={cardDate(report.issue_date)} />
          <Detail label="Report no." value={report.report_no} />
          <Detail label="Exam" value={report.exam_title} />
          <Detail label="Examiner" value={report.examiner_name} />
        </dl>

        {scores.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {scores.map(([skill, score]) => (
              <div key={skill} className="rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{skill}</p>
                <p className="mt-1 text-lg font-extrabold text-brand">{score}</p>
              </div>
            ))}
          </div>
        )}

        {report.remarks && (
          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Examiner remarks</p>
            <p className="mt-1 text-sm text-slate-700">{report.remarks}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock size={13} /> Issued {cardDate(report.issue_date) || 'on record'}
          </span>
          {report.examiner_name && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound size={13} /> Assessed by {report.examiner_name}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
