// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { hasTmuxSession, tmuxNotify, tmuxInjectWithContext } from '../../src/broker/tmux.js';

// Tmux may or may not be installed in CI. These tests only cover the
// "no session exists" path, which is deterministic regardless of tmux
// availability (tmux absence also returns false via the catch block).

const NO_SESSION_ID = 'zaipex-acc-test-definitely-not-a-real-session-xyz';

describe('hasTmuxSession', () => {
  it('returns false for a session that does not exist', () => {
    expect(hasTmuxSession(NO_SESSION_ID)).toBe(false);
  });
});

describe('tmuxNotify', () => {
  it('returns false when target session does not exist', () => {
    const ok = tmuxNotify(NO_SESSION_ID, 'backend', 'Turing', 'backend');
    expect(ok).toBe(false);
  });
});

describe('tmuxInjectWithContext', () => {
  it('returns false when target session does not exist', () => {
    const ok = tmuxInjectWithContext(
      NO_SESSION_ID,
      'backend',
      'auth-refactor',
      'working on login',
      'Turing',
      'backend',
    );
    expect(ok).toBe(false);
  });
});
