// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { WsEvent, BrokerEvent } from '../lib/types';

interface UseWebSocketReturn {
  events: WsEvent[];
  lastEvent: WsEvent | null;
  connected: boolean;
}

export function useWebSocket(projectId: string | undefined): UseWebSocketReturn {
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (!projectId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?project_id=${encodeURIComponent(projectId)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retriesRef.current = 0;
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data as string) as WsEvent;
        setLastEvent(parsed);
        setEvents((prev) => [...prev.slice(-200), parsed]);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect with exponential backoff (max 30s)
      const delay = Math.min(1000 * 2 ** retriesRef.current, 30000);
      retriesRef.current++;
      timerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [projectId]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(timerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
      setEvents([]);
      setLastEvent(null);
      retriesRef.current = 0;
    };
  }, [connect]);

  return { events, lastEvent, connected };
}

// Helper to check if a WsEvent matches a specific event type
export function isEvent(event: WsEvent | null, type: BrokerEvent): boolean {
  return event?.event === type;
}
