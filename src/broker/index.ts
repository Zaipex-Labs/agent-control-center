// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACC_HOST, ACC_PORT, CLEANUP_INTERVAL_MS } from '../shared/config.js';
import { t, getLang } from '../shared/i18n/index.js';
import { initDatabase, closeDatabase } from './database.js';
import { gcOrphanBlobs } from './blob-gc.js';
import { cleanStalePeers } from './cleanup.js';
import { URL } from 'node:url';
import { handleEventsUpgrade, closeAllEventsClients } from './websocket.js';
import { handleTerminalUpgrade, killAllWebAgentsEverywhere, closeAllTerminalClients } from './terminal.js';
import { isAllowedHost, isAllowedOrigin, isJsonContentType } from './origin.js';
import { startTokenCleanup, stopTokenCleanup } from './csrf-tokens.js';
import {
  parseBody,
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
  handleCreateThread,
  handleListThreads,
  handleGetThread,
  handleUpdateThread,
  handleSearchThreads,
  handleThreadSummary,
  handleListProjects,
  handleBrowse,
  handleCreateProject,
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
  '/api/threads/create': handleCreateThread,
  '/api/threads/list': handleListThreads,
  '/api/threads/get': handleGetThread,
  '/api/threads/update': handleUpdateThread,
  '/api/threads/search': handleSearchThreads,
  '/api/threads/summary': handleThreadSummary,
  '/api/project/create': handleCreateProject,
  '/api/project/add-agent': handleAddAgent,
  '/api/project/update': handleUpdateProject,
  '/api/project/delete': handleDeleteProject,
  '/api/project/up': handleProjectUp,
  '/api/project/down': handleProjectDown,
  '/api/project/save-resume': handleSaveResume,
  '/api/project/modified-files': handleListModifiedFiles,
  '/api/threads/delete': handleDeleteThread,
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
      return handleListProjects(res);
    }

    if (method === 'GET' && url === '/api/lang') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lang: getLang() }));
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
        try {
          const body = await parseBody(req);
          await handler(body, res);
          return;
        } catch {
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
      const safePath = pathOnly.replace(/\.\./g, '');
      const filePath = safePath === '/' ? '/index.html' : safePath;
      const fullPath = join(DASHBOARD_DIR, filePath);

      try {
        const content = await readFile(fullPath);
        const ext = extname(filePath);
        const headers: Record<string, string> = {
          'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
        };
        // Vite hashed assets get long cache
        if (safePath.startsWith('/assets/')) {
          headers['Cache-Control'] = 'public, max-age=31536000, immutable';
        }
        res.writeHead(200, headers);
        res.end(content);
        return;
      } catch {
        // File not found — SPA fallback to index.html
        try {
          const indexContent = await readFile(join(DASHBOARD_DIR, 'index.html'));
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(indexContent);
          return;
        } catch {
          // Dashboard not built yet
        }
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

export function installLifecycleHandlers(server: Server): void {
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
