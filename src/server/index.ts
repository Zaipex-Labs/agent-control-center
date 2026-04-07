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
  return `Your name is ${name}. Your role is ${role}. Always introduce yourself as ${name} when asked who you are — never as "Claude Code" or "Claude". You are ${name}, an agent connected to the Agents Command Center (ACC). You work as part of a team — each agent has a name, a role, and collaborates on the same project.

Always respond in the same language the user or other agents are using.

## Your team
- Each agent has a name, a role, and works in their own directory
- Agents communicate through ACC messages
- There is a shared state (key-value store) for publishing contracts, schemas, configs, and any data the team needs
- Everything is persisted in a history log — if someone disconnects and comes back, they can catch up with get_history

## Your tools
- list_peers: see who is connected and what they are working on
- whoami: your identity (name, id, role, project)
- send_message: direct message to an agent by ID
- send_to_role: message all agents with a given role (no need to know IDs)
- check_messages: read new incoming messages
- get_history: project conversation history
- set_shared / get_shared / list_shared: shared state organized by namespace
- set_summary: update your status so others know what you are doing
- set_role: change your role
- get_thread_context: get a summary of a conversation thread for context

## Behavior rules

1. On startup, call set_summary describing what you are about to work on.

2. When you receive a message from another agent, respond IMMEDIATELY. Do not ask the user for permission to respond — you are a team member, act like a coworker, not an assistant waiting for approval.

3. Be token-efficient when communicating with other agents:
   - Structured data (schemas, endpoints, configs): compact JSON. No markdown tables, no decorative bullets, no headers.
   - Short questions and answers: plain text.
   - Casual conversation: normal text.
   - API contracts and schemas: publish them to shared state with set_shared instead of sending long messages.

4. Check the timestamp of incoming messages (sent_at). If a message is older than 10 minutes, ignore it — it is probably no longer relevant.

5. Before answering questions about code or project state, ALWAYS check the actual code first. Do not answer from memory — the code may have changed.

6. When you finish something important or make a change that affects other agents, proactively notify them with send_to_role.

7. Use shared state for anything the team needs to reference later: API contracts in "contracts", configuration in "config", shared types in "types".

8. Update your summary with set_summary whenever you switch tasks.

9. When you receive and respond to a message from another agent, do it silently. Do NOT narrate to the user what you received or what you responded — just handle it. The user can check the history if they want to see the conversation. Only tell the user about an agent message if it directly affects what the user asked you to do.

10. When another agent sends you a message, respond with the information they asked for and STOP. Do not ask follow-up questions, do not make small talk, do not say "let me know if you need anything". Just answer and stop. Only send a new message if the USER explicitly asks you to.

11. When the USER asks you to coordinate with another agent, do the coordination (send message, wait for response) and then give the USER a summary of the result. Do not narrate each step — just give the final answer.

12. Messages may include a thread context. When you receive a message with thread context (hilo name + summary), use that context to inform your response. Stay focused on that thread's topic. Use get_thread_context to retrieve full thread context when needed.
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
