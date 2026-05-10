// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE B (v0.3.0): per-project skill files. Users drop `*.md` files
// into ~/.zaipex-acc/projects/<id>/skills/ via the dashboard. At agent
// boot we concat them into a "## Project skills" section appended to
// the system prompt — this is how a team encodes conventions like
// "always use ESM" or "tests live in tests/<area>/" without editing
// every agent prompt by hand.
//
// Loader is sync (matches buildInstructions being sync) and tolerates
// missing/malformed dirs — boot must never fail because of a skill
// file. Total budget is 8 KB / ~2,000 tokens; we skip the first file
// that would push us over and flag `truncated` so the caller can warn.

import { readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { PROJECTS_DIR } from './config.js';

// Soft cap on total skill bytes injected into the prompt. 8 KiB is
// roughly 2,000 tokens at 4 chars/tok — same order of magnitude as
// the system prompt itself, so any larger and skills start dwarfing
// the agent's behavior rules. Tune in QA if it's too tight.
export const MAX_SKILLS_BYTES = 8 * 1024;

// FILENAME validator. Only ASCII alphanum + `_` / `-`, ending in `.md`.
// Matches the broker handler in B-2 so the dashboard surfaces the same
// constraint to the user.
export const SKILL_FILENAME_PATTERN = /^[a-zA-Z0-9_-]+\.md$/;

export function getSkillsDir(projectId: string): string {
  return join(PROJECTS_DIR, projectId, 'skills');
}

export function validateSkillFilename(name: string): boolean {
  return SKILL_FILENAME_PATTERN.test(name);
}

export interface LoadedSkill {
  filename: string;
  content: string;
}

export interface LoadedSkills {
  skills: LoadedSkill[];
  totalBytes: number;
  // true if at least one file was skipped because the total would have
  // exceeded MAX_SKILLS_BYTES. Caller is expected to log a warning.
  truncated: boolean;
}

// Load all *.md skill files for a project. Always returns — never
// throws — so a broken/missing directory cannot block agent boot.
// Files are loaded in directory order (whatever readdirSync gives,
// then sorted lexicographically) so the result is deterministic.
//
// Path-traversal guard: we filter filenames against
// SKILL_FILENAME_PATTERN before opening anything, then realpath the
// final path and check it still lives under the skills directory.
// The pattern alone already rejects "/" / ".." / NUL, but the realpath
// check defends against symlink shenanigans (someone dropping a
// `mySkill.md` symlink that points at /etc/passwd).
export function loadProjectSkills(projectId: string): LoadedSkills {
  const dir = getSkillsDir(projectId);

  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch {
    // Dir doesn't exist (or unreadable). Empty result, no warning.
    return { skills: [], totalBytes: 0, truncated: false };
  }

  let entries: string[];
  try {
    entries = readdirSync(realDir);
  } catch {
    return { skills: [], totalBytes: 0, truncated: false };
  }

  const valid = entries.filter(validateSkillFilename).sort();

  const skills: LoadedSkill[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const filename of valid) {
    const path = join(realDir, filename);

    // Symlink defence: realpath the file and confirm it stays inside
    // realDir. If a symlink points outside (e.g., /etc/passwd), the
    // resolved path won't match and we skip.
    let realPath: string;
    try {
      realPath = realpathSync(path);
    } catch {
      continue;
    }
    if (!realPath.startsWith(realDir + sep) && realPath !== realDir) {
      continue;
    }

    let content: string;
    try {
      const stat = statSync(realPath);
      if (!stat.isFile()) continue;
      content = readFileSync(realPath, 'utf8');
    } catch {
      continue;
    }

    const len = Buffer.byteLength(content, 'utf8');
    if (totalBytes + len > MAX_SKILLS_BYTES) {
      truncated = true;
      // Stop on the first overflow rather than greedily fitting
      // smaller-than-remaining-budget files later — keeps behaviour
      // deterministic and easy for the user to reason about.
      break;
    }
    skills.push({ filename, content });
    totalBytes += len;
  }

  return { skills, totalBytes, truncated };
}

// Format the loaded skills as a markdown section for the system
// prompt. Empty input returns an empty string so the caller can
// concat unconditionally.
export function formatSkillsSection(skills: LoadedSkill[]): string {
  if (skills.length === 0) return '';
  const blocks = skills.map(s => {
    // Strip trailing whitespace so adjacent files don't add extra
    // blank lines, but keep the file content as-is otherwise — users
    // write these by hand and we don't want to "format" their text.
    const trimmed = s.content.replace(/\s+$/, '');
    return `### ${s.filename}\n${trimmed}`;
  });
  return `\n\n## Project skills\n\n${blocks.join('\n\n')}`;
}
