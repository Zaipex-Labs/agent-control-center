// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import {
  activeThreadStorageKey,
  persistActiveThread,
} from '../../src/dashboard/hooks/useThreads';
import type { Thread } from '../../src/dashboard/lib/types';

function makeThread(id: string): Thread {
  return {
    id,
    project_id: 'p1',
    name: `t-${id}`,
    status: 'active',
    summary: '',
    created_by: 'user',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function inMemoryStorage() {
  const data = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
    get: (k: string) => data.get(k),
    has: (k: string) => data.has(k),
    snapshot: () => new Map(data),
  };
}

describe('Q-9 · persistActiveThread', () => {
  it('writes the thread id when given a Thread', () => {
    const s = inMemoryStorage();
    const t = makeThread('abc');
    persistActiveThread(s, 'p1', t);
    expect(s.get(activeThreadStorageKey('p1'))).toBe('abc');
  });

  it('removes the key when given null', () => {
    const s = inMemoryStorage();
    s.setItem(activeThreadStorageKey('p1'), 'abc');
    persistActiveThread(s, 'p1', null);
    expect(s.has(activeThreadStorageKey('p1'))).toBe(false);
  });

  it('throws when given an updater function (the Q-9 regression case)', () => {
    const s = inMemoryStorage();
    // Simulating the bug: callsite mistakenly passes (cur) => null
    const updater = ((cur: Thread | null) => cur) as unknown as Thread;
    expect(() => persistActiveThread(s, 'p1', updater)).toThrow(/must be Thread \| null/);
    // And critically: localStorage was NOT polluted with the string "undefined"
    expect(s.has(activeThreadStorageKey('p1'))).toBe(false);
  });

  it('namespaces by projectId', () => {
    const s = inMemoryStorage();
    persistActiveThread(s, 'p1', makeThread('x'));
    persistActiveThread(s, 'p2', makeThread('y'));
    expect(s.get(activeThreadStorageKey('p1'))).toBe('x');
    expect(s.get(activeThreadStorageKey('p2'))).toBe('y');
  });
});
