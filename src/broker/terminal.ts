import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolveEntryPoint } from '../shared/utils.js';
import { selectPeersByProject, getSharedState, deleteSharedState } from './database.js';

// Locate a usable python3 binary. When the broker is launched via nohup /
// launchd the PATH can lose /usr/local/bin or /opt/homebrew/bin, and
// macOS's /usr/bin/python3 is a stub that needs CLT. Probe common paths.
let pythonPathCache: string | null = null;
function findPython3(): string {
  if (pythonPathCache) return pythonPathCache;
  const candidates = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    '/usr/bin/python3',
    'python3',
  ];
  for (const c of candidates) {
    if (c === 'python3' || existsSync(c)) {
      pythonPathCache = c;
      return c;
    }
  }
  pythonPathCache = 'python3';
  return 'python3';
}

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

export function spawnWebAgent(projectId: string, role: string, cwd: string, name?: string, model?: string): ChildProcess {
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
  // Claude Code accepts --model <id> to pin a specific model for the
  // session. We forward whatever the user picked in the Agent editor so
  // roles can run on different models (opus for architect, haiku for qa).
  if (model && model.trim()) {
    claudeArgs.push('--model', model.trim());
  }

  const env = {
    ...process.env,
    ACC_PROJECT: projectId,
    ACC_ROLE: role,
    ...(name ? { ACC_NAME: name } : {}),
    TERM: 'xterm-256color',
  };

  // Use Python PTY wrapper so Claude Code gets a real terminal
  const ptyWrap = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'broker', 'pty-wrap.py');
  const pythonBin = findPython3();
  const proc = spawn(pythonBin, [ptyWrap, 'claude', ...claudeArgs], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Must attach error handler before any other event — otherwise an ENOENT
  // from spawn bubbles up as an unhandled 'error' and crashes the broker.
  proc.on('error', (err) => {
    log(`web agent ${key} spawn error: ${err.message}`);
    agentProcesses.delete(key);
    outputBuffers.delete(key);
  });

  agentProcesses.set(key, proc);
  outputBuffers.set(key, []);
  log(`spawned web agent ${key} pid=${proc.pid} via ${pythonBin}`);

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

  // Boot sequence for the web agent, in order:
  //
  //   1. Claude Code starts and shows the "local development channel" prompt.
  //      We press Enter to accept it.
  //   2. Claude Code finishes loading and renders the shortcuts/bypass banner.
  //   3. The MCP server inside Claude connects to our broker and calls
  //      /api/register. Only now does the agent know its own name/role —
  //      before this point, typing a message results in Claude answering
  //      without knowing it is "Turing (backend)".
  //   4. Once we see the peer in the broker's DB, we send the init prompt.
  //
  // Step 3 is the one that was missing: previously we sent the prompt as soon
  // as the shortcuts banner appeared, which raced against the MCP handshake
  // and some agents ended up answering before they knew who they were.
  if (proc.stdin) {
    const stdin = proc.stdin;
    let accepted = false;
    let bannerSeen = false;
    let prompted = false;
    const bootStart = Date.now();
    let dumpedStuck = false;
    const poll = setInterval(() => {
      if (!bannerSeen && !dumpedStuck && Date.now() - bootStart > 8000) {
        dumpedStuck = true;
        const buf = outputBuffers.get(key);
        const raw = buf ? Buffer.concat(buf).toString() : '(empty)';
        const stripped = raw.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').replace(/\x1b[^[].?/g, '');
        log(`boot stuck for ${key} after 8s — buffer tail: ${JSON.stringify(stripped.slice(-500))}`);
      }
      if (prompted || !stdin.writable) { clearInterval(poll); return; }
      const buf = outputBuffers.get(key);

      if (!bannerSeen) {
        if (!buf || buf.length === 0) return;
        const raw = Buffer.concat(buf).toString();
        // Strip ANSI for matching
        const text = raw.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').replace(/\x1b[^[].?/g, '');
        const noSpaces = text.replace(/\s/g, '');

        if (!accepted && noSpaces.includes('localdevelopment')) {
          log(`auto-accept for ${key}`);
          stdin.write('\r');
          accepted = true;
          // Clear buffer so old text doesn't interfere with next check
          outputBuffers.set(key, []);
          return;
        }

        // "Trust this folder?" prompt — fires the first time Claude Code
        // opens a new directory. Default highlight is already on "Yes",
        // so \r confirms. We don't set `accepted` here because the dev
        // channel prompt may still come after.
        if (noSpaces.includes('trustthisfolder')) {
          log(`trust-folder accept for ${key}`);
          stdin.write('\r');
          outputBuffers.set(key, []);
          return;
        }

        // When the project folder already has the dev channel approved, the
        // prompt is skipped entirely and we go straight to the banner. Accept
        // the banner either after an explicit accept or without one.
        if (noSpaces.includes('shortcuts') || noSpaces.includes('bypass')) {
          log(`banner ready for ${key}${accepted ? '' : ' (no accept needed)'} — waiting for MCP registration`);
          bannerSeen = true;
          return;
        }
        return;
      }

      // Banner is up. Wait until the MCP server inside Claude has registered
      // this (project, role) with the broker. Only then does the agent know
      // its own identity well enough to act on the init prompt.
      try {
        const peers = selectPeersByProject(projectId);
        const mine = peers.find(p => p.role === role && p.agent_type !== 'dashboard');
        if (mine) {
          const agentName = mine.name || name || role;
          log(`init prompt for ${key} (peer ${mine.id} registered)`);

          // Pull any saved resume snapshot for this role so the agent can
          // pick up where it left off. Two possible formats:
          //   - agent-authored: { summary, next_steps, open_questions, updated_at }
          //   - mechanical baseline: { summary, last_messages, shutdown_at }
          // We format whichever fields are present.
          let resumeBlock = '';
          try {
            const entry = getSharedState(projectId, 'resume', role);
            if (entry) {
              const data = JSON.parse(entry.value) as {
                summary?: string;
                next_steps?: unknown;
                open_questions?: unknown;
                last_messages?: Array<{ from_role: string; to_role: string; text: string; at: string }>;
                updated_at?: string;
                shutdown_at?: string;
              };
              const lines: string[] = [];
              if (data.summary) lines.push(`Estado previo: ${data.summary}`);
              if (Array.isArray(data.next_steps) && data.next_steps.length > 0) {
                const steps = data.next_steps.filter((s): s is string => typeof s === 'string');
                if (steps.length > 0) lines.push(`Próximos pasos: ${steps.join(' · ')}`);
              }
              if (Array.isArray(data.open_questions) && data.open_questions.length > 0) {
                const qs = data.open_questions.filter((s): s is string => typeof s === 'string');
                if (qs.length > 0) lines.push(`Pendientes: ${qs.join(' · ')}`);
              }
              if (data.last_messages && data.last_messages.length > 0 && !data.next_steps) {
                // Only show the raw last-messages fallback if we don't have
                // the richer agent-authored fields — otherwise it's noise.
                lines.push('Últimos mensajes:');
                for (const m of data.last_messages) {
                  const who = m.from_role === role ? `Tú → ${m.to_role}` : `${m.from_role} → Tú`;
                  lines.push(`  - ${who}: ${m.text.slice(0, 200)}`);
                }
              }
              if (lines.length > 0) {
                resumeBlock = ` Contexto de tu sesión anterior: ${lines.join(' | ')}`;
              }
              // One-shot: consume the snapshot so we don't keep replaying it
              // on every restart. If the user shuts down again, a new one
              // is captured.
              deleteSharedState(projectId, 'resume', role);
            }
          } catch (e) {
            log(`resume load failed for ${key}: ${e instanceof Error ? e.message : String(e)}`);
          }

          // Claude Code's TUI treats a combined "text\r" single write as
          // "text + newline in the input box" (the \r lands inside the
          // textarea like Shift+Enter). Tmux avoids this by typing the
          // literal text and then sending Enter as a SEPARATE keypress.
          // Replicate that by writing the body first, waiting a moment,
          // and then writing \r on its own so the TUI interprets it as
          // the submit key instead of a line break.
          const body = `Soy ${agentName}, rol ${role}. Ejecuta whoami y set_summary ahora.${resumeBlock}`;
          setTimeout(() => {
            stdin.write(body);
            setTimeout(() => stdin.write('\r'), 250);
          }, 600);
          prompted = true;
          clearInterval(poll);
        }
      } catch (err) {
        log(`peer check failed for ${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 1000);
    // Safety: stop polling after 60s so a stuck boot doesn't leave the
    // interval running forever.
    setTimeout(() => clearInterval(poll), 60000);

    // ── Continuous auto-continue watcher ─────────────────────
    //
    // After the boot prompt is sent, some Claude Code turns stall at a
    // "Continue?" style prompt after many tool calls. --dangerously-
    // skip-permissions bypasses most permissions but not this one.
    // Since web agents have no human at the terminal, we watch the
    // output buffer and auto-send Enter whenever a known stall pattern
    // shows up. The tail window (last 400 chars) is checked every 2s.
    const seen = new Set<string>();
    const STALL_PATTERNS = [
      /press\s+enter\s+to\s+continue/i,
      /do you want to continue\s*\(y\/n\)/i,
      /continue\?\s*\[y\/n\]/i,
      /\(y\/n\)\s*$/i,
      /press any key to continue/i,
      /\benter\b.*\bto continue\b/i,
    ];
    const autoContinue = setInterval(() => {
      if (proc.killed || !stdin.writable) {
        clearInterval(autoContinue);
        return;
      }
      const buf = outputBuffers.get(key);
      if (!buf || buf.length === 0) return;
      const tail = Buffer.concat(buf).toString().slice(-400);
      // Strip ANSI for matching
      const text = tail.replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '').replace(/\x1b[^[].?/g, '');
      for (const re of STALL_PATTERNS) {
        const m = text.match(re);
        if (!m) continue;
        // Fingerprint by surrounding chars so we don't re-fire on the
        // same prompt if it hasn't scrolled off yet.
        const fp = m[0] + text.length;
        if (seen.has(fp)) continue;
        seen.add(fp);
        log(`auto-continue for ${key}: matched "${m[0].trim()}"`);
        try { stdin.write('\r'); } catch { /* ignore */ }
        break;
      }
    }, 2000);
    proc.on('exit', () => clearInterval(autoContinue));
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
