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
    const _req = import('node:http').then(http => {
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

  // Full message flow + send-to-role broadcast are covered end-to-end
  // in full-flow.test.ts and message-flow.test.ts; not repeated here.

  it('shared state round-trip', async () => {
    // [S-NEW-3] register the peer that will issue the calls so it
    // passes the membership gate.
    const reg = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/p1', role: 'agent', project_id: 'integ',
    });
    const peerId = reg.data.id;

    // Set
    const set = await post<{ ok: boolean }>('/api/shared/set', {
      project_id: 'integ', namespace: 'contracts', key: 'api-spec', value: '{"version":"2.1"}', peer_id: peerId,
    });
    expect(set.data.ok).toBe(true);

    // Get
    const got = await post<{ value: string; updated_by: string }>('/api/shared/get', {
      project_id: 'integ', namespace: 'contracts', key: 'api-spec', peer_id: peerId,
    });
    expect(got.data.value).toBe('{"version":"2.1"}');
    expect(got.data.updated_by).toBe(peerId);

    // Get missing
    const missing = await post<{ error: string }>('/api/shared/get', {
      project_id: 'integ', namespace: 'contracts', key: 'nope', peer_id: peerId,
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
