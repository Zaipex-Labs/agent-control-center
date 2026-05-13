// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../../src/broker/database.js';
import { setBlobsRoot } from '../../src/broker/blobs.js';
import { handleBlobStats } from '../../src/broker/handlers.js';

function createMockRes() {
  const result = { statusCode: 200, body: null as any };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = (status: number) => { result.statusCode = status; return res; };
  res.end = ((data?: string) => {
    if (data) { try { result.body = JSON.parse(data); } catch { result.body = data; } }
    return res;
  }) as ServerResponse['end'];
  return { res, result };
}

describe('handleBlobStats (dev-only)', () => {
  let home: string;
  let prevNodeEnv: string | undefined;

  beforeEach(() => {
    prevNodeEnv = process.env['NODE_ENV'];
    home = mkdtempSync(join(tmpdir(), 'acc-stats-'));
    setBlobsRoot(join(home, 'blobs'));
    initDatabase(':memory:');
  });

  afterEach(() => {
    setBlobsRoot(null);
    if (prevNodeEnv != null) process.env['NODE_ENV'] = prevNodeEnv;
    else delete process.env['NODE_ENV'];
    rmSync(home, { recursive: true, force: true });
  });

  it('returns 404 in production', () => {
    process.env['NODE_ENV'] = 'production';
    const { res, result } = createMockRes();
    handleBlobStats(res);
    expect(result.statusCode).toBe(404);
  });
});
