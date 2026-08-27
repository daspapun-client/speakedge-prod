import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen, Check, ClipboardCopy, Copy, FileText, Layers, Loader2,
  RotateCcw, Save, Sparkles, X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PromptBodyEditor } from '@/components/PromptBodyEditor';
import { isBlankText, RichTextEditor } from '@/components/RichTextEditor';
import { api, unwrap } from '@/lib/api';
import { Modal, PageHeader, StatCard } from './_shared';

/* --------------------------------------------------------------------------
 * The Prompt Library navigator: Audience → Week → Day → Prompt slot.
 * Prompts are stored as a shared per-slot template plus optional per-day
 * overrides, so editing one prompt never duplicates the other 2,879.
 * ------------------------------------------------------------------------ */

interface Slot { key: string; label: string; stage: number; accent: string | null }
interface Structure {
  audiences: string[];
  weeks: number;
  days_per_week: number;
  slots: Slot[];
  default_day_topics: Record<string, string>;
  accents: string[];
  cefr_levels: string[];
  english_styles: string[];
}
interface WeekRow { week: number; days_total: number; days_created: number; days_configured: number }
interface DayRow {
  day: number; day_topic: string; title: string; exists: boolean; configured: boolean;
  published: boolean; sequence_steps: number; overridden_slots: string[]; id: string | null;
}
interface Lesson {
  id: string; audience: string; week: number; day: number;
  day_topic: string; title: string; context: string;
  conversation_sequence: string[];
  target_expressions: Record<string, string[]>;
  overridden_slots: string[];
  published: boolean;
}
interface RenderedPrompt {
  slot: string; label: string; stage: number; accent: string;
  source: 'template' | 'override'; body: string; raw: string;
  params: Record<string, string>;
}

const STAGE_TONE: Record<number, string> = {
  1: 'bg-brand/10 text-brand',
  2: 'bg-violet-100 text-violet-700',
  3: 'bg-emerald-100 text-emerald-700',
};

/** One item per line — plain-text editor with clean multilingual paste. */
function LineListEditor({ label, hint, value, rows = 5, onChange }: {
  label: string;
  hint?: string;
  value: string[];
  rows?: number;
  onChange: (next: string[]) => void;
}) {
  const text = value.join('\n');
  const minHeight = `${Math.max(rows * 1.35, 3)}rem`;
  return (
    <div>
      <label className="label">{label}</label>
      <RichTextEditor
        plainText
        mono
        minHeight={minHeight}
        value={text}
        placeholder="One per line"
        onChange={(next) => onChange(next.split('\n'))}
      />
      <p className="mt-1 text-xs text-slate-400">{hint ?? 'One per line.'}</p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn-ghost inline-flex items-center gap-1.5 text-xs"
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

export function AdminPromptLibrary() {
  const qc = useQueryClient();
  const [audience, setAudience] = useState('adults');
  const [week, setWeek] = useState(1);
  const [day, setDay] = useState(1);
  const [slot, setSlot] = useState('lexical_international');
  const [previewCefr, setPreviewCefr] = useState('B1');
  const [previewEnglish, setPreviewEnglish] = useState('Neutral International English');
  const [promptDraft, setPromptDraft] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);
  const [error, setError] = useState('');

  const structure = useQuery({
    queryKey: ['prompt-structure'],
    queryFn: () => unwrap<Structure>(api.get('/prompt-library/structure')),
  });
  const weeks = useQuery({
    queryKey: ['prompt-weeks', audience],
    queryFn: () => unwrap<WeekRow[]>(api.get('/prompt-library/weeks', { params: { audience } })),
  });
  const days = useQuery({
    queryKey: ['prompt-days', audience, week],
    queryFn: () => unwrap<DayRow[]>(api.get('/prompt-library/days', { params: { audience, week } })),
  });
  const lesson = useQuery({
    queryKey: ['prompt-lesson', audience, week, day],
    queryFn: () => unwrap<Lesson>(api.get('/prompt-library/lesson', { params: { audience, week, day } })),
  });
  const prompt = useQuery({
    queryKey: ['prompt-body', audience, week, day, slot, previewCefr, previewEnglish],
    queryFn: () => unwrap<RenderedPrompt>(api.get('/prompt-library/prompt', {
      params: { audience, week, day, slot, cefr_level: previewCefr, preferred_english: previewEnglish },
    })),
  });

  useEffect(() => {
    if (prompt.data?.raw != null) setPromptDraft(prompt.data.raw);
  }, [prompt.data?.raw]);

  const promptDirty = !!prompt.data && promptDraft !== prompt.data.raw;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['prompt-lesson', audience, week, day] });
    qc.invalidateQueries({ queryKey: ['prompt-body'] });
    qc.invalidateQueries({ queryKey: ['prompt-days', audience, week] });
    qc.invalidateQueries({ queryKey: ['prompt-weeks', audience] });
  };

  const saveLesson = useMutation({
    mutationFn: (body: Partial<Lesson>) =>
      unwrap(api.put('/prompt-library/lesson', body, { params: { audience, week, day } })),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const savePrompt = useMutation({
    mutationFn: (body: string) =>
      unwrap(api.put('/prompt-library/prompt', { body }, { params: { audience, week, day, slot } })),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const resetPrompt = useMutation({
    mutationFn: () => unwrap(api.delete('/prompt-library/prompt', { params: { audience, week, day, slot } })),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const copyPrompt = useMutation({
    mutationFn: (body: Record<string, unknown>) => unwrap(api.post('/prompt-library/prompt/copy', body)),
    onSuccess: () => { setError(''); setCopyOpen(false); refresh(); },
    onError: (e: Error) => setError(e.message),
  });

  const slots = structure.data?.slots ?? [];
  const activeSlot = slots.find((s) => s.key === slot);
  const totals = useMemo(() => {
    const rows = weeks.data ?? [];
    return {
      weeks: rows.length,
      configured: rows.reduce((n, r) => n + r.days_configured, 0),
      total: rows.reduce((n, r) => n + r.days_total, 0),
    };
  }, [weeks.data]);

  const l = lesson.data;

  // The day panel is edited as a local draft and committed with an explicit
  // Save — nothing is written while the admin is still typing.
  const [draft, setDraft] = useState<Lesson | null>(null);
  useEffect(() => { setDraft(l ?? null); }, [l]);
  const patch = (fields: Partial<Lesson>) =>
    setDraft((cur) => (cur ? { ...cur, ...fields } : cur));
  const dirty = !!draft && !!l && JSON.stringify(draft) !== JSON.stringify(l);

  // Blank lines are kept while typing so Enter works; they are dropped on save.
  const clean = (lines: string[]) => lines.map((s) => s.trim()).filter(Boolean);
  const saveDraft = () => {
    if (!draft) return;
    saveLesson.mutate({
      day_topic: draft.day_topic,
      title: draft.title,
      context: draft.context,
      published: draft.published,
      conversation_sequence: clean(draft.conversation_sequence),
      target_expressions: Object.fromEntries(
        Object.entries(draft.target_expressions ?? {}).map(([k, v]) => [k, clean(v)]),
      ),
    });
  };

  // Leaving the day with unsaved edits would silently discard them.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prompt Library"
        description="Audience → Week → Day → Prompt. Student CEFR level and preferred English are filled in automatically — never edit a prompt to change them."
        actions={
          <div className="inline-flex rounded-lg border border-slate-200 bg-surface p-0.5">
            {(structure.data?.audiences ?? ['adults', 'kids']).map((a) => (
              <button
                key={a}
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  audience === a ? 'bg-brand text-white shadow-sm' : 'text-slate-500 hover:text-brand'
                }`}
                onClick={() => { setAudience(a); setWeek(1); setDay(1); }}
              >
                {a}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Weeks in library" value={structure.data?.weeks ?? '—'} icon={Layers} hint={`${structure.data?.days_per_week ?? 6} days each`} />
        <StatCard label="Days configured" value={`${totals.configured} / ${totals.total || '—'}`} icon={BookOpen} accent="emerald" hint="Days with a conversation sequence" />
        <StatCard label="Prompt slots per day" value={slots.length || '—'} icon={Sparkles} accent="violet" hint="3 lexical + learning + assessment" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
        {/* Week / day navigator */}
        <div className="space-y-3">
          <div className="card p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Week</p>
            <div className="max-h-64 overflow-y-auto pr-1">
              <div className="grid grid-cols-4 gap-1">
                {(weeks.data ?? []).map((w) => (
                  <button
                    key={w.week}
                    type="button"
                    title={`${w.days_configured}/${w.days_total} days configured`}
                    className={`relative rounded-md py-1.5 text-xs font-semibold transition ${
                      week === w.week ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                    onClick={() => { setWeek(w.week); setDay(1); }}
                  >
                    {w.week}
                    {w.days_configured > 0 && (
                      <span className={`absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full ${week === w.week ? 'bg-white' : 'bg-emerald-500'}`} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="card p-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Day</p>
            <div className="flex flex-col gap-1">
              {(days.data ?? []).map((d) => (
                <button
                  key={d.day}
                  type="button"
                  className={`rounded-lg px-2.5 py-2 text-left text-xs transition ${
                    day === d.day ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  onClick={() => setDay(d.day)}
                >
                  <span className="font-semibold">Day {d.day}</span>
                  <span className={`ml-1.5 ${day === d.day ? 'text-white/75' : 'text-slate-400'}`}>{d.day_topic}</span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {d.configured ? (
                      <span className={`text-[10px] ${day === d.day ? 'text-white/80' : 'text-emerald-600'}`}>
                        {d.sequence_steps} step{d.sequence_steps === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className={`text-[10px] ${day === d.day ? 'text-white/70' : 'text-amber-600'}`}>Not configured</span>
                    )}
                    {d.overridden_slots.length > 0 && (
                      <span className={`text-[10px] ${day === d.day ? 'text-white/70' : 'text-violet-600'}`}>
                        · {d.overridden_slots.length} edited
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Lesson + prompt editor */}
        <div className="space-y-4">
          <div className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 font-bold text-slate-800">
                  <BookOpen size={16} className="text-brand" />
                  Week {week} · Day {day}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Shared by all five prompt slots for this day.
                </p>
              </div>
              {draft && (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    checked={draft.published}
                    onChange={(e) => patch({ published: e.target.checked })}
                  />
                  Published to students
                </label>
              )}
            </div>

            {lesson.isLoading ? (
              <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" /></div>
            ) : draft ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Day topic</label>
                  <input
                    className="input"
                    value={draft.day_topic}
                    onChange={(e) => patch({ day_topic: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Title</label>
                  <input
                    className="input"
                    value={draft.title}
                    onChange={(e) => patch({ title: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Context</label>
                  <RichTextEditor
                    plainText
                    minHeight="3.5rem"
                    value={draft.context}
                    placeholder="The scenario the conversation is set in"
                    onChange={(next) => patch({ context: next })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <LineListEditor
                    label="Conversation sequence"
                    hint="One step per line. The AI follows these in order — a day with no sequence is not offered to students."
                    rows={4}
                    value={draft.conversation_sequence}
                    onChange={(next) => patch({ conversation_sequence: next })}
                  />
                </div>
                {(structure.data?.accents ?? ['british', 'american', 'international']).map((accent) => (
                  <div key={accent} className={accent === 'international' ? 'sm:col-span-2' : ''}>
                    <LineListEditor
                      label={`Target expressions — ${accent}`}
                      hint="Stage 1 only. One collocation/expression per line."
                      rows={3}
                      value={draft.target_expressions?.[accent] ?? []}
                      onChange={(next) => patch({
                        target_expressions: { ...(draft.target_expressions ?? {}), [accent]: next },
                      })}
                    />
                  </div>
                ))}
              </div>
            ) : null}

            {draft && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-1.5"
                  onClick={saveDraft}
                  disabled={!dirty || saveLesson.isPending}
                >
                  {saveLesson.isPending
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Save size={14} />}
                  Save day
                </button>
                {dirty && (
                  <button type="button" className="btn-ghost" onClick={() => setDraft(l ?? null)}>
                    Discard changes
                  </button>
                )}
                <span className="text-xs text-slate-400">
                  {saveLesson.isPending
                    ? 'Saving…'
                    : dirty
                      ? 'Unsaved changes'
                      : 'All changes saved'}
                </span>
              </div>
            )}
          </div>

          {/* Prompt viewer / editor */}
          <div className="card">
            <div className="flex flex-wrap items-center gap-1.5">
              {slots.map((s) => {
                const edited = l?.overridden_slots?.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      slot === s.key ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                    onClick={() => { setSlot(s.key); }}
                  >
                    {s.label.replace(' – ', ' · ').replace('British/American/International', 'Auto')}
                    {edited && <span className={`h-1.5 w-1.5 rounded-full ${slot === s.key ? 'bg-white' : 'bg-violet-500'}`} />}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                {activeSlot && (
                  <span className={`badge ${STAGE_TONE[activeSlot.stage] ?? 'bg-slate-100 text-slate-600'}`}>
                    Stage {activeSlot.stage}
                  </span>
                )}
                {prompt.data && (
                  <span className={`badge ${prompt.data.source === 'override' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}`}>
                    {prompt.data.source === 'override' ? 'Custom prompt' : 'Shared template'}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select className="input py-1 text-xs" value={previewCefr} onChange={(e) => setPreviewCefr(e.target.value)}>
                  {(structure.data?.cefr_levels ?? ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).map((c) => (
                    <option key={c} value={c}>Preview as {c}</option>
                  ))}
                </select>
                <select className="input py-1 text-xs" value={previewEnglish} onChange={(e) => setPreviewEnglish(e.target.value)}>
                  {(structure.data?.english_styles ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            {prompt.isLoading ? (
              <div className="py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" /></div>
            ) : prompt.isError ? (
              <p className="py-8 text-center text-sm text-red-600">{(prompt.error as Error).message}</p>
            ) : prompt.data ? (
              <>
                <PromptBodyEditor
                  value={promptDraft}
                  params={prompt.data.params ?? {}}
                  onChange={setPromptDraft}
                  className="mt-4 max-h-[26rem] overflow-auto rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Edit the plain text directly. Highlighted values are dynamic — they come from lesson
                  data and the preview settings above; only the surrounding instructions can be changed.
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-primary inline-flex items-center gap-1.5 text-xs"
                    disabled={!promptDirty || savePrompt.isPending || isBlankText(promptDraft)}
                    onClick={() => savePrompt.mutate(promptDraft)}
                  >
                    {savePrompt.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save prompt
                  </button>
                  {promptDirty && (
                    <button
                      type="button"
                      className="btn-ghost inline-flex items-center gap-1.5 text-xs"
                      onClick={() => setPromptDraft(prompt.data!.raw)}
                    >
                      <X size={14} /> Discard
                    </button>
                  )}
                  <CopyButton text={prompt.data.body} />
                  <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-xs"
                    onClick={() => setCopyOpen(true)}>
                    <Copy size={14} /> Copy to another day
                  </button>
                  {prompt.data.source === 'override' && (
                    <button
                      type="button"
                      className="btn-ghost inline-flex items-center gap-1.5 text-xs text-amber-700"
                      disabled={resetPrompt.isPending}
                      onClick={() => { if (window.confirm('Discard this custom prompt and go back to the shared template?')) resetPrompt.mutate(); }}
                    >
                      <RotateCcw size={14} /> Reset to template
                    </button>
                  )}
                  <span className="text-xs text-slate-400">
                    {promptDirty ? 'Unsaved prompt changes' : 'Prompt saved'}
                  </span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {copyOpen && (
        <CopyPromptModal
          structure={structure.data}
          from={{ audience, week, day, slot }}
          pending={copyPrompt.isPending}
          onClose={() => setCopyOpen(false)}
          onCopy={(body) => copyPrompt.mutate(body)}
        />
      )}
    </div>
  );
}

function CopyPromptModal({ structure, from, pending, onClose, onCopy }: {
  structure?: Structure;
  from: { audience: string; week: number; day: number; slot: string };
  pending: boolean;
  onClose: () => void;
  onCopy: (body: Record<string, unknown>) => void;
}) {
  const [toAudience, setToAudience] = useState(from.audience);
  const [toWeek, setToWeek] = useState(from.week === 1 ? 2 : 1);
  const [toDay, setToDay] = useState(from.day);
  const [allSlots, setAllSlots] = useState(false);
  const [includeLesson, setIncludeLesson] = useState(false);
  const [overwrite, setOverwrite] = useState(false);

  const weekCount = structure?.weeks ?? 48;
  const dayCount = structure?.days_per_week ?? 6;

  return (
    <Modal onClose={onClose}>
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Copy size={18} className="text-brand" /> Copy prompt
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        From <span className="font-semibold capitalize">{from.audience}</span> · Week {from.week} · Day {from.day}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Audience</label>
          <select className="input" value={toAudience} onChange={(e) => setToAudience(e.target.value)}>
            {(structure?.audiences ?? ['adults', 'kids']).map((a) => (
              <option key={a} value={a} className="capitalize">{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Week</label>
          <select className="input" value={toWeek} onChange={(e) => setToWeek(Number(e.target.value))}>
            {Array.from({ length: weekCount }, (_, i) => i + 1).map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Day</label>
          <select className="input" value={toDay} onChange={(e) => setToDay(Number(e.target.value))}>
            {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-brand" checked={allSlots} onChange={(e) => setAllSlots(e.target.checked)} />
          Copy every edited prompt for this day (not just the selected slot)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-brand" checked={includeLesson} onChange={(e) => setIncludeLesson(e.target.checked)} />
          Also copy the topic, context, sequence and target expressions
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-brand" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          Overwrite custom prompts already on the destination day
        </label>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button
          className="btn-primary inline-flex items-center gap-1.5"
          disabled={pending}
          onClick={() => onCopy({
            from_audience: from.audience, from_week: from.week, from_day: from.day,
            to_audience: toAudience, to_week: toWeek, to_day: toDay,
            slot: allSlots ? null : from.slot,
            include_lesson: includeLesson,
            overwrite,
          })}
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />} Copy
        </button>
      </div>
    </Modal>
  );
}
