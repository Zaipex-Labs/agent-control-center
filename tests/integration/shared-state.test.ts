import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { initDatabase } from '../../src/broker/database.js';
import {
  parseBody,
  handleHealth,
  handleRegister,
  handleSharedSet,
  handleSharedGet,
  handleSharedList,
  handleSharedDelete,
} from '../../src/broker/handlers.js';

type PostHandler = (body: unknown, res: ServerResponse) => void;

const POST_ROUTES: Record<string, PostHandler> = {
  '/api/register': handleRegister,
  '/api/shared/set': handleSharedSet,
  '/api/shared/get': handleSharedGet,
  '/api/shared/list': handleSharedList,
  '/api/shared/delete': handleSharedDelete,
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

describe('shared state integration', () => {
  it('full CRUD lifecycle: set → get → list → delete → get (404)', async () => {
    // Set a value
    const setResp = await post<{ ok: boolean }>('/api/shared/set', {
      project_id: 'ss-test',
      namespace: 'contracts',
      key: 'user-api',
      value: JSON.stringify({ version: '1.0', endpoints: ['/users'] }),
      peer_id: 'agent-1',
    });
    expect(setResp.data.ok).toBe(true);

    // Get it back
    const getResp = await post<{ value: string; updated_by: string; updated_at: string }>('/api/shared/get', {
      project_id: 'ss-test',
      namespace: 'contracts',
      key: 'user-api',
    });
    expect(getResp.status).toBe(200);
    const parsed = JSON.parse(getResp.data.value);
    expect(parsed.version).toBe('1.0');
    expect(getResp.data.updated_by).toBe('agent-1');

    // List keys
    const listResp = await post<{ keys: string[] }>('/api/shared/list', {
      project_id: 'ss-test',
      namespace: 'contracts',
    });
    expect(listResp.data.keys).toContain('user-api');

    // Delete
    const delResp = await post<{ ok: boolean }>('/api/shared/delete', {
      project_id: 'ss-test',
      namespace: 'contracts',
      key: 'user-api',
      peer_id: 'agent-1',
    });
    expect(delResp.data.ok).toBe(true);

    // Verify deleted
    const getAgain = await post<{ error: string }>('/api/shared/get', {
      project_id: 'ss-test',
      namespace: 'contracts',
      key: 'user-api',
    });
    expect(getAgain.status).toBe(404);
  });

  it('upsert overwrites existing value', async () => {
    await post('/api/shared/set', {
      project_id: 'ss-test',
      namespace: 'config',
      key: 'port',
      value: '3000',
      peer_id: 'agent-1',
    });

    await post('/api/shared/set', {
      project_id: 'ss-test',
      namespace: 'config',
      key: 'port',
      value: '8080',
      peer_id: 'agent-2',
    });

    const resp = await post<{ value: string; updated_by: string }>('/api/shared/get', {
      project_id: 'ss-test',
      namespace: 'config',
      key: 'port',
    });
    expect(resp.data.value).toBe('8080');
    expect(resp.data.updated_by).toBe('agent-2');
  });

  it('namespaces are isolated', async () => {
    await post('/api/shared/set', {
      project_id: 'ss-test',
      namespace: 'ns-a',
      key: 'shared-key',
      value: 'value-a',
      peer_id: 'p1',
    });

    await post('/api/shared/set', {
      project_id: 'ss-test',
      namespace: 'ns-b',
      key: 'shared-key',
      value: 'value-b',
      peer_id: 'p1',
    });

    const respA = await post<{ value: string }>('/api/shared/get', {
      project_id: 'ss-test',
      namespace: 'ns-a',
      key: 'shared-key',
    });
    expect(respA.data.value).toBe('value-a');

    const respB = await post<{ value: string }>('/api/shared/get', {
      project_id: 'ss-test',
      namespace: 'ns-b',
      key: 'shared-key',
    });
    expect(respB.data.value).toBe('value-b');
  });

  it('projects are isolated', async () => {
    await post('/api/shared/set', {
      project_id: 'proj-x',
      namespace: 'ns',
      key: 'k',
      value: 'from-x',
      peer_id: 'p1',
    });

    const resp = await post<{ error: string }>('/api/shared/get', {
      project_id: 'proj-y',
      namespace: 'ns',
      key: 'k',
    });
    expect(resp.status).toBe(404);
  });

  it('rejects set with missing fields', async () => {
    const resp = await post<{ ok: boolean; error: string }>('/api/shared/set', {
      project_id: 'ss-test',
      namespace: 'ns',
      // missing: key, value, peer_id
    });
    expect(resp.status).toBe(400);
  });

  it('rejects get with missing fields', async () => {
    const resp = await post<{ ok: boolean; error: string }>('/api/shared/get', {
      project_id: 'ss-test',
      // missing: namespace, key
    });
    expect(resp.status).toBe(400);
  });

  it('list returns empty array for nonexistent namespace', async () => {
    const resp = await post<{ keys: string[] }>('/api/shared/list', {
      project_id: 'ss-test',
      namespace: 'nonexistent-ns',
    });
    expect(resp.data.keys).toHaveLength(0);
  });
});
