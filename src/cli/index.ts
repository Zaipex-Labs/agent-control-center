#!/usr/bin/env node
import { Command } from 'commander';
import { registerProjectCommand, registerProjectsCommand } from './commands/project.js';
import { registerStatusCommand } from './commands/status.js';
import { registerPeersCommand } from './commands/peers.js';
import { registerHistoryCommand } from './commands/history.js';
import { registerSharedCommand } from './commands/shared.js';
import { registerSendCommand } from './commands/send.js';
import { registerUpCommand } from './commands/up.js';
import { registerDownCommand } from './commands/down.js';

const program = new Command();

program
  .name('acc')
  .description('Agents Command Center — orchestrate AI agents for team development')
  .version('0.1.0');

registerProjectsCommand(program);
registerProjectCommand(program);
registerUpCommand(program);
registerDownCommand(program);
registerStatusCommand(program);
registerPeersCommand(program);
registerHistoryCommand(program);
registerSharedCommand(program);
registerSendCommand(program);

program.parse();
