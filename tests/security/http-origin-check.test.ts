// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrokerServer } from '../../src/broker/index.js';

// [QW-1] — broker HTTP must reject:
//   1. requests whose Origin header points outside localhost (CSRF
//      from a malicious webpage)              → 403
//   2. requests whose Host header is not a localhost name (DNS
//      rebinding)                              → 403
//   3. POST requests whose Content-Type is not application/json
//      (cross-origin "simple requests" without preflight)  → 415
//
// Closes S-NEW-1.

let server: Server | null = null;
let port: number;
let home: string;

beforeAll(async () => {
  // Unique ACC_HOME per test file — see comment in
  // ws-origin-check.test.ts (CI macOS 22.x failure).
  home = mkdtempSync(join(tmpdir(), 'acc-test-http-origin-'));
  process.env['ACC_HOME'] = home;
  server = createBrokerServer();
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  port = (server!.address() as { port: number }).port;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (home) {
    try { rmSync(home, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// We use http.request directly so we can override the Host header,
// which fetch() does not allow.
function rawPost(path: string, headers: Record<string, string>, body: string): Promise<{
  status: number;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(body).toString(), ...headers },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const VALID_REGISTER = JSON.stringify({
  pid: process.pid,
  cwd: '/tmp/test',
  role: 'backend',
  project_id: 'test-csrf',
});

describe('Origin check (state-changing routes)', () => {
  it('accepts POST with Origin: http://localhost:7899', async () => {
    const r = await rawPost('/api/register', {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:7899',
    }, VALID_REGISTER);
    expect(r.status).toBe(200);
  });

  it('accepts POST with Origin: http://127.0.0.1:9999', async () => {
    const r = await rawPost('/api/register', {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:9999',
    }, VALID_REGISTER);
    expect(r.status).toBe(200);
  });

  it('rejects POST with external Origin (CSRF defense)', async () => {
    const r = await rawPost('/api/register', {
      'Content-Type': 'application/json',
      Origin: 'http://attacker.com',
    }, VALID_REGISTER);
    expect(r.status).toBe(403);
    expect(r.body).toContain('Forbidden origin');
  });

  it('rejects POST with subdomain spoofing localhost', async () => {
    const r = await rawPost('/api/register', {
      'Content-Type': 'application/json',
      Origin: 'http://localhost.attacker.com',
    }, VALID_REGISTER);
    expect(r.status).toBe(403);
  });

  it('accepts POST with no Origin from loopback (curl/CLI)', async () => {
    const r = await rawPost('/api/register', {
      'Content-Type': 'application/json',
    }, VALID_REGISTER);
    expect(r.status).toBe(200);
  });
});

describe('Content-Type check', () => {
  it('rejects POST with Content-Type: text/plain (415)', async () => {
    // text/plain + JSON-shaped body is the classic "simple request"
    // CSRF — no preflight required by the browser.
    const r = await rawPost('/api/register', {
      'Content-Type': 'text/plain',
    }, VALID_REGISTER);
    expect(r.status).toBe(415);
    expect(r.body).toContain('application/json');
  });

  it('rejects POST with Content-Type: application/x-www-form-urlencoded', async () => {
    const r = await rawPost('/api/register', {
      'Content-Type': 'application/x-www-form-urlencoded',
    }, VALID_REGISTER);
    expect(r.status).toBe(415);
  });

  it('rejects POST with no Content-Type', async () => {
    const r = await rawPost('/api/register', {}, VALID_REGISTER);
    expect(r.status).toBe(415);
  });

  it('accepts application/json; charset=utf-8', async () => {
    const r = await rawPost('/api/register', {
      'Content-Type': 'application/json; charset=utf-8',
    }, VALID_REGISTER);
    expect(r.status).toBe(200);
  });
});

describe('Host check (DNS rebinding defense)', () => {
  it('rejects POST with attacker-controlled Host header', async () => {
    const r = await rawPost('/api/register', {
      Host: 'attacker.com',
      'Content-Type': 'application/json',
    }, VALID_REGISTER);
    expect(r.status).toBe(403);
    expect(r.body).toContain('Forbidden host');
  });

  it('accepts Host: 127.0.0.1:port', async () => {
    const r = await rawPost('/api/register', {
      Host: `127.0.0.1:${port}`,
      'Content-Type': 'application/json',
    }, VALID_REGISTER);
    expect(r.status).toBe(200);
  });

  it('accepts Host: localhost:port', async () => {
    const r = await rawPost('/api/register', {
      Host: `localhost:${port}`,
      'Content-Type': 'application/json',
    }, VALID_REGISTER);
    expect(r.status).toBe(200);
  });
});
