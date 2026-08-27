import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  BookOpen,
  CheckCheck,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Flag,
  GraduationCap,
  Handshake,
  Info,
  Megaphone,
  MessageCircle,
  Receipt,
  ShieldCheck,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '@/lib/api';
import { useAuth, type Role } from '@/lib/auth';

function notificationsPageFor(role: Role | null): string {
  if (role === 'admin' || role === 'super_admin') return '/admin/notifications';
  return '/dashboard/notifications';
}
import { relTime } from '@/lib/datetime';
import { notificationHref } from '@/lib/notificationRoutes';

interface Notif {
  id: string;
  title: string;
  body: string;
  kind: string;
  is_read: boolean;
  created_at: string;
}

const KIND_META: Record<string, { icon: LucideIcon; tone: string; label: string }> = {
  membership: { icon: Users, tone: 'bg-violet-100 text-violet-600', label: 'Membership' },
  subscription: { icon: CreditCard, tone: 'bg-amber-100 text-amber-700', label: 'Subscription' },
  community: { icon: Users, tone: 'bg-teal-100 text-teal-600', label: 'Community Classes' },
  batch: { icon: MessageCircle, tone: 'bg-indigo-100 text-indigo-600', label: 'Batch' },
  exam: { icon: GraduationCap, tone: 'bg-sky-100 text-sky-600', label: 'Exam' },
  payment: { icon: Receipt, tone: 'bg-emerald-100 text-emerald-600', label: 'Payment' },
  info: { icon: Info, tone: 'bg-slate-100 text-slate-600', label: 'Info' },
  success: { icon: CheckCheck, tone: 'bg-emerald-100 text-emerald-600', label: 'Success' },
  warning: { icon: Info, tone: 'bg-orange-100 text-orange-600', label: 'Warning' },
  promo: { icon: Bell, tone: 'bg-brand/10 text-brand', label: 'Promo' },
  approval: { icon: CheckCheck, tone: 'bg-violet-100 text-violet-600', label: 'Approval' },
  verification: { icon: ShieldCheck, tone: 'bg-violet-100 text-violet-600', label: 'Verification' },
  refund: { icon: Receipt, tone: 'bg-orange-100 text-orange-600', label: 'Refund' },
  teacher: { icon: GraduationCap, tone: 'bg-sky-100 text-sky-600', label: 'Teacher' },
  partner: { icon: Handshake, tone: 'bg-indigo-100 text-indigo-600', label: 'Partner' },
  partner_report: { icon: Receipt, tone: 'bg-indigo-50 text-indigo-500', label: 'Partner report' },
  community_report: { icon: Flag, tone: 'bg-rose-100 text-rose-600', label: 'Report' },
  team_join: { icon: UsersRound, tone: 'bg-teal-100 text-teal-600', label: 'Team join' },
  attendance: { icon: ClipboardCheck, tone: 'bg-cyan-100 text-cyan-600', label: 'Attendance' },
  remuneration: { icon: Wallet, tone: 'bg-emerald-100 text-emerald-600', label: 'Remuneration' },
  book_order: { icon: BookOpen, tone: 'bg-fuchsia-100 text-fuchsia-600', label: 'Book order' },
  lead: { icon: Megaphone, tone: 'bg-brand/10 text-brand', label: 'Lead' },
};

const INBOX_LIMIT = 15;
const SEEN_CAP = 200;

interface ActionItem {
  id: string;
  kind: string;
  title: string;
  summary: string;
  href: string;
  created_at?: string | null;
}

interface InboxRow {
  id: string;
  source: 'notification' | 'action';
  kind: string;
  title: string;
  body: string;
  created_at: string;
  href: string;
}

function seenStorageKey(subject: string) {
  return `speakedge:admin-inbox-seen:${subject}`;
}

function loadSeenIds(subject: string): Set<string> {
  try {
    const raw = localStorage.getItem(seenStorageKey(subject));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeenIds(subject: string, ids: Set<string>) {
  const trimmed = [...ids].slice(-SEEN_CAP);
  localStorage.setItem(seenStorageKey(subject), JSON.stringify(trimmed));
}

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { icon: Bell, tone: 'bg-slate-100 text-slate-500', label: kind };
}

function InboxSkeleton() {
  return (
    <ul className="space-y-1 p-2">
      {[1, 2, 3, 4].map((i) => (
        <li key={i} className="flex animate-pulse gap-3 rounded-xl px-3 py-3">
          <div className="h-10 w-10 shrink-0 rounded-xl bg-slate-100" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <div className="h-3 w-2/3 rounded bg-slate-100" />
            <div className="h-2.5 w-full rounded bg-slate-50" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function NotificationInbox({ compact = false }: { compact?: boolean }) {
  const { role, subject } = useAuth();
  const isAdmin = role === 'admin' || role === 'super_admin';
  const adminKey = subject ?? 'admin';
  const notificationsPath = notificationsPageFor(role);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => loadSeenIds(adminKey));
  const rootRef = useRef<HTMLDivElement>(null);

  const { data, isLoading: notifLoading } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => unwrap<Notif[]>(api.get('/notifications/my')),
    refetchInterval: 60_000,
  });

  const { data: actionData, isLoading: actionLoading } = useQuery({
    queryKey: ['admin-action-inbox'],
    queryFn: () => unwrap<{ items: ActionItem[] }>(api.get('/admin/action-inbox')),
    refetchInterval: 60_000,
    enabled: isAdmin,
  });

  useEffect(() => {
    setSeenIds(loadSeenIds(adminKey));
  }, [adminKey]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const markAll = useMutation({
    mutationFn: () => unwrap(api.post('/notifications/read-all', {})),
    onSuccess: invalidate,
  });
  const markOne = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/notifications/${id}/read`, {})),
    onSuccess: invalidate,
  });

  const markSeen = (ids: string[]) =>
    setSeenIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      saveSeenIds(adminKey, next);
      return next;
    });

  const unreadNotifs = useMemo(() => (data ?? []).filter((n) => !n.is_read), [data]);
  const unseenActions = useMemo(
    () => (actionData?.items ?? []).filter((i) => !seenIds.has(i.id)),
    [actionData, seenIds],
  );

  const items = useMemo(() => {
    const rows: InboxRow[] = [
      ...unreadNotifs.map((n) => ({
        id: n.id,
        source: 'notification' as const,
        kind: n.kind,
        title: n.title,
        body: n.body,
        created_at: n.created_at,
        href: notificationHref(n, role),
      })),
      ...unseenActions.map((a) => ({
        id: a.id,
        source: 'action' as const,
        kind: a.kind,
        title: a.title,
        body: a.summary,
        created_at: a.created_at ?? '',
        href: a.href,
      })),
    ];
    return rows
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, INBOX_LIMIT);
  }, [unreadNotifs, unseenActions, role]);

  const unreadCount = unreadNotifs.length + unseenActions.length;
  const isLoading = notifLoading || (isAdmin && actionLoading);
  const badge = unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null;

  const markAllRead = () => {
    if (unreadNotifs.length > 0) markAll.mutate();
    if (unseenActions.length > 0) markSeen(unseenActions.map((i) => i.id));
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={
          compact
            ? 'mobile-topbar-icon-btn'
            : `relative rounded-xl p-2.5 transition-all ${
                open
                  ? 'bg-brand/10 text-brand ring-2 ring-brand/20'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              }`
        }
        data-open={compact ? open : undefined}
        aria-label={badge ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={compact ? 19 : 18} strokeWidth={open ? 2.25 : 2} />
        {badge && (
          <span
            className={
              compact
                ? 'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-600 px-0.5 text-[9px] font-bold text-white shadow-sm ring-2 ring-white'
                : 'absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gradient-to-br from-red-500 to-rose-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white'
            }
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xl shadow-slate-200/50 ring-1 ring-black/5">
          <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-brand to-brand-light px-3 py-2 text-white">
            <div className="flex min-w-0 items-center gap-2">
              <Bell size={14} className="shrink-0 opacity-80" />
              <span className="truncate text-sm font-semibold">
                Notifications
                {unreadCount > 0 && (
                  <span className="ml-1.5 font-normal text-white/80">({unreadCount})</span>
                )}
              </span>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={markAll.isPending}
                className="flex shrink-0 items-center gap-1 rounded-md bg-white/15 px-2 py-1 text-[10px] font-semibold transition hover:bg-white/25 disabled:opacity-60"
              >
                <CheckCheck size={11} /> Mark read
              </button>
            )}
          </div>

          <div className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain">
            {isLoading ? (
              <InboxSkeleton />
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand/10 text-brand ring-1 ring-brand/20">
                  <BellOff size={26} strokeWidth={2.25} />
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-800">You&apos;re all caught up</p>
                <p className="mt-1 max-w-[14rem] text-xs leading-relaxed text-slate-500">
                  New notifications will appear here. See past ones on the notifications page.
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5 p-2">
                {items.map((item) => {
                  const meta = kindMeta(item.kind);
                  const Icon = meta.icon;
                  return (
                    <li key={`${item.source}-${item.id}`}>
                      <Link
                        to={item.href}
                        className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition hover:bg-slate-50 active:bg-slate-100"
                        onClick={() => {
                          if (item.source === 'notification') markOne.mutate(item.id);
                          else markSeen([item.id]);
                          setOpen(false);
                        }}
                      >
                        <div className="relative shrink-0">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-xl ${meta.tone} transition group-hover:scale-105`}
                          >
                            <Icon size={17} strokeWidth={2} />
                          </div>
                          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-white" />
                        </div>
                        <div className="min-w-0 flex-1 pt-0.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold leading-snug text-slate-800 group-hover:text-brand">
                              {item.title}
                            </p>
                            <span className="shrink-0 text-[10px] font-medium tabular-nums text-slate-400">
                              {relTime(item.created_at)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.body}</p>
                          <span className="mt-1 inline-block text-[10px] font-medium uppercase tracking-wide text-slate-400">
                            {meta.label}
                          </span>
                        </div>
                        <ChevronRight
                          size={14}
                          className="mt-2.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {items.length > 0 && (
            <div className="border-t border-slate-100 bg-slate-50/80 px-4 py-2.5">
              <Link
                to={notificationsPath}
                className="flex items-center justify-center gap-1 text-xs font-semibold text-brand hover:underline"
                onClick={() => setOpen(false)}
              >
                View all notifications
                <ChevronRight size={12} />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
