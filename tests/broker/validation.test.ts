import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { initDatabase, insertPeer } from '../../src/broker/database.js';
import {
  handleRegister,
  handleSendMessage,
  handleSendToRole,
  handleSharedSet,
} from '../../src/broker/handlers.js';
import type { Peer } from '../../src/shared/types.js';

interface MockRes {
  statusCode: number;
  body: unknown;
}

function createMockRes(): { res: ServerResponse; result: MockRes } {
  const result: MockRes = { statusCode: 200, body: null };
  const emitter = new EventEmitter();
  const res = emitter as unknown as ServerResponse;

  res.writeHead = ((status: number) => {
    result.statusCode = status;
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

describe('input validation - command injection prevention', () => {
  it('rejects project_id with shell metacharacters', () => {
    const { res, result } = createMockRes();
    handleRegister({
      pid: 123, cwd: '/app', role: 'backend',
      project_id: 'test; rm -rf /',
    }, res);
    expect(result.statusCode).toBe(400);
    expect((result.body as { error: string }).error).toContain('Invalid project_id');
  });

  it('rejects role with shell metacharacters', () => {
    const { res, result } = createMockRes();
    handleRegister({
      pid: 123, cwd: '/app', project_id: 'safe-project',
      role: 'backend && echo hacked',
    }, res);
    expect(result.statusCode).toBe(400);
    expect((result.body as { error: string }).error).toContain('Invalid role');
  });

  it('rejects project_id with path traversal', () => {
    const { res, result } = createMockRes();
    handleRegister({
      pid: 123, cwd: '/app', role: 'backend',
      project_id: '../../etc/passwd',
    }, res);
    expect(result.statusCode).toBe(400);
  });

  it('accepts valid project_id with dots dashes and underscores', () => {
    const { res, result } = createMockRes();
    handleRegister({
      pid: 123, cwd: '/app', role: 'backend',
      project_id: 'my-project_v2.0',
    }, res);
    expect(result.statusCode).toBe(200);
  });

  it('accepts valid role names', () => {
    const { res, result } = createMockRes();
    handleRegister({
      pid: 123, cwd: '/app', role: 'back-end_v2',
      project_id: 'proj',
    }, res);
    expect(result.statusCode).toBe(200);
  });

  it('rejects role with backticks in send-to-role', () => {
    insertPeer(makePeer({ id: 'sender' }));
    const { res, result } = createMockRes();
    handleSendToRole({
      project_id: 'proj', from_id: 'sender',
      role: '`whoami`',
      text: 'hello',
    }, res);
    expect(result.statusCode).toBe(400);
  });
});

describe('input validation - message size limits', () => {
  it('rejects message text exceeding 100KB', () => {
    insertPeer(makePeer({ id: 'from1' }));
    insertPeer(makePeer({ id: 'to1' }));

    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'proj', from_id: 'from1', to_id: 'to1',
      text: 'x'.repeat(200_000),
    }, res);
    expect(result.statusCode).toBe(400);
    expect((result.body as { error: string }).error).toContain('maximum length');
  });

  it('accepts message text within limit', () => {
    insertPeer(makePeer({ id: 'from2' }));
    insertPeer(makePeer({ id: 'to2' }));

    const { res, result } = createMockRes();
    handleSendMessage({
      project_id: 'proj', from_id: 'from2', to_id: 'to2',
      text: 'x'.repeat(50_000),
    }, res);
    expect(result.statusCode).toBe(200);
  });

  it('rejects oversized text in send-to-role', () => {
    insertPeer(makePeer({ id: 'sender2' }));
    const { res, result } = createMockRes();
    handleSendToRole({
      project_id: 'proj', from_id: 'sender2', role: 'backend',
      text: 'x'.repeat(200_000),
    }, res);
    expect(result.statusCode).toBe(400);
  });
});
