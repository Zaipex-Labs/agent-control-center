import { Command } from 'commander';
import chalk from 'chalk';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import type { GetHistoryResponse } from '../../shared/types.js';
import { heading, dim, err } from '../ui.js';
import { t } from '../../shared/i18n/index.js';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history <project>')
    .description(t('cmd.history'))
    .option('-r, --role <role>', t('cmd.historyRole'))
    .option('-l, --last <n>', t('cmd.historyLast'), '20')
    .action(async (project: string, opts: { role?: string; last: string }) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err(`  ${t('history.brokerNotRunning')}`));
        return;
      }

      const resp = await brokerFetch<GetHistoryResponse>('/api/get-history', {
        project_id: project,
        role: opts.role,
        limit: parseInt(opts.last, 10),
      });

      if (resp.messages.length === 0) {
        console.log(dim(`  ${t('history.noMessages')}`));
        return;
      }

      console.log(heading(`\n  ${t('history.heading', { project })}\n`));

      // History comes in DESC order, reverse for chronological display
      const messages = [...resp.messages].reverse();
      for (const msg of messages) {
        const time = new Date(msg.sent_at).toLocaleTimeString();
        const from = chalk.magenta(msg.from_role || msg.from_id);
        const to = chalk.cyan(msg.to_role || msg.to_id);
        const typeTag = msg.type !== 'message' ? dim(` [${msg.type}]`) : '';

        console.log(`  ${dim(time)} ${from} ${dim('→')} ${to}${typeTag}`);
        console.log(`    ${msg.text}`);
      }
      console.log();
    });
}
