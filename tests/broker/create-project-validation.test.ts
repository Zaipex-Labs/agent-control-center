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
      handleCreateProject({ name, description: 'audit' }, res);
      expect(result.statusCode).toBe(400);
      // Confirm no file leaked out of PROJECTS_DIR.
      const escaped = join(home, '..', 'tmp', 'pwned.json');
      expect(existsSync(escaped)).toBe(false);
    });
  }

  it('accepts a valid name and writes inside PROJECTS_DIR', () => {
    const { res, result } = createMockRes();
    handleCreateProject({ name: 'proj-alpha_01', description: 'audit' }, res);
    expect(result.statusCode).toBe(200);
    expect(result.body?.ok).toBe(true);
    // The config file lives inside PROJECTS_DIR.
    const files = readdirSync(projectsDir);
    expect(files).toContain('proj-alpha_01.json');
  });

  it('accepts dotted names for backcompat (e.g. "my.project")', () => {
    const { res, result } = createMockRes();
    handleCreateProject({ name: 'my.project', description: 'audit' }, res);
    expect(result.statusCode).toBe(200);
  });
});
