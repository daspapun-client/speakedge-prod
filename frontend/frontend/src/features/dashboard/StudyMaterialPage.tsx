import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, FileText, Loader2, Lock, X } from 'lucide-react';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from '@/features/admin/_shared';

/* PDF study material. Access is decided server-side by membership — opening an
 * item re-checks authorization before the file URL is handed over. */

interface Doc {
  id: string;
  title: string;
  category: string;
  url: string;
  plans?: string[];
  description?: string | null;
}
interface Plan { plan: string; label: string }

export function StudyMaterialPage() {
  const [open, setOpen] = useState<Doc | null>(null);
  const [error, setError] = useState('');

  const docs = useQuery({
    queryKey: ['study-material'],
    queryFn: () => unwrap<Doc[]>(api.get('/videos/library', { params: { kind: 'pdf' } })),
  });
  const plans = useQuery({
    queryKey: ['plans'],
    queryFn: () => unwrap<Plan[]>(api.get('/payments/plans')),
  });

  // Re-verify access at open time; the listing could be stale after a plan
  // change or after an admin archived the document.
  const openDoc = useMutation({
    mutationFn: (id: string) => unwrap<Doc>(api.get(`/videos/${id}/open`)),
    onSuccess: (doc) => { setError(''); setOpen(doc); },
    onError: (e: Error) => { setError(e.message); setOpen(null); },
  });

  const planLabel = (key: string) => plans.data?.find((p) => p.plan === key)?.label ?? key;
  const items = docs.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Study Material"
        description="PDF workbooks and handouts included with your membership."
      />

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</p>
      )}

      {docs.isLoading ? (
        <div className="card py-16 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand/60" /></div>
      ) : docs.isError ? (
        <div className="card py-10 text-center text-sm text-red-600">{(docs.error as Error).message}</div>
      ) : items.length === 0 ? (
        <div className="card py-16 text-center">
          <Lock className="mx-auto h-9 w-9 text-slate-300" />
          <p className="mt-3 font-semibold text-slate-700">No study material available yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Documents included with your membership will appear here.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((d) => (
            <button
              key={d.id}
              type="button"
              className="card group text-left transition hover:-translate-y-0.5 hover:shadow-md"
              disabled={openDoc.isPending}
              onClick={() => openDoc.mutate(d.id)}
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                  <FileText size={20} />
                </span>
                <div className="min-w-0">
                  <p className="font-bold leading-snug text-slate-800 transition group-hover:text-brand">{d.title}</p>
                  {d.description && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500">{d.description}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                {d.plans?.length
                  ? d.plans.map((p) => (
                      <span key={p} className="badge bg-slate-100 text-slate-600">{planLabel(p)}</span>
                    ))
                  : <span className="badge bg-slate-100 text-slate-600">All members</span>}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex flex-col bg-slate-900/70 p-4" onClick={() => setOpen(null)}>
          <div
            className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 className="min-w-0 truncate font-bold text-slate-800">{open.title}</h2>
              <div className="flex shrink-0 items-center gap-1">
                <a
                  href={open.url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ghost inline-flex items-center gap-1.5 text-xs"
                >
                  <ExternalLink size={14} /> Open
                </a>
                <a
                  href={open.url}
                  download
                  className="btn-ghost inline-flex items-center gap-1.5 text-xs"
                >
                  <Download size={14} /> Download
                </a>
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100"
                  aria-label="Close"
                  onClick={() => setOpen(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <object data={open.url} type="application/pdf" className="min-h-0 flex-1 bg-slate-100">
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-slate-500">
                <FileText size={32} className="text-slate-300" />
                <p>Your browser cannot display this PDF inline.</p>
                <a href={open.url} target="_blank" rel="noreferrer" className="btn-primary">Open in a new tab</a>
              </div>
            </object>
          </div>
        </div>
      )}
    </div>
  );
}
