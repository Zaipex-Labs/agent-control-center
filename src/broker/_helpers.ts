// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Shared cross-handler helpers. Today this is just project-membership
// gating used by every endpoint that takes a `project_id` from the body
// AND a peer-scoped identifier — see [S-NEW-3] in
// docs/audits/v0.2.2-comprehensive-audit.md.
//
// The original H-1 fix wired the same check into handleSendMessage /
// handleSendToRole. Lifting it into a single function lets every other
// handler (shared/* , get-history, threads/*, save-resume,
// list-modified-files) reject the same cross-project bypass without
// each callsite reinventing the response shape.

import type { ServerResponse } from 'node:http';
import { selectPeerById } from './database.js';

// Returns true when the peer is a member of the given project. On
// failure writes a 403 PROJECT_MISMATCH response (or 404 PEER_NOT_FOUND
// if the peer_id is unknown / 400 MISSING_PEER_ID if the caller didn't
// pass one) and returns false. Callers MUST short-circuit on false.
//
// Identical wire shape to the H-1 messaging check so dashboard /
// MCP retries observe one error code per cross-project bypass.
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
