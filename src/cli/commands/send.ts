// Copyright 2025-2026 Zaipex Labs (zaipex.ai)
// Licensed under the Apache License, Version 2.0
// See LICENSE file for details.

import { Command } from 'commander';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import type { RegisterResponse, SendToRoleResponse } from '../../shared/types.js';
import { success, err, dim } from '../ui.js';
import { t } from '../../shared/i18n/index.js';

export function registerSendCommand(program: Command): void {
  program
    .command('send <project> <message>')
    .description(t('cmd.send'))
    .requiredOption('--to-role <role>', t('cmd.sendRole'))
    .option('-t, --type <type>', t('cmd.sendType'), 'message')
    .action(async (project: string, message: string, opts: { toRole: string; type: string }) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err(`  ${t('send.brokerNotRunning')}`));
        return;
      }

      // Register a temporary CLI peer to send from
      const { id } = await brokerFetch<RegisterResponse>('/api/register', {
        pid: process.pid,
        cwd: process.cwd(),
        role: 'cli',
        agent_type: 'cli',
        summary: t('send.cliSummary'),
        project_id: project,
      });

      try {
        const resp = await brokerFetch<SendToRoleResponse>('/api/send-to-role', {
          project_id: project,
          from_id: id,
          role: opts.toRole,
          type: opts.type,
          text: message,
        });

        if (resp.sent_to === 0) {
          console.log(dim(`  ${t('send.noAgents', { role: opts.toRole, project })}`));
        } else {
          console.log(success(`  ${t('send.sent', { count: String(resp.sent_to), role: opts.toRole })}`));
        }
      } finally {
        // Unregister the temporary peer
        await brokerFetch('/api/unregister', { id }).catch(() => {});
      }
    });
}
