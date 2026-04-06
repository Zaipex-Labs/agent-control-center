import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateId, getDefaultName } from '../shared/utils.js';
import { tmuxNotify } from './tmux.js';
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
} from './database.js';

// ── Helpers ────────────────────────────────────────────────────

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { ok: false, error: message }, status);
}

export function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
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

// ── Health ─────────────────────────────────────────────────────

export function handleHealth(res: ServerResponse): void {
  json(res, {
    status: 'ok',
    peers: countPeers(),
    pending_messages: countPendingMessages(),
  });
}

// ── Peers ──────────────────────────────────────────────────────

export function handleRegister(body: unknown, res: ServerResponse): void {
  const b = body as RegisterRequest;
  if (!b.project_id || !b.cwd || b.pid == null) {
    return error(res, 'Missing required fields: project_id, cwd, pid');
  }

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

  deletePeer(b.id);
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

  const toPeer = selectPeerById(b.to_id);
  if (!toPeer) return error(res, `Peer not found: ${b.to_id}`, 404);

  const fromPeer = selectPeerById(b.from_id);
  if (!fromPeer) return error(res, `Peer not found: ${b.from_id}`, 404);

  const type: MessageType = b.type ?? 'message';
  const now = new Date().toISOString();
  const metadata = b.metadata ?? null;

  console.error(`[broker:send-message] from=${b.from_id} (${fromPeer.role}) to=${b.to_id} (${toPeer.role})`);

  insertMessage(b.project_id, b.from_id, b.to_id, type, b.text, metadata, now);
  insertLogEntry(
    b.project_id, b.from_id, fromPeer.role, b.to_id, toPeer.role,
    type, b.text, metadata, now, fromPeer.id,
  );

  // Best-effort tmux notification to target pane
  if (toPeer.role) {
    tmuxNotify(b.project_id, toPeer.role, fromPeer.name, fromPeer.role);
  }

  json(res, { ok: true });
}

export function handleSendToRole(body: unknown, res: ServerResponse): void {
  const b = body as SendToRoleRequest;
  if (!b.project_id || !b.from_id || !b.role || !b.text) {
    return error(res, 'Missing required fields: project_id, from_id, role, text');
  }

  const fromPeer = selectPeerById(b.from_id);
  if (!fromPeer) return error(res, `Peer not found: ${b.from_id}`, 404);

  const targets = selectPeersByRole(b.project_id, b.role);
  const type: MessageType = b.type ?? 'message';
  const now = new Date().toISOString();
  const metadata = b.metadata ?? null;

  console.error(`[broker:send-to-role] from=${b.from_id} (role=${fromPeer.role}) target_role=${b.role} project=${b.project_id}`);
  console.error(`[broker:send-to-role] found ${targets.length} peer(s) with role "${b.role}":`);
  for (const target of targets) {
    console.error(`[broker:send-to-role]   -> id=${target.id} role=${target.role} pid=${target.pid}`);
  }

  // Track roles we've already injected into (avoid duplicate send-keys for same role)
  const injectedRoles = new Set<string>();

  for (const target of targets) {
    console.error(`[broker:send-to-role] inserting message: from=${b.from_id} to=${target.id} (${target.role})`);
    insertMessage(b.project_id, b.from_id, target.id, type, b.text, metadata, now);
    insertLogEntry(
      b.project_id, b.from_id, fromPeer.role, target.id, target.role,
      type, b.text, metadata, now, fromPeer.id,
    );

    // Best-effort tmux notification (once per role/window)
    if (target.role && !injectedRoles.has(target.role)) {
      tmuxNotify(b.project_id, target.role, fromPeer.name, fromPeer.role);
      injectedRoles.add(target.role);
    }
  }

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
