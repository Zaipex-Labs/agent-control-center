import { useState, useEffect, useRef } from 'react';
import { registerDashboard, unregisterDashboard } from '../lib/api';

export function useDashboardPeer(projectId: string | undefined): string | undefined {
  const [peerId, setPeerId] = useState<string>();
  const idRef = useRef<string>();
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!projectId) {
      setPeerId(undefined);
      return;
    }

    let cancelled = false;

    registerDashboard(projectId)
      .then((resp) => {
        if (cancelled) return;
        idRef.current = resp.id;
        setPeerId(resp.id);

        // Heartbeat every 20s to stay alive
        heartbeatRef.current = setInterval(() => {
          fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: idRef.current }),
          }).catch(() => {});
        }, 20000);
      })
      .catch((err) => {
        console.error('Dashboard registration failed:', err);
      });

    return () => {
      cancelled = true;
      clearInterval(heartbeatRef.current);
      if (idRef.current) {
        unregisterDashboard(idRef.current);
        idRef.current = undefined;
      }
      setPeerId(undefined);
    };
  }, [projectId]);

  return peerId;
}
