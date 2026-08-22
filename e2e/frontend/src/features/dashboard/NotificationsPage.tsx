import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Bell, BellOff, CheckCheck, CreditCard, GraduationCap, Info, Receipt, Users,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notificationHref } from '@/lib/notificationRoutes';
import { PageHeader, badgeClass, fmtDate } from '@/features/admin/_shared';

interface Notif {
  id: string;
  title: string;
  body: string;
  kind: string;
  is_read: boolean;
  created_at: string;
}

const KINDS = ['all', 'membership', 'subscription', 'community', 'batch', 'exam', 'payment', 'info'] as const;
type KindFilter = (typeof KINDS)[number];

const KIND_META: Record<string, { label: string; icon: LucideIcon }> = {
  membership: { label: 'Membership', icon: Users },
  subscription: { label: 'Subscription', icon: CreditCard },
  community: { label: 'Community Classes', icon: Users },
  batch: { label: 'Batch', icon: Users },
  exam: { label: 'Exam', icon: GraduationCap },
  payment: { label: 'Payment', icon: Receipt },
  info: { label: 'Info', icon: Info },
};

function StatTile({ label, value, icon: Icon, hint }: { label: string; value: number | string; icon: LucideIcon; hint?: string }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
          <div className="mt-2 text-2xl font-extrabold text-brand">{value}</div>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        <div className="shrink-0 rounded-xl bg-brand/10 p-2.5 text-brand">
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function NotificationsSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-56 rounded bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
      </div>
      <div className="h-14 rounded-xl bg-slate-200" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-slate-200" />)}
      </div>
    </div>
  );
}

function kindIcon(kind: string): LucideIcon {
  return KIND_META[kind]?.icon ?? Bell;
}

function filterLabel(k: KindFilter, count?: number) {
  if (k === 'all') return count != null ? `All (${count})` : 'All';
  const label = KIND_META[k]?.label ?? k;
  return count != null ? `${label} (${count})` : label;
}

export function NotificationsPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<KindFilter>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => unwrap<Notif[]>(api.get('/notifications/my')),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/notifications/${id}/read`, {})),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const all = data ?? [];
  const stats = useMemo(() => ({
    total: all.length,
    unread: all.filter((n) => !n.is_read).length,
    read: all.filter((n) => n.is_read).length,
  }), [all]);

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of all) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    return counts;
  }, [all]);

  const items = useMemo(
    () => all.filter((n) => filter === 'all' || n.kind === filter),
    [all, filter],
  );

  const visibleKinds = KINDS.filter((k) => k === 'all' || (kindCounts[k] ?? 0) > 0 || filter === k);

  if (isLoading) return <NotificationsSkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Updates on membership, payments, exams, and community activity"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Total" value={stats.total} icon={Bell} hint="Last 100 notifications" />
        <StatTile label="Unread" value={stats.unread} icon={BellOff} hint={stats.unread ? 'Needs your attention' : 'All caught up'} />
        <StatTile label="Read" value={stats.read} icon={CheckCheck} hint="Previously viewed" />
      </div>

      {stats.unread > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-4 text-white sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white/80">Inbox summary</p>
                <h2 className="mt-0.5 text-lg font-extrabold sm:text-xl">
                  {stats.unread} unread notification{stats.unread === 1 ? '' : 's'}
                </h2>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Bell size={22} />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="font-bold text-slate-800">Filter by type</h2>
            <p className="text-xs text-slate-400">Showing {items.length} of {all.length}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {visibleKinds.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition ${
                filter === k
                  ? 'bg-brand text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-brand/30 hover:bg-brand/5'
              }`}
            >
              {filterLabel(k, k === 'all' ? all.length : kindCounts[k])}
            </button>
          ))}
        </div>
      </div>

      {!items.length ? (
        <div className="card py-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
            <BellOff size={32} />
          </div>
          <h2 className="mt-4 text-lg font-bold text-slate-800">
            {filter === 'all' ? 'No notifications yet' : `No ${KIND_META[filter]?.label?.toLowerCase() ?? filter} notifications`}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {filter === 'all'
              ? 'Important updates about your account will appear here.'
              : 'Try another filter to see more messages.'}
          </p>
          {filter !== 'all' && (
            <button type="button" className="btn-ghost mt-4" onClick={() => setFilter('all')}>
              Show all notifications
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((n) => {
            const Icon = kindIcon(n.kind);
            const meta = KIND_META[n.kind];
            return (
              <article
                key={n.id}
                className={`group relative overflow-hidden rounded-xl border bg-white shadow-sm transition hover:border-brand/40 hover:shadow-md ${
                  n.is_read ? 'border-slate-200' : 'border-brand/30 bg-brand/[0.03] ring-1 ring-brand/10'
                }`}
              >
                {!n.is_read && <div className="absolute inset-y-0 left-0 w-1 bg-brand" />}

                <div className="flex items-start justify-between gap-4 p-5 pl-6">
                  <Link
                    to={notificationHref(n, role)}
                    className="flex min-w-0 flex-1 gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
                    onClick={() => {
                      if (!n.is_read) markRead.mutate(n.id);
                    }}
                  >
                    <div className={`mt-0.5 shrink-0 rounded-xl p-2.5 ${n.is_read ? 'bg-slate-100 text-slate-400' : 'bg-brand/10 text-brand'}`}>
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className={`font-semibold group-hover:text-brand ${n.is_read ? 'text-slate-700' : 'text-slate-900'}`}>{n.title}</h3>
                        {!n.is_read && (
                          <span className="inline-flex h-2 w-2 rounded-full bg-brand" aria-label="Unread" />
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-slate-600">{n.body}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className={`badge ${badgeClass(meta?.label ?? n.kind)}`}>
                          {meta?.label ?? n.kind}
                        </span>
                        <span>{fmtDate(n.created_at)}</span>
                      </div>
                    </div>
                  </Link>

                  {!n.is_read && (
                    <button
                      type="button"
                      className="btn-ghost shrink-0 py-1.5 text-xs"
                      disabled={markRead.isPending}
                      onClick={() => markRead.mutate(n.id)}
                    >
                      <CheckCheck size={14} /> Mark read
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
