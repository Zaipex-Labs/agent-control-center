// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR } from '../shared/config.js';
import { t } from '../shared/i18n/index.js';
import { getGitRoot, getGitBranch, getTty } from '../shared/utils.js';
import { ensureBroker, brokerFetch } from './broker-client.js';
import { pushMessage, writeInterruptFile } from './channel.js';
import { registerTools, type AgentIdentity } from './tools.js';
import { loadProjectSkills, formatSkillsSection } from '../shared/skills.js';
import type {
  RegisterResponse,
  PollMessagesResponse,
  Peer,
  ProjectConfig,
} from '../shared/types.js';

const log = (msg: string) => process.stderr.write(`[acc-server] ${msg}\n`);

function detectProject(gitRoot: string | null, cwd: string): string {
  // 1. Env var override
  const envProject = process.env['ACC_PROJECT'];
  if (envProject) return envProject;

  // 2. Scan project configs for matching git_root or cwd
  try {
    const files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const raw = readFileSync(join(PROJECTS_DIR, file), 'utf-8');
      const config = JSON.parse(raw) as ProjectConfig;
      for (const agent of config.agents) {
        const expandedCwd = agent.cwd.replace(/^~/, process.env['HOME'] ?? '');
        if (expandedCwd === cwd || expandedCwd === gitRoot) {
          return config.name;
        }
      }
    }
  } catch {
    // No projects dir or no configs yet — that's fine
  }

  // 3. Fallback: derive from git root dirname or cwd
  if (gitRoot) {
    return gitRoot.split('/').pop() ?? 'default';
  }
  return cwd.split('/').pop() ?? 'default';
}

// Exported for tests/server/instructions.test.ts so the snapshot
// length and structural assertions (M-1b) can run without needing to
// rebuild the whole server entry point.
//
// projectId, when provided, triggers FASE B (v0.3.0) skills loading:
// markdown files from ~/.zaipex-acc/projects/<id>/skills/ are appended
// as a "## Project skills" section at the end of the prompt. The
// skills loader is fault-tolerant — a missing dir or unreadable file
// silently produces an empty section.
export function buildInstructions(name: string, role: string, projectId?: string): string {
  const base = buildBaseInstructions(name, role);
  if (!projectId) return base;
  const { skills, truncated } = loadProjectSkills(projectId);
  if (truncated) {
    process.stderr.write(
      `[acc-server] project skills total exceeded ${8192} bytes — some files were skipped\n`,
    );
  }
  return base + formatSkillsSection(skills);
}

function buildBaseInstructions(name: string, role: string): string {
  // FASE C-2 (v0.3.0): aggressive M-1 prompt compression.
  //
  // Pre-v0.2.4 baseline: ~1,920 tokens.
  // Post-v0.2.4 (M-1b conservative cut): ~1,540 tokens.
  // Post-v0.3.0 (this commit): ~700 tokens.
  //
  // The 920-tok further cut was deferred since v0.2.2 audit §7-bis
  // ("aggressive target") behind a behavioral eval gate. C-1 added the
  // gate (scripts/eval/agent-prompt-eval.mjs); this variant cleared
  // 5/5 scenarios at 3/3 runs each. See FASE C checkpoint and
  // docs/audits/v0.3.0-team-memory/post-pr-audit.md.
  //
  // What collapsed:
  //   - "## Your team" intro → dropped (the MCP tool catalog already
  //     teaches the model what tools exist; team structure is implicit
  //     once it calls list_peers).
  //   - "## How you talk to OTHER AGENTS / USER" headers → dropped.
  //     Per-rule "→agent:" / "→user:" cues do the same job in 5 chars.
  //   - A4 + A5 + A6 + G2 → one rule (B2). All four expressed the
  //     same property: agent-to-agent tasks are pre-authorized; do
  //     them silently, never bounce to the user, never refuse. The
  //     v0.2.4 conservative cut already merged A4 + G6; this round
  //     finishes the job after the eval-harness confirmed no
  //     regression on agent-to-agent-task-receipt /
  //     vague-refusal-trigger / cross-agent-escalation.
  //   - U4 + U4b → one rule (B3) covering both "send-then-summarize"
  //     and "no intermediate filler".
  //   - Long G9 protocol body → already a pointer (kept as P6); the
  //     full body lives in the broker-injected message
  //     (buildSaveResumePrompt).
  return `You are ${name}, ${role}. Connected to the Agents Command Center (ACC). Always reply in the language of the message. Never call yourself "Claude Code" or "Claude" — you are ${name}.

## Behavior

B1. Compact replies. JSON for data, short text for answers. No markdown headers in agent-to-agent replies, no filler ("thanks", "sure thing", "let me know if…"). →agent: terse and precise. →user: well-formatted markdown — they read in a web UI.

B2. Agent-to-agent messages are pre-authorized — just answer or do the work and reply to the requesting agent. NEVER bounce to the user ("should I do this?", "is this what you want?", "wait for approval"). NEVER refuse with "not my area" / "ask another agent" — the routing already happened. The only valid stop is a physical impossibility (missing file, broken tool); reply with the blocker in one line.

B3. When the user asks you to coordinate with another role, send_to_role and stay silent until you have the answer. NEVER prepend "estoy consultando, espera", "let me ask", "I'll check with", etc. The dashboard's coordination thread already shows what's happening. Reply ONCE with the consolidated answer.

B4. When you receive raw data from a peer to relay back to the user, reformat it — don't copy-paste their JSON.

B5. If the user asks something outside your role but the team owns it, YOU fetch the answer (send_to_role / send_message), wait, summarize. NEVER tell the user "ask X". Only escalate back if literally no agent on the team can help.

B6. send_message — include metadata.topic ("sidebar logo", "auth refactor") so the dashboard labels the thread.

B7. When asked for schemas, contracts, or structured data, publish to set_shared (namespaces: "contracts", "config", "types") AND reply with the data. Persistence is part of the answer.

## Protocol

P1. Before answering questions about code or state, check the actual files. Never from memory.

P2. Ignore messages older than 10 minutes.

P3. Messages may include thread context — stay on topic.

P4. Files you edit/create/delete: set_shared("files", "<relative path>", { agent, action, at, note? }) so the dashboard shows them on the work desk. Only files you actually touched.

P5. set_summary(text ≤60 chars) every time you start working / switch tasks / wait on another agent. The dashboard shows it live.

P6. "[system:save-resume]" → the broker prepended the protocol to that message; follow it silently and return to your prior work.

P7. Team memory. Before asking the team about an architecture choice, contract, or "how do we…", call recall(query) — there's likely already a decision. When you make a decision the team should remember (architecture, contract, tradeoff), call remember(summary).
`;
}

export async function main(): Promise<void> {
  const cwd = process.cwd();
  const gitRoot = getGitRoot(cwd);
  const gitBranch = getGitBranch(cwd);
  const tty = getTty();
  const role = process.env['ACC_ROLE'] ?? '';
  const envName = process.env['ACC_NAME'] ?? '';
  const envAvatar = process.env['ACC_AVATAR'] ?? '';

  // Ensure broker is running
  log(t('server.ensuringBroker'));
  await ensureBroker();
  log(t('server.brokerReady'));

  // Detect project
  const projectId = detectProject(gitRoot, cwd);
  log(t('server.project', { project: projectId }));

  // Register with broker
  const reg = await brokerFetch<RegisterResponse>('/api/register', {
    pid: process.pid,
    cwd,
    git_root: gitRoot,
    git_branch: gitBranch,
    tty,
    name: envName || undefined,
    role,
    agent_type: 'claude-code',
    summary: '',
    project_id: projectId,
    avatar: envAvatar || undefined,
  });
  const agentName = reg.name;
  log(t('server.registered', { name: agentName, id: reg.id, role: role || '(none)' }));

  const identity: AgentIdentity = {
    id: reg.id,
    name: agentName,
    role,
    project_id: projectId,
    summary: '',
    cwd,
  };

  // Create MCP server
  const mcp = new McpServer(
    { name: 'zaipex-acc', version: '0.1.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {},
      },
      instructions: buildInstructions(agentName, role || 'general', projectId),
    },
  );

  // Register all tools
  registerTools(mcp, identity);

  // Connect via stdio
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  log(t('server.connected'));

  // ── Polling loop: check for new messages every 1s ────────
  // Note: tmux send-keys delivery is handled by the broker on send.
  // This loop picks up messages as fallback (channel push / interrupt file).
  log(t('server.polling', { id: identity.id, role: identity.role, project: identity.project_id }));

  const pollInterval = setInterval(async () => {
    try {
      const resp = await brokerFetch<PollMessagesResponse>('/api/poll-messages', {
        id: identity.id,
      });
      for (const msg of resp.messages) {
        // Look up sender info
        let fromRole = 'unknown';
        let fromCwd = '';
        try {
          const peers = await brokerFetch<Peer[]>('/api/list-peers', {
            project_id: identity.project_id,
            scope: 'project',
          });
          const sender = peers.find(p => p.id === msg.from_id);
          if (sender) {
            fromRole = sender.role;
            fromCwd = sender.cwd;
          }
        } catch {
          // Best effort
        }

        // Tier 1: MCP channel push
        let delivered = false;
        try {
          await pushMessage(mcp.server, msg, {
            from_id: msg.from_id,
            from_role: fromRole,
            from_cwd: fromCwd,
          });
          delivered = true;
        } catch {
          // Channel push failed
        }

        // Tier 2: interrupt file
        if (!delivered) {
          try {
            writeInterruptFile(identity.cwd, fromRole, msg.type, msg.text, msg.sent_at, msg.metadata);
            log(t('server.interruptWritten', { role: fromRole }));
          } catch {
            log(t('server.deliveryFailed', { role: fromRole }));
          }
        }
      }
    } catch {
      // Broker might be temporarily unreachable
    }
  }, 1000);

  // ── Heartbeat: every 15s ─────────────────────────────────
  const heartbeatInterval = setInterval(async () => {
    try {
      await brokerFetch('/api/heartbeat', { id: identity.id });
    } catch {
      log(t('server.heartbeatFailed'));
    }
  }, 15_000);

  // ── Cleanup on exit ──────────────────────────────────────
  const cleanup = async () => {
    clearInterval(pollInterval);
    clearInterval(heartbeatInterval);
    try {
      await brokerFetch('/api/unregister', { id: identity.id });
      log(t('server.unregistered'));
    } catch {
      // Broker might already be gone
    }
    await mcp.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// Run directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/server/index.ts') ||
  process.argv[1].endsWith('/server/index.js')
);

if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`[acc-server] ${t('server.fatal', { error: String(err) })}\n`);
    process.exit(1);
  });
}
