// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInstructions } from '../../src/server/index.js';
import { buildSaveResumePrompt } from '../../src/broker/handlers.js';

// [M-1] Snapshot + structural assertions for the system prompt the
// MCP server hands every agent. Locks in the FASE C-2 (v0.3.0)
// aggressive compression from §7-bis so a future refactor can't
// silently re-bloat it.
//
// Length cap is 3500 characters (~875 tokens at 4 chars/tok). Real
// measurements over time:
//   pre-M-1b (v0.2.3):    7,685 chars / ~1,922 tok
//   post-M-1b (v0.2.4):   6,157 chars / ~1,540 tok  (−382 tok / 20%)
//   post-A-4 (v0.3.0):    6,424 chars / ~1,606 tok  (G-mem +67 tok)
//   post-C-2 (this cut):  ~2,725 chars / ~681 tok  (−925 tok / ~58%)
// 3500 leaves headroom over the post-C-2 measurement so per-rule
// edits don't trip the budget, while still failing if anyone re-adds
// a deleted section ("## Your team" intro, "## How you talk to
// OTHER AGENTS" prefix, expanded G9 protocol body).

describe('buildInstructions [M-1 / C-2 aggressive]', () => {
  const prompt = buildInstructions('Turing', 'backend');

  it('renders the agent name and role inside markdown backticks (FU-H fence)', () => {
    expect(prompt).toContain('You are `Turing`');
    expect(prompt).toContain(', `backend`.');
    // and the trailing self-reference is also fenced
    expect(prompt).toContain('you are `Turing`.');
  });

  it('stays under the 3500-character budget (~875 tokens at 4 chars/tok)', () => {
    // Anchor the post-C-2 size so a future creep is caught early.
    expect(prompt.length).toBeLessThan(3500);
  });

  it('does NOT carry the "## Your tools" list (MCP host injects tool descs already)', () => {
    expect(prompt).not.toContain('## Your tools');
    expect(prompt).not.toContain('list_peers / whoami:');
  });

  it('does NOT carry the dropped "## How you talk to" prefix sections', () => {
    // Pre-C-2 the prompt had three section headers ("## How you talk to
    // OTHER AGENTS", "## How you talk to the USER", "## General
    // behavior"). C-2 collapsed them into "## Behavior" + "## Protocol".
    expect(prompt).not.toContain('## How you talk to');
    expect(prompt).not.toContain('## Your team');
    expect(prompt).not.toContain('## General behavior');
  });

  it('exposes the new "## Behavior" and "## Protocol" sections', () => {
    expect(prompt).toContain('## Behavior');
    expect(prompt).toContain('## Protocol');
  });

  it('B2 collapses A5 + A6 + G2: agent-to-agent tasks are pre-authorized + silent', () => {
    // C-2 merges the four rules that were the no-bounce / no-refuse /
    // no-permission-asking cluster. The eval harness's
    // agent-to-agent-task-receipt + vague-refusal-trigger scenarios
    // gate this collapse — see scripts/eval/scenarios/.
    const m = prompt.match(/B2\.\s+([^]+?)\n\nB3\./);
    expect(m).not.toBeNull();
    const body = m![1].toLowerCase();
    expect(body).toContain('pre-authorized');
    expect(body).toMatch(/never (bounce|refuse)/);
    expect(body).toContain('not my area');
  });

  it('B3 collapses U4 + U4b: send_to_role + no intermediate filler', () => {
    const m = prompt.match(/B3\.\s+([^]+?)\n\nB4\./);
    expect(m).not.toBeNull();
    const body = m![1].toLowerCase();
    expect(body).toContain('send_to_role');
    expect(body).toMatch(/(estoy consultando|let me ask|i'?ll check)/);
  });

  it('B1 anti-filler stays language-agnostic (no Spanish-only list)', () => {
    expect(prompt).toContain('B1.');
    expect(prompt).not.toMatch(/no "gracias"/);
    expect(prompt).not.toMatch(/no "perfecto"/);
    expect(prompt.toLowerCase()).toContain('filler');
  });

  // FASE B-1 (v0.3.0): no projectId → no skills section in the prompt.
  it('omits the "## Project skills" section when projectId is not passed', () => {
    expect(prompt).not.toContain('## Project skills');
  });

  // FU-H (v0.3.1): defense-in-depth fence on ${name}/${role}. The
  // primary guard is assertSafeIdentifier on the broker side; this
  // test pins the prompt-side wrapping so a future regression there
  // can't silently let injection bytes land verbatim. We exercise the
  // shape, not the validator — buildInstructions is allowed to render
  // whatever string the caller passes, but it must wrap it.
  it('FU-H: name and role land inside `…` even if exotic chars slip past the validator', () => {
    const out = buildInstructions('weird name', 'weird role');
    // Both occurrences of name (header + tail self-reference) are fenced.
    const fencedHeader = out.indexOf('You are `weird name`, `weird role`.');
    expect(fencedHeader).toBeGreaterThan(-1);
    expect(out).toContain('you are `weird name`.');
    // And there is no un-fenced raw occurrence ("You are weird name" without
    // the leading backtick).
    expect(out).not.toMatch(/You are weird name(?!`)/);
  });
});

// FASE B-1 (v0.3.0): when projectId IS passed, buildInstructions
// appends the skills section. Tests run against a tmp ACC_HOME so they
// don't pollute the user's real ~/.zaipex-acc/.
describe('buildInstructions · skills loading [B-1]', () => {
  let tmpHome: string;
  let prevHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'acc-skills-instr-'));
    prevHome = process.env['ACC_HOME'];
    process.env['ACC_HOME'] = tmpHome;
    vi.resetModules();
  });

  afterEach(() => {
    if (prevHome != null) process.env['ACC_HOME'] = prevHome;
    else delete process.env['ACC_HOME'];
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
  });

  function seed(projectId: string, filename: string, content: string): void {
    const dir = join(tmpHome, 'projects', projectId, 'skills');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), content, 'utf8');
  }

  it('omits the skills section when there are no skill files', async () => {
    const { buildInstructions } = await import('../../src/server/index.js');
    const out = buildInstructions('Turing', 'backend', 'project-empty');
    expect(out).not.toContain('## Project skills');
  });

  it('appends a "## Project skills" section with each file as a sub-heading', async () => {
    seed('proj-x', 'use-esm.md', 'always use esm');
    seed('proj-x', 'tests.md', 'tests live in tests/<area>/');
    const { buildInstructions } = await import('../../src/server/index.js');
    const out = buildInstructions('Turing', 'backend', 'proj-x');
    expect(out).toContain('## Project skills');
    expect(out).toContain('### use-esm.md');
    expect(out).toContain('always use esm');
    expect(out).toContain('### tests.md');
    expect(out).toContain('tests live in tests/<area>/');
  });

  it('skills are appended AFTER the rules section (P7 stays the last protocol rule)', async () => {
    seed('proj-x', 'a.md', 'rule one');
    const { buildInstructions } = await import('../../src/server/index.js');
    const out = buildInstructions('Turing', 'backend', 'proj-x');
    // Post-C-2 the team-memory rule moved from G-mem to P7.
    const memIdx = out.indexOf('P7.');
    const skillsIdx = out.indexOf('## Project skills');
    expect(memIdx).toBeGreaterThan(0);
    expect(skillsIdx).toBeGreaterThan(memIdx);
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
