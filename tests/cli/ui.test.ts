// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  heading,
  success,
  warn,
  err,
  dim,
  label,
  printProject,
  printProjectList,
} from '../../src/cli/ui.js';
import type { ProjectConfig } from '../../src/shared/types.js';

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('ui color helpers', () => {
  it('heading/success/warn/err/dim/label wrap their input', () => {
    for (const fn of [heading, success, warn, err, dim, label]) {
      const out = fn('hello');
      expect(stripAnsi(out)).toBe('hello');
    }
  });
});

describe('printProject / printProjectList', () => {
  let logged: string[] = [];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logged = [];
    spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  const project: ProjectConfig = {
    name: 'demo',
    description: 'A test project',
    created_at: '2026-04-14T10:00:00Z',
    agents: [
      {
        role: 'backend',
        cwd: '/tmp/back',
        agent_cmd: 'claude',
        agent_args: [],
        instructions: 'short',
      },
      {
        role: 'frontend',
        cwd: '/tmp/front',
        agent_cmd: 'bash',
        agent_args: ['-i'],
      },
    ],
  };

  it('printProject shows name, description, and each agent', () => {
    printProject(project);
    const all = stripAnsi(logged.join('\n'));
    expect(all).toContain('demo');
    expect(all).toContain('A test project');
    expect(all).toContain('backend');
    expect(all).toContain('/tmp/back');
    expect(all).toContain('frontend');
    expect(all).toContain('/tmp/front');
    // Custom agent_cmd should show the cmd line
    expect(all).toContain('bash -i');
  });

  it('printProject handles empty agent list', () => {
    printProject({ ...project, agents: [] });
    const all = stripAnsi(logged.join('\n'));
    expect(all).toContain('demo');
  });

  it('printProject truncates long instructions to 80 chars + ellipsis', () => {
    const long = 'x'.repeat(200);
    printProject({
      ...project,
      agents: [
        { role: 'qa', cwd: '/tmp/qa', agent_cmd: 'claude', agent_args: [], instructions: long },
      ],
    });
    const all = stripAnsi(logged.join('\n'));
    expect(all).toContain('...');
    expect(all).not.toContain(long);
  });

  it('printProjectList shows a placeholder for empty list', () => {
    printProjectList([]);
    expect(logged.length).toBeGreaterThan(0);
  });

  it('printProjectList lists each project', () => {
    printProjectList([project, { ...project, name: 'other', agents: [] }]);
    const all = stripAnsi(logged.join('\n'));
    expect(all).toContain('demo');
    expect(all).toContain('other');
  });
});
