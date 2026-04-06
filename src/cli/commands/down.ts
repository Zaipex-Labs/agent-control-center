import { Command } from 'commander';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import { killTmuxSession, hasTmuxSession } from '../spawn.js';
import type { Peer } from '../../shared/types.js';
import { success, err, dim, warn } from '../ui.js';
import { t } from '../../shared/i18n/index.js';
import chalk from 'chalk';

function killProcess(pid: number): boolean {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

export function registerDownCommand(program: Command): void {
  program
    .command('down <project>')
    .description('Stop agents for a project')
    .action(async (projectName: string) => {
      const alive = await isBrokerAlive();

      let peers: Peer[] = [];
      if (alive) {
        peers = await brokerFetch<Peer[]>('/list-peers', {
          project_id: projectName,
          scope: 'project',
        });
      }

      let killed = 0;

      // Kill each agent process and unregister from broker
      for (const peer of peers) {
        const wasKilled = killProcess(peer.pid);
        if (wasKilled) {
          console.log(`  ${success(t('down.stopped'))} ${chalk.magenta(peer.role || peer.id)} ${dim(`(pid: ${peer.pid})`)}`);
          killed++;
        } else {
          console.log(`  ${dim(t('down.alreadyDead'))} ${chalk.magenta(peer.role || peer.id)} ${dim(`(pid: ${peer.pid})`)}`);
        }

        if (alive) {
          try {
            await brokerFetch('/unregister', { id: peer.id });
          } catch {
            // Best effort
          }
        }
      }

      // Kill tmux session if it exists
      if (hasTmuxSession(projectName)) {
        const sessionKilled = killTmuxSession(projectName);
        if (sessionKilled) {
          console.log(`  ${success(t('down.killed'))} tmux session ${dim(`acc-${projectName}`)}`);
        }
      }

      if (peers.length === 0 && !hasTmuxSession(projectName)) {
        console.log(warn(`  ${t('down.noAgents', { name: projectName })}`));
      } else {
        console.log(dim(`\n  ${t('down.summary', { count: String(killed), name: projectName })}`));
        console.log(dim(`  ${t('down.brokerNote')}`));
      }
    });
}
