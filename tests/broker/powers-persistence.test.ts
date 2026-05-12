// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// FASE A-1 (v0.3.2). Round-trip test: a project upsert / add-agent with
// `powers: [...]` persists those names into the project JSON, and an
// upsert with no powers leaves the field off the on-disk shape so old
// projects stay byte-clean.

interface MockRes {
  statusCode: number;
  body: { ok?: boolean; error?: string } | null;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((s: number) => {
    result.statusCode = s;
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
  home = mkdtempSync(join(tmpdir(), 'acc-powers-'));
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

beforeEach(() => {
  mkdirSync(projectsDir, { recursive: true });
  // Fresh project per test so the architect injection on
  // handleUpdateProject doesn't compound across tests.
  rmSync(join(projectsDir, 'powers-proj.json'), { force: true });
  const { res } = createMockRes();
  handleCreateProject({ project_id: 'powers-proj' }, res);
});

describe('handleAddAgent persists powers', () => {
  it('writes a non-empty powers array verbatim', () => {
    const { res, result } = createMockRes();
    handleAddAgent(
      {
        project_id: 'powers-proj',
        role: 'backend',
        cwd: home,
        powers: ['git', 'postgres'],
      },
      res,
    );
    expect(result.statusCode).toBe(200);
    expect(result.body?.ok).toBe(true);

    const config = JSON.parse(readFileSync(join(projectsDir, 'powers-proj.json'), 'utf-8'));
    const backend = config.agents.find((a: { role: string }) => a.role === 'backend');
    expect(backend.powers).toEqual(['git', 'postgres']);
  });

  it('omits the powers field when none requested', () => {
    const { res } = createMockRes();
    handleAddAgent(
      { project_id: 'powers-proj', role: 'frontend', cwd: home },
      res,
    );
    const config = JSON.parse(readFileSync(join(projectsDir, 'powers-proj.json'), 'utf-8'));
    const frontend = config.agents.find((a: { role: string }) => a.role === 'frontend');
    expect(Object.prototype.hasOwnProperty.call(frontend, 'powers')).toBe(false);
  });
});

describe('handleUpdateProject persists powers per agent', () => {
  it('writes per-agent powers and leaves bare entries clean', () => {
    const { res, result } = createMockRes();
    handleUpdateProject(
      {
        project_id: 'powers-proj',
        description: 'desc',
        agents: [
          { role: 'backend', cwd: home, powers: ['git'] },
          { role: 'frontend', cwd: home, powers: ['playwright'] },
          { role: 'qa', cwd: home }, // no powers
        ],
      },
      res,
    );
    expect(result.statusCode).toBe(200);

    const config = JSON.parse(readFileSync(join(projectsDir, 'powers-proj.json'), 'utf-8'));
    const byRole = Object.fromEntries(
      config.agents.map((a: { role: string }) => [a.role, a]),
    );
    expect(byRole.backend.powers).toEqual(['git']);
    expect(byRole.frontend.powers).toEqual(['playwright']);
    expect(Object.prototype.hasOwnProperty.call(byRole.qa, 'powers')).toBe(false);
  });

  it('handleUpdateProject rejects non-string entries in the powers array', () => {
    const { res, result } = createMockRes();
    handleUpdateProject(
      {
        project_id: 'powers-proj',
        agents: [{ role: 'backend', cwd: home, powers: ['git', 123] }],
      },
      res,
    );
    // Zod shape check: array<string> rejects a number element.
    expect(result.statusCode).toBe(400);
    expect(result.body?.error).toBeDefined();
  });
});

describe('ensureArchitect preserves powers across update', () => {
  it('does not strip powers from the architect entry on re-save', () => {
    // First save: architect with a custom power.
    {
      const { res, result } = createMockRes();
      handleUpdateProject(
        {
          project_id: 'powers-proj',
          agents: [
            { role: 'arquitectura', cwd: home, powers: ['git'] },
            { role: 'backend', cwd: home },
          ],
        },
        res,
      );
      expect(result.statusCode).toBe(200);
    }
    // Read back, confirm architect kept powers.
    {
      const config = JSON.parse(readFileSync(join(projectsDir, 'powers-proj.json'), 'utf-8'));
      const arch = config.agents.find((a: { role: string }) => a.role === 'arquitectura');
      expect(arch.powers).toEqual(['git']);
    }
    // Re-save with the same shape: powers should survive ensureArchitect merge.
    {
      const fresh = JSON.parse(readFileSync(join(projectsDir, 'powers-proj.json'), 'utf-8'));
      const { res } = createMockRes();
      handleUpdateProject(
        {
          project_id: 'powers-proj',
          agents: fresh.agents.map((a: { role: string; cwd: string; powers?: string[] }) => ({
            role: a.role,
            cwd: a.cwd,
            ...(a.powers ? { powers: a.powers } : {}),
          })),
        },
        res,
      );
      const next = JSON.parse(readFileSync(join(projectsDir, 'powers-proj.json'), 'utf-8'));
      const arch = next.agents.find((a: { role: string }) => a.role === 'arquitectura');
      expect(arch.powers).toEqual(['git']);
    }
  });
});
