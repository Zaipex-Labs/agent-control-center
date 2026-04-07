import { useState, useEffect } from 'react';
import { registerDashboard, unregisterDashboard } from '../lib/api';

export function useDashboardPeer(projectId: string | undefined): string | undefined {
  const [peerId, setPeerId] = useState<string>();

  useEffect(() => {
    if (!projectId) {
      setPeerId(undefined);
      return;
    }

    let id: string | undefined;

    registerDashboard(projectId)
      .then((resp) => {
        id = resp.id;
        setPeerId(id);
      })
      .catch(() => {});

    return () => {
      if (id) unregisterDashboard(id);
      setPeerId(undefined);
    };
  }, [projectId]);

  return peerId;
}
