// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setBlobsRoot, storeBlob } from '../../src/broker/blobs.js';
import { initDatabase } from '../../src/broker/database.js';
import { addBlobRef } from '../../src/broker/blob-refs.js';
import { gcOrphanBlobs } from '../../src/broker/blob-gc.js';

describe('gcOrphanBlobs', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'acc-gc-'));
    setBlobsRoot(join(home, 'blobs'));
    initDatabase(':memory:');
  });
  afterEach(() => {
    setBlobsRoot(null);
    rmSync(home, { recursive: true, force: true });
  });

  it('removes blobs on disk with zero refs AND mtime past grace period', () => {
    const stored = storeBlob(Buffer.from('orphan'), 'text/plain', 'o.txt');
    // Age the file past the 1h grace window.
    const past = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    utimesSync(join(home, 'blobs', `${stored.hash}.txt`), past, past);

    const removed = gcOrphanBlobs();
    expect(removed).toBe(1);
    expect(readdirSync(join(home, 'blobs'))).toHaveLength(0);
  });

  it('keeps blobs with at least one ref', () => {
    const stored = storeBlob(Buffer.from('kept'), 'text/plain', 'k.txt');
    addBlobRef(stored.hash, 'some-proj', 0);
    const removed = gcOrphanBlobs();
    expect(removed).toBe(0);
    expect(readdirSync(join(home, 'blobs'))).toHaveLength(1);
  });

  it('keeps orphan blobs inside the grace period (recently uploaded)', () => {
    // Simulates a race: blob just uploaded, ref not yet inserted because
    // the send-message call hasn't happened. GC must not nuke it.
    storeBlob(Buffer.from('recent orphan'), 'text/plain', 'r.txt');
    const removed = gcOrphanBlobs();
    expect(removed).toBe(0);
    expect(readdirSync(join(home, 'blobs'))).toHaveLength(1);
  });
});
