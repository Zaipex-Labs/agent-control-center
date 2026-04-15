// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

import { registerProjectsCommand, registerProjectCommand } from '../../src/cli/commands/project.js';
import { registerUpCommand } from '../../src/cli/commands/up.js';
import { registerDownCommand } from '../../src/cli/commands/down.js';
import { registerStatusCommand } from '../../src/cli/commands/status.js';
import { registerHistoryCommand } from '../../src/cli/commands/history.js';
import { registerSharedCommand } from '../../src/cli/commands/shared.js';
import { registerPeersCommand } from '../../src/cli/commands/peers.js';
import { registerSendCommand } from '../../src/cli/commands/send.js';
import { registerConfigCommand } from '../../src/cli/commands/config.js';
import { registerAppCommand } from '../../src/cli/commands/app.js';

function newProgram(): Command {
  const p = new Command();
  p.exitOverride(); // don't process.exit on errors
  return p;
}

function findCommand(program: Command, name: string): Command | undefined {
  return program.commands.find(c => c.name() === name);
}

describe('CLI command registration', () => {
  it('registerProjectsCommand adds a "projects" command', () => {
    const program = newProgram();
    registerProjectsCommand(program);
    expect(findCommand(program, 'projects')).toBeDefined();
  });

  it('registerProjectCommand adds "project" with subcommands', () => {
    const program = newProgram();
    registerProjectCommand(program);
    const project = findCommand(program, 'project');
    expect(project).toBeDefined();
    const subNames = project!.commands.map(c => c.name()).sort();
    // At minimum these are defined
    for (const expected of ['create', 'add-agent', 'remove-agent', 'show']) {
      expect(subNames).toContain(expected);
    }
  });

  it('registerUpCommand adds an "up" command with options', () => {
    const program = newProgram();
    registerUpCommand(program);
    const cmd = findCommand(program, 'up');
    expect(cmd).toBeDefined();
    // Options helper exists; action is set
    expect(typeof cmd!.description()).toBe('string');
  });

  it('registerDownCommand adds a "down" command', () => {
    const program = newProgram();
    registerDownCommand(program);
    expect(findCommand(program, 'down')).toBeDefined();
  });

  it('registerStatusCommand adds a "status" command', () => {
    const program = newProgram();
    registerStatusCommand(program);
    expect(findCommand(program, 'status')).toBeDefined();
  });

  it('registerHistoryCommand adds a "history" command', () => {
    const program = newProgram();
    registerHistoryCommand(program);
    expect(findCommand(program, 'history')).toBeDefined();
  });

  it('registerSharedCommand adds a "shared" command', () => {
    const program = newProgram();
    registerSharedCommand(program);
    expect(findCommand(program, 'shared')).toBeDefined();
  });

  it('registerPeersCommand adds a "peers" command', () => {
    const program = newProgram();
    registerPeersCommand(program);
    expect(findCommand(program, 'peers')).toBeDefined();
  });

  it('registerSendCommand adds a "send" command', () => {
    const program = newProgram();
    registerSendCommand(program);
    expect(findCommand(program, 'send')).toBeDefined();
  });

  it('registerConfigCommand adds a "config" command', () => {
    const program = newProgram();
    registerConfigCommand(program);
    expect(findCommand(program, 'config')).toBeDefined();
  });

  it('registerAppCommand adds an "app" command', () => {
    const program = newProgram();
    registerAppCommand(program);
    expect(findCommand(program, 'app')).toBeDefined();
  });

  it('registering all commands at once does not collide', () => {
    const program = newProgram();
    registerProjectsCommand(program);
    registerProjectCommand(program);
    registerUpCommand(program);
    registerDownCommand(program);
    registerStatusCommand(program);
    registerHistoryCommand(program);
    registerSharedCommand(program);
    registerPeersCommand(program);
    registerSendCommand(program);
    registerConfigCommand(program);
    registerAppCommand(program);
    const names = program.commands.map(c => c.name());
    // No duplicates
    expect(new Set(names).size).toBe(names.length);
  });
});
