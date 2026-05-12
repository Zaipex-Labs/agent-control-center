// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase, insertPeer } from '../../src/broker/database.js';
import { handleCsrfIssue } from '../../src/broker/handlers.js';
import {
  issueToken,
  consumeToken,
  purgeExpired,
  _resetTokensForTests,
  _peekTokenForTests,
  _tokenCountForTests,
} from '../../src/broker/csrf-tokens.js';
import type { Peer } from '../../src/shared/types.js';

// [F-3-A] — POST /api/csrf/issue must:
//   - require a registered peer_id whose project matches body.project_id
//     (membership check: closes the cross-port hijack — a malicious dev
//     server on http://127.0.0.1:8080 has no peer_id because the
//     dashboard's localStorage lives in a different origin's storage)
//   - require an existing non-dashboard agent for the requested role
//   - return a one-shot 32-byte hex token bound to (project_id, role)
//
// The token store itself is tested directly: TTL, one-shot consumption,
// purgeExpired correctness.

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'acc-test-csrf-'));
  process.env['ACC_HOME'] = home;
  initDatabase(':memory:');
  _resetTokensForTests();
});

afterEach(() => {
  _resetTokensForTests();
  if (home) {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

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

function seedDashboardAndAgent(projectId: string, agentRole: string): { dashId: string; agentId: string } {
  const now = new Date().toISOString();
  const dashId = 'dash-1';
  const agentId = 'agent-1';
  const dashPeer: Peer = {
    id: dashId, project_id: projectId, pid: process.pid,
    name: 'Dashboard', role: 'user', agent_type: 'dashboard',
    cwd: '/', git_root: null, git_branch: null, tty: null,
    summary: '', registered_at: now, last_seen: now,
  };
  const agentPeer: Peer = {
    id: agentId, project_id: projectId, pid: process.pid,
    name: 'Turing', role: agentRole, agent_type: 'claude-code',
    cwd: '/tmp', git_root: null, git_branch: null, tty: null,
    summary: '', registered_at: now, last_seen: now,
  };
  insertPeer(dashPeer);
  insertPeer(agentPeer);
  return { dashId, agentId };
}

describe('csrf-tokens (unit)', () => {
  it('issues a 64-hex token (256 bits)', () => {
    const tok = issueToken('proj', 'backend');
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
  });

  it('consumeToken returns the binding once and then misses', () => {
    const tok = issueToken('proj-a', 'backend');
    const first = consumeToken(tok);
    expect(first).toEqual({ project_id: 'proj-a', role: 'backend', expires_at: expect.any(Number) });
    const second = consumeToken(tok);
    expect(second).toBeNull();
  });

  it('expired tokens cannot be consumed', () => {
    const tok = issueToken('p', 'r');
    // Force-expire by mutating the entry directly
    const entry = _peekTokenForTests(tok)!;
    entry.expires_at = Date.now() - 1;
    expect(consumeToken(tok)).toBeNull();
  });

  it('purgeExpired drops only the stale entries', () => {
    const tFresh = issueToken('p', 'r1');
    const tStale = issueToken('p', 'r2');
    _peekTokenForTests(tStale)!.expires_at = Date.now() - 1;
    expect(_tokenCountForTests()).toBe(2);
    expect(purgeExpired()).toBe(1);
    expect(_tokenCountForTests()).toBe(1);
    expect(_peekTokenForTests(tFresh)).toBeDefined();
  });
});

describe('handleCsrfIssue', () => {
  it('400 on missing fields', () => {
    const cases: unknown[] = [
      {},
      { peer_id: 'x' },
      { project_id: 'p', role: 'r' },
      { peer_id: 'x', project_id: 'p' },
    ];
    for (const body of cases) {
      const { res, result } = createMockRes();
      handleCsrfIssue(body, res);
      expect(result.statusCode).toBe(400);
    }
  });

  it('400 on unsafe role (path traversal / shell metachars)', () => {
    const { res, result } = createMockRes();
    handleCsrfIssue({ peer_id: 'a', project_id: 'p', role: '../etc' }, res);
    expect(result.statusCode).toBe(400);
  });

  it('403 when peer_id not registered', () => {
    const { res, result } = createMockRes();
    handleCsrfIssue({ peer_id: 'ghost', project_id: 'p', role: 'backend' }, res);
    expect(result.statusCode).toBe(403);
  });

  it('403 when peer registered in different project (cross-project)', () => {
    seedDashboardAndAgent('proj-a', 'backend');
    const { res, result } = createMockRes();
    handleCsrfIssue({ peer_id: 'dash-1', project_id: 'proj-b', role: 'backend' }, res);
    expect(result.statusCode).toBe(403);
  });

  it('404 when role has no live non-dashboard agent', () => {
    seedDashboardAndAgent('proj-a', 'backend');
    const { res, result } = createMockRes();
    handleCsrfIssue({ peer_id: 'dash-1', project_id: 'proj-a', role: 'frontend' }, res);
    expect(result.statusCode).toBe(404);
  });

  it('200 with one-shot token bound to (project, role) on success', () => {
    seedDashboardAndAgent('proj-a', 'backend');
    const { res, result } = createMockRes();
    handleCsrfIssue({ peer_id: 'dash-1', project_id: 'proj-a', role: 'backend' }, res);
    expect(result.statusCode).toBe(200);
    const body = result.body as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    // Token can be consumed exactly once and matches the requested binding
    const entry = consumeToken(body.token);
    expect(entry).toEqual({ project_id: 'proj-a', role: 'backend', expires_at: expect.any(Number) });
    expect(consumeToken(body.token)).toBeNull();
  });

  it('rejects when caller is the dashboard peer of a different project', () => {
    // proj-a has its own dashboard; proj-b has its own. A peer_id that
    // belongs to proj-b cannot trade for a token bound to proj-a.
    seedDashboardAndAgent('proj-a', 'backend');
    const now = new Date().toISOString();
    insertPeer({
      id: 'dash-b', project_id: 'proj-b', pid: process.pid,
      name: 'Dash', role: 'user', agent_type: 'dashboard',
      cwd: '/', git_root: null, git_branch: null, tty: null,
      summary: '', registered_at: now, last_seen: now,
    });
    const { res, result } = createMockRes();
    handleCsrfIssue({ peer_id: 'dash-b', project_id: 'proj-a', role: 'backend' }, res);
    expect(result.statusCode).toBe(403);
  });
});
