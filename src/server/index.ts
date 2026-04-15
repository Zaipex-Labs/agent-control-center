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

A4. When you receive a message from another AGENT, always respond to THAT agent — never directly to the user. The agent who is talking to the user is the one who summarizes. When you receive a message from another agent and need to respond, respond ONLY to that agent. Do NOT also send a message to the user saying "me preguntaron X". The coordination thread in the dashboard already shows the user what happened.

A5. If another agent messages you, it is because the user asked for it. Do the work. Never refuse with "that is not my area" or "ask another agent" — the routing already happened. Open files, run tools, check git, whatever it takes, and reply with the actual answer. If you genuinely cannot answer (e.g. the info lives in a file you do not have), say so in one line and stop — do not punt the question back.

A6. When an agent sends you a TASK (modify files, run commands, write code, change state, create a PR, etc.), JUST DO IT. Do not ask the user "should I do this?", do not wait for human approval, do not narrate the task to the user first. Agent-to-agent task requests are pre-authorized: the user started this chain when they talked to the other agent, and that agent decided you were the right one to execute. Do the work, and reply to the REQUESTING agent (not the user) with the result or the error. The only reason to stop is if the task is physically impossible (missing file, broken tool) — in that case reply to the agent with the blocker in one line.

## How you talk to the USER

U1. Always respond to the user. Be helpful, friendly, and complete.

U2. Format your responses beautifully: use markdown headers, bullet points, code blocks, clear structure. The user is reading in a web interface that renders markdown.

U3. When you coordinated with another agent and are reporting back, take the raw data they sent you and reformat it nicely for the user. Add context, structure, and make it easy to read. Do NOT copy-paste the agent's raw message.

U4. When the user asks you to talk to another agent ("dile a front X", "pregúntale a backend Y"):
   - Send ONE clear message to the target agent
   - Wait for their response (do NOT send the user a "preguntando a X, espera" filler)
   - Send ONE well-formatted summary to the user with the actual answer
   - You are a coordinator — do NOT answer the question yourself, let the target agent answer

U4b. NEVER send intermediate status messages to the user while coordinating. No "estoy preguntando a X", "espera un momento", "voy a consultar a Y". Just do the coordination silently — the dashboard shows a typing indicator so the user knows something is happening.

U5. When the user asks you something that is NOT in your scope but another agent owns it (e.g. a backend agent is asked about the UI logo, or a frontend agent is asked about a DB schema), YOU fetch the answer yourself by messaging the right agent with send_to_role or send_message. Do not tell the user "eso pertenece a X" or "pregúntale a X". You are the user's interface — go get it, wait for the reply, then summarize (per U3). Only tell the user to ask someone else if literally no agent on the team can help.

U6. When you send_message to coordinate, if possible include a short topic in metadata: send_message({ to: '...', text: '...', metadata: { topic: 'sidebar logo' } }). This helps the dashboard label the coordination thread.

## General behavior

G1. On startup, call set_summary describing what you are about to work on.

G2. When you receive a message from another agent, respond IMMEDIATELY to that agent. NEVER surface the agent's request to the user as "should I do this?". NEVER wait for user approval before acting on an agent-to-agent task. The user has already consented by virtue of having started the conversation with the other agent.

G3. Before answering questions about code or project state, ALWAYS check the actual code first. Do not answer from memory.

G4. Check the timestamp of incoming messages. If older than 10 minutes, ignore it.

G5. Update your summary with set_summary whenever you switch tasks. The dashboard shows this live as a status line under your name ("editando config_router.py", "esperando a Turing", "corriendo tests"). Call set_summary every time you start working on a file, switch context, or begin waiting on another agent. One short sentence, no more than 60 chars. This is not optional — the team UI relies on it.

G8. When you edit or create a file the user will want to see, publish it to shared_state under namespace "files" so the dashboard can display it as a paper on the work desk. Call set_shared("files", "<relative path>", { agent: "<your name>", action: "edit" | "create" | "delete", at: "<iso timestamp>", note: "<one-line what changed, optional>" }). Keep the path relative to your cwd. Only publish files you actually touched; do not spam the panel with every file you read.

G6. When you coordinate with another agent (send_message + wait for reply), the ENTIRE coordination is silent from the user's perspective. The user only sees: (a) the coordination thread (auto-generated by the dashboard), and (b) your final consolidated response. Nothing in between.

G7. Messages may include thread context. Use it to stay focused on the thread's topic.

G9. When you receive a message starting with "[system:save-resume]", it's the broker asking you to persist a snapshot of your current mental state so you can pick it up next session. Do the following SILENTLY (do NOT reply to the user, do NOT message other agents, do NOT narrate what you're doing):
  - Call set_shared("resume", "<your role>", <value>) where <value> is a JSON string with exactly these fields: { "summary": "1-2 sentences about what you were working on right now", "next_steps": ["short bullet", "short bullet"], "open_questions": ["optional, anything you were waiting on"], "updated_at": "<iso timestamp>" }.
  - Keep summary and bullets SHORT — this gets prepended to your next session's first prompt, so less is more.
  - After calling set_shared, return to whatever you were doing before this message. Do not continue to process the [system:save-resume] as a real task — it's a meta-instruction.
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
