import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, CalendarDays, Eye, Languages, Loader2, Lock, MessageSquare, RotateCcw,
  ScrollText, Sparkles, Target,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';
import { PromptViewerModal } from '@/features/dashboard/PromptViewer';

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

const STAGE_META: Record<number, { title: string; blurb: string; tone: string; icon: typeof Sparkles }> = {
  1: {
    title: 'Lexical Integration',
    blurb: "The instruction that teaches today's expressions.",
    tone: 'border-brand/30 bg-brand/[0.04]',
    icon: Sparkles,
  },
  2: {
    title: 'Guided Learning',
    blurb: 'Same conversation without hints — corrections only.',
    tone: 'border-violet-200 bg-violet-50',
    icon: MessageSquare,
  },
  3: {
    title: 'Fluency & Assessment',
    blurb: 'Uninterrupted speaking, then the scoring rubric.',
    tone: 'border-emerald-200 bg-emerald-50',
    icon: Target,
  },
};

export function PromptLibraryPage() {
  const [week, setWeek] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [viewPrompt, setViewPrompt] = useState<number | null>(null);
  // Preview overrides. null = "use my profile" — sent as undefined so the
  // backend falls back to the stored values.
  const [cefr, setCefr] = useState<string | null>(null);
  const [english, setEnglish] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ['learning-overview'],
    queryFn: () => unwrap<Overview>(api.get('/prompt-library/me/overview')),
  });

  // Land on the student's current position once the overview arrives.
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Prompt Library"
        description="Read the exact instructions your AI tutor follows for every published day."
      />

      <div className="card space-y-3 bg-gradient-to-r from-brand to-brand-light text-white">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-white/70">
              CEFR level
            </span>
            <select
              className="mt-1 rounded-lg border-0 bg-white/15 px-2.5 py-1.5 text-sm font-bold text-white outline-none ring-1 ring-white/25 transition hover:bg-white/25 focus:ring-2 focus:ring-white/60 [&>option]:text-slate-800"
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

          <label className="block">
            <span className="block text-[11px] font-medium uppercase tracking-wide text-white/70">
              Preferred English
            </span>
            <select
              className="mt-1 rounded-lg border-0 bg-white/15 px-2.5 py-1.5 text-sm font-bold text-white outline-none ring-1 ring-white/25 transition hover:bg-white/25 focus:ring-2 focus:ring-white/60 [&>option]:text-slate-800"
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
        </div>

        <p className="border-t border-white/20 pt-3 text-[11px] text-white/75">
          Currently at <span className="font-bold text-white">Week {o.current_week} · Day {o.current_day}</span>
          {previewing
            ? ' — previewing another level or accent. Your sessions still use your profile settings.'
            : ' — prompts below are exactly what your AI tutor receives.'}
        </p>
      </div>

      <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-200/70">
        <Eye size={14} className="shrink-0 text-slate-400" />
        View only — prompts are written and maintained by SpeakEdge. Change the level or
        accent above to see how the same lesson reads for a different student.
      </p>

      {!o.available.length ? (
        <div className="card py-16 text-center">
          <BookOpen className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 font-semibold text-slate-700">No prompts published yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Your curriculum is being prepared. Please check back soon.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[13rem_1fr]">
          {/* Week + day picker */}
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

          {/* Day detail + the three prompts */}
          <div className="space-y-4">
            {detail.isLoading ? (
              <div className="card py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" /></div>
            ) : detail.isError ? (
              <div className="card py-12 text-center">
                <Lock className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm text-slate-600">{(detail.error as Error).message}</p>
              </div>
            ) : detail.data ? (
              <>
                <div className="card">
                  <span className="badge bg-brand/10 text-brand">{detail.data.day_topic}</span>
                  <h2 className="mt-2 text-xl font-extrabold text-slate-800">{detail.data.title}</h2>
                  {detail.data.context && <p className="mt-1 text-sm text-slate-500">{detail.data.context}</p>}
                  {detail.data.conversation_sequence.length > 0 && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Conversation sequence · {detail.data.sequence_steps} steps
                      </p>
                      <ol className="space-y-1.5">
                        {detail.data.conversation_sequence.map((s, i) => (
                          <li key={i} className="flex gap-2.5 text-sm text-slate-600">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
                              {i + 1}
                            </span>
                            {s}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  {detail.data.modes.map((m) => {
                    const meta = STAGE_META[m.stage];
                    const Icon = meta.icon;
                    return (
                      <button
                        key={m.stage}
                        type="button"
                        className={`card flex flex-col border text-left transition hover:shadow-md ${meta.tone}`}
                        onClick={() => setViewPrompt(m.stage)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/70">
                            <Icon size={18} />
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Stage {m.stage}
                          </span>
                        </div>
                        <p className="mt-3 font-bold text-slate-800">{meta.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.blurb}</p>
                        <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-brand">
                          <ScrollText size={13} /> Read prompt
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <BookOpen size={13} />
                  Want to practise this day?{' '}
                  <Link to="/dashboard/learning" className="font-semibold text-brand underline underline-offset-2">
                    Go to Learning
                  </Link>
                </p>
              </>
            ) : null}
          </div>
        </div>
      )}

      {viewPrompt !== null && week !== null && day !== null && (
        <PromptViewerModal
          week={week}
          day={day}
          stage={viewPrompt}
          cefrLevel={cefr ?? undefined}
          preferredEnglish={english ?? undefined}
          onClose={() => setViewPrompt(null)}
        />
      )}
    </div>
  );
}
