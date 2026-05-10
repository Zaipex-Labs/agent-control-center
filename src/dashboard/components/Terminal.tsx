// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { requestWsToken } from '../lib/api';
import { useCurrentPeerId } from '../hooks/useDashboardPeer';

interface TerminalProps {
  projectId: string;
  role: string;
  visible: boolean;
}

export default function Terminal({ projectId, role, visible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // [Q-10] @types/react@19 removed the no-arg useRef overload.
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retriesRef = useRef(0);
  const peerId = useCurrentPeerId();

  useEffect(() => {
    if (!visible || !containerRef.current || !peerId) return;

    const term = new XTerm({
      theme: {
        background: '#141F2E',
        foreground: '#C8D8E8',
        cursor: '#E8823A',
        cursorAccent: '#141F2E',
        selectionBackground: '#243D5880',
        black: '#0F1824',
        red: '#DC3C3C',
        green: '#3DBA7A',
        yellow: '#E8823A',
        blue: '#4A9FE8',
        magenta: '#534AB7',
        cyan: '#4AC8E8',
        white: '#C8D8E8',
        brightBlack: '#5A6272',
        brightRed: '#E86060',
        brightGreen: '#5AD48E',
        brightYellow: '#F0A050',
        brightBlue: '#70B8F0',
        brightMagenta: '#7A6DD0',
        brightCyan: '#70D8F0',
        brightWhite: '#F0ECE3',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    let cancelled = false;
    async function connect() {
      // [F-3-B] Request a one-shot CSRF token bound to (project, role)
      // and carry it via Sec-WebSocket-Protocol. Browsers don't allow
      // custom headers on WS, but the protocol field IS settable through
      // `new WebSocket(url, [protocol])`. The broker echoes it back on
      // accept so the underlying WS handshake is valid.
      let token: string;
      try {
        token = await requestWsToken(projectId, role, peerId!);
      } catch {
        // Couldn't issue — schedule a retry like a normal close. The
        // token endpoint is gated on a registered peer_id, so failures
        // here usually mean the dashboard peer was just cleaned up; the
        // useDashboardPeer heartbeat will re-register and the next
        // attempt will succeed.
        if (cancelled) return;
        if (retriesRef.current >= 3) return;
        const delay = Math.min(2000 * 2 ** retriesRef.current, 10000);
        retriesRef.current++;
        reconnectTimer.current = setTimeout(connect, delay);
        return;
      }
      if (cancelled) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws/terminal/${encodeURIComponent(role)}?project=${encodeURIComponent(projectId)}`;
      const ws = new WebSocket(url, [`acc-token.${token}`]);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        retriesRef.current = 0;
        term.clear();
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          term.write(ev.data);
        } else {
          term.write(new Uint8Array(ev.data as ArrayBuffer));
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (retriesRef.current >= 3) return; // stop after 3 retries
        const delay = Math.min(2000 * 2 ** retriesRef.current, 10000);
        retriesRef.current++;
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    // Terminal input → WebSocket
    const dataDisposable = term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });

    // Window resize → fit
    const handleWindowResize = () => {
      fit.fit();
    };
    window.addEventListener('resize', handleWindowResize);

    // ResizeObserver for container changes
    const observer = new ResizeObserver(() => {
      fit.fit();
    });
    observer.observe(containerRef.current);

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer.current);
      dataDisposable.dispose();
      window.removeEventListener('resize', handleWindowResize);
      observer.disconnect();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      retriesRef.current = 0;
    };
  }, [projectId, role, visible, peerId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%', height: '100%',
        display: visible ? 'block' : 'none',
        background: '#141F2E',
      }}
    />
  );
}
