// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { Command } from 'commander';
import chalk from 'chalk';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import type { SharedGetResponse, SharedListResponse } from '../../shared/types.js';
import { heading, dim, label, err } from '../ui.js';
import { t } from '../../shared/i18n/index.js';

export function registerSharedCommand(program: Command): void {
  program
    .command('shared <project> [namespace] [key]')
    .description(t('cmd.shared'))
    .action(async (project: string, namespace?: string, key?: string) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err(`  ${t('shared.brokerNotRunning')}`));
        return;
      }

      // Show a specific key
      if (namespace && key) {
        const resp = await brokerFetch<SharedGetResponse | { error: string }>('/api/shared/get', {
          project_id: project,
          namespace,
          key,
        });

        if ('error' in resp) {
          console.log(dim(`  ${t('shared.keyNotFound', { key, namespace })}`));
          return;
        }

        console.log(heading(`\n  ${namespace}/${key}\n`));
        console.log(`  ${label(t('shared.valueLabel'))}      ${resp.value}`);
        console.log(`  ${label(t('shared.updatedByLabel'))} ${resp.updated_by}`);
        console.log(`  ${label(t('shared.updatedAtLabel'))} ${resp.updated_at}`);
        console.log();
        return;
      }

      // List keys in a namespace
      if (namespace) {
        const resp = await brokerFetch<SharedListResponse>('/api/shared/list', {
          project_id: project,
          namespace,
        });

        if (resp.keys.length === 0) {
          console.log(dim(`  ${t('shared.noKeys', { namespace })}`));
          return;
        }

        console.log(heading(`\n  ${t('shared.keysHeading', { namespace })}\n`));
        for (const k of resp.keys) {
          console.log(`  ${chalk.yellow(k)}`);
        }
        console.log();
        return;
      }

      // No namespace given — explain usage
      console.log(heading(`\n  ${t('shared.heading', { project })}\n`));
      console.log(`  ${t('shared.usageLabel')}`);
      console.log(`    ${dim('acc shared <project> <namespace>')}        ${dim(t('shared.usageListKeys'))}`);
      console.log(`    ${dim('acc shared <project> <namespace> <key>')}  ${dim(t('shared.usageShowValue'))}`);
      console.log();
    });
}
