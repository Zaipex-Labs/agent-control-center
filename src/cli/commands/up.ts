import { Command } from 'commander';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR } from '../../shared/config.js';
import { ensureBroker } from '../../server/broker-client.js';
import { spawnAgents, hasTmuxSession, registerMcpServer } from '../spawn.js';
import type { ProjectConfig } from '../../shared/types.js';
import { success, err, dim, heading, label, warn } from '../ui.js';
import chalk from 'chalk';

function loadProject(name: string): ProjectConfig {
  const path = join(PROJECTS_DIR, `${name}.json`);
  if (!existsSync(path)) {
    console.error(err(`Project "${name}" not found at ${path}`));
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as ProjectConfig;
}

export function registerUpCommand(program: Command): void {
  program
    .command('up <project>')
    .description('Start agents for a project')
    .option('--only <role>', 'Start only agents with this role')
    .option('--strategy <s>', 'Force spawn strategy: tmux, windows-terminal, fallback')
    .action(async (projectName: string, opts: { only?: string; strategy?: string }) => {
      const config = loadProject(projectName);

      let agents = config.agents;
      if (opts.only) {
        agents = agents.filter(a => a.role === opts.only);
        if (agents.length === 0) {
          console.error(err(`No agent with role "${opts.only}" in project "${projectName}".`));
          process.exit(1);
        }
      }

      if (agents.length === 0) {
        console.error(err(`Project "${projectName}" has no agents configured.`));
        console.error(dim('  Add one with: acc project add-agent ' + projectName + ' --role <r> --cwd <d>'));
        process.exit(1);
      }

      // Check for existing tmux session
      if (hasTmuxSession(projectName)) {
        console.log(warn(`  tmux session "acc-${projectName}" already exists.`));
        console.log(dim(`  Run "acc down ${projectName}" first, or attach with: tmux attach -t acc-${projectName}`));
        process.exit(1);
      }

      // Ensure broker is running
      console.log(dim('  Ensuring broker is alive...'));
      try {
        await ensureBroker();
      } catch (e) {
        console.error(err(`  Failed to start broker: ${e}`));
        process.exit(1);
      }
      console.log(success('  Broker is ready.'));

      // Register MCP server (user scope — once for all agents)
      try {
        registerMcpServer();
        console.log(success('  MCP server registered (user scope).'));
      } catch (e) {
        console.error(err(`  Failed to register MCP server: ${e}`));
        console.error(dim('  Make sure "claude" CLI is installed and available in PATH.'));
        process.exit(1);
      }

      // Clean up residual .mcp.json files from old --scope project registrations
      for (const agent of agents) {
        const mcpJson = join(agent.cwd, '.mcp.json');
        if (existsSync(mcpJson)) {
          unlinkSync(mcpJson);
          console.log(dim(`  Removed residual ${mcpJson}`));
        }
      }

      // Spawn agents
      const strategy = (opts.strategy as 'tmux' | 'windows-terminal' | 'fallback') ?? undefined;
      const result = spawnAgents(projectName, agents, strategy);

      console.log(heading(`\n  Project "${projectName}" is up\n`));
      console.log(`  ${label('Strategy:')} ${result.strategy}`);
      console.log(`  ${label('Agents:')}   ${agents.length}`);

      for (const agent of agents) {
        console.log(`    ${chalk.magenta(agent.role)} ${dim('→')} ${agent.cwd}`);
      }

      if (result.tmuxSession) {
        console.log(`\n  ${dim('Attach with:')} tmux attach -t ${result.tmuxSession}`);
      } else if (result.strategy === 'fallback') {
        console.log(`\n  ${dim('Agents spawned as background processes.')}`);
        console.log(`  ${dim('PIDs:')} ${result.pids.join(', ')}`);
        console.log(`  ${dim('Stop with:')} acc down ${projectName}`);
      }
      console.log();
    });
}
