import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { Column, DataTable, PageHeader, StatCard, StatusBadge, fmtDate } from './_shared';

interface Notification {
  id: string;
  recipient: string;
  title: string;
  body: string;
  kind: string;
  sent: boolean;
  scheduled_for?: string | null;
  created_at: string;
}
interface Banner { id: string; title: string; message?: string | null; audience: string; kind: string; active: boolean }
interface Stats { total: number; sent: number; scheduled: number; read_rate: number; by_kind: Record<string, number> }

const TARGETS = [
  { value: '*', label: 'All users' },
  { value: 'students', label: 'All students' },
  { value: 'teachers', label: 'All teachers' },
  { value: 'partners', label: 'All partners' },
  { value: 'examiners', label: 'All examiners' },
  { value: '__specific__', label: 'Specific student / username' },
];

export function AdminNotifications() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'compose' | 'banners' | 'stats'>('compose');
  const [error, setError] = useState('');
  const [target, setTarget] = useState('*');
  const [specific, setSpecific] = useState('');
  const [form, setForm] = useState({ title: '', body: '', kind: 'info', scheduled_for: '' });
  const [banner, setBanner] = useState({ title: '', message: '', audience: 'public', kind: 'announcement' });

  const history = useQuery({ queryKey: ['admin-notif-history'], queryFn: () => unwrap<{ items: Notification[] }>(api.get('/notifications/admin/history')) });
  const banners = useQuery({ queryKey: ['admin-banners'], queryFn: () => unwrap<Banner[]>(api.get('/notifications/banners')), enabled: tab === 'banners' });
  const stats = useQuery({ queryKey: ['admin-notif-stats'], queryFn: () => unwrap<Stats>(api.get('/notifications/admin/stats')), enabled: tab === 'stats' });

  const send = useMutation({
    mutationFn: () => {
      const recipient = target === '__specific__' ? specific.trim() : target;
      if (!recipient) throw new Error('Recipient is required');
      if (!form.title.trim() || !form.body.trim()) throw new Error('Title and body are required');
      return unwrap(api.post('/notifications/', {
        recipient, title: form.title, body: form.body, kind: form.kind,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
      }));
    },
    onSuccess: () => { setError(''); setForm({ title: '', body: '', kind: 'info', scheduled_for: '' }); qc.invalidateQueries({ queryKey: ['admin-notif-history'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/notifications/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-notif-history'] }),
  });

  const createBanner = useMutation({
    mutationFn: () => {
      if (!banner.title.trim()) throw new Error('Banner title is required');
      return unwrap(api.post('/notifications/banners', banner));
    },
    onSuccess: () => { setError(''); setBanner({ title: '', message: '', audience: 'public', kind: 'announcement' }); qc.invalidateQueries({ queryKey: ['admin-banners'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const deleteBanner = useMutation({
    mutationFn: (id: string) => unwrap(api.delete(`/notifications/banners/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-banners'] }),
  });
  const toggleBanner = useMutation({
    mutationFn: (b: Banner) => unwrap(api.patch(`/notifications/banners/${b.id}`, {
      title: b.title, message: b.message ?? null, audience: b.audience, kind: b.kind, active: !b.active,
    })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-banners'] }),
  });

  const historyColumns: Column<Notification>[] = [
    { key: 'when', header: 'When', sort: (n) => n.scheduled_for || n.created_at, cell: (n) => <span className="text-slate-500">{fmtDate(n.scheduled_for || n.created_at)}</span> },
    { key: 'recipient', header: 'Recipient', sort: (n) => n.recipient, cell: (n) => <span className="font-mono text-xs">{n.recipient}</span> },
    { key: 'title', header: 'Title', sort: (n) => n.title },
    { key: 'kind', header: 'Kind', sort: (n) => n.kind, cell: (n) => <StatusBadge status={n.kind} /> },
    { key: 'sent', header: 'State', sort: (n) => (n.sent ? 1 : 0), cell: (n) => (n.sent ? <span className="badge bg-green-100 text-green-700">Sent</span> : <span className="badge bg-amber-100 text-amber-700">Scheduled</span>) },
    { key: 'actions', header: '', width: '1%', cell: (n) => (!n.sent ? <button className="btn-ghost py-1 text-xs text-red-600" onClick={() => cancel.mutate(n.id)}>Cancel</button> : null) },
  ];

  const bannerColumns: Column<Banner>[] = [
    { key: 'title', header: 'Title', sort: (b) => b.title, cell: (b) => <span className="font-semibold">{b.title}</span> },
    { key: 'audience', header: 'Audience', sort: (b) => b.audience },
    { key: 'kind', header: 'Kind', sort: (b) => b.kind, cell: (b) => <StatusBadge status={b.kind} /> },
    { key: 'active', header: 'Status', sort: (b) => (b.active ? 1 : 0), cell: (b) => <StatusBadge status={b.active ? 'active' : 'inactive'} /> },
    {
      key: 'actions',
      header: '',
      cell: (b) => (
        <div className="flex gap-1">
          <button className="btn-ghost py-1 text-xs" disabled={toggleBanner.isPending} onClick={() => toggleBanner.mutate(b)}>{b.active ? 'Deactivate' : 'Activate'}</button>
          <button className="btn-ghost py-1 text-xs text-red-600" onClick={() => deleteBanner.mutate(b.id)}>Delete</button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Notification Management" description="Announcements, scheduled & targeted notices across dashboards." />
      <div className="mt-4 flex gap-2">
        {(['compose', 'banners', 'stats'] as const).map((t) => (
          <button key={t} className={`btn-ghost py-1 text-xs ${tab === t ? 'bg-slate-100' : ''}`} onClick={() => setTab(t)}>
            {t === 'compose' ? 'Compose & History' : t === 'banners' ? 'Banners' : 'Statistics'}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {tab === 'compose' && (
        <>
          <div className="card mt-4 grid gap-2 sm:grid-cols-2">
            <div>
              <label className="label">Target audience</label>
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                {TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {target === '__specific__' && (
              <div><label className="label">Student ID / username</label><input className="input" value={specific} onChange={(e) => setSpecific(e.target.value)} /></div>
            )}
            <div><label className="label">Title</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div>
              <label className="label">Kind</label>
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {['info', 'success', 'warning', 'promo', 'payment', 'approval', 'exam', 'community'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><label className="label">Body</label><textarea className="input" rows={3} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></div>
            <div><label className="label">Schedule for (optional)</label><input className="input" type="datetime-local" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} /></div>
            <div className="flex items-end"><button className="btn-primary" disabled={send.isPending} onClick={() => send.mutate()}>{form.scheduled_for ? 'Schedule' : 'Send now'}</button></div>
          </div>

          <h2 className="mt-8 text-lg font-bold">History</h2>
          <DataTable
            rows={history.data?.items}
            columns={historyColumns}
            loading={history.isLoading}
            rowKey={(n) => n.id}
            searchText={(n) => `${n.recipient} ${n.title} ${n.kind}`}
            searchPlaceholder="Search notifications"
            initialSort={{ key: 'when', dir: 'desc' }}
            emptyLabel="No notifications."
          />
        </>
      )}

      {tab === 'banners' && (
        <>
          <div className="card mt-4 grid gap-2 sm:grid-cols-2">
            <div><label className="label">Title</label><input className="input" value={banner.title} onChange={(e) => setBanner({ ...banner, title: e.target.value })} /></div>
            <div>
              <label className="label">Audience</label>
              <select className="input" value={banner.audience} onChange={(e) => setBanner({ ...banner, audience: e.target.value })}>
                {['public', 'students', 'teachers', 'partners'].map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><label className="label">Message</label><input className="input" value={banner.message} onChange={(e) => setBanner({ ...banner, message: e.target.value })} /></div>
            <div>
              <label className="label">Kind</label>
              <select className="input" value={banner.kind} onChange={(e) => setBanner({ ...banner, kind: e.target.value })}>
                <option value="announcement">announcement</option>
                <option value="promo">promo</option>
              </select>
            </div>
            <div className="flex items-end"><button className="btn-primary" disabled={createBanner.isPending} onClick={() => createBanner.mutate()}>Create banner</button></div>
          </div>
          <DataTable
            rows={banners.data}
            columns={bannerColumns}
            loading={banners.isLoading}
            rowKey={(b) => b.id}
            searchText={(b) => `${b.title} ${b.audience}`}
            searchPlaceholder="Search banners"
            emptyLabel="No banners."
          />
        </>
      )}

      {tab === 'stats' && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total" value={stats.data?.total ?? '—'} />
          <StatCard label="Sent" value={stats.data?.sent ?? '—'} />
          <StatCard label="Scheduled" value={stats.data?.scheduled ?? '—'} />
          <StatCard label="Read rate" value={stats.data ? `${stats.data.read_rate}%` : '—'} hint="direct notifications" />
        </div>
      )}
    </div>
  );
}
