// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';

// FASE C-1 (v0.3.2). handleRegister emits 'agent:spawning' with
// phase='registered' for real agents, and skips it for the
// dashboard peer (whose register call doesn't go through the
// pty_ready / mcp_ready earlier phases).
//
// pty_ready and mcp_ready emissions live inside spawnWebAgent, which
// needs a real PTY + child process — they're verified by manual /
// puppeteer QA in FASE E and not unit-tested here.

interface CapturedEvent {
  event: string;
  data: unknown;
  projectId?: string;
}

interface MockRes {
  statusCode: number;
  body: unknown;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((s: number) => { result.statusCode = s; return res; }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => { if (data) result.body = JSON.parse(data); return res; }) as ServerResponse['end'];
  return { res, result };
}

describe('handleRegister broadcasts agent:spawning(registered) [C-1 v0.3.2]', () => {
  let captured: CapturedEvent[];

  beforeEach(async () => {
    vi.resetModules();
    captured = [];
    // Stub the broadcast function so we can observe what handleRegister
    // emits without spinning up real WebSocket clients.
    vi.doMock('../../src/broker/websocket.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/broker/websocket.js')>('../../src/broker/websocket.js');
      return {
        ...actual,
        broadcast: (event: string, data: unknown, projectId?: string) => {
          captured.push({ event, data, projectId });
        },
      };
    });
    const db = await import('../../src/broker/database.js');
    db.initDatabase(':memory:');
  });

  it('emits {phase: "registered"} for a claude-code peer', async () => {
    const { handleRegister } = await import('../../src/broker/handlers.js');
    const { res } = createMockRes();
    handleRegister({ pid: 1, cwd: '/tmp', role: 'backend', project_id: 'proj' }, res);
    const spawning = captured.filter(e => e.event === 'agent:spawning');
    expect(spawning).toHaveLength(1);
    expect(spawning[0].data).toMatchObject({ role: 'backend', phase: 'registered' });
    expect(spawning[0].projectId).toBe('proj');
  });

  it('SKIPS agent:spawning for dashboard peer (avoids phantom checklist row)', async () => {
    const { handleRegister } = await import('../../src/broker/handlers.js');
    const { res } = createMockRes();
    handleRegister(
      { pid: 1, cwd: '/tmp', role: 'user', project_id: 'proj', agent_type: 'dashboard' },
      res,
    );
    const spawning = captured.filter(e => e.event === 'agent:spawning');
    expect(spawning).toHaveLength(0);
    // peer:connected still fires.
    expect(captured.some(e => e.event === 'peer:connected')).toBe(true);
  });

  it('SKIPS agent:spawning when role is empty (no checklist key to bucket under)', async () => {
    const { handleRegister } = await import('../../src/broker/handlers.js');
    const { res } = createMockRes();
    handleRegister({ pid: 1, cwd: '/tmp', project_id: 'proj' }, res);
    const spawning = captured.filter(e => e.event === 'agent:spawning');
    expect(spawning).toHaveLength(0);
  });

  it('peer:connected still fires alongside agent:spawning(registered)', async () => {
    const { handleRegister } = await import('../../src/broker/handlers.js');
    const { res } = createMockRes();
    handleRegister({ pid: 1, cwd: '/tmp', role: 'frontend', project_id: 'proj' }, res);
    const eventNames = captured.map(e => e.event);
    expect(eventNames).toContain('peer:connected');
    expect(eventNames).toContain('agent:spawning');
  });
});
