// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { createBrokerServer } from '../../src/broker/index.js';

let server: Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe('createBrokerServer', () => {
  it('creates a server that responds to /health', async () => {
    server = createBrokerServer();

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address() as { port: number };
    const resp = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(resp.status).toBe(200);

    const data = await resp.json() as { status: string; peers: number };
    expect(data.status).toBe('ok');
    expect(typeof data.peers).toBe('number');
  });

  it('serves SPA fallback for unknown GET routes', async () => {
    server = createBrokerServer();

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address() as { port: number };
    const resp = await fetch(`http://127.0.0.1:${addr.port}/nonexistent`);
    // SPA fallback: returns 200 with index.html if dashboard is built, 404 otherwise
    expect([200, 404]).toContain(resp.status);
  });

  it('returns 404 for unknown POST routes', async () => {
    server = createBrokerServer();

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address() as { port: number };
    const resp = await fetch(`http://127.0.0.1:${addr.port}/fake-endpoint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(resp.status).toBe(404);
  });

  it('returns 400 for invalid JSON body', async () => {
    server = createBrokerServer();

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address() as { port: number };
    const resp = await fetch(`http://127.0.0.1:${addr.port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });
    expect(resp.status).toBe(400);
  });

  it('handles POST /register correctly', async () => {
    server = createBrokerServer();

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', resolve);
    });

    const addr = server.address() as { port: number };
    const resp = await fetch(`http://127.0.0.1:${addr.port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: process.pid,
        cwd: '/tmp/test',
        role: 'backend',
        project_id: 'test-proj',
      }),
    });
    expect(resp.status).toBe(200);

    const data = await resp.json() as { id: string; name: string };
    expect(data.id).toHaveLength(8);
    expect(data.name).toBe('Turing'); // backend → Turing
  });
});
