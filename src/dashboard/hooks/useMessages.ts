import { useState, useEffect, useCallback } from 'react';
import type { LogEntry, MessageType } from '../lib/types';
import { getHistory, sendToRole } from '../lib/api';
import { useWebSocket, isEvent } from './useWebSocket';

interface UseMessagesReturn {
  messages: LogEntry[];
  loading: boolean;
  sendMessage: (toRole: string, text: string, type?: MessageType) => Promise<void>;
}

export function useMessages(
  projectId: string | undefined,
  threadId: string | undefined,
  senderId?: string,
): UseMessagesReturn {
  const [messages, setMessages] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
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

  const sendMessage = useCallback(
    async (toRole: string, text: string, type: MessageType = 'message') => {
      if (!projectId || !senderId) return;

      // Optimistic: show message immediately
      const optimistic: LogEntry = {
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
      setMessages((prev) => [...prev, optimistic]);

      await sendToRole(projectId, senderId, toRole, text, threadId, type);
    },
    [projectId, senderId, threadId],
  );

  return { messages, loading, sendMessage };
}
