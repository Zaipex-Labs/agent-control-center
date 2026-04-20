// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Peer } from '../../src/shared/types.js';

// Note: initDatabase / insertPeer / addBlobRef are imported dynamically
// inside beforeAll AFTER vi.resetModules(), so they share the same
// module instances as handlers.js. Importing them at the top would
// resolve to a different singleton than the one handlers uses after
// the reset and every DB call would hit an undefined connection.

let server: Server;
let baseUrl: string;
let home: string;

// Named peers seeded before each test. Upload is anonymous (unauthenticated
// writes are fine — the dashboard fires them from the user's session);
// download needs X-Peer-Id so the broker can scope ACL to blob_refs.
const PROJ_OWNER = 'proj-owner';
const PROJ_INTRUDER = 'proj-intruder';
const INSIDER_ID = 'insider-peer';
const OUTSIDER_ID = 'outsider-peer';

function makePeer(overrides: Partial<Peer> = {}): Peer {
  const now = new Date().toISOString();
  return {
    id: 'x', project_id: PROJ_OWNER, pid: process.pid,
    name: 'n', role: 'backend', agent_type: 'claude-code',
    cwd: '/tmp', git_root: null, git_branch: null, tty: null,
    summary: '', registered_at: now, last_seen: now,
    ...overrides,
  };
}

let dbMod: typeof import('../../src/broker/database.js');
let refsMod: typeof import('../../src/broker/blob-refs.js');

beforeAll(async () => {
  process.env['ACC_MAX_BLOB_SIZE'] = '1024';
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'acc-blob-http-'));
  // Dynamic imports AFTER resetModules so db/refs/handlers share the
  // same module instances.
  dbMod = await import('../../src/broker/database.js');
  refsMod = await import('../../src/broker/blob-refs.js');
  dbMod.initDatabase(':memory:');
  const { setBlobsRoot } = await import('../../src/broker/blobs.js');
  setBlobsRoot(join(home, 'blobs'));
  const { handleUploadBlob, handleDownloadBlob } = await import('../../src/broker/handlers.js');
  server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/blobs/upload') return handleUploadBlob(req, res);
    const m = req.url?.match(/^\/api\/blobs\/([a-f0-9]{64})$/);
    if (req.method === 'GET' && m) return handleDownloadBlob(req, m[1], res);
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

beforeEach(() => {
  // Fresh schema per test. Re-init on the same dynamically-imported
  // module so the singleton stays in sync with what handlers sees.
  dbMod.initDatabase(':memory:');
  dbMod.insertPeer(makePeer({ id: INSIDER_ID, project_id: PROJ_OWNER }));
  dbMod.insertPeer(makePeer({ id: OUTSIDER_ID, project_id: PROJ_INTRUDER }));
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  const { setBlobsRoot } = await import('../../src/broker/blobs.js');
  setBlobsRoot(null);
  rmSync(home, { recursive: true, force: true });
  delete process.env['ACC_MAX_BLOB_SIZE'];
});

async function upload(body: Buffer, mime: string, filename: string) {
  const r = await fetch(`${baseUrl}/api/blobs/upload`, {
    method: 'POST',
    headers: { 'Content-Type': mime, 'X-Filename': encodeURIComponent(filename) },
    body,
  });
  return { status: r.status, json: r.ok ? await r.json() : await r.json().catch(() => null) };
}

describe('blob upload', () => {
  it('uploads and returns sha256, size, mime, name', async () => {
    const { status, json } = await upload(Buffer.from('hello'), 'text/plain', 'h.txt');
    expect(status).toBe(200);
    expect(json.hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(json.size).toBe(5);
    expect(json.mime).toBe('text/plain');
    expect(json.name).toBe('h.txt');
  });

  it('preserves UTF-8 filenames with spaces and accents', async () => {
    const { status, json } = await upload(
      Buffer.from('pdf'),
      'application/pdf',
      'diagrama arquitectura v2.pdf',
    );
    expect(status).toBe(200);
    expect(json.name).toBe('diagrama arquitectura v2.pdf');
  });

  it('rejects when body exceeds MAX_BLOB_SIZE with BLOB_TOO_LARGE code', async () => {
    const big = Buffer.alloc(1024 + 1, 0);
    const r = await fetch(`${baseUrl}/api/blobs/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': encodeURIComponent('big.bin'),
      },
      body: big,
    });
    expect(r.status).toBe(413);
    const body = await r.json();
    expect(body.code).toBe('BLOB_TOO_LARGE');
  });

  it('rejects missing Content-Type', async () => {
    const r = await fetch(`${baseUrl}/api/blobs/upload`, {
      method: 'POST',
      headers: { 'X-Filename': encodeURIComponent('no-mime') },
      body: Buffer.from('x'),
    });
    expect(r.status).toBe(400);
  });
});

// ── [H-2] Peer-scoped ACL on GET /api/blobs/:hash ────────────
//
// v0.2.1 audit reproduced: anyone who knew a hash could download any
// blob via curl http://127.0.0.1:7899/api/blobs/<hash>. The route had
// no auth, no project check. These tests lock the new contract:
//
//   1. Request must carry X-Peer-Id.
//   2. The peer must exist.
//   3. A row in blob_refs(blob_hash, project_id = peer.project_id)
//      must exist — i.e. some message in the peer's project references
//      this blob.
//
// Mismatch at any step → 401 or 403. Orphan blobs (no refs yet) are
// inaccessible to anyone: the 1h GC grace keeps them on disk for a
// short window, but the API refuses to serve them until they're
// attached to a message.

describe('blob download ACL [H-2]', () => {
  it('rejects without X-Peer-Id (401 MISSING_PEER_ID)', async () => {
    const up = await upload(Buffer.from('a'), 'text/plain', 'a.txt');
    refsMod.addBlobRef(up.json.hash, PROJ_OWNER, null);
    const r = await fetch(`${baseUrl}/api/blobs/${up.json.hash}`);
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.code).toBe('MISSING_PEER_ID');
  });

  it('rejects when X-Peer-Id references an unknown peer (401 UNKNOWN_PEER)', async () => {
    const up = await upload(Buffer.from('b'), 'text/plain', 'b.txt');
    refsMod.addBlobRef(up.json.hash, PROJ_OWNER, null);
    const r = await fetch(`${baseUrl}/api/blobs/${up.json.hash}`, {
      headers: { 'X-Peer-Id': 'ghost-peer' },
    });
    expect(r.status).toBe(401);
    expect((await r.json()).code).toBe('UNKNOWN_PEER');
  });

  it('rejects when the peer is in a different project (403 BLOB_ACCESS_DENIED)', async () => {
    const up = await upload(Buffer.from('c'), 'text/plain', 'c.txt');
    refsMod.addBlobRef(up.json.hash, PROJ_OWNER, null);
    const r = await fetch(`${baseUrl}/api/blobs/${up.json.hash}`, {
      headers: { 'X-Peer-Id': OUTSIDER_ID },
    });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('BLOB_ACCESS_DENIED');
  });

  it('rejects orphan blobs (uploaded but never attached) even for valid peer', async () => {
    const up = await upload(Buffer.from('d'), 'text/plain', 'd.txt');
    // NO addBlobRef call — blob is orphan.
    const r = await fetch(`${baseUrl}/api/blobs/${up.json.hash}`, {
      headers: { 'X-Peer-Id': INSIDER_ID },
    });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('BLOB_ACCESS_DENIED');
  });

  it('rejects unknown hash with 403 (no enumeration leak)', async () => {
    const r = await fetch(`${baseUrl}/api/blobs/${'0'.repeat(64)}`, {
      headers: { 'X-Peer-Id': INSIDER_ID },
    });
    // ACL runs before getBlob, so unknown hashes are indistinguishable
    // from "known but not yours". Prevents hash enumeration.
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe('BLOB_ACCESS_DENIED');
  });

  it('allows download when peer belongs to the blob project (200)', async () => {
    const up = await upload(Buffer.from('welcome'), 'application/json', 'x.json');
    refsMod.addBlobRef(up.json.hash, PROJ_OWNER, null);
    const r = await fetch(`${baseUrl}/api/blobs/${up.json.hash}`, {
      headers: { 'X-Peer-Id': INSIDER_ID },
    });
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    // Downgrade from public: blobs are peer-scoped now.
    expect(r.headers.get('cache-control')).toMatch(/^private,/);
    expect(await r.text()).toBe('welcome');
  });
});
