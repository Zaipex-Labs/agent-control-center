// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

// FASE C-1 (v0.3.2). Per-agent spawn-phase state for the "Encender"
// checklist on TeamsPage. The broker emits one `agent:spawning`
// event per phase (pty_ready → mcp_ready → registered); this hook
// folds them into a `Record<role, Set<phase>>` the UI can render
// directly.

import { useEffect, useState } from 'react';
import { useWebSocket, isEvent } from './useWebSocket';
import type { SpawnPhase, AgentSpawningEvent } from '../../shared/wire';

// Re-export so consumers don't need a second import.
export type { SpawnPhase };

export type PhaseSet = Record<SpawnPhase, boolean>;
export type SpawnPhases = Record<string, PhaseSet>;

const EMPTY_PHASES: PhaseSet = {
  pty_ready: false,
  mcp_ready: false,
  registered: false,
};

export function useSpawnPhases(
  projectId: string | undefined,
  active: boolean,
): SpawnPhases {
  const [phases, setPhases] = useState<SpawnPhases>({});
  const { lastEvent } = useWebSocket(projectId);

  useEffect(() => {
    if (!lastEvent || !isEvent(lastEvent, 'agent:spawning')) return;
    const { role, phase } = lastEvent.data as Partial<AgentSpawningEvent>;
    if (!role || !phase) return;
    if (phase !== 'pty_ready' && phase !== 'mcp_ready' && phase !== 'registered') return;
    setPhases(prev => {
      const current = prev[role] ?? EMPTY_PHASES;
      // Idempotent: once a phase flips to true it stays true within the
      // current spawn cycle. The next "Encender" cycle resets state via
      // the `active` flag below.
      if (current[phase]) return prev;
      return {
        ...prev,
        [role]: { ...current, [phase]: true },
      };
    });
  }, [lastEvent]);

  // Reset whenever the project changes OR the dashboard's `starting`
  // gate goes low. `active=true` means "the user just pressed
  // Encender"; flipping back to false (boot finished, user navigated
  // away, etc.) wipes the state so the next press starts clean.
  useEffect(() => {
    if (!active) {
      setPhases({});
    }
  }, [active, projectId]);

  return phases;
}

// Convenience selector used by render code: 3 booleans → 0/1/2/3.
export function phaseCount(p: PhaseSet | undefined): number {
  if (!p) return 0;
  return (p.pty_ready ? 1 : 0) + (p.mcp_ready ? 1 : 0) + (p.registered ? 1 : 0);
}
