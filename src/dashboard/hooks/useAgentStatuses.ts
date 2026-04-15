import { useEffect, useState } from 'react';
import { useWebSocket, isEvent } from './useWebSocket';

// Live status line per role, pushed by the broker's 'agent:status' events.
// Value is the TUI status line (e.g. "Thinking… (12s · ↓ 230 tokens)") or
// null / absent when the agent is idle.
export function useAgentStatuses(projectId: string | undefined): Record<string, string> {
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const { lastEvent } = useWebSocket(projectId);

  useEffect(() => {
    if (!lastEvent || !isEvent(lastEvent, 'agent:status')) return;
    const { role, status } = lastEvent.data as { role: string; status: string | null };
    if (!role) return;
    setStatuses(prev => {
      const next = { ...prev };
      if (status && status.trim()) next[role] = status;
      else delete next[role];
      return next;
    });
  }, [lastEvent]);

  // Reset when project changes so we don't carry stale statuses across.
  useEffect(() => {
    setStatuses({});
  }, [projectId]);

  return statuses;
}
