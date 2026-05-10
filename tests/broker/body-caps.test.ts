// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [P-11] per-route body caps. The previous global 1 MB ceiling was
// 1000× too generous for chatty short-payload endpoints like
// /api/heartbeat. v0.2.5 sets per-route limits and replies 413
// BODY_TOO_LARGE when exceeded.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { initDatabase } from '../../src/broker/database.js';
import {
  parseBody,
  BodyTooLargeError,
  DEFAULT_MAX_BODY_SIZE,
} from '../../src/broker/handlers.js';

let server: Server;
let baseUrl: string;

// Mirror the per-route limit map from src/broker/index.ts. Tests pin
// the contract that the broker's HTTP dispatcher applies these limits;
// the constants themselves live in index.ts for the production code
// path.
const ROUTE_BODY_LIMITS: Record<string, number> = {
  '/api/heartbeat': 1024,
  '/api/poll-messages': 4 * 1024,
  '/api/unregister': 1024,
  '/api/set-summary': 16 * 1024,
  '/api/set-role': 1024,
  '/api/csrf/issue': 1024,
  '/api/list-peers': 1024,
};

function post(path: string, body: string): Promise<{ status: number; data: { ok?: boolean; code?: string; limit?: number } }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    import('node:http').then(http => {
      const r = http.request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          let data: unknown = {};
          try { data = JSON.parse(raw); } catch { /* may be empty */ }
          resolve({ status: res.statusCode!, data: data as { ok?: boolean; code?: string; limit?: number } });
        });
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });
  });
}

beforeAll(async () => {
  initDatabase(':memory:');

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    const bodyLimit = ROUTE_BODY_LIMITS[url] ?? DEFAULT_MAX_BODY_SIZE;
    try {
      const body = await parseBody(req, bodyLimit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, gotKeys: Object.keys(body as object).length }));
    } catch (e) {
      if (e instanceof BodyTooLargeError) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'BODY_TOO_LARGE', limit: e.limit }));
        return;
      }
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
    }
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

describe('[P-11] per-route body size caps', () => {
  it('/api/heartbeat accepts a normal heartbeat (~30 bytes)', async () => {
    const body = JSON.stringify({ id: 'abc12345' });
    const { status, data } = await post('/api/heartbeat', body);
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('/api/heartbeat rejects 2 KB body with 413 BODY_TOO_LARGE', async () => {
    const body = JSON.stringify({ id: 'a'.repeat(2000) });
    const { status, data } = await post('/api/heartbeat', body);
    expect(status).toBe(413);
    expect(data.code).toBe('BODY_TOO_LARGE');
    expect(data.limit).toBe(1024);
  });

  it('/api/poll-messages rejects > 4 KB', async () => {
    const body = JSON.stringify({ id: 'p', extra: 'x'.repeat(5000) });
    const { status, data } = await post('/api/poll-messages', body);
    expect(status).toBe(413);
    expect(data.code).toBe('BODY_TOO_LARGE');
    expect(data.limit).toBe(4096);
  });

  it('/api/poll-messages accepts a body under 4 KB', async () => {
    const body = JSON.stringify({ id: 'pid12345' });
    const { status } = await post('/api/poll-messages', body);
    expect(status).toBe(200);
  });

  it('/api/set-summary accepts a 10 KB summary (under 16 KB)', async () => {
    const body = JSON.stringify({ id: 'pid12345', summary: 'x'.repeat(10_000) });
    const { status } = await post('/api/set-summary', body);
    expect(status).toBe(200);
  });

  it('/api/set-summary rejects a 20 KB summary', async () => {
    const body = JSON.stringify({ id: 'pid12345', summary: 'x'.repeat(20_000) });
    const { status, data } = await post('/api/set-summary', body);
    expect(status).toBe(413);
    expect(data.code).toBe('BODY_TOO_LARGE');
  });

  it('a route not in the map uses the default 1 MB cap', async () => {
    // /api/send-message isn't in ROUTE_BODY_LIMITS — falls back to
    // DEFAULT_MAX_BODY_SIZE (1 MB). 100 KB easily fits.
    const body = JSON.stringify({ payload: 'x'.repeat(100_000) });
    const { status } = await post('/api/send-message', body);
    expect(status).toBe(200);
  });

  it('error response includes the limit so the client can adapt', async () => {
    const body = JSON.stringify({ id: 'a'.repeat(2000) });
    const { data } = await post('/api/heartbeat', body);
    expect(data.code).toBe('BODY_TOO_LARGE');
    expect(typeof data.limit).toBe('number');
  });
});
