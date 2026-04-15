// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { ACC_HOST, ACC_PORT, ACC_HOME, ACC_DB, PROJECTS_DIR, BROKER_URL, STALE_PEER_SECONDS, CLEANUP_INTERVAL_MS } from '../../src/shared/config.js';

describe('config constants', () => {
  it('ACC_HOST is always localhost', () => {
    expect(ACC_HOST).toBe('127.0.0.1');
  });

  it('ACC_PORT is a valid port number', () => {
    expect(ACC_PORT).toBeGreaterThanOrEqual(1);
    expect(ACC_PORT).toBeLessThanOrEqual(65535);
  });

  it('ACC_HOME ends with .zaipex-acc', () => {
    expect(ACC_HOME).toMatch(/\.zaipex-acc$/);
  });

  it('ACC_DB is inside ACC_HOME', () => {
    expect(ACC_DB).toContain(ACC_HOME);
    expect(ACC_DB).toMatch(/acc\.db$/);
  });

  it('PROJECTS_DIR is inside ACC_HOME', () => {
    expect(PROJECTS_DIR).toContain(ACC_HOME);
    expect(PROJECTS_DIR).toMatch(/projects$/);
  });

  it('BROKER_URL uses ACC_HOST and ACC_PORT', () => {
    expect(BROKER_URL).toBe(`http://${ACC_HOST}:${ACC_PORT}`);
  });

  it('STALE_PEER_SECONDS is positive', () => {
    expect(STALE_PEER_SECONDS).toBeGreaterThan(0);
  });

  it('CLEANUP_INTERVAL_MS is positive', () => {
    expect(CLEANUP_INTERVAL_MS).toBeGreaterThan(0);
  });
});
