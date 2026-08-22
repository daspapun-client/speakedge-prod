import { useCallback, useEffect, useRef, useState } from 'react';
import { api, unwrap } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface BatchChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  created_at: string;
}

export type BatchChatStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

const TYPING_TTL = 5000;
const HEARTBEAT = 25_000;
const TYPING_THROTTLE = 2000;

function wsUrl(batchId: string, token: string) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/v1/teacher/ws/batches/${batchId}?token=${encodeURIComponent(token)}`;
}

/** Live batch chat — history via REST, deltas over WebSocket. */
export function useBatchChat(batchId: string | undefined) {
  const me = useAuth((s) => s.subject);
  const [messages, setMessages] = useState<BatchChatMessage[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<BatchChatStatus>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTypingSent = useRef(0);
  const seen = useRef(new Set<string>());

  const addMessage = useCallback((m: BatchChatMessage) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    setMessages((prev) => [...prev, m]);
  }, []);

  useEffect(() => {
    if (!batchId) return;
    closedRef.current = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    (async () => {
      try {
        const data = await unwrap<{ messages: BatchChatMessage[] }>(
          api.get(`/teacher/batches/${batchId}/messages`),
        );
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
      const ws = new WebSocket(wsUrl(batchId!, token));
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
            handleTyping(msg.student_id, msg.display_name, msg.is_typing);
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

    function handleTyping(id: string, name: string, isTyping: boolean) {
      if (id === me) return;
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
  }, [batchId, me, addMessage]);

  const send = useCallback((text: string) => {
    const t = text.trim();
    if (t && wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'message', text: t }));
      wsRef.current.send('{"type":"typing","is_typing":false}');
    }
  }, []);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE) return;
    lastTypingSent.current = now;
    if (wsRef.current?.readyState === 1) wsRef.current.send('{"type":"typing","is_typing":true}');
  }, []);

  return { messages, online, typing, status, loadError, chatError, send, notifyTyping };
}
