import { Command } from 'commander';
import chalk from 'chalk';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import type { Peer } from '../../shared/types.js';
import { heading, dim, label, err } from '../ui.js';

export function registerPeersCommand(program: Command): void {
  program
    .command('peers [project]')
    .description('List active peers')
    .action(async (project?: string) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err('  Broker is not running.'));
        return;
      }

      const peers = project
        ? await brokerFetch<Peer[]>('/list-peers', { project_id: project, scope: 'project' })
        : await brokerFetch<Peer[]>('/list-peers', { project_id: '', scope: 'machine' });

      if (peers.length === 0) {
        console.log(dim('  No active peers.'));
        return;
      }

      console.log(heading(`\n  Active Peers${project ? ` (${project})` : ''}\n`));
      for (const p of peers) {
        const roleStr = p.role ? chalk.magenta(p.role) : dim('(no role)');
        console.log(`  ${label(p.id)}  ${roleStr}  ${dim(p.agent_type)}  pid:${p.pid}`);
        console.log(`    ${dim('cwd:')} ${p.cwd}`);
        if (p.git_branch) {
          console.log(`    ${dim('branch:')} ${p.git_branch}`);
        }
        if (p.summary) {
          console.log(`    ${dim('summary:')} ${p.summary}`);
        }
      }
      console.log();
    });
}
