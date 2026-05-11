// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE A v0.3.3 — Token observability via Claude session JSONL tail.
//
// The MCP SDK exposes no usage tokens to McpServer (verified during
// v0.3.2 FASE B feasibility + v0.3.3 A-1 re-check). The Claude CLI
// itself writes per-session JSONL at
//   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
// where each `type: "assistant"` line carries `message.usage.{input_tokens,
// output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`
// and `message.model`.
//
// This module tails those files and inserts one row per assistant turn
// into the `token_usage` table. Idempotent on `turn_uuid` (the per-line
// `message.uuid`), so a re-tail after broker restart is safe — duplicates
// are silently skipped at the DB layer.
//
// Design:
//   - `attachPeer(peer)` is called when handleRegister inserts a non-
//     dashboard peer. We resolve the peer's claude-session directory
//     and (1) backfill existing files, (2) start watching for new ones.
//   - `detachPeer(peerId)` is called when handleProjectDown deletes
//     the peer or cleanStalePeers evicts it. We stop the watcher so
//     the broker exits cleanly.
//   - Bookmarks are kept in memory: a Map<filePath, lastByte>. Crash
//     recovery uses the UNIQUE(turn_uuid) DB constraint — on next
//     boot, the watcher re-reads from byte 0 and dedups via INSERT
//     OR IGNORE.

import { existsSync, readFileSync, statSync, watch as fsWatch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { insertTokenUsage } from './database.js';
import type { Peer } from '../shared/types.js';

// Claude CLI encodes the cwd into a directory name by replacing every
// path separator with `-`. Verified against actual on-disk dirs:
//   /private/tmp/acc-deep-X/techlead/deep
//     → -private-tmp-acc-deep-X-techlead-deep
// Other punctuation (dots, hyphens, underscores) stays as-is.
export function encodeClaudeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

export function claudeSessionsDirFor(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeClaudeCwd(cwd));
}

interface PeerWatch {
  peerId: string;
  projectId: string;
  role: string;
  cwd: string;
  sessionsDir: string;
  watcher: FSWatcher | null;
  bookmarks: Map<string, number>; // filename → next byte offset to read
}

const watches = new Map<string, PeerWatch>();

interface JsonlAssistantLine {
  type?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

function parseAndInsert(filePath: string, peer: PeerWatch, contents: string): number {
  let inserted = 0;
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let entry: JsonlAssistantLine;
    try {
      entry = JSON.parse(line) as JsonlAssistantLine;
    } catch {
      continue; // malformed line — skip silently
    }
    if (entry.type !== 'assistant') continue;
    const usage = entry.message?.usage;
    if (!usage) continue;
    const result = insertTokenUsage({
      project_id: peer.projectId,
      peer_id: peer.peerId,
      role: peer.role,
      model: entry.message?.model ?? '',
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0,
      turn_uuid: entry.uuid ?? null,
      session_uuid: entry.sessionId ?? null,
      created_at: entry.timestamp ?? new Date().toISOString(),
    });
    if (result.inserted) inserted++;
  }
  return inserted;
}

function readNewBytes(filePath: string, peer: PeerWatch): void {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    return; // file disappeared between watch event and read
  }
  const bookmark = peer.bookmarks.get(filePath) ?? 0;
  if (stat.size <= bookmark) return; // no new bytes
  let chunk: string;
  try {
    // Read only the new tail. better-sqlite3 throws on huge buffers but
    // JSONL turn lines are typically <10 KB each; whole appends are <1 MB.
    const buf = readFileSync(filePath);
    chunk = buf.slice(bookmark).toString('utf-8');
  } catch (e) {
    console.error(`[token-tail] read failed for ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  // JSONL appends complete lines, but a partial last line is possible
  // if the writer is mid-flush. Trim back to the last newline so we
  // don't parse a truncated entry and miss it on the next pass.
  const lastNl = chunk.lastIndexOf('\n');
  if (lastNl < 0) return; // no complete line yet
  const completed = chunk.slice(0, lastNl + 1);
  const consumed = Buffer.byteLength(completed, 'utf-8');
  parseAndInsert(filePath, peer, completed);
  peer.bookmarks.set(filePath, bookmark + consumed);
}

async function backfillAndWatch(peer: PeerWatch): Promise<void> {
  if (!existsSync(peer.sessionsDir)) {
    // Directory not created yet — claude makes it on first session
    // write. Schedule a one-shot retry; the watcher attaches once the
    // directory appears.
    setTimeout(() => { void backfillAndWatch(peer); }, 2000);
    return;
  }
  // Initial backfill: read everything currently in the directory.
  try {
    const files = await readdir(peer.sessionsDir);
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      readNewBytes(join(peer.sessionsDir, name), peer);
    }
  } catch (e) {
    console.error(`[token-tail] backfill failed for ${peer.sessionsDir}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Live watch — fs.watch fires `change` on append, `rename` on
  // create/delete. We rescan the directory on either kind because
  // claude can create a fresh .jsonl partway through a session
  // (e.g. when `acc up` runs after `acc down`).
  try {
    peer.watcher = fsWatch(peer.sessionsDir, { persistent: false }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;
      readNewBytes(join(peer.sessionsDir, filename), peer);
    });
  } catch (e) {
    console.error(`[token-tail] watch failed for ${peer.sessionsDir}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function attachPeer(peer: Peer): void {
  // Skip dashboard peers and any peer without a usable cwd.
  if (peer.agent_type === 'dashboard') return;
  if (!peer.cwd) return;
  // Idempotent — calling attachPeer twice for the same peer is a no-op.
  if (watches.has(peer.id)) return;

  const watch: PeerWatch = {
    peerId: peer.id,
    projectId: peer.project_id,
    role: peer.role || '',
    cwd: peer.cwd,
    sessionsDir: claudeSessionsDirFor(peer.cwd),
    watcher: null,
    bookmarks: new Map(),
  };
  watches.set(peer.id, watch);
  void backfillAndWatch(watch);
}

export function detachPeer(peerId: string): void {
  const watch = watches.get(peerId);
  if (!watch) return;
  if (watch.watcher) {
    try { watch.watcher.close(); } catch { /* ignore */ }
  }
  watches.delete(peerId);
}

// Test-only — drops every active watcher and bookmark.
export function _resetTokenTailForTests(): void {
  for (const w of watches.values()) {
    if (w.watcher) { try { w.watcher.close(); } catch { /* ignore */ } }
  }
  watches.clear();
}

// Test-only — synchronous backfill against a known directory. Skips
// the fs.watch hookup so the test process exits cleanly.
export function _processFileForTests(peer: Peer, filePath: string): number {
  if (peer.agent_type === 'dashboard') return 0;
  const watch: PeerWatch = {
    peerId: peer.id,
    projectId: peer.project_id,
    role: peer.role || '',
    cwd: peer.cwd,
    sessionsDir: claudeSessionsDirFor(peer.cwd),
    watcher: null,
    bookmarks: new Map(),
  };
  const before = watch.bookmarks.get(filePath) ?? 0;
  readNewBytes(filePath, watch);
  const after = watch.bookmarks.get(filePath) ?? 0;
  return after - before;
}
