import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, CalendarDays, Check, ChevronRight, ClipboardCopy, Eye, Languages, Loader2, Lock,
  RotateCcw, ScrollText,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PromptBodyView } from '@/components/PromptBodyEditor';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';

/* Prompt Library — view only.
 * Students browse every published day of their own audience and read the
 * prompt behind each stage, already rendered with their CEFR level and
 * preferred English. There is deliberately no edit path: the backend only
 * exposes `/prompt-library/me/*` (read) to `require_student`; every mutating
 * route is `require_admin`. */

interface AvailableWeek {
  week: number;
  days: { day: number; day_topic: string; title: string }[];
}
interface Overview {
  weeks_total: number;
  days_total: number;
  current_week: number;
  current_day: number;
  cefr_level: string;
  preferred_english: string;
  audience: string;
  cefr_levels: string[];
  english_styles: string[];
  available: AvailableWeek[];
}
interface Mode { stage: number; slot: string; label: string; accent: string }
interface StudentPrompt {
  week: number; day: number; stage: number; label: string; accent: string;
  body: string; raw: string; params: Record<string, string>;
  cefr_level: string; preferred_english: string; day_topic: string; title: string;
}
interface DayDetail {
  week: number;
  day: number;
  day_topic: string;
  title: string;
  context: string;
  conversation_sequence: string[];
  sequence_steps: number;
  modes: Mode[];
}

const STAGE_TONE: Record<number, string> = {
  1: 'bg-brand/10 text-brand',
  2: 'bg-violet-100 text-violet-700',
  3: 'bg-emerald-100 text-emerald-700',
};

const STAGE_SHORT: Record<number, string> = {
  1: 'Lexical',
  2: 'Guided',
  3: 'Assessment',
};

const SCROLL_HIDE = '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

function NavChip({
  active,
  onClick,
  children,
  className = '',
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition',
        active ? 'bg-brand text-white shadow-sm' : 'bg-slate-100 text-slate-700 active:bg-slate-200',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={`btn-ghost inline-flex items-center gap-1.5 text-xs ${className}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={14} className="text-emerald-600" /> : <ClipboardCopy size={14} />}
      {copied ? 'Copied' : 'Copy prompt'}
    </button>
  );
}

function PreviewControls({
  o,
  cefr,
  english,
  setCefr,
  setEnglish,
  previewing,
  compact = false,
}: {
  o: Overview;
  cefr: string | null;
  english: string | null;
  setCefr: (v: string | null) => void;
  setEnglish: (v: string | null) => void;
  previewing: boolean;
  compact?: boolean;
}) {
  const selectClass = compact
    ? 'mt-1 w-full rounded-lg border-0 bg-white/15 px-2.5 py-2 text-sm font-semibold text-white outline-none ring-1 ring-white/25 focus:ring-2 focus:ring-white/60 [&>option]:text-slate-800'
    : 'mt-1 rounded-lg border-0 bg-white/15 px-2.5 py-1.5 text-sm font-bold text-white outline-none ring-1 ring-white/25 transition hover:bg-white/25 focus:ring-2 focus:ring-white/60 [&>option]:text-slate-800';

  return (
    <div className={compact ? 'space-y-3' : 'space-y-3'}>
      <div className={compact ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap items-end gap-x-4 gap-y-3'}>
        <label className="block min-w-0">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-white/70">
            CEFR level
          </span>
          <select
            className={selectClass}
            value={cefr ?? o.cefr_level}
            onChange={(e) => setCefr(e.target.value)}
          >
            {o.cefr_levels.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}{lvl === o.cefr_level ? ' (yours)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="block min-w-0">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-white/70">
            Preferred English
          </span>
          <select
            className={selectClass}
            value={english ?? o.preferred_english}
            onChange={(e) => setEnglish(e.target.value)}
          >
            {o.english_styles.map((style) => (
              <option key={style} value={style}>
                {style}{style === o.preferred_english ? ' (yours)' : ''}
              </option>
            ))}
          </select>
        </label>

        {!compact && (
          <div className="ml-auto flex items-center gap-2">
            {previewing && (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold transition hover:bg-white/25"
                onClick={() => { setCefr(null); setEnglish(null); }}
              >
                <RotateCcw size={14} /> Reset to my profile
              </button>
            )}
            <Link to="/dashboard/profile" className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold transition hover:bg-white/25">
              <Languages size={14} /> Change in profile
            </Link>
          </div>
        )}
      </div>

      {compact && (
        <div className="flex flex-wrap gap-2">
          {previewing && (
            <button
              type="button"
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold transition active:bg-white/25"
              onClick={() => { setCefr(null); setEnglish(null); }}
            >
              <RotateCcw size={14} /> Reset preview
            </button>
          )}
          <Link
            to="/dashboard/profile"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold transition active:bg-white/25"
          >
            <Languages size={14} /> Profile settings
          </Link>
        </div>
      )}

      <p className={`text-[11px] text-white/75 ${compact ? '' : 'border-t border-white/20 pt-3'}`}>
        Currently at <span className="font-bold text-white">Week {o.current_week} · Day {o.current_day}</span>
        {previewing
          ? ' — previewing another level or accent.'
          : ' — prompts match what your AI tutor receives.'}
      </p>
    </div>
  );
}

function DayContent({
  detail,
  prompt,
  stage,
  setStage,
  mobile = false,
}: {
  detail: DayDetail | undefined;
  prompt: StudentPrompt | undefined;
  stage: number;
  setStage: (s: number) => void;
  mobile?: boolean;
  detailLoading?: boolean;
  detailError?: Error | null;
  promptLoading?: boolean;
  promptError?: Error | null;
}) {
  if (!detail) return null;

  const stageLabel = (m: Mode) =>
    m.label.replace(' – ', ' · ').replace('British/American/International', 'Auto');

  return (
    <>
      <section className={mobile ? 'px-3 py-4' : 'card'}>
        <span className="badge bg-brand/10 text-brand">{detail.day_topic}</span>
        <h2 className={`mt-2 font-extrabold text-slate-800 ${mobile ? 'text-lg leading-snug' : 'text-xl'}`}>
          {detail.title}
        </h2>
        {detail.context && (
          <p className={`mt-1 text-slate-500 ${mobile ? 'text-sm leading-relaxed' : 'text-sm'}`}>
            {detail.context}
          </p>
        )}
        {detail.conversation_sequence.length > 0 && (
          mobile ? (
            <details className="group mt-3 rounded-xl bg-slate-50 ring-1 ring-slate-200/70">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold text-slate-600 [&::-webkit-details-marker]:hidden">
                <span>Conversation sequence · {detail.sequence_steps} steps</span>
                <ChevronRight size={14} className="shrink-0 text-slate-400 transition group-open:rotate-90" />
              </summary>
              <ol className="space-y-1.5 border-t border-slate-200/70 px-3 py-3">
                {detail.conversation_sequence.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-600">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-500 ring-1 ring-slate-200/70">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </details>
          ) : (
            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Conversation sequence · {detail.sequence_steps} steps
              </p>
              <ol className="space-y-1.5">
                {detail.conversation_sequence.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-slate-600">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>
          )
        )}
      </section>

      <section className={mobile ? 'border-t border-slate-100 px-3 py-4' : 'card'}>
        <div className={`flex gap-1.5 ${mobile ? `overflow-x-auto pb-0.5 ${SCROLL_HIDE}` : 'flex-wrap items-center'}`}>
          {detail.modes.map((m) => (
            <button
              key={m.stage}
              type="button"
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                stage === m.stage ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100 active:bg-slate-100'
              }`}
              onClick={() => setStage(m.stage)}
            >
              {mobile ? (
                <>
                  <span className="font-bold">Stage {m.stage}</span>
                  <span className={stage === m.stage ? 'text-white/80' : 'text-slate-400'}>
                    {STAGE_SHORT[m.stage] ?? stageLabel(m)}
                  </span>
                </>
              ) : stageLabel(m)}
            </button>
          ))}
        </div>

        <div className={`flex flex-wrap items-center gap-2 ${mobile ? 'mt-3' : 'mt-4 border-t border-slate-100 pt-4'}`}>
          <span className={`badge ${STAGE_TONE[stage] ?? 'bg-slate-100 text-slate-600'}`}>
            Stage {stage}
          </span>
          {prompt && (
            <>
              <span className="badge bg-slate-100 text-slate-600">CEFR {prompt.cefr_level}</span>
              <span className="badge bg-slate-100 text-slate-600">{prompt.preferred_english}</span>
            </>
          )}
        </div>

        {!prompt ? (
          <div className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" /></div>
        ) : (
          <>
            <PromptBodyView
              raw={prompt.raw}
              params={prompt.params ?? {}}
              className={`overflow-auto rounded-xl bg-slate-50 ring-1 ring-slate-200/70 ${
                mobile ? 'mt-3 max-h-[min(52vh,28rem)] p-3 text-sm' : 'mt-4 max-h-[26rem] p-4'
              }`}
            />
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Highlighted values come from your profile and this lesson — the rest is the
              instruction your AI tutor follows.
            </p>
            <div className="mt-3">
              <CopyButton text={prompt.body} className={mobile ? 'w-full justify-center py-2.5' : ''} />
            </div>
          </>
        )}
      </section>

      <p className={`flex items-center gap-1.5 text-xs text-slate-400 ${mobile ? 'border-t border-slate-100 bg-slate-50/80 px-3 py-3' : ''}`}>
        <BookOpen size={13} />
        Want to practise this day?{' '}
        <Link to="/dashboard/learning" className="font-semibold text-brand underline underline-offset-2">
          Go to Learning
        </Link>
      </p>
    </>
  );
}

export function PromptLibraryPage() {
  const [week, setWeek] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [stage, setStage] = useState(1);
  const [cefr, setCefr] = useState<string | null>(null);
  const [english, setEnglish] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ['learning-overview'],
    queryFn: () => unwrap<Overview>(api.get('/prompt-library/me/overview')),
  });

  useEffect(() => {
    if (!overview.data || week !== null) return;
    const avail = overview.data.available;
    const target = avail.find((w) => w.week === overview.data!.current_week) ?? avail[0];
    if (!target) return;
    setWeek(target.week);
    const d = target.days.find((x) => x.day === overview.data!.current_day) ?? target.days[0];
    setDay(d?.day ?? null);
  }, [overview.data, week]);

  const detail = useQuery({
    queryKey: ['learning-day', week, day, cefr, english],
    queryFn: () => unwrap<DayDetail>(api.get('/prompt-library/me/day', {
      params: {
        week, day,
        cefr_level: cefr ?? undefined,
        preferred_english: english ?? undefined,
      },
    })),
    enabled: week !== null && day !== null,
  });

  useEffect(() => {
    const modes = detail.data?.modes;
    if (!modes?.length) return;
    if (!modes.some((m) => m.stage === stage)) setStage(modes[0].stage);
  }, [detail.data?.modes, stage]);

  const prompt = useQuery({
    queryKey: ['my-prompt', week, day, stage, cefr, english],
    queryFn: () => unwrap<StudentPrompt>(api.get('/prompt-library/me/prompt', {
      params: {
        week, day, stage,
        cefr_level: cefr ?? undefined,
        preferred_english: english ?? undefined,
      },
    })),
    enabled: week !== null && day !== null,
  });

  const selectedWeek = overview.data?.available.find((w) => w.week === week);

  if (overview.isLoading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand/60" />
        <p className="mt-3 text-sm text-slate-400">Loading the prompt library…</p>
      </div>
    );
  }

  if (overview.isError) {
    return (
      <div className="card mt-6 text-center">
        <p className="text-sm text-red-600">{(overview.error as Error).message}</p>
      </div>
    );
  }

  const o = overview.data!;
  const previewing =
    (cefr !== null && cefr !== o.cefr_level) ||
    (english !== null && english !== o.preferred_english);

  const emptyState = (
    <div className="text-center">
      <BookOpen className="mx-auto h-9 w-9 text-slate-300" />
      <p className="mt-3 font-semibold text-slate-700">No prompts published yet</p>
      <p className="mt-1 text-sm text-slate-500">
        Your curriculum is being prepared. Please check back soon.
      </p>
    </div>
  );

  const detailBlock = (mobile: boolean) => {
    if (detail.isLoading) {
      return (
        <div className={mobile ? 'py-16 text-center' : 'card py-16 text-center'}>
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" />
        </div>
      );
    }
    if (detail.isError) {
      return (
        <div className={mobile ? 'px-6 py-12 text-center' : 'card py-12 text-center'}>
          <Lock className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-600">{(detail.error as Error).message}</p>
        </div>
      );
    }
    if (!detail.data) return null;
    if (prompt.isError) {
      return (
        <div className={mobile ? 'px-3 py-8' : 'card'}>
          <p className="text-center text-sm text-red-600">{(prompt.error as Error).message}</p>
        </div>
      );
    }
    return (
      <DayContent
        detail={detail.data}
        prompt={prompt.data}
        stage={stage}
        setStage={setStage}
        mobile={mobile}
      />
    );
  };

  return (
    <div className="prompt-library-page -mx-3 space-y-0 sm:-mx-4 md:mx-0 md:space-y-5">
      {/* ── Mobile ── */}
      <div className="md:hidden">
        <div className="border-b border-slate-100 bg-white px-3 py-2.5">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <ScrollText size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900">Prompt Library</h1>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                AI tutor instructions for every published day — view only.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-brand to-brand-light px-3 py-3 text-white">
          <PreviewControls
            o={o}
            cefr={cefr}
            english={english}
            setCefr={setCefr}
            setEnglish={setEnglish}
            previewing={previewing}
            compact
          />
        </div>

        {!o.available.length ? (
          <div className="px-6 py-16">{emptyState}</div>
        ) : (
          <>
            <div className="sticky top-0 z-20 bg-white/95 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-white/85">
              <div className={`flex gap-2 overflow-x-auto border-b border-slate-100 px-3 py-2.5 ${SCROLL_HIDE}`}>
                {o.available.map((w) => (
                  <NavChip
                    key={w.week}
                    active={week === w.week}
                    onClick={() => { setWeek(w.week); setDay(w.days[0]?.day ?? null); }}
                  >
                    Week {w.week}
                  </NavChip>
                ))}
              </div>
              <div className={`flex gap-2 overflow-x-auto px-3 py-2.5 ${SCROLL_HIDE}`}>
                {(selectedWeek?.days ?? []).map((d) => (
                  <NavChip
                    key={d.day}
                    active={day === d.day}
                    onClick={() => setDay(d.day)}
                    className="max-w-[11rem] truncate"
                  >
                    Day {d.day} · {d.day_topic}
                  </NavChip>
                ))}
              </div>
            </div>

            <div className="divide-y divide-slate-100 bg-white">
              {detailBlock(true)}
            </div>
          </>
        )}
      </div>

      {/* ── Desktop ── */}
      <div className="hidden space-y-5 md:block">
        <PageHeader
          title="Prompt Library"
          description="Read the exact instructions your AI tutor follows for every published day."
        />

        <div className="card space-y-3 bg-gradient-to-r from-brand to-brand-light text-white">
          <PreviewControls
            o={o}
            cefr={cefr}
            english={english}
            setCefr={setCefr}
            setEnglish={setEnglish}
            previewing={previewing}
          />
        </div>

        <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200/70">
          <Eye size={14} className="shrink-0 text-slate-400" />
          View only — prompts are written and maintained by SpeakEdge. Change the level or
          accent above to see how the same lesson reads for a different student.
        </p>

        {!o.available.length ? (
          <div className="card py-16">{emptyState}</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
            <div className="space-y-3">
              <div className="card p-3">
                <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <CalendarDays size={12} /> Week
                </p>
                <div className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto pr-1">
                  {o.available.map((w) => (
                    <button
                      key={w.week}
                      type="button"
                      className={`rounded-md py-1.5 text-xs font-semibold transition ${
                        week === w.week ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                      onClick={() => { setWeek(w.week); setDay(w.days[0]?.day ?? null); }}
                    >
                      {w.week}
                    </button>
                  ))}
                </div>
              </div>

              <div className="card p-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Day</p>
                <div className="flex flex-col gap-1">
                  {(selectedWeek?.days ?? []).map((d) => (
                    <button
                      key={d.day}
                      type="button"
                      className={`rounded-lg px-2.5 py-2 text-left text-xs transition ${
                        day === d.day ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                      onClick={() => setDay(d.day)}
                    >
                      <span className="font-semibold">Day {d.day}</span>
                      <span className={`block ${day === d.day ? 'text-white/75' : 'text-slate-400'}`}>{d.day_topic}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {detailBlock(false)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
