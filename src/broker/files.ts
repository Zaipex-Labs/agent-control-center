// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Returns the set of files currently modified in the given working
// directory according to `git status --porcelain`. Each entry carries the
// two-character git status code (e.g. ' M', 'A ', '??', 'MM') and the
// final path. Rename entries ("R  old -> new") are collapsed to the new
// path only.
//
// Silent on failure: if the cwd is not a git repo, git is missing, or
// anything else goes wrong, returns an empty array.
export interface GitFileEntry {
  path: string;
  status: string;
}

export function gitModifiedFiles(cwd: string): GitFileEntry[] {
  if (!cwd || !existsSync(cwd)) return [];
  try {
    const out = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500,
    });
    const entries: GitFileEntry[] = [];
    for (const rawLine of out.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.length < 3) continue;
      const status = line.slice(0, 2);
      let path = line.slice(3);
      // Rename: "old -> new" → keep the new path.
      const arrow = path.indexOf(' -> ');
      if (arrow >= 0) path = path.slice(arrow + 4);
      // Strip quoting around paths with unusual characters.
      if (path.startsWith('"') && path.endsWith('"')) {
        path = path.slice(1, -1).replace(/\\(.)/g, '$1');
      }
      if (path.length === 0) continue;
      entries.push({ path, status });
    }
    return entries;
  } catch {
    return [];
  }
}
