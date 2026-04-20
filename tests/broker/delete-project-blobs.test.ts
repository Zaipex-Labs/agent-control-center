// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ACC_HOME must be set BEFORE importing config/handlers, and the module
// cache must be reset so PROJECTS_DIR evaluates against our temp dir.
// Type aliases for the dynamic imports.
type Handlers = typeof import('../../src/broker/handlers.js');
type Blobs = typeof import('../../src/broker/blobs.js');
type BlobRefs = typeof import('../../src/broker/blob-refs.js');
type Db = typeof import('../../src/broker/database.js');

let home: string;
let prevAccHome: string | undefined;
let H: Handlers;
let B: Blobs;
let R: BlobRefs;

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

describe('handleDeleteProject releases blob refs', () => {
  beforeEach(async () => {
    prevAccHome = process.env['ACC_HOME'];
    home = mkdtempSync(join(tmpdir(), 'acc-del-'));
    process.env['ACC_HOME'] = home;
    mkdirSync(join(home, 'projects'), { recursive: true });
    vi.resetModules();
    const db: Db = await import('../../src/broker/database.js');
    db.initDatabase(':memory:');
    B = await import('../../src/broker/blobs.js');
    B.setBlobsRoot(join(home, 'blobs'));
    R = await import('../../src/broker/blob-refs.js');
    H = await import('../../src/broker/handlers.js');
  });

  afterEach(() => {
    B.setBlobsRoot(null);
    if (prevAccHome != null) process.env['ACC_HOME'] = prevAccHome;
    else delete process.env['ACC_HOME'];
    rmSync(home, { recursive: true, force: true });
  });

  function writeProjectConfig(name: string) {
    writeFileSync(
      join(home, 'projects', `${name}.json`),
      JSON.stringify({ name, description: '', created_at: '2026-04-20', agents: [] }),
    );
  }

  it('deletes blob files whose only project was the deleted one', () => {
    writeProjectConfig('a-proj');
    writeProjectConfig('b-proj');

    const blobA = B.storeBlob(Buffer.from('A only'), 'text/plain', 'a.txt');
    const blobShared = B.storeBlob(Buffer.from('shared bytes'), 'text/plain', 's.txt');

    R.addBlobRef(blobA.hash, 'a-proj', 1);
    R.addBlobRef(blobShared.hash, 'a-proj', 2);
    R.addBlobRef(blobShared.hash, 'b-proj', 3);

    const { res, result } = createMockRes();
    H.handleDeleteProject({ project_id: 'a-proj' }, res);

    expect(result.statusCode).toBe(200);
    // a-only hash is gone both from DB refs and from disk
    expect(R.countBlobRefs(blobA.hash)).toBe(0);
    expect(B.getBlob(blobA.hash)).toBeNull();
    // shared hash still referenced by b-proj — file remains
    expect(R.countBlobRefs(blobShared.hash)).toBe(1);
    expect(B.getBlob(blobShared.hash)).not.toBeNull();
  });
});
