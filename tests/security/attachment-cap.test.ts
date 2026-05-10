// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [S-NEW-6] cap on `attachments[]` per send-message / send-to-role
// call. v0.2.4 and earlier iterated `incoming` without a tope, so a
// single 1MB request body could carry ~5,000 descriptors and force
// the broker to do thousands of getBlob() readdirSyncs (L-2) and
// blob_refs INSERTs while the event loop stalls.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { initDatabase, insertPeer } from '../../src/broker/database.js';
import { handleSendMessage, handleSendToRole } from '../../src/broker/handlers.js';
import type { Peer } from '../../src/shared/types.js';

interface MockRes {
  statusCode: number;
  body: { ok?: boolean; error?: string; code?: string } | null;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((status: number) => {
    result.statusCode = status;
    return res;
  }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => {
    if (data) result.body = JSON.parse(data);
    return res;
  }) as ServerResponse['end'];
  return { res, result };
}

function makePeer(id: string, role = 'agent'): Peer {
  const now = new Date().toISOString();
  return {
    id, project_id: 'p', pid: process.pid, name: id, role,
    agent_type: 'claude-code', cwd: '/tmp', git_root: null, git_branch: null,
    tty: null, summary: '', registered_at: now, last_seen: now,
  };
}

function descriptors(n: number): Array<{ hash: string; mime: string; name: string; size: number }> {
  return Array.from({ length: n }, (_, i) => ({
    hash: 'a'.repeat(64 - String(i).length) + i,
    mime: 'image/png',
    name: `pic-${i}.png`,
    size: 1024,
  }));
}

beforeEach(() => {
  initDatabase(':memory:');
  insertPeer(makePeer('alice'));
  insertPeer(makePeer('bob'));
  insertPeer(makePeer('carol', 'backend'));
});

describe('[S-NEW-6] attachment cap (32 per message)', () => {
  it('handleSendMessage rejects 33 attachments with 400 TOO_MANY_ATTACHMENTS', () => {
    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'p', from_id: 'alice', to_id: 'bob', text: 'spam',
      attachments: descriptors(33),
    }, res);
    expect(result.statusCode).toBe(400);
    expect(result.body?.code).toBe('TOO_MANY_ATTACHMENTS');
  });

  it('handleSendToRole rejects 33 attachments with 400 TOO_MANY_ATTACHMENTS', () => {
    const { res, result } = createMockRes();
    handleSendToRole({
      project_id: 'p', from_id: 'alice', role: 'backend', text: 'spam',
      attachments: descriptors(33),
    }, res);
    expect(result.statusCode).toBe(400);
    expect(result.body?.code).toBe('TOO_MANY_ATTACHMENTS');
  });

  it('handleSendMessage rejects exactly 33 (boundary)', () => {
    // 32 is allowed, 33 is not — but with 32 we'd fail BLOB_NOT_FOUND
    // because the descriptors point to non-existent blobs. We pin only
    // the boundary on the cap itself.
    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'p', from_id: 'alice', to_id: 'bob', text: 'spam',
      attachments: descriptors(33),
    }, res);
    expect(result.body?.code).toBe('TOO_MANY_ATTACHMENTS');
  });

  it('handleSendMessage with 32 attachments passes the cap (would fail later as BLOB_NOT_FOUND)', () => {
    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'p', from_id: 'alice', to_id: 'bob', text: 'thirty-two',
      attachments: descriptors(32),
    }, res);
    // Cap not hit — falls through to the per-blob existence check and
    // 404s on the first synthetic hash. The point is that the cap did
    // NOT fire here.
    expect(result.body?.code).not.toBe('TOO_MANY_ATTACHMENTS');
  });

  it('handleSendMessage with 0 attachments works normally', () => {
    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'p', from_id: 'alice', to_id: 'bob', text: 'hi',
    }, res);
    expect(result.statusCode).toBe(200);
    expect(result.body?.ok).toBe(true);
  });
});
