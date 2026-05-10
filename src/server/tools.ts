// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { brokerFetch } from './broker-client.js';
import type {
  Peer,
  OkResponse,
  SendToRoleResponse,
  PollMessagesResponse,
  GetHistoryResponse,
  SharedGetResponse,
  SharedListResponse,
  ThreadSummaryResponse,
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
      const peers = await brokerFetch<Peer[]>('/api/list-peers', {
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

  // Reusable zod schema for an attachment reference. The file must
  // already be uploaded to the broker (via POST /api/blobs/upload) —
  // here we only carry the descriptor.
  const attachmentSchema = z.object({
    hash: z.string(),
    mime: z.string(),
    name: z.string(),
    size: z.number(),
  });

  mcp.tool(
    'send_message',
    // FASE C-3 / M-11 (v0.3.0): `type` accepts any string. Common
    // values: "message" (default), "question", "response",
    // "task_request", "task_complete", "contract_update",
    // "notification". The dashboard renders unknown values with the
    // generic message tag, so a custom string is safe — we just lose
    // the per-type color chip in the UI.
    'Send a message to a specific agent by ID. Use list_peers to find IDs. Optionally pass thread_id, metadata with a short topic, or attachments (previously uploaded blobs identified by hash + mime + name + size) for images or files. `type` is an optional string tag; common values: "message" (default), "question", "response", "task_request", "task_complete".',
    {
      to_id: z.string(),
      text: z.string(),
      type: z.string().optional(),
      thread_id: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      attachments: z.array(attachmentSchema).optional(),
    },
    async (args) => {
      const resp = await brokerFetch<OkResponse>('/api/send-message', {
        project_id: identity.project_id,
        from_id: identity.id,
        to_id: args.to_id,
        type: args.type ?? 'message',
        text: args.text,
        thread_id: args.thread_id,
        metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
        attachments: args.attachments,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp) }],
      };
    },
  );

  mcp.tool(
    'send_to_role',
    'Broadcast a message to all agents with a given role (e.g. "backend", "frontend"). No need to know their IDs. Optionally pass thread_id, metadata with a short topic, or attachments (previously uploaded blobs). `type` is an optional string tag; common values: "message" (default), "question", "response", "task_request", "task_complete".',
    {
      role: z.string(),
      text: z.string(),
      type: z.string().optional(),
      thread_id: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      attachments: z.array(attachmentSchema).optional(),
    },
    async (args) => {
      const resp = await brokerFetch<SendToRoleResponse>('/api/send-to-role', {
        project_id: identity.project_id,
        from_id: identity.id,
        role: args.role,
        type: args.type ?? 'message',
        text: args.text,
        thread_id: args.thread_id,
        metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
        attachments: args.attachments,
      });
      // [M-7] Return consistent JSON shape with the rest of the MCP
      // tools (every other write tool returns the broker's raw OK
      // response). Previously this returned a free-form string
      // ("Sent to 2 agent(s)") which forced agents to parse out the
      // count when chaining calls.
      return {
        content: [{ type: 'text', text: JSON.stringify(resp) }],
      };
    },
  );

  // FASE D-2 (v0.3.0): renamed from `check_messages` (M-2 / M-12 / M-14
  // in audit §7). Reasoning:
  //   - The MCP server's pushMessage() (src/server/channel.ts) already
  //     polls every 1s and pushes new messages via the
  //     `notifications/claude/channel` channel. In normal operation
  //     check_messages always returned [] because the broker had
  //     already delivered them.
  //   - The old name + description ("Poll for new messages, mark as
  //     delivered") encouraged agents to call it on every turn,
  //     wasting a round-trip and a dedup race against the server poll.
  //   - But it isn't dead: src/broker/tmux.ts uses it as a fallback
  //     when channel push isn't available (tmux notification text says
  //     "Usa <name> para leer el mensaje").
  // Renamed to `manual_catch_up` so agents understand it's a fallback,
  // not the primary delivery path.
  mcp.tool(
    'manual_catch_up',
    'Force-poll for messages addressed to this agent. Normally not needed — the broker pushes new messages automatically via the MCP channel. Use only when explicitly told (e.g. a tmux fallback notification said to call it) or when you suspect channel delivery is broken.',
    async () => {
      // FU-A (v0.3.1): peek (read without consume) so calling
      // manual_catch_up doesn't race the server's polling loop on
      // markDelivered. The consume path (default) belongs to the
      // 1-second pollInterval that fans out to channel push / interrupt
      // file. manual_catch_up is meant as a fallback view, not a
      // consumer — agents calling it back-to-back will see the same
      // queue until the consume path drains it.
      const resp = await brokerFetch<PollMessagesResponse>('/api/poll-messages', {
        id: identity.id,
        peek: true,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp.messages, null, 2) }],
      };
    },
  );

  mcp.tool(
    'get_history',
    // FASE D-1 / M-5 (v0.3.0): default limit 20, max 100. Without
    // these the agent could pull every log entry the project has
    // ever produced into context. Pagination via before/after ISO
    // timestamps lets the agent scroll back without re-fetching.
    'Get conversation history for this project. Defaults to the most recent 20 entries (max 100). Optionally filter by role, message type (any string tag), thread_id, or limit. Paginate with `before` (ISO timestamp — returns entries strictly older than this) and `after` (strictly newer).',
    {
      role: z.string().optional(),
      type: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      thread_id: z.string().optional(),
      before: z.string().optional(),
      after: z.string().optional(),
    },
    async (args) => {
      const resp = await brokerFetch<GetHistoryResponse>('/api/get-history', {
        project_id: identity.project_id,
        peer_id: identity.id,
        role: args.role,
        type: args.type,
        limit: args.limit,
        thread_id: args.thread_id,
        before: args.before,
        after: args.after,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp.messages, null, 2) }],
      };
    },
  );

  // ── Shared state ───────────────────────────────────────────

  mcp.tool(
    'set_shared',
    'Set a key-value pair in shared state. Namespace groups related keys (e.g. "contracts", "config", "files", "resume"). `value` accepts either a string OR an object — objects are JSON-encoded automatically so you do not need to call JSON.stringify yourself.',
    {
      namespace: z.string(),
      key: z.string(),
      // [M-3] Accept either a raw string or an object. Several rules
      // in the system prompt instruct the agent to publish structured
      // data (resume snapshots, file metadata, contracts) — forcing
      // the agent to JSON.stringify ahead of time was a foot-gun:
      // either the agent forgot and shipped an object that the SDK
      // refused, or it stringified twice and broke downstream
      // consumers.
      value: z.union([z.string(), z.record(z.string(), z.unknown())]),
    },
    async (args) => {
      const value = typeof args.value === 'string'
        ? args.value
        : JSON.stringify(args.value);
      const resp = await brokerFetch<OkResponse>('/api/shared/set', {
        project_id: identity.project_id,
        namespace: args.namespace,
        key: args.key,
        value,
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
      const resp = await brokerFetch<SharedGetResponse | { error: string }>('/api/shared/get', {
        project_id: identity.project_id,
        peer_id: identity.id,
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
      const resp = await brokerFetch<SharedListResponse>('/api/shared/list', {
        project_id: identity.project_id,
        peer_id: identity.id,
        namespace: args.namespace,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp.keys, null, 2) }],
      };
    },
  );

  // ── Team memory ────────────────────────────────────────────

  // FASE A-3 (v0.3.0): remember writes one decision into the reserved
  // `decisions` namespace without the agent having to think about
  // namespace/key plumbing. Auto-key = <YYYYMMDD>-<first-3-words slug>.
  // Pair this with `recall` — together they form Team Memory.
  mcp.tool(
    'remember',
    'Save a decision the team should remember (architecture choice, contract, tradeoff). Pass the decision summary; an auto-generated key is derived from today\'s date + first 3 words. Pass an explicit `key` only if you want a stable handle to update later. Avoid using this for transient state — use set_shared with namespace="files"/"contracts"/etc for that.',
    {
      summary: z.string().min(4),
      key: z.string().optional(),
    },
    async (args) => {
      const key = args.key && args.key.length > 0
        ? args.key
        : autoDecisionKey(args.summary);
      const resp = await brokerFetch<OkResponse>('/api/shared/set', {
        project_id: identity.project_id,
        namespace: 'decisions',
        key,
        value: args.summary,
        peer_id: identity.id,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...resp, key }) }],
      };
    },
  );

  // FASE A-2 (v0.3.0): recall over the reserved `decisions`
  // namespace. Cheap fuzzy match (LIKE + length-normalized scoring),
  // project-scoped on the broker side. Useful before asking the team
  // a question that may already have been decided.
  mcp.tool(
    'recall',
    'Search this team\'s past decisions before asking a question. Fuzzy-matches a query over keys and values in the project\'s `decisions` namespace and returns the top matches. Use it whenever you are about to ask about an architectural choice, a contract, or "how do we…" — there\'s probably already a decision.',
    {
      query: z.string().min(2),
      limit: z.number().int().min(1).max(20).optional(),
    },
    async (args) => {
      const resp = await brokerFetch<{ matches: unknown[] }>('/api/decisions/recall', {
        project_id: identity.project_id,
        peer_id: identity.id,
        query: args.query,
        limit: args.limit,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp.matches, null, 2) }],
      };
    },
  );

  // [M-4] Expose delete_shared so agents can clean up entries in
  // namespaces that grow forever (e.g. "files" — the dashboard work-
  // desk panel). The broker handler already exists
  // (`handlers.ts:handleSharedDelete`) and is wired to /api/shared/delete;
  // it just wasn't surfaced via MCP.
  mcp.tool(
    'delete_shared',
    'Delete a key from shared state. Returns ok when the key was removed; missing keys return ok too (idempotent).',
    {
      namespace: z.string(),
      key: z.string(),
    },
    async (args) => {
      const resp = await brokerFetch<OkResponse>('/api/shared/delete', {
        project_id: identity.project_id,
        namespace: args.namespace,
        key: args.key,
        peer_id: identity.id,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp) }],
      };
    },
  );

  // ── Threads ────────────────────────────────────────────────

  mcp.tool(
    'get_thread_context',
    'Get a summary of a conversation thread — the last 10 messages concatenated. Use this to understand thread context before responding.',
    {
      thread_id: z.string(),
    },
    async (args) => {
      const resp = await brokerFetch<ThreadSummaryResponse>('/api/threads/summary', {
        project_id: identity.project_id,
        peer_id: identity.id,
        thread_id: args.thread_id,
      });
      return {
        content: [{ type: 'text', text: resp.summary }],
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
      const resp = await brokerFetch<OkResponse>('/api/set-summary', {
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
      const resp = await brokerFetch<OkResponse>('/api/set-role', {
        id: identity.id,
        role: args.role,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(resp) }],
      };
    },
  );
}

// FASE A-3 (v0.3.0): derive a default key from a decision summary so
// the agent can call `remember(...)` without inventing a key. Shape:
// `<YYYYMMDD>-<first-3-words>`. Words are lowercased ASCII; everything
// else is stripped. The full slug is bounded so very long summaries
// don't blow up the SQLite primary key.
//
// Exported for tests — the slugger is the most likely place a future
// regression sneaks in (e.g., a unicode summary producing an empty key).
export function autoDecisionKey(summary: string, now: Date = new Date()): string {
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join('-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  return slug ? `${yyyymmdd}-${slug}` : `${yyyymmdd}-decision`;
}
