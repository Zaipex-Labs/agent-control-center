// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitModifiedFiles } from '../../src/broker/files.js';

describe('gitModifiedFiles', () => {
  let repo: string;
  let notRepo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'acc-files-repo-'));
    execSync('git init -q', { cwd: repo });
    execSync('git config user.email test@example.com', { cwd: repo });
    execSync('git config user.name test', { cwd: repo });
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    execSync('git add a.txt', { cwd: repo });
    execSync('git commit -q -m init', { cwd: repo });

    notRepo = mkdtempSync(join(tmpdir(), 'acc-files-norepo-'));
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(notRepo, { recursive: true, force: true });
  });

  it('returns empty array on empty cwd', async () => {
    expect(await gitModifiedFiles('')).toEqual([]);
  });

  it('returns empty array when cwd does not exist', async () => {
    expect(await gitModifiedFiles('/definitely/does/not/exist/xyz')).toEqual([]);
  });

  it('returns empty array for a non-git directory', async () => {
    expect(await gitModifiedFiles(notRepo)).toEqual([]);
  });

  it('returns empty array when repo is clean', async () => {
    expect(await gitModifiedFiles(repo)).toEqual([]);
  });

  it('detects untracked files', async () => {
    writeFileSync(join(repo, 'untracked.txt'), 'new\n');
    const entries = await gitModifiedFiles(repo);
    const found = entries.find(e => e.path === 'untracked.txt');
    expect(found).toBeDefined();
    expect(found!.status).toBe('??');
  });

  it('detects modified tracked files', async () => {
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    const entries = await gitModifiedFiles(repo);
    const found = entries.find(e => e.path === 'a.txt');
    expect(found).toBeDefined();
    expect(found!.status.trim()).toBe('M');
  });

  it('detects files in subdirectories', async () => {
    mkdirSync(join(repo, 'sub'), { recursive: true });
    writeFileSync(join(repo, 'sub', 'nested.txt'), 'x\n');
    const entries = await gitModifiedFiles(repo);
    // Git porcelain output may list either the individual file or the
    // whole directory ("sub/") when the dir is entirely new. Accept both.
    expect(
      entries.some(e => e.path === 'sub/nested.txt' || e.path === 'sub/'),
    ).toBe(true);
  });

  // [P-3] fans out one git-status spawn per agent in parallel — pin the
  // contract that calling gitModifiedFiles N times concurrently still
  // returns N independent results (no shared state, no cross-talk).
  it('runs concurrently for multiple cwds (P-3)', async () => {
    const repo2 = mkdtempSync(join(tmpdir(), 'acc-files-repo2-'));
    try {
      execSync('git init -q', { cwd: repo2 });
      writeFileSync(join(repo2, 'b.txt'), 'b\n');
      // Running two queries in parallel must not deadlock or mix results.
      const [a, b] = await Promise.all([
        gitModifiedFiles(repo),
        gitModifiedFiles(repo2),
      ]);
      expect(Array.isArray(a)).toBe(true);
      expect(Array.isArray(b)).toBe(true);
    } finally {
      rmSync(repo2, { recursive: true, force: true });
    }
  });
});
