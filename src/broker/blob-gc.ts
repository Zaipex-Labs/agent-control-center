// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { listBlobFilesOnDisk, deleteBlobFile } from './blobs.js';
import { countBlobRefs } from './blob-refs.js';

// 1 hour grace: protects blobs that were uploaded by the dashboard but
// whose send-message call hasn't yet attached them to a message (and
// therefore hasn't inserted the blob_ref row). Without this, a broker
// restart between upload and send would delete the fresh blob.
const GRACE_MS = 60 * 60 * 1000;

// Keep blobs referenced by at least one row in blob_refs OR recently
// created (mtime within GRACE_MS). Everything else is garbage.
// Called once at broker startup.
export function gcOrphanBlobs(now: number = Date.now()): number {
  let removed = 0;
  for (const { hash, mtimeMs } of listBlobFilesOnDisk()) {
    if (now - mtimeMs < GRACE_MS) continue;
    if (countBlobRefs(hash) > 0) continue;
    if (deleteBlobFile(hash)) removed++;
  }
  return removed;
}
