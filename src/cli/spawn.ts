// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { execFileSync, execFile, spawn as cpSpawn } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig } from '../shared/types.js';
import { swallow } from '../shared/log.js';
import { resolveEntryPoint, getDefaultName } from '../shared/utils.js';
import { assertSafeIdentifier } from '../shared/validate.js';
import { prepareAgentMcpConfig } from './mcp-config.js';

const execFileAsync = promisify(execFile);

export type SpawnStrategy = 'tmux' | 'windows-terminal' | 'fallback';

export interface SpawnResult {
  strategy: SpawnStrategy;
  pids: number[];
  tmuxSession?: string;
}

export function detectStrategy(): SpawnStrategy {
  if (process.platform === 'win32') return 'windows-terminal';
  if (hasTmux()) return 'tmux';
  return 'fallback';
}

function hasTmux(): boolean {
  try {
    execFileSync('which', ['tmux'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── MCP server registration ────────────────────────────────────

const MCP_SERVER_NAME = 'zaipex-acc';

function getServerEntryPath(): string {
  const thisDir = resolve(fileURLToPath(import.meta.url), '..');
  return resolveEntryPoint(thisDir, '..', 'server', 'index.ts');
}

export interface RegisteredMcpServer {
  command: string;
  args: string[];
}

// `claude mcp get <name>` is ~3× faster than `mcp list` (no remote
// health checks) and gives us the args/command of an existing
// registration so we can detect cross-install conflicts.
export function getRegisteredMcpServer(): RegisteredMcpServer | null {
  let output: string;
  try {
    output = execFileSync('claude', ['mcp', 'get', MCP_SERVER_NAME], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 3000,
    });
  } catch {
    return null;
  }
  if (!output.includes(MCP_SERVER_NAME)) return null;
  const commandMatch = output.match(/^\s*Command:\s*(.+)$/m);
  const argsMatch = output.match(/^\s*Args:\s*(.+)$/m);
  return {
    command: commandMatch?.[1].trim() ?? '',
    args: argsMatch ? argsMatch[1].trim().split(/\s+/).filter(Boolean) : [],
  };
}

// Back-compat: callers that only need the boolean keep working.
export function isMcpServerRegistered(): boolean {
  return getRegisteredMcpServer() !== null;
}

function buildExpectedRegistration(): RegisteredMcpServer {
  const serverPath = getServerEntryPath();
  // runner is either "npx tsx" (two tokens) or "node" (one); expand to
  // separate argv entries so the whole thing is shell-free.
  if (serverPath.endsWith('.ts')) {
    return { command: 'npx', args: ['tsx', serverPath] };
  }
  return { command: 'node', args: [serverPath] };
}

function registrationsMatch(a: RegisteredMcpServer, b: RegisteredMcpServer): boolean {
  if (a.command !== b.command) return false;
  if (a.args.length !== b.args.length) return false;
  for (let i = 0; i < a.args.length; i++) {
    if (a.args[i] !== b.args[i]) return false;
  }
  return true;
}

export function registerMcpServer(): void {
  const expected = buildExpectedRegistration();
  const existing = getRegisteredMcpServer();

  if (existing && registrationsMatch(existing, expected)) {
    // Same install already registered — no-op.
    return;
  }

  if (existing) {
    // Different install registered. The agents this broker spawns
    // will use the existing MCP server registration (Claude Code
    // resolves user-scope MCP servers by name). Wire-compatible
    // across recent versions; we warn loudly so the user knows.
    const existingFull = [existing.command, ...existing.args].join(' ');
    const expectedFull = [expected.command, ...expected.args].join(' ');
    process.stderr.write(
      `[acc] zaipex-acc MCP server already registered (user scope) pointing to a different install:\n` +
      `      current:  ${existingFull}\n` +
      `      this install: ${expectedFull}\n` +
      `[acc] Agents will use the existing registration. To switch this install in:\n` +
      `      claude mcp remove zaipex-acc -s user\n`,
    );
    return;
  }

  try {
    execFileSync(
      'claude',
      ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', MCP_SERVER_NAME, '--', expected.command, ...expected.args],
      { stdio: 'pipe' },
    );
  } catch (e) {
    // TOCTOU: another process raced us and added it first. claude exits
    // non-zero with `already exists in user config` on stderr — that's
    // exactly the state we wanted, so treat it as success.
    const err = e as { stderr?: Buffer | string; message?: string };
    const raw = typeof err.stderr === 'string'
      ? err.stderr
      : Buffer.isBuffer(err.stderr)
        ? err.stderr.toString('utf8')
        : err.message ?? String(e);
    if (/already exists/i.test(raw)) return;
    // Re-throw with a single-line message so the broker's handler
    // (projects.ts:453) doesn't propagate raw multi-line stderr to
    // the user.
    const firstLine = raw.split('\n').map(s => s.trim()).filter(Boolean)[0] ?? 'unknown error';
    throw new Error(firstLine, { cause: e });
  }
}

// ── Agent command building ─────────────────────────────────────

function buildAgentEnv(projectName: string, agent: AgentConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ACC_PROJECT: projectName,
    ACC_ROLE: agent.role,
    ...(agent.name ? { ACC_NAME: agent.name } : {}),
    ...(agent.avatar ? { ACC_AVATAR: agent.avatar } : {}),
  };
}

// FASE A-2 (v0.3.2). `mcpConfigPath`, when provided, is wired into
// claude as `--mcp-config <path>`. The file holds the per-agent
// powers (extra MCP servers); the ACC team-coordination server stays
// the user-scope registration the broker already manages.
function buildAgentCommand(agent: AgentConfig, mcpConfigPath?: string | null): { cmd: string; args: string[] } {
  const args = [
    '--dangerously-skip-permissions',
    '--dangerously-load-development-channels',
    `server:${MCP_SERVER_NAME}`,
    ...agent.agent_args,
  ];
  if (mcpConfigPath) {
    args.push('--mcp-config', mcpConfigPath);
  }
  if (agent.instructions) {
    args.push('--instruction', agent.instructions);
  }
  return { cmd: agent.agent_cmd, args };
}

// Resolve and persist the agent's MCP config for this spawn, log any
// warnings to stderr, and return the path (or null when no power
// applies). Centralized here so each spawn strategy invokes it the
// same way — keeps the warning channel uniform across tmux/web/win.
function preparePowersForSpawn(projectName: string, agent: AgentConfig): string | null {
  const prep = prepareAgentMcpConfig(projectName, {
    powers: agent.powers,
    cwd: agent.cwd,
    role: agent.role,
  });
  for (const w of prep.warnings) {
    process.stderr.write(w + '\n');
  }
  return prep.configPath;
}

function buildTmuxEnvExports(projectName: string, agent: AgentConfig): string {
  let exports = `ACC_PROJECT=${shellEscape(projectName)} ACC_ROLE=${shellEscape(agent.role)}`;
  if (agent.name) {
    exports += ` ACC_NAME=${shellEscape(agent.name)}`;
  }
  if (agent.avatar) {
    exports += ` ACC_AVATAR=${shellEscape(agent.avatar)}`;
  }
  return exports;
}

// ── tmux strategy ──────────────────────────────────────────────

// [H-3] — role and project name feed tmux argv. Defense in depth: even
// though handleAddAgent / handleUpdateProject validate these, a CLI
// caller (acc up from the shell) bypasses those handlers. Validate
// again at the spawn boundary so a hand-crafted project config can't
// slip through.
function assertSafeSpawnInputs(projectName: string, agents: AgentConfig[]): void {
  assertSafeIdentifier('project_id', projectName);
  for (const agent of agents) {
    assertSafeIdentifier('role', agent.role);
    if (agent.name) assertSafeIdentifier('name', agent.name);
  }
}

// Build the shell command that will run inside a tmux pane after the
// window is created empty with `-c cwd`. Each env var value is passed
// through shellEscape so the pane's shell interprets it safely; the
// command itself and its args are treated the same way. This string
// never reaches a Node shell — Node hands it to tmux via execFileSync,
// and tmux types it into the pane via send-keys.
function buildPaneCommandLine(projectName: string, agent: AgentConfig): string {
  const mcpConfigPath = preparePowersForSpawn(projectName, agent);
  const { cmd, args } = buildAgentCommand(agent, mcpConfigPath);
  const envExports = buildTmuxEnvExports(projectName, agent);
  return `${envExports} ${cmd} ${args.map(shellEscape).join(' ')}`;
}

export function spawnWithTmux(
  projectName: string,
  agents: AgentConfig[],
): SpawnResult {
  assertSafeSpawnInputs(projectName, agents);
  const sessionName = `acc-${projectName}`;

  // Kill existing session if present
  try {
    execFileSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'pipe' });
  } catch {
    // No existing session — fine
  }

  const first = agents[0];

  // Create the session with an empty window (no shell-command) whose
  // cwd is the agent's working directory. This avoids embedding a
  // shell command into tmux's positional argv, which tmux otherwise
  // passes to `sh -c` — keeping the session creation itself shell-free.
  execFileSync('tmux', [
    'new-session', '-d',
    '-s', sessionName,
    '-n', first.role,
    '-c', first.cwd,
  ], { stdio: 'pipe' });

  // Then type the command into the pane via send-keys. shellEscape is
  // already applied to each piece inside buildPaneCommandLine, so the
  // pane's shell interprets the line safely.
  execFileSync('tmux', [
    'send-keys', '-t', `${sessionName}:${first.role}`,
    buildPaneCommandLine(projectName, first), 'Enter',
  ], { stdio: 'pipe' });

  // Add remaining agents as separate windows (one window per agent)
  for (let i = 1; i < agents.length; i++) {
    const agent = agents[i];
    execFileSync('tmux', [
      'new-window', '-t', sessionName,
      '-n', agent.role,
      '-c', agent.cwd,
    ], { stdio: 'pipe' });
    execFileSync('tmux', [
      'send-keys', '-t', `${sessionName}:${agent.role}`,
      buildPaneCommandLine(projectName, agent), 'Enter',
    ], { stdio: 'pipe' });
  }

  // Select the first window — best-effort; if the user has a custom
  // tmux config that renames windows differently, this fails but the
  // session is still up. swallow surfaces it without breaking spawn.
  swallow('spawn:tmux-select-window', () => {
    execFileSync('tmux', ['select-window', '-t', `${sessionName}:${first.role}`], { stdio: 'pipe' });
  });

  // Collect PIDs from tmux panes
  const pids = getTmuxPanePids(sessionName);

  // Auto-accept MCP server and send initial prompt for each agent (background)
  scheduleAgentInit(sessionName, agents);

  return { strategy: 'tmux', pids, tmuxSession: sessionName };
}

function scheduleAgentInit(sessionName: string, agents: AgentConfig[]): void {
  // Single-loop retry per agent:
  // 1. If channels prompt visible → accept with Enter, continue loop
  // 2. If "shortcuts" visible AND no "local development" → Claude Code ready → send prompt, done
  // 3. Otherwise → wait and retry

  const lines: string[] = ['#!/bin/sh'];

  for (const agent of agents) {
    // [H-3 caveat] — target = sessionName + ':' + agent.role. Both
    // sides are validated by assertSafeIdentifier before they reach
    // here, so today it's safe. But this is the last `sh -c` template
    // the audit flagged, and the only unescaped interpolation: defense
    // in depth, wrap with shellEscape so a future regression in either
    // identifier validator can't reach the shell verbatim.
    const target = shellEscape(`${sessionName}:${agent.role}`);
    const name = agent.name || getDefaultName(agent.role);
    const prompt = `Soy ${name}, rol ${agent.role}. Ejecuta whoami y set_summary ahora.`;

    lines.push(`# Init ${agent.role}`);
    lines.push(`for i in $(seq 1 60); do`);
    lines.push(`  content=$(tmux capture-pane -t ${target} -p 2>/dev/null)`);
    lines.push(`  has_channels=$(echo "$content" | grep -c "local development" || true)`);
    lines.push(`  has_ready=$(echo "$content" | grep -c "shortcuts" || true)`);
    // Accept channels prompt if visible
    lines.push(`  if [ "$has_channels" -gt 0 ]; then`);
    lines.push(`    tmux send-keys -t ${target} Enter 2>/dev/null`);
    lines.push(`    sleep 2`);
    lines.push(`    continue`);
    lines.push(`  fi`);
    // Claude Code ready (shortcuts visible, channels gone)
    lines.push(`  if [ "$has_ready" -gt 0 ]; then`);
    lines.push(`    sleep 1`);
    lines.push(`    tmux send-keys -t ${target} -l ${shellEscape(prompt)} 2>/dev/null`);
    lines.push(`    tmux send-keys -t ${target} Enter 2>/dev/null`);
    lines.push(`    break`);
    lines.push(`  fi`);
    lines.push(`  sleep 1`);
    lines.push(`done`);
  }

  const script = lines.join('\n');
  const child = cpSpawn('sh', ['-c', script], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function getTmuxPanePids(session: string): number[] {
  try {
    const output = execFileSync(
      'tmux',
      ['list-panes', '-s', '-t', session, '-F', '#{pane_pid}'],
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return output.trim().split('\n').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  } catch {
    return [];
  }
}

// ── Windows strategy ───────────────────────────────────────────

export function spawnWithWindowsTerminal(
  projectName: string,
  agents: AgentConfig[],
): SpawnResult {
  const pids: number[] = [];

  for (const agent of agents) {
    const mcpConfigPath = preparePowersForSpawn(projectName, agent);
    const { cmd, args } = buildAgentCommand(agent, mcpConfigPath);
    const child = cpSpawn('cmd.exe', ['/c', 'start', cmd, ...args], {
      cwd: agent.cwd,
      detached: true,
      stdio: 'ignore',
      env: buildAgentEnv(projectName, agent),
    });
    child.unref();
    if (child.pid) pids.push(child.pid);
  }

  return { strategy: 'windows-terminal', pids };
}

// ── Fallback strategy ──────────────────────────────────────────

export function spawnWithFallback(
  projectName: string,
  agents: AgentConfig[],
): SpawnResult {
  const pids: number[] = [];

  for (const agent of agents) {
    const mcpConfigPath = preparePowersForSpawn(projectName, agent);
    const { cmd, args } = buildAgentCommand(agent, mcpConfigPath);
    const child = cpSpawn(cmd, args, {
      cwd: agent.cwd,
      detached: true,
      stdio: 'ignore',
      env: buildAgentEnv(projectName, agent),
    });
    child.unref();
    if (child.pid) pids.push(child.pid);
  }

  return { strategy: 'fallback', pids };
}

// ── Main entry point ───────────────────────────────────────────

export function spawnAgents(
  projectName: string,
  agents: AgentConfig[],
  strategy?: SpawnStrategy,
): SpawnResult {
  const s = strategy ?? detectStrategy();

  switch (s) {
    case 'tmux':
      return spawnWithTmux(projectName, agents);
    case 'windows-terminal':
      return spawnWithWindowsTerminal(projectName, agents);
    case 'fallback':
      return spawnWithFallback(projectName, agents);
  }
}

// ── tmux teardown ──────────────────────────────────────────────

export function killTmuxSession(projectName: string): boolean {
  const sessionName = `acc-${projectName}`;
  try {
    execFileSync('tmux', ['kill-session', '-t', sessionName], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function hasTmuxSession(projectName: string): boolean {
  const sessionName = `acc-${projectName}`;
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// [P-2] Batched alternative to N × hasTmuxSession() forks. Returns the
// set of `acc-<project>` session names tmux currently knows about. Used
// by handleListProjects so a 5-project dashboard refresh fires ONE
// `tmux list-sessions` instead of five `tmux has-session` calls.
//
// Returns an empty set when tmux is missing OR when there are no live
// sessions — both cases land in execFile rejecting (tmux exits 1 with
// "no server running" / ENOENT). Either way the caller treats every
// project as "tmux not running".
export async function listTmuxSessions(): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync(
      'tmux',
      ['list-sessions', '-F', '#{session_name}'],
      { encoding: 'utf-8', timeout: 1500 },
    );
    return new Set(stdout.split('\n').map(s => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

// ── Helpers ────────────────────────────────────────────────────

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
