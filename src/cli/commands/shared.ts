import { Command } from 'commander';
import chalk from 'chalk';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import type { SharedGetResponse, SharedListResponse } from '../../shared/types.js';
import { heading, dim, label, err } from '../ui.js';

export function registerSharedCommand(program: Command): void {
  program
    .command('shared <project> [namespace] [key]')
    .description('View shared state. With no args: list namespaces. With namespace: list keys. With both: show value.')
    .action(async (project: string, namespace?: string, key?: string) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err('  Broker is not running.'));
        return;
      }

      // Show a specific key
      if (namespace && key) {
        const resp = await brokerFetch<SharedGetResponse | { error: string }>('/shared/get', {
          project_id: project,
          namespace,
          key,
        });

        if ('error' in resp) {
          console.log(dim(`  Key "${key}" not found in namespace "${namespace}".`));
          return;
        }

        console.log(heading(`\n  ${namespace}/${key}\n`));
        console.log(`  ${label('Value:')}      ${resp.value}`);
        console.log(`  ${label('Updated by:')} ${resp.updated_by}`);
        console.log(`  ${label('Updated at:')} ${resp.updated_at}`);
        console.log();
        return;
      }

      // List keys in a namespace
      if (namespace) {
        const resp = await brokerFetch<SharedListResponse>('/shared/list', {
          project_id: project,
          namespace,
        });

        if (resp.keys.length === 0) {
          console.log(dim(`  No keys in namespace "${namespace}".`));
          return;
        }

        console.log(heading(`\n  Keys in "${namespace}"\n`));
        for (const k of resp.keys) {
          console.log(`  ${chalk.yellow(k)}`);
        }
        console.log();
        return;
      }

      // No namespace given — there's no "list namespaces" endpoint,
      // so explain usage
      console.log(heading(`\n  Shared State (${project})\n`));
      console.log(`  Usage:`);
      console.log(`    ${dim('acc shared <project> <namespace>')}        ${dim('— list keys in namespace')}`);
      console.log(`    ${dim('acc shared <project> <namespace> <key>')}  ${dim('— show value')}`);
      console.log();
    });
}
