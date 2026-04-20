// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture broker calls so each test can assert request shape + mock response.
const brokerCalls: Array<{ path: string; body: unknown }> = [];
let nextResponse: unknown = { ok: true };

vi.mock('../../src/server/broker-client.js', () => ({
  brokerFetch: vi.fn(async (path: string, body: unknown) => {
    brokerCalls.push({ path, body });
    return nextResponse;
  }),
  brokerGet: vi.fn(async () => ({})),
  isBrokerAlive: vi.fn(async () => true),
  ensureBroker: vi.fn(async () => undefined),
}));

// Fake McpServer that records every .tool() registration.
type ToolHandler = (args: any) => Promise<any>;
interface RegisteredTool {
  name: string;
  description: string;
  schema?: Record<string, unknown>;
  handler: ToolHandler;
}

function createFakeMcp() {
  const tools = new Map<string, RegisteredTool>();
  const mcp = {
    tool(name: string, description: string, schemaOrHandler: any, maybeHandler?: any) {
      let schema: Record<string, unknown> | undefined;
      let handler: ToolHandler;
      if (typeof schemaOrHandler === 'function') {
        handler = schemaOrHandler;
      } else {
        schema = schemaOrHandler;
        handler = maybeHandler;
      }
      tools.set(name, { name, description, schema, handler });
    },
  };
  return { mcp, tools };
}

const identity = {
  id: 'agent-1',
  name: 'Turing',
  role: 'backend',
  project_id: 'proj-x',
  summary: 'doing stuff',
  cwd: '/tmp/proj',
};

let registerTools: typeof import('../../src/server/tools.js').registerTools;

beforeEach(async () => {
  brokerCalls.length = 0;
  nextResponse = { ok: true };
  const mod = await import('../../src/server/tools.js');
  registerTools = mod.registerTools;
});

function setup() {
  const { mcp, tools } = createFakeMcp();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerTools(mcp as any, { ...identity });
  return tools;
}

describe('registerTools — registration', () => {
  it('registers all expected tools', () => {
    const tools = setup();
    const names = Array.from(tools.keys()).sort();
    expect(names).toEqual([
      'check_messages',
      'get_history',
      'get_shared',
      'get_thread_context',
      'list_peers',
      'list_shared',
      'send_message',
      'send_to_role',
      'set_role',
      'set_shared',
      'set_summary',
      'whoami',
    ]);
  });

  it('each tool has a non-empty description', () => {
    const tools = setup();
    for (const t of tools.values()) {
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});

describe('list_peers', () => {
  it('uses default scope "project" and forwards identity', async () => {
    nextResponse = [];
    const tools = setup();
    await tools.get('list_peers')!.handler({});
    expect(brokerCalls[0]!.path).toBe('/api/list-peers');
    expect(brokerCalls[0]!.body).toMatchObject({
      project_id: 'proj-x',
      scope: 'project',
      exclude_id: 'agent-1',
      cwd: '/tmp/proj',
    });
  });

  it('passes custom scope', async () => {
    nextResponse = [];
    const tools = setup();
    await tools.get('list_peers')!.handler({ scope: 'machine' });
    expect((brokerCalls[0]!.body as any).scope).toBe('machine');
  });
});

describe('whoami', () => {
  it('returns the identity as JSON text without hitting the broker', async () => {
    const tools = setup();
    const result = await tools.get('whoami')!.handler({});
    expect(brokerCalls).toHaveLength(0);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toMatchObject({
      name: 'Turing',
      id: 'agent-1',
      role: 'backend',
      project_id: 'proj-x',
    });
  });
});

describe('send_message', () => {
  it('forwards to /api/send-message with default type "message"', async () => {
    const tools = setup();
    await tools.get('send_message')!.handler({
      to_id: 'agent-2',
      text: 'hello',
    });
    expect(brokerCalls[0]!.path).toBe('/api/send-message');
    expect(brokerCalls[0]!.body).toMatchObject({
      project_id: 'proj-x',
      from_id: 'agent-1',
      to_id: 'agent-2',
      type: 'message',
      text: 'hello',
    });
  });

  it('serializes metadata as a JSON string', async () => {
    const tools = setup();
    await tools.get('send_message')!.handler({
      to_id: 'agent-2',
      text: 'hi',
      metadata: { topic: 'sidebar' },
    });
    expect((brokerCalls[0]!.body as any).metadata).toBe('{"topic":"sidebar"}');
  });

  it('passes through custom type and thread_id', async () => {
    const tools = setup();
    await tools.get('send_message')!.handler({
      to_id: 'agent-2',
      text: 'done',
      type: 'task_complete',
      thread_id: 'thr-1',
    });
    expect((brokerCalls[0]!.body as any).type).toBe('task_complete');
    expect((brokerCalls[0]!.body as any).thread_id).toBe('thr-1');
  });

  it('forwards attachments array through to the broker', async () => {
    const tools = setup();
    const att = { hash: 'abc', mime: 'image/png', name: 's.png', size: 10 };
    await tools.get('send_message')!.handler({
      to_id: 'agent-2',
      text: 'mira',
      attachments: [att],
    });
    expect((brokerCalls[0]!.body as any).attachments).toEqual([att]);
  });
});

describe('send_to_role', () => {
  it('forwards attachments array to the broker', async () => {
    nextResponse = { ok: true, sent_to: 2 };
    const tools = setup();
    const att = { hash: 'abc', mime: 'image/png', name: 's.png', size: 10 };
    await tools.get('send_to_role')!.handler({
      role: 'frontend',
      text: 'hi all',
      attachments: [att],
    });
    expect((brokerCalls[0]!.body as any).attachments).toEqual([att]);
  });

  it('forwards to /api/send-to-role and returns "Sent to N agent(s)"', async () => {
    nextResponse = { ok: true, sent_to: 3 };
    const tools = setup();
    const result = await tools.get('send_to_role')!.handler({
      role: 'frontend',
      text: 'heads up',
    });
    expect(brokerCalls[0]!.path).toBe('/api/send-to-role');
    expect((brokerCalls[0]!.body as any).role).toBe('frontend');
    expect(result.content[0].text).toBe('Sent to 3 agent(s)');
  });
});

describe('check_messages', () => {
  it('calls /api/poll-messages with this agent id', async () => {
    nextResponse = { messages: [] };
    const tools = setup();
    await tools.get('check_messages')!.handler({});
    expect(brokerCalls[0]!.path).toBe('/api/poll-messages');
    expect(brokerCalls[0]!.body).toEqual({ id: 'agent-1' });
  });
});

describe('get_history', () => {
  it('calls /api/get-history with filters forwarded', async () => {
    nextResponse = { messages: [] };
    const tools = setup();
    await tools.get('get_history')!.handler({
      role: 'backend',
      type: 'question',
      limit: 10,
      thread_id: 'thr-2',
    });
    expect(brokerCalls[0]!.path).toBe('/api/get-history');
    expect(brokerCalls[0]!.body).toMatchObject({
      project_id: 'proj-x',
      role: 'backend',
      type: 'question',
      limit: 10,
      thread_id: 'thr-2',
    });
  });
});

describe('shared state tools', () => {
  it('set_shared posts namespace/key/value + peer_id', async () => {
    const tools = setup();
    await tools.get('set_shared')!.handler({
      namespace: 'contracts',
      key: 'user',
      value: '{"id":"string"}',
    });
    expect(brokerCalls[0]!.path).toBe('/api/shared/set');
    expect(brokerCalls[0]!.body).toMatchObject({
      project_id: 'proj-x',
      namespace: 'contracts',
      key: 'user',
      value: '{"id":"string"}',
      peer_id: 'agent-1',
    });
  });

  it('get_shared queries /api/shared/get', async () => {
    nextResponse = { value: 'v', updated_by: 'agent-1', updated_at: 'now' };
    const tools = setup();
    await tools.get('get_shared')!.handler({ namespace: 'config', key: 'db' });
    expect(brokerCalls[0]!.path).toBe('/api/shared/get');
    expect(brokerCalls[0]!.body).toMatchObject({
      project_id: 'proj-x',
      namespace: 'config',
      key: 'db',
    });
  });

  it('list_shared queries /api/shared/list and returns key array text', async () => {
    nextResponse = { keys: ['a', 'b', 'c'] };
    const tools = setup();
    const result = await tools.get('list_shared')!.handler({ namespace: 'types' });
    expect(brokerCalls[0]!.path).toBe('/api/shared/list');
    expect(JSON.parse(result.content[0].text)).toEqual(['a', 'b', 'c']);
  });
});

describe('get_thread_context', () => {
  it('calls /api/threads/summary and returns the summary text directly', async () => {
    nextResponse = { summary: '3 messages about auth' };
    const tools = setup();
    const result = await tools.get('get_thread_context')!.handler({ thread_id: 'thr-42' });
    expect(brokerCalls[0]!.path).toBe('/api/threads/summary');
    expect(brokerCalls[0]!.body).toEqual({ thread_id: 'thr-42' });
    expect(result.content[0].text).toBe('3 messages about auth');
  });
});

describe('identity tools', () => {
  it('set_summary updates local identity and posts to broker', async () => {
    const tools = setup();
    await tools.get('set_summary')!.handler({ summary: 'now testing' });
    expect(brokerCalls[0]!.path).toBe('/api/set-summary');
    expect(brokerCalls[0]!.body).toMatchObject({
      id: 'agent-1',
      summary: 'now testing',
    });
  });

  it('set_role updates local identity and posts to broker', async () => {
    const tools = setup();
    await tools.get('set_role')!.handler({ role: 'qa' });
    expect(brokerCalls[0]!.path).toBe('/api/set-role');
    expect(brokerCalls[0]!.body).toMatchObject({
      id: 'agent-1',
      role: 'qa',
    });
  });
});
