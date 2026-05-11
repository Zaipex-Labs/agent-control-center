// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE A-1 (v0.3.2) — Powers registry.
//
// A power binds a canonical name (e.g. "git") to a concrete MCP-server
// invocation (command + argv template). Powers are attached to an agent
// via `AgentConfig.powers: string[]`; src/cli/spawn.ts looks up each
// name in this registry and generates a per-agent --mcp-config JSON file
// before launching the claude CLI.
//
// Why a static registry: powers are platform-defining wiring. They
// must be the same across the dashboard (which renders the toggle) and
// the spawner (which actually launches MCP servers), so they live in a
// single TS module rather than user-editable disk state. New powers
// are added by appending to POWERS_REGISTRY in a code change.
//
// The public-facing shape (Power, in src/shared/wire.ts) deliberately
// omits the command/args fields — the dashboard renders a name +
// description + env hint, and never needs to know how the MCP server
// is invoked.

import type { Power } from './wire.js';

export interface PowerSpec extends Power {
  // Server-only fields used by the spawner to actually launch the
  // MCP server. `command` is the bare executable name (resolved via
  // PATH at spawn time); `args` is the argv tail. Both pieces support
  // template variables — see resolvePowerArgs below.
  command: string;
  args: string[];
}

// Args / command templates can reference these substitution variables:
//   ${cwd}                    — the agent's working directory
//   ${<UPPER_CASE_ENV_NAME>}  — any name listed in requiredEnv. If the
//                                value is missing the spawner warns and
//                                skips the power (the env value can
//                                only be expanded if it actually
//                                exists at spawn time).
//
// Templates that reference an env var must declare it in requiredEnv
// so the dashboard can surface the hint and the spawner can validate
// up front rather than failing inside the MCP server's launch.

export const POWERS_REGISTRY: Record<string, PowerSpec> = {
  // Read-only git inspection (log, diff, show, status). The official
  // mcp-server-git ships as a Python package; uvx is the no-install
  // launcher of choice (`uvx <pkg>` ≡ pipx run, no global pollution).
  git: {
    name: 'git',
    description: 'Read-only git inspection (log, diff, show, status) scoped to the agent cwd.',
    requiredEnv: [],
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '${cwd}'],
  },
  // Postgres read-only query MCP server. The official server expects
  // the connection string as its first positional arg; we pull it
  // from POSTGRES_CONNECTION_STRING so it lives in the user's env
  // rather than a project config file.
  postgres: {
    name: 'postgres',
    description: 'Read-only SQL access to a Postgres database (SELECTs only).',
    requiredEnv: ['POSTGRES_CONNECTION_STRING'],
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', '${POSTGRES_CONNECTION_STRING}'],
  },
  // Browser automation via Microsoft's official Playwright MCP server.
  playwright: {
    name: 'playwright',
    description: 'Browser automation: navigate, click, fill, screenshot via Playwright.',
    requiredEnv: [],
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
  },
};

// ── Public view ────────────────────────────────────────────────

// The dashboard's GET /api/powers endpoint and any other public
// surface returns this shape — every entry stripped of its
// server-only command/args. Keeping the projection here (and not in
// the broker handler) makes the boundary explicit: the dashboard
// can NEVER see command/args, even by accident.
export function listPublicPowers(): Power[] {
  return Object.values(POWERS_REGISTRY)
    .map(({ command: _command, args: _args, ...pub }) => pub)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getPowerSpec(name: string): PowerSpec | undefined {
  return POWERS_REGISTRY[name];
}

// ── Argument resolution ────────────────────────────────────────

export interface ResolveContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface ResolvedPower {
  // Original spec, untouched, for diagnostics.
  spec: PowerSpec;
  // argv after ${...} substitution. Includes the command itself as
  // args[0]? No — the command stays separate so node spawn can use
  // execFile semantics safely.
  command: string;
  args: string[];
  // Env var names declared as required but absent from ctx.env. When
  // non-empty the caller should warn + skip the power rather than
  // launch a broken MCP server (the server itself would fail with a
  // cryptic error since the empty-string substitute would land in
  // its argv).
  missingEnv: string[];
}

// Substitutes ${cwd} and ${ENV_NAME} occurrences inside a template
// string. ENV_NAME is matched against ctx.env; missing values yield
// an empty string but get recorded in `missing` so the caller can
// decide whether to abort. ${cwd} is always available because every
// agent has one.
function substitute(template: string, ctx: ResolveContext, missing: Set<string>): string {
  return template.replace(/\$\{([A-Za-z_][A-Za-z_0-9]*)\}/g, (_, key) => {
    if (key === 'cwd') return ctx.cwd;
    const value = ctx.env[key];
    if (value === undefined || value === '') {
      missing.add(key);
      return '';
    }
    return value;
  });
}

export function resolvePower(spec: PowerSpec, ctx: ResolveContext): ResolvedPower {
  // Pre-flight: which declared env vars are absent? Done before
  // substitution so a single missing var blocks the whole power
  // rather than producing a half-empty argv.
  const missingEnv: string[] = [];
  for (const name of spec.requiredEnv) {
    const v = ctx.env[name];
    if (v === undefined || v === '') missingEnv.push(name);
  }

  const missingFromTemplate = new Set<string>();
  const command = substitute(spec.command, ctx, missingFromTemplate);
  const args = spec.args.map(a => substitute(a, ctx, missingFromTemplate));

  // Merge: a power that references an undeclared env var also
  // counts as missing. This way the dashboard's requiredEnv hint
  // stays the source of truth for users while the registry author
  // can't accidentally ship an unresolved template.
  for (const k of missingFromTemplate) {
    if (k !== 'cwd' && !missingEnv.includes(k)) missingEnv.push(k);
  }

  return { spec, command, args, missingEnv };
}
