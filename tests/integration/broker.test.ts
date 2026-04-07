import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { initDatabase } from '../../src/broker/database.js';
import {
  parseBody,
  handleHealth,
  handleRegister,
  handleHeartbeat,
  handleListPeers,
  handleSendMessage,
  handleSendToRole,
  handlePollMessages,
  handleGetHistory,
  handleSharedSet,
  handleSharedGet,
  handleUnregister,
} from '../../src/broker/handlers.js';

// ── Test broker on random port ─────────────────────────────────

type PostHandler = (body: unknown, res: ServerResponse) => void;

const POST_ROUTES: Record<string, PostHandler> = {
  '/api/register': handleRegister,
  '/api/heartbeat': handleHeartbeat,
  '/api/list-peers': handleListPeers,
  '/api/send-message': handleSendMessage,
  '/api/send-to-role': handleSendToRole,
  '/api/poll-messages': handlePollMessages,
  '/api/get-history': handleGetHistory,
  '/api/shared/set': handleSharedSet,
  '/api/shared/get': handleSharedGet,
  '/api/unregister': handleUnregister,
};

let server: Server;
let baseUrl: string;

function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    const req = import('node:http').then(http => {
      const r = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
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

function get<T>(path: string): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    import('node:http').then(http => {
      const r = http.request(url, { method: 'GET' }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()) as T });
        });
      });
      r.on('error', reject);
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
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
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

// ── Tests ──────────────────────────────────────────────────────

describe('broker integration', () => {
  it('GET /health returns status ok', async () => {
    const { status, data } = await get<{ status: string }>('/health');
    expect(status).toBe(200);
    expect(data.status).toBe('ok');
  });

  it('full message flow: register → send → poll → history', async () => {
    // Register peer A (backend)
    const regA = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/app/backend', role: 'backend', project_id: 'integ',
    });
    expect(regA.data.id).toHaveLength(8);
    const idA = regA.data.id;

    // Register peer B (frontend)
    const regB = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/app/frontend', role: 'frontend', project_id: 'integ',
    });
    const idB = regB.data.id;

    // List peers — should see both
    const peers = await post<Array<{ id: string; role: string }>>('/api/list-peers', {
      project_id: 'integ',
    });
    expect(peers.data).toHaveLength(2);

    // A sends message to B
    const send1 = await post<{ ok: boolean }>('/api/send-message', {
      project_id: 'integ', from_id: idA, to_id: idB, text: 'Build the login page',
    });
    expect(send1.data.ok).toBe(true);

    // A sends another message to B
    const send2 = await post<{ ok: boolean }>('/api/send-message', {
      project_id: 'integ', from_id: idA, to_id: idB, type: 'task_request', text: 'Add auth form',
    });
    expect(send2.data.ok).toBe(true);

    // B polls — should get both messages
    const poll = await post<{ messages: Array<{ text: string; type: string }> }>('/api/poll-messages', { id: idB });
    expect(poll.data.messages).toHaveLength(2);
    expect(poll.data.messages[0].text).toBe('Build the login page');
    expect(poll.data.messages[1].type).toBe('task_request');

    // B polls again — should be empty (already delivered)
    const poll2 = await post<{ messages: unknown[] }>('/api/poll-messages', { id: idB });
    expect(poll2.data.messages).toHaveLength(0);

    // History shows both messages
    const history = await post<{ messages: Array<{ from_role: string; to_role: string }> }>('/api/get-history', {
      project_id: 'integ',
    });
    expect(history.data.messages).toHaveLength(2);
    expect(history.data.messages[0].from_role).toBe('backend');
    expect(history.data.messages[0].to_role).toBe('frontend');
  });

  it('send-to-role broadcasts to all peers with that role', async () => {
    // Register sender
    const sender = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/ops', role: 'devops', project_id: 'broadcast',
    });

    // Register two backend peers
    const b1 = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/b1', role: 'backend', project_id: 'broadcast',
    });
    const b2 = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/b2', role: 'backend', project_id: 'broadcast',
    });

    // Broadcast to "backend"
    const resp = await post<{ ok: boolean; sent_to: number }>('/api/send-to-role', {
      project_id: 'broadcast', from_id: sender.data.id, role: 'backend', text: 'Deploy v2',
    });
    expect(resp.data.sent_to).toBe(2);

    // Both peers should have the message
    const poll1 = await post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: b1.data.id });
    expect(poll1.data.messages).toHaveLength(1);
    expect(poll1.data.messages[0].text).toBe('Deploy v2');

    const poll2 = await post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: b2.data.id });
    expect(poll2.data.messages).toHaveLength(1);
  });

  it('shared state round-trip', async () => {
    // Set
    const set = await post<{ ok: boolean }>('/api/shared/set', {
      project_id: 'integ', namespace: 'contracts', key: 'api-spec', value: '{"version":"2.1"}', peer_id: 'p1',
    });
    expect(set.data.ok).toBe(true);

    // Get
    const got = await post<{ value: string; updated_by: string }>('/api/shared/get', {
      project_id: 'integ', namespace: 'contracts', key: 'api-spec',
    });
    expect(got.data.value).toBe('{"version":"2.1"}');
    expect(got.data.updated_by).toBe('p1');

    // Get missing
    const missing = await post<{ error: string }>('/api/shared/get', {
      project_id: 'integ', namespace: 'contracts', key: 'nope',
    });
    expect(missing.status).toBe(404);
    expect(missing.data.error).toBe('not found');
  });

  it('heartbeat updates last_seen', async () => {
    const reg = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/hb', role: 'test', project_id: 'hb-test',
    });

    const hb = await post<{ ok: boolean }>('/api/heartbeat', { id: reg.data.id });
    expect(hb.data.ok).toBe(true);
  });

  it('unregister removes a peer', async () => {
    const reg = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/unreg', role: 'test', project_id: 'unreg-test',
    });

    await post('/api/unregister', { id: reg.data.id });

    // Heartbeat should now fail
    const hb = await post<{ ok: boolean; error?: string }>('/api/heartbeat', { id: reg.data.id });
    expect(hb.status).toBe(404);
  });

  it('returns 404 for unknown routes', async () => {
    const { status } = await get<unknown>('/nope');
    expect(status).toBe(404);
  });

  it('returns 404 when sending message to nonexistent peer', async () => {
    const sender = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/x', role: 'a', project_id: 'err-test',
    });
    const resp = await post<{ ok: boolean; error: string }>('/api/send-message', {
      project_id: 'err-test', from_id: sender.data.id, to_id: 'ghost', text: 'hi',
    });
    expect(resp.status).toBe(404);
  });
});
