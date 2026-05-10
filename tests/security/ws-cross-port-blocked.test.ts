// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createBrokerServer } from '../../src/broker/index.js';
import { insertPeer } from '../../src/broker/database.js';
import {
  issueToken,
  _resetTokensForTests,
  _peekTokenForTests,
} from '../../src/broker/csrf-tokens.js';
import type { Peer } from '../../src/shared/types.js';

// [F-3-C] — End-to-end coverage of the /ws/terminal token gate.
//
// The Origin allowlist alone admits a malicious dev server on
// http://127.0.0.1:8080 (different port, same machine) because its
// Origin matches the localhost regex. The token gate closes that
// caveat: an attacker who can't read the dashboard's localStorage has
// no peer_id to call /api/csrf/issue and therefore can't acquire a
// token. Each scenario below probes one failure mode the attacker
// could try.
//
// Scenarios:
//   1. WS with no token (cross-port attacker who didn't even try) → 403
//   2. WS with a token bound to a DIFFERENT role (cross-role replay)  → 403
//   3. WS with an EXPIRED token                                       → 403
//   4. WS with a REUSED token (already consumed by previous attempt)  → 403
//   5. WS with a fresh, valid token + a live agent registered          → 101 + open

let server: Server | null = null;
let port: number;
let home: string;

const PROJECT = 'demo';
const ROLE = 'backend';

async function startBroker(): Promise<void> {
  home = mkdtempSync(join(tmpdir(), 'acc-test-csrf-e2e-'));
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

beforeEach(() => {
  _resetTokensForTests();
});

function tryWs(path: string, headers: Record<string, string>, protocols?: string[]): Promise<{
  opened: boolean;
  upgradeStatus?: number;
  closeCode?: number;
}> {
  return new Promise((resolve) => {
    const ws = protocols && protocols.length > 0
      ? new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, { headers })
      : new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
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
      resolve({ opened, upgradeStatus });
    });
  });
}

function seedAgentPeer(projectId: string, role: string): void {
  // The token gate runs BEFORE the proc-existence check, so the seeded
  // DB row is never actually consulted in the failure-mode tests — we
  // keep it for the one "valid token, no live agent → 503" case to
  // make the proc check distinguishable. Idempotent insert keeps
  // beforeAll-style state across describe-blocks happy.
  const now = new Date().toISOString();
  const peer: Peer = {
    id: `agent-${projectId}-${role}`, project_id: projectId, pid: process.pid,
    name: 'Turing', role, agent_type: 'claude-code',
    cwd: '/tmp', git_root: null, git_branch: null, tty: null,
    summary: '', registered_at: now, last_seen: now,
  };
  try { insertPeer(peer); } catch { /* already seeded */ }
}

describe('/ws/terminal cross-port hijack — token gate', () => {
  it('1. rejects WS with no acc-token subprotocol → 403', async () => {
    seedAgentPeer(PROJECT, ROLE);
    const r = await tryWs(`/ws/terminal/${ROLE}?project=${PROJECT}`, {
      // Cross-port attacker's Origin still passes the existing gate
      Origin: 'http://127.0.0.1:8080',
    });
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(403);
  });

  it('2. rejects WS with token bound to a different role → 403', async () => {
    seedAgentPeer(PROJECT, ROLE);
    const wrongRoleToken = issueToken(PROJECT, 'frontend');
    const r = await tryWs(
      `/ws/terminal/${ROLE}?project=${PROJECT}`,
      { Origin: 'http://127.0.0.1:8080' },
      [`acc-token.${wrongRoleToken}`],
    );
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(403);
  });

  it('2b. rejects WS with token bound to a different project → 403', async () => {
    seedAgentPeer(PROJECT, ROLE);
    const wrongProjectToken = issueToken('other-project', ROLE);
    const r = await tryWs(
      `/ws/terminal/${ROLE}?project=${PROJECT}`,
      { Origin: 'http://127.0.0.1:8080' },
      [`acc-token.${wrongProjectToken}`],
    );
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(403);
  });

  it('3. rejects WS with expired token → 403', async () => {
    seedAgentPeer(PROJECT, ROLE);
    const tok = issueToken(PROJECT, ROLE);
    // Force-expire by mutating the underlying entry
    const entry = _peekTokenForTests(tok)!;
    entry.expires_at = Date.now() - 1;
    const r = await tryWs(
      `/ws/terminal/${ROLE}?project=${PROJECT}`,
      { Origin: 'http://127.0.0.1:8080' },
      [`acc-token.${tok}`],
    );
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(403);
  });

  it('4. rejects WS replay (same token used twice) → 403 on second use', async () => {
    seedAgentPeer(PROJECT, ROLE);
    const tok = issueToken(PROJECT, ROLE);
    // First attempt — there's no agent process registered in
    // agentProcesses (we only seeded a DB peer), so the proc check
    // returns 503 AFTER the token is consumed. Either 503 (proc
    // missing) or 101 (proc present) is acceptable for the first hit;
    // both consume the token. We don't assert the first status — only
    // the second.
    await tryWs(
      `/ws/terminal/${ROLE}?project=${PROJECT}`,
      { Origin: 'http://127.0.0.1:8080' },
      [`acc-token.${tok}`],
    );
    // Second attempt — token already consumed, must be 403.
    const r2 = await tryWs(
      `/ws/terminal/${ROLE}?project=${PROJECT}`,
      { Origin: 'http://127.0.0.1:8080' },
      [`acc-token.${tok}`],
    );
    expect(r2.opened).toBe(false);
    expect(r2.upgradeStatus).toBe(403);
  });

  it('5. without a live agent, fresh valid token → 503 (token consumed but proc missing)', async () => {
    // The token gate passes (binding matches), then the proc check
    // returns 503 because no spawnWebAgent has been called. This is
    // exactly the leak described in followups F-3 mitigation: the
    // 503-vs-403 distinction is now ONLY observable to a holder of a
    // valid token, i.e. the legitimate dashboard, not a cross-port
    // attacker.
    seedAgentPeer(PROJECT, ROLE);
    const tok = issueToken(PROJECT, ROLE);
    const r = await tryWs(
      `/ws/terminal/${ROLE}?project=${PROJECT}`,
      { Origin: 'http://127.0.0.1:8080' },
      [`acc-token.${tok}`],
    );
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(503);
  });

  it('6. malformed Sec-WebSocket-Protocol value (no acc-token prefix) → 403', async () => {
    seedAgentPeer(PROJECT, ROLE);
    const r = await tryWs(
      `/ws/terminal/${ROLE}?project=${PROJECT}`,
      { Origin: 'http://127.0.0.1:8080' },
      ['some-other-protocol'],
    );
    expect(r.opened).toBe(false);
    expect(r.upgradeStatus).toBe(403);
  });
});
