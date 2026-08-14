import { useCallback, useEffect, useRef, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface DirectMessage {
  id: string;
  sender_student_id: string;
  to_student_id: string;
  text: string;
  is_read?: boolean;
  created_at: string;
  reply_to_id?: string | null;
  reply_to_sender_name?: string | null;
  reply_to_text?: string | null;
  reactions?: Record<string, string[]>;
}
export interface FriendInfo {
  student_id: string;
  display_name: string;
  first_name?: string | null;
  photo_url?: string | null;
  cefr_level?: string | null;
}
export type ChatStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

const HEARTBEAT = 25_000;
const TYPING_TTL = 5000;
const TYPING_THROTTLE = 2000;

function wsUrl(studentId: string, token: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/v1/community/ws/dm/${studentId}?token=${encodeURIComponent(token)}`;
}

export function useDirectChat(studentId: string | undefined) {
  const me = useAuth((s) => s.subject);
  const [friend, setFriend] = useState<FriendInfo | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState(false);
  const [status, setStatus] = useState<ChatStatus>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSent = useRef(0);
  const seen = useRef(new Set<string>());

  const addMessage = useCallback((m: DirectMessage) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  useEffect(() => {
    if (!studentId) return;
    closedRef.current = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        const data = await unwrap<{ friend: FriendInfo; messages: DirectMessage[] }>(
          api.get(`/community/dm/${studentId}`),
        );
        setFriend(data.friend);
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
      const ws = new WebSocket(wsUrl(studentId!, token));
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
          case 'typing':
            handleTyping(msg.student_id, msg.is_typing);
            break;
          case 'reaction':
            setMessages((prev) =>
              prev.map((m) => (m.id === msg.message_id ? { ...m, reactions: msg.reactions } : m)),
            );
            break;
          case 'error':
            if (msg.message) setChatError(msg.message as string);
            break;
        }
      };

      ws.onclose = async (ev) => {
        if (heartbeat) clearInterval(heartbeat);
        if (closedRef.current) return;
        if (ev.code === 4401) await useAuth.getState().refresh();
        if (ev.code === 4403) {
          setStatus('closed');
          return;
        }
        retryRef.current = Math.min(retryRef.current + 1, 6);
        setStatus('reconnecting');
        setTimeout(connect, Math.min(1000 * 2 ** retryRef.current, 15_000));
      };
    }

    function handleTyping(id: string, isTyping: boolean) {
      if (id === me) return;
      clearTimeout(typingTimer.current);
      if (!isTyping) {
        setTyping(false);
        return;
      }
      setTyping(true);
      typingTimer.current = setTimeout(() => setTyping(false), TYPING_TTL);
    }

    return () => {
      closedRef.current = true;
      if (heartbeat) clearInterval(heartbeat);
      clearTimeout(typingTimer.current);
      wsRef.current?.close();
    };
  }, [studentId, me, addMessage]);

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
    if (now - lastTypingSent.current < TYPING_THROTTLE) return;
    lastTypingSent.current = now;
    if (wsRef.current?.readyState === 1) wsRef.current.send('{"type":"typing","is_typing":true}');
  }, []);

  return { friend, messages, online, typing, status, loadError, chatError, send, react, notifyTyping };
}
