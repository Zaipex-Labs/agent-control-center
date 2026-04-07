import { useState, useEffect, useCallback, useRef } from 'react';
import type { LogEntry, MessageType } from '../lib/types';
import { getHistory, sendToRole } from '../lib/api';
import { useWebSocket, isEvent } from './useWebSocket';

export interface WaitingReply {
  toRole: string;
  since: number;
}

export interface SendError {
  text: string;
  toRole: string;
}

interface UseMessagesReturn {
  messages: LogEntry[];
  loading: boolean;
  waitingFor: WaitingReply | null;
  sendError: SendError | null;
  clearError: () => void;
  sendMessage: (toRole: string, text: string, type?: MessageType) => Promise<void>;
  retrySend: () => Promise<void>;
}

export function useMessages(
  projectId: string | undefined,
  threadId: string | undefined,
  senderId?: string,
): UseMessagesReturn {
  const [messages, setMessages] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [waitingFor, setWaitingFor] = useState<WaitingReply | null>(null);
  const [sendError, setSendError] = useState<SendError | null>(null);
  const [lastSend, setLastSend] = useState<{ toRole: string; text: string; type: MessageType } | null>(null);
  const waitingTimeout = useRef<ReturnType<typeof setTimeout>>();
  const { lastEvent } = useWebSocket(projectId);

  // Initial fetch
  useEffect(() => {
    if (!projectId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    getHistory(projectId, threadId, 100)
      .then((msgs) => setMessages(msgs.reverse())) // API returns DESC, we want ASC
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [projectId, threadId]);

  // Real-time: append new messages from WebSocket
  useEffect(() => {
    if (!lastEvent || !isEvent(lastEvent, 'message:new')) return;

    const data = lastEvent.data as {
      thread_id: string | null;
      from_name: string;
      from_role: string;
      text: string;
      type: MessageType;
    };

    // Only append if this message belongs to the active thread (or no thread filter)
    if (threadId && data.thread_id !== threadId) return;

    // Skip if this is our own message (already shown via optimistic update)
    if (data.from_role === 'user') return;

    // Agent replied — clear waiting state
    if (waitingFor && data.from_role === waitingFor.toRole) {
      setWaitingFor(null);
      clearTimeout(waitingTimeout.current);
    }

    const synthetic: LogEntry = {
      id: Date.now(),
      project_id: projectId ?? '',
      from_id: '',
      from_role: data.from_role,
      to_id: '',
      to_role: '',
      type: data.type,
      text: data.text,
      metadata: null,
      thread_id: data.thread_id,
      sent_at: new Date().toISOString(),
      session_id: '',
    };

    setMessages((prev) => [...prev, synthetic]);
  }, [lastEvent, threadId, projectId]);

  const doSend = useCallback(
    async (toRole: string, text: string, type: MessageType = 'message', optimistic = true) => {
      if (!projectId || !senderId) return;

      setSendError(null);
      setLastSend({ toRole, text, type });

      if (optimistic) {
        const msg: LogEntry = {
          id: Date.now(),
          project_id: projectId,
          from_id: 'user',
          from_role: 'user',
          to_id: '',
          to_role: toRole,
          type,
          text,
          metadata: null,
          thread_id: threadId ?? null,
          sent_at: new Date().toISOString(),
          session_id: '',
        };
        setMessages((prev) => [...prev, msg]);
      }

      try {
        await sendToRole(projectId, senderId, toRole, text, threadId, type);
        // Show typing indicator
        setWaitingFor({ toRole, since: Date.now() });
        // Timeout after 60s
        clearTimeout(waitingTimeout.current);
        waitingTimeout.current = setTimeout(() => {
          setWaitingFor(null);
        }, 60000);
      } catch (e) {
        // Remove the optimistic message
        if (optimistic) {
          setMessages((prev) => prev.filter(m => !(m.from_id === 'user' && m.text === text)));
        }
        setSendError({ text, toRole });
      }
    },
    [projectId, senderId, threadId],
  );

  const sendMessage = useCallback(
    (toRole: string, text: string, type?: MessageType) => doSend(toRole, text, type ?? 'message', true),
    [doSend],
  );

  const retrySend = useCallback(async () => {
    if (!lastSend) return;
    setSendError(null);
    await doSend(lastSend.toRole, lastSend.text, lastSend.type, true);
  }, [lastSend, doSend]);

  const clearError = useCallback(() => {
    setSendError(null);
    setLastSend(null);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => () => clearTimeout(waitingTimeout.current), []);

  return { messages, loading, waitingFor, sendError, clearError, sendMessage, retrySend };
}
