// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE E-1 / Q-5 (v0.3.0): zod-backed input validation on the hot
// HTTP handlers. After the v0.4.x audit, this file retains only the
// assertions that pin observable behavior (envelope shape, enum
// constraints, sub-schemas) and the canonical project_id contract
// pins for the project/* surface. Per-field "missing required"
// permutations were dropped because zod schemas are the source of
// truth — they were tautological re-assertions of the schemas
// already enforced at runtime.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { initDatabase, insertPeer } from '../../src/broker/database.js';
import {
  handleSendMessage,
  handlePollMessages,
  handleDecisionsRecall,
  handleListPeers,
  handleListThreads,
  handleProjectUp,
  handleProjectDown,
  handleSaveResume,
  handleListModifiedFiles,
  handleDeleteProject,
} from '../../src/broker/handlers.js';
import type { Peer } from '../../src/shared/types.js';

interface MockRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null, headers: {} };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((status: number, headers?: Record<string, string>) => {
    result.statusCode = status;
    if (headers) result.headers = headers;
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

beforeEach(() => {
  initDatabase(':memory:');
  insertPeer(makePeer({ id: 'p1', project_id: 'proj' }));
});

// Common assertion shape: 400 + INVALID_BODY + at least one issue
// with the expected path.
function expectInvalidBody(
  result: MockRes,
  expectedPath: string,
): void {
  expect(result.statusCode).toBe(400);
  const body = result.body as { ok: boolean; error: string; code: string; issues: Array<{ path: string }> };
  expect(body.ok).toBe(false);
  expect(body.code).toBe('INVALID_BODY');
  expect(body.error).toBeTruthy();
  expect(body.issues.some(i => i.path === expectedPath)).toBe(true);
}

describe('zod validation · send-message sub-schemas', () => {
  it('attachments must be an array of {hash, mime, name, size}', async () => {
    const { res, result } = createMockRes();
    await handleSendMessage({
      project_id: 'proj', from_id: 'p1', to_id: 'p1', text: 'hi',
      attachments: [{ hash: 'a', mime: 'b' }],  // missing name + size
    }, res);
    expect(result.statusCode).toBe(400);
    expect((result.body as { code: string }).code).toBe('INVALID_BODY');
  });
});

describe('zod validation · decisions/recall limit semantics', () => {
  it('limit accepts large numbers (handler clamps to RECALL_MAX_LIMIT)', () => {
    // limit: 999 must NOT fail validation — the handler clamps at 20.
    const { res, result } = createMockRes();
    handleDecisionsRecall({
      project_id: 'proj', peer_id: 'p1', query: 'esm', limit: 999,
    }, res);
    expect(result.statusCode).toBe(200);
  });
});

describe('zod validation · peers handlers — enum + scope behavior', () => {
  it('list-peers: scope=machine works without project_id (200 path)', () => {
    const { res, result } = createMockRes();
    handleListPeers({ scope: 'machine' }, res);
    // Should NOT return INVALID_BODY — list-peers allows omitting
    // project_id when scope is 'machine'.
    expect(result.statusCode).not.toBe(400);
  });

  it('list-peers: invalid scope value rejected', () => {
    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'proj', scope: 'nope' }, res);
    expectInvalidBody(result, 'scope');
  });
});

describe('zod validation · threads handlers — enum constraint', () => {
  it('threads/list: invalid status value rejected', () => {
    const { res, result } = createMockRes();
    handleListThreads({ project_id: 'proj', status: 'frozen' }, res);
    expectInvalidBody(result, 'status');
  });
});

// ── FU-AI canonical project_id contract pins ──
//
// These tests are NOT redundant with the zod schema: they pin that
// every /api/project/* surface uses `project_id` (not the legacy
// `name` alias, which v0.4.0 removed). If a future refactor reverts
// to accepting `name`, these tests catch it.
describe('zod validation · projects handlers — FU-AI canonical project_id', () => {
  it('project/up: missing project_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleProjectUp({}, res);
    expectInvalidBody(result, 'project_id');
  });

  it('project/down: missing project_id → INVALID_BODY', async () => {
    const { res, result } = createMockRes();
    await handleProjectDown({}, res);
    expectInvalidBody(result, 'project_id');
  });

  it('project/save-resume: missing project_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleSaveResume({}, res);
    expectInvalidBody(result, 'project_id');
  });

  it('project/modified-files: missing project_id → INVALID_BODY', async () => {
    const { res, result } = createMockRes();
    await handleListModifiedFiles({}, res);
    expectInvalidBody(result, 'project_id');
  });

  it('project/delete: missing project_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleDeleteProject({}, res);
    expectInvalidBody(result, 'project_id');
  });
});

describe('zod validation · response shape stability', () => {
  it('every INVALID_BODY response has { ok:false, error, code, issues }', () => {
    const { res, result } = createMockRes();
    handlePollMessages({}, res);
    const body = result.body as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
    expect(body.code).toBe('INVALID_BODY');
    expect(Array.isArray(body.issues)).toBe(true);
    const issues = body.issues as Array<Record<string, unknown>>;
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) {
      expect(typeof i.path).toBe('string');
      expect(typeof i.message).toBe('string');
      expect(typeof i.code).toBe('string');
    }
  });
});
