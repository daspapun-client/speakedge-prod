/**
 * Public credential verification. An institute, college or employer holding a
 * SpeakEdge certificate or CEFR report card checks it here by the code printed
 * on the document — no account, no login. `/verify/<code>` (the URL printed on
 * the PDF) verifies straight away and is shareable; `/verify` asks for a code.
 *
 * Only what is already printed on the document in the enquirer's hand is shown,
 * so verification confirms a document rather than opening a learner's record.
 */
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Loader2, Search, ShieldAlert, ShieldX } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { CertificateSheet } from '@/features/dashboard/CertificatePage';
import { ReportSheet } from '@/features/dashboard/ReportCardPage';

interface VerifyResult {
  valid: boolean;
  withdrawn?: boolean;
  type?: 'certificate' | 'cefr_report';
  code?: string;
  student_name?: string | null;
  student_id?: string;
  title?: string | null;
  grade?: string | null;
  cefr_level?: string | null;
  level?: string | null;
  scores?: Record<string, unknown> | null;
  exam_title?: string | null;
  examiner_name?: string | null;
  remarks?: string | null;
  exam_date?: string | null;
  issued_at?: string | null;
}

function fmtDate(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function OfficialRecord({
  isCert,
  result,
  docTitle,
}: {
  isCert: boolean;
  result: VerifyResult;
  docTitle?: string | null;
}) {
  const rows: { label: string; value?: string | null; mono?: boolean }[] = [
    { label: 'Student ID', value: result.student_id, mono: true },
    { label: isCert ? 'Certificate no.' : 'Report no.', value: result.code, mono: true },
    { label: isCert ? 'Certificate title' : 'Report title', value: docTitle },
    { label: 'Assessment date', value: fmtDate(result.exam_date) },
    { label: isCert ? 'Date of issue' : 'Reported on', value: fmtDate(result.issued_at) },
    { label: 'Examiner', value: result.examiner_name },
  ];

  const visible = rows.filter((r) => r.value);

  return (
    <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        Official record
      </p>
      <dl className="overflow-hidden rounded-lg bg-slate-50/80 ring-1 ring-slate-200/70">
        {visible.map((row, i) => (
          <div
            key={row.label}
            className={`flex items-start justify-between gap-3 px-3 py-2 sm:px-3.5 ${
              i > 0 ? 'border-t border-slate-200/60' : ''
            }`}
          >
            <dt className="shrink-0 pt-px text-xs text-slate-500">{row.label}</dt>
            <dd
              className={`min-w-0 max-w-[62%] text-right text-xs font-semibold leading-snug text-slate-900 sm:max-w-[68%] ${
                row.mono ? 'font-mono tracking-tight' : ''
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ResultShell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`mt-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_4px_24px_rgba(15,23,42,0.06)] ${className}`}>
      {children}
    </div>
  );
}

function ResultHeader({
  tone,
  icon,
  eyebrow,
  title,
  subtitle,
  badge,
}: {
  tone: 'success' | 'warning' | 'error';
  icon: ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
  badge: string;
}) {
  const palette = {
    success: {
      bg: 'from-slate-900 via-slate-800 to-brand',
      glow: 'bg-[radial-gradient(ellipse_at_top_right,rgba(47,128,237,0.28),transparent_60%)]',
      icon: 'bg-white/10 ring-white/20 text-emerald-400',
      badge: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/25',
    },
    warning: {
      bg: 'from-amber-950 via-amber-900 to-amber-800',
      glow: 'bg-[radial-gradient(ellipse_at_top_right,rgba(251,191,36,0.2),transparent_60%)]',
      icon: 'bg-white/10 ring-white/20 text-amber-300',
      badge: 'bg-amber-500/15 text-amber-200 ring-amber-400/25',
    },
    error: {
      bg: 'from-rose-950 via-red-900 to-red-800',
      glow: 'bg-[radial-gradient(ellipse_at_top_right,rgba(248,113,113,0.2),transparent_60%)]',
      icon: 'bg-white/10 ring-white/20 text-red-300',
      badge: 'bg-red-500/15 text-red-200 ring-red-400/25',
    },
  }[tone];

  return (
    <div className={`relative overflow-hidden bg-gradient-to-br px-5 py-4 sm:px-6 ${palette.bg}`}>
      <div className={`pointer-events-none absolute inset-0 ${palette.glow}`} />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 backdrop-blur-sm ${palette.icon}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">{eyebrow}</p>
            <h2 className="mt-0.5 text-lg font-bold leading-tight text-white sm:text-xl">{title}</h2>
            <p className="mt-1 text-xs leading-relaxed text-white/70">{subtitle}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ring-1 ${palette.badge}`}>
          {badge}
        </span>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: VerifyResult }) {
  if (!result.valid) {
    const withdrawn = result.withdrawn;
    return (
      <ResultShell>
        <ResultHeader
          tone={withdrawn ? 'warning' : 'error'}
          icon={withdrawn ? <ShieldAlert size={20} /> : <ShieldX size={20} />}
          eyebrow="Credential verification"
          title={withdrawn ? 'Withdrawn credential' : 'Verification failed'}
          subtitle={
            withdrawn
              ? 'This record was issued by SpeakEdge but is no longer valid. Contact us before accepting the document.'
              : 'No SpeakEdge certificate or report matches this code. Confirm the CERT- or CEFR- prefix and try again.'
          }
          badge={withdrawn ? 'Withdrawn' : 'Invalid'}
        />
        {result.code && (
          <div className="border-t border-slate-100 px-4 py-3 sm:px-6">
            <p className="text-xs font-medium text-slate-500">Code checked</p>
            <p className="mt-1 font-mono text-sm font-semibold text-slate-800">{result.code}</p>
          </div>
        )}
      </ResultShell>
    );
  }

  const isCert = result.type === 'certificate';
  const level = result.cefr_level ?? result.level ?? null;
  const scores = Object.entries(result.scores ?? {});
  const docTitle = result.title ?? result.exam_title;
  const summary = [result.grade, docTitle].filter(Boolean).join(' · ');

  return (
    <ResultShell>
      <ResultHeader
        tone="success"
        icon={<BadgeCheck size={20} />}
        eyebrow="Credential verification"
        title={isCert ? 'SpeakEdge Certificate' : 'CEFR Report Card'}
        subtitle="Issued by SpeakEdge · Sujyoti EdTech Pvt. Ltd. · Active and authentic."
        badge="Verified"
      />

      <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500">Candidate</p>
            <p className="mt-0.5 truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              {result.student_name ?? result.student_id}
            </p>
            {summary && <p className="mt-1 text-sm text-slate-600">{summary}</p>}
          </div>
          {level && (
            <div className="flex h-[3.75rem] w-[3.75rem] shrink-0 flex-col items-center justify-center rounded-xl border border-brand/15 bg-gradient-to-b from-brand/5 to-brand/10">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-brand/70">CEFR</span>
              <span className="text-2xl font-extrabold leading-none text-brand">{level}</span>
            </div>
          )}
        </div>
      </div>

      <OfficialRecord isCert={isCert} result={result} docTitle={docTitle} />

      {scores.length > 0 && (
        <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Assessment scores</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {scores.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs shadow-sm"
              >
                <span className="capitalize text-slate-500">{k.replace(/_/g, ' ')}</span>
                <span className="font-bold text-slate-900">{String(v)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {result.remarks && (
        <div className="border-t border-slate-100 bg-slate-50/50 px-5 py-3 sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Examiner remarks</p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{result.remarks}</p>
        </div>
      )}
    </ResultShell>
  );
}

function VerifiedDocument({ result }: { result: VerifyResult }) {
  if (!result.valid || !result.student_id) return null;
  if (result.type === 'certificate' && result.code) {
    return (
      <div className="mt-6 w-full min-w-0 rounded-xl">
        <CertificateSheet
          cert={{
            student_name: result.student_name,
            student_id: result.student_id,
            assessment_date: result.exam_date,
            issue_date: result.issued_at,
            certificate_no: result.code,
            cefr_level: result.cefr_level ?? result.level,
          }}
        />
      </div>
    );
  }
  if (result.type === 'cefr_report') {
    return (
      <div className="mt-6 w-full min-w-0 rounded-xl">
        <ReportSheet
          report={{
            student_name: result.student_name,
            student_id: result.student_id,
            exam_date: result.exam_date,
            issue_date: result.issued_at,
            cefr_level: result.cefr_level ?? result.level,
          }}
        />
      </div>
    );
  }
  return null;
}

export function VerifyPage() {
  const { code: urlCode } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(urlCode ?? '');

  // The URL is the source of truth, so a verified result can be bookmarked or
  // forwarded to whoever asked for it.
  useEffect(() => setCode(urlCode ?? ''), [urlCode]);

  const query = useQuery({
    queryKey: ['verify', urlCode],
    queryFn: () => unwrap<VerifyResult>(api.get(`/exams/verify/${encodeURIComponent(urlCode!)}`)),
    enabled: !!urlCode,
    retry: false,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const next = code.trim().toUpperCase();
    if (next) navigate(`/verify/${encodeURIComponent(next)}`);
  }

  return (
    <div>
      <div className="mx-auto max-w-3xl">
        <h1 className="text-3xl font-extrabold">Verify a Certificate or Report Card</h1>
        <p className="mt-2 text-slate-600">
          Anyone can check a SpeakEdge credential here — no account needed. Institutes, colleges and
          employers: enter the verification code printed on the certificate or CEFR report card to
          confirm it is genuine and still valid.
        </p>

        <form onSubmit={submit} className="card mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="verify-code">Verification code</label>
            <input
              id="verify-code"
              className="input"
              placeholder="CERT-XXXXXXXXXX or CEFR-XXXXXXXXXX"
              value={code}
              autoFocus
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <button
            className="btn-primary inline-flex w-full items-center justify-center gap-2"
            disabled={!code.trim() || query.isFetching}
          >
            {query.isFetching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {query.isFetching ? 'Checking…' : 'Verify'}
          </button>
        </form>

        {query.isError && (
          <p className="mt-4 text-sm text-red-600">
            {(query.error as Error).message || 'Verification is unavailable right now. Please try again.'}
          </p>
        )}
        {query.data && !query.isFetching && <ResultCard result={query.data} />}
      </div>

      {query.data && !query.isFetching && <VerifiedDocument result={query.data} />}

      <p className="mx-auto mt-6 max-w-3xl text-xs text-slate-400">
        Results show only the details printed on the document itself. If a code cannot be verified,
        or the details do not match, contact SpeakEdge before accepting the document.
      </p>
    </div>
  );
}
