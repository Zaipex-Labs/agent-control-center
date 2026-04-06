// ── Message types ──────────────────────────────────────────────

export type MessageType =
  | 'message'
  | 'question'
  | 'response'
  | 'contract_update'
  | 'notification'
  | 'task_request'
  | 'task_complete';

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
}

// ── Project config (persisted as JSON) ─────────────────────────

export interface AgentConfig {
  role: string;
  name?: string;
  cwd: string;
  agent_cmd: string;
  agent_args: string[];
  instructions: string;
}

export interface ProjectConfig {
  name: string;
  description: string;
  created_at: string;
  agents: AgentConfig[];
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
}

export interface SendToRoleRequest {
  project_id: string;
  from_id: string;
  role: string;
  type?: MessageType;
  text: string;
  metadata?: string;
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
  type?: MessageType;
  limit?: number;
  session_id?: string;
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
