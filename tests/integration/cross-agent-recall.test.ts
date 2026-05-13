// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// v0.4.x audit Wave 1 add — feature 2 (team memory) gap. The DB-level
// tests in tests/broker/database.test.ts pin that setSharedStateWithMeta
// preserves author_role/author_peer_id on upsert and that searchDecisions
// is project-scoped. The MCP-level tests pin the result shape. What no
// existing test pins is the seam users care about: one agent calls
// `remember`, a different agent calls `recall`, and the second agent
// sees the first agent's row.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { initDatabase, insertPeer } from '../../src/broker/database.js';
import {
  handleSharedSet,
  handleDecisionsRecall,
} from '../../src/broker/handlers.js';
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
    project_id: 'mem-proj',
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

beforeEach(() => {
  initDatabase(':memory:');
});

describe('team memory — cross-agent recall happy path', () => {
  it('agent B recalls a decision saved by agent A with the original author metadata', () => {
    // Both agents live in the same project. Agent A is the backend
    // specialist, agent B is the frontend specialist.
    insertPeer(makePeer({ id: 'agent-a', role: 'backend', project_id: 'mem-proj' }));
    insertPeer(makePeer({ id: 'agent-b', role: 'frontend', project_id: 'mem-proj' }));

    // ── Agent A remembers a decision ─────────────────────────────
    const writeRes = createMockRes();
    handleSharedSet({
      project_id: 'mem-proj',
      peer_id: 'agent-a',
      namespace: 'decisions',
      key: 'auth-strategy',
      value: 'use esm modules with jwt rotation every 7 days',
    }, writeRes.res);
    expect(writeRes.result.statusCode).toBe(200);

    // ── Agent B recalls and finds A's row ────────────────────────
    const readRes = createMockRes();
    handleDecisionsRecall({
      project_id: 'mem-proj',
      peer_id: 'agent-b',
      query: 'esm',
      limit: 5,
    }, readRes.res);

    expect(readRes.result.statusCode).toBe(200);
    const body = readRes.result.body as {
      matches: Array<{ key: string; value: string; author_role: string; author_peer_id: string }>;
    };
    expect(body.matches.length).toBeGreaterThanOrEqual(1);
    const match = body.matches.find(m => m.key === 'auth-strategy');
    expect(match).toBeDefined();
    expect(match!.value).toContain('esm');
    // The author metadata is what makes "team memory" a team feature:
    // recall surfaces who wrote the decision, not just the content.
    expect(match!.author_role).toBe('backend');
    expect(match!.author_peer_id).toBe('agent-a');
  });

  it('a peer from a different project cannot recall the decision', () => {
    insertPeer(makePeer({ id: 'agent-a', role: 'backend', project_id: 'mem-proj' }));
    insertPeer(makePeer({ id: 'agent-c', role: 'qa', project_id: 'other-proj' }));

    const writeRes = createMockRes();
    handleSharedSet({
      project_id: 'mem-proj',
      peer_id: 'agent-a',
      namespace: 'decisions',
      key: 'k', value: 'esm + jwt',
    }, writeRes.res);
    expect(writeRes.result.statusCode).toBe(200);

    // Agent-c is a member of other-proj — assertProjectMembership
    // returns 403 when peer_id is not a member of project_id.
    const xRes = createMockRes();
    handleDecisionsRecall({
      project_id: 'mem-proj',
      peer_id: 'agent-c',
      query: 'esm',
      limit: 5,
    }, xRes.res);
    expect(xRes.result.statusCode).toBe(403);
  });
});
