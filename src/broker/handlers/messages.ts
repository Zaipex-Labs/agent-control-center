// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Message-flow handlers: send-message, send-to-role, poll-messages,
// get-history. The two send paths are heavy duplicates of each other
// today (Q-2 in the v0.2.2 audit) — Q-1 (this commit) is a pure split,
// Q-2 (next commit) extracts the shared resolveMessageDelivery helper.

import type { ServerResponse } from 'node:http';
import { broadcast } from '../websocket.js';
import { tmuxNotify, tmuxInjectWithContext } from '../tmux.js';
import { getBlob } from '../blobs.js';
import { addBlobRef } from '../blob-refs.js';
import { serializeAttachments, type Attachment } from '../../shared/attachments.js';
import type {
  SendMessageRequest,
  SendToRoleRequest,
  PollMessagesRequest,
  GetHistoryRequest,
  MessageType,
} from '../../shared/types.js';
import {
  selectPeerById,
  selectPeersByRole,
  insertMessage,
  selectUndelivered,
  markDelivered,
  insertLogEntry,
  selectHistory,
  selectThreadById,
  selectLogByThread,
  touchThread,
} from '../database.js';
import {
  json,
  error,
  validateIdentifiers,
  assertProjectMembership,
  MAX_TEXT_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from './_helpers.js';

const MESSAGE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export async function handleSendMessage(body: unknown, res: ServerResponse): Promise<void> {
  const b = body as SendMessageRequest;
  if (!b.project_id || !b.from_id || !b.to_id || !b.text) {
    return error(res, 'Missing required fields: project_id, from_id, to_id, text');
  }

  if (typeof b.text === 'string' && b.text.length > MAX_TEXT_LENGTH) {
    return error(res, `Message text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }

  const toPeer = selectPeerById(b.to_id);
  if (!toPeer) return error(res, `Peer not found: ${b.to_id}`, 404);

  const fromPeer = selectPeerById(b.from_id);
  if (!fromPeer) return error(res, `Peer not found: ${b.from_id}`, 404);

  // [H-1] — both peers must belong to the body's project_id. Without this,
  // a local attacker who knows a peer_id in project B could send messages
  // (with attachments) to that peer while claiming to be in project A.
  // SECURITY.md lists cross-project bypasses as a vulnerability.
  if (fromPeer.project_id !== b.project_id || toPeer.project_id !== b.project_id) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Peer does not belong to the requested project',
      code: 'PROJECT_MISMATCH',
    }));
    return;
  }

  const type: MessageType = b.type ?? 'message';
  const now = new Date().toISOString();

  // Attachments: validate every referenced blob is on disk before writing
  // the message. If any is missing, return a structured 404 so the
  // dashboard can decide to re-upload. The blob_refs rows are inserted
  // AFTER insertMessage so we have a real message_id.
  const incoming = (b as SendMessageRequest & { attachments?: Attachment[] }).attachments ?? [];
  if (incoming.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: `Too many attachments (max ${MAX_ATTACHMENTS_PER_MESSAGE} per message)`,
      code: 'TOO_MANY_ATTACHMENTS',
    }));
    return;
  }
  for (const att of incoming) {
    if (!getBlob(att.hash)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'Attachment blob not found on server',
        code: 'BLOB_NOT_FOUND',
        hash: att.hash,
      }));
      return;
    }
  }

  // Merge incoming attachments into metadata so `topic` (and any other
  // future metadata key) survives alongside them.
  let metadata: string | null;
  if (incoming.length > 0) {
    let existingObj: Record<string, unknown> = {};
    if (b.metadata) {
      try { existingObj = JSON.parse(b.metadata) as Record<string, unknown>; } catch { /* ignore */ }
    }
    metadata = serializeAttachments(incoming, existingObj);
  } else {
    metadata = b.metadata ?? null;
  }

  let threadId = b.thread_id ?? null;

  // Auto-inherit thread_id: first try user's original message, then any recent message
  // sent TO this sender (so agent replies stay in the same thread as the question)
  if (!threadId) {
    const recentHistory = selectHistory(b.project_id, { limit: 30 });
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    // 1. Try user's original message
    const userMsg = recentHistory.find(m =>
      m.from_role === 'user' &&
      m.thread_id &&
      new Date(m.sent_at).getTime() > fiveMinAgo
    );
    if (userMsg?.thread_id) {
      threadId = userMsg.thread_id;
      console.error(`[broker:send-message] inherited thread_id=${threadId} from user message`);
    } else {
      // 2. Try the last message received by this sender that has a thread_id
      const receivedMsg = recentHistory.find(m =>
        m.to_id === b.from_id &&
        m.thread_id &&
        new Date(m.sent_at).getTime() > fiveMinAgo
      );
      if (receivedMsg?.thread_id) {
        threadId = receivedMsg.thread_id;
        console.error(`[broker:send-message] inherited thread_id=${threadId} from received message`);
      }
    }
  }

  console.error(`[broker:send-message] from=${b.from_id} (${fromPeer.role}) to=${b.to_id} (${toPeer.role}) thread=${threadId}`);

  const messageId = insertMessage(b.project_id, b.from_id, b.to_id, type, b.text, metadata, now, threadId);
  insertLogEntry(
    b.project_id, b.from_id, fromPeer.role, b.to_id, toPeer.role,
    type, b.text, metadata, now, fromPeer.id, threadId,
  );

  // Register one blob_ref per attachment so cleanup (project delete / GC)
  // knows the blob is referenced by this specific message.
  for (const att of incoming) {
    addBlobRef(att.hash, b.project_id, messageId);
  }

  if (threadId) {
    touchThread(b.project_id, threadId);
  }

  // Best-effort tmux notification to target pane
  if (toPeer.role) {
    if (threadId) {
      const thread = selectThreadById(b.project_id, threadId);
      if (thread) {
        const entries = selectLogByThread(threadId, 10);
        const summary = entries.reverse().map(e => `${e.from_role || e.from_id}: ${e.text}`).join(' | ');
        tmuxInjectWithContext(b.project_id, toPeer.role, thread.name, summary || '(sin mensajes)', fromPeer.name, fromPeer.role);
      }
    } else {
      tmuxNotify(b.project_id, toPeer.role, fromPeer.name, fromPeer.role);
    }
  }

  broadcast('message:new', {
    thread_id: threadId,
    from_name: fromPeer.name,
    from_role: fromPeer.role,
    to_role: toPeer.role,
    text: b.text,
    type,
    metadata,
  }, b.project_id);

  json(res, { ok: true });
}

export async function handleSendToRole(body: unknown, res: ServerResponse): Promise<void> {
  const b = body as SendToRoleRequest;
  if (!b.project_id || !b.from_id || !b.role || !b.text) {
    return error(res, 'Missing required fields: project_id, from_id, role, text');
  }

  if (!validateIdentifiers(res, { name: 'role', value: b.role })) return;

  if (typeof b.text === 'string' && b.text.length > MAX_TEXT_LENGTH) {
    return error(res, `Message text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }

  const fromPeer = selectPeerById(b.from_id);
  if (!fromPeer) return error(res, `Peer not found: ${b.from_id}`, 404);

  // [H-1] — sender must be in the same project it claims. selectPeersByRole
  // already filters by project_id, so broadcast targets are safe; this
  // check just stops impersonation of a project by a peer that doesn't
  // belong to it.
  if (fromPeer.project_id !== b.project_id) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Peer does not belong to the requested project',
      code: 'PROJECT_MISMATCH',
    }));
    return;
  }

  const targets = selectPeersByRole(b.project_id, b.role);
  const type: MessageType = b.type ?? 'message';
  const now = new Date().toISOString();

  // Same attachments handling as handleSendMessage (see there for rationale).
  const incoming = (b as SendToRoleRequest & { attachments?: Attachment[] }).attachments ?? [];
  if (incoming.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: `Too many attachments (max ${MAX_ATTACHMENTS_PER_MESSAGE} per message)`,
      code: 'TOO_MANY_ATTACHMENTS',
    }));
    return;
  }
  for (const att of incoming) {
    if (!getBlob(att.hash)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'Attachment blob not found on server',
        code: 'BLOB_NOT_FOUND',
        hash: att.hash,
      }));
      return;
    }
  }

  let metadata: string | null;
  if (incoming.length > 0) {
    let existingObj: Record<string, unknown> = {};
    if (b.metadata) {
      try { existingObj = JSON.parse(b.metadata) as Record<string, unknown>; } catch { /* ignore */ }
    }
    metadata = serializeAttachments(incoming, existingObj);
  } else {
    metadata = b.metadata ?? null;
  }
  let threadId = b.thread_id ?? null;

  // Auto-inherit thread_id: first try user's original message, then any recent message
  // sent TO this sender (so agent replies stay in the same thread as the question)
  if (!threadId) {
    const recentHistory = selectHistory(b.project_id, { limit: 30 });
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const userMsg = recentHistory.find(m =>
      m.from_role === 'user' &&
      m.thread_id &&
      new Date(m.sent_at).getTime() > fiveMinAgo
    );
    if (userMsg?.thread_id) {
      threadId = userMsg.thread_id;
      console.error(`[broker:send-to-role] inherited thread_id=${threadId} from user message`);
    } else {
      const receivedMsg = recentHistory.find(m =>
        m.to_id === b.from_id &&
        m.thread_id &&
        new Date(m.sent_at).getTime() > fiveMinAgo
      );
      if (receivedMsg?.thread_id) {
        threadId = receivedMsg.thread_id;
        console.error(`[broker:send-to-role] inherited thread_id=${threadId} from received message`);
      }
    }
  }

  console.error(`[broker:send-to-role] from=${b.from_id} (role=${fromPeer.role}) target_role=${b.role} project=${b.project_id}`);
  console.error(`[broker:send-to-role] found ${targets.length} peer(s) with role "${b.role}":`);
  for (const target of targets) {
    console.error(`[broker:send-to-role]   -> id=${target.id} role=${target.role} pid=${target.pid}`);
  }

  // Precompute thread context for tmux injection
  let threadContext: { name: string; summary: string } | null = null;
  if (threadId) {
    const thread = selectThreadById(b.project_id, threadId);
    if (thread) {
      const entries = selectLogByThread(threadId, 10);
      const summary = entries.reverse().map(e => `${e.from_role || e.from_id}: ${e.text}`).join(' | ');
      threadContext = { name: thread.name, summary: summary || '(sin mensajes)' };
    }
  }

  // Track roles we've already injected into (avoid duplicate send-keys for same role)
  const injectedRoles = new Set<string>();

  for (const target of targets) {
    console.error(`[broker:send-to-role] inserting message: from=${b.from_id} to=${target.id} (${target.role})`);
    const messageId = insertMessage(b.project_id, b.from_id, target.id, type, b.text, metadata, now, threadId);
    insertLogEntry(
      b.project_id, b.from_id, fromPeer.role, target.id, target.role,
      type, b.text, metadata, now, fromPeer.id, threadId,
    );
    for (const att of incoming) addBlobRef(att.hash, b.project_id, messageId);

    // Best-effort tmux notification (once per role/window)
    if (target.role && !injectedRoles.has(target.role)) {
      if (threadId && threadContext) {
        tmuxInjectWithContext(b.project_id, target.role, threadContext.name, threadContext.summary, fromPeer.name, fromPeer.role);
      } else {
        tmuxNotify(b.project_id, target.role, fromPeer.name, fromPeer.role);
      }
      injectedRoles.add(target.role);
    }
  }

  if (threadId) {
    touchThread(b.project_id, threadId);
  }

  broadcast('message:new', {
    thread_id: threadId,
    from_name: fromPeer.name,
    from_role: fromPeer.role,
    to_role: b.role,
    text: b.text,
    type,
    metadata,
  }, b.project_id);

  json(res, { ok: true, sent_to: targets.length });
}

export function handlePollMessages(body: unknown, res: ServerResponse): void {
  const b = body as PollMessagesRequest;
  if (!b.id) return error(res, 'Missing required field: id');

  const all = selectUndelivered(b.id);
  const now = Date.now();
  const expired: number[] = [];
  const fresh: typeof all = [];

  for (const msg of all) {
    if (now - new Date(msg.sent_at).getTime() > MESSAGE_TTL_MS) {
      expired.push(msg.id);
    } else {
      fresh.push(msg);
    }
  }

  // Mark expired messages as delivered silently
  if (expired.length > 0) {
    markDelivered(expired);
  }

  // Mark fresh messages as delivered
  if (fresh.length > 0) {
    markDelivered(fresh.map(m => m.id));
  }

  json(res, { messages: fresh });
}

export function handleGetHistory(body: unknown, res: ServerResponse): void {
  const b = body as GetHistoryRequest & { peer_id?: string };
  if (!b.project_id) return error(res, 'Missing required field: project_id');
  // [S-NEW-3] history can include arbitrary text + tool calls — any
  // cross-project read here is a full conversation leak.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const messages = selectHistory(b.project_id, {
    role: b.role,
    type: b.type,
    limit: b.limit,
    session_id: b.session_id,
    thread_id: b.thread_id,
  });

  json(res, { messages });
}
