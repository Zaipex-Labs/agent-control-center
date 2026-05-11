// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Wire-protocol types shared by broker, MCP server, and dashboard.
//
// [Q-4] This file is the single source of truth for any shape that
// crosses the broker boundary. It MUST NOT import node-only modules
// (fs, path, crypto, etc.) so the dashboard bundle can pull it in
// without polluting the browser graph.
//
// `src/shared/types.ts` re-exports from here. The dashboard side at
// `src/dashboard/lib/types.ts` does the same. Add new wire shapes
// here, not in either of the re-export shims.

export type { Attachment } from './attachments.js';

// ── Message types ──────────────────────────────────────────────

export type MessageType =
  | 'message'
  | 'question'
  | 'response'
  | 'contract_update'
  | 'notification'
  | 'task_request'
  | 'task_complete';

// ── Thread types ──────────────────────────────────────────────

export type ThreadStatus = 'active' | 'archived';

export interface Thread {
  id: string;
  project_id: string;
  name: string;
  status: ThreadStatus;
  summary: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  // Roles that participated in this thread. Populated server-side on
  // list (handleListThreads), absent on bare DB reads.
  participants?: string[];
}

// ── Domain entities ────────────────────────────────────────────

export interface Peer {
  id: string;
  project_id: string;
  pid: number;
  name: string;
  role: string;
  agent_type: string;
  cwd: string;
  git_root: string | null;
  git_branch: string | null;
  tty: string | null;
  summary: string;
  // Optional. Format is either `dicebear:<seed>` (generated bottts svg) or
  // `data:image/...` (user-uploaded). Empty/undefined falls back to a
  // deterministic seed derived from `name` at render time.
  avatar?: string;
  registered_at: string;
  last_seen: string;
}

export interface Message {
  id: number;
  project_id: string;
  from_id: string;
  to_id: string;
  type: MessageType;
  text: string;
  metadata: string | null;
  thread_id: string | null;
  sent_at: string;
  delivered: number;
}

export interface LogEntry {
  id: number;
  project_id: string;
  from_id: string;
  from_role: string;
  to_id: string;
  to_role: string;
  type: MessageType;
  text: string;
  metadata: string | null;
  thread_id: string | null;
  sent_at: string;
  session_id: string;
}

export interface SharedStateEntry {
  project_id: string;
  namespace: string;
  key: string;
  value: string;
  updated_by: string;
  updated_at: string;
  // FASE A-1 (v0.3.0): populated only for the reserved `decisions`
  // namespace (Team Memory). Stays NULL for every other namespace.
  // `updated_by` / `updated_at` already track the last editor; these
  // additional fields preserve the *original* author and creation time
  // across edits, which is the part decisions care about.
  author_role?: string | null;
  author_peer_id?: string | null;
  created_at?: string | null;
}

// ── Powers (v0.3.2 FASE A-1) ──────────────────────────────────
//
// A "power" attaches an external MCP server to a specific agent at
// spawn time (e.g. an agent with the `git` power gets the
// mcp-server-git MCP tools alongside the ACC tools). The full
// definition (command, args, etc.) lives in the server-only registry
// at src/shared/powers.ts. This wire shape is the *public* face the
// dashboard renders — name, description, and the env vars the user
// must populate before the power will work.
export interface Power {
  name: string;
  description: string;
  // Env var names the agent's process must inherit. Empty when the
  // power has no env requirements. The dashboard surfaces these as a
  // hint when the power is toggled on.
  requiredEnv: string[];
}

// ── Project config (persisted as JSON) ─────────────────────────

export interface AgentConfig {
  role: string;
  name?: string;
  cwd: string;
  agent_cmd: string;
  agent_args: string[];
  instructions: string;
  avatar?: string;
  model?: string;
  // FASE A-1 (v0.3.2): canonical power names (e.g. ['git', 'postgres']).
  // The spawner resolves each name against POWERS_REGISTRY at boot;
  // unknown names are warned + skipped (see src/cli/spawn.ts).
  powers?: string[];
}

export interface ProjectConfig {
  name: string;
  description: string;
  created_at: string;
  agents: AgentConfig[];
}

// Project summary returned by `/api/projects` (list endpoint). Differs
// from ProjectConfig in that it augments the persisted shape with
// runtime fields (active_peers, peers, tmux_running).
export interface Project {
  name: string;
  description: string;
  created_at: string;
  agents: AgentConfig[];
  active_peers: number;
  peers: Peer[];
  tmux_running?: boolean;
}

// ── Broker request / response types ────────────────────────────

// Peers

export interface RegisterRequest {
  pid: number;
  cwd: string;
  git_root?: string;
  git_branch?: string;
  tty?: string;
  name?: string;
  role: string;
  agent_type?: string;
  summary?: string;
  project_id: string;
  avatar?: string;
}

export interface RegisterResponse {
  id: string;
  name: string;
}

export interface HeartbeatRequest {
  id: string;
}

export interface UnregisterRequest {
  id: string;
}

export interface SetSummaryRequest {
  id: string;
  summary: string;
}

export interface SetRoleRequest {
  id: string;
  role: string;
}

export type PeerScope = 'project' | 'machine' | 'directory' | 'repo';

export interface ListPeersRequest {
  project_id: string;
  scope?: PeerScope;
  cwd?: string;
  git_root?: string;
  exclude_id?: string;
  role?: string;
}

// Messages

export interface SendMessageRequest {
  project_id: string;
  from_id: string;
  to_id: string;
  type?: MessageType;
  text: string;
  metadata?: string;
  thread_id?: string;
}

export interface SendToRoleRequest {
  project_id: string;
  from_id: string;
  role: string;
  type?: MessageType;
  text: string;
  metadata?: string;
  thread_id?: string;
}

export interface SendToRoleResponse {
  ok: true;
  sent_to: number;
}

export interface PollMessagesRequest {
  id: string;
}

export interface PollMessagesResponse {
  messages: Message[];
}

export interface GetHistoryRequest {
  project_id: string;
  role?: string;
  // FASE C-3 / M-11 (v0.3.0): the wire schema is now any string;
  // MessageType remains the canonical enum for typed callsites.
  type?: MessageType | string;
  limit?: number;
  session_id?: string;
  thread_id?: string;
  // FASE D-1 / M-5 (v0.3.0): paginate by sent_at. Both bounds are
  // ISO timestamps; the server applies them as `sent_at < before` /
  // `sent_at > after` so the agent can scroll back without re-fetching.
  before?: string;
  after?: string;
}

export interface GetHistoryResponse {
  messages: LogEntry[];
}

// Shared state

export interface SharedSetRequest {
  project_id: string;
  namespace: string;
  key: string;
  value: string;
  peer_id: string;
}

export interface SharedGetRequest {
  project_id: string;
  namespace: string;
  key: string;
}

export interface SharedGetResponse {
  value: string;
  updated_by: string;
  updated_at: string;
}

export interface SharedListRequest {
  project_id: string;
  namespace: string;
}

export interface SharedListResponse {
  keys: string[];
}

export interface SharedDeleteRequest {
  project_id: string;
  namespace: string;
  key: string;
  peer_id: string;
}

// Generic responses

export interface OkResponse {
  ok: true;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

export interface HealthResponse {
  status: 'ok';
  peers: number;
  pending_messages: number;
}

// ── Thread request / response types ───────────────────────────

export interface CreateThreadRequest {
  project_id: string;
  name: string;
  created_by: string;
}

export interface CreateThreadResponse {
  id: string;
  name: string;
}

export interface ThreadListRequest {
  project_id: string;
  status?: ThreadStatus;
}

export interface ThreadListResponse {
  threads: Thread[];
}

export interface ThreadGetRequest {
  project_id: string;
  thread_id: string;
}

export interface ThreadUpdateRequest {
  project_id: string;
  thread_id: string;
  name?: string;
  status?: ThreadStatus;
  summary?: string;
}

export interface ThreadSearchRequest {
  project_id: string;
  query: string;
  limit?: number;
}

export interface ThreadSearchResponse {
  threads: Thread[];
  messages: MessageMatch[];
}

export interface MessageMatch {
  id: number;
  project_id: string;
  from_id: string;
  from_role: string;
  to_id: string;
  to_role: string;
  type: MessageType;
  text: string;
  thread_id: string;
  thread_name: string;
  sent_at: string;
}

export interface ThreadSummaryRequest {
  thread_id: string;
}

export interface ThreadSummaryResponse {
  summary: string;
}

// ── Realtime (WebSocket) events ───────────────────────────────

export type BrokerEvent =
  | 'peer:connected'
  | 'peer:disconnected'
  | 'message:new'
  | 'shared:updated'
  | 'thread:created'
  | 'thread:updated'
  | 'thread:deleted'
  | 'agent:status'
  // FASE C-1 (v0.3.2). Per-agent spawn progress events.
  | 'agent:spawning';

// FASE C-1 (v0.3.2) — phases of the spawn checklist.
// pty_ready: child process spawn() succeeded.
// mcp_ready: claude's banner appeared (MCP servers loaded).
// registered: the in-agent MCP server hit /api/register.
export type SpawnPhase = 'pty_ready' | 'mcp_ready' | 'registered';

export interface AgentSpawningEvent {
  role: string;
  phase: SpawnPhase;
}

export interface WsEvent {
  event: BrokerEvent;
  data: unknown;
}
