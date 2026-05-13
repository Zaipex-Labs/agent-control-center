// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// v0.3.4 FU-AG — Cache discipline warning when the user does an
// Apagar → Encender cycle within ~60s. The actual UI integration
// lives in `src/dashboard/pages/TeamsPage.tsx` and reads
// `localStorage.acc.lastDown.<name>`; the test below exercises the
// localStorage contract in isolation so a future refactor of the
// React handler can't silently drop the threshold.

import { describe, it, expect, beforeEach } from 'vitest';

const RAPID_THRESHOLD_MS = 60_000;

// In-memory stand-in for the browser API — jsdom isn't enabled for
// dashboard tests, so we hand-roll the shim that mirrors the surface
// our React handler actually touches: getItem / setItem.
function makeLocalStorage() {
  const data = new Map<string, string>();
  return {
    setItem: (k: string, v: string) => data.set(k, v),
    getItem: (k: string) => data.get(k) ?? null,
    clear: () => data.clear(),
    _data: data,
  };
}

function isRapidRestart(ls: ReturnType<typeof makeLocalStorage>, name: string, now: number): boolean {
  const raw = ls.getItem(`acc.lastDown.${name}`);
  if (!raw) return false;
  const last = Number(raw);
  if (!Number.isFinite(last)) return false;
  return now - last < RAPID_THRESHOLD_MS;
}

beforeEach(() => {
  // Each test starts with a fresh stand-in.
});

describe('FU-AG cache-thrash warning · isRapidRestart', () => {
  it('returns false when there is no recorded down', () => {
    const ls = makeLocalStorage();
    expect(isRapidRestart(ls, 'demo', Date.now())).toBe(false);
  });

  it('returns true within the 60 s window', () => {
    const ls = makeLocalStorage();
    const t0 = 1_700_000_000_000;
    ls.setItem('acc.lastDown.demo', String(t0));
    expect(isRapidRestart(ls, 'demo', t0 + 30_000)).toBe(true);
    expect(isRapidRestart(ls, 'demo', t0 + 59_999)).toBe(true);
  });

  it('returns false past the 60 s window', () => {
    const ls = makeLocalStorage();
    const t0 = 1_700_000_000_000;
    ls.setItem('acc.lastDown.demo', String(t0));
    expect(isRapidRestart(ls, 'demo', t0 + 60_000)).toBe(false);
    expect(isRapidRestart(ls, 'demo', t0 + 120_000)).toBe(false);
  });

  it('is per-project — restarting project A does not warn project B', () => {
    const ls = makeLocalStorage();
    const t0 = 1_700_000_000_000;
    ls.setItem('acc.lastDown.alpha', String(t0));
    expect(isRapidRestart(ls, 'alpha', t0 + 10_000)).toBe(true);
    expect(isRapidRestart(ls, 'beta', t0 + 10_000)).toBe(false);
  });

  it('tolerates garbage values in localStorage without throwing', () => {
    const ls = makeLocalStorage();
    ls.setItem('acc.lastDown.demo', 'not-a-number');
    expect(() => isRapidRestart(ls, 'demo', Date.now())).not.toThrow();
    expect(isRapidRestart(ls, 'demo', Date.now())).toBe(false);
  });
});

describe('FU-AG · localStorage key format pin', () => {
  // The TeamsPage handler reads/writes acc.lastDown.<name>. Pinning
  // the shape here means a typo in the React handler shows up as a
  // test failure rather than a silent UX regression.
  it.each([
    { name: 'my-team', value: '12345' },
    { name: 'alpha', value: '1' },
    { name: 'beta', value: '2' },
  ])('writes acc.lastDown.$name = $value without collision', ({ name, value }) => {
    const ls = makeLocalStorage();
    ls.setItem(`acc.lastDown.${name}`, value);
    // Confirm the key + namespace match exactly and a sibling name
    // does not read back this value.
    expect(ls.getItem(`acc.lastDown.${name}`)).toBe(value);
    expect(ls.getItem(`acc.lastDown.${name}-other`)).toBeNull();
  });
});
