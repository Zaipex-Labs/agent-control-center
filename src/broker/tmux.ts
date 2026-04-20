// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { execFileSync } from 'node:child_process';
import { assertSafeIdentifier } from '../shared/validate.js';

const log = (msg: string) => console.error(`[broker:tmux] ${msg}`);

// [H-3] — both arguments used to build `acc-<project>:<role>` targets
// are validated at the broker entry (handleAddAgent / handleUpdateProject /
// handleCreateProject). This helper re-asserts so any internal caller
// that slipped through without going via those handlers still fails
// safe rather than typing shell metacharacters into a tmux argv slot
// (or, before the execFileSync switch, into a shell template).
function assertTarget(projectId: string, targetRole: string): void {
  assertSafeIdentifier('project_id', projectId);
  assertSafeIdentifier('role', targetRole);
}

export function hasTmuxSession(projectId: string): boolean {
  try {
    assertSafeIdentifier('project_id', projectId);
    execFileSync('tmux', ['has-session', '-t', `acc-${projectId}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function tmuxNotify(
  projectId: string,
  targetRole: string,
  fromName: string,
  fromRole: string,
): boolean {
  try {
    assertTarget(projectId, targetRole);
  } catch (e) {
    log(`notify rejected: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }

  const sessionName = `acc-${projectId}`;
  if (!hasTmuxSession(projectId)) return false;

  const paneTarget = `${sessionName}:${targetRole}`;
  // fromName and fromRole flow into the notification TEXT, not into
  // shell argv. send-keys -l sends the string literally into the pane;
  // it's typed character-by-character, not interpreted as a shell
  // command until the pane's shell sees a newline. Even so, no shell
  // construction happens on the Node side with execFileSync.
  const notification = `Tienes un nuevo mensaje de ${fromName} (${fromRole}). Usa check_messages para leerlo.`;
  try {
    execFileSync('tmux', ['send-keys', '-t', paneTarget, '-l', notification], {
      stdio: 'pipe', timeout: 3000,
    });
    execFileSync('tmux', ['send-keys', '-t', paneTarget, 'Enter'], {
      stdio: 'pipe', timeout: 3000,
    });
    log(`notify OK to ${paneTarget} (from ${fromRole})`);
    return true;
  } catch (e) {
    log(`notify FAILED to ${paneTarget}: ${e}`);
    return false;
  }
}

export function tmuxInjectWithContext(
  projectId: string,
  targetRole: string,
  threadName: string,
  summary: string,
  fromName: string,
  fromRole: string,
): boolean {
  try {
    assertTarget(projectId, targetRole);
  } catch (e) {
    log(`inject-context rejected: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }

  const sessionName = `acc-${projectId}`;
  if (!hasTmuxSession(projectId)) return false;

  const paneTarget = `${sessionName}:${targetRole}`;

  try {
    // Send /clear to reset the agent context.
    execFileSync('tmux', ['send-keys', '-t', paneTarget, '/clear', 'Enter'], {
      stdio: 'pipe', timeout: 3000,
    });

    // Wait 2 seconds then inject the context message. The previous
    // implementation used `sh -c "sleep 2 && tmux send-keys …"` which
    // forked a shell we no longer trust; setTimeout in Node achieves
    // the same delay without any shell involvement.
    const notification = `[Hilo: ${threadName}] Resumen: ${summary}. Nuevo mensaje de ${fromName} (${fromRole}). Usa check_messages para leer el mensaje completo.`;
    setTimeout(() => {
      try {
        execFileSync('tmux', ['send-keys', '-t', paneTarget, '-l', notification], {
          stdio: 'pipe', timeout: 3000,
        });
        execFileSync('tmux', ['send-keys', '-t', paneTarget, 'Enter'], {
          stdio: 'pipe', timeout: 3000,
        });
      } catch (err) {
        log(`inject-context (delayed) FAILED to ${paneTarget}: ${err}`);
      }
    }, 2000);

    log(`inject-context OK to ${paneTarget} thread=${threadName} (from ${fromRole})`);
    return true;
  } catch (e) {
    log(`inject-context FAILED to ${paneTarget}: ${e}`);
    return false;
  }
}
