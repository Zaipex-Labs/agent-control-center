// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { buildInstructions } from '../../src/server/index.js';
import { buildSaveResumePrompt } from '../../src/broker/handlers.js';

// [M-1b] Snapshot + structural assertions for the system prompt the
// MCP server hands every agent. Locks in the conservative compression
// from §7-bis so a future refactor can't silently re-bloat it.
//
// Length cap is 6500 characters (~1625 tokens at 4 chars/tok). Real
// measurements at the M-1b commit:
//   - pre-M-1b system prompt:  7,685 chars / ~1,922 tokens
//   - post-M-1b system prompt: 6,157 chars / ~1,540 tokens
//   - delta: −1,528 chars / ~−382 tokens (≈ 20% recorte)
// 6500 leaves a small margin while still failing if anyone re-adds a
// rule the size of the deleted "## Your tools" list (~80 tok) or the
// expanded G9 (~150 tok).

describe('buildInstructions [M-1b]', () => {
  const prompt = buildInstructions('Turing', 'backend');

  it('renders the agent name and role', () => {
    expect(prompt).toContain('You are Turing');
    expect(prompt).toContain('the role of backend');
  });

  it('stays under the 6500-character budget (~1625 tokens at 4 chars/tok)', () => {
    expect(prompt.length).toBeLessThan(6500);
  });

  it('does NOT carry the "## Your tools" list (MCP host injects tool descs already)', () => {
    expect(prompt).not.toContain('## Your tools');
    // Sanity: the bullets that used to follow the heading are also gone
    expect(prompt).not.toContain('list_peers / whoami:');
  });

  it('A4 collapses agent-to-agent silence into a single rule that mentions "silent"', () => {
    // The compression merges old A4 + G6. A4 is the surviving one.
    const a4Match = prompt.match(/A4\.\s+([^]+?)\n\nA5\./);
    expect(a4Match).not.toBeNull();
    const a4 = a4Match![1];
    expect(a4.toLowerCase()).toContain('silent');
  });

  it('G6 (the previous separate "coordination is silent" rule) is gone', () => {
    expect(prompt).not.toMatch(/^G6\./m);
  });

  it('A2 anti-filler rule is language-agnostic (no Spanish-specific list)', () => {
    // §7-bis: "fraseo lenguaje-agnóstico" — drop the "gracias / perfecto" list.
    expect(prompt).toContain('A2.');
    expect(prompt).not.toMatch(/no "gracias"/);
    expect(prompt).not.toMatch(/no "perfecto"/);
    expect(prompt.toLowerCase()).toContain('filler');
  });

  it('G9 collapsed to a one-line pointer (protocol body now lives in the broker-injected message)', () => {
    const g9Match = prompt.match(/G9\.\s+([^]+?)\n`;|G9\.\s+([^]+?)$/);
    expect(g9Match).not.toBeNull();
    const g9Body = (g9Match![1] ?? g9Match![2] ?? '').trim();
    // One short sentence — pre-M-1b version was ~5 lines, ~640 chars.
    expect(g9Body.length).toBeLessThan(280);
    // The literal "[system:save-resume]" trigger is still mentioned so
    // the agent recognises it; the "set_shared(\"resume\", ...)" call
    // and JSON shape MUST NOT be in the system prompt anymore.
    expect(g9Body).toContain('[system:save-resume]');
    expect(g9Body).not.toContain('set_shared("resume"');
    expect(g9Body).not.toContain('next_steps');
  });
});

describe('buildSaveResumePrompt — broker-injected protocol [M-1a/M-1b E2E]', () => {
  // The injected message must carry the full set_shared(...) protocol
  // and the canonical JSON shape so an agent with the COMPRESSED G9
  // (just a one-line pointer) can still execute the snapshot. Without
  // this end-to-end coverage, breaking buildSaveResumePrompt would
  // silently regress save-resume behaviour while every prompt-side
  // test stays green.
  const REQUIRED_KEYS = ['summary', 'next_steps', 'open_questions', 'updated_at'] as const;

  it('periodic call carries the literal trigger + set_shared protocol', () => {
    const text = buildSaveResumePrompt('backend', '2026-05-09T00:00:00.000Z', 'periodic');
    expect(text).toContain('[system:save-resume]');
    expect(text).toContain('set_shared("resume", "backend"');
  });

  it('shutdown call carries the urgency wording + protocol', () => {
    const text = buildSaveResumePrompt('frontend', '2026-05-09T00:00:00.000Z', 'shutdown');
    expect(text).toContain('[system:save-resume]');
    expect(text).toContain('shutting down');
    expect(text).toContain('set_shared("resume", "frontend"');
  });

  it('protocol mentions every required JSON key (summary, next_steps, open_questions, updated_at)', () => {
    const text = buildSaveResumePrompt('arquitectura', '2026-05-09T12:30:45.000Z', 'periodic');
    for (const key of REQUIRED_KEYS) {
      expect(text).toContain(key);
    }
  });

  it('protocol asks the agent to act SILENTLY (no user reply)', () => {
    const text = buildSaveResumePrompt('qa', '2026-05-09T00:00:00.000Z', 'periodic');
    expect(text.toLowerCase()).toContain('silently');
    expect(text.toLowerCase()).toContain('do not reply to the user');
  });

  it('embeds the role and timestamp the caller supplied', () => {
    const role = 'data-pipeline';
    const ts = '2026-05-09T10:00:00.000Z';
    const text = buildSaveResumePrompt(role, ts, 'periodic');
    expect(text).toContain(`set_shared("resume", "${role}"`);
    expect(text).toContain(ts);
  });
});
