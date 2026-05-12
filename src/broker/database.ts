// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import Database from 'better-sqlite3';
import { ACC_DB, ensureDirectories } from '../shared/config.js';
import { generateId } from '../shared/utils.js';
import type { Peer, Message, LogEntry, SharedStateEntry, MessageType, Thread, ThreadStatus, MessageMatch } from '../shared/types.js';

let db: Database.Database;

export function initDatabase(dbPath?: string): Database.Database {
  if (!dbPath || dbPath !== ':memory:') {
    ensureDirectories();
  }
  db = new Database(dbPath ?? ACC_DB);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  db.exec(`
    CREATE TABLE IF NOT EXISTS peers (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pid INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      agent_type TEXT NOT NULL DEFAULT 'claude-code',
      cwd TEXT NOT NULL,
      git_root TEXT,
      git_branch TEXT,
      tty TEXT,
      summary TEXT NOT NULL DEFAULT '',
      avatar TEXT,
      registered_at TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_peers_project ON peers(project_id);

    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'message',
      text TEXT NOT NULL,
      metadata TEXT,
      thread_id TEXT,
      sent_at TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, delivered);

    CREATE TABLE IF NOT EXISTS shared_state (
      project_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      author_role TEXT,
      author_peer_id TEXT,
      created_at TEXT,
      PRIMARY KEY (project_id, namespace, key)
    );

    CREATE TABLE IF NOT EXISTS message_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      from_role TEXT NOT NULL,
      to_id TEXT NOT NULL,
      to_role TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      metadata TEXT,
      thread_id TEXT,
      sent_at TEXT NOT NULL,
      session_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_log_project ON message_log(project_id);
    CREATE INDEX IF NOT EXISTS idx_log_session ON message_log(session_id);

    -- Reference counting for blob attachments. One row per
    -- (blob, project, message). Storing project_id AND message_id
    -- lets us release refs on either axis (delete project cascades
    -- all rows for that project; future handleDeleteMessage can
    -- release by message_id alone). When a blob's ref count drops
    -- to zero the broker deletes the file from ~/.zaipex-acc/blobs/.
    CREATE TABLE IF NOT EXISTS blob_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      blob_hash TEXT NOT NULL,
      project_id TEXT NOT NULL,
      message_id INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blob_refs_hash ON blob_refs(blob_hash);
    CREATE INDEX IF NOT EXISTS idx_blob_refs_project ON blob_refs(project_id);
    CREATE INDEX IF NOT EXISTS idx_blob_refs_message ON blob_refs(message_id);

    -- FASE A v0.3.3 — per-turn LLM token usage, populated by the
    -- broker's claude-session JSONL tailer (token-tail.ts). Each row
    -- corresponds to one assistant turn captured from
    -- ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl. The
    -- turn_uuid comes from the JSONL message.uuid and is UNIQUE so a
    -- re-tail after broker restart is idempotent (INSERT OR IGNORE).
    --
    -- peer_id may go stale if cleanStalePeers evicts the peer before
    -- the next aggregate query — kept as a soft reference, not a FK,
    -- because the four token counts and the role tag are enough to
    -- attribute usage even if the live peer row is gone.
    CREATE TABLE IF NOT EXISTS token_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      peer_id TEXT,
      role TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      turn_uuid TEXT UNIQUE,
      session_uuid TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_project_created
      ON token_usage(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_token_usage_role
      ON token_usage(project_id, role);
  `);

  // Migrations for existing databases
  migrateSchema(db);

  return db;
}

function migrateSchema(database: Database.Database): void {
  // Add thread_id to messages if missing
  const msgCols = database.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!msgCols.some(c => c.name === 'thread_id')) {
    database.exec('ALTER TABLE messages ADD COLUMN thread_id TEXT');
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)');

  // Add thread_id to message_log if missing
  const logCols = database.prepare("PRAGMA table_info(message_log)").all() as { name: string }[];
  if (!logCols.some(c => c.name === 'thread_id')) {
    database.exec('ALTER TABLE message_log ADD COLUMN thread_id TEXT');
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_log_thread ON message_log(thread_id)');

  // PRE-2 (v0.3.0): peers.avatar — dicebear:<seed> or data:image/... or NULL.
  // Dashboard already supports the on-disk shape; broker now persists it.
  const peerCols = database.prepare("PRAGMA table_info(peers)").all() as { name: string }[];
  if (!peerCols.some(c => c.name === 'avatar')) {
    database.exec('ALTER TABLE peers ADD COLUMN avatar TEXT');
  }

  // FASE A-1 (v0.3.0): shared_state author_* + created_at, populated
  // only for the reserved `decisions` namespace (Team Memory).
  // Idempotent — older DBs without these columns get them lazily.
  const sharedCols = database.prepare("PRAGMA table_info(shared_state)").all() as { name: string }[];
  if (!sharedCols.some(c => c.name === 'author_role')) {
    database.exec('ALTER TABLE shared_state ADD COLUMN author_role TEXT');
  }
  if (!sharedCols.some(c => c.name === 'author_peer_id')) {
    database.exec('ALTER TABLE shared_state ADD COLUMN author_peer_id TEXT');
  }
  if (!sharedCols.some(c => c.name === 'created_at')) {
    database.exec('ALTER TABLE shared_state ADD COLUMN created_at TEXT');
  }
}

export function getDb(): Database.Database {
  return db;
}

// Close the SQLite handle and run a final WAL checkpoint so on-disk
// state is consistent. Safe to call multiple times. Wired into the
// broker shutdown path (QW-5).
export function closeDatabase(): void {
  if (!db) return;
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    // [F-5 v0.2.3] Log the failure instead of silently moving on. The
    // pragma can fail under disk-full / locked / corrupt scenarios; if
    // we proceed without checkpointing, the WAL is left fat and the
    // next boot pays the cost. The shutdown still continues — we'd
    // rather close the handle than hang on a wedged checkpoint.
    console.error(
      '[broker:db] wal_checkpoint(TRUNCATE) failed during close',
      e instanceof Error ? e.message : String(e),
    );
  }
  try { db.close(); } catch (e) {
    // db.close() failing is rare but worth surfacing — if the handle
    // is still alive after this, future getDb() callers see a stale
    // pointer. Same "log + carry on" rule.
    console.error(
      '[broker:db] db.close() failed',
      e instanceof Error ? e.message : String(e),
    );
  }
  // @ts-expect-error — leaving the var dangling is fine; subsequent
  // getDb() calls will throw, which is the desired behaviour after
  // shutdown.
  db = undefined;
}

// ── Peers ──────────────────────────────────────────────────────

export function insertPeer(peer: Peer): void {
  getDb().prepare(`
    INSERT INTO peers (id, project_id, pid, name, role, agent_type, cwd, git_root, git_branch, tty, summary, avatar, registered_at, last_seen)
    VALUES (@id, @project_id, @pid, @name, @role, @agent_type, @cwd, @git_root, @git_branch, @tty, @summary, @avatar, @registered_at, @last_seen)
  `).run({ ...peer, avatar: peer.avatar ?? null });
}

// PRE-2 (v0.3.0): allow the dashboard to update an agent's avatar after the
// fact (avatar picker UI). Idempotent — passing null/undefined clears it.
export function updatePeerAvatar(id: string, avatar: string | null): void {
  getDb().prepare('UPDATE peers SET avatar = ? WHERE id = ?').run(avatar, id);
}

export function updateLastSeen(id: string, now: string): void {
  getDb().prepare('UPDATE peers SET last_seen = ? WHERE id = ?').run(now, id);
}

export function updateSummary(id: string, summary: string): void {
  getDb().prepare('UPDATE peers SET summary = ? WHERE id = ?').run(summary, id);
}

export function updateRole(id: string, role: string): void {
  getDb().prepare('UPDATE peers SET role = ? WHERE id = ?').run(role, id);
}

export function deletePeer(id: string): void {
  getDb().prepare('DELETE FROM peers WHERE id = ?').run(id);
}

export function selectPeerById(id: string): Peer | undefined {
  return getDb().prepare('SELECT * FROM peers WHERE id = ?').get(id) as Peer | undefined;
}

export function selectPeersByProject(projectId: string): Peer[] {
  return getDb().prepare('SELECT * FROM peers WHERE project_id = ?').all(projectId) as Peer[];
}

export function selectAllPeers(): Peer[] {
  return getDb().prepare('SELECT * FROM peers').all() as Peer[];
}

export function selectPeersByRole(projectId: string, role: string): Peer[] {
  return getDb().prepare('SELECT * FROM peers WHERE project_id = ? AND role = ?').all(projectId, role) as Peer[];
}

export function selectPeersByCwd(projectId: string, cwd: string): Peer[] {
  return getDb().prepare('SELECT * FROM peers WHERE project_id = ? AND cwd = ?').all(projectId, cwd) as Peer[];
}

export function selectPeersByGitRoot(projectId: string, gitRoot: string): Peer[] {
  return getDb().prepare('SELECT * FROM peers WHERE project_id = ? AND git_root = ?').all(projectId, gitRoot) as Peer[];
}

export function deleteStalePeers(cutoff: string): number {
  return getDb().prepare('DELETE FROM peers WHERE last_seen < ?').run(cutoff).changes;
}

export function countPeers(): number {
  return (getDb().prepare('SELECT COUNT(*) as count FROM peers').get() as { count: number }).count;
}

// ── Messages ───────────────────────────────────────────────────

export function insertMessage(
  projectId: string,
  fromId: string,
  toId: string,
  type: MessageType,
  text: string,
  metadata: string | null,
  sentAt: string,
  threadId: string | null = null,
): number {
  const result = getDb().prepare(`
    INSERT INTO messages (project_id, from_id, to_id, type, text, metadata, thread_id, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, fromId, toId, type, text, metadata, threadId, sentAt);
  return Number(result.lastInsertRowid);
}

export function selectUndelivered(toId: string): Message[] {
  return getDb().prepare(
    'SELECT * FROM messages WHERE to_id = ? AND delivered = 0 ORDER BY id ASC',
  ).all(toId) as Message[];
}

export function markDelivered(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  getDb().prepare(`UPDATE messages SET delivered = 1 WHERE id IN (${placeholders})`).run(...ids);
}

// FU-A (v0.3.1): atomic SELECT + UPDATE for the consume path. Two
// concurrent /api/poll-messages calls used to race because they each
// ran SELECT separately and then UPDATE separately — both saw the
// same delivered=0 rows and both returned them. The UPDATE is
// idempotent at the SQL level (delivered=0→1 either way), but the
// SELECT side leaked duplicate messages to the agent. Wrapping the
// pair in `db.transaction(...)` serializes them: the second
// transaction's SELECT sees delivered=1 for the rows the first
// already claimed, so it returns the disjoint set.
//
// Callers:
//   - The MCP server's 1-second polling loop uses this (consume).
//   - manual_catch_up uses selectUndelivered directly (peek), so the
//     agent can re-read its undelivered queue without marking.
export function consumeUndelivered(toId: string): Message[] {
  return getDb().transaction(() => {
    const rows = getDb().prepare(
      'SELECT * FROM messages WHERE to_id = ? AND delivered = 0 ORDER BY id ASC',
    ).all(toId) as Message[];
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      const placeholders = ids.map(() => '?').join(',');
      getDb().prepare(
        `UPDATE messages SET delivered = 1 WHERE id IN (${placeholders}) AND delivered = 0`,
      ).run(...ids);
    }
    return rows;
  })();
}

export function countPendingMessages(): number {
  return (getDb().prepare('SELECT COUNT(*) as count FROM messages WHERE delivered = 0').get() as { count: number }).count;
}

// ── Message log ────────────────────────────────────────────────

export function insertLogEntry(
  projectId: string,
  fromId: string,
  fromRole: string,
  toId: string,
  toRole: string,
  type: MessageType,
  text: string,
  metadata: string | null,
  sentAt: string,
  sessionId: string,
  threadId: string | null = null,
): void {
  getDb().prepare(`
    INSERT INTO message_log (project_id, from_id, from_role, to_id, to_role, type, text, metadata, thread_id, sent_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, fromId, fromRole, toId, toRole, type, text, metadata, threadId, sentAt, sessionId);
}

export function selectHistory(
  projectId: string,
  options?: {
    role?: string;
    type?: MessageType | string;
    limit?: number;
    session_id?: string;
    thread_id?: string;
    before?: string;  // FASE D-1 (v0.3.0): sent_at < before
    after?: string;   // FASE D-1 (v0.3.0): sent_at > after
  },
): LogEntry[] {
  const conditions: string[] = ['project_id = ?'];
  const params: (string | number)[] = [projectId];

  if (options?.role) {
    conditions.push('(from_role = ? OR to_role = ?)');
    params.push(options.role, options.role);
  }
  if (options?.type) {
    conditions.push('type = ?');
    params.push(options.type);
  }
  if (options?.session_id) {
    conditions.push('session_id = ?');
    params.push(options.session_id);
  }
  if (options?.thread_id) {
    conditions.push('thread_id = ?');
    params.push(options.thread_id);
  }
  if (options?.before) {
    conditions.push('sent_at < ?');
    params.push(options.before);
  }
  if (options?.after) {
    conditions.push('sent_at > ?');
    params.push(options.after);
  }

  const limit = options?.limit ?? 100;
  const sql = `SELECT * FROM message_log WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT ?`;
  params.push(limit);

  return getDb().prepare(sql).all(...params) as LogEntry[];
}

// ── Shared state ───────────────────────────────────────────────

export function setSharedState(
  projectId: string,
  namespace: string,
  key: string,
  value: string,
  peerId: string,
  now: string,
): void {
  getDb().prepare(`
    INSERT INTO shared_state (project_id, namespace, key, value, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, namespace, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(projectId, namespace, key, value, peerId, now);
}

// FASE A-1 (v0.3.0): write-through for the `decisions` namespace.
// On INSERT, all fields are written. On UPDATE, author_role /
// author_peer_id / created_at are preserved (decisions track the
// original author across edits — last editor lives in updated_by /
// updated_at, same as every other namespace).
export function setSharedStateWithMeta(
  projectId: string,
  namespace: string,
  key: string,
  value: string,
  peerId: string,
  now: string,
  meta: { author_role: string; author_peer_id: string },
): void {
  getDb().prepare(`
    INSERT INTO shared_state
      (project_id, namespace, key, value, updated_by, updated_at, author_role, author_peer_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, namespace, key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
      -- author_role / author_peer_id / created_at intentionally NOT updated
  `).run(
    projectId, namespace, key, value, peerId, now,
    meta.author_role, meta.author_peer_id, now,
  );
}

// FASE A-2 (v0.3.0): fuzzy match over key + value within the
// `decisions` namespace of one project. Lightweight scoring (substring
// hit, length-normalized) — BM25 is overkill at this scale and the
// query is interactive (n ~ 1k decisions, returns top-5).
export interface DecisionMatch {
  key: string;
  value: string;
  author_role: string | null;
  author_peer_id: string | null;
  created_at: string | null;
  updated_at: string;
  score: number;
}

export function searchDecisions(
  projectId: string,
  namespace: string,
  query: string,
  limit: number,
): DecisionMatch[] {
  // Two-step: SQL LIKE narrows to candidate rows, then the JS scorer
  // ranks. We bound the candidate set so even pathological queries
  // (single-char "a") don't fan out across 100k rows. 500 is well past
  // any realistic use and still fits in one prepared-statement call.
  const pattern = `%${query.replace(/[%_]/g, m => `\\${m}`)}%`;
  const rows = getDb().prepare(`
    SELECT key, value, author_role, author_peer_id, created_at, updated_at
    FROM shared_state
    WHERE project_id = ? AND namespace = ?
      AND (key LIKE ? ESCAPE '\\' OR value LIKE ? ESCAPE '\\')
    LIMIT 500
  `).all(projectId, namespace, pattern, pattern) as Array<{
    key: string; value: string;
    author_role: string | null; author_peer_id: string | null;
    created_at: string | null; updated_at: string;
  }>;

  const q = query.toLowerCase();
  const scored: DecisionMatch[] = rows.map(r => {
    const k = r.key.toLowerCase();
    const v = r.value.toLowerCase();
    // Key hits weigh more than value hits — keys are intentional handles
    // ("use-esm", "auth-strategy"), values are prose.
    const keyHit = k.includes(q) ? q.length / Math.max(k.length, 1) : 0;
    const valHit = v.includes(q) ? q.length / Math.max(v.length, 1) : 0;
    const score = keyHit * 2 + valHit;
    return { ...r, score };
  });

  return scored
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}

export function getSharedState(projectId: string, namespace: string, key: string): SharedStateEntry | undefined {
  return getDb().prepare(
    'SELECT * FROM shared_state WHERE project_id = ? AND namespace = ? AND key = ?',
  ).get(projectId, namespace, key) as SharedStateEntry | undefined;
}

export function listSharedKeys(projectId: string, namespace: string): string[] {
  const rows = getDb().prepare(
    'SELECT key FROM shared_state WHERE project_id = ? AND namespace = ?',
  ).all(projectId, namespace) as { key: string }[];
  return rows.map(r => r.key);
}

export function deleteSharedState(projectId: string, namespace: string, key: string): void {
  getDb().prepare(
    'DELETE FROM shared_state WHERE project_id = ? AND namespace = ? AND key = ?',
  ).run(projectId, namespace, key);
}

// ── Threads ───────────────────────────────────────────────────

export function insertThread(thread: Thread): void {
  getDb().prepare(`
    INSERT INTO threads (id, project_id, name, status, summary, created_by, created_at, updated_at)
    VALUES (@id, @project_id, @name, @status, @summary, @created_by, @created_at, @updated_at)
  `).run(thread);
}

// Distinct roles that ever sent or received a message in a given thread.
// Used to paint agent avatars on the conversations sidebar.
export function selectThreadParticipants(projectId: string, threadId: string): string[] {
  const rows = getDb().prepare(`
    SELECT DISTINCT role FROM (
      SELECT from_role AS role FROM message_log
      WHERE project_id = ? AND thread_id = ?
      UNION
      SELECT to_role AS role FROM message_log
      WHERE project_id = ? AND thread_id = ?
    ) WHERE role IS NOT NULL AND role != ''
  `).all(projectId, threadId, projectId, threadId) as Array<{ role: string }>;
  return rows.map(r => r.role);
}

export function selectThreadsByProject(projectId: string, status?: ThreadStatus): Thread[] {
  if (status) {
    return getDb().prepare(
      'SELECT * FROM threads WHERE project_id = ? AND status = ? ORDER BY created_at ASC',
    ).all(projectId, status) as Thread[];
  }
  return getDb().prepare(
    'SELECT * FROM threads WHERE project_id = ? ORDER BY created_at ASC',
  ).all(projectId) as Thread[];
}

export function selectThreadById(projectId: string, threadId: string): Thread | undefined {
  if (projectId) {
    return getDb().prepare(
      'SELECT * FROM threads WHERE project_id = ? AND id = ?',
    ).get(projectId, threadId) as Thread | undefined;
  }
  return getDb().prepare(
    'SELECT * FROM threads WHERE id = ?',
  ).get(threadId) as Thread | undefined;
}

export function updateThread(
  projectId: string,
  threadId: string,
  updates: { name?: string; status?: ThreadStatus; summary?: string },
): boolean {
  const fields: string[] = [];
  const params: (string)[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    params.push(updates.name);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    params.push(updates.status);
  }
  if (updates.summary !== undefined) {
    fields.push('summary = ?');
    params.push(updates.summary);
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  params.push(new Date().toISOString());

  if (projectId) {
    params.push(projectId, threadId);
    const result = getDb().prepare(
      `UPDATE threads SET ${fields.join(', ')} WHERE project_id = ? AND id = ?`,
    ).run(...params);
    return result.changes > 0;
  }

  params.push(threadId);
  const result = getDb().prepare(
    `UPDATE threads SET ${fields.join(', ')} WHERE id = ?`,
  ).run(...params);
  return result.changes > 0;
}

// Wipes every row in every table that belongs to a project. Used when
// the user deletes a team — without this, messages/threads/shared_state
// accumulate as orphans keyed by a project_id that no longer exists.
// Returns every distinct project_id currently referenced by any row in
// peers / messages / message_log / shared_state / threads. Used by the
// startup migration to find orphan data from deleted projects.
export function listProjectIdsInDb(): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT project_id FROM peers
    UNION SELECT project_id FROM messages
    UNION SELECT project_id FROM message_log
    UNION SELECT project_id FROM shared_state
    UNION SELECT project_id FROM threads
  `).all() as Array<{ project_id: string }>;
  return rows.map(r => r.project_id).filter(Boolean);
}

export function deleteProjectData(projectId: string): void {
  const db = getDb();
  const tables = ['peers', 'messages', 'message_log', 'shared_state', 'threads'];
  const tx = db.transaction((pid: string) => {
    for (const table of tables) {
      db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(pid);
    }
  });
  tx(projectId);
}

export function deleteThread(projectId: string, threadId: string): boolean {
  const db = getDb();
  // Null out thread_id references in logs + pending messages so we don't
  // leave dangling foreign keys. We keep the log entries themselves — they
  // are still part of the project history, just no longer grouped under
  // this thread.
  db.prepare('UPDATE message_log SET thread_id = NULL WHERE thread_id = ? AND project_id = ?').run(threadId, projectId);
  db.prepare('UPDATE messages SET thread_id = NULL WHERE thread_id = ? AND project_id = ?').run(threadId, projectId);
  const result = db.prepare('DELETE FROM threads WHERE id = ? AND project_id = ?').run(threadId, projectId);
  return result.changes > 0;
}

export function searchThreads(projectId: string, query: string, limit: number = 20): Thread[] {
  const pattern = `%${query}%`;
  return getDb().prepare(`
    SELECT DISTINCT t.* FROM threads t
    LEFT JOIN messages m ON m.thread_id = t.id AND m.project_id = t.project_id
    WHERE t.project_id = ? AND (t.name LIKE ? OR m.text LIKE ?)
    ORDER BY t.updated_at DESC
    LIMIT ?
  `).all(projectId, pattern, pattern, limit) as Thread[];
}

export function searchMessagesInThreads(projectId: string, query: string, limit: number = 50): MessageMatch[] {
  const pattern = `%${query}%`;
  return getDb().prepare(`
    SELECT ml.id, ml.project_id, ml.from_id, ml.from_role, ml.to_id, ml.to_role,
           ml.type, ml.text, ml.thread_id, t.name as thread_name, ml.sent_at
    FROM message_log ml
    INNER JOIN threads t ON t.id = ml.thread_id AND t.project_id = ml.project_id
    WHERE ml.project_id = ? AND ml.text LIKE ? AND ml.thread_id IS NOT NULL
    ORDER BY ml.sent_at DESC
    LIMIT ?
  `).all(projectId, pattern, limit) as MessageMatch[];
}

export function selectLogByThread(threadId: string, limit: number = 10): LogEntry[] {
  return getDb().prepare(
    'SELECT * FROM message_log WHERE thread_id = ? ORDER BY id DESC LIMIT ?',
  ).all(threadId, limit) as LogEntry[];
}

export function touchThread(projectId: string, threadId: string): void {
  getDb().prepare(
    'UPDATE threads SET updated_at = ? WHERE project_id = ? AND id = ?',
  ).run(new Date().toISOString(), projectId, threadId);
}

const GENERAL_THREAD_NAME = 'General';

export function ensureGeneralThread(projectId: string): Thread {
  const existing = getDb().prepare(
    'SELECT * FROM threads WHERE project_id = ? AND name = ?',
  ).get(projectId, GENERAL_THREAD_NAME) as Thread | undefined;

  if (existing) return existing;

  const now = new Date().toISOString();
  const thread: Thread = {
    id: generateId(),
    project_id: projectId,
    name: GENERAL_THREAD_NAME,
    status: 'active',
    summary: '',
    created_by: 'system',
    created_at: now,
    updated_at: now,
  };
  insertThread(thread);
  return thread;
}

// ── FASE A v0.3.3 — token usage ────────────────────────────────

export interface TokenUsageRow {
  id: number;
  project_id: string;
  peer_id: string | null;
  role: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  turn_uuid: string | null;
  session_uuid: string | null;
  created_at: string;
}

export interface TokenUsageInsert {
  project_id: string;
  peer_id?: string | null;
  role?: string;
  model?: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  turn_uuid?: string | null;
  session_uuid?: string | null;
  created_at?: string;
}

// Idempotent insert keyed on turn_uuid. The JSONL tailer may re-read a
// file after broker restart; UNIQUE(turn_uuid) makes the second insert
// a no-op so we never double-count a turn. Rows without a turn_uuid
// (e.g. manual POST /api/log-completion) are always inserted.
export function insertTokenUsage(row: TokenUsageInsert): { inserted: boolean } {
  const now = row.created_at ?? new Date().toISOString();
  try {
    const result = getDb().prepare(`
      INSERT INTO token_usage (
        project_id, peer_id, role, model,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        turn_uuid, session_uuid, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.project_id,
      row.peer_id ?? null,
      row.role ?? '',
      row.model ?? '',
      row.input_tokens,
      row.output_tokens,
      row.cache_creation_tokens ?? 0,
      row.cache_read_tokens ?? 0,
      row.turn_uuid ?? null,
      row.session_uuid ?? null,
      now,
    );
    return { inserted: result.changes > 0 };
  } catch (e) {
    // SQLITE_CONSTRAINT_UNIQUE: turn_uuid already present → idempotent skip.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('UNIQUE constraint failed')) return { inserted: false };
    throw e;
  }
}

export function selectTokenUsageSince(
  projectId: string,
  sinceIso: string,
): TokenUsageRow[] {
  return getDb().prepare(`
    SELECT * FROM token_usage
    WHERE project_id = ? AND created_at >= ?
    ORDER BY created_at ASC
  `).all(projectId, sinceIso) as TokenUsageRow[];
}
