// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeInterruptFile, pushMessage } from '../../src/server/channel.js';
import type { Message } from '../../src/shared/types.js';

describe('channel attachment footer', () => {
  it('writeInterruptFile appends an attachment footer when metadata has attachments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chan-'));
    try {
      writeInterruptFile(
        dir, 'frontend', 'message', 'look at this',
        '2026-04-20T12:00:00.000Z',
        JSON.stringify({
          attachments: [
            { hash: 'abc', mime: 'image/png', name: 's.png', size: 1024 },
          ],
        }),
      );
      const files = readdirSync(join(dir, '.acc-messages'));
      const body = readFileSync(join(dir, '.acc-messages', files[0]), 'utf-8');
      expect(body).toContain('[image: ~/.zaipex-acc/blobs/abc.png · image/png · 1.0 KB]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeInterruptFile without metadata still writes a valid file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chan-'));
    try {
      writeInterruptFile(dir, 'backend', 'message', 'plain text', '2026-04-20T12:00:00.000Z');
      const files = readdirSync(join(dir, '.acc-messages'));
      const body = readFileSync(join(dir, '.acc-messages', files[0]), 'utf-8');
      expect(body).toContain('plain text');
      expect(body).not.toContain('[image:');
      expect(body).not.toContain('[file:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pushMessage appends attachment footer to content before notifying', async () => {
    const sent: Array<{ method: string; params: any }> = [];
    const fakeServer = {
      notification: async (payload: any) => { sent.push(payload); },
    } as any;

    const msg: Message = {
      id: 1,
      project_id: 'p',
      from_id: 'a',
      to_id: 'b',
      type: 'message',
      text: 'mockup de login',
      metadata: JSON.stringify({
        attachments: [{ hash: 'deadbeef', mime: 'image/png', name: 'login.png', size: 2048 }],
      }),
      thread_id: null,
      sent_at: '2026-04-20T12:00:00.000Z',
      delivered: 0,
    };
    await pushMessage(fakeServer, msg, { from_id: 'a', from_role: 'frontend', from_cwd: '/tmp' });
    expect(sent).toHaveLength(1);
    expect(sent[0].params.content).toContain('mockup de login');
    expect(sent[0].params.content).toContain('[image: ~/.zaipex-acc/blobs/deadbeef.png');
  });
});
