import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const log = (msg: string) => console.error(`[broker:terminal] ${msg}`);

const wss = new WebSocketServer({ noServer: true });

interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

function isResizeMessage(data: unknown): data is ResizeMessage {
  return typeof data === 'object' && data !== null &&
    (data as Record<string, unknown>).type === 'resize' &&
    typeof (data as Record<string, unknown>).cols === 'number' &&
    typeof (data as Record<string, unknown>).rows === 'number';
}

export function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, role: string, projectId: string): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const sessionTarget = `acc-${projectId}:${role}`;
    log(`connecting to tmux session ${sessionTarget}`);

    let term: pty.IPty;
    try {
      term = pty.spawn('tmux', ['attach', '-t', sessionTarget], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      });
    } catch (err) {
      log(`failed to spawn pty for ${sessionTarget}: ${err}`);
      ws.close(1011, 'Failed to attach to tmux session');
      return;
    }

    log(`pty spawned pid=${term.pid} for ${sessionTarget}`);

    // pty → ws
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // pty exit → close ws
    term.onExit(({ exitCode }) => {
      log(`pty exited code=${exitCode} for ${sessionTarget}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'PTY process exited');
      }
    });

    // ws → pty
    ws.on('message', (raw: Buffer | string) => {
      const msg = raw.toString();

      // Try to parse as JSON for resize commands
      try {
        const parsed: unknown = JSON.parse(msg);
        if (isResizeMessage(parsed)) {
          term.resize(parsed.cols, parsed.rows);
          return;
        }
      } catch {
        // Not JSON — treat as terminal input
      }

      term.write(msg);
    });

    // ws close → kill pty
    ws.on('close', () => {
      log(`ws closed for ${sessionTarget}, killing pty pid=${term.pid}`);
      term.kill();
    });

    ws.on('error', (err) => {
      log(`ws error for ${sessionTarget}: ${err}`);
      term.kill();
    });
  });
}
