import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { PROJECTS_DIR, ensureDirectories } from '../shared/config.js';
import { generateId, getDefaultName } from '../shared/utils.js';
import { registerMcpServer, killTmuxSession, hasTmuxSession as hasTmuxSess } from '../cli/spawn.js';
import { spawnWebAgent, killAllWebAgents } from './terminal.js';
import { tmuxNotify, tmuxInjectWithContext } from './tmux.js';
import { broadcast } from './websocket.js';
import type {
  RegisterRequest,
  HeartbeatRequest,
  UnregisterRequest,
  SetSummaryRequest,
  SetRoleRequest,
  ListPeersRequest,
  SendMessageRequest,
  SendToRoleRequest,
  PollMessagesRequest,
  GetHistoryRequest,
  SharedSetRequest,
  SharedGetRequest,
  SharedListRequest,
  SharedDeleteRequest,
  CreateThreadRequest,
  ThreadListRequest,
  ThreadGetRequest,
  ThreadUpdateRequest,
  ThreadSearchRequest,
  ThreadSummaryRequest,
  Peer,
  MessageType,
} from '../shared/types.js';
import {
  insertPeer,
  updateLastSeen,
  updateSummary,
  updateRole,
  deletePeer,
  selectPeerById,
  selectPeersByProject,
  selectAllPeers,
  selectPeersByRole,
  selectPeersByCwd,
  selectPeersByGitRoot,
  insertMessage,
  selectUndelivered,
  markDelivered,
  insertLogEntry,
  selectHistory,
  setSharedState,
  getSharedState,
  listSharedKeys,
  deleteSharedState,
  countPeers,
  countPendingMessages,
  insertThread,
  selectThreadsByProject,
  selectThreadById,
  updateThread,
  searchThreads,
  searchMessagesInThreads,
  selectLogByThread,
  touchThread,
} from './database.js';

// ── Helpers ────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { ok: false, error: message }, status);
}

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

export function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// ── Input validation ──────────────────────────────────────────

const SAFE_ID_REGEX = /^[a-zA-Z0-9_.\-]+$/;
const MAX_TEXT_LENGTH = 100_000; // 100KB per message text

function isSafeIdentifier(value: string): boolean {
  return SAFE_ID_REGEX.test(value) && value.length <= 128;
}

function validateIdentifiers(res: ServerResponse, ...values: Array<{ name: string; value: unknown }>): boolean {
  for (const { name, value } of values) {
    if (typeof value === 'string' && value.length > 0 && !isSafeIdentifier(value)) {
      error(res, `Invalid ${name}: only alphanumeric, dash, underscore, and dot allowed`);
      return false;
    }
  }
  return true;
}

// ── Health ─────────────────────────────────────────────────────

export function handleHealth(res: ServerResponse): void {
  json(res, {
    status: 'ok',
    peers: countPeers(),
    pending_messages: countPendingMessages(),
  });
}

// ── Projects ──────────────────────────────────────────────────

export function handleBrowse(query: string, res: ServerResponse): void {
  const params = new URLSearchParams(query);
  const home = process.env['HOME'] ?? '/';
  const raw = params.get('path') || home;

  // Prevent path traversal outside resolved path
  const resolved = join('/', raw).replace(/\.\./g, '');
  const target = raw.startsWith('/') ? resolved : join(home, resolved);

  try {
    const entries = readdirSync(target, { withFileTypes: true });
    const folders: Array<{ name: string; path: string }> = [];

    // Parent directory
    if (target !== '/') {
      folders.push({ name: '..', path: join(target, '..') });
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip hidden folders unless the requested path itself is hidden
      if (entry.name.startsWith('.')) continue;
      folders.push({ name: entry.name, path: join(target, entry.name) });
    }

    folders.sort((a, b) => {
      if (a.name === '..') return -1;
      if (b.name === '..') return 1;
      return a.name.localeCompare(b.name);
    });

    json(res, { path: target, folders });
  } catch {
    json(res, { path: target, folders: [], error: 'Cannot read directory' }, 400);
  }
}

export function handleListProjects(res: ServerResponse): void {
  ensureDirectories();
  try {
    const projects = readdirSync(PROJECTS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const config = JSON.parse(readFileSync(join(PROJECTS_DIR, f), 'utf-8'));
        const allPeers = selectPeersByProject(config.name);
        // Filter out zombie peers (process dead) and dashboard peers
        const livePeers = allPeers.filter(p => {
          if (p.agent_type === 'dashboard') return false;
          try { process.kill(p.pid, 0); return true; } catch { return false; }
        });
        return { ...config, active_peers: livePeers.length, peers: livePeers };
      })
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    json(res, { projects });
  } catch {
    json(res, { projects: [] });
  }
}

export function handleCreateProject(body: unknown, res: ServerResponse): void {
  const b = body as { name?: string; description?: string };
  if (!b.name) return error(res, 'Missing required field: name');

  ensureDirectories();
  const configPath = join(PROJECTS_DIR, `${b.name}.json`);
  if (existsSync(configPath)) return error(res, `Project already exists: ${b.name}`);

  const config = {
    name: b.name,
    description: b.description ?? '',
    created_at: new Date().toISOString(),
    agents: [],
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  json(res, { ok: true, name: b.name });
}

export function handleAddAgent(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string; role?: string; cwd?: string; name?: string; instructions?: string };
  if (!b.project_id || !b.role || !b.cwd) return error(res, 'Missing required fields: project_id, role, cwd');

  const configPath = join(PROJECTS_DIR, `${b.project_id}.json`);
  if (!existsSync(configPath)) return error(res, `Project not found: ${b.project_id}`, 404);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (config.agents.some((a: { role: string }) => a.role === b.role)) {
    return error(res, `Agent with role '${b.role}' already exists`);
  }

  config.agents.push({
    role: b.role,
    cwd: b.cwd,
    name: b.name ?? '',
    agent_cmd: 'claude',
    agent_args: [],
    instructions: b.instructions ?? '',
  });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  json(res, { ok: true });
}

export function handleProjectUp(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string };
  if (!b.project_id) return error(res, 'Missing required field: project_id');

  const configPath = join(PROJECTS_DIR, `${b.project_id}.json`);
  if (!existsSync(configPath)) return error(res, `Project not found: ${b.project_id}`, 404);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (!config.agents || config.agents.length === 0) {
    return error(res, 'Project has no agents configured');
  }

  // Clean up zombie peers from previous runs
  const stalePeers = selectPeersByProject(b.project_id);
  for (const peer of stalePeers) {
    if (peer.agent_type === 'dashboard') continue;
    try { process.kill(peer.pid, 0); } catch {
      deletePeer(peer.id);
    }
  }

  try {
    registerMcpServer();
  } catch (e) {
    return error(res, `Failed to register MCP server: ${e}`);
  }

  // Kill existing tmux session if it exists (stale from previous run)
  if (hasTmuxSess(b.project_id)) {
    killTmuxSession(b.project_id);
  }

  // Kill existing web agents
  killAllWebAgents(b.project_id);

  const agentNames = config.agents.map((a: { role: string; name?: string }) =>
    a.name || getDefaultName(a.role)
  );

  try {
    // Spawn agents as direct child processes (web mode)
    for (const agent of config.agents) {
      spawnWebAgent(b.project_id, agent.role, agent.cwd, agent.name);
    }
    json(res, {
      ok: true,
      strategy: 'web',
      agents: config.agents.length,
      agent_roles: config.agents.map((a: { role: string }) => a.role),
      agent_names: agentNames,
    });
  } catch (e) {
    error(res, `Failed to start agents: ${e}`);
  }
}

export function handleProjectDown(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string };
  if (!b.project_id) return error(res, 'Missing required field: project_id');

  const peers = selectPeersByProject(b.project_id);
  let killed = 0;

  for (const peer of peers) {
    try {
      process.kill(peer.pid, 'SIGTERM');
      killed++;
    } catch {
      // Process already dead
    }
    deletePeer(peer.id);
  }

  // Kill tmux session (if started via CLI)
  if (hasTmuxSess(b.project_id)) {
    killTmuxSession(b.project_id);
  }

  // Kill web agents (if started via browser)
  killAllWebAgents(b.project_id);

  // Broadcast disconnections
  for (const peer of peers) {
    broadcast('peer:disconnected', { id: peer.id }, b.project_id);
  }

  json(res, { ok: true, killed });
}

// ── Peers ──────────────────────────────────────────────────────

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

export function handleSetRole(body: unknown, res: ServerResponse): void {
  const b = body as SetRoleRequest;
  if (!b.id || b.role == null) return error(res, 'Missing required fields: id, role');

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

  json(res, peers);
}

// ── Messages ───────────────────────────────────────────────────

export function handleSendMessage(body: unknown, res: ServerResponse): void {
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

  const type: MessageType = b.type ?? 'message';
  const now = new Date().toISOString();
  const metadata = b.metadata ?? null;

  let threadId = b.thread_id ?? null;

  // Auto-inherit thread_id: if no thread specified, check if the target sent us
  // a message with a thread_id in the last 5 minutes (this is a reply)
  if (!threadId) {
    const recentHistory = selectHistory(b.project_id, { limit: 20 });
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const parentMsg = recentHistory.find(m =>
      m.from_id === b.to_id &&
      (m.to_id === b.from_id || m.to_role === fromPeer.role) &&
      m.thread_id &&
      new Date(m.sent_at).getTime() > fiveMinAgo
    );
    if (parentMsg?.thread_id) {
      threadId = parentMsg.thread_id;
      console.error(`[broker:send-message] auto-inherited thread_id=${threadId} from recent message`);
    }
  }

  console.error(`[broker:send-message] from=${b.from_id} (${fromPeer.role}) to=${b.to_id} (${toPeer.role}) thread=${threadId}`);

  insertMessage(b.project_id, b.from_id, b.to_id, type, b.text, metadata, now, threadId);
  insertLogEntry(
    b.project_id, b.from_id, fromPeer.role, b.to_id, toPeer.role,
    type, b.text, metadata, now, fromPeer.id, threadId,
  );

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
  }, b.project_id);

  json(res, { ok: true });
}

export function handleSendToRole(body: unknown, res: ServerResponse): void {
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

  const targets = selectPeersByRole(b.project_id, b.role);
  const type: MessageType = b.type ?? 'message';
  const now = new Date().toISOString();
  const metadata = b.metadata ?? null;
  let threadId = b.thread_id ?? null;

  // Auto-inherit thread_id from recent messages to this sender
  if (!threadId) {
    const recentHistory = selectHistory(b.project_id, { limit: 20 });
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const parentMsg = recentHistory.find(m =>
      m.to_id === b.from_id &&
      m.thread_id &&
      new Date(m.sent_at).getTime() > fiveMinAgo
    );
    if (parentMsg?.thread_id) {
      threadId = parentMsg.thread_id;
      console.error(`[broker:send-to-role] auto-inherited thread_id=${threadId}`);
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
    insertMessage(b.project_id, b.from_id, target.id, type, b.text, metadata, now, threadId);
    insertLogEntry(
      b.project_id, b.from_id, fromPeer.role, target.id, target.role,
      type, b.text, metadata, now, fromPeer.id, threadId,
    );

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
  }, b.project_id);

  json(res, { ok: true, sent_to: targets.length });
}

const MESSAGE_TTL_MS = 30 * 60 * 1000; // 30 minutes

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
  const b = body as GetHistoryRequest;
  if (!b.project_id) return error(res, 'Missing required field: project_id');

  const messages = selectHistory(b.project_id, {
    role: b.role,
    type: b.type,
    limit: b.limit,
    session_id: b.session_id,
    thread_id: b.thread_id,
  });

  json(res, { messages });
}

// ── Shared state ───────────────────────────────────────────────

export function handleSharedSet(body: unknown, res: ServerResponse): void {
  const b = body as SharedSetRequest;
  if (!b.project_id || !b.namespace || !b.key || b.value == null || !b.peer_id) {
    return error(res, 'Missing required fields: project_id, namespace, key, value, peer_id');
  }

  setSharedState(b.project_id, b.namespace, b.key, b.value, b.peer_id, new Date().toISOString());
  broadcast('shared:updated', { namespace: b.namespace, key: b.key }, b.project_id);
  json(res, { ok: true });
}

export function handleSharedGet(body: unknown, res: ServerResponse): void {
  const b = body as SharedGetRequest;
  if (!b.project_id || !b.namespace || !b.key) {
    return error(res, 'Missing required fields: project_id, namespace, key');
  }

  const entry = getSharedState(b.project_id, b.namespace, b.key);
  if (!entry) return json(res, { error: 'not found' }, 404);

  json(res, { value: entry.value, updated_by: entry.updated_by, updated_at: entry.updated_at });
}

export function handleSharedList(body: unknown, res: ServerResponse): void {
  const b = body as SharedListRequest;
  if (!b.project_id || !b.namespace) {
    return error(res, 'Missing required fields: project_id, namespace');
  }

  json(res, { keys: listSharedKeys(b.project_id, b.namespace) });
}

export function handleSharedDelete(body: unknown, res: ServerResponse): void {
  const b = body as SharedDeleteRequest;
  if (!b.project_id || !b.namespace || !b.key || !b.peer_id) {
    return error(res, 'Missing required fields: project_id, namespace, key, peer_id');
  }

  deleteSharedState(b.project_id, b.namespace, b.key);
  json(res, { ok: true });
}

// ── Threads ───────────────────────────────────────────────────

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
  json(res, { threads });
}

export function handleGetThread(body: unknown, res: ServerResponse): void {
  const b = body as ThreadGetRequest;
  if (!b.thread_id) {
    return error(res, 'Missing required field: thread_id');
  }

  // Search across all projects since we only have thread_id
  const thread = selectThreadById('', b.thread_id);
  if (!thread) return error(res, `Thread not found: ${b.thread_id}`, 404);

  json(res, thread);
}

export function handleUpdateThread(body: unknown, res: ServerResponse): void {
  const b = body as ThreadUpdateRequest;
  if (!b.thread_id) {
    return error(res, 'Missing required field: thread_id');
  }

  const updated = updateThread(b.project_id ?? '', b.thread_id, {
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
  const b = body as ThreadSummaryRequest;
  if (!b.thread_id) {
    return error(res, 'Missing required field: thread_id');
  }

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
