// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// One-shot CSRF tokens for the /ws/terminal/<role> upgrade [F-3].
//
// Closes the residual S-NEW-2 caveat: the Origin gate alone still admits
// a malicious dev server on http://127.0.0.1:8080 (different port, same
// machine) because its Origin matches the localhost regex. The dashboard
// must now (a) request a token from POST /api/csrf/issue with a
// registered peer_id whose project matches body.project_id, and (b) carry
// it via Sec-WebSocket-Protocol when opening the WS. The broker consumes
// the token in handleTerminalUpgrade BEFORE wss.handleUpgrade, so a
// cross-port attacker who can't read the dashboard's localStorage
// (different origin, different storage) has no peer_id to obtain a
// token with.
//
// Defense-in-depth: token + Origin gate are AND, not OR. Both must pass.

import { randomBytes } from 'node:crypto';

interface TokenEntry {
  project_id: string;
  role: string;
  expires_at: number; // ms epoch
}

const TOKEN_TTL_MS = 60_000; // 60 seconds — a token must be used the moment it's issued
const CLEANUP_INTERVAL_MS = 30_000; // purge expired entries every 30s

const tokens = new Map<string, TokenEntry>();
let cleanupTimer: NodeJS.Timeout | null = null;

export function issueToken(project_id: string, role: string): string {
  const token = randomBytes(32).toString('hex'); // 64 hex chars / 256 bits
  tokens.set(token, {
    project_id,
    role,
    expires_at: Date.now() + TOKEN_TTL_MS,
  });
  return token;
}

// Look up, validate, and CONSUME (delete) a token. Returns the bound
// {project_id, role} on success, null on miss / expired / mismatch.
// The caller is responsible for matching project_id+role against the
// upgrade request — consumeToken returns the binding so the caller can
// reject "valid token, wrong target".
export function consumeToken(token: string | undefined | null): TokenEntry | null {
  if (!token || typeof token !== 'string') return null;
  const entry = tokens.get(token);
  if (!entry) return null;
  // One-shot regardless of whether the binding matches: an attacker
  // who steals a real token can only use it once, and a mismatched
  // target burns the token (denial-of-service is acceptable here —
  // the dashboard just requests a fresh one).
  tokens.delete(token);
  if (entry.expires_at < Date.now()) return null;
  return entry;
}

export function purgeExpired(now: number = Date.now()): number {
  let removed = 0;
  for (const [token, entry] of tokens) {
    if (entry.expires_at < now) {
      tokens.delete(token);
      removed++;
    }
  }
  return removed;
}

export function startTokenCleanup(): void {
  if (cleanupTimer) return; // idempotent
  cleanupTimer = setInterval(() => {
    purgeExpired();
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

export function stopTokenCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Test-only helpers. Do not call from production code.
export function _resetTokensForTests(): void {
  tokens.clear();
  stopTokenCleanup();
}

export function _peekTokenForTests(token: string): TokenEntry | undefined {
  return tokens.get(token);
}

export function _tokenCountForTests(): number {
  return tokens.size;
}
