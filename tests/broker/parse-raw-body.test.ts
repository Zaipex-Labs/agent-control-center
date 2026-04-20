// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { parseRawBody } from '../../src/broker/handlers.js';

function fakeReq(chunks: Buffer[]): IncomingMessage {
  const s = new PassThrough() as unknown as IncomingMessage;
  setImmediate(() => {
    for (const c of chunks) (s as unknown as PassThrough).write(c);
    (s as unknown as PassThrough).end();
  });
  return s;
}

describe('parseRawBody', () => {
  it('returns concatenated buffer', async () => {
    const r = await parseRawBody(fakeReq([Buffer.from('abc'), Buffer.from('def')]), 100);
    expect(r.toString()).toBe('abcdef');
  });

  it('rejects when over limit', async () => {
    await expect(
      parseRawBody(fakeReq([Buffer.alloc(200, 0)]), 100),
    ).rejects.toThrow(/too large/i);
  });

  it('resolves to empty buffer when no chunks arrive', async () => {
    const r = await parseRawBody(fakeReq([]), 100);
    expect(r.length).toBe(0);
  });
});
