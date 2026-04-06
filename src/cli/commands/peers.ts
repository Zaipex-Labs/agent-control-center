import { Command } from 'commander';
import chalk from 'chalk';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import type { Peer } from '../../shared/types.js';
import { heading, dim, label, err } from '../ui.js';
import { t } from '../../shared/i18n/index.js';

export function registerPeersCommand(program: Command): void {
  program
    .command('peers [project]')
    .description('List active peers')
    .action(async (project?: string) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err(`  ${t('peers.brokerNotRunning')}`));
        return;
      }

      const peers = project
        ? await brokerFetch<Peer[]>('/list-peers', { project_id: project, scope: 'project' })
        : await brokerFetch<Peer[]>('/list-peers', { project_id: '', scope: 'machine' });

      if (peers.length === 0) {
        console.log(dim(`  ${t('peers.noPeers')}`));
        return;
      }

      const headingText = project
        ? t('peers.headingProject', { project })
        : t('peers.heading');
      console.log(heading(`\n  ${headingText}\n`));
      for (const p of peers) {
        const roleStr = p.role ? chalk.magenta(p.role) : dim(t('peers.noRole'));
        console.log(`  ${label(p.id)}  ${roleStr}  ${dim(p.agent_type)}  pid:${p.pid}`);
        console.log(`    ${dim(t('peers.cwdLabel'))} ${p.cwd}`);
        if (p.git_branch) {
          console.log(`    ${dim(t('peers.branchLabel'))} ${p.git_branch}`);
        }
        if (p.summary) {
          console.log(`    ${dim(t('peers.summaryLabel'))} ${p.summary}`);
        }
      }
      console.log();
    });
}
