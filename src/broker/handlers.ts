// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { PROJECTS_DIR, ensureDirectories, techLeadCwd } from '../shared/config.js';
import { generateId, getDefaultName } from '../shared/utils.js';
import { ARCHITECT_ROLE, ARCHITECT_DEFAULT_INSTRUCTIONS } from '../shared/names.js';
import { mkdirSync } from 'node:fs';
import { registerMcpServer, killTmuxSession, hasTmuxSession as hasTmuxSess } from '../cli/spawn.js';
import { spawnWebAgent, killAllWebAgents, getWebAgent } from './terminal.js';
import { gitModifiedFiles } from './files.js';
import { tmuxNotify, tmuxInjectWithContext } from './tmux.js';
import { broadcast } from './websocket.js';
import { storeBlob, getBlob, deleteBlobFile, listBlobFilesOnDisk, MAX_BLOB_SIZE } from './blobs.js';
import { addBlobRef, releaseBlobRefsForProject, getAllBlobRefCounts } from './blob-refs.js';
import { serializeAttachments, type Attachment } from '../shared/attachments.js';
import { assertSafeIdentifier } from '../shared/validate.js';
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
  selectThreadParticipants,
  selectThreadById,
  updateThread,
  deleteThread,
  deleteProjectData,
  listProjectIdsInDb,
  searchThreads,
  searchMessagesInThreads,
  selectLogByThread,
  touchThread,
} from './database.js';
import { unlinkSync } from 'node:fs';

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

// Raw-body helper for binary uploads (image/* blobs, files). Unlike
// parseBody it does NOT assume JSON — returns the concatenated Buffer
// so callers can compute a hash, persist, decode, etc. Caller is
// responsible for honouring their own max-size cap.
export function parseRawBody(req: IncomingMessage, maxSize: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on('data', (c: Buffer) => {
      if (settled) return;
      total += c.length;
      if (total > maxSize) {
        settled = true;
        // Don't destroy the socket — the caller still needs to write a
        // 413 response. Stop buffering chunks and reject; the handler
        // will close the connection cleanly.
        reject(new Error(`Request body too large (> ${maxSize} bytes)`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', err => { if (!settled) { settled = true; reject(err); } });
  });
}

// ── Input validation ──────────────────────────────────────────

const MAX_TEXT_LENGTH = 100_000; // 100KB per message text

// Back-compat wrapper around assertSafeIdentifier (src/shared/validate.ts).
// Preserves the res-based callsite API so handlers can stay
// `if (!validateIdentifiers(res, …)) return;`. Underlying rules
// (path traversal, shell metachars, null bytes, 64-char cap) live in
// the shared helper so CLI / tests / future runtimes use the same check.
// Empty / missing values are skipped here — callers enforce presence.
function validateIdentifiers(
  res: ServerResponse,
  ...values: Array<{ name: string; value: unknown }>
): boolean {
  for (const { name, value } of values) {
    if (typeof value !== 'string' || value.length === 0) continue;
    try {
      assertSafeIdentifier(name, value);
    } catch (e) {
      error(res, e instanceof Error ? e.message : String(e));
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

// Walks every project config on disk and makes sure it has the permanent
// tech lead agent. Called once when the broker boots, so legacy projects
// created before the architect existed get migrated without user action.
// Also drops DB rows for projects whose config was deleted externally.
export function migrateLegacyProjects(): void {
  ensureDirectories();
  try {
    const configs = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
    const activeProjectIds = new Set<string>();
    for (const file of configs) {
      const path = join(PROJECTS_DIR, file);
      let config: { name: string; description?: string; agents?: AgentConfig[] };
      try {
        config = JSON.parse(readFileSync(path, 'utf-8'));
      } catch (e) {
        console.error(`[broker:migrate] skipping ${file}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      activeProjectIds.add(config.name);
      const agents = Array.isArray(config.agents) ? config.agents : [];
      const withArch = ensureArchitect(config.name, agents);
      const changed = withArch.length !== agents.length || withArch[0]?.role !== ARCHITECT_ROLE;
      if (changed) {
        const updated = { ...config, agents: withArch };
        try {
          writeFileSync(path, JSON.stringify(updated, null, 2) + '\n');
          console.error(`[broker:migrate] injected architect into ${config.name}`);
        } catch (e) {
          console.error(`[broker:migrate] failed to write ${file}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    // Drop DB rows owned by projects whose config file no longer exists.
    // Stops old "zaipex-saas" / "mi-proyecto" data from lingering after
    // the user deletes them without the DB cleanup we added below.
    const orphanProjectIds = listProjectIdsInDb().filter(id => !activeProjectIds.has(id));
    for (const pid of orphanProjectIds) {
      try {
        deleteProjectData(pid);
        const techDir = techLeadCwd(pid);
        if (existsSync(techDir)) rmSync(techDir, { recursive: true, force: true });
        console.error(`[broker:migrate] wiped orphan project data: ${pid}`);
      } catch (e) {
        console.error(`[broker:migrate] failed to wipe ${pid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } catch (e) {
    console.error(`[broker:migrate] sweep failed: ${e instanceof Error ? e.message : String(e)}`);
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
        return { ...config, active_peers: livePeers.length, peers: livePeers, tmux_running: hasTmuxSess(config.name) };
      })
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    json(res, { projects });
  } catch {
    json(res, { projects: [] });
  }
}

// Every project has a permanent tech-lead agent whose cwd is a broker-
// managed directory under ~/.zaipex-acc/techlead/<project>. The directory
// holds the live MD files the tech lead maintains (progress, decisions,
// current work) — it's the only thing the tech lead writes to. Other
// agents still use their own repo cwd.
function ensureTechLeadDir(projectName: string): string {
  const dir = techLeadCwd(projectName);
  mkdirSync(dir, { recursive: true });
  // Seed starter MDs on first create. We don't overwrite if they exist
  // — the tech lead may have updated them already.
  const readme = join(dir, 'README.md');
  if (!existsSync(readme)) {
    writeFileSync(readme, `# ${projectName} — Tech Lead workspace\n\nThis directory is maintained by the tech lead agent (arquitectura). The agent updates these files as the team works:\n\n- **progress.md** — what has been shipped\n- **decisions.md** — architectural decisions and rationale\n- **current.md** — what's in progress right now\n\nOther agents' code lives in their own cwds — this folder is the tech lead's memory across sessions.\n`);
  }
  const current = join(dir, 'current.md');
  if (!existsSync(current)) {
    writeFileSync(current, `# Current work\n\n_The tech lead updates this file when tasks start or switch._\n`);
  }
  const progress = join(dir, 'progress.md');
  if (!existsSync(progress)) {
    writeFileSync(progress, `# Progress log\n\n_One line per shipped task. The tech lead appends here when something finishes._\n`);
  }
  const decisions = join(dir, 'decisions.md');
  if (!existsSync(decisions)) {
    writeFileSync(decisions, `# Decisions\n\n_Short entries for architectural decisions, trade-offs, and "why we chose X over Y"._\n`);
  }
  // CLAUDE.md is what Claude Code auto-loads as context for every session
  // run from this directory. This is how the architect's tech-lead prompt
  // actually reaches the agent (the MCP server instructions are generic).
  // Always refresh this file so prompt updates propagate on broker restart.
  writeFileSync(join(dir, 'CLAUDE.md'), ARCHITECT_DEFAULT_INSTRUCTIONS + '\n');
  return dir;
}

interface AgentConfig {
  role: string;
  cwd: string;
  name?: string;
  agent_cmd?: string;
  agent_args?: string[];
  instructions?: string;
  avatar?: string;
  model?: string;
}

function buildTechLeadAgent(projectName: string): AgentConfig {
  return {
    role: ARCHITECT_ROLE,
    cwd: ensureTechLeadDir(projectName),
    name: 'Da Vinci',
    agent_cmd: 'claude',
    agent_args: [],
    instructions: ARCHITECT_DEFAULT_INSTRUCTIONS,
    avatar: '',
    model: '',
  };
}

// Makes sure the agents list contains the tech lead. If an existing entry
// uses the architect role, refresh its cwd + instructions (but preserve
// avatar/name/model in case the user customized them).
function ensureArchitect(projectName: string, agents: AgentConfig[]): AgentConfig[] {
  const idx = agents.findIndex(a => a.role === ARCHITECT_ROLE);
  const dir = ensureTechLeadDir(projectName);
  if (idx === -1) {
    return [buildTechLeadAgent(projectName), ...agents];
  }
  const existing = agents[idx];
  const merged: AgentConfig = {
    ...existing,
    cwd: dir, // always pin to the broker-managed dir
    instructions: existing.instructions?.trim() ? existing.instructions : ARCHITECT_DEFAULT_INSTRUCTIONS,
    name: existing.name?.trim() || 'Da Vinci',
    agent_cmd: existing.agent_cmd || 'claude',
    agent_args: existing.agent_args || [],
  };
  const copy = agents.slice();
  copy[idx] = merged;
  return copy;
}

export function handleCreateProject(body: unknown, res: ServerResponse): void {
  const b = body as { name?: string; description?: string };
  if (!b.name) return error(res, 'Missing required field: name');

  // [C-1] — name flows into a filesystem path (PROJECTS_DIR/<name>.json),
  // into the tech-lead dir (TECHLEAD/<name>/), and later into tmux session
  // names (acc-<name>). Validate before touching any of those sinks.
  try {
    assertSafeIdentifier('name', b.name);
  } catch (e) {
    return error(res, e instanceof Error ? e.message : String(e), 400);
  }

  ensureDirectories();
  const configPath = join(PROJECTS_DIR, `${b.name}.json`);
  if (existsSync(configPath)) return error(res, `Project already exists: ${b.name}`);

  const config = {
    name: b.name,
    description: b.description ?? '',
    created_at: new Date().toISOString(),
    agents: [buildTechLeadAgent(b.name)],
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

export function handleUpdateProject(body: unknown, res: ServerResponse): void {
  const b = body as {
    project_id?: string;
    description?: string;
    agents?: Array<{ role: string; cwd: string; name?: string; instructions?: string; avatar?: string; model?: string }>;
  };
  if (!b.project_id) return error(res, 'Missing required field: project_id');
  if (!Array.isArray(b.agents)) return error(res, 'Missing required field: agents (array)');

  const configPath = join(PROJECTS_DIR, `${b.project_id}.json`);
  if (!existsSync(configPath)) return error(res, `Project not found: ${b.project_id}`, 404);

  // Block edits while the project is actively running — rename/remove would
  // desync the running peers from the new config.
  const livePeers = selectPeersByProject(b.project_id).filter(p => {
    if (p.agent_type === 'dashboard') return false;
    try { process.kill(p.pid, 0); return true; } catch { return false; }
  });
  if (livePeers.length > 0 || hasTmuxSess(b.project_id)) {
    return error(res, 'Cannot edit an active team. Shut it down first.');
  }

  // Validate agents (architect cwd is broker-managed, so skip that check)
  const seen = new Set<string>();
  for (const a of b.agents) {
    if (!a.role || !a.role.trim()) return error(res, 'Every agent must have a role');
    if (a.role !== ARCHITECT_ROLE && (!a.cwd || !a.cwd.trim())) {
      return error(res, `Agent '${a.role}' is missing cwd`);
    }
    if (seen.has(a.role)) return error(res, `Duplicate role: ${a.role}`);
    seen.add(a.role);
  }

  const existing = JSON.parse(readFileSync(configPath, 'utf-8'));
  // Normalize incoming agents, then re-inject the tech lead if it was
  // removed or was never there in the first place. The tech lead's cwd
  // is always pinned to the broker-managed directory.
  const normalized: AgentConfig[] = b.agents.map(a => ({
    role: a.role.trim(),
    cwd: a.cwd.trim(),
    name: a.name?.trim() ?? '',
    agent_cmd: 'claude',
    agent_args: [],
    instructions: a.instructions?.trim() ?? '',
    avatar: a.avatar ?? '',
    model: a.model ?? '',
  }));
  const withArchitect = ensureArchitect(b.project_id, normalized);

  const updated = {
    ...existing,
    description: b.description ?? existing.description ?? '',
    agents: withArchitect,
  };
  writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n');
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

  // Refresh the tech lead workspace (creates dir if missing, rewrites
  // CLAUDE.md so prompt edits take effect on every power-up) before we
  // validate cwds — otherwise the architect's cwd would fail the existence
  // check on first spawn after it was set.
  for (const agent of config.agents) {
    if (agent.role === ARCHITECT_ROLE) {
      try {
        ensureTechLeadDir(b.project_id);
      } catch (e) {
        console.error(`[broker] failed to prepare tech lead workspace: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Validate every agent cwd up front so we fail loud instead of getting a
  // cryptic ENOENT from spawn (node reports the exec path, not the missing cwd).
  const missingCwds: string[] = [];
  for (const agent of config.agents) {
    if (!agent.cwd || !existsSync(agent.cwd)) {
      missingCwds.push(`${agent.role} → ${agent.cwd || '(empty)'}`);
    }
  }
  if (missingCwds.length > 0) {
    return error(res, `Agent working directories do not exist: ${missingCwds.join(', ')}`);
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

  const agentNames = config.agents.map((a: { role: string; name?: string }) =>
    a.name || getDefaultName(a.role)
  );

  try {
    // Idempotent spawn: reuse agents that are already running. This is what
    // makes a browser reload safe — the dashboard may hit /project/up again
    // when it re-mounts, but we don't want to kill healthy agents.
    let spawned = 0;
    let reused = 0;
    for (const agent of config.agents) {
      const existing = getWebAgent(b.project_id, agent.role);
      if (existing && !existing.killed && existing.exitCode === null) {
        console.error(`[broker] project/up: reusing ${b.project_id}:${agent.role} (pid=${existing.pid})`);
        reused++;
        continue;
      }
      console.error(`[broker] project/up: spawning ${b.project_id}:${agent.role} cwd=${agent.cwd}${agent.model ? ` model=${agent.model}` : ''}`);
      try {
        spawnWebAgent(b.project_id, agent.role, agent.cwd, agent.name, agent.model);
        spawned++;
      } catch (e) {
        console.error(`[broker] project/up: spawn failed for ${b.project_id}:${agent.role}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    json(res, {
      ok: true,
      strategy: 'web',
      agents: config.agents.length,
      spawned,
      reused,
      agent_roles: config.agents.map((a: { role: string }) => a.role),
      agent_names: agentNames,
    });
  } catch (e) {
    error(res, `Failed to start agents: ${e}`);
  }
}

// Returns the merged list of modified files across every agent cwd in the
// project. Each entry is { path, status, role, name, cwd } and is derived
// by running `git status --porcelain` in each agent's working directory.
// Silent on repos that aren't git-initialized — they just contribute zero
// files. The dashboard merges this list with shared_state notes client
// side.
export function handleListModifiedFiles(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string };
  if (!b.project_id) return error(res, 'Missing required field: project_id');

  const configPath = join(PROJECTS_DIR, `${b.project_id}.json`);
  if (!existsSync(configPath)) return error(res, `Project not found: ${b.project_id}`, 404);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const agents: Array<{ role: string; name?: string; cwd: string }> = config.agents ?? [];

  // Key files by (cwd, path) so the same filename in two different agent
  // directories doesn't collapse.
  const seen = new Set<string>();
  const files: Array<{
    path: string;
    status: string;
    role: string;
    name: string;
    cwd: string;
  }> = [];

  for (const agent of agents) {
    const entries = gitModifiedFiles(agent.cwd);
    // Skip untracked paths (status "??"). They are pure noise if the repo
    // isn't initialized or if a cwd has lots of generated files — we'd
    // rather show nothing and let agents explicitly pin files via
    // shared_state when they want them highlighted. Also drop directory
    // entries (git-status prints them trailing with "/").
    for (const entry of entries) {
      if (entry.status.trim() === '??') continue;
      if (entry.path.endsWith('/')) continue;
      const key = `${agent.cwd}::${entry.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({
        path: entry.path,
        status: entry.status,
        role: agent.role,
        name: agent.name ?? '',
        cwd: agent.cwd,
      });
    }
  }

  // Sort: modified/staged first, then added/new, then untracked, deleted last.
  const rank = (s: string): number => {
    const t = s.trim();
    if (t.includes('M')) return 0;
    if (t.includes('A')) return 1;
    if (t === '??') return 2;
    if (t.includes('R')) return 3;
    if (t.includes('D')) return 4;
    return 5;
  };
  files.sort((a, b) => rank(a.status) - rank(b.status));

  json(res, { files });
}

// Explicit save handler — captures the resume snapshot without killing
// agents. Called when the user clicks "Guardar" in the workspace.
//
// Two-layer capture:
//   1. Mechanical baseline: broker writes the last 3 messages + peer.summary
//      into shared_state/resume/<role>. Guaranteed to exist, no waiting.
//   2. Agent-authored refinement: broker inserts a "system: save-resume"
//      message to each agent so they overwrite that entry with their own
//      contextual summary on their next poll. If an agent is slow or down,
//      the mechanical baseline stays as the effective snapshot.
export function handleSaveResume(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string };
  if (!b.project_id) return error(res, 'Missing required field: project_id');

  const peers = selectPeersByProject(b.project_id);
  const liveAgents = peers.filter(p => {
    if (p.agent_type === 'dashboard') return false;
    if (!p.role) return false;
    try { process.kill(p.pid, 0); return true; } catch { return false; }
  });

  // 1) Write the mechanical baseline immediately.
  try {
    captureResumeSnapshots(b.project_id, peers);
  } catch (e) {
    return error(res, `Failed to save resume: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Ask each live agent to overwrite with their own richer summary.
  //    We insert directly into the messages table so the agent's MCP
  //    poll picks it up on its next tick (~1s). from_id is the sentinel
  //    'system' so it's visually distinct from agent-to-agent chatter.
  const now = new Date().toISOString();

  for (const peer of liveAgents) {
    const promptText = `[system:save-resume] Save your own resume snapshot so you can pick up where you left off next time. Call set_shared("resume", "${peer.role}", JSON.stringify({ summary: "<1-2 sentences about what you were working on>", next_steps: ["<short bullet>", "<short bullet>"], open_questions: ["<optional>"], updated_at: "${now}" })). Do this silently — do NOT reply to the user. Just update shared_state and return to whatever you were doing before this message.`;
    try {
      insertMessage(
        b.project_id,
        'system',
        peer.id,
        'notification',
        promptText,
        null,
        now,
        null,
      );
      insertLogEntry(
        b.project_id,
        'system', 'system',
        peer.id, peer.role,
        'notification',
        promptText,
        null,
        now,
        'system',
        null,
      );
    } catch (e) {
      console.error(`[broker:save-resume] failed to notify ${peer.role}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  json(res, { ok: true, snapshotted: liveAgents.length });
}

// Before killing agents, capture a lightweight "resume" snapshot per role
// so when the team comes back up we can remind each agent what they were
// doing. The snapshot is stored in shared_state under namespace "resume"
// and consumed by terminal.ts when building the init prompt.
function captureResumeSnapshots(projectId: string, peers: Peer[]): void {
  const now = new Date().toISOString();
  const peersByRole = new Map<string, Peer>();
  for (const peer of peers) {
    if (peer.agent_type === 'dashboard') continue;
    if (!peer.role) continue;
    // Prefer the first live peer per role
    if (!peersByRole.has(peer.role)) peersByRole.set(peer.role, peer);
  }

  for (const [role, peer] of peersByRole) {
    try {
      const history = selectHistory(projectId, { role, limit: 8 });
      // selectHistory returns DESC (newest first); keep the 3 newest as
      // reverse-chronological, then flip to chronological for the prompt.
      const last = history.slice(0, 3).reverse().map(m => ({
        at: m.sent_at,
        from_role: m.from_role || '',
        to_role: m.to_role || '',
        text: m.text.slice(0, 500), // safety cap
        type: m.type,
      }));

      const snapshot = {
        summary: peer.summary || '',
        last_messages: last,
        shutdown_at: now,
      };

      setSharedState(
        projectId,
        'resume',
        role,
        JSON.stringify(snapshot),
        peer.id,
        now,
      );
    } catch (e) {
      console.error(`[broker:resume] failed to capture ${role}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export async function handleProjectDown(body: unknown, res: ServerResponse): Promise<void> {
  const b = body as { project_id?: string };
  if (!b.project_id) return error(res, 'Missing required field: project_id');

  const peers = selectPeersByProject(b.project_id);

  // 1) Mechanical baseline — guaranteed, sync.
  try {
    captureResumeSnapshots(b.project_id, peers);
  } catch (e) {
    console.error(`[broker:resume] capture failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Ask live agents to refine the snapshot with their own summary,
  //    then give them ~3s to respond before we kill them. If they're
  //    slow, the mechanical baseline from step 1 is what persists.
  const liveAgents = peers.filter(p => {
    if (p.agent_type === 'dashboard') return false;
    if (!p.role) return false;
    try { process.kill(p.pid, 0); return true; } catch { return false; }
  });
  const now = new Date().toISOString();
  for (const peer of liveAgents) {
    const promptText = `[system:save-resume] The team is shutting down. Save a final resume snapshot now so you can resume next session. Call set_shared("resume", "${peer.role}", JSON.stringify({ summary: "<1-2 sentences about what you were working on>", next_steps: ["<short bullet>"], open_questions: ["<optional>"], updated_at: "${now}" })). Do this silently. You have ~3 seconds before shutdown.`;
    try {
      insertMessage(b.project_id, 'system', peer.id, 'notification', promptText, null, now, null);
      insertLogEntry(b.project_id, 'system', 'system', peer.id, peer.role, 'notification', promptText, null, now, 'system', null);
    } catch {
      // ignore
    }
  }
  if (liveAgents.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

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

  // BUG 2 fix: Remove stale dashboard peers for this project before inserting a new one
  if (peer.agent_type === 'dashboard') {
    const existing = selectPeersByProject(peer.project_id);
    for (const p of existing) {
      if (p.agent_type === 'dashboard') {
        deletePeer(p.id);
        console.error(`[broker:register] removed stale dashboard peer id=${p.id}`);
      }
    }
  }

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

  // Hide dashboard peers from agents — they're not real team members
  peers = peers.filter(p => p.agent_type !== 'dashboard');

  // Liveness check in real time — without this, a page reload sees the
  // stale rows still in the DB (cleanStalePeers only runs every 30s) and
  // reports zombie peers as online. process.kill(pid, 0) is a cheap
  // syscall that throws if the process is dead.
  const deadIds: string[] = [];
  peers = peers.filter(p => {
    try {
      process.kill(p.pid, 0);
      return true;
    } catch {
      deadIds.push(p.id);
      return false;
    }
  });
  // Fire-and-forget eviction so the DB catches up for future callers.
  for (const id of deadIds) {
    try { deletePeer(id); } catch { /* ignore */ }
  }

  json(res, peers);
}

// ── Messages ───────────────────────────────────────────────────

export async function handleSendMessage(body: unknown, res: ServerResponse): Promise<void> {
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

  // [H-1] — both peers must belong to the body's project_id. Without this,
  // a local attacker who knows a peer_id in project B could send messages
  // (with attachments) to that peer while claiming to be in project A.
  // SECURITY.md lists cross-project bypasses as a vulnerability.
  if (fromPeer.project_id !== b.project_id || toPeer.project_id !== b.project_id) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Peer does not belong to the requested project',
      code: 'PROJECT_MISMATCH',
    }));
    return;
  }

  const type: MessageType = b.type ?? 'message';
  const now = new Date().toISOString();

  // Attachments: validate every referenced blob is on disk before writing
  // the message. If any is missing, return a structured 404 so the
  // dashboard can decide to re-upload. The blob_refs rows are inserted
  // AFTER insertMessage so we have a real message_id.
  const incoming = (b as SendMessageRequest & { attachments?: Attachment[] }).attachments ?? [];
  for (const att of incoming) {
    if (!getBlob(att.hash)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'Attachment blob not found on server',
        code: 'BLOB_NOT_FOUND',
        hash: att.hash,
      }));
      return;
    }
  }

  // Merge incoming attachments into metadata so `topic` (and any other
  // future metadata key) survives alongside them.
  let metadata: string | null;
  if (incoming.length > 0) {
    let existingObj: Record<string, unknown> = {};
    if (b.metadata) {
      try { existingObj = JSON.parse(b.metadata) as Record<string, unknown>; } catch { /* ignore */ }
    }
    metadata = serializeAttachments(incoming, existingObj);
  } else {
    metadata = b.metadata ?? null;
  }

  let threadId = b.thread_id ?? null;

  // Auto-inherit thread_id: first try user's original message, then any recent message
  // sent TO this sender (so agent replies stay in the same thread as the question)
  if (!threadId) {
    const recentHistory = selectHistory(b.project_id, { limit: 30 });
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    // 1. Try user's original message
    const userMsg = recentHistory.find(m =>
      m.from_role === 'user' &&
      m.thread_id &&
      new Date(m.sent_at).getTime() > fiveMinAgo
    );
    if (userMsg?.thread_id) {
      threadId = userMsg.thread_id;
      console.error(`[broker:send-message] inherited thread_id=${threadId} from user message`);
    } else {
      // 2. Try the last message received by this sender that has a thread_id
      const receivedMsg = recentHistory.find(m =>
        m.to_id === b.from_id &&
        m.thread_id &&
        new Date(m.sent_at).getTime() > fiveMinAgo
      );
      if (receivedMsg?.thread_id) {
        threadId = receivedMsg.thread_id;
        console.error(`[broker:send-message] inherited thread_id=${threadId} from received message`);
      }
    }
  }

  console.error(`[broker:send-message] from=${b.from_id} (${fromPeer.role}) to=${b.to_id} (${toPeer.role}) thread=${threadId}`);

  const messageId = insertMessage(b.project_id, b.from_id, b.to_id, type, b.text, metadata, now, threadId);
  insertLogEntry(
    b.project_id, b.from_id, fromPeer.role, b.to_id, toPeer.role,
    type, b.text, metadata, now, fromPeer.id, threadId,
  );

  // Register one blob_ref per attachment so cleanup (project delete / GC)
  // knows the blob is referenced by this specific message.
  for (const att of incoming) {
    addBlobRef(att.hash, b.project_id, messageId);
  }

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
    metadata,
  }, b.project_id);

  json(res, { ok: true });
}

export async function handleSendToRole(body: unknown, res: ServerResponse): Promise<void> {
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

  // [H-1] — sender must be in the same project it claims. selectPeersByRole
  // already filters by project_id, so broadcast targets are safe; this
  // check just stops impersonation of a project by a peer that doesn't
  // belong to it.
  if (fromPeer.project_id !== b.project_id) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Peer does not belong to the requested project',
      code: 'PROJECT_MISMATCH',
    }));
    return;
  }

  const targets = selectPeersByRole(b.project_id, b.role);
  const type: MessageType = b.type ?? 'message';
  const now = new Date().toISOString();

  // Same attachments handling as handleSendMessage (see there for rationale).
  const incoming = (b as SendToRoleRequest & { attachments?: Attachment[] }).attachments ?? [];
  for (const att of incoming) {
    if (!getBlob(att.hash)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'Attachment blob not found on server',
        code: 'BLOB_NOT_FOUND',
        hash: att.hash,
      }));
      return;
    }
  }

  let metadata: string | null;
  if (incoming.length > 0) {
    let existingObj: Record<string, unknown> = {};
    if (b.metadata) {
      try { existingObj = JSON.parse(b.metadata) as Record<string, unknown>; } catch { /* ignore */ }
    }
    metadata = serializeAttachments(incoming, existingObj);
  } else {
    metadata = b.metadata ?? null;
  }
  let threadId = b.thread_id ?? null;

  // Auto-inherit thread_id: first try user's original message, then any recent message
  // sent TO this sender (so agent replies stay in the same thread as the question)
  if (!threadId) {
    const recentHistory = selectHistory(b.project_id, { limit: 30 });
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    const userMsg = recentHistory.find(m =>
      m.from_role === 'user' &&
      m.thread_id &&
      new Date(m.sent_at).getTime() > fiveMinAgo
    );
    if (userMsg?.thread_id) {
      threadId = userMsg.thread_id;
      console.error(`[broker:send-to-role] inherited thread_id=${threadId} from user message`);
    } else {
      const receivedMsg = recentHistory.find(m =>
        m.to_id === b.from_id &&
        m.thread_id &&
        new Date(m.sent_at).getTime() > fiveMinAgo
      );
      if (receivedMsg?.thread_id) {
        threadId = receivedMsg.thread_id;
        console.error(`[broker:send-to-role] inherited thread_id=${threadId} from received message`);
      }
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
    const messageId = insertMessage(b.project_id, b.from_id, target.id, type, b.text, metadata, now, threadId);
    insertLogEntry(
      b.project_id, b.from_id, fromPeer.role, target.id, target.role,
      type, b.text, metadata, now, fromPeer.id, threadId,
    );
    for (const att of incoming) addBlobRef(att.hash, b.project_id, messageId);

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
    metadata,
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
  // Attach the list of roles that participated in each thread so the
  // sidebar can show their avatars on each card. 'user' is intentionally
  // excluded — we only want agent avatars.
  const withParticipants = threads.map(thread => ({
    ...thread,
    participants: selectThreadParticipants(b.project_id, thread.id).filter(r => r && r !== 'user' && r !== 'system'),
  }));
  json(res, { threads: withParticipants });
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

// Delete a thread (conversation). The thread row is removed but the
// historical messages stay in message_log with their thread_id nulled out,
// so the team history is preserved even after the thread disappears from
// the sidebar.
export function handleDeleteThread(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string; thread_id?: string };
  if (!b.project_id || !b.thread_id) {
    return error(res, 'Missing required fields: project_id, thread_id');
  }

  const ok = deleteThread(b.project_id, b.thread_id);
  if (!ok) return error(res, `Thread not found: ${b.thread_id}`, 404);

  broadcast('thread:deleted', { id: b.thread_id }, b.project_id);
  json(res, { ok: true });
}

// Delete a project (team). Refuses if the project is currently active,
// because silently dropping a config while agents are still attached would
// leave orphaned processes. The caller must shut the team down first.
export function handleDeleteProject(body: unknown, res: ServerResponse): void {
  const b = body as { project_id?: string };
  if (!b.project_id) return error(res, 'Missing required field: project_id');

  const configPath = join(PROJECTS_DIR, `${b.project_id}.json`);
  if (!existsSync(configPath)) return error(res, `Project not found: ${b.project_id}`, 404);

  // Block deletion if the project is currently running.
  const livePeers = selectPeersByProject(b.project_id).filter(p => {
    if (p.agent_type === 'dashboard') return false;
    try { process.kill(p.pid, 0); return true; } catch { return false; }
  });
  if (livePeers.length > 0 || hasTmuxSess(b.project_id)) {
    return error(res, 'Cannot delete an active team. Shut it down first.');
  }

  try {
    unlinkSync(configPath);
  } catch (e) {
    return error(res, `Failed to delete project file: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Release blob refs BEFORE wiping other project data. Any hash whose
  // only remaining reference was this project becomes orphan and its
  // on-disk file gets unlinked. Blobs shared with other live projects
  // are kept because their ref count stays > 0.
  try {
    const orphans = releaseBlobRefsForProject(b.project_id);
    for (const h of orphans) deleteBlobFile(h);
    if (orphans.length > 0) {
      console.error(`[broker] released ${orphans.length} orphan blobs for ${b.project_id}`);
    }
  } catch (e) {
    console.error(`[broker] blob cleanup failed for ${b.project_id}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Wipe all rows this project owns in the DB — peers, messages, threads,
  // message_log, shared_state. Without this, the SQLite file grows with
  // orphan rows keyed by a project_id that no longer exists.
  try {
    deleteProjectData(b.project_id);
  } catch (e) {
    console.error(`[broker] failed to wipe DB rows for ${b.project_id}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Remove the tech lead workspace — nothing else uses it and leaving it
  // behind accumulates stale MDs under ~/.zaipex-acc/techlead/.
  try {
    const techDir = techLeadCwd(b.project_id);
    if (existsSync(techDir)) {
      rmSync(techDir, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`[broker] failed to remove tech lead dir for ${b.project_id}: ${e instanceof Error ? e.message : String(e)}`);
  }

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

// ── Blobs (multimodal attachments) ─────────────────────────────

export async function handleUploadBlob(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const mime = (req.headers['content-type'] ?? '').split(';')[0].trim();
  // Filenames can contain UTF-8 (accents, spaces). HTTP header values
  // must be US-ASCII, so the client sends encodeURIComponent(name).
  const rawName = String(req.headers['x-filename'] ?? '');
  let name: string;
  try {
    name = decodeURIComponent(rawName).slice(0, 255);
  } catch {
    return error(res, 'Malformed X-Filename header', 400);
  }
  if (!mime) return error(res, 'Missing Content-Type header');
  if (!name) return error(res, 'Missing X-Filename header');
  try {
    const buf = await parseRawBody(req, MAX_BLOB_SIZE);
    const stored = storeBlob(buf, mime, name);
    json(res, stored);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/too large/i.test(msg)) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg, code: 'BLOB_TOO_LARGE' }));
      return;
    }
    error(res, msg, 400);
  }
}

export function handleDownloadBlob(hash: string, res: ServerResponse): void {
  if (!/^[a-f0-9]{64}$/.test(hash)) return error(res, 'Invalid hash', 400);
  const got = getBlob(hash);
  if (!got) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Blob not found',
      code: 'BLOB_NOT_FOUND',
      hash,
    }));
    return;
  }
  // Observability: terse log so stale hashes correlate with UI misses.
  console.error('[broker] blob:download hash=%s size=%d mime=%s', hash, got.buffer.length, got.mime);
  res.writeHead(200, {
    'Content-Type': got.mime,
    'Content-Length': String(got.buffer.length),
    'Cache-Control': 'public, max-age=31536000, immutable',
  });
  res.end(got.buffer);
}

// Dev-only stats endpoint for observability. Gated by NODE_ENV so it's
// not exposed in production packaged runs. Returns total blob count,
// total bytes, and how many are orphan (zero refs in blob_refs).
export function handleBlobStats(res: ServerResponse): void {
  if (process.env['NODE_ENV'] === 'production') {
    return error(res, 'Not available in production', 404);
  }
  const files = listBlobFilesOnDisk();
  const refs = getAllBlobRefCounts();
  const total_bytes = files.reduce((s, f) => s + f.sizeBytes, 0);
  const orphan_count = files.filter(f => (refs.get(f.hash) ?? 0) === 0).length;
  json(res, { total_blobs: files.length, total_bytes, orphan_count });
}
