// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// v0.4.x audit Wave 1 add — feature 5 (persistence) gap.
//
// Before this test, the suite verified every individual CRUD primitive
// against an in-memory SQLite but never exercised the seam that matters
// most to users: "I shut down the broker, started it again, and my work
// is still there." This pins that boot-2 reads back exactly what boot-1
// wrote: peers, messages, shared_state and threads. The test uses a
// real file-backed DB on disk so the SQLite WAL recovery path runs.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  initDatabase,
  closeDatabase,
  insertPeer,
  selectPeersByProject,
  insertMessage,
  selectUndelivered,
  setSharedState,
  getSharedState,
  insertThread,
  selectThreadsByProject,
  deleteStalePeers,
} from '../../src/broker/database.js';
import type { Peer } from '../../src/shared/types.js';

let tmpHome: string;
let dbPath: string;

function tmpHomeWithDb() {
  tmpHome = mkdtempSync(join(tmpdir(), 'acc-restart-'));
  dbPath = join(tmpHome, 'acc.db');
}

function makePeer(overrides: Partial<Peer> = {}): Peer {
  const now = new Date().toISOString();
  return {
    id: `peer-${Math.random().toString(36).slice(2, 6)}`,
    project_id: 'restart-proj',
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

afterEach(() => {
  try { closeDatabase(); } catch { /* already closed */ }
  if (tmpHome && existsSync(tmpHome)) {
    rmSync(tmpHome, { recursive: true, force: true });
  }
});

describe('broker survives a clean shutdown + restart on the same DB path', () => {
  it('preserves messages, shared_state, threads, and peers across reboot', () => {
    tmpHomeWithDb();

    // ── Boot 1: write state ──────────────────────────────────────
    initDatabase(dbPath);
    const alivePeer = makePeer({ id: 'alive-p1', role: 'backend', pid: process.pid });
    const deadPeer = makePeer({ id: 'dead-p1', role: 'frontend', pid: 999_999_999 });
    insertPeer(alivePeer);
    insertPeer(deadPeer);

    const now = new Date().toISOString();
    insertMessage(
      'restart-proj', 'alive-p1', 'dead-p1',
      'message', 'pre-restart hello', null, now,
    );
    setSharedState('restart-proj', 'config', 'auth-method', 'jwt', 'alive-p1', now);
    insertThread({
      id: 'thr-1', project_id: 'restart-proj',
      name: 'Pre-restart thread', status: 'active', summary: '',
      created_by: 'alive-p1', created_at: now, updated_at: now,
    });

    closeDatabase();

    // ── Boot 2: same DB path, fresh connection ───────────────────
    initDatabase(dbPath);

    // Peers survive the row write. The actual stale-PID eviction
    // path runs on heartbeat ticks and is tested in
    // tests/broker/cleanup.test.ts — here the persistence-only pin
    // is just that the row IS still readable after the
    // closeDatabase()/initDatabase() cycle.
    expect(selectPeersByProject('restart-proj')).toHaveLength(2);
    // deleteStalePeers with a cutoff in the future evicts both;
    // verify the eviction primitive operates correctly against the
    // restored DB (not that any specific eviction is wired).
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(deleteStalePeers(future)).toBe(2);

    // Undelivered messages survive the restart.
    const undelivered = selectUndelivered('dead-p1');
    expect(undelivered.map(m => m.text)).toContain('pre-restart hello');

    // shared_state survives.
    const shared = getSharedState('restart-proj', 'config', 'auth-method');
    expect(shared?.value).toBe('jwt');

    // Threads survive.
    const threads = selectThreadsByProject('restart-proj');
    expect(threads.map(t => t.name)).toContain('Pre-restart thread');

    closeDatabase();
  });

  it('survives an unclean shutdown (no closeDatabase) thanks to SQLite WAL', () => {
    tmpHomeWithDb();

    // Boot 1: write but skip closeDatabase to simulate a crash.
    initDatabase(dbPath);
    const peer = makePeer({ id: 'crash-p1', project_id: 'crash-proj', pid: process.pid });
    insertPeer(peer);
    const now = new Date().toISOString();
    setSharedState('crash-proj', 'ns', 'key', 'value', 'crash-p1', now);
    // No closeDatabase() — drop the singleton ref and re-init below.
    // SQLite WAL pages should still recover on reopen.

    // Boot 2: re-open without explicit close.
    initDatabase(dbPath);
    expect(selectPeersByProject('crash-proj')).toHaveLength(1);
    expect(getSharedState('crash-proj', 'ns', 'key')?.value).toBe('value');

    closeDatabase();
  });
});
