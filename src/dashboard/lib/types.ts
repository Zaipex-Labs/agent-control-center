export type MessageType =
  | 'message'
  | 'question'
  | 'response'
  | 'contract_update'
  | 'notification'
  | 'task_request'
  | 'task_complete';

export type ThreadStatus = 'active' | 'archived';

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

export interface Thread {
  id: string;
  project_id: string;
  name: string;
  status: ThreadStatus;
  summary: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SharedStateEntry {
  value: string;
  updated_by: string;
  updated_at: string;
}

export interface AgentConfig {
  role: string;
  name?: string;
  cwd: string;
  agent_cmd: string;
  agent_args: string[];
  instructions: string;
  avatar?: string;
}

export interface Project {
  name: string;
  description: string;
  created_at: string;
  agents: AgentConfig[];
  active_peers: number;
  peers: Peer[];
  tmux_running?: boolean;
}

export interface HealthResponse {
  status: 'ok';
  peers: number;
  pending_messages: number;
}

export type BrokerEvent =
  | 'peer:connected'
  | 'peer:disconnected'
  | 'message:new'
  | 'shared:updated'
  | 'thread:created'
  | 'thread:updated';

export interface WsEvent {
  event: BrokerEvent;
  data: unknown;
}
