// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  insertThread,
  selectThreadsByProject,
  selectThreadById,
  updateThread,
  searchThreads,
  searchMessagesInThreads,
  ensureGeneralThread,
  insertMessage,
  insertLogEntry,
  selectHistory,
  selectLogByThread,
} from '../../src/broker/database.js';
import type { Thread } from '../../src/shared/types.js';

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const now = new Date().toISOString();
  return {
    id: `t-${Math.random().toString(36).slice(2, 10)}`,
    project_id: 'proj',
    name: 'Test Thread',
    status: 'active',
    summary: '',
    created_by: 'peer1',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

beforeEach(() => {
  initDatabase(':memory:');
});

describe('thread CRUD', () => {
  it('creates and retrieves a thread', () => {
    const t = makeThread({ id: 'th01', name: 'Auth Discussion' });
    insertThread(t);

    const found = selectThreadById('proj', 'th01');
    expect(found).toBeDefined();
    expect(found!.name).toBe('Auth Discussion');
    expect(found!.status).toBe('active');
  });

  it('lists threads by project', () => {
    insertThread(makeThread({ id: 't1', project_id: 'p1', name: 'A' }));
    insertThread(makeThread({ id: 't2', project_id: 'p1', name: 'B' }));
    insertThread(makeThread({ id: 't3', project_id: 'p2', name: 'C' }));

    const p1Threads = selectThreadsByProject('p1');
    expect(p1Threads).toHaveLength(2);

    const p2Threads = selectThreadsByProject('p2');
    expect(p2Threads).toHaveLength(1);
  });

  it('lists threads filtered by status', () => {
    insertThread(makeThread({ id: 't1', status: 'active' }));
    insertThread(makeThread({ id: 't2', status: 'archived' }));
    insertThread(makeThread({ id: 't3', status: 'active' }));

    const active = selectThreadsByProject('proj', 'active');
    expect(active).toHaveLength(2);

    const archived = selectThreadsByProject('proj', 'archived');
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe('t2');
  });

  it('updates thread name and status', () => {
    insertThread(makeThread({ id: 'tu1', name: 'Old Name' }));

    const updated = updateThread('proj', 'tu1', { name: 'New Name', status: 'archived' });
    expect(updated).toBe(true);

    const found = selectThreadById('proj', 'tu1');
    expect(found!.name).toBe('New Name');
    expect(found!.status).toBe('archived');
  });

  it('updateThread returns false for nonexistent thread', () => {
    const updated = updateThread('proj', 'nope', { name: 'X' });
    expect(updated).toBe(false);
  });

  it('selectThreadById with empty projectId finds by id alone', () => {
    insertThread(makeThread({ id: 'global1', project_id: 'any-proj' }));

    const found = selectThreadById('', 'global1');
    expect(found).toBeDefined();
    expect(found!.project_id).toBe('any-proj');
  });
});

describe('thread search', () => {
  it('searches threads by name', () => {
    insertThread(makeThread({ id: 's1', name: 'API Design' }));
    insertThread(makeThread({ id: 's2', name: 'Database Migration' }));
    insertThread(makeThread({ id: 's3', name: 'API Endpoints' }));

    const results = searchThreads('proj', 'API');
    expect(results).toHaveLength(2);
  });

  it('searches threads by message content', () => {
    insertThread(makeThread({ id: 'sm1', name: 'General' }));
    insertMessage('proj', 'f', 't', 'message', 'lets discuss authentication', null, new Date().toISOString(), 'sm1');

    const results = searchThreads('proj', 'authentication');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('sm1');
  });

  it('searchMessagesInThreads returns matching messages with thread info', () => {
    insertThread(makeThread({ id: 'smt1', name: 'Auth Thread' }));
    insertLogEntry('proj', 'f1', 'backend', 't1', 'frontend', 'message', 'password hashing', null, new Date().toISOString(), 's1', 'smt1');
    insertLogEntry('proj', 'f2', 'frontend', 't2', 'backend', 'message', 'unrelated stuff', null, new Date().toISOString(), 's1', 'smt1');

    const matches = searchMessagesInThreads('proj', 'password');
    expect(matches).toHaveLength(1);
    expect(matches[0].thread_name).toBe('Auth Thread');
    expect(matches[0].thread_id).toBe('smt1');
  });
});

describe('ensureGeneralThread', () => {
  it('creates General thread on first call', () => {
    const thread = ensureGeneralThread('proj');
    expect(thread.name).toBe('General');
    expect(thread.project_id).toBe('proj');
    expect(thread.created_by).toBe('system');
  });

  it('returns same thread on second call (idempotent)', () => {
    const first = ensureGeneralThread('proj');
    const second = ensureGeneralThread('proj');
    expect(first.id).toBe(second.id);
  });

  it('creates separate General threads per project', () => {
    const t1 = ensureGeneralThread('p1');
    const t2 = ensureGeneralThread('p2');
    expect(t1.id).not.toBe(t2.id);
    expect(t1.project_id).toBe('p1');
    expect(t2.project_id).toBe('p2');
  });
});

describe('messages with thread_id', () => {
  it('insertMessage stores thread_id', () => {
    insertThread(makeThread({ id: 'mt1' }));
    insertMessage('proj', 'f', 't', 'message', 'hello', null, new Date().toISOString(), 'mt1');

    const history = selectHistory('proj');
    // Messages table, not log — check via selectLogByThread after inserting to log
  });

  it('get_history filters by thread_id', () => {
    insertThread(makeThread({ id: 'ht1', name: 'Thread A' }));
    insertThread(makeThread({ id: 'ht2', name: 'Thread B' }));

    insertLogEntry('proj', 'f', 'be', 't', 'fe', 'message', 'msg in A', null, new Date().toISOString(), 's', 'ht1');
    insertLogEntry('proj', 'f', 'be', 't', 'fe', 'message', 'msg in B', null, new Date().toISOString(), 's', 'ht2');
    insertLogEntry('proj', 'f', 'be', 't', 'fe', 'message', 'no thread', null, new Date().toISOString(), 's');

    const allHistory = selectHistory('proj');
    expect(allHistory).toHaveLength(3);

    const threadA = selectHistory('proj', { thread_id: 'ht1' });
    expect(threadA).toHaveLength(1);
    expect(threadA[0].text).toBe('msg in A');

    const threadB = selectHistory('proj', { thread_id: 'ht2' });
    expect(threadB).toHaveLength(1);
    expect(threadB[0].text).toBe('msg in B');
  });

  it('selectLogByThread returns entries in DESC order', () => {
    insertLogEntry('proj', 'f', 'be', 't', 'fe', 'message', 'first', null, new Date().toISOString(), 's', 'lt1');
    insertLogEntry('proj', 'f', 'be', 't', 'fe', 'message', 'second', null, new Date().toISOString(), 's', 'lt1');
    insertLogEntry('proj', 'f', 'be', 't', 'fe', 'message', 'third', null, new Date().toISOString(), 's', 'lt1');

    const entries = selectLogByThread('lt1', 10);
    expect(entries).toHaveLength(3);
    // DESC order: third first
    expect(entries[0].text).toBe('third');
    expect(entries[2].text).toBe('first');
  });
});

describe('thread summary generation', () => {
  it('generates summary from last 10 messages', () => {
    insertThread(makeThread({ id: 'sum1', name: 'Summary Thread' }));

    insertLogEntry('proj', 'a1', 'backend', 'a2', 'frontend', 'message', 'Hello from backend', null, new Date().toISOString(), 's', 'sum1');
    insertLogEntry('proj', 'a2', 'frontend', 'a1', 'backend', 'message', 'Hello from frontend', null, new Date().toISOString(), 's', 'sum1');
    insertLogEntry('proj', 'a1', 'backend', 'a2', 'frontend', 'message', 'API ready', null, new Date().toISOString(), 's', 'sum1');

    // Simulate what handleThreadSummary does
    const entries = selectLogByThread('sum1', 10);
    const lines = entries.reverse().map(e => `${e.from_role || e.from_id}: ${e.text}`);
    const summary = lines.join('\n');

    expect(summary).toBe('backend: Hello from backend\nfrontend: Hello from frontend\nbackend: API ready');

    // Update thread summary
    updateThread('proj', 'sum1', { summary });
    const thread = selectThreadById('proj', 'sum1');
    expect(thread!.summary).toBe(summary);
  });

  it('returns empty message for thread with no messages', () => {
    const entries = selectLogByThread('nonexistent', 10);
    expect(entries).toHaveLength(0);
  });
});
