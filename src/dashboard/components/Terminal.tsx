import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

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
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const retriesRef = useRef(0);

  useEffect(() => {
    if (!visible || !containerRef.current) return;

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

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws/terminal/${encodeURIComponent(role)}?project=${encodeURIComponent(projectId)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        retriesRef.current = 0;
        term.clear();
        // Send initial size
        const dims = fit.proposeDimensions();
        if (dims) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
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
        const delay = Math.min(1000 * 2 ** retriesRef.current, 15000);
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

    // Terminal resize → WebSocket
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
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
      clearTimeout(reconnectTimer.current);
      dataDisposable.dispose();
      resizeDisposable.dispose();
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
  }, [projectId, role, visible]);

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
