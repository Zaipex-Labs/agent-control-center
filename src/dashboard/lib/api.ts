// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import type {
  Peer,
  LogEntry,
  Thread,
  Project,
  HealthResponse,
  SharedGetResponse,
  MessageType,
  Attachment,
  Power,
} from './types';
export type { Attachment, Power };

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

// ── Blob attachments ──────────────────────────────────────────

// Blobs are now peer-scoped (see [H-2] in docs/audits/v0.2.1-audit.md):
// the browser must send X-Peer-Id and the broker checks that the blob's
// project matches the peer's project. We can't add headers to <img src>
// directly, so we fetch the bytes and wrap them in an object URL.
// `attachmentUrl(hash)` was removed — use `fetchBlobAsObjectUrl` via
// the useBlobUrl hook.
export async function fetchBlobAsObjectUrl(hash: string, peerId: string): Promise<string> {
  const resp = await fetch(`/api/blobs/${hash}`, {
    headers: { 'X-Peer-Id': peerId },
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText })) as {
      error?: string; code?: string;
    };
    throw new Error(err.code ? `${err.code}: ${err.error}` : (err.error ?? `Blob fetch failed: ${resp.status}`));
  }
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

// Upload a File from the browser. Returns the stored blob descriptor
// (hash + mime + name + size) ready to attach to a send-message call.
export async function uploadBlob(file: File): Promise<Attachment> {
  const resp = await fetch('/api/blobs/upload', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      // HTTP header values must be US-ASCII. Filenames with spaces or
      // accents (e.g. "diagrama arquitectura v2.png") break raw headers,
      // so we encode and let the broker decodeURIComponent on arrival.
      'X-Filename': encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error((err as { error?: string }).error ?? `Upload failed ${resp.status}`);
  }
  return resp.json() as Promise<Attachment>;
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

// B-1 v0.3.4 — one-click demo team for cold-landing onboarding.
// Returns `already_existed: true` if the demo project was already
// scaffolded, so the dashboard can just navigate to it instead of
// surfacing an error.
export async function createDemoProject(): Promise<{
  ok: boolean;
  name: string;
  already_existed?: boolean;
}> {
  return apiFetch<{ ok: boolean; name: string; already_existed?: boolean }>(
    'project/create-demo',
    {},
  );
}

// ── FASE A v0.3.3 — token usage ───────────────────────────────

export type TokenPeriod = 'today' | 'week' | 'month';

export interface TokensByAgent {
  role: string;
  peer_id: string | null;
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  total: number;
  turns: number;
}

export interface TokensTotal {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  total: number;
  turns: number;
}

export interface TokensByHour { hour: string; total: number }

export interface TokensTopTurn {
  turn_uuid: string | null;
  peer_id: string | null;
  role: string;
  model: string;
  total: number;
  created_at: string;
}

export interface TokensReport {
  period: TokenPeriod;
  since: string;
  by_agent: TokensByAgent[];
  total: TokensTotal;
  by_hour: TokensByHour[];
  top_turns: TokensTopTurn[];
}

export async function getProjectTokens(
  projectId: string,
  period: TokenPeriod = 'today',
): Promise<TokensReport> {
  return apiGet<TokensReport>(
    `/api/projects/${encodeURIComponent(projectId)}/tokens?period=${period}`,
  );
}

// FU-AH v0.3.4 — coord-overhead readout (count of inter-agent
// messages vs assistant turn count + pair breakdown). v0.3.5 will
// surface analysis/optimisation; v0.3.4 only ships the read shape.
export interface CoordOverheadPair {
  from_role: string;
  to_role: string;
  events: number;
}

export interface CoordOverheadReport {
  period: TokenPeriod;
  since: string;
  coord_events: number;
  total_turns: number;
  coord_ratio: number;
  by_pair: CoordOverheadPair[];
}

export async function getProjectCoordOverhead(
  projectId: string,
  period: TokenPeriod = 'today',
): Promise<CoordOverheadReport> {
  return apiGet<CoordOverheadReport>(
    `/api/projects/${encodeURIComponent(projectId)}/coord-overhead?period=${period}`,
  );
}

// FU-AE v0.4.0 — pre-send cost estimate. Returned shape mirrors
// CostEstimate in src/broker/cost-estimator.ts. The dashboard's
// Compose component fetches this on debounced text changes and
// renders an inline preview above the Send button. Confidence
// drives the visual treatment — see Compose.tsx.
export type CostConfidence = 'low' | 'medium' | 'high';

export interface CostEstimate {
  estimatedTurns: [number, number];
  estimatedCostUSD: [number, number];
  confidence: CostConfidence;
  sampleSize: number;
  basis: {
    agents: number;
    complexity: 'light' | 'normal' | 'heavy';
    source: 'synthetic-v0.3.3' | 'project-avg';
    avgUsdPerTurn?: number;
  };
}

export async function estimateMessageCost(
  projectId: string,
  message: string,
): Promise<CostEstimate> {
  const qs = new URLSearchParams({ message });
  return apiGet<CostEstimate>(
    `/api/projects/${encodeURIComponent(projectId)}/estimate-cost?${qs.toString()}`,
  );
}

// ── Dashboard peer registration ───────────────────────────────

export async function registerDashboard(
  projectId: string,
  avatar?: string,
): Promise<{ id: string; name: string }> {
  // Use PID 1 (init) which is always alive, so cleanup won't remove us
  return apiFetch<{ id: string; name: string }>('register', {
    project_id: projectId,
    pid: 1,
    cwd: '/',
    role: 'user',
    name: 'Dashboard',
    agent_type: 'dashboard',
    summary: 'Web dashboard',
    avatar,
  });
}

export async function unregisterDashboard(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('unregister', { id }).catch(() => {});
}

// One-shot CSRF token for /ws/terminal/<role> [F-3-B]. The token is
// bound to (project_id, role), expires in 60s, and is consumed on the
// next upgrade attempt. Returned token is carried via
// Sec-WebSocket-Protocol when opening the WebSocket.
export async function requestWsToken(
  projectId: string,
  role: string,
  peerId: string,
): Promise<string> {
  const resp = await apiFetch<{ ok: boolean; token: string }>('csrf/issue', {
    project_id: projectId,
    role,
    peer_id: peerId,
  });
  return resp.token;
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

// MED-8 (v0.4.0): /api/project/create now accepts both `project_id`
// (canonical) and `name` (legacy alias for one version). Dashboard
// uses the canonical form going forward; the broker still accepts
// `name` from older clients until v0.5.0+.
export async function createProject(name: string, description: string): Promise<{ ok: boolean; project_id: string; name: string }> {
  return apiFetch<{ ok: boolean; project_id: string; name: string }>('project/create', { project_id: name, description });
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

export async function deleteThread(projectId: string, threadId: string, peerId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>('threads/delete', {
    project_id: projectId,
    thread_id: threadId,
    peer_id: peerId,
  });
}

export async function updateProject(
  projectId: string,
  description: string,
  agents: Array<{
    role: string;
    cwd: string;
    name?: string;
    instructions?: string;
    avatar?: string;
    model?: string;
    // FASE A-1/A-3 (v0.3.2). Canonical power names.
    powers?: string[];
  }>,
): Promise<void> {
  await apiFetch<{ ok: boolean }>('project/update', {
    project_id: projectId, description, agents,
  });
}

// FASE A-3 (v0.3.2). Read-only — the powers registry lives in code
// (src/shared/powers.ts), the dashboard just renders it. Returns
// [] if the fetch fails so the editor degrades gracefully (existing
// agent.powers values still round-trip from the project config).
export async function listPowers(): Promise<Power[]> {
  try {
    const resp = await apiGet<{ powers: Power[] }>('/api/powers');
    return resp.powers ?? [];
  } catch {
    return [];
  }
}

export async function projectUp(projectId: string): Promise<{
  ok: boolean;
  strategy: string;
  agents: number;
  spawned?: number;
  reused?: number;
  agent_roles?: string[];
  agent_names?: string[];
}> {
  return apiFetch('project/up', {
    project_id: projectId,
  });
}

export async function projectDown(projectId: string): Promise<{ ok: boolean; killed: number }> {
  return apiFetch<{ ok: boolean; killed: number }>('project/down', {
    project_id: projectId,
  });
}

export async function saveResume(projectId: string, peerId: string): Promise<{ ok: boolean; snapshotted: number }> {
  return apiFetch<{ ok: boolean; snapshotted: number }>('project/save-resume', {
    project_id: projectId,
    peer_id: peerId,
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

export async function getThreadSummary(projectId: string, peerId: string, threadId: string): Promise<string> {
  const resp = await apiFetch<{ summary: string }>('threads/summary', {
    project_id: projectId,
    peer_id: peerId,
    thread_id: threadId,
  });
  return resp.summary;
}

// ── Messages / History ────────────────────────────────────────

export async function getHistory(
  projectId: string,
  peerId: string,
  threadId?: string,
  limit?: number,
): Promise<LogEntry[]> {
  const resp = await apiFetch<{ messages: LogEntry[] }>('get-history', {
    project_id: projectId,
    peer_id: peerId,
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
  attachments?: Attachment[],
): Promise<void> {
  await apiFetch<{ ok: boolean }>('send-message', {
    project_id: projectId,
    from_id: fromId,
    to_id: toId,
    text,
    thread_id: threadId,
    type,
    attachments,
  });
}

export async function sendToRole(
  projectId: string,
  fromId: string,
  role: string,
  text: string,
  threadId?: string,
  type: MessageType = 'message',
  attachments?: Attachment[],
): Promise<number> {
  const resp = await apiFetch<{ ok: boolean; sent_to: number }>('send-to-role', {
    project_id: projectId,
    from_id: fromId,
    role,
    text,
    thread_id: threadId,
    type,
    attachments,
  });
  return resp.sent_to;
}

// ── Shared State ──────────────────────────────────────────────

export async function getSharedState(
  projectId: string,
  peerId: string,
  namespace: string,
  key: string,
): Promise<SharedGetResponse> {
  return apiFetch<SharedGetResponse>('shared/get', {
    project_id: projectId,
    peer_id: peerId,
    namespace,
    key,
  });
}

export async function listSharedKeys(projectId: string, peerId: string, namespace: string): Promise<string[]> {
  const resp = await apiFetch<{ keys: string[] }>('shared/list', {
    project_id: projectId,
    peer_id: peerId,
    namespace,
  });
  return resp.keys;
}

// ── Project skills (B-3) ─────────────────────────────────────

export interface SkillFileMeta {
  filename: string;
  size: number;
  updated_at: string;
}

export async function listSkills(projectId: string, peerId: string): Promise<SkillFileMeta[]> {
  const resp = await apiFetch<{ files: SkillFileMeta[] }>('skills/list', {
    project_id: projectId, peer_id: peerId,
  });
  return resp.files;
}

// B-4 v0.3.4 — skills "marketplace" (minimal). Returns the three
// curated example skills the dashboard can preview + one-click-copy
// to a project. No auth — these are read-only static content.
export interface SkillExample {
  filename: string;
  description: string;
  content: string;
}

export async function listSkillExamples(): Promise<SkillExample[]> {
  const resp = await apiFetch<{ examples: SkillExample[] }>('skills/list-examples', {});
  return resp.examples;
}

export async function getSkill(
  projectId: string, peerId: string, filename: string,
): Promise<{ filename: string; content: string }> {
  return apiFetch<{ filename: string; content: string }>('skills/get', {
    project_id: projectId, peer_id: peerId, filename,
  });
}

export async function saveSkill(
  projectId: string, peerId: string, filename: string, content: string,
): Promise<{ ok: true; filename: string; size: number }> {
  return apiFetch<{ ok: true; filename: string; size: number }>('skills/save', {
    project_id: projectId, peer_id: peerId, filename, content,
  });
}

export async function deleteSkill(
  projectId: string, peerId: string, filename: string,
): Promise<void> {
  await apiFetch<{ ok: true }>('skills/delete', {
    project_id: projectId, peer_id: peerId, filename,
  });
}

// ── Modified files (git-polled per agent cwd) ────────────────

export interface ModifiedFile {
  path: string;
  status: string;
  role: string;
  name: string;
  cwd: string;
}

export async function listModifiedFiles(projectId: string, peerId: string): Promise<ModifiedFile[]> {
  const resp = await apiFetch<{ files: ModifiedFile[] }>('project/modified-files', {
    project_id: projectId,
    peer_id: peerId,
  });
  return resp.files;
}
