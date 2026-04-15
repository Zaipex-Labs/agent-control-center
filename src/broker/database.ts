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
}

export function getDb(): Database.Database {
  return db;
}

// ── Peers ──────────────────────────────────────────────────────

export function insertPeer(peer: Peer): void {
  getDb().prepare(`
    INSERT INTO peers (id, project_id, pid, name, role, agent_type, cwd, git_root, git_branch, tty, summary, registered_at, last_seen)
    VALUES (@id, @project_id, @pid, @name, @role, @agent_type, @cwd, @git_root, @git_branch, @tty, @summary, @registered_at, @last_seen)
  `).run(peer);
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
  options?: { role?: string; type?: MessageType; limit?: number; session_id?: string; thread_id?: string },
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
