// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// FASE A-2 (v0.3.2). The mcp-config module reads from POWERS_REGISTRY
// and writes per-agent JSON under ACC_HOME. We swap ACC_HOME to a tmp
// dir per test and re-import so config.ts picks up the override.

let home: string;
let prevHome: string | undefined;
let prevPgEnv: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'acc-mcp-config-'));
  prevHome = process.env['ACC_HOME'];
  process.env['ACC_HOME'] = home;
  prevPgEnv = process.env['POSTGRES_CONNECTION_STRING'];
  delete process.env['POSTGRES_CONNECTION_STRING'];
  vi.resetModules();
});

afterEach(() => {
  if (prevHome != null) process.env['ACC_HOME'] = prevHome;
  else delete process.env['ACC_HOME'];
  if (prevPgEnv != null) process.env['POSTGRES_CONNECTION_STRING'] = prevPgEnv;
  rmSync(home, { recursive: true, force: true });
  vi.resetModules();
});

describe('prepareAgentMcpConfig — no powers requested', () => {
  it('returns null configPath and writes nothing', async () => {
    const { prepareAgentMcpConfig, agentMcpConfigPath } = await import(
      '../../src/cli/mcp-config.js'
    );
    const result = prepareAgentMcpConfig('myproj', {
      role: 'backend',
      cwd: '/tmp',
      powers: [],
    });
    expect(result.configPath).toBeNull();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(existsSync(agentMcpConfigPath('myproj', 'backend'))).toBe(false);
  });

  it('removes a stale config when invoked with no powers', async () => {
    const { prepareAgentMcpConfig, agentMcpConfigPath } = await import(
      '../../src/cli/mcp-config.js'
    );
    // First run: write a config.
    prepareAgentMcpConfig('myproj', {
      role: 'backend',
      cwd: '/tmp',
      powers: ['git'],
    });
    const path = agentMcpConfigPath('myproj', 'backend');
    expect(existsSync(path)).toBe(true);
    // Second run: powers stripped → file should be gone.
    prepareAgentMcpConfig('myproj', {
      role: 'backend',
      cwd: '/tmp',
      powers: [],
    });
    expect(existsSync(path)).toBe(false);
  });
});

describe('prepareAgentMcpConfig — applied powers', () => {
  it('writes a valid mcpServers JSON for the git power', async () => {
    const { prepareAgentMcpConfig } = await import('../../src/cli/mcp-config.js');
    const result = prepareAgentMcpConfig('myproj', {
      role: 'backend',
      cwd: '/repo/path',
      powers: ['git'],
    });
    expect(result.configPath).not.toBeNull();
    expect(result.applied).toEqual(['git']);
    const json = JSON.parse(readFileSync(result.configPath!, 'utf-8'));
    expect(json.mcpServers.git.command).toBe('uvx');
    expect(json.mcpServers.git.args).toContain('/repo/path');
    expect(json.mcpServers.git.args).toContain('mcp-server-git');
  });

  it('combines multiple powers into one mcpServers object', async () => {
    const { prepareAgentMcpConfig } = await import('../../src/cli/mcp-config.js');
    const result = prepareAgentMcpConfig(
      'myproj',
      { role: 'backend', cwd: '/repo', powers: ['git', 'playwright'] },
      { ...process.env },
    );
    expect(result.applied.sort()).toEqual(['git', 'playwright']);
    const json = JSON.parse(readFileSync(result.configPath!, 'utf-8'));
    expect(Object.keys(json.mcpServers).sort()).toEqual(['git', 'playwright']);
  });

  it('substitutes env vars when present', async () => {
    const { prepareAgentMcpConfig } = await import('../../src/cli/mcp-config.js');
    const result = prepareAgentMcpConfig(
      'myproj',
      { role: 'backend', cwd: '/r', powers: ['postgres'] },
      { POSTGRES_CONNECTION_STRING: 'postgres://localhost/test' } as NodeJS.ProcessEnv,
    );
    expect(result.applied).toEqual(['postgres']);
    expect(result.warnings).toEqual([]);
    const json = JSON.parse(readFileSync(result.configPath!, 'utf-8'));
    expect(json.mcpServers.postgres.args).toContain('postgres://localhost/test');
  });
});

describe('prepareAgentMcpConfig — skip with warning', () => {
  it('warns and skips an unknown power', async () => {
    const { prepareAgentMcpConfig } = await import('../../src/cli/mcp-config.js');
    const result = prepareAgentMcpConfig('myproj', {
      role: 'backend',
      cwd: '/r',
      powers: ['definitely-not-a-real-power'],
    });
    expect(result.configPath).toBeNull();
    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['definitely-not-a-real-power']);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('not in registry');
  });

  it('warns and skips a power whose required env is unset', async () => {
    const { prepareAgentMcpConfig } = await import('../../src/cli/mcp-config.js');
    const result = prepareAgentMcpConfig(
      'myproj',
      { role: 'backend', cwd: '/r', powers: ['postgres'] },
      {} as NodeJS.ProcessEnv,
    );
    expect(result.configPath).toBeNull();
    expect(result.skipped).toEqual(['postgres']);
    expect(result.warnings[0]).toContain('POSTGRES_CONNECTION_STRING');
  });

  it('keeps good powers when a sibling power is skipped', async () => {
    const { prepareAgentMcpConfig } = await import('../../src/cli/mcp-config.js');
    const result = prepareAgentMcpConfig(
      'myproj',
      { role: 'backend', cwd: '/r', powers: ['git', 'postgres'] },
      {} as NodeJS.ProcessEnv,
    );
    expect(result.applied).toEqual(['git']);
    expect(result.skipped).toEqual(['postgres']);
    expect(result.configPath).not.toBeNull();
    const json = JSON.parse(readFileSync(result.configPath!, 'utf-8'));
    expect(Object.keys(json.mcpServers)).toEqual(['git']);
  });
});

describe('pruneAgentMcpConfig', () => {
  it('is idempotent on missing files', async () => {
    const { pruneAgentMcpConfig } = await import('../../src/cli/mcp-config.js');
    expect(() => pruneAgentMcpConfig('myproj', 'backend')).not.toThrow();
  });
});

// v0.4.x audit Wave 1 add — feature 4 (powers) gap. The unit tests
// above exercise prepareAgentMcpConfig for one agent at a time. They
// do not pin that two agents in the same project end up with
// independent files. A regression that wrote the same config across
// agents would cause one agent's power to "leak" into another, which
// the user would notice but no test catches.
describe('prepareAgentMcpConfig — per-agent isolation in the same project', () => {
  it('a power applied to agent A does not appear in agent B\'s config', async () => {
    const { prepareAgentMcpConfig, agentMcpConfigPath } = await import(
      '../../src/cli/mcp-config.js'
    );

    const a = prepareAgentMcpConfig('iso-proj', {
      role: 'backend',
      cwd: '/r/back',
      powers: ['git'],
    });
    const b = prepareAgentMcpConfig('iso-proj', {
      role: 'frontend',
      cwd: '/r/front',
      powers: [],
    });

    // A writes a file with the git power. B writes nothing.
    expect(a.configPath).not.toBeNull();
    expect(b.configPath).toBeNull();

    // The two agent-config paths must be distinct so the spawn flow
    // can hand each agent its own file.
    expect(agentMcpConfigPath('iso-proj', 'backend'))
      .not.toBe(agentMcpConfigPath('iso-proj', 'frontend'));

    // A's config really contains git; B has no file at all.
    expect(existsSync(a.configPath!)).toBe(true);
    expect(existsSync(agentMcpConfigPath('iso-proj', 'frontend'))).toBe(false);
    const aJson = JSON.parse(readFileSync(a.configPath!, 'utf-8'));
    expect(Object.keys(aJson.mcpServers)).toEqual(['git']);
  });
});
