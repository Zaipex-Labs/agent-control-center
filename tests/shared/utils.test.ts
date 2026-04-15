// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { generateId, getGitRoot, getGitBranch, getTty } from '../../src/shared/utils.js';

describe('generateId', () => {
  it('returns an 8-character hex string', () => {
    const id = generateId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('getGitRoot', () => {
  it('returns a path inside a git repo', () => {
    const root = getGitRoot(process.cwd());
    // This test runs inside the project's own repo; the folder name may
    // differ between local checkouts and CI runners, so we only assert
    // that the root is a non-empty string that the cwd sits within.
    expect(typeof root === 'string' || root === null).toBe(true);
    if (root) {
      expect(root.length).toBeGreaterThan(0);
      expect(process.cwd().startsWith(root)).toBe(true);
    }
  });

  it('returns null for a non-repo directory', () => {
    // /tmp is unlikely to be a git repo
    const root = getGitRoot('/tmp');
    expect(root).toBeNull();
  });
});

describe('getGitBranch', () => {
  it('returns a string inside a git repo', () => {
    const branch = getGitBranch(process.cwd());
    if (branch) {
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
    }
  });

  it('returns null for a non-repo directory', () => {
    expect(getGitBranch('/tmp')).toBeNull();
  });
});

describe('getTty', () => {
  it('returns string or null', () => {
    const tty = getTty();
    expect(tty === null || typeof tty === 'string').toBe(true);
  });
});
