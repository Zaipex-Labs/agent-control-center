import { Command } from 'commander';
import chalk from 'chalk';
import { brokerFetch, brokerGet, isBrokerAlive } from '../../server/broker-client.js';
import type { HealthResponse, Peer } from '../../shared/types.js';
import { heading, dim, label, err, success } from '../ui.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status [project]')
    .description('Show broker status and active peers')
    .action(async (project?: string) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err('  Broker is not running.'));
        console.log(dim('  Start it with: acc broker start'));
        return;
      }

      const health = await brokerGet<HealthResponse>('/health');
      console.log(heading('\n  Broker Status\n'));
      console.log(`  ${label('Status:')}  ${success('online')}`);
      console.log(`  ${label('Peers:')}   ${health.peers}`);
      console.log(`  ${label('Pending:')} ${health.pending_messages} message(s)`);

      if (project) {
        const peers = await brokerFetch<Peer[]>('/list-peers', {
          project_id: project,
          scope: 'project',
        });

        if (peers.length === 0) {
          console.log(dim(`\n  No active peers in project "${project}".`));
        } else {
          console.log(heading(`\n  Peers in "${project}"\n`));
          for (const p of peers) {
            const age = timeSince(p.last_seen);
            console.log(`  ${chalk.magenta(p.role || '(no role)')}  ${dim(p.id)}  pid:${p.pid}  ${dim(age)}`);
            if (p.summary) {
              console.log(`    ${dim(p.summary)}`);
            }
          }
        }
      }
      console.log();
    });
}

function timeSince(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
