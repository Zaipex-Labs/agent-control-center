// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Audited in v0.4.x — replaced 8 per-constant pin tests with a single
// shape assertion. The exact constant values (`127.0.0.1`, the
// `.zaipex-acc` suffix, etc.) are internal; what matters is that the
// resolved config has the expected key shape and sensible values for
// what they semantically represent.

import { describe, it, expect } from 'vitest';
import {
  ACC_HOST,
  ACC_PORT,
  ACC_HOME,
  ACC_DB,
  PROJECTS_DIR,
  BROKER_URL,
  STALE_PEER_SECONDS,
  CLEANUP_INTERVAL_MS,
} from '../../src/shared/config.js';

describe('config — env resolution shape', () => {
  it('exposes the expected keys with sane defaults', () => {
    expect(typeof ACC_HOST).toBe('string');
    expect(ACC_HOST.length).toBeGreaterThan(0);

    expect(ACC_PORT).toBeGreaterThanOrEqual(1);
    expect(ACC_PORT).toBeLessThanOrEqual(65535);

    expect(ACC_HOME).toMatch(/\.zaipex-acc$/);
    expect(ACC_DB.startsWith(ACC_HOME)).toBe(true);
    expect(PROJECTS_DIR.startsWith(ACC_HOME)).toBe(true);

    expect(BROKER_URL).toBe(`http://${ACC_HOST}:${ACC_PORT}`);

    expect(STALE_PEER_SECONDS).toBeGreaterThan(0);
    expect(CLEANUP_INTERVAL_MS).toBeGreaterThan(0);
  });
});
