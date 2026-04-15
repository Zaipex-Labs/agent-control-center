// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// broker-client.ts reads ACC_HOST / ACC_PORT at module load via config.ts.
// We start a fake broker, set the env var, then DYNAMICALLY import the
// client so config picks up our port.

let httpServer: Server;
let port: number;
let lastBody: unknown = null;
let lastPath: string | null = null;

function startFakeBroker(): Promise<void> {
  return new Promise((done) => {
    httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      lastPath = req.url ?? null;
      if (req.method === 'GET') {
        if (req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        }
        if (req.url === '/broken-json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('not-json{');
          return;
        }
        if (req.url === '/get-ok') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ value: 42 }));
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          lastBody = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          lastBody = null;
        }
        if (req.url === '/broken-json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('not-json{');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, echo: lastBody }));
      });
    });
    httpServer.listen(0, '127.0.0.1', () => {
      port = (httpServer.address() as AddressInfo).port;
      done();
    });
  });
}

type BrokerClient = typeof import('../../src/server/broker-client.js');
let client: BrokerClient;

beforeAll(async () => {
  await startFakeBroker();
  process.env.ACC_PORT = String(port);
  client = await import('../../src/server/broker-client.js');
});

afterAll(() => {
  try {
    httpServer?.close();
  } catch {
    // ignore
  }
});

describe('brokerFetch', () => {
  it('POSTs JSON body and parses JSON response', async () => {
    const resp = await client.brokerFetch<{ ok: boolean; echo: unknown }>('/api/anything', {
      hello: 'world',
      n: 1,
    });
    expect(resp.ok).toBe(true);
    expect(resp.echo).toEqual({ hello: 'world', n: 1 });
    expect(lastPath).toBe('/api/anything');
  });

  it('rejects when the broker returns invalid JSON', async () => {
    await expect(client.brokerFetch('/broken-json', {})).rejects.toThrow(/Invalid JSON/);
  });

  it('sets Content-Length header correctly for multibyte bodies', async () => {
    const resp = await client.brokerFetch<{ ok: boolean; echo: { s: string } }>('/api/utf8', {
      s: 'ñáéíóú · 😀',
    });
    expect(resp.echo.s).toBe('ñáéíóú · 😀');
  });
});

describe('brokerGet', () => {
  it('parses GET JSON response', async () => {
    const resp = await client.brokerGet<{ value: number }>('/get-ok');
    expect(resp.value).toBe(42);
  });

  it('rejects on invalid JSON', async () => {
    await expect(client.brokerGet('/broken-json')).rejects.toThrow(/Invalid JSON/);
  });
});

describe('isBrokerAlive', () => {
  it('returns true when broker /health returns 200', async () => {
    expect(await client.isBrokerAlive()).toBe(true);
  });

  it('returns false when broker is down', async () => {
    await new Promise<void>((r) => httpServer.close(() => r()));
    // tiny delay to make sure the socket is gone
    await new Promise((r) => setTimeout(r, 30));
    expect(await client.isBrokerAlive()).toBe(false);
    // Bring it back so other tests (none now, but for safety) still work.
    await startFakeBroker();
    process.env.ACC_PORT = String(port);
  });
});
