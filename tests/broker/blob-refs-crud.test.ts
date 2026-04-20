// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../../src/broker/database.js';
import {
  addBlobRef,
  countBlobRefs,
  releaseBlobRefsForProject,
  releaseBlobRefsForMessage,
  getAllBlobRefCounts,
} from '../../src/broker/blob-refs.js';

describe('blob_refs crud', () => {
  beforeEach(() => initDatabase(':memory:'));

  it('addBlobRef + countBlobRefs', () => {
    addBlobRef('abc', 'proj-1', 42);
    addBlobRef('abc', 'proj-1', 43);
    addBlobRef('def', 'proj-1', 44);
    expect(countBlobRefs('abc')).toBe(2);
    expect(countBlobRefs('def')).toBe(1);
    expect(countBlobRefs('xxx')).toBe(0);
  });

  it('releaseBlobRefsForProject removes all project rows and returns orphan hashes', () => {
    addBlobRef('abc', 'proj-1', 1);
    addBlobRef('abc', 'proj-2', 2);
    addBlobRef('def', 'proj-1', 3);
    const orphans = releaseBlobRefsForProject('proj-1');
    expect(orphans).toEqual(['def']); // abc still referenced by proj-2
    expect(countBlobRefs('abc')).toBe(1);
    expect(countBlobRefs('def')).toBe(0);
  });

  it('releaseBlobRefsForMessage returns orphan hashes', () => {
    addBlobRef('abc', 'proj-1', 1);
    addBlobRef('abc', 'proj-1', 2);
    const orphans = releaseBlobRefsForMessage(1);
    expect(orphans).toEqual([]); // still referenced by message 2
    const orphans2 = releaseBlobRefsForMessage(2);
    expect(orphans2).toEqual(['abc']);
  });

  it('getAllBlobRefCounts groups rows per blob_hash', () => {
    addBlobRef('abc', 'proj-1', 1);
    addBlobRef('abc', 'proj-2', 2);
    addBlobRef('def', 'proj-1', 3);
    const counts = getAllBlobRefCounts();
    expect(counts.get('abc')).toBe(2);
    expect(counts.get('def')).toBe(1);
    expect(counts.has('ghi')).toBe(false);
  });
});
