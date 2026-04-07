import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEntryPoint } from '../shared/utils.js';

const log = (msg: string) => console.error(`[broker:terminal] ${msg}`);

const wss = new WebSocketServer({ noServer: true });

// Active agent processes spawned from the web UI
const agentProcesses = new Map<string, ChildProcess>();
// Buffer output so WS clients connecting later see the full history
const outputBuffers = new Map<string, Buffer[]>();
const MAX_BUFFER = 100000; // ~100KB per agent

function processKey(projectId: string, role: string): string {
  return `${projectId}:${role}`;
}

function getServerEntryPath(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolveEntryPoint(thisDir, '..', 'server', 'index.ts');
}

export function spawnWebAgent(projectId: string, role: string, cwd: string, name?: string): ChildProcess {
  const key = processKey(projectId, role);

  // Kill existing if any
  const existing = agentProcesses.get(key);
  if (existing) {
    existing.kill();
    agentProcesses.delete(key);
  }

  const serverPath = getServerEntryPath();
  const runner = serverPath.endsWith('.ts') ? 'npx' : 'node';
  const mcpName = 'zaipex-acc';

  const claudeArgs = [
    '--dangerously-skip-permissions',
    '--dangerously-load-development-channels',
    `server:${mcpName}`,
  ];

  const env = {
    ...process.env,
    ACC_PROJECT: projectId,
    ACC_ROLE: role,
    ...(name ? { ACC_NAME: name } : {}),
    TERM: 'xterm-256color',
  };

  // Use Python PTY wrapper so Claude Code gets a real terminal
  const ptyWrap = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'broker', 'pty-wrap.py');
  const proc = spawn('python3', [ptyWrap, 'claude', ...claudeArgs], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  agentProcesses.set(key, proc);
  outputBuffers.set(key, []);
  log(`spawned web agent ${key} pid=${proc.pid}`);

  // Buffer all output for later WS clients
  const appendBuffer = (data: Buffer) => {
    const buf = outputBuffers.get(key);
    if (!buf) return;
    buf.push(data);
    // Trim if too large (keep last MAX_BUFFER bytes)
    let total = buf.reduce((s, b) => s + b.length, 0);
    while (total > MAX_BUFFER && buf.length > 1) {
      total -= buf.shift()!.length;
    }
  };

  proc.stdout?.on('data', appendBuffer);
  proc.stderr?.on('data', appendBuffer);

  proc.on('exit', (code) => {
    log(`web agent ${key} exited code=${code}`);
    agentProcesses.delete(key);
    outputBuffers.delete(key);
  });

  // Auto-accept channels prompt and send init prompt (polling like the CLI does)
  if (proc.stdin) {
    const stdin = proc.stdin;
    let accepted = false;
    let prompted = false;
    const poll = setInterval(() => {
      if (prompted || !stdin.writable) { clearInterval(poll); return; }
      const buf = outputBuffers.get(key);
      if (!buf || buf.length === 0) return;

      const raw = Buffer.concat(buf).toString();
      // Strip ANSI for matching
      const text = raw.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').replace(/\x1b[^[].?/g, '');

      const noSpaces = text.replace(/\s/g, '');

      if (!accepted && noSpaces.includes('localdevelopment')) {
        log(`auto-accept for ${key}`);
        stdin.write('\r');
        accepted = true;
        return;
      }

      if (accepted && (noSpaces.includes('shortcuts') || noSpaces.includes('bypass')) && !noSpaces.includes('localdevelopment')) {
        const agentName = name || role;
        log(`init prompt for ${key}`);
        setTimeout(() => stdin.write(`Soy ${agentName}, rol ${role}. Ejecuta whoami y set_summary ahora.\r`), 500);
        prompted = true;
        clearInterval(poll);
        return;
      }
    }, 1000);
    // Safety: stop polling after 60s
    setTimeout(() => clearInterval(poll), 60000);
  }

  return proc;
}

export function killWebAgent(projectId: string, role: string): boolean {
  const key = processKey(projectId, role);
  const proc = agentProcesses.get(key);
  if (!proc) return false;
  proc.kill();
  agentProcesses.delete(key);
  return true;
}

export function killAllWebAgents(projectId: string): number {
  let killed = 0;
  for (const [key, proc] of agentProcesses) {
    if (key.startsWith(`${projectId}:`)) {
      proc.kill();
      agentProcesses.delete(key);
      killed++;
    }
  }
  return killed;
}

export function getWebAgent(projectId: string, role: string): ChildProcess | undefined {
  return agentProcesses.get(processKey(projectId, role));
}

export function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, role: string, projectId: string): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    const key = processKey(projectId, role);
    log(`ws connect for ${key}`);

    const proc = agentProcesses.get(key);
    if (!proc || proc.killed) {
      log(`no active process for ${key}`);
      ws.close(1011, 'Agent not running');
      return;
    }

    log(`piping ws to process ${key} pid=${proc.pid}`);

    // Send buffered output first
    const buf = outputBuffers.get(key);
    if (buf) {
      for (const chunk of buf) {
        ws.send(chunk);
      }
    }

    // Process stdout → WebSocket
    const onStdout = (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    };

    const onStderr = (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    };

    proc.stdout?.on('data', onStdout);
    proc.stderr?.on('data', onStderr);

    // Process exit → close WebSocket
    const onExit = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Agent exited');
      }
    };
    proc.on('exit', onExit);

    // WebSocket → process stdin
    ws.on('message', (raw: Buffer | string) => {
      if (!proc.stdin?.writable) return;
      proc.stdin.write(raw.toString());
    });

    // Cleanup on WebSocket close
    ws.on('close', () => {
      log(`ws closed for ${key}`);
      proc.stdout?.off('data', onStdout);
      proc.stderr?.off('data', onStderr);
      proc.off('exit', onExit);
    });

    ws.on('error', () => {
      proc.stdout?.off('data', onStdout);
      proc.stderr?.off('data', onStderr);
      proc.off('exit', onExit);
    });
  });
}
