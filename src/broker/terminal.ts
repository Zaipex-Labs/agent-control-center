import { WebSocketServer, WebSocket } from 'ws';
import { execSync, spawn } from 'node:child_process';
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
    const session = `acc-${projectId}`;
    const target = `${session}:${role}`;
    log(`connecting to tmux ${target}`);

    // Verify session exists
    try {
      execSync(`tmux has-session -t ${session}`, { stdio: 'pipe' });
    } catch {
      log(`session ${session} not found`);
      ws.close(1011, 'tmux session not found');
      return;
    }

    // Send initial screen capture
    try {
      const capture = execSync(`tmux capture-pane -t ${target} -p -e`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(capture);
      }
    } catch { /* best effort */ }

    // Poll tmux pane content every 500ms and send diffs
    let lastContent = '';
    const pollInterval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const content = execSync(`tmux capture-pane -t ${target} -p -e`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 2000,
        });
        if (content !== lastContent) {
          // Clear screen and redraw
          ws.send('\x1b[2J\x1b[H' + content);
          lastContent = content;
        }
      } catch { /* tmux may be gone */ }
    }, 500);

    // WebSocket input → tmux send-keys
    ws.on('message', (raw: Buffer | string) => {
      const msg = raw.toString();

      try {
        const parsed: unknown = JSON.parse(msg);
        if (isResizeMessage(parsed)) {
          try {
            execSync(`tmux resize-pane -t ${target} -x ${parsed.cols} -y ${parsed.rows}`, { stdio: 'pipe' });
          } catch { /* best effort */ }
          return;
        }
      } catch {
        // Not JSON — terminal input
      }

      // Send keystrokes to tmux
      try {
        // Use -l for literal text to avoid key interpretation issues
        execSync(`tmux send-keys -t ${target} -l ${shellEscape(msg)}`, { stdio: 'pipe', timeout: 2000 });
      } catch { /* best effort */ }
    });

    ws.on('close', () => {
      log(`ws closed for ${target}`);
      clearInterval(pollInterval);
    });

    ws.on('error', () => {
      clearInterval(pollInterval);
    });
  });
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
