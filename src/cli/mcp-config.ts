// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE A-2 (v0.3.2) — per-agent MCP config generation.
//
// For every agent that opts into one or more powers, we generate a JSON
// file in the canonical Claude Code "mcpServers" shape and pass it via
// `claude --mcp-config <path>` at spawn time. The file is regenerated
// on every spawn so registry updates, env-var changes, and template
// substitutions stay in sync.
//
// Two spawn paths consume this:
//   1. src/cli/spawn.ts (tmux / windows-terminal / fallback)
//   2. src/broker/terminal.ts spawnWebAgent (dashboard "encender")
//
// Both pass the returned configPath into the agent's claude argv.
// Warnings (unknown power, missing required env) are returned for the
// caller to log; this module deliberately does no I/O beyond writing
// the JSON file, so the spawn path stays in charge of how warnings
// surface to the user (broker stderr, dashboard event, etc).

import { mkdirSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ACC_HOME } from '../shared/config.js';
import { POWERS_REGISTRY, resolvePower } from '../shared/powers.js';

export interface PreparedPowers {
  // Absolute path to the generated --mcp-config JSON file, or null when
  // no power resolved (no agent.powers, all unknown, or all missing env).
  configPath: string | null;
  // Human-readable warnings: unknown power names, missing required env
  // vars. The spawn caller is expected to write each line to stderr
  // (broker logs in dev; otherwise visible at agent boot).
  warnings: string[];
  // Power names that landed in the generated file.
  applied: string[];
  // Power names that were dropped (unknown or missing env). Useful for
  // a future dashboard "agent encender" checklist.
  skipped: string[];
}

// On-disk layout: ~/.zaipex-acc/projects/<projectName>/mcp/<role>.json.
// Matches the FASE B-1 (v0.3.0) skills layout, so the per-project
// state directory stays uniform.
export function agentMcpDir(projectName: string): string {
  return join(ACC_HOME, 'projects', projectName, 'mcp');
}

export function agentMcpConfigPath(projectName: string, role: string): string {
  return join(agentMcpDir(projectName), `${role}.json`);
}

export interface PreparePowerInput {
  // Canonical names the agent opted into.
  powers?: string[];
  // The agent's working directory; resolves the ${cwd} template var.
  cwd: string;
  // Display role used to name the generated file.
  role: string;
}

export function prepareAgentMcpConfig(
  projectName: string,
  agent: PreparePowerInput,
  env: NodeJS.ProcessEnv = process.env,
): PreparedPowers {
  const warnings: string[] = [];
  const applied: string[] = [];
  const skipped: string[] = [];

  // No powers requested → make sure no stale config remains so the
  // next spawn doesn't accidentally pick up a previous run's file.
  if (!agent.powers || agent.powers.length === 0) {
    pruneAgentMcpConfig(projectName, agent.role);
    return { configPath: null, warnings, applied, skipped };
  }

  const mcpServers: Record<string, { command: string; args: string[] }> = {};
  for (const name of agent.powers) {
    const spec = POWERS_REGISTRY[name];
    if (!spec) {
      warnings.push(
        `[powers] agent "${agent.role}": power "${name}" not in registry — skipping. ` +
        `Available: ${Object.keys(POWERS_REGISTRY).join(', ')}.`,
      );
      skipped.push(name);
      continue;
    }
    const resolved = resolvePower(spec, { cwd: agent.cwd, env });
    if (resolved.missingEnv.length > 0) {
      warnings.push(
        `[powers] agent "${agent.role}": power "${name}" needs env var(s) ${resolved.missingEnv.join(', ')}; ` +
        `export them in your shell before powering up the team. Skipping for now.`,
      );
      skipped.push(name);
      continue;
    }
    mcpServers[name] = { command: resolved.command, args: resolved.args };
    applied.push(name);
  }

  if (applied.length === 0) {
    pruneAgentMcpConfig(projectName, agent.role);
    return { configPath: null, warnings, applied, skipped };
  }

  const dir = agentMcpDir(projectName);
  mkdirSync(dir, { recursive: true });
  const configPath = agentMcpConfigPath(projectName, agent.role);
  writeFileSync(configPath, JSON.stringify({ mcpServers }, null, 2) + '\n');

  return { configPath, warnings, applied, skipped };
}

// Remove a previously written per-agent MCP config. Idempotent — safe
// to call when nothing exists. Used both as the "no powers requested"
// cleanup path and exposed for the dashboard's agent-delete flow.
export function pruneAgentMcpConfig(projectName: string, role: string): void {
  const path = agentMcpConfigPath(projectName, role);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // Best effort — a stale file is recoverable on next spawn.
    }
  }
}
