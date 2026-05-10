// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync, symlinkSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Peer } from '../../src/shared/types.js';

// FASE B-2 (v0.3.0): broker handlers for /api/skills/*. Per-test
// ACC_HOME so the file system never gets polluted, and we
// vi.resetModules() between to pick up a fresh PROJECTS_DIR.

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

let tmpHome: string;
let prevHome: string | undefined;

let initDatabase: typeof import('../../src/broker/database.js').initDatabase;
let insertPeer: typeof import('../../src/broker/database.js').insertPeer;
let handleSkillsList: typeof import('../../src/broker/handlers.js').handleSkillsList;
let handleSkillsGet: typeof import('../../src/broker/handlers.js').handleSkillsGet;
let handleSkillsSave: typeof import('../../src/broker/handlers.js').handleSkillsSave;
let handleSkillsDelete: typeof import('../../src/broker/handlers.js').handleSkillsDelete;

beforeEach(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), 'acc-skills-handlers-'));
  prevHome = process.env['ACC_HOME'];
  process.env['ACC_HOME'] = tmpHome;
  vi.resetModules();
  ({ initDatabase, insertPeer } = await import('../../src/broker/database.js'));
  ({ handleSkillsList, handleSkillsGet, handleSkillsSave, handleSkillsDelete } =
    await import('../../src/broker/handlers.js'));
  initDatabase(':memory:');
  insertPeer(makePeer({ id: 'p1', project_id: 'proj' }));
  insertPeer(makePeer({ id: 'p-other', project_id: 'other-proj' }));
});

afterEach(() => {
  if (prevHome != null) process.env['ACC_HOME'] = prevHome;
  else delete process.env['ACC_HOME'];
  rmSync(tmpHome, { recursive: true, force: true });
  vi.resetModules();
});

function skillPath(projectId: string, filename: string): string {
  return join(tmpHome, 'projects', projectId, 'skills', filename);
}

// ── list ───────────────────────────────────────────────────────

describe('handleSkillsList', () => {
  it('returns empty array when no skills exist', () => {
    const { res, result } = createMockRes();
    handleSkillsList({ project_id: 'proj', peer_id: 'p1' }, res);
    expect(result.statusCode).toBe(200);
    expect((result.body as { files: unknown[] }).files).toEqual([]);
  });

  it('lists existing valid skill files with size + updated_at', () => {
    mkdirSync(join(tmpHome, 'projects', 'proj', 'skills'), { recursive: true });
    writeFileSync(skillPath('proj', 'esm.md'), 'always esm', 'utf8');
    writeFileSync(skillPath('proj', 'tests.md'), 'tests/<area>/', 'utf8');

    const { res, result } = createMockRes();
    handleSkillsList({ project_id: 'proj', peer_id: 'p1' }, res);
    const body = result.body as { files: Array<{ filename: string; size: number; updated_at: string }> };
    expect(body.files).toHaveLength(2);
    expect(body.files.map(f => f.filename).sort()).toEqual(['esm.md', 'tests.md']);
    for (const f of body.files) {
      expect(typeof f.size).toBe('number');
      expect(typeof f.updated_at).toBe('string');
    }
  });

  it('rejects cross-project peer (S-NEW-3)', () => {
    const { res, result } = createMockRes();
    handleSkillsList({ project_id: 'proj', peer_id: 'p-other' }, res);
    expect(result.statusCode).toBe(403);
  });

  it('rejects missing project_id', () => {
    const { res, result } = createMockRes();
    handleSkillsList({ peer_id: 'p1' }, res);
    expect(result.statusCode).toBe(400);
  });

  it('skips invalid filenames at scan time', () => {
    const dir = join(tmpHome, 'projects', 'proj', 'skills');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'good.md'), 'good', 'utf8');
    writeFileSync(join(dir, 'bad name.md'), 'no', 'utf8');
    writeFileSync(join(dir, 'image.png'), 'no', 'utf8');

    const { res, result } = createMockRes();
    handleSkillsList({ project_id: 'proj', peer_id: 'p1' }, res);
    const body = result.body as { files: Array<{ filename: string }> };
    expect(body.files.map(f => f.filename)).toEqual(['good.md']);
  });
});

// ── get ────────────────────────────────────────────────────────

describe('handleSkillsGet', () => {
  it('returns the file content when it exists', () => {
    mkdirSync(join(tmpHome, 'projects', 'proj', 'skills'), { recursive: true });
    writeFileSync(skillPath('proj', 'esm.md'), '# always esm\nuse import', 'utf8');

    const { res, result } = createMockRes();
    handleSkillsGet({ project_id: 'proj', peer_id: 'p1', filename: 'esm.md' }, res);
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      filename: 'esm.md',
      content: '# always esm\nuse import',
    });
  });

  it('returns 404 for missing file', () => {
    const { res, result } = createMockRes();
    handleSkillsGet({ project_id: 'proj', peer_id: 'p1', filename: 'nope.md' }, res);
    expect(result.statusCode).toBe(404);
  });

  it('rejects path traversal in filename', () => {
    const { res, result } = createMockRes();
    handleSkillsGet({ project_id: 'proj', peer_id: 'p1', filename: '../escape.md' }, res);
    expect(result.statusCode).toBe(400);
  });

  it('rejects non-md filename', () => {
    const { res, result } = createMockRes();
    handleSkillsGet({ project_id: 'proj', peer_id: 'p1', filename: 'config.json' }, res);
    expect(result.statusCode).toBe(400);
  });

  it('rejects cross-project peer', () => {
    const { res, result } = createMockRes();
    handleSkillsGet({ project_id: 'proj', peer_id: 'p-other', filename: 'esm.md' }, res);
    expect(result.statusCode).toBe(403);
  });
});

// ── save ───────────────────────────────────────────────────────

describe('handleSkillsSave', () => {
  it('creates a new skill file (mkdirs the skills/ dir)', () => {
    const { res, result } = createMockRes();
    handleSkillsSave({
      project_id: 'proj', peer_id: 'p1',
      filename: 'esm.md', content: 'always use esm',
    }, res);
    expect(result.statusCode).toBe(200);
    expect(readFileSync(skillPath('proj', 'esm.md'), 'utf8')).toBe('always use esm');
  });

  it('overwrites an existing file', () => {
    const dir = join(tmpHome, 'projects', 'proj', 'skills');
    mkdirSync(dir, { recursive: true });
    writeFileSync(skillPath('proj', 'esm.md'), 'v1', 'utf8');

    const { res } = createMockRes();
    handleSkillsSave({
      project_id: 'proj', peer_id: 'p1',
      filename: 'esm.md', content: 'v2',
    }, res);
    expect(readFileSync(skillPath('proj', 'esm.md'), 'utf8')).toBe('v2');
  });

  it('rejects content over the per-file cap (8 KB) with 413', () => {
    const { res, result } = createMockRes();
    handleSkillsSave({
      project_id: 'proj', peer_id: 'p1',
      filename: 'big.md', content: 'a'.repeat(8 * 1024 + 1),
    }, res);
    expect(result.statusCode).toBe(413);
  });

  it('rejects path traversal in filename', () => {
    const { res, result } = createMockRes();
    handleSkillsSave({
      project_id: 'proj', peer_id: 'p1',
      filename: '../etc/passwd', content: 'bad',
    }, res);
    expect(result.statusCode).toBe(400);
  });

  it('rejects cross-project peer', () => {
    const { res, result } = createMockRes();
    handleSkillsSave({
      project_id: 'proj', peer_id: 'p-other',
      filename: 'esm.md', content: 'x',
    }, res);
    expect(result.statusCode).toBe(403);
  });

  it('rejects missing required fields', () => {
    const { res, result } = createMockRes();
    handleSkillsSave({ project_id: 'proj', peer_id: 'p1' }, res);
    expect(result.statusCode).toBe(400);
  });

  it('a save on project A cannot touch project B (cross-project write)', () => {
    insertPeer(makePeer({ id: 'p-b', project_id: 'projB' }));
    const { res } = createMockRes();
    handleSkillsSave({
      project_id: 'projB', peer_id: 'p-b',
      filename: 'b.md', content: 'in B',
    }, res);
    // Sanity: the file landed under projB, not proj
    expect(readFileSync(skillPath('projB', 'b.md'), 'utf8')).toBe('in B');
    // proj's skills dir was NEVER created (or stays empty)
    const projDir = join(tmpHome, 'projects', 'proj', 'skills');
    let entries: string[] = [];
    try {
       
      entries = require('node:fs').readdirSync(projDir);
    } catch { /* dir does not exist — also fine */ }
    expect(entries).toEqual([]);
  });
});

// ── delete ─────────────────────────────────────────────────────

describe('handleSkillsDelete', () => {
  it('removes an existing file', () => {
    mkdirSync(join(tmpHome, 'projects', 'proj', 'skills'), { recursive: true });
    writeFileSync(skillPath('proj', 'esm.md'), 'x', 'utf8');

    const { res, result } = createMockRes();
    handleSkillsDelete({ project_id: 'proj', peer_id: 'p1', filename: 'esm.md' }, res);
    expect(result.statusCode).toBe(200);
    // Verify the file is gone via list
    const listResult = createMockRes();
    handleSkillsList({ project_id: 'proj', peer_id: 'p1' }, listResult.res);
    expect((listResult.result.body as { files: unknown[] }).files).toHaveLength(0);
  });

  it('is idempotent — deleting a missing file returns 200', () => {
    const { res, result } = createMockRes();
    handleSkillsDelete({ project_id: 'proj', peer_id: 'p1', filename: 'gone.md' }, res);
    expect(result.statusCode).toBe(200);
  });

  it('rejects path traversal in filename', () => {
    const { res, result } = createMockRes();
    handleSkillsDelete({ project_id: 'proj', peer_id: 'p1', filename: '../escape.md' }, res);
    expect(result.statusCode).toBe(400);
  });

  it('rejects cross-project peer', () => {
    const { res, result } = createMockRes();
    handleSkillsDelete({ project_id: 'proj', peer_id: 'p-other', filename: 'esm.md' }, res);
    expect(result.statusCode).toBe(403);
  });
});

// ── symlink defence ────────────────────────────────────────────

describe('skills handlers · symlink defence', () => {
  it('rejects a symlink that points outside the skills directory', () => {
    const dir = join(tmpHome, 'projects', 'proj', 'skills');
    mkdirSync(dir, { recursive: true });
    try {
      symlinkSync('/etc/hosts', join(dir, 'evil.md'));
    } catch {
      // CI sandbox may forbid symlink creation — skip gracefully
      return;
    }
    const { res, result } = createMockRes();
    handleSkillsGet({ project_id: 'proj', peer_id: 'p1', filename: 'evil.md' }, res);
    expect(result.statusCode).toBe(400);
  });
});
