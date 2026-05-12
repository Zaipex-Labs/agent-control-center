// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Project-lifecycle handlers: browse, list, create, add-agent, update,
// up, down, delete, modified-files, save-resume. Plus the legacy
// project migration sweep that runs at broker boot, the tech-lead
// directory bootstrap, and buildSaveResumePrompt (exported for the
// instructions test suite).

import type { ServerResponse } from 'node:http';
import { readdirSync, readFileSync, existsSync, writeFileSync, rmSync, realpathSync, mkdirSync, unlinkSync } from 'node:fs';
import { readdir as readdirAsync, readFile as readFileAsync } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROJECTS_DIR, ACC_HOME, ensureDirectories, techLeadCwd } from '../../shared/config.js';
import { getDefaultName } from '../../shared/utils.js';
import { ARCHITECT_ROLE, ARCHITECT_DEFAULT_INSTRUCTIONS } from '../../shared/names.js';
import { assertSafeIdentifier, assertSafeDisplayName } from '../../shared/validate.js';
import { clearSpawnState } from '../spawn-state.js';
import { detachPeer as detachTokenTail } from '../token-tail.js';
import { registerMcpServer, killTmuxSession, hasTmuxSession as hasTmuxSess, listTmuxSessions } from '../../cli/spawn.js';
import { spawnWebAgent, killAllWebAgents, getWebAgent } from '../terminal.js';
import { gitModifiedFiles } from '../files.js';
import { broadcast } from '../websocket.js';
import { deleteBlobFile } from '../blobs.js';
import { releaseBlobRefsForProject } from '../blob-refs.js';
import type { Peer } from '../../shared/types.js';
import {
  selectPeersByProject,
  deletePeer,
  insertMessage,
  insertLogEntry,
  selectHistory,
  setSharedState,
  setSharedStateWithMeta,
  deleteProjectData,
  listProjectIdsInDb,
} from '../database.js';
import { json, error, assertProjectMembership, parseBodyOrError } from './_helpers.js';
import {
  createProjectSchema,
  addAgentSchema,
  updateProjectSchema,
  projectUpSchema,
  projectDownSchema,
  deleteProjectSchema,
  saveResumeSchema,
  listModifiedFilesSchema,
} from './_schemas.js';

// Keep this here (not in _helpers.ts) so it's colocated with the
// project handlers that use it. Test imports use `from
// '../../src/broker/handlers.ts'` via the barrel.
interface AgentConfig {
  role: string;
  cwd: string;
  name?: string;
  agent_cmd?: string;
  agent_args?: string[];
  instructions?: string;
  avatar?: string;
  model?: string;
  // FASE A-1 (v0.3.2). Persisted as a flat string[] of canonical
  // power names. The spawner is the only consumer.
  powers?: string[];
}

export function handleBrowse(query: string, res: ServerResponse): void {
  const params = new URLSearchParams(query);
  const home = process.env['HOME'] ?? '/';
  const raw = params.get('path') || home;

  // [S-NEW-5 / L-7] previously this did `.replace(/\.\./g, '')` which is a
  // broken sanitizer (`....//` survives as `..//`) and didn't follow
  // symlinks. Resolve the path (handling `..`, double slashes, `.`),
  // then realpath so symlinks land at their actual target before we
  // pass it to readdirSync.
  const candidate = raw.startsWith('/') ? resolve(raw) : resolve(home, raw);
  let target: string;
  try {
    target = realpathSync(candidate);
  } catch {
    return json(res, { path: candidate, folders: [], error: 'Cannot read directory' }, 400);
  }

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

export async function handleListProjects(res: ServerResponse): Promise<void> {
  ensureDirectories();
  try {
    // [P-2] async dir + per-config reads + a single batched tmux call.
    // Pre-v0.2.5 each refresh did:
    //   1. readdirSync → blocks the event loop
    //   2. readFileSync per project → N more blocking ops
    //   3. tmux has-session per project → N forks
    // Now each phase fires concurrently and never holds the loop.
    const files = (await readdirAsync(PROJECTS_DIR)).filter(f => f.endsWith('.json'));
    const [configs, tmuxSessions] = await Promise.all([
      Promise.all(files.map(async f => {
        const raw = await readFileAsync(join(PROJECTS_DIR, f), 'utf-8');
        return JSON.parse(raw) as { name: string };
      })),
      listTmuxSessions(),
    ]);
    const projects = configs
      .map(config => {
        const allPeers = selectPeersByProject(config.name);
        const livePeers = allPeers.filter(p => {
          if (p.agent_type === 'dashboard') return false;
          try { process.kill(p.pid, 0); return true; } catch { return false; }
        });
        return {
          ...config,
          active_peers: livePeers.length,
          peers: livePeers,
          tmux_running: tmuxSessions.has(`acc-${config.name}`),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    json(res, { projects });
  } catch (e) {
    // Surface the failure on stderr so a broken PROJECTS_DIR (permissions,
    // bad JSON in a config file) doesn't silently disappear behind an
    // empty list. Caller still gets the safe fallback.
    console.error('[broker:list-projects]', e instanceof Error ? e.message : String(e));
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
    writeFileSync(readme, `# ${projectName} — Coordinator workspace\n\nThis directory is maintained by the coordinator agent (arquitectura). The agent updates these files as the team works:\n\n- **progress.md** — what has been shipped\n- **decisions.md** — architectural decisions and rationale\n- **current.md** — what's in progress right now\n\nOther agents' code lives in their own cwds — this folder is the coordinator's memory across sessions.\n`);
  }
  const current = join(dir, 'current.md');
  if (!existsSync(current)) {
    writeFileSync(current, `# Current work\n\n_The coordinator updates this file when tasks start or switch._\n`);
  }
  const progress = join(dir, 'progress.md');
  if (!existsSync(progress)) {
    writeFileSync(progress, `# Progress log\n\n_One line per shipped task. The coordinator appends here when something finishes._\n`);
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
  const b = parseBodyOrError(createProjectSchema, body, res);
  if (!b) return;

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

// B-1 v0.3.4 — one-click demo team for cold landing onboarding.
// Creates a project "demo-fullstack" pre-populated with Turing
// (backend), Ada (frontend), Curie (qa) + the example conventions
// skill + one seeded decision in team memory, so a new user can
// hit Encender and see the whole product in 30 seconds rather than
// hunt down the right config combination.
//
// Idempotent: if `demo-fullstack` already exists, returns
// `{ok: true, name, already_existed: true}` so the dashboard can
// just navigate to the existing project.
const DEMO_PROJECT_NAME = 'demo-fullstack';

const DEMO_SKILL_CONTENT = `# Demo project conventions

Tiny starter skill for the demo team. Replace with your own once you
spin up a real project — these are placeholders that show what a
skill file looks like to the agents.

## Stack
- TypeScript everywhere (\`.ts\` / \`.tsx\`).
- React 19 for UI, Node 20+ runtime.
- Postgres 15 for persistence, tables prefixed with \`app_\`.
- Tests with Vitest. Integration tests touch a real DB (no mocks).

## Workflow
- Branch per feature. Conventional commits.
- API responses follow \`{ ok: bool, data?: any, error?: string }\`.
- Tech lead writes \`decisions.md\` for anything that crosses two roles.
`;

const DEMO_DECISION_KEY = 'demo-stack-2026';
const DEMO_DECISION_VALUE =
  'Stack: TypeScript + React + Postgres. Tests con Vitest.';

export function handleCreateDemo(_body: unknown, res: ServerResponse): void {
  ensureDirectories();
  const configPath = join(PROJECTS_DIR, `${DEMO_PROJECT_NAME}.json`);

  // Idempotent: existing demo project → just confirm it's there.
  if (existsSync(configPath)) {
    return json(res, { ok: true, name: DEMO_PROJECT_NAME, already_existed: true });
  }

  // Each demo agent needs a real cwd that exists at spawn time —
  // /tmp tends to get cleaned and the user's home shouldn't have
  // mystery dirs appear, so we keep them under ACC_HOME/demo/.
  const demoBase = join(ACC_HOME, 'demo');
  mkdirSync(demoBase, { recursive: true });
  const specs: Array<{ role: string; name: string; avatarSeed: string }> = [
    { role: 'backend',  name: 'Turing', avatarSeed: 'demo-backend' },
    { role: 'frontend', name: 'Ada',    avatarSeed: 'demo-frontend' },
    { role: 'qa',       name: 'Curie',  avatarSeed: 'demo-qa' },
  ];
  const agents = [buildTechLeadAgent(DEMO_PROJECT_NAME)];
  for (const spec of specs) {
    const cwd = join(demoBase, spec.role);
    mkdirSync(cwd, { recursive: true });
    // Seed a README so the dir isn't suspiciously empty — also makes
    // Turing's git power immediately useful.
    const readme = join(cwd, 'README.md');
    if (!existsSync(readme)) {
      writeFileSync(readme,
        `# Demo ${spec.role}\n\nWorkspace for ${spec.name} (${spec.role}) in ${DEMO_PROJECT_NAME}.\nReplace this dir with a real repo when you're ready.\n`,
      );
    }
    agents.push({
      role: spec.role,
      cwd,
      name: spec.name,
      agent_cmd: 'claude',
      agent_args: [],
      instructions: '',
      avatar: `dicebear:${spec.avatarSeed}`,
      model: '',
    });
  }

  const config = {
    name: DEMO_PROJECT_NAME,
    description: 'Demo fullstack — Turing/Ada/Curie. Edita o reemplaza cuando estés listo para un proyecto real.',
    created_at: new Date().toISOString(),
    agents,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Seed the example skill file so the user sees the skills feature
  // working from turn 0.
  const skillsDir = join(ACC_HOME, 'projects', DEMO_PROJECT_NAME, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  const skillPath = join(skillsDir, 'conventions.md');
  if (!existsSync(skillPath)) {
    writeFileSync(skillPath, DEMO_SKILL_CONTENT);
  }

  // Seed one decision in team memory. Authored as "system" so the
  // dashboard's decision-author chip doesn't blame the user for it.
  // Once the user encends the team, recall(query) finds it.
  try {
    setSharedStateWithMeta(
      DEMO_PROJECT_NAME, 'decisions',
      DEMO_DECISION_KEY, DEMO_DECISION_VALUE,
      'system', new Date().toISOString(),
      { author_role: 'system', author_peer_id: 'system' },
    );
  } catch (e) {
    // Seed failure is non-fatal — the project is still usable. Log so
    // a future maintainer notices if the helper signature shifts.
    console.error(`[broker:create-demo] decision seed failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  json(res, { ok: true, name: DEMO_PROJECT_NAME });
}

export function handleAddAgent(body: unknown, res: ServerResponse): void {
  const b = parseBodyOrError(addAgentSchema, body, res);
  if (!b) return;

  // [H-3] — role/name flow into tmux window names and session targets.
  // Without validation a role like `$(touch /tmp/pwn)` would run a shell
  // command at "Power up". cwd is a filesystem path, not an identifier,
  // so it's left to existsSync + null-byte filtering downstream.
  try {
    assertSafeIdentifier('project_id', b.project_id);
    assertSafeIdentifier('role', b.role);
    // Agent display name is allowed to contain spaces / unicode letters
    // (e.g. default "Da Vinci", LatAm "café-app"). See validate.ts.
    if (b.name) assertSafeDisplayName('name', b.name);
  } catch (e) {
    return error(res, e instanceof Error ? e.message : String(e), 400);
  }

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
    ...(b.powers && b.powers.length > 0 ? { powers: b.powers } : {}),
  });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  json(res, { ok: true });
}

export function handleUpdateProject(body: unknown, res: ServerResponse): void {
  const b = parseBodyOrError(updateProjectSchema, body, res);
  if (!b) return;

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

  // Validate agents (architect cwd is broker-managed, so skip that check).
  // [H-3] — role and name flow into tmux commands; reject shell metachars,
  // path separators, null bytes, and length overflow before the config hits
  // disk. Done alongside the existing presence/duplicate checks.
  const seen = new Set<string>();
  for (const a of b.agents) {
    if (!a.role || !a.role.trim()) return error(res, 'Every agent must have a role');
    if (a.role !== ARCHITECT_ROLE && (!a.cwd || !a.cwd.trim())) {
      return error(res, `Agent '${a.role}' is missing cwd`);
    }
    if (seen.has(a.role)) return error(res, `Duplicate role: ${a.role}`);
    seen.add(a.role);
    try {
      assertSafeIdentifier('role', a.role);
      // Agent display name relaxed (see handleAddAgent comment + validate.ts).
      if (a.name) assertSafeDisplayName('name', a.name);
    } catch (e) {
      return error(res, e instanceof Error ? e.message : String(e), 400);
    }
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
    // FASE A-1 (v0.3.2). Powers only persist when non-empty so the
    // on-disk JSON stays minimal for agents that don't use them.
    ...(a.powers && a.powers.length > 0 ? { powers: a.powers } : {}),
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
  const b = parseBodyOrError(projectUpSchema, body, res);
  if (!b) return;

  const configPath = join(PROJECTS_DIR, `${b.project_id}.json`);
  if (!existsSync(configPath)) return error(res, `Project not found: ${b.project_id}`, 404);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  if (!config.agents || config.agents.length === 0) {
    return error(res, 'Project has no agents configured');
  }

  // v0.3.3 PRE-4 (MED-7a): wipe any leftover spawn-phase state from a
  // previous cycle BEFORE we start spawning. Otherwise the snapshot
  // endpoint would return stale `true`s from the prior run and the
  // dashboard's OR-merge would never see chips drop back to "in flight".
  clearSpawnState(b.project_id);

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
      console.error(`[broker] project/up: spawning ${b.project_id}:${agent.role} cwd=${agent.cwd}${agent.model ? ` model=${agent.model}` : ''}${agent.powers?.length ? ` powers=${agent.powers.join(',')}` : ''}`);
      try {
        spawnWebAgent(b.project_id, agent.role, agent.cwd, agent.name, agent.model, agent.powers);
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
export async function handleListModifiedFiles(body: unknown, res: ServerResponse): Promise<void> {
  const b = parseBodyOrError(listModifiedFilesSchema, body, res);
  if (!b) return;
  // [S-NEW-3] cross-project leak guard. The earlier H-1 fix only covered
  // /api/send-message and /api/send-to-role. Without this, a peer in
  // project A could ask for the modified-files list of project B by
  // forging the body's project_id.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const configPath = join(PROJECTS_DIR, `${b.project_id}.json`);
  if (!existsSync(configPath)) return error(res, `Project not found: ${b.project_id}`, 404);

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const agents: Array<{ role: string; name?: string; cwd: string }> = config.agents ?? [];

  // [P-3] Fan out one git-status spawn per agent in parallel. Previously
  // this was a sequential execSync loop with a 2.5s timeout each, so
  // worst case it stalled the broker's event loop for agents.length × 2.5s.
  const perAgentEntries = await Promise.all(
    agents.map(agent => gitModifiedFiles(agent.cwd).then(entries => ({ agent, entries }))),
  );

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

  for (const { agent, entries } of perAgentEntries) {
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

// [M-1a] Save-resume protocol — injected dynamically when the broker
// triggers `[system:save-resume]`. Before this commit the protocol
// (the literal `set_shared("resume", ...)` instruction with its JSON
// shape) lived in the agent's system prompt as rule G9, eating ~175
// tokens × every turn × every agent for a message that only fires at
// shutdown / save-resume. By prepending the full protocol to the
// trigger message itself, G9 in the system prompt can collapse to a
// one-line pointer (~25 tokens), reclaiming ~150 tokens per agent
// per turn (M-1b commits the system prompt change).
//
// `kind` distinguishes the two existing call sites:
//   - 'periodic': /api/project/save-resume — user pressed "Save" while
//     the team is alive. No shutdown urgency.
//   - 'shutdown': /api/project/down — agents have ~3s before SIGTERM.
// Exported for tests/server/instructions.test.ts (M-1b) so the E2E
// "G9 trigger contains the protocol body end-to-end" assertion can
// inspect the produced prompt without spinning up the full broker.
export function buildSaveResumePrompt(role: string, now: string, kind: 'periodic' | 'shutdown'): string {
  const intro = kind === 'shutdown'
    ? 'The team is shutting down. Save a final resume snapshot now so you can resume next session.'
    : 'Save your own resume snapshot so you can pick up where you left off next time.';
  const urgency = kind === 'shutdown'
    ? ' You have ~3 seconds before shutdown.'
    : ' Just update shared_state and return to whatever you were doing before this message.';
  // [S-NEW-7 / I-2 v0.2.1] role is interpolated into a JSON-as-string
  // template. assertSafeIdentifier already guards register/set_role
  // (so quotes/backslashes/control chars never reach this handler) but
  // a defense-in-depth JSON.stringify keeps the template robust if a
  // role ever lands here without going through the validator first.
  // Using JSON.stringify also wraps the value in quotes, so the literal
  // surrounding `"…"` from the template comes out of stringify itself.
  return `[system:save-resume] ${intro} Call set_shared("resume", ${JSON.stringify(role)}, JSON.stringify({ summary: "<1-2 sentences about what you were working on>", next_steps: ["<short bullet>", "<short bullet>"], open_questions: ["<optional>"], updated_at: ${JSON.stringify(now)} })). Do this silently — do NOT reply to the user.${urgency}`;
}

export function handleSaveResume(body: unknown, res: ServerResponse): void {
  const b = parseBodyOrError(saveResumeSchema, body, res);
  if (!b) return;
  // [S-NEW-3] save-resume writes shared_state for every live agent in
  // the project, so leaking it cross-project would let A force B to
  // emit a resume snapshot. Same gate as H-1.
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

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
    const promptText = buildSaveResumePrompt(peer.role, now, 'periodic');
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
  const b = parseBodyOrError(projectDownSchema, body, res);
  if (!b) return;

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
    const promptText = buildSaveResumePrompt(peer.role, now, 'shutdown');
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
    // FASE A v0.3.3 — stop tailing this peer's Claude session JSONL.
    detachTokenTail(peer.id);
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

  // v0.3.3 PRE-4 (MED-7a): drop the spawn-phase state for this
  // project so the next "Encender" starts from a clean snapshot.
  clearSpawnState(b.project_id);

  json(res, { ok: true, killed });
}

// Delete a project (team). Refuses if the project is currently active,
// because silently dropping a config while agents are still attached would
// leave orphaned processes. The caller must shut the team down first.
export function handleDeleteProject(body: unknown, res: ServerResponse): void {
  const b = parseBodyOrError(deleteProjectSchema, body, res);
  if (!b) return;

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
