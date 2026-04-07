import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { initDatabase } from '../../src/broker/database.js';
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
} from '../../src/broker/handlers.js';

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

let server: Server;
let baseUrl: string;

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
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── Registration errors ──────────────────────────────────────────

describe('edge cases: registration errors', () => {
  it('register with empty project_id returns 400', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/register', {
      pid: process.pid, cwd: '/tmp/test', role: 'test', project_id: '',
    });
    expect(status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });

  it('register with empty cwd returns 400', async () => {
    const { status } = await post<{ ok: boolean; error: string }>('/register', {
      pid: process.pid, cwd: '', role: 'test', project_id: 'ec-reg-err',
    });
    expect(status).toBe(400);
  });
});

// ── Message errors ───────────────────────────────────────────────

describe('edge cases: message errors', () => {
  it('send message to nonexistent peer returns 404', async () => {
    const reg = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/tmp', role: 'sender', project_id: 'ec-msg-err1',
    });
    const { status, data } = await post<{ ok: boolean; error: string }>('/send-message', {
      project_id: 'ec-msg-err1', from_id: reg.data.id, to_id: 'nonexistent-peer', text: 'hello',
    });
    expect(status).toBe(404);
    expect(data.error).toContain('Peer not found');
  });

  it('send message from nonexistent peer returns 404', async () => {
    const reg = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/tmp', role: 'receiver', project_id: 'ec-msg-err2',
    });
    const { status, data } = await post<{ ok: boolean; error: string }>('/send-message', {
      project_id: 'ec-msg-err2', from_id: 'ghost-sender', to_id: reg.data.id, text: 'hello',
    });
    expect(status).toBe(404);
    expect(data.error).toContain('Peer not found');
  });

  it('send-to-role with no matching peers returns sent_to: 0', async () => {
    const reg = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/tmp', role: 'ops', project_id: 'ec-msg-err3',
    });
    const { status, data } = await post<{ ok: boolean; sent_to: number }>('/send-to-role', {
      project_id: 'ec-msg-err3', from_id: reg.data.id, role: 'nonexistent-role', text: 'anyone?',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.sent_to).toBe(0);
  });

  it('send message with missing text returns 400', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/send-message', {
      project_id: 'ec-msg-err4', from_id: 'a', to_id: 'b',
    });
    expect(status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });
});

// ── Poll edge cases ──────────────────────────────────────────────

describe('edge cases: poll', () => {
  it('poll with valid-format but nonexistent id returns empty messages', async () => {
    const { status, data } = await post<{ messages: unknown[] }>('/poll-messages', {
      id: 'does-not-exist',
    });
    expect(status).toBe(200);
    expect(data.messages).toEqual([]);
  });
});

// ── Thread edge cases ────────────────────────────────────────────

describe('edge cases: threads', () => {
  it('create thread with no name uses default name', async () => {
    const { status, data } = await post<{ id: string; name: string }>('/threads/create', {
      project_id: 'ec-thread1', created_by: 'peer-1',
    });
    expect(status).toBe(200);
    expect(data.name).toBe('Hilo sin nombre');
    expect(data.id).toBeTruthy();
  });

  it('create thread with duplicate name succeeds', async () => {
    const r1 = await post<{ id: string; name: string }>('/threads/create', {
      project_id: 'ec-thread2', created_by: 'peer-1', name: 'Design Discussion',
    });
    const r2 = await post<{ id: string; name: string }>('/threads/create', {
      project_id: 'ec-thread2', created_by: 'peer-1', name: 'Design Discussion',
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.data.id).not.toBe(r2.data.id);
    expect(r1.data.name).toBe('Design Discussion');
    expect(r2.data.name).toBe('Design Discussion');
  });

  it('get thread that does not exist returns 404', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/threads/get', {
      thread_id: 'nonexistent-thread-id',
    });
    expect(status).toBe(404);
    expect(data.error).toContain('Thread not found');
  });

  it('update thread that does not exist returns 404', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/threads/update', {
      thread_id: 'nonexistent-thread-id', name: 'New Name',
    });
    expect(status).toBe(404);
    expect(data.error).toContain('Thread not found');
  });

  it('thread search with empty query returns 400', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/threads/search', {
      project_id: 'ec-thread3',
    });
    expect(status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });

  it('thread summary with no messages returns "(no messages yet)"', async () => {
    const thread = await post<{ id: string }>('/threads/create', {
      project_id: 'ec-thread4', created_by: 'peer-1', name: 'Empty Thread',
    });
    const { status, data } = await post<{ summary: string }>('/threads/summary', {
      thread_id: thread.data.id,
    });
    expect(status).toBe(200);
    expect(data.summary).toContain('(no messages yet)');
  });
});

// ── Shared state edge cases ──────────────────────────────────────

describe('edge cases: shared state', () => {
  it('get nonexistent key returns 404 with error "not found"', async () => {
    const { status, data } = await post<{ error: string }>('/shared/get', {
      project_id: 'ec-shared1', namespace: 'config', key: 'does-not-exist',
    });
    expect(status).toBe(404);
    expect(data.error).toBe('not found');
  });

  it('delete nonexistent key returns ok: true (idempotent)', async () => {
    const { status, data } = await post<{ ok: boolean }>('/shared/delete', {
      project_id: 'ec-shared2', namespace: 'config', key: 'does-not-exist', peer_id: 'p1',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('set shared state with missing fields returns 400', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/shared/set', {
      project_id: 'ec-shared3', namespace: 'config',
    });
    expect(status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });
});

// ── Body edge cases ──────────────────────────────────────────────

describe('edge cases: body validation', () => {
  it('empty body to /register returns error about missing fields', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/register', {});
    expect(status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });

  it('body with extra fields to /register succeeds and ignores extras', async () => {
    const { status, data } = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/tmp/extra', role: 'test', project_id: 'ec-body1',
      extra_field: 'should be ignored', another: 42,
    });
    expect(status).toBe(200);
    expect(data.id).toBeTruthy();
  });

  it('empty body to /send-message returns error about missing fields', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/send-message', {});
    expect(status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });

  it('empty body to /threads/create returns error about missing fields', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/threads/create', {});
    expect(status).toBe(400);
    expect(data.error).toContain('Missing required fields');
  });
});

// ── Heartbeat edge cases ─────────────────────────────────────────

describe('edge cases: heartbeat', () => {
  it('heartbeat with nonexistent ID returns 404', async () => {
    const { status, data } = await post<{ ok: boolean; error: string }>('/heartbeat', {
      id: 'nonexistent-peer-id',
    });
    expect(status).toBe(404);
    expect(data.error).toContain('Peer not found');
  });
});

// ── Multiple peers same role ─────────────────────────────────────

describe('edge cases: multiple peers same role', () => {
  it('send-to-role delivers to all 3 peers with same role', async () => {
    const proj = 'ec-multi-role';

    // Register sender
    const sender = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/sender', role: 'coordinator', project_id: proj,
    });

    // Register 3 backend peers
    const b1 = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/b1', role: 'backend', project_id: proj,
    });
    const b2 = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/b2', role: 'backend', project_id: proj,
    });
    const b3 = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/b3', role: 'backend', project_id: proj,
    });

    // Send to all backends
    const resp = await post<{ ok: boolean; sent_to: number }>('/send-to-role', {
      project_id: proj, from_id: sender.data.id, role: 'backend', text: 'Scale up instances',
    });
    expect(resp.data.ok).toBe(true);
    expect(resp.data.sent_to).toBe(3);

    // All 3 should receive the message
    const poll1 = await post<{ messages: Array<{ text: string }> }>('/poll-messages', { id: b1.data.id });
    expect(poll1.data.messages).toHaveLength(1);
    expect(poll1.data.messages[0].text).toBe('Scale up instances');

    const poll2 = await post<{ messages: Array<{ text: string }> }>('/poll-messages', { id: b2.data.id });
    expect(poll2.data.messages).toHaveLength(1);
    expect(poll2.data.messages[0].text).toBe('Scale up instances');

    const poll3 = await post<{ messages: Array<{ text: string }> }>('/poll-messages', { id: b3.data.id });
    expect(poll3.data.messages).toHaveLength(1);
    expect(poll3.data.messages[0].text).toBe('Scale up instances');
  });
});

// ── Cross-project isolation ──────────────────────────────────────

describe('edge cases: cross-project isolation', () => {
  it('thread created in project A is not visible in project B history', async () => {
    const projA = 'ec-iso-projA';
    const projB = 'ec-iso-projB';

    // Register peers in both projects
    const peerA1 = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/a1', role: 'backend', project_id: projA,
    });
    const peerA2 = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/a2', role: 'frontend', project_id: projA,
    });
    const peerB1 = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/b1', role: 'backend', project_id: projB,
    });
    const peerB2 = await post<{ id: string }>('/register', {
      pid: process.pid, cwd: '/b2', role: 'frontend', project_id: projB,
    });

    // Create thread in project A
    const thread = await post<{ id: string }>('/threads/create', {
      project_id: projA, created_by: peerA1.data.id, name: 'API Design',
    });
    const threadId = thread.data.id;

    // Send message in project A using that thread
    await post('/send-message', {
      project_id: projA, from_id: peerA1.data.id, to_id: peerA2.data.id,
      text: 'Let us design the API', thread_id: threadId,
    });

    // Send message in project B using same thread_id (just a tag)
    await post('/send-message', {
      project_id: projB, from_id: peerB1.data.id, to_id: peerB2.data.id,
      text: 'Different project message', thread_id: threadId,
    });

    // Get history for project A filtered by thread_id — should have 1 message
    const histA = await post<{ messages: Array<{ text: string; project_id: string }> }>('/get-history', {
      project_id: projA, thread_id: threadId,
    });
    expect(histA.data.messages.length).toBeGreaterThanOrEqual(1);
    const textsA = histA.data.messages.map(m => m.text);
    expect(textsA).toContain('Let us design the API');

    // Get history for project B filtered by thread_id — should only have the project B message
    const histB = await post<{ messages: Array<{ text: string; project_id: string }> }>('/get-history', {
      project_id: projB, thread_id: threadId,
    });
    const textsB = histB.data.messages.map(m => m.text);
    expect(textsB).not.toContain('Let us design the API');
    expect(textsB).toContain('Different project message');
  });
});
