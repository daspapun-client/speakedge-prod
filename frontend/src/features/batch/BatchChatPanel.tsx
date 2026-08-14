import { ChevronDown, MessageCircle, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { relTime } from '@/lib/datetime';
import { useBatchChat } from './useBatchChat';

export function BatchChatPanel({
  batchId,
  disabled,
  layout = 'stacked',
  chatHint,
}: {
  batchId: string;
  disabled?: boolean;
  layout?: 'stacked' | 'sidebar';
  chatHint?: string;
}) {
  const me = useAuth((s) => s.subject);
  const { messages, typing, status, loadError, chatError, send, notifyTyping } = useBatchChat(batchId);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(() => layout === 'sidebar' || location.hash === `#batch-${batchId}`);
  const endRef = useRef<HTMLDivElement>(null);
  const sidebar = layout === 'sidebar';

  useEffect(() => {
    if (location.hash === `#batch-${batchId}`) setOpen(true);
  }, [batchId]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [open, messages.length, typing.length]);

  if (loadError) {
    return (
      <div className={`px-5 py-4 text-sm text-slate-500 ${sidebar ? 'border-l border-slate-200' : 'border-t border-slate-100'}`}>
        Chat unavailable — {loadError}
      </div>
    );
  }

  const messageList = (
    <div className={`overflow-y-auto px-4 py-3 ${sidebar ? 'min-h-0 flex-1' : 'max-h-64'}`}>
      {!messages.length ? (
        <p className="py-6 text-center text-sm text-slate-400">No messages yet — say hello!</p>
      ) : (
        messages.map((m) => {
          const mine = m.sender_id === me;
          return (
            <div key={m.id} className={`mb-2 flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2 shadow-sm ${
                  mine
                    ? 'rounded-br-sm bg-[#d9fdd3] text-[#111b21]'
                    : 'rounded-bl-sm bg-white text-[#111b21]'
                }`}
              >
                {!mine && (
                  <p className="text-[11px] font-semibold text-[#00a884]">{m.sender_name}</p>
                )}
                <p className="whitespace-pre-wrap break-words text-sm leading-snug">{m.text}</p>
                <p className={`mt-0.5 text-[10px] ${mine ? 'text-[#667781]' : 'text-slate-400'}`}>
                  {relTime(m.created_at)}
                </p>
              </div>
            </div>
          );
        })
      )}

      {typing.length > 0 && (
        <div className="flex justify-start">
          <div className="rounded-xl rounded-bl-sm bg-white px-3 py-2 shadow-sm">
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
  );

  const composeForm = (
    <form
      className="shrink-0 border-t border-[#e0e0e0] bg-[#f0f2f5] px-3 py-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) {
          send(text);
          setText('');
        }
      }}
    >
      {chatError && (
        <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {chatError}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          className="min-h-[40px] flex-1 rounded-3xl border-0 bg-white px-4 py-2 text-sm text-[#111b21] shadow-sm outline-none placeholder:text-[#8696a0] focus:ring-2 focus:ring-[#00a884]/30 disabled:bg-slate-100"
          placeholder={disabled ? 'Chat closed after attendance' : status === 'open' ? 'Type a message…' : 'Connecting…'}
          value={text}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            notifyTyping();
          }}
          autoComplete="off"
        />
        <button
          type="submit"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-sm transition hover:bg-[#008069] disabled:opacity-40"
          disabled={disabled || !text.trim() || status !== 'open'}
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </div>
    </form>
  );

  if (sidebar) {
    return (
      <div className="flex h-full min-h-[16rem] flex-col border-slate-200 bg-[#f0f2f5]/40 lg:min-h-0 lg:border-l">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <span className="rounded-lg bg-brand/10 p-1.5 text-brand">
            <MessageCircle size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">Batch chat</p>
            <p className="text-xs text-slate-500">
              {status === 'open' ? (chatHint ?? 'Messages with students') : 'Connecting…'}
            </p>
          </div>
        </div>
        {messageList}
        {composeForm}
      </div>
    );
  }

  return (
    <div className="border-t border-slate-100 bg-[#f0f2f5]/40">
      <button
        type="button"
        className={`flex w-full items-center gap-2 bg-white px-5 py-3 text-left transition hover:bg-slate-50 ${open ? 'border-b border-slate-100' : ''}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
      >
        <span className="rounded-lg bg-brand/10 p-1.5 text-brand">
          <MessageCircle size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">Batch notes &amp; chat</p>
          <p className="text-xs text-slate-500">
            {open
              ? status === 'open'
                ? 'Messages with your teacher and classmates'
                : 'Connecting…'
              : messages.length
                ? `${messages.length} message${messages.length === 1 ? '' : 's'} — click to open`
                : 'Click to open chat'}
          </p>
        </div>
        <ChevronDown
          size={18}
          className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <>
          {messageList}
          {composeForm}
        </>
      )}
    </div>
  );
}
