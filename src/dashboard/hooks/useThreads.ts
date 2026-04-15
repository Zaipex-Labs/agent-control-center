import { useState, useEffect, useCallback } from 'react';
import type { Thread } from '../lib/types';
import { listThreads as fetchThreads, createThread as apiCreateThread, deleteThread as apiDeleteThread } from '../lib/api';
import { useWebSocket, isEvent } from './useWebSocket';

interface UseThreadsReturn {
  threads: Thread[];
  activeThread: Thread | null;
  setActiveThread: (thread: Thread | null) => void;
  createThread: (name: string) => Promise<void>;
  deleteThread: (threadId: string) => Promise<void>;
  loading: boolean;
}

function activeThreadStorageKey(projectId: string): string {
  return `acc.activeThread.${projectId}`;
}

export function useThreads(projectId: string | undefined): UseThreadsReturn {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThreadState] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const { lastEvent } = useWebSocket(projectId);

  // Wrapper so every write also persists the id to localStorage. Keeps
  // the selection across reloads — without this you always landed on the
  // empty-office view after F5.
  const setActiveThread = useCallback((thread: Thread | null) => {
    setActiveThreadState(thread);
    if (!projectId) return;
    try {
      const key = activeThreadStorageKey(projectId);
      if (thread) localStorage.setItem(key, thread.id);
      else localStorage.removeItem(key);
    } catch { /* ignore */ }
  }, [projectId]);

  // Initial fetch + restore the previously-selected thread from storage.
  useEffect(() => {
    if (!projectId) {
      setThreads([]);
      setActiveThreadState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchThreads(projectId)
      .then(list => {
        setThreads(list);
        try {
          const storedId = localStorage.getItem(activeThreadStorageKey(projectId));
          if (storedId) {
            const restored = list.find(t => t.id === storedId);
            if (restored) setActiveThreadState(restored);
          }
        } catch { /* ignore */ }
      })
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Real-time updates
  useEffect(() => {
    if (!lastEvent) return;

    if (isEvent(lastEvent, 'thread:created')) {
      const thread = lastEvent.data as Thread;
      setThreads((prev) => {
        if (prev.some((t) => t.id === thread.id)) return prev;
        return [...prev, thread];
      });
    }

    if (isEvent(lastEvent, 'thread:updated')) {
      const update = lastEvent.data as { id: string; name?: string; status?: string };
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== update.id) return t;
          return {
            ...t,
            ...(update.name !== undefined && { name: update.name }),
            ...(update.status !== undefined && { status: update.status as Thread['status'] }),
            updated_at: new Date().toISOString(),
          };
        }),
      );
    }

    if (isEvent(lastEvent, 'thread:deleted')) {
      const data = lastEvent.data as { id: string };
      setThreads((prev) => prev.filter((t) => t.id !== data.id));
      setActiveThread((cur) => (cur?.id === data.id ? null : cur));
    }
  }, [lastEvent]);

  const createThread = useCallback(
    async (name: string) => {
      if (!projectId) return;
      const { id, name: threadName } = await apiCreateThread(projectId, name);
      const newThread: Thread = {
        id,
        project_id: projectId,
        name: threadName,
        status: 'active',
        summary: '',
        created_by: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      setThreads((prev) => [...prev, newThread]);
      setActiveThread(newThread);
    },
    [projectId],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!projectId) return;
      await apiDeleteThread(projectId, threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      setActiveThread((cur) => (cur?.id === threadId ? null : cur));
    },
    [projectId],
  );

  return { threads, activeThread, setActiveThread, createThread, deleteThread, loading };
}
