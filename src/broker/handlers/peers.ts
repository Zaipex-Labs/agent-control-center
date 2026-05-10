// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Peer-lifecycle handlers: register, heartbeat, unregister, set-summary,
// set-role, list-peers, csrf-issue (token issuance bound to a peer).
// Also handleHealth lives here because the count it returns is over peers.

import type { ServerResponse } from 'node:http';
import { generateId, getDefaultName } from '../../shared/utils.js';
import { ARCHITECT_ROLE } from '../../shared/names.js';
import { broadcast } from '../websocket.js';
import { issueToken as issueCsrfToken } from '../csrf-tokens.js';
import type {
  RegisterRequest,
  HeartbeatRequest,
  UnregisterRequest,
  SetSummaryRequest,
  SetRoleRequest,
  ListPeersRequest,
  Peer,
} from '../../shared/types.js';
import {
  insertPeer,
  updateLastSeen,
  updateSummary,
  updateRole,
  deletePeer,
  selectPeerById,
  selectPeersByProject,
  selectAllPeers,
  selectPeersByCwd,
  selectPeersByGitRoot,
  countPeers,
  countPendingMessages,
} from '../database.js';
import { json, error, validateIdentifiers } from './_helpers.js';

// ── Health ─────────────────────────────────────────────────────

export function handleHealth(res: ServerResponse): void {
  json(res, {
    status: 'ok',
    peers: countPeers(),
    pending_messages: countPendingMessages(),
  });
}

// ── Peer registration & lifecycle ─────────────────────────────

export function handleRegister(body: unknown, res: ServerResponse): void {
  const b = body as RegisterRequest;
  if (!b.project_id || !b.cwd || b.pid == null) {
    return error(res, 'Missing required fields: project_id, cwd, pid');
  }

  if (!validateIdentifiers(res,
    { name: 'project_id', value: b.project_id },
    { name: 'role', value: b.role },
  )) return;

  const now = new Date().toISOString();
  const id = generateId();
  const role = b.role ?? '';
  const name = b.name || getDefaultName(role);
  const peer: Peer = {
    id,
    project_id: b.project_id,
    pid: b.pid,
    name,
    role,
    agent_type: b.agent_type ?? 'claude-code',
    cwd: b.cwd,
    git_root: b.git_root ?? null,
    git_branch: b.git_branch ?? null,
    tty: b.tty ?? null,
    summary: b.summary ?? '',
    registered_at: now,
    last_seen: now,
  };

  // BUG 2 fix: Remove stale dashboard peers for this project before inserting a new one
  if (peer.agent_type === 'dashboard') {
    const existing = selectPeersByProject(peer.project_id);
    for (const p of existing) {
      if (p.agent_type === 'dashboard') {
        deletePeer(p.id);
        console.error(`[broker:register] removed stale dashboard peer id=${p.id}`);
      }
    }
  }

  insertPeer(peer);
  broadcast('peer:connected', peer, peer.project_id);
  console.error(`[broker:register] id=${id} name=${name} role=${role} project=${peer.project_id} pid=${peer.pid}`);
  json(res, { id, name });
}

export function handleHeartbeat(body: unknown, res: ServerResponse): void {
  const b = body as HeartbeatRequest;
  if (!b.id) return error(res, 'Missing required field: id');

  const peer = selectPeerById(b.id);
  if (!peer) return error(res, `Peer not found: ${b.id}`, 404);

  updateLastSeen(b.id, new Date().toISOString());
  json(res, { ok: true });
}

export function handleUnregister(body: unknown, res: ServerResponse): void {
  const b = body as UnregisterRequest;
  if (!b.id) return error(res, 'Missing required field: id');

  const peer = selectPeerById(b.id);
  deletePeer(b.id);
  broadcast('peer:disconnected', { id: b.id }, peer?.project_id);
  json(res, { ok: true });
}

export function handleSetSummary(body: unknown, res: ServerResponse): void {
  const b = body as SetSummaryRequest;
  if (!b.id || b.summary == null) return error(res, 'Missing required fields: id, summary');

  const peer = selectPeerById(b.id);
  if (!peer) return error(res, `Peer not found: ${b.id}`, 404);

  updateSummary(b.id, b.summary);
  json(res, { ok: true });
}

// One-shot CSRF token for /ws/terminal/<role> [F-3]. Closes the residual
// S-NEW-2 cross-port caveat: the Origin gate alone admits a malicious
// dev server on http://127.0.0.1:<other-port> because its Origin matches
// the localhost regex. Requiring a token bound to (project, role) and
// keyed off a registered peer_id stops cross-port attackers, who cannot
// read the dashboard's localStorage and therefore have no peer_id to
// trade for a token.
export function handleCsrfIssue(body: unknown, res: ServerResponse): void {
  const b = body as { peer_id?: string; project_id?: string; role?: string };
  if (!b.peer_id || !b.project_id || !b.role) {
    return error(res, 'Missing required fields: peer_id, project_id, role');
  }
  if (!validateIdentifiers(res, { name: 'role', value: b.role })) return;

  // Membership check: the requester must be a peer registered in this
  // project. A cross-port attacker has no way to manufacture a peer_id
  // because /api/register requires the same Origin gate AND the
  // dashboard's persisted peer_id lives in its own origin's localStorage.
  const peer = selectPeerById(b.peer_id);
  if (!peer || peer.project_id !== b.project_id) {
    return error(res, 'Forbidden', 403);
  }

  // Defense-in-depth: only emit a token if the target role actually
  // exists as a live agent in this project. This avoids handing out
  // tokens for ghost roles and keeps the failure mode aligned with the
  // 503 already returned by handleTerminalUpgrade.
  const peers = selectPeersByProject(b.project_id);
  const target = peers.find(p => p.role === b.role && p.agent_type !== 'dashboard');
  if (!target) {
    return error(res, 'No agent found for role', 404);
  }

  const token = issueCsrfToken(b.project_id, b.role);
  json(res, { ok: true, token });
}

export function handleSetRole(body: unknown, res: ServerResponse): void {
  const b = body as SetRoleRequest;
  if (!b.id || b.role == null) return error(res, 'Missing required fields: id, role');

  // [QW-3 / S-NEW-4 / M-5 v0.2.1 / L-5 v0.2.1] — handleSetRole used to
  // accept any string. A peer that registered as 'qa' could call
  // /api/set-role with role='arquitectura' and start receiving every
  // send_to_role('arquitectura', …) intended for the tech lead, or
  // emit shell metachars / path-traversal that would later be
  // interpolated into prompts and shell templates.
  //
  // Defense:
  //   1. assertSafeIdentifier: same rules as register/add-agent
  //      (no shell metachars, no traversal, no NUL, ≤64 chars).
  //   2. ARCHITECT_ROLE is reserved — it gets seeded by
  //      migrateLegacyProjects / handleCreateProject and the dashboard
  //      treats it as the permanent tech lead. A non-architect peer
  //      cannot self-promote into it.
  if (!validateIdentifiers(res, { name: 'role', value: b.role })) return;
  if (b.role === ARCHITECT_ROLE) {
    return error(res, `Role "${ARCHITECT_ROLE}" is reserved`, 403);
  }

  const peer = selectPeerById(b.id);
  if (!peer) return error(res, `Peer not found: ${b.id}`, 404);

  updateRole(b.id, b.role);
  json(res, { ok: true });
}

export function handleListPeers(body: unknown, res: ServerResponse): void {
  const b = body as ListPeersRequest;
  const scope = b.scope ?? 'project';

  if (!b.project_id && scope !== 'machine') {
    return error(res, 'Missing required field: project_id');
  }

  let peers: Peer[];

  switch (scope) {
    case 'machine':
      peers = selectAllPeers();
      break;
    case 'directory':
      peers = b.cwd ? selectPeersByCwd(b.project_id, b.cwd) : selectPeersByProject(b.project_id);
      break;
    case 'repo':
      peers = b.git_root ? selectPeersByGitRoot(b.project_id, b.git_root) : selectPeersByProject(b.project_id);
      break;
    case 'project':
    default:
      peers = selectPeersByProject(b.project_id);
      break;
  }

  if (b.role) {
    peers = peers.filter(p => p.role === b.role);
  }
  if (b.exclude_id) {
    peers = peers.filter(p => p.id !== b.exclude_id);
  }

  // Hide dashboard peers from agents — they're not real team members
  peers = peers.filter(p => p.agent_type !== 'dashboard');

  // Liveness check in real time — without this, a page reload sees the
  // stale rows still in the DB (cleanStalePeers only runs every 30s) and
  // reports zombie peers as online. process.kill(pid, 0) is a cheap
  // syscall that throws if the process is dead.
  const deadIds: string[] = [];
  peers = peers.filter(p => {
    try {
      process.kill(p.pid, 0);
      return true;
    } catch {
      deadIds.push(p.id);
      return false;
    }
  });
  // Fire-and-forget eviction so the DB catches up for future callers.
  for (const id of deadIds) {
    try { deletePeer(id); } catch { /* ignore */ }
  }

  json(res, peers);
}
