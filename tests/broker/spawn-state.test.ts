// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// v0.3.3 PRE-4 (MED-7a) — Unit + race-regression tests for the
// per-(project, role) spawn-phase state store and the
// `recordSpawnPhase` → `getSpawnState` → snapshot read path.
//
// Why we care about a regression test:
//   The original bug was the dashboard's WS handshake racing the
//   broker's `pty_ready` emit. Under instrumentation we confirmed
//   that 100% of `pty_ready` frames were dropped by broadcast()
//   because the client wasn't yet OPEN. The fix is for the broker
//   to keep an authoritative state and the client to fetch it on
//   mount. This test pins:
//     1. recordSpawnPhase mutates the store correctly (idempotent,
//        false→true only, isolated by project).
//     2. getSpawnState returns a stable shape the dashboard can OR-merge.
//     3. clearSpawnState wipes state on project up/down boundary.
//     4. Race regression: if the snapshot is queried AFTER an event
//        was recorded but BEFORE the WS would have delivered it, the
//        snapshot still has the phase set to true.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordSpawnPhase,
  getSpawnState,
  clearSpawnState,
  _resetSpawnStateForTests,
} from '../../src/broker/spawn-state.js';

beforeEach(() => {
  _resetSpawnStateForTests();
});

describe('spawn-state — recordSpawnPhase + getSpawnState', () => {
  it('returns {} for unknown project', () => {
    expect(getSpawnState('no-such-project')).toEqual({});
  });

  it('records a single phase for a role', () => {
    recordSpawnPhase('proj', 'backend', 'pty_ready');
    expect(getSpawnState('proj')).toEqual({
      backend: { pty_ready: true, mcp_ready: false, registered: false },
    });
  });

  it('records all three phases for the same role', () => {
    recordSpawnPhase('proj', 'backend', 'pty_ready');
    recordSpawnPhase('proj', 'backend', 'mcp_ready');
    recordSpawnPhase('proj', 'backend', 'registered');
    expect(getSpawnState('proj')).toEqual({
      backend: { pty_ready: true, mcp_ready: true, registered: true },
    });
  });

  it('records multiple roles independently within the same project', () => {
    recordSpawnPhase('proj', 'backend', 'pty_ready');
    recordSpawnPhase('proj', 'frontend', 'mcp_ready');
    expect(getSpawnState('proj')).toEqual({
      backend: { pty_ready: true, mcp_ready: false, registered: false },
      frontend: { pty_ready: false, mcp_ready: true, registered: false },
    });
  });

  it('isolates state across projects', () => {
    recordSpawnPhase('p1', 'backend', 'pty_ready');
    recordSpawnPhase('p2', 'backend', 'registered');
    expect(getSpawnState('p1')).toEqual({
      backend: { pty_ready: true, mcp_ready: false, registered: false },
    });
    expect(getSpawnState('p2')).toEqual({
      backend: { pty_ready: false, mcp_ready: false, registered: true },
    });
  });

  it('is idempotent — recording the same phase twice is a no-op', () => {
    recordSpawnPhase('proj', 'backend', 'pty_ready');
    const first = getSpawnState('proj');
    recordSpawnPhase('proj', 'backend', 'pty_ready');
    expect(getSpawnState('proj')).toEqual(first);
  });

  it('returns a fresh object — mutating the result does not corrupt the store', () => {
    recordSpawnPhase('proj', 'backend', 'pty_ready');
    const snap = getSpawnState('proj');
    snap.backend.mcp_ready = true; // try to mutate the caller's copy
    // The store keeps its own value
    expect(getSpawnState('proj').backend.mcp_ready).toBe(false);
  });

  it('silently ignores empty projectId / empty role / unknown phase', () => {
    recordSpawnPhase('', 'backend', 'pty_ready');
    recordSpawnPhase('proj', '', 'pty_ready');
    recordSpawnPhase('proj', 'backend', 'nonsense' as never);
    expect(getSpawnState('proj')).toEqual({});
  });
});

describe('spawn-state — clearSpawnState', () => {
  it('wipes state for a project after a cycle ends', () => {
    recordSpawnPhase('proj', 'backend', 'pty_ready');
    recordSpawnPhase('proj', 'backend', 'mcp_ready');
    clearSpawnState('proj');
    expect(getSpawnState('proj')).toEqual({});
  });

  it('does not touch other projects when clearing one', () => {
    recordSpawnPhase('p1', 'backend', 'pty_ready');
    recordSpawnPhase('p2', 'frontend', 'mcp_ready');
    clearSpawnState('p1');
    expect(getSpawnState('p1')).toEqual({});
    expect(getSpawnState('p2')).toEqual({
      frontend: { pty_ready: false, mcp_ready: true, registered: false },
    });
  });

  it('clearing an unknown project is a no-op', () => {
    expect(() => clearSpawnState('never-existed')).not.toThrow();
  });
});

describe('spawn-state — race regression (MED-7a)', () => {
  // The original race: broker emits pty_ready at ~50ms post-spawn;
  // the dashboard's WS handshake hasn't completed yet, so
  // broadcast() drops the frame. The dashboard later fetches
  // /api/project/:id/spawn-state to recover.
  //
  // This test simulates that flow: emit (record) the phase first,
  // then query the snapshot. The phase MUST appear regardless of
  // whether any WS client was attached at emit time.

  it('snapshot has pty_ready=true even if the event was "emitted" before any client was attached', () => {
    // Simulating broadcast() at terminal.ts:256 — recordSpawnPhase
    // runs first, then broadcast() finds no OPEN clients (in this
    // test there is no broker at all). Later the client connects
    // and fetches the snapshot:
    recordSpawnPhase('proj-race', 'backend', 'pty_ready');
    // No WS broadcast happened (irrelevant for state storage anyway).
    // Snapshot fetch by the client:
    const snap = getSpawnState('proj-race');
    expect(snap).toEqual({
      backend: { pty_ready: true, mcp_ready: false, registered: false },
    });
  });

  it('snapshot reflects intermediate phases — client fetching after only pty_ready was emitted', () => {
    // Race window: broker has emitted pty_ready but not mcp_ready.
    // The client connects late; the snapshot should show partial
    // progress.
    recordSpawnPhase('proj-mid', 'backend', 'pty_ready');
    // mcp_ready and registered haven't fired yet — they'll come
    // through the WS once the client subscribes.
    expect(getSpawnState('proj-mid')).toEqual({
      backend: { pty_ready: true, mcp_ready: false, registered: false },
    });
  });

  it('OR-merge invariant — combining a partial snapshot with WS-folded state never loses a true', () => {
    // The dashboard hook's mergePhases(prev, snapshot) only flips
    // false→true. This test checks the broker-side invariant the
    // client relies on: phases never regress (clearSpawnState is the
    // only way to drop a `true`, and that happens at project boundary).
    recordSpawnPhase('proj-merge', 'backend', 'mcp_ready');
    recordSpawnPhase('proj-merge', 'backend', 'pty_ready');
    // Even though pty_ready was recorded AFTER mcp_ready, both stay.
    expect(getSpawnState('proj-merge')).toEqual({
      backend: { pty_ready: true, mcp_ready: true, registered: false },
    });
  });

  it('after clearSpawnState the next cycle starts fresh — no leftover trues from previous run', () => {
    recordSpawnPhase('proj-cycle', 'backend', 'pty_ready');
    recordSpawnPhase('proj-cycle', 'backend', 'mcp_ready');
    recordSpawnPhase('proj-cycle', 'backend', 'registered');
    clearSpawnState('proj-cycle');
    expect(getSpawnState('proj-cycle')).toEqual({});
    // Second cycle:
    recordSpawnPhase('proj-cycle', 'backend', 'pty_ready');
    expect(getSpawnState('proj-cycle')).toEqual({
      backend: { pty_ready: true, mcp_ready: false, registered: false },
    });
  });
});
