// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// MED-10 (v0.4.0): every broker error response carries the canonical
// { ok: false, error: string, code: string, issues?: ... } shape.
// Pre-v0.4.0 there were ~57 callsites of error(res, message, status)
// that produced { ok: false, error } without `code`. This test
// exercises a representative slice of those error paths and asserts
// the shape is uniform now.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface MockRes {
  statusCode: number;
  body: { ok?: boolean; error?: string; code?: string; issues?: unknown[]; [k: string]: unknown } | null;
  headers: Record<string, string>;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null, headers: {} };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((s: number, h?: Record<string, string>) => {
    result.statusCode = s;
    if (h) result.headers = h;
    return res;
  }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => {
    if (data) result.body = JSON.parse(data);
    return res;
  }) as ServerResponse['end'];
  return { res, result };
}

// Asserts the canonical MED-10 shape. Every error response in v0.4.0+
// must satisfy this.
function expectCanonicalErrorShape(result: MockRes): void {
  expect(result.statusCode).toBeGreaterThanOrEqual(400);
  expect(result.body).not.toBeNull();
  expect(result.body?.ok).toBe(false);
  expect(typeof result.body?.error).toBe('string');
  expect(result.body?.error).toBeTruthy();
  expect(typeof result.body?.code).toBe('string');
  expect(result.body?.code).toBeTruthy();
}

let home: string;
let H: typeof import('../../src/broker/handlers.js');

beforeAll(async () => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'acc-err-shapes-'));
  process.env['ACC_HOME'] = home;
  H = await import('../../src/broker/handlers.js');
  const db = await import('../../src/broker/database.js');
  db.initDatabase(':memory:');
});

afterAll(() => {
  delete process.env['ACC_HOME'];
  rmSync(home, { recursive: true, force: true });
});

describe('MED-10 — canonical error response shape', () => {
  // ── Zod validation errors (INVALID_BODY)

  it('project/create empty body → INVALID_BODY with issues array', () => {
    const { res, result } = createMockRes();
    H.handleCreateProject({}, res);
    expectCanonicalErrorShape(result);
    expect(result.body?.code).toBe('INVALID_BODY');
    expect(Array.isArray(result.body?.issues)).toBe(true);
  });

  it('project/add-agent missing role → INVALID_BODY', () => {
    const { res, result } = createMockRes();
    H.handleAddAgent({ project_id: 'p', cwd: '/tmp' }, res);
    expectCanonicalErrorShape(result);
    expect(result.body?.code).toBe('INVALID_BODY');
  });

  it('send-message empty body → INVALID_BODY', async () => {
    const { res, result } = createMockRes();
    await H.handleSendMessage({}, res);
    expectCanonicalErrorShape(result);
    expect(result.body?.code).toBe('INVALID_BODY');
  });

  // ── Project not-found (NOT_FOUND, derived from status 404)

  it('project/update on non-existent project → 404 NOT_FOUND', () => {
    const { res, result } = createMockRes();
    H.handleUpdateProject(
      { project_id: 'does-not-exist', agents: [] },
      res,
    );
    expectCanonicalErrorShape(result);
    expect(result.statusCode).toBe(404);
    expect(result.body?.code).toBe('NOT_FOUND');
  });

  it('project/delete on non-existent project → 404 NOT_FOUND', () => {
    const { res, result } = createMockRes();
    H.handleDeleteProject({ project_id: 'does-not-exist' }, res);
    expectCanonicalErrorShape(result);
    expect(result.statusCode).toBe(404);
    expect(result.body?.code).toBe('NOT_FOUND');
  });

  // ── Cross-project membership (specific subcodes preserved)

  it('shared/get without peer_id → MISSING_PEER_ID (subcode preserved)', () => {
    const { res, result } = createMockRes();
    H.handleSharedGet({ project_id: 'p', namespace: 'a', key: 'k' }, res);
    expectCanonicalErrorShape(result);
    expect(result.body?.code).toBe('MISSING_PEER_ID');
  });

  it('shared/get with unknown peer_id → PEER_NOT_FOUND (subcode preserved)', () => {
    const { res, result } = createMockRes();
    H.handleSharedGet(
      { project_id: 'p', namespace: 'a', key: 'k', peer_id: 'ghost' },
      res,
    );
    expectCanonicalErrorShape(result);
    expect(result.body?.code).toBe('PEER_NOT_FOUND');
    expect(result.statusCode).toBe(404);
  });

  // ── Conflict (409, derived from status)

  it('project/create then create-again → 400 (status defaults to BAD_REQUEST when no explicit code)', () => {
    // The "already exists" path uses error() with default status 400;
    // the helper derives `code: BAD_REQUEST`. This matches existing
    // behavior — finer codes (CONFLICT) can come in a later round.
    H.handleCreateProject({ project_id: 'med10-once' }, createMockRes().res);
    const { res, result } = createMockRes();
    H.handleCreateProject({ project_id: 'med10-once' }, res);
    expectCanonicalErrorShape(result);
    expect(result.statusCode).toBe(400);
    expect(result.body?.code).toBe('BAD_REQUEST');
  });
});
