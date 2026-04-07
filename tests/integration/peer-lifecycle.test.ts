import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { initDatabase } from '../../src/broker/database.js';
import {
  parseBody,
  handleHealth,
  handleRegister,
  handleHeartbeat,
  handleUnregister,
  handleSetSummary,
  handleSetRole,
  handleListPeers,
} from '../../src/broker/handlers.js';

type PostHandler = (body: unknown, res: ServerResponse) => void;

const POST_ROUTES: Record<string, PostHandler> = {
  '/api/register': handleRegister,
  '/api/heartbeat': handleHeartbeat,
  '/api/unregister': handleUnregister,
  '/api/set-summary': handleSetSummary,
  '/api/set-role': handleSetRole,
  '/api/list-peers': handleListPeers,
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

describe('peer lifecycle integration', () => {
  it('register → set-summary → set-role → heartbeat → list → unregister', async () => {
    const projId = 'lifecycle';

    // Register
    const reg = await post<{ id: string; name: string }>('/api/register', {
      pid: process.pid, cwd: '/lifecycle', role: 'backend', project_id: projId,
    });
    expect(reg.data.id).toHaveLength(8);
    expect(reg.data.name).toBe('Turing');
    const id = reg.data.id;

    // Set summary
    const sum = await post<{ ok: boolean }>('/api/set-summary', { id, summary: 'Building REST API' });
    expect(sum.data.ok).toBe(true);

    // Set role
    const role = await post<{ ok: boolean }>('/api/set-role', { id, role: 'devops' });
    expect(role.data.ok).toBe(true);

    // Heartbeat
    const hb = await post<{ ok: boolean }>('/api/heartbeat', { id });
    expect(hb.data.ok).toBe(true);

    // List peers — should see updated role and summary
    const peers = await post<Array<{ id: string; role: string; summary: string }>>('/api/list-peers', {
      project_id: projId,
    });
    const me = (peers.data as Array<{ id: string; role: string; summary: string }>).find(p => p.id === id);
    expect(me).toBeDefined();
    expect(me!.role).toBe('devops');
    expect(me!.summary).toBe('Building REST API');

    // Unregister
    const unreg = await post<{ ok: boolean }>('/api/unregister', { id });
    expect(unreg.data.ok).toBe(true);

    // Heartbeat should fail
    const hb2 = await post<{ ok: boolean; error: string }>('/api/heartbeat', { id });
    expect(hb2.status).toBe(404);
  });

  it('multiple agents in same project see each other', async () => {
    const projId = 'multi-peer';

    const a = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/ma', role: 'backend', project_id: projId });
    const b = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/mb', role: 'frontend', project_id: projId });
    const c = await post<{ id: string }>('/api/register', { pid: process.pid, cwd: '/mc', role: 'qa', project_id: projId });

    const peers = await post<Array<{ id: string }>>('/api/list-peers', { project_id: projId });
    expect(peers.data).toHaveLength(3);

    // Filter by role
    const backends = await post<Array<{ id: string }>>('/api/list-peers', { project_id: projId, role: 'backend' });
    expect(backends.data).toHaveLength(1);

    // Exclude self
    const withoutA = await post<Array<{ id: string }>>('/api/list-peers', {
      project_id: projId,
      exclude_id: a.data.id,
    });
    expect(withoutA.data).toHaveLength(2);
    expect(withoutA.data.map((p: { id: string }) => p.id)).not.toContain(a.data.id);
  });

  it('agents in different projects are isolated', async () => {
    await post('/api/register', { pid: process.pid, cwd: '/p1a', role: 'backend', project_id: 'iso-proj-1' });
    await post('/api/register', { pid: process.pid, cwd: '/p2a', role: 'backend', project_id: 'iso-proj-2' });

    const peers1 = await post<Array<{ id: string }>>('/api/list-peers', { project_id: 'iso-proj-1' });
    expect(peers1.data).toHaveLength(1);

    const peers2 = await post<Array<{ id: string }>>('/api/list-peers', { project_id: 'iso-proj-2' });
    expect(peers2.data).toHaveLength(1);
  });

  it('scope=machine returns all peers across projects', async () => {
    await post('/api/register', { pid: process.pid, cwd: '/m1', role: 'a', project_id: 'scope-p1' });
    await post('/api/register', { pid: process.pid, cwd: '/m2', role: 'b', project_id: 'scope-p2' });

    const all = await post<Array<{ id: string }>>('/api/list-peers', { project_id: '', scope: 'machine' });
    // At least these 2 (might be more from other tests since DB is shared in this suite)
    expect(all.data.length).toBeGreaterThanOrEqual(2);
  });

  it('default name assignment by role', async () => {
    const backend = await post<{ name: string }>('/api/register', { pid: process.pid, cwd: '/n1', role: 'backend', project_id: 'names' });
    expect(backend.data.name).toBe('Turing');

    const frontend = await post<{ name: string }>('/api/register', { pid: process.pid, cwd: '/n2', role: 'frontend', project_id: 'names' });
    expect(frontend.data.name).toBe('Lovelace');

    const qa = await post<{ name: string }>('/api/register', { pid: process.pid, cwd: '/n3', role: 'qa', project_id: 'names' });
    expect(qa.data.name).toBe('Curie');
  });

  it('custom name overrides default', async () => {
    const reg = await post<{ name: string }>('/api/register', {
      pid: process.pid, cwd: '/custom', role: 'backend', project_id: 'names',
      name: 'CustomBot',
    });
    expect(reg.data.name).toBe('CustomBot');
  });

  it('register rejects missing required fields', async () => {
    const r1 = await post<{ ok: boolean }>('/api/register', { pid: 123 });
    expect(r1.status).toBe(400);

    const r2 = await post<{ ok: boolean }>('/api/register', { cwd: '/x' });
    expect(r2.status).toBe(400);

    const r3 = await post<{ ok: boolean }>('/api/register', {});
    expect(r3.status).toBe(400);
  });
});
