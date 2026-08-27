/**
 * Public credential verification. An institute, college or employer holding a
 * SpeakEdge certificate or CEFR report card checks it here by the code printed
 * on the document — no account, no login. `/verify/<code>` (the URL printed on
 * the PDF) verifies straight away and is shareable; `/verify` asks for a code.
 *
 * Only what is already printed on the document in the enquirer's hand is shown,
 * so verification confirms a document rather than opening a learner's record.
 */
import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Loader2, Search, ShieldAlert, ShieldX } from 'lucide-react';
import { api, unwrap } from '@/lib/api';

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

function Detail({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function ResultCard({ result }: { result: VerifyResult }) {
  if (!result.valid) {
    const withdrawn = result.withdrawn;
    return (
      <div className={`card mt-6 border ${withdrawn ? 'border-amber-200' : 'border-red-200'}`}>
        <div className="flex items-start gap-3">
          <span className={withdrawn ? 'text-amber-600' : 'text-red-600'}>
            {withdrawn ? <ShieldAlert size={22} /> : <ShieldX size={22} />}
          </span>
          <div>
            <p className={`font-bold ${withdrawn ? 'text-amber-700' : 'text-red-700'}`}>
              {withdrawn ? 'Withdrawn — no longer valid' : 'Not verified'}
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {withdrawn
                ? 'This credential was issued by SpeakEdge but has since been withdrawn. Please contact us before relying on the document.'
                : 'No SpeakEdge certificate or report card carries this verification code. Check the code exactly as printed on the document, including the CERT- or CEFR- prefix.'}
            </p>
            {result.code && (
              <p className="mt-2 text-xs text-slate-400">Code checked: {result.code}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isCert = result.type === 'certificate';
  const level = result.cefr_level ?? result.level ?? null;
  const scores = Object.entries(result.scores ?? {});
  return (
    <div className="card mt-6 border border-green-200">
      <div className="flex items-start gap-3 border-b border-slate-100 pb-4">
        <span className="text-green-600"><BadgeCheck size={22} /></span>
        <div>
          <p className="font-bold text-green-700">
            Verified — genuine SpeakEdge {isCert ? 'certificate' : 'CEFR report card'}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            This record was issued by SpeakEdge, a product of Sujyoti EdTech Pvt. Ltd., and is
            active. The details below must match the document you are holding.
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Candidate name" value={result.student_name} />
        <Detail label="Student ID" value={result.student_id} />
        <Detail label={isCert ? 'CEFR level awarded' : 'CEFR level'} value={level} />
        <Detail label="Result" value={result.grade} />
        <Detail label={isCert ? 'Certificate' : 'Report'} value={result.title ?? result.exam_title} />
        <Detail label="Assessment date" value={fmtDate(result.exam_date)} />
        <Detail label={isCert ? 'Date of issue' : 'Reported on'} value={fmtDate(result.issued_at)} />
        <Detail label="Examiner" value={result.examiner_name} />
        <Detail label={isCert ? 'Certificate no.' : 'Report no.'} value={result.code} />
      </dl>

      {scores.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Assessment scores</p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-700">
            {scores.map(([k, v]) => (
              <span key={k}>
                <span className="capitalize">{k.replace(/_/g, ' ')}</span>: <b>{String(v)}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {result.remarks && (
        <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Examiner remarks</p>
          <p className="mt-1 text-sm text-slate-700">{result.remarks}</p>
        </div>
      )}
    </div>
  );
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

      <p className="mt-6 text-xs text-slate-400">
        Results show only the details printed on the document itself. If a code cannot be verified,
        or the details do not match, contact SpeakEdge before accepting the document.
      </p>
    </div>
  );
}
