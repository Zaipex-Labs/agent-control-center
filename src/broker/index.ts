import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { ACC_HOST, ACC_PORT, CLEANUP_INTERVAL_MS } from '../shared/config.js';
import { initDatabase } from './database.js';
import { cleanStalePeers } from './cleanup.js';
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
};

export function createBrokerServer(): Server {
  initDatabase();

  // Clean dead peers on startup
  const removed = cleanStalePeers();
  if (removed > 0) {
    console.error(`[broker] Cleaned ${removed} stale peer(s) on startup`);
  }

  // Periodic cleanup
  const cleanupInterval = setInterval(() => {
    const n = cleanStalePeers();
    if (n > 0) {
      console.error(`[broker] Cleaned ${n} stale peer(s)`);
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

  return server;
}

export function main(): void {
  const server = createBrokerServer();

  server.listen(ACC_PORT, ACC_HOST, () => {
    console.error(`[broker] Listening on http://${ACC_HOST}:${ACC_PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[broker] Port ${ACC_PORT} already in use — another broker may be running`);
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
