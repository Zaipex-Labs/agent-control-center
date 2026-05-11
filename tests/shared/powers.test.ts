// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import {
  POWERS_REGISTRY,
  listPublicPowers,
  getPowerSpec,
  resolvePower,
} from '../../src/shared/powers.js';

describe('POWERS_REGISTRY', () => {
  it('ships git, postgres, playwright as the v0.3.2 seed set', () => {
    const names = Object.keys(POWERS_REGISTRY).sort();
    expect(names).toEqual(['git', 'playwright', 'postgres']);
  });

  it('every spec has a non-empty description and command', () => {
    for (const [name, spec] of Object.entries(POWERS_REGISTRY)) {
      expect(spec.name, name).toBe(name);
      expect(spec.description.length, `${name}.description`).toBeGreaterThan(0);
      expect(spec.command.length, `${name}.command`).toBeGreaterThan(0);
      expect(Array.isArray(spec.args), `${name}.args`).toBe(true);
      expect(Array.isArray(spec.requiredEnv), `${name}.requiredEnv`).toBe(true);
    }
  });

  it('git is read-only and parametrized by cwd', () => {
    const spec = POWERS_REGISTRY['git'];
    expect(spec.requiredEnv).toEqual([]);
    expect(spec.args.some(a => a.includes('${cwd}'))).toBe(true);
  });

  it('postgres declares POSTGRES_CONNECTION_STRING as required env', () => {
    const spec = POWERS_REGISTRY['postgres'];
    expect(spec.requiredEnv).toEqual(['POSTGRES_CONNECTION_STRING']);
    expect(spec.args.some(a => a.includes('${POSTGRES_CONNECTION_STRING}'))).toBe(true);
  });
});

describe('listPublicPowers', () => {
  it('returns entries stripped of server-only command/args fields', () => {
    const pub = listPublicPowers();
    for (const p of pub) {
      // Cast to a permissive shape so the TS compiler doesn't help us
      // — we want the runtime assertion to be the source of truth.
      const anyP = p as Record<string, unknown>;
      expect(anyP['command']).toBeUndefined();
      expect(anyP['args']).toBeUndefined();
      expect(typeof p.name).toBe('string');
      expect(typeof p.description).toBe('string');
      expect(Array.isArray(p.requiredEnv)).toBe(true);
    }
  });

  it('returns entries sorted alphabetically by name', () => {
    const names = listPublicPowers().map(p => p.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

describe('getPowerSpec', () => {
  it('returns the spec for a known power', () => {
    const spec = getPowerSpec('git');
    expect(spec?.name).toBe('git');
  });

  it('returns undefined for an unknown power', () => {
    expect(getPowerSpec('nonexistent')).toBeUndefined();
  });
});

describe('resolvePower', () => {
  it('substitutes ${cwd} into argv', () => {
    const r = resolvePower(getPowerSpec('git')!, {
      cwd: '/home/user/project',
      env: {},
    });
    expect(r.args).toContain('/home/user/project');
    expect(r.args.some(a => a.includes('${cwd}'))).toBe(false);
    expect(r.missingEnv).toEqual([]);
  });

  it('substitutes ${ENV_NAME} when the env var is set', () => {
    const r = resolvePower(getPowerSpec('postgres')!, {
      cwd: '/tmp',
      env: { POSTGRES_CONNECTION_STRING: 'postgres://localhost/db' },
    });
    expect(r.args).toContain('postgres://localhost/db');
    expect(r.missingEnv).toEqual([]);
  });

  it('flags missing required env vars without throwing', () => {
    const r = resolvePower(getPowerSpec('postgres')!, {
      cwd: '/tmp',
      env: {},
    });
    expect(r.missingEnv).toEqual(['POSTGRES_CONNECTION_STRING']);
    // The arg position with the empty substitution still exists, but
    // the caller is expected to NOT spawn the MCP server when
    // missingEnv is non-empty. We don't dictate what to do with the
    // partial argv here.
  });

  it('treats empty-string env values as missing', () => {
    const r = resolvePower(getPowerSpec('postgres')!, {
      cwd: '/tmp',
      env: { POSTGRES_CONNECTION_STRING: '' },
    });
    expect(r.missingEnv).toEqual(['POSTGRES_CONNECTION_STRING']);
  });
});
