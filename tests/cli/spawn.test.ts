// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
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

// MCP registration tests live in their own file (spawn-mcp-register.test.ts)
// so the mock surface stays scoped. The old `isMcpServerRegistered (mocked
// child_process)` block here used to assert against `claude mcp list`
// output — that code path was replaced by `mcp get` in v0.3.2.1 (HIGH-1).
