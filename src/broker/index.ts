import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { ACC_HOST, ACC_PORT, CLEANUP_INTERVAL_MS } from '../shared/config.js';
import { t } from '../shared/i18n/index.js';
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
} from './handlers.js';

type PostHandler = (body: unknown, res: ServerResponse) => void;

const POST_ROUTES: Record<string, PostHandler> = {
  '/register': handleRegister,
  '/heartbeat': handleHeartbeat,
  '/unregister': handleUnregister,
  '/set-summary': handleSetSummary,
  '/set-role': handleSetRole,
  '/list-peers': handleListPeers,
  '/send-message': handleSendMessage,
  '/send-to-role': handleSendToRole,
  '/poll-messages': handlePollMessages,
  '/get-history': handleGetHistory,
  '/shared/set': handleSharedSet,
  '/shared/get': handleSharedGet,
  '/shared/list': handleSharedList,
  '/shared/delete': handleSharedDelete,
  '/threads/create': handleCreateThread,
  '/threads/list': handleListThreads,
  '/threads/get': handleGetThread,
  '/threads/update': handleUpdateThread,
  '/threads/search': handleSearchThreads,
  '/threads/summary': handleThreadSummary,
};

export function createBrokerServer(): Server {
  initDatabase();

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

    if (method === 'POST') {
      const handler = POST_ROUTES[url];
      if (handler) {
        try {
          const body = await parseBody(req);
          return handler(body, res);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
          return;
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
