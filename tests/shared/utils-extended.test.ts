// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { getDefaultName, resolveEntryPoint } from '../../src/shared/utils.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// generateId robustness lives in tests/shared/utils.test.ts.

describe('getDefaultName', () => {
  it('maps known roles to specific scientists', () => {
    expect(getDefaultName('backend')).toBe('Turing');
    expect(getDefaultName('frontend')).toBe('Lovelace');
    expect(getDefaultName('qa')).toBe('Curie');
    expect(getDefaultName('architect')).toBe('Da Vinci');
    expect(getDefaultName('devops')).toBe('Tesla');
    expect(getDefaultName('data')).toBe('Gauss');
    expect(getDefaultName('ml')).toBe('Euler');
    expect(getDefaultName('analytics')).toBe('Fibonacci');
    expect(getDefaultName('security')).toBe('Enigma');
  });

  it('returns a fallback name for unknown roles', () => {
    const fallbackNames = [
      'Faraday', 'Newton', 'Hypatia', 'Hawking', 'Galileo',
      'Ramanujan', 'Noether', 'Fermat', 'Kepler', 'Planck',
    ];
    const name = getDefaultName('custom-role-xyz');
    expect(fallbackNames).toContain(name);
  });

  it('is deterministic - same role always gets same name', () => {
    const name1 = getDefaultName('some-unique-role');
    const name2 = getDefaultName('some-unique-role');
    expect(name1).toBe(name2);
  });

  it('different unknown roles may get different names', () => {
    // Not guaranteed but highly likely with different enough strings
    const names = new Set<string>();
    for (const role of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']) {
      names.add(getDefaultName(role));
    }
    // At least 2 different names from 8 roles
    expect(names.size).toBeGreaterThanOrEqual(2);
  });

  it('handles empty string role', () => {
    const name = getDefaultName('');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });
});

describe('resolveEntryPoint', () => {
  it('resolves to .ts file when it exists', () => {
    // This test file exists as .ts in the source
    const result = resolveEntryPoint(resolve('src'), 'shared', 'utils.ts');
    expect(result).toMatch(/utils\.ts$/);
    expect(existsSync(result)).toBe(true);
  });

  it('returns .ts path as fallback when neither exists', () => {
    const result = resolveEntryPoint('/tmp', 'nonexistent', 'file.ts');
    expect(result).toMatch(/file\.ts$/);
  });

  it('handles multiple path segments', () => {
    const result = resolveEntryPoint(resolve('src'), 'broker', 'index.ts');
    expect(result).toContain('broker');
    expect(result).toMatch(/index\.ts$/);
    expect(existsSync(result)).toBe(true);
  });
});
