import Database from 'better-sqlite3';
import { ACC_DB, ensureDirectories } from '../shared/config.js';
import type { Peer, Message, LogEntry, SharedStateEntry, MessageType } from '../shared/types.js';

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

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'message',
      text TEXT NOT NULL,
      metadata TEXT,
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
      sent_at TEXT NOT NULL,
      session_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_log_project ON message_log(project_id);
    CREATE INDEX IF NOT EXISTS idx_log_session ON message_log(session_id);
  `);

  return db;
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
): number {
  const result = getDb().prepare(`
    INSERT INTO messages (project_id, from_id, to_id, type, text, metadata, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, fromId, toId, type, text, metadata, sentAt);
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
): void {
  getDb().prepare(`
    INSERT INTO message_log (project_id, from_id, from_role, to_id, to_role, type, text, metadata, sent_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, fromId, fromRole, toId, toRole, type, text, metadata, sentAt, sessionId);
}

export function selectHistory(
  projectId: string,
  options?: { role?: string; type?: MessageType; limit?: number; session_id?: string },
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
