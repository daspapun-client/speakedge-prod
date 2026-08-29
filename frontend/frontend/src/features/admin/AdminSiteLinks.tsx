import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { PageHeader } from './_shared';

/* Google Business Profile + social media links shown in the public footer.
 * They live in the database so the real URLs can be filled in (or changed)
 * once SpeakEdge is live, with no code change and no deploy. A row left blank
 * is kept as a placeholder but is never rendered on the site. */

interface SiteLink { key: string; label: string; url: string }

export function AdminSiteLinks() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<SiteLink[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const links = useQuery({
    queryKey: ['admin-site-links'],
    queryFn: () => unwrap<{ links: SiteLink[] }>(api.get('/site/admin/links')),
  });

  useEffect(() => { if (links.data) setRows(links.data.links); }, [links.data]);

  const save = useMutation({
    mutationFn: () => unwrap<{ links: SiteLink[] }>(api.put('/site/admin/links', { links: rows })),
    onSuccess: () => {
      setError('');
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['admin-site-links'] });
      qc.invalidateQueries({ queryKey: ['site-links'] });
    },
    onError: (e: Error) => { setSaved(false); setError(e.message); },
  });

  const update = (i: number, patch: Partial<SiteLink>) => {
    setSaved(false);
    setRows((r) => r.map((row, n) => (n === i ? { ...row, ...patch } : row)));
  };
  const remove = (i: number) => { setSaved(false); setRows((r) => r.filter((_, n) => n !== i)); };
  const add = () => { setSaved(false); setRows((r) => [...r, { key: '', label: '', url: '' }]); };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Site Links"
        description="Google Business Profile and social media links for the public footer. Leave a URL blank until you have it — blank links are not shown on the site."
      />

      {links.isLoading ? (
        <div className="card p-6 text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="card p-4 sm:p-6">
          <div className="space-y-3">
            {rows.map((row, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-12 sm:items-end">
                <div className="sm:col-span-3">
                  <label className="label">Name</label>
                  <input
                    className="input"
                    value={row.label}
                    placeholder="Instagram"
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Icon key</label>
                  <input
                    className="input"
                    value={row.key}
                    placeholder="instagram"
                    onChange={(e) => update(i, { key: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-6">
                  <label className="label">URL</label>
                  <input
                    className="input"
                    value={row.url}
                    placeholder="https://…  (leave blank until you have it)"
                    onChange={(e) => update(i, { url: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-1 sm:pb-1">
                  <button
                    type="button"
                    className="btn-ghost text-rose-600"
                    title="Remove this link"
                    onClick={() => remove(i)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-slate-500">No links configured yet.</p>
            )}
          </div>

          <p className="mt-4 text-xs text-slate-500">
            The icon key picks the footer icon — <span className="font-mono">gmb</span>,{' '}
            <span className="font-mono">facebook</span>, <span className="font-mono">instagram</span>,{' '}
            <span className="font-mono">youtube</span>, <span className="font-mono">linkedin</span>,{' '}
            <span className="font-mono">x</span>. Any other key gets a generic globe icon.
          </p>

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          {saved && <p className="mt-3 text-sm text-emerald-600">Links saved.</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={add}>
              <Plus size={16} /> Add a link
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              Save links
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
