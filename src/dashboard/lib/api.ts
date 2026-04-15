import type {
  Peer,
  LogEntry,
  Thread,
  Project,
  HealthResponse,
  SharedStateEntry,
  MessageType,
} from './types';

async function apiFetch<T>(path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as { error?: string }).error ?? `API error ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(path);
  if (!resp.ok) {
    throw new Error(`GET ${path} failed: ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

// ── Health ────────────────────────────────────────────────────

export function getHealth(): Promise<HealthResponse> {
  return apiGet<HealthResponse>('/health');
}

// ── Projects ──────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const resp = await apiGet<{ projects: Project[] }>('/api/projects');
  return resp.projects;
}

// ── Dashboard peer registration ───────────────────────────────

export async function registerDashboard(projectId: string): Promise<{ id: string; name: string }> {
  // Use PID 1 (init) which is always alive, so cleanup won't remove us
  return apiFetch<{ id: string; name: string }>('register', {
    project_id: projectId,
    pid: 1,
    cwd: '/',
    role: 'user',
    name: 'Dashboard',
    agent_type: 'dashboard',
    summary: 'Web dashboard',
  });
}

export async function unregisterDashboard(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('unregister', { id }).catch(() => {});
}

// ── File browser ──────────────────────────────────────────────

export interface BrowseEntry {
  name: string;
  path: string;
}

export async function browseFolders(path?: string): Promise<{ path: string; folders: BrowseEntry[] }> {
  const params = path ? `?path=${encodeURIComponent(path)}` : '';
  return apiGet<{ path: string; folders: BrowseEntry[] }>(`/api/browse${params}`);
}

// ── Project control ───────────────────────────────────────────

export async function createProject(name: string, description: string): Promise<{ ok: boolean; name: string }> {
  return apiFetch<{ ok: boolean; name: string }>('project/create', { name, description });
}

export async function addAgent(
  projectId: string,
  role: string,
  cwd: string,
  name?: string,
  instructions?: string,
): Promise<void> {
  await apiFetch<{ ok: boolean }>('project/add-agent', {
    project_id: projectId, role, cwd, name, instructions,
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('project/delete', { project_id: projectId });
}

export async function deleteThread(projectId: string, threadId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('threads/delete', {
    project_id: projectId,
    thread_id: threadId,
  });
}

export async function updateProject(
  projectId: string,
  description: string,
  agents: Array<{ role: string; cwd: string; name?: string; instructions?: string; avatar?: string }>,
): Promise<void> {
  await apiFetch<{ ok: boolean }>('project/update', {
    project_id: projectId, description, agents,
  });
}

export async function projectUp(projectId: string): Promise<{ ok: boolean; strategy: string; agents: number }> {
  return apiFetch<{ ok: boolean; strategy: string; agents: number }>('project/up', {
    project_id: projectId,
  });
}

export async function projectDown(projectId: string): Promise<{ ok: boolean; killed: number }> {
  return apiFetch<{ ok: boolean; killed: number }>('project/down', {
    project_id: projectId,
  });
}

export async function saveResume(projectId: string): Promise<{ ok: boolean; snapshotted: number }> {
  return apiFetch<{ ok: boolean; snapshotted: number }>('project/save-resume', {
    project_id: projectId,
  });
}

// ── Peers ─────────────────────────────────────────────────────

export async function listPeers(projectId: string): Promise<Peer[]> {
  return apiFetch<Peer[]>('list-peers', {
    project_id: projectId,
    scope: 'project',
  });
}

// ── Threads ───────────────────────────────────────────────────

export async function listThreads(projectId: string, status?: string): Promise<Thread[]> {
  const resp = await apiFetch<{ threads: Thread[] }>('threads/list', {
    project_id: projectId,
    status,
  });
  return resp.threads;
}

export async function createThread(projectId: string, name: string): Promise<{ id: string; name: string }> {
  return apiFetch<{ id: string; name: string }>('threads/create', {
    project_id: projectId,
    name,
    created_by: 'user',
  });
}

export async function searchThreads(projectId: string, query: string): Promise<{ threads: Thread[]; messages: unknown[] }> {
  return apiFetch<{ threads: Thread[]; messages: unknown[] }>('threads/search', {
    project_id: projectId,
    query,
  });
}

export async function getThreadSummary(threadId: string): Promise<string> {
  const resp = await apiFetch<{ summary: string }>('threads/summary', {
    thread_id: threadId,
  });
  return resp.summary;
}

// ── Messages / History ────────────────────────────────────────

export async function getHistory(
  projectId: string,
  threadId?: string,
  limit?: number,
): Promise<LogEntry[]> {
  const resp = await apiFetch<{ messages: LogEntry[] }>('get-history', {
    project_id: projectId,
    thread_id: threadId,
    limit,
  });
  return resp.messages;
}

export async function sendMessage(
  projectId: string,
  fromId: string,
  toId: string,
  text: string,
  threadId?: string,
  type: MessageType = 'message',
): Promise<void> {
  await apiFetch<{ ok: boolean }>('send-message', {
    project_id: projectId,
    from_id: fromId,
    to_id: toId,
    text,
    thread_id: threadId,
    type,
  });
}

export async function sendToRole(
  projectId: string,
  fromId: string,
  role: string,
  text: string,
  threadId?: string,
  type: MessageType = 'message',
): Promise<number> {
  const resp = await apiFetch<{ ok: boolean; sent_to: number }>('send-to-role', {
    project_id: projectId,
    from_id: fromId,
    role,
    text,
    thread_id: threadId,
    type,
  });
  return resp.sent_to;
}

// ── Shared State ──────────────────────────────────────────────

export async function getSharedState(
  projectId: string,
  namespace: string,
  key: string,
): Promise<SharedStateEntry> {
  return apiFetch<SharedStateEntry>('shared/get', {
    project_id: projectId,
    namespace,
    key,
  });
}

export async function listSharedKeys(projectId: string, namespace: string): Promise<string[]> {
  const resp = await apiFetch<{ keys: string[] }>('shared/list', {
    project_id: projectId,
    namespace,
  });
  return resp.keys;
}

// ── Modified files (git-polled per agent cwd) ────────────────

export interface ModifiedFile {
  path: string;
  status: string;
  role: string;
  name: string;
  cwd: string;
}

export async function listModifiedFiles(projectId: string): Promise<ModifiedFile[]> {
  const resp = await apiFetch<{ files: ModifiedFile[] }>('project/modified-files', {
    project_id: projectId,
  });
  return resp.files;
}
