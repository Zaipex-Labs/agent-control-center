// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Cross-handler helpers shared by every file in this directory. Lives
// inside `handlers/` (not in the parent broker dir) because everything
// here is HTTP-handler-specific: response writers, body parsing,
// per-route input validation, project-membership gating.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertSafeIdentifier } from '../../shared/validate.js';
import { selectPeerById } from '../database.js';

export function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { ok: false, error: message }, status);
}

// [P-11] Default body cap. Used when a route doesn't have a specific
// override in src/broker/index.ts:ROUTE_BODY_LIMITS. 1 MB is the right
// size for /api/shared/set (configs / large attachments metadata) but
// is 1000× too large for /api/heartbeat (a 24-byte JSON object). The
// per-route map shrinks the default for the chatty short-payload
// endpoints.
export const DEFAULT_MAX_BODY_SIZE = 1024 * 1024; // 1 MB

// Thrown by parseBody when a request body exceeds the per-route cap.
// The HTTP dispatcher catches this and replies 413.
export class BodyTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`Request body too large (> ${limit} bytes)`);
    this.name = 'BodyTooLargeError';
    this.limit = limit;
  }
}

export function parseBody(req: IncomingMessage, maxSize: number = DEFAULT_MAX_BODY_SIZE): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    let settled = false;
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        // Don't destroy() the socket — the caller still needs to write
        // the 413 response. Stop buffering and reject; ws/HTTP cleanup
        // closes the connection for us when the response is sent.
        settled = true;
        reject(new BodyTooLargeError(maxSize));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', err => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

// Raw-body helper for binary uploads (image/* blobs, files). Unlike
// parseBody it does NOT assume JSON — returns the concatenated Buffer
// so callers can compute a hash, persist, decode, etc. Caller is
// responsible for honouring their own max-size cap.
export function parseRawBody(req: IncomingMessage, maxSize: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on('data', (c: Buffer) => {
      if (settled) return;
      total += c.length;
      if (total > maxSize) {
        settled = true;
        // Don't destroy the socket — the caller still needs to write a
        // 413 response. Stop buffering chunks and reject; the handler
        // will close the connection cleanly.
        reject(new Error(`Request body too large (> ${maxSize} bytes)`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', err => { if (!settled) { settled = true; reject(err); } });
  });
}

// ── Input validation ──────────────────────────────────────────

export const MAX_TEXT_LENGTH = 100_000; // 100KB per message text

// [S-NEW-6] cap attachments[] per send-message / send-to-role call.
// A 1MB request body fits ~5,000 descriptors (each is a hash + mime +
// name + size — under 200 bytes). Without a tope every getBlob() does a
// readdirSync (L-2), every addBlobRef does an INSERT, and a single
// malicious request can hold the event loop for hundreds of ms while
// the dashboard renders nothing useful. 32 is comfortably above the
// real-world ceiling (deepest cluster I've seen is 8 PNGs in one
// review thread).
export const MAX_ATTACHMENTS_PER_MESSAGE = 32;

// Back-compat wrapper around assertSafeIdentifier (src/shared/validate.ts).
// Preserves the res-based callsite API so handlers can stay
// `if (!validateIdentifiers(res, …)) return;`. Underlying rules
// (path traversal, shell metachars, null bytes, 64-char cap) live in
// the shared helper so CLI / tests / future runtimes use the same check.
// Empty / missing values are skipped here — callers enforce presence.
export function validateIdentifiers(
  res: ServerResponse,
  ...values: Array<{ name: string; value: unknown }>
): boolean {
  for (const { name, value } of values) {
    if (typeof value !== 'string' || value.length === 0) continue;
    try {
      assertSafeIdentifier(name, value);
    } catch (e) {
      error(res, e instanceof Error ? e.message : String(e));
      return false;
    }
  }
  return true;
}

// ── Cross-project membership gating ──────────────────────────

// Returns true when the peer is a member of the given project. On
// failure writes a 403 PROJECT_MISMATCH response (or 404 PEER_NOT_FOUND
// if the peer_id is unknown / 400 MISSING_PEER_ID if the caller didn't
// pass one) and returns false. Callers MUST short-circuit on false.
//
// [S-NEW-3] The original H-1 fix wired the same check into
// handleSendMessage / handleSendToRole. Lifting it into a single
// function lets every other handler (shared/*, get-history, threads/*,
// save-resume, list-modified-files) reject the same cross-project
// bypass without each callsite reinventing the response shape.
export function assertProjectMembership(
  peerId: string | undefined,
  projectId: string,
  res: ServerResponse,
): boolean {
  if (!peerId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Missing required field: peer_id',
      code: 'MISSING_PEER_ID',
    }));
    return false;
  }

  const peer = selectPeerById(peerId);
  if (!peer) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: `Peer not found: ${peerId}`,
      code: 'PEER_NOT_FOUND',
    }));
    return false;
  }

  if (peer.project_id !== projectId) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Peer does not belong to the requested project',
      code: 'PROJECT_MISMATCH',
    }));
    return false;
  }

  return true;
}
