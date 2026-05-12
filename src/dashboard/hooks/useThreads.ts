// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

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

export function activeThreadStorageKey(projectId: string): string {
  return `acc.activeThread.${projectId}`;
}

// Persist the active-thread selection so reloads land on the right thread.
// Exported for testing — guards against Q-9 (passing an updater function would
// store the literal string "undefined" in localStorage because `fn.id` is undefined).
export function persistActiveThread(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  projectId: string,
  thread: Thread | null,
): void {
  if (thread === null) {
    storage.removeItem(activeThreadStorageKey(projectId));
    return;
  }
  if (typeof thread !== 'object' || typeof thread.id !== 'string') {
    throw new Error('persistActiveThread: thread must be Thread | null, not a function or other value');
  }
  storage.setItem(activeThreadStorageKey(projectId), thread.id);
}

export function useThreads(projectId: string | undefined, peerId: string | undefined): UseThreadsReturn {
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
      persistActiveThread(localStorage, projectId, thread);
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
      if (activeThread?.id === data.id) setActiveThread(null);
    }
  }, [lastEvent, activeThread, setActiveThread]);

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
      // Dedup by id — the WS `thread:created` event may have already
      // pushed this thread between the await resolving and us running.
      // Mirrors the guard in the WS handler above (line 89). Without
      // this, smoke-testing in v0.4.2 surfaced a reproducible duplicate
      // entry on every "+ Nuevo" + Enter.
      setThreads((prev) => {
        if (prev.some((t) => t.id === newThread.id)) return prev;
        return [...prev, newThread];
      });
      setActiveThread(newThread);
    },
    [projectId],
  );

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!projectId || !peerId) return;
      await apiDeleteThread(projectId, threadId, peerId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThread?.id === threadId) setActiveThread(null);
    },
    [projectId, peerId, setActiveThread, activeThread],
  );

  return { threads, activeThread, setActiveThread, createThread, deleteThread, loading };
}
