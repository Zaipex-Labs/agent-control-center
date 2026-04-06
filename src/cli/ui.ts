import chalk from 'chalk';
import { t } from '../shared/i18n/index.js';
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
  console.log(`  ${dim(t('ui.createdLabel'))} ${config.created_at}`);

  if (config.agents.length === 0) {
    console.log(`  ${dim(t('ui.noAgents'))}`);
  } else {
    console.log(`  ${label(t('ui.agentsLabel'))}`);
    for (const agent of config.agents) {
      console.log(`    ${chalk.magenta(agent.role)} ${dim('→')} ${agent.cwd}`);
      if (agent.agent_cmd !== 'claude') {
        console.log(`      ${dim(t('ui.cmdLabel'))} ${agent.agent_cmd} ${agent.agent_args.join(' ')}`);
      }
      if (agent.instructions) {
        console.log(`      ${dim(t('ui.instructionsLabel'))} ${agent.instructions.slice(0, 80)}${agent.instructions.length > 80 ? '...' : ''}`);
      }
    }
  }
  console.log();
}

export function printProjectList(configs: ProjectConfig[]): void {
  if (configs.length === 0) {
    console.log(dim(`  ${t('ui.noProjects')}`));
    return;
  }

  console.log(heading(`\n  ${t('ui.projectsHeading')}\n`));
  for (const config of configs) {
    const agentCount = config.agents.length;
    const roles = config.agents.map(a => a.role).join(', ') || dim(t('ui.noAgents'));
    console.log(`  ${label(config.name)}  ${dim(`(${t('ui.agentCount', { count: String(agentCount) })})`)}  ${roles}`);
  }
  console.log();
}
