// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// [H-3] — handleAddAgent and handleUpdateProject previously wrote the
// user-supplied `role` straight into the project config, and spawn.ts
// interpolated that role raw into a `tmux new-window` execSync template.
// A role like `$(touch /tmp/acc-pwn-canary)` would run at "Power up".
//
// Defense:
//   - handlers now call assertSafeIdentifier on role + name before
//     persisting. These tests verify the 400 rejection path.
//   - A canary file is wired in so that if anyone disables the
//     validation without realising the downstream risk, this test
//     catches it on CI (the canary never gets created because we never
//     call project/up; the test asserts the 400 at handler level).

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
let handleAddAgent: (body: unknown, res: ServerResponse) => void;
let handleUpdateProject: (body: unknown, res: ServerResponse) => void;

beforeAll(async () => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'acc-h3-'));
  process.env['ACC_HOME'] = home;
  const cfg = await import('../../src/shared/config.js');
  projectsDir = cfg.PROJECTS_DIR;
  const db = await import('../../src/broker/database.js');
  db.initDatabase(':memory:');
  const H = await import('../../src/broker/handlers.js');
  handleCreateProject = H.handleCreateProject;
  handleAddAgent = H.handleAddAgent;
  handleUpdateProject = H.handleUpdateProject;
});

afterAll(() => {
  delete process.env['ACC_HOME'];
  rmSync(home, { recursive: true, force: true });
});

// A canary in /tmp that any shell-injection attempt would create. If
// our rejection logic fails and a test accidentally reaches spawn, this
// file shows up and afterEach fails the run.
const CANARY_PATH = join(tmpdir(), `acc-pwn-canary-${process.pid}`);

beforeEach(() => {
  // Ensure projects dir exists and seed a valid config per test.
  mkdirSync(projectsDir, { recursive: true });
  writeFileSync(join(projectsDir, 'proj-a.json'), JSON.stringify({
    name: 'proj-a',
    description: 'seed',
    created_at: new Date().toISOString(),
    agents: [],
  }));
});

afterAll(() => {
  if (existsSync(CANARY_PATH)) {
    rmSync(CANARY_PATH);
    throw new Error(
      `Security regression: canary ${CANARY_PATH} was created. A test ` +
      'reached shell execution with injected role/name — [H-3] defence ' +
      'is broken.',
    );
  }
});

describe('handleAddAgent rejects unsafe role/name [H-3]', () => {
  const BAD_ROLES = [
    '$(touch /tmp/acc-pwn-canary-nope)',
    '`id`',
    'a;rm -rf /',
    'a|b',
    'a&b',
    'a>b',
    'a\nb',
    'a\0b',
    '../role',
    'a'.repeat(65),
  ];

  for (const role of BAD_ROLES) {
    it(`rejects role ${JSON.stringify(role)}`, () => {
      const { res, result } = createMockRes();
      handleAddAgent({
        project_id: 'proj-a', role, cwd: '/tmp', name: 'Alice',
      }, res);
      expect(result.statusCode).toBe(400);
      expect(result.body?.error).toMatch(/Invalid role/i);
    });
  }

  it('rejects unsafe name', () => {
    const { res, result } = createMockRes();
    handleAddAgent({
      project_id: 'proj-a', role: 'backend', cwd: '/tmp', name: '`whoami`',
    }, res);
    expect(result.statusCode).toBe(400);
    expect(result.body?.error).toMatch(/Invalid name/i);
  });

  it('accepts legit role/name', () => {
    const { res, result } = createMockRes();
    handleAddAgent({
      project_id: 'proj-a', role: 'backend', cwd: '/tmp', name: 'Turing',
    }, res);
    expect(result.statusCode).toBe(200);
  });
});

describe('handleUpdateProject rejects unsafe role/name [H-3]', () => {
  it('rejects an agent entry with an injected role', () => {
    const { res, result } = createMockRes();
    handleUpdateProject({
      project_id: 'proj-a',
      description: 'x',
      agents: [
        { role: 'backend', cwd: '/tmp' },
        { role: '$(touch /tmp/acc-pwn-canary-nope)', cwd: '/tmp' },
      ],
    }, res);
    expect(result.statusCode).toBe(400);
    expect(result.body?.error).toMatch(/Invalid role/i);
  });

  it('rejects an agent entry with an injected name', () => {
    const { res, result } = createMockRes();
    handleUpdateProject({
      project_id: 'proj-a',
      description: 'x',
      agents: [
        { role: 'backend', cwd: '/tmp', name: 'a;rm -rf ~' },
      ],
    }, res);
    expect(result.statusCode).toBe(400);
    expect(result.body?.error).toMatch(/Invalid name/i);
  });

  it('accepts a clean agents list', () => {
    const { res, result } = createMockRes();
    handleUpdateProject({
      project_id: 'proj-a',
      description: 'x',
      agents: [{ role: 'backend', cwd: '/tmp', name: 'Turing' }],
    }, res);
    expect(result.statusCode).toBe(200);
  });
});

describe('handleCreateProject is also hardened [C-1 regression]', () => {
  it('still rejects traversal in name', () => {
    const { res, result } = createMockRes();
    handleCreateProject({ name: '../escape' }, res);
    expect(result.statusCode).toBe(400);
  });
});
