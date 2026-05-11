// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { assertSafeIdentifier, assertSafeDisplayName } from '../../src/shared/validate.js';

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

// v0.3.2.1 HIGH-2 + MED-3 — Display names (agent.name) are NOT
// identifiers. They appear in markdown-fenced contexts, dashboard
// React text (escaped), and tmux pane titles. We allow spaces and
// unicode letters/numbers; we still reject `..`, null bytes, and
// the < > " ' ` \ characters that could break the rare consumer
// that doesn't escape (logs, manual greps, etc.).
describe('assertSafeDisplayName (v0.3.2.1 HIGH-2 + MED-3)', () => {
  const GOOD = [
    'Da Vinci',           // the default Tech Lead name — was rejected pre-fix
    'DaVinci',
    'Da-Vinci',
    'Da_Vinci',
    'café-app',           // MED-3: accented vowel
    'niño-bot',           // MED-3: ñ
    'agente 01',
    'A',                  // 1-char boundary
    'a'.repeat(64),       // 64-char boundary
    'turing.backend',     // dot still allowed
    '京都-bot',            // unicode letters from non-Latin scripts
    'Алиса',              // Cyrillic
  ];

  const BAD: Array<[string, string]> = [
    ['', 'empty'],
    ['  '.padEnd(65, ' '), 'too long'],
    ['..', 'contains ".."'],
    ['Da .. Vinci', 'contains ".."'],
    ['name\0bytes', 'null byte'],
    ['<script>', 'forbidden < >'],
    ['name"with"quotes', 'forbidden quotes'],
    ['name`backtick`', 'forbidden backtick'],
    ['name\\backslash', 'forbidden backslash'],
    ["O'Brien", "forbidden apostrophe — UX trade-off: apostrophes uncommon in handles, blocking is safer than allowing"],
    ['$(touch /tmp/pwn)', 'parens/$ not in allowed class'],
    ['name;rm -rf', 'semicolon not in allowed class'],
  ];

  for (const value of GOOD) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(() => assertSafeDisplayName('name', value)).not.toThrow();
    });
  }

  for (const [value, why] of BAD) {
    it(`rejects ${JSON.stringify(value)} (${why})`, () => {
      expect(() => assertSafeDisplayName('name', value)).toThrow(/Invalid name/);
    });
  }

  it('rejects non-string input', () => {
    expect(() => assertSafeDisplayName('name', 42 as unknown as string)).toThrow(/must be a string/);
    expect(() => assertSafeDisplayName('name', null as unknown as string)).toThrow(/must be a string/);
  });

  it('regression: "Da Vinci" (the default Tech Lead) is allowed', () => {
    // This is the exact bug that blocked every freshly-created team's
    // first Edit-save until v0.3.2.1.
    expect(() => assertSafeDisplayName('name', 'Da Vinci')).not.toThrow();
  });

  it('regression: assertSafeIdentifier still rejects "Da Vinci" — roles stay strict', () => {
    // Roles are still identifiers; spaces still blocked there.
    expect(() => assertSafeIdentifier('role', 'Da Vinci')).toThrow(/Invalid role/);
  });
});
