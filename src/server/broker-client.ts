// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROKER_URL, ACC_HOST, ACC_PORT } from '../shared/config.js';
import { resolveEntryPoint } from '../shared/utils.js';

export function brokerFetch<T>(path: string, body: unknown): Promise<T> {
  return new Promise((resolve_, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        hostname: ACC_HOST,
        port: ACC_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString();
            resolve_(JSON.parse(text) as T);
          } catch (err) {
            reject(new Error(`Invalid JSON from broker ${path}: ${err}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

export function brokerGet<T>(path: string): Promise<T> {
  return new Promise((resolve_, reject) => {
    const req = request(
      {
        hostname: ACC_HOST,
        port: ACC_PORT,
        path,
        method: 'GET',
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString();
            resolve_(JSON.parse(text) as T);
          } catch (err) {
            reject(new Error(`Invalid JSON from broker GET ${path}: ${err}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export function isBrokerAlive(): Promise<boolean> {
  return new Promise((resolve_) => {
    const req = request(
      {
        hostname: ACC_HOST,
        port: ACC_PORT,
        path: '/health',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        // Drain response
        res.resume();
        resolve_(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve_(false));
    req.on('timeout', () => {
      req.destroy();
      resolve_(false);
    });
    req.end();
  });
}

export async function ensureBroker(): Promise<void> {
  if (await isBrokerAlive()) return;

  // Resolve the broker entry point relative to this file (.ts for dev, .js for build)
  const thisDir = resolve(fileURLToPath(import.meta.url), '..');
  const brokerEntry = resolveEntryPoint(thisDir, '..', 'broker', 'index.ts');
  const useTsx = brokerEntry.endsWith('.ts');

  const child = spawn(useTsx ? 'npx' : 'node', useTsx ? ['tsx', brokerEntry] : [brokerEntry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  // Wait up to 6s for broker to respond
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (await isBrokerAlive()) return;
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(
    `Broker did not start within 6s on ${BROKER_URL}. ` +
    `Try starting it manually: npx tsx src/broker/index.ts`,
  );
}
