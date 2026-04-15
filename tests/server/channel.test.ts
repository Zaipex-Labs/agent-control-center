// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pushMessage, writeInterruptFile, type SenderInfo } from '../../src/server/channel.js';
import type { Message } from '../../src/shared/types.js';

describe('writeInterruptFile', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'acc-channel-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates .acc-messages dir and writes a markdown file', () => {
    writeInterruptFile(dir, 'backend', 'message', 'hola', '2026-04-14T10:30:00.000Z');
    const msgDir = join(dir, '.acc-messages');
    const files = readdirSync(msgDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/\.md$/);
    expect(files[0]).toContain('backend');
    const content = readFileSync(join(msgDir, files[0]!), 'utf-8');
    expect(content).toContain('backend');
    expect(content).toContain('(message)');
    expect(content).toContain('hola');
    expect(content).toContain('2026-04-14T10:30:00.000Z');
  });

  it('sanitizes role names with unsafe characters', () => {
    writeInterruptFile(dir, 'back/end:weird', 'notification', 'x', '2026-04-14T11:00:00.000Z');
    const files = readdirSync(join(dir, '.acc-messages'));
    const newFile = files.find(f => f.includes('back_end_weird'));
    expect(newFile).toBeDefined();
  });

  it('replaces colons and dots in the timestamp for a valid filename', () => {
    writeInterruptFile(dir, 'qa', 'message', 'hi', '2026-04-14T12:00:00.000Z');
    const files = readdirSync(join(dir, '.acc-messages'));
    // filename should not contain raw colons (bad on Windows and some FS)
    for (const f of files) {
      expect(f).not.toMatch(/:/);
    }
  });
});

describe('pushMessage', () => {
  it('calls mcpServer.notification with the expected method and payload', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const fakeMcp = {
      notification: async (payload: { method: string; params: unknown }) => {
        calls.push(payload);
      },
    };

    const msg: Message = {
      id: 1,
      from_id: 'abc',
      to_id: 'def',
      type: 'message',
      text: 'hi there',
      metadata: null,
      sent_at: '2026-04-14T10:00:00.000Z',
      thread_id: null,
    } as Message;

    const sender: SenderInfo = {
      from_id: 'abc',
      from_role: 'backend',
      from_cwd: '/tmp/repo',
    };

    // The real McpServer has extra methods; cast is fine for this unit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pushMessage(fakeMcp as any, msg, sender);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('notifications/claude/channel');
    const params = calls[0]!.params as { content: string; meta: Record<string, string> };
    expect(params.content).toBe('hi there');
    expect(params.meta.from_id).toBe('abc');
    expect(params.meta.from_role).toBe('backend');
    expect(params.meta.from_cwd).toBe('/tmp/repo');
    expect(params.meta.sent_at).toBe('2026-04-14T10:00:00.000Z');
  });
});
