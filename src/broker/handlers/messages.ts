// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Message-flow handlers: send-message, send-to-role, poll-messages,
// get-history. Pre-v0.2.5 the two send paths were 95% duplicates
// (Q-2 in the v0.2.2 audit). v0.2.5 lifts the shared steps —
// attachment validation, metadata serialization, thread inheritance,
// per-target write + log + blob_ref, tmux notify, broadcast — into
// a small set of helpers. Each handler now owns only the parts that
// actually differ: target resolution and the wire-shape of its
// response.

import type { ServerResponse } from 'node:http';
import { broadcast } from '../websocket.js';
import { tmuxNotify, tmuxInjectWithContext } from '../tmux.js';
import { getBlob } from '../blobs.js';
import { addBlobRef } from '../blob-refs.js';
import { serializeAttachments, type Attachment } from '../../shared/attachments.js';
import type {
  MessageType,
  Peer,
} from '../../shared/types.js';
import {
  getDb,
  selectPeerById,
  selectPeersByRole,
  insertMessage,
  selectUndelivered,
  consumeUndelivered,
  insertLogEntry,
  selectHistory,
  selectThreadById,
  selectLogByThread,
  touchThread,
} from '../database.js';
import {
  json,
  error,
  errorResponse,
  validateIdentifiers,
  assertProjectMembership,
  parseBodyOrError,
  MAX_TEXT_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from './_helpers.js';
import {
  sendMessageSchema,
  sendToRoleSchema,
  pollMessagesSchema,
  getHistorySchema,
} from './_schemas.js';

const MESSAGE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FIVE_MINUTES_MS = 5 * 60 * 1000;

// ── Shared helpers (Q-2 dedup) ────────────────────────────────

// Returns false and writes a 4xx response if attachment list is bad.
// The two send handlers used to inline this loop — keep it here so
// adding a new validation rule (e.g. per-mime cap) lands in one place.
function validateAttachments(incoming: Attachment[], res: ServerResponse): boolean {
  if (incoming.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    errorResponse(
      res, 400, 'TOO_MANY_ATTACHMENTS',
      `Too many attachments (max ${MAX_ATTACHMENTS_PER_MESSAGE} per message)`,
    );
    return false;
  }
  for (const att of incoming) {
    if (!getBlob(att.hash)) {
      errorResponse(
        res, 404, 'BLOB_NOT_FOUND',
        'Attachment blob not found on server',
        { extras: { hash: att.hash } },
      );
      return false;
    }
  }
  return true;
}

// FASE E-1 (v0.3.0): zod schemas accept metadata as `string | object`
// (mirroring set_shared.value via M-3). Normalize to the
// JSON-string shape buildMetadata expects.
function normalizeMetadata(meta: string | Record<string, unknown> | undefined): string | null {
  if (meta == null) return null;
  return typeof meta === 'string' ? meta : JSON.stringify(meta);
}

// Merge attachment descriptors into the existing JSON metadata so a
// `topic` (or any future metadata key) survives alongside them.
function buildMetadata(incoming: Attachment[], existingRaw: string | null | undefined): string | null {
  if (incoming.length === 0) return existingRaw ?? null;
  let existingObj: Record<string, unknown> = {};
  if (existingRaw) {
    try { existingObj = JSON.parse(existingRaw) as Record<string, unknown>; } catch { /* ignore */ }
  }
  return serializeAttachments(incoming, existingObj);
}

// Auto-inherit thread_id when the caller didn't supply one. First try
// the user's most recent message in the project, then fall back to the
// last message that was sent TO this peer (so an agent's reply lands
// in the same thread as the question that prompted it). Both windows
// are 5 minutes — older history is treated as a separate conversation.
function inheritThreadId(
  projectId: string,
  fromId: string,
  providedThreadId: string | null | undefined,
  contextLabel: string,
): string | null {
  if (providedThreadId) return providedThreadId;
  const recentHistory = selectHistory(projectId, { limit: 30 });
  const cutoff = Date.now() - FIVE_MINUTES_MS;
  const userMsg = recentHistory.find(m =>
    m.from_role === 'user' &&
    m.thread_id &&
    new Date(m.sent_at).getTime() > cutoff,
  );
  if (userMsg?.thread_id) {
    console.error(`[broker:${contextLabel}] inherited thread_id=${userMsg.thread_id} from user message`);
    return userMsg.thread_id;
  }
  const receivedMsg = recentHistory.find(m =>
    m.to_id === fromId &&
    m.thread_id &&
    new Date(m.sent_at).getTime() > cutoff,
  );
  if (receivedMsg?.thread_id) {
    console.error(`[broker:${contextLabel}] inherited thread_id=${receivedMsg.thread_id} from received message`);
    return receivedMsg.thread_id;
  }
  return null;
}

// Precompute the (thread name, last-10-messages summary) tuple once so
// per-target tmux injection doesn't redo the query on every iteration.
function loadThreadContext(
  projectId: string,
  threadId: string | null,
): { name: string; summary: string } | null {
  if (!threadId) return null;
  const thread = selectThreadById(projectId, threadId);
  if (!thread) return null;
  const entries = selectLogByThread(threadId, 10);
  const summary = entries.reverse().map(e => `${e.from_role || e.from_id}: ${e.text}`).join(' | ');
  return { name: thread.name, summary: summary || '(sin mensajes)' };
}

// Per-target write loop shared by both send paths. For each target:
//   1. Insert into messages (real per-recipient rows so polling works).
//   2. Insert into message_log (the audit/history table).
//   3. Register one blob_ref per attachment so cleanup can release the
//      bytes when this specific message is dropped.
// Then touch the thread's updated_at if a thread is in play.
//
// [P-17] All DB writes happen inside a single db.transaction(). Before
// this each insert/touch was its own implicit transaction, meaning a
// send-to-role broadcast to 3 peers with 2 attachments each used to
// fsync the WAL 7+ times. The transaction collapses that into one
// commit, and also gives us atomic rollback if any single statement
// throws (e.g. a peer row vanished between selectPeersByRole and
// insertMessage). Tmux notification is intentionally kept outside the
// transaction — it shells out via execFileSync (3s timeout) and would
// otherwise hold the WAL lock for the duration of the subprocess.
function writeMessagesToTargets(
  projectId: string,
  fromPeer: Peer,
  targets: Peer[],
  text: string,
  type: MessageType,
  metadata: string | null,
  threadId: string | null,
  incoming: Attachment[],
  now: string,
  threadContext: { name: string; summary: string } | null,
  contextLabel: string,
): void {
  getDb().transaction(() => {
    for (const target of targets) {
      if (contextLabel === 'send-to-role') {
        console.error(`[broker:send-to-role] inserting message: from=${fromPeer.id} to=${target.id} (${target.role})`);
      }
      const messageId = insertMessage(projectId, fromPeer.id, target.id, type, text, metadata, now, threadId);
      insertLogEntry(
        projectId, fromPeer.id, fromPeer.role, target.id, target.role,
        type, text, metadata, now, fromPeer.id, threadId,
      );
      for (const att of incoming) addBlobRef(att.hash, projectId, messageId);
    }
    if (threadId) touchThread(projectId, threadId);
  })();

  // Best-effort tmux notify — deduped per role so a 3-backend broadcast
  // only triggers one send-keys per pane. Runs after commit so a slow
  // tmux call can never hold the WAL lock.
  const injectedRoles = new Set<string>();
  for (const target of targets) {
    if (target.role && !injectedRoles.has(target.role)) {
      if (threadId && threadContext) {
        tmuxInjectWithContext(projectId, target.role, threadContext.name, threadContext.summary, fromPeer.name, fromPeer.role);
      } else {
        tmuxNotify(projectId, target.role, fromPeer.name, fromPeer.role);
      }
      injectedRoles.add(target.role);
    }
  }
}

// Final shared steps: fan out the `message:new` ws event and reply
// with `{ ok: true, ... }` shaped the way the caller wants. Caller
// passes the response shape so each handler keeps its own wire
// contract (`{ ok }` vs `{ ok, sent_to }`). The thread touch used to
// live here; it moved into the writeMessagesToTargets transaction so
// every per-message side-effect commits in one fsync (P-17).
function finalizeDelivery(
  projectId: string,
  fromPeer: Peer,
  toRole: string,
  text: string,
  type: MessageType,
  metadata: string | null,
  threadId: string | null,
  responseBody: Record<string, unknown>,
  res: ServerResponse,
): void {
  broadcast('message:new', {
    thread_id: threadId,
    from_name: fromPeer.name,
    from_role: fromPeer.role,
    to_role: toRole,
    text,
    type,
    metadata,
  }, projectId);
  json(res, responseBody);
}

// ── Handlers ──────────────────────────────────────────────────

export async function handleSendMessage(body: unknown, res: ServerResponse): Promise<void> {
  const b = parseBodyOrError(sendMessageSchema, body, res);
  if (!b) return;

  if (b.text.length > MAX_TEXT_LENGTH) {
    return error(res, `Message text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }

  const toPeer = selectPeerById(b.to_id);
  if (!toPeer) return error(res, `Peer not found: ${b.to_id}`, 404);

  const fromPeer = selectPeerById(b.from_id);
  if (!fromPeer) return error(res, `Peer not found: ${b.from_id}`, 404);

  // [H-1] — both peers must belong to the body's project_id. Without this,
  // a local attacker who knows a peer_id in project B could send messages
  // (with attachments) to that peer while claiming to be in project A.
  if (fromPeer.project_id !== b.project_id || toPeer.project_id !== b.project_id) {
    return errorResponse(
      res, 403, 'PROJECT_MISMATCH',
      'Peer does not belong to the requested project',
    );
  }

  const incoming = b.attachments ?? [];
  if (!validateAttachments(incoming, res)) return;

  const type: MessageType = (b.type ?? 'message') as MessageType;
  const now = new Date().toISOString();
  // M-3 (v0.2.4) parity: zod accepts metadata as string OR object;
  // serialize to string for buildMetadata which speaks JSON-string.
  const metadataStr = normalizeMetadata(b.metadata);
  const metadata = buildMetadata(incoming, metadataStr);
  const threadId = inheritThreadId(b.project_id, b.from_id, b.thread_id ?? null, 'send-message');

  console.error(`[broker:send-message] from=${b.from_id} (${fromPeer.role}) to=${b.to_id} (${toPeer.role}) thread=${threadId}`);

  const threadContext = loadThreadContext(b.project_id, threadId);
  writeMessagesToTargets(
    b.project_id, fromPeer, [toPeer],
    b.text, type, metadata, threadId, incoming, now,
    threadContext, 'send-message',
  );
  finalizeDelivery(b.project_id, fromPeer, toPeer.role, b.text, type, metadata, threadId, { ok: true }, res);
}

export async function handleSendToRole(body: unknown, res: ServerResponse): Promise<void> {
  const b = parseBodyOrError(sendToRoleSchema, body, res);
  if (!b) return;

  if (!validateIdentifiers(res, { name: 'role', value: b.role })) return;

  if (b.text.length > MAX_TEXT_LENGTH) {
    return error(res, `Message text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }

  const fromPeer = selectPeerById(b.from_id);
  if (!fromPeer) return error(res, `Peer not found: ${b.from_id}`, 404);

  // [H-1] — sender must be in the same project it claims. selectPeersByRole
  // already filters by project_id, so broadcast targets are safe; this
  // check just stops impersonation of a project by a peer that doesn't
  // belong to it.
  if (fromPeer.project_id !== b.project_id) {
    return errorResponse(
      res, 403, 'PROJECT_MISMATCH',
      'Peer does not belong to the requested project',
    );
  }

  const targets = selectPeersByRole(b.project_id, b.role);
  const incoming = b.attachments ?? [];
  if (!validateAttachments(incoming, res)) return;

  const type: MessageType = (b.type ?? 'message') as MessageType;
  const now = new Date().toISOString();
  const metadata = buildMetadata(incoming, normalizeMetadata(b.metadata));
  const threadId = inheritThreadId(b.project_id, b.from_id, b.thread_id ?? null, 'send-to-role');

  console.error(`[broker:send-to-role] from=${b.from_id} (role=${fromPeer.role}) target_role=${b.role} project=${b.project_id}`);
  console.error(`[broker:send-to-role] found ${targets.length} peer(s) with role "${b.role}":`);
  for (const target of targets) {
    console.error(`[broker:send-to-role]   -> id=${target.id} role=${target.role} pid=${target.pid}`);
  }

  const threadContext = loadThreadContext(b.project_id, threadId);
  writeMessagesToTargets(
    b.project_id, fromPeer, targets,
    b.text, type, metadata, threadId, incoming, now,
    threadContext, 'send-to-role',
  );
  finalizeDelivery(b.project_id, fromPeer, b.role, b.text, type, metadata, threadId, { ok: true, sent_to: targets.length }, res);
}

export function handlePollMessages(body: unknown, res: ServerResponse): void {
  const b = parseBodyOrError(pollMessagesSchema, body, res);
  if (!b) return;

  // FU-A (v0.3.1) peek/consume split. peek=true returns rows without
  // marking them delivered — used by manual_catch_up so an agent can
  // re-read its undelivered queue without yanking it out from under the
  // server's channel-push path. Default (consume) wraps SELECT+UPDATE
  // in a transaction so two concurrent consumers can't both claim the
  // same row IDs. Expired-message GC only runs on the consume path:
  // peek is meant to be read-only.
  if (b.peek) {
    const all = selectUndelivered(b.id);
    const now = Date.now();
    const fresh = all.filter(m =>
      now - new Date(m.sent_at).getTime() <= MESSAGE_TTL_MS,
    );
    json(res, { messages: fresh });
    return;
  }

  // consumeUndelivered already marked every selected row delivered=1
  // inside its transaction. We still partition by TTL so the agent
  // doesn't get handed messages older than MESSAGE_TTL_MS; the
  // dropped ones stay marked delivered, which is the intended behavior
  // (old, never-pushed messages are gone for good).
  const all = consumeUndelivered(b.id);
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  const fresh = all.filter(m => new Date(m.sent_at).getTime() >= cutoff);

  json(res, { messages: fresh });
}

// FASE D-1 / M-5 (v0.3.0): default + max bounded so an agent can no
// longer accidentally pull every log entry into context. The previous
// default (100) was already enforced at selectHistory; surfacing it
// here lets us also cap a request that asks for `limit: 99999`.
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 100;

export function handleGetHistory(body: unknown, res: ServerResponse): void {
  const b = parseBodyOrError(getHistorySchema, body, res);
  if (!b) return;
  // [S-NEW-3] history can include arbitrary text + tool calls — any
  // cross-project read here is a full conversation leak.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const limit = Math.min(b.limit ?? HISTORY_DEFAULT_LIMIT, HISTORY_MAX_LIMIT);

  const messages = selectHistory(b.project_id, {
    role: b.role,
    type: b.type,
    limit,
    session_id: b.session_id,
    thread_id: b.thread_id,
    before: b.before,
    after: b.after,
  });

  json(res, { messages });
}
