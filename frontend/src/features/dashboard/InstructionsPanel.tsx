import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookText, ChevronDown, Globe, Info, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';

/* Instructions section inside the student profile. Content comes from the
 * admin-managed Instructions library and is shown in the student's own
 * language, falling back to English when a translation is missing. */

interface Item {
  key: string;
  language: string | null;
  requested_language: string;
  is_fallback: boolean;
  title: string;
  body: string;
  untranslated?: boolean;
}
interface Language { code: string; label: string; native: string }
interface Payload { language: string; available_languages: Language[]; items: Item[] }

export function InstructionsPanel({ preferredLanguage }: { preferredLanguage?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [override, setOverride] = useState<string | null>(null);

  const lang = override ?? preferredLanguage;

  const data = useQuery({
    queryKey: ['my-instructions', lang],
    queryFn: () => unwrap<Payload>(api.get('/instructions/me', {
      params: lang ? { language: lang } : undefined,
    })),
  });

  // Changing the language here also saves it as the student's preference, so
  // the rest of the app follows suit.
  const savePreference = useMutation({
    mutationFn: (code: string) => unwrap(api.put('/dashboard/profile', { preferred_language: code })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['student-profile'] }),
  });

  const languages = data.data?.available_languages ?? [];
  const items = data.data?.items ?? [];

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-brand/10 p-2 text-brand"><BookText size={18} /></span>
          <div>
            <h2 className="font-bold text-slate-800">Instructions</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              How SpeakEdge works — read it in your own language.
            </p>
          </div>
        </div>
        <label className="inline-flex items-center gap-2">
          <Globe size={15} className="text-slate-400" />
          <select
            className="input py-1.5 text-sm"
            value={lang ?? 'en'}
            onChange={(e) => {
              setOverride(e.target.value);
              savePreference.mutate(e.target.value);
            }}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>{l.native} · {l.label}</option>
            ))}
          </select>
        </label>
      </div>

      {data.isLoading ? (
        <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" /></div>
      ) : data.isError ? (
        <p className="py-8 text-center text-sm text-red-600">{(data.error as Error).message}</p>
      ) : items.length === 0 ? (
        <div className="py-10 text-center">
          <Info className="mx-auto h-7 w-7 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">No instructions have been published yet.</p>
        </div>
      ) : (
        <div className="mt-4 divide-y divide-slate-100">
          {items.map((item) => {
            const expanded = open === item.key;
            return (
              <div key={item.key}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 py-3 text-left"
                  onClick={() => setOpen(expanded ? null : item.key)}
                  aria-expanded={expanded}
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-800">{item.title}</span>
                    {item.is_fallback && !item.untranslated && (
                      <span className="mt-0.5 block text-xs text-slate-400">
                        Not available in your language yet — showing {item.language?.toUpperCase()}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    size={17}
                    className={`shrink-0 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`}
                  />
                </button>
                {expanded && (
                  item.untranslated ? (
                    <p className="pb-4 text-sm text-slate-400">
                      This instruction has not been written yet.
                    </p>
                  ) : (
                    <p className="whitespace-pre-wrap pb-4 text-sm leading-relaxed text-slate-600">
                      {item.body}
                    </p>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
