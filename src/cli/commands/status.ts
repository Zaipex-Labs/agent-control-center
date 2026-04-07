import { Command } from 'commander';
import chalk from 'chalk';
import { brokerFetch, brokerGet, isBrokerAlive } from '../../server/broker-client.js';
import type { HealthResponse, Peer } from '../../shared/types.js';
import { heading, dim, label, err, success } from '../ui.js';
import { t } from '../../shared/i18n/index.js';

export function registerStatusCommand(program: Command): void {
  program
    .command('status [project]')
    .description('Show broker status and active peers')
    .action(async (project?: string) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err(`  ${t('status.brokerNotRunning')}`));
        console.log(dim(`  ${t('status.startHint')}`));
        return;
      }

      const health = await brokerGet<HealthResponse>('/health');
      console.log(heading(`\n  ${t('status.heading')}\n`));
      console.log(`  ${label(t('status.statusLabel'))}  ${success(t('status.online'))}`);
      console.log(`  ${label(t('status.peersLabel'))}   ${health.peers}`);
      console.log(`  ${label(t('status.pendingLabel'))} ${t('status.messages', { count: String(health.pending_messages) })}`);

      if (project) {
        const peers = await brokerFetch<Peer[]>('/api/list-peers', {
          project_id: project,
          scope: 'project',
        });

        if (peers.length === 0) {
          console.log(dim(`\n  ${t('status.noPeers', { project })}`));
        } else {
          console.log(heading(`\n  ${t('status.peersHeading', { project })}\n`));
          for (const p of peers) {
            const age = timeSince(p.last_seen);
            console.log(`  ${chalk.magenta(p.role || t('peers.noRole'))}  ${dim(p.id)}  pid:${p.pid}  ${dim(age)}`);
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
