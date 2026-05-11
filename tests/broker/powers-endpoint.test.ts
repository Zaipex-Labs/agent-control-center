// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { handleListPowers } from '../../src/broker/handlers.js';

function createMockRes(): {
  res: ServerResponse;
  result: { statusCode: number; body: unknown };
} {
  const result = { statusCode: 200, body: null as unknown };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;
  res.writeHead = ((s: number) => {
    result.statusCode = s;
    return res;
  }) as ServerResponse['writeHead'];
  res.end = ((data?: string) => {
    if (data) result.body = JSON.parse(data);
    return res;
  }) as ServerResponse['end'];
  return { res, result };
}

describe('GET /api/powers handler', () => {
  it('returns { powers: Power[] } with a 200', () => {
    const { res, result } = createMockRes();
    handleListPowers(res);
    expect(result.statusCode).toBe(200);
    const body = result.body as { powers: Array<{ name: string; description: string; requiredEnv: string[] }> };
    expect(Array.isArray(body.powers)).toBe(true);
    const names = body.powers.map(p => p.name).sort();
    expect(names).toEqual(['git', 'playwright', 'postgres']);
  });

  it('strips server-only command/args fields', () => {
    const { res, result } = createMockRes();
    handleListPowers(res);
    const body = result.body as { powers: Array<Record<string, unknown>> };
    for (const p of body.powers) {
      expect(p['command']).toBeUndefined();
      expect(p['args']).toBeUndefined();
    }
  });

  it('includes requiredEnv hint for env-dependent powers', () => {
    const { res, result } = createMockRes();
    handleListPowers(res);
    const body = result.body as { powers: Array<{ name: string; requiredEnv: string[] }> };
    const postgres = body.powers.find(p => p.name === 'postgres')!;
    expect(postgres.requiredEnv).toEqual(['POSTGRES_CONNECTION_STRING']);
  });
});
