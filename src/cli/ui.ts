import chalk from 'chalk';
import type { ProjectConfig } from '../shared/types.js';

export const heading = (text: string) => chalk.bold.cyan(text);
export const success = (text: string) => chalk.green(text);
export const warn = (text: string) => chalk.yellow(text);
export const err = (text: string) => chalk.red(text);
export const dim = (text: string) => chalk.dim(text);
export const label = (text: string) => chalk.bold(text);

export function printProject(config: ProjectConfig): void {
  console.log(heading(`\n  ${config.name}`));
  if (config.description) {
    console.log(`  ${dim(config.description)}`);
  }
  console.log(`  ${dim('Created:')} ${config.created_at}`);

  if (config.agents.length === 0) {
    console.log(`  ${dim('No agents configured.')}`);
  } else {
    console.log(`  ${label('Agents:')}`);
    for (const agent of config.agents) {
      console.log(`    ${chalk.magenta(agent.role)} ${dim('→')} ${agent.cwd}`);
      if (agent.agent_cmd !== 'claude') {
        console.log(`      ${dim('cmd:')} ${agent.agent_cmd} ${agent.agent_args.join(' ')}`);
      }
      if (agent.instructions) {
        console.log(`      ${dim('instructions:')} ${agent.instructions.slice(0, 80)}${agent.instructions.length > 80 ? '...' : ''}`);
      }
    }
  }
  console.log();
}

export function printProjectList(configs: ProjectConfig[]): void {
  if (configs.length === 0) {
    console.log(dim('  No projects found. Create one with: acc project create <name>'));
    return;
  }

  console.log(heading('\n  Projects\n'));
  for (const config of configs) {
    const agentCount = config.agents.length;
    const roles = config.agents.map(a => a.role).join(', ') || dim('no agents');
    console.log(`  ${label(config.name)}  ${dim(`(${agentCount} agent${agentCount !== 1 ? 's' : ''})`)}  ${roles}`);
  }
  console.log();
}
