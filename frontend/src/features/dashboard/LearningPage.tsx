import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, BookOpen, CalendarDays, GraduationCap, Languages, Loader2, Lock,
  MessageSquare, Sparkles, Target,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';
import { PromptViewerModal, ViewPromptButton } from '@/features/dashboard/PromptViewer';

/* The learning journey: Week → Day → Mode → AI session.
 * Everything the header shows (CEFR level, English preference, current
 * position) comes from the student's profile — nothing is chosen here. */

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
  cefr_level: string;
  preferred_english: string;
  modes: Mode[];
}
interface SessionSummary {
  id: string; week: number; day: number; stage: number;
  status: string; assessment: { scores: Record<string, number> } | null;
}

const STAGE_META: Record<number, { title: string; blurb: string; tone: string; icon: typeof Sparkles }> = {
  1: {
    title: 'Lexical Integration',
    blurb: "Learn and practise today's expressions with guided corrections.",
    tone: 'border-brand/30 bg-brand/[0.04] text-brand',
    icon: Sparkles,
  },
  2: {
    title: 'Guided Learning',
    blurb: 'Same conversation, no hints — corrections and native-like rewrites.',
    tone: 'border-violet-200 bg-violet-50 text-violet-700',
    icon: MessageSquare,
  },
  3: {
    title: 'Fluency & Assessment',
    blurb: 'Speak freely with no interruptions, then get scored out of 10.',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    icon: Target,
  },
};

export function LearningPage() {
  const navigate = useNavigate();
  const [week, setWeek] = useState<number | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [viewPrompt, setViewPrompt] = useState<number | null>(null);

  const overview = useQuery({
    queryKey: ['learning-overview'],
    queryFn: () => unwrap<Overview>(api.get('/prompt-library/me/overview')),
  });
  const history = useQuery({
    queryKey: ['ai-history'],
    queryFn: () => unwrap<SessionSummary[]>(api.get('/ai-session/history')),
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
    queryKey: ['learning-day', week, day],
    queryFn: () => unwrap<DayDetail>(api.get('/prompt-library/me/day', { params: { week, day } })),
    enabled: week !== null && day !== null,
  });

  const selectedWeek = overview.data?.available.find((w) => w.week === week);

  const stageStatus = (stage: number) => {
    const rows = (history.data ?? []).filter((s) => s.week === week && s.day === day && s.stage === stage);
    if (rows.some((s) => s.status === 'completed')) return 'completed';
    if (rows.some((s) => s.status === 'active')) return 'in_progress';
    return 'not_started';
  };

  if (overview.isLoading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand/60" />
        <p className="mt-3 text-sm text-slate-400">Loading your learning journey…</p>
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Learning"
        description={`Your ${o.weeks_total}-week speaking journey — ${o.days_total} days each week.`}
      />

      {/* Profile-driven parameters */}
      <div className="card flex flex-wrap items-center gap-x-6 gap-y-3 bg-gradient-to-r from-brand to-brand-light text-white">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">CEFR level</p>
          <p className="text-lg font-extrabold">{o.cefr_level}</p>
        </div>
        <div className="h-8 w-px bg-white/20" aria-hidden />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">Preferred English</p>
          <p className="text-lg font-extrabold">{o.preferred_english}</p>
        </div>
        <div className="h-8 w-px bg-white/20" aria-hidden />
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-white/70">Current position</p>
          <p className="text-lg font-extrabold">Week {o.current_week} · Day {o.current_day}</p>
        </div>
        <Link to="/dashboard/profile" className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-semibold transition hover:bg-white/25">
          <Languages size={14} /> Change in profile
        </Link>
      </div>

      {!o.available.length ? (
        <div className="card py-16 text-center">
          <BookOpen className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 font-semibold text-slate-700">No lessons published yet</p>
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

          {/* Day detail + modes */}
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
                    const status = stageStatus(m.stage);
                    return (
                      <div key={m.stage} className={`card flex flex-col ${meta.tone} border`}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/70">
                            <Icon size={18} />
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wide">Stage {m.stage}</span>
                        </div>
                        <p className="mt-3 font-bold text-slate-800">{meta.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-500">{meta.blurb}</p>
                        <span className={`badge mt-3 self-start ${
                          status === 'completed' ? 'bg-green-100 text-green-700'
                            : status === 'in_progress' ? 'bg-amber-100 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}>
                          {status === 'completed' ? 'Completed' : status === 'in_progress' ? 'In progress' : 'Not started'}
                        </span>
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/60 pt-3">
                          <ViewPromptButton onClick={() => setViewPrompt(m.stage)} />
                          <button
                            type="button"
                            className="group inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-white hover:text-brand"
                            onClick={() => navigate(`/dashboard/learning/${week}/${day}/${m.stage}`)}
                          >
                            {status === 'in_progress' ? 'Resume' : status === 'completed' ? 'Practise again' : 'Start'}
                            <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="flex items-center gap-1.5 text-xs text-slate-400">
                  <GraduationCap size={13} />
                  Stages 1 and 2 pause until you repeat the improved sentence. Stage 3 never interrupts you.
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
          onClose={() => setViewPrompt(null)}
        />
      )}
    </div>
  );
}
