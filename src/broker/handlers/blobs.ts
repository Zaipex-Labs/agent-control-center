// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Blob upload / download / stats handlers. Blobs are content-addressed
// binary attachments (images, files) stored under
// ~/.zaipex-acc/blobs/<sha256>. The download path is peer-scoped (H-2)
// — a peer can only fetch blobs referenced by some message in its
// project.

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  storeBlob,
  getBlob,
  listBlobFilesOnDisk,
  MAX_BLOB_SIZE,
} from '../blobs.js';
import { getAllBlobRefCounts, blobBelongsToProject } from '../blob-refs.js';
import { selectPeerById } from '../database.js';
import { json, error, errorResponse, parseRawBody } from './_helpers.js';

export async function handleUploadBlob(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const mime = (req.headers['content-type'] ?? '').split(';')[0].trim();
  // Filenames can contain UTF-8 (accents, spaces). HTTP header values
  // must be US-ASCII, so the client sends encodeURIComponent(name).
  const rawName = String(req.headers['x-filename'] ?? '');
  let name: string;
  try {
    name = decodeURIComponent(rawName).slice(0, 255);
  } catch {
    return error(res, 'Malformed X-Filename header', 400);
  }
  if (!mime) return error(res, 'Missing Content-Type header');
  if (!name) return error(res, 'Missing X-Filename header');
  try {
    const buf = await parseRawBody(req, MAX_BLOB_SIZE);
    const stored = storeBlob(buf, mime, name);
    json(res, stored);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/too large/i.test(msg)) {
      return errorResponse(res, 413, 'BLOB_TOO_LARGE', msg);
    }
    error(res, msg, 400);
  }
}

export function handleDownloadBlob(req: IncomingMessage, hash: string, res: ServerResponse): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) return error(res, 'Invalid hash', 400);

  // [H-2] — peer-scoped ACL. Before this, the route was fully anonymous:
  // anyone who knew a sha256 could download the blob. Now we require an
  // X-Peer-Id header, resolve the peer, and only serve the blob if some
  // message in the peer's project references it (blob_refs row).
  const peerId = String(req.headers['x-peer-id'] ?? '').trim();
  if (!peerId) {
    return errorResponse(res, 401, 'MISSING_PEER_ID', 'Missing X-Peer-Id header');
  }

  const peer = selectPeerById(peerId);
  if (!peer) {
    return errorResponse(res, 401, 'UNKNOWN_PEER', 'Unknown peer');
  }

  // ACL runs before getBlob so unknown hashes return 403 (same as
  // "hash exists but not yours") — prevents enumeration of the blob
  // store by brute-forcing sha256 values.
  if (!blobBelongsToProject(hash, peer.project_id)) {
    return errorResponse(
      res, 403, 'BLOB_ACCESS_DENIED',
      "Blob not accessible to this peer's project",
    );
  }

  const got = getBlob(hash);
  if (!got) {
    // Edge case: blob_refs row survived but the on-disk file is gone
    // (GC race, manual unlink, etc.). Return 404 so the dashboard can
    // retry — this is a bug state, not an ACL failure.
    return errorResponse(res, 404, 'BLOB_NOT_FOUND', 'Blob not found');
  }

  console.error('[broker] blob:download hash=%s peer=%s project=%s size=%d',
    hash, peerId, peer.project_id, got.buffer.length);
  res.writeHead(200, {
    'Content-Type': got.mime,
    'Content-Length': String(got.buffer.length),
    // private: peer-scoped resources must not be cached by intermediaries.
    'Cache-Control': 'private, max-age=31536000, immutable',
  });
  res.end(got.buffer);
}

// Dev-only stats endpoint for observability. Gated by NODE_ENV so it's
// not exposed in production packaged runs. Returns total blob count,
// total bytes, and how many are orphan (zero refs in blob_refs).
export function handleBlobStats(res: ServerResponse): void {
  if (process.env['NODE_ENV'] === 'production') {
    return error(res, 'Not available in production', 404);
  }
  const files = listBlobFilesOnDisk();
  const refs = getAllBlobRefCounts();
  const total_bytes = files.reduce((s, f) => s + f.sizeBytes, 0);
  const orphan_count = files.filter(f => (refs.get(f.hash) ?? 0) === 0).length;
  json(res, { total_blobs: files.length, total_bytes, orphan_count });
}
