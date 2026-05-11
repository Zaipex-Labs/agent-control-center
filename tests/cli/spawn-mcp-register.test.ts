// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// v0.3.2.1 HIGH-1: `registerMcpServer` used to be non-idempotent —
// when `zaipex-acc` was already registered in claude's user-scope MCP
// list (typical for users with prior installs / multi-MCP setups),
// `claude mcp add` would exit 1 with "already exists in user config"
// and the broker would propagate the raw stderr to the user.
//
// These tests pin the new behavior:
//   1. Not registered → adds.
//   2. Already registered with matching args → silent skip.
//   3. Already registered with different args (other install) → log
//      a clear warning + continue (the existing registration wins;
//      the user can switch installs by removing it).
//   4. TOCTOU: `mcp add` raced and failed with "already exists" →
//      treat as success.
//   5. Any other `mcp add` failure → throw a single-line error so
//      the broker doesn't propagate raw stderr.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Build a mock for `execFileSync` that routes based on the claude
// sub-command being invoked. Each test passes in handlers for the
// commands it cares about; unhandled commands throw a "not configured"
// error so unintended calls are obvious.
function mockClaude(handlers: {
  get?: (args: string[]) => string;
  add?: (args: string[]) => string;
}) {
  return vi.fn((cmd: string, args: string[]) => {
    // The first execFileSync call in the codebase under test that
    // we don't care about is `which tmux`. Let it succeed silently.
    if (cmd === 'which') return Buffer.from('');
    if (cmd !== 'claude') {
      throw new Error(`unexpected command in mock: ${cmd}`);
    }
    const sub = args.slice(0, 2).join(' ');
    if (sub === 'mcp get') {
      if (!handlers.get) {
        // Default: simulate "not registered" → claude exits non-zero.
        const err = Object.assign(new Error('not registered'), {
          status: 1,
          stderr: Buffer.from('No MCP server named zaipex-acc'),
        });
        throw err;
      }
      return handlers.get(args);
    }
    if (sub === 'mcp add') {
      if (!handlers.add) {
        throw new Error('mcp add called but no handler configured');
      }
      return handlers.add(args);
    }
    throw new Error(`unhandled claude sub-command: ${args.join(' ')}`);
  });
}

// Real spawn.ts uses `getServerEntryPath()` which resolves the path
// of the server entry relative to import.meta.url. Under vitest, that
// resolves to `src/server/index.ts`. We construct a matching expected
// registration here so the test doesn't hard-code an absolute path.
async function expectedFromCurrentInstall(): Promise<{ command: string; args: string[] }> {
  const { fileURLToPath } = await import('node:url');
  const { resolve } = await import('node:path');
  const { resolveEntryPoint } = await import('../../src/shared/utils.js');
  // Mirror getServerEntryPath() in src/cli/spawn.ts — relative to that file.
  const cliSpawnUrl = new URL('../../src/cli/spawn.ts', import.meta.url).href;
  const thisDir = resolve(fileURLToPath(cliSpawnUrl), '..');
  const serverPath = resolveEntryPoint(thisDir, '..', 'server', 'index.ts');
  return serverPath.endsWith('.ts')
    ? { command: 'npx', args: ['tsx', serverPath] }
    : { command: 'node', args: [serverPath] };
}

describe('registerMcpServer (v0.3.2.1 HIGH-1 idempotency)', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.doUnmock('node:child_process');
    stderrSpy.mockRestore();
  });

  it('not registered → invokes mcp add with the current install args', async () => {
    const expected = await expectedFromCurrentInstall();
    const fake = mockClaude({
      add: (args) => {
        // The add path should be: mcp add --scope user --transport stdio zaipex-acc -- <command> ...<args>
        expect(args.slice(0, 8)).toEqual([
          'mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'zaipex-acc', '--',
        ]);
        expect(args[8]).toBe(expected.command);
        expect(args.slice(9)).toEqual(expected.args);
        return '';
      },
    });

    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, execFileSync: fake };
    });
    const { registerMcpServer } = await import('../../src/cli/spawn.js');

    expect(() => registerMcpServer()).not.toThrow();
    expect(fake).toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('same install already registered → no-op (no mcp add, no stderr)', async () => {
    const expected = await expectedFromCurrentInstall();
    const fake = mockClaude({
      get: () => [
        'zaipex-acc:',
        '  Scope: User config (available in all your projects)',
        '  Status: ✓ Connected',
        '  Type: stdio',
        `  Command: ${expected.command}`,
        `  Args: ${expected.args.join(' ')}`,
        '  Environment:',
        '',
      ].join('\n'),
      add: () => {
        throw new Error('mcp add should NOT be called when the same install is registered');
      },
    });

    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, execFileSync: fake };
    });
    const { registerMcpServer } = await import('../../src/cli/spawn.js');

    expect(() => registerMcpServer()).not.toThrow();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('different install registered → logs clear warning + continues (no error)', async () => {
    const fake = mockClaude({
      get: () => [
        'zaipex-acc:',
        '  Scope: User config (available in all your projects)',
        '  Status: ✓ Connected',
        '  Type: stdio',
        '  Command: npx',
        '  Args: tsx /Users/someone/other-install/src/server/index.ts',
        '',
      ].join('\n'),
      add: () => {
        throw new Error('mcp add should NOT be called when another install owns the slot');
      },
    });

    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, execFileSync: fake };
    });
    const { registerMcpServer } = await import('../../src/cli/spawn.js');

    expect(() => registerMcpServer()).not.toThrow();

    expect(stderrSpy).toHaveBeenCalled();
    const message = stderrSpy.mock.calls.map(c => String(c[0])).join('');
    expect(message).toContain('already registered');
    expect(message).toContain('current:');
    expect(message).toContain('this install:');
    expect(message).toContain('claude mcp remove zaipex-acc -s user');
    // The current registration's path should appear so the user can identify it.
    expect(message).toContain('/Users/someone/other-install/src/server/index.ts');
  });

  it('TOCTOU: mcp add raced, claude reports "already exists" → success', async () => {
    let getCallCount = 0;
    const fake = mockClaude({
      get: () => {
        // First call: not registered. We then try `mcp add` and lose the race.
        if (getCallCount++ === 0) {
          const err = Object.assign(new Error('not registered'), {
            status: 1,
            stderr: Buffer.from('No MCP server named zaipex-acc'),
          });
          throw err;
        }
        return '';
      },
      add: () => {
        const err = Object.assign(new Error('Command failed'), {
          status: 1,
          stderr: Buffer.from('MCP server zaipex-acc already exists in user config'),
        });
        throw err;
      },
    });

    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, execFileSync: fake };
    });
    const { registerMcpServer } = await import('../../src/cli/spawn.js');

    expect(() => registerMcpServer()).not.toThrow();
  });

  it('genuine mcp add failure → throws single-line error (no multi-line stderr propagation)', async () => {
    const fake = mockClaude({
      add: () => {
        const err = Object.assign(new Error('Command failed'), {
          status: 1,
          stderr: Buffer.from('Something exploded\nbecause of reasons\nclaude: exit 1'),
        });
        throw err;
      },
    });

    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, execFileSync: fake };
    });
    const { registerMcpServer } = await import('../../src/cli/spawn.js');

    let caught: unknown;
    try { registerMcpServer(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toBe('Something exploded');
    expect(message).not.toContain('\n');
  });

  it('claude unavailable (ENOENT on mcp get) → falls through, mcp add path attempted', async () => {
    const fake = mockClaude({
      // No `get` handler → default behavior simulates not-registered.
      add: () => '',
    });

    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, execFileSync: fake };
    });
    const { registerMcpServer } = await import('../../src/cli/spawn.js');

    expect(() => registerMcpServer()).not.toThrow();
  });
});

describe('getRegisteredMcpServer (v0.3.2.1)', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.doUnmock('node:child_process'); });

  it('returns null when claude exits non-zero (not registered)', async () => {
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync: vi.fn(() => { throw new Error('not found'); }),
      };
    });
    const { getRegisteredMcpServer } = await import('../../src/cli/spawn.js');
    expect(getRegisteredMcpServer()).toBeNull();
  });

  it('parses Command + Args from mcp get output', async () => {
    const output = [
      'zaipex-acc:',
      '  Scope: User config (available in all your projects)',
      '  Status: ✓ Connected',
      '  Type: stdio',
      '  Command: npx',
      '  Args: tsx /Users/alice/zaipex-acc/src/server/index.ts',
      '  Environment:',
      '',
    ].join('\n');
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, execFileSync: vi.fn(() => output) };
    });
    const { getRegisteredMcpServer } = await import('../../src/cli/spawn.js');

    expect(getRegisteredMcpServer()).toEqual({
      command: 'npx',
      args: ['tsx', '/Users/alice/zaipex-acc/src/server/index.ts'],
    });
  });

  it('isMcpServerRegistered stays back-compat (returns boolean)', async () => {
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return { ...actual, execFileSync: vi.fn(() => 'zaipex-acc:\n  Command: node\n  Args: /path\n') };
    });
    const { isMcpServerRegistered } = await import('../../src/cli/spawn.js');
    expect(isMcpServerRegistered()).toBe(true);
  });
});
