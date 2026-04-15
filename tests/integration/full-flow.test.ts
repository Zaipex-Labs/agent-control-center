// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { initDatabase, insertMessage, ensureGeneralThread } from '../../src/broker/database.js';
import { cleanStalePeers } from '../../src/broker/cleanup.js';
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

// ── Test broker on random port ─────────────────────────────────

type PostHandler = (body: unknown, res: ServerResponse) => void;

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

function get<T>(path: string): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    import('node:http').then(http => {
      const r = http.request(url, { method: 'GET' }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({ status: res.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()) as T });
        });
      });
      r.on('error', reject);
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
        const body = await parseBody(req);
        return handler(body, res);
      }
    }
    res.writeHead(404);
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

// ── Tests ──────────────────────────────────────────────────────

describe('full flow integration', () => {
  // Shared state across the sequential flow tests
  let peer1Id: string;
  let peer2Id: string;
  let peer3Id: string;
  let thread1Id: string;
  let thread2Id: string;

  // 1. Register 3 peers
  it('registers 3 peers: backend/Turing, frontend/Lovelace, qa/Curie', async () => {
    const reg1 = await post<{ id: string; name: string }>('/api/register', {
      pid: process.pid, cwd: '/app/backend', role: 'backend', name: 'Turing', project_id: 'fullflow',
    });
    expect(reg1.status).toBe(200);
    expect(reg1.data.id).toHaveLength(8);
    peer1Id = reg1.data.id;

    const reg2 = await post<{ id: string; name: string }>('/api/register', {
      pid: process.pid, cwd: '/app/frontend', role: 'frontend', name: 'Lovelace', project_id: 'fullflow',
    });
    expect(reg2.status).toBe(200);
    peer2Id = reg2.data.id;

    const reg3 = await post<{ id: string; name: string }>('/api/register', {
      pid: process.pid, cwd: '/app/qa', role: 'qa', name: 'Curie', project_id: 'fullflow',
    });
    expect(reg3.status).toBe(200);
    peer3Id = reg3.data.id;

    // Verify all 3 are listed
    const peers = await post<Array<{ id: string }>>('/api/list-peers', { project_id: 'fullflow' });
    expect(peers.data).toHaveLength(3);
  });

  // 2. Create thread
  it('creates thread "Integracion de Customers"', async () => {
    const resp = await post<{ id: string; name: string }>('/api/threads/create', {
      project_id: 'fullflow', name: 'Integracion de Customers', created_by: peer1Id,
    });
    expect(resp.status).toBe(200);
    expect(resp.data.name).toBe('Integracion de Customers');
    thread1Id = resp.data.id;
  });

  // 3. Peer 1 sends message to peer 2 in the thread
  it('peer 1 sends message to peer 2 in thread', async () => {
    const resp = await post<{ ok: boolean }>('/api/send-message', {
      project_id: 'fullflow', from_id: peer1Id, to_id: peer2Id,
      text: 'Necesitamos el endpoint de customers', thread_id: thread1Id,
    });
    expect(resp.data.ok).toBe(true);
  });

  // 4. Peer 2 polls and receives message with correct thread_id
  it('peer 2 polls and receives message with correct thread_id', async () => {
    const poll = await post<{ messages: Array<{ text: string; thread_id: string }> }>('/api/poll-messages', { id: peer2Id });
    expect(poll.data.messages).toHaveLength(1);
    expect(poll.data.messages[0].text).toBe('Necesitamos el endpoint de customers');
    expect(poll.data.messages[0].thread_id).toBe(thread1Id);
  });

  // 5. Peer 2 responds via /send-message back to peer 1 in same thread
  it('peer 2 responds to peer 1 in same thread', async () => {
    const resp = await post<{ ok: boolean }>('/api/send-message', {
      project_id: 'fullflow', from_id: peer2Id, to_id: peer1Id,
      text: 'Ya tengo el GET /customers listo', thread_id: thread1Id,
    });
    expect(resp.data.ok).toBe(true);
  });

  // 6. Peer 1 polls and receives the response
  it('peer 1 polls and receives response from peer 2', async () => {
    const poll = await post<{ messages: Array<{ text: string; thread_id: string }> }>('/api/poll-messages', { id: peer1Id });
    expect(poll.data.messages).toHaveLength(1);
    expect(poll.data.messages[0].text).toBe('Ya tengo el GET /customers listo');
    expect(poll.data.messages[0].thread_id).toBe(thread1Id);
  });

  // 7. get_history with thread_id only returns messages from that thread (should be 2)
  it('get_history with thread_id returns only thread messages', async () => {
    const history = await post<{ messages: Array<{ text: string; thread_id: string }> }>('/api/get-history', {
      project_id: 'fullflow', thread_id: thread1Id,
    });
    expect(history.data.messages).toHaveLength(2);
    for (const msg of history.data.messages) {
      expect(msg.thread_id).toBe(thread1Id);
    }
  });

  // 8. get_history without thread_id returns all messages
  it('get_history without thread_id returns all messages', async () => {
    const history = await post<{ messages: Array<{ text: string }> }>('/api/get-history', {
      project_id: 'fullflow',
    });
    expect(history.data.messages.length).toBeGreaterThanOrEqual(2);
  });

  // 9. Create second thread, send message, verify isolation
  it('thread isolation: second thread does not leak into first', async () => {
    // Create second thread
    const resp = await post<{ id: string; name: string }>('/api/threads/create', {
      project_id: 'fullflow', name: 'Auth Flow', created_by: peer2Id,
    });
    expect(resp.status).toBe(200);
    thread2Id = resp.data.id;

    // Send message in second thread
    const send = await post<{ ok: boolean }>('/api/send-message', {
      project_id: 'fullflow', from_id: peer2Id, to_id: peer3Id,
      text: 'Necesito tests de autenticacion', thread_id: thread2Id,
    });
    expect(send.data.ok).toBe(true);

    // History for thread 1 should still be 2
    const history1 = await post<{ messages: Array<{ thread_id: string }> }>('/api/get-history', {
      project_id: 'fullflow', thread_id: thread1Id,
    });
    expect(history1.data.messages).toHaveLength(2);

    // History for thread 2 should be 1
    const history2 = await post<{ messages: Array<{ thread_id: string }> }>('/api/get-history', {
      project_id: 'fullflow', thread_id: thread2Id,
    });
    expect(history2.data.messages).toHaveLength(1);
  });

  // 10. Thread summary
  it('thread summary contains message texts', async () => {
    const resp = await post<{ summary: string }>('/api/threads/summary', { thread_id: thread1Id });
    expect(resp.status).toBe(200);
    expect(resp.data.summary).toContain('Necesitamos el endpoint de customers');
    expect(resp.data.summary).toContain('Ya tengo el GET /customers listo');
  });

  // 11. Shared state: set, get, list, delete, verify 404 after delete
  it('shared state full lifecycle: set, get, list, delete', async () => {
    // Set
    const set = await post<{ ok: boolean }>('/api/shared/set', {
      project_id: 'fullflow', namespace: 'contracts', key: 'customers-api', value: '{"version":"1.0"}', peer_id: peer1Id,
    });
    expect(set.data.ok).toBe(true);

    // Get
    const got = await post<{ value: string; updated_by: string }>('/api/shared/get', {
      project_id: 'fullflow', namespace: 'contracts', key: 'customers-api',
    });
    expect(got.status).toBe(200);
    expect(got.data.value).toBe('{"version":"1.0"}');
    expect(got.data.updated_by).toBe(peer1Id);

    // List
    const list = await post<{ keys: string[] }>('/api/shared/list', {
      project_id: 'fullflow', namespace: 'contracts',
    });
    expect(list.data.keys).toContain('customers-api');

    // Delete
    const del = await post<{ ok: boolean }>('/api/shared/delete', {
      project_id: 'fullflow', namespace: 'contracts', key: 'customers-api', peer_id: peer1Id,
    });
    expect(del.data.ok).toBe(true);

    // Get after delete returns 404
    const gone = await post<{ error: string }>('/api/shared/get', {
      project_id: 'fullflow', namespace: 'contracts', key: 'customers-api',
    });
    expect(gone.status).toBe(404);
    expect(gone.data.error).toBe('not found');
  });

  // 12. Shared state isolation between projects
  it('shared state isolation: project A data not visible from project B', async () => {
    // Set in project A
    await post<{ ok: boolean }>('/api/shared/set', {
      project_id: 'proj-a', namespace: 'config', key: 'secret', value: '"hidden"', peer_id: 'pa',
    });

    // Get from project B returns 404
    const got = await post<{ error: string }>('/api/shared/get', {
      project_id: 'proj-b', namespace: 'config', key: 'secret',
    });
    expect(got.status).toBe(404);
    expect(got.data.error).toBe('not found');
  });

  // 13. Search threads by name
  it('search threads by name finds matching thread', async () => {
    const resp = await post<{ threads: Array<{ id: string; name: string }>; messages: unknown[] }>('/api/threads/search', {
      project_id: 'fullflow', query: 'Customers',
    });
    expect(resp.status).toBe(200);
    const found = resp.data.threads.find(t => t.id === thread1Id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Integracion de Customers');
  });

  // 14. Search threads by message content
  it('search threads by message content finds matching messages', async () => {
    const resp = await post<{ threads: Array<{ id: string }>; messages: Array<{ text: string; thread_id: string }> }>('/api/threads/search', {
      project_id: 'fullflow', query: 'endpoint de customers',
    });
    expect(resp.status).toBe(200);
    const msgMatch = resp.data.messages.find(m => m.thread_id === thread1Id);
    expect(msgMatch).toBeDefined();
    expect(msgMatch!.text).toContain('endpoint de customers');
  });

  // 15. Archive thread and verify list filtering
  it('archive thread: archived thread excluded from active list', async () => {
    // Archive thread 1
    const upd = await post<{ ok: boolean }>('/api/threads/update', {
      project_id: 'fullflow', thread_id: thread1Id, status: 'archived',
    });
    expect(upd.data.ok).toBe(true);

    // List with status='active' should NOT include archived thread
    const active = await post<{ threads: Array<{ id: string }> }>('/api/threads/list', {
      project_id: 'fullflow', status: 'active',
    });
    const archivedInActive = active.data.threads.find(t => t.id === thread1Id);
    expect(archivedInActive).toBeUndefined();

    // List without status filter should include it
    const all = await post<{ threads: Array<{ id: string }> }>('/api/threads/list', {
      project_id: 'fullflow',
    });
    const found = all.data.threads.find(t => t.id === thread1Id);
    expect(found).toBeDefined();
  });

  // 16. ensureGeneralThread: idempotent creation
  it('ensureGeneralThread returns same id on repeated calls', () => {
    const first = ensureGeneralThread('general-test');
    expect(first.name).toBe('General');
    expect(first.id).toHaveLength(8);

    const second = ensureGeneralThread('general-test');
    expect(second.id).toBe(first.id);
  });

  // 17. Cleanup peers: register a peer with current pid, verify cleanStalePeers behavior
  it('cleanStalePeers removes peers with dead PIDs', async () => {
    // Register a peer with a PID that does not exist (99999999)
    const reg = await post<{ id: string }>('/api/register', {
      pid: 99999999, cwd: '/dead', role: 'ghost', project_id: 'cleanup-test',
    });
    expect(reg.data.id).toHaveLength(8);

    // Register a peer with current (alive) PID
    const alive = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/alive', role: 'living', project_id: 'cleanup-test',
    });

    // Run cleanup — should remove the dead peer
    const removed = cleanStalePeers();
    expect(removed).toBeGreaterThanOrEqual(1);

    // The alive peer should still exist
    const hb = await post<{ ok: boolean }>('/api/heartbeat', { id: alive.data.id });
    expect(hb.data.ok).toBe(true);

    // The dead peer should be gone
    const hbDead = await post<{ ok: boolean; error?: string }>('/api/heartbeat', { id: reg.data.id });
    expect(hbDead.status).toBe(404);
  });

  // TTL test: expired messages are silently dropped on poll
  it('expired messages (>30min old) are not returned by poll', async () => {
    // Register a fresh peer for this test
    const reg = await post<{ id: string }>('/api/register', {
      pid: process.pid, cwd: '/ttl', role: 'ttl-test', project_id: 'ttl-proj',
    });
    const peerId = reg.data.id;

    // Insert a message directly with sent_at 31 minutes in the past
    const pastDate = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    insertMessage('ttl-proj', 'sender-x', peerId, 'message', 'This is old', null, pastDate);

    // Poll — should NOT return the expired message
    const poll = await post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: peerId });
    expect(poll.data.messages).toHaveLength(0);
  });
});
