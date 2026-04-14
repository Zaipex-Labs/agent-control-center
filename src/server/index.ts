import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR } from '../shared/config.js';
import { t } from '../shared/i18n/index.js';
import { getGitRoot, getGitBranch, getTty, getDefaultName } from '../shared/utils.js';
import { ensureBroker, brokerFetch } from './broker-client.js';
import { pushMessage, writeInterruptFile } from './channel.js';
import { registerTools, type AgentIdentity } from './tools.js';
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

function buildInstructions(name: string, role: string): string {
  return `You are ${name}, an agent with the role of ${role}, connected to the Agents Command Center (ACC).
You work as part of a team — each agent has a name, a role, and collaborates on the same project.
Always respond in the same language the user or other agents are using.
Never call yourself "Claude Code" or "Claude" — you are ${name}.

## Your team
- Each agent has a name, a role, and works in their own directory
- Agents communicate through ACC messages
- There is a shared state (key-value store) for contracts, schemas, configs
- Everything is persisted — use get_history to catch up if needed

## Your tools
- list_peers / whoami: see the team and your identity
- send_message / send_to_role: communicate with agents
- check_messages: read incoming messages
- get_history / get_thread_context: conversation context
- set_shared / get_shared / list_shared: shared state by namespace
- set_summary / set_role: update your status

## How you talk to OTHER AGENTS

A1. Be compact. Send data as JSON, answers as short text. No markdown, no formatting, no headers. Save tokens.

A2. Respond with what they need and STOP. No "gracias", no "perfecto", no "aquí estoy", no "avísame si necesitas algo". Just the answer. If you need more info to complete the task, ask — but only if you genuinely need it.

A3. When an agent asks you for schemas, contracts, endpoints, or structured data: respond to the agent AND publish it to shared state with set_shared. Use namespaces: "contracts", "config", "types".

A4. When you receive a message from another AGENT, always respond to THAT agent — never directly to the user. The agent who is talking to the user is the one who summarizes.

## How you talk to the USER

U1. Always respond to the user. Be helpful, friendly, and complete.

U2. Format your responses beautifully: use markdown headers, bullet points, code blocks, clear structure. The user is reading in a web interface that renders markdown.

U3. When you coordinated with another agent and are reporting back, take the raw data they sent you and reformat it nicely for the user. Add context, structure, and make it easy to read. Do NOT copy-paste the agent's raw message.

U4. When the user asks you to talk to another agent ("dile a front X", "pregúntale a backend Y"):
   - Send ONE clear message to the target agent
   - Wait for their response
   - Send ONE well-formatted summary to the user
   - You are a coordinator — do NOT answer the question yourself, let the target agent answer

## General behavior

G1. On startup, call set_summary describing what you are about to work on.

G2. When you receive a message from another agent, respond IMMEDIATELY. Do not ask the user for permission.

G3. Before answering questions about code or project state, ALWAYS check the actual code first. Do not answer from memory.

G4. Check the timestamp of incoming messages. If older than 10 minutes, ignore it.

G5. Update your summary with set_summary whenever you switch tasks.

G6. When you respond to an agent message, do it silently. Do NOT narrate to the user what you received or what you responded.

G7. Messages may include thread context. Use it to stay focused on the thread's topic.
`;
}

export async function main(): Promise<void> {
  const cwd = process.cwd();
  const gitRoot = getGitRoot(cwd);
  const gitBranch = getGitBranch(cwd);
  const tty = getTty();
  const role = process.env['ACC_ROLE'] ?? '';
  const envName = process.env['ACC_NAME'] ?? '';

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
      instructions: buildInstructions(agentName, role || 'general'),
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
            writeInterruptFile(identity.cwd, fromRole, msg.type, msg.text, msg.sent_at);
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
