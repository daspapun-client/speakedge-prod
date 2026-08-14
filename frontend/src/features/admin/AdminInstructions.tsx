import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Globe, Languages, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader } from './_shared';

/* Multilingual instruction articles shown in the student profile. Each article
 * holds one translation per language; students see their preferred language and
 * fall back to the article's fallback language when it is missing. */

interface Translation { title?: string; body?: string }
interface Instruction {
  id: string;
  key: string;
  audience: string;
  display_order: number;
  fallback_language: string;
  translations: Record<string, Translation>;
  translated_languages: string[];
  published: boolean;
}
interface Language { code: string; label: string; native: string }

export function AdminInstructions() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Instruction | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');

  const items = useQuery({
    queryKey: ['admin-instructions'],
    queryFn: () => unwrap<Instruction[]>(api.get('/instructions/admin/list')),
  });
  const langs = useQuery({
    queryKey: ['instruction-languages'],
    queryFn: () => unwrap<{ languages: Language[]; default: string }>(api.get('/instructions/languages')),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-instructions'] });

  const create = useMutation({
    mutationFn: () => unwrap<Instruction>(api.post('/instructions/admin', {
      key: newKey,
      translations: { en: { title: newKey, body: '' } },
    })),
    onSuccess: (row) => { setError(''); setCreating(false); setNewKey(''); refresh(); setEditing(row); },
    onError: (e: Error) => setError(e.message),
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Instruction> }) =>
      unwrap(api.patch(`/instructions/admin/${id}`, body)),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });
  const archive = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/instructions/admin/${id}`)),
    onSuccess: refresh,
  });

  const columns: Column<Instruction>[] = [
    {
      key: 'key',
      header: 'Instruction',
      sort: (i) => i.key,
      cell: (i) => (
        <div>
          <p className="font-semibold text-slate-800">{i.translations?.en?.title || i.key}</p>
          <p className="font-mono text-xs text-slate-400">{i.key}</p>
        </div>
      ),
    },
    {
      key: 'languages',
      header: 'Languages',
      sort: (i) => i.translated_languages.length,
      cell: (i) => (
        <div className="flex flex-wrap gap-1">
          {i.translated_languages.length ? i.translated_languages.map((c) => (
            <span key={c} className={`badge ${c === i.fallback_language ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-600'}`}>
              {c}
            </span>
          )) : <span className="text-xs text-amber-600">No translations</span>}
        </div>
      ),
    },
    { key: 'display_order', header: 'Order', align: 'right', sort: (i) => i.display_order },
    {
      key: 'published',
      header: 'Status',
      sort: (i) => String(i.published),
      cell: (i) => (
        <span className={`badge ${i.published ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
          {i.published ? 'Published' : 'Draft'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (i) => (
        <div className="flex justify-end gap-1">
          <button type="button" className="btn-ghost inline-flex items-center gap-1.5 text-xs" onClick={() => setEditing(i)}>
            <Languages size={14} /> Translations
          </button>
          <button
            type="button"
            className="btn-ghost inline-flex items-center gap-1.5 text-xs text-red-600"
            onClick={() => { if (window.confirm(`Archive "${i.key}"? Students will stop seeing it immediately.`)) archive.mutate(i.id); }}
          >
            <Archive size={14} /> Archive
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Instructions"
        description="Multilingual help articles shown in the student profile. Students read them in their own language."
        actions={
          <button className="btn-primary inline-flex items-center gap-2" onClick={() => { setError(''); setCreating(true); }}>
            <Plus size={16} /> New instruction
          </button>
        }
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <DataTable
        rows={items.data}
        columns={columns}
        loading={items.isLoading}
        rowKey={(i) => i.id}
        searchText={(i) => `${i.key} ${i.translations?.en?.title ?? ''}`}
        searchPlaceholder="Search instructions"
        emptyLabel="No instructions yet. Create one to get started."
      />

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <h2 className="text-lg font-bold">New instruction</h2>
          <p className="mt-1 text-sm text-slate-500">
            The key is a stable slug used internally — the visible title comes from each translation.
          </p>
          <div className="mt-4">
            <label className="label">Key</label>
            <input
              className="input"
              placeholder="e.g. getting-started"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
            />
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button className="btn-primary" disabled={!newKey.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? <Loader2 size={16} className="animate-spin" /> : 'Create'}
            </button>
          </div>
        </Modal>
      )}

      {editing && (
        <TranslationEditor
          instruction={editing}
          languages={langs.data?.languages ?? []}
          onClose={() => setEditing(null)}
          onSaved={(fresh) => { setEditing(fresh); refresh(); }}
          onMeta={(body) => patch.mutate({ id: editing.id, body })}
        />
      )}
    </div>
  );
}

function TranslationEditor({ instruction, languages, onClose, onSaved, onMeta }: {
  instruction: Instruction;
  languages: Language[];
  onClose: () => void;
  onSaved: (fresh: Instruction) => void;
  onMeta: (body: Partial<Instruction>) => void;
}) {
  const [lang, setLang] = useState(instruction.fallback_language || 'en');
  const current = instruction.translations?.[lang] ?? {};
  const [title, setTitle] = useState(current.title ?? '');
  const [body, setBody] = useState(current.body ?? '');
  const [error, setError] = useState('');

  const selectLanguage = (code: string) => {
    setLang(code);
    const t = instruction.translations?.[code] ?? {};
    setTitle(t.title ?? '');
    setBody(t.body ?? '');
    setError('');
  };

  const save = useMutation({
    mutationFn: () => unwrap<Instruction>(
      api.put(`/instructions/admin/${instruction.id}/translations/${lang}`, { title, body }),
    ),
    onSuccess: (fresh) => { setError(''); onSaved(fresh); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => unwrap<Instruction>(
      api.delete(`/instructions/admin/${instruction.id}/translations/${lang}`),
    ),
    onSuccess: (fresh) => { setError(''); onSaved(fresh); selectLanguage(fresh.fallback_language); },
    onError: (e: Error) => setError(e.message),
  });

  const translated = new Set(
    Object.entries(instruction.translations ?? {})
      .filter(([, v]) => v?.title || v?.body)
      .map(([k]) => k),
  );

  return (
    <Modal onClose={onClose} wide>
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <Globe size={18} className="text-brand" /> {instruction.key}
      </h2>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Fallback language</label>
          <select
            className="input"
            value={instruction.fallback_language}
            onChange={(e) => onMeta({ fallback_language: e.target.value })}
          >
            {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Display order</label>
          <input
            type="number"
            className="input"
            defaultValue={instruction.display_order}
            onBlur={(e) => onMeta({ display_order: Number(e.target.value) })}
          />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 pb-2 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              className="accent-brand"
              checked={instruction.published}
              onChange={(e) => onMeta({ published: e.target.checked })}
            />
            Published
          </label>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Language</p>
        <div className="flex flex-wrap gap-1.5">
          {languages.map((l) => (
            <button
              key={l.code}
              type="button"
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                lang === l.code ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
              onClick={() => selectLanguage(l.code)}
            >
              {l.native}
              {translated.has(l.code) && (
                <span className={`h-1.5 w-1.5 rounded-full ${lang === l.code ? 'bg-white' : 'bg-emerald-500'}`} />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Body</label>
          <textarea className="input min-h-[12rem]" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {translated.has(lang) && lang !== instruction.fallback_language && (
          <button
            className="btn-ghost inline-flex items-center gap-1.5 text-red-600"
            disabled={remove.isPending}
            onClick={() => { if (window.confirm(`Remove the '${lang}' translation?`)) remove.mutate(); }}
          >
            <Trash2 size={16} /> Remove language
          </button>
        )}
        <button className="btn-ghost" onClick={onClose}>Close</button>
        <button
          className="btn-primary inline-flex items-center gap-1.5"
          disabled={save.isPending || !title.trim() || !body.trim()}
          onClick={() => save.mutate()}
        >
          {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save translation
        </button>
      </div>
    </Modal>
  );
}
