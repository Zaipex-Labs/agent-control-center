// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, insertPeer, selectPeerById, selectAllPeers } from '../../src/broker/database.js';
import { cleanStalePeers } from '../../src/broker/cleanup.js';
import type { Peer } from '../../src/shared/types.js';

function makePeer(overrides: Partial<Peer> = {}): Peer {
  const now = new Date().toISOString();
  return {
    id: `peer-${Math.random().toString(36).slice(2, 6)}`,
    project_id: 'test-project',
    pid: process.pid, // Use current PID so it's "alive"
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

describe('cleanStalePeers', () => {
  it('removes peers whose PID is not alive', () => {
    // PID 999999 is almost certainly not running
    insertPeer(makePeer({ id: 'dead', pid: 999999 }));
    insertPeer(makePeer({ id: 'alive', pid: process.pid }));

    const removed = cleanStalePeers();
    expect(removed).toBe(1);
    expect(selectPeerById('dead')).toBeUndefined();
    expect(selectPeerById('alive')).toBeDefined();
  });

  it('returns 0 when all peers are alive', () => {
    insertPeer(makePeer({ id: 'a', pid: process.pid }));
    insertPeer(makePeer({ id: 'b', pid: process.pid }));

    expect(cleanStalePeers()).toBe(0);
    expect(selectAllPeers()).toHaveLength(2);
  });

  it('returns 0 when no peers exist', () => {
    expect(cleanStalePeers()).toBe(0);
  });

  it('removes multiple dead peers', () => {
    insertPeer(makePeer({ id: 'dead1', pid: 999998 }));
    insertPeer(makePeer({ id: 'dead2', pid: 999997 }));
    insertPeer(makePeer({ id: 'alive', pid: process.pid }));

    const removed = cleanStalePeers();
    expect(removed).toBe(2);
    expect(selectAllPeers()).toHaveLength(1);
  });
});
