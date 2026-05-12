// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE B-2 (v0.3.0): per-project skills CRUD endpoints.
//
//   POST /api/skills/list   — { project_id, peer_id }
//   POST /api/skills/get    — { project_id, peer_id, filename }
//   POST /api/skills/save   — { project_id, peer_id, filename, content }
//   POST /api/skills/delete — { project_id, peer_id, filename }
//
// Storage path: ~/.zaipex-acc/projects/<id>/skills/<filename>.md
// Filename pattern: /^[a-zA-Z0-9_-]+\.md$/ (same as the loader uses
// when scanning at boot time, so anything writable is also loadable).
// Content cap: 8 KiB per file. The loader's 8 KiB total cap is the
// real budget, but per-file enforcement here keeps the dashboard's
// upload path honest.
//
// Security:
//   - assertProjectMembership (S-NEW-3) on every endpoint.
//   - validateSkillFilename rejects "..", "/", NUL, non-md before any
//     fs op. We then realpath the resolved path and confirm it sits
//     under the realpath of the project's skills/ directory — the same
//     symlink-escape defence as S-NEW-5 (handleBrowse).

import type { ServerResponse } from 'node:http';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import {
  getSkillsDir,
  validateSkillFilename,
  MAX_SKILLS_BYTES,
} from '../../shared/skills.js';
import { json, error, assertProjectMembership } from './_helpers.js';

// Per-file cap. Same as the loader's TOTAL cap — at v0.3.0 a single
// file is the realistic upper bound (most teams will use 1-3 short
// skill files; users using more will hit truncation in the loader long
// before this matters). Keeping them equal makes the dashboard error
// message simpler ("file too large" vs "you would exceed the budget").
const MAX_SKILL_FILE_BYTES = MAX_SKILLS_BYTES;

interface SkillReqBase {
  project_id?: string;
  peer_id?: string;
  filename?: string;
  content?: string;
}

// Resolve the target file path while defending against symlink
// escape. Returns null + writes the appropriate error response if
// validation fails — caller short-circuits on null.
function resolveSkillPath(
  projectId: string,
  filename: string,
  res: ServerResponse,
): string | null {
  if (!validateSkillFilename(filename)) {
    error(res, 'Invalid filename. Allowed: ^[a-zA-Z0-9_-]+\\.md$');
    return null;
  }

  const dir = getSkillsDir(projectId);
  // Skills dir may not exist yet (first save). For list/get/delete we
  // bail out gracefully; for save we mkdir below, before this guard
  // runs against the realpath.
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch {
    return dir; // dir not yet created — caller decides what to do
  }

  const fullPath = join(realDir, filename);
  // realpath the file too, so a symlink at <skills>/foo.md → /etc/passwd
  // is rejected here even though `validateSkillFilename(foo.md)` passed.
  let realFile: string;
  try {
    realFile = realpathSync(fullPath);
  } catch {
    // File doesn't exist yet — fine for save / a no-op delete. The
    // resolved fullPath is safe because realDir is already realpath'd
    // and filename is validated.
    return fullPath;
  }
  if (!realFile.startsWith(realDir + sep) && realFile !== realDir) {
    error(res, 'Invalid filename. Allowed: ^[a-zA-Z0-9_-]+\\.md$', 400);
    return null;
  }
  return realFile;
}

export function handleSkillsList(body: unknown, res: ServerResponse): void {
  const b = body as SkillReqBase;
  if (!b.project_id) return error(res, 'Missing required field: project_id');
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const dir = getSkillsDir(b.project_id);
  let realDir: string;
  try {
    realDir = realpathSync(dir);
  } catch {
    return json(res, { files: [] });
  }

  let entries: string[];
  try {
    entries = readdirSync(realDir);
  } catch {
    return json(res, { files: [] });
  }

  const files = entries
    .filter(validateSkillFilename)
    .sort()
    .flatMap(filename => {
      try {
        const stat = statSync(join(realDir, filename));
        if (!stat.isFile()) return [];
        return [{
          filename,
          size: stat.size,
          updated_at: stat.mtime.toISOString(),
        }];
      } catch {
        return [];
      }
    });

  json(res, { files });
}

export function handleSkillsGet(body: unknown, res: ServerResponse): void {
  const b = body as SkillReqBase;
  if (!b.project_id || !b.filename) {
    return error(res, 'Missing required fields: project_id, filename');
  }
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const path = resolveSkillPath(b.project_id, b.filename, res);
  if (!path) return; // resolveSkillPath already wrote the error response

  let content: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return error(res, `Skill not found: ${b.filename}`, 404);
    content = readFileSync(path, 'utf8');
  } catch {
    return error(res, `Skill not found: ${b.filename}`, 404);
  }

  json(res, { filename: b.filename, content });
}

export function handleSkillsSave(body: unknown, res: ServerResponse): void {
  const b = body as SkillReqBase;
  if (!b.project_id || !b.filename || b.content == null) {
    return error(res, 'Missing required fields: project_id, filename, content');
  }
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;
  if (!validateSkillFilename(b.filename)) {
    return error(res, 'Invalid filename. Allowed: ^[a-zA-Z0-9_-]+\\.md$');
  }
  // Cap per-file to keep the dashboard honest. Total enforcement is
  // the loader's job (it skips files past the 8 KB cumulative budget).
  const byteLen = Buffer.byteLength(b.content, 'utf8');
  if (byteLen > MAX_SKILL_FILE_BYTES) {
    return error(
      res,
      `Skill content exceeds per-file cap (${byteLen} > ${MAX_SKILL_FILE_BYTES} bytes)`,
      413,
    );
  }

  const dir = getSkillsDir(b.project_id);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    return error(res, `Could not create skills directory: ${(e as Error).message}`, 500);
  }

  // After mkdir, resolveSkillPath sees the dir and runs the symlink
  // check. For a fresh save (file doesn't exist yet) it returns the
  // resolved fullPath — safe because realDir is already realpath'd.
  const path = resolveSkillPath(b.project_id, b.filename, res);
  if (!path) return;

  try {
    writeFileSync(path, b.content, 'utf8');
  } catch (e) {
    return error(res, `Could not write skill: ${(e as Error).message}`, 500);
  }

  json(res, { ok: true, filename: b.filename, size: byteLen });
}

// B-4 v0.3.4 — skills "marketplace" (minimal). The dashboard
// Skills modal exposes these three example skills as one-click
// "Copy to my team" cards. Inlined as constants (rather than
// readFileSync from docs/skills/) so the deploy path doesn't
// depend on whether docs/ ships alongside dist/. Source of truth
// is duplicated under docs/skills/example-*.md for users browsing
// the repo, and the constants below mirror that content.

const SKILL_EXAMPLE_CONVENTIONS = `# Project conventions

Tiny starter conventions for the team. Copy + edit.

## Stack
- TypeScript everywhere (\`.ts\` / \`.tsx\`).
- React 19 for UI, Node 20+ runtime.
- Postgres 15 for persistence, tables prefixed with \`app_\`.
- Tests with Vitest. Integration tests touch a real DB (no mocks).

## Workflow
- Branch per feature. Conventional commits.
- API responses follow \`{ ok: bool, data?: any, error?: string }\`.
- The coordinator writes \`decisions.md\` when something crosses two roles.
`;

const SKILL_EXAMPLE_API_SHAPE = `# API response shape

Every backend response — successful or not — uses this envelope:

\`\`\`jsonc
{ "ok": true | false, "data": ..., "error": "...", "code": "..." }
\`\`\`

- \`data\` present iff \`ok === true\`.
- \`error\` (short human string) + \`code\` (stable machine code)
  present iff \`ok === false\`.
- Validation failures add \`issues: [{path, message, code}]\`,
  matching the broker's own \`INVALID_BODY\` shape.

Never: a different shape per endpoint, error message in \`data\`,
or HTTP status as the only error signal.
`;

const SKILL_EXAMPLE_TESTING_STYLE = `# Testing style

Every test follows the **AAA** structure with explicit separators:

\`\`\`ts
it('returns the user when email matches', async () => {
  // Arrange
  const user = await makeUser({ email: 'a@b.co' });
  // Act
  const result = await findUserByEmail('a@b.co');
  // Assert
  expect(result).toMatchObject({ id: user.id });
});
\`\`\`

Factories over JSON fixtures. Mock at the function boundary
for unit tests; integration tests touch a real DB (no mocks of
better-sqlite3). Each test reinitialises the world in
\`beforeEach\` — no shared state between tests.

File layout: \`<area>/<unit>.test.ts\` mirrors the source. \`it()\`
text is a complete present-tense sentence.
`;

interface SkillExample {
  filename: string;
  description: string;
  content: string;
}

const SKILL_EXAMPLES: SkillExample[] = [
  {
    filename: 'conventions.md',
    description: 'Project stack + workflow conventions (TS, React, Postgres, Vitest).',
    content: SKILL_EXAMPLE_CONVENTIONS,
  },
  {
    filename: 'api-shape.md',
    description: 'Unified API response envelope ({ok, data?, error?, code?}).',
    content: SKILL_EXAMPLE_API_SHAPE,
  },
  {
    filename: 'testing-style.md',
    description: 'AAA pattern, factories over fixtures, no shared state.',
    content: SKILL_EXAMPLE_TESTING_STYLE,
  },
];

export function handleSkillsListExamples(_body: unknown, res: ServerResponse): void {
  json(res, { examples: SKILL_EXAMPLES });
}

export function handleSkillsDelete(body: unknown, res: ServerResponse): void {
  const b = body as SkillReqBase;
  if (!b.project_id || !b.filename) {
    return error(res, 'Missing required fields: project_id, filename');
  }
  if (!assertProjectMembership(b.peer_id, b.project_id, res)) return;

  const path = resolveSkillPath(b.project_id, b.filename, res);
  if (!path) return;

  try {
    unlinkSync(path);
  } catch (e) {
    // Idempotent — missing file is fine. Anything else surfaces.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return json(res, { ok: true });
    }
    return error(res, `Could not delete skill: ${(e as Error).message}`, 500);
  }
  json(res, { ok: true });
}
