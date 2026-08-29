import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  UserPlus, Users, MessageCircle, AlertTriangle, Plus, Search,
  Sparkles, Compass, Heart, Loader2, Clock, Pencil, ArrowRight,
  ClipboardCheck, Star, Ban, UserMinus, ChevronDown, Lock, type LucideIcon,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, PageHeader, Paginator } from '@/features/admin/_shared';
import { BannerEditor, CommunityBannerDisplay, bannerFallback } from '@/features/dashboard/CommunityBanner';
import { CommunityMemberLink } from '@/features/dashboard/CommunityMemberLink';
import { TeamMembersModal } from '@/features/dashboard/MemberList';

interface Member {
  student_id: string;
  display_name?: string | null;
  first_name?: string | null;
  photo_url?: string | null;
  gender?: string | null;
}
/** What the member's plan allows for community classes (GET /community/class-access). */
interface ClassAccess {
  allowed: number;
  joined: number;
  included: boolean;
  can_join: boolean;
}
interface Team {
  id: string;
  name: string;
  owner_student_id: string;
  member_ids: string[];
  description?: string | null;
  max_members?: number;
  banner_url?: string | null;
  requested?: boolean;
  class_day?: string | null;
  class_time?: string | null;
}

function fmtTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDay(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

function nextClassDate(classDay: string) {
  const target = WEEKDAYS.indexOf(classDay.toLowerCase() as typeof WEEKDAYS[number]);
  if (target < 0) return null;
  const d = new Date();
  let diff = target - d.getDay();
  if (diff < 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function classScheduleParts(classDay: string) {
  const date = nextClassDate(classDay);
  if (!date) return null;
  return {
    month: date.toLocaleDateString(undefined, { month: 'short' }),
    day: date.getDate(),
    weekdayShort: date.toLocaleDateString(undefined, { weekday: 'short' }),
    full: date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

function GroupScheduleCalendar({ classDay, classTime }: { classDay: string; classTime: string }) {
  const schedule = classScheduleParts(classDay);
  if (!schedule) {
    return <p className="text-sm font-medium text-white/60">Schedule to be announced</p>;
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex w-14 shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-lg ring-1 ring-white/20">
        <div className="bg-brand px-1 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
          {schedule.month}
        </div>
        <div className="px-1 py-2">
          <span className="text-2xl font-bold leading-none text-slate-900">{schedule.day}</span>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{schedule.weekdayShort}</p>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight text-white">{schedule.full}</p>
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-white/85">
          <Clock size={14} className="shrink-0 text-brand-gold" />
          <span className="tabular-nums">{fmtTime(classTime)}</span>
        </p>
        <p className="mt-0.5 text-[11px] font-medium text-white/50">Every {fmtDay(classDay)}</p>
      </div>
    </div>
  );
}

const fmtSessionDate = (d: string) =>
  new Date(`${d}T00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

interface AttendanceHistoryItem {
  id: string;
  team_id: string;
  team_name: string;
  session_date: string;
  attended: boolean;
  rating: number | null;
  responded_at: string | null;
}

interface AttendanceHistory {
  attended_count: number;
  missed_count: number;
  avg_rating: number | null;
  items: AttendanceHistoryItem[];
}

interface FriendReq {
  id: string;
  from_student_id: string;
  to_student_id: string;
  status: string;
  other_student_id: string;
  other_name?: string | null;
  other_photo_url?: string | null;
  other_gender?: string | null;
}
interface FriendCard {
  student_id: string;
  display_name?: string | null;
  first_name?: string | null;
  photo_url?: string | null;
  gender?: string | null;
  unread_count?: number;
  last_message?: string | null;
}
interface JoinReq {
  id: string;
  team_id: string;
  team_name: string;
  requester_student_id: string;
  requester_name: string;
  requester_photo_url?: string | null;
  requester_gender?: string | null;
  status: string;
}

function Section({
  title,
  icon: Icon,
  description,
  count,
  countLabel,
  children,
}: {
  title: string;
  icon: LucideIcon;
  description?: string;
  count?: number;
  countLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-brand/10 p-2 text-brand">
            <Icon size={18} />
          </span>
          <div>
            <h2 className="font-bold text-slate-800">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        {count != null && (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {count} {countLabel ?? (count === 1 ? 'community class' : 'community classes')}
          </span>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function BlockedSection({
  blocked,
  onUnblock,
  pending,
}: {
  blocked: FriendCard[];
  onUnblock: (studentId: string) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-slate-100 p-2 text-slate-500">
            <Ban size={18} />
          </span>
          <div className="text-left">
            <h2 className="font-bold text-slate-800">Blocked members</h2>
            <p className="mt-0.5 text-sm text-slate-500">{blocked.length} blocked — they can't message or friend you</p>
          </div>
        </div>
        <ChevronDown size={18} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
          {blocked.map((b) => {
            const bname = b.display_name || b.first_name || b.student_id;
            return (
              <div key={b.student_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                <div className="flex items-center gap-3">
                  {b.photo_url ? (
                    <img src={b.photo_url} alt="" className="h-9 w-9 rounded-full object-cover grayscale" />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-500">
                      {bname.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="font-medium text-slate-700">{bname}</span>
                </div>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  disabled={pending}
                  onClick={() => onUnblock(b.student_id)}
                >
                  Unblock
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CommunitySkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-8 w-56 rounded bg-slate-200" />
      <div className="h-24 rounded-xl bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-48 rounded-xl bg-slate-200" />)}
      </div>
    </div>
  );
}

const DEFAULT_CAPACITY = 8;
const DISCOVER_PAGE_SIZE = 6;

type DiscoverFilter = 'all' | 'open' | 'pending' | 'full';

function teamStatus(t: Team, subject: string | null): DiscoverFilter | 'member' {
  const joined = t.member_ids.includes(subject ?? '');
  if (joined) return 'member';
  if (t.requested) return 'pending';
  if (t.member_ids.length >= (t.max_members ?? DEFAULT_CAPACITY)) return 'full';
  return 'open';
}

export function CommunityFormModal({
  team,
  onClose,
  onSubmit,
  pending,
}: {
  team?: Team;
  onClose: () => void;
  onSubmit: (fd: FormData) => void;
  pending: boolean;
}) {
  const editing = !!team;
  const minMembers = editing ? team.member_ids.length : 2;
  const [name, setName] = useState(team?.name ?? '');
  const [description, setDescription] = useState(team?.description ?? '');
  const [maxMembers, setMaxMembers] = useState(String(team?.max_members ?? 4));
  const [exporting, setExporting] = useState(false);
  const bannerRef = useRef({
    hasImage: false,
    removed: false,
    dirty: false,
    exportFile: async () => null as File | null,
  });
  const onBannerReady = useCallback((state: typeof bannerRef.current) => {
    bannerRef.current = state;
  }, []);

  const valid =
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    description.length <= 200 &&
    Number(maxMembers) >= minMembers &&
    Number(maxMembers) <= DEFAULT_CAPACITY;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || exporting) return;
    setExporting(true);
    try {
      const fd = new FormData();
      fd.append('name', name.trim());
      fd.append('description', description.trim());
      fd.append('max_members', maxMembers);
      const b = bannerRef.current;
      if (b.removed) fd.append('remove_banner', 'true');
      else if (b.dirty) {
        const file = await b.exportFile();
        if (file) fd.append('banner', file);
      }
      onSubmit(fd);
    } finally {
      setExporting(false);
    }
  };

  const busy = pending || exporting;

  return (
    <Modal onClose={onClose} wide>
      <h3 className="text-lg font-bold text-slate-800">{editing ? 'Edit community class' : 'Create a community class'}</h3>
      <p className="mt-1 text-sm text-slate-500">
        {editing ? 'Update your group details — visible to all members.' : 'Set up your speaking group — other learners can request to join.'}
      </p>
      <form className="mt-5 space-y-4" onSubmit={submit}>
        <BannerEditor
          initialSrc={team?.banner_url}
          fallbackClass={bannerFallback(team?.id ?? 'new')}
          name={name}
          onReadyChange={onBannerReady}
        />
        <div>
          <label className="label">Community class name</label>
          <input
            className="input"
            placeholder="e.g. Morning English Club"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
          />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            className="input"
            rows={3}
            placeholder="What will you practice together?"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 200))}
            maxLength={200}
          />
          <p className="mt-1 text-right text-xs text-slate-400">{description.length}/200</p>
        </div>
        <div>
          <label className="label">Number of members</label>
          <input
            className="input"
            type="number"
            min={minMembers}
            max={DEFAULT_CAPACITY}
            value={maxMembers}
            onChange={(e) => setMaxMembers(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-400">
            Maximum group size ({minMembers}–{DEFAULT_CAPACITY}{editing ? ', cannot go below current members' : ', including you'})
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-gold inline-flex items-center gap-1" disabled={!valid || busy}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : editing ? <Pencil size={16} /> : <Plus size={16} />}
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GroupCard({
  team: t,
  subject,
  joining,
  access,
  onJoin,
  onViewMembers,
}: {
  team: Team;
  subject: string | null;
  joining: boolean;
  access?: ClassAccess;
  onJoin: () => void;
  onViewMembers: () => void;
}) {
  const joined = t.member_ids.includes(subject ?? '');
  const pending = !!t.requested && !joined;
  const memberCount = t.member_ids.length;
  const capacity = t.max_members ?? DEFAULT_CAPACITY;
  const full = memberCount >= capacity;
  const fillPct = Math.min(100, Math.round((memberCount / Math.max(capacity, 1)) * 100));
  const barColor = full ? 'bg-slate-400' : joined ? 'bg-emerald-500' : 'bg-brand';

  const isOwner = joined && t.owner_student_id === subject;
  const status = joined
    ? isOwner
      ? { label: 'Owner', cls: 'bg-brand-gold/95 text-white' }
      : { label: 'Member', cls: 'bg-emerald-500/90 text-white' }
    : pending
      ? { label: 'Pending', cls: 'bg-amber-400/90 text-white' }
      : access && !access.included
        ? { label: 'Upgrade', cls: 'bg-brand-gold/95 text-white' }
        : full
          ? { label: 'Full', cls: 'bg-slate-500/80 text-white' }
          : { label: 'Open', cls: 'bg-white/90 text-brand backdrop-blur-sm' };

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 transition duration-300 hover:-translate-y-0.5 hover:shadow-md ${
        joined ? 'ring-emerald-200/80' : pending ? 'ring-amber-200/80' : 'ring-slate-200/80 hover:ring-brand/30'
      }`}
    >
      <div className="relative">
        <CommunityBannerDisplay
          src={t.banner_url}
          fallbackClass={bannerFallback(t.id)}
          bare
        />
        <span className={`absolute right-3 top-3 rounded-md px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${status.cls}`}>
          {status.label}
        </span>
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-transparent px-4 pb-4 pt-10">
          {t.class_day && t.class_time ? (
            <GroupScheduleCalendar classDay={t.class_day} classTime={t.class_time} />
          ) : (
            <p className="text-sm font-medium text-white/60">Schedule to be announced</p>
          )}
          <div className="mt-2.5 border-t border-white/[0.08] pt-2">
            <h3 className="truncate text-xs font-normal text-white/45">{t.name}</h3>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 pb-4 pt-3.5">
        {t.description && (
          <p className="line-clamp-1 text-sm leading-snug text-slate-600">{t.description}</p>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <Users size={12} className="text-brand/70" />
              {memberCount}/{capacity} members
            </span>
            {joined ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Active
              </span>
            ) : full ? (
              <span className="text-[11px] font-medium text-slate-400">Full</span>
            ) : (
              <span className="text-[11px] font-medium text-brand">{capacity - memberCount} spots left</span>
            )}
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={memberCount}
            aria-valuemin={0}
            aria-valuemax={capacity}
            aria-label={`${memberCount} of ${capacity} members`}
          >
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${fillPct}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
            onClick={onViewMembers}
          >
            <Users size={15} className="text-slate-400" />
            Members
          </button>
          {joined ? (
            <Link
              to={`/dashboard/community/${t.id}`}
              className="group/btn inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-light hover:shadow-md"
            >
              Enter
              <ArrowRight size={15} className="transition group-hover/btn:translate-x-0.5" />
            </Link>
          ) : pending ? (
            <div className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/60">
              <Clock size={14} className="shrink-0" />
              Pending
            </div>
          ) : access && !access.included ? (
            // The class stays visible on every tier — Tribe includes none, so
            // joining asks for an upgrade instead of failing on the server.
            <Link
              to="/plans"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand-gold px-3 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:brightness-105"
            >
              <Lock size={14} className="shrink-0" />
              Upgrade to join
            </Link>
          ) : full ? (
            <div className="inline-flex items-center justify-center rounded-xl bg-slate-100/80 px-3 py-2.5 text-xs font-medium text-slate-400 ring-1 ring-slate-200/60">
              Full
            </div>
          ) : (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-light hover:shadow-md disabled:opacity-60"
              disabled={joining}
              onClick={onJoin}
            >
              {joining ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  Join
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function CommunityPage() {
  const qc = useQueryClient();
  const { subject } = useAuth();
  const [membersModal, setMembersModal] = useState<{ id: string; name: string } | null>(null);
  const [dialog, setDialog] = useState<{ title: string; body: string; ok?: boolean } | null>(null);
  const [discoverSearch, setDiscoverSearch] = useState('');
  const [discoverFilter, setDiscoverFilter] = useState<DiscoverFilter>('all');
  const [discoverPage, setDiscoverPage] = useState(1);

  const loadingDir = useQuery({
    queryKey: ['community-directory'],
    queryFn: () => unwrap<{ items: Member[]; total: number }>(api.get('/community/directory')),
  });
  const loadingTeams = useQuery({ queryKey: ['teams'], queryFn: () => unwrap<Team[]>(api.get('/community/teams')) });
  const loadingAccess = useQuery({
    queryKey: ['class-access'],
    queryFn: () => unwrap<ClassAccess>(api.get('/community/class-access')),
  });
  const loadingFriends = useQuery({
    queryKey: ['friend-requests'],
    queryFn: () => unwrap<{ incoming: FriendReq[]; outgoing: FriendReq[] }>(api.get('/community/friend-requests')),
  });
  const loadingFriendsList = useQuery({
    queryKey: ['friends'],
    queryFn: () => unwrap<FriendCard[]>(api.get('/community/friends')),
  });
  const loadingBlocked = useQuery({
    queryKey: ['blocked'],
    queryFn: () => unwrap<FriendCard[]>(api.get('/community/blocked')),
  });
  const loadingJoinReqs = useQuery({
    queryKey: ['team-join-requests'],
    queryFn: () => unwrap<JoinReq[]>(api.get('/community/teams/join-requests')),
  });
  const attendanceHistory = useQuery({
    queryKey: ['attendance-history'],
    queryFn: () => unwrap<AttendanceHistory>(api.get('/community/attendance/history')),
  });

  const dir = loadingDir.data;
  const teams = loadingTeams.data;
  const access = loadingAccess.data;
  const friends = loadingFriends.data;
  const friendsList = loadingFriendsList.data;
  const blocked = loadingBlocked.data;
  const joinReqs = loadingJoinReqs.data;
  const isLoading = loadingDir.isLoading || loadingTeams.isLoading || loadingFriends.isLoading;

  const invalidate = (k: string) => qc.invalidateQueries({ queryKey: [k] });
  const refreshFriends = () => {
    invalidate('friend-requests');
    invalidate('friends');
    invalidate('blocked');
  };

  const respondFriend = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => unwrap(api.post(`/community/friend-request/${id}/${action}`, {})),
    onSuccess: refreshFriends,
  });
  const unfriend = useMutation({
    mutationFn: (studentId: string) => unwrap(api.post(`/community/friends/${studentId}/unfriend`, {})),
    onSuccess: refreshFriends,
  });
  const blockMember = useMutation({
    mutationFn: (studentId: string) => unwrap(api.post('/community/block', { student_id: studentId })),
    onSuccess: refreshFriends,
  });
  const unblockMember = useMutation({
    mutationFn: (studentId: string) => unwrap(api.post('/community/unblock', { student_id: studentId })),
    onSuccess: refreshFriends,
  });
  const respondJoin = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'decline' }) =>
      unwrap(api.post(`/community/teams/join-requests/${id}/${action}`, {})),
    onSuccess: () => { invalidate('team-join-requests'); invalidate('teams'); },
    onError: (e: Error) => setDialog({ title: "Can't do that", body: e.message }),
  });
  const joinLeave = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'join' | 'leave' }) => unwrap(api.post(`/community/teams/${id}/${action}`, {})),
    onSuccess: (_d, v) => {
      invalidate('teams');
      invalidate('class-access');
      if (v.action === 'join') {
        setDialog({
          title: 'Request sent',
          body: "Waiting for the community class owner's approval. You'll be notified.",
          ok: true,
        });
      }
    },
    onError: (e: Error) => setDialog({ title: "Can't do that", body: e.message }),
  });

  const mine = useMemo(
    () => (teams ?? []).filter((t) => t.member_ids.includes(subject ?? '')),
    [teams, subject],
  );
  const discover = useMemo(
    () => (teams ?? []).filter((t) => !t.member_ids.includes(subject ?? '')),
    [teams, subject],
  );
  const memberName = (id: string) => {
    const m = dir?.items.find((x) => x.student_id === id);
    return m?.display_name || m?.first_name || id;
  };
  const memberOf = (id: string) => dir?.items.find((x) => x.student_id === id);

  const discoverFiltered = useMemo(() => {
    const q = discoverSearch.trim().toLowerCase();
    return discover.filter((t) => {
      const status = teamStatus(t, subject);
      if (discoverFilter !== 'all' && status !== discoverFilter) return false;
      if (!q) return true;
      const owner = memberName(t.owner_student_id).toLowerCase();
      return (
        t.name.toLowerCase().includes(q)
        || (t.description ?? '').toLowerCase().includes(q)
        || owner.includes(q)
      );
    });
  }, [discover, discoverSearch, discoverFilter, subject, dir]);

  const discoverPages = Math.max(1, Math.ceil(discoverFiltered.length / DISCOVER_PAGE_SIZE));
  const safeDiscoverPage = Math.min(discoverPage, discoverPages);
  const discoverPageItems = discoverFiltered.slice(
    (safeDiscoverPage - 1) * DISCOVER_PAGE_SIZE,
    safeDiscoverPage * DISCOVER_PAGE_SIZE,
  );

  const pendingFriends = useMemo(
    () => friends?.incoming.filter((f) => f.status === 'pending') ?? [],
    [friends],
  );
  const pendingJoins = useMemo(
    () => (joinReqs ?? []).filter((r) => r.status === 'pending'),
    [joinReqs],
  );
  if (isLoading) return <CommunitySkeleton />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Community Classes"
        description="Join speaking groups, chat with learners, and connect with friends"
      />

      <div className="card overflow-hidden p-0">
        <div className="bg-gradient-to-r from-brand to-brand-light px-6 py-5 text-white sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90">
                <Sparkles size={14} /> Speaking community
              </p>
              <h2 className="mt-1 text-xl font-extrabold sm:text-2xl">Practice English together</h2>
              <p className="mt-1 text-sm text-white/80">Create a group or join an existing community class to start chatting</p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <MessageCircle size={28} />
            </div>
          </div>
        </div>
      </div>

      {!!pendingJoins.length && (
        <Section
          title="Community class join requests"
          icon={UserPlus}
          description="Learners waiting to join community classes you own — approve or decline"
          count={pendingJoins.length}
        >
          <div className="space-y-2">
            {pendingJoins.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3">
                <CommunityMemberLink
                  studentId={r.requester_student_id}
                  name={r.requester_name}
                  photoUrl={r.requester_photo_url}
                  gender={r.requester_gender}
                  subtitle={
                    <>
                      wants to join <span className="font-medium text-slate-500">{r.team_name}</span>
                    </>
                  }
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={respondJoin.isPending}
                    onClick={() => respondJoin.mutate({ id: r.id, action: 'approve' })}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    disabled={respondJoin.isPending}
                    onClick={() => respondJoin.mutate({ id: r.id, action: 'decline' })}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!!pendingFriends.length && (
        <Section title="Friend requests" icon={Heart} description="Accept or decline incoming requests" count={pendingFriends.length} countLabel={pendingFriends.length === 1 ? 'request' : 'requests'}>
          <div className="space-y-2">
            {pendingFriends.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                <CommunityMemberLink
                  studentId={f.other_student_id}
                  name={f.other_name || memberName(f.other_student_id)}
                  photoUrl={f.other_photo_url ?? memberOf(f.other_student_id)?.photo_url}
                  gender={f.other_gender ?? memberOf(f.other_student_id)?.gender}
                  subtitle="wants to be your friend"
                />
                <div className="flex gap-2">
                  <button type="button" className="btn-primary text-xs" disabled={respondFriend.isPending} onClick={() => respondFriend.mutate({ id: f.id, action: 'accepted' })}>
                    Accept
                  </button>
                  <button type="button" className="btn-ghost text-xs" disabled={respondFriend.isPending} onClick={() => respondFriend.mutate({ id: f.id, action: 'declined' })}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Friends"
        icon={Users}
        description="Chat one-on-one with learners you've connected with"
        count={friendsList?.length ?? 0}
        countLabel={friendsList?.length === 1 ? 'friend' : 'friends'}
      >
        {friendsList?.length ? (
          <div className="space-y-2">
            {friendsList.map((f) => {
              const fname = f.display_name || f.first_name || f.student_id;
              return (
                <div key={f.student_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3">
                  <CommunityMemberLink
                    studentId={f.student_id}
                    name={fname}
                    photoUrl={f.photo_url}
                    gender={f.gender}
                    subtitle={f.last_message ? (f.last_message.length > 48 ? `${f.last_message.slice(0, 48)}…` : f.last_message) : 'Say hello!'}
                  />
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/dashboard/community/chat/${f.student_id}`}
                      className="relative inline-flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-light"
                    >
                      <MessageCircle size={14} /> Message
                      {!!f.unread_count && (
                        <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                          {f.unread_count}
                        </span>
                      )}
                    </Link>
                    <button
                      type="button"
                      title="Remove friend"
                      className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                      disabled={unfriend.isPending}
                      onClick={() => { if (window.confirm(`Remove ${fname} from your friends?`)) unfriend.mutate(f.student_id); }}
                    >
                      <UserMinus size={15} />
                    </button>
                    <button
                      type="button"
                      title="Block"
                      className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      disabled={blockMember.isPending}
                      onClick={() => { if (window.confirm(`Block ${fname}? They won't be able to message or friend you.`)) blockMember.mutate(f.student_id); }}
                    >
                      <Ban size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Users size={32} className="text-slate-300" />
            <p className="text-sm text-slate-500">No friends yet — send a request from a member's profile to connect.</p>
          </div>
        )}
      </Section>

      {!!blocked?.length && (
        <BlockedSection blocked={blocked} onUnblock={(id) => unblockMember.mutate(id)} pending={unblockMember.isPending} />
      )}

      <Section title="Your community classes" icon={Users} description="Groups you've joined — open chat to participate" count={mine.length}>
        {mine.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mine.map((t) => (
              <GroupCard
                key={t.id}
                team={t}
                subject={subject}
                joining={joinLeave.isPending}
                access={access}
                onJoin={() => joinLeave.mutate({ id: t.id, action: 'join' })}
                onViewMembers={() => setMembersModal({ id: t.id, name: t.name })}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Users size={22} />
            </div>
            <p className="mt-3 font-semibold text-slate-700">No community classes yet</p>
            <p className="mt-1 text-sm text-slate-500">
              {access && !access.included
                ? 'Community classes are not included in your membership — upgrade to join one.'
                : 'Discover and join a group below to start practicing.'}
            </p>
          </div>
        )}
      </Section>

      <Section title="Discover community classes" icon={Compass} description="Browse open groups and request to join — owners approve new members" count={discoverFiltered.length}>
        {access && !access.included && (
          // Every tier can browse the classes; the entry tier does not include
          // a seat in one, so say so here instead of only on a failed join.
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-gold/30 bg-brand-gold/5 px-4 py-3">
            <p className="text-sm text-slate-700">
              <span className="font-semibold">Community classes are not included in your membership.</span>{' '}
              You can browse them here — upgrade your membership to join one.
            </p>
            <Link to="/plans" className="btn-gold inline-flex shrink-0 items-center gap-1.5 text-sm">
              <Lock size={14} />
              Upgrade membership
            </Link>
          </div>
        )}
        {discover.length ? (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[14rem] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="input pl-9"
                  placeholder="Search by name, description, or owner…"
                  value={discoverSearch}
                  onChange={(e) => {
                    setDiscoverSearch(e.target.value);
                    setDiscoverPage(1);
                  }}
                />
              </div>
              <select
                className="input w-auto min-w-[9rem]"
                value={discoverFilter}
                onChange={(e) => {
                  setDiscoverFilter(e.target.value as DiscoverFilter);
                  setDiscoverPage(1);
                }}
                aria-label="Filter community classes"
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="full">Full</option>
              </select>
            </div>
            {discoverFiltered.length ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {discoverPageItems.map((t) => (
                    <GroupCard
                      key={t.id}
                      team={t}
                      subject={subject}
                      joining={joinLeave.isPending}
                      access={access}
                      onJoin={() => joinLeave.mutate({ id: t.id, action: 'join' })}
                      onViewMembers={() => setMembersModal({ id: t.id, name: t.name })}
                    />
                  ))}
                </div>
                <Paginator
                  page={safeDiscoverPage}
                  pageSize={DISCOVER_PAGE_SIZE}
                  total={discoverFiltered.length}
                  onPage={setDiscoverPage}
                />
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
                <p className="font-semibold text-slate-700">No matching community classes</p>
                <p className="mt-1 text-sm text-slate-500">Try a different search or filter.</p>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand/10 text-brand">
              <Compass size={32} />
            </div>
            <h3 className="mt-4 text-lg font-bold text-slate-800">No community classes to discover</h3>
            <p className="mt-2 text-sm text-slate-500">Be the first — create a group above and invite fellow learners.</p>
          </div>
        )}
      </Section>

      <Section
        title="Class attendance & feedback"
        icon={ClipboardCheck}
        description="Sessions you confirmed and reported on after class (24h post-class check-in)"
        count={attendanceHistory.data?.items.length}
        countLabel={attendanceHistory.data?.items.length === 1 ? 'record' : 'records'}
      >
        {attendanceHistory.isLoading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : !attendanceHistory.data?.items.length ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-8 text-center">
            <p className="font-semibold text-slate-700">No submitted attendance yet</p>
            <p className="mt-1 text-sm text-slate-500">
              After each class, you'll be asked whether you attended and to rate the session.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-emerald-700/80">Attended</p>
                <p className="mt-1 text-2xl font-bold text-emerald-800">{attendanceHistory.data.attended_count}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Missed</p>
                <p className="mt-1 text-2xl font-bold text-slate-800">{attendanceHistory.data.missed_count}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700/80">Avg rating</p>
                <p className="mt-1 flex items-center gap-1 text-2xl font-bold text-amber-900">
                  {attendanceHistory.data.avg_rating != null ? (
                    <>
                      {attendanceHistory.data.avg_rating}
                      <Star size={18} className="fill-brand-gold text-brand-gold" />
                    </>
                  ) : (
                    '—'
                  )}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200/80">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">Session</th>
                    <th className="px-4 py-2.5 font-semibold">Community class</th>
                    <th className="px-4 py-2.5 font-semibold">Attendance</th>
                    <th className="px-4 py-2.5 font-semibold">Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceHistory.data.items.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-slate-600">{fmtSessionDate(row.session_date)}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{row.team_name}</td>
                      <td className="px-4 py-3">
                        {row.attended ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                            Attended
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                            Missed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.attended && row.rating ? (
                          <span className="inline-flex items-center gap-0.5">
                            {row.rating}
                            <Star size={14} className="fill-brand-gold text-brand-gold" />
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      {membersModal && (
        <TeamMembersModal
          teamId={membersModal.id}
          teamName={membersModal.name}
          onClose={() => setMembersModal(null)}
        />
      )}

      {dialog && (
        <Modal onClose={() => setDialog(null)}>
          <div className="flex items-start gap-3">
            <AlertTriangle className={`mt-0.5 shrink-0 ${dialog.ok ? 'text-green-500' : 'text-amber-500'}`} size={22} />
            <div>
              <h3 className="font-bold">{dialog.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{dialog.body}</p>
            </div>
          </div>
          <div className="mt-5 flex justify-end">
            <button type="button" className="btn-primary" onClick={() => setDialog(null)}>Got it</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
