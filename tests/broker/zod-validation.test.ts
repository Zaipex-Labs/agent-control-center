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
