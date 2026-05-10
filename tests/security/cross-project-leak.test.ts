// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// [S-NEW-3] cross-project bypass coverage. The H-1 fix in v0.2.2 only
// gated /api/send-message and /api/send-to-role. Every other handler
// that took `project_id` from the body still let a peer in project A
// read or write data in project B. v0.2.5 lifts the check into a
// shared assertProjectMembership helper and applies it everywhere.
//
// This file pins the "peer in A, ask for B → 403" behaviour for each
// affected endpoint.

import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import {
  initDatabase,
  insertPeer,
  insertThread,
} from '../../src/broker/database.js';
import {
  handleListModifiedFiles,
  handleSaveResume,
  handleGetHistory,
  handleSharedSet,
  handleSharedGet,
  handleSharedList,
  handleSharedDelete,
  handleGetThread,
  handleUpdateThread,
  handleDeleteThread,
  handleThreadSummary,
} from '../../src/broker/handlers.js';
import type { Peer } from '../../src/shared/types.js';

interface MockRes {
  statusCode: number;
  body: { ok?: boolean; error?: string; code?: string } | null;
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

function makePeer(id: string, projectId: string): Peer {
  const now = new Date().toISOString();
  return {
    id, project_id: projectId, pid: process.pid, name: id, role: 'agent',
    agent_type: 'claude-code', cwd: '/tmp', git_root: null, git_branch: null,
    tty: null, summary: '', registered_at: now, last_seen: now,
  };
}

beforeEach(() => {
  initDatabase(':memory:');
  // Two projects, one peer in each.
  insertPeer(makePeer('alice', 'projA'));
  insertPeer(makePeer('bob', 'projB'));
  // Pre-seed a thread in project A so the thread handlers have something
  // real to ask for. Project B's peer asking for A's thread is still
  // gated at the membership level — never reaches the thread row.
  insertThread({
    id: 'thrA',
    project_id: 'projA',
    name: 'Thread in A',
    status: 'active',
    summary: '',
    created_by: 'alice',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
});

interface Endpoint {
  name: string;
  call: (peerId: string, projectId: string) => MockRes;
}

// Each endpoint is exercised twice:
//   1. Bob (projB) asks for projA → 403 PROJECT_MISMATCH
//   2. Alice (projA) asks for projA → not 403 (membership passes; the
//      handler may still 404 or 200, that's not what we're asserting)
const endpoints: Endpoint[] = [
  {
    name: '/api/project/modified-files',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleListModifiedFiles({ project_id: projectId, peer_id: peerId }, res);
      return result;
    },
  },
  {
    name: '/api/project/save-resume',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleSaveResume({ project_id: projectId, peer_id: peerId }, res);
      return result;
    },
  },
  {
    name: '/api/get-history',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleGetHistory({ project_id: projectId, peer_id: peerId }, res);
      return result;
    },
  },
  {
    name: '/api/shared/set',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleSharedSet({
        project_id: projectId, namespace: 'ns', key: 'k', value: 'v', peer_id: peerId,
      }, res);
      return result;
    },
  },
  {
    name: '/api/shared/get',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleSharedGet({
        project_id: projectId, namespace: 'ns', key: 'k', peer_id: peerId,
      }, res);
      return result;
    },
  },
  {
    name: '/api/shared/list',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleSharedList({
        project_id: projectId, namespace: 'ns', peer_id: peerId,
      }, res);
      return result;
    },
  },
  {
    name: '/api/shared/delete',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleSharedDelete({
        project_id: projectId, namespace: 'ns', key: 'k', peer_id: peerId,
      }, res);
      return result;
    },
  },
  {
    name: '/api/threads/get',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleGetThread({ project_id: projectId, thread_id: 'thrA', peer_id: peerId }, res);
      return result;
    },
  },
  {
    name: '/api/threads/update',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleUpdateThread({
        project_id: projectId, thread_id: 'thrA', name: 'renamed', peer_id: peerId,
      }, res);
      return result;
    },
  },
  {
    name: '/api/threads/delete',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleDeleteThread({
        project_id: projectId, thread_id: 'thrA', peer_id: peerId,
      }, res);
      return result;
    },
  },
  {
    name: '/api/threads/summary',
    call: (peerId, projectId) => {
      const { res, result } = createMockRes();
      handleThreadSummary({
        project_id: projectId, thread_id: 'thrA', peer_id: peerId,
      }, res);
      return result;
    },
  },
];

describe('[S-NEW-3] cross-project leak guard', () => {
  for (const ep of endpoints) {
    it(`${ep.name} — peer in projB asking for projA returns 403 PROJECT_MISMATCH`, () => {
      const result = ep.call('bob', 'projA');
      expect(result.statusCode).toBe(403);
      expect(result.body?.code).toBe('PROJECT_MISMATCH');
    });

    it(`${ep.name} — missing peer_id is rejected with 400`, () => {
      const result = ep.call('', 'projA');
      expect(result.statusCode).toBe(400);
      // Three valid rejection paths after FASE E-1:
      //   - INVALID_BODY: zod schema requires peer_id (set/delete/recall)
      //   - MISSING_PEER_ID: handler routes through assertProjectMembership
      //   - undefined: legacy handlers without zod, with their own
      //     missing-fields branch (kept for now — covered by ad-hoc check)
      // Either the body's code is one of the above OR the handler still
      // returned 400 (which is the load-bearing assertion).
      const acceptable = result.body?.code === 'MISSING_PEER_ID'
        || result.body?.code === 'INVALID_BODY'
        || result.body?.code === undefined;
      expect(acceptable).toBe(true);
    });

    it(`${ep.name} — unknown peer_id returns 404 PEER_NOT_FOUND`, () => {
      const result = ep.call('ghost-id', 'projA');
      expect(result.statusCode).toBe(404);
      expect(result.body?.code).toBe('PEER_NOT_FOUND');
    });

    it(`${ep.name} — same-project peer is NOT blocked at the membership gate`, () => {
      const result = ep.call('alice', 'projA');
      // The membership gate must allow alice through. The handler may
      // still produce a 200/404 depending on the resource's own
      // existence — what we're pinning is "membership did not 403".
      expect(result.statusCode).not.toBe(403);
    });
  }
});
