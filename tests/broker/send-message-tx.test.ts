// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [P-17] handleSendMessage / handleSendToRole used to issue their 4-7
// writes (insertMessage + insertLogEntry + addBlobRef × N + touchThread)
// as separate implicit transactions. Each write fsync'd the WAL
// independently, and a throw between writes left the DB in an
// inconsistent state (e.g. message row written but log entry missing).
//
// v0.3.1.5 wraps the writes inside a single getDb().transaction().
// This test forces a mid-transaction failure and asserts every prior
// write is rolled back — nothing in messages, message_log, or
// blob_refs survives.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import {
  initDatabase,
  insertPeer,
  selectUndelivered,
  selectHistory,
  getDb,
} from '../../src/broker/database.js';
import * as dbMod from '../../src/broker/database.js';
import { handleSendMessage, handleSendToRole } from '../../src/broker/handlers.js';
import type { Peer } from '../../src/shared/types.js';

interface MockRes {
  statusCode: number;
  body: unknown;
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

function makePeer(overrides: Partial<Peer> = {}): Peer {
  const now = new Date().toISOString();
  return {
    id: `peer-${Math.random().toString(36).slice(2, 6)}`,
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
    registered_at: now,
    last_seen: now,
    ...overrides,
  };
}

function countBlobRefs(): number {
  return (getDb().prepare('SELECT COUNT(*) as n FROM blob_refs').get() as { n: number }).n;
}

beforeEach(() => {
  initDatabase(':memory:');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleSendMessage transaction rollback [P-17]', () => {
  it('rolls back insertMessage when insertLogEntry throws mid-transaction', async () => {
    const from = makePeer({ id: 'p-from', role: 'backend', name: 'Turing' });
    const to = makePeer({ id: 'p-to', role: 'frontend', name: 'Lovelace' });
    insertPeer(from);
    insertPeer(to);

    // Snapshot baseline. Both tables must come back to this state.
    expect(selectUndelivered(to.id)).toHaveLength(0);
    expect(selectHistory('proj', { limit: 50 })).toHaveLength(0);
    expect(countBlobRefs()).toBe(0);

    // Force insertLogEntry to throw on the first call — this fires
    // AFTER insertMessage has already inserted a row inside the same
    // transaction. Without the transaction wrapper, that row would
    // survive.
    const spy = vi.spyOn(dbMod, 'insertLogEntry').mockImplementation(() => {
      throw new Error('simulated mid-tx failure');
    });

    const { res } = createMockRes();
    await expect(
      handleSendMessage({
        project_id: 'proj',
        from_id: from.id,
        to_id: to.id,
        text: 'should not survive',
      }, res),
    ).rejects.toThrow('simulated mid-tx failure');

    // Spy fired exactly once — confirming we actually triggered the
    // mid-transaction failure path (not some earlier rejection).
    expect(spy).toHaveBeenCalledTimes(1);

    // Rollback assertion: neither table has any new rows.
    expect(selectUndelivered(to.id)).toHaveLength(0);
    expect(selectHistory('proj', { limit: 50 })).toHaveLength(0);
    expect(countBlobRefs()).toBe(0);
  });

  it('commits both inserts when no statement throws', async () => {
    const from = makePeer({ id: 'p-from', role: 'backend', name: 'Turing' });
    const to = makePeer({ id: 'p-to', role: 'frontend', name: 'Lovelace' });
    insertPeer(from);
    insertPeer(to);

    const { res, result } = createMockRes();
    await handleSendMessage({
      project_id: 'proj',
      from_id: from.id,
      to_id: to.id,
      text: 'happy path',
    }, res);

    expect(result.statusCode).toBe(200);
    expect(selectUndelivered(to.id)).toHaveLength(1);
    expect(selectHistory('proj', { limit: 50 })).toHaveLength(1);
  });
});

describe('handleSendToRole transaction rollback [P-17]', () => {
  it('rolls back ALL per-target writes when insertLogEntry throws on the second target', async () => {
    const from = makePeer({ id: 'p-from', role: 'backend', name: 'Turing' });
    const t1 = makePeer({ id: 'p-t1', role: 'frontend', name: 'Lovelace' });
    const t2 = makePeer({ id: 'p-t2', role: 'frontend', name: 'Hopper' });
    insertPeer(from);
    insertPeer(t1);
    insertPeer(t2);

    // Throw on the SECOND call so the first target's insertMessage +
    // insertLogEntry succeed inside the transaction, then we fail.
    // The whole transaction must roll back — neither target should
    // see a message.
    let calls = 0;
    const realInsertLog = dbMod.insertLogEntry;
    const spy = vi.spyOn(dbMod, 'insertLogEntry').mockImplementation(((...args: Parameters<typeof realInsertLog>) => {
      calls++;
      if (calls >= 2) throw new Error('simulated 2nd-target failure');
      return realInsertLog(...args);
    }) as typeof realInsertLog);

    const { res } = createMockRes();
    await expect(
      handleSendToRole({
        project_id: 'proj',
        from_id: from.id,
        role: 'frontend',
        text: 'broadcast that must not stick',
      }, res),
    ).rejects.toThrow('simulated 2nd-target failure');

    expect(spy).toHaveBeenCalledTimes(2);
    // Neither target retains a message — full rollback.
    expect(selectUndelivered(t1.id)).toHaveLength(0);
    expect(selectUndelivered(t2.id)).toHaveLength(0);
    expect(selectHistory('proj', { limit: 50 })).toHaveLength(0);
  });
});
