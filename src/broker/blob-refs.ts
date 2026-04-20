// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Reference counting for blob attachments. See the blob_refs schema in
// src/broker/database.ts. Each ref represents one usage of a blob by a
// specific (project, message). Releasing refs that bring a blob's count
// to zero returns the blob hash so the caller can delete the on-disk
// file (see src/broker/blobs.ts:deleteBlobFile).

import { getDb } from './database.js';

export function addBlobRef(
  blobHash: string,
  projectId: string,
  messageId: number | null,
): void {
  getDb().prepare(`
    INSERT INTO blob_refs (blob_hash, project_id, message_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(blobHash, projectId, messageId, new Date().toISOString());
}

export function countBlobRefs(blobHash: string): number {
  const row = getDb().prepare(
    'SELECT COUNT(*) AS n FROM blob_refs WHERE blob_hash = ?',
  ).get(blobHash) as { n: number };
  return row.n;
}

// Remove every blob_refs row owned by projectId. Returns the hashes
// whose ref count dropped to 0 — caller deletes those files from disk.
export function releaseBlobRefsForProject(projectId: string): string[] {
  const db = getDb();
  const candidates = db.prepare(
    'SELECT DISTINCT blob_hash FROM blob_refs WHERE project_id = ?',
  ).all(projectId) as Array<{ blob_hash: string }>;
  db.prepare('DELETE FROM blob_refs WHERE project_id = ?').run(projectId);
  const orphans: string[] = [];
  for (const c of candidates) {
    if (countBlobRefs(c.blob_hash) === 0) orphans.push(c.blob_hash);
  }
  return orphans;
}

/**
 * Release all blob refs owned by a specific message. Called during
 * project delete (per-message sweep) and — when a future version adds
 * handleDeleteMessage — from that handler too.
 */
export function releaseBlobRefsForMessage(messageId: number): string[] {
  const db = getDb();
  const candidates = db.prepare(
    'SELECT DISTINCT blob_hash FROM blob_refs WHERE message_id = ?',
  ).all(messageId) as Array<{ blob_hash: string }>;
  db.prepare('DELETE FROM blob_refs WHERE message_id = ?').run(messageId);
  const orphans: string[] = [];
  for (const c of candidates) {
    if (countBlobRefs(c.blob_hash) === 0) orphans.push(c.blob_hash);
  }
  return orphans;
}

/**
 * [H-2] — returns true iff at least one row in blob_refs links the blob
 * to the project. Used by the download ACL so a peer can only fetch
 * blobs that live inside its project.
 */
export function blobBelongsToProject(blobHash: string, projectId: string): boolean {
  const row = getDb().prepare(
    'SELECT 1 FROM blob_refs WHERE blob_hash = ? AND project_id = ? LIMIT 1',
  ).get(blobHash, projectId);
  return !!row;
}

export function listBlobHashesForProject(projectId: string): string[] {
  const rows = getDb().prepare(
    'SELECT DISTINCT blob_hash FROM blob_refs WHERE project_id = ?',
  ).all(projectId) as Array<{ blob_hash: string }>;
  return rows.map(r => r.blob_hash);
}

// Aggregate ref count per blob hash. Used by the dev /api/blobs/_stats
// endpoint to compute orphan_count without N+1 queries.
export function getAllBlobRefCounts(): Map<string, number> {
  const rows = getDb().prepare(
    'SELECT blob_hash, COUNT(*) AS n FROM blob_refs GROUP BY blob_hash',
  ).all() as Array<{ blob_hash: string; n: number }>;
  return new Map(rows.map(r => [r.blob_hash, r.n]));
}
