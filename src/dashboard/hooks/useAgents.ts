import { useState, useEffect } from 'react';
import type { Peer } from '../lib/types';
import { listPeers } from '../lib/api';
import { useWebSocket, isEvent } from './useWebSocket';

interface UseAgentsReturn {
  agents: Peer[];
  loading: boolean;
}

export function useAgents(projectId: string | undefined): UseAgentsReturn {
  const [agents, setAgents] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);
  const { lastEvent } = useWebSocket(projectId);

  // Initial fetch
  useEffect(() => {
    if (!projectId) {
      setAgents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    listPeers(projectId)
      .then(peers => setAgents(peers.filter(p => p.agent_type !== 'dashboard')))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Real-time updates
  useEffect(() => {
    if (!projectId || !lastEvent) return;

    if (isEvent(lastEvent, 'peer:connected')) {
      const peer = lastEvent.data as Peer;
      if (peer.agent_type === 'dashboard') return;
      setAgents((prev) => {
        if (prev.some((p) => p.id === peer.id)) return prev;
        return [...prev, peer];
      });
    }

    if (isEvent(lastEvent, 'peer:disconnected')) {
      const { id } = lastEvent.data as { id: string };
      setAgents((prev) => prev.filter((p) => p.id !== id));
    }
  }, [lastEvent, projectId]);

  return { agents, loading };
}
