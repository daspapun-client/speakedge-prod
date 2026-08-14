import { useMemo, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, Users, Pencil, LogOut, Trash2, Loader2, AlertTriangle, X, Reply, SmilePlus, Ban, CheckCheck, Shield, CalendarClock } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal } from '@/features/admin/_shared';
import { MemberList, type MemberCard } from '@/features/dashboard/MemberList';
import { CommunityBannerDisplay, bannerFallback } from '@/features/dashboard/CommunityBanner';
import { CommunityFormModal } from '@/features/dashboard/CommunityPage';
import { useTeamChat, type ChatMessage } from '@/features/dashboard/useTeamChat';
import { fmtTime, parseApiDate } from '@/lib/datetime';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

const WA = {
  green: '#008069',
  greenLight: '#00a884',
  sent: '#cce5f6',
  received: '#ffffff',
  chatBg: '#eaf2f9',
  footer: '#f0f2f5',
  text: '#111b21',
  meta: '#667781',
  read: '#53bdeb',
} as const;

const SENDER_NAME_COLORS = [
  '#00529b', '#7b1fa2', '#c62828', '#e65100', '#00695c',
  '#ad1457', '#4527a0', '#558b2f', '#6a1b9a', '#bf360c',
];

const WA_CHAT_WALLPAPER = `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23b3cde4' fill-opacity='0.35'%3E%3Cpath d='M20 20h4v4h-4zm20 0h4v4h-4zm20 0h4v4h-4zM0 40h4v4H0zm20 0h4v4h-4zm20 0h4v4h-4zm20 0h4v4h-4zM0 60h4v4H0zm20 0h4v4h-4zm20 0h4v4h-4zm20 0h4v4h-4z'/%3E%3C/g%3E%3C/svg%3E")`;

function senderColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return SENDER_NAME_COLORS[Math.abs(h) % SENDER_NAME_COLORS.length];
}

function sameDay(a: string, b: string): boolean {
  const da = parseApiDate(a);
  const db = parseApiDate(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function fmtDateLabel(iso: string): string {
  const d = parseApiDate(iso);
  const today = new Date();
  const yday = new Date(today);
  yday.setDate(yday.getDate() - 1);
  const eq = (x: Date, y: Date) =>
    x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  if (eq(d, today)) return 'Today';
  if (eq(d, yday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}),
  });
}

function fmtClassDay(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function fmtClassTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function DateDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex justify-center first:mt-0">
      <span className="rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
        {label}
      </span>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="team-chat-page -mb-8 flex min-h-0 flex-1 animate-pulse flex-col gap-2 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
        <div className="card grid h-[80dvh] max-h-[80dvh] shrink-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0">
          <div className="h-[3.75rem] shrink-0 overflow-hidden bg-slate-200 sm:h-[4.25rem]" />
          <div className="space-y-4 bg-slate-50/50 p-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`flex gap-3 ${i % 2 === 0 ? 'flex-row-reverse' : ''}`}>
                <div className="h-9 w-9 shrink-0 rounded-full bg-slate-200" />
                <div className="h-14 w-48 rounded-2xl bg-slate-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="hidden w-72 shrink-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm lg:block">
        <div className="h-14 bg-brand/20" />
        <div className="space-y-3 bg-slate-50/40 p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="h-9 w-9 rounded-full bg-slate-200" />
              <div className="h-8 flex-1 rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Avatar({
  name,
  photoUrl,
  admin,
  online,
}: {
  name: string;
  photoUrl?: string | null;
  admin?: boolean;
  online?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(photoUrl) && !failed && !admin;

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  return (
    <div className="relative shrink-0 self-end">
      {showPhoto ? (
        <img
          src={photoUrl!}
          alt=""
          className="h-9 w-9 rounded-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
            admin ? 'bg-red-600 text-white' : 'bg-slate-300 text-slate-600'
          }`}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#eaf2f9] bg-emerald-500" />
      )}
    </div>
  );
}

function typingText(names: string[]) {
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return 'Several people are typing…';
}

function MembersPanelHeader({ memberCount, onlineCount }: { memberCount: number; onlineCount: number }) {
  return (
    <div className="flex shrink-0 items-center gap-3 bg-brand px-4 py-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-white">
        <Users size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-white">Members</h2>
        <p className="flex items-center gap-1.5 text-xs text-white/75">
          <span>{memberCount} total</span>
          <span className="text-white/40">·</span>
          <span className="inline-flex items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${onlineCount > 0 ? 'bg-emerald-300' : 'bg-white/40'}`} />
            {onlineCount} online
          </span>
        </p>
      </div>
    </div>
  );
}

function MessageActions({
  open,
  mine,
  myReaction,
  onToggle,
  onClose,
  onReply,
  onReact,
}: {
  open: boolean;
  mine: boolean;
  myReaction?: string;
  onToggle: () => void;
  onClose: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  return (
    <div ref={ref} className="relative shrink-0 self-center">
      <button
        type="button"
        onClick={onToggle}
        aria-label="React or reply"
        aria-expanded={open}
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors
          hover:bg-black/5 active:scale-95
          sm:opacity-0 sm:group-hover/message:opacity-100 sm:focus-visible:opacity-100
          ${open ? 'bg-black/10 text-[#54656f] opacity-100' : 'text-[#8696a0] opacity-80'}`}
      >
        <SmilePlus size={16} strokeWidth={2} />
      </button>

      {open && (
        <div
          role="toolbar"
          aria-label="Message actions"
          className={`absolute bottom-full z-30 mb-2 flex flex-nowrap items-center gap-0.5 rounded-2xl border border-slate-200/80 bg-white/95 px-1.5 py-1.5 shadow-xl shadow-slate-200/50 backdrop-blur-md ${
            mine ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left'
          }`}
        >
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              title={`React ${emoji}`}
              onClick={() => onReact(emoji)}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg transition-all duration-150 hover:scale-110 hover:bg-slate-100 active:scale-95 ${
                myReaction === emoji ? 'bg-brand/15 ring-2 ring-brand/30' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
          <div className="mx-0.5 h-6 w-px shrink-0 bg-slate-200" aria-hidden />
          <button
            type="button"
            title="Reply"
            onClick={onReply}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-all duration-150 hover:scale-110 hover:bg-brand/10 hover:text-brand active:scale-95"
          >
            <Reply size={17} strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}

function bubbleVariant(mine: boolean, isAdminMsg: boolean, isFirst: boolean, isLast: boolean) {
  let radius: string;
  if (mine) {
    if (isFirst && isLast) radius = 'rounded-lg rounded-br-none';
    else if (isFirst) radius = 'rounded-lg rounded-br-[4px]';
    else if (isLast) radius = 'rounded-lg rounded-tr-[4px] rounded-br-none';
    else radius = 'rounded-lg rounded-r-[4px]';
  } else {
    if (isFirst && isLast) radius = 'rounded-lg rounded-bl-none';
    else if (isFirst) radius = 'rounded-lg rounded-bl-[4px]';
    else if (isLast) radius = 'rounded-lg rounded-tl-[4px] rounded-bl-none';
    else radius = 'rounded-lg rounded-l-[4px]';
  }

  if (isAdminMsg) {
    return `${radius} bg-[#1f2c34] text-white shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]`;
  }
  if (mine) {
    return `${radius} bg-[#cce5f6] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]`;
  }
  return `${radius} bg-white text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]`;
}

function ChatMessageRow({
  message: m,
  mine,
  isAdminMsg,
  sender,
  isFirstInGroup,
  isLastInGroup,
  showSeen,
  reactionEntries,
  myReaction,
  memberById,
  subject,
  chatDisabled,
  actionsOpen,
  online,
  onToggleActions,
  onCloseActions,
  onReply,
  onReact,
}: {
  message: ChatMessage;
  mine: boolean;
  isAdminMsg: boolean;
  sender?: MemberCard;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  showSeen: boolean;
  reactionEntries: [string, string[]][];
  myReaction?: string;
  memberById: Map<string, MemberCard>;
  subject: string | null | undefined;
  chatDisabled: boolean;
  actionsOpen: boolean;
  online: Set<string>;
  onToggleActions: () => void;
  onCloseActions: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
}) {
  const hasReactions = reactionEntries.length > 0;
  const filled = isAdminMsg;

  return (
    <div
      className={`group/message flex gap-1.5 ${mine ? 'flex-row-reverse' : 'flex-row'} ${
        isFirstInGroup ? 'mt-2' : 'mt-0.5'
      }`}
    >
      {!mine && isLastInGroup ? (
        <Avatar
          name={m.sender_name}
          photoUrl={sender?.photo_url}
          admin={isAdminMsg}
          online={online.has(m.sender_student_id)}
        />
      ) : !mine ? (
        <div className="w-9 shrink-0" aria-hidden />
      ) : null}

      <div className={`relative min-w-0 max-w-[min(78%,34rem)] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        {isFirstInGroup && !mine && (
          <span
            className="mb-1 px-2 text-base font-semibold leading-snug"
            style={{ color: isAdminMsg ? '#ea0038' : senderColor(m.sender_name) }}
          >
            {m.sender_name}
            {isAdminMsg && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-red-600 px-1 py-px text-[9px] font-bold uppercase text-white">
                <Shield size={8} />
                Mod
              </span>
            )}
          </span>
        )}

        <div className={`relative max-w-full ${mine ? 'items-end' : 'items-start'} ${hasReactions ? 'mb-3' : ''}`}>
          <div
            className={`relative min-w-[3.25rem] px-3 pt-1.5 ${hasReactions ? 'pb-6' : 'pb-1.5'} ${bubbleVariant(mine, isAdminMsg, isFirstInGroup, isLastInGroup)}`}
          >
            {m.reply_to_text && (
              <div
                className={`mb-2 overflow-hidden rounded-md text-base ${
                  filled ? 'bg-white/10' : 'bg-[#f0f2f5]'
                }`}
              >
                <div className={`border-l-4 px-3 py-2 ${filled ? 'border-[#53bdeb]' : 'border-[#06cf9c]'}`}>
                  <p className={`truncate text-base font-semibold ${filled ? 'text-[#53bdeb]' : 'text-[#06cf9c]'}`}>
                    {m.reply_to_sender_name}
                  </p>
                  <p className={`mt-0.5 line-clamp-2 text-base ${filled ? 'text-white/70' : 'text-[#667781]'}`}>
                    {m.reply_to_text}
                  </p>
                </div>
              </div>
            )}

            <p className="whitespace-pre-wrap break-words text-lg leading-[22px]">
              {m.text}
              {/* Reserve last-line space for timestamp (WhatsApp-style) */}
              <span className="inline-block w-[4.5rem] select-none" aria-hidden="true" />
              <span
                className={`relative -mt-[22px] float-right inline-flex items-center gap-0.5 text-[11px] leading-none ${
                  filled ? 'text-white/60' : 'text-[#667781]'
                }`}
              >
                <span className="tabular-nums">{fmtTime(m.created_at)}</span>
                {showSeen && (
                  <CheckCheck size={16} strokeWidth={2} className="text-[#53bdeb]" aria-label="Read" />
                )}
              </span>
            </p>
          </div>

          {hasReactions && (
            <div
              className={`absolute bottom-0 z-[2] translate-y-1/2 ${mine ? 'right-2' : 'left-2'}`}
            >
              <div className="inline-flex max-w-[12rem] flex-wrap items-center gap-0.5 rounded-full border border-[#e9edef] bg-white px-1.5 py-0.5 shadow-[0_1px_3px_rgba(11,20,26,0.16)]">
                {reactionEntries.map(([emoji, ids]) => {
                  const mineReacted = ids.includes(subject ?? '');
                  const names = ids
                    .map((id) => memberById.get(id)?.display_name || memberById.get(id)?.first_name || id)
                    .join(', ');
                  return (
                    <button
                      key={emoji}
                      type="button"
                      title={names}
                      disabled={chatDisabled}
                      onClick={() => onReact(emoji)}
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                        mineReacted ? 'bg-[#cce5f6]/90' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="text-base leading-none">{emoji}</span>
                      {ids.length > 1 && (
                        <span className="text-[11px] font-medium tabular-nums text-slate-500">{ids.length}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {!chatDisabled && (
        <MessageActions
          open={actionsOpen}
          mine={mine}
          myReaction={myReaction}
          onToggle={onToggleActions}
          onClose={onCloseActions}
          onReply={onReply}
          onReact={onReact}
        />
      )}
    </div>
  );
}

export function TeamChatPage() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { subject, isAdmin } = useAuth();
  const adminView = location.pathname.startsWith('/admin/');
  const communitiesPath = adminView ? '/admin/community' : '/dashboard/community';
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const { team, messages, online, typing, reads, status, loadError, chatError, send, react, notifyTyping, markRead } =
    useTeamChat(teamId);

  const { data: members } = useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => unwrap<{ members: MemberCard[] }>(api.get(`/community/teams/${teamId}/members`)),
  });

  const memberById = useMemo(() => {
    const map = new Map<string, MemberCard>();
    for (const m of members?.members ?? []) map.set(m.student_id, m);
    return map;
  }, [members?.members]);

  const invalidateTeams = () => {
    qc.invalidateQueries({ queryKey: ['teams'] });
    qc.invalidateQueries({ queryKey: ['team-join-requests'] });
    qc.invalidateQueries({ queryKey: ['admin-community-teams'] });
    qc.invalidateQueries({ queryKey: ['admin-community-join-requests'] });
  };

  const updateTeam = useMutation({
    mutationFn: (fd: FormData) => unwrap(api.put(`/community/teams/${teamId}`, fd)),
    onSuccess: () => { setShowEdit(false); invalidateTeams(); },
    onError: (e: Error) => setActionError(e.message),
  });
  const leaveTeam = useMutation({
    mutationFn: () => unwrap(api.post(`/community/teams/${teamId}/leave`, {})),
    onSuccess: () => { invalidateTeams(); navigate(communitiesPath); },
    onError: (e: Error) => setActionError(e.message),
  });
  const deleteTeam = useMutation({
    mutationFn: () => unwrap(api.delete(`/community/teams/${teamId}`)),
    onSuccess: () => { invalidateTeams(); navigate(communitiesPath); },
    onError: (e: Error) => setActionError(e.message),
  });
  const removeMember = useMutation({
    mutationFn: (studentId: string) => unwrap(api.delete(`/community/teams/${teamId}/members/${studentId}`)),
    onMutate: (studentId) => setRemovingId(studentId),
    onSuccess: () => {
      setRemovingId(null);
      qc.invalidateQueries({ queryKey: ['team-members', teamId] });
      invalidateTeams();
    },
    onError: (e: Error) => { setActionError(e.message); setRemovingId(null); },
  });

  const actionPending = updateTeam.isPending || leaveTeam.isPending || deleteTeam.isPending || removeMember.isPending;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typing.length]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && document.visibilityState === 'visible') markRead(last.id);
  }, [messages, markRead]);

  const lastSeenIdx = useMemo(() => {
    const idx = new Map(messages.map((m, i) => [m.id, i]));
    let maxOther = -1;
    for (const [sid, mid] of Object.entries(reads)) {
      if (sid === subject) continue;
      const i = idx.get(mid);
      if (i !== undefined && i > maxOther) maxOther = i;
    }
    let seen = -1;
    for (let i = 0; i <= maxOther; i++) if (messages[i].sender_student_id === subject) seen = i;
    return seen;
  }, [messages, reads, subject]);

  if (loadError) {
    return (
      <div className="card border-red-200 bg-red-50/50 text-center">
        <p className="font-semibold text-red-700">Unable to load chat</p>
        <p className="mt-1 text-sm text-red-600">{loadError}</p>
        <Link to={communitiesPath} className="btn-ghost mt-4 inline-flex">
          <ArrowLeft size={16} /> Back to community classes
        </Link>
      </div>
    );
  }
  if (!team) return <ChatSkeleton />;

  const chatDisabled = Boolean(team.is_suspended);
  const roster = members?.members ?? [];
  const memberCount = roster.length || team.member_ids.length;
  const onlineCount = (roster.length ? roster.map((m) => m.student_id) : team.member_ids)
    .filter((id) => online.has(id)).length;
  const isOwner = !adminView && team.owner_student_id === subject;
  const canDelete = isOwner || (adminView && isAdmin());
  const canRemoveMembers = adminView && isAdmin();

  const handleRemoveMember = (m: MemberCard) => {
    const name = m.display_name || m.first_name || m.student_id;
    if (window.confirm(`Remove ${name} from “${team.name}”?`)) removeMember.mutate(m.student_id);
  };

  return (
    <div className="team-chat-page -mb-8 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {actionError && (
        <div className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>{actionError}</span>
          <button type="button" className="text-xs font-semibold underline" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}

      {adminView && !chatDisabled && (
        <div className="shrink-0 rounded-lg border border-brand/20 bg-brand/5 px-4 py-2 text-sm text-brand">
          Moderating as Admin — you can read and send messages in any community class without joining.
        </div>
      )}

      {chatDisabled && (
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <Ban size={16} className="shrink-0 text-amber-600" />
          <span>
            This community class is <strong>suspended</strong> — chat is disabled. Members can still read history.
            {adminView && ' Unsuspend it from Community Class Management to re-enable chat.'}
          </span>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Link to={communitiesPath} className="btn-ghost inline-flex items-center gap-1 px-2 py-1.5 text-xs">
          <ArrowLeft size={14} /> Community Classes
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          {isOwner && (
            <button type="button" className="btn-ghost inline-flex items-center gap-1 px-2.5 py-1.5 text-xs" disabled={actionPending} onClick={() => setShowEdit(true)}>
              <Pencil size={13} /> Edit
            </button>
          )}
          {!adminView && (
            <button type="button" className="btn-ghost inline-flex items-center gap-1 px-2.5 py-1.5 text-xs" disabled={actionPending} onClick={() => leaveTeam.mutate()}>
              {leaveTeam.isPending ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
              Leave
            </button>
          )}
          {canDelete && (
            <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50" disabled={actionPending} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
      {/* Left: chat with unified banner header */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="grid h-[80dvh] max-h-[80dvh] shrink-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
          <div className="relative h-[3.75rem] shrink-0 overflow-hidden sm:h-[4.25rem]">
            <CommunityBannerDisplay
              src={team.banner_url}
              fallbackClass={bannerFallback(team.id)}
              bare
              fill
            />
            <div className="absolute inset-0 bg-gradient-to-r from-slate-950/92 via-slate-950/78 to-slate-950/50 backdrop-blur-[2px]" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />
            <div className="absolute inset-0 flex items-center justify-between gap-2.5 px-3 sm:gap-3 sm:px-4">
              <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
                <div className="relative shrink-0">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-md ring-2 ring-white/25 sm:h-10 sm:w-10 ${bannerFallback(team.id)}`}
                  >
                    {team.name.charAt(0).toUpperCase()}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950/80 ${
                      status === 'open' ? 'bg-emerald-400' : 'bg-slate-400'
                    }`}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-sm font-semibold leading-tight text-white sm:text-[15px]">
                    {team.name}
                  </h1>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    {team.class_day && team.class_time ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-gold px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-900 shadow-sm sm:text-[11px]">
                        <CalendarClock size={11} className="shrink-0" strokeWidth={2.5} />
                        <span className="truncate">{fmtClassDay(team.class_day)} · {fmtClassTime(team.class_time)}</span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] font-medium text-white/45">Schedule TBA</span>
                    )}
                    <span className={`min-w-0 truncate text-[10px] sm:text-[11px] ${typing.length > 0 ? 'font-medium text-emerald-300' : 'text-white/55'}`}>
                      {status !== 'open'
                        ? status === 'closed' ? 'Offline' : 'Connecting…'
                        : typing.length > 0
                          ? typingText(typing.map((t) => t.name))
                          : `${memberCount} ${memberCount === 1 ? 'member' : 'members'} · ${onlineCount} online`}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="hidden items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300 ring-1 ring-white/10 sm:inline-flex">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  {onlineCount} online
                </span>
                <button
                  type="button"
                  onClick={() => setShowMembers(true)}
                  className="inline-flex shrink-0 items-center justify-center rounded-full p-2 text-white/90 transition hover:bg-white/10 active:scale-95 lg:hidden"
                  aria-label="View members"
                >
                  <Users size={20} />
                </button>
              </div>
            </div>
          </div>

        {/* Messages */}
        <div
          className="row-start-2 min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-[4%] py-3 sm:px-[6%] sm:py-4"
          style={{ backgroundColor: WA.chatBg, backgroundImage: WA_CHAT_WALLPAPER }}
        >
          {!messages.length ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
              <div className="rounded-lg bg-white/90 px-4 py-2 text-sm text-[#54656f] shadow-sm">
                Messages are end-to-end inspired — say hello to your community class!
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const mine = m.sender_student_id === subject;
              const isAdminMsg = m.sender_name === 'Admin';
              const sender = memberById.get(m.sender_student_id);
              const reactionEntries = Object.entries(m.reactions ?? {}).filter(([, ids]) => ids.length) as [string, string[]][];
              const myReaction = reactionEntries.find(([, ids]) => ids.includes(subject ?? ''))?.[0];
              const isFirstInGroup = i === 0 || messages[i - 1].sender_student_id !== m.sender_student_id;
              const isLastInGroup = i === messages.length - 1 || messages[i + 1].sender_student_id !== m.sender_student_id;
              const showDateDivider = i === 0 || !sameDay(messages[i - 1].created_at, m.created_at);

              return (
                <div key={m.id}>
                  {showDateDivider && <DateDivider label={fmtDateLabel(m.created_at)} />}
                  <ChatMessageRow
                  message={m}
                  mine={mine}
                  isAdminMsg={isAdminMsg}
                  sender={sender}
                  isFirstInGroup={isFirstInGroup}
                  isLastInGroup={isLastInGroup}
                  showSeen={mine && i === lastSeenIdx}
                  reactionEntries={reactionEntries}
                  myReaction={myReaction}
                  memberById={memberById}
                  subject={subject}
                  chatDisabled={chatDisabled}
                  actionsOpen={actionsFor === m.id}
                  online={online}
                  onToggleActions={() => setActionsFor((cur) => (cur === m.id ? null : m.id))}
                  onCloseActions={() => setActionsFor(null)}
                  onReply={() => {
                    setReplyTo(m);
                    setActionsFor(null);
                  }}
                  onReact={(emoji) => {
                    react(m.id, emoji);
                    setActionsFor(null);
                  }}
                />
                </div>
              );
            })
          )}

          {typing.length > 0 && (
            <div className="mt-2 flex gap-1.5">
              <div className="w-9 shrink-0" aria-hidden />
              <div className="rounded-lg rounded-bl-none bg-white px-3 py-2 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]">
                <span className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#8696a0] [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#8696a0]" />
                </span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Composer */}
        {chatDisabled ? (
          <div className="shrink-0 border-t border-amber-100 bg-amber-50/80 px-4 py-4 text-center sm:px-6">
            <p className="text-sm font-medium text-amber-800">Chat is disabled while this community class is suspended.</p>
          </div>
        ) : (
        <form
          className="shrink-0 border-t border-[#e0e0e0] bg-[#f0f2f5] px-3 py-2.5 sm:px-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) {
              send(text, replyTo?.id);
              setText('');
              setReplyTo(null);
            }
          }}
        >
          {chatError && (
            <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {chatError}
            </div>
          )}
          {replyTo && (
            <div className="mb-2 flex items-start gap-2 rounded-lg bg-white px-3 py-2 shadow-sm">
              <div className="min-w-0 flex-1 border-l-4 border-[#06cf9c] pl-2">
                <p className="text-xs font-semibold text-[#06cf9c]">{replyTo.sender_name}</p>
                <p className="truncate text-xs text-[#667781]">{replyTo.text}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="shrink-0 rounded-full p-1 text-[#8696a0] transition hover:bg-black/5"
                aria-label="Cancel reply"
              >
                <X size={18} />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              className="min-h-[44px] flex-1 rounded-3xl border-0 bg-white px-4 py-2.5 text-base text-[#111b21] shadow-sm outline-none placeholder:text-[#8696a0] focus:ring-2 focus:ring-[#00a884]/30"
              placeholder={status === 'open' ? (replyTo ? 'Type a reply' : 'Type a message') : 'Connecting…'}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                notifyTyping();
              }}
              autoComplete="off"
            />
            <button
              type="submit"
              className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-sm transition hover:bg-[#008069] disabled:opacity-40"
              disabled={!text.trim() || status !== 'open'}
              aria-label="Send message"
            >
              <Send size={18} />
            </button>
          </div>
        </form>
        )}
        </div>
      </div>

      {/* Members sidebar — desktop */}
      <aside className="hidden w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm lg:flex">
        <MembersPanelHeader memberCount={memberCount} onlineCount={onlineCount} />
        <div className="flex-1 overflow-y-auto bg-slate-50/40 p-2">
          {roster.length ? (
            <MemberList
              members={roster}
              onlineIds={online}
              variant="sidebar"
              adminView={canRemoveMembers}
              onRemove={canRemoveMembers ? handleRemoveMember : undefined}
              removingId={removingId}
            />
          ) : (
            <p className="px-3 py-6 text-center text-sm text-slate-400">Loading members…</p>
          )}
        </div>
      </aside>

      {/* Members modal — mobile */}
      {showMembers && (
        <Modal onClose={() => setShowMembers(false)}>
          <div className="-mx-5 -mt-5 mb-4 overflow-hidden rounded-t-xl">
            <MembersPanelHeader memberCount={memberCount} onlineCount={onlineCount} />
          </div>
          <MemberList
            members={roster}
            onlineIds={online}
            variant="sidebar"
            adminView={canRemoveMembers}
            onRemove={canRemoveMembers ? handleRemoveMember : undefined}
            removingId={removingId}
          />
        </Modal>
      )}
      </div>

      {showEdit && (
        <CommunityFormModal
          team={{
            id: team.id,
            name: team.name,
            owner_student_id: team.owner_student_id ?? '',
            member_ids: team.member_ids,
            description: team.description,
            max_members: team.max_members,
            banner_url: team.banner_url,
          }}
          onClose={() => setShowEdit(false)}
          onSubmit={(fd) => updateTeam.mutate(fd)}
          pending={updateTeam.isPending}
        />
      )}

      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(false)}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-red-500" size={22} />
            <div>
              <h3 className="font-bold text-slate-800">Delete “{team.name}”?</h3>
              <p className="mt-1 text-sm text-slate-500">
                This permanently removes the community class for all members. Chat history will be archived and cannot be recovered.
              </p>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
              disabled={deleteTeam.isPending}
              onClick={() => deleteTeam.mutate()}
            >
              {deleteTeam.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
