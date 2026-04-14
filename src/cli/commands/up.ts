import { Command } from 'commander';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECTS_DIR } from '../../shared/config.js';
import { ensureBroker } from '../../server/broker-client.js';
import { spawnAgents, hasTmuxSession, registerMcpServer } from '../spawn.js';
import type { ProjectConfig } from '../../shared/types.js';
import { success, err, dim, heading, label, warn } from '../ui.js';
import { ACC_PORT } from '../../shared/config.js';
import { t } from '../../shared/i18n/index.js';
import chalk from 'chalk';

function loadProject(name: string): ProjectConfig {
  const path = join(PROJECTS_DIR, `${name}.json`);
  if (!existsSync(path)) {
    console.error(err(t('project.notFound', { name, path })));
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as ProjectConfig;
}

export function registerUpCommand(program: Command): void {
  program
    .command('up <project>')
    .description(t('cmd.up'))
    .option('--only <role>', t('cmd.upOnly'))
    .option('--strategy <s>', t('cmd.upStrategy'))
    .action(async (projectName: string, opts: { only?: string; strategy?: string }) => {
      const config = loadProject(projectName);

      let agents = config.agents;
      if (opts.only) {
        agents = agents.filter(a => a.role === opts.only);
        if (agents.length === 0) {
          console.error(err(t('up.noRole', { role: opts.only!, name: projectName })));
          process.exit(1);
        }
      }

      if (agents.length === 0) {
        console.error(err(t('up.noAgents', { name: projectName })));
        console.error(dim(`  ${t('up.addHint', { name: projectName })}`));
        process.exit(1);
      }

      // Check for existing tmux session
      if (hasTmuxSession(projectName)) {
        console.log(warn(`  ${t('up.tmuxExists', { name: projectName })}`));
        console.log(dim(`  ${t('up.tmuxHint', { name: projectName })}`));
        process.exit(1);
      }

      // Ensure broker is running
      console.log(dim(`  ${t('up.ensuringBroker')}`));
      try {
        await ensureBroker();
      } catch (e) {
        console.error(err(`  ${t('up.brokerFailed', { error: String(e) })}`));
        process.exit(1);
      }
      console.log(success(`  ${t('up.brokerReady')}`));

      // Register MCP server (user scope — once for all agents)
      try {
        registerMcpServer();
        console.log(success(`  ${t('up.mcpRegistered')}`));
      } catch (e) {
        console.error(err(`  ${t('up.mcpFailed', { error: String(e) })}`));
        console.error(dim(`  ${t('up.mcpHint')}`));
        process.exit(1);
      }

      // Clean up residual .mcp.json files from old --scope project registrations
      for (const agent of agents) {
        const mcpJson = join(agent.cwd, '.mcp.json');
        if (existsSync(mcpJson)) {
          unlinkSync(mcpJson);
          console.log(dim(`  ${t('up.removedResidual', { path: mcpJson })}`));
        }
      }

      // Spawn agents
      const strategy = (opts.strategy as 'tmux' | 'windows-terminal' | 'fallback') ?? undefined;
      const result = spawnAgents(projectName, agents, strategy);

      console.log(heading(`\n  ${t('up.projectUp', { name: projectName })}\n`));
      console.log(`  ${label(t('up.strategyLabel'))} ${result.strategy}`);
      console.log(`  ${label(t('up.agentsLabel'))}   ${agents.length}`);

      for (const agent of agents) {
        console.log(`    ${chalk.magenta(agent.role)} ${dim('→')} ${agent.cwd}`);
      }

      if (result.tmuxSession) {
        console.log(`\n  ${dim(t('up.attachWith'))} tmux attach -t ${result.tmuxSession}`);
      } else if (result.strategy === 'fallback') {
        console.log(`\n  ${dim(t('up.fallbackSpawned'))}`);
        console.log(`  ${dim(t('up.pidsLabel'))} ${result.pids.join(', ')}`);
        console.log(`  ${dim(t('up.stopWith'))} acc down ${projectName}`);
      }
      console.log(dim(`  App disponible en http://localhost:${ACC_PORT}`));
      console.log();
    });
}
