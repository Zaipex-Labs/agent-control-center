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

  it('returns empty array on empty cwd', () => {
    expect(gitModifiedFiles('')).toEqual([]);
  });

  it('returns empty array when cwd does not exist', () => {
    expect(gitModifiedFiles('/definitely/does/not/exist/xyz')).toEqual([]);
  });

  it('returns empty array for a non-git directory', () => {
    expect(gitModifiedFiles(notRepo)).toEqual([]);
  });

  it('returns empty array when repo is clean', () => {
    expect(gitModifiedFiles(repo)).toEqual([]);
  });

  it('detects untracked files', () => {
    writeFileSync(join(repo, 'untracked.txt'), 'new\n');
    const entries = gitModifiedFiles(repo);
    const found = entries.find(e => e.path === 'untracked.txt');
    expect(found).toBeDefined();
    expect(found!.status).toBe('??');
  });

  it('detects modified tracked files', () => {
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    const entries = gitModifiedFiles(repo);
    const found = entries.find(e => e.path === 'a.txt');
    expect(found).toBeDefined();
    expect(found!.status.trim()).toBe('M');
  });

  it('detects files in subdirectories', () => {
    mkdirSync(join(repo, 'sub'), { recursive: true });
    writeFileSync(join(repo, 'sub', 'nested.txt'), 'x\n');
    const entries = gitModifiedFiles(repo);
    // Git porcelain output may list either the individual file or the
    // whole directory ("sub/") when the dir is entirely new. Accept both.
    expect(
      entries.some(e => e.path === 'sub/nested.txt' || e.path === 'sub/'),
    ).toBe(true);
  });

  it('returns GitFileEntry objects with path and status', () => {
    const entries = gitModifiedFiles(repo);
    for (const e of entries) {
      expect(typeof e.path).toBe('string');
      expect(typeof e.status).toBe('string');
      expect(e.status).toHaveLength(2);
    }
  });
});
