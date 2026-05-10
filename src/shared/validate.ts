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
