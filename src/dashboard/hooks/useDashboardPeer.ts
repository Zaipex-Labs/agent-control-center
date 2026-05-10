// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { registerDashboard } from '../lib/api';

// Context for the dashboard's peer_id. ProjectPage wraps its render
// tree in a Provider so deeply-nested components (AttachmentsRow,
// AttachmentChip, Lightbox) can read the id without prop drilling.
// Needed because the blob endpoint is now peer-scoped [H-2].
export const DashboardPeerContext = createContext<string | undefined>(undefined);

export function useCurrentPeerId(): string | undefined {
  return useContext(DashboardPeerContext);
}

export function useDashboardPeer(projectId: string | undefined): string | undefined {
  const [peerId, setPeerId] = useState<string>();
  const idRef = useRef<string>();
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>();
  const projectRef = useRef(projectId);
  projectRef.current = projectId;

  const register = useCallback(async (pid: string) => {
    try {
      const resp = await registerDashboard(pid);
      idRef.current = resp.id;
      setPeerId(resp.id);
    } catch {
      // Retry once after 2s
      setTimeout(async () => {
        try {
          const resp = await registerDashboard(pid);
          idRef.current = resp.id;
          setPeerId(resp.id);
        } catch {
          // Give up
        }
      }, 2000);
    }
  }, []);

  useEffect(() => {
    if (!projectId) {
      setPeerId(undefined);
      return;
    }

    register(projectId);

    // Heartbeat every 15s — also re-registers if peer was cleaned up
    heartbeatRef.current = setInterval(async () => {
      if (!idRef.current || !projectRef.current) return;
      try {
        const resp = await fetch('/api/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: idRef.current }),
        });
        if (!resp.ok) {
          // Peer was cleaned up — re-register
          await register(projectRef.current);
        }
      } catch {
        // Broker down — try re-register next cycle
      }
    }, 15000);

    return () => {
      clearInterval(heartbeatRef.current);
      idRef.current = undefined;
      setPeerId(undefined);
    };
  }, [projectId, register]);

  return peerId;
}
