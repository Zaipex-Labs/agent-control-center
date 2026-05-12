// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { join, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACC_HOST, ACC_PORT, CLEANUP_INTERVAL_MS } from '../shared/config.js';
import { t, getLang } from '../shared/i18n/index.js';
import { initDatabase, closeDatabase } from './database.js';
import { gcOrphanBlobs } from './blob-gc.js';
import { cleanStalePeers } from './cleanup.js';
import { URL } from 'node:url';
import { handleEventsUpgrade, closeAllEventsClients } from './websocket.js';
import { handleTerminalUpgrade, killAllWebAgentsEverywhere, closeAllTerminalClients } from './terminal.js';
import { getSpawnState } from './spawn-state.js';
import { isAllowedHost, isAllowedOrigin, isJsonContentType } from './origin.js';
import { startTokenCleanup, stopTokenCleanup } from './csrf-tokens.js';
import {
  parseBody,
  BodyTooLargeError,
  DEFAULT_MAX_BODY_SIZE,
  handleHealth,
  handleRegister,
  handleHeartbeat,
  handleUnregister,
  handleSetSummary,
  handleSetRole,
  handleCsrfIssue,
  handleListPeers,
  handleSendMessage,
  handleSendToRole,
  handlePollMessages,
  handleGetHistory,
  handleSharedSet,
  handleSharedGet,
  handleSharedList,
  handleSharedDelete,
  handleDecisionsRecall,
  handleSkillsList,
  handleSkillsGet,
  handleSkillsSave,
  handleSkillsDelete,
  handleCreateThread,
  handleListThreads,
  handleGetThread,
  handleUpdateThread,
  handleSearchThreads,
  handleThreadSummary,
  handleListProjects,
  handleBrowse,
  handleCreateProject,
  handleCreateDemo,
  handleAddAgent,
  handleUpdateProject,
  handleDeleteProject,
  handleDeleteThread,
  handleProjectUp,
  handleProjectDown,
  handleSaveResume,
  handleListModifiedFiles,
  migrateLegacyProjects,
  handleUploadBlob,
  handleDownloadBlob,
  handleBlobStats,
  handleListPowers,
  handleProjectTokens,
  handleProjectCoordOverhead,
} from './handlers.js';

type PostHandler = (body: unknown, res: ServerResponse) => void | Promise<void>;

const POST_ROUTES: Record<string, PostHandler> = {
  '/api/register': handleRegister,
  '/api/heartbeat': handleHeartbeat,
  '/api/unregister': handleUnregister,
  '/api/set-summary': handleSetSummary,
  '/api/set-role': handleSetRole,
  '/api/csrf/issue': handleCsrfIssue,
  '/api/list-peers': handleListPeers,
  '/api/send-message': handleSendMessage,
  '/api/send-to-role': handleSendToRole,
  '/api/poll-messages': handlePollMessages,
  '/api/get-history': handleGetHistory,
  '/api/shared/set': handleSharedSet,
  '/api/shared/get': handleSharedGet,
  '/api/shared/list': handleSharedList,
  '/api/shared/delete': handleSharedDelete,
  '/api/decisions/recall': handleDecisionsRecall,
  '/api/skills/list': handleSkillsList,
  '/api/skills/get': handleSkillsGet,
  '/api/skills/save': handleSkillsSave,
  '/api/skills/delete': handleSkillsDelete,
  '/api/threads/create': handleCreateThread,
  '/api/threads/list': handleListThreads,
  '/api/threads/get': handleGetThread,
  '/api/threads/update': handleUpdateThread,
  '/api/threads/search': handleSearchThreads,
  '/api/threads/summary': handleThreadSummary,
  '/api/project/create': handleCreateProject,
  '/api/project/create-demo': handleCreateDemo,
  '/api/project/add-agent': handleAddAgent,
  '/api/project/update': handleUpdateProject,
  '/api/project/delete': handleDeleteProject,
  '/api/project/up': handleProjectUp,
  '/api/project/down': handleProjectDown,
  '/api/project/save-resume': handleSaveResume,
  '/api/project/modified-files': handleListModifiedFiles,
  '/api/threads/delete': handleDeleteThread,
};

// [P-11] Per-route body caps. The previous global 1 MB ceiling was
// 1000× larger than what /api/heartbeat or /api/poll-messages need
// (their bodies are tiny JSON objects), making the broker more open
// than necessary to slow-loris / large-body DoS. Routes that need
// more (shared/set, send-message with attachments) keep the 1 MB
// default. Anything not in this map uses DEFAULT_MAX_BODY_SIZE.
const ROUTE_BODY_LIMITS: Record<string, number> = {
  '/api/heartbeat': 1024,                  // ~24 bytes in practice
  '/api/poll-messages': 4 * 1024,           // peer id + small filters
  '/api/unregister': 1024,
  '/api/set-summary': 16 * 1024,            // user-typed text, capped soft
  '/api/set-role': 1024,
  '/api/csrf/issue': 1024,
  '/api/list-peers': 1024,
  '/api/decisions/recall': 4 * 1024,        // ids + short query + limit
  '/api/skills/list': 1024,
  '/api/skills/get': 1024,
  '/api/skills/save': 16 * 1024,            // 8KB content + JSON envelope
  '/api/skills/delete': 1024,
};

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Resolve project root: this file is at src/broker/index.ts or dist/broker/index.js
const __brokerDir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__brokerDir, '..', '..');
const DASHBOARD_DIR = join(PROJECT_ROOT, 'dist', 'dashboard');

export function createBrokerServer(): Server {
  initDatabase();
  console.error(`[broker] dashboard dir: ${DASHBOARD_DIR}`);

  // Migrate legacy projects: inject the tech lead into old configs and
  // wipe any DB rows whose project was deleted without the new cleanup.
  migrateLegacyProjects();

  // Clean dead peers on startup
  const removed = cleanStalePeers();
  if (removed > 0) {
    console.error(`[broker] ${t('broker.cleanedStartup', { count: String(removed) })}`);
  }

  // GC blob files whose only refs were in now-deleted projects. Respects
  // a 1h grace period so a blob uploaded right before a crash survives.
  const orphanBlobs = gcOrphanBlobs();
  if (orphanBlobs > 0) {
    console.error(`[broker] GC removed ${orphanBlobs} orphan blobs`);
  }

  // Periodic cleanup
  const cleanupInterval = setInterval(() => {
    const n = cleanStalePeers();
    if (n > 0) {
      console.error(`[broker] ${t('broker.cleaned', { count: String(n) })}`);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupInterval.unref();

  // CSRF token cleanup [F-3]: purge expired one-shot tokens issued for
  // /ws/terminal upgrades. Idempotent — safe to call repeatedly.
  startTokenCleanup();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CSRF + DNS-rebinding gate (S-NEW-1). Reject anything whose Host
    // header is not a localhost name (covers DNS rebinding) and any
    // state-changing request whose Origin is not localhost (covers
    // cross-origin POSTs from a malicious page). Origin missing is
    // tolerated only when the connection comes from loopback — that's
    // how non-browser clients (curl, MCP server, CLI, tests) talk to
    // us.
    if (!isAllowedHost(req)) {
      console.error(`[broker:csrf] reject host=${JSON.stringify(req.headers.host)} url=${url}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden host' }));
      return;
    }
    const isStateChanging = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    if (isStateChanging && !isAllowedOrigin(req)) {
      console.error(`[broker:csrf] reject origin=${JSON.stringify(req.headers.origin)} method=${method} url=${url}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Forbidden origin' }));
      return;
    }

    if (method === 'GET' && url === '/health') {
      return handleHealth(res);
    }

    if (method === 'GET' && url === '/api/projects') {
      // [P-2] now async; await so any thrown error is caught here
      // rather than becoming an unhandled rejection.
      await handleListProjects(res);
      return;
    }

    if (method === 'GET' && url === '/api/lang') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lang: getLang() }));
      return;
    }

    // FASE A-3 (v0.3.2). Stateless registry projection — no auth, no
    // body, no project context. Returns {powers: Power[]}.
    if (method === 'GET' && url === '/api/powers') {
      return handleListPowers(res);
    }

    // v0.3.3 PRE-4 (MED-7a). Snapshot of the per-(project, role) spawn
    // phase state held in broker memory. The dashboard fetches this once
    // on mount to recover from the WS-handshake race where pty_ready
    // (sometimes mcp_ready) fires before the client's socket is OPEN.
    const spawnStateMatch = url.match(/^\/api\/project\/([^/?]+)\/spawn-state$/);
    if (method === 'GET' && spawnStateMatch) {
      const projectId = decodeURIComponent(spawnStateMatch[1]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ phases: getSpawnState(projectId) }));
      return;
    }

    // FASE A v0.3.3 — token usage aggregate for a project, bucketed
    // by agent / hour / top-5 turn. Period is `today | week | month`,
    // default `today`. Source rows are populated by the JSONL tailer.
    const tokensMatch = url.match(/^\/api\/projects\/([^/?]+)\/tokens(?:\?(.+))?$/);
    if (method === 'GET' && tokensMatch) {
      const projectId = decodeURIComponent(tokensMatch[1]);
      const query = new URLSearchParams(tokensMatch[2] ?? '');
      handleProjectTokens(projectId, query.get('period'), res);
      return;
    }

    // FU-AH v0.3.4 — coord-overhead readout (coord_events / total_turns
    // ratio plus per-(from,to) breakdown). Read-only; analysis &
    // tuning live in v0.3.5 once data accumulates.
    const coordMatch = url.match(/^\/api\/projects\/([^/?]+)\/coord-overhead(?:\?(.+))?$/);
    if (method === 'GET' && coordMatch) {
      const projectId = decodeURIComponent(coordMatch[1]);
      const query = new URLSearchParams(coordMatch[2] ?? '');
      handleProjectCoordOverhead(projectId, query.get('period'), res);
      return;
    }

    if (method === 'GET' && url.startsWith('/api/browse')) {
      const query = url.includes('?') ? url.split('?')[1] : '';
      return handleBrowse(query, res);
    }

    // Blob upload/download — must be handled BEFORE the JSON POST router
    // because the upload body is binary (octet-stream), not JSON.
    if (method === 'POST' && url === '/api/blobs/upload') {
      return handleUploadBlob(req, res);
    }
    if (method === 'GET' && url === '/api/blobs/_stats') {
      return handleBlobStats(res);
    }
    const blobMatch = url.match(/^\/api\/blobs\/([a-f0-9]{64})$/);
    if (method === 'GET' && blobMatch) {
      return handleDownloadBlob(req, blobMatch[1], res);
    }

    if (method === 'POST') {
      const handler = POST_ROUTES[url];
      if (handler) {
        // Reject non-JSON Content-Type. parseBody assumes JSON, and
        // accepting text/plain / form-urlencoded would let a cross-
        // origin <script> emit "simple requests" without preflight
        // (S-NEW-1).
        if (!isJsonContentType(req)) {
          res.writeHead(415, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Content-Type must be application/json' }));
          return;
        }
        // [P-11] per-route body cap; default for routes not in the
        // map is the global 1 MB.
        const bodyLimit = ROUTE_BODY_LIMITS[url] ?? DEFAULT_MAX_BODY_SIZE;
        try {
          const body = await parseBody(req, bodyLimit);
          await handler(body, res);
          return;
        } catch (e) {
          if (e instanceof BodyTooLargeError) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: false,
              error: e.message,
              code: 'BODY_TOO_LARGE',
              limit: e.limit,
            }));
            return;
          }
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
          return;
        }
      }
    }

    // [UX-4] Anything under /api/* must never reach the SPA fallback.
    // The previous code returned the dashboard's index.html with 200
    // for unknown API paths (e.g. GET /api/blobs/<bad-hash>), which
    // makes monitoring tools and CLI clients see HTML when they
    // expected a structured 4xx. Catch /api/* here with a typed JSON
    // 404 before any static-file or SPA-fallback logic runs.
    const pathOnly = url.split('?')[0];
    if (pathOnly.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Not found', code: 'NOT_FOUND' }));
      return;
    }

    // Static file serving for dashboard (SPA fallback)
    if (method === 'GET') {
      // [S-NEW-5 / L-7] resolve the requested path and require it to
      // live under DASHBOARD_DIR after symlinks resolve. The previous
      // `safePath.replace(/\.\./g, '')` left `....//` intact (`....//`
      // → `..//`) and didn't catch symlinks at all.
      const filePath = pathOnly === '/' ? '/index.html' : pathOnly;
      const fullPath = join(DASHBOARD_DIR, filePath);
      const dashboardBase = await realpath(DASHBOARD_DIR).catch(() => DASHBOARD_DIR);
      let resolved: string | null = null;
      try {
        resolved = await realpath(fullPath);
      } catch {
        // Fall through — handled by the SPA fallback below.
      }
      const insideDashboard =
        resolved !== null &&
        (resolved === dashboardBase || resolved.startsWith(dashboardBase + sep));

      if (insideDashboard) {
        try {
          const content = await readFile(resolved!);
          const ext = extname(filePath);
          const headers: Record<string, string> = {
            'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
          };
          // Vite hashed assets get long cache
          if (pathOnly.startsWith('/assets/')) {
            headers['Cache-Control'] = 'public, max-age=31536000, immutable';
          }
          res.writeHead(200, headers);
          res.end(content);
          return;
        } catch {
          // Fall through to SPA fallback.
        }
      }

      // SPA fallback — index.html. Always served from inside DASHBOARD_DIR
      // (no traversal possible) so it doesn't need the realpath dance.
      try {
        const indexContent = await readFile(join(DASHBOARD_DIR, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexContent);
        return;
      } catch {
        // Dashboard not built yet
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });

  // WebSocket upgrade dispatch — route by path
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/ws') {
      const projectId = url.searchParams.get('project_id');
      handleEventsUpgrade(req, socket, head, projectId);
      return;
    }

    const termMatch = url.pathname.match(/^\/ws\/terminal\/([a-zA-Z0-9_.\-]+)$/);
    if (termMatch) {
      const role = termMatch[1];
      const projectId = url.searchParams.get('project');
      if (!projectId) {
        socket.destroy();
        return;
      }
      handleTerminalUpgrade(req, socket, head, role, projectId);
      return;
    }

    socket.destroy();
  });

  return server;
}

// Graceful shutdown for the broker process [QW-5]. Without these
// handlers a SIGTERM (launchd reload, `pkill node`, container stop)
// or any throw in an async handler crashes the broker, leaving the
// PTY children of spawnWebAgent orphaned, the WAL un-checkpointed,
// and dashboard WS clients with a dangling TCP connection.
//
// Close order matters and is asserted by tests/broker/lifecycle.test.ts:
//   1. Terminal WS clients (/ws/terminal/<role>): close FIRST so any
//      pending stdin write can't reach a dying agent and dashboard
//      viewers see a clean 1001 instead of agent stdout going dark
//      before the WS notifies them.
//   2. Web agent processes: kill once nobody can write stdin to them.
//   3. Events WS clients (/ws): close after the agent layer is gone
//      so the dashboard's last event is the one that says "broker
//      shutting down", not a garbled half-state.
//   4. HTTP server: drain remaining connections.
//   5. SQLite database: close LAST with a wal_checkpoint(TRUNCATE)
//      so on-disk state is consistent.
let shutdownRunning = false;
// Test-only hook so the order test can clear the idempotency latch
// between cases. Not exported from `main()`'s import path.
export function _resetShutdownLatchForTests(): void { shutdownRunning = false; }
export function shutdownBroker(server: Server, label: string): Promise<void> {
  if (shutdownRunning) return Promise.resolve();
  shutdownRunning = true;
  console.error(`[broker:lifecycle] ${label} — terminals → agents → events → http → db`);
  return new Promise<void>((resolve) => {
    try { stopTokenCleanup(); } catch (e) { console.error('[broker:lifecycle] stopTokenCleanup', e); }
    try {
      const closedTerm = closeAllTerminalClients();
      if (closedTerm > 0) console.error(`[broker:lifecycle] closed ${closedTerm} terminal WS client(s)`);
    } catch (e) { console.error('[broker:lifecycle] closeAllTerminalClients', e); }
    try {
      const killed = killAllWebAgentsEverywhere();
      if (killed > 0) console.error(`[broker:lifecycle] killed ${killed} web agent(s)`);
    } catch (e) { console.error('[broker:lifecycle] killAllWebAgentsEverywhere', e); }
    try { closeAllEventsClients(); } catch (e) { console.error('[broker:lifecycle] closeAllEventsClients', e); }
    server.close(() => {
      try { closeDatabase(); } catch (e) { console.error('[broker:lifecycle] closeDatabase', e); }
      console.error('[broker:lifecycle] shutdown complete');
      resolve();
    });
    // Hard cap: if server.close hangs (lingering keep-alive sockets,
    // half-open WS) force-resolve after 5s so the parent (launchd /
    // shell) gets the exit and doesn't sit in "stopping" forever.
    setTimeout(() => {
      try { closeDatabase(); } catch { /* ignore */ }
      resolve();
    }, 5000).unref();
  });
}

// [F-4 v0.2.3 / FU-5 v0.2.4] Track which servers already had handlers
// installed so a second installLifecycleHandlers(server) call is a
// no-op. Without this, accumulating signal listeners on hot reload
// would (a) trip Node's MaxListenersExceededWarning after ~10 reloads
// and (b) run the lifecycle path N times in parallel on a single
// SIGTERM. The WeakSet means servers don't keep themselves alive past
// their natural GC.
const lifecycleInstalledFor = new WeakSet<Server>();
// Test-only hook so the idempotency-suite can verify "second call is a
// no-op" without holding the WeakSet entry across cases.
export function _resetLifecycleHandlersForTests(server: Server): void {
  lifecycleInstalledFor.delete(server);
}

export function installLifecycleHandlers(server: Server): void {
  if (lifecycleInstalledFor.has(server)) return;
  lifecycleInstalledFor.add(server);

  const onSignal = (sig: NodeJS.Signals): void => {
    void shutdownBroker(server, `received ${sig}`).then(() => process.exit(0));
  };
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  process.on('uncaughtException', (err) => {
    console.error('[broker:lifecycle] uncaughtException', err);
    void shutdownBroker(server, 'uncaughtException').then(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[broker:lifecycle] unhandledRejection', reason);
    void shutdownBroker(server, 'unhandledRejection').then(() => process.exit(1));
  });
}

export function main(): void {
  const server = createBrokerServer();

  server.listen(ACC_PORT, ACC_HOST, () => {
    console.error(`[broker] ${t('broker.listening', { host: ACC_HOST, port: String(ACC_PORT) })}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[broker] ${t('broker.portInUse', { port: String(ACC_PORT) })}`);
      process.exit(1);
    }
    throw err;
  });

  installLifecycleHandlers(server);
}

// Run directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/broker/index.ts') ||
  process.argv[1].endsWith('/broker/index.js')
);

if (isDirectRun) {
  main();
}
