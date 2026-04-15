// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { detectStrategy, isMcpServerRegistered, hasTmuxSession } from '../../src/cli/spawn.js';

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

describe('isMcpServerRegistered', () => {
  it('does not throw whether claude CLI is installed or not', () => {
    expect(() => isMcpServerRegistered()).not.toThrow();
    expect(typeof isMcpServerRegistered()).toBe('boolean');
  });
});

describe('hasTmuxSession', () => {
  it('returns false for a clearly nonexistent tmux session', () => {
    expect(hasTmuxSession('zaipex-acc-test-nonexistent-project-xyz')).toBe(false);
  });
});
