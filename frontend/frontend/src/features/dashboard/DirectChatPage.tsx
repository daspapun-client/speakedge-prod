import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Reply, Send, SmilePlus, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { StudentAvatar } from '@/features/admin/_shared';
import { useDirectChat, type DirectMessage } from '@/features/dashboard/useDirectChat';
import { fmtTime, parseApiDate } from '@/lib/datetime';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

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
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}),
  });
}

function MessageActions({
  open,
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setMenuPos(null);
      return;
    }
    const place = () => {
      if (!btnRef.current) return;
      const btn = btnRef.current.getBoundingClientRect();
      const menuW = menuRef.current?.offsetWidth ?? Math.min(296, window.innerWidth - 16);
      const menuH = menuRef.current?.offsetHeight ?? 48;
      const pad = 8;
      const gap = 6;

      let left = btn.left + btn.width / 2 - menuW / 2;
      let top = btn.top - menuH - gap;

      if (left + menuW > window.innerWidth - pad) left = window.innerWidth - menuW - pad;
      if (left < pad) left = pad;
      if (top < pad) top = btn.bottom + gap;

      setMenuPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose]);

  const menu = open ? (
    <div
      ref={menuRef}
      role="toolbar"
      aria-label="Message actions"
      style={menuPos ? { position: 'fixed', top: menuPos.top, left: menuPos.left, zIndex: 60 } : { position: 'fixed', visibility: 'hidden' }}
      className="flex max-w-[calc(100vw-1rem)] flex-wrap items-center justify-center gap-0.5 rounded-2xl border border-slate-200/80 bg-white px-1.5 py-1.5 shadow-xl sm:flex-nowrap sm:justify-start"
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          title={`React ${emoji}`}
          onClick={() => onReact(emoji)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg transition-all hover:bg-slate-100 active:scale-95 ${
            myReaction === emoji ? 'bg-brand/15 ring-2 ring-brand/30' : ''
          }`}
        >
          {emoji}
        </button>
      ))}
      <div className="mx-0.5 hidden h-6 w-px shrink-0 bg-slate-200 sm:block" aria-hidden />
      <button
        type="button"
        title="Reply"
        onClick={onReply}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-all hover:bg-brand/10 hover:text-brand active:scale-95"
      >
        <Reply size={17} strokeWidth={2} />
      </button>
    </div>
  ) : null;

  return (
    <div ref={wrapRef} className="relative shrink-0 self-center">
      <button
        ref={btnRef}
        type="button"
        onClick={onToggle}
        aria-label="React or reply"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-slate-200/80 active:scale-95 sm:h-7 sm:w-7 sm:opacity-0 sm:group-hover/message:opacity-100 sm:focus-visible:opacity-100 ${
          open ? 'bg-slate-200 text-slate-700 opacity-100' : 'text-slate-400 opacity-100 sm:opacity-0'
        }`}
      >
        <SmilePlus size={16} strokeWidth={2} />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  );
}

function DmMessageRow({
  message: m,
  mine,
  friendName,
  myName,
  subject,
  actionsOpen,
  onToggleActions,
  onCloseActions,
  onReply,
  onReact,
}: {
  message: DirectMessage;
  mine: boolean;
  friendName: string;
  myName: string;
  subject: string | null | undefined;
  actionsOpen: boolean;
  onToggleActions: () => void;
  onCloseActions: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
}) {
  const reactionEntries = Object.entries(m.reactions ?? {}).filter(([, ids]) => ids.length) as [string, string[]][];
  const myReaction = reactionEntries.find(([, ids]) => ids.includes(subject ?? ''))?.[0];
  const hasReactions = reactionEntries.length > 0;
  const nameFor = (id: string) => (id === subject ? myName : friendName);

  return (
    <div className={`group/message mt-2 flex items-end gap-1.5 sm:mt-1.5 ${mine ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`relative min-w-0 max-w-[min(85%,18rem)] sm:max-w-[min(75%,28rem)] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`relative w-full ${hasReactions ? 'mb-3' : ''}`}>
          <div
            className={`w-full rounded-2xl px-3.5 py-2.5 shadow-sm ${
              mine
                ? 'rounded-br-md bg-[#e8f1fb] text-slate-900 ring-1 ring-brand/10'
                : 'rounded-bl-md border border-slate-200/90 bg-white text-slate-900'
            }`}
          >
            {m.reply_to_text && (
              <div className="mb-2 overflow-hidden rounded-lg bg-slate-100/90">
                <div className="border-l-[3px] border-brand px-2.5 py-1.5">
                  <p className="truncate text-xs font-semibold text-brand">
                    {m.reply_to_sender_name}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-500">
                    {m.reply_to_text}
                  </p>
                </div>
              </div>
            )}

            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed sm:text-base">
              {m.text}
            </p>
            <div className={`mt-1 flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <span className="text-[10px] font-medium tabular-nums text-slate-400 sm:text-[11px]">
                {fmtTime(m.created_at)}
              </span>
            </div>
          </div>

          {hasReactions && (
            <div className={`absolute bottom-0 z-[2] translate-y-1/2 ${mine ? 'right-2' : 'left-2'}`}>
              <div className="inline-flex max-w-[12rem] flex-wrap items-center gap-0.5 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 shadow-sm">
                {reactionEntries.map(([emoji, ids]) => {
                  const mineReacted = ids.includes(subject ?? '');
                  const names = ids.map((id) => nameFor(id)).join(', ');
                  return (
                    <button
                      key={emoji}
                      type="button"
                      title={names}
                      onClick={() => onReact(emoji)}
                      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 transition active:scale-95 ${
                        mineReacted ? 'bg-brand/15' : 'hover:bg-slate-50'
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

      <MessageActions
        open={actionsOpen}
        mine={mine}
        myReaction={myReaction}
        onToggle={onToggleActions}
        onClose={onCloseActions}
        onReply={onReply}
        onReact={onReact}
      />
    </div>
  );
}

export function DirectChatPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const { subject } = useAuth();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<DirectMessage | null>(null);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/dashboard/explore');
  };

  const { friend, messages, online, typing, status, loadError, chatError, send, react, notifyTyping } =
    useDirectChat(studentId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, typing]);

  if (loadError) {
    return (
      <div className="card border-red-200 bg-red-50/50 text-center">
        <p className="font-semibold text-red-700">Unable to open chat</p>
        <p className="mt-1 text-sm text-red-600">{loadError}</p>
        <button type="button" className="btn-ghost mt-4 inline-flex" onClick={goBack}>
          <ArrowLeft size={16} /> Go back
        </button>
      </div>
    );
  }

  const friendOnline = friend ? online.has(friend.student_id) : false;
  const name = friend?.display_name || friend?.first_name || studentId || 'Friend';
  const myName = subject ?? 'You';
  const statusLabel =
    status !== 'open'
      ? status === 'closed' ? 'Offline' : 'Connecting…'
      : typing
        ? 'typing…'
        : friendOnline ? 'Active now' : 'Offline';

  return (
    <div className="team-chat-page -mx-3 -mt-4 -mb-8 flex min-h-0 flex-1 flex-col overflow-hidden sm:mx-0 sm:mt-0 sm:gap-2">
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-white sm:h-[80dvh] sm:max-h-[80dvh] sm:shrink-0 sm:rounded-xl sm:border sm:border-slate-200/80 sm:shadow-sm">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-brand/20 bg-brand px-2 sm:h-[4.25rem] sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={goBack}
            className="inline-flex shrink-0 items-center justify-center rounded-full p-2 text-white transition hover:bg-white/10 active:scale-95"
            aria-label="Go back"
          >
            <ArrowLeft size={20} />
          </button>
          <Link
            to={`/dashboard/community/member/${studentId}`}
            className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3"
          >
            <div className="relative shrink-0">
              <StudentAvatar photoUrl={friend?.photo_url} name={name} size="h-10 w-10" iconSize={18} />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-brand ${
                  friendOnline ? 'bg-emerald-400' : 'bg-slate-300'
                }`}
                aria-hidden
              />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold leading-tight text-white sm:text-base">{name}</h1>
              <span className={`text-xs ${typing ? 'font-medium text-emerald-200' : 'text-white/75'}`}>
                {statusLabel}
              </span>
            </div>
          </Link>
        </div>

        <div className="row-start-2 min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain bg-[#f4f6f8] px-3 py-3 sm:px-[6%] sm:py-4">
          {!messages.length ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center text-center sm:min-h-[200px]">
              <div className="rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                Say hello to {name}
              </div>
            </div>
          ) : (
            messages.map((m, i) => {
              const showDate = i === 0 || !sameDay(messages[i - 1].created_at, m.created_at);
              const mine = m.sender_student_id === subject;
              return (
                <div key={m.id}>
                  {showDate && (
                    <div className="my-3 flex justify-center first:mt-0">
                      <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-500 shadow-sm sm:rounded-lg sm:py-1.5 sm:text-sm sm:text-[#54656f]">
                        {fmtDateLabel(m.created_at)}
                      </span>
                    </div>
                  )}
                  <DmMessageRow
                    message={m}
                    mine={mine}
                    friendName={name}
                    myName={myName}
                    subject={subject}
                    actionsOpen={actionsFor === m.id}
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
          {typing && (
            <div className="mt-2 flex justify-start">
              <div className="rounded-2xl rounded-bl-md border border-slate-200/90 bg-white px-3.5 py-2.5 shadow-sm">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s] sm:h-2 sm:w-2 sm:bg-[#8696a0]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s] sm:h-2 sm:w-2 sm:bg-[#8696a0]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 sm:h-2 sm:w-2 sm:bg-[#8696a0]" />
                </span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="shrink-0 border-t border-slate-200 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:border-[#e0e0e0] sm:bg-[#f0f2f5] sm:px-4 sm:py-2.5"
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
            <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{chatError}</div>
          )}
          {replyTo && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border-l-4 border-brand bg-slate-50 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand">
                  {replyTo.sender_student_id === subject ? myName : name}
                </p>
                <p className="truncate text-xs text-slate-500">{replyTo.text}</p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-full p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                onClick={() => setReplyTo(null)}
                aria-label="Cancel reply"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              className="min-h-10 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand/40 focus:bg-white focus:ring-2 focus:ring-brand/20 sm:min-h-[44px] sm:border-0 sm:bg-white sm:text-base sm:shadow-sm sm:focus:ring-[#00a884]/30"
              placeholder={status === 'open' ? (replyTo ? 'Type a reply' : 'Aa') : 'Connecting…'}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                notifyTyping();
              }}
              autoComplete="off"
            />
            <button
              type="submit"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm transition hover:bg-brand-light disabled:opacity-40 sm:h-[42px] sm:w-[42px] sm:bg-[#00a884] sm:hover:bg-[#008069]"
              disabled={!text.trim() || status !== 'open'}
              aria-label="Send message"
            >
              <Send size={17} className="sm:h-[18px] sm:w-[18px]" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
