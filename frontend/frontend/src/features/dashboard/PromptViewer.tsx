import { useQuery } from '@tanstack/react-query';
import { Check, ClipboardCopy, Eye, Loader2, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PromptBodyView } from '@/components/PromptBodyEditor';
import { api, unwrap } from '@/lib/api';
import { Modal } from '@/features/admin/_shared';

interface StudentPrompt {
  week: number;
  day: number;
  stage: number;
  label: string;
  accent: string;
  body: string;
  raw: string;
  params: Record<string, string>;
  cefr_level: string;
  preferred_english: string;
  day_topic: string;
  title: string;
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
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export function PromptViewerModal({ week, day, stage, cefrLevel, preferredEnglish, onClose }: {
  week: number;
  day: number;
  stage: number;
  /* Optional preview overrides. Omitted → the prompt renders with the
   * student's own profile values (how the AI session will actually run). */
  cefrLevel?: string;
  preferredEnglish?: string;
  onClose: () => void;
}) {
  const prompt = useQuery({
    queryKey: ['my-prompt', week, day, stage, cefrLevel ?? null, preferredEnglish ?? null],
    queryFn: () => unwrap<StudentPrompt>(api.get('/prompt-library/me/prompt', {
      params: {
        week, day, stage,
        cefr_level: cefrLevel,
        preferred_english: preferredEnglish,
      },
    })),
  });

  return (
    <Modal onClose={onClose} wide>
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <ScrollText size={18} className="text-brand" />
        {prompt.data?.label ?? 'Practice prompt'}
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Week {week} · Day {day}
        {prompt.data?.title ? ` — ${prompt.data.title}` : ''}
      </p>

      {prompt.isLoading ? (
        <div className="py-14 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" /></div>
      ) : prompt.isError ? (
        <p className="py-10 text-center text-sm text-red-600">{(prompt.error as Error).message}</p>
      ) : prompt.data ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="badge bg-brand/10 text-brand">Stage {prompt.data.stage}</span>
            <span className="badge bg-slate-100 text-slate-600">{prompt.data.day_topic}</span>
            <span className="badge bg-slate-100 text-slate-600">CEFR {prompt.data.cefr_level}</span>
            <span className="badge bg-slate-100 text-slate-600">{prompt.data.preferred_english}</span>
          </div>

          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {cefrLevel || preferredEnglish ? (
              <>
                Preview: this is how the prompt reads at CEFR {prompt.data.cefr_level} ·{' '}
                {prompt.data.preferred_english}. Your actual sessions still use your profile
                settings — change them in your profile to make this permanent.
              </>
            ) : (
              <>
                This is the instruction your AI tutor follows. It's filled in from your profile —
                change your CEFR level or preferred English in your profile and it updates
                automatically.
              </>
            )}{' '}
            View only: prompts are managed by SpeakEdge.
          </p>

          <PromptBodyView
            raw={prompt.data.raw}
            params={prompt.data.params ?? {}}
            className="mt-3 max-h-[26rem] overflow-auto rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70"
          />

          <div className="mt-4 flex justify-end gap-2">
            <CopyButton text={prompt.data.body} />
            <button className="btn-primary" onClick={onClose}>Close</button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

/** Small "View prompt" trigger used on mode cards and in the session header. */
export function ViewPromptButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-white/70 hover:text-brand ${className}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <Eye size={13} /> View prompt
    </button>
  );
}
