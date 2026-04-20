// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../../src/broker/database.js';

// End-to-end round-trip at broker level:
// upload blob → register peers → send message with attachment →
// read history and parse metadata → download the blob by hash.

let server: Server;
let baseUrl: string;
let home: string;

beforeAll(async () => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'acc-att-flow-'));
  // After resetModules, re-import database.js and initialize ON THE FRESH
  // instance — otherwise handlers.ts imports a different (uninitialised)
  // database module and getDb() returns undefined.
  const { initDatabase: initFresh } = await import('../../src/broker/database.js');
  initFresh(':memory:');
  const { setBlobsRoot } = await import('../../src/broker/blobs.js');
  setBlobsRoot(join(home, 'blobs'));
  const H = await import('../../src/broker/handlers.js');

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'POST' && url === '/api/blobs/upload') return H.handleUploadBlob(req, res);
    const blob = url.match(/^\/api\/blobs\/([a-f0-9]{64})$/);
    if (method === 'GET' && blob) return H.handleDownloadBlob(blob[1], res);

    if (method === 'POST') {
      try {
        const body = await H.parseBody(req);
        if (url === '/api/register') return H.handleRegister(body, res);
        if (url === '/api/send-message') return H.handleSendMessage(body, res);
        if (url === '/api/get-history') return H.handleGetHistory(body, res);
      } catch {
        res.writeHead(400); res.end('{}');
        return;
      }
    }
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  const { setBlobsRoot } = await import('../../src/broker/blobs.js');
  setBlobsRoot(null);
  rmSync(home, { recursive: true, force: true });
});

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return (text ? JSON.parse(text) : {}) as T;
}

describe('attachments round-trip', () => {
  it('upload → send → history → download reproduces bytes', async () => {
    // 1. upload
    const up = await fetch(`${baseUrl}/api/blobs/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'X-Filename': encodeURIComponent('login mockup.png'),
      },
      body: Buffer.from('fake png bytes for testing'),
    }).then(r => r.json());
    expect(up.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(up.name).toBe('login mockup.png');

    // 2. register two peers
    const a = await post<{ id: string }>('/api/register', {
      project_id: 'demo', pid: process.pid, cwd: '/tmp/a', role: 'frontend', name: 'Lovelace',
    });
    const b = await post<{ id: string }>('/api/register', {
      project_id: 'demo', pid: process.pid, cwd: '/tmp/b', role: 'backend', name: 'Turing',
    });

    // 3. send message with attachment
    const sent = await post<{ ok: boolean }>('/api/send-message', {
      project_id: 'demo',
      from_id: a.id,
      to_id: b.id,
      text: 'mira este mockup',
      attachments: [up],
    });
    expect(sent.ok).toBe(true);

    // 4. read history, confirm attachment survived metadata round-trip
    const hist = await post<{ messages: Array<{ text: string; metadata: string | null }> }>('/api/get-history', {
      project_id: 'demo',
      limit: 10,
    });
    expect(hist.messages.length).toBe(1);
    const parsed = JSON.parse(hist.messages[0].metadata ?? '{}');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].hash).toBe(up.hash);
    expect(parsed.attachments[0].name).toBe('login mockup.png');

    // 5. download blob by hash, bytes must match
    const dl = await fetch(`${baseUrl}/api/blobs/${up.hash}`);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('image/png');
    const buf = Buffer.from(await dl.arrayBuffer());
    expect(buf.toString()).toBe('fake png bytes for testing');
  });
});
