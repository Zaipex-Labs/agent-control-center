// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { initDatabase } from '../../src/broker/database.js';
import {
  parseBody,
  handleHealth,
  handleRegister,
  handleSendMessage,
  handleSendToRole,
  handlePollMessages,
  handleGetHistory,
  handleUnregister,
} from '../../src/broker/handlers.js';

type PostHandler = (body: unknown, res: ServerResponse) => void;

const POST_ROUTES: Record<string, PostHandler> = {
  '/api/register': handleRegister,
  '/api/send-message': handleSendMessage,
  '/api/send-to-role': handleSendToRole,
  '/api/poll-messages': handlePollMessages,
  '/api/get-history': handleGetHistory,
  '/api/unregister': handleUnregister,
};

let server: Server;
let baseUrl: string;

function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    import('node:http').then(http => {
      const r = http.request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()) as T });
        });
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
  });
}

beforeAll(async () => {
  initDatabase(':memory:');

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url === '/health') return handleHealth(res);
    if (req.method === 'POST') {
      const handler = POST_ROUTES[url];
      if (handler) {
        const body = await parseBody(req);
        return handler(body, res);
      }
    }
    res.writeHead(404);
    res.end(JSON.stringify({ ok: false }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('message flow integration', () => {
  it('messages between 3 agents in correct order', async () => {
    const projId = 'msg-flow-3';

    const a = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/a', role: 'backend', project_id: projId });
    const b = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/b', role: 'frontend', project_id: projId });
    const c = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/c', role: 'qa', project_id: projId });

    // A → B
    await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: b.data.id, text: 'API ready' });
    // B → C
    await post('/api/send-message', { project_id: projId, from_id: b.data.id, to_id: c.data.id, text: 'UI ready for testing' });
    // A → C
    await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: c.data.id, text: 'Check /users endpoint' });

    // B should have 1 message
    const pollB = await post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: b.data.id });
    expect(pollB.data.messages).toHaveLength(1);
    expect(pollB.data.messages[0].text).toBe('API ready');

    // C should have 2 messages in order
    const pollC = await post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: c.data.id });
    expect(pollC.data.messages).toHaveLength(2);
    expect(pollC.data.messages[0].text).toBe('UI ready for testing');
    expect(pollC.data.messages[1].text).toBe('Check /users endpoint');

    // A should have 0 messages
    const pollA = await post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: a.data.id });
    expect(pollA.data.messages).toHaveLength(0);
  });

  it('message types are preserved', async () => {
    const projId = 'msg-types';
    const a = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/x', role: 'backend', project_id: projId });
    const b = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/y', role: 'frontend', project_id: projId });

    await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: b.data.id, type: 'question', text: 'Ready?' });
    await post('/api/send-message', { project_id: projId, from_id: b.data.id, to_id: a.data.id, type: 'response', text: 'Yes' });
    await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: b.data.id, type: 'task_request', text: 'Build form' });
    await post('/api/send-message', { project_id: projId, from_id: b.data.id, to_id: a.data.id, type: 'task_complete', text: 'Done' });

    const pollB = await post<{ messages: Array<{ type: string }> }>('/api/poll-messages', { id: b.data.id });
    expect(pollB.data.messages[0].type).toBe('question');
    expect(pollB.data.messages[1].type).toBe('task_request');

    const pollA = await post<{ messages: Array<{ type: string }> }>('/api/poll-messages', { id: a.data.id });
    expect(pollA.data.messages[0].type).toBe('response');
    expect(pollA.data.messages[1].type).toBe('task_complete');
  });

  it('history includes all messages in project', async () => {
    const projId = 'hist-all';
    const a = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/ha', role: 'backend', project_id: projId });
    const b = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/hb', role: 'frontend', project_id: projId });

    await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: b.data.id, text: 'msg1' });
    await post('/api/send-message', { project_id: projId, from_id: b.data.id, to_id: a.data.id, text: 'msg2' });
    await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: b.data.id, text: 'msg3' });

    const hist = await post<{ messages: Array<{ text: string; from_role: string; to_role: string }> }>('/api/get-history', {
      project_id: projId,
    });
    expect(hist.data.messages).toHaveLength(3);
  });

  it('history filters by role', async () => {
    const projId = 'hist-role';
    const a = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/ra', role: 'backend', project_id: projId });
    const b = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/rb', role: 'frontend', project_id: projId });
    const c = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/rc', role: 'devops', project_id: projId });

    await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: b.data.id, text: 'A→B' });
    await post('/api/send-message', { project_id: projId, from_id: c.data.id, to_id: b.data.id, text: 'C→B' });
    await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: c.data.id, text: 'A→C' });

    // Filter by "devops" — should see C→B (from) and A→C (to)
    const hist = await post<{ messages: Array<{ text: string }> }>('/api/get-history', {
      project_id: projId,
      role: 'devops',
    });
    expect(hist.data.messages).toHaveLength(2);
  });

  it('history respects limit', async () => {
    const projId = 'hist-limit';
    const a = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/la', role: 'backend', project_id: projId });
    const b = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/lb', role: 'frontend', project_id: projId });

    for (let i = 0; i < 10; i++) {
      await post('/api/send-message', { project_id: projId, from_id: a.data.id, to_id: b.data.id, text: `msg-${i}` });
    }

    const hist = await post<{ messages: unknown[] }>('/api/get-history', {
      project_id: projId,
      limit: 3,
    });
    expect(hist.data.messages).toHaveLength(3);
  });

  it('send-to-role skips sender even if same role', async () => {
    const projId = 'str-self';
    const a = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/sa', role: 'backend', project_id: projId });
    const b = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/sb', role: 'backend', project_id: projId });

    // A sends to role "backend" — both A and B have that role
    const resp = await post<{ sent_to: number }>('/api/send-to-role', {
      project_id: projId,
      from_id: a.data.id,
      role: 'backend',
      text: 'broadcast',
    });
    // Both A and B receive (send-to-role doesn't exclude sender)
    expect(resp.data.sent_to).toBe(2);
  });

  it('unregistered peer cannot receive messages', async () => {
    const projId = 'unreg-recv';
    const a = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/ua', role: 'backend', project_id: projId });
    const b = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/ub', role: 'frontend', project_id: projId });

    // Unregister B
    await post('/api/unregister', { id: b.data.id });

    // Try to send to B — should fail
    const resp = await post<{ ok: boolean; error: string }>('/api/send-message', {
      project_id: projId,
      from_id: a.data.id,
      to_id: b.data.id,
      text: 'hello',
    });
    expect(resp.status).toBe(404);
  });
});
