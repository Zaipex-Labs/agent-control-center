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
      .then(peers => {
        const agentPeers = peers.filter(p => p.agent_type !== 'dashboard');
        // Deduplicate by role (keep latest by last_seen)
        const byRole = new Map<string, typeof agentPeers[0]>();
        for (const p of agentPeers) {
          const existing = byRole.get(p.role);
          if (!existing || p.last_seen > existing.last_seen) {
            byRole.set(p.role, p);
          }
        }
        setAgents(Array.from(byRole.values()));
      })
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
        // Dedupe by role too — if a peer with the same role is already in
        // state (usually a zombie left over from before a restart), drop
        // it and keep only the fresh one. Without this the sidebar ends
        // up showing duplicate rows like "Turing / Turing".
        const filtered = peer.role ? prev.filter(p => p.role !== peer.role) : prev;
        return [...filtered, peer];
      });
    }

    if (isEvent(lastEvent, 'peer:disconnected')) {
      const { id } = lastEvent.data as { id: string };
      setAgents((prev) => prev.filter((p) => p.id !== id));
    }
  }, [lastEvent, projectId]);

  return { agents, loading };
}
