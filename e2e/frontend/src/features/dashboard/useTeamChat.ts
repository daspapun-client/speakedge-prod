import { useCallback, useEffect, useRef, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface ChatMessage {
  id: string;
  sender_student_id: string;
  sender_name: string;
  text: string;
  created_at: string;
  reply_to_id?: string | null;
  reply_to_sender_name?: string | null;
  reply_to_text?: string | null;
  reactions?: Record<string, string[]>;
}
export interface TeamInfo {
  id: string;
  name: string;
  member_ids: string[];
  description?: string | null;
  banner_url?: string | null;
  owner_student_id?: string;
  max_members?: number;
  is_suspended?: boolean;
  class_day?: string | null;
  class_time?: string | null;
}
export type ChatStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

const TYPING_TTL = 5000; // clear a "typing…" indicator this long after the last event
const HEARTBEAT = 25_000; // keep the server-side presence score fresh
const TYPING_THROTTLE = 2000; // send at most one "typing" event per this window

function wsUrl(teamId: string, token: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/v1/community/ws/teams/${teamId}?token=${encodeURIComponent(token)}`;
}

/**
 * Live community chat over a single WebSocket: messages, presence, typing and
 * read receipts. History loads once via REST, then the socket streams deltas.
 * Reconnects with backoff and refreshes the access token on an auth-close.
 */
export function useTeamChat(teamId: string | undefined) {
  const me = useAuth((s) => s.subject);
  const [team, setTeam] = useState<TeamInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<{ id: string; name: string }[]>([]);
  const [reads, setReads] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ChatStatus>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false); // component unmounted — stop reconnecting
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSent = useRef(0);

  const seen = useRef(new Set<string>()); // message ids already in state (dedupe)

  const addMessage = useCallback((m: ChatMessage) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  // --- connection loop -----------------------------------------------------
  useEffect(() => {
    if (!teamId) return;
    closedRef.current = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    // Seed history + team once, then connect the socket.
    (async () => {
      try {
        const data = await unwrap<{ team: TeamInfo; messages: ChatMessage[] }>(
          api.get(`/community/teams/${teamId}/messages`),
        );
        setTeam(data.team);
        seen.current = new Set(data.messages.map((m) => m.id));
        setMessages(data.messages);
      } catch (e) {
        setLoadError((e as Error).message);
        return;
      }
      connect();
    })();

    async function connect() {
      if (closedRef.current) return;
      let token = useAuth.getState().accessToken;
      if (!token) {
        token = await useAuth.getState().refresh();
        if (!token) {
          setStatus('closed');
          return;
        }
      }
      setStatus(retryRef.current ? 'reconnecting' : 'connecting');
      const ws = new WebSocket(wsUrl(teamId!, token));
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setStatus('open');
        heartbeat = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), HEARTBEAT);
      };

      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case 'message':
            addMessage(msg.message);
            break;
          case 'presence':
            setOnline(new Set<string>(msg.online));
            break;
          case 'reads':
            setReads(msg.reads);
            break;
          case 'read':
            setReads((prev) => ({ ...prev, [msg.student_id]: msg.last_read_message_id }));
            break;
          case 'typing':
            handleTyping(msg.student_id, msg.display_name, msg.is_typing);
            break;
          case 'reaction':
            setMessages((prev) =>
              prev.map((m) => (m.id === msg.message_id ? { ...m, reactions: msg.reactions } : m)),
            );
            break;
          case 'team_state':
            setTeam((prev) => (prev ? { ...prev, is_suspended: Boolean(msg.is_suspended) } : prev));
            break;
          case 'error':
            if (msg.message) setChatError(msg.message as string);
            break;
        }
      };

      ws.onclose = async (ev) => {
        if (heartbeat) clearInterval(heartbeat);
        if (closedRef.current) return;
        // 4401 = token rejected → refresh once before the normal backoff.
        if (ev.code === 4401) await useAuth.getState().refresh();
        if (ev.code === 4403) {
          setStatus('closed'); // not a member — don't hammer
          return;
        }
        retryRef.current = Math.min(retryRef.current + 1, 6);
        setStatus('reconnecting');
        setTimeout(connect, Math.min(1000 * 2 ** retryRef.current, 15_000));
      };
    }

    function handleTyping(id: string, name: string, isTyping: boolean) {
      if (id === me) return; // never show my own typing
      clearTimeout(typingTimers.current[id]);
      if (!isTyping) {
        delete typingTimers.current[id];
        setTyping((prev) => prev.filter((t) => t.id !== id));
        return;
      }
      setTyping((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, { id, name }]));
      typingTimers.current[id] = setTimeout(() => {
        delete typingTimers.current[id];
        setTyping((prev) => prev.filter((t) => t.id !== id));
      }, TYPING_TTL);
    }

    return () => {
      closedRef.current = true;
      if (heartbeat) clearInterval(heartbeat);
      Object.values(typingTimers.current).forEach(clearTimeout);
      typingTimers.current = {};
      wsRef.current?.close();
    };
  }, [teamId, me, addMessage]);

  // --- actions -------------------------------------------------------------
  const send = useCallback((text: string, replyToId?: string) => {
    const t = text.trim();
    if (t && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'message', text: t, reply_to_id: replyToId || undefined }));
      wsRef.current.send('{"type":"typing","is_typing":false}');
    }
  }, []);

  const react = useCallback((messageId: string, emoji: string) => {
    if (messageId && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'react', message_id: messageId, emoji }));
    }
  }, []);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE) return; // client-side throttle
    lastTypingSent.current = now;
    if (wsRef.current?.readyState === 1) wsRef.current.send('{"type":"typing","is_typing":true}');
  }, []);

  const markRead = useCallback((messageId: string) => {
    if (messageId && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'read', message_id: messageId }));
    }
  }, []);

  return { team, messages, online, typing, reads, status, loadError, chatError, send, react, notifyTyping, markRead };
}
