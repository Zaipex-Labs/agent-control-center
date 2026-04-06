import { Command } from 'commander';
import chalk from 'chalk';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import type { GetHistoryResponse } from '../../shared/types.js';
import { heading, dim, err } from '../ui.js';

export function registerHistoryCommand(program: Command): void {
  program
    .command('history <project>')
    .description('Show message history for a project')
    .option('-r, --role <role>', 'Filter by role')
    .option('-l, --last <n>', 'Number of messages to show', '20')
    .action(async (project: string, opts: { role?: string; last: string }) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err('  Broker is not running.'));
        return;
      }

      const resp = await brokerFetch<GetHistoryResponse>('/get-history', {
        project_id: project,
        role: opts.role,
        limit: parseInt(opts.last, 10),
      });

      if (resp.messages.length === 0) {
        console.log(dim('  No messages found.'));
        return;
      }

      console.log(heading(`\n  Message History (${project})\n`));

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
