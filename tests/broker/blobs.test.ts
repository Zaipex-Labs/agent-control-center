// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  setBlobsRoot,
  storeBlob,
  getBlob,
  blobPath,
  MAX_BLOB_SIZE,
} from '../../src/broker/blobs.js';

describe('blobs storage', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'acc-blobs-'));
    setBlobsRoot(join(home, 'blobs'));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    setBlobsRoot(null);
  });

  it('storeBlob writes file and returns sha256 hash', () => {
    const buf = Buffer.from('hello world');
    const r = storeBlob(buf, 'text/plain', 'greet.txt');
    expect(r.hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
    expect(r.size).toBe(11);
    expect(r.mime).toBe('text/plain');
    expect(existsSync(join(home, 'blobs', `${r.hash}.txt`))).toBe(true);
    expect(readFileSync(join(home, 'blobs', `${r.hash}.txt`)).toString()).toBe('hello world');
  });

  it('storeBlob is idempotent — same content returns same hash and does not rewrite', () => {
    const buf = Buffer.from('dedup test');
    const a = storeBlob(buf, 'text/plain', 'a.txt');
    const b = storeBlob(buf, 'text/plain', 'b.txt');
    expect(a.hash).toBe(b.hash);
  });

  it('storeBlob rejects over MAX_BLOB_SIZE', () => {
    const huge = Buffer.alloc(MAX_BLOB_SIZE + 1, 0);
    expect(() => storeBlob(huge, 'application/octet-stream', 'x.bin')).toThrow(/too large/i);
  });

  it('getBlob returns buffer + mime for known hash', () => {
    const r = storeBlob(Buffer.from('abc'), 'text/plain', 'a.txt');
    const got = getBlob(r.hash);
    expect(got?.buffer.toString()).toBe('abc');
    expect(got?.mime).toBe('text/plain');
  });

  it('getBlob returns null for unknown hash', () => {
    expect(getBlob('0'.repeat(64))).toBeNull();
  });

  it('MAX_BLOB_SIZE defaults to 100 MB', () => {
    expect(MAX_BLOB_SIZE).toBe(100 * 1024 * 1024);
  });

  it('blobPath returns absolute path inside the configured root', () => {
    const p = blobPath('abc123', 'png');
    expect(p).toBe(join(home, 'blobs', 'abc123.png'));
  });
});
