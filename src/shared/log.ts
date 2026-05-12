// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// MED-12 wave-1 (v0.4.0). Helper for the canonical "swallow this
// expected failure but log it" pattern that pre-v0.4.0 was written
// as `try { … } catch { /* ignore */ }`. The empty catch hides
// production errors when the assumption that "this can only fail
// in expected ways" turns out to be wrong; swallow() keeps the
// fail-soft behaviour but leaves a greppable breadcrumb in stderr
// so the site can be found from logs.
//
// Why this lives in src/shared/ and not in src/broker/handlers/:
// terminal lifecycle (broker side), WS broadcast (broker side), and
// the MCP message-router poll loop (server side) all need this. A
// shared helper sits above any of those subsystems.
//
// Format:
//
//   [swallow:peer:cleanup-delete] ENOENT: no such file
//
// The label is a greppable colon-separated identifier. Convention:
// `<subsystem>:<operation>` (e.g. `ws:broadcast-send`,
// `terminal:stdin-write`). Subsystem-first so `grep -E
// '^\[swallow:ws:'` returns every WS-related swallow.

function formatError(e: unknown): string {
  if (e instanceof Error) {
    return e.message || e.name || 'unknown error';
  }
  return String(e);
}

// Synchronous version. Use for catches around sync calls
// (`proc.kill()`, `client.ws.send()`, `localStorage.setItem`).
export function swallow(label: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    process.stderr.write(`[swallow:${label}] ${formatError(e)}\n`);
  }
}

// Async version. Use for catches around await-returning calls.
// Returns a promise that resolves either way — never rejects.
// Only added because the MCP poll loop (server/index.ts) needs it;
// not provided as a "for completeness" helper.
export async function swallowAsync(
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    process.stderr.write(`[swallow:${label}] ${formatError(e)}\n`);
  }
}
