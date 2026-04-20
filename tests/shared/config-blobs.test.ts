// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, vi } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('BLOBS_DIR config', () => {
  it('exposes BLOBS_DIR under ACC_HOME', async () => {
    const mod = await import('../../src/shared/config.js');
    expect(mod.BLOBS_DIR).toBe(join(mod.ACC_HOME, 'blobs'));
  });

  it('ensureDirectories creates blobs dir', async () => {
    const fake = mkdtempSync(join(tmpdir(), 'acc-home-'));
    const prev = process.env['ACC_HOME'];
    process.env['ACC_HOME'] = fake;
    // Vitest caches modules; reset so ACC_HOME is re-read at import time.
    vi.resetModules();
    const mod = await import('../../src/shared/config.js');
    mod.ensureDirectories();
    expect(existsSync(join(fake, 'blobs'))).toBe(true);
    if (prev != null) process.env['ACC_HOME'] = prev;
    else delete process.env['ACC_HOME'];
    rmSync(fake, { recursive: true, force: true });
    vi.resetModules();
  });
});
