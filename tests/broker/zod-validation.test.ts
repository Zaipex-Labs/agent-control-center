// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE E-1 / Q-5 (v0.3.0): zod-backed input validation on the hot
// HTTP handlers. Asserts:
//   - Malformed bodies → 400 with code: INVALID_BODY + non-empty
//     issues array.
//   - Wrong-typed values (string where number expected, etc.) are
//     caught.
//   - Issues carry per-field detail (path + message).
// The structural shape of the rejection is what callers (dashboard +
// REST consumers) rely on to surface useful error UX.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { initDatabase, insertPeer } from '../../src/broker/database.js';
import {
  handleSendMessage,
  handleSendToRole,
  handlePollMessages,
  handleGetHistory,
  handleSharedSet,
  handleSharedGet,
  handleSharedList,
  handleSharedDelete,
  handleDecisionsRecall,
  // FU-D (v0.3.1) extended coverage:
  handleRegister,
  handleHeartbeat,
  handleUnregister,
  handleSetSummary,
  handleSetRole,
  handleCsrfIssue,
  handleListPeers,
  handleCreateThread,
  handleListThreads,
  handleGetThread,
  handleUpdateThread,
  handleDeleteThread,
  handleSearchThreads,
  handleThreadSummary,
  handleCreateProject,
  handleAddAgent,
  handleUpdateProject,
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

describe('zod validation · send-message', () => {
  it('missing project_id returns INVALID_BODY with project_id issue', async () => {
    const { res, result } = createMockRes();
    await handleSendMessage({ from_id: 'p1', to_id: 'p1', text: 'hi' }, res);
    expectInvalidBody(result, 'project_id');
  });

  it('wrong type on text (number, not string) is caught', async () => {
    const { res, result } = createMockRes();
    await handleSendMessage({
      project_id: 'proj', from_id: 'p1', to_id: 'p1', text: 42,
    }, res);
    expectInvalidBody(result, 'text');
  });

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

describe('zod validation · send-to-role', () => {
  it('missing role returns INVALID_BODY', async () => {
    const { res, result } = createMockRes();
    await handleSendToRole({
      project_id: 'proj', from_id: 'p1', text: 'hi',
    }, res);
    expectInvalidBody(result, 'role');
  });
});

describe('zod validation · poll-messages', () => {
  it('missing id returns INVALID_BODY with id issue', () => {
    const { res, result } = createMockRes();
    handlePollMessages({}, res);
    expectInvalidBody(result, 'id');
  });

  it('id must be non-empty string', () => {
    const { res, result } = createMockRes();
    handlePollMessages({ id: '' }, res);
    expectInvalidBody(result, 'id');
  });
});

describe('zod validation · get-history', () => {
  it('missing project_id returns INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleGetHistory({}, res);
    expectInvalidBody(result, 'project_id');
  });

  it('limit must be a number, not a string', () => {
    const { res, result } = createMockRes();
    handleGetHistory({ project_id: 'proj', peer_id: 'p1', limit: '20' }, res);
    expectInvalidBody(result, 'limit');
  });
});

describe('zod validation · shared/*', () => {
  it('shared/set rejects missing fields with INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleSharedSet({ project_id: 'proj' }, res);
    expect(result.statusCode).toBe(400);
    expect((result.body as { code: string }).code).toBe('INVALID_BODY');
    const issues = (result.body as { issues: Array<{ path: string }> }).issues;
    // namespace, key, value, peer_id are all required
    const paths = issues.map(i => i.path);
    expect(paths).toEqual(expect.arrayContaining(['namespace', 'key', 'value', 'peer_id']));
  });

  it('shared/get rejects missing namespace', () => {
    const { res, result } = createMockRes();
    handleSharedGet({ project_id: 'proj', key: 'k', peer_id: 'p1' }, res);
    expectInvalidBody(result, 'namespace');
  });

  it('shared/list rejects missing namespace', () => {
    const { res, result } = createMockRes();
    handleSharedList({ project_id: 'proj', peer_id: 'p1' }, res);
    expectInvalidBody(result, 'namespace');
  });

  it('shared/delete rejects missing peer_id with INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleSharedDelete({ project_id: 'proj', namespace: 'ns', key: 'k' }, res);
    expectInvalidBody(result, 'peer_id');
  });
});

describe('zod validation · decisions/recall', () => {
  it('missing query returns INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleDecisionsRecall({ project_id: 'proj', peer_id: 'p1' }, res);
    expectInvalidBody(result, 'query');
  });

  it('limit accepts large numbers (handler clamps to RECALL_MAX_LIMIT)', () => {
    // limit: 999 must NOT fail validation — the handler clamps at 20.
    const { res, result } = createMockRes();
    handleDecisionsRecall({
      project_id: 'proj', peer_id: 'p1', query: 'esm', limit: 999,
    }, res);
    expect(result.statusCode).toBe(200);
  });

  it('limit must be a number, not a string', () => {
    const { res, result } = createMockRes();
    handleDecisionsRecall({
      project_id: 'proj', peer_id: 'p1', query: 'esm', limit: 'foo',
    }, res);
    expectInvalidBody(result, 'limit');
  });
});

// ── FU-D (v0.3.1): extended zod coverage on peers/threads/projects ──
//
// One test per migrated handler — exercise the "missing required" path
// and pin the INVALID_BODY shape. The handlers' deeper behavior
// (membership gating, identifier safety, etc.) is covered by the
// existing handler / integration suites.

describe('zod validation · peers handlers [FU-D]', () => {
  it('register: missing project_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleRegister({ pid: 1, cwd: '/tmp', role: 'backend' }, res);
    expectInvalidBody(result, 'project_id');
  });

  it('register: pid as string is rejected', () => {
    const { res, result } = createMockRes();
    handleRegister({ pid: '42', cwd: '/tmp', role: 'backend', project_id: 'proj' }, res);
    expectInvalidBody(result, 'pid');
  });

  it('heartbeat: missing id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleHeartbeat({}, res);
    expectInvalidBody(result, 'id');
  });

  it('unregister: missing id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleUnregister({}, res);
    expectInvalidBody(result, 'id');
  });

  it('set-summary: missing summary → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleSetSummary({ id: 'p1' }, res);
    expectInvalidBody(result, 'summary');
  });

  it('set-role: missing role → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleSetRole({ id: 'p1' }, res);
    expectInvalidBody(result, 'role');
  });

  it('csrf/issue: missing peer_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleCsrfIssue({ project_id: 'proj', role: 'backend' }, res);
    expectInvalidBody(result, 'peer_id');
  });

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

describe('zod validation · threads handlers [FU-D]', () => {
  it('threads/create: missing created_by → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleCreateThread({ project_id: 'proj' }, res);
    expectInvalidBody(result, 'created_by');
  });

  it('threads/list: missing project_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleListThreads({}, res);
    expectInvalidBody(result, 'project_id');
  });

  it('threads/list: invalid status value rejected', () => {
    const { res, result } = createMockRes();
    handleListThreads({ project_id: 'proj', status: 'frozen' }, res);
    expectInvalidBody(result, 'status');
  });

  it('threads/get: missing thread_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleGetThread({ project_id: 'proj' }, res);
    expectInvalidBody(result, 'thread_id');
  });

  it('threads/update: missing thread_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleUpdateThread({ project_id: 'proj' }, res);
    expectInvalidBody(result, 'thread_id');
  });

  it('threads/delete: missing thread_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleDeleteThread({ project_id: 'proj' }, res);
    expectInvalidBody(result, 'thread_id');
  });

  it('threads/search: missing query → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleSearchThreads({ project_id: 'proj' }, res);
    expectInvalidBody(result, 'query');
  });

  it('threads/summary: missing thread_id → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleThreadSummary({ project_id: 'proj' }, res);
    expectInvalidBody(result, 'thread_id');
  });
});

describe('zod validation · projects handlers [FU-D]', () => {
  it('project/create: missing name → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleCreateProject({}, res);
    expectInvalidBody(result, 'name');
  });

  it('project/add-agent: missing cwd → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleAddAgent({ project_id: 'proj', role: 'backend' }, res);
    expectInvalidBody(result, 'cwd');
  });

  it('project/update: missing agents array → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    handleUpdateProject({ project_id: 'proj' }, res);
    expectInvalidBody(result, 'agents');
  });

  it('project/update: agents must be array (object rejected)', () => {
    const { res, result } = createMockRes();
    handleUpdateProject({ project_id: 'proj', agents: { role: 'x', cwd: '/y' } }, res);
    expectInvalidBody(result, 'agents');
  });

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
