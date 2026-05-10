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
  getSharedState,
  listSharedKeys,
  deleteSharedState,
} from '../database.js';
import type {
  SharedSetRequest,
  SharedGetRequest,
  SharedListRequest,
  SharedDeleteRequest,
} from '../../shared/types.js';
import { json, error, assertProjectMembership } from './_helpers.js';

export function handleSharedSet(body: unknown, res: ServerResponse): void {
  const b = body as SharedSetRequest;
  if (!b.project_id || !b.namespace || !b.key || b.value == null || !b.peer_id) {
    return error(res, 'Missing required fields: project_id, namespace, key, value, peer_id');
  }
  // [S-NEW-3] peer_id was already required (used as updated_by) but
  // we never checked it actually belonged to project_id. A peer in A
  // could overwrite a config key in B otherwise.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  setSharedState(b.project_id, b.namespace, b.key, b.value, b.peer_id, new Date().toISOString());
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

  json(res, { value: entry.value, updated_by: entry.updated_by, updated_at: entry.updated_at });
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
