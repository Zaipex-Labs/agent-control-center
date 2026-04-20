// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDatabase } from '../../src/broker/database.js';

let server: Server;
let baseUrl: string;
let home: string;

beforeAll(async () => {
  // Shrink the blob size cap so the 413 test stays fast (1 KB instead of 100 MB).
  // Must be set BEFORE the first import of blobs.js so the module picks it up.
  process.env['ACC_MAX_BLOB_SIZE'] = '1024';
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'acc-blob-http-'));
  initDatabase(':memory:');
  const { setBlobsRoot } = await import('../../src/broker/blobs.js');
  setBlobsRoot(join(home, 'blobs'));
  const { handleUploadBlob, handleDownloadBlob } = await import('../../src/broker/handlers.js');
  server = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/blobs/upload') return handleUploadBlob(req, res);
    const m = req.url?.match(/^\/api\/blobs\/([a-f0-9]{64})$/);
    if (req.method === 'GET' && m) return handleDownloadBlob(m[1], res);
    res.writeHead(404); res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
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

describe('blob upload/download', () => {
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

  it('GET returns bytes with correct Content-Type', async () => {
    const up = await upload(Buffer.from('payload'), 'application/json', 'x.json');
    const r = await fetch(`${baseUrl}/api/blobs/${up.json.hash}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await r.text()).toBe('payload');
  });

  it('GET returns structured 404 for unknown hash', async () => {
    const r = await fetch(`${baseUrl}/api/blobs/${'0'.repeat(64)}`);
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.code).toBe('BLOB_NOT_FOUND');
    expect(body.hash).toBe('0'.repeat(64));
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
