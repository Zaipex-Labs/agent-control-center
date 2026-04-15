// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { extractStatusLine, getAgentStatus } from '../../src/broker/terminal.js';

describe('extractStatusLine', () => {
  it('extracts a basic status line with action and metadata', () => {
    const out = extractStatusLine('Thinking… (12s · ↑ 234 tokens)');
    expect(out).toBe('Thinking… (12s · ↑ 234 tokens)');
  });

  it('extracts ellipsized action with triple dots', () => {
    const out = extractStatusLine('Nesting... (1m 11s · ↓ 1.0k tokens)');
    expect(out).toBe('Nesting… (1m 11s · ↓ 1.0k tokens)');
  });

  it('strips "esc to interrupt" noise', () => {
    const out = extractStatusLine('Reading… (3s · esc to interrupt)');
    expect(out).toBe('Reading… (3s)');
  });

  it('returns null when the input is idle (input box rounded borders visible)', () => {
    const idle = 'Thinking… (12s · ↑ 234 tokens)\n╭──────╮\n│      │\n╰──────╯';
    expect(extractStatusLine(idle)).toBeNull();
  });

  it('returns null when there is no status line at all', () => {
    expect(extractStatusLine('Just some random output\nnothing to see')).toBeNull();
  });

  it('strips ANSI escape codes before matching', () => {
    const raw = '\x1b[32mThinking…\x1b[0m (5s · ↑ 99 tokens)';
    expect(extractStatusLine(raw)).toBe('Thinking… (5s · ↑ 99 tokens)');
  });

  it('returns the LAST status line when multiple are present in window', () => {
    const lines = 'Reading config.ts… (1s · ↑ 1 tokens)\nWriting… (2s · ↑ 2 tokens)';
    const out = extractStatusLine(lines);
    expect(out).toBe('Writing… (2s · ↑ 2 tokens)');
  });

  it('only considers the tail (last ~400 chars)', () => {
    // Pad a stale status line far in the past with lots of fresh noise
    // that does not itself contain a status line.
    const stale = 'Thinking… (1s · ↑ 1 tokens)';
    const noise = 'x'.repeat(500);
    const out = extractStatusLine(stale + noise);
    expect(out).toBeNull();
  });

  it('handles status line with a multi-word meta field', () => {
    const out = extractStatusLine('Nesting… (1m 11s · ↓ 1.0k tokens · thought for 2s)');
    expect(out).toBe('Nesting… (1m 11s · ↓ 1.0k tokens · thought for 2s)');
  });
});

describe('getAgentStatus', () => {
  it('returns undefined for an unknown key', () => {
    expect(getAgentStatus('does-not-exist')).toBeUndefined();
  });
});
