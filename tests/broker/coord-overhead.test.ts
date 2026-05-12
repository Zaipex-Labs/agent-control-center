// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// v0.3.4 FU-AH — coord-overhead read surface. Validates that the
// shared DB shape (`message_log`'s from_role/to_role + `token_usage`'s
// per-turn rows) is queryable as a single panel-ready aggregate.
//
// The hard analysis (is ratio > 0.3? what prompt tweak fixes it?)
// is v0.3.5 territory — these tests only pin the read shape.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import {
  initDatabase,
  insertLogEntry,
  insertTokenUsage,
  countCoordEventsSince,
  selectCoordEventsByPair,
  countTokenTurnsSince,
} from '../../src/broker/database.js';
import { handleProjectCoordOverhead } from '../../src/broker/handlers/tokens.js';

interface MockRes { statusCode: number; body: unknown }
function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((status: number) => { result.statusCode = status; return res; }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => { if (data) result.body = JSON.parse(data); return res; }) as ServerResponse['end'];
  return { res, result };
}

beforeEach(() => {
  initDatabase(':memory:');
});

// Helper — message_log requires the full insertLogEntry shape.
function logEntry(p: {
  project_id: string;
  from_role: string;
  to_role: string;
  type?: string;
  sent_at?: string;
}) {
  insertLogEntry(
    p.project_id,
    'peer-x', p.from_role,
    'peer-y', p.to_role,
    (p.type ?? 'message'),
    'hi',
    null,
    p.sent_at ?? new Date().toISOString(),
    'session-1',
    null,
  );
}

describe('FU-AH · count + by_pair query primitives', () => {
  it('counts only genuine inter-agent coord (both roles non-empty, distinct)', () => {
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'backend' });
    logEntry({ project_id: 'p', from_role: 'backend', to_role: 'arquitectura' });
    logEntry({ project_id: 'p', from_role: '', to_role: 'backend' }); // user → agent, not coord
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: '' }); // agent → user, not coord
    logEntry({ project_id: 'p', from_role: 'qa', to_role: 'qa' }); // self-talk, not coord

    expect(countCoordEventsSince('p', '1970-01-01T00:00:00.000Z')).toBe(2);
  });

  it('groups by (from_role, to_role) and orders by event count desc', () => {
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'backend' });
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'backend' });
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'backend' });
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'qa' });
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'qa' });
    logEntry({ project_id: 'p', from_role: 'backend', to_role: 'qa' });

    const rows = selectCoordEventsByPair('p', '1970-01-01T00:00:00.000Z');
    expect(rows).toEqual([
      { from_role: 'arquitectura', to_role: 'backend', events: 3 },
      { from_role: 'arquitectura', to_role: 'qa',      events: 2 },
      { from_role: 'backend',      to_role: 'qa',      events: 1 },
    ]);
  });

  it('isolates per-project', () => {
    logEntry({ project_id: 'p1', from_role: 'arquitectura', to_role: 'backend' });
    logEntry({ project_id: 'p2', from_role: 'arquitectura', to_role: 'backend' });
    expect(countCoordEventsSince('p1', '1970-01-01T00:00:00.000Z')).toBe(1);
    expect(countCoordEventsSince('p2', '1970-01-01T00:00:00.000Z')).toBe(1);
  });

  it('respects the period window via sent_at', () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'backend', sent_at: old });
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'backend', sent_at: now });
    expect(countCoordEventsSince('p', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())).toBe(1);
  });

  it('countTokenTurnsSince counts token_usage rows in the same window', () => {
    insertTokenUsage({ project_id: 'p', role: 'backend', input_tokens: 1, output_tokens: 1, turn_uuid: 't1' });
    insertTokenUsage({ project_id: 'p', role: 'backend', input_tokens: 1, output_tokens: 1, turn_uuid: 't2' });
    expect(countTokenTurnsSince('p', '1970-01-01T00:00:00.000Z')).toBe(2);
  });
});

describe('FU-AH · handleProjectCoordOverhead endpoint shape', () => {
  it('empty project returns zeros + ratio 0', () => {
    const { res, result } = createMockRes();
    handleProjectCoordOverhead('empty', 'today', res);
    expect(result.statusCode).toBe(200);
    const body = result.body as { coord_events: number; total_turns: number; coord_ratio: number; by_pair: unknown[] };
    expect(body.coord_events).toBe(0);
    expect(body.total_turns).toBe(0);
    expect(body.coord_ratio).toBe(0);
    expect(body.by_pair).toEqual([]);
  });

  it('returns coord_ratio = coord_events / total_turns', () => {
    // Seed 3 coord events + 12 token turns → ratio = 0.25
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'backend' });
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'frontend' });
    logEntry({ project_id: 'p', from_role: 'arquitectura', to_role: 'qa' });
    for (let i = 0; i < 12; i++) {
      insertTokenUsage({ project_id: 'p', role: 'backend', input_tokens: 1, output_tokens: 1, turn_uuid: `t${i}` });
    }

    const { res, result } = createMockRes();
    handleProjectCoordOverhead('p', 'today', res);
    const body = result.body as { coord_events: number; total_turns: number; coord_ratio: number; by_pair: Array<{ from_role: string; to_role: string; events: number }> };
    expect(body.coord_events).toBe(3);
    expect(body.total_turns).toBe(12);
    expect(body.coord_ratio).toBeCloseTo(0.25, 5);
    expect(body.by_pair.map(r => `${r.from_role}->${r.to_role}`)).toEqual([
      'arquitectura->backend',
      'arquitectura->frontend',
      'arquitectura->qa',
    ]);
  });

  it('defaults to "today" when period is null or unknown', () => {
    logEntry({ project_id: 'p', from_role: 'a', to_role: 'b' });

    const r1 = createMockRes();
    handleProjectCoordOverhead('p', null, r1.res);
    expect((r1.result.body as { period: string }).period).toBe('today');

    const r2 = createMockRes();
    handleProjectCoordOverhead('p', 'bogus', r2.res);
    expect((r2.result.body as { period: string }).period).toBe('today');
  });

  it('honors period=week and period=month', () => {
    const oldButThisMonth = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    logEntry({ project_id: 'p', from_role: 'a', to_role: 'b', sent_at: oldButThisMonth });

    const week = createMockRes();
    handleProjectCoordOverhead('p', 'week', week.res);
    expect((week.result.body as { coord_events: number }).coord_events).toBe(0);

    const month = createMockRes();
    handleProjectCoordOverhead('p', 'month', month.res);
    expect((month.result.body as { coord_events: number }).coord_events).toBe(1);
  });
});
