// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase, getDb } from '../../src/broker/database.js';

describe('blob_refs schema', () => {
  beforeEach(() => initDatabase(':memory:'));

  it('creates blob_refs table with expected columns', () => {
    const cols = getDb().prepare("PRAGMA table_info(blob_refs)").all() as Array<{ name: string; type: string }>;
    const names = cols.map(c => c.name).sort();
    expect(names).toEqual(['blob_hash', 'created_at', 'id', 'message_id', 'project_id']);
  });

  it('indexes blob_hash, project_id, message_id for fast lookup', () => {
    const idx = getDb().prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='blob_refs'",
    ).all() as Array<{ name: string }>;
    const names = idx.map(i => i.name);
    expect(names).toContain('idx_blob_refs_hash');
    expect(names).toContain('idx_blob_refs_project');
    expect(names).toContain('idx_blob_refs_message');
  });
});
