// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { initDatabase, insertPeer } from '../../src/broker/database.js';
import {
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
} from '../../src/broker/handlers.js';
import type { Peer } from '../../src/shared/types.js';

// ── Mock ServerResponse ────────────────────────────────────────

interface MockRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null, headers: {} };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;

  res.writeHead = ((status: number, headers?: Record<string, string>) => {
    result.statusCode = status;
    if (headers) result.headers = headers;
    return res;
  }) as ServerResponse['writeHead'];

  res.end = ((data?: string) => {
    if (data) result.body = JSON.parse(data);
    return res;
  }) as ServerResponse['end'];

  return { res, result };
}

function makePeer(overrides: Partial<Peer> = {}): Peer {
  const now = new Date().toISOString();
  return {
    id: `peer-${Math.random().toString(36).slice(2, 6)}`,
    project_id: 'proj',
    pid: process.pid,
    name: 'Turing',
    role: 'backend',
    agent_type: 'claude-code',
    cwd: '/tmp',
    git_root: null,
    git_branch: null,
    tty: null,
    summary: '',
    registered_at: now,
    last_seen: now,
    ...overrides,
  };
}

beforeEach(() => {
  initDatabase(':memory:');
});

// ── Health ─────────────────────────────────────────────────────

describe('handleHealth', () => {
  it('returns status ok with counts', () => {
    const { res, result } = createMockRes();
    handleHealth(res);
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ status: 'ok', peers: 0, pending_messages: 0 });
  });
});

// ── Register ───────────────────────────────────────────────────

describe('handleRegister', () => {
  it('registers a peer and returns id', () => {
    const { res, result } = createMockRes();
    handleRegister({ pid: 123, cwd: '/app', role: 'backend', project_id: 'proj' }, res);
    expect(result.statusCode).toBe(200);
    expect((result.body as { id: string }).id).toHaveLength(8);
  });

  it('rejects missing fields', () => {
    const { res, result } = createMockRes();
    handleRegister({}, res);
    expect(result.statusCode).toBe(400);
    expect((result.body as { ok: boolean }).ok).toBe(false);
  });
});

// ── Heartbeat ──────────────────────────────────────────────────

describe('handleHeartbeat', () => {
  it('updates last_seen for existing peer', () => {
    const peer = makePeer({ id: 'hb1' });
    insertPeer(peer);

    const { res, result } = createMockRes();
    handleHeartbeat({ id: 'hb1' }, res);
    expect(result.statusCode).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);
  });

  it('returns 404 for missing peer', () => {
    const { res, result } = createMockRes();
    handleHeartbeat({ id: 'nope' }, res);
    expect(result.statusCode).toBe(404);
  });

  it('rejects missing id', () => {
    const { res, result } = createMockRes();
    handleHeartbeat({}, res);
    expect(result.statusCode).toBe(400);
  });
});

// ── Unregister ─────────────────────────────────────────────────

describe('handleUnregister', () => {
  it('removes a peer', () => {
    insertPeer(makePeer({ id: 'u1' }));
    const { res, result } = createMockRes();
    handleUnregister({ id: 'u1' }, res);
    expect(result.statusCode).toBe(200);
  });

  it('succeeds even if peer does not exist', () => {
    const { res, result } = createMockRes();
    handleUnregister({ id: 'gone' }, res);
    expect(result.statusCode).toBe(200);
  });
});

// ── SetSummary ─────────────────────────────────────────────────

describe('handleSetSummary', () => {
  it('updates summary', () => {
    insertPeer(makePeer({ id: 's1' }));
    const { res, result } = createMockRes();
    handleSetSummary({ id: 's1', summary: 'Working on API' }, res);
    expect(result.statusCode).toBe(200);
  });

  it('returns 404 for missing peer', () => {
    const { res, result } = createMockRes();
    handleSetSummary({ id: 'nope', summary: 'x' }, res);
    expect(result.statusCode).toBe(404);
  });
});

// ── SetRole ────────────────────────────────────────────────────

describe('handleSetRole', () => {
  it('updates role', () => {
    insertPeer(makePeer({ id: 'r1', role: 'backend' }));
    const { res, result } = createMockRes();
    handleSetRole({ id: 'r1', role: 'devops' }, res);
    expect(result.statusCode).toBe(200);
  });

  it('returns 404 for missing peer', () => {
    const { res, result } = createMockRes();
    handleSetRole({ id: 'nope', role: 'x' }, res);
    expect(result.statusCode).toBe(404);
  });
});

// ── ListPeers ──────────────────────────────────────────────────

describe('handleListPeers', () => {
  it('lists peers by project', () => {
    insertPeer(makePeer({ id: 'a', project_id: 'proj' }));
    insertPeer(makePeer({ id: 'b', project_id: 'proj' }));
    insertPeer(makePeer({ id: 'c', project_id: 'other' }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'proj' }, res);
    expect(result.statusCode).toBe(200);
    expect(result.body).toHaveLength(2);
  });

  it('lists all peers with scope=machine', () => {
    insertPeer(makePeer({ id: 'a', project_id: 'p1' }));
    insertPeer(makePeer({ id: 'b', project_id: 'p2' }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: '', scope: 'machine' }, res);
    expect(result.body).toHaveLength(2);
  });

  it('filters by role', () => {
    insertPeer(makePeer({ id: 'a', role: 'backend' }));
    insertPeer(makePeer({ id: 'b', role: 'frontend' }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'proj', role: 'backend' }, res);
    expect(result.body).toHaveLength(1);
  });

  it('excludes by id', () => {
    insertPeer(makePeer({ id: 'a' }));
    insertPeer(makePeer({ id: 'b' }));

    const { res, result } = createMockRes();
    handleListPeers({ project_id: 'proj', exclude_id: 'a' }, res);
    expect(result.body).toHaveLength(1);
    expect((result.body as Peer[])[0].id).toBe('b');
  });

  it('rejects missing project_id for non-machine scope', () => {
    const { res, result } = createMockRes();
    handleListPeers({ project_id: '' }, res);
    expect(result.statusCode).toBe(400);
  });
});

// ── SendMessage ────────────────────────────────────────────────

describe('handleSendMessage', () => {
  it('sends a message between peers', () => {
    insertPeer(makePeer({ id: 'from1', role: 'backend' }));
    insertPeer(makePeer({ id: 'to1', role: 'frontend' }));

    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'proj', from_id: 'from1', to_id: 'to1', text: 'Hello',
    }, res);
    expect(result.statusCode).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);
  });

  it('returns 404 if target peer missing', () => {
    insertPeer(makePeer({ id: 'from1' }));
    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'proj', from_id: 'from1', to_id: 'gone', text: 'Hello',
    }, res);
    expect(result.statusCode).toBe(404);
  });

  it('returns 404 if sender peer missing', () => {
    insertPeer(makePeer({ id: 'to1' }));
    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'proj', from_id: 'gone', to_id: 'to1', text: 'Hello',
    }, res);
    expect(result.statusCode).toBe(404);
  });

  it('rejects missing fields', () => {
    const { res, result } = createMockRes();
    handleSendMessage({ project_id: 'proj' }, res);
    expect(result.statusCode).toBe(400);
  });
});

// ── SendToRole ─────────────────────────────────────────────────

describe('handleSendToRole', () => {
  it('sends to all peers with role', () => {
    insertPeer(makePeer({ id: 'sender', role: 'cli' }));
    insertPeer(makePeer({ id: 'b1', role: 'backend' }));
    insertPeer(makePeer({ id: 'b2', role: 'backend' }));

    const { res, result } = createMockRes();
    handleSendToRole({
      project_id: 'proj', from_id: 'sender', role: 'backend', text: 'Deploy!',
    }, res);
    expect(result.statusCode).toBe(200);
    expect((result.body as { sent_to: number }).sent_to).toBe(2);
  });

  it('returns sent_to=0 if no peers with that role', () => {
    insertPeer(makePeer({ id: 'sender', role: 'cli' }));

    const { res, result } = createMockRes();
    handleSendToRole({
      project_id: 'proj', from_id: 'sender', role: 'devops', text: 'Hi',
    }, res);
    expect((result.body as { sent_to: number }).sent_to).toBe(0);
  });
});

// ── PollMessages ───────────────────────────────────────────────

describe('handlePollMessages', () => {
  it('returns and marks messages as delivered', () => {
    insertPeer(makePeer({ id: 'from1' }));
    insertPeer(makePeer({ id: 'to1' }));

    // Send a message first
    const { res: sendRes } = createMockRes();
    handleSendMessage({
      project_id: 'proj', from_id: 'from1', to_id: 'to1', text: 'Check this',
    }, sendRes);

    // Poll
    const { res, result } = createMockRes();
    handlePollMessages({ id: 'to1' }, res);
    expect(result.statusCode).toBe(200);
    const msgs = (result.body as { messages: unknown[] }).messages;
    expect(msgs).toHaveLength(1);

    // Poll again — should be empty (already delivered)
    const { res: res2, result: result2 } = createMockRes();
    handlePollMessages({ id: 'to1' }, res2);
    expect((result2.body as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it('rejects missing id', () => {
    const { res, result } = createMockRes();
    handlePollMessages({}, res);
    expect(result.statusCode).toBe(400);
  });
});

// ── GetHistory ─────────────────────────────────────────────────

describe('handleGetHistory', () => {
  it('returns history for a project', () => {
    insertPeer(makePeer({ id: 'f', role: 'backend' }));
    insertPeer(makePeer({ id: 't', role: 'frontend' }));

    const { res: sendRes } = createMockRes();
    handleSendMessage({
      project_id: 'proj', from_id: 'f', to_id: 't', text: 'Hi',
    }, sendRes);

    const { res, result } = createMockRes();
    handleGetHistory({ project_id: 'proj' }, res);
    expect((result.body as { messages: unknown[] }).messages).toHaveLength(1);
  });

  it('rejects missing project_id', () => {
    const { res, result } = createMockRes();
    handleGetHistory({}, res);
    expect(result.statusCode).toBe(400);
  });
});

// ── Shared state handlers ──────────────────────────────────────

describe('handleSharedSet / Get / List / Delete', () => {
  it('set + get round-trip', () => {
    const { res: setRes, result: setResult } = createMockRes();
    handleSharedSet({
      project_id: 'proj', namespace: 'config', key: 'port', value: '8080', peer_id: 'p1',
    }, setRes);
    expect(setResult.statusCode).toBe(200);

    const { res: getRes, result: getResult } = createMockRes();
    handleSharedGet({ project_id: 'proj', namespace: 'config', key: 'port' }, getRes);
    expect(getResult.statusCode).toBe(200);
    expect((getResult.body as { value: string }).value).toBe('8080');
  });

  it('get returns 404 for missing key', () => {
    const { res, result } = createMockRes();
    handleSharedGet({ project_id: 'proj', namespace: 'x', key: 'y' }, res);
    expect(result.statusCode).toBe(404);
  });

  it('list returns keys', () => {
    const { res: r1 } = createMockRes();
    handleSharedSet({ project_id: 'proj', namespace: 'ns', key: 'a', value: '1', peer_id: 'p1' }, r1);
    const { res: r2 } = createMockRes();
    handleSharedSet({ project_id: 'proj', namespace: 'ns', key: 'b', value: '2', peer_id: 'p1' }, r2);

    const { res, result } = createMockRes();
    handleSharedList({ project_id: 'proj', namespace: 'ns' }, res);
    expect((result.body as { keys: string[] }).keys).toHaveLength(2);
  });

  it('delete removes a key', () => {
    const { res: r1 } = createMockRes();
    handleSharedSet({ project_id: 'proj', namespace: 'ns', key: 'k', value: 'v', peer_id: 'p1' }, r1);

    const { res: delRes, result: delResult } = createMockRes();
    handleSharedDelete({ project_id: 'proj', namespace: 'ns', key: 'k', peer_id: 'p1' }, delRes);
    expect(delResult.statusCode).toBe(200);

    const { res: getRes, result: getResult } = createMockRes();
    handleSharedGet({ project_id: 'proj', namespace: 'ns', key: 'k' }, getRes);
    expect(getResult.statusCode).toBe(404);
  });

  it('set rejects missing fields', () => {
    const { res, result } = createMockRes();
    handleSharedSet({ project_id: 'proj' }, res);
    expect(result.statusCode).toBe(400);
  });
});
