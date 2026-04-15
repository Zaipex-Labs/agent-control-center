import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACC_HOST, ACC_PORT, CLEANUP_INTERVAL_MS } from '../shared/config.js';
import { t, getLang } from '../shared/i18n/index.js';
import { initDatabase } from './database.js';
import { cleanStalePeers } from './cleanup.js';
import { URL } from 'node:url';
import { handleEventsUpgrade } from './websocket.js';
import { handleTerminalUpgrade } from './terminal.js';
import {
  parseBody,
  handleHealth,
  handleRegister,
  handleHeartbeat,
  handleUnregister,
  handleSetSummary,
  handleSetRole,
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
} from './handlers.js';

type PostHandler = (body: unknown, res: ServerResponse) => void | Promise<void>;

const POST_ROUTES: Record<string, PostHandler> = {
  '/api/register': handleRegister,
  '/api/heartbeat': handleHeartbeat,
  '/api/unregister': handleUnregister,
  '/api/set-summary': handleSetSummary,
  '/api/set-role': handleSetRole,
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

  // Periodic cleanup
  const cleanupInterval = setInterval(() => {
    const n = cleanStalePeers();
    if (n > 0) {
      console.error(`[broker] ${t('broker.cleaned', { count: String(n) })}`);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupInterval.unref();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

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

    if (method === 'POST') {
      const handler = POST_ROUTES[url];
      if (handler) {
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

    // Static file serving for dashboard (SPA fallback)
    if (method === 'GET') {
      const safePath = url.split('?')[0].replace(/\.\./g, '');
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
}

// Run directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/broker/index.ts') ||
  process.argv[1].endsWith('/broker/index.js')
);

if (isDirectRun) {
  main();
}
