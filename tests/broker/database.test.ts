import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  getDb,
  insertPeer,
  selectPeerById,
  selectPeersByProject,
  selectAllPeers,
  selectPeersByRole,
  selectPeersByCwd,
  selectPeersByGitRoot,
  updateLastSeen,
  updateSummary,
  updateRole,
  deletePeer,
  deleteStalePeers,
  countPeers,
  insertMessage,
  selectUndelivered,
  markDelivered,
  countPendingMessages,
  insertLogEntry,
  selectHistory,
  setSharedState,
  getSharedState,
  listSharedKeys,
  deleteSharedState,
} from '../../src/broker/database.js';
import type { Peer } from '../../src/shared/types.js';

function makePeer(overrides: Partial<Peer> = {}): Peer {
  const now = new Date().toISOString();
  return {
    id: `peer-${Math.random().toString(36).slice(2, 6)}`,
    project_id: 'test-project',
    pid: 12345,
    name: 'Turing',
    role: 'backend',
    agent_type: 'claude-code',
    cwd: '/tmp/test',
    git_root: null,
    git_branch: null,
    tty: null,
    summary: '',
    registered_at: now,
    last_seen: now,
    ...overrides,
  };
}

beforeEach(() => {
  initDatabase(':memory:');
});

// ── Peers ──────────────────────────────────────────────────────

describe('peers CRUD', () => {
  it('inserts and selects a peer by id', () => {
    const peer = makePeer({ id: 'p1' });
    insertPeer(peer);
    const found = selectPeerById('p1');
    expect(found).toBeDefined();
    expect(found!.id).toBe('p1');
    expect(found!.role).toBe('backend');
  });

  it('returns undefined for missing peer', () => {
    expect(selectPeerById('nope')).toBeUndefined();
  });

  it('selects peers by project', () => {
    insertPeer(makePeer({ id: 'a', project_id: 'proj1' }));
    insertPeer(makePeer({ id: 'b', project_id: 'proj1' }));
    insertPeer(makePeer({ id: 'c', project_id: 'proj2' }));

    expect(selectPeersByProject('proj1')).toHaveLength(2);
    expect(selectPeersByProject('proj2')).toHaveLength(1);
    expect(selectPeersByProject('proj3')).toHaveLength(0);
  });

  it('selects all peers', () => {
    insertPeer(makePeer({ id: 'a', project_id: 'p1' }));
    insertPeer(makePeer({ id: 'b', project_id: 'p2' }));
    expect(selectAllPeers()).toHaveLength(2);
  });

  it('selects peers by role', () => {
    insertPeer(makePeer({ id: 'a', role: 'backend' }));
    insertPeer(makePeer({ id: 'b', role: 'frontend' }));
    insertPeer(makePeer({ id: 'c', role: 'backend' }));

    expect(selectPeersByRole('test-project', 'backend')).toHaveLength(2);
    expect(selectPeersByRole('test-project', 'frontend')).toHaveLength(1);
    expect(selectPeersByRole('test-project', 'devops')).toHaveLength(0);
  });

  it('selects peers by cwd', () => {
    insertPeer(makePeer({ id: 'a', cwd: '/app/backend' }));
    insertPeer(makePeer({ id: 'b', cwd: '/app/frontend' }));

    expect(selectPeersByCwd('test-project', '/app/backend')).toHaveLength(1);
  });

  it('selects peers by git_root', () => {
    insertPeer(makePeer({ id: 'a', git_root: '/repo' }));
    insertPeer(makePeer({ id: 'b', git_root: '/other' }));

    expect(selectPeersByGitRoot('test-project', '/repo')).toHaveLength(1);
  });

  it('updates last_seen', () => {
    insertPeer(makePeer({ id: 'p1', last_seen: '2020-01-01T00:00:00Z' }));
    updateLastSeen('p1', '2025-06-01T00:00:00Z');
    expect(selectPeerById('p1')!.last_seen).toBe('2025-06-01T00:00:00Z');
  });

  it('updates summary', () => {
    insertPeer(makePeer({ id: 'p1' }));
    updateSummary('p1', 'Working on API');
    expect(selectPeerById('p1')!.summary).toBe('Working on API');
  });

  it('updates role', () => {
    insertPeer(makePeer({ id: 'p1', role: 'backend' }));
    updateRole('p1', 'devops');
    expect(selectPeerById('p1')!.role).toBe('devops');
  });

  it('deletes a peer', () => {
    insertPeer(makePeer({ id: 'p1' }));
    deletePeer('p1');
    expect(selectPeerById('p1')).toBeUndefined();
  });

  it('deletes stale peers by cutoff', () => {
    insertPeer(makePeer({ id: 'old', last_seen: '2020-01-01T00:00:00Z' }));
    insertPeer(makePeer({ id: 'new', last_seen: '2099-01-01T00:00:00Z' }));

    const removed = deleteStalePeers('2025-01-01T00:00:00Z');
    expect(removed).toBe(1);
    expect(selectPeerById('old')).toBeUndefined();
    expect(selectPeerById('new')).toBeDefined();
  });

  it('counts peers', () => {
    expect(countPeers()).toBe(0);
    insertPeer(makePeer({ id: 'a' }));
    insertPeer(makePeer({ id: 'b' }));
    expect(countPeers()).toBe(2);
  });
});

// ── Messages ───────────────────────────────────────────────────

describe('messages CRUD', () => {
  it('inserts a message and retrieves undelivered', () => {
    const id = insertMessage('proj', 'from1', 'to1', 'message', 'Hello', null, new Date().toISOString());
    expect(id).toBeGreaterThan(0);

    const msgs = selectUndelivered('to1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toBe('Hello');
    expect(msgs[0].delivered).toBe(0);
  });

  it('returns empty array when no undelivered messages', () => {
    expect(selectUndelivered('nobody')).toHaveLength(0);
  });

  it('marks messages as delivered', () => {
    const id1 = insertMessage('proj', 'f', 'to1', 'message', 'A', null, new Date().toISOString());
    const id2 = insertMessage('proj', 'f', 'to1', 'message', 'B', null, new Date().toISOString());

    markDelivered([id1, id2]);

    const msgs = selectUndelivered('to1');
    expect(msgs).toHaveLength(0);
  });

  it('handles empty array in markDelivered', () => {
    expect(() => markDelivered([])).not.toThrow();
  });

  it('counts pending messages', () => {
    expect(countPendingMessages()).toBe(0);
    insertMessage('proj', 'f', 't', 'message', 'A', null, new Date().toISOString());
    insertMessage('proj', 'f', 't', 'message', 'B', null, new Date().toISOString());
    expect(countPendingMessages()).toBe(2);
  });

  it('only returns messages for the target peer', () => {
    insertMessage('proj', 'f', 'to1', 'message', 'For to1', null, new Date().toISOString());
    insertMessage('proj', 'f', 'to2', 'message', 'For to2', null, new Date().toISOString());

    expect(selectUndelivered('to1')).toHaveLength(1);
    expect(selectUndelivered('to2')).toHaveLength(1);
  });
});

// ── Message log ────────────────────────────────────────────────

describe('message log', () => {
  it('inserts and retrieves log entries', () => {
    insertLogEntry('proj', 'f1', 'backend', 't1', 'frontend', 'message', 'Hi', null, new Date().toISOString(), 'sess1');

    const entries = selectHistory('proj');
    expect(entries).toHaveLength(1);
    expect(entries[0].from_role).toBe('backend');
    expect(entries[0].to_role).toBe('frontend');
  });

  it('filters by role', () => {
    insertLogEntry('proj', 'f1', 'backend', 't1', 'frontend', 'message', 'A', null, new Date().toISOString(), 's');
    insertLogEntry('proj', 'f2', 'devops', 't2', 'backend', 'message', 'B', null, new Date().toISOString(), 's');

    const backendEntries = selectHistory('proj', { role: 'backend' });
    expect(backendEntries).toHaveLength(2); // backend is from_role in A, to_role in B

    const devopsEntries = selectHistory('proj', { role: 'devops' });
    expect(devopsEntries).toHaveLength(1);
  });

  it('filters by type', () => {
    insertLogEntry('proj', 'f', 't', 'br', 'fr', 'message', 'A', null, new Date().toISOString(), 's');
    insertLogEntry('proj', 'f', 't', 'br', 'fr', 'question', 'B', null, new Date().toISOString(), 's');

    expect(selectHistory('proj', { type: 'question' })).toHaveLength(1);
  });

  it('filters by session_id', () => {
    insertLogEntry('proj', 'f', 't', 'br', 'fr', 'message', 'A', null, new Date().toISOString(), 'sess1');
    insertLogEntry('proj', 'f', 't', 'br', 'fr', 'message', 'B', null, new Date().toISOString(), 'sess2');

    expect(selectHistory('proj', { session_id: 'sess1' })).toHaveLength(1);
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      insertLogEntry('proj', 'f', 't', 'br', 'fr', 'message', `Msg ${i}`, null, new Date().toISOString(), 's');
    }
    expect(selectHistory('proj', { limit: 3 })).toHaveLength(3);
  });
});

// ── Shared state ───────────────────────────────────────────────

describe('shared state CRUD', () => {
  it('sets and gets a value', () => {
    setSharedState('proj', 'config', 'port', '8080', 'peer1', new Date().toISOString());

    const entry = getSharedState('proj', 'config', 'port');
    expect(entry).toBeDefined();
    expect(entry!.value).toBe('8080');
    expect(entry!.updated_by).toBe('peer1');
  });

  it('returns undefined for missing key', () => {
    expect(getSharedState('proj', 'config', 'nope')).toBeUndefined();
  });

  it('upserts on conflict', () => {
    setSharedState('proj', 'ns', 'key', 'v1', 'p1', '2025-01-01T00:00:00Z');
    setSharedState('proj', 'ns', 'key', 'v2', 'p2', '2025-06-01T00:00:00Z');

    const entry = getSharedState('proj', 'ns', 'key');
    expect(entry!.value).toBe('v2');
    expect(entry!.updated_by).toBe('p2');
  });

  it('lists keys in a namespace', () => {
    setSharedState('proj', 'contracts', 'api', 'v1', 'p1', new Date().toISOString());
    setSharedState('proj', 'contracts', 'db', 'v2', 'p1', new Date().toISOString());
    setSharedState('proj', 'other', 'x', 'y', 'p1', new Date().toISOString());

    const keys = listSharedKeys('proj', 'contracts');
    expect(keys).toHaveLength(2);
    expect(keys).toContain('api');
    expect(keys).toContain('db');
  });

  it('deletes a key', () => {
    setSharedState('proj', 'ns', 'key', 'val', 'p1', new Date().toISOString());
    deleteSharedState('proj', 'ns', 'key');
    expect(getSharedState('proj', 'ns', 'key')).toBeUndefined();
  });

  it('returns empty list for missing namespace', () => {
    expect(listSharedKeys('proj', 'nonexistent')).toHaveLength(0);
  });
});
