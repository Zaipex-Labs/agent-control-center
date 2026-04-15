// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import { initDatabase } from '../../src/broker/database.js';
import {
  parseBody,
  handleHealth,
  handleRegister,
  handleListPeers,
  handleSendMessage,
  handleSendToRole,
  handlePollMessages,
  handleGetHistory,
  handleCreateThread,
  handleSearchThreads,
} from '../../src/broker/handlers.js';

type PostHandler = (body: unknown, res: ServerResponse) => void;
const POST_ROUTES: Record<string, PostHandler> = {
  '/api/register': handleRegister,
  '/api/list-peers': handleListPeers,
  '/api/send-message': handleSendMessage,
  '/api/send-to-role': handleSendToRole,
  '/api/poll-messages': handlePollMessages,
  '/api/get-history': handleGetHistory,
  '/api/threads/create': handleCreateThread,
  '/api/threads/search': handleSearchThreads,
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

// ── Helpers ────────────────────────────────────────────────────

function registerPeer(projectId: string, role: string) {
  return post<{ id: string }>('/api/register', {
    project_id: projectId,
    pid: process.pid,
    cwd: '/tmp/test',
    role,
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe('robustness', () => {
  it('100 peers register and list correctly', async () => {
    const projectId = 'rob-peers';
    const batchSize = 20;
    const total = 100;
    const ids: string[] = [];

    for (let batchStart = 0; batchStart < total; batchStart += batchSize) {
      const batch = Array.from({ length: batchSize }, (_, i) => {
        const index = batchStart + i;
        return registerPeer(projectId, `agent-${index}`);
      });
      const results = await Promise.all(batch);
      for (const r of results) {
        expect(r.status).toBe(200);
        ids.push(r.data.id);
      }
    }

    const listRes = await post<Array<{ id: string; role: string }>>('/api/list-peers', {
      project_id: projectId,
    });

    expect(listRes.status).toBe(200);
    expect(listRes.data).toHaveLength(100);

    const roles = listRes.data.map(p => p.role).sort();
    const expected = Array.from({ length: 100 }, (_, i) => `agent-${i}`).sort();
    expect(roles).toEqual(expected);
  });

  it('50 rapid messages all delivered', async () => {
    const projectId = 'rob-msgs';
    const senderRes = await registerPeer(projectId, 'sender');
    const receiverRes = await registerPeer(projectId, 'receiver');
    const senderId = senderRes.data.id;
    const receiverId = receiverRes.data.id;

    for (let i = 0; i < 50; i++) {
      const r = await post('/api/send-message', {
        project_id: projectId,
        from_id: senderId,
        to_id: receiverId,
        text: `msg-${i}`,
      });
      expect(r.status).toBe(200);
    }

    const pollRes = await post<{ messages: Array<{ text: string }> }>('/api/poll-messages', {
      id: receiverId,
    });

    expect(pollRes.status).toBe(200);
    expect(pollRes.data.messages).toHaveLength(50);

    for (let i = 0; i < 50; i++) {
      expect(pollRes.data.messages[i].text).toBe(`msg-${i}`);
    }
  });

  it('20 threads created and searchable', async () => {
    const projectId = 'rob-threads';
    const creatorRes = await registerPeer(projectId, 'creator');
    const creatorId = creatorRes.data.id;

    const threadIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await post<{ id: string; name: string }>('/api/threads/create', {
        project_id: projectId,
        created_by: creatorId,
        name: `Thread-${i}`,
      });
      expect(r.status).toBe(200);
      expect(r.data.name).toBe(`Thread-${i}`);
      threadIds.push(r.data.id);
    }

    // Search for 'Thread-1' should match Thread-1, Thread-10 through Thread-19 (up to 11)
    const search1 = await post<{ threads: Array<{ name: string }> }>('/api/threads/search', {
      project_id: projectId,
      query: 'Thread-1',
    });
    expect(search1.status).toBe(200);
    const names1 = search1.data.threads.map(t => t.name);
    expect(names1.length).toBeGreaterThanOrEqual(1);
    expect(names1.length).toBeLessThanOrEqual(11);
    expect(names1).toContain('Thread-1');

    // Search for 'Thread-19' should match exactly 1
    const search2 = await post<{ threads: Array<{ name: string }> }>('/api/threads/search', {
      project_id: projectId,
      query: 'Thread-19',
    });
    expect(search2.status).toBe(200);
    expect(search2.data.threads).toHaveLength(1);
    expect(search2.data.threads[0].name).toBe('Thread-19');
  });

  it('rapid poll 10 times does not duplicate messages', async () => {
    const projectId = 'rob-poll';
    const senderRes = await registerPeer(projectId, 'sender');
    const receiverRes = await registerPeer(projectId, 'receiver');
    const senderId = senderRes.data.id;
    const receiverId = receiverRes.data.id;

    // Send 3 messages
    for (let i = 0; i < 3; i++) {
      await post('/api/send-message', {
        project_id: projectId,
        from_id: senderId,
        to_id: receiverId,
        text: `rapid-${i}`,
      });
    }

    // Poll 10 times concurrently
    const polls = await Promise.all(
      Array.from({ length: 10 }, () =>
        post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: receiverId })
      )
    );

    // Collect all unique message texts across all polls
    const allTexts = new Set<string>();
    for (const poll of polls) {
      expect(poll.status).toBe(200);
      for (const msg of poll.data.messages) {
        allTexts.add(msg.text);
      }
    }

    // All 3 original messages must appear in the union of all poll results
    expect(allTexts).toContain('rapid-0');
    expect(allTexts).toContain('rapid-1');
    expect(allTexts).toContain('rapid-2');
    expect(allTexts.size).toBe(3);

    // After all polls, one more poll should return 0 messages (all delivered)
    const finalPoll = await post<{ messages: Array<{ text: string }> }>('/api/poll-messages', {
      id: receiverId,
    });
    expect(finalPoll.status).toBe(200);
    expect(finalPoll.data.messages).toHaveLength(0);
  });

  it('two peers poll simultaneously get only their own messages', async () => {
    const projectId = 'rob-target';
    const peerARes = await registerPeer(projectId, 'worker-a');
    const peerBRes = await registerPeer(projectId, 'worker-b');
    const senderRes = await registerPeer(projectId, 'dispatcher');
    const peerAId = peerARes.data.id;
    const peerBId = peerBRes.data.id;
    const senderId = senderRes.data.id;

    // Send targeted messages
    await post('/api/send-message', {
      project_id: projectId,
      from_id: senderId,
      to_id: peerAId,
      text: 'for-A',
    });
    await post('/api/send-message', {
      project_id: projectId,
      from_id: senderId,
      to_id: peerBId,
      text: 'for-B',
    });

    // Poll both simultaneously
    const [pollA, pollB] = await Promise.all([
      post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: peerAId }),
      post<{ messages: Array<{ text: string }> }>('/api/poll-messages', { id: peerBId }),
    ]);

    expect(pollA.status).toBe(200);
    expect(pollA.data.messages).toHaveLength(1);
    expect(pollA.data.messages[0].text).toBe('for-A');

    expect(pollB.status).toBe(200);
    expect(pollB.data.messages).toHaveLength(1);
    expect(pollB.data.messages[0].text).toBe('for-B');
  });
});
