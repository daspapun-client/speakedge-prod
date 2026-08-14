import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Search, UserPlus, Clock, MessageCircle, Users, Loader2, Ban, UserMinus,
  Check, X, Heart, AlertTriangle,
} from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, Paginator, StudentAvatar } from '@/features/admin/_shared';

interface Profile {
  student_id: string;
  display_name?: string | null;
  first_name?: string | null;
  age?: number | null;
  gender?: string | null;
  photo_url?: string | null;
  cefr_level?: string | null;
  cefr_status?: string | null;
  bio?: string | null;
  interests?: string[];
  looking_for_partner?: boolean;
}
interface FriendCard {
  student_id: string;
  display_name?: string | null;
  first_name?: string | null;
  photo_url?: string | null;
  gender?: string | null;
  age?: number | null;
  cefr_level?: string | null;
  cefr_status?: string | null;
  bio?: string | null;
  looking_for_partner?: boolean;
  unread_count?: number;
  last_message?: string | null;
  last_message_at?: string | null;
}
interface FriendReq {
  id: string;
  other_student_id: string;
  other_name?: string | null;
  other_photo_url?: string | null;
  other_gender?: string | null;
  status: string;
}

/** Tab order is fixed: Members (default) | My Friends | Friend Requests. */
type Tab = 'members' | 'friends' | 'requests';

const PAGE_SIZE = 12;

function nameOf(p: { display_name?: string | null; first_name?: string | null; student_id: string }) {
  return p.display_name || p.first_name || p.student_id;
}

function fbBtnPrimary(extra = '') {
  return `inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-light disabled:opacity-60 ${extra}`;
}

function fbBtnSecondary(extra = '') {
  return `inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-300 disabled:opacity-60 ${extra}`;
}

function profileMeta(p: Profile) {
  return [
    p.cefr_level ? `CEFR ${p.cefr_level}` : 'CEFR —',
    p.gender,
    p.age != null ? `${p.age} yrs` : null,
  ].filter(Boolean).join(' · ');
}

function fmtMsgTime(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className="w-full rounded-full border-0 bg-slate-100 py-2.5 pl-11 pr-4 text-[15px] outline-none ring-0 transition placeholder:text-slate-400 focus:bg-white focus:shadow-[0_0_0_2px_rgba(47,128,237,0.25)]"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function PageTabs({
  tab,
  onTab,
  friendsCount,
  pendingCount,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  friendsCount: number;
  pendingCount: number;
}) {
  const items: { id: Tab; label: string; icon: typeof Heart; badge?: number }[] = [
    { id: 'members', label: 'Members', icon: Users },
    { id: 'friends', label: 'My Friends', icon: Heart, badge: friendsCount || undefined },
    { id: 'requests', label: 'Friend Requests', icon: UserPlus, badge: pendingCount || undefined },
  ];

  return (
    <div className="overflow-x-auto border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl gap-1 px-2 md:px-4">
        {items.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-[3px] px-3 py-3 text-[15px] font-semibold transition md:px-4 ${
                tab === t.id
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <Icon size={16} />
              {t.label}
              {!!t.badge && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  t.id === 'requests' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, hint, action }: {
  icon: typeof Heart;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100">
        <Icon size={28} className="text-slate-400" />
      </div>
      <div>
        <p className="font-bold text-slate-900">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{hint}</p>
      </div>
      {action}
    </div>
  );
}

export function ExploreProfilesPage() {
  const qc = useQueryClient();
  const { subject } = useAuth();
  const [tab, setTab] = useState<Tab>('members');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const directory = useQuery({
    queryKey: ['explore-directory', debounced, page],
    queryFn: () => unwrap<{ items: Profile[]; total: number; page: number; page_size: number }>(
      api.get('/community/directory', { params: { q: debounced || undefined, page, page_size: PAGE_SIZE } }),
    ),
  });
  const friendsQ = useQuery({ queryKey: ['friends'], queryFn: () => unwrap<FriendCard[]>(api.get('/community/friends')) });
  const reqsQ = useQuery({
    queryKey: ['friend-requests'],
    queryFn: () => unwrap<{ incoming: FriendReq[]; outgoing: FriendReq[] }>(api.get('/community/friend-requests')),
  });
  const blockedQ = useQuery({ queryKey: ['blocked'], queryFn: () => unwrap<FriendCard[]>(api.get('/community/blocked')) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['friends'] });
    qc.invalidateQueries({ queryKey: ['friend-requests'] });
    qc.invalidateQueries({ queryKey: ['blocked'] });
    qc.invalidateQueries({ queryKey: ['explore-directory'] });
  };

  const addFriend = useMutation({
    mutationFn: (id: string) => unwrap(api.post('/community/friend-request', { to_student_id: id })),
    onSuccess: refresh,
  });
  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accepted' | 'declined' }) =>
      unwrap(api.post(`/community/friend-request/${id}/${action}`, {})),
    onSuccess: refresh,
  });
  const unfriend = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/community/friends/${id}/unfriend`, {})),
    onSuccess: refresh,
  });
  const unblock = useMutation({
    mutationFn: (id: string) => unwrap(api.post('/community/unblock', { student_id: id })),
    onSuccess: refresh,
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => unwrap(api.post(`/community/friend-request/${id}/withdraw`, {})),
    onSuccess: refresh,
  });

  const incoming = reqsQ.data?.incoming ?? [];
  const outgoing = reqsQ.data?.outgoing ?? [];
  const friends = friendsQ.data ?? [];
  const blocked = blockedQ.data ?? [];

  const friendIds = useMemo(() => new Set(friends.map((f) => f.student_id)), [friends]);
  const blockedIds = useMemo(() => new Set(blocked.map((b) => b.student_id)), [blocked]);
  const sentIds = useMemo(() => new Set(outgoing.map((o) => o.other_student_id)), [outgoing]);
  const sentMap = useMemo(
    () => new Map(outgoing.map((o) => [o.other_student_id, o.id])),
    [outgoing],
  );
  const receivedMap = useMemo(
    () => new Map(incoming.map((i) => [i.other_student_id, i.id])),
    [incoming],
  );

  const items = directory.data?.items ?? [];
  const total = directory.data?.total ?? 0;
  const pendingCount = incoming.length;

  return (
    <div className="-mx-3 -mt-4 sm:-mx-4 sm:-mt-6 md:-mx-4 md:-mt-8">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand via-brand-light to-indigo-600 px-4 py-5 sm:px-6 sm:py-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_90%_10%,rgba(244,180,0,0.4),transparent_50%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-brand/50 via-transparent to-white/10" aria-hidden />
        <div className="relative mx-auto max-w-5xl">
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Friends</h1>
          <p className="mt-1 text-sm text-white/85 sm:text-[15px]">
            Discover learners, connect, and practice together
          </p>
        </div>
      </section>

      <PageTabs tab={tab} onTab={setTab} friendsCount={friends.length} pendingCount={pendingCount} />

      <div className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:py-6">
        {tab === 'members' ? (
          <>
            <SearchBar value={search} onChange={setSearch} placeholder="Search members…" />

            {directory.isLoading ? (
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200 sm:h-56" />
                ))}
              </div>
            ) : !items.length ? (
              <EmptyState
                icon={Users}
                title="No members found"
                hint={debounced ? `No members match “${debounced}”.` : 'Check back later for new members to connect with.'}
              />
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                  {items.map((p) => (
                    <ProfileExploreCard
                      key={p.student_id}
                      profile={p}
                      subject={subject}
                      isFriend={friendIds.has(p.student_id)}
                      isBlocked={blockedIds.has(p.student_id)}
                      isSent={sentIds.has(p.student_id)}
                      sentReqId={sentMap.get(p.student_id)}
                      reqId={receivedMap.get(p.student_id)}
                      addFriend={addFriend}
                      respond={respond}
                      unblock={unblock}
                      withdraw={withdraw}
                    />
                  ))}
                </div>
                {total > PAGE_SIZE && (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <Paginator page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
                  </div>
                )}
              </>
            )}
          </>
        ) : tab === 'friends' ? (
          <FriendsList
            friends={friends}
            loading={friendsQ.isLoading}
            unfriend={unfriend}
            onExplore={() => setTab('members')}
          />
        ) : (
          <ManageFriends
            incoming={incoming}
            outgoing={outgoing}
            respond={respond}
            withdraw={withdraw}
          />
        )}
      </div>
    </div>
  );
}

function FriendsList({
  friends,
  loading,
  unfriend,
  onExplore,
}: {
  friends: FriendCard[];
  loading: boolean;
  unfriend: ReturnType<typeof useMutation<unknown, Error, string>>;
  onExplore: () => void;
}) {
  const [query, setQuery] = useState('');
  const [unfriendTarget, setUnfriendTarget] = useState<FriendCard | null>(null);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => nameOf(f).toLowerCase().includes(q));
  }, [friends, query]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-11 animate-pulse rounded-full bg-slate-200" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  if (!friends.length) {
    return (
      <EmptyState
        icon={Heart}
        title="No friends yet"
        hint="Browse the Members tab and send friend requests to start connecting."
        action={
          <button type="button" className={fbBtnPrimary('!flex-none px-6')} onClick={onExplore}>
            <Users size={16} /> Browse members
          </button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <SearchBar value={query} onChange={setQuery} placeholder="Search friends…" />

      {!filtered.length ? (
        <EmptyState icon={Search} title="No matches" hint={`No friends match “${query.trim()}”.`} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
          {filtered.map((f) => (
            <FriendRow key={f.student_id} friend={f} onRequestUnfriend={() => setUnfriendTarget(f)} />
          ))}
        </div>
      )}

      {unfriendTarget && (
        <Modal onClose={() => setUnfriendTarget(null)}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-amber-500" size={22} />
            <div>
              <h3 className="font-bold text-slate-900">Remove {nameOf(unfriendTarget)}?</h3>
              <p className="mt-1 text-sm text-slate-500">
                They will be removed from your friends list. You can send a new friend request later.
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setUnfriendTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary bg-red-600 hover:bg-red-700"
              disabled={unfriend.isPending}
              onClick={() => {
                unfriend.mutate(unfriendTarget.student_id, {
                  onSuccess: () => setUnfriendTarget(null),
                });
              }}
            >
              {unfriend.isPending ? <Loader2 size={16} className="animate-spin" /> : <UserMinus size={16} />}
              Remove friend
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function friendMeta(f: FriendCard) {
  return [
    f.cefr_level ? `CEFR ${f.cefr_level}` : null,
    f.gender,
    f.age != null ? `${f.age} yrs` : null,
  ].filter(Boolean).join(' · ');
}

function FriendRow({
  friend: f,
  onRequestUnfriend,
}: {
  friend: FriendCard;
  onRequestUnfriend: () => void;
}) {
  const name = nameOf(f);
  const meta = friendMeta(f);
  const unread = !!f.unread_count;
  const preview = f.last_message
    ? (f.last_message.length > 56 ? `${f.last_message.slice(0, 56)}…` : f.last_message)
    : 'Say hello';
  const when = fmtMsgTime(f.last_message_at);

  return (
    <article className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Link to={`/dashboard/community/member/${f.student_id}`} className="relative shrink-0">
          <StudentAvatar photoUrl={f.photo_url} gender={f.gender} name={name} size="h-14 w-14" iconSize={24} />
          {unread && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {f.unread_count}
            </span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <Link
              to={`/dashboard/community/member/${f.student_id}`}
              className={`min-w-0 truncate text-[17px] font-semibold leading-tight hover:text-brand ${
                unread ? 'text-slate-900' : 'text-slate-800'
              }`}
            >
              {name}
            </Link>
            {when && (
              <span className={`shrink-0 text-xs ${unread ? 'font-semibold text-brand' : 'text-slate-400'}`}>
                {when}
              </span>
            )}
          </div>
          {meta && (
            <p className="mt-0.5 truncate text-xs font-medium text-slate-500">{meta}</p>
          )}
          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">{f.student_id}</p>
          {f.cefr_status && (
            <p className="mt-0.5 truncate text-[11px] text-slate-400">{f.cefr_status}</p>
          )}
          {f.looking_for_partner && (
            <span className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
              Seeking partner
            </span>
          )}
          <Link to={`/dashboard/community/chat/${f.student_id}`} className="mt-1 block min-w-0">
            <p className={`truncate text-sm ${unread ? 'font-medium text-slate-700' : 'text-slate-500'}`}>
              {preview}
            </p>
          </Link>
        </div>
      </div>

      <div className="flex shrink-0 gap-2 sm:w-auto">
        <Link to={`/dashboard/community/chat/${f.student_id}`} className={fbBtnPrimary('sm:min-w-[7rem]')}>
          <MessageCircle size={16} /> Message
        </Link>
        <Link to={`/dashboard/community/member/${f.student_id}`} className={fbBtnSecondary('sm:min-w-[7rem]')}>
          View Profile
        </Link>
        <button
          type="button"
          title={`Remove ${name}`}
          className="inline-flex min-h-9 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-600 transition hover:bg-slate-300"
          onClick={onRequestUnfriend}
        >
          <UserMinus size={16} />
        </button>
      </div>
    </article>
  );
}

function ProfileExploreCard({
  profile: p,
  subject,
  isFriend,
  isBlocked,
  isSent,
  sentReqId,
  reqId,
  addFriend,
  respond,
  unblock,
  withdraw,
}: {
  profile: Profile;
  subject?: string | null;
  isFriend: boolean;
  isBlocked: boolean;
  isSent: boolean;
  sentReqId?: string;
  reqId?: string;
  addFriend: ReturnType<typeof useMutation<unknown, Error, string>>;
  respond: ReturnType<typeof useMutation<unknown, Error, { id: string; action: 'accepted' | 'declined' }>>;
  unblock: ReturnType<typeof useMutation<unknown, Error, string>>;
  withdraw: ReturnType<typeof useMutation<unknown, Error, string>>;
}) {
  const name = nameOf(p);
  const isSelf = p.student_id === subject;
  const meta = profileMeta(p);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:shadow-sm">
      <Link
        to={`/dashboard/community/member/${p.student_id}`}
        className="group flex items-start gap-3 px-3 py-3 sm:flex-col sm:items-center sm:px-4 sm:pb-3 sm:pt-5 sm:text-center"
      >
        <StudentAvatar
          photoUrl={p.photo_url}
          gender={p.gender}
          name={name}
          size="h-14 w-14 sm:h-20 sm:w-20"
          iconSize={24}
        />
        <div className="min-w-0 flex-1 sm:w-full">
          <h3 className="truncate text-base font-bold text-slate-900 transition-colors group-hover:text-brand sm:mt-3 sm:text-[17px]">
            {name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-slate-500 sm:text-sm">{meta}</p>
          {p.looking_for_partner && (
            <span className="mt-1 inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600 sm:mt-2 sm:px-2.5 sm:text-xs">
              Seeking partner
            </span>
          )}
          <p className="mt-1 line-clamp-1 text-xs leading-snug text-slate-500 sm:mt-2 sm:line-clamp-2 sm:min-h-[2.5rem] sm:text-sm">
            {p.bio || 'No bio yet.'}
          </p>
        </div>
      </Link>

      <div className="flex gap-2 border-t border-slate-100 px-3 py-2 sm:py-2.5">
        {isSelf ? (
          <span className={fbBtnSecondary('cursor-default opacity-80 !min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')}>This is you</span>
        ) : isBlocked ? (
          <button type="button" className={fbBtnPrimary('!min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')} disabled={unblock.isPending} onClick={() => unblock.mutate(p.student_id)}>
            <Ban size={14} className="sm:h-4 sm:w-4" /> Unblock
          </button>
        ) : isFriend ? (
          <>
            <Link to={`/dashboard/community/chat/${p.student_id}`} className={fbBtnPrimary('!min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')}>
              <MessageCircle size={14} className="sm:h-4 sm:w-4" /> Message
            </Link>
            <Link to={`/dashboard/community/member/${p.student_id}`} className={fbBtnSecondary('!min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')}>
              View Profile
            </Link>
          </>
        ) : reqId ? (
          <>
            <button type="button" className={fbBtnPrimary('!min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')} disabled={respond.isPending} onClick={() => respond.mutate({ id: reqId, action: 'accepted' })}>
              <Check size={14} className="sm:h-4 sm:w-4" /> Accept
            </button>
            <button type="button" className={fbBtnSecondary('!min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')} disabled={respond.isPending} onClick={() => respond.mutate({ id: reqId, action: 'declined' })}>
              <X size={14} className="sm:h-4 sm:w-4" /> Reject
            </button>
          </>
        ) : isSent && sentReqId ? (
          <>
            <span className={fbBtnSecondary('cursor-default bg-slate-100 text-slate-500 hover:bg-slate-100 !min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')}>
              <Clock size={14} className="sm:h-4 sm:w-4" /> Sent
            </span>
            <button
              type="button"
              className={fbBtnSecondary('!min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')}
              disabled={withdraw.isPending && withdraw.variables === sentReqId}
              onClick={() => withdraw.mutate(sentReqId)}
            >
              {withdraw.isPending && withdraw.variables === sentReqId
                ? <Loader2 size={14} className="animate-spin sm:h-4 sm:w-4" />
                : <X size={14} className="sm:h-4 sm:w-4" />}
              Withdraw
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={fbBtnPrimary('!min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')}
              disabled={addFriend.isPending && addFriend.variables === p.student_id}
              onClick={() => addFriend.mutate(p.student_id)}
            >
              {addFriend.isPending && addFriend.variables === p.student_id
                ? <Loader2 size={14} className="animate-spin sm:h-4 sm:w-4" />
                : <UserPlus size={14} className="sm:h-4 sm:w-4" />}
              Add Friend
            </button>
            <Link to={`/dashboard/community/member/${p.student_id}`} className={fbBtnSecondary('!min-h-8 !py-1.5 !text-xs sm:!min-h-9 sm:!py-2 sm:!text-sm')}>
              View Profile
            </Link>
          </>
        )}
      </div>
    </article>
  );
}

function ManageFriends({
  incoming,
  outgoing,
  respond,
  withdraw,
}: {
  incoming: FriendReq[];
  outgoing: FriendReq[];
  respond: ReturnType<typeof useMutation<unknown, Error, { id: string; action: 'accepted' | 'declined' }>>;
  withdraw: ReturnType<typeof useMutation<unknown, Error, string>>;
}) {
  if (!incoming.length && !outgoing.length) {
    return (
      <EmptyState
        icon={UserPlus}
        title="No friend requests"
        hint="When someone sends you a request, it will show up here."
      />
    );
  }

  return (
    <div className="space-y-4">
      {!!incoming.length && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <UserPlus size={18} className="text-brand" />
              Received Requests
              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-xs font-bold text-white">{incoming.length}</span>
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {incoming.map((r) => (
              <RequestRow key={r.id} req={r} subtitle="Sent you a friend request">
                <button type="button" className={fbBtnPrimary('!flex-none px-4')} disabled={respond.isPending} onClick={() => respond.mutate({ id: r.id, action: 'accepted' })}>
                  Accept
                </button>
                <button type="button" className={fbBtnSecondary('!flex-none px-4')} disabled={respond.isPending} onClick={() => respond.mutate({ id: r.id, action: 'declined' })}>
                  Reject
                </button>
              </RequestRow>
            ))}
          </div>
        </section>
      )}

      {!!outgoing.length && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <Clock size={18} className="text-amber-500" />
              Sent Requests
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{outgoing.length}</span>
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {outgoing.map((r) => (
              <RequestRow key={r.id} req={r} subtitle="Awaiting response">
                <button type="button" className={fbBtnSecondary('!flex-none px-4')} disabled={withdraw.isPending} onClick={() => withdraw.mutate(r.id)}>
                  Withdraw
                </button>
              </RequestRow>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RequestRow({ req, subtitle, children }: { req: FriendReq; subtitle: string; children: ReactNode }) {
  const name = req.other_name || req.other_student_id;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <Link to={`/dashboard/community/member/${req.other_student_id}`} className="group flex min-w-0 flex-1 items-center gap-3">
        <StudentAvatar photoUrl={req.other_photo_url} gender={req.other_gender} name={name} size="h-14 w-14" iconSize={24} />
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold text-slate-900 group-hover:text-brand">{name}</p>
          <p className="truncate text-sm text-slate-500">{subtitle}</p>
        </div>
      </Link>
      <div className="flex w-full gap-2 sm:w-auto">{children}</div>
    </div>
  );
}
