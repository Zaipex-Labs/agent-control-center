// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createBrokerServer } from '../../src/broker/index.js';
import { isAllowedOrigin } from '../../src/broker/origin.js';

// [QW-2] — WebSocketServer must reject upgrades whose Origin is not
// localhost / 127.0.0.1 / [::1] (cierra S-NEW-2: WS-hijack RCE via the
// terminal stdin from a remote webpage).
//
// Policy (audit doc §3, line 103):
//   ✓ Origin: undefined  AND remote = loopback         → allow
//   ✓ Origin: http(s)://localhost(:port)?              → allow
//   ✓ Origin: http(s)://127.0.0.1(:port)?              → allow
//   ✗ Origin: http://attacker.com                      → reject 403
//   ✗ Origin: http://10.0.0.1                          → reject 403

let server: Server | null = null;
let port: number;
let home: string;

async function startBroker(): Promise<void> {
  // Each test file MUST use its own ACC_HOME; vitest can co-schedule
  // files in the same worker process, and a shared SQLite WAL + two
  // concurrent connections trips SQLITE_BUSY on macOS APFS (CI macOS
  // 22.x failed exactly here on first push).
  home = mkdtempSync(join(tmpdir(), 'acc-test-ws-'));
  process.env['ACC_HOME'] = home;
  server = createBrokerServer();
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  port = (server!.address() as { port: number }).port;
}

async function stopBroker(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (home) {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

beforeAll(async () => {
  await startBroker();
});

afterAll(async () => {
  await stopBroker();
});

function tryWs(path: string, headers?: Record<string, string>): Promise<{
  opened: boolean;
  closeCode?: number;
  upgradeStatus?: number;
}> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers: headers ?? {},
    });
    let upgradeStatus: number | undefined;
    let opened = false;
    ws.on('upgrade', (msg: IncomingMessage) => {
      upgradeStatus = msg.statusCode;
    });
    ws.on('unexpected-response', (_req, msg) => {
      upgradeStatus = msg.statusCode;
      ws.terminate();
      resolve({ opened: false, upgradeStatus });
    });
    ws.on('open', () => {
      opened = true;
      ws.close();
    });
    ws.on('close', (code) => {
      resolve({ opened, closeCode: code, upgradeStatus });
    });
    ws.on('error', () => {
      // Connection refused / ECONNRESET — server destroyed the socket
      resolve({ opened, upgradeStatus });
    });
  });
}

describe('isAllowedOrigin (unit)', () => {
  function fakeReq(origin: string | undefined, remote = '127.0.0.1'): IncomingMessage {
    return {
      headers: origin === undefined ? {} : { origin },
      socket: { remoteAddress: remote },
    } as unknown as IncomingMessage;
  }

  it('accepts localhost origin variants', () => {
    expect(isAllowedOrigin(fakeReq('http://localhost'))).toBe(true);
    expect(isAllowedOrigin(fakeReq('http://localhost:7899'))).toBe(true);
    expect(isAllowedOrigin(fakeReq('http://127.0.0.1:8080'))).toBe(true);
    expect(isAllowedOrigin(fakeReq('https://127.0.0.1'))).toBe(true);
    expect(isAllowedOrigin(fakeReq('http://[::1]:7899'))).toBe(true);
  });

  it('rejects external origins regardless of remote', () => {
    expect(isAllowedOrigin(fakeReq('http://attacker.com'))).toBe(false);
    expect(isAllowedOrigin(fakeReq('https://evil.localhost.attacker.com'))).toBe(false);
    expect(isAllowedOrigin(fakeReq('http://10.0.0.1'))).toBe(false);
    expect(isAllowedOrigin(fakeReq('http://localhost.attacker.com'))).toBe(false);
    expect(isAllowedOrigin(fakeReq('http://127.0.0.1.attacker.com'))).toBe(false);
  });

  it('accepts no-origin only when remote is loopback', () => {
    expect(isAllowedOrigin(fakeReq(undefined, '127.0.0.1'))).toBe(true);
    expect(isAllowedOrigin(fakeReq(undefined, '::1'))).toBe(true);
    expect(isAllowedOrigin(fakeReq(undefined, '::ffff:127.0.0.1'))).toBe(true);
    // Remote IS NOT loopback — would only happen if the broker bound to
    // 0.0.0.0 by misconfiguration. Last line of defense kicks in.
    expect(isAllowedOrigin(fakeReq(undefined, '10.0.0.5'))).toBe(false);
    expect(isAllowedOrigin(fakeReq(undefined, '203.0.113.7'))).toBe(false);
  });
});

describe('/ws (events) end-to-end', () => {
  it('accepts WS with Origin: http://localhost:9999', async () => {
    const r = await tryWs('/ws', { Origin: 'http://localhost:9999' });
    expect(r.opened).toBe(true);
  });

  it('accepts WS with Origin: http://127.0.0.1:7899', async () => {
    const r = await tryWs('/ws', { Origin: 'http://127.0.0.1:7899' });
    expect(r.opened).toBe(true);
  });

  it('rejects WS with external Origin', async () => {
    const r = await tryWs('/ws', { Origin: 'http://attacker.com' });
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(403);
  });

  it('accepts WS with no Origin from loopback', async () => {
    // ws library does not set Origin by default. The broker is bound to
    // 127.0.0.1, so remoteAddress is loopback.
    const r = await tryWs('/ws', {});
    expect(r.opened).toBe(true);
  });
});

describe('/ws/terminal/:role end-to-end', () => {
  it('rejects upgrade from external Origin (S-NEW-2 hijack defense)', async () => {
    const r = await tryWs('/ws/terminal/backend?project=demo', {
      Origin: 'http://attacker.com',
    });
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(403);
  });

  it('rejects pre-handshake when no agent is running for that role', async () => {
    // Origin is allowed (localhost), but no spawnWebAgent has been
    // called → must 503, not handshake-then-1011.
    const r = await tryWs('/ws/terminal/no-such-role?project=no-such-proj', {
      Origin: 'http://localhost:7899',
    });
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(503);
  });
});
