import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle2, Eye, HelpCircle, Info, Loader2, Mic, RefreshCw, Repeat,
  Send, Sparkles, TriangleAlert, Wand2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { PromptViewerModal } from '@/features/dashboard/PromptViewer';

/* One AI practice session. The stage decides the behaviour:
 *   1 & 2 — after each answer the tutor corrects you and BLOCKS the
 *           conversation until you repeat the improved sentence.
 *   3     — no corrections at all; scores appear once every step is done. */

interface Message {
  role: 'tutor' | 'student' | 'system';
  text: string;
  kind: string;
  created_at: string;
  model_answer?: string | null;
  correction?: string | null;
}
interface Assessment {
  scores: Record<string, number>;
  labels: Record<string, string>;
  max_score: number;
}
interface Session {
  id: string;
  week: number;
  day: number;
  stage: number;
  stage_label: string;
  status: 'active' | 'completed' | 'abandoned';
  accent: string;
  cefr_level: string;
  awaiting_repetition: boolean;
  pending_model_answer?: string | null;
  messages: Message[];
  assessment: Assessment | null;
  progress: { step: number; total: number; percent: number };
  can_request_better: boolean;
  can_request_explanation: boolean;
  day_topic?: string;
  title?: string;
  sequence_step?: string | null;
}
interface Config { is_stub: boolean; provider: string }

const KIND_STYLE: Record<string, string> = {
  repeat_request: 'border-amber-300 bg-amber-50 text-amber-900',
  repetition_accepted: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  correction: 'border-slate-200 bg-white text-slate-700',
  explanation: 'border-sky-200 bg-sky-50 text-sky-900',
  better: 'border-violet-200 bg-violet-50 text-violet-900',
  assessment: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

function ScoreBar({ label, score, max }: { label: string; score: number; max: number }) {
  const pct = Math.round((score / max) * 100);
  const tone = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-brand' : 'bg-amber-500';
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="font-bold text-slate-800">{score}<span className="text-xs font-normal text-slate-400">/{max}</span></span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${tone} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function AISessionPage() {
  const { week, day, stage } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const w = Number(week);
  const d = Number(day);
  const s = Number(stage);

  const config = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => unwrap<Config>(api.get('/ai-session/config')),
  });

  const session = useQuery({
    queryKey: ['ai-session', w, d, s],
    queryFn: () => unwrap<Session>(api.post('/ai-session/start', { week: w, day: d, stage: s })),
    retry: false,
  });

  const apply = (fresh: Session) => {
    qc.setQueryData(['ai-session', w, d, s], fresh);
    qc.invalidateQueries({ queryKey: ['ai-history'] });
    setError('');
  };
  const onErr = (e: Error) => setError(e.message);

  const reply = useMutation({
    mutationFn: (body: string) => unwrap<Session>(api.post(`/ai-session/${session.data!.id}/reply`, { text: body })),
    onSuccess: (fresh) => { apply(fresh); setText(''); },
    onError: onErr,
  });
  const better = useMutation({
    mutationFn: () => unwrap<Session>(api.post(`/ai-session/${session.data!.id}/better`)),
    onSuccess: apply, onError: onErr,
  });
  const explain = useMutation({
    mutationFn: () => unwrap<Session>(api.post(`/ai-session/${session.data!.id}/explain`, {})),
    onSuccess: apply, onError: onErr,
  });
  const restart = useMutation({
    mutationFn: () => unwrap<Session>(api.post(`/ai-session/${session.data!.id}/restart`)),
    onSuccess: (fresh) => { apply(fresh); setText(''); },
    onError: onErr,
  });

  const data = session.data;
  const busy = reply.isPending || better.isPending || explain.isPending || restart.isPending;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [data?.messages.length, data?.assessment]);

  if (session.isLoading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand/60" />
        <p className="mt-3 text-sm text-slate-400">Starting your practice session…</p>
      </div>
    );
  }

  if (session.isError || !data) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <TriangleAlert className="mx-auto h-9 w-9 text-amber-400" />
        <p className="mt-3 font-semibold text-slate-700">This session could not be started</p>
        <p className="mt-1 text-sm text-slate-500">{(session.error as Error)?.message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-ghost" onClick={() => session.refetch()}>Try again</button>
          <Link to="/dashboard/learning" className="btn-primary">Back to Learning</Link>
        </div>
      </div>
    );
  }

  const finished = data.status !== 'active';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {/* Header */}
      <div className="card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-brand"
              onClick={() => navigate('/dashboard/learning')}
            >
              <ArrowLeft size={13} /> Learning
            </button>
            <h1 className="truncate text-lg font-extrabold text-slate-800">{data.title || `Week ${data.week} · Day ${data.day}`}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="badge bg-brand/10 text-brand">Stage {data.stage} · {data.stage_label}</span>
              {data.day_topic && <span className="badge bg-slate-100 text-slate-600">{data.day_topic}</span>}
              <span className="badge bg-slate-100 text-slate-600">CEFR {data.cefr_level}</span>
              <span className="badge bg-slate-100 capitalize text-slate-600">{data.accent}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-1.5 text-xs"
              onClick={() => setShowPrompt(true)}
            >
              <Eye size={14} /> View prompt
            </button>
            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-1.5 text-xs"
              disabled={busy}
              onClick={() => { if (window.confirm('Restart this practice session from the beginning?')) restart.mutate(); }}
            >
              <RefreshCw size={14} /> Restart
            </button>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs text-slate-500">
            <span>Conversation progress</span>
            <span className="font-semibold text-slate-700">
              Step {data.progress.step} of {data.progress.total}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${data.progress.percent}%` }} />
          </div>
        </div>

        {config.data?.is_stub && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Info size={13} className="mt-0.5 shrink-0" />
            Practice mode is running on the built-in offline tutor. Conversation flow, corrections and
            scoring all work; connect a live AI provider for richer responses.
          </p>
        )}
      </div>

      {/* Transcript */}
      <div className="card space-y-3">
        {data.messages.map((m, i) => (
          m.role === 'student' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand px-4 py-2.5 text-sm text-white">
                {m.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className={`max-w-[90%] rounded-2xl rounded-bl-sm border px-4 py-2.5 text-sm ${KIND_STYLE[m.kind] ?? 'border-slate-200 bg-white text-slate-700'}`}>
                {m.kind === 'repeat_request' && (
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
                    <Repeat size={12} /> Repeat this to continue
                  </p>
                )}
                {m.kind === 'explanation' && (
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
                    <HelpCircle size={12} /> Explanation
                  </p>
                )}
                {m.kind === 'better' && (
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
                    <Wand2 size={12} /> A stronger version
                  </p>
                )}
                <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
              </div>
            </div>
          )
        ))}

        {data.assessment && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
            <h2 className="flex items-center gap-2 font-extrabold text-emerald-900">
              <Sparkles size={18} /> Your assessment
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(data.assessment.scores).map(([key, score]) => (
                <ScoreBar
                  key={key}
                  label={data.assessment!.labels[key] ?? key}
                  score={score}
                  max={data.assessment!.max_score}
                />
              ))}
            </div>
          </div>
        )}

        {finished && !data.assessment && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircle2 size={16} className="mr-1.5 inline" />
            Practice complete. Head back to Learning to try the next mode.
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      )}

      {/* Composer */}
      {finished ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Link to="/dashboard/learning" className="btn-primary">Back to Learning</Link>
          <button className="btn-ghost" disabled={busy} onClick={() => restart.mutate()}>Practise again</button>
        </div>
      ) : (
        <div className="card sticky bottom-4">
          {data.awaiting_repetition && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
                <Repeat size={12} /> Waiting for your repetition
              </p>
              <p className="mt-1 text-sm text-amber-900">"{data.pending_model_answer}"</p>
              <button
                type="button"
                className="mt-2 text-xs font-semibold text-amber-800 underline"
                onClick={() => setText(data.pending_model_answer ?? '')}
              >
                Fill it in for me
              </button>
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
              className="input max-h-40 min-h-[3rem] flex-1 resize-y"
              placeholder={data.awaiting_repetition ? 'Type the sentence above to continue…' : 'Type your answer…'}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim() && !busy) reply.mutate(text.trim());
                }
              }}
            />
            <button
              type="button"
              className="btn-primary inline-flex h-11 w-11 shrink-0 items-center justify-center p-0"
              disabled={!text.trim() || busy}
              aria-label="Send"
              onClick={() => reply.mutate(text.trim())}
            >
              {reply.isPending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {data.can_request_better && (
              <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-xs" disabled={busy} onClick={() => better.mutate()}>
                <Wand2 size={13} /> Better response
              </button>
            )}
            {data.can_request_explanation && (
              <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-xs" disabled={busy} onClick={() => explain.mutate()}>
                <HelpCircle size={13} /> Explain the correction
              </button>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Mic size={12} /> Enter to send · Shift+Enter for a new line
            </span>
          </div>
        </div>
      )}

      {showPrompt && (
        <PromptViewerModal week={w} day={d} stage={s} onClose={() => setShowPrompt(false)} />
      )}
    </div>
  );
}
