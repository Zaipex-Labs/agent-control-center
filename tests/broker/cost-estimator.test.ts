// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FU-AE v0.4.0 — cost estimator tests. Exercises the three
// confidence levels (low/medium/high), the complexity heuristic
// (heavy/light keywords), and the synthetic baseline bands per
// agent count.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface MockRes {
  statusCode: number;
  body: { estimatedTurns?: [number, number]; estimatedCostUSD?: [number, number]; confidence?: string; sampleSize?: number; basis?: { agents?: number; complexity?: string; source?: string; avgUsdPerTurn?: number }; error?: string } | null;
  headers: Record<string, string>;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null, headers: {} };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((s: number, h?: Record<string, string>) => {
    result.statusCode = s;
    if (h) result.headers = h;
    return res;
  }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => {
    if (data) result.body = JSON.parse(data);
    return res;
  }) as ServerResponse['end'];
  return { res, result };
}

let home: string;
let estimateCost: typeof import('../../src/broker/cost-estimator.js').estimateCost;
let initDatabase: typeof import('../../src/broker/database.js').initDatabase;
let insertTokenUsage: typeof import('../../src/broker/database.js').insertTokenUsage;
let handleProjectEstimateCost: typeof import('../../src/broker/handlers/tokens.js').handleProjectEstimateCost;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'acc-cost-est-'));
  process.env['ACC_HOME'] = home;
  vi.resetModules();
  // Create projects dir with two configs: one with 3 specialists,
  // one with 5 — for testing the agent-count branches.
  mkdirSync(join(home, 'projects'), { recursive: true });

  ({ initDatabase, insertTokenUsage } = await import('../../src/broker/database.js'));
  ({ estimateCost } = await import('../../src/broker/cost-estimator.js'));
  ({ handleProjectEstimateCost } = await import('../../src/broker/handlers/tokens.js'));
  initDatabase(':memory:');

  // 3-specialist project
  writeFileSync(
    join(home, 'projects', 'trio.json'),
    JSON.stringify({
      name: 'trio',
      description: '',
      created_at: new Date().toISOString(),
      agents: [
        { role: 'arquitectura', cwd: '/tmp', agent_cmd: 'claude', agent_args: [], instructions: '' },
        { role: 'backend',  cwd: '/tmp', agent_cmd: 'claude', agent_args: [], instructions: '' },
        { role: 'frontend', cwd: '/tmp', agent_cmd: 'claude', agent_args: [], instructions: '' },
        { role: 'qa',       cwd: '/tmp', agent_cmd: 'claude', agent_args: [], instructions: '' },
      ],
    }),
  );

  // 5-specialist project
  writeFileSync(
    join(home, 'projects', 'equipo.json'),
    JSON.stringify({
      name: 'equipo',
      description: '',
      created_at: new Date().toISOString(),
      agents: [
        { role: 'arquitectura', cwd: '/tmp', agent_cmd: 'claude', agent_args: [], instructions: '' },
        ...['backend', 'frontend', 'qa', 'data', 'devops'].map(r => ({
          role: r, cwd: '/tmp', agent_cmd: 'claude', agent_args: [], instructions: '',
        })),
      ],
    }),
  );
});

afterEach(() => {
  delete process.env['ACC_HOME'];
  rmSync(home, { recursive: true, force: true });
});

// ── Synthetic baseline (low confidence, zero token_usage rows)

describe('estimateCost — synthetic baseline (low confidence)', () => {
  it('returns the TRIO band for a 3-specialist project with no history', () => {
    const e = estimateCost('trio', 'add a small backend endpoint');
    expect(e.confidence).toBe('low');
    expect(e.sampleSize).toBe(0);
    expect(e.basis.source).toBe('synthetic-v0.3.3');
    expect(e.basis.agents).toBe(3);
    // TRIO band: 80-120 turns × multiplier (normal here) = 80-120
    expect(e.estimatedTurns[0]).toBeGreaterThanOrEqual(80);
    expect(e.estimatedTurns[1]).toBeLessThanOrEqual(120);
    // TRIO usd band: $8-15
    expect(e.estimatedCostUSD[0]).toBeGreaterThanOrEqual(8);
    expect(e.estimatedCostUSD[1]).toBeLessThanOrEqual(15);
  });

  it('returns the EQUIPO band for a 5-specialist project', () => {
    const e = estimateCost('equipo', 'add a backend endpoint');
    expect(e.confidence).toBe('low');
    expect(e.basis.agents).toBe(5);
    // EQUIPO band: 150-250 turns
    expect(e.estimatedTurns[0]).toBeGreaterThanOrEqual(150);
    expect(e.estimatedTurns[1]).toBeLessThanOrEqual(250);
    expect(e.estimatedCostUSD[0]).toBeGreaterThanOrEqual(20);
    expect(e.estimatedCostUSD[1]).toBeLessThanOrEqual(35);
  });

  it('clamps zero-specialist projects to the SOLO band', () => {
    const e = estimateCost('nonexistent', 'add a backend endpoint');
    expect(e.basis.agents).toBe(0);
    // Falls into the n<=1 branch → SOLO 30-50 turns / $1-3
    expect(e.estimatedTurns).toEqual([30, 50]);
    expect(e.estimatedCostUSD).toEqual([1, 3]);
  });
});

// ── Complexity heuristic

describe('estimateCost — complexity classifier', () => {
  it('marks heavyweight keywords as "heavy" and inflates the band', () => {
    const e = estimateCost('trio', 'implementa todo el feature end-to-end con tests completos');
    expect(e.basis.complexity).toBe('heavy');
    // Heavy multiplier 1.3 → TRIO 80*1.3≈104, 120*1.3≈156
    expect(e.estimatedTurns[0]).toBeGreaterThan(80);
    expect(e.estimatedTurns[1]).toBeGreaterThan(120);
  });

  it('marks lightweight keywords as "light" and deflates the band', () => {
    const e = estimateCost('trio', 'fix typo en línea 42, cambio pequeño');
    expect(e.basis.complexity).toBe('light');
    // Light multiplier 0.7 → TRIO 80*0.7=56, 120*0.7=84
    expect(e.estimatedTurns[1]).toBeLessThan(120);
  });

  it('defaults to "normal" when no keyword matches', () => {
    const e = estimateCost('trio', 'add a new field to the schema');
    expect(e.basis.complexity).toBe('normal');
  });
});

// ── Medium confidence path

describe('estimateCost — medium confidence (20-99 rows)', () => {
  it('switches to project-avg source at 20+ rows with a wider band', () => {
    for (let i = 0; i < 50; i++) {
      insertTokenUsage({
        project_id: 'trio',
        input_tokens: 5000,
        output_tokens: 800,
        cache_creation_tokens: 0,
        cache_read_tokens: 2000,
        turn_uuid: `t-${i}`,
        created_at: new Date().toISOString(),
      });
    }
    const e = estimateCost('trio', 'add a backend endpoint');
    expect(e.confidence).toBe('medium');
    expect(e.sampleSize).toBe(50);
    expect(e.basis.source).toBe('project-avg');
    expect(typeof e.basis.avgUsdPerTurn).toBe('number');
  });
});

// ── High confidence path

describe('estimateCost — high confidence (100+ rows)', () => {
  it('switches to real-data with a narrower band at 100+ rows', () => {
    for (let i = 0; i < 110; i++) {
      insertTokenUsage({
        project_id: 'trio',
        input_tokens: 5000,
        output_tokens: 800,
        cache_creation_tokens: 0,
        cache_read_tokens: 2000,
        turn_uuid: `t-${i}`,
        created_at: new Date().toISOString(),
      });
    }
    const e = estimateCost('trio', 'add a backend endpoint');
    expect(e.confidence).toBe('high');
    expect(e.sampleSize).toBe(110);
    expect(e.basis.source).toBe('project-avg');
    // The high-confidence band is ±25% around the point estimate;
    // the medium band is ±50%. So min should be relatively close to
    // max. With 100 turns avg and ~$0.027 per turn:
    //   center = 0.027 * 100 = 2.70
    //   min = 0.75 * 2.70 = 2.025 → 2.03
    //   max = 1.25 * 2.70 = 3.375 → 3.38
    // Sanity check: max < 4× min.
    expect(e.estimatedCostUSD[1] / e.estimatedCostUSD[0]).toBeLessThan(4);
  });
});

// ── Endpoint handler

describe('handleProjectEstimateCost — HTTP wrapper', () => {
  it('returns 400 when projectId is empty', () => {
    const { res, result } = createMockRes();
    handleProjectEstimateCost('', 'some text', res);
    expect(result.statusCode).toBe(400);
    expect(result.body?.error).toMatch(/project_id/i);
  });

  it('returns a valid estimate for a known project', () => {
    const { res, result } = createMockRes();
    handleProjectEstimateCost('trio', 'add a backend endpoint', res);
    expect(result.statusCode).toBe(200);
    expect(result.body?.confidence).toBe('low');
    expect(result.body?.estimatedTurns?.length).toBe(2);
    expect(result.body?.estimatedCostUSD?.length).toBe(2);
  });

  it('tolerates a missing message argument', () => {
    const { res, result } = createMockRes();
    handleProjectEstimateCost('trio', null, res);
    expect(result.statusCode).toBe(200);
    // Empty message = normal complexity (no keywords match)
    expect(result.body?.basis?.complexity).toBe('normal');
  });
});
