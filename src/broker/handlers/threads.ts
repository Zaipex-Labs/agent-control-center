// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Thread CRUD + search + summary handlers. Threads scope conversations
// inside a project so the dashboard can render parallel topics. Every
// endpoint that takes (project_id, thread_id) gates on
// assertProjectMembership (S-NEW-3) and rejects empty project_id
// (S-NEW-8 brute-force defense).

import type { ServerResponse } from 'node:http';
import { generateId } from '../../shared/utils.js';
import { broadcast } from '../websocket.js';
import { deleteBlobFile } from '../blobs.js';
import { releaseBlobRefsForThread } from '../blob-refs.js';
import type {
  CreateThreadRequest,
  ThreadListRequest,
  ThreadGetRequest,
  ThreadUpdateRequest,
  ThreadSearchRequest,
  ThreadSummaryRequest,
} from '../../shared/types.js';
import {
  insertThread,
  selectThreadsByProject,
  selectThreadParticipants,
  selectThreadById,
  updateThread,
  deleteThread,
  searchThreads,
  searchMessagesInThreads,
  selectLogByThread,
} from '../database.js';
import { json, error, assertProjectMembership } from './_helpers.js';

export function handleCreateThread(body: unknown, res: ServerResponse): void {
  const b = body as CreateThreadRequest;
  if (!b.project_id || !b.created_by) {
    return error(res, 'Missing required fields: project_id, created_by');
  }

  const now = new Date().toISOString();
  const id = generateId();
  const name = b.name || 'Hilo sin nombre';

  const thread = {
    id,
    project_id: b.project_id,
    name,
    status: 'active' as const,
    summary: '',
    created_by: b.created_by,
    created_at: now,
    updated_at: now,
  };
  insertThread(thread);
  broadcast('thread:created', thread, b.project_id);

  json(res, { id, name });
}

export function handleListThreads(body: unknown, res: ServerResponse): void {
  const b = body as ThreadListRequest;
  if (!b.project_id) {
    return error(res, 'Missing required field: project_id');
  }

  const threads = selectThreadsByProject(b.project_id, b.status ?? undefined);
  // Attach the list of roles that participated in each thread so the
  // sidebar can show their avatars on each card. 'user' is intentionally
  // excluded — we only want agent avatars.
  const withParticipants = threads.map(thread => ({
    ...thread,
    participants: selectThreadParticipants(b.project_id, thread.id).filter(r => r && r !== 'user' && r !== 'system'),
  }));
  json(res, { threads: withParticipants });
}

export function handleGetThread(body: unknown, res: ServerResponse): void {
  const b = body as ThreadGetRequest & { peer_id?: string };
  // [S-NEW-8] previously this allowed thread_id alone, then queried with
  // project_id=''. Since generateId() yields ~32 bits of entropy, that
  // path was brute-forceable on a local broker. Require both ids and
  // a member peer.
  if (!b.thread_id || !b.project_id) {
    return error(res, 'Missing required fields: project_id, thread_id');
  }
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const thread = selectThreadById(b.project_id, b.thread_id);
  if (!thread) return error(res, `Thread not found: ${b.thread_id}`, 404);

  json(res, thread);
}

export function handleUpdateThread(body: unknown, res: ServerResponse): void {
  const b = body as ThreadUpdateRequest & { peer_id?: string };
  // [S-NEW-8] same brute-force scope as handleGetThread.
  if (!b.thread_id || !b.project_id) {
    return error(res, 'Missing required fields: project_id, thread_id');
  }
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const updated = updateThread(b.project_id, b.thread_id, {
    name: b.name,
    status: b.status,
  });

  if (!updated) return error(res, `Thread not found: ${b.thread_id}`, 404);

  broadcast('thread:updated', {
    id: b.thread_id,
    name: b.name,
    status: b.status,
  }, b.project_id);

  json(res, { ok: true });
}

// Delete a thread (conversation). The thread row is removed but the
// historical messages stay in message_log with their thread_id nulled out,
// so the team history is preserved even after the thread disappears from
// the sidebar.
export function handleDeleteThread(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string; thread_id?: string; peer_id?: string };
  if (!b.project_id || !b.thread_id) {
    return error(res, 'Missing required fields: project_id, thread_id');
  }
  // [S-NEW-3] gate cross-project deletion the same way as messaging.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  // [S-NEW-9] release blob_refs owned by every message in this thread
  // BEFORE deleteThread() runs. Otherwise a deleted thread leaves
  // attached blob files on disk forever (the project-level sweep only
  // fires when the entire project is dropped). Orphans whose ref
  // count drops to zero are unlinked from the blob store.
  try {
    const orphans = releaseBlobRefsForThread(b.project_id, b.thread_id);
    for (const h of orphans) deleteBlobFile(h);
  } catch (e) {
    console.error(`[broker:delete-thread] blob cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const ok = deleteThread(b.project_id, b.thread_id);
  if (!ok) return error(res, `Thread not found: ${b.thread_id}`, 404);

  broadcast('thread:deleted', { id: b.thread_id }, b.project_id);
  json(res, { ok: true });
}

export function handleSearchThreads(body: unknown, res: ServerResponse): void {
  const b = body as ThreadSearchRequest;
  if (!b.project_id || !b.query) {
    return error(res, 'Missing required fields: project_id, query');
  }

  const threads = searchThreads(b.project_id, b.query, b.limit);
  const messages = searchMessagesInThreads(b.project_id, b.query, b.limit ?? 50);
  json(res, { threads, messages });
}

export function handleThreadSummary(body: unknown, res: ServerResponse): void {
  const b = body as ThreadSummaryRequest & { project_id?: string; peer_id?: string };
  // [S-NEW-3] previously thread_id alone was enough; the summary leaks
  // the last 10 messages of any thread cross-project. Require
  // project_id + member peer like every other thread endpoint.
  if (!b.thread_id || !b.project_id) {
    return error(res, 'Missing required fields: project_id, thread_id');
  }
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const entries = selectLogByThread(b.thread_id, 10);

  // Entries come in DESC order, reverse to chronological
  const lines = entries.reverse().map(e => {
    const name = e.from_role || e.from_id;
    return `${name}: ${e.text}`;
  });

  const summary = lines.length > 0 ? lines.join('\n') : '(no messages yet)';

  // Find the thread to update it — search in log entries for project_id
  if (entries.length > 0) {
    updateThread(entries[0].project_id, b.thread_id, { summary });
  }

  json(res, { summary });
}
