// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// MED-12 wave-1: swallow / swallowAsync are error suppression helpers.
// Audited in v0.4.x — pre-audit the file pinned exact stderr strings,
// which made the tests brittle without protecting any operator-visible
// behavior. We now assert only the two contracts that matter:
// (1) errors are swallowed (no re-throw); (2) the canonical
// [swallow:label] prefix appears so operators can grep logs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { swallow, swallowAsync } from '../../src/shared/log.js';

describe('swallow / swallowAsync — error suppression contract', () => {
  let writes: string[];
  let origWrite: typeof process.stderr.write;

  beforeEach(() => {
    writes = [];
    origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string | Uint8Array) => {
      writes.push(typeof s === 'string' ? s : Buffer.from(s).toString());
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = origWrite;
  });

  it('swallow does not re-throw and tags stderr with the [swallow:label] prefix', () => {
    // No try/catch around swallow(); if it re-threw, the second line
    // never runs and the test fails with the thrown error.
    swallow('test:err', () => { throw new Error('boom'); });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/^\[swallow:test:err\] /);
  });

  it('swallowAsync resolves regardless of throw type and tags with the canonical prefix', async () => {
    // swallowAsync returns void — the contract is only that it does
    // not reject, regardless of whether fn throws or what fn throws.
    await expect(swallowAsync('test:async-ok', async () => { /* noop */ })).resolves.toBeUndefined();
    await expect(swallowAsync('test:async-err', async () => { throw new Error('async boom'); })).resolves.toBeUndefined();
    await expect(swallowAsync('test:async-string', async () => { throw 'plain string'; })).resolves.toBeUndefined();
    expect(writes.length).toBeGreaterThanOrEqual(2);
    expect(writes.every(w => w.startsWith('[swallow:'))).toBe(true);
  });
});
