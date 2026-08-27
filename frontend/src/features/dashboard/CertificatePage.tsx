/**
 * A student's CEFR-aligned certificate, rendered from the record the examiner
 * filed rather than from a stored image: the artwork is the fixed background
 * and the awarded values are positioned over it, so every certificate reads
 * identically and stays in step with the data behind it.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Award, AlertCircle, ArrowLeft, CalendarClock, Download, Printer, UserRound,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';
import artwork from '@/asset/certificate-cefr.png';

interface CertificateDetail {
  id: string;
  student_name?: string | null;
  student_id: string;
  assessment_date?: string | null;
  issue_date?: string | null;
  certificate_no: string;
  cefr_level?: string | null;
  title: string;
  grade?: string | null;
  remarks?: string | null;
  exam_title?: string | null;
  examiner_name?: string | null;
  pdf_url?: string | null;
}

/** Public page a scan of this certificate must open — no account required. */
function publicVerifyUrl(code: string) {
  return `${window.location.origin}/verify/${encodeURIComponent(code)}`;
}

/** "25 Aug 2026" — the date as it is printed on the certificate. */
function certDate(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** One row of the details list under the certificate. */
function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-800">{value || 'Not recorded'}</dd>
    </div>
  );
}

function CertificateSheet({ cert }: { cert: CertificateDetail }) {
  const name = cert.student_name ?? cert.student_id;
  const verifyUrl = publicVerifyUrl(cert.certificate_no);
  return (
    <div
      className="cert-sheet min-w-[680px] shadow-lg"
      style={{ backgroundImage: `url(${artwork})` }}
    >
      <div className="cert-field cert-detail" style={{ top: '41.26%' }}>{name}</div>
      <div className="cert-field cert-detail" style={{ top: '46.44%' }}>{cert.student_id}</div>
      <div className="cert-field cert-detail" style={{ top: '51.71%' }}>{certDate(cert.assessment_date)}</div>
      <div className="cert-field cert-detail" style={{ top: '56.98%' }}>{certDate(cert.issue_date)}</div>
      <div className="cert-field cert-detail" style={{ top: '62.26%' }}>{cert.certificate_no}</div>

      <div className="cert-field cert-name">{name}</div>
      <div className="cert-field cert-level">{cert.cefr_level ?? ''}</div>

      <a className="cert-qr" href={verifyUrl} target="_blank" rel="noreferrer" aria-label="Verify this certificate">
        <QRCodeSVG value={verifyUrl} size={256} bgColor="#ffffff" fgColor="#111111" level="M" marginSize={1} />
      </a>
    </div>
  );
}

function CertificateSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-64 rounded bg-slate-200" />
      <div className="aspect-[3/2] rounded-xl bg-slate-200" />
      <div className="h-40 rounded-xl bg-slate-200" />
    </div>
  );
}

export function CertificatePage() {
  const { id = '' } = useParams();
  const { data: cert, isLoading, isError } = useQuery({
    queryKey: ['certificate', id],
    queryFn: () => unwrap<CertificateDetail>(api.get(`/exams/certificate/${id}`)),
  });

  if (isLoading) return <CertificateSkeleton />;

  if (isError || !cert) {
    return (
      <div className="space-y-6">
        <PageHeader title="Certificate" />
        <div className="card flex items-start gap-3 text-sm text-red-700">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">This certificate could not be opened.</p>
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificate of English Communication"
        description={`${cert.title} · Certificate no. ${cert.certificate_no}`}
        actions={
          <>
            <Link to="/dashboard/exams" className="btn-ghost inline-flex items-center gap-2">
              <ArrowLeft size={16} /> My exams
            </Link>
            {cert.pdf_url && (
              <a href={cert.pdf_url} target="_blank" rel="noreferrer" className="btn-ghost inline-flex items-center gap-2">
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
        <CertificateSheet cert={cert} />
      </div>

      <section className="card">
        <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
          <span className="rounded-lg bg-brand-gold/15 p-2 text-brand-gold"><Award size={18} /></span>
          <div>
            <h2 className="font-bold text-slate-800">Certificate details</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Exactly what your examiner filed — the same record anyone verifying this
              certificate sees.
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Student name" value={cert.student_name} />
          <Detail label="Student ID" value={cert.student_id} />
          <Detail label="CEFR level achieved" value={cert.cefr_level} />
          <Detail label="Result" value={cert.grade} />
          <Detail label="Assessment date" value={certDate(cert.assessment_date)} />
          <Detail label="Date of issue" value={certDate(cert.issue_date)} />
          <Detail label="Certificate no." value={cert.certificate_no} />
          <Detail label="Exam" value={cert.exam_title} />
          <Detail label="Examiner" value={cert.examiner_name} />
        </dl>

        {cert.remarks && (
          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Examiner remarks</p>
            <p className="mt-1 text-sm text-slate-700">{cert.remarks}</p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <CalendarClock size={13} /> Issued {certDate(cert.issue_date) || 'on record'}
          </span>
          {cert.examiner_name && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound size={13} /> Assessed by {cert.examiner_name}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
