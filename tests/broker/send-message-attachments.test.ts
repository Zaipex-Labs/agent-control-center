// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, insertPeer, getDb } from '../../src/broker/database.js';
import { storeBlob, setBlobsRoot } from '../../src/broker/blobs.js';
import { countBlobRefs } from '../../src/broker/blob-refs.js';
import { handleSendMessage } from '../../src/broker/handlers.js';
import type { Peer } from '../../src/shared/types.js';

function makePeer(overrides: Partial<Peer>): Peer {
  return {
    id: 'id',
    project_id: 'proj',
    pid: process.pid,
    name: 'Turing',
    role: 'backend',
    agent_type: 'claude-code',
    cwd: '/tmp',
    git_root: null,
    git_branch: null,
    tty: null,
    summary: '',
    registered_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    ...overrides,
  } as Peer;
}

interface MockRes {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null, headers: {} };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = (status: number, headers?: Record<string, string>) => {
    result.statusCode = status;
    if (headers) Object.assign(result.headers, headers);
    return res;
  };
  res.end = ((data?: string) => {
    if (data) { try { result.body = JSON.parse(data); } catch { result.body = data; } }
    return res;
  }) as ServerResponse['end'];
  return { res, result };
}

describe('handleSendMessage with attachments', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'acc-send-'));
    setBlobsRoot(join(home, 'blobs'));
    initDatabase(':memory:');
  });
  afterEach(() => {
    setBlobsRoot(null);
    rmSync(home, { recursive: true, force: true });
  });

  it('accepts attachments, stores into metadata JSON, registers blob refs', async () => {
    const a = makePeer({ id: 'a', role: 'frontend' }); insertPeer(a);
    const b = makePeer({ id: 'b', role: 'backend' }); insertPeer(b);
    const blob = storeBlob(Buffer.from('png bytes'), 'image/png', 'shot.png');

    const { res, result } = createMockRes();
    await handleSendMessage({
      project_id: 'proj', from_id: 'a', to_id: 'b', text: 'mira esto',
      attachments: [blob],
    }, res);

    expect(result.statusCode).toBe(200);
    expect(countBlobRefs(blob.hash)).toBe(1);

    const row = getDb()
      .prepare('SELECT metadata FROM messages WHERE project_id=?')
      .get('proj') as { metadata: string };
    expect(JSON.parse(row.metadata).attachments[0].hash).toBe(blob.hash);
  });

  it('returns structured 404 when an attachment blob is not on disk', async () => {
    const a = makePeer({ id: 'a' }); insertPeer(a);
    const b = makePeer({ id: 'b' }); insertPeer(b);
    const missingHash = '0'.repeat(64);
    const { res, result } = createMockRes();
    await handleSendMessage({
      project_id: 'proj', from_id: 'a', to_id: 'b', text: 'x',
      attachments: [{ hash: missingHash, mime: 'image/png', name: 'x.png', size: 1 }],
    }, res);
    expect(result.statusCode).toBe(404);
    expect(result.body.code).toBe('BLOB_NOT_FOUND');
    expect(result.body.hash).toBe(missingHash);
  });

  it('preserves user-provided metadata and merges attachments', async () => {
    const a = makePeer({ id: 'a' }); insertPeer(a);
    const b = makePeer({ id: 'b' }); insertPeer(b);
    const blob = storeBlob(Buffer.from('x'), 'image/png', 'x.png');
    const { res } = createMockRes();
    await handleSendMessage({
      project_id: 'proj', from_id: 'a', to_id: 'b', text: 'x',
      metadata: JSON.stringify({ topic: 'logo' }),
      attachments: [blob],
    }, res);
    const row = getDb()
      .prepare('SELECT metadata FROM messages WHERE project_id=?')
      .get('proj') as { metadata: string };
    const parsed = JSON.parse(row.metadata);
    expect(parsed.topic).toBe('logo');
    expect(parsed.attachments).toHaveLength(1);
  });

  it('no attachments: leaves metadata untouched', async () => {
    const a = makePeer({ id: 'a' }); insertPeer(a);
    const b = makePeer({ id: 'b' }); insertPeer(b);
    const { res, result } = createMockRes();
    await handleSendMessage({
      project_id: 'proj', from_id: 'a', to_id: 'b', text: 'hi',
    }, res);
    expect(result.statusCode).toBe(200);
    const row = getDb()
      .prepare('SELECT metadata FROM messages WHERE project_id=?')
      .get('proj') as { metadata: string | null };
    expect(row.metadata).toBeNull();
  });
});
