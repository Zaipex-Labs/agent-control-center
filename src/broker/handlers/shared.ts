// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Shared-state handlers: set / get / list / delete keyed by
// (project_id, namespace, key). Cross-project membership is gated by
// assertProjectMembership (S-NEW-3) on every endpoint.

import type { ServerResponse } from 'node:http';
import { broadcast } from '../websocket.js';
import {
  setSharedState,
  setSharedStateWithMeta,
  getSharedState,
  listSharedKeys,
  deleteSharedState,
  selectPeerById,
  searchDecisions,
} from '../database.js';
import type {
  SharedSetRequest,
  SharedGetRequest,
  SharedListRequest,
  SharedDeleteRequest,
} from '../../shared/types.js';
import { json, error, assertProjectMembership } from './_helpers.js';

// FASE A-1 (v0.3.0): the `decisions` namespace is reserved for Team
// Memory. Writes to it auto-record author_role / author_peer_id /
// created_at via setSharedStateWithMeta. Reads work like any other
// namespace.
export const DECISIONS_NAMESPACE = 'decisions';

export function handleSharedSet(body: unknown, res: ServerResponse): void {
  const b = body as SharedSetRequest;
  if (!b.project_id || !b.namespace || !b.key || b.value == null || !b.peer_id) {
    return error(res, 'Missing required fields: project_id, namespace, key, value, peer_id');
  }
  // [S-NEW-3] peer_id was already required (used as updated_by) but
  // we never checked it actually belonged to project_id. A peer in A
  // could overwrite a config key in B otherwise.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const now = new Date().toISOString();

  if (b.namespace === DECISIONS_NAMESPACE) {
    // Write-through: stamp the author from the registered peer. If the
    // row already exists, setSharedStateWithMeta preserves the original
    // author_* / created_at — only updated_by / updated_at get bumped.
    const peer = selectPeerById(b.peer_id);
    setSharedStateWithMeta(
      b.project_id, b.namespace, b.key, b.value, b.peer_id, now,
      { author_role: peer?.role ?? '', author_peer_id: b.peer_id },
    );
  } else {
    setSharedState(b.project_id, b.namespace, b.key, b.value, b.peer_id, now);
  }

  broadcast('shared:updated', { namespace: b.namespace, key: b.key }, b.project_id);
  json(res, { ok: true });
}

export function handleSharedGet(body: unknown, res: ServerResponse): void {
  const b = body as SharedGetRequest & { peer_id?: string };
  if (!b.project_id || !b.namespace || !b.key) {
    return error(res, 'Missing required fields: project_id, namespace, key');
  }
  // [S-NEW-3] shared/get exposes secrets stored as values (db credentials,
  // contract specs). Without membership the read is open to any peer.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const entry = getSharedState(b.project_id, b.namespace, b.key);
  if (!entry) return json(res, { error: 'not found' }, 404);

  // FASE A-1 (v0.3.0): include author_role / author_peer_id /
  // created_at when the row was written through the decisions
  // write-through path. They stay null for every other namespace, so
  // omit them entirely in that case to keep the response shape stable.
  const out: Record<string, unknown> = {
    value: entry.value,
    updated_by: entry.updated_by,
    updated_at: entry.updated_at,
  };
  if (entry.author_role) out.author_role = entry.author_role;
  if (entry.author_peer_id) out.author_peer_id = entry.author_peer_id;
  if (entry.created_at) out.created_at = entry.created_at;
  json(res, out);
}

export function handleSharedList(body: unknown, res: ServerResponse): void {
  const b = body as SharedListRequest & { peer_id?: string };
  if (!b.project_id || !b.namespace) {
    return error(res, 'Missing required fields: project_id, namespace');
  }
  // [S-NEW-3] enumerating keys leaks the namespace's structure even if
  // values stay opaque — gate with the same membership check.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  json(res, { keys: listSharedKeys(b.project_id, b.namespace) });
}

// FASE A-2 (v0.3.0): recall over the reserved `decisions` namespace.
// Project-scoped via assertProjectMembership (same gate as the rest of
// shared/*). Limit defaults to 5, capped at 20 — recall is meant to
// surface a handful of relevant items, not a full-text search engine.
export const RECALL_DEFAULT_LIMIT = 5;
export const RECALL_MAX_LIMIT = 20;

export function handleDecisionsRecall(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string; peer_id?: string; query?: string; limit?: number };
  if (!b.project_id || !b.peer_id || !b.query) {
    return error(res, 'Missing required fields: project_id, peer_id, query');
  }
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const requested = typeof b.limit === 'number' && b.limit > 0 ? b.limit : RECALL_DEFAULT_LIMIT;
  const limit = Math.min(requested, RECALL_MAX_LIMIT);

  // Trim and bound the query — empty or single-char queries would
  // match nearly every row, which defeats the purpose. The handler
  // pretends nothing matched in that case.
  const query = b.query.trim();
  if (query.length < 2) {
    return json(res, { matches: [] });
  }

  const matches = searchDecisions(b.project_id, DECISIONS_NAMESPACE, query, limit);
  json(res, { matches });
}

export function handleSharedDelete(body: unknown, res: ServerResponse): void {
  const b = body as SharedDeleteRequest;
  if (!b.project_id || !b.namespace || !b.key || !b.peer_id) {
    return error(res, 'Missing required fields: project_id, namespace, key, peer_id');
  }
  // [S-NEW-3] a destructive op even more obviously needs membership.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  deleteSharedState(b.project_id, b.namespace, b.key);
  json(res, { ok: true });
}
