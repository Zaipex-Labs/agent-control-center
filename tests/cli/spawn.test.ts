// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectStrategy, hasTmuxSession } from '../../src/cli/spawn.js';

describe('detectStrategy', () => {
  it('returns a known strategy', () => {
    const s = detectStrategy();
    expect(['tmux', 'windows-terminal', 'fallback']).toContain(s);
  });

  it('matches platform expectations', () => {
    const s = detectStrategy();
    if (process.platform === 'win32') {
      expect(s).toBe('windows-terminal');
    } else {
      expect(['tmux', 'fallback']).toContain(s);
    }
  });
});

// isMcpServerRegistered used to spawn `claude mcp list` for real. On CI
// runners without the CLI installed, that spawn occasionally timed out
// past vitest's 5s limit. We now mock node:child_process so the test is
// deterministic regardless of what's on the PATH.
describe('isMcpServerRegistered (mocked child_process)', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.doUnmock('node:child_process'); });

  it('returns true when claude output contains zaipex-acc', async () => {
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync: vi.fn(() => 'zaipex-acc: registered\nother-server: …\n'),
      };
    });
    const { isMcpServerRegistered } = await import('../../src/cli/spawn.js');
    expect(isMcpServerRegistered()).toBe(true);
  });

  it('returns false when claude is missing (throws ENOENT)', async () => {
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
      };
    });
    const { isMcpServerRegistered } = await import('../../src/cli/spawn.js');
    expect(isMcpServerRegistered()).toBe(false);
  });

  it('returns false when claude output does not contain zaipex-acc', async () => {
    vi.doMock('node:child_process', async () => {
      const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync: vi.fn(() => 'other-server-1\nother-server-2\n'),
      };
    });
    const { isMcpServerRegistered } = await import('../../src/cli/spawn.js');
    expect(isMcpServerRegistered()).toBe(false);
  });
});

describe('hasTmuxSession', () => {
  it('returns false for a clearly nonexistent tmux session', () => {
    expect(hasTmuxSession('zaipex-acc-test-nonexistent-project-xyz')).toBe(false);
  });
});
