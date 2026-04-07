import { Command } from 'commander';
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { ensureBroker, isBrokerAlive } from '../../server/broker-client.js';
import { ACC_PORT } from '../../shared/config.js';
import { success, dim, err, heading } from '../ui.js';

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open'
    : platform() === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${cmd} ${url}`);
}

export function registerAppCommand(program: Command): void {
  program
    .command('app')
    .description('Open the ACC web dashboard in your browser')
    .option('--port <port>', 'Broker port', String(ACC_PORT))
    .option('--no-open', 'Do not open the browser automatically')
    .action(async (opts: { port: string; open: boolean }) => {
      const port = Number(opts.port);
      const url = `http://localhost:${port}`;

      console.log(dim('  Ensuring broker is running...'));
      try {
        await ensureBroker();
      } catch (e) {
        console.error(err(`  Failed to start broker: ${e}`));
        process.exit(1);
      }
      console.log(success('  Broker ready'));

      console.log(heading(`\n  ACC app running at ${url}\n`));

      if (opts.open) {
        openBrowser(url);
        console.log(dim('  Browser opened. Press Ctrl+C to stop.\n'));
      }

      // Keep process alive so the user can Ctrl+C
      const alive = await isBrokerAlive();
      if (alive) {
        // Just wait — the broker is a separate process
        // Nothing to keep alive here, exit cleanly
      }
    });
}
