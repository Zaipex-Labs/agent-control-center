// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// v0.3.3 PRE-4 (MED-7a) — Per-(project, role) spawn-phase state held in
// the broker's memory. The FASE C-1 v0.3.2 broadcast-only design loses
// events that fire BEFORE the dashboard's WS connection finishes its
// handshake. In practice that's the first agent (typically Da Vinci as
// Tech Lead), whose chip stays at `pty ✓ claude — broker —` even though
// the broker actually logged all three phases.
//
// Fix: every site that broadcasts an `agent:spawning` event also records
// the same phase here. A new HTTP endpoint exposes the snapshot. The
// dashboard fetches it once on mount and OR-merges with live WS events,
// closing the race.
//
// Lifecycle:
//   - recordSpawnPhase(...) called by terminal.ts (pty_ready, mcp_ready)
//     and peers.ts (registered).
//   - clearSpawnState(projectId) called by handleProjectDown — the next
//     "Encender" cycle starts from a clean slate.
//   - In-memory only. Broker restart loses state; dashboard's WS reconnect
//     plus a fresh snapshot fetch re-syncs.

import type { SpawnPhase } from '../shared/wire.js';

export interface PhaseSet {
  pty_ready: boolean;
  mcp_ready: boolean;
  registered: boolean;
}

export type ProjectPhases = Record<string, PhaseSet>;

const EMPTY: PhaseSet = Object.freeze({ pty_ready: false, mcp_ready: false, registered: false });

const spawnStates = new Map<string, Map<string, PhaseSet>>();

export function recordSpawnPhase(projectId: string, role: string, phase: SpawnPhase): void {
  if (!projectId || !role) return;
  if (phase !== 'pty_ready' && phase !== 'mcp_ready' && phase !== 'registered') return;
  let proj = spawnStates.get(projectId);
  if (!proj) {
    proj = new Map();
    spawnStates.set(projectId, proj);
  }
  let pset = proj.get(role);
  if (!pset) {
    pset = { ...EMPTY };
    proj.set(role, pset);
  }
  pset[phase] = true;
}

export function getSpawnState(projectId: string): ProjectPhases {
  const proj = spawnStates.get(projectId);
  if (!proj) return {};
  const result: ProjectPhases = {};
  for (const [role, pset] of proj.entries()) {
    result[role] = { ...pset };
  }
  return result;
}

export function clearSpawnState(projectId: string): void {
  spawnStates.delete(projectId);
}

// Test-only helper — broker process keeps state for its lifetime;
// tests need a global wipe between scenarios. Not exported via
// any public re-export; only the tests import directly from this
// module.
export function _resetSpawnStateForTests(): void {
  spawnStates.clear();
}
