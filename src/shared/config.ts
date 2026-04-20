// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const ACC_HOME = process.env['ACC_HOME'] ?? join(homedir(), '.zaipex-acc');
const rawPort = Number(process.env['ACC_PORT'] ?? 7899);
export const ACC_PORT = (rawPort >= 1 && rawPort <= 65535) ? rawPort : 7899;
export const ACC_HOST = '127.0.0.1';
export const ACC_DB = join(ACC_HOME, 'acc.db');
export const PROJECTS_DIR = join(ACC_HOME, 'projects');
export const TECHLEAD_DIR = join(ACC_HOME, 'techlead');
export const BLOBS_DIR = join(ACC_HOME, 'blobs');

export function techLeadCwd(projectName: string): string {
  return join(TECHLEAD_DIR, projectName);
}

export const BROKER_URL = `http://${ACC_HOST}:${ACC_PORT}`;

export const STALE_PEER_SECONDS = 60;
export const CLEANUP_INTERVAL_MS = 30_000;

export function ensureDirectories(): void {
  mkdirSync(ACC_HOME, { recursive: true });
  mkdirSync(PROJECTS_DIR, { recursive: true });
  mkdirSync(TECHLEAD_DIR, { recursive: true });
  mkdirSync(BLOBS_DIR, { recursive: true });
}
