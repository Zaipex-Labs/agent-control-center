// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// FASE B-1 (v0.3.0): tests for the skills loader. We swap ACC_HOME to
// a fresh tmpdir per test, then re-import the module so PROJECTS_DIR
// is recomputed against it. Vitest's vi.resetModules() handles the
// cache.

let tmpHome: string;
let prevHome: string | undefined;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'acc-skills-test-'));
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

function seedSkill(projectId: string, filename: string, content: string): void {
  const dir = join(tmpHome, 'projects', projectId, 'skills');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, filename), content, 'utf8');
}

describe('validateSkillFilename', () => {
  it('accepts plain alphanumeric .md filenames', async () => {
    const { validateSkillFilename } = await import('../../src/shared/skills.js');
    expect(validateSkillFilename('conventions.md')).toBe(true);
    expect(validateSkillFilename('use-esm.md')).toBe(true);
    expect(validateSkillFilename('test_naming.md')).toBe(true);
    expect(validateSkillFilename('A1.md')).toBe(true);
  });

  it('rejects path traversal attempts', async () => {
    const { validateSkillFilename } = await import('../../src/shared/skills.js');
    expect(validateSkillFilename('../escape.md')).toBe(false);
    expect(validateSkillFilename('foo/bar.md')).toBe(false);
    expect(validateSkillFilename('../../etc/passwd')).toBe(false);
  });

  it('rejects non-.md and disallowed characters', async () => {
    const { validateSkillFilename } = await import('../../src/shared/skills.js');
    expect(validateSkillFilename('readme.txt')).toBe(false);
    expect(validateSkillFilename('a.md.bak')).toBe(false);
    expect(validateSkillFilename('weird name.md')).toBe(false);
    expect(validateSkillFilename('.hidden.md')).toBe(false);
    expect(validateSkillFilename('emoji-🎉.md')).toBe(false);
  });

  it('rejects empty / nul', async () => {
    const { validateSkillFilename } = await import('../../src/shared/skills.js');
    expect(validateSkillFilename('')).toBe(false);
    expect(validateSkillFilename('a\0.md')).toBe(false);
  });
});

describe('loadProjectSkills', () => {
  it('returns empty when the dir does not exist', async () => {
    const { loadProjectSkills } = await import('../../src/shared/skills.js');
    const out = loadProjectSkills('no-such-project');
    expect(out.skills).toEqual([]);
    expect(out.totalBytes).toBe(0);
    expect(out.truncated).toBe(false);
  });

  it('loads valid skill files in deterministic (sorted) order', async () => {
    seedSkill('p1', 'b-second.md', '# B');
    seedSkill('p1', 'a-first.md', '# A');
    seedSkill('p1', 'c-third.md', '# C');
    const { loadProjectSkills } = await import('../../src/shared/skills.js');
    const out = loadProjectSkills('p1');
    expect(out.skills.map(s => s.filename)).toEqual([
      'a-first.md', 'b-second.md', 'c-third.md',
    ]);
  });

  it('skips files with invalid filenames silently', async () => {
    seedSkill('p1', 'good.md', 'good');
    // Manually drop a bad-name file via the same dir path
    const badPath = join(tmpHome, 'projects', 'p1', 'skills', 'bad name.md');
    writeFileSync(badPath, 'should be ignored', 'utf8');
    const { loadProjectSkills } = await import('../../src/shared/skills.js');
    const out = loadProjectSkills('p1');
    expect(out.skills.map(s => s.filename)).toEqual(['good.md']);
  });

  it('skips non-.md files and respects the validator at fs scan time', async () => {
    seedSkill('p1', 'valid.md', 'ok');
    const dir = join(tmpHome, 'projects', 'p1', 'skills');
    writeFileSync(join(dir, 'image.png'), 'binary', 'utf8');
    writeFileSync(join(dir, 'README'), 'no extension', 'utf8');
    const { loadProjectSkills } = await import('../../src/shared/skills.js');
    const out = loadProjectSkills('p1');
    expect(out.skills.map(s => s.filename)).toEqual(['valid.md']);
  });

  it('respects the 8KB total cap and flags truncated', async () => {
    // Two 5KB files — first fits, second pushes total over and is skipped.
    seedSkill('p1', 'a.md', 'a'.repeat(5 * 1024));
    seedSkill('p1', 'b.md', 'b'.repeat(5 * 1024));
    const { loadProjectSkills, MAX_SKILLS_BYTES } = await import('../../src/shared/skills.js');
    const out = loadProjectSkills('p1');
    expect(out.skills).toHaveLength(1);
    expect(out.skills[0].filename).toBe('a.md');
    expect(out.totalBytes).toBeLessThanOrEqual(MAX_SKILLS_BYTES);
    expect(out.truncated).toBe(true);
  });

  it('truncated is false when content fits', async () => {
    seedSkill('p1', 'a.md', 'a'.repeat(100));
    seedSkill('p1', 'b.md', 'b'.repeat(100));
    const { loadProjectSkills } = await import('../../src/shared/skills.js');
    const out = loadProjectSkills('p1');
    expect(out.truncated).toBe(false);
    expect(out.skills).toHaveLength(2);
  });

  it('symlink that escapes the skills dir is dropped', async () => {
    seedSkill('p1', 'good.md', 'safe');
    const dir = join(tmpHome, 'projects', 'p1', 'skills');
    // /etc/hosts is world-readable on macOS + linux runners, so the
    // symlink itself succeeds; the loader's realpath check is what
    // must drop it.
    try {
      symlinkSync('/etc/hosts', join(dir, 'evil.md'));
    } catch {
      // Some sandboxed CI systems disallow symlink creation; the test
      // is informational here, skip.
      return;
    }
    const { loadProjectSkills } = await import('../../src/shared/skills.js');
    const out = loadProjectSkills('p1');
    expect(out.skills.map(s => s.filename)).toEqual(['good.md']);
  });
});

describe('formatSkillsSection', () => {
  it('returns empty string for no skills', async () => {
    const { formatSkillsSection } = await import('../../src/shared/skills.js');
    expect(formatSkillsSection([])).toBe('');
  });

  it('renders a "## Project skills" markdown header followed by per-file blocks', async () => {
    const { formatSkillsSection } = await import('../../src/shared/skills.js');
    const out = formatSkillsSection([
      { filename: 'esm.md', content: 'use esm always\n' },
      { filename: 'tests.md', content: 'tests/<area>/' },
    ]);
    expect(out).toContain('## Project skills');
    expect(out).toContain('### esm.md');
    expect(out).toContain('use esm always');
    expect(out).toContain('### tests.md');
    expect(out).toContain('tests/<area>/');
  });
});
