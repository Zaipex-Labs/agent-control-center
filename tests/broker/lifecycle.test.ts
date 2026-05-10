// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import WebSocket from 'ws';
import {
  createBrokerServer,
  shutdownBroker,
  installLifecycleHandlers,
} from '../../src/broker/index.js';
import { closeDatabase, getDb } from '../../src/broker/database.js';

// [QW-5] — broker must clean up gracefully on signal / crash. No PTY
// children orphaned, WAL checkpointed, WS clients see a clean 1001
// instead of a TCP RST. We can't actually kill the test process with
// SIGTERM mid-test (it would kill vitest too), so we drive the same
// shutdown path the signal handler invokes and assert observable
// effects.

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as { port: number }).port);
  }));
}

function openClient(port: number, path = '/ws'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

describe('shutdownBroker (QW-5)', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    process.env['ACC_HOME'] = process.env['ACC_HOME'] ?? '/tmp/acc-test-lifecycle';
    server = createBrokerServer();
    port = await listen(server);
  });

  afterAll(() => {
    // safety net — if the test failed before shutdown, force-close.
    try { closeDatabase(); } catch { /* ignore */ }
  });

  it('closes connected dashboard WS clients with code 1001', async () => {
    const ws = await openClient(port, '/ws');
    const closeP = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reasonBuf) => resolve({ code, reason: reasonBuf.toString() }));
    });

    await shutdownBroker(server, 'test SIGTERM');

    const closed = await closeP;
    expect(closed.code).toBe(1001);
    expect(closed.reason).toMatch(/shutting down/i);
  }, 10_000);

  it('closes the HTTP server (no further connections accepted)', async () => {
    // Server is closed by the previous test; opening should fail.
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });

  it('closes the database (subsequent queries throw)', () => {
    // Re-shutting is a no-op (already shut). Verify db is gone.
    expect(() => getDb().prepare('SELECT 1').get()).toThrow();
  });

  it('is idempotent (second call resolves without error)', async () => {
    await expect(shutdownBroker(server, 'test idempotent')).resolves.toBeUndefined();
  });
});

describe('installLifecycleHandlers (QW-5)', () => {
  it('registers SIGTERM, SIGINT, uncaughtException, unhandledRejection', () => {
    // Snapshot listener counts before/after to verify we attach.
    const before = {
      SIGTERM: process.listenerCount('SIGTERM'),
      SIGINT: process.listenerCount('SIGINT'),
      uncaughtException: process.listenerCount('uncaughtException'),
      unhandledRejection: process.listenerCount('unhandledRejection'),
    };

    const fakeServer = { close: (cb: () => void) => cb() } as unknown as Server;
    installLifecycleHandlers(fakeServer);

    expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM + 1);
    expect(process.listenerCount('SIGINT')).toBe(before.SIGINT + 1);
    expect(process.listenerCount('uncaughtException')).toBe(before.uncaughtException + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(before.unhandledRejection + 1);

    // Detach our listeners so we don't leak into other tests.
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    // Don't fully wipe uncaughtException/unhandledRejection — vitest
    // uses them. Trim down to the count we observed before.
    const trim = (ev: 'uncaughtException' | 'unhandledRejection', target: number) => {
      const fns = process.listeners(ev) as Array<(...args: unknown[]) => void>;
      while (fns.length > target) {
        const f = fns.pop();
        if (f) process.off(ev, f);
      }
    };
    trim('uncaughtException', before.uncaughtException);
    trim('unhandledRejection', before.unhandledRejection);
  });
});
