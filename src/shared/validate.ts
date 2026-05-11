// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// Safe-identifier validation for user-controlled strings that flow into
// file paths (PROJECTS_DIR/<name>.json), shell commands (tmux send-keys),
// and tmux pane targets (acc-<project>:<role>). Callers should invoke
// this at the entry point of every handler that writes user input to
// those sinks.
//
// Addresses audit findings:
//   [C-1] path traversal in handleCreateProject
//   [H-3] shell injection via agent.role in tmux spawn
//   [M-6] handleAddAgent / handleUpdateProject accepted arbitrary roles

// Allowed character class kept at [a-zA-Z0-9_.-] for backwards
// compatibility with existing configs (project names like `my.proj`).
// Length cap 64 because:
//   - 128 (old) was wider than any realistic identifier.
//   - 64 still covers rolelabel + numeric suffix comfortably.
//   - Shorter strings mean shorter error messages when something slips through.
const SAFE_RE = /^[a-zA-Z0-9_.\-]{1,64}$/;

export function assertSafeIdentifier(fieldName: string, value: unknown): void {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`Invalid ${fieldName}: empty`);
  }
  if (value.length > 64) {
    throw new Error(`Invalid ${fieldName}: too long (${value.length} > 64)`);
  }
  // Explicit checks beyond the regex so error messages point at the
  // actual offender instead of a generic "only [a-zA-Z0-9_.-] allowed".
  if (value.includes('\0')) {
    throw new Error(`Invalid ${fieldName}: null byte`);
  }
  if (value.includes('..')) {
    throw new Error(`Invalid ${fieldName}: contains ".."`);
  }
  if (!SAFE_RE.test(value)) {
    throw new Error(`Invalid ${fieldName}: only [a-zA-Z0-9_.-] allowed (1-64 chars)`);
  }
}

// v0.3.2.1 HIGH-2 + MED-3 — Agent *display* names (not identifiers).
// Display names appear in the dashboard, the system prompt (markdown-
// fenced per FU-H v0.3.1), and tmux pane titles. They do NOT flow to
// file paths, shell command tokens, or MCP config keys — `role` and
// `project_id` (the actual identifiers) handle those, and stay under
// `assertSafeIdentifier`.
//
// Practical examples that should be allowed but were rejected pre-fix:
//   "Da Vinci"   — default Tech Lead name in the dashboard
//   "café-app"   — LatAm/Mexico-targeted product, accents matter
//   "niño-bot"   — same
//
// We still reject < > " ' ` to keep the value safe for any context
// that does end up rendering it as raw markup (defense-in-depth — the
// dashboard escapes via React, but message-broker logs and rendered
// system prompts touch the value too).
const DISPLAY_NAME_RE = /^[\p{L}\p{N}_\- .]{1,64}$/u;
const FORBIDDEN_DISPLAY_CHARS = /[<>"'`\\]/;

export function assertSafeDisplayName(fieldName: string, value: unknown): void {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${fieldName}: must be a string`);
  }
  if (value.length === 0) {
    throw new Error(`Invalid ${fieldName}: empty`);
  }
  if (value.length > 64) {
    throw new Error(`Invalid ${fieldName}: too long (${value.length} > 64)`);
  }
  if (value.includes('\0')) {
    throw new Error(`Invalid ${fieldName}: null byte`);
  }
  if (value.includes('..')) {
    throw new Error(`Invalid ${fieldName}: contains ".."`);
  }
  if (FORBIDDEN_DISPLAY_CHARS.test(value)) {
    throw new Error(`Invalid ${fieldName}: contains forbidden character (< > " ' \` \\)`);
  }
  if (!DISPLAY_NAME_RE.test(value)) {
    throw new Error(`Invalid ${fieldName}: only letters, numbers, spaces, "_", "-", "." allowed (1-64 chars)`);
  }
}
