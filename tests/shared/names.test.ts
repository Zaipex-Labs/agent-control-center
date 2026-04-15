// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import {
  getDefaultName,
  ARCHITECT_ROLE,
  ARCHITECT_DEFAULT_INSTRUCTIONS,
} from '../../src/shared/names.js';

describe('getDefaultName', () => {
  it('returns well-known scientist for known roles', () => {
    expect(getDefaultName('backend')).toBe('Turing');
    expect(getDefaultName('frontend')).toBe('Lovelace');
    expect(getDefaultName('qa')).toBe('Curie');
    expect(getDefaultName('devops')).toBe('Tesla');
    expect(getDefaultName('data')).toBe('Gauss');
    expect(getDefaultName('ml')).toBe('Euler');
    expect(getDefaultName('analytics')).toBe('Fibonacci');
    expect(getDefaultName('security')).toBe('Enigma');
  });

  it('maps all three architect role spellings to the same name', () => {
    const name = getDefaultName('architect');
    expect(name).toBe('Da Vinci');
    expect(getDefaultName('arquitectura')).toBe(name);
    expect(getDefaultName('architecture')).toBe(name);
  });

  it('is deterministic for unknown roles', () => {
    const a = getDefaultName('custom-role');
    const b = getDefaultName('custom-role');
    expect(a).toBe(b);
  });

  it('different unknown roles may pick different fallback names', () => {
    // Not strictly guaranteed, but with 10-name pool + hash, very likely.
    const roles = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const names = new Set(roles.map(getDefaultName));
    expect(names.size).toBeGreaterThan(1);
  });

  it('returns a fallback name (not empty) for empty string', () => {
    const name = getDefaultName('');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('falls back to the FALLBACK_NAMES pool for unknown roles', () => {
    const pool = new Set([
      'Faraday', 'Newton', 'Hypatia', 'Hawking', 'Galileo',
      'Ramanujan', 'Noether', 'Fermat', 'Kepler', 'Planck',
    ]);
    expect(pool.has(getDefaultName('nonexistent-role-xyz'))).toBe(true);
  });
});

describe('ARCHITECT constants', () => {
  it('exposes the canonical architect role', () => {
    expect(ARCHITECT_ROLE).toBe('arquitectura');
  });

  it('provides tech-lead instructions', () => {
    expect(ARCHITECT_DEFAULT_INSTRUCTIONS).toContain('tech lead');
    expect(ARCHITECT_DEFAULT_INSTRUCTIONS).toContain('progress.md');
    expect(ARCHITECT_DEFAULT_INSTRUCTIONS).toContain('decisions.md');
    expect(ARCHITECT_DEFAULT_INSTRUCTIONS).toContain('current.md');
  });
});
