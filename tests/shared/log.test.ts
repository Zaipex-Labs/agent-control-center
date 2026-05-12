// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { swallow, swallowAsync } from '../../src/shared/log.js';

describe('swallow() — MED-12 wave-1', () => {
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

  it('runs the function and writes nothing when no throw', () => {
    swallow('test:ok', () => { /* noop */ });
    expect(writes).toEqual([]);
  });

  it('captures Error.message into the stderr line', () => {
    swallow('test:err', () => { throw new Error('boom'); });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('[swallow:test:err] boom\n');
  });

  it('captures non-Error throws via String()', () => {
    swallow('test:string-throw', () => { throw 'plain string'; });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('[swallow:test:string-throw] plain string\n');
  });

  it('falls back to Error.name when message is empty', () => {
    const e = new Error('');
    e.name = 'ENOENT';
    swallow('test:name-only', () => { throw e; });
    expect(writes[0]).toBe('[swallow:test:name-only] ENOENT\n');
  });

  it('does not re-throw — function returns normally after a throw', () => {
    // No try/catch around swallow(); if it re-threw, this line would
    // never execute and the test would fail with the thrown error.
    swallow('test:no-rethrow', () => { throw new Error('x'); });
    expect(writes).toHaveLength(1);
  });
});

describe('swallowAsync() — MED-12 wave-1', () => {
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

  it('resolves normally when no throw', async () => {
    await swallowAsync('test:async-ok', async () => { /* noop */ });
    expect(writes).toEqual([]);
  });

  it('resolves (does not reject) when fn rejects with Error', async () => {
    await swallowAsync('test:async-err', async () => { throw new Error('async boom'); });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('[swallow:test:async-err] async boom\n');
  });

  it('resolves when fn rejects synchronously inside an async function', async () => {
    await swallowAsync('test:async-sync-throw', () => {
      return Promise.reject(new Error('sync-throw-in-async'));
    });
    expect(writes[0]).toBe('[swallow:test:async-sync-throw] sync-throw-in-async\n');
  });

  it('label appears in the canonical [swallow:label] format', async () => {
    await swallowAsync('mcp:channel-push', async () => { throw new Error('test'); });
    expect(writes[0]).toMatch(/^\[swallow:mcp:channel-push\] /);
  });
});
