import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { brokerFetch } from './broker-client.js';
import type {
  Peer,
  MessageType,
  OkResponse,
  SendToRoleResponse,
  PollMessagesResponse,
  GetHistoryResponse,
  SharedGetResponse,
  SharedListResponse,
} from '../shared/types.js';

export interface AgentIdentity {
  id: string;
  name: string;
  role: string;
  project_id: string;
  summary: string;
  cwd: string;
}

export function registerTools(mcp: McpServer, identity: AgentIdentity): void {
  // ── Discovery ──────────────────────────────────────────────

  mcp.tool(
    'list_peers',
    'List agents connected to the same project. Use scope to filter: "project" (default), "machine", "directory", "repo".',
    {
      scope: z.enum(['project', 'machine', 'directory', 'repo']).optional(),
    },
    async (args) => {
      const peers = await brokerFetch<Peer[]>('/list-peers', {
        project_id: identity.project_id,
        scope: args.scope ?? 'project',
        exclude_id: identity.id,
        cwd: identity.cwd,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(peers, null, 2) }],
      };
    },
  );

  mcp.tool(
    'whoami',
    'Returns this agent\'s identity: name, id, role, project_id, summary.',
    async () => {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            name: identity.name,
            id: identity.id,
            role: identity.role,
            project_id: identity.project_id,
            summary: identity.summary,
          }, null, 2),
        }],
      };
    },
  );

  // ── Messaging ──────────────────────────────────────────────

  mcp.tool(
    'send_message',
    'Send a message to a specific agent by ID. Use list_peers to find IDs.',
    {
      to_id: z.string(),
      text: z.string(),
      type: z.enum([
        'message', 'question', 'response', 'contract_update',
        'notification', 'task_request', 'task_complete',
      ]).optional(),
    },
    async (args) => {
      const resp = await brokerFetch<OkResponse>('/send-message', {
        project_id: identity.project_id,
        from_id: identity.id,
        to_id: args.to_id,
        type: args.type ?? 'message',
        text: args.text,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp) }],
      };
    },
  );

  mcp.tool(
    'send_to_role',
    'Broadcast a message to all agents with a given role (e.g. "backend", "frontend"). No need to know their IDs.',
    {
      role: z.string(),
      text: z.string(),
      type: z.enum([
        'message', 'question', 'response', 'contract_update',
        'notification', 'task_request', 'task_complete',
      ]).optional(),
    },
    async (args) => {
      const resp = await brokerFetch<SendToRoleResponse>('/send-to-role', {
        project_id: identity.project_id,
        from_id: identity.id,
        role: args.role,
        type: args.type ?? 'message',
        text: args.text,
      });
      return {
        content: [{ type: 'text', text: `Sent to ${resp.sent_to} agent(s)` }],
      };
    },
  );

  mcp.tool(
    'check_messages',
    'Poll for new messages sent to this agent. Returns and marks them as delivered.',
    async () => {
      const resp = await brokerFetch<PollMessagesResponse>('/poll-messages', {
        id: identity.id,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp.messages, null, 2) }],
      };
    },
  );

  mcp.tool(
    'get_history',
    'Get conversation history for this project. Optionally filter by role, message type, or limit.',
    {
      role: z.string().optional(),
      type: z.enum([
        'message', 'question', 'response', 'contract_update',
        'notification', 'task_request', 'task_complete',
      ]).optional(),
      limit: z.number().optional(),
    },
    async (args) => {
      const resp = await brokerFetch<GetHistoryResponse>('/get-history', {
        project_id: identity.project_id,
        role: args.role,
        type: args.type,
        limit: args.limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp.messages, null, 2) }],
      };
    },
  );

  // ── Shared state ───────────────────────────────────────────

  mcp.tool(
    'set_shared',
    'Set a key-value pair in shared state. Namespace groups related keys (e.g. "contracts", "config").',
    {
      namespace: z.string(),
      key: z.string(),
      value: z.string(),
    },
    async (args) => {
      const resp = await brokerFetch<OkResponse>('/shared/set', {
        project_id: identity.project_id,
        namespace: args.namespace,
        key: args.key,
        value: args.value,
        peer_id: identity.id,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp) }],
      };
    },
  );

  mcp.tool(
    'get_shared',
    'Read a value from shared state by namespace and key.',
    {
      namespace: z.string(),
      key: z.string(),
    },
    async (args) => {
      const resp = await brokerFetch<SharedGetResponse | { error: string }>('/shared/get', {
        project_id: identity.project_id,
        namespace: args.namespace,
        key: args.key,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp, null, 2) }],
      };
    },
  );

  mcp.tool(
    'list_shared',
    'List all keys in a shared state namespace.',
    {
      namespace: z.string(),
    },
    async (args) => {
      const resp = await brokerFetch<SharedListResponse>('/shared/list', {
        project_id: identity.project_id,
        namespace: args.namespace,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp.keys, null, 2) }],
      };
    },
  );

  // ── Identity ───────────────────────────────────────────────

  mcp.tool(
    'set_summary',
    'Update this agent\'s summary — a short description of what you are currently doing. Call this when you start working and when your focus changes.',
    {
      summary: z.string(),
    },
    async (args) => {
      identity.summary = args.summary;
      const resp = await brokerFetch<OkResponse>('/set-summary', {
        id: identity.id,
        summary: args.summary,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp) }],
      };
    },
  );

  mcp.tool(
    'set_role',
    'Change this agent\'s role label (e.g. "backend", "frontend", "devops").',
    {
      role: z.string(),
    },
    async (args) => {
      identity.role = args.role;
      const resp = await brokerFetch<OkResponse>('/set-role', {
        id: identity.id,
        role: args.role,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp) }],
      };
    },
  );
}
