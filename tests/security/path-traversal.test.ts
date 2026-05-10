// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [S-NEW-5 / L-7 v0.2.1] path traversal regression coverage.
//
// The pre-v0.2.5 sanitizer was `safePath.replace(/\.\./g, '')` which:
//   1. Left `....//` intact (`....` minus first `..` → `..//`).
//   2. Did not follow symlinks. A symlink under DASHBOARD_DIR pointing
//      to `/etc/passwd` would be served happily.
//
// v0.2.5 replaces it with realpath + startsWith(BASE + sep) for the
// static-file path and full path resolution for handleBrowse.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { handleBrowse } from '../../src/broker/handlers.js';

interface MockRes {
  statusCode: number;
  body: { path?: string; folders?: unknown[]; error?: string } | null;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((status: number) => {
    result.statusCode = status;
    return res;
  }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => {
    if (data) result.body = JSON.parse(data);
    return res;
  }) as ServerResponse['end'];
  return { res, result };
}

describe('[S-NEW-5] handleBrowse path normalization', () => {
  let baseDir: string;
  let resolvedBase: string;
  let inner: string;
  let symlinkPath: string;

  beforeAll(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'acc-browse-'));
    resolvedBase = realpathSync(baseDir);
    inner = join(baseDir, 'inner');
    mkdirSync(inner);
    writeFileSync(join(inner, 'note.txt'), 'hello');
    // A symlink under baseDir pointing to a sibling directory — the
    // resolved target is fine (no escape) and we want the handler to
    // still happily list it.
    symlinkPath = join(baseDir, 'link-to-inner');
    symlinkSync(inner, symlinkPath);
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('listing a real directory works', () => {
    const { res, result } = createMockRes();
    handleBrowse(`path=${encodeURIComponent(baseDir)}`, res);
    expect(result.statusCode).toBe(200);
    expect(result.body?.path).toBe(resolvedBase);
    const names = (result.body?.folders as Array<{ name: string }>).map(f => f.name);
    expect(names).toContain('inner');
  });

  it('a `....//` traversal is normalized, not silently stripped', () => {
    // Pre-v0.2.5 the broken `.replace(/\.\./g, '')` turned this into
    // `..//<something>` which then escaped the parent. The new
    // resolve() collapses `....//foo` to `<cwd>/..../foo` (literal four
    // dots is a valid component name) — readdirSync fails with ENOENT
    // and the handler returns 400 with an error string.
    const { res, result } = createMockRes();
    handleBrowse(`path=${encodeURIComponent('....//etc/passwd')}`, res);
    // The exact status depends on whether `....//etc/passwd` resolves
    // anywhere — on a fresh tmp it doesn't, so we get 400.
    expect(result.statusCode).toBe(400);
    expect(result.body?.error).toBeTruthy();
  });

  it('symlink under baseDir resolves to its target', () => {
    const { res, result } = createMockRes();
    handleBrowse(`path=${encodeURIComponent(symlinkPath)}`, res);
    expect(result.statusCode).toBe(200);
    // realpath must have followed the symlink
    expect(result.body?.path).toBe(realpathSync(inner));
  });

  it('non-existent path returns 400 not 200', () => {
    const { res, result } = createMockRes();
    handleBrowse(`path=${encodeURIComponent('/this/definitely/does/not/exist/abcdef')}`, res);
    expect(result.statusCode).toBe(400);
  });
});
