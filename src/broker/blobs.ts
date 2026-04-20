// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

/**
 * Blob storage for multimodal message attachments.
 *
 * - Files live at ~/.zaipex-acc/blobs/<sha256>.<ext>
 * - Content-addressed: same bytes ⇒ same file, stored once.
 * - Reference counting via blob_refs table (see blob-refs.ts):
 *   one row per (blob, project, message). Delete project ⇒ release refs;
 *   orphan files (ref count 0) are deleted immediately.
 * - Startup GC (blob-gc.ts) sweeps any blob on disk with zero refs AND
 *   whose mtime is older than a 1h grace period (protects fresh uploads
 *   whose send-message call hasn't landed yet).
 * - Max size: 100 MB per file by default, overridable via
 *   ACC_MAX_BLOB_SIZE env var (bytes).
 * - Tests override the storage root with setBlobsRoot(path) / null.
 */

import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
  readdirSync, statSync, unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { BLOBS_DIR } from '../shared/config.js';
import { extensionFromMime } from '../shared/attachments.js';

// 100 MB default, overridable via ACC_MAX_BLOB_SIZE env var (bytes).
// Read once at module load — integration tests set the env var before
// dynamically importing this module.
const DEFAULT_MAX = 100 * 1024 * 1024;
export const MAX_BLOB_SIZE = (() => {
  const env = process.env['ACC_MAX_BLOB_SIZE'];
  const n = env ? parseInt(env, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX;
})();

// Explicit root override for tests. Null means "use BLOBS_DIR from config".
// Pattern mirrors initDatabase(':memory:') — tests call setBlobsRoot(path)
// in beforeEach and setBlobsRoot(null) in afterEach.
let blobsRootOverride: string | null = null;

export function setBlobsRoot(path: string | null): void {
  blobsRootOverride = path;
}

function blobsDir(): string {
  return blobsRootOverride ?? BLOBS_DIR;
}

export interface StoredBlob {
  hash: string;
  mime: string;
  name: string;
  size: number;
}

export function blobPath(hash: string, ext: string): string {
  return join(blobsDir(), `${hash}.${ext}`);
}

export function storeBlob(buffer: Buffer, mime: string, name: string): StoredBlob {
  if (buffer.length > MAX_BLOB_SIZE) {
    throw new Error(`Blob too large: ${buffer.length} bytes (max ${MAX_BLOB_SIZE})`);
  }
  mkdirSync(blobsDir(), { recursive: true });
  const hash = createHash('sha256').update(buffer).digest('hex');
  const ext = extensionFromMime(mime);
  const path = blobPath(hash, ext);
  if (!existsSync(path)) {
    writeFileSync(path, buffer);
  }
  return { hash, mime, name, size: buffer.length };
}

export function getBlob(hash: string): { buffer: Buffer; mime: string } | null {
  const dir = blobsDir();
  if (!existsSync(dir)) return null;
  let match: string | undefined;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(hash + '.')) { match = entry; break; }
  }
  if (!match) return null;
  const ext = match.slice(hash.length + 1);
  const buffer = readFileSync(join(dir, match));
  const mime = mimeFromExt(ext);
  return { buffer, mime };
}

export function deleteBlobFile(hash: string): boolean {
  const dir = blobsDir();
  if (!existsSync(dir)) return false;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(hash + '.')) {
      unlinkSync(join(dir, entry));
      return true;
    }
  }
  return false;
}

export function listBlobFilesOnDisk(): Array<{
  hash: string;
  ext: string;
  mtimeMs: number;
  sizeBytes: number;
}> {
  const dir = blobsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.includes('.'))
    .map(f => {
      const dot = f.indexOf('.');
      const hash = f.slice(0, dot);
      const ext = f.slice(dot + 1);
      const st = statSync(join(dir, f));
      return { hash, ext, mtimeMs: st.mtimeMs, sizeBytes: st.size };
    });
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', zip: 'application/zip',
  json: 'application/json', txt: 'text/plain',
  csv: 'text/csv', md: 'text/markdown',
  bin: 'application/octet-stream',
};

function mimeFromExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}
