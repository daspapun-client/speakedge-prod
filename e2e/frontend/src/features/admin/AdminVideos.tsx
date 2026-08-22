import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Check, ChevronDown, Eye, FileText, Loader2, Pencil, Plus, Upload, Video } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, Modal, PageHeader, StatusBadge, TableFilter } from './_shared';

type ContentKind = 'video' | 'pdf';

interface Video {
  id: string;
  title: string;
  kind: ContentKind;
  category: string;
  source: string;
  url: string;
  access: string;
  plans: string[];
  student_ids: string[];
  description?: string | null;
  display_order: number;
}
interface Plan { plan: string; label: string }
interface WatchStat { video_id: string; title: string; kind?: ContentKind; views: number; unique_viewers: number; completions: number }

// Editable content fields shared by the Add form and the Edit modal.
interface VideoForm { title: string; kind: ContentKind; category: string; source: string; url: string; access: string; plans: string[]; student_ids: string[]; description: string; display_order: number }

function patchFromPlanSelection(selected: string[], allPlans: Plan[]): Pick<VideoForm, 'category' | 'plans'> {
  if (!selected.length) return { category: 'general', plans: [] };
  if (selected.length === 1) {
    const p = allPlans.find((x) => x.plan === selected[0]);
    return { category: p?.label ?? selected[0], plans: selected };
  }
  return { category: 'general', plans: selected };
}

/** Multi-select dropdown: General (all students) or subscription plans. */
function AudienceMultiSelect({ selected, plans, className, onChange }: {
  selected: string[];
  plans: Plan[];
  className?: string;
  onChange: (plans: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const summary = useMemo(() => {
    if (!selected.length) return 'General';
    if (selected.length === 1) return plans.find((p) => p.plan === selected[0])?.label ?? selected[0];
    return `${selected.length} plans selected`;
  }, [selected, plans]);

  const togglePlan = (plan: string) =>
    onChange(selected.includes(plan) ? selected.filter((p) => p !== plan) : [...selected, plan]);

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        className="input flex w-full items-center justify-between gap-2 py-1.5 text-left text-sm"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-brand/5">
            <input type="checkbox" className="accent-brand" checked={!selected.length} onChange={() => onChange([])} />
            General
          </label>
          {plans.map((p) => (
            <label key={p.plan} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-brand/5">
              <input type="checkbox" className="accent-brand" checked={selected.includes(p.plan)} onChange={() => togglePlan(p.plan)} />
              {p.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const VIDEO_SOURCE = ['youtube', 'uploaded'];

function youtubeId(url: string) {
  return url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([\w-]{11})/)?.[1] ?? null;
}

function videoThumbnail(v: Pick<Video, 'source' | 'url'>) {
  if (v.source !== 'youtube') return null;
  const id = youtubeId(v.url);
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}

function VideoTitleCell({ v }: { v: Video }) {
  const isPdf = v.kind === 'pdf';
  const thumb = isPdf ? null : videoThumbnail(v);
  return (
    <div className="flex items-center gap-3">
      <div className="relative h-10 w-[4.5rem] shrink-0 overflow-hidden rounded-md bg-slate-900 ring-1 ring-slate-200/80">
        {thumb ? (
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className={`flex h-full items-center justify-center bg-gradient-to-br ${isPdf ? 'from-rose-500 to-rose-700' : 'from-slate-700 to-slate-900'}`}>
            {isPdf ? <FileText size={14} className="text-white/70" /> : <Video size={14} className="text-white/50" />}
          </div>
        )}
      </div>
      <span className="min-w-0 font-semibold leading-snug">{v.title}</span>
    </div>
  );
}

const emptyForm: VideoForm = { title: '', kind: 'video', category: 'general', source: 'youtube', url: '', access: 'member', plans: [], student_ids: [], description: '', display_order: 0 };

/** Switching content type resets the source to one that is valid for it. */
function patchFromKind(kind: ContentKind): Partial<VideoForm> {
  return kind === 'pdf'
    ? { kind, source: 'uploaded', url: '' }
    : { kind, source: 'youtube', url: '' };
}

/** Shared add/edit form — content type, title, membership mapping, source, URL. */
function VideoFormGrid({ v, plans, uploading, onChange, onUpload }: {
  v: VideoForm;
  plans: Plan[];
  uploading: boolean;
  onChange: (patch: Partial<VideoForm>) => void;
  onUpload: (file: File, kind: ContentKind) => void;
}) {
  const isPdf = v.kind === 'pdf';
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label">Content type</label>
        <div className="inline-flex w-full rounded-lg border border-slate-200 bg-surface p-0.5 sm:w-64">
          {(['video', 'pdf'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                v.kind === k ? 'bg-brand text-white' : 'text-slate-500 hover:text-brand'
              }`}
              onClick={() => onChange(patchFromKind(k))}
            >
              {k === 'video' ? <Video size={13} /> : <FileText size={13} />}
              {k === 'video' ? 'Video' : 'PDF'}
            </button>
          ))}
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Title</label>
        <input className="input" placeholder={isPdf ? 'Document title' : 'Video title'} value={v.title} onChange={(e) => onChange({ title: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Membership access</label>
        <AudienceMultiSelect
          selected={v.plans}
          plans={plans}
          onChange={(next) => onChange(patchFromPlanSelection(next, plans))}
        />
        <p className="mt-1 text-xs text-slate-400">
          {v.plans.length
            ? 'Only these memberships (and higher tiers) can see this content.'
            : 'General — visible to every student.'}
        </p>
      </div>
      {!isPdf && (
        <div>
          <label className="label">Source</label>
          <div className="inline-flex w-full rounded-lg border border-slate-200 bg-surface p-0.5">
            {VIDEO_SOURCE.map((s) => (
              <button
                key={s}
                type="button"
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                  v.source === s ? 'bg-brand text-white' : 'text-slate-500 hover:text-brand'
                }`}
                onClick={() => onChange({ source: s })}
              >
                {s === 'youtube' ? 'YouTube' : 'Upload'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="sm:col-span-2">
        <label className="label">{isPdf ? 'PDF file' : v.source === 'youtube' ? 'YouTube URL' : 'Video file'}</label>
        <div className="flex gap-2">
          <input
            className="input min-w-0 flex-1"
            placeholder={
              isPdf ? 'Upload a PDF or paste /media/… URL'
                : v.source === 'youtube' ? 'https://youtube.com/watch?v=…'
                  : 'Upload a file or paste /media/… URL'
            }
            value={v.url}
            onChange={(e) => onChange({ url: e.target.value })}
          />
          {(isPdf || v.source === 'uploaded') && (
            <label className="btn-ghost shrink-0 cursor-pointer">
              {uploading ? <Loader2 size={16} className="animate-spin" /> : v.url ? <Check size={16} className="text-emerald-600" /> : <Upload size={16} />}
              {uploading ? 'Uploading…' : v.url ? 'Replace' : 'Browse'}
              <input
                type="file"
                accept={isPdf ? 'application/pdf' : 'video/*'}
                className="hidden"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f, v.kind); e.target.value = ''; }}
              />
            </label>
          )}
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="label">Description <span className="font-normal text-slate-400">(optional)</span></label>
        <textarea
          className="input min-h-[4rem]"
          placeholder="Shown to students under the title"
          value={v.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>
    </div>
  );
}

/** Inline preview: YouTube embed, uploaded video, or an embedded PDF. */
function VideoPreview({ v }: { v: Video }) {
  const yt = v.kind === 'video' && v.source === 'youtube'
    ? v.url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/)([\w-]{11})/)
    : null;
  return (
    <div>
      {v.kind === 'pdf' ? (
        <object data={v.url} type="application/pdf" className="h-[60vh] w-full rounded-lg border border-slate-200">
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-50 text-sm text-slate-500">
            <FileText size={28} className="text-slate-300" />
            This browser cannot display the PDF inline.
          </div>
        </object>
      ) : yt ? (
        <iframe className="aspect-video w-full rounded-lg" src={`https://www.youtube.com/embed/${yt[1]}`} allowFullScreen title={v.title} />
      ) : (
        <video className="w-full rounded-lg" src={v.url} controls />
      )}
      <a className="mt-2 inline-block text-sm text-brand underline" href={v.url} target="_blank" rel="noreferrer">Open in new tab</a>
    </div>
  );
}

export function AdminVideos() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'videos' | 'stats'>('videos');
  const [kindFilter, setKindFilter] = useState('');
  const [form, setForm] = useState<VideoForm>(emptyForm);
  const [editing, setEditing] = useState<(VideoForm & { id: string }) | null>(null);
  const [viewing, setViewing] = useState<Video | null>(null);
  const [error, setError] = useState('');

  const videos = useQuery({ queryKey: ['admin-videos'], queryFn: () => unwrap<Video[]>(api.get('/videos/admin/list')) });
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => unwrap<Plan[]>(api.get('/payments/plans', { params: { all: true } })) });
  const stats = useQuery({ queryKey: ['admin-video-stats'], queryFn: () => unwrap<WatchStat[]>(api.get('/videos/admin/stats')), enabled: tab === 'stats' });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-videos'] });
  const planLabel = (key: string) => plans.data?.find((p) => p.plan === key)?.label ?? key;

  const create = useMutation({
    mutationFn: () => {
      if (!form.title.trim() || !form.url.trim()) throw new Error('Title and URL are required');
      return unwrap(api.post('/videos/', form));
    },
    onSuccess: () => { setError(''); setForm(emptyForm); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const patchVideo = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Video> }) => unwrap(api.patch(`/videos/${id}`, body)),
    onSuccess: refresh,
  });
  const saveEdit = () => {
    if (!editing) return;
    if (!editing.title.trim() || !editing.url.trim()) { setError('Title and URL are required'); return; }
    const { id, ...body } = editing;
    patchVideo.mutate({ id, body }, { onSuccess: () => { setError(''); setEditing(null); refresh(); } });
  };
  const archive = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/videos/${id}`)),
    onSuccess: refresh,
  });
  const upload = useMutation({
    mutationFn: ({ file, kind }: { file: File; kind: ContentKind }) => {
      const fd = new FormData();
      fd.append('file', file);
      return unwrap<{ url: string }>(
        api.post(kind === 'pdf' ? '/videos/upload-pdf' : '/videos/upload', fd),
      );
    },
    onError: (e: Error) => setError(e.message),
  });

  const applyUpload = (url: string, apply: (patch: Partial<VideoForm>) => void) => {
    setError('');
    apply({ url, source: 'uploaded' });
  };

  const visibleRows = useMemo(
    () => (kindFilter ? videos.data?.filter((v) => v.kind === kindFilter) : videos.data),
    [videos.data, kindFilter],
  );

  const videoColumns: Column<Video>[] = [
    { key: 'title', header: 'Title', sort: (v) => v.title, cell: (v) => <VideoTitleCell v={v} /> },
    {
      key: 'kind',
      header: 'Type',
      sort: (v) => v.kind,
      cell: (v) => (
        <span className={`badge inline-flex items-center gap-1 ${v.kind === 'pdf' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
          {v.kind === 'pdf' ? <FileText size={11} /> : <Video size={11} />}
          {v.kind === 'pdf' ? 'PDF' : 'Video'}
        </span>
      ),
    },
    { key: 'category', header: 'Category', sort: (v) => v.plans?.length ? v.plans.join() : 'general', cell: (v) => (
      <span className="text-slate-500">
        {v.plans?.length ? v.plans.map((k) => planLabel(k)).join(', ') : 'General'}
      </span>
    ) },
    { key: 'source', header: 'Source', sort: (v) => v.source, cell: (v) => <StatusBadge status={v.source} /> },
    { key: 'access', header: 'Visibility', sort: (v) => v.access, cell: (v) => <StatusBadge status={v.access} /> },
    {
      key: 'plans',
      header: 'Visible to',
      cell: (v) =>
        v.student_ids?.length
          ? <span className="badge bg-brand/10 text-brand">{v.student_ids.length} specific {v.student_ids.length === 1 ? 'person' : 'people'}</span>
          : v.plans?.length
            ? <div className="flex flex-wrap gap-1">{v.plans.map((k) => <span key={k} className="badge bg-slate-100 text-slate-600">{planLabel(k)}</span>)}</div>
            : <span className="text-xs text-slate-400">All students</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '1%',
      cell: (v) => (
        <div className="flex justify-end">
          <div className="inline-flex items-stretch overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-900/[0.04]">
            <button
              type="button"
              title="Preview video"
              onClick={() => setViewing(v)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/5"
            >
              <Eye size={14} strokeWidth={2.25} />
              View
            </button>
            <span className="w-px shrink-0 self-stretch bg-slate-200" aria-hidden />
            <button
              type="button"
              title="Edit video"
              onClick={() => {
                setError('');
                setEditing({
                  id: v.id,
                  title: v.title,
                  kind: v.kind ?? 'video',
                  category: v.category,
                  source: v.source,
                  url: v.url,
                  access: v.access,
                  plans: v.plans ?? [],
                  student_ids: v.student_ids ?? [],
                  description: v.description ?? '',
                  display_order: v.display_order,
                });
              }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <Pencil size={14} strokeWidth={2.25} />
              Edit
            </button>
            <span className="w-px shrink-0 self-stretch bg-slate-200" aria-hidden />
            <button
              type="button"
              title="Archive video"
              onClick={() => { if (window.confirm(`Archive this ${v.kind === 'pdf' ? 'document' : 'video'}? Students will lose access immediately; it stays restorable for 60 days.`)) archive.mutate(v.id); }}
              className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50"
            >
              <Archive size={14} strokeWidth={2.25} />
              Archive
            </button>
          </div>
        </div>
      ),
    },
  ];

  const statColumns: Column<WatchStat>[] = [
    {
      key: 'title',
      header: 'Title',
      sort: (s) => s.title,
      cell: (s) => {
        const v = videos.data?.find((x) => x.id === s.video_id);
        return v ? <VideoTitleCell v={v} /> : <span className="font-semibold">{s.title}</span>;
      },
    },
    { key: 'views', header: 'Views', align: 'right', sort: (s) => s.views },
    { key: 'unique_viewers', header: 'Unique viewers', align: 'right', sort: (s) => s.unique_viewers },
    { key: 'completions', header: 'Completions', align: 'right', sort: (s) => s.completions },
  ];

  return (
    <div>
      <PageHeader
        title="Content Management"
        description="Videos & PDF study material, membership access mapping, and watch statistics."
      />
      <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-surface p-0.5">
        {(['videos', 'stats'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
              tab === t ? 'bg-brand text-white shadow-sm' : 'text-slate-500 hover:text-brand'
            }`}
            onClick={() => setTab(t)}
          >
            {t === 'videos' ? 'Content library' : 'Watch statistics'}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {tab === 'videos' ? (
        <>
          <div className="card mt-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-bold text-brand">
              {form.kind === 'pdf' ? <FileText size={16} strokeWidth={2.25} /> : <Video size={16} strokeWidth={2.25} />}
              Add content
            </h2>

            <VideoFormGrid
              v={form}
              plans={plans.data ?? []}
              uploading={upload.isPending}
              onChange={(p) => setForm((f) => ({ ...f, ...p }))}
              onUpload={(file, kind) => upload.mutate({ file, kind }, { onSuccess: (res) => applyUpload(res.url, (p) => setForm((s) => ({ ...s, ...p }))) })}
            />
            <div className="mt-3 flex items-end">
              <button type="button" className="btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add {form.kind === 'pdf' ? 'PDF' : 'video'}
              </button>
            </div>
          </div>

          <DataTable
            rows={visibleRows}
            columns={videoColumns}
            loading={videos.isLoading}
            rowKey={(v) => v.id}
            searchText={(v) => `${v.title} ${v.category} ${v.kind}`}
            searchPlaceholder="Search content"
            emptyLabel={kindFilter === 'pdf' ? 'No PDF content yet.' : kindFilter === 'video' ? 'No videos yet.' : 'No content yet.'}
            filters={
              <TableFilter
                value={kindFilter}
                onChange={setKindFilter}
                options={[
                  { value: '', label: 'All' },
                  { value: 'video', label: 'Videos' },
                  { value: 'pdf', label: 'PDFs' },
                ]}
              />
            }
          />
        </>
      ) : (
        <DataTable
          rows={stats.data}
          columns={statColumns}
          loading={stats.isLoading}
          rowKey={(s) => s.video_id}
          searchText={(s) => s.title}
          searchPlaceholder="Search videos"
          initialSort={{ key: 'views', dir: 'desc' }}
          emptyLabel="No watch data."
        />
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <h2 className="text-lg font-bold">Edit content</h2>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          <div className="mt-4">
            <VideoFormGrid
              v={editing}
              plans={plans.data ?? []}
              uploading={upload.isPending}
              onChange={(p) => setEditing((s) => s && { ...s, ...p })}
              onUpload={(file, kind) => upload.mutate({ file, kind }, { onSuccess: (res) => applyUpload(res.url, (p) => setEditing((s) => s && { ...s, ...p })) })}
            />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" disabled={patchVideo.isPending} onClick={saveEdit}>Save</button>
          </div>
        </Modal>
      )}

      {viewing && (
        <Modal onClose={() => setViewing(null)} wide>
          <h2 className="text-lg font-bold">{viewing.title}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={viewing.source} />
            <StatusBadge status={viewing.access} />
            <span className="badge bg-slate-100 text-slate-600">{viewing.category}</span>
          </div>
          <div className="mt-4"><VideoPreview v={viewing} /></div>
          {viewing.description && <p className="mt-3 text-sm text-slate-600">{viewing.description}</p>}
          <div className="mt-3 text-sm text-slate-600">
            <span className="font-semibold">Visible to: </span>
            {viewing.student_ids?.length
              ? `${viewing.student_ids.length} specific ${viewing.student_ids.length === 1 ? 'person' : 'people'}`
              : viewing.plans?.length ? viewing.plans.map(planLabel).join(', ') : 'All students'}
          </div>
        </Modal>
      )}
    </div>
  );
}
