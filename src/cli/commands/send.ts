import { Command } from 'commander';
import { brokerFetch, isBrokerAlive } from '../../server/broker-client.js';
import type { RegisterResponse, SendToRoleResponse } from '../../shared/types.js';
import { success, err, dim } from '../ui.js';

export function registerSendCommand(program: Command): void {
  program
    .command('send <project> <message>')
    .description('Send a message to agents by role')
    .requiredOption('--to-role <role>', 'Target role (e.g. backend, frontend)')
    .option('-t, --type <type>', 'Message type', 'message')
    .action(async (project: string, message: string, opts: { toRole: string; type: string }) => {
      const alive = await isBrokerAlive();
      if (!alive) {
        console.log(err('  Broker is not running.'));
        return;
      }

      // Register a temporary CLI peer to send from
      const { id } = await brokerFetch<RegisterResponse>('/register', {
        pid: process.pid,
        cwd: process.cwd(),
        role: 'cli',
        agent_type: 'cli',
        summary: 'CLI user sending a message',
        project_id: project,
      });

      try {
        const resp = await brokerFetch<SendToRoleResponse>('/send-to-role', {
          project_id: project,
          from_id: id,
          role: opts.toRole,
          type: opts.type,
          text: message,
        });

        if (resp.sent_to === 0) {
          console.log(dim(`  No agents with role "${opts.toRole}" found in project "${project}".`));
        } else {
          console.log(success(`  Message sent to ${resp.sent_to} agent(s) with role "${opts.toRole}".`));
        }
      } finally {
        // Unregister the temporary peer
        await brokerFetch('/unregister', { id }).catch(() => {});
      }
    });
}
