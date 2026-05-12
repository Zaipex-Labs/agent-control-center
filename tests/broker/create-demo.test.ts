// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// B-1 v0.3.4 — one-click demo team handler. Tests pin:
//   1. First call creates the project file + 4 agents (Da Vinci +
//      Turing + Ada + Curie), seeds the skill, seeds the decision.
//   2. Second call returns {already_existed: true} without touching
//      anything. (Idempotency — the user can hit the button twice.)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ServerResponse } from 'node:http';

interface MockRes { statusCode: number; body: unknown }
function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((status: number) => { result.statusCode = status; return res; }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => { if (data) result.body = JSON.parse(data); return res; }) as ServerResponse['end'];
  return { res, result };
}

let testAccHome: string;
let prevAccHome: string | undefined;

beforeEach(() => {
  // ACC_HOME is read by src/shared/config.ts at MODULE LOAD TIME
  // (top-level `export const ACC_HOME = ...`). Setting process.env
  // in a normal beforeEach has no effect because the import was
  // already evaluated. We need to (a) set env, (b) reset the module
  // cache so a fresh import re-reads the env, (c) dynamically import
  // the handler INSIDE each test. The shape mirrors what
  // spawn-mcp-register.test.ts does for the claude PATH probe.
  testAccHome = join(tmpdir(), `vitest-demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testAccHome, { recursive: true });
  prevAccHome = process.env['ACC_HOME'];
  process.env['ACC_HOME'] = testAccHome;
  vi.resetModules();
});

afterEach(() => {
  if (prevAccHome === undefined) delete process.env['ACC_HOME'];
  else process.env['ACC_HOME'] = prevAccHome;
  try { rmSync(testAccHome, { recursive: true, force: true }); } catch { /* ignore */ }
  vi.resetModules();
});

// Fresh module graph per test: dynamic import gives us a config
// module evaluated against the just-set ACC_HOME, plus a database
// module bound to :memory: for that same fresh graph.
async function freshModules() {
  const db = await import('../../src/broker/database.js');
  db.initDatabase(':memory:');
  const handlers = await import('../../src/broker/handlers/projects.js');
  return { db, handlers };
}

describe('B-1 · handleCreateDemo', () => {
  it('creates the demo project with 4 agents on first call', async () => {
    const { handlers } = await freshModules();

    const { res, result } = createMockRes();
    handlers.handleCreateDemo({}, res);

    expect(result.statusCode).toBe(200);
    const body = result.body as { ok: boolean; name: string; already_existed?: boolean };
    expect(body.ok).toBe(true);
    expect(body.name).toBe('demo-fullstack');
    expect(body.already_existed).toBeUndefined();

    // Config file is written under the test ACC_HOME.
    const configPath = join(testAccHome, 'projects', 'demo-fullstack.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      name: string;
      agents: Array<{ role: string; name: string; cwd: string; avatar: string }>;
    };
    expect(config.name).toBe('demo-fullstack');
    expect(config.agents).toHaveLength(4);

    const byRole = new Map(config.agents.map(a => [a.role, a]));
    expect(byRole.get('arquitectura')?.name).toBe('Da Vinci');
    expect(byRole.get('backend')?.name).toBe('Turing');
    expect(byRole.get('frontend')?.name).toBe('Ada');
    expect(byRole.get('qa')?.name).toBe('Curie');

    // Specialist avatars are seeded so the user sees three distinct
    // characters from turn 0.
    expect(byRole.get('backend')?.avatar).toBe('dicebear:demo-backend');
    expect(byRole.get('frontend')?.avatar).toBe('dicebear:demo-frontend');
    expect(byRole.get('qa')?.avatar).toBe('dicebear:demo-qa');

    // Each specialist's cwd exists (so Encender doesn't error
    // with ENOENT on the validateCwds step).
    for (const role of ['backend', 'frontend', 'qa']) {
      const cwd = byRole.get(role)?.cwd ?? '';
      expect(existsSync(cwd)).toBe(true);
      expect(existsSync(join(cwd, 'README.md'))).toBe(true);
    }
  });

  it('seeds the example skill file under the project skills dir', async () => {
    const { handlers } = await freshModules();
    const { res } = createMockRes();
    handlers.handleCreateDemo({}, res);

    const skillPath = join(testAccHome, 'projects', 'demo-fullstack', 'skills', 'conventions.md');
    expect(existsSync(skillPath)).toBe(true);
    const body = readFileSync(skillPath, 'utf-8');
    expect(body).toContain('Demo project conventions');
    expect(body).toContain('TypeScript');
    expect(body).toContain('Postgres');
  });

  it('seeds one decision in team memory under namespace "decisions"', async () => {
    const { db, handlers } = await freshModules();
    const { res } = createMockRes();
    handlers.handleCreateDemo({}, res);

    const row = db.getSharedState('demo-fullstack', 'decisions', 'demo-stack-2026');
    expect(row).toBeDefined();
    expect(row?.value).toContain('TypeScript');
    expect(row?.value).toContain('React');
    expect(row?.value).toContain('Postgres');
    expect(row?.value).toContain('Vitest');
  });

  it('is idempotent — second call returns already_existed without touching state', async () => {
    const { handlers } = await freshModules();

    // First call → creates everything.
    const first = createMockRes();
    handlers.handleCreateDemo({}, first.res);
    expect((first.result.body as { ok: boolean; already_existed?: boolean }).already_existed).toBeUndefined();

    // Capture pre-call mtime/content so we can prove no overwrite.
    const configPath = join(testAccHome, 'projects', 'demo-fullstack.json');
    const before = readFileSync(configPath, 'utf-8');

    // Second call → reports already_existed, leaves the file alone.
    const second = createMockRes();
    handlers.handleCreateDemo({}, second.res);
    const body2 = second.result.body as { ok: boolean; name: string; already_existed: boolean };
    expect(body2.ok).toBe(true);
    expect(body2.already_existed).toBe(true);

    const after = readFileSync(configPath, 'utf-8');
    expect(after).toBe(before);
  });
});
