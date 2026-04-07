import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { URL } from 'node:url';
import { WebSocket } from 'ws';
import { initDatabase } from '../../src/broker/database.js';
import { handleEventsUpgrade } from '../../src/broker/websocket.js';
import {
  parseBody,
  handleHealth,
  handleRegister,
  handleUnregister,
  handleSendMessage,
  handlePollMessages,
  handleSharedSet,
  handleCreateThread,
  handleUpdateThread,
} from '../../src/broker/handlers.js';

// ── Test server with WebSocket support ────────────────────────

type PostHandler = (body: unknown, res: ServerResponse) => void;

const POST_ROUTES: Record<string, PostHandler> = {
  '/register': handleRegister,
  '/unregister': handleUnregister,
  '/send-message': handleSendMessage,
  '/poll-messages': handlePollMessages,
  '/shared/set': handleSharedSet,
  '/threads/create': handleCreateThread,
  '/threads/update': handleUpdateThread,
};

let server: Server;
let baseUrl: string;
let wsUrl: string;

function post<T>(path: string, body: unknown): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, baseUrl);
    import('node:http').then(http => {
      const r = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()) as T });
        });
      });
      r.on('error', reject);
      r.write(payload);
      r.end();
    });
  });
}

function connectWs(projectId?: string): Promise<{ ws: WebSocket; events: Array<{ event: string; data: unknown }>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const url = projectId ? `${wsUrl}?project_id=${projectId}` : wsUrl;
    const ws = new WebSocket(url);
    const events: Array<{ event: string; data: unknown }> = [];

    ws.on('open', () => {
      resolve({ ws, events, close: () => ws.close() });
    });
    ws.on('message', (raw) => {
      const parsed = JSON.parse(raw.toString());
      events.push(parsed);
    });
    ws.on('error', reject);
  });
}

function waitMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

beforeAll(async () => {
  initDatabase(':memory:');

  server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url === '/health') return handleHealth(res);
    if (req.method === 'POST') {
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

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/ws') {
      const projectId = url.searchParams.get('project_id');
      handleEventsUpgrade(req, socket, head, projectId);
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── Tests ─────────────────────────────────────────────────────

describe('websocket events', () => {
  it('connects successfully', async () => {
    const { ws, close } = await connectWs();
    try {
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      close();
    }
  });

  it('receives peer:connected on register', async () => {
    const { events, close } = await connectWs('ws-peer');
    try {
      await post('/register', {
        project_id: 'ws-peer',
        pid: 9001,
        cwd: '/tmp/ws-peer',
        role: 'backend',
      });

      await waitMs(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const peerEvent = events.find(e => e.event === 'peer:connected');
      expect(peerEvent).toBeDefined();
      const data = peerEvent!.data as { id: string; role: string; project_id: string };
      expect(data.role).toBe('backend');
      expect(data.project_id).toBe('ws-peer');
      expect(data.id).toBeDefined();
    } finally {
      close();
    }
  });

  it('receives message:new on send-message', async () => {
    // Register two peers first
    const { data: p1 } = await post<{ id: string }>('/register', {
      project_id: 'ws-msg',
      pid: 9010,
      cwd: '/tmp/ws-msg-1',
      role: 'backend',
    });
    const { data: p2 } = await post<{ id: string }>('/register', {
      project_id: 'ws-msg',
      pid: 9011,
      cwd: '/tmp/ws-msg-2',
      role: 'frontend',
    });

    const { events, close } = await connectWs('ws-msg');
    try {
      await post('/send-message', {
        project_id: 'ws-msg',
        from_id: p1.id,
        to_id: p2.id,
        text: 'Hello from backend',
      });

      await waitMs(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const msgEvent = events.find(e => e.event === 'message:new');
      expect(msgEvent).toBeDefined();
      const data = msgEvent!.data as { from_role: string; text: string };
      expect(data.from_role).toBe('backend');
      expect(data.text).toBe('Hello from backend');
    } finally {
      close();
    }
  });

  it('receives shared:updated on set', async () => {
    // Need a peer for peer_id
    const { data: peer } = await post<{ id: string }>('/register', {
      project_id: 'ws-shared',
      pid: 9020,
      cwd: '/tmp/ws-shared',
      role: 'backend',
    });

    const { events, close } = await connectWs('ws-shared');
    try {
      await post('/shared/set', {
        project_id: 'ws-shared',
        namespace: 'config',
        key: 'api-url',
        value: 'http://localhost:3000',
        peer_id: peer.id,
      });

      await waitMs(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const sharedEvent = events.find(e => e.event === 'shared:updated');
      expect(sharedEvent).toBeDefined();
      const data = sharedEvent!.data as { namespace: string; key: string };
      expect(data.namespace).toBe('config');
      expect(data.key).toBe('api-url');
    } finally {
      close();
    }
  });

  it('receives thread:created on create', async () => {
    const { events, close } = await connectWs('ws-thread');
    try {
      await post('/threads/create', {
        project_id: 'ws-thread',
        created_by: 'test-agent',
        name: 'API Design Discussion',
      });

      await waitMs(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const threadEvent = events.find(e => e.event === 'thread:created');
      expect(threadEvent).toBeDefined();
      const data = threadEvent!.data as { name: string; project_id: string };
      expect(data.name).toBe('API Design Discussion');
      expect(data.project_id).toBe('ws-thread');
    } finally {
      close();
    }
  });

  it('receives peer:disconnected on unregister', async () => {
    const { data: peer } = await post<{ id: string }>('/register', {
      project_id: 'ws-unreg',
      pid: 9030,
      cwd: '/tmp/ws-unreg',
      role: 'backend',
    });

    const { events, close } = await connectWs('ws-unreg');
    try {
      await post('/unregister', { id: peer.id });

      await waitMs(100);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const disconnectEvent = events.find(e => e.event === 'peer:disconnected');
      expect(disconnectEvent).toBeDefined();
      const data = disconnectEvent!.data as { id: string };
      expect(data.id).toBe(peer.id);
    } finally {
      close();
    }
  });

  it('project isolation: ws with different project_id does NOT receive events', async () => {
    const { events, close } = await connectWs('ws-iso-A');
    try {
      await post('/register', {
        project_id: 'ws-iso-B',
        pid: 9040,
        cwd: '/tmp/ws-iso-B',
        role: 'backend',
      });

      await waitMs(100);

      expect(events).toHaveLength(0);
    } finally {
      close();
    }
  });
});
