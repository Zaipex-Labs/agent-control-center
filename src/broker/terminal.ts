// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { selectPeersByProject, getSharedState, deleteSharedState } from './database.js';
import { broadcast } from './websocket.js';
import { isAllowedOrigin, rejectUpgrade } from './origin.js';
import { consumeToken } from './csrf-tokens.js';
import { prepareAgentMcpConfig } from '../cli/mcp-config.js';
import { recordSpawnPhase } from './spawn-state.js';
import { swallow } from '../shared/log.js';

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

// handleProtocols runs during wss.handleUpgrade and decides which
// subprotocol (if any) to echo back in the response. We use it purely
// to satisfy the WS protocol negotiation when the dashboard sends
// `acc-token.<hex>` — the token itself was already validated and
// consumed by handleTerminalUpgrade BEFORE handleUpgrade was called.
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols: (protocols) => {
    for (const p of protocols) {
      if (typeof p === 'string' && p.startsWith('acc-token.')) return p;
    }
    return false;
  },
});

const ACC_TOKEN_PROTO = 'acc-token.';

function extractAccToken(req: IncomingMessage): string | null {
  // The Sec-WebSocket-Protocol header arrives as a comma-separated
  // string when multiple subprotocols are offered. We only care about
  // the `acc-token.<hex>` entry — anything else the dashboard offers
  // (xterm.js doesn't send any today, but be liberal) is ignored.
  const raw = req.headers['sec-websocket-protocol'];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  for (const p of raw.split(',').map(s => s.trim())) {
    if (p.startsWith(ACC_TOKEN_PROTO)) return p.slice(ACC_TOKEN_PROTO.length);
  }
  return null;
}

// Active agent processes spawned from the web UI
const agentProcesses = new Map<string, ChildProcess>();
// Buffer output so WS clients connecting later see the full history
const outputBuffers = new Map<string, Buffer[]>();
// Track every live /ws/terminal/* WebSocket so the lifecycle path
// (QW-5 shutdownBroker) can close them BEFORE we kill the underlying
// agent process. Without this Set the WS-close happens indirectly via
// the proc 'exit' handler, which is racy on shutdown.
const terminalClients = new Set<WebSocket>();
const MAX_BUFFER = 100000; // ~100KB per agent
// Last-seen live status line per agent ("Nesting… (1m 11s · ↓ 1.0k tokens)")
// so we only broadcast when it actually changes, and new WS clients can
// hydrate without us flooding.
const agentStatus = new Map<string, string>();
// When the same status string was last seen. Claude Code's TUI bumps the
// `(Xs)` counter every second while active, so if the string is identical
// for more than STALE_MS we know the agent is idle and the line is just
// lingering in the scrollback.
const agentStatusLastSeen = new Map<string, number>();
const STALE_MS = 2000;

export function getAgentStatus(key: string): string | undefined {
  return agentStatus.get(key);
}

// Match Claude Code's TUI status line. Shape examples:
//   Nesting… (1m 11s · ↓ 1.0k tokens · thought for 2s)
//   Thinking… (12s · ↑ 234 tokens)
//   Reading config.ts… (3s · esc to interrupt)
// The action word is the first token ending in … or ..., the parens hold
// the live metadata. We trim off "esc to interrupt" noise.
const STATUS_LINE_RE = /\b([A-Z][a-zA-Z]+)(?:…|\.\.\.)\s*\(([^)]+)\)/g;

export function extractStatusLine(raw: string): string | null {
  // Strip ANSI control codes so regex actually matches
  const text = raw
    .replace(/\x1b\[[^a-zA-Z]*[a-zA-Z]/g, '')
    .replace(/\x1b[^[].?/g, '');
  // Only look at the last ~400 chars — that's what's on screen in the
  // Claude Code TUI right now. Scrollback above it is not visible and
  // anything matched up there would be stale.
  const window = text.slice(-400);
  // Idle detection: Claude Code's input box renders rounded-corner
  // borders (╭╮╰╯) when it's waiting for input. If we see any of those
  // the agent is not working — return null immediately. This is
  // cheaper and more reliable than aging out via STALE_MS alone.
  if (/[╭╮╰╯]/.test(window)) return null;

  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  STATUS_LINE_RE.lastIndex = 0;
  while ((m = STATUS_LINE_RE.exec(window)) !== null) {
    last = m;
  }
  if (!last) return null;
  // Require the match to be close to the very end of the window so
  // we don't latch onto old "Reading…" prints that scrolled by.
  if (last.index < window.length - 200) return null;
  const action = last[1];
  const meta = last[2]
    .replace(/\s*·\s*esc to interrupt\s*$/i, '')
    .trim();
  return meta ? `${action}… (${meta})` : `${action}…`;
}

function pollStatusLine(projectId: string, role: string): void {
  const key = processKey(projectId, role);
  const buf = outputBuffers.get(key);
  if (!buf || buf.length === 0) return;
  // Only look at the tail — status lines are always at the bottom of the
  // TUI, and scanning the whole buffer is wasted work.
  const tail = Buffer.concat(buf).toString().slice(-1500);
  const parsed = extractStatusLine(tail);
  const prev = agentStatus.get(key);
  const now = Date.now();

  // No status line in the tail at all — clear immediately if we had one.
  if (!parsed) {
    if (prev) {
      agentStatus.delete(key);
      agentStatusLastSeen.delete(key);
      broadcast('agent:status', { role, status: null }, projectId);
    }
    return;
  }

  // The string changed (counter ticked or action swapped) — live update.
  if (parsed !== prev) {
    agentStatus.set(key, parsed);
    agentStatusLastSeen.set(key, now);
    broadcast('agent:status', { role, status: parsed }, projectId);
    return;
  }

  // Same string as before. Check age: if the counter hasn't ticked in
  // STALE_MS the agent is idle and the line is just stuck in scrollback.
  const lastChange = agentStatusLastSeen.get(key) ?? now;
  if (now - lastChange > STALE_MS) {
    agentStatus.delete(key);
    agentStatusLastSeen.delete(key);
    broadcast('agent:status', { role, status: null }, projectId);
  }
}

function processKey(projectId: string, role: string): string {
  return `${projectId}:${role}`;
}

export function spawnWebAgent(
  projectId: string,
  role: string,
  cwd: string,
  name?: string,
  model?: string,
  powers?: string[],
): ChildProcess {
  const key = processKey(projectId, role);

  // Kill existing if any
  const existing = agentProcesses.get(key);
  if (existing) {
    existing.kill();
    agentProcesses.delete(key);
  }

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

  // FASE A-2 (v0.3.2). Resolve the agent's powers against the registry
  // and write a per-agent --mcp-config JSON. Warnings (unknown power,
  // missing env) land on broker stderr alongside the spawn log; the
  // dashboard surfaces them via the existing terminal-buffer stream
  // because they tail into the agent's stderr capture.
  const prep = prepareAgentMcpConfig(projectId, { powers, cwd, role });
  for (const w of prep.warnings) {
    log(w);
  }
  if (prep.configPath) {
    claudeArgs.push('--mcp-config', prep.configPath);
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

  // FASE C-1 (v0.3.2). First milestone: PTY child spawned. The
  // dashboard's per-agent checklist ticks 1/3 here.
  //
  // v0.3.3 PRE-4 (MED-7a): record into the broker's in-memory
  // spawn-state map BEFORE emitting the WS event. This event fires
  // ~50ms after the broker receives /api/project/up; the dashboard's
  // WS handshake often hasn't completed yet, so broadcast() drops the
  // frame (websocket.ts:120). The state map persists across that
  // window, and the dashboard fetches it once on mount via
  // /api/project/:id/spawn-state to backfill any lost events.
  recordSpawnPhase(projectId, role, 'pty_ready');
  broadcast('agent:spawning', { role, phase: 'pty_ready' }, projectId);

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
          // FASE C-1 (v0.3.2). Second milestone: Claude finished
          // loading its MCP servers (the shortcuts/bypass banner is the
          // canonical signal). registered fires later from
          // handleRegister when the in-agent MCP server hits the
          // broker's /api/register.
          // v0.3.3 PRE-4 (MED-7a): record BEFORE emit — see pty_ready
          // site above for the full rationale.
          recordSpawnPhase(projectId, role, 'mcp_ready');
          broadcast('agent:spawning', { role, phase: 'mcp_ready' }, projectId);
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
        swallow('terminal:auto-continue-write', () => stdin.write('\r'));
        break;
      }
    }, 2000);
    proc.on('exit', () => clearInterval(autoContinue));

    // Live status line poller. Reads the PTY output tail every ~800ms
    // and broadcasts 'agent:status' when the line changes. This is what
    // surfaces "Thinking… (12s · ↓ 230 tokens)" on the dashboard card.
    const statusPoll = setInterval(() => {
      if (proc.killed) { clearInterval(statusPoll); return; }
      pollStatusLine(projectId, role);
    }, 800);
    proc.on('exit', () => {
      clearInterval(statusPoll);
      // Emit one final clear so the UI drops the dots when the agent dies.
      if (agentStatus.has(key)) {
        agentStatus.delete(key);
        agentStatusLastSeen.delete(key);
        broadcast('agent:status', { role, status: null }, projectId);
      }
    });
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

// Kill EVERY web agent across all projects. Called from the broker
// shutdown path (QW-5) so we don't leave PTY children orphaned when
// the broker exits.
export function killAllWebAgentsEverywhere(): number {
  let killed = 0;
  for (const [key, proc] of agentProcesses) {
    swallow('terminal:kill-shutdown', () => { proc.kill(); });
    agentProcesses.delete(key);
    killed++;
  }
  return killed;
}

// Close every live /ws/terminal/* WebSocket. Sent BEFORE the agent
// processes are killed so dashboard terminal viewers see a clean
// 1001 close (and stop sending stdin) before the PTY tears down.
// Order matters in shutdownBroker (QW-5 follow-up).
export function closeAllTerminalClients(): number {
  let n = 0;
  for (const ws of terminalClients) {
    try { ws.close(1001, 'Broker shutting down'); n++; } catch { /* ignore */ }
  }
  terminalClients.clear();
  return n;
}

export function getWebAgent(projectId: string, role: string): ChildProcess | undefined {
  return agentProcesses.get(processKey(projectId, role));
}

export function handleTerminalUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, role: string, projectId: string): void {
  // Origin check before the handshake. WebSockets are not subject to
  // CORS preflight, so a webpage on an external origin can otherwise
  // open a hijacking WS to ws://127.0.0.1/ws/terminal/<role> and pipe
  // bytes into the agent's stdin (S-NEW-2 / WS-hijack RCE).
  if (!isAllowedOrigin(req)) {
    log(`reject /ws/terminal upgrade: origin=${JSON.stringify(req.headers.origin)} remote=${req.socket.remoteAddress}`);
    rejectUpgrade(socket, 403, 'Forbidden');
    return;
  }

  // [F-3-C] One-shot CSRF token check. Defense-in-depth alongside the
  // Origin gate (token + Origin = AND, not OR). Closes the residual
  // S-NEW-2 cross-port hijack: a malicious dev server on
  // http://127.0.0.1:<other-port> matches the Origin allowlist but
  // can't read the dashboard's localStorage and therefore has no
  // peer_id with which to obtain a token via /api/csrf/issue.
  //
  // The token is delivered via Sec-WebSocket-Protocol since browsers
  // refuse to let JS attach custom headers to WS handshakes. The
  // handleProtocols hook on wss echoes the protocol back so the
  // handshake completes — we don't need to call wss.handleUpgrade with
  // any extra plumbing here.
  const token = extractAccToken(req);
  const entry = consumeToken(token); // one-shot: removes from store
  if (!entry || entry.project_id !== projectId || entry.role !== role) {
    log(`reject /ws/terminal upgrade: invalid token for ${projectId}:${role} (token=${token ? token.slice(0, 8) + '…' : 'missing'})`);
    rejectUpgrade(socket, 403, 'Forbidden');
    return;
  }

  // Defense-in-depth: also refuse the handshake when no agent is alive
  // for this (project, role). The previous code accepted the WS first
  // and then closed with 1011, which still exposed handshake success
  // to a probing attacker.
  const key = processKey(projectId, role);
  const proc = agentProcesses.get(key);
  if (!proc || proc.killed) {
    log(`reject /ws/terminal upgrade: no active process for ${key}`);
    rejectUpgrade(socket, 503, 'Agent not running');
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    log(`ws connect for ${key}`);
    log(`piping ws to process ${key} pid=${proc.pid}`);
    terminalClients.add(ws);

    // [S-NEW-10] Hard backstop: drop frames if the WS send buffer is
    // saturated. Without this, a stuck client could accumulate process
    // stdout in memory until the heap blew out.
    // [P-5] Soft backpressure on top: pause the PTY's stdout/stderr
    // when the WS buffer is over LIMIT, resume once it drains below
    // LIMIT/2 (hysteresis prevents thrashing). This way data isn't
    // dropped under transient slowness — only under sustained
    // saturation does S-NEW-10's drop kick in.
    const WS_SEND_BACKPRESSURE_LIMIT = 1024 * 1024; // 1 MB
    const RESUME_AT = WS_SEND_BACKPRESSURE_LIMIT / 2;

    const maybeResume = () => {
      if (ws.bufferedAmount < RESUME_AT) {
        if (proc.stdout && proc.stdout.isPaused()) proc.stdout.resume();
        if (proc.stderr && proc.stderr.isPaused()) proc.stderr.resume();
      }
    };

    const sendIfBufferOK = (data: Buffer) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > WS_SEND_BACKPRESSURE_LIMIT) {
        // Hard cap reached — drop. The pause path below should
        // normally prevent us from getting here, but if the PTY queued
        // more data before the pause took effect we drop the excess.
        return;
      }
      ws.send(data, () => maybeResume());
      // [P-5] If this send pushed us over the limit, pause the source
      // so the PTY stops producing until the OS drains the socket.
      if (ws.bufferedAmount > WS_SEND_BACKPRESSURE_LIMIT) {
        proc.stdout?.pause();
        proc.stderr?.pause();
      }
    };

    // Send buffered output first
    const buf = outputBuffers.get(key);
    if (buf) {
      for (const chunk of buf) {
        sendIfBufferOK(chunk);
      }
    }

    // Process stdout → WebSocket
    const onStdout = (data: Buffer) => sendIfBufferOK(data);

    const onStderr = (data: Buffer) => sendIfBufferOK(data);

    proc.stdout?.on('data', onStdout);
    proc.stderr?.on('data', onStderr);

    // Process exit → close WebSocket
    const onExit = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'Agent exited');
      }
    };
    proc.on('exit', onExit);

    // [S-NEW-10] Token bucket on stdin so a misbehaving (or hijacked)
    // client cannot flood the agent with input. 16 KB/s sustained, 64
    // KB burst capacity — well above human typing / paste rate but
    // tight enough that a flood gets choked off in <1s.
    const STDIN_REFILL_BYTES_PER_SEC = 16 * 1024;
    const STDIN_BURST_CAPACITY = 64 * 1024;
    let stdinTokens = STDIN_BURST_CAPACITY;
    let stdinLastRefill = Date.now();
    const refillStdinTokens = (): void => {
      const now = Date.now();
      const elapsedSec = (now - stdinLastRefill) / 1000;
      stdinLastRefill = now;
      stdinTokens = Math.min(
        STDIN_BURST_CAPACITY,
        stdinTokens + elapsedSec * STDIN_REFILL_BYTES_PER_SEC,
      );
    };

    // WebSocket → process stdin
    ws.on('message', (raw: Buffer | string) => {
      if (!proc.stdin?.writable) return;
      const text = typeof raw === 'string' ? raw : raw.toString();
      const cost = Buffer.byteLength(text);
      refillStdinTokens();
      if (stdinTokens < cost) {
        // Bucket empty — drop this frame silently. We don't close the
        // socket because legitimate paste-of-a-large-blob just needs
        // to wait for refill.
        return;
      }
      stdinTokens -= cost;
      proc.stdin.write(text);
    });

    // Cleanup on WebSocket close
    const cleanup = (): void => {
      terminalClients.delete(ws);
      proc.stdout?.off('data', onStdout);
      proc.stderr?.off('data', onStderr);
      proc.off('exit', onExit);
      // [P-5] If we paused the PTY before this WS disconnected, the
      // stream would stay paused forever and the next reconnect would
      // see nothing. Resume on the way out — other listeners (status
      // poller, output buffer) need it flowing.
      if (proc.stdout && proc.stdout.isPaused()) proc.stdout.resume();
      if (proc.stderr && proc.stderr.isPaused()) proc.stderr.resume();
    };

    ws.on('close', () => {
      log(`ws closed for ${key}`);
      cleanup();
    });

    ws.on('error', () => {
      cleanup();
    });
  });
}
