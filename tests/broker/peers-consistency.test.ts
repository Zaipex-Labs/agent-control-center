// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// v0.3.3 PRE-3 — regression pin for the "MED-7c" red-herring from the
// v0.3.2.1 hotfix audit.
//
// During v0.3.2.1 verify, the QA script reported a divergence between
// `GET /api/peers` (returned 0) and `GET /api/projects[].peers`
// (returned 2 live peers). MED-7c was opened as a `MED` followup, but
// PRE-1 of v0.3.3 traced it back to a QA script artifact: `/api/peers`
// is not a route — the real endpoint is `POST /api/list-peers`. The
// router responded `404 Not Found` and the Python parser silently
// defaulted to `[]`.
//
// By inspection, the two handlers share the same logic:
//   - selectPeersByProject(projectId) → the single source for the row set
//   - filter(p => p.agent_type !== 'dashboard') → exclude dashboards
//   - filter(p => { try { process.kill(p.pid, 0); return true } catch { false }})
//     → exclude peers whose OS process is gone
//
// This test PINS that invariant by:
//   (a) inserting a mixed peer set (alive agent, alive dashboard, dead-pid),
//   (b) calling handleListPeers via a mock ServerResponse,
//   (c) replicating handleListProjects' filter inline against the same DB,
//   (d) asserting both produce the same id set.
//
// If either handler's filter changes in the future, this test will
// catch the divergence — provided the OTHER handler's filter (replicated
// below) is updated in lockstep. The replication block carries a
// pointer to the source-of-truth path so the next maintainer knows
// where to look.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { initDatabase, insertPeer, selectPeersByProject } from '../../src/broker/database.js';
import { handleListPeers } from '../../src/broker/handlers.js';
import type { Peer } from '../../src/shared/types.js';

interface MockRes {
  statusCode: number;
  body: unknown;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((status: number) => { result.statusCode = status; return res; }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => { if (data) result.body = JSON.parse(data); return res; }) as ServerResponse['end'];
  return { res, result };
}

function makePeer(overrides: Partial<Peer> = {}): Peer {
  const now = new Date().toISOString();
  return {
    id: `peer-${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'proj-test',
    pid: process.pid, // own process — always alive
    name: 'Anon',
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

// Mirror of handleListProjects' per-project filter at
// src/broker/handlers/projects.ts:182-185. Kept here as a TEST
// REPLICATION so an accidental change to either handler's filter
// gets caught by this test failing. When you update one handler's
// filter, also update this mirror (or this test will mask the
// divergence).
function projectsHandlerFilter(projectId: string): Peer[] {
  const all = selectPeersByProject(projectId);
  return all.filter(p => {
    if (p.agent_type === 'dashboard') return false;
    try { process.kill(p.pid, 0); return true; } catch { return false; }
  });
}

beforeEach(() => {
  initDatabase(':memory:');
});

describe('peers consistency: /api/list-peers vs /api/projects[].peers', () => {
  it('both return the same peers when there are 2 alive agents in the same project', () => {
    insertPeer(makePeer({ id: 'p-a', role: 'backend', project_id: 'p' }));
    insertPeer(makePeer({ id: 'p-b', role: 'frontend', project_id: 'p' }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'p' }, res);

    const fromListPeers = (result.body as Peer[]).map(p => p.id).sort();
    const fromProjects = projectsHandlerFilter('p').map(p => p.id).sort();

    expect(fromListPeers).toEqual(fromProjects);
    expect(fromListPeers).toEqual(['p-a', 'p-b']);
  });

  it('both exclude dashboard-type peers from the agent list', () => {
    insertPeer(makePeer({ id: 'agent-1', role: 'backend', project_id: 'p' }));
    insertPeer(makePeer({ id: 'dash-1', role: '', agent_type: 'dashboard', project_id: 'p' }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'p' }, res);

    const fromListPeers = (result.body as Peer[]).map(p => p.id).sort();
    const fromProjects = projectsHandlerFilter('p').map(p => p.id).sort();

    expect(fromListPeers).toEqual(fromProjects);
    expect(fromListPeers).toEqual(['agent-1']);
    expect(fromListPeers).not.toContain('dash-1');
  });

  it('both exclude peers whose OS process is gone', () => {
    // process.pid is always alive (it's the test runner itself).
    insertPeer(makePeer({ id: 'alive', pid: process.pid, project_id: 'p' }));
    // PID 0x7FFFFFFE is well outside any realistic running pid range on
    // any OS we target. `process.kill(badPid, 0)` will throw ESRCH.
    insertPeer(makePeer({ id: 'dead', pid: 0x7FFFFFFE, project_id: 'p' }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'p' }, res);

    const fromListPeers = (result.body as Peer[]).map(p => p.id).sort();
    const fromProjects = projectsHandlerFilter('p').map(p => p.id).sort();

    expect(fromListPeers).toEqual(fromProjects);
    expect(fromListPeers).toEqual(['alive']);
  });

  it('handleListPeers evicts dead peers from the DB; projectsHandlerFilter is read-only — but BOTH agree on what is live', () => {
    // Subtle divergence preserved by intent: handleListPeers fires
    // deletePeer(id) for the dead rows, projectsHandlerFilter does NOT.
    // After /api/list-peers runs once, the dead peer is gone from the
    // DB entirely, so subsequent /api/projects calls also stop seeing
    // it. The eviction is a one-way alignment, not a divergence — they
    // converge after the first list-peers call.
    insertPeer(makePeer({ id: 'alive', pid: process.pid, project_id: 'p' }));
    insertPeer(makePeer({ id: 'dead', pid: 0x7FFFFFFE, project_id: 'p' }));

    // Call list-peers first — should evict 'dead'.
    const first = createMockRes();
    handleListPeers({ project_id: 'p' }, first.res);

    // Now projectsHandlerFilter runs on the cleaned DB.
    const fromProjectsAfter = projectsHandlerFilter('p').map(p => p.id).sort();
    expect(fromProjectsAfter).toEqual(['alive']);

    // And selectPeersByProject (raw read) only sees the alive one too,
    // because handleListPeers evicted.
    expect(selectPeersByProject('p').map(p => p.id).sort()).toEqual(['alive']);
  });

  it('mixed set: dashboard + agents + dead — both return only the live, non-dashboard agents', () => {
    insertPeer(makePeer({ id: 'agent-a', role: 'backend', project_id: 'p', pid: process.pid }));
    insertPeer(makePeer({ id: 'agent-b', role: 'frontend', project_id: 'p', pid: process.pid }));
    insertPeer(makePeer({ id: 'dash', role: '', agent_type: 'dashboard', project_id: 'p', pid: process.pid }));
    insertPeer(makePeer({ id: 'dead-c', role: 'qa', project_id: 'p', pid: 0x7FFFFFFE }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'p' }, res);

    const fromListPeers = (result.body as Peer[]).map(p => p.id).sort();
    const fromProjects = projectsHandlerFilter('p').map(p => p.id).sort();

    expect(fromListPeers).toEqual(fromProjects);
    expect(fromListPeers).toEqual(['agent-a', 'agent-b']);
  });

  it('regression — the original "MED-7c" claim of divergence is unreproducible: matching DB state, matching output', () => {
    // Mirror of what was running on the broker the moment the v0.3.2.1
    // QA reported "0 peers in /api/peers vs 2 in /api/projects":
    // two alive agents (one tech lead, one backend), no dashboard, no
    // dead pids. The QA script hit `GET /api/peers` (a non-existent
    // route → 404). The python parser swallowed the 404 body as `[]`
    // and reported "0 peers" — false alarm.
    insertPeer(makePeer({
      id: 'tech-lead', role: 'arquitectura', name: 'Da Vinci',
      project_id: 'deep', pid: process.pid,
    }));
    insertPeer(makePeer({
      id: 'backend', role: 'backend', name: 'Turing',
      project_id: 'deep', pid: process.pid,
    }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'deep' }, res);

    const fromListPeers = (result.body as Peer[]).map(p => p.id).sort();
    const fromProjects = projectsHandlerFilter('deep').map(p => p.id).sort();

    expect(fromListPeers).toEqual(fromProjects);
    expect(fromListPeers).toEqual(['backend', 'tech-lead']);
  });
});
