// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// [C-1] from v0.2.1 audit: handleCreateProject wrote ${PROJECTS_DIR}/${name}.json
// without validating name. A body with `name: "../../../tmp/pwned"` escaped
// PROJECTS_DIR. These tests lock the validation in place.

interface MockRes {
  statusCode: number;
  body: { ok?: boolean; error?: string } | null;
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

let home: string;
let projectsDir: string;
let handleCreateProject: (body: unknown, res: ServerResponse) => void;

beforeAll(async () => {
  // Pin ACC_HOME to a scratch dir BEFORE importing handlers, so the
  // config module resolves PROJECTS_DIR inside it. resetModules lets
  // us re-import config.js with the new env.
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'acc-cp-val-'));
  process.env['ACC_HOME'] = home;

  const cfg = await import('../../src/shared/config.js');
  projectsDir = cfg.PROJECTS_DIR;
  const H = await import('../../src/broker/handlers.js');
  handleCreateProject = H.handleCreateProject;
});

afterAll(() => {
  delete process.env['ACC_HOME'];
  rmSync(home, { recursive: true, force: true });
});

describe('handleCreateProject validates name [C-1]', () => {
  const TRAVERSAL_CASES: Array<[string, string]> = [
    ['../../../tmp/pwned', 'path traversal'],
    ['foo/bar', 'slash separator'],
    ['..', 'dot-dot alone'],
    ['$(id)', 'shell substitution'],
    ['`whoami`', 'backticks'],
    ['a;b', 'semicolon'],
    ['name with space', 'space'],
    ['a'.repeat(65), 'too long'],
    ['', 'empty string'],
    ['a\0b', 'null byte'],
  ];

  for (const [name, why] of TRAVERSAL_CASES) {
    it(`rejects name=${JSON.stringify(name)} (${why})`, () => {
      const { res, result } = createMockRes();
      handleCreateProject({ project_id: name, description: 'audit' }, res);
      expect(result.statusCode).toBe(400);
      // Confirm no file leaked out of PROJECTS_DIR.
      const escaped = join(home, '..', 'tmp', 'pwned.json');
      expect(existsSync(escaped)).toBe(false);
    });
  }

  it('accepts a valid project_id and writes inside PROJECTS_DIR', () => {
    const { res, result } = createMockRes();
    handleCreateProject({ project_id: 'proj-alpha_01', description: 'audit' }, res);
    expect(result.statusCode).toBe(200);
    expect(result.body?.ok).toBe(true);
    // The config file lives inside PROJECTS_DIR.
    const files = readdirSync(projectsDir);
    expect(files).toContain('proj-alpha_01.json');
  });

  it('accepts dotted ids for backcompat (e.g. "my.project")', () => {
    const { res, result } = createMockRes();
    handleCreateProject({ project_id: 'my.project', description: 'audit' }, res);
    expect(result.statusCode).toBe(200);
  });
});

// FU-AI v0.4.1: /api/project/create now accepts only `project_id`.
// The legacy `name` alias that v0.4.0 kept for one back-compat window
// has been removed. These tests pin the new strict contract.
describe('handleCreateProject FU-AI — canonical project_id only', () => {
  it('accepts canonical project_id and returns only project_id in response', () => {
    const { res, result } = createMockRes();
    handleCreateProject({ project_id: 'fuai-canonical', description: 'a' }, res);
    expect(result.statusCode).toBe(200);
    expect(result.body?.ok).toBe(true);
    const body = result.body as { project_id?: string; name?: string };
    expect(body.project_id).toBe('fuai-canonical');
    // `name` is no longer part of the response shape.
    expect(body.name).toBeUndefined();
    expect(readdirSync(projectsDir)).toContain('fuai-canonical.json');
  });

  it('rejects body that uses the legacy `name` alias (no longer accepted)', () => {
    const { res, result } = createMockRes();
    handleCreateProject({ name: 'fuai-legacy', description: 'a' }, res);
    expect(result.statusCode).toBe(400);
    const body = result.body as { code?: string; error?: string };
    expect(body.code).toBe('INVALID_BODY');
    expect(body.error).toMatch(/project_id/i);
  });

  it('rejects body without project_id', () => {
    const { res, result } = createMockRes();
    handleCreateProject({ description: 'a' }, res);
    expect(result.statusCode).toBe(400);
    const body = result.body as { code?: string };
    expect(body.code).toBe('INVALID_BODY');
  });
});
