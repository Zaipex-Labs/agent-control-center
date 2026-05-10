// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { assertSafeIdentifier } from '../../src/shared/validate.js';

// The helper is used wherever user-controlled strings flow into file
// paths, shell commands, or tmux targets (project names, roles, agent
// names). Hardening it closes [C-1] and [H-3] from the v0.2.1 audit.

describe('assertSafeIdentifier', () => {
  // Traversal + separators + shell metachars + null byte + length.
  const BAD: Array<[string, string]> = [
    ['..', 'contains ".."'],
    ['../foo', 'slash or "..'],
    ['foo/../bar', 'slash or "..'],
    ['a/b', 'slash'],
    ['a\\b', 'backslash'],
    ['$(touch /tmp/pwn)', 'shell substitution'],
    ['`id`', 'backtick'],
    ['a;b', 'semicolon'],
    ['a|b', 'pipe'],
    ['a&b', 'ampersand'],
    ['a>b', 'redirect'],
    ['a<b', 'redirect'],
    ['a\nb', 'newline'],
    ['a\tb', 'tab'],
    ['a\0b', 'null byte'],
    ['', 'empty'],
    [' ', 'space'],
    ['  ', 'spaces'],
    ['a'.repeat(65), 'too long'],
  ];

  const GOOD = [
    'arquitectura',
    'backend-01',
    'qa_lead',
    'A1',
    'x',
    'my.project',     // dot is allowed (backcompat with existing configs)
    'a'.repeat(64),   // boundary: exactly 64 chars
  ];

  for (const [value, why] of BAD) {
    it(`rejects ${JSON.stringify(value)} (${why})`, () => {
      expect(() => assertSafeIdentifier('field', value)).toThrow(/Invalid field/);
    });
  }

  for (const value of GOOD) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(() => assertSafeIdentifier('field', value)).not.toThrow();
    });
  }

  it('rejects non-string input', () => {
    expect(() => assertSafeIdentifier('field', 42 as unknown as string)).toThrow(/must be a string/);
    expect(() => assertSafeIdentifier('field', null as unknown as string)).toThrow(/must be a string/);
    expect(() => assertSafeIdentifier('field', undefined as unknown as string)).toThrow(/must be a string/);
  });

  it('error message includes the field name', () => {
    expect(() => assertSafeIdentifier('project_id', '..')).toThrow(/Invalid project_id/);
    expect(() => assertSafeIdentifier('role', '`pwn`')).toThrow(/Invalid role/);
  });
});
