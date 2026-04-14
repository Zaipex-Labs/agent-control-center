#!/usr/bin/env node
import { Command, Help } from 'commander';
import { registerProjectCommand, registerProjectsCommand } from './commands/project.js';
import { registerStatusCommand } from './commands/status.js';
import { registerPeersCommand } from './commands/peers.js';
import { registerHistoryCommand } from './commands/history.js';
import { registerSharedCommand } from './commands/shared.js';
import { registerSendCommand } from './commands/send.js';
import { registerUpCommand } from './commands/up.js';
import { registerDownCommand } from './commands/down.js';
import { registerConfigCommand } from './commands/config.js';
import { registerAppCommand } from './commands/app.js';
import { t } from '../shared/i18n/index.js';

class LocalizedHelp extends Help {
  formatHelp(cmd: Command, helper: Help): string {
    return super.formatHelp(cmd, helper)
      .replace(/^Usage:/m, t('cli.usage'))
      .replace(/^Options:/m, t('cli.options'))
      .replace(/^Commands:/m, t('cli.commands'))
      .replace(/^Arguments:/m, t('cli.arguments'));
  }
}

function applyLocalizedHelp(cmd: Command): void {
  cmd.createHelp = () => Object.assign(new LocalizedHelp(), cmd.configureHelp());
  cmd.helpOption('-h, --help', t('cli.helpOpt'));
  for (const sub of cmd.commands) applyLocalizedHelp(sub);
}

const program = new Command();

program
  .name('acc')
  .description(t('cli.description'))
  .version('0.1.0', '-V, --version', t('cli.versionOpt'))
  .addHelpCommand('help [command]', t('cli.helpOpt'));

registerProjectsCommand(program);
registerProjectCommand(program);
registerUpCommand(program);
registerDownCommand(program);
registerStatusCommand(program);
registerPeersCommand(program);
registerHistoryCommand(program);
registerSharedCommand(program);
registerSendCommand(program);
registerConfigCommand(program);
registerAppCommand(program);

applyLocalizedHelp(program);

program.parse();
