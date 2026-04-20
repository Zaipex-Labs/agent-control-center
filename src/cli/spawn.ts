// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { execFileSync, spawn as cpSpawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentConfig } from '../shared/types.js';
import { resolveEntryPoint, getDefaultName } from '../shared/utils.js';
import { assertSafeIdentifier } from '../shared/validate.js';

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

function getServerEntryPath(): string {
  const thisDir = resolve(fileURLToPath(import.meta.url), '..');
  return resolveEntryPoint(thisDir, '..', 'server', 'index.ts');
}

export function isMcpServerRegistered(): boolean {
  try {
    const output = execFileSync('claude', ['mcp', 'list'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      // Bound timeout so a stuck child doesn't hang vitest. Matches the
      // cli test's 5s cap (see tests/cli/spawn.test.ts).
      timeout: 3000,
    });
    return output.includes('zaipex-acc');
  } catch {
    return false;
  }
}

export function registerMcpServer(): void {
  if (isMcpServerRegistered()) return;

  const serverPath = getServerEntryPath();
  // runner is either "npx tsx" (two tokens) or "node" (one); expand to
  // separate argv entries so the whole thing is shell-free.
  const runnerArgv = serverPath.endsWith('.ts') ? ['npx', 'tsx'] : ['node'];
  execFileSync(
    'claude',
    ['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'zaipex-acc', '--', ...runnerArgv, serverPath],
    { stdio: 'pipe' },
  );
}

// ── Agent command building ─────────────────────────────────────

function buildAgentEnv(projectName: string, agent: AgentConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ACC_PROJECT: projectName,
    ACC_ROLE: agent.role,
    ...(agent.name ? { ACC_NAME: agent.name } : {}),
  };
}

const MCP_SERVER_NAME = 'zaipex-acc';

function buildAgentCommand(agent: AgentConfig): { cmd: string; args: string[] } {
  const args = [
    '--dangerously-skip-permissions',
    '--dangerously-load-development-channels',
    `server:${MCP_SERVER_NAME}`,
    ...agent.agent_args,
  ];
  if (agent.instructions) {
    args.push('--instruction', agent.instructions);
  }
  return { cmd: agent.agent_cmd, args };
}

function buildTmuxEnvExports(projectName: string, agent: AgentConfig): string {
  let exports = `ACC_PROJECT=${shellEscape(projectName)} ACC_ROLE=${shellEscape(agent.role)}`;
  if (agent.name) {
    exports += ` ACC_NAME=${shellEscape(agent.name)}`;
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
  const { cmd, args } = buildAgentCommand(agent);
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

  // Select the first window
  try {
    execFileSync('tmux', ['select-window', '-t', `${sessionName}:${first.role}`], { stdio: 'pipe' });
  } catch {
    // Best effort
  }

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
    const target = `${sessionName}:${agent.role}`;
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
    const { cmd, args } = buildAgentCommand(agent);
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
    const { cmd, args } = buildAgentCommand(agent);
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

// ── Helpers ────────────────────────────────────────────────────

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
